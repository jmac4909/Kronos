import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';
import { RUNS_DIR, appendRunLog as appendRunLogFile, markRunCancelled, readRunRecord, readRuns, writeRunPrompt, writeRunRecord } from '../services/runStore';
import { readStateFile } from '../services/stateStore';
import { RunFailureKind, classifyRunFailure, type PostRunReadiness } from '../services/postRunReadiness';
import { stopProcessTree, supportsProcessTreeSuspend } from '../services/processTree';
import { createWebviewReadyMonitor } from '../services/webviewDiagnostics';
import { WEBVIEW_ACTION_PANEL_SCRIPT, WEBVIEW_READY_COMMAND, createWebviewNonce, webviewActionScriptTag, webviewScriptCspOptions, withWebviewCsp } from '../services/webviewSecurity';
import { currentGitCommit, currentGitRef, inspectTrackedWorktree, prepareManagedWorktree, removeWorktreeSafely } from '../services/gitWorkspace';
import { checkGcloudApplicationDefaultAuth } from '../services/cliProbes';
import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss } from '../services/webviewHtml';
import { resolveDefaultBaseBranch, sanitizeBranch } from '../services/profileManager';
import { safeFileStem } from '../services/fileNames';
import { SavedSession, SessionStats, safeSessionId, writeSavedSession } from '../services/sessionStore';
import { ACTIVE_WORKTREES_FILE, ActiveWorktreeEntry, loadActiveWorktreeRegistry, trackActiveWorktree, untrackActiveWorktree } from '../services/worktreeRegistry';
import { gcloudApplicationDefaultLoginCommand, kronosLoginShellTerminalOptions, kronosTerminalOptions } from '../services/terminalProfiles';
import { unknownErrorMessage } from '../services/errorUtils';
import { isFreshActiveRun } from '../services/runStatus';
import { runProgressSummary } from '../services/runProgress';
import { isAttentionRunStatus, runAttentionDetail } from '../services/runAttention';
import { sortedRunCenterRuns } from '../services/runCenterSort';
import { readJsonFile } from '../services/jsonFiles';
export { getAggregateStats, listSavedSessions, listSessionStoreIssues } from '../services/sessionStore';

const CLAUDE_PATH = process.env['CLAUDE_PATH'] || 'claude';
const CLAUDE_PERMISSION_MODE = 'acceptEdits';
const CLAUDE_ALLOWED_TOOL_PATTERNS = [
  'Bash(git *)',
  'Bash(mvn *)',
  'Bash(python *)',
  'Bash(curl *)',
  'Bash(kill *)',
  'Bash(pkill *)',
  'Bash(nohup *)',
  'Bash(sleep *)',
  'Bash(cd *)',
  'Bash(ls *)',
  'Bash(cat *)',
  'Bash(rm *)',
  'Bash(cp *)',
  'Bash(mkdir *)',
  'Bash(echo *)',
  'Bash(grep *)',
  'Bash(head *)',
  'Bash(tail *)',
  'Bash(taskkill *)',
  'PowerShell(Stop-Process *)',
  'PowerShell(Get-Process *)',
];
const CLAUDE_ALLOWED_TOOLS = CLAUDE_ALLOWED_TOOL_PATTERNS.join(' ');

const RUN_CENTER_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'archiveFinishedRuns',
  'openRunRecord',
  'openRunLog',
  'openRunPrompt',
  'openRunWorkspace',
  'openRunDiff',
  'markNeedsHuman',
  'pauseRun',
  'continueRun',
  'cancelRun',
  'resumeRun',
  'retryRun',
  'archiveRun',
]);

export interface RunCenterActionRequest {
  command: string;
  runId: string;
}

interface RunCenterOptions {
  onAction?: (request: RunCenterActionRequest) => Promise<void> | void;
  pollIntervalMs?: number;
  extensionUri?: vscode.Uri | undefined;
  focusRunId?: string | undefined;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) { fs.mkdirSync(dir, { recursive: true }); }
}

function validateModel(model: string): string {
  if (!/^[A-Za-z0-9._:@/\-[\]]+$/.test(model)) {
    throw new Error(`Unsafe model id: ${model}`);
  }
  return model;
}

function configuredDefaultBaseBranch(): string {
  const config = vscode.workspace.getConfiguration('kronos');
  return resolveDefaultBaseBranch(config.get<string>('profile'), config.get<string>('defaultBaseBranch'));
}

interface BaseRefResolution {
  branch: string;
  ref: string;
  source: 'profile' | 'state' | 'project-json';
  warning?: string;
}

function resolveBaseRef(projectPath: string): BaseRefResolution {
  let base = configuredDefaultBaseBranch();
  let source: BaseRefResolution['source'] = 'profile';
  const warnings: string[] = [];
  const stateBranch = configuredStateBaseBranch(projectPath);
  if (stateBranch.warning) { warnings.push(stateBranch.warning); }
  if (stateBranch.branch) {
    base = stateBranch.branch;
    source = 'state';
  }

  if (!stateBranch.branch) {
    const projConfig = path.join(projectPath, '.claude', 'project.json');
    const projectBranch = configuredProjectJsonBaseBranch(projConfig);
    if (projectBranch.warning) { warnings.push(projectBranch.warning); }
    if (projectBranch.branch) {
      base = projectBranch.branch;
      source = 'project-json';
    }
  }

  const result: BaseRefResolution = {
    branch: base,
    ref: `origin/${base}`,
    source,
  };
  const warning = warnings.join('\n');
  if (warning) { result.warning = warning; }
  return result;
}

function configuredStateBaseBranch(projectPath: string): { branch?: string; warning?: string } {
  try {
    const state = readStateFile();
    const project = Object.values(state?.projects || {}).find(p => p.path === projectPath);
    const configured = project?.config?.base_branch || project?.config?.default_branch;
    if (typeof configured !== 'string' || !configured.trim()) { return {}; }
    const branch = sanitizeBranch(configured);
    return branch
      ? { branch }
      : { warning: `Ignoring unsafe state base branch for ${projectPath}: ${configured}` };
  } catch (e: unknown) {
    return { warning: unknownErrorMessage(e, 'Could not read Kronos state for base branch.') };
  }
}

function configuredProjectJsonBaseBranch(projConfig: string): { branch?: string; warning?: string } {
  if (!fs.existsSync(projConfig)) { return {}; }
  try {
    const parsed = readJsonFile(projConfig);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { return {}; }
    const cfg = parsed as Record<string, unknown>;
    const configured = cfg['base_branch'] || cfg['default_branch'];
    if (typeof configured !== 'string' || !configured.trim()) { return {}; }
    const branch = sanitizeBranch(configured);
    return branch
      ? { branch }
      : { warning: `Ignoring unsafe project base branch in ${projConfig}: ${configured}` };
  } catch (e: unknown) {
    return { warning: `Could not read project base branch from ${projConfig}: ${unknownErrorMessage(e, 'Invalid JSON')}` };
  }
}

function configuredProjectExtraDirs(projectPath: string): { dirs: string[]; warning?: string } {
  try {
    const state = readStateFile();
    const project = Object.values(state?.projects || {}).find(p => p.path === projectPath);
    const dirs = project?.config?.extra_dirs;
    return {
      dirs: Array.isArray(dirs)
        ? dirs.filter((dir): dir is string => typeof dir === 'string' && dir.trim().length > 0)
        : [],
    };
  } catch (e: unknown) {
    return { dirs: [], warning: unknownErrorMessage(e, 'Failed to read Kronos state.') };
  }
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export interface KronosRun {
  id: string;
  project: string;
  projectPath: string;
  skill: string;
  ticket: string;
  status: 'preflight' | 'running' | 'paused' | 'waiting_for_review' | 'completed' | 'failed' | 'cancelled' | 'needs_human';
  model: string;
  promptHash: string;
  promptPreview: string;
  promptPath?: string;
  promptMetadata?: PromptRunMetadata;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  worktreePath?: string;
  cwd: string;
  logPath: string;
  processPid?: number;
  branch?: RunBranchMetadata;
  permissions?: RunPermissionMetadata;
  events: Array<{ type: string; label: string; detail: string; timestamp: string }>;
  failureReason?: string;
  failureKind?: RunFailureKind;
  readiness?: PostRunReadiness;
  warnings?: string[];
  recoveryActions?: Array<{ at: string; action: string; reason: string }>;
  [key: string]: unknown;
}

export interface RunBranchMetadata {
  projectBaseRef?: string;
  projectBaseBranch?: string;
  projectBaseSource?: string;
  projectBaseWarning?: string;
  requestedWorktreeBranch?: string;
  resolvedWorktreeRef?: string;
  checkoutRef?: string;
  currentRef?: string;
  currentCommit?: string;
  managedWorktree?: boolean;
}

export interface RunPermissionMetadata {
  claudePath: string;
  permissionMode: string;
  allowedTools: string[];
  addDirs: string[];
}

export interface PromptRunMetadata {
  name?: string;
  source?: 'project' | 'global' | 'slash' | 'custom';
  path?: string;
  templateHash?: string;
  renderedHash?: string;
  modifiedAt?: string;
  variables?: string[];
  providedVariables?: string[];
  missingVariables?: string[];
  appendSystemPromptHash?: string;
  retryOfRunId?: string;
  handoff?: string;
  mergeRequestIid?: number;
}

interface WorktreeCleanupResult {
  entry: ActiveWorktreeEntry;
  status: 'missing' | 'removable' | 'removed' | 'blocked' | 'error';
  reason: string;
}

interface WorktreeCleanupReport {
  results: WorktreeCleanupResult[];
  removable: number;
  removed: number;
  blocked: number;
  registryPath?: string;
  registryIssue?: string;
}

function computeStats(events: ProgressEvent[]): SessionStats {
  const progress = runProgressSummary({ events });
  const thinkingCount = events.filter(e => e.type === 'thinking').length;
  const doneEvent = events.find(e => e.type === 'done');
  const verdict = doneEvent ? (doneEvent.label.includes('Complete') ? 'success' : 'error') : 'unknown';
  return {
    toolCalls: progress.toolCalls,
    toolErrors: progress.toolErrors,
    thinkingCount,
    filesRead: progress.filesRead,
    filesEdited: progress.filesChanged,
    durationSec: progress.elapsedSeconds,
    verdict,
  };
}

function saveSession(project: string, skill: string, ticket: string, events: ProgressEvent[]): string {
  const id = safeSessionId(`${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`);
  const stats = computeStats(events);
  const firstEvent = events[0];
  const session: SavedSession = {
    id,
    project,
    skill,
    ticket,
    startedAt: firstEvent ? firstEvent.timestamp.toISOString() : new Date().toISOString(),
    events: events.map(e => ({ type: e.type, label: e.label, detail: e.detail, timestamp: e.timestamp.toISOString() })),
    stats,
  };
  writeSavedSession(session);
  return id;
}

export function openSavedSession(session: SavedSession): void {
  const sessionStart = progressDateOr(session.startedAt, new Date());
  const events: ProgressEvent[] = session.events.map(e => ({
    ...e,
    timestamp: progressDateOr(e.timestamp, sessionStart),
  } as ProgressEvent));
  const panel = vscode.window.createWebviewPanel(
    'kronosProgress',
    `Kronos: ${session.project} (${session.skill}) — saved`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );
  panel.webview.html = withWebviewCsp(buildProgressHtml(session.project, session.skill, session.ticket, events));
}

function createRun(project: string, projectPath: string, skill: string, ticket: string, model: string, prompt: string, cwd: string, promptMetadata?: PromptRunMetadata): KronosRun {
  ensureDir(RUNS_DIR);
  const id = safeFileStem(`${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`, { fallback: 'run', maxLength: 160 });
  const logPath = path.join(RUNS_DIR, `${id}.log`);
  const promptPath = writeRunPrompt(id, prompt);
  const run: KronosRun = {
    id,
    project,
    projectPath,
    skill,
    ticket,
    status: 'preflight',
    model,
    promptHash: hashText(prompt),
    promptPreview: prompt.substring(0, 500),
    promptPath,
    startedAt: new Date().toISOString(),
    cwd,
    logPath,
    events: [],
  };
  if (promptMetadata) { run.promptMetadata = promptMetadata; }
  writeRun(run);
  return run;
}

function writeRun(run: KronosRun): void {
  writeRunRecord(run);
}

function appendRunLog(run: KronosRun, chunk: string): void {
  appendRunLogFile(run.logPath, chunk);
}

function addRunEvent(run: KronosRun, event: ProgressEvent): void {
  run.events.push({ type: event.type, label: event.label, detail: event.detail, timestamp: event.timestamp.toISOString() });
  if (run.events.length > 250) { run.events = run.events.slice(-250); }
  writeRun(run);
}

function updateRun(run: KronosRun, patch: Partial<KronosRun>): void {
  Object.assign(run, patch);
  writeRun(run);
}

export function listRuns(): KronosRun[] {
  return readRuns(100) as KronosRun[];
}

export interface DispatchOptions {
  onComplete?: (code: number, run: KronosRun) => void | Promise<void>;
  customPrompt?: string;
  promptMetadata?: PromptRunMetadata;
  parallel?: boolean;
  appendSystemPrompt?: string;
  worktreeBranch?: string;
  extraDirs?: string[];
  workspaceCwd?: string;
  projectNameOverride?: string;
}

export interface DispatchLaunchResult {
  runId?: string;
  launched: boolean;
  status?: KronosRun['status'] | 'failed';
  failureReason?: string;
}

async function runCompletionCallback(
  opts: DispatchOptions,
  code: number,
  run: KronosRun,
  context: { projectName: string; skill: string; ticket: string; events: ProgressEvent[]; panel: vscode.WebviewPanel }
): Promise<void> {
  if (!opts.onComplete) { return; }
  try {
    await opts.onComplete(code, run);
  } catch (e: unknown) {
    const detail = unknownErrorMessage(e, 'Post-run completion callback failed.');
    const event = { type: 'error' as const, label: 'Post-run completion callback failed', detail, timestamp: new Date() };
    context.events.push(event);
    addRunEvent(run, event);
    const nextStatus = run.status === 'completed' || run.status === 'waiting_for_review' ? 'needs_human' : run.status;
    const failureReason = run.failureReason
      ? `${run.failureReason}; post-run callback failed: ${detail}`
      : `Post-run callback failed: ${detail}`;
    updateRun(run, {
      status: nextStatus,
      failureReason,
      failureKind: classifyRunFailure({ ...run, status: nextStatus, failureReason, events: run.events }),
    });
    context.panel.webview.html = withWebviewCsp(buildProgressHtml(context.projectName, context.skill, context.ticket, context.events, run));
    saveSession(context.projectName, context.skill, context.ticket, context.events);
    vscode.window.showWarningMessage(`Kronos post-run completion failed for ${run.id}. See Run Center.`);
  }
}

function resolveCliPath(value: string): string {
  if (value === '~') { return os.homedir(); }
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function buildClaudeArgs(prompt: string, model: string, appendSystemPrompt: string | undefined, addDirs: string[]): string[] {
  const args = ['-p', prompt, '--model', model];
  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }
  for (const dir of addDirs) {
    args.push('--add-dir', resolveCliPath(dir));
  }
  args.push(
    '--permission-mode', CLAUDE_PERMISSION_MODE,
    '--allowedTools', CLAUDE_ALLOWED_TOOLS,
    '--output-format', 'stream-json',
    '--verbose',
  );
  return args;
}

function buildRunPermissionMetadata(addDirs: string[]): RunPermissionMetadata {
  return {
    claudePath: CLAUDE_PATH,
    permissionMode: CLAUDE_PERMISSION_MODE,
    allowedTools: [...CLAUDE_ALLOWED_TOOL_PATTERNS],
    addDirs: addDirs.map(resolveCliPath),
  };
}

function buildRunBranchMetadata(input: {
  cwd: string;
  projectBaseRef?: string | undefined;
  projectBaseBranch?: string | undefined;
  projectBaseSource?: string | undefined;
  projectBaseWarning?: string | undefined;
  requestedWorktreeBranch?: string | undefined;
  resolvedWorktreeRef?: string | undefined;
  checkoutRef?: string | undefined;
  managedWorktree?: boolean;
}): RunBranchMetadata {
  const metadata: RunBranchMetadata = {
    managedWorktree: Boolean(input.managedWorktree),
  };
  if (input.projectBaseRef) { metadata.projectBaseRef = input.projectBaseRef; }
  if (input.projectBaseBranch) { metadata.projectBaseBranch = input.projectBaseBranch; }
  if (input.projectBaseSource) { metadata.projectBaseSource = input.projectBaseSource; }
  if (input.projectBaseWarning) { metadata.projectBaseWarning = input.projectBaseWarning; }
  if (input.requestedWorktreeBranch) { metadata.requestedWorktreeBranch = input.requestedWorktreeBranch; }
  if (input.resolvedWorktreeRef) { metadata.resolvedWorktreeRef = input.resolvedWorktreeRef; }
  if (input.checkoutRef) { metadata.checkoutRef = input.checkoutRef; }
  const currentRef = currentGitRef(input.cwd);
  if (currentRef) { metadata.currentRef = currentRef; }
  const currentCommit = currentGitCommit(input.cwd);
  if (currentCommit) { metadata.currentCommit = currentCommit; }
  return metadata;
}

export async function ensureAuth(): Promise<boolean> {
  const auth = checkGcloudApplicationDefaultAuth();
  if (auth.ok) {
    return true;
  }
  const action = await vscode.window.showWarningMessage(
    'GCP auth expired or missing. Authenticate now?',
    'Login', 'Cancel'
  );
  if (action === 'Login') {
    const terminalOptions = kronosTerminalOptions({ name: 'Kronos Auth' });
    const terminal = vscode.window.createTerminal(terminalOptions);
    terminal.sendText(gcloudApplicationDefaultLoginCommand(terminalOptions.shellPath));
    terminal.show();
    vscode.window.showInformationMessage('Complete browser login, then try again.');
  }
  return false;
}

function trackWorktree(projectPath: string, worktreePath: string, ticket: string): void {
  trackActiveWorktree(projectPath, worktreePath, ticket);
}

function untrackWorktree(worktreePath: string): void {
  untrackActiveWorktree(worktreePath);
}

function inspectWorktree(entry: ActiveWorktreeEntry): WorktreeCleanupResult {
  return inspectTrackedWorktree(entry);
}

export function cleanupStaleWorktrees(options: { remove?: boolean } = {}): WorktreeCleanupReport {
  const registry = loadActiveWorktreeRegistry();
  const entries = registry.entries;
  const results: WorktreeCleanupResult[] = [];
  for (const entry of entries) {
    const inspected = inspectWorktree(entry);
    if (inspected.status === 'missing') {
      if (options.remove) {
        untrackWorktree(entry.worktreePath);
        results.push({ ...inspected, status: 'removed' });
      } else {
        results.push(inspected);
      }
      continue;
    }
    if (inspected.status === 'removable' && options.remove) {
      const warning = removeWorktreeSafely(entry.projectPath, entry.worktreePath, { onRemoved: () => untrackWorktree(entry.worktreePath) });
      results.push(warning
        ? { entry, status: 'blocked', reason: warning }
        : { entry, status: 'removed', reason: 'Removed clean worktree.' });
      continue;
    }
    results.push(inspected);
  }
  const report: WorktreeCleanupReport = {
    results,
    removable: results.filter(r => r.status === 'removable' || r.status === 'missing').length,
    removed: results.filter(r => r.status === 'removed').length,
    blocked: results.filter(r => r.status === 'blocked' || r.status === 'error').length,
    registryPath: ACTIVE_WORKTREES_FILE,
  };
  if (registry.issue) { report.registryIssue = registry.issue; }
  return report;
}

export function openRunCenter(options: RunCenterOptions = {}): void {
  const interactive = Boolean(options.onAction);
  const nonce = interactive ? createWebviewNonce() : '';
  const webviewOptions: vscode.WebviewOptions = interactive && options.extensionUri
    ? { enableScripts: interactive, localResourceRoots: [vscode.Uri.joinPath(options.extensionUri, 'media')] }
    : { enableScripts: interactive };
  const panel = vscode.window.createWebviewPanel(
    'kronosRunCenter',
    'Kronos Run Center',
    vscode.ViewColumn.One,
    webviewOptions
  );
  const actionScriptUri = interactive && options.extensionUri
    ? panel.webview.asWebviewUri(vscode.Uri.joinPath(options.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT)).toString()
    : undefined;
  const render = (): boolean => {
    const runs = listRuns();
    panel.webview.html = withWebviewCsp(
      buildRunCenterHtml(runs, interactive ? nonce : undefined, actionScriptUri, options.focusRunId),
      interactive ? webviewScriptCspOptions(panel.webview.cspSource, nonce) : {},
    );
    return runs.some(run => isFreshActiveRun(run));
  };
  const warnPanelFailure = (error: unknown, fallback: string): void => {
    const detail = unknownErrorMessage(error, fallback);
    console.warn(detail);
    vscode.window.showWarningMessage(detail);
  };
  const safeRender = (): void => {
    try {
      wasActive = render();
    } catch (e: unknown) {
      warnPanelFailure(e, 'Kronos Run Center refresh failed.');
    }
  };
  let wasActive = false;
  if (interactive && options.onAction) {
    const pollIntervalMs = Math.max(1000, options.pollIntervalMs || 5000);
    const logReady = createWebviewReadyMonitor(panel, 'Kronos Run Center');
    const pollTimer = setInterval(() => {
      const hasActive = listRuns().some(run => isFreshActiveRun(run));
      if (hasActive || wasActive) {
        safeRender();
      }
    }, pollIntervalMs);
    panel.onDidDispose(() => clearInterval(pollTimer));
    panel.webview.onDidReceiveMessage(async msg => {
      if (logReady(msg)) { return; }
      const request = normalizeRunCenterMessage(msg);
      if (!request) {
        vscode.window.showWarningMessage('Ignored invalid Kronos Run Center action.');
        return;
      }
      if (request.command === 'refreshPanel') {
        safeRender();
        return;
      }
      try {
        await options.onAction!(request);
      } catch (e: unknown) {
        warnPanelFailure(e, 'Kronos Run Center action failed.');
      }
      safeRender();
    });
  }
  safeRender();
}

export async function dispatchClaudeSession(
  projectPath: string,
  skill: string,
  ticket?: string,
  onCompleteOrOpts?: ((code: number) => void) | DispatchOptions,
  customPrompt?: string
): Promise<DispatchLaunchResult> {
  const opts: DispatchOptions = typeof onCompleteOrOpts === 'function'
    ? { onComplete: onCompleteOrOpts }
    : (onCompleteOrOpts || {});
  if (typeof onCompleteOrOpts === 'function' && customPrompt) {
    opts.customPrompt = customPrompt;
  }

  const prompt = opts.customPrompt || (ticket ? `/${skill} ${ticket}` : `/${skill}`);
  const projectName = opts.projectNameOverride || projectPath.split(/[\\/]/).pop() || 'project';

  const panel = vscode.window.createWebviewPanel(
    'kronosProgress',
    `Kronos: ${projectName} (${skill})`,
    vscode.ViewColumn.One,
    { enableScripts: false }
  );

  const events: ProgressEvent[] = [{ type: 'text', label: 'Setting up session...', detail: '', timestamp: new Date() }];
  panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events));

  const config = vscode.workspace.getConfiguration('kronos');
  let model: string;
  try {
    model = validateModel(config.get<string>('dispatchModel', 'claude-opus-4-6'));
  } catch (e: unknown) {
    const failureReason = unknownErrorMessage(e, 'Invalid dispatch model.');
    vscode.window.showErrorMessage(failureReason);
    panel.dispose();
    return { launched: false, status: 'failed', failureReason };
  }

  let cwd = opts.workspaceCwd || projectPath;
  let worktreePath: string | null = opts.workspaceCwd && opts.workspaceCwd !== projectPath ? opts.workspaceCwd : null;
  let managedWorktreePath: string | null = null;
  const baseRef = resolveBaseRef(projectPath);
  const projectBaseRef = baseRef.ref;
  const requestedWorktreeBranch = opts.worktreeBranch;
  let resolvedWorktreeRef: string | undefined;
  let checkoutRef: string | undefined;
  const promptMetadata: PromptRunMetadata = opts.promptMetadata
    ? { ...opts.promptMetadata }
    : { source: opts.customPrompt ? 'custom' : 'slash' };
  if (opts.appendSystemPrompt) {
    promptMetadata.appendSystemPromptHash = hashText(opts.appendSystemPrompt);
  }
  const run = createRun(projectName, projectPath, skill, ticket || '', model, prompt, cwd, promptMetadata);
  const initialPatch: Partial<KronosRun> = {
    cwd,
    branch: buildRunBranchMetadata({
      cwd,
      projectBaseRef,
      projectBaseBranch: baseRef.branch,
      projectBaseSource: baseRef.source,
      projectBaseWarning: baseRef.warning,
      requestedWorktreeBranch,
      managedWorktree: false,
    }),
    permissions: buildRunPermissionMetadata(['~/.claude']),
  };
  if (worktreePath) { initialPatch.worktreePath = worktreePath; }
  updateRun(run, initialPatch);
  const setupEvent = events[0];
  if (setupEvent) {
    addRunEvent(run, setupEvent);
  }
  if (baseRef.warning) {
    const event = { type: 'error' as const, label: 'Could not fully resolve project base branch config', detail: baseRef.warning, timestamp: new Date() };
    events.push(event);
    addRunEvent(run, event);
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
  }

  const authed = await ensureAuth();
  if (!authed) {
    const message = 'GCP auth expired or missing.';
    const event = { type: 'error' as const, label: message, detail: 'Authenticate and retry the saved prompt from Run Center.', timestamp: new Date() };
    events.push(event);
    addRunEvent(run, event);
    updateRun(run, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      exitCode: 1,
      failureReason: message,
      failureKind: classifyRunFailure({ ...run, status: 'failed', failureReason: message, events: run.events }),
    });
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
    saveSession(projectName, skill, ticket || '', events);
    await runCompletionCallback(opts, 1, run, { projectName, skill, ticket: ticket || '', events, panel });
    return launchResult(run, false);
  }

  if (opts.parallel) {
    const safeName = safeFileStem(ticket || skill, { fallback: 'worktree', maxLength: 80 });
    const wtName = `kronos-${safeName}-${Date.now().toString(36)}`;
    const wtDir = path.join(projectPath, '.claude', 'worktrees', wtName);

    let targetBranch = opts.worktreeBranch || projectBaseRef;
    resolvedWorktreeRef = targetBranch;

    try {
      const event = { type: 'text' as const, label: `Creating worktree on ${targetBranch}...`, detail: '', timestamp: new Date() };
      events.push(event);
      addRunEvent(run, event);
      panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
      // For feature branches: use local name so worktree gets a real branch checkout
      // For base branches: use origin/ ref so the main checkout is not mutated
      const isFeatureBranch = Boolean(opts.worktreeBranch);
      const registry = loadActiveWorktreeRegistry();
      if (registry.issue) {
        throw new Error(`Active worktree registry needs manual review before creating a worktree: ${registry.issue}`);
      }
      const prepared = prepareManagedWorktree({
        projectPath,
        worktreePath: wtDir,
        targetRef: targetBranch,
        featureBranch: isFeatureBranch,
      });
      checkoutRef = prepared.checkoutRef;
      if (prepared.pullWarning) {
        const warning = `Managed worktree pull skipped: ${prepared.pullWarning}`;
        const event = { type: 'error' as const, label: 'Managed worktree pull skipped', detail: prepared.pullWarning, timestamp: new Date() };
        events.push(event);
        addRunEvent(run, event);
        updateRun(run, { warnings: [...(run.warnings || []), warning] });
      }
      cwd = wtDir;
      worktreePath = wtDir;
      managedWorktreePath = wtDir;
      trackWorktree(projectPath, wtDir, ticket || skill);
      updateRun(run, {
        cwd,
        worktreePath,
        status: 'preflight',
        branch: buildRunBranchMetadata({
          cwd,
          projectBaseRef,
          projectBaseBranch: baseRef.branch,
          projectBaseSource: baseRef.source,
          projectBaseWarning: baseRef.warning,
          requestedWorktreeBranch,
          resolvedWorktreeRef,
          checkoutRef,
          managedWorktree: true,
        }),
      });
    } catch (e: unknown) {
      const failureDetail = unknownErrorMessage(e, 'Git worktree setup failed.');
      const failureReason = failureDetail === 'Git worktree setup failed.'
        ? failureDetail
        : `Git worktree setup failed: ${failureDetail}`;
      vscode.window.showWarningMessage('Git worktree setup failed; run marked failed before launch.');
      const event = { type: 'error' as const, label: 'Git worktree setup failed', detail: failureDetail, timestamp: new Date() };
      events.push(event);
      addRunEvent(run, event);
      updateRun(run, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        exitCode: 1,
        failureReason,
        failureKind: 'git',
      });
      panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
      saveSession(projectName, skill, ticket || '', events);
      await runCompletionCallback(opts, 1, run, { projectName, skill, ticket: ticket || '', events, panel });
      return launchResult(run, false);
    }
  }

  const launchEvent = { type: 'text' as const, label: 'Launching Claude session...', detail: '', timestamp: new Date() };
  events.push(launchEvent);
  addRunEvent(run, launchEvent);
  panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));

  const addDirs = ['~/.claude'];
  if (opts.extraDirs) { addDirs.push(...opts.extraDirs); }
  const configuredExtraDirs = configuredProjectExtraDirs(projectPath);
  for (const d of configuredExtraDirs.dirs) {
    if (!addDirs.includes(d)) { addDirs.push(d); }
  }
  if (configuredExtraDirs.warning) {
    const event = { type: 'error' as const, label: 'Could not read project extra_dirs', detail: configuredExtraDirs.warning, timestamp: new Date() };
    events.push(event);
    addRunEvent(run, event);
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
  }
  const claudeArgs = buildClaudeArgs(prompt, model, opts.appendSystemPrompt, addDirs);
  const permissions = buildRunPermissionMetadata(addDirs);
  const branch = buildRunBranchMetadata({
    cwd,
    projectBaseRef,
    projectBaseBranch: baseRef.branch,
    projectBaseSource: baseRef.source,
    projectBaseWarning: baseRef.warning,
    requestedWorktreeBranch,
    resolvedWorktreeRef,
    checkoutRef,
    managedWorktree: Boolean(managedWorktreePath),
  });
  const launchPatch: Partial<KronosRun> = { cwd, permissions, branch };
  if (worktreePath) { launchPatch.worktreePath = worktreePath; }
  updateRun(run, launchPatch);

  let proc: ClaudeProcess;
  try {
    proc = spawn(CLAUDE_PATH, claudeArgs, {
      cwd,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
    }) as ClaudeProcess;
  } catch (e: unknown) {
    const failureDetail = unknownErrorMessage(e, 'Failed to launch Claude CLI.');
    const failureReason = failureDetail.startsWith('Failed to launch Claude CLI')
      ? failureDetail
      : `Failed to launch Claude CLI: ${failureDetail}`;
    const event = { type: 'error' as const, label: 'Failed to launch Claude CLI', detail: failureDetail, timestamp: new Date() };
    events.push(event);
    addRunEvent(run, event);
    updateRun(run, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      exitCode: 1,
      failureReason,
      failureKind: classifyRunFailure({ ...run, status: 'failed', failureReason, events: run.events }),
    });
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
    saveSession(projectName, skill, ticket || '', events);
    await runCompletionCallback(opts, 1, run, { projectName, skill, ticket: ticket || '', events, panel });
    return launchResult(run, false);
  }
  const runningPatch: Partial<KronosRun> = { status: 'running', cwd };
  if (proc.pid !== undefined) { runningPatch.processPid = proc.pid; }
  updateRun(run, runningPatch);

  let buffer = '';
  let processClosed = false;
  let spawnErrorHandled = false;

  proc.on('error', async (error: Error) => {
    spawnErrorHandled = true;
    processClosed = true;
    const message = `Failed to launch Claude CLI: ${error.message}`;
    const event = { type: 'error' as const, label: message, detail: '', timestamp: new Date() };
    events.push(event);
    addRunEvent(run, event);
    updateRun(run, {
      status: 'failed',
      endedAt: new Date().toISOString(),
      exitCode: 1,
      failureReason: message,
      failureKind: classifyRunFailure({ ...run, status: 'failed', failureReason: message }),
    });
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
    saveSession(projectName, skill, ticket || '', events);
    await runCompletionCallback(opts, 1, run, { projectName, skill, ticket: ticket || '', events, panel });
  });

  proc.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString();
    appendRunLog(run, chunk);
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('{')) { continue; }
      try {
        const pe = parseStreamEvent(JSON.parse(trimmed));
        if (pe) {
          events.push(pe);
          addRunEvent(run, pe);
          panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
        }
      } catch (e: unknown) {
        const detail = unknownErrorMessage(e, 'Failed to parse Claude stream event.');
        const event = {
          type: 'error' as const,
          label: 'Failed to parse Claude stream event',
          detail,
          timestamp: new Date(),
        };
        events.push(event);
        addRunEvent(run, event);
        panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
      }
    }
  });

  proc.stderr.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    appendRunLog(run, data.toString());
    if (text && !text.includes('npm') && !text.includes('WARN')) {
      const event = { type: 'error' as const, label: text.substring(0, 200), detail: '', timestamp: new Date() };
      events.push(event);
      addRunEvent(run, event);
      panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
    }
  });

  proc.on('close', async (code) => {
    if (spawnErrorHandled) { return; }
    processClosed = true;
    const persisted = readRunRecord(run.id) as KronosRun | null;
    const wasCancelled = persisted?.status === 'cancelled';
    if (wasCancelled && persisted) {
      run.status = 'cancelled';
      if (persisted.failureReason !== undefined) { run.failureReason = persisted.failureReason; }
      else { delete run.failureReason; }
      if (persisted.endedAt !== undefined) { run.endedAt = persisted.endedAt; }
      else { delete run.endedAt; }
      run.events = Array.isArray(persisted.events) ? persisted.events : run.events;
      if (persisted.recoveryActions !== undefined) { run.recoveryActions = persisted.recoveryActions; }
      else { delete run.recoveryActions; }
      if (persisted.processPid !== undefined) { run.processPid = persisted.processPid; }
      else { delete run.processPid; }
    }
    const finalEvent = {
      type: wasCancelled ? 'error' : code === 0 ? 'done' : 'error',
      label: wasCancelled ? 'Session cancelled' : code === 0 ? 'Session complete' : `Session exited with code ${code}`,
      detail: '',
      timestamp: new Date(),
    } as ProgressEvent;
    events.push(finalEvent);
    addRunEvent(run, finalEvent);
    const finalStatus = wasCancelled ? 'cancelled' : code === 0 ? 'completed' : 'failed';
    const finalFailureReason = wasCancelled ? persisted?.failureReason : code === 0 ? undefined : `Process exited with code ${code}`;
    const finalPatch: Partial<KronosRun> = {
      status: finalStatus,
      endedAt: persisted?.endedAt || new Date().toISOString(),
      exitCode: code,
      failureKind: classifyRunFailure({ ...run, status: finalStatus, failureReason: finalFailureReason }),
    };
    if (finalFailureReason !== undefined) { finalPatch.failureReason = finalFailureReason; }
    updateRun(run, finalPatch);
    panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
    saveSession(projectName, skill, ticket || '', events);

    if (managedWorktreePath) {
      const warning = removeWorktreeSafely(projectPath, managedWorktreePath, { onRemoved: () => untrackWorktree(managedWorktreePath!) });
      if (warning) {
        vscode.window.showWarningMessage(
          `Worktree for ${ticket || skill} has unsaved work. Clean up manually or run "Kronos: Cleanup Worktrees".`,
        );
        const event = { type: 'error' as const, label: `Worktree not removed: ${warning}`, detail: '', timestamp: new Date() };
        events.push(event);
        addRunEvent(run, event);
        const cleanupStatus = wasCancelled ? 'cancelled' : code === 0 ? 'needs_human' : 'failed';
        const cleanupFailureReason = wasCancelled ? `${run.failureReason || 'Run cancelled'}; worktree cleanup blocked: ${warning}` : warning;
        updateRun(run, {
          status: cleanupStatus,
          failureReason: cleanupFailureReason,
          failureKind: classifyRunFailure({ ...run, status: cleanupStatus, failureReason: cleanupFailureReason }),
        });
        panel.webview.html = withWebviewCsp(buildProgressHtml(projectName, skill, ticket || '', events, run));
      }
    }

    await runCompletionCallback(opts, code ?? 1, run, { projectName, skill, ticket: ticket || '', events, panel });
  });

  panel.onDidDispose(() => {
    if (!processClosed && !proc.killed) {
      stopProcessTree(proc.pid);
      const cancelled = markRunCancelled(run.id, 'Progress panel disposed by user');
      Object.assign(run, cancelled);
      if (managedWorktreePath) {
        setTimeout(() => {
          const warning = removeWorktreeSafely(projectPath, managedWorktreePath!, { onRemoved: () => untrackWorktree(managedWorktreePath!) });
          if (warning) {
            vscode.window.showWarningMessage(`Worktree has unsaved work from killed session: ${ticket || skill}`);
          }
        }, 2000);
      }
    }
  });
  return launchResult(run, true);
}

function launchResult(run: KronosRun, launched: boolean): DispatchLaunchResult {
  const result: DispatchLaunchResult = {
    runId: run.id,
    launched,
    status: run.status,
  };
  if (run.failureReason) { result.failureReason = run.failureReason; }
  return result;
}

export async function openInClaude(projectPath: string): Promise<void> {
  const authed = await ensureAuth();
  if (!authed) { return; }
  const terminal = vscode.window.createTerminal(kronosLoginShellTerminalOptions({
    name: `Claude: ${projectPath.split(/[\\/]/).pop() || 'project'}`,
    cwd: projectPath,
  }));
  terminal.sendText('claude');
  terminal.show();
}

interface ProgressEvent {
  type: 'tool' | 'text' | 'result' | 'error' | 'done' | 'thinking';
  label: string;
  detail: string;
  timestamp: Date;
}

type ClaudeProcess = ReturnType<typeof spawn> & {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
};

function toValidDate(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  return null;
}

function progressDateOr(value: unknown, fallback: Date): Date {
  return toValidDate(value) || fallback;
}

function progressEventTimeLabel(value: unknown): string {
  return toValidDate(value)?.toLocaleTimeString() || 'Unknown';
}

function progressDateTimeLabel(value: unknown, fallback = 'Unknown'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') { return fallback; }
  const trimmed = String(value).trim();
  return trimmed || fallback;
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  return isRecord(value) ? value : {};
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  return Array.isArray(value) ? value : [];
}

function streamString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

export function parseStreamEvent(event: unknown): ProgressEvent | null {
  const now = new Date();
  const payload = isRecord(event) ? event : {};
  if (payload['type'] === 'assistant') {
    const message = recordField(payload, 'message');
    for (const rawBlock of arrayField(message, 'content')) {
      const block = isRecord(rawBlock) ? rawBlock : {};
      const blockType = streamString(block['type']);
      if (blockType === 'tool_use') {
        const name = streamString(block['name']);
        const input = recordField(block, 'input');
        let label = '';
        let detail = '';
        if (name === 'Read') {
          label = `Reading ${shortenPath(streamString(input['file_path']))}`;
        } else if (name === 'Edit') {
          label = `Editing ${shortenPath(streamString(input['file_path']))}`;
          const oldString = streamString(input['old_string']);
          detail = oldString ? `replacing: ${oldString.substring(0, 60)}...` : '';
        } else if (name === 'Write') {
          label = `Writing ${shortenPath(streamString(input['file_path']))}`;
        } else if (name === 'Bash' || name === 'PowerShell') {
          label = `Running: ${streamString(input['command']).substring(0, 80)}`;
          detail = streamString(input['description']);
        } else if (name === 'Grep') {
          label = `Searching for "${streamString(input['pattern'])}"`;
          const pathValue = streamString(input['path']);
          detail = pathValue ? `in ${shortenPath(pathValue)}` : '';
        } else if (name === 'Glob') {
          label = `Finding files: ${streamString(input['pattern'])}`;
        } else if (name === 'Skill') {
          label = `Invoking /${streamString(input['skill'])}`;
        } else {
          label = `${name}`;
          detail = JSON.stringify(input).substring(0, 80);
        }
        return { type: 'tool', label, detail, timestamp: now };
      }
      if (blockType === 'thinking') {
        const text = streamString(block['thinking']).substring(0, 120);
        if (text.length > 10) {
          return { type: 'thinking', label: text, detail: '', timestamp: now };
        }
      }
      if (blockType === 'text') {
        const text = streamString(block['text']).trim();
        if (text.length > 5) {
          return { type: 'text', label: text.substring(0, 150), detail: '', timestamp: now };
        }
      }
    }
  }
  if (payload['type'] === 'result') {
    const result = streamString(payload['result']);
    const rawDurationMs = typeof payload['duration_ms'] === 'number' ? payload['duration_ms'] : Number.NaN;
    const duration = Number.isFinite(rawDurationMs) ? `${(rawDurationMs / 1000).toFixed(1)}s` : '';
    return { type: 'done', label: `Complete — ${duration}`, detail: result, timestamp: now };
  }
  return null;
}

function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 3) { return parts.join('/'); }
  return `.../${parts.slice(-3).join('/')}`;
}

function buildProgressHtml(project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun): string {
  const progress = runProgressSummary({ events });
  const attentionDetail = run && isAttentionRunStatus(run.status) ? runAttentionDetail(run) : '';
  const filesEdited = new Set<string>();
  const filesRead = new Set<string>();
  let lastThinking = '';
  for (const e of events) {
    if (e.label.startsWith('Editing ') || e.label.startsWith('Writing ')) {
      filesEdited.add(e.label.replace(/^(Editing |Writing )/, ''));
    }
    if (e.label.startsWith('Reading ')) {
      filesRead.add(e.label.replace(/^Reading /, ''));
    }
    if (e.type === 'thinking') { lastThinking = e.label; }
  }

  const isDone = events.some(e => e.type === 'done');
  const hasError = events.some(e => e.type === 'error');
  const statusColor = isDone ? '#4caf50' : hasError ? '#f44336' : '#2196f3';
  const statusText = isDone ? 'Complete' : hasError ? 'Error' : 'Working...';

  const eventRows = events.slice(-20).map(e => {
    const icon = e.type === 'tool' ? '&#128295;' : e.type === 'text' ? '&#128172;' : e.type === 'thinking' ? '&#128161;' : e.type === 'done' ? '&#10003;' : e.type === 'error' ? '&#10007;' : '&#8226;';
    const time = progressEventTimeLabel(e.timestamp);
    return `<div class="event ${e.type}"><span class="time">${time}</span><span class="event-icon">${icon}</span><strong>${escapeHtml(e.label)}</strong>${e.detail ? `<div class="detail">${escapeHtml(e.detail)}</div>` : ''}</div>`;
  }).join('');

  const editedList = Array.from(filesEdited).map(f => `<div class="file edited"><span class="file-icon">&#9998;</span>${escapeHtml(f)}</div>`).join('');
  const readList = Array.from(filesRead).map(f => `<div class="file read"><span class="file-icon">&#128065;</span>${escapeHtml(f)}</div>`).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .progress-shell { max-width: 1180px; }
  .run-header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding: 14px 16px; margin-bottom: 16px; }
  .status-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 12%, transparent); }
  .run-title { margin: 0; font-size: 18px; line-height: 1.25; }
  .run-subtitle { margin-top: 3px; color: var(--k-muted); font-size: 12px; }
  .run-status { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 290px); gap: 16px; align-items: start; }
  .section { margin-bottom: 16px; }
  .section h3 { margin: 0 0 8px 0; color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .activity { overflow: hidden; }
  .event { display: grid; grid-template-columns: 74px 22px minmax(0, 1fr); gap: 6px; padding: 8px 10px; border-top: 1px solid var(--k-border); line-height: 1.35; }
  .event:first-child { border-top: 0; }
  .event.done strong { color: var(--k-ok); }
  .event.error strong { color: var(--k-danger); }
  .event .time { color: var(--k-muted); font-size: 11px; }
  .event-icon { text-align: center; opacity: 0.8; }
  .event .detail { grid-column: 3; color: var(--k-muted); font-size: 12px; white-space: pre-wrap; }
  .file { display: flex; align-items: flex-start; gap: 7px; padding: 5px 0; color: var(--k-muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .file.edited { color: var(--vscode-gitDecoration-modifiedResourceForeground, var(--k-ok)); }
  .file-icon { flex: 0 0 auto; opacity: 0.8; }
  .thinking { border-left: 3px solid var(--k-accent); padding: 10px 12px; margin: 8px 0 16px 0; color: var(--k-muted); font-style: italic; font-size: 12px; }
  .attention-banner { border-left: 4px solid var(--k-danger); padding: 10px 12px; margin: 0 0 16px 0; color: var(--k-text); }
  .attention-banner strong { display: block; margin-bottom: 4px; color: var(--k-danger); }
  .done-summary { padding: 16px; margin-top: 12px; }
  .done-summary h2 { margin: 12px 0 8px 0; font-size: 15px; }
  .done-summary h3 { margin: 12px 0 6px 0; font-size: 13px; opacity: 0.8; }
  .done-summary hr { border: none; border-top: 1px solid var(--k-border); margin: 12px 0; }
  .done-summary code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .stats { display: flex; gap: 8px; flex-wrap: wrap; }
  .stat { padding: 6px 9px; border: 1px solid var(--k-border); border-radius: 6px; color: var(--k-muted); font-size: 11px; }
  .result-table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  .result-table th, .result-table td { border: 1px solid var(--k-border); padding: 5px 8px; text-align: left; }
  .result-table th { background: var(--k-surface-soft); font-weight: 650; }
  @media (max-width: 820px) {
    .columns { grid-template-columns: 1fr; }
    .run-header { grid-template-columns: auto 1fr; }
    .run-status { grid-column: 2; }
  }
</style></head><body><div class="kronos-shell progress-shell">
  <div class="run-header kronos-panel kronos-soft">
    <span class="status-dot" style="background:${statusColor}"></span>
    <div>
      <h1 class="run-title">${escapeHtml(project)} - ${escapeHtml(skill)}${ticket ? ` ${escapeHtml(ticket)}` : ''}</h1>
      <div class="run-subtitle">${events.length} event${events.length === 1 ? '' : 's'} captured</div>
    </div>
    <div class="run-status">${statusText}</div>
  </div>
  ${attentionDetail ? `<div class="attention-banner kronos-panel"><strong>Needs Attention</strong>${escapeHtml(attentionDetail)}</div>` : ''}
  ${lastThinking && !isDone ? `<div class="thinking">${escapeHtml(lastThinking)}</div>` : ''}
  <div class="columns">
    <div>
      <div class="section"><h3>Activity</h3><div class="activity kronos-panel">${eventRows || '<div class="kronos-empty">Waiting for Claude to start...</div>'}</div></div>
      ${isDone && events.find(e => e.type === 'done')?.detail ? `<div class="section"><h3>Result</h3><div class="done-summary kronos-panel kronos-soft">${renderResult(events.find(e => e.type === 'done')!.detail)}</div></div>` : ''}
      ${isDone ? `<div class="section"><h3>Session Stats</h3><div class="stats">
        <span class="stat">Tools: ${progress.toolCalls}</span>
        <span class="stat">Errors: ${progress.toolErrors}</span>
        <span class="stat">Files read: ${progress.filesRead}</span>
        <span class="stat">Files changed: ${progress.filesChanged}</span>
        <span class="stat">Duration: ${progress.elapsedSeconds}s</span>
      </div></div>` : ''}
    </div>
    <div>
      ${filesEdited.size > 0 ? `<div class="section"><h3>Files Changed (${filesEdited.size})</h3>${editedList}</div>` : ''}
      ${filesRead.size > 0 ? `<div class="section"><h3>Files Read (${filesRead.size})</h3>${readList}</div>` : ''}
    </div>
  </div>
</div></body></html>`;
}

function normalizeRunCenterMessage(raw: unknown): RunCenterActionRequest | null {
  if (!raw || typeof raw !== 'object') { return null; }
  const message = raw as { command?: unknown; runId?: unknown };
  if (typeof message.command !== 'string' || !RUN_CENTER_MESSAGE_COMMANDS.has(message.command)) { return null; }
  if (message.command === 'refreshPanel' || message.command === 'archiveFinishedRuns') {
    return { command: message.command, runId: '' };
  }
  if (typeof message.runId !== 'string' || message.runId.trim().length === 0) { return null; }
  return { command: message.command, runId: message.runId };
}

function runCenterActionButton(action: string, label: string, runId?: string, primary = false): string {
  const classes = `run-action${primary ? ' primary' : ''}`;
  const runAttr = runId ? ` data-run-id="${escapeAttr(runId)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${runAttr}>${escapeHtml(label)}</button>`;
}

function runCenterActionButtons(run: KronosRun): string {
  const runId = stringOrDefault(run.id, '');
  if (!runId) {
    return '<span class="muted">No action</span>';
  }
  const status = stringOrDefault(run.status, 'unknown');
  const canSuspend = supportsProcessTreeSuspend();
  const pausable = canSuspend && (status === 'running' || status === 'preflight');
  const stoppable = isFreshActiveRun(run) && status !== 'paused';
  const paused = canSuspend && status === 'paused';
  const hasWorkspace = Boolean(run.worktreePath || run.cwd || run.projectPath);
  const hasPrompt = Boolean(run.promptPath);
  const hasLog = Boolean(run.logPath);
  const canResume = hasPrompt || hasLog;
  const canRetry = hasPrompt && !isFreshActiveRun(run);
  const buttons = [
    runCenterActionButton('openRunRecord', 'Record', runId),
  ];
  if (hasLog) { buttons.push(runCenterActionButton('openRunLog', 'Log', runId)); }
  if (hasPrompt) { buttons.push(runCenterActionButton('openRunPrompt', 'Prompt', runId)); }
  if (hasWorkspace) {
    buttons.push(runCenterActionButton('openRunWorkspace', 'Workspace', runId));
    buttons.push(runCenterActionButton('openRunDiff', 'Diff', runId));
  }
  if (stoppable) {
    if (pausable) { buttons.push(runCenterActionButton('pauseRun', 'Pause', runId)); }
    buttons.push(runCenterActionButton('cancelRun', 'Stop', runId, true));
  } else if (paused) {
    buttons.push(runCenterActionButton('continueRun', 'Continue', runId, true));
    buttons.push(runCenterActionButton('cancelRun', 'Stop', runId));
  } else if (canResume) {
    buttons.push(runCenterActionButton('resumeRun', 'Resume', runId, status === 'failed' || status === 'needs_human'));
  }
  if (canRetry) { buttons.push(runCenterActionButton('retryRun', 'Retry', runId)); }
  if (status !== 'needs_human') { buttons.push(runCenterActionButton('markNeedsHuman', 'Needs Human', runId)); }
  buttons.push(runCenterActionButton('archiveRun', 'Archive', runId));
  return `<div class="run-actions">${buttons.join('')}</div>`;
}

function runCenterScript(nonce: string, scriptUri?: string): string {
  return webviewActionScriptTag(nonce, 'Kronos Run Center', [
    { messageKey: 'runId', dataAttribute: 'data-run-id' },
  ], { readyCommand: WEBVIEW_READY_COMMAND, scriptUri });
}

function buildRunCenterHtml(runs: KronosRun[], nonce?: string, actionScriptUri?: string, focusRunId?: string): string {
  const interactive = Boolean(nonce);
  const actionHeader = interactive ? '<th>Actions</th>' : '';
  const focusedRunId = focusRunId?.trim() || '';
  const sortedRuns = sortedRunCenterRuns(runs);
  const displayRuns = focusedRunId
    ? [...sortedRuns].sort((a, b) => focusedRunSort(a, b, focusedRunId))
    : sortedRuns;
  const rows = displayRuns.map(run => {
    const runId = stringOrDefault(run.id, '');
    const focused = Boolean(focusedRunId && runId === focusedRunId);
    const status = stringOrDefault(run.status, 'unknown');
    const statusClass = escapeClass(status);
    const rowClass = `${statusClass}${focused ? ' focused-run' : ''}`;
    const ended = run.endedAt ? progressDateTimeLabel(run.endedAt) : '';
    const started = progressDateTimeLabel(run.startedAt);
    const runEvents = Array.isArray(run.events) ? run.events : [];
    const lastEvent = runEvents[runEvents.length - 1];
    const promptMeta = isRecord(run.promptMetadata) ? run.promptMetadata : undefined;
    const promptName = stringOrDefault(promptMeta?.['name'], '');
    const promptLabel = promptName
      ? `${promptName} (${stringOrDefault(promptMeta?.['source'], 'unknown')})`
      : stringOrDefault(promptMeta?.['source'], 'prompt');
    const promptHash = stringOrDefault(promptMeta?.['templateHash'] || run.promptHash, '');
    const rawMissingVariables = promptMeta?.['missingVariables'];
    const missingVariables = Array.isArray(rawMissingVariables) ? rawMissingVariables.map(String) : [];
    const missing = missingVariables.length ? `<br><span class="failure">missing vars: ${escapeHtml(missingVariables.join(', '))}</span>` : '';
    const readiness = isRecord(run.readiness) ? run.readiness : undefined;
    const readinessStatus = stringOrDefault(readiness?.status, 'unknown');
    const readinessSummary = stringOrDefault(readiness?.summary, 'Not evaluated yet.');
    const permissions = isRecord(run.permissions) ? run.permissions : undefined;
    const permissionMode = stringOrDefault(permissions?.permissionMode, '');
    const toolCount = Array.isArray(permissions?.allowedTools) ? permissions.allowedTools.length : 0;
    const permissionSummary = permissionMode ? `${permissionMode}${toolCount ? `, ${toolCount} tools` : ''}` : '';
    const branch = isRecord(run.branch) ? run.branch : undefined;
    const currentRef = stringOrDefault(branch?.['currentRef'], '');
    const currentCommit = stringOrDefault(branch?.['currentCommit'], '');
    const branchSummary = currentRef
      ? `ref ${currentRef}${currentCommit ? ` @ ${currentCommit.substring(0, 12)}` : ''}`
      : '';
    const progress = runProgressSummary(run);
    const needsAttention = status === 'failed' || status === 'needs_human' || status === 'cancelled';
    const eventLabel = lastEvent ? stringOrDefault(lastEvent.label, '') : '';
    const attentionDetail = needsAttention ? runAttentionDetail(run) : '';
    const eventCell = attentionDetail && attentionDetail !== eventLabel
      ? `${eventLabel ? `${escapeHtml(eventLabel)}<br>` : ''}<span class="failure">${escapeHtml(attentionDetail)}</span>`
      : escapeHtml(eventLabel || attentionDetail);
    const actionCell = interactive ? `<td class="action-cell">${runCenterActionButtons(run)}</td>` : '';
    return `<tr class="${rowClass}"${runId ? ` data-run-id="${escapeAttr(runId)}"` : ''}${focused ? ' data-focused-run="true"' : ''}>
      <td><span class="kronos-pill status ${statusClass}">${escapeHtml(status)}</span></td>
      <td><strong>${escapeHtml(stringOrDefault(run.project, 'unknown project'))}</strong><br><span>${escapeHtml(stringOrDefault(run.skill, 'unknown skill'))} ${escapeHtml(stringOrDefault(run.ticket, ''))}</span></td>
      <td>${escapeHtml(started)}${ended ? `<br><span>${escapeHtml(ended)}</span>` : ''}</td>
      <td class="progress-cell"><strong>${escapeHtml(progress.label)}</strong>${progress.detail ? `<br><span>${escapeHtml(progress.detail)}</span>` : ''}</td>
      <td><code>${escapeHtml(run.model)}</code><br><span>${escapeHtml(promptLabel)} ${escapeHtml(promptHash.substring(0, 12))}${run.promptPath ? ' saved' : ''}</span>${missing}${permissionSummary ? `<br><span>${escapeHtml(permissionSummary)}</span>` : ''}</td>
      <td><span class="kronos-pill readiness ${escapeClass(readinessStatus)}">${escapeHtml(readinessStatus)}</span><br><span>${escapeHtml(readinessSummary)}</span></td>
      <td class="workspace-cell">${escapeHtml(stringOrDefault(run.worktreePath || run.cwd, 'unknown workspace'))}${branchSummary ? `<br><span>${escapeHtml(branchSummary)}</span>` : ''}</td>
      <td>${eventCell}</td>
      ${actionCell}
    </tr>`;
  }).join('');
  const actionStyles = interactive ? `
  .action-cell { min-width: 210px; }
  .run-actions { display: flex; flex-wrap: wrap; gap: 5px; align-items: flex-start; }
  .run-center-toolbar { display: flex; gap: 8px; align-items: center; }
  .run-action { min-height: 24px; padding: 3px 8px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface); color: var(--k-fg); font: inherit; font-size: 10px; font-weight: 600; cursor: pointer; }
  .run-action:hover { background: var(--vscode-list-hoverBackground); }
  .run-action.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }` : '';
  const refreshAction = interactive
    ? `<div class="run-center-toolbar">${runCenterActionButton('refreshPanel', 'Refresh')}${runCenterActionButton('archiveFinishedRuns', 'Archive Finished')}</div>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .run-table-wrap { overflow: auto; }
  .kronos-table { min-width: ${interactive ? '1160' : '940'}px; }
  td span:not(.kronos-pill), .muted { color: var(--k-muted); }
  .progress-cell strong { display: block; font-size: 11px; }
  .readiness.ready { background: rgba(76,175,80,0.18); color: #4caf50; }
  .readiness.needs_human, .readiness.not_ready, .readiness.unknown { background: rgba(255,152,0,0.18); color: #ff9800; }
  .readiness.blocked { background: rgba(244,67,54,0.18); color: #f44336; }
  .completed { background: rgba(76,175,80,0.18); color: #4caf50; }
  .running, .preflight { background: rgba(33,150,243,0.18); color: #2196f3; }
  .paused { background: rgba(255,152,0,0.18); color: #ff9800; }
  .failed, .cancelled, .needs_human { background: rgba(244,67,54,0.18); color: #f44336; }
  tr.focused-run { outline: 2px solid var(--k-accent); outline-offset: -2px; background: color-mix(in srgb, var(--k-accent) 12%, transparent); }
  .failure { color: #f44336; opacity: 1; }
  .workspace-cell { overflow-wrap: anywhere; }
  ${actionStyles}
</style></head><body><div class="kronos-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Run Center</h1>
      <div class="kronos-subtitle">${runs.length} persisted run${runs.length === 1 ? '' : 's'} sorted by status and time${focusedRunId ? ` - focused on ${escapeHtml(focusedRunId)}` : ''}</div>
    </div>
    ${refreshAction}
  </div>
  ${runs.length === 0 ? '<div class="kronos-empty">No persisted runs yet.</div>' : `<div class="run-table-wrap kronos-panel"><table class="kronos-table">
    <tr><th>Status</th><th>Run</th><th>Time</th><th>Progress</th><th>Model</th><th>Readiness</th><th>Workspace</th><th>Last event</th>${actionHeader}</tr>
    ${rows}
  </table></div>`}
</div>${nonce ? runCenterScript(nonce, actionScriptUri) : ''}</body></html>`;
}

function focusedRunSort(a: KronosRun, b: KronosRun, focusRunId: string): number {
  const aFocused = stringOrDefault(a.id, '') === focusRunId;
  const bFocused = stringOrDefault(b.id, '') === focusRunId;
  return Number(bFocused) - Number(aFocused);
}

function renderResult(text: string): string {
  const lines = text.split('\n');
  let html = '';
  let inTable = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (trimmed.replace(/[|\-\s]/g, '').length === 0) { continue; }
      const cells = trimmed.split('|').filter(Boolean).map(c => `<td>${escapeHtml(c.trim())}</td>`).join('');
      if (!inTable) {
        html += '<table class="result-table"><tr>' + cells.replace(/td>/g, 'th>') + '</tr>';
        inTable = true;
      } else {
        html += '<tr>' + cells + '</tr>';
      }
      continue;
    }
    if (inTable) { html += '</table>'; inTable = false; }
    if (trimmed.startsWith('## ')) { html += `<h3>${escapeHtml(trimmed.substring(3))}</h3>`; }
    else if (trimmed.startsWith('# ')) { html += `<h2>${escapeHtml(trimmed.substring(2))}</h2>`; }
    else if (trimmed === '---') { html += '<hr>'; }
    else if (trimmed === '') { html += '<br>'; }
    else {
      let rendered = escapeHtml(trimmed);
      rendered = rendered.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      rendered = rendered.replace(/`(.+?)`/g, '<code>$1</code>');
      html += `<div>${rendered}</div>`;
    }
  }
  if (inTable) { html += '</table>'; }
  return html;
}
