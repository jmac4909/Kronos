import * as vscode from 'vscode';
import { KronosState } from './state/KronosState';
import { ProjectTreeProvider } from './views/ProjectTreeProvider';
import { QueueTreeProvider } from './views/QueueTreeProvider';
import { SessionTreeProvider } from './views/SessionTreeProvider';
import { TaskTreeProvider } from './views/TaskTreeProvider';
import { ReviewTreeProvider } from './views/ReviewTreeProvider';
import { TicketTreeProvider } from './views/TicketTreeProvider';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { DiscoveredProject, MergeRequestChangedFile, QueueItem, Ticket } from './state/types';
import { dispatchClaudeSession, openInClaude, ensureAuth, cleanupStaleWorktrees, listSavedSessions, listSessionStoreIssues, openSavedSession, getAggregateStats, openRunCenter, listRuns, type DispatchOptions, type KronosRun, type PromptRunMetadata, type RunCenterActionRequest } from './runners/sessionDispatcher';
import { PromptHistoryDiff, PromptHistorySnapshot, PromptSmokeResult, PromptSmokeTest, PromptTemplateInfo, buildDefaultPromptSmokeTests, createPromptHistorySnapshot, diffPromptHistorySnapshots, latestPromptHistorySnapshot, listPromptHistorySnapshots, listPromptTemplates, repairRequiredPromptTemplates, runPromptSmokeTests } from './services/promptManager';
import { KRONOS_DIR, STATE_AUDIT_FILE, StateAuditEvent, listBackups, listStateAuditEvents, restoreBackup } from './services/stateStore';
import { BacklogTriageReport, PlannedAction, ProjectBatchPlan, ReleaseBatchPlan, actionToLabel, buildBacklogTriageReport, estimatePlanMinutes, overnightCandidatePlans, planByProject, planByRelease, planForMinutes, planNextActions as buildNextActionPlan, planToQueueItem as buildQueueItemFromPlan } from './services/queuePlanner';
import { writeEvidenceExport } from './services/evidenceStore';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './services/evidenceData';
import { EvidenceHandoffPlan, buildEvidenceHandoffPlan } from './services/evidenceHandoff';
import { EvidencePublishDestination, EvidencePublishResult, buildEvidencePublishPlan, publishEvidencePlan, readyPublishDestinations } from './services/evidencePublisher';
import { RUNS_DIR, archiveRun, listRunStoreIssues, markRunCancelled, markRunContinued, markRunNeedsHuman, markRunPaused, runRecordPath, writeRunRecord } from './services/runStore';
import { RecoveryInventory, RecoveryItem, buildRecoveryInventory } from './services/recoveryCenter';
import { TimelineEvent, buildTicketTimeline } from './services/ticketTimeline';
import { DispatchCollision, detectDispatchCollisions } from './services/collisionDetector';
import { requiredScripts } from './services/scriptClient';
import { gitlabAdapter, jiraAdapter, sonarAdapter, type MergeRequestDiffResult } from './services/integrationAdapters';
import { buildRunCompletionEvidenceText, evaluatePostRunReadiness, shouldRecordRunCompletionEvidence } from './services/postRunReadiness';
import { extractAcceptanceCriteria } from './services/acceptanceCriteria';
import type { ExistingAcceptanceCriterion } from './services/acceptanceCriteria';
import { HumanReviewInbox, buildHumanReviewInbox } from './services/humanReviewInbox';
import { EvidenceGateResult, evaluateEvidenceGate, evaluateEvidenceGates } from './services/evidenceGate';
import { decideEvidenceHandoff } from './services/evidenceGatePolicy';
import { AgentQualityScore, computeAgentQualityScore } from './services/agentQualityScore';
import { DashboardWorklistLane, buildDashboardWorklist } from './services/dashboardWorklist';
import { INTEGRATION_MANIFEST_FILE, IntegrationManifestAudit, IntegrationManifestStatus, auditIntegrationManifest, readIntegrationManifest, writeIntegrationManifestSnapshot } from './services/integrationManifest';
import { KronosProfile, listProfiles, resolveDefaultBaseBranch, resolveProfile, sanitizeBranch as sanitizeProfileBranch } from './services/profileManager';
import { AgingThresholds, analyzeAging } from './services/agingAnalyzer';
import { SafetyPlan, assessSafetyGate } from './services/safetyGate';
import { TrendMetricsReport, computeTrendMetrics } from './services/trendMetrics';
import { TicketFilter, TicketGroupBy, TICKET_FILTER_PRESETS, describeTicketFilter } from './services/ticketFilters';
import { buildRunResumePrompt, readRunLogTail } from './services/runRecovery';
import { addTicketEvidenceCheck, addTicketEvidenceNote, linkMergeRequestToTicket, previewLinkMergeRequestToTicket, recordTicketEnvironmentResult, replaceTicketAcceptanceCriteria, updateTicketAcceptanceCriteria, updateTicketMergeRequestStatus } from './services/ticketMutations';
import { addPlanToQueue as addPlanToQueueState, addTicketToQueue, linkTicketToProject, recordPlanQueueDecision, removeTicketFromQueue as removeTicketFromQueueState, reorderQueueItem, selectNextQueueItem, unlinkTicketFromProject } from './services/queueMutations';
import { removeProject as removeProjectFromState, setProjectConfigValue, setProjectIntegrationConfig, setScanDirs, writeProjectSetupConfig } from './services/projectMutations';
import { DoctorCheck, runDoctorChecks as collectDoctorChecks, runDoctorReachabilityChecks as collectDoctorReachabilityChecks } from './services/doctorChecks';
import { checkClaudeModelAccess } from './services/cliProbes';
import { buildCombinedVerificationPlan, buildCombinedVerificationPromptVars } from './services/combinedVerification';
import { primaryChangedFilePath } from './services/changedFiles';
import { buildSonarReport, type SonarIssue } from './services/sonarReportView';
import { buildAgingReportHtml } from './services/agingReportView';
import { computeAttentionBadge } from './services/attentionBadge';
import { buildNextActionContext, buildNextActionStartDecision, skillForAction } from './services/nextActionContext';
import { createWorkspaceDiffArtifact, firstRemoteBranchMatching, originProjectPath } from './services/gitWorkspace';
import { signalProcessTree, stopProcessTree } from './services/processTree';
import { createWebviewNonce, webviewScriptCspOptions, webviewVsCodeApiScript, withWebviewCsp } from './services/webviewSecurity';
import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss, safeHttpHref } from './services/webviewHtml';
import { kronosTerminalOptions } from './services/terminalProfiles';
import { unknownErrorMessage } from './services/errorUtils';
import { activeRunSummary, isActiveRun } from './services/runStatus';

let statusBarItem: vscode.StatusBarItem;
interface BadgeTarget {
  badge?: vscode.ViewBadge | undefined;
}
const REQUIRED_PROMPTS = [
  'implement-system',
  'verify-local',
  'sonar-scan',
  'sonar-fix',
  'sonar-fix-branch',
  'fix-finding',
  'verify-develop',
  'verify-test',
  'resolve-conflicts',
  'verify-combined',
  'continue-work',
];
const CODE_COLLISION_ACTIONS = new Set(['implement', 'in_progress', 'fix_build']);
const LIVE_MR_DIFF_LIMIT = 4;
const LIVE_MR_DIFF_TIMEOUT_MS = 8000;

function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  const replacements: Record<string, string> = {
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return json.replace(/[<>&\u2028\u2029]/g, c => replacements[c]);
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function formatWebviewDateTime(value: unknown, fallback = 'N/A'): string {
  if (typeof value !== 'string' && typeof value !== 'number') { return fallback; }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function formatWebviewDate(value: unknown, fallback = 'N/A'): string {
  if (typeof value !== 'string' && typeof value !== 'number') { return fallback; }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleDateString();
}

function openExternalHttpUrl(url: string): void {
  try {
    const parsed = vscode.Uri.parse(url);
    if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
      vscode.window.showWarningMessage(`Refusing to open non-HTTP URL: ${parsed.scheme}`);
      return;
    }
    vscode.env.openExternal(parsed);
  } catch {
    vscode.window.showWarningMessage('Refusing to open invalid URL.');
  }
}

function runNotificationCommandAction(
  selection: Thenable<string | undefined>,
  actionLabel: string,
  command: string,
  failureFallback: string
): void {
  void selection.then(action => {
    if (action !== actionLabel) { return; }
    void vscode.commands.executeCommand(command).then(undefined, (e: unknown) => {
      void vscode.window.showWarningMessage(unknownErrorMessage(e, failureFallback));
    });
  }, (e: unknown) => {
    void vscode.window.showWarningMessage(unknownErrorMessage(e, failureFallback));
  });
}

async function runCommandProgress(
  options: vscode.ProgressOptions,
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ) => Thenable<unknown>,
  failureFallback: string
): Promise<void> {
  try {
    await vscode.window.withProgress(options, task);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, failureFallback));
  }
}

async function startClaudeDispatch(
  projectPath: string,
  skill: string,
  ticket?: string,
  onCompleteOrOpts?: ((code: number) => void) | DispatchOptions,
  customPrompt?: string
): Promise<void> {
  try {
    await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, `Failed to start ${skill} session.`));
  }
}

const BOARD_MESSAGE_COMMANDS = new Set([
  'link',
  'unlink',
  'addToQueue',
  'removeFromQueue',
  'start',
  'openJira',
  'openMr',
  'getComments',
  'addToQueueFromModal',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
]);
const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'extractAcceptanceCriteria',
  'updateAcceptanceCriteria',
  'viewTicket',
  'evidenceHandoff',
  'publishEvidence',
]);
const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'extractAcceptanceCriteria',
  'updateAcceptanceCriteria',
  'startTicket',
  'addToQueue',
  'viewTicket',
  'evidenceGate',
  'runCenter',
  'recoveryCenter',
  'doctor',
  'queuePlanner',
]);
const DASHBOARD_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'nextBestAction',
  'queuePlanner',
  'runCenter',
  'humanReviewInbox',
  'evidenceGate',
  'recoveryCenter',
]);
const PLAN_MESSAGE_COMMANDS = new Set([
  'startPlan',
  'queuePlan',
  'pinPlan',
  'snoozePlan',
  'snoozePlanToday',
  'rejectPlan',
  'viewTicket',
  'addEvidence',
]);
const BACKLOG_TRIAGE_MESSAGE_COMMANDS = new Set([
  'linkTicket',
  'startTicket',
  'addToQueue',
  'addEvidence',
  'addEvidenceCheck',
  'viewTicket',
]);
const TICKET_DETAIL_MESSAGE_COMMANDS = new Set([
  'startTicket',
  'addToQueue',
  'removeFromQueue',
  'linkTicket',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'evidenceGate',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
  'openJira',
  'openMr',
  'openBuild',
]);
const RECOVERY_MESSAGE_COMMANDS = new Set([
  'executeRecoveryItem',
]);
const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set([
  'addEvidence',
  'addEvidenceCheck',
  'setup',
  'settings',
  'doctor',
  'integrationManifest',
  'snapshotIntegrationManifest',
  'profiles',
  'queuePlanner',
  'humanReviewInbox',
  'promptManager',
  'promptSmokeTests',
  'snapshotPromptPack',
  'promptHistory',
  'repairPromptPack',
  'runCenter',
  'stats',
  'sessionHistory',
  'viewTicket',
  'recordEnvironmentResult',
  'evidenceGate',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
  'agentQualityScore',
  'trendMetrics',
  'agingReport',
  'recoveryCenter',
  'stateAuditLog',
]);
const AGING_REPORT_MESSAGE_COMMANDS = new Set([
  ...OPERATOR_COMMAND_MESSAGE_COMMANDS,
  'refreshPanel',
]);
const TICKET_SCOPED_OPERATOR_COMMANDS = new Set([
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'viewTicket',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
]);

function normalizeWebviewCommand(raw: unknown, allowed: Set<string>): string | null {
  const command = recordFromUnknown(raw).command;
  if (typeof command !== 'string' || !allowed.has(command)) { return null; }
  return command;
}

function normalizeBoardMessage(raw: unknown): { command: string; ticket: string; project: string } | null {
  const command = normalizeWebviewCommand(raw, BOARD_MESSAGE_COMMANDS);
  if (!command) { return null; }
  const message = recordFromUnknown(raw);
  return {
    command,
    ticket: typeof message.ticket === 'string' ? message.ticket : '',
    project: typeof message.project === 'string' ? message.project : '',
  };
}

function normalizeActionPanelMessage(raw: unknown, allowed: Set<string>): { command: string; ticket: string; runId: string; planId: string; itemId: string } | null {
  const command = normalizeWebviewCommand(raw, allowed);
  if (!command) { return null; }
  const message = recordFromUnknown(raw);
  return {
    command,
    ticket: typeof message.ticket === 'string' ? message.ticket : '',
    runId: typeof message.runId === 'string' ? message.runId : '',
    planId: typeof message.planId === 'string' ? message.planId : '',
    itemId: typeof message.itemId === 'string' ? message.itemId : '',
  };
}

function normalizeSonarIssueCommandList(value: unknown): SonarIssue[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .map(normalizeSonarIssueCommandValue)
    .filter((issue): issue is SonarIssue => Boolean(issue));
}

function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null {
  const record = recordFromUnknown(value);
  const issue: SonarIssue = {
    severity: typeof record.severity === 'string' ? record.severity : undefined,
    rule: typeof record.rule === 'string' ? record.rule : undefined,
    component: typeof record.component === 'string' ? record.component : undefined,
    line: record.line,
    message: typeof record.message === 'string' ? record.message : undefined,
  };
  return issue.severity || issue.rule || issue.component || issue.message || issue.line !== undefined ? issue : null;
}

function formatSonarIssuePromptLine(issue: SonarIssue): string {
  const file = String(issue.component || '').replace(/^[^:]+:/, '') || '?';
  const rule = String(issue.rule || '').replace(/^[^:]+:/, '') || '-';
  const line = issue.line === undefined || issue.line === null || issue.line === '' ? '?' : String(issue.line);
  return `- [${issue.severity || '-'}] ${rule}: ${file}:${line} — ${issue.message || ''}`;
}

function agingThresholdsFromConfig(): Partial<AgingThresholds> {
  const config = vscode.workspace.getConfiguration('kronos');
  const entries: Array<[keyof AgingThresholds, string]> = [
    ['reviewDays', 'staleReviewDays'],
    ['buildFailureDays', 'staleBuildFailureDays'],
    ['blockedDays', 'staleBlockedDays'],
    ['verificationDays', 'staleVerificationDays'],
    ['ticketDays', 'staleTicketDays'],
  ];
  const thresholds: Partial<AgingThresholds> = {};
  for (const [key, setting] of entries) {
    const value = config.get<number>(setting);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      thresholds[key] = value;
    }
  }
  return thresholds;
}

function trendWindowDaysFromConfig(): number {
  const value = vscode.workspace.getConfiguration('kronos').get<number>('trendWindowDays', 14);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 14;
}

async function confirmSafetyGate(plan: SafetyPlan): Promise<boolean> {
  const assessment = assessSafetyGate(plan);
  if (!assessment.requiresConfirmation) { return true; }
  const action = await vscode.window.showWarningMessage(
    assessment.message,
    { modal: assessment.modal },
    assessment.confirmationLabel,
    'Cancel'
  );
  return action === assessment.confirmationLabel;
}

async function openTextFileIfExists(filePath: string, missingMessage: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(missingMessage);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function retryRunFromPrompt(run: KronosRun): Promise<void> {
  if (!run?.promptPath || !fs.existsSync(run.promptPath)) {
    vscode.window.showWarningMessage('Run prompt artifact not found.');
    return;
  }
  if (!run.projectPath || !fs.existsSync(run.projectPath)) {
    vscode.window.showWarningMessage('Original project path no longer exists.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Retry ${run.project} ${run.skill}${run.ticket ? ` ${run.ticket}` : ''} in the original project workspace?`,
    'Retry',
    'Cancel'
  );
  if (confirm !== 'Retry') { return; }

  const prompt = fs.readFileSync(run.promptPath, 'utf-8');
  const retryMetadata = {
    ...(run.promptMetadata || {}),
    retryOfRunId: run.id,
  };
  await startClaudeDispatch(run.projectPath, run.skill, run.ticket || undefined, {
    customPrompt: prompt,
    promptMetadata: retryMetadata,
    noWorktree: true,
  });
}

function resolveRunWorkspace(run: KronosRun): string | null {
  for (const candidate of [run.worktreePath, run.cwd, run.projectPath]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch {}
    }
  }
  return null;
}

async function resumeSelectedRun(state: KronosState, run: KronosRun): Promise<void> {
  const workspace = resolveRunWorkspace(run);
  if (!workspace) {
    vscode.window.showWarningMessage('Run workspace no longer exists.');
    return;
  }
  const projectPath = run.projectPath || workspace;
  const projectName = run.project || path.basename(projectPath);
  const ticketKey = run.ticket || undefined;
  const confirm = await vscode.window.showWarningMessage(
    `Resume run ${run.id} in ${workspace}? Kronos will dispatch a continuation prompt using the saved prompt and recent log tail.`,
    'Resume Run',
    'Cancel'
  );
  if (confirm !== 'Resume Run') { return; }

  try {
    const originalPrompt = run.promptPath && fs.existsSync(run.promptPath)
      ? fs.readFileSync(run.promptPath, 'utf-8')
      : '';
    const logTail = readRunLogTail(run.logPath);
    const resumePrompt = buildRunResumePrompt(run, originalPrompt, logTail);
    const resumeMetadata: PromptRunMetadata = {
      ...(run.promptMetadata || {}),
      name: `resume-${run.id}`,
      source: 'custom',
      retryOfRunId: run.id,
    };

    await startClaudeDispatch(projectPath, run.skill || 'continue-work', ticketKey, {
      customPrompt: resumePrompt,
      promptMetadata: resumeMetadata,
      noWorktree: true,
      workspaceCwd: workspace,
      projectNameOverride: projectName,
      appendSystemPrompt: getImplementPrompt(state),
      onComplete: refreshAfterDispatch(state, projectName, ticketKey),
    });
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to resume run.'));
  }
}

async function archiveSelectedRun(runId: string): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Archive run ${runId}? Its run record, log, and saved prompt will move under the run archive.`,
    'Archive',
    'Cancel'
  );
  if (confirm !== 'Archive') { return; }

  try {
    const archived = archiveRun(runId);
    const action = await vscode.window.showInformationMessage(`Archived run ${runId}.`, 'Open Archived Record');
    if (action === 'Open Archived Record') {
      await openTextFileIfExists(archived.runPath, 'Archived run record not found.');
    }
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to archive run.'));
  }
}

async function pauseSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  const confirm = await vscode.window.showWarningMessage(
    `Pause run ${run.id}? Kronos will send SIGSTOP to its process tree and keep the run visible as paused.`,
    'Pause Run',
    'Cancel'
  );
  if (confirm !== 'Pause Run') { return; }

  try {
    const signalResult = signalProcessTree(processPid, 'SIGSTOP');
    markRunPaused(
      run.id,
      signalResult.signalled
        ? `Paused by operator. ${signalResult.method} SIGSTOP sent.`
        : `Paused by operator. No process signal was sent${signalResult.error ? `: ${signalResult.error}` : '.'}`,
    );
    vscode.window.showInformationMessage(`Paused run ${run.id}.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to pause run.'));
  }
}

async function continueSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  const confirm = await vscode.window.showWarningMessage(
    `Continue run ${run.id}? Kronos will send SIGCONT to its process tree and mark it running.`,
    'Continue Run',
    'Cancel'
  );
  if (confirm !== 'Continue Run') { return; }

  try {
    const signalResult = signalProcessTree(processPid, 'SIGCONT');
    markRunContinued(
      run.id,
      signalResult.signalled
        ? `Continued by operator. ${signalResult.method} SIGCONT sent.`
        : `Continued by operator. No process signal was sent${signalResult.error ? `: ${signalResult.error}` : '.'}`,
    );
    vscode.window.showInformationMessage(`Continued run ${run.id}.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to continue run.'));
  }
}

async function cancelSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  const status = String(run.status || 'unknown');
  const confirm = await vscode.window.showWarningMessage(
    `Cancel run ${run.id} (currently ${status})? Kronos will mark it cancelled and attempt to stop its process tree.`,
    'Cancel Run',
    'Keep Running'
  );
  if (confirm !== 'Cancel Run') { return; }

  try {
    const stopResult = stopProcessTree(processPid);
    markRunCancelled(
      run.id,
      stopResult.signalled
        ? `Cancelled by operator. ${stopResult.method} stop requested.`
        : 'Cancelled by operator. No process pid was recorded.',
    );
    vscode.window.showInformationMessage(`Marked run ${run.id} as cancelled.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to cancel run.'));
  }
}

async function openRunDiffArtifact(run: KronosRun): Promise<void> {
  const cwd = run.worktreePath || run.cwd || run.projectPath;
  if (!cwd || !fs.existsSync(cwd)) {
    vscode.window.showWarningMessage('Run workspace no longer exists.');
    return;
  }
  try {
    const artifact = createWorkspaceDiffArtifact(run, RUNS_DIR);
    await openTextFileIfExists(artifact.filePath, 'Run diff artifact not found.');
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to open run diff.'));
  }
}

async function markSelectedRunNeedsHuman(run: KronosRun): Promise<void> {
  const reason = await vscode.window.showInputBox({
    prompt: `Why does ${run.id} need human review?`,
    placeHolder: 'e.g., ambiguous product requirement, unsafe worktree, missing credential, manual QA needed',
  });
  if (reason === undefined) { return; }
  try {
    markRunNeedsHuman(run.id, reason);
    vscode.window.showInformationMessage(`Marked run ${run.id} as needs-human.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to mark run needs-human.'));
  }
}

function runLastEventLabel(run: KronosRun): string {
  const events = Array.isArray(run.events) ? run.events : [];
  const last = events[events.length - 1];
  return typeof last?.label === 'string' ? last.label : '';
}

function runQuickPickDetail(run: KronosRun): string {
  return `${formatWebviewDateTime(run.startedAt)} - ${run.failureReason || runLastEventLabel(run) || run.cwd || ''}`;
}

function runProcessPid(run: KronosRun): number | undefined {
  const pid = Number(run.processPid ?? Reflect.get(run, 'pid'));
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function findRunById(runId: string): KronosRun | undefined {
  return listRuns().find(run => run.id === runId);
}

function openInteractiveRunCenter(state: KronosState): void {
  openRunCenter({
    onAction: request => executeRunCenterAction(state, request),
  });
}

async function executeRunCenterAction(state: KronosState, request: RunCenterActionRequest): Promise<void> {
  const run = findRunById(request.runId);
  if (request.command === 'openRunRecord') {
    await openTextFileIfExists(runRecordPath(request.runId), 'Run record not found.');
    return;
  }
  if (!run) {
    vscode.window.showWarningMessage('Run record not found.');
    return;
  } else if (request.command === 'openRunLog') {
    await openTextFileIfExists(run.logPath || '', 'Run log not found.');
  } else if (request.command === 'openRunPrompt') {
    await openTextFileIfExists(run.promptPath || '', 'Run prompt artifact not found.');
  } else if (request.command === 'openRunWorkspace') {
    const cwd = run.worktreePath || run.cwd || run.projectPath;
    if (cwd && fs.existsSync(cwd)) {
      const terminal = vscode.window.createTerminal(kronosTerminalOptions({ name: `Kronos ${run.project || run.id}`, cwd }));
      terminal.show();
    } else {
      vscode.window.showWarningMessage('Run workspace no longer exists.');
    }
  } else if (request.command === 'openRunDiff') {
    await openRunDiffArtifact(run);
  } else if (request.command === 'markNeedsHuman') {
    await markSelectedRunNeedsHuman(run);
  } else if (request.command === 'pauseRun') {
    await pauseSelectedRun(run);
  } else if (request.command === 'continueRun') {
    await continueSelectedRun(run);
  } else if (request.command === 'cancelRun') {
    await cancelSelectedRun(run);
  } else if (request.command === 'resumeRun') {
    await resumeSelectedRun(state, run);
  } else if (request.command === 'retryRun') {
    await retryRunFromPrompt(run);
  } else if (request.command === 'archiveRun') {
    await archiveSelectedRun(request.runId);
  }
}

function openTicketExternalUrl(state: KronosState, ticketKey: string, kind: 'jira' | 'mr' | 'build'): void {
  const ticket = state.state?.tickets?.[ticketKey];
  if (!ticket) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  const url = kind === 'jira'
    ? ticketStringField(ticket, 'jira_url')
    : kind === 'mr'
      ? ticketStringField(ticketRecord(ticket.mr) ? ticket.mr : null, 'url')
      : ticketStringField(ticketRecord(ticket.build) ? ticket.build : null, 'url');
  if (!url) {
    vscode.window.showWarningMessage(`No ${kind} URL recorded for ${ticketKey}.`);
    return;
  }
  openExternalHttpUrl(url);
}

async function executeTicketDetailAction(state: KronosState, command: string, ticketKey: string): Promise<void> {
  if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey || 'Ticket'} is no longer in Kronos state.`);
    return;
  }
  if (command === 'startTicket') {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (command === 'addToQueue') {
    await vscode.commands.executeCommand('kronos.addToQueue', { ticketKey });
  } else if (command === 'removeFromQueue') {
    await removeTicketFromQueue(state, ticketKey, true);
  } else if (command === 'linkTicket') {
    await vscode.commands.executeCommand('kronos.linkTicket', { ticketKey });
  } else if (command === 'addEvidence') {
    await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
  } else if (command === 'addEvidenceCheck') {
    await vscode.commands.executeCommand('kronos.addEvidenceCheck', { ticketKey });
  } else if (command === 'recordEnvironmentResult') {
    await vscode.commands.executeCommand('kronos.recordEnvironmentResult', { ticketKey });
  } else if (command === 'evidenceGate') {
    await vscode.commands.executeCommand('kronos.evidenceGate', { ticketKey });
  } else if (command === 'exportEvidence') {
    await vscode.commands.executeCommand('kronos.exportEvidence', { ticketKey });
  } else if (command === 'evidenceHandoff') {
    await vscode.commands.executeCommand('kronos.evidenceHandoff', { ticketKey });
  } else if (command === 'publishEvidence') {
    await vscode.commands.executeCommand('kronos.publishEvidence', { ticketKey });
  } else if (command === 'openJira') {
    openTicketExternalUrl(state, ticketKey, 'jira');
  } else if (command === 'openMr') {
    openTicketExternalUrl(state, ticketKey, 'mr');
  } else if (command === 'openBuild') {
    openTicketExternalUrl(state, ticketKey, 'build');
  }
}

async function promptTicketView(
  state: KronosState,
  currentFilter: TicketFilter,
  currentGroupBy: TicketGroupBy,
  reviewOnly: boolean,
): Promise<{ filter: TicketFilter; groupBy: TicketGroupBy } | null> {
  const fields = [
    { label: 'Search text', id: 'query' },
    { label: 'Project', id: 'project' },
    { label: 'Action status', id: 'action' },
    { label: 'Priority', id: 'priority' },
    { label: 'Label', id: 'label' },
    { label: 'MR state', id: 'mrState' },
    { label: 'Build status', id: 'buildStatus' },
    { label: 'Stale age', id: 'staleDays' },
    ...(reviewOnly ? [] : [{ label: 'Link state', id: 'linked' }, { label: 'Group by', id: 'groupBy' }]),
    { label: 'Clear filters', id: 'clear' },
  ];
  const picked = await vscode.window.showQuickPick(fields, { placeHolder: `Current: ${describeTicketFilter(currentFilter)}` });
  if (!picked) { return null; }
  if (picked.id === 'clear') {
    return { filter: {}, groupBy: 'none' };
  }

  const filter: TicketFilter = { ...currentFilter };
  let groupBy = currentGroupBy;
  const tickets = Object.values(state.state?.tickets || {});

  if (picked.id === 'query') {
    filter.query = await promptOptionalText('Ticket search text', filter.query);
  } else if (picked.id === 'project') {
    filter.project = await promptOptionalChoice('Project', filter.project, uniqueStrings([
      ...Object.keys(state.state?.projects || {}),
      ...tickets.flatMap(ticket => ticket.projects || []),
    ]));
  } else if (picked.id === 'action') {
    filter.action = await promptOptionalChoice('Action status', filter.action, uniqueStrings(tickets.map(ticket => ticket.next_action)));
  } else if (picked.id === 'priority') {
    filter.priority = await promptOptionalChoice('Priority', filter.priority, uniqueStrings(tickets.map(ticket => ticket.priority)));
  } else if (picked.id === 'label') {
    filter.label = await promptOptionalChoice('Label', filter.label, uniqueStrings(tickets.flatMap(ticket => ticket.labels || [])));
  } else if (picked.id === 'mrState') {
    filter.mrState = await promptOptionalChoice('MR state', filter.mrState, uniqueStrings([
      'none',
      'opened',
      'merged',
      'closed',
      'pending_review',
      'approved',
      'changes_requested',
      ...tickets.flatMap(ticket => ticket.mr ? [ticket.mr.state, ticket.mr.review_status] : []),
    ]));
  } else if (picked.id === 'buildStatus') {
    filter.buildStatus = await promptOptionalChoice('Build status', filter.buildStatus, uniqueStrings([
      'none',
      ...tickets.map(ticket => ticket.build?.status || ''),
    ]));
  } else if (picked.id === 'staleDays') {
    const value = await vscode.window.showInputBox({
      prompt: 'Minimum age in days; leave blank for any age',
      value: filter.staleDays ? String(filter.staleDays) : '',
      validateInput: value => !value.trim() || (/^\d+$/.test(value.trim()) && Number(value.trim()) > 0) ? null : 'Enter a positive whole number.',
    });
    if (value === undefined) { return null; }
    filter.staleDays = value.trim() ? Number(value.trim()) : undefined;
  } else if (picked.id === 'linked') {
    const linked = await promptOptionalChoice('Link state', filter.linked, ['linked', 'unlinked']);
    filter.linked = linked === 'linked' || linked === 'unlinked' ? linked : undefined;
  } else if (picked.id === 'groupBy') {
    const selected = await promptOptionalChoice('Group by', groupBy, ['none', 'action', 'project', 'priority']);
    groupBy = (selected === 'action' || selected === 'project' || selected === 'priority') ? selected : 'none';
  }

  return { filter: cleanTicketFilter(filter), groupBy };
}

async function promptOptionalText(placeHolder: string, current?: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({ placeHolder, value: current || '', prompt: 'Leave blank to clear this filter.' });
  if (value === undefined) { return current; }
  return value.trim() || undefined;
}

async function promptOptionalChoice(placeHolder: string, current: string | undefined, values: string[]): Promise<string | undefined> {
  const options = ['Any', ...values].map(value => ({ label: value, description: value === current ? 'current' : undefined }));
  const picked = await vscode.window.showQuickPick(options, { placeHolder });
  if (!picked) { return current; }
  return picked.label === 'Any' ? undefined : picked.label;
}

function cleanTicketFilter(filter: TicketFilter): TicketFilter {
  const cleaned: TicketFilter = {};
  if (filter.query?.trim()) { cleaned.query = filter.query.trim(); }
  if (filter.project?.trim()) { cleaned.project = filter.project.trim(); }
  if (filter.action?.trim()) { cleaned.action = filter.action.trim(); }
  if (filter.priority?.trim()) { cleaned.priority = filter.priority.trim(); }
  if (filter.label?.trim()) { cleaned.label = filter.label.trim(); }
  if (filter.mrState?.trim()) { cleaned.mrState = filter.mrState.trim(); }
  if (filter.buildStatus?.trim()) { cleaned.buildStatus = filter.buildStatus.trim(); }
  if (filter.staleDays && filter.staleDays > 0) { cleaned.staleDays = filter.staleDays; }
  if (filter.linked) { cleaned.linked = filter.linked; }
  return cleaned;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function getImplementPrompt(state: KronosState): string {
  return state.loadPrompt('implement-system');
}

function loadPromptForDispatch(
  state: KronosState,
  name: string,
  vars: Record<string, string> = {},
  projectPath?: string,
): { text: string; metadata: PromptRunMetadata } {
  const rendered = state.renderPrompt(name, vars, projectPath);
  if (!rendered) {
    return {
      text: '',
      metadata: { name, source: 'global', missingVariables: Object.keys(vars).sort() },
    };
  }
  return {
    text: rendered.text,
    metadata: {
      name: rendered.name,
      source: rendered.source,
      path: rendered.path,
      templateHash: rendered.templateHash,
      renderedHash: rendered.renderedHash,
      modifiedAt: rendered.modifiedAt,
      variables: rendered.variables,
      providedVariables: rendered.providedVariables,
      missingVariables: rendered.missingVariables,
    },
  };
}

function loadEnvFile(): void {
  const envPath = path.join(os.homedir(), '.claude', '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...rest] = trimmed.split('=');
        const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[k.trim()]) { process.env[k.trim()] = val; }
      }
    }
  } catch {}
}

export function activate(context: vscode.ExtensionContext) {
  loadEnvFile();
  const state = new KronosState();

  const projectTree = new ProjectTreeProvider(state);
  const queueTree = new QueueTreeProvider(state);
  const sessionTree = new SessionTreeProvider(state);
  const taskTree = new TaskTreeProvider(state);
  const reviewTree = new ReviewTreeProvider(state);
  const ticketTree = new TicketTreeProvider(state);

  vscode.window.registerTreeDataProvider('kronosSessions', sessionTree);
  vscode.window.registerTreeDataProvider('kronosTasks', taskTree);

  // Shared refresh guard — prevents concurrent refresh calls
  let refreshing = false;
  let lastRefreshTime = 0;
  const throttledRefresh = async () => {
    if (refreshing || Date.now() - lastRefreshTime < 60000) { return; }
    refreshing = true;
    lastRefreshTime = Date.now();
    try { await state.refresh(); } catch {} finally { refreshing = false; }
  };

  // Tree views with auto-refresh on focus
  let attentionBadgeTarget: BadgeTarget | undefined;
  const updateAttentionBadge = () => {
    if (!attentionBadgeTarget) { return; }
    const summary = computeAttentionBadge({
      state: state.state,
      queue: state.queue,
      runs: listRuns(),
      newReviewItems: reviewTree.getNewReviewCount(),
      agingThresholds: agingThresholdsFromConfig(),
    });
    attentionBadgeTarget.badge = summary.count > 0
      ? { value: summary.count, tooltip: summary.tooltip }
      : undefined;
  };
  for (const [id, provider] of [
    ['kronosProjects', projectTree],
    ['kronosTickets', ticketTree],
    ['kronosQueue', queueTree],
    ['kronosReview', reviewTree],
  ] as const) {
    const view = vscode.window.createTreeView(id, { treeDataProvider: provider });
    if (id === 'kronosProjects') {
      attentionBadgeTarget = view;
    }
    const updateReviewBadge = () => {
      if (id !== 'kronosReview') { return; }
      const count = reviewTree.getNewReviewCount();
      view.badge = count > 0
        ? { value: count, tooltip: `${count} new review item${count === 1 ? '' : 's'}` }
        : undefined;
    };
    if (id === 'kronosReview') {
      updateReviewBadge();
      context.subscriptions.push(reviewTree.onDidChangeNewReviewCount(updateReviewBadge));
      if (view.visible) {
        reviewTree.markVisibleReviewItemsSeen();
      }
    }
    view.onDidChangeVisibility(e => {
      if (!e.visible) { return; }
      void throttledRefresh().finally(() => {
        if (id === 'kronosReview') {
          reviewTree.markVisibleReviewItemsSeen();
        }
      });
    });
    context.subscriptions.push(view);
  }
  updateAttentionBadge();
  context.subscriptions.push(
    state.onDidChange(updateAttentionBadge),
    state.onDidSessionChange(updateAttentionBadge),
    reviewTree.onDidChangeNewReviewCount(updateAttentionBadge),
  );

  const config = vscode.workspace.getConfiguration('kronos');
  const sessionPollMs = config.get<number>('sessionPollIntervalMs', 5000);
  sessionTree.startPolling(sessionPollMs);

  // Background poll (uses same throttle — won't double-refresh)
  const pollSec = config.get<number>('pollIntervalSec', 300);
  const pollTimer = setInterval(throttledRefresh, pollSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(pollTimer) });
  startReviewAutomation(context, state);

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'kronos.openDashboard';
  updateStatusBar(state);
  state.onDidChange(() => updateStatusBar(state));
  state.onDidSessionChange(() => updateStatusBar(state));
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  if (state.loadIssues.length > 0) {
    const loaded = state.state ? 'loaded with warnings' : 'could not load state.json';
    runNotificationCommandAction(
      vscode.window.showWarningMessage(`Kronos ${loaded}. Run Doctor for details.`, 'Run Doctor'),
      'Run Doctor',
      'kronos.doctor',
      'Failed to open Kronos Doctor.'
    );
  }

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('kronos.refresh', async () => {
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Refreshing all projects...' },
        async () => {
          await state.refresh();
          lastRefreshTime = Date.now();
        },
        'Failed to refresh Kronos projects.'
      );
    }),

    vscode.commands.registerCommand('kronos.openExternalUrl', async (url: string) => {
      openExternalHttpUrl(String(url || ''));
    }),

    vscode.commands.registerCommand('kronos.refreshProject', async (item: any) => {
      if (item?.projectName) {
        await state.refresh(item.projectName);
        lastRefreshTime = Date.now();
      }
    }),

    vscode.commands.registerCommand('kronos.filterTickets', async () => {
      const result = await promptTicketView(state, ticketTree.getFilter(), ticketTree.getGroupBy(), false);
      if (!result) { return; }
      ticketTree.setView(result.filter, result.groupBy);
      vscode.window.showInformationMessage(`Tickets view: ${describeTicketFilter(result.filter)}${result.groupBy !== 'none' ? `, grouped by ${result.groupBy}` : ''}.`);
    }),

    vscode.commands.registerCommand('kronos.ticketSavedView', async () => {
      const picked = await vscode.window.showQuickPick(
        TICKET_FILTER_PRESETS.map(preset => ({ label: preset.label, description: preset.id, preset })),
        { placeHolder: 'Saved ticket view' }
      );
      if (!picked) { return; }
      ticketTree.setView(picked.preset.view.filter, picked.preset.view.groupBy);
      vscode.window.showInformationMessage(`Tickets view: ${picked.preset.label}.`);
    }),

    vscode.commands.registerCommand('kronos.clearTicketFilters', async () => {
      ticketTree.clearView();
      vscode.window.showInformationMessage('Tickets view filters cleared.');
    }),

    vscode.commands.registerCommand('kronos.filterReviews', async () => {
      const result = await promptTicketView(state, reviewTree.getFilter(), 'none', true);
      if (!result) { return; }
      reviewTree.setFilter(result.filter);
      vscode.window.showInformationMessage(`Review view: ${describeTicketFilter(result.filter)}.`);
    }),

    vscode.commands.registerCommand('kronos.clearReviewFilters', async () => {
      reviewTree.clearFilter();
      vscode.window.showInformationMessage('Review filters cleared.');
    }),

    vscode.commands.registerCommand('kronos.discover', async () => {
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Scanning for projects...' },
        async () => {
          const result = await state.discover();
          try {
            const candidates: DiscoveredProject[] = result.candidates || [];
            if (candidates.length === 0) {
              vscode.window.showInformationMessage('No unregistered projects found in scan directories.');
              return;
            }

            // Show ALL repos, group by readiness
            const withConfig = candidates.filter(c => c.has_project_json);
            const withJiraGuess = candidates.filter(c => !c.has_project_json && c.suggested_jira_key);
            const noConfig = candidates.filter(c => !c.has_project_json && !c.suggested_jira_key);

            const items: vscode.QuickPickItem[] = [];

            if (withConfig.length > 0) {
              items.push({ label: '--- Ready to register (has config) ---', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of withConfig) {
                items.push({ label: c.repo_name, description: '$(check) Has .claude/project.json', detail: c.path, picked: true });
              }
            }

            if (withJiraGuess.length > 0) {
              items.push({ label: `--- Jira key guessed (${withJiraGuess.length} repos) ---`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of withJiraGuess) {
                const parent = c.path.split(/[\\/]/).slice(-2, -1)[0] || '';
                items.push({ label: c.repo_name, description: `Jira: ${c.suggested_jira_key} | ${parent}`, detail: c.path });
              }
            }

            if (noConfig.length > 0) {
              items.push({ label: `--- No config (${noConfig.length} repos) ---`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of noConfig) {
                const parent = c.path.split(/[\\/]/).slice(-2, -1)[0] || '';
                items.push({ label: c.repo_name, description: `${parent} — needs Jira key`, detail: c.path });
              }
            }

            const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
              canPickMany: true,
              placeHolder: `Found ${candidates.length} repos — select which to register`,
            });

            if (selected && selected.length > 0) {
              let registered = 0;
              for (const s of selected) {
                if (!s.detail) { continue; }
                const candidate = candidates.find(c => c.path === s.detail);
                try {
                  await state.register(s.detail);
                  registered++;

                  // For repos without config AND no guessed Jira key, ask for one
                  if (candidate && !candidate.has_project_json && !candidate.suggested_jira_key) {
                    const jiraKey = await vscode.window.showInputBox({
                      prompt: `Jira project key for ${s.label}?`,
                      placeHolder: 'e.g., EDIPVR (leave empty to skip)',
                    });
                    if (jiraKey) {
                      setProjectConfigValue(s.label, 'jira_project_key', jiraKey);
                      state.reloadAndNotify();
                    }
                  }
                } catch {
                  // skip failures silently
                }
              }
              vscode.window.showInformationMessage(`Registered ${registered} project(s). Run Refresh to pull tickets.`);
            }
          } catch {
            vscode.window.showErrorMessage('Failed to parse discovery results.');
          }
        },
        'Failed to discover Kronos projects.'
      );
    }),

    vscode.commands.registerCommand('kronos.register', async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Register Project',
      });
      if (folders && folders[0]) {
        await state.register(folders[0].fsPath);
        vscode.window.showInformationMessage(`Registered: ${folders[0].fsPath}`);
      }
    }),

    vscode.commands.registerCommand('kronos.implement', async (item: any) => {
      const ticketKey = item?.ticketKey;
      if (!ticketKey || !state.state) { return; }
      const ticket = state.state.tickets[ticketKey];
      if (!ticket) { return; }

      const projects = ticket.projects || [];
      let targetProjects: string[] = [];

      if (projects.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} is not linked to any project. Link it first.`);
        return;
      } else if (projects.length === 1) {
        targetProjects = projects;
      } else {
        const picks = await vscode.window.showQuickPick(
          projects.map(p => ({ label: p, picked: true })),
          { canPickMany: true, placeHolder: `${ticketKey} is linked to ${projects.length} projects — which to implement in?` }
        );
        if (!picks || picks.length === 0) { return; }
        targetProjects = picks.map(p => p.label);
      }

      const canStart = await confirmDispatchCollisions(state, { ticketKey, projects: targetProjects, action: 'implement' });
      if (!canStart) { return; }

      for (const projName of targetProjects) {
        const projectPath = getProjectPath(state, projName);
        if (!projectPath) { continue; }
        const otherProjects = targetProjects.filter(p => p !== projName);
        const scopeHint = otherProjects.length > 0
          ? `\n\nADDITIONAL CONTEXT FROM USER: You are working in ${projName}. Focus ONLY on changes relevant to this codebase. Other projects also being updated for this ticket: ${otherProjects.join(', ')}.`
          : '';
        await startClaudeDispatch(projectPath, 'implement', ticketKey, {
          onComplete: refreshAfterDispatch(state, projName, ticketKey),
          parallel: true,
          appendSystemPrompt: getImplementPrompt(state) + scopeHint,
        });
      }
    }),

    vscode.commands.registerCommand('kronos.deployMonitor', async (item: any) => {
      const projectName = resolveProjectName(state, item);
      const ticketKey = resolveTicketKey(item);
      const projectPath = getProjectPath(state, projectName);
      if (projectPath) {
        await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey, {
          onComplete: refreshAfterDispatch(state, projectName, ticketKey),
          noWorktree: true,
          projectNameOverride: projectName,
        });
      } else {
        vscode.window.showWarningMessage('No project linked. Link the ticket to a project first.');
      }
    }),

    vscode.commands.registerCommand('kronos.verifyFix', async (item: any) => {
      const projectName = resolveProjectName(state, item);
      const projectPath = getProjectPath(state, projectName);
      if (projectPath) {
        await startClaudeDispatch(projectPath, 'verify-fix', item?.ticketKey, {
          onComplete: refreshAfterDispatch(state, projectName),
          noWorktree: true,
        });
      } else {
        vscode.window.showWarningMessage('No project linked. Link the ticket to a project first.');
      }
    }),

    vscode.commands.registerCommand('kronos.startNext', async () => {
      try {
        const selection = selectNextQueueItem();
        if (selection.empty || !selection.item) {
          vscode.window.showInformationMessage('Queue is empty. Add tickets from the Tickets view.');
          return;
        }
        const item = selection.item;
        const projs: string[] = item.projects || [];
        const projLabel = projs.join(', ') || 'unlinked';
        if (item.action === 'refresh') {
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const p of projs) { await state.refresh(p); }
        } else if (projs.length > 0) {
          const canStart = await confirmDispatchCollisions(state, {
            ticketKey: item.ticket,
            projects: projs,
            action: item.action,
            excludeQueueItemId: item.id,
          });
          if (!canStart) { return; }
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const projName of projs) {
            const projectPath = getProjectPath(state, projName);
            if (!projectPath) { continue; }
            const skill = skillForAction(item.action);
            const isCodeAction = ['implement', 'in_progress', 'fix_build'].includes(item.action);
            const ticketKey = item.ticket || undefined;
            await startClaudeDispatch(projectPath, skill, ticketKey, {
              onComplete: refreshAfterDispatch(state, projName, ticketKey),
              parallel: isCodeAction,
              appendSystemPrompt: isCodeAction ? getImplementPrompt(state) : undefined,
            });
          }
        }
      } catch {
        vscode.window.showErrorMessage('Failed to get next queue item.');
      }
    }),

    vscode.commands.registerCommand('kronos.nextBestAction', async () => {
      const plans = planNextActions(state);
      if (plans.length === 0) {
        vscode.window.showInformationMessage('No actionable tickets found.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        plans.slice(0, 25).map(plan => {
          const context = buildNextActionContext(plan, { state: state.state, queue: state.queue });
          return {
            label: `${plan.ticketKey || 'Refresh'}: ${actionToLabel(plan.action)} (${plan.score})`,
            description: `${plan.projects.join(', ') || 'unlinked'} - risk: ${context.risks.join(', ')}`,
            detail: `${plan.reason} | ${context.commandLabel} | ${context.blockers.length ? `Blocked: ${context.blockers.join('; ')}` : `Preflight: ${context.preflight.join('; ')}`}`,
            plan,
            context,
          };
        }),
        { placeHolder: 'Next best Kronos action' }
      );
      if (!picked) { return; }

      const actions = picked.plan.ticketKey
        ? picked.plan.source === 'queue'
          ? ['Start', 'Pin to Queue', 'View Ticket', 'Add Evidence']
          : ['Start', 'Add to Queue', 'Pin to Queue', 'Snooze 1 Hour', 'Snooze Today', 'Reject Recommendation', 'View Ticket', 'Add Evidence']
        : ['Start'];
      const action = await vscode.window.showQuickPick(actions, { placeHolder: `${picked.label}: what should Kronos do?` });
      if (!action) { return; }

      if (action === 'Start') {
        await startPlannedAction(state, picked.plan, picked.context);
      } else if (action === 'Add to Queue' && picked.plan.ticketKey) {
        addPlanToQueue(state, picked.plan, false);
      } else if (action === 'Pin to Queue' && picked.plan.ticketKey) {
        addPlanToQueue(state, picked.plan, true);
      } else if (action === 'Snooze 1 Hour' && picked.plan.ticketKey) {
        recordPlanDecision(state, picked.plan, 'snoozed', 60);
        vscode.window.showInformationMessage(`Snoozed ${picked.plan.ticketKey} for 1 hour.`);
      } else if (action === 'Snooze Today' && picked.plan.ticketKey) {
        recordPlanDecision(state, picked.plan, 'snoozed', minutesUntilTomorrow());
        vscode.window.showInformationMessage(`Snoozed ${picked.plan.ticketKey} until tomorrow.`);
      } else if (action === 'Reject Recommendation' && picked.plan.ticketKey) {
        const reason = await vscode.window.showInputBox({
          prompt: `Why reject ${picked.plan.ticketKey}?`,
          placeHolder: 'e.g., not in scope this sprint, blocked by product',
        });
        if (reason === undefined) { return; }
        recordPlanDecision(state, picked.plan, 'rejected', undefined, reason || undefined);
        vscode.window.showInformationMessage(`Rejected ${picked.plan.ticketKey} recommendation.`);
      } else if (action === 'View Ticket' && picked.plan.ticketKey) {
        vscode.commands.executeCommand('kronos.viewTicket', { ticketKey: picked.plan.ticketKey });
      } else if (action === 'Add Evidence' && picked.plan.ticketKey) {
        vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: picked.plan.ticketKey });
      }
    }),

    vscode.commands.registerCommand('kronos.queuePlanner', async () => {
      openQueuePlannerPanel(state);
    }),

    vscode.commands.registerCommand('kronos.backlogTriage', async () => {
      openBacklogTriagePanel(state);
    }),

    vscode.commands.registerCommand('kronos.projectBatchPlan', async () => {
      openProjectBatchPlanPanel(state);
    }),

    vscode.commands.registerCommand('kronos.releaseBatchPlan', async () => {
      openReleaseBatchPlanPanel(state);
    }),

    vscode.commands.registerCommand('kronos.collisionReport', async () => {
      await openCollisionReportPanel(state);
    }),

    vscode.commands.registerCommand('kronos.planNextTwoHours', async () => {
      openQueuePlanWindowPanel(state);
    }),

    vscode.commands.registerCommand('kronos.overnightCandidates', async () => {
      openOvernightCandidatesPanel(state);
    }),

    vscode.commands.registerCommand('kronos.addTask', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Task title',
        placeHolder: 'e.g., Research 278 routing logic',
      });
      if (title) {
        await state.addTask(title);
      }
    }),

    vscode.commands.registerCommand('kronos.completeTask', async (item: any) => {
      if (item?.taskId) {
        await state.completeTask(item.taskId);
      }
    }),

    vscode.commands.registerCommand('kronos.openProject', async (item: any) => {
      const projectPath = getProjectPath(state, item?.projectName);
      if (projectPath) {
        const terminal = vscode.window.createTerminal(kronosTerminalOptions({
          name: item.projectName,
          cwd: projectPath,
        }));
        terminal.show();
      }
    }),

    vscode.commands.registerCommand('kronos.openInClaude', async (item: any) => {
      const projectPath = getProjectPath(state, item?.projectName);
      if (projectPath) {
        openInClaude(projectPath);
      }
    }),

    vscode.commands.registerCommand('kronos.jiraBoard', async () => {
      if (!state.state) { return; }
      const panel = vscode.window.createWebviewPanel(
        'kronosJiraBoard', 'Kronos: Jira Board',
        vscode.ViewColumn.One, { enableScripts: true }
      );
      const nonce = createWebviewNonce();
      const renderBoard = () => {
        panel.webview.html = withWebviewCsp(buildJiraBoardHtml(state, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
      };
      const hasTicket = (ticketKey: string) => Boolean(state.state?.tickets?.[ticketKey]);
      const hasProject = (projectName: string) => Boolean(state.state?.projects?.[projectName]);
      const openKnownTicketUrl = (ticketKey: string, kind: 'jira' | 'mr') => {
        const ticket = state.state?.tickets?.[ticketKey];
        const url = kind === 'jira' ? ticket?.jira_url : ticket?.mr?.url;
        if (url) {
          openExternalHttpUrl(url);
        }
      };
      renderBoard();
      panel.webview.onDidReceiveMessage(async (msg) => {
        const request = normalizeBoardMessage(msg);
        if (!request) {
          vscode.window.showWarningMessage('Ignored invalid Kronos board request.');
          return;
        }
        const { command, ticket, project } = request;

        if (command === 'link' && hasTicket(ticket) && hasProject(project)) {
          try {
            linkTicketToProject(ticket, project);
            state.reloadAndNotify();
            renderBoard();
          } catch (e: unknown) {
            vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to link ticket.'));
          }
        } else if (command === 'unlink' && hasTicket(ticket) && hasProject(project)) {
          try {
            unlinkTicketFromProject(ticket, project);
            state.reloadAndNotify();
            renderBoard();
          } catch (e: unknown) {
            vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to unlink ticket.'));
          }
        } else if (command === 'addToQueue' && hasTicket(ticket)) {
          try {
            const result = addTicketToQueue(ticket);
            state.reloadAndNotify();
            renderBoard();
            if (result.alreadyInQueue) { vscode.window.showInformationMessage(`${ticket} is already in the queue.`); }
          } catch (e: unknown) {
            vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to add ticket to queue.'));
          }
        } else if (command === 'removeFromQueue' && hasTicket(ticket)) {
          await removeTicketFromQueue(state, ticket, true);
          renderBoard();
        } else if (command === 'start' && hasTicket(ticket)) {
          vscode.commands.executeCommand('kronos.implement', { ticketKey: ticket });
          return;
        } else if (command === 'openJira' && hasTicket(ticket)) {
          openKnownTicketUrl(ticket, 'jira');
          return;
        } else if (command === 'openMr' && hasTicket(ticket)) {
          openKnownTicketUrl(ticket, 'mr');
          return;
        } else if (command === 'getComments' && hasTicket(ticket)) {
          try {
            const result = await jiraAdapter.ticketComments(state, ticket);
            panel.webview.postMessage({ command: 'comments', ticket, data: result });
          } catch {
            panel.webview.postMessage({ command: 'comments', ticket, data: [], error: 'Could not load comments' });
          }
          return;
        } else if (command === 'addToQueueFromModal' && hasTicket(ticket)) {
          try {
            const result = addTicketToQueue(ticket);
            state.reloadAndNotify();
            if (result.alreadyInQueue) { vscode.window.showInformationMessage(`${ticket} is already in the queue.`); }
          } catch (e: unknown) {
            vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to add ticket to queue.'));
          }
          renderBoard();
          return;
        } else if (command === 'addEvidence' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: ticket });
          renderBoard();
          return;
        } else if (command === 'addEvidenceCheck' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.addEvidenceCheck', { ticketKey: ticket });
          renderBoard();
          return;
        } else if (command === 'recordEnvironmentResult' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.recordEnvironmentResult', { ticketKey: ticket });
          renderBoard();
          return;
        } else if (command === 'exportEvidence' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.exportEvidence', { ticketKey: ticket });
          renderBoard();
          return;
        } else if (command === 'evidenceHandoff' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.evidenceHandoff', { ticketKey: ticket });
          renderBoard();
          return;
        } else if (command === 'publishEvidence' && hasTicket(ticket)) {
          await vscode.commands.executeCommand('kronos.publishEvidence', { ticketKey: ticket });
          renderBoard();
          return;
        } else {
          vscode.window.showWarningMessage('Ignored invalid Kronos board request.');
        }
        renderBoard();
      });
    }),

    vscode.commands.registerCommand('kronos.viewTicket', async (treeItem: any) => {
      const ticketKey = treeItem?.ticketKey;
      if (!ticketKey || !state.state) { return; }
      if (!state.state.tickets[ticketKey]) { return; }
      const panel = vscode.window.createWebviewPanel(
        'kronosTicket', `${ticketKey}: Ticket`,
        vscode.ViewColumn.One, { enableScripts: true }
      );
      const nonce = createWebviewNonce();
      const render = () => {
        const freshTicket = state.state?.tickets?.[ticketKey];
        if (!freshTicket) {
          panel.webview.html = withWebviewCsp(`<!DOCTYPE html><html><body><div class="kronos-empty">Ticket not found.</div></body></html>`);
          return;
        }
        panel.title = `${ticketKey}: ${freshTicket.summary}`;
        panel.webview.html = withWebviewCsp(buildTicketHtml(ticketKey, freshTicket, state, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
      };
      render();
      panel.webview.onDidReceiveMessage(async msg => {
        const request = normalizeActionPanelMessage(msg, TICKET_DETAIL_MESSAGE_COMMANDS);
        if (!request) {
          vscode.window.showWarningMessage('Ignored invalid Kronos ticket action.');
          return;
        }
        await executeTicketDetailAction(state, request.command, ticketKey);
        render();
      });
    }),

    vscode.commands.registerCommand('kronos.addEvidence', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for evidence.');
        return;
      }

      const kind = await vscode.window.showQuickPick(
        [
          { label: 'note', description: 'General implementation or review note' },
          { label: 'test', description: 'Verification command, result, or environment proof' },
          { label: 'risk', description: 'Known risk, gap, or follow-up to preserve' },
          { label: 'decision', description: 'Architecture or product decision made during work' },
        ],
        { placeHolder: `Evidence type for ${ticketKey}` }
      );
      if (!kind) { return; }

      const text = await vscode.window.showInputBox({
        prompt: `Evidence for ${ticketKey}`,
        placeHolder: 'e.g., npm test passed locally; Sonar gate is green; QA risk remains around OAuth timeout',
        ignoreFocusOut: true,
      });
      if (!text?.trim()) { return; }

      const evidenceKind = kind.label as 'note' | 'test' | 'risk' | 'decision';
      try {
        addTicketEvidenceNote(ticketKey, { kind: evidenceKind, text: text.trim() });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Added ${kind.label} evidence to ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add ticket evidence.'));
      }
    }),

    vscode.commands.registerCommand('kronos.addEvidenceCheck', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for evidence check.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: `Evidence check name for ${ticketKey}`,
        placeHolder: 'e.g., npm test, Jenkins build, Sonar gate, smoke checkout flow',
        ignoreFocusOut: true,
      });
      if (!name?.trim()) { return; }

      const result = await vscode.window.showQuickPick(
        [
          { label: 'pass', description: 'Check passed' },
          { label: 'warn', description: 'Check has caveats or partial coverage' },
          { label: 'fail', description: 'Check failed and should block handoff' },
          { label: 'unknown', description: 'Result is inconclusive' },
        ],
        { placeHolder: `Result for ${name.trim()}` }
      );
      if (!result) { return; }

      const environment = await vscode.window.showQuickPick(
        ['local', 'develop', 'test', 'prod', 'n/a'],
        { placeHolder: 'Environment for this check' }
      );
      if (!environment) { return; }

      const command = await vscode.window.showInputBox({
        prompt: 'Command or procedure used',
        placeHolder: 'e.g., npm test -- --runInBand; manual smoke through checkout retry',
        ignoreFocusOut: true,
      });
      if (command === undefined) { return; }

      const summary = await vscode.window.showInputBox({
        prompt: 'Short result summary',
        placeHolder: 'e.g., 214 tests passed; checkout retry returned 200 after timeout',
        ignoreFocusOut: true,
      });
      if (summary === undefined) { return; }

      const artifact = await vscode.window.showInputBox({
        prompt: 'Artifact path or URL (optional)',
        placeHolder: 'e.g., /tmp/kronos-checkout.log or https://jenkins/job/123',
        ignoreFocusOut: true,
      });
      if (artifact === undefined) { return; }

      const confidence = await vscode.window.showQuickPick(
        [
          { label: 'high', description: 'Directly proves the behavior' },
          { label: 'medium', description: 'Useful but partial coverage' },
          { label: 'low', description: 'Weak or indirect signal' },
        ],
        { placeHolder: 'Confidence level' }
      );
      if (!confidence) { return; }

      try {
        addTicketEvidenceCheck(ticketKey, {
          name: name.trim(),
          result: result.label as 'pass' | 'fail' | 'warn' | 'unknown',
          environment: environment === 'n/a' ? undefined : environment,
          command,
          summary,
          artifactPath: artifact,
          confidence: confidence.label as 'low' | 'medium' | 'high',
        });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Added ${result.label} evidence check to ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add evidence check.'));
      }
    }),

    vscode.commands.registerCommand('kronos.recordEnvironmentResult', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for environment result.');
        return;
      }

      const environment = await vscode.window.showQuickPick(
        ['local', 'develop', 'test', 'prod'],
        { placeHolder: `Environment result for ${ticketKey}` }
      );
      if (!environment) { return; }
      const status = await vscode.window.showQuickPick(
        [
          { label: 'pass', description: 'Environment check passed' },
          { label: 'warn', description: 'Environment check has caveats' },
          { label: 'fail', description: 'Environment check failed' },
          { label: 'unknown', description: 'Environment state is unknown' },
        ],
        { placeHolder: `Status for ${environment}` }
      );
      if (!status) { return; }
      const detail = await vscode.window.showInputBox({
        prompt: `${environment} result detail`,
        placeHolder: 'e.g., deployed build 123 passed smoke checkout retry',
        ignoreFocusOut: true,
      });
      if (!detail?.trim()) { return; }
      const artifact = await vscode.window.showInputBox({
        prompt: 'Artifact path or URL (optional)',
        placeHolder: 'e.g., Jenkins URL, screenshot, log path',
        ignoreFocusOut: true,
      });
      if (artifact === undefined) { return; }

      try {
        recordTicketEnvironmentResult(ticketKey, {
          environment,
          status: status.label as 'pass' | 'fail' | 'warn' | 'unknown',
          detail: detail.trim(),
          artifactPath: artifact,
        });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Recorded ${environment} ${status.label} result for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to record environment result.'));
      }
    }),

    vscode.commands.registerCommand('kronos.extractAcceptanceCriteria', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for acceptance criteria extraction.');
        return;
      }

      const existingCriteria = evidenceAcceptanceCriteria(ticket)
        .map(existingAcceptanceCriterion)
        .filter((criterion): criterion is ExistingAcceptanceCriterion => Boolean(criterion));
      const extracted = extractAcceptanceCriteria(ticket.description, existingCriteria);
      if (extracted.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} has no obvious acceptance criteria in its description.`);
        return;
      }

      const existingCount = existingCriteria.length;
      if (existingCount > 0) {
        const confirm = await vscode.window.showWarningMessage(
          `${ticketKey} already has ${existingCount} acceptance criterion item(s). Replace with ${extracted.length} extracted item(s)? Existing checked state is preserved when text matches.`,
          'Replace',
          'Cancel'
        );
        if (confirm !== 'Replace') { return; }
      }

      try {
        replaceTicketAcceptanceCriteria(ticketKey, extracted);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Extracted ${extracted.length} acceptance criterion item(s) for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to extract acceptance criteria.'));
      }
    }),

    vscode.commands.registerCommand('kronos.updateAcceptanceCriteria', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for acceptance criteria update.');
        return;
      }
      const criteria = evidenceAcceptanceCriteria(ticket)
        .filter(criterion => evidenceString(criterion, 'id').length > 0 && evidenceString(criterion, 'text').length > 0);
      if (criteria.length === 0) {
        const action = await vscode.window.showWarningMessage(
          `${ticketKey} has no extracted acceptance criteria.`,
          'Extract',
          'Cancel'
        );
        if (action === 'Extract') {
          await vscode.commands.executeCommand('kronos.extractAcceptanceCriteria', { ticketKey });
        }
        return;
      }

      const picked = await vscode.window.showQuickPick(
        criteria.map(criterion => ({
          label: evidenceString(criterion, 'text'),
          description: evidenceChecked(criterion) ? 'checked' : 'unchecked',
          detail: evidenceString(criterion, 'id'),
          picked: evidenceChecked(criterion),
          criterionId: evidenceString(criterion, 'id'),
        })),
        { canPickMany: true, placeHolder: `Checked acceptance criteria for ${ticketKey}` }
      );
      if (!picked) { return; }

      try {
        updateTicketAcceptanceCriteria(ticketKey, picked.map(item => item.criterionId));
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Updated ${picked.length}/${criteria.length} checked acceptance criterion item(s) for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update acceptance criteria.'));
      }
    }),

    vscode.commands.registerCommand('kronos.evidenceGate', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (ticketKey && state.state?.tickets?.[ticketKey]) {
        openEvidenceGatePanel(state, [evaluateEvidenceGate(ticketKey, state.state.tickets[ticketKey])], `Evidence Gate: ${ticketKey}`);
        return;
      }
      if (!state.state) {
        vscode.window.showWarningMessage('No Kronos state loaded.');
        return;
      }
      openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true });
    }),

    vscode.commands.registerCommand('kronos.exportEvidence', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence export.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      await vscode.env.clipboard.writeText(exported.comment);
      const actions = ['Open Export'];
      if (ticket.jira_url) { actions.push('Open Jira'); }
      if (ticket.mr?.url) { actions.push('Open MR'); }
      const action = await vscode.window.showInformationMessage(
        `Exported evidence for ${ticketKey} and copied comment text.`,
        ...actions
      );
      if (action === 'Open Export') {
        await openTextFileIfExists(exported.filePath, 'Evidence export not found.');
      } else if (action === 'Open Jira' && ticket.jira_url) {
        openExternalHttpUrl(ticket.jira_url);
      } else if (action === 'Open MR' && ticket.mr?.url) {
        openExternalHttpUrl(ticket.mr.url);
      }
    }),

    vscode.commands.registerCommand('kronos.evidenceHandoff', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence handoff.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      const plan = buildEvidenceHandoffPlan(ticketKey, ticket, exported);
      await vscode.env.clipboard.writeText(plan.comment);
      openEvidenceHandoffPanel(plan);
      vscode.window.showInformationMessage(`Prepared evidence handoff for ${ticketKey} and copied comment text.`);
    }),

    vscode.commands.registerCommand('kronos.publishEvidence', async (treeItem: any) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence publishing.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      const plan = buildEvidencePublishPlan(ticketKey, ticket, exported.comment);
      const ready = readyPublishDestinations(plan);
      if (ready.length === 0) {
        openEvidencePublishPanel(plan.destinations.map(destination => ({
          kind: destination.kind,
          label: destination.label,
          status: destination.status,
          detail: destination.detail,
          endpoint: destination.endpoint,
        })), ticketKey);
        vscode.window.showWarningMessage(`No evidence publish destinations are ready for ${ticketKey}. Use Evidence Handoff for manual posting.`);
        return;
      }

      const selected = await vscode.window.showQuickPick(
        ready.map(destination => ({
          label: destination.label,
          description: destination.endpoint,
          detail: destination.detail,
          destination,
          picked: true,
        })),
        { placeHolder: `Publish evidence for ${ticketKey}`, canPickMany: true }
      );
      if (!selected || selected.length === 0) { return; }

      const canPublish = await confirmSafetyGate({
        command: 'kronos.publishEvidence',
        title: 'Publish Evidence Comment',
        target: ticketKey,
        risks: ['external-publish'],
        changes: selected.map(item => `Post the generated evidence comment to ${item.destination.label}.`),
        warnings: [
          'Review the generated evidence artifact before publishing. Kronos will not print credential values.',
          `Evidence markdown remains saved at ${exported.filePath}.`,
        ],
        confirmationLabel: 'Publish Evidence',
      });
      if (!canPublish) { return; }

      try {
        const results = await publishEvidencePlan(plan, selected.map(item => item.destination.kind));
        openEvidencePublishPanel(results, ticketKey);
        const posted = results.filter(result => result.status === 'posted').length;
        const failed = results.filter(result => result.status === 'failed').length;
        vscode.window.showInformationMessage(`Evidence publish complete for ${ticketKey}: ${posted} posted, ${failed} failed.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to publish evidence.'));
      }
    }),

    vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: any) => {
      const ticketKey = treeItem?.ticketKey;
      if (!ticketKey) { return; }
      try {
        const data = addTicketToQueue(ticketKey);
        state.reloadAndNotify();
        if (data.alreadyInQueue) {
          vscode.window.showInformationMessage(`${ticketKey} is already in the queue.`);
        } else if (data.added) {
          vscode.window.showInformationMessage(`Added ${ticketKey} to queue.`);
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add to queue.'));
      }
    }),

    vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: any) => {
      const ticketKey = (treeItem?.item || treeItem)?.ticket;
      if (!ticketKey) { return; }
      await removeTicketFromQueue(state, ticketKey, true);
    }),

    vscode.commands.registerCommand('kronos.removeProject', async (item: any) => {
      const name = item?.projectName;
      if (!name) { return; }
      const canRemove = await confirmSafetyGate({
        command: 'kronos.removeProject',
        title: 'Remove Project',
        target: name,
        risks: ['state-write'],
        changes: [
          `Unregister ${name} from Kronos state.`,
          'Move the project back to discovered repositories.',
        ],
        confirmationLabel: 'Remove',
      });
      if (!canRemove) { return; }
      try {
        const result = removeProjectFromState(name);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Removed ${name}. Unlinked ${result.ticketsUnlinked.length} ticket(s) and kept it in discovered repos.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, `Failed to remove ${name}.`));
      }
    }),

    vscode.commands.registerCommand('kronos.registerDiscovered', async (projectPath: string) => {
      if (projectPath) {
        try {
          await state.register(projectPath);
          const projectName = projectPath.split(/[\\/]/).pop() || '';
          vscode.window.showInformationMessage(`Registered: ${projectName}`);

          const setup = await vscode.window.showInformationMessage(
            `Set up ${projectName}? This will generate CLAUDE.md and find GitLab/SonarQube config.`,
            'Set Up', 'Skip'
          );
          if (setup === 'Set Up') {
            // Resolve and write project config from the extension side; agent sessions cannot write .claude/.
            let gitlabId: number | null = null;
            let sonarKey: string | null = null;
            try {
              const gitlabPath = originProjectPath(projectPath);
              try {
                gitlabId = await gitlabAdapter.projectId(gitlabPath);
              } catch (e: unknown) {
                vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not resolve GitLab project ID.'));
              }
              try {
                sonarKey = await sonarAdapter.projectKey(projectName);
              } catch (e: unknown) {
                vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not resolve SonarQube project key.'));
              }
            } catch {}

            const profile = getActiveProfile();
            writeProjectSetupConfig({
              projectPath,
              projectName,
              gitlabProjectId: gitlabId,
              sonarProjectKey: sonarKey,
              defaultBranch: profile.defaultBaseBranch,
            });

            // Also update Kronos state so MR polling works immediately
            try {
              const updates = setProjectIntegrationConfig(projectName, {
                gitlabProjectId: gitlabId,
                sonarProjectKey: sonarKey,
                defaultBranch: profile.defaultBaseBranch,
              });
              if (updates.length > 0) {
                state.reloadAndNotify();
              }
            } catch {}

            const setupPrompt = `Set up project ${projectName} at ${projectPath}. Do these things:

1. Read the pom.xml for artifactId, groupId, parent, dependencies, build profiles
2. Read src/main/resources/application*.yml for datasources, ports, profiles
3. Check for existing CLAUDE.md — update it, or create one if missing
4. The CLAUDE.md should document: build commands (including gen profiles), run commands (profiles, port), mock server (if any), API endpoints, test data files, SonarQube config
5. Do NOT touch .claude/project.json — it has already been configured with gitlab_project_id=${gitlabId} and sonar_project_key=${sonarKey}
6. Report what was set up`;

            await startClaudeDispatch(projectPath, 'init-project', undefined, {
              onComplete: refreshAfterDispatch(state, projectName),
              customPrompt: setupPrompt,
              noWorktree: true,
            });
          }
        } catch {
          vscode.window.showErrorMessage('Failed to register project.');
        }
      }
    }),

    vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: any) => {
      const queueData = treeItemOrData?.item || treeItemOrData;
      if (!queueData || !queueData.action) { return; }

      const projs: string[] = queueData.projects || [];
      const projLabel = projs.join(', ') || 'unlinked';

      if (queueData.action === 'refresh') {
        for (const p of projs) { await state.refresh(p); }
        vscode.window.showInformationMessage(`Refreshed ${projLabel}.`);
        return;
      }

      const actionLabel = queueData.action.replace(/_/g, ' ');
      const extra = await vscode.window.showInputBox({
        prompt: `Starting [${actionLabel}] on ${projLabel}/${queueData.ticket || ''}. Any additional context? (leave empty to just start)`,
        placeHolder: 'e.g., focus on the auth flow, skip UI changes',
      });
      if (extra === undefined) { return; }

      const skill = skillForAction(queueData.action);
      const isCodeAction = ['implement', 'in_progress', 'fix_build'].includes(queueData.action);
      const extraPrompt = extra ? `\n\nADDITIONAL CONTEXT FROM USER: ${extra}` : '';

      if (projs.length === 0) {
        vscode.window.showWarningMessage(`${queueData.ticket} is not linked to any project.`);
        return;
      }

      const canStart = await confirmDispatchCollisions(state, {
        ticketKey: queueData.ticket,
        projects: projs,
        action: queueData.action,
        excludeQueueItemId: queueData.id,
      });
      if (!canStart) { return; }

      for (const projName of projs) {
        const projectPath = getProjectPath(state, projName);
        if (!projectPath) { continue; }
        const otherProjects = projs.filter(p => p !== projName);
        const scopeHint = otherProjects.length > 0 ? `\nYou are working in ${projName}. Focus ONLY on this codebase. Other projects: ${otherProjects.join(', ')}.` : '';
        await startClaudeDispatch(projectPath, skill, queueData.ticket, {
          onComplete: refreshAfterDispatch(state, projName, queueData.ticket),
          parallel: isCodeAction,
          appendSystemPrompt: isCodeAction ? getImplementPrompt(state) + scopeHint + extraPrompt : extraPrompt || undefined,
        });
      }
    }),

    vscode.commands.registerCommand('kronos.openDashboard', async () => {
      try {
        const panel = vscode.window.createWebviewPanel(
          'kronosDashboard',
          'Kronos Dashboard',
          vscode.ViewColumn.One,
          { enableScripts: true }
        );
        const nonce = createWebviewNonce();
        const render = async () => {
          const data = await state.morningBrief();
          panel.webview.html = withWebviewCsp(buildDashboardHtml(state, data, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
        };
        await render();
        panel.webview.onDidReceiveMessage(async msg => {
          const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);
          if (!request) {
            vscode.window.showWarningMessage('Ignored invalid Kronos dashboard action.');
            return;
          }
          if (request.command === 'refreshPanel') {
            state.reloadAndNotify();
            await render();
            return;
          }
          await executeDashboardAction(request.command);
          await render();
        });
      } catch {
        vscode.window.showErrorMessage('Failed to generate dashboard.');
      }
    }),

    vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: any) => {
      const idx = treeItem?.index;
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'up');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: any) => {
      const idx = treeItem?.index;
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'down');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: any) => {
      const idx = treeItem?.index;
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'top');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: any) => {
      const ticketKey = treeItem?.ticketKey;
      if (!ticketKey) {
        const mr = treeItem?.ticket?.mr;
        if (mr?.url) { openExternalHttpUrl(mr.url); }
        return;
      }
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading diff for ${ticketKey}...` },
        async () => {
          try {
            const data = await gitlabAdapter.mergeRequestDiff(state, ticketKey);
            const panel = vscode.window.createWebviewPanel(
              'kronosMrDiff', `MR: ${data.mr.title}`,
              vscode.ViewColumn.One, { enableScripts: false }
            );
            panel.webview.html = withWebviewCsp(buildDiffHtml(data));
          } catch {
            vscode.window.showErrorMessage('Failed to load MR diff.');
          }
        },
        'Failed to open merge request diff.'
      );
    }),

    vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: any) => {
      const ticketKey = treeItem?.ticketKey;
      if (!ticketKey || !state.state) {
        vscode.window.showErrorMessage('No ticket selected.');
        return;
      }
      const ticket = state.state.tickets[ticketKey];
      const projs = ticket?.projects || [];
      let projectName: string;
      if (projs.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} is not linked to any project.`);
        return;
      } else if (projs.length === 1) {
        projectName = projs[0];
      } else {
        const pick = await vscode.window.showQuickPick(projs.map(p => ({ label: p })), { placeHolder: `Verify ${ticketKey} in which project?` });
        if (!pick) { return; }
        projectName = pick.label;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const confirm = await vscode.window.showInformationMessage(
        `Verify ${ticketKey} locally? Will build, start app, replay the defect, and compare local vs test env.`,
        'Verify', 'Cancel'
      );
      if (confirm !== 'Verify') { return; }

      const verifyPrompt = loadPromptForDispatch(state, 'verify-local', { TICKET_KEY: ticketKey }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-local', ticketKey, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: verifyPrompt.text,
        promptMetadata: verifyPrompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.sonarScan', async (item: any) => {
      const projectName = resolveProjectName(state, item);
      if (!projectName || !state.state) {
        vscode.window.showWarningMessage('No project found for scan.');
        return;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;
      const baseBranch = getProjectBaseBranch(state, projectName);

      const mode = await vscode.window.showQuickPick(
        [
          { label: `New scan (${baseBranch})`, description: `Checkout ${baseBranch}, pull latest, scan`, value: 'new' },
          { label: 'Pull latest & rescan', description: 'Pull latest on current branch, rescan', value: 'pull' },
        ],
        { placeHolder: 'SonarQube scan mode' }
      );
      if (!mode) { return; }

      const branch = mode.value === 'new' ? (item?.branch || baseBranch) : '';
      const scanPrompt = loadPromptForDispatch(state, 'sonar-scan', { PROJECT_NAME: projectName, SONAR_KEY: sonarKey, BRANCH: branch }, projectPath);

      await startClaudeDispatch(projectPath, 'sonar-scan', undefined, {
        onComplete: async (code: number, run: KronosRun) => {
          await refreshAfterDispatch(state, projectName)(code, run);
          const action = await vscode.window.showInformationMessage(
            `SonarQube scan complete for ${projectName}.`,
            'View Report', 'Dismiss'
          );
          if (action === 'View Report') {
            vscode.commands.executeCommand('kronos.sonarReport', { projectName });
          }
        },
        customPrompt: scanPrompt.text,
        promptMetadata: scanPrompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.sonarReport', async (item: any) => {
      const projectName = resolveProjectName(state, item);
      if (!projectName || !state.state) {
        vscode.window.showWarningMessage('No project found.');
        return;
      }
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;
      const baseBranch = getProjectBaseBranch(state, projectName);

      let branchItems: vscode.QuickPickItem[] = [];
      try {
        const branchesData = await sonarAdapter.branches(sonarKey);
        const branches = branchesData.branches;
        branchItems = branches.map(b => ({
          label: b.name,
          description: `${b.isMain ? '(main) ' : ''}${b.status?.qualityGateStatus || ''}`,
        }));
      } catch {
        branchItems = [{ label: baseBranch, description: '(default)' }];
      }
      if (branchItems.length === 0) {
        branchItems = [{ label: baseBranch, description: '(default)' }];
      }

      const picked = await vscode.window.showQuickPick(branchItems, { placeHolder: 'Select branch' });
      if (!picked) { return; }
      const branch = picked.label;

      try {
        const [gate, measures, issues] = await Promise.all([
          sonarAdapter.gate(sonarKey, branch),
          sonarAdapter.measures(sonarKey, branch),
          sonarAdapter.issues(sonarKey, branch),
        ]);
        const nonce = createWebviewNonce();
        const report = buildSonarReport({
          projectName,
          branch,
          sonarKey,
          host: process.env.SONAR_HOST_URL,
          gate,
          measures,
          issues,
          nonce,
        });
        const panel = vscode.window.createWebviewPanel('sonarReport', `Sonar: ${projectName}`, vscode.ViewColumn.One, { enableScripts: true });
        panel.webview.html = withWebviewCsp(report.html, webviewScriptCspOptions(panel.webview.cspSource, nonce));

        const sonarCommands = new Set(['fixSonar', 'openSonar']);
        panel.webview.onDidReceiveMessage(async (msg: unknown) => {
          const command = normalizeWebviewCommand(msg, sonarCommands);
          if (command === 'fixSonar') {
            panel.dispose();
            vscode.commands.executeCommand('kronos.fixSonarIssues', { projectName, sourceBranch: branch, issuesData: report.issueList });
          } else if (command === 'openSonar' && report.dashboardUrl) {
            openExternalHttpUrl(report.dashboardUrl);
          }
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to fetch SonarQube report.'));
      }
    }),

    vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: any) => {
      const projectName = resolveProjectName(state, item);
      if (!projectName || !state.state) {
        vscode.window.showWarningMessage('No project found.');
        return;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;

      const customInstructions = await vscode.window.showInputBox({
        placeHolder: 'e.g. suppress S107 on PasProviderValidationServiceImpl, skip S1192',
        prompt: 'Custom instructions: "suppress" = add @SuppressWarnings, "skip" = don\'t touch, blank = fix all',
      });
      if (customInstructions === undefined) { return; }

      const commandArg = recordFromUnknown(item);
      const sourceBranch = typeof commandArg.sourceBranch === 'string' ? commandArg.sourceBranch : '';
      const isProtected = !sourceBranch || sourceBranch === 'develop' || sourceBranch === 'main' || sourceBranch === 'master';
      const branchStrategy = isProtected
        ? `You are fixing issues from the ${sourceBranch || 'develop'} branch. Create a NEW branch: bugfix/sonar-${projectName.toLowerCase()} from ${sourceBranch || 'develop'}. After fixing and pushing, create a GitLab MR from your branch into ${sourceBranch || 'develop'} using: python ~/.claude/scripts/gitlab_api.py --create-mr`
        : `You are fixing issues on branch ${sourceBranch}. Stay on this branch — push directly, it already has an open MR.`;

      // Format pre-fetched issues if available
      let issuesBlock = '';
      const issuesData = normalizeSonarIssueCommandList(commandArg.issuesData);
      if (issuesData.length > 0) {
        const lines = issuesData.map(formatSonarIssuePromptLine);
        issuesBlock = `KNOWN ISSUES (already fetched — do NOT re-query SonarQube for the issue list):\n${lines.join('\n')}`;
      }

      const instructionBlock = [
        customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${customInstructions}` : '',
        `BRANCH STRATEGY:\n${branchStrategy}`,
        issuesBlock,
      ].filter(Boolean).join('\n\n');

      const canFix = await confirmSafetyGate({
        command: 'kronos.fixSonarIssues',
        title: 'Fix SonarQube Issues',
        target: `${projectName}${sourceBranch ? ` / ${sourceBranch}` : ''}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          isProtected
            ? `Create a new bugfix/sonar-${projectName.toLowerCase()} branch from ${sourceBranch || 'develop'}.`
            : `Modify the existing source branch ${sourceBranch}.`,
          'Apply source changes for SonarQube findings.',
          'May push changes and create or update a merge request through the agent prompt.',
        ],
        warnings: customInstructions ? ['Custom Sonar instructions will be passed to the agent.'] : undefined,
        confirmationLabel: 'Fix Sonar',
      });
      if (!canFix) { return; }

      const fixPrompt = loadPromptForDispatch(state, 'sonar-fix', { PROJECT_NAME: projectName, SONAR_KEY: sonarKey, CUSTOM_INSTRUCTIONS: instructionBlock }, projectPath);

      await startClaudeDispatch(projectPath, 'fix-sonar', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: fixPrompt.text,
        promptMetadata: fixPrompt.metadata,
        noWorktree: true,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.sonarCombined', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length === 0) {
        vscode.window.showInformationMessage('No open review MRs to fix.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Fix sonar issues in which project?', 'branches');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;

      const branchList = tickets.map(t => t.key).join(', ');
      const canFixAll = await confirmSafetyGate({
        command: 'kronos.sonarCombined',
        title: 'Fix SonarQube on Review Branches',
        target: `${projectName}: ${branchList}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          `Dispatch Sonar fix agents for ${tickets.length} review branch(es).`,
          'Agents may edit source files, push branch updates, and update merge requests.',
        ],
        confirmationLabel: 'Fix All',
      });
      if (!canFixAll) { return; }

      const customInstructions = await vscode.window.showInputBox({
        placeHolder: 'e.g. suppress S107 on PasProviderValidationServiceImpl, skip S1192',
        prompt: 'Custom instructions: "suppress" = add @SuppressWarnings, "skip" = don\'t touch, blank = fix all',
      });
      if (customInstructions === undefined) { return; }
      const instructionBlock = customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${customInstructions}` : '';

      for (const ticket of tickets) {
        // Find the remote branch for this ticket's MR
        let remoteBranch = '';
        if (ticket.mr?.url) {
          try {
            const branch = await gitlabAdapter.mergeRequestBranch(state, ticket.key);
            if (branch) { remoteBranch = `origin/${branch}`; }
          } catch {}
        }
        if (!remoteBranch) {
          try {
            const first = firstRemoteBranchMatching(projectPath, `*${ticket.key}*`);
            if (first) { remoteBranch = first; }
          } catch {}
        }

        const prompt = loadPromptForDispatch(state, 'sonar-fix-branch', { SONAR_KEY: sonarKey, TICKET_KEY: ticket.key, CUSTOM_INSTRUCTIONS: instructionBlock }, projectPath);

        await startClaudeDispatch(projectPath, 'sonar-fix', ticket.key, {
          onComplete: refreshAfterDispatch(state, projectName, ticket.key),
          customPrompt: prompt.text,
          promptMetadata: prompt.metadata,
          parallel: true,
          worktreeBranch: remoteBranch || undefined,
        });
      }
    }),

    vscode.commands.registerCommand('kronos.fixFinding', async (args: any) => {
      const projectName = args?.projectName;
      const projectPath = args?.projectPath || getProjectPath(state, projectName);
      if (!projectPath || !projectName) {
        vscode.window.showWarningMessage('No project specified.');
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'Describe the finding to fix (or leave empty to fix all findings from the last verification)',
        placeHolder: 'e.g., missing routing_cache_v2.sql migration file for EDIPVR-3322',
      });
      if (description === undefined) { return; }

      const findingDesc = description || 'Fix all CRITICAL and FAIL findings from the last develop verification. Read the session history or git log to find what was flagged.';

      const canFix = await confirmSafetyGate({
        command: 'kronos.fixFinding',
        title: 'Fix Verification Finding',
        target: projectName,
        risks: ['repo-write'],
        changes: [
          'Dispatch an agent in the project workspace.',
          'Allow source edits needed to address the verification finding.',
        ],
        warnings: description ? undefined : ['Blank finding text asks the agent to infer all critical/failing findings from prior context.'],
        confirmationLabel: 'Fix Finding',
      });
      if (!canFix) { return; }

      const prompt = loadPromptForDispatch(state, 'fix-finding', { FINDING_DESC: findingDesc }, projectPath);

      await startClaudeDispatch(projectPath, 'fix-finding', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
        noWorktree: true,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.verifyDevelop', async (item: any) => {
      let projectName = item?.projectName;
      if (!projectName || !state.state) {
        const projects = Object.keys(state.state?.projects || {});
        if (projects.length === 1) { projectName = projects[0]; }
        else {
          const pick = await vscode.window.showQuickPick(projects.map(p => ({ label: p })), { placeHolder: 'Verify develop for which project?' });
          if (!pick) { return; }
          projectName = pick.label;
        }
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const reviewTickets = Object.entries(state.state?.tickets || {})
        .filter(([_, t]) => t.mr && t.mr.state === 'merged' && t.projects.includes(projectName))
        .map(([k]) => k);
      const tickets = reviewTickets;
      if (tickets.length === 0) {
        vscode.window.showInformationMessage('No merged tickets found for this project.');
        return;
      }
      const ticketList = tickets.join(', ');

      const canVerify = await confirmSafetyGate({
        command: 'kronos.verifyDevelop',
        title: 'Verify Develop',
        target: `${projectName}: ${ticketList}`,
        risks: ['repo-write'],
        changes: [
          'Dispatch an agent in the project workspace.',
          'Run develop verification for merged tickets.',
          'May create local artifacts or follow-up findings.',
        ],
        confirmationLabel: 'Verify Develop',
      });
      if (!canVerify) { return; }

      const prompt = loadPromptForDispatch(state, 'verify-develop', { PROJECT_NAME: projectName, TICKET_LIST: ticketList }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-develop', undefined, {
        onComplete: async (code: number, run: KronosRun) => {
          await refreshAfterDispatch(state, projectName)(code, run);
          const action = await vscode.window.showInformationMessage(
            `Develop verification complete for ${projectName}. Fix any findings?`,
            'Fix Findings', 'Dismiss'
          );
          if (action === 'Fix Findings') {
            vscode.commands.executeCommand('kronos.fixFinding', { projectName, projectPath, tickets: ticketList });
          }
        },
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.verifyTest', async () => {
      if (!state.state) { return; }

      const mergedTickets = Object.entries(state.state.tickets)
        .filter(([_, t]) => t.mr && t.mr.state === 'merged')
        .map(([k, t]) => ({ key: k, summary: t.summary, projects: t.projects }));
      if (mergedTickets.length === 0) {
        vscode.window.showInformationMessage('No merged tickets to verify in TEST.');
        return;
      }

      const picked = await pickProjectFromTickets(state, mergedTickets, 'Verify TEST for which project?', 'merged tickets');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const ticketList = tickets.map(t => t.key).join(', ');

      const canVerify = await confirmSafetyGate({
        command: 'kronos.verifyTest',
        title: 'Verify TEST',
        target: `${projectName}: ${ticketList}`,
        risks: ['repo-write'],
        changes: [
          `Dispatch TEST verification for ${tickets.length} merged ticket(s).`,
          'May start local tooling and write verification artifacts.',
        ],
        confirmationLabel: 'Verify',
      });
      if (!canVerify) { return; }

      const prompt = loadPromptForDispatch(state, 'verify-test', { PROJECT_NAME: projectName, TICKET_LIST: ticketList }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-test', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.resolveConflicts', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length < 2) {
        vscode.window.showInformationMessage('Need at least 2 open review MRs to resolve conflicts.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Resolve conflicts in which project?', 'branches');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;

      const ordered = await vscode.window.showQuickPick(
        tickets.map(t => ({ label: t.key, description: t.summary, picked: true })),
        { canPickMany: true, placeHolder: 'Select branches in MERGE ORDER (first = merge first, last = merge last)' }
      );
      if (!ordered || ordered.length < 2) { return; }

      const mergeOrder = ordered.map(o => o.label);
      const branchLookups = await Promise.all(mergeOrder.map(async k => {
        try {
          const branch = await gitlabAdapter.mergeRequestBranch(state, k);
          return { key: k, branch };
        } catch { return { key: k, branch: k }; }
      }));

      const branchOrder = branchLookups.map((b, i) => `${i + 1}. ${b.key} (branch: ${b.branch})`).join('\n');
      const canResolve = await confirmSafetyGate({
        command: 'kronos.resolveConflicts',
        title: 'Resolve Merge Conflicts',
        target: `${projectName}: ${mergeOrder.join(', ')}`,
        risks: ['branch-switch', 'repo-write'],
        changes: [
          'Dispatch an agent to merge review branches in the selected order.',
          'Allow conflict-resolution source edits in the project workspace.',
        ],
        warnings: ['Branch order affects conflict resolution and final combined state.'],
        confirmationLabel: 'Resolve Conflicts',
      });
      if (!canResolve) { return; }
      const prompt = loadPromptForDispatch(state, 'resolve-conflicts', { BRANCH_ORDER: branchOrder }, projectPath);

      await startClaudeDispatch(projectPath, 'resolve-conflicts', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.verifyCombined', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length === 0) {
        vscode.window.showInformationMessage('No open review MRs to verify.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Verify combined changes in which project?', 'MRs');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const branchPlans = buildCombinedVerificationPlan(tickets);

      const branchList = branchPlans.map(plan => `${plan.ticketKey} (${plan.branch}, MR ${plan.mrIid ? `!${plan.mrIid}` : '?'})`).join(', ');
      const canVerify = await confirmSafetyGate({
        command: 'kronos.verifyCombined',
        title: 'Verify Combined MRs',
        target: `${projectName}: ${branchList}`,
        risks: ['branch-switch', 'repo-write'],
        changes: [
          `Merge ${tickets.length} review branch(es) into a combined local state.`,
          'Run combined verification in the project workspace.',
        ],
        warnings: ['Local merge conflicts may require manual recovery if the agent cannot resolve them.'],
        confirmationLabel: 'Verify',
      });
      if (!canVerify) { return; }

      const promptVars = buildCombinedVerificationPromptVars(branchPlans);

      const combinedPrompt = loadPromptForDispatch(state, 'verify-combined', {
        TICKET_KEYS: promptVars.ticketKeys,
        MERGE_COMMANDS: promptVars.mergeCommands,
        BRANCH_TABLE: promptVars.branchTable
      }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-combined', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: combinedPrompt.text,
        promptMetadata: combinedPrompt.metadata,
        noWorktree: true,
      });
    }),

    vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: any) => {
      const ticketKey = treeItem?.ticketKey;
      if (!ticketKey || !state.state) { return; }
      const ticket = state.state.tickets[ticketKey];
      const projs = ticket?.projects || [];
      let projectName: string;
      if (projs.length === 0) { return; }
      else if (projs.length === 1) { projectName = projs[0]; }
      else {
        const pick = await vscode.window.showQuickPick(projs.map(p => ({ label: p })), { placeHolder: `Send back ${ticketKey} to which project?` });
        if (!pick) { return; }
        projectName = pick.label;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const feedback = await vscode.window.showInputBox({
        prompt: `What's missing or wrong with ${ticketKey}? (Claude will continue on the existing branch)`,
        placeHolder: 'e.g., missing migration file, service layer not updated, AC #1 and #5 not met',
      });
      if (!feedback) { return; }

      const branch = ticket?.mr ? `${ticketKey}` : undefined;
      const canContinue = await confirmSafetyGate({
        command: 'kronos.rejectReview',
        title: 'Send Review Back to Agent',
        target: `${ticketKey} / ${projectName}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          'Dispatch an implementation agent on the existing review branch.',
          'Apply source changes based on the supplied feedback.',
          'May push branch updates through the agent prompt.',
        ],
        confirmationLabel: 'Continue Work',
      });
      if (!canContinue) { return; }

      const continuePrompt = loadPromptForDispatch(state, 'continue-work', { TICKET_KEY: ticketKey, BRANCH: branch || ticketKey, FEEDBACK: feedback }, projectPath);

      await startClaudeDispatch(projectPath, 'implement', ticketKey, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: continuePrompt.text,
        promptMetadata: continuePrompt.metadata,
        noWorktree: true,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: any) => {
      const orphanKey = treeItem?.ticketKey;
      if (!orphanKey || !state.state) { return; }
      const orphan = state.state.tickets[orphanKey];
      if (!orphan?.mr) { return; }

      const ticketKey = await vscode.window.showInputBox({
        prompt: `Link MR !${orphan.mr.iid} to which Jira ticket?`,
        placeHolder: 'e.g. EDIPVR-3413',
      });
      if (!ticketKey) { return; }

      let preview;
      try {
        preview = previewLinkMergeRequestToTicket(state.state, {
          orphanKey,
          targetTicketKey: ticketKey,
          jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://bcbsma.atlassian.net',
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to preview merge request link.'));
        return;
      }

      let allowReviewHandoffWithWarnings = false;
      if (preview.reviewReady) {
        const handoffDecision = decideEvidenceHandoff(ticketKey, preview.ticket);
        const evidenceTicketKey = state.state.tickets[ticketKey] ? ticketKey : orphanKey;
        if (!handoffDecision.allowed) {
          const action = await vscode.window.showWarningMessage(
            handoffDecision.message,
            'Open Gate',
            'Add Evidence',
            'Cancel'
          );
          if (action === 'Open Gate') {
            openEvidenceGatePanel(state, [handoffDecision.gate], `Evidence Gate: ${ticketKey}`);
          } else if (action === 'Add Evidence') {
            await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: evidenceTicketKey });
          }
          return;
        }
        if (handoffDecision.requiresConfirmation) {
          const action = await vscode.window.showWarningMessage(
            handoffDecision.message,
            'Continue Handoff',
            'Open Gate',
            'Cancel'
          );
          if (action === 'Open Gate') {
            openEvidenceGatePanel(state, [handoffDecision.gate], `Evidence Gate: ${ticketKey}`);
            return;
          }
          if (action !== 'Continue Handoff') { return; }
          allowReviewHandoffWithWarnings = true;
        }
      }

      const canLink = await confirmSafetyGate({
        command: 'kronos.linkMrToTicket',
        title: 'Link Merge Request to Ticket',
        target: `${orphanKey} -> ${ticketKey}`,
        risks: ['state-write'],
        changes: [
          `Attach MR !${orphan.mr.iid} to ${ticketKey}.`,
          preview.reviewReady ? 'Mark the ticket as review-ready only after the evidence gate check.' : 'Keep the ticket out of review-ready handoff state.',
          orphanKey !== ticketKey ? `Remove orphan ticket entry ${orphanKey}.` : `Update ${ticketKey} in place.`,
        ],
        confirmationLabel: 'Link MR',
      });
      if (!canLink) { return; }

      try {
        linkMergeRequestToTicket({
          orphanKey,
          targetTicketKey: ticketKey,
          jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://bcbsma.atlassian.net',
          allowReviewHandoffWithWarnings,
        });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Linked MR !${orphan.mr.iid} → ${ticketKey}`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to link merge request to ticket.'));
      }
    }),

    vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: any) => {
      const mr = treeItem?.ticket?.mr;
      if (mr?.url) {
        openExternalHttpUrl(mr.url);
      }
    }),

    vscode.commands.registerCommand('kronos.overnightStart', () => {
      vscode.window.showInformationMessage('Overnight engine — use /kronos overnight start from a Claude session.');
    }),

    vscode.commands.registerCommand('kronos.overnightStop', () => {
      vscode.window.showInformationMessage('Overnight engine — use /kronos overnight stop from a Claude session.');
    }),

    vscode.commands.registerCommand('kronos.setup', async () => {
      await runSetupWizard();
    }),

    vscode.commands.registerCommand('kronos.settings', async () => {
      await runSettingsMenu(state);
    }),

    vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: any) => {
      const ticketKey = typeof ticketKeyOrItem === 'string' ? ticketKeyOrItem : ticketKeyOrItem?.ticketKey;
      if (!ticketKey || !state.state) { return; }
      const allProjects = Object.keys(state.state.projects);
      if (allProjects.length === 0) {
        vscode.window.showWarningMessage('No projects registered.');
        return;
      }
      const current = state.state.tickets[ticketKey]?.projects || [];
      const picks = await vscode.window.showQuickPick(
        allProjects.map(p => ({ label: p, picked: current.includes(p), description: current.includes(p) ? 'linked' : '' })),
        { canPickMany: true, placeHolder: `Select projects for ${ticketKey} (toggle on/off)` }
      );
      if (!picks) { return; }
      const selected = picks.map(p => p.label);
      try {
        for (const p of selected) {
          if (!current.includes(p)) { linkTicketToProject(ticketKey, p); }
        }
        for (const p of current) {
          if (!selected.includes(p)) { unlinkTicketFromProject(ticketKey, p); }
        }
        state.reloadAndNotify();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update ticket project links.'));
      }
    }),

    vscode.commands.registerCommand('kronos.unlinkTicket', async (item: any) => {
      const ticketKey = item?.ticketKey;
      const projectName = item?.linkedProject;
      if (ticketKey && projectName) {
        const canUnlink = await confirmSafetyGate({
          command: 'kronos.unlinkTicket',
          title: 'Unlink Ticket from Project',
          target: `${ticketKey} / ${projectName}`,
          risks: ['state-write'],
          changes: [
            `Remove ${projectName} from ${ticketKey}'s linked projects.`,
            'Leave Jira, MR, and repository data untouched.',
          ],
          confirmationLabel: 'Unlink',
        });
        if (!canUnlink) { return; }
        try {
          unlinkTicketFromProject(ticketKey, projectName);
          state.reloadAndNotify();
        } catch (e: unknown) {
          vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to unlink ticket.'));
        }
      }
    }),

    vscode.commands.registerCommand('kronos.sessionHistory', async () => {
      const sessions = listSavedSessions();
      const issues = listSessionStoreIssues();
      if (sessions.length === 0) {
        if (issues.length > 0) {
          vscode.window.showWarningMessage(`No readable saved sessions. Kronos found ${issues.length} saved session store issue(s). Run Kronos: Doctor.`);
        } else {
          vscode.window.showInformationMessage('No saved sessions yet.');
        }
        return;
      }
      const items = sessions.map(s => {
        const date = new Date(s.startedAt);
        const isDone = s.events.some(e => e.type === 'done');
        const icon = isDone ? '$(check)' : '$(error)';
        return {
          label: `${icon} ${s.project} — ${s.skill} ${s.ticket}`,
          description: date.toLocaleString(),
          detail: s.events.find(e => e.type === 'done')?.label || s.events[s.events.length - 1]?.label || '',
          session: s,
        };
      });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a session to reopen' });
      if (pick) { openSavedSession(pick.session); }
    }),

    vscode.commands.registerCommand('kronos.stats', async () => {
      const stats = getAggregateStats();
      const issues = listSessionStoreIssues();
      const sessions = stats.sessions;
      if (sessions.length === 0) {
        if (issues.some(issue => issue.kind === 'invalid_session_stats')) {
          vscode.window.showWarningMessage('No readable session stats. Kronos found an invalid stats.json. Run Kronos: Doctor.');
        } else {
          vscode.window.showInformationMessage('No session data yet. Run some actions to collect stats.');
        }
        return;
      }
      const panel = vscode.window.createWebviewPanel('kronosStats', 'Kronos: Session Stats', vscode.ViewColumn.One, { enableScripts: true });
      const nonce = createWebviewNonce();
      attachOperatorCommandHandler(panel);
      const esc = escapeHtml;

      const totalSessions = sessions.length;
      const successes = sessions.filter(s => s.verdict === 'success').length;
      const avgDuration = Math.round(sessions.reduce((a, s) => a + s.durationSec, 0) / totalSessions);
      const avgTools = Math.round(sessions.reduce((a, s) => a + s.toolCalls, 0) / totalSessions);
      const totalErrors = sessions.reduce((a, s) => a + s.toolErrors, 0);
      const totalFiles = sessions.reduce((a, s) => a + s.filesEdited, 0);

      const bySkill: Record<string, typeof sessions> = {};
      for (const s of sessions) {
        if (!bySkill[s.skill]) { bySkill[s.skill] = []; }
        bySkill[s.skill].push(s);
      }

      const skillRows = Object.entries(bySkill).map(([skill, items]) => {
        const avg = Math.round(items.reduce((a, s) => a + s.durationSec, 0) / items.length);
        const succ = items.filter(s => s.verdict === 'success').length;
        const tools = Math.round(items.reduce((a, s) => a + s.toolCalls, 0) / items.length);
        return `<tr><td>${esc(skill)}</td><td>${items.length}</td><td>${succ}/${items.length}</td><td>${avg}s</td><td>${tools}</td></tr>`;
      }).join('');

      const recentRows = sessions.slice(-15).reverse().map(s => {
        const date = formatWebviewDateTime(s.startedAt);
        const verdict = s.verdict === 'success' ? '<span class="pill pass">PASS</span>' : '<span class="pill fail">FAIL</span>';
        return `<tr><td>${date}</td><td>${esc(s.project)}</td><td>${esc(s.skill)}</td><td>${esc(s.ticket || '-')}</td><td>${verdict}</td><td>${s.durationSec}s</td><td>${s.toolCalls}</td><td>${s.toolErrors}</td><td>${s.filesEdited}</td></tr>`;
      }).join('');
      const actions = operatorCommandRow([
        actionButton('runCenter', 'Run Center'),
        actionButton('sessionHistory', 'Session History'),
        actionButton('agentQualityScore', 'Agent Quality'),
        actionButton('trendMetrics', 'Trend Metrics'),
      ]);

      panel.webview.html = withWebviewCsp(`<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Session Stats</h1>
      <div class="kronos-subtitle">Aggregate run outcomes, tool use, errors, and recent session history</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${totalSessions}</div><div class="lbl">Sessions</div></div>
    <div class="summary-card"><div class="num">${successes}/${totalSessions}</div><div class="lbl">Success Rate</div></div>
    <div class="summary-card"><div class="num">${avgDuration}s</div><div class="lbl">Avg Duration</div></div>
    <div class="summary-card"><div class="num">${avgTools}</div><div class="lbl">Avg Tool Calls</div></div>
    <div class="summary-card"><div class="num">${totalErrors}</div><div class="lbl">Total Errors</div></div>
    <div class="summary-card"><div class="num">${totalFiles}</div><div class="lbl">Files Changed</div></div>
  </div>
  <div class="operator-section"><h2>By Action Type</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Action</th><th>Sessions</th><th>Success</th><th>Avg Time</th><th>Avg Tools</th></tr>${skillRows}</table></div></div>
  <div class="operator-section"><h2>Recent Sessions</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Date</th><th>Project</th><th>Action</th><th>Ticket</th><th>Result</th><th>Time</th><th>Tools</th><th>Errors</th><th>Files</th></tr>${recentRows}</table></div></div>
</div>${kronosActionPanelScript(nonce)}</body></html>`, webviewScriptCspOptions(panel.webview.cspSource, nonce));
    }),

    vscode.commands.registerCommand('kronos.agentQualityScore', async () => {
      openAgentQualityScorePanel(state);
    }),

    vscode.commands.registerCommand('kronos.trendMetrics', async () => {
      openTrendMetricsPanel(state);
    }),

    vscode.commands.registerCommand('kronos.agingReport', async () => {
      openAgingReportPanel(state);
    }),

    vscode.commands.registerCommand('kronos.runCenter', async () => {
      openInteractiveRunCenter(state);
    }),

    vscode.commands.registerCommand('kronos.openRunArtifact', async () => {
      const runs = listRuns();
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No persisted Kronos runs yet.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Select a Kronos run' });
      if (!picked) { return; }

      const action = await vscode.window.showQuickPick(
        ['Open Log', 'Open Prompt', 'Open Run Record', 'Open Workspace Terminal', 'Open Workspace Diff', 'Mark Needs Human', 'Pause Run', 'Continue Run', 'Cancel Run', 'Resume Run', 'Retry Saved Prompt', 'Archive Run'],
        { placeHolder: `Inspect ${picked.label}` }
      );
      if (!action) { return; }

      if (action === 'Open Log') {
        await openTextFileIfExists(picked.run.logPath, 'Run log not found.');
      } else if (action === 'Open Prompt') {
        await openTextFileIfExists(picked.run.promptPath || '', 'Run prompt artifact not found.');
      } else if (action === 'Open Run Record') {
        await openTextFileIfExists(runRecordPath(picked.run.id), 'Run record not found.');
      } else if (action === 'Open Workspace Terminal') {
        const cwd = picked.run.worktreePath || picked.run.cwd || picked.run.projectPath;
        if (cwd && fs.existsSync(cwd)) {
          const terminal = vscode.window.createTerminal(kronosTerminalOptions({ name: `Kronos ${picked.run.project}`, cwd }));
          terminal.show();
        } else {
          vscode.window.showWarningMessage('Run workspace no longer exists.');
        }
      } else if (action === 'Open Workspace Diff') {
        await openRunDiffArtifact(picked.run);
      } else if (action === 'Mark Needs Human') {
        await markSelectedRunNeedsHuman(picked.run);
      } else if (action === 'Pause Run') {
        await pauseSelectedRun(picked.run);
      } else if (action === 'Continue Run') {
        await continueSelectedRun(picked.run);
      } else if (action === 'Cancel Run') {
        await cancelSelectedRun(picked.run);
      } else if (action === 'Resume Run') {
        await resumeSelectedRun(state, picked.run);
      } else if (action === 'Retry Saved Prompt') {
        await retryRunFromPrompt(picked.run);
      } else if (action === 'Archive Run') {
        await archiveSelectedRun(picked.run.id);
      }
    }),

    vscode.commands.registerCommand('kronos.retryRun', async () => {
      const runs = listRuns().filter(run => run.promptPath && fs.existsSync(run.promptPath));
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No runs with saved prompt artifacts found.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: `${formatWebviewDateTime(run.startedAt)} - ${String(run.promptHash || '').substring(0, 12)}`,
        run,
      })), { placeHolder: 'Retry which saved Kronos prompt?' });
      if (!picked) { return; }
      await retryRunFromPrompt(picked.run);
    }),

    vscode.commands.registerCommand('kronos.resumeRun', async () => {
      const runs = listRuns().filter(run => run.promptPath || run.logPath);
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No resumable Kronos runs found.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Resume which Kronos run?' });
      if (!picked) { return; }
      await resumeSelectedRun(state, picked.run);
    }),

    vscode.commands.registerCommand('kronos.pauseRun', async () => {
      const runs = listRuns().filter(run => run.status === 'running' || run.status === 'preflight');
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No running Kronos runs to pause.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Pause which Kronos run?' });
      if (!picked) { return; }
      await pauseSelectedRun(picked.run);
    }),

    vscode.commands.registerCommand('kronos.continueRun', async () => {
      const runs = listRuns().filter(run => run.status === 'paused');
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No paused Kronos runs to continue.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Continue which Kronos run?' });
      if (!picked) { return; }
      await continueSelectedRun(picked.run);
    }),

    vscode.commands.registerCommand('kronos.archiveRun', async () => {
      const runs = listRuns();
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No persisted Kronos runs to archive.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Archive which Kronos run?' });
      if (!picked) { return; }
      await archiveSelectedRun(picked.run.id);
    }),

    vscode.commands.registerCommand('kronos.cancelRun', async () => {
      const runs = listRuns();
      if (runs.length === 0) {
        vscode.window.showInformationMessage('No persisted Kronos runs to cancel.');
        return;
      }

      const picked = await vscode.window.showQuickPick(runs.map(run => ({
        label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
        description: run.status,
        detail: runQuickPickDetail(run),
        run,
      })), { placeHolder: 'Cancel which Kronos run?' });
      if (!picked) { return; }
      await cancelSelectedRun(picked.run);
    }),

    vscode.commands.registerCommand('kronos.doctor', async () => {
      openDoctorPanel(state);
    }),

    vscode.commands.registerCommand('kronos.integrationManifest', async () => {
      openIntegrationManifestPanel();
    }),

    vscode.commands.registerCommand('kronos.snapshotIntegrationManifest', async () => {
      await snapshotIntegrationManifest();
    }),

    vscode.commands.registerCommand('kronos.profiles', async () => {
      openProfilesPanel();
    }),

    vscode.commands.registerCommand('kronos.promptManager', async () => {
      openPromptManager(state);
    }),

    vscode.commands.registerCommand('kronos.promptSmokeTests', async () => {
      openPromptSmokeTestsPanel(state);
    }),

    vscode.commands.registerCommand('kronos.snapshotPromptPack', async () => {
      snapshotPromptPack(state);
    }),

    vscode.commands.registerCommand('kronos.promptHistory', async () => {
      openPromptHistoryPanel();
    }),

    vscode.commands.registerCommand('kronos.repairPromptPack', async () => {
      await repairPromptPack(state);
    }),

    vscode.commands.registerCommand('kronos.humanReviewInbox', async () => {
      openHumanReviewInbox(state);
    }),

    vscode.commands.registerCommand('kronos.recoveryCenter', async () => {
      await openRecoveryCenter(state);
    }),

    vscode.commands.registerCommand('kronos.stateAuditLog', async () => {
      openStateAuditLogPanel();
    }),

    vscode.commands.registerCommand('kronos.cleanupWorktrees', async () => {
      const preview = cleanupStaleWorktrees({ remove: false });
      if (preview.results.length === 0) {
        vscode.window.showInformationMessage('No tracked Kronos worktrees found.');
        return;
      }
      if (preview.removable === 0) {
        vscode.window.showWarningMessage(`No worktrees are safe to remove. ${preview.blocked} need manual review.`);
        return;
      }
      const canClean = await confirmSafetyGate({
        command: 'kronos.cleanupWorktrees',
        title: 'Cleanup Stale Worktrees',
        target: `${preview.removable} clean / ${preview.blocked} blocked`,
        risks: ['destructive'],
        changes: [
          `Remove ${preview.removable} clean tracked Kronos worktree(s).`,
          'Untrack missing worktrees from Kronos metadata.',
          `Leave ${preview.blocked} blocked worktree(s) untouched for manual review.`,
        ],
        warnings: ['Only the dry-run removable set will be cleaned. Dirty worktrees are not removed.'],
        confirmationLabel: 'Remove Clean Worktrees',
      });
      if (!canClean) { return; }
      const cleaned = cleanupStaleWorktrees({ remove: true });
      vscode.window.showInformationMessage(`Removed ${cleaned.removed} worktree(s). ${cleaned.blocked} still need manual review.`);
    }),
  );

  // First-run detection
  if (!state.state || Object.keys(state.state.projects).length === 0) {
    runNotificationCommandAction(
      vscode.window.showInformationMessage(
        'Welcome to Kronos! Run setup to configure auth and scan for projects.',
        'Run Setup', 'Later'
      ),
      'Run Setup',
      'kronos.setup',
      'Failed to start Kronos setup.'
    );
  }

  // Report stale worktrees from previous sessions without deleting anything automatically.
  const cleanupPreview = cleanupStaleWorktrees({ remove: false });
  if (cleanupPreview.removable > 0 || cleanupPreview.blocked > 0) {
    runNotificationCommandAction(
      vscode.window.showWarningMessage(
        `Kronos found ${cleanupPreview.results.length} tracked worktree(s): ${cleanupPreview.removable} clean, ${cleanupPreview.blocked} need review.`,
        'Review Cleanup'
      ),
      'Review Cleanup',
      'kronos.cleanupWorktrees',
      'Failed to open Kronos worktree cleanup.'
    );
  }

  context.subscriptions.push({ dispose: () => { state.dispose(); sessionTree.dispose(); } });
}

async function runSetupWizard(): Promise<void> {
  // Step 1: Check gcloud auth
  const authOk = await ensureAuth();
  if (!authOk) {
    return;
  }
  vscode.window.showInformationMessage('GCP auth OK');

  // Step 2: Check Claude model access
  let modelOk = false;
  const config = vscode.workspace.getConfiguration('kronos');
  const model = config.get<string>('dispatchModel', 'claude-opus-4-6');
  modelOk = checkClaudeModelAccess(model).ok;

  if (!modelOk) {
    const pick = await vscode.window.showWarningMessage(
      `Model "${model}" is not accessible. Pick a different model?`,
      'Pick Model', 'Skip'
    );
    if (pick === 'Pick Model') {
      const models = ['claude-opus-4-6', 'claude-opus-4-6[1m]', 'claude-sonnet-4-6', 'claude-sonnet-4@20250514', 'claude-haiku-4-5'];
      const selected = await vscode.window.showQuickPick(models, { placeHolder: 'Select a model your Vertex project supports' });
      if (selected) {
        await config.update('dispatchModel', selected, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${selected}`);
      }
    }
  } else {
    vscode.window.showInformationMessage(`$(check) Model "${model}" OK`);
  }

  // Step 3: Discover projects
  const discover = await vscode.window.showInformationMessage(
    'Scan for projects to register?',
    'Discover', 'Skip'
  );
  if (discover === 'Discover') {
    await vscode.commands.executeCommand('kronos.discover');
  }

  vscode.window.showInformationMessage('Kronos setup complete. Use Refresh to pull tickets from Jira.');
}

async function runSettingsMenu(state: KronosState): Promise<void> {
  const config = vscode.workspace.getConfiguration('kronos');

  const pick = await vscode.window.showQuickPick([
    { label: '$(settings) Profile', description: getActiveProfile().label, detail: 'Provider/default-branch behavior profile' },
    { label: '$(cloud) Dispatch Model', description: config.get('dispatchModel', 'claude-opus-4-6'), detail: 'Claude model for dispatched sessions' },
    { label: '$(clock) Poll Interval', description: `${config.get('pollIntervalSec', 300)}s`, detail: 'How often to auto-refresh project status' },
    { label: '$(pulse) Session Poll', description: `${config.get('sessionPollIntervalMs', 5000)}ms`, detail: 'How often to check for active Claude sessions' },
    { label: '$(folder) Scan Directories', description: 'Edit scan dirs for project discovery', detail: 'Which directories to scan for repos' },
    { label: '$(key) Run Auth Check', description: 'Verify GCP + Claude access', detail: 'Check gcloud auth and model permissions' },
  ], { placeHolder: 'Kronos Settings' });

  if (!pick) { return; }

  if (pick.label.includes('Profile')) {
    const current = getActiveProfile().id;
    const selected = await vscode.window.showQuickPick(
      listProfiles().map(profile => ({ label: profile.label, description: profile.id === current ? '(current)' : profile.id, detail: profile.description, profile })),
      { placeHolder: 'Select Kronos profile' }
    );
    if (selected) {
      await config.update('profile', selected.profile.id, vscode.ConfigurationTarget.Global);
      if (!config.get<string>('defaultBaseBranch')) {
        await config.update('defaultBaseBranch', selected.profile.defaultBaseBranch, vscode.ConfigurationTarget.Global);
      }
      vscode.window.showInformationMessage(`Kronos profile set to ${selected.profile.label}.`);
    }
  } else if (pick.label.includes('Dispatch Model')) {
    const models = ['claude-opus-4-6', 'claude-opus-4-6[1m]', 'claude-sonnet-4-6', 'claude-sonnet-4@20250514', 'claude-haiku-4-5'];
    const current = config.get<string>('dispatchModel', 'claude-opus-4-6');
    const selected = await vscode.window.showQuickPick(
      models.map(m => ({ label: m, description: m === current ? '(current)' : '' })),
      { placeHolder: 'Select model' }
    );
    if (selected) {
      await config.update('dispatchModel', selected.label, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(`Model set to ${selected.label}`);
    }
  } else if (pick.label.includes('Poll Interval')) {
    const val = await vscode.window.showInputBox({ prompt: 'Refresh interval in seconds', value: String(config.get('pollIntervalSec', 300)) });
    if (val) { await config.update('pollIntervalSec', parseInt(val), vscode.ConfigurationTarget.Global); }
  } else if (pick.label.includes('Session Poll')) {
    const val = await vscode.window.showInputBox({ prompt: 'Session poll interval in ms', value: String(config.get('sessionPollIntervalMs', 5000)) });
    if (val) { await config.update('sessionPollIntervalMs', parseInt(val), vscode.ConfigurationTarget.Global); }
  } else if (pick.label.includes('Scan Directories')) {
    const currentState = state.state;
    const val = await vscode.window.showInputBox({
      prompt: 'Scan directories (comma-separated)',
      value: currentState?.settings?.scan_dirs?.join(', ') || '',
    });
    if (val) {
      const newDirs = val.split(',').map(d => d.trim()).filter(Boolean);
      try {
        const result = setScanDirs(newDirs);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Scan dirs updated: ${result.scanDirs.join(', ')}`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update scan dirs.'));
      }
    }
  } else if (pick.label.includes('Auth Check')) {
    await vscode.commands.executeCommand('kronos.setup');
  }
}

function openPromptManager(state: KronosState): void {
  const globalTemplates = listPromptTemplates();
  const projects = state.state?.projects || {};
  const projectOverrides: Array<{ project: string; template: PromptTemplateInfo }> = [];
  for (const [projectName, project] of Object.entries(projects)) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      projectOverrides.push({ project: projectName, template });
    }
  }
  const smokeResults = runPromptSmokeTests(buildPromptSmokeTests(state, globalTemplates, projectOverrides));

  const panel = vscode.window.createWebviewPanel(
    'kronosPromptManager',
    'Kronos Prompt Manager',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildPromptManagerHtml(globalTemplates, projectOverrides, smokeResults, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildPromptManagerHtml(
  globalTemplates: PromptTemplateInfo[],
  projectOverrides: Array<{ project: string; template: PromptTemplateInfo }>,
  smokeResults: PromptSmokeResult[],
  nonce?: string,
): string {
  const globalByName = new Map(globalTemplates.map(t => [t.name, t]));
  const missing = REQUIRED_PROMPTS.filter(name => !globalByName.has(name));
  const requiredRows = REQUIRED_PROMPTS.map(name => {
    const template = globalByName.get(name);
    const status = template ? 'pass' : 'fail';
    const detail = template
      ? `${template.hash.substring(0, 12)} - ${template.variables.length} variable(s)`
      : 'missing';
    return `<tr><td><span class="pill ${status}">${status}</span></td><td>${escapeHtml(name)}</td><td>${escapeHtml(detail)}</td></tr>`;
  }).join('');

  const templateRows = globalTemplates.map(template => promptTemplateRow(template)).join('');
  const smokeRows = smokeResults.map(promptSmokeResultRow).join('');
  const smokeSummary = {
    pass: smokeResults.filter(result => result.status === 'pass').length,
    fail: smokeResults.filter(result => result.status === 'fail').length,
  };
  const overrideRows = projectOverrides.map(({ project, template }) => `
    <tr>
      <td>${escapeHtml(project)}</td>
      <td>${escapeHtml(template.name)}</td>
      <td><code>${escapeHtml(template.hash.substring(0, 12))}</code></td>
      <td>${escapeHtml(template.modifiedAt)}</td>
      <td>${escapeHtml(template.variables.join(', ') || '-')}</td>
      <td>${escapeHtml(template.path)}</td>
    </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('promptSmokeTests', 'Smoke Tests'),
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptHistory', 'History'),
    actionButton('repairPromptPack', 'Repair'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt Manager</h1>
      <div class="kronos-subtitle">Required prompts, smoke coverage, global templates, and project overrides</div>
    </div>
  </div>
  ${actions}
  <div class="operator-section"><h2>Required Prompt Pack</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Prompt</th><th>Detail</th></tr>${requiredRows}</table></div>
  ${missing.length > 0 ? `<div class="kronos-empty">Missing required prompts: ${escapeHtml(missing.join(', '))}</div>` : ''}</div>

  <div class="operator-section"><h2>Prompt Smoke Tests</h2>
  <div class="subtitle">${smokeSummary.pass} passing, ${smokeSummary.fail} failing.</div>
  ${smokeResults.length === 0 ? '<div class="kronos-empty">No prompt smoke tests configured.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Test</th><th>Template</th><th>Detail</th></tr>${smokeRows}</table></div>`}</div>

  <div class="operator-section"><h2>Global Templates</h2>
  ${globalTemplates.length === 0 ? '<div class="kronos-empty">No global prompt templates found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Name</th><th>Hash</th><th>Modified</th><th>Variables</th><th>Path</th></tr>${templateRows}</table></div>`}</div>

  <div class="operator-section"><h2>Project Overrides</h2>
  ${projectOverrides.length === 0 ? '<div class="kronos-empty">No project prompt overrides found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Project</th><th>Name</th><th>Hash</th><th>Modified</th><th>Variables</th><th>Path</th></tr>${overrideRows}</table></div>`}</div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openPromptSmokeTestsPanel(state: KronosState): void {
  const globalTemplates = listPromptTemplates();
  const projectOverrides: Array<{ project: string; template: PromptTemplateInfo }> = [];
  for (const [projectName, project] of Object.entries(state.state?.projects || {})) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      projectOverrides.push({ project: projectName, template });
    }
  }
  const results = runPromptSmokeTests(buildPromptSmokeTests(state, globalTemplates, projectOverrides));
  const panel = vscode.window.createWebviewPanel(
    'kronosPromptSmokeTests',
    'Kronos Prompt Smoke Tests',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildPromptSmokeTestsHtml(results, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function snapshotPromptPack(state: KronosState): void {
  const templates = promptHistoryTemplatesForState(state);
  const previous = latestPromptHistorySnapshot('workspace');
  const snapshot = createPromptHistorySnapshot(templates, { scope: 'workspace' });
  const diff = diffPromptHistorySnapshots(snapshot, previous);
  const changed = diff.summary.added + diff.summary.removed + diff.summary.changed;
  vscode.window.showInformationMessage(`Prompt snapshot saved: ${changed} changed, ${diff.summary.unchanged} unchanged.`);
  openPromptHistoryDiffPanel(diff);
}

function openPromptHistoryPanel(): void {
  const snapshots = listPromptHistorySnapshots(25);
  const latest = snapshots[0];
  const previous = latest ? snapshots.find(snapshot => snapshot.scope === latest.scope && snapshot.id !== latest.id) : undefined;
  const diff = latest ? diffPromptHistorySnapshots(latest, previous) : undefined;
  const panel = vscode.window.createWebviewPanel(
    'kronosPromptHistory',
    'Kronos Prompt History',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildPromptHistoryHtml(snapshots, diff, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

async function repairPromptPack(state: KronosState): Promise<void> {
  const globalTemplates = listPromptTemplates();
  const globalByName = new Set(globalTemplates.filter(template => template.source === 'global').map(template => template.name));
  const missing = REQUIRED_PROMPTS.filter(name => !globalByName.has(name));
  if (missing.length === 0) {
    vscode.window.showInformationMessage('Required Kronos prompt pack is already present.');
    return;
  }
  const canRepair = await confirmSafetyGate({
    command: 'kronos.repairPromptPack',
    title: 'Repair Prompt Pack',
    target: path.join(KRONOS_DIR, 'prompts'),
    risks: ['state-write'],
    changes: [
      `Create ${missing.length} missing required prompt template file(s).`,
      'Leave existing prompt templates untouched.',
      'Generated templates are starter prompts that should be reviewed before production use.',
    ],
    warnings: ['This does not install external scripts or credentials.'],
    confirmationLabel: 'Create Missing Prompts',
  });
  if (!canRepair) { return; }
  const result = repairRequiredPromptTemplates(REQUIRED_PROMPTS);
  const action = await vscode.window.showInformationMessage(
    `Created ${result.created.length} prompt template(s). ${result.existing.length} already existed.`,
    'Open Prompt Manager'
  );
  if (action === 'Open Prompt Manager') {
    openPromptManager(state);
  }
}

function openPromptHistoryDiffPanel(diff: PromptHistoryDiff): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosPromptHistory',
    'Kronos Prompt History',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildPromptHistoryHtml(listPromptHistorySnapshots(25), diff, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildPromptHistoryHtml(snapshots: PromptHistorySnapshot[], diff?: PromptHistoryDiff, nonce?: string): string {
  const snapshotRows = snapshots.map(snapshot => `<tr>
    <td>${escapeHtml(snapshot.createdAt)}</td>
    <td>${escapeHtml(snapshot.scope)}</td>
    <td>${escapeHtml(String(snapshot.templateCount))}</td>
    <td><code>${escapeHtml(snapshot.id)}</code></td>
  </tr>`).join('');
  const diffRows = (diff?.changes || []).map(change => {
    const hash = `${change.beforeHash ? change.beforeHash.substring(0, 12) : '-'} -> ${change.afterHash ? change.afterHash.substring(0, 12) : '-'}`;
    const variables = `${(change.beforeVariables || []).join(', ') || '-'} -> ${(change.afterVariables || []).join(', ') || '-'}`;
    return `<tr>
      <td><span class="pill ${escapeClass(change.kind)}">${escapeHtml(change.kind)}</span></td>
      <td>${escapeHtml(change.name)}<br><span class="muted">${escapeHtml(change.source)}</span></td>
      <td><code>${escapeHtml(hash)}</code></td>
      <td>${escapeHtml(variables)}</td>
      <td>${escapeHtml(change.path)}</td>
    </tr>`;
  }).join('');
  const diffSummary = diff
    ? `${diff.summary.added} added, ${diff.summary.removed} removed, ${diff.summary.changed} changed, ${diff.summary.unchanged} unchanged.`
    : 'No prompt history snapshots yet.';
  const actions = operatorCommandRow([
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptManager', 'Prompt Manager'),
    actionButton('promptSmokeTests', 'Smoke Tests'),
    actionButton('repairPromptPack', 'Repair'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .pill.added { color: #4caf50; background: rgba(76,175,80,0.16); }
  .pill.removed { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.changed { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.unchanged { color: var(--k-muted); background: rgba(128,128,128,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt History</h1>
      <div class="kronos-subtitle">${escapeHtml(diffSummary)}</div>
    </div>
  </div>
  ${actions}
  <div class="operator-section"><h2>Latest Diff</h2>
  ${diff ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Prompt</th><th>Hash</th><th>Variables</th><th>Path</th></tr>${diffRows}</table></div>` : '<div class="kronos-empty">Create a prompt snapshot to start history tracking.</div>'}</div>
  <div class="operator-section"><h2>Snapshots</h2>
  ${snapshots.length === 0 ? '<div class="kronos-empty">No prompt snapshots found.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Created</th><th>Scope</th><th>Templates</th><th>ID</th></tr>${snapshotRows}</table></div>`}</div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function promptHistoryTemplatesForState(state: KronosState): PromptTemplateInfo[] {
  const byKey = new Map<string, PromptTemplateInfo>();
  for (const template of listPromptTemplates()) {
    byKey.set(`${template.source}:${template.name}:${template.path}`, template);
  }
  for (const project of Object.values(state.state?.projects || {})) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      byKey.set(`${template.source}:${template.name}:${template.path}`, template);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => `${a.source}:${a.name}:${a.path}`.localeCompare(`${b.source}:${b.name}:${b.path}`));
}

function buildPromptSmokeTestsHtml(results: PromptSmokeResult[], nonce?: string): string {
  const pass = results.filter(result => result.status === 'pass').length;
  const fail = results.filter(result => result.status === 'fail').length;
  const rows = results.map(promptSmokeResultRow).join('');
  const actions = operatorCommandRow([
    actionButton('promptManager', 'Prompt Manager'),
    actionButton('snapshotPromptPack', 'Snapshot'),
    actionButton('promptHistory', 'History'),
    actionButton('repairPromptPack', 'Repair'),
  ]);
  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Prompt Smoke Tests</h1>
      <div class="kronos-subtitle">${pass} passing, ${fail} failing.</div>
    </div>
  </div>
  ${actions}
  ${results.length === 0 ? '<div class="kronos-empty">No prompt smoke tests configured.</div>' : `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Test</th><th>Template</th><th>Detail</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function buildPromptSmokeTests(
  state: KronosState,
  globalTemplates: PromptTemplateInfo[],
  projectOverrides: Array<{ project: string; template: PromptTemplateInfo }>,
): PromptSmokeTest[] {
  const tests = buildDefaultPromptSmokeTests(globalTemplates, { idPrefix: 'global' });
  for (const { project, template } of projectOverrides) {
    const projectPath = state.state?.projects?.[project]?.path;
    if (projectPath) {
      tests.push(...buildDefaultPromptSmokeTests([template], { idPrefix: `project:${project}`, projectPath }));
    }
  }

  const manifest = readIntegrationManifest().manifest;
  for (const [templateName, entry] of Object.entries(manifest?.prompts || {})) {
    for (const [idx, smoke] of (entry.smoke_tests || []).entries()) {
      tests.push({
        id: `manifest:${templateName}:${smoke.name || idx + 1}`,
        templateName,
        variables: smoke.variables,
        mustContain: smoke.mustContain,
        mustNotContain: smoke.mustNotContain,
        allowMissingVariables: smoke.allowMissingVariables,
        source: 'manifest',
      });
    }
  }
  return tests;
}

function promptSmokeResultRow(result: PromptSmokeResult): string {
  const detail = result.errors.length > 0
    ? result.errors.join('; ')
    : `${result.renderedBytes || 0} bytes rendered${result.renderedHash ? `, hash ${result.renderedHash.substring(0, 12)}` : ''}`;
  return `<tr>
    <td><span class="pill ${escapeClass(result.status)}">${escapeHtml(result.status)}</span></td>
    <td>${escapeHtml(result.id)}${result.source ? `<br><span class="muted">${escapeHtml(result.source)}</span>` : ''}</td>
    <td>${escapeHtml(result.templateName)}</td>
    <td>${escapeHtml(detail)}</td>
  </tr>`;
}

function promptTemplateRow(template: PromptTemplateInfo): string {
  return `<tr>
    <td>${escapeHtml(template.name)}</td>
    <td><code>${escapeHtml(template.hash.substring(0, 12))}</code></td>
    <td>${escapeHtml(template.modifiedAt)}</td>
    <td>${escapeHtml(template.variables.join(', ') || '-')}</td>
    <td>${escapeHtml(template.path)}</td>
  </tr>`;
}

async function openRecoveryCenter(state: KronosState): Promise<void> {
  const backups = listBackups();
  const inventory = buildRecoveryInventoryForState(state, backups);
  openRecoveryPanel(state, inventory, backups);

  if (!inventory.items.some(item => item.action)) {
    vscode.window.showInformationMessage('Recovery Center found no active recovery items.');
  }
}

function buildRecoveryInventoryForState(state: KronosState, backups = listBackups()): RecoveryInventory {
  return buildRecoveryInventory({
    runs: listRuns(),
    runStoreIssues: listRunStoreIssues(),
    tickets: state.state?.tickets,
    backups,
    worktreeReport: cleanupStaleWorktrees({ remove: false }),
    doctorChecks: runDoctorChecks(state),
  });
}

function openRecoveryPanel(state: KronosState, initialInventory: RecoveryInventory, initialBackups = listBackups()): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosRecoveryCenter',
    'Kronos Recovery Center',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentInventory = initialInventory;
  let currentBackups = initialBackups;
  const render = (refresh = false) => {
    if (refresh) {
      currentBackups = listBackups();
      currentInventory = buildRecoveryInventoryForState(state, currentBackups);
    }
    panel.webview.html = withWebviewCsp(buildRecoveryHtml(currentInventory, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, RECOVERY_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos recovery action.');
      return;
    }
    const item = currentInventory.items.find(candidate => candidate.id === request.itemId);
    if (!item) {
      vscode.window.showWarningMessage('Recovery item is no longer available.');
      return;
    }
    await executeRecoveryAction(item, state, currentBackups);
    render(true);
  });
}

function openStateAuditLogPanel(): void {
  const events = listStateAuditEvents(200);
  const panel = vscode.window.createWebviewPanel(
    'kronosStateAuditLog',
    'Kronos State Audit Log',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildStateAuditLogHtml(events, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildStateAuditLogHtml(events: StateAuditEvent[], nonce?: string): string {
  const rows = events.length === 0
    ? '<tr><td colspan="5" class="empty">No state audit events found.</td></tr>'
    : events.map(event => {
      const backup = typeof event.backup === 'string' && event.backup
        ? event.backup
        : event.backup === null
          ? 'none'
          : '';
      const detail = Object.entries(event)
        .filter(([key]) => !['at', 'action', 'target', 'backup'].includes(key))
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join('\n');
      return `<tr>
        <td>${escapeHtml(String(event.at || ''))}</td>
        <td><code>${escapeHtml(event.action)}</code></td>
        <td>${escapeHtml(String(event.target || ''))}</td>
        <td>${escapeHtml(backup)}</td>
        <td><pre>${escapeHtml(detail || '-')}</pre></td>
      </tr>`;
    }).join('');
  const actions = operatorCommandRow([
    actionButton('recoveryCenter', 'Recovery Center'),
    actionButton('doctor', 'Doctor'),
    actionButton('stats', 'Session Stats'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  pre { margin: 0; padding: 0; border: 0; background: transparent; font-size: 11px; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos State Audit Log</h1>
      <div class="kronos-subtitle">${escapeHtml(STATE_AUDIT_FILE)} · newest first · ${events.length} event(s)</div>
    </div>
  </div>
  ${actions}
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Time</th><th>Action</th><th>Target</th><th>Backup</th><th>Detail</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

async function executeRecoveryAction(item: RecoveryItem, state: KronosState, backups = listBackups()): Promise<void> {
  if (item.action === 'openRunCenter') {
    openInteractiveRunCenter(state);
    return;
  }
  if (item.action === 'retryRun') {
    const run = listRuns().find(r => r.id === item.runId);
    if (!run) {
      vscode.window.showWarningMessage('Run record not found.');
      return;
    }
    await retryRunFromPrompt(run);
    return;
  }
  if (item.action === 'resumeRun') {
    const run = listRuns().find(r => r.id === item.runId);
    if (!run) {
      vscode.window.showWarningMessage('Run record not found.');
      return;
    }
    await resumeSelectedRun(state, run);
    return;
  }
  if (item.action === 'archiveRun') {
    if (!item.runId) { return; }
    await archiveSelectedRun(item.runId);
    return;
  }
  if (item.action === 'openRunLog') {
    const run = listRuns().find(r => r.id === item.runId);
    await openTextFileIfExists(run?.logPath || '', 'Run log not found.');
    return;
  }
  if (item.action === 'openRunPrompt') {
    const run = listRuns().find(r => r.id === item.runId);
    await openTextFileIfExists(run?.promptPath || '', 'Run prompt artifact not found.');
    return;
  }
  if (item.action === 'linkMrToTicket') {
    if (!item.ticketKey) {
      vscode.window.showWarningMessage('Recovery item does not include a ticket key.');
      return;
    }
    await vscode.commands.executeCommand('kronos.linkMrToTicket', { ticketKey: item.ticketKey });
    return;
  }
  if (item.action === 'cleanupWorktrees') {
    await vscode.commands.executeCommand('kronos.cleanupWorktrees');
    return;
  }
  if (item.action === 'openDoctor') {
    openDoctorPanel(state);
    return;
  }
  if (item.action === 'restoreBackup') {
    await pickAndRestoreBackup(state, backups, item.backupPath);
  }
}

async function pickAndRestoreBackup(state: KronosState, backups = listBackups(), preferredBackupPath?: string): Promise<void> {
  if (backups.length === 0) {
    vscode.window.showInformationMessage('No Kronos state backups found.');
    return;
  }

  const choices = backups.map(backup => ({
    label: `${backup.targetName} - ${formatWebviewDateTime(backup.createdAt)}`,
    description: `${Math.max(1, Math.round(backup.size / 1024))} KB`,
    detail: backup.filePath,
    backup,
  }));
  const preferred = preferredBackupPath ? choices.find(choice => choice.backup.filePath === preferredBackupPath) : undefined;
  const picked = preferred || await vscode.window.showQuickPick(choices, { placeHolder: 'Select a Kronos backup' });
  if (!picked) { return; }

  const action = await vscode.window.showQuickPick(
    ['Open Backup', 'Restore Backup'],
    { placeHolder: `${picked.backup.targetName}: ${picked.backup.filePath}` }
  );
  if (!action) { return; }

  if (action === 'Open Backup') {
    await openTextFileIfExists(picked.backup.filePath, 'Backup file not found.');
    return;
  }

  const canRestore = await confirmSafetyGate({
    command: 'kronos.restoreBackup',
    title: 'Restore Kronos Backup',
    target: picked.backup.targetName,
    risks: ['state-write'],
    changes: [
      `Restore ${picked.backup.targetName} from ${formatWebviewDateTime(picked.backup.createdAt)}.`,
      'Back up the current file before replacing it.',
    ],
    confirmationLabel: 'Restore',
  });
  if (!canRestore) { return; }

  try {
    restoreBackup(picked.backup.filePath);
    state.reloadAndNotify();
    vscode.window.showInformationMessage(`Restored ${picked.backup.targetName} from backup.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to restore backup.'));
  }
}

function recoveryActionLabel(action: RecoveryItem['action']): string {
  if (action === 'openRunCenter') { return 'Open Run Center'; }
  if (action === 'resumeRun') { return 'Resume Run'; }
  if (action === 'retryRun') { return 'Retry Saved Prompt'; }
  if (action === 'archiveRun') { return 'Archive Run'; }
  if (action === 'openRunLog') { return 'Open Log'; }
  if (action === 'openRunPrompt') { return 'Open Prompt'; }
  if (action === 'linkMrToTicket') { return 'Link MR to Ticket'; }
  if (action === 'cleanupWorktrees') { return 'Review Worktrees'; }
  if (action === 'restoreBackup') { return 'Restore Backup'; }
  if (action === 'openDoctor') { return 'Open Doctor'; }
  return '';
}

function kronosOperatorPanelCss(): string {
  return `${kronosWebviewBaseCss()}
  .operator-shell { max-width: 1280px; }
  .operator-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin: 12px 0 18px; }
  .summary-card { padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .summary-card .num { font-size: 24px; line-height: 1.1; font-weight: 700; }
  .summary-card .lbl { margin-top: 4px; color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .table-wrap { overflow: auto; }
  .detail { white-space: pre-wrap; word-break: break-word; }
  .pill { display: inline-flex; align-items: center; min-height: 20px; border: 1px solid var(--k-border); border-radius: 999px; padding: 2px 8px; font-weight: 650; font-size: 10px; line-height: 1.2; text-transform: uppercase; }
  .pill.critical, .pill.fail, .pill.bad, .pill.error { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.warning, .pill.warn, .pill.medium, .pill.neutral { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.info, .pill.pass, .pill.good, .pill.ok, .pill.low { color: #4caf50; background: rgba(76,175,80,0.16); }
  .subtitle { color: var(--k-muted); margin-bottom: 16px; }
  .muted { color: var(--k-muted); margin-top: 3px; }
  .empty { color: var(--k-muted); }
  div.empty { border: 1px dashed var(--k-border); border-radius: var(--k-radius); padding: 18px; background: var(--k-surface-soft); }
  .operator-section { margin: 20px 0; }
  .operator-section h2,
  .operator-section h3 { margin: 0 0 10px; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .operator-card { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 12px; background: var(--k-surface); }
  .operator-card-header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .operator-card-title { font-size: 14px; font-weight: 650; line-height: 1.3; }
  .operator-card-meta { color: var(--k-muted); font-size: 11px; }
  .operator-card .subtitle { margin-bottom: 10px; }
  .operator-note { border-left: 3px solid var(--k-accent); padding: 10px 12px; border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .operator-hero { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius); padding: 14px 16px; background: var(--k-surface-soft); }
  .operator-hero .score { font-size: 34px; line-height: 1; font-weight: 750; }
  .operator-hero .grade { color: var(--k-muted); font-size: 18px; margin-left: 8px; }
  .action-cell { min-width: 150px; }
  .inline-actions { gap: 6px; align-items: flex-start; }
  .inline-actions .kronos-button { min-height: 24px; padding: 3px 8px; font-size: 10px; }
  .operator-command-row { margin: 12px 0 18px; gap: 8px; align-items: flex-start; }
  .operator-command-row .kronos-button { min-height: 28px; }
  .plan-list { display: grid; gap: 10px; }
  .plan-card { display: grid; grid-template-columns: 34px 1fr; gap: 10px; }
  .rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--k-border); border-radius: 999px; background: var(--k-surface-soft); font-weight: 700; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; margin-top: 8px; }
  .score-part { border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 7px 8px; font-size: 11px; background: var(--k-surface-soft); }
  .score-part span { display: block; color: var(--k-muted); font-weight: 650; text-transform: uppercase; }
  .score-part strong { display: inline-block; margin-right: 6px; font-size: 16px; }
  .score-part small { color: var(--k-muted); }
  .message { padding: 9px 10px; margin: 6px 0; border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); font-size: 12px; }
  .message.pass { border-left-color: #4caf50; }
  .message.warn { border-left-color: #ff9800; }
  .message.fail { border-left-color: #f44336; }
  .hash-detail { display: inline-block; margin-top: 3px; color: var(--k-muted); word-break: break-word; }
  .path { color: var(--k-muted); font-size: 12px; margin-bottom: 12px; word-break: break-all; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--k-surface-soft); border: 1px solid var(--k-border); padding: 12px; border-radius: var(--k-radius); font-size: 12px; }
  a { color: var(--k-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  li { margin: 4px 0; }`;
}

function buildRecoveryHtml(inventory: RecoveryInventory, nonce?: string): string {
  const rows = inventory.items.map(item => `<tr class="${item.severity}">
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td class="action-cell">${actionButton('executeRecoveryItem', item.actionLabel || recoveryActionLabel(item.action), {
      itemId: item.id,
      ticket: item.ticketKey,
      runId: item.runId,
      primary: item.severity === 'critical',
    })}</td>
  </tr>`).join('');
  const empty = inventory.items.length === 0 ? '<div class="empty">No active recovery items.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Recovery Center</h1><div class="kronos-subtitle">Runs, worktrees, backups, integrations, and merge requests that need operator action</div></div></div>
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inventory.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th>Action</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openHumanReviewInbox(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosHumanReviewInbox',
    'Kronos Human Review Inbox',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  const render = () => {
    const inbox = buildHumanReviewInbox({
      state: state.state,
      queue: state.queue,
      runs: listRuns(),
      worktreeReport: cleanupStaleWorktrees({ remove: false }),
      doctorChecks: runDoctorChecks(state),
    });
    panel.webview.html = withWebviewCsp(buildHumanReviewInboxHtml(inbox, state, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, HUMAN_REVIEW_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos human review request.');
      return;
    }
    if (request.command === 'refreshPanel') {
      state.reloadAndNotify();
      render();
      return;
    }
    await executeHumanReviewAction(state, request.command, request.ticket);
    render();
  });
}

function buildHumanReviewInboxHtml(inbox: HumanReviewInbox, state: KronosState, nonce: string): string {
  const rows = inbox.items.map(item => `<tr class="${item.severity}">
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td>${escapeHtml(item.ticketKey || item.runId || '')}</td>
    <td class="action-cell">${humanReviewActionButtons(item, state)}</td>
  </tr>`).join('');
  const empty = inbox.items.length === 0 ? '<div class="empty">No human-review items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Human Review Inbox</h1><div class="kronos-subtitle">Items where an operator decision is safer than automation</div></div></div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inbox.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th>Ref</th><th>Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(nonce)}</body></html>`;
}

function humanReviewActionButtons(item: HumanReviewInbox['items'][number], state: KronosState): string {
  const ticket = item.ticketKey ? state.state?.tickets?.[item.ticketKey] : undefined;
  const hasLinkedProject = Boolean(ticket?.projects?.length);
  const buttons: string[] = [];

  if (item.kind === 'evidence' && item.ticketKey) {
    if (/acceptance criteria not extracted/i.test(item.title)) {
      buttons.push(actionButton('extractAcceptanceCriteria', 'Extract AC', { ticket: item.ticketKey, primary: true }));
    } else if (/acceptance criterion item.*unchecked/i.test(item.title)) {
      buttons.push(actionButton('updateAcceptanceCriteria', 'Check AC', { ticket: item.ticketKey, primary: true }));
    } else if (/test evidence|evidence check|build/i.test(item.title)) {
      buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: item.ticketKey, primary: true }));
    } else {
      buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: item.ticketKey, primary: true }));
    }
    buttons.push(actionButton('evidenceGate', 'Gate', { ticket: item.ticketKey }));
  } else if (item.kind === 'ticket' && item.ticketKey) {
    if (hasLinkedProject && ticket?.next_action !== 'done') {
      buttons.push(actionButton('startTicket', 'Start', { ticket: item.ticketKey, primary: item.severity === 'critical' }));
      buttons.push(actionButton('addToQueue', 'Queue', { ticket: item.ticketKey }));
    }
    buttons.push(actionButton('viewTicket', item.title.includes('blocked') || !hasLinkedProject ? 'Fix' : 'View', { ticket: item.ticketKey, primary: !hasLinkedProject }));
  } else if (item.kind === 'run') {
    buttons.push(actionButton('runCenter', 'Open Run Center', { primary: item.severity === 'critical' }));
    buttons.push(actionButton('recoveryCenter', 'Recovery'));
  } else if (item.kind === 'integration') {
    buttons.push(actionButton('doctor', 'Open Doctor', { primary: item.severity === 'critical' }));
  } else if (item.kind === 'worktree') {
    buttons.push(actionButton('recoveryCenter', 'Review Worktree', { primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  } else if (item.kind === 'queue') {
    buttons.push(actionButton('queuePlanner', 'Open Queue', { primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  }

  return actionRow(buttons);
}

async function executeHumanReviewAction(state: KronosState, command: string, ticketKey: string): Promise<void> {
  if (ticketKey && !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }

  if (command === 'addEvidence' && ticketKey) {
    await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
  } else if (command === 'addEvidenceCheck' && ticketKey) {
    await vscode.commands.executeCommand('kronos.addEvidenceCheck', { ticketKey });
  } else if (command === 'recordEnvironmentResult' && ticketKey) {
    await vscode.commands.executeCommand('kronos.recordEnvironmentResult', { ticketKey });
  } else if (command === 'extractAcceptanceCriteria' && ticketKey) {
    await vscode.commands.executeCommand('kronos.extractAcceptanceCriteria', { ticketKey });
  } else if (command === 'updateAcceptanceCriteria' && ticketKey) {
    await vscode.commands.executeCommand('kronos.updateAcceptanceCriteria', { ticketKey });
  } else if (command === 'startTicket' && ticketKey) {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (command === 'addToQueue' && ticketKey) {
    await vscode.commands.executeCommand('kronos.addToQueue', { ticketKey });
  } else if (command === 'viewTicket' && ticketKey) {
    await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey });
  } else if (command === 'evidenceGate' && ticketKey) {
    await executeOperatorCommandAction(command, ticketKey);
  } else if (command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner') {
    await executeOperatorCommandAction(command);
  } else {
    vscode.window.showWarningMessage('Ignored Kronos human review action without a valid target.');
  }
}

async function startTicketFromActionPanel(state: KronosState, ticketKey: string): Promise<void> {
  const ticket = state.state?.tickets?.[ticketKey];
  if (!ticket) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  if (!ticket.projects?.length) {
    vscode.window.showWarningMessage(`${ticketKey} is not linked to a project.`);
    return;
  }
  if (ticket.next_action === 'done') {
    vscode.window.showInformationMessage(`${ticketKey} is already done.`);
    return;
  }

  const plan = planNextActions(state).find(candidate => candidate.ticketKey === ticketKey) || {
    planId: `human-review:${ticketKey}`,
    ticketKey,
    action: ticket.next_action === 'blocked' ? 'implement' : (ticket.next_action || 'implement'),
    projects: ticket.projects,
    score: 0,
    scoreBreakdown: [],
    reason: 'Started from Human Review Inbox.',
    source: 'ticket' as const,
    ticketSummary: ticket.summary,
  };
  await vscode.commands.executeCommand('kronos.startQueueItem', { item: planToQueueItem(state, plan) });
}

function openEvidenceGatePanel(
  state: KronosState,
  gates: EvidenceGateResult[],
  title: string,
  options: { refreshAllEvidenceGates?: boolean } = {},
): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosEvidenceGate',
    title,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  const gateTicketKeys = gates.map(gate => gate.ticketKey);
  const render = () => {
    const freshGates = options.refreshAllEvidenceGates
      ? evidenceGatePanelGatesForState(state)
      : gateTicketKeys
        .map(ticketKey => {
          const ticket = state.state?.tickets?.[ticketKey];
          return ticket ? evaluateEvidenceGate(ticketKey, ticket) : undefined;
        })
        .filter((gate): gate is EvidenceGateResult => Boolean(gate));
    panel.webview.html = withWebviewCsp(buildEvidenceGateHtml(freshGates, title, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos evidence gate request.');
      return;
    }
    if (request.command === 'refreshPanel') {
      state.reloadAndNotify();
      render();
      return;
    }
    if (!request.ticket || !state.state?.tickets?.[request.ticket]) {
      vscode.window.showWarningMessage('Ignored invalid Kronos evidence gate request.');
      return;
    }
    await executeEvidenceGateAction(request.command, request.ticket);
    render();
  });
}

function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[] {
  const currentState = state.state;
  if (!currentState) { return []; }
  return evaluateEvidenceGates(currentState.tickets)
    .filter(gate => gate.status !== 'pass' || isProofSensitiveAction(currentState.tickets[gate.ticketKey]?.next_action));
}

function isProofSensitiveAction(action: string | undefined): boolean {
  return action === 'await_review' || action === 'verify' || action === 'deploy_monitor' || action === 'done';
}

function openEvidenceHandoffPanel(plan: EvidenceHandoffPlan): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosEvidenceHandoff',
    `Evidence Handoff: ${plan.ticketKey}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildEvidenceHandoffHtml(plan, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildEvidenceHandoffHtml(plan: EvidenceHandoffPlan, nonce?: string): string {
  const destinations = plan.destinations.map(destination => {
    const href = safeHttpHref(destination.url);
    return `<tr class="${destination.available ? 'available' : 'missing'}">
      <td><span class="pill ${destination.available ? 'pass' : 'warn'}">${destination.available ? 'AVAILABLE' : 'MISSING'}</span></td>
      <td>${escapeHtml(destination.label)}</td>
      <td>${escapeHtml(destination.detail)}</td>
      <td>${href ? `<a href="${href}">Open</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const steps = plan.manualSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  const comment = escapeHtml(plan.comment);
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: plan.ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: plan.ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: plan.ticketKey }),
    actionButton('publishEvidence', 'Publish', { ticket: plan.ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Handoff: ${escapeHtml(plan.ticketKey)}</h1><div class="kronos-subtitle">Manual posting packet with destinations, steps, and copied comment payload</div></div></div>
  ${actions}
  <div class="subtitle">${escapeHtml(plan.summary)}<br>Comment text has been copied to the clipboard. Kronos did not call a posting API.</div>
  <div class="operator-section"><h2>Destinations</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Open</th></tr>${destinations}</table></div></div>
  <div class="operator-section"><h2>Manual Steps</h2>
  <ol>${steps}</ol>
  </div>
  <div class="operator-section"><h2>Comment Payload</h2>
  <pre>${comment}</pre></div>
  <p>Markdown artifact: ${escapeHtml(plan.exportPath)}</p>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openEvidencePublishPanel(results: Array<EvidencePublishResult | EvidencePublishDestination>, ticketKey: string): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosEvidencePublish',
    `Evidence Publish: ${ticketKey}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildEvidencePublishHtml(results, ticketKey, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildEvidencePublishHtml(results: Array<EvidencePublishResult | EvidencePublishDestination>, ticketKey: string, nonce?: string): string {
  const rows = results.map(result => {
    const href = safeHttpHref(result.endpoint);
    const httpStatus = 'httpStatus' in result && result.httpStatus ? `HTTP ${result.httpStatus}` : '';
    return `<tr class="${escapeClass(result.status)}">
      <td><span class="pill ${publishPillClass(result.status)}">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.label)}</td>
      <td>${escapeHtml(result.detail)}${httpStatus ? `<div class="muted">${escapeHtml(httpStatus)}</div>` : ''}</td>
      <td>${href ? `<a href="${href}">Endpoint</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const empty = results.length === 0 ? '<div class="empty">No publish destinations were evaluated.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: ticketKey }),
    actionButton('evidenceHandoff', 'Handoff', { ticket: ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Publish: ${escapeHtml(ticketKey)}</h1><div class="kronos-subtitle">External publish results and endpoint safety status</div></div></div>
  ${actions}
  <div class="subtitle">External publishing is safety-gated and credential values are never displayed.</div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Endpoint</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function publishPillClass(status: string): string {
  if (status === 'posted' || status === 'ready') { return 'pass'; }
  if (status === 'failed') { return 'fail'; }
  return 'warn';
}

function buildEvidenceGateHtml(gates: EvidenceGateResult[], title: string, nonce: string): string {
  const summary = {
    fail: gates.filter(g => g.status === 'fail').length,
    warn: gates.filter(g => g.status === 'warn').length,
    pass: gates.filter(g => g.status === 'pass').length,
  };
  const rows = gates.flatMap(gate => gate.checks.map(check => `<tr class="${check.status}">
    <td><span class="pill ${check.status}">${escapeHtml(check.status.toUpperCase())}</span></td>
    <td>${escapeHtml(gate.ticketKey)}</td>
    <td>${escapeHtml(check.kind)}</td>
    <td>${escapeHtml(check.title)}</td>
    <td class="detail">${escapeHtml(check.detail)}</td>
    <td class="action-cell">${evidenceGateActionButtons(gate, check)}</td>
  </tr>`)).join('');
  const empty = gates.length === 0 ? '<div class="empty">No evidence gate items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">${escapeHtml(title)}</h1><div class="kronos-subtitle">Evidence readiness by ticket and check</div></div></div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${summary.fail}</div><div class="lbl">Failing</div></div>
    <div class="summary-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${summary.pass}</div><div class="lbl">Passing</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Ticket</th><th>Check</th><th>Item</th><th>Detail</th><th>Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(nonce)}</body></html>`;
}

function evidenceGateActionButtons(gate: EvidenceGateResult, check: EvidenceGateResult['checks'][number]): string {
  if (check.status === 'pass') {
    return actionRow([actionButton('viewTicket', 'View Ticket', { ticket: gate.ticketKey })]);
  }

  const buttons: string[] = [];
  if (check.kind === 'notes' || check.kind === 'risk') {
    buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'test') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidence', 'Add Note', { ticket: gate.ticketKey }));
  } else if (check.kind === 'acceptance') {
    const isMissingExtraction = /not extracted/i.test(check.title);
    buttons.push(actionButton(isMissingExtraction ? 'extractAcceptanceCriteria' : 'updateAcceptanceCriteria', isMissingExtraction ? 'Extract AC' : 'Check AC', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'environment') {
    buttons.push(actionButton('recordEnvironmentResult', 'Record Env', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey }));
  } else if (check.kind === 'build') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Build Check', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'project' || check.kind === 'mr') {
    buttons.push(actionButton('viewTicket', 'Fix', { ticket: gate.ticketKey, primary: true }));
  }

  if (gate.ready) {
    buttons.push(actionButton('evidenceHandoff', 'Handoff', { ticket: gate.ticketKey }));
    buttons.push(actionButton('publishEvidence', 'Publish', { ticket: gate.ticketKey }));
  }
  return actionRow(buttons);
}

async function executeEvidenceGateAction(command: string, ticketKey: string): Promise<void> {
  if (command === 'addEvidence') {
    await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
  } else if (command === 'addEvidenceCheck') {
    await vscode.commands.executeCommand('kronos.addEvidenceCheck', { ticketKey });
  } else if (command === 'recordEnvironmentResult') {
    await vscode.commands.executeCommand('kronos.recordEnvironmentResult', { ticketKey });
  } else if (command === 'extractAcceptanceCriteria') {
    await vscode.commands.executeCommand('kronos.extractAcceptanceCriteria', { ticketKey });
  } else if (command === 'updateAcceptanceCriteria') {
    await vscode.commands.executeCommand('kronos.updateAcceptanceCriteria', { ticketKey });
  } else if (command === 'viewTicket') {
    await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey });
  } else if (command === 'evidenceHandoff') {
    await vscode.commands.executeCommand('kronos.evidenceHandoff', { ticketKey });
  } else if (command === 'publishEvidence') {
    await vscode.commands.executeCommand('kronos.publishEvidence', { ticketKey });
  }
}

function actionButton(action: string, label: string, options: { ticket?: string; runId?: string; planId?: string; itemId?: string; primary?: boolean } = {}): string {
  const classes = `kronos-button${options.primary ? ' primary' : ''}`;
  const ticketAttr = options.ticket ? ` data-ticket="${escapeAttr(options.ticket)}"` : '';
  const runAttr = options.runId ? ` data-run-id="${escapeAttr(options.runId)}"` : '';
  const planAttr = options.planId ? ` data-plan-id="${escapeAttr(options.planId)}"` : '';
  const itemAttr = options.itemId ? ` data-item-id="${escapeAttr(options.itemId)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${ticketAttr}${runAttr}${planAttr}${itemAttr}>${escapeHtml(label)}</button>`;
}

function actionRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row inline-actions">${buttons.join('')}</div>`
    : '<span class="muted">No action</span>';
}

function operatorCommandRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row operator-command-row">${buttons.join('')}</div>`
    : '';
}

async function executeOperatorCommandAction(command: string, ticketKey = ''): Promise<void> {
  if (TICKET_SCOPED_OPERATOR_COMMANDS.has(command)) {
    if (!ticketKey) {
      vscode.window.showWarningMessage('This Kronos action needs a ticket context.');
      return;
    }
    await vscode.commands.executeCommand(`kronos.${command}`, { ticketKey });
    return;
  }
  if (command === 'evidenceGate' && ticketKey) {
    await vscode.commands.executeCommand(`kronos.${command}`, { ticketKey });
    return;
  }
  await vscode.commands.executeCommand(`kronos.${command}`);
}

function attachOperatorCommandHandler(panel: vscode.WebviewPanel): void {
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, OPERATOR_COMMAND_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos operator action.');
      return;
    }
    await executeOperatorCommandAction(request.command, request.ticket);
  });
}

function kronosActionPanelScript(nonce: string): string {
  return `<script nonce="${escapeAttr(nonce)}">
${webviewVsCodeApiScript('Kronos action panel')}
document.addEventListener('click', function(event) {
  const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;
  if (!target) { return; }
  event.preventDefault();
  vscode.postMessage({
    command: target.getAttribute('data-action') || '',
    ticket: target.getAttribute('data-ticket') || '',
    runId: target.getAttribute('data-run-id') || '',
    planId: target.getAttribute('data-plan-id') || '',
    itemId: target.getAttribute('data-item-id') || ''
  });
});
</script>`;
}

function openQueuePlannerPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosQueuePlanner',
    'Kronos Queue Planner',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentPlans: PlannedAction[] = [];
  const render = () => {
    currentPlans = planNextActions(state).slice(0, 50);
    panel.webview.html = withWebviewCsp(buildQueuePlannerHtml(currentPlans, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos queue planner action.');
      return;
    }
    await executePlanPanelAction(state, currentPlans, request);
    render();
  });
}

function buildQueuePlannerHtml(plans: PlannedAction[], nonce?: string): string {
  const rows = plans.map((plan, idx) => {
    const parts = plan.scoreBreakdown
      .map(part => `<div class="score-part"><span>${escapeHtml(part.label)}</span><strong>${escapeHtml(String(part.value))}</strong><small>${escapeHtml(part.detail)}</small></div>`)
      .join('');
    return `<div class="operator-card plan-card">
      <div class="rank">${idx + 1}</div>
      <div class="plan-main">
        <div class="operator-card-title">${escapeHtml(plan.ticketKey || 'Refresh')} - ${escapeHtml(actionToLabel(plan.action))}</div>
        <div class="operator-card-meta">${escapeHtml(plan.projects.join(', ') || 'unlinked')} | ${escapeHtml(plan.source)} | score ${escapeHtml(String(plan.score))}</div>
        <div class="detail">${escapeHtml(plan.reason)}</div>
        <div class="score-grid">${parts}</div>
        ${planActionRow(plan)}
      </div>
    </div>`;
  }).join('');
  const empty = plans.length === 0 ? '<div class="kronos-empty">No actionable queue recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Queue Planner</h1>
      <div class="kronos-subtitle">${plans.length} ranked recommendation${plans.length === 1 ? '' : 's'} from queue, Jira, and repository state</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function planActionRow(plan: PlannedAction): string {
  const buttons: string[] = [
    actionButton('startPlan', 'Start', { planId: plan.planId, primary: true }),
  ];
  if (plan.ticketKey) {
    if (plan.source === 'queue') {
      buttons.push(actionButton('pinPlan', 'Pin', { planId: plan.planId, ticket: plan.ticketKey }));
    } else {
      buttons.push(actionButton('queuePlan', 'Queue', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('pinPlan', 'Pin', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('snoozePlan', 'Snooze', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('snoozePlanToday', 'Tomorrow', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('rejectPlan', 'Reject', { planId: plan.planId, ticket: plan.ticketKey }));
    }
    buttons.push(actionButton('viewTicket', 'View', { planId: plan.planId, ticket: plan.ticketKey }));
    buttons.push(actionButton('addEvidence', 'Evidence', { planId: plan.planId, ticket: plan.ticketKey }));
  }
  return actionRow(buttons);
}

function findPlanById(plans: PlannedAction[], planId: string): PlannedAction | undefined {
  return plans.find(plan => plan.planId === planId);
}

async function executePlanPanelAction(
  state: KronosState,
  plans: PlannedAction[],
  request: { command: string; ticket: string; planId: string },
): Promise<void> {
  const plan = findPlanById(plans, request.planId);
  if (!plan) {
    vscode.window.showWarningMessage('That Kronos recommendation is no longer available.');
    return;
  }

  if (request.command === 'startPlan') {
    await startPlannedAction(state, plan);
  } else if (request.command === 'queuePlan' && plan.ticketKey) {
    addPlanToQueue(state, plan, false);
  } else if (request.command === 'pinPlan' && plan.ticketKey) {
    addPlanToQueue(state, plan, true);
  } else if (request.command === 'snoozePlan' && plan.ticketKey) {
    recordPlanDecision(state, plan, 'snoozed', 60);
    vscode.window.showInformationMessage(`Snoozed ${plan.ticketKey} for 1 hour.`);
  } else if (request.command === 'snoozePlanToday' && plan.ticketKey) {
    recordPlanDecision(state, plan, 'snoozed', minutesUntilTomorrow());
    vscode.window.showInformationMessage(`Snoozed ${plan.ticketKey} until tomorrow.`);
  } else if (request.command === 'rejectPlan' && plan.ticketKey) {
    const reason = await vscode.window.showInputBox({
      prompt: `Why reject ${plan.ticketKey}?`,
      placeHolder: 'e.g., not in scope this sprint, blocked by product',
    });
    if (reason === undefined) { return; }
    recordPlanDecision(state, plan, 'rejected', undefined, reason || undefined);
    vscode.window.showInformationMessage(`Rejected ${plan.ticketKey} recommendation.`);
  } else if (request.command === 'viewTicket' && plan.ticketKey) {
    await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey: plan.ticketKey });
  } else if (request.command === 'addEvidence' && plan.ticketKey) {
    await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: plan.ticketKey });
  }
}

function openBacklogTriagePanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosBacklogTriage',
    'Kronos Backlog Triage',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  const render = () => {
    const report = buildBacklogTriageReport({ state: state.state, queue: state.queue });
    panel.webview.html = withWebviewCsp(buildBacklogTriageHtml(report, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, BACKLOG_TRIAGE_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos backlog triage action.');
      return;
    }
    await executeBacklogTriageAction(state, request.command, request.ticket);
    render();
  });
}

function buildBacklogTriageHtml(report: BacklogTriageReport, nonce?: string): string {
  const cards = Object.entries(report.summary)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `<div class="summary-card"><div class="num">${escapeHtml(String(count))}</div><div class="lbl">${escapeHtml(triageKindLabel(kind))}</div></div>`)
    .join('');
  const rows = report.items.map(item => `<tr class="${escapeClass(item.severity)}">
    <td><span class="pill ${escapeClass(item.severity)}">${escapeHtml(item.severity)}</span></td>
    <td><strong>${escapeHtml(item.ticketKey)}</strong><div class="muted">${escapeHtml(item.summary)}</div></td>
    <td>${escapeHtml(triageKindLabel(item.kind))}</td>
    <td>${escapeHtml(item.action)}</td>
    <td>${escapeHtml(item.projects.join(', ') || 'unlinked')}</td>
    <td>${item.ageDays === undefined ? '-' : `${escapeHtml(String(item.ageDays))}d`}</td>
    <td>${escapeHtml(item.detail)}</td>
    <td class="action-cell">${triageActionButtons(item)}</td>
  </tr>`).join('');
  const empty = report.items.length === 0 ? '<div class="kronos-empty">No backlog triage items found.</div>' : '';
  const summaryCards = cards || '<div class="kronos-empty">No active backlog categories.</div>';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  tr.critical td { border-left: 3px solid #f44336; }
  tr.warning td { border-left: 3px solid #ff9800; }
  tr.info td { border-left: 3px solid #4caf50; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Backlog Triage</h1>
      <div class="kronos-subtitle">Generated ${escapeHtml(report.generatedAt)}. Critical items sort first, then oldest tickets.</div>
    </div>
  </div>
  <div class="operator-summary">${summaryCards}</div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Ticket</th><th>Category</th><th>Action</th><th>Projects</th><th>Age</th><th>Detail</th><th>Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function triageKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

function triageActionButtons(item: BacklogTriageReport['items'][number]): string {
  const buttons: string[] = [];
  if (item.kind === 'unlinked') {
    buttons.push(actionButton('linkTicket', 'Link', { ticket: item.ticketKey, primary: true }));
  }
  if (item.kind === 'evidence_gap') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: item.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidence', 'Add Note', { ticket: item.ticketKey }));
  }
  if (['build_failed', 'ready_to_plan', 'stale'].includes(item.kind) && item.projects.length > 0) {
    buttons.push(actionButton('startTicket', 'Start', { ticket: item.ticketKey, primary: item.kind === 'build_failed' }));
    buttons.push(actionButton('addToQueue', 'Queue', { ticket: item.ticketKey }));
  }
  buttons.push(actionButton('viewTicket', 'View', { ticket: item.ticketKey, primary: buttons.length === 0 }));
  return actionRow(buttons);
}

async function executeBacklogTriageAction(state: KronosState, command: string, ticketKey: string): Promise<void> {
  if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey || 'Ticket'} is no longer in Kronos state.`);
    return;
  }
  if (command === 'linkTicket') {
    await vscode.commands.executeCommand('kronos.linkTicket', { ticketKey });
  } else if (command === 'startTicket') {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (command === 'addToQueue') {
    await vscode.commands.executeCommand('kronos.addToQueue', { ticketKey });
  } else if (command === 'addEvidence') {
    await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
  } else if (command === 'addEvidenceCheck') {
    await vscode.commands.executeCommand('kronos.addEvidenceCheck', { ticketKey });
  } else if (command === 'viewTicket') {
    await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey });
  }
}

function openProjectBatchPlanPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosProjectBatchPlan',
    'Kronos Project Batch Plan',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentPlans: PlannedAction[] = [];
  const render = () => {
    currentPlans = planNextActions(state);
    const batches = planByProject(currentPlans, 5).slice(0, 20);
    panel.webview.html = withWebviewCsp(buildProjectBatchPlanHtml(batches, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos project batch action.');
      return;
    }
    await executePlanPanelAction(state, currentPlans, request);
    render();
  });
}

function buildProjectBatchPlanHtml(batches: ProjectBatchPlan[], nonce?: string): string {
  const rows = batches.map(batch => {
    const actions = Object.entries(batch.actionCounts)
      .map(([action, count]) => `${actionToLabel(action)}: ${count}`)
      .join(', ');
    const plans = batch.plans.map(plan => `<tr>
      <td>${escapeHtml(plan.ticketKey || 'Refresh')}</td>
      <td>${escapeHtml(actionToLabel(plan.action))}</td>
      <td>${escapeHtml(String(plan.score))}</td>
      <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
      <td>${escapeHtml(plan.reason)}</td>
      <td class="action-cell">${planActionRow(plan)}</td>
    </tr>`).join('');
    return `<section class="operator-card">
      <div class="operator-card-header"><div class="operator-card-title">${escapeHtml(batch.project)}</div><div class="operator-card-meta">${escapeHtml(String(batch.plans.length))} action(s)</div></div>
      <div class="subtitle">Score ${escapeHtml(String(batch.totalScore))} | estimated ${escapeHtml(String(batch.estimatedMinutes))}m | ${escapeHtml(actions || 'no actions')}</div>
      <div class="table-wrap"><table class="kronos-table"><tr><th>Ticket</th><th>Action</th><th>Score</th><th>Estimate</th><th>Reason</th><th>Actions</th></tr>${plans}</table></div>
    </section>`;
  }).join('');
  const empty = batches.length === 0 ? '<div class="kronos-empty">No project batch plan recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Project Batch Plan</h1>
      <div class="kronos-subtitle">Top grouped recommendations by project</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openReleaseBatchPlanPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosReleaseBatchPlan',
    'Kronos Release Batch Plan',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentPlans: PlannedAction[] = [];
  const render = () => {
    currentPlans = planNextActions(state);
    const batches = planByRelease(currentPlans, 8).slice(0, 20);
    panel.webview.html = withWebviewCsp(buildReleaseBatchPlanHtml(batches, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos release batch action.');
      return;
    }
    await executePlanPanelAction(state, currentPlans, request);
    render();
  });
}

function buildReleaseBatchPlanHtml(batches: ReleaseBatchPlan[], nonce?: string): string {
  const rows = batches.map(batch => {
    const actions = Object.entries(batch.actionCounts)
      .map(([action, count]) => `${actionToLabel(action)}: ${count}`)
      .join(', ');
    const plans = batch.plans.map(plan => `<tr>
      <td>${escapeHtml(plan.ticketKey || 'Refresh')}</td>
      <td>${escapeHtml(actionToLabel(plan.action))}</td>
      <td>${escapeHtml(plan.projects.join(', ') || 'unlinked')}</td>
      <td>${escapeHtml(String(plan.score))}</td>
      <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
      <td>${escapeHtml(plan.reason)}</td>
      <td class="action-cell">${planActionRow(plan)}</td>
    </tr>`).join('');
    return `<section class="operator-card">
      <div class="operator-card-header"><div class="operator-card-title">${escapeHtml(batch.release)}</div><div class="operator-card-meta">${escapeHtml(String(batch.plans.length))} action(s)</div></div>
      <div class="subtitle">Score ${escapeHtml(String(batch.totalScore))} | estimated ${escapeHtml(String(batch.estimatedMinutes))}m | ${escapeHtml(actions || 'no actions')}</div>
      <div class="table-wrap"><table class="kronos-table"><tr><th>Ticket</th><th>Action</th><th>Projects</th><th>Score</th><th>Estimate</th><th>Reason</th><th>Actions</th></tr>${plans}</table></div>
    </section>`;
  }).join('');
  const empty = batches.length === 0 ? '<div class="kronos-empty">No release batch plan recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Release Batch Plan</h1>
      <div class="kronos-subtitle">Top grouped recommendations by release bucket</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

async function openCollisionReportPanel(state: KronosState): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'kronosCollisionReport',
    'Kronos Collision Report',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let plans: PlannedAction[] = [];
  const render = async () => {
    plans = planNextActions(state).slice(0, 25);
    const mrFiles = await loadMrFileHints(state, plans);
    const reports = plans.map(plan => {
      const collisions = detectDispatchCollisions({
        ticketKey: plan.ticketKey,
        projects: plan.projects,
        action: plan.action,
        queue: state.queue,
        runs: listRuns(),
        tickets: state.state?.tickets,
        mrFiles,
        excludeQueueItemId: plan.queueItem?.id,
      });
      return { plan, collisions };
    }).filter(report => report.collisions.length > 0);
    panel.webview.html = withWebviewCsp(buildCollisionReportHtml(reports, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  await render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos collision report action.');
      return;
    }
    await executePlanPanelAction(state, plans, request);
    await render();
  });
}

function buildCollisionReportHtml(reports: Array<{ plan: PlannedAction; collisions: DispatchCollision[] }>, nonce?: string): string {
  const rows = reports.flatMap(report => report.collisions.map(collision => `<tr class="${escapeClass(collision.severity)}">
    <td><span class="pill ${escapeClass(collision.severity)}">${escapeHtml(collision.severity)}</span></td>
    <td>${escapeHtml(report.plan.ticketKey || 'Refresh')}<br><span class="collision-plan-detail">${escapeHtml(actionToLabel(report.plan.action))}</span></td>
    <td>${escapeHtml(collision.kind)}</td>
    <td><strong>${escapeHtml(collision.title)}</strong><div>${escapeHtml(collision.detail)}</div></td>
    <td class="action-cell">${planActionRow(report.plan)}</td>
  </tr>`)).join('');
  const empty = reports.length === 0 ? '<div class="kronos-empty">No collisions found for the top planned actions.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .collision-plan-detail { color: var(--k-muted); }
  .pill.high { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.medium { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.low { color: #4caf50; background: rgba(76,175,80,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Collision Report</h1>
      <div class="kronos-subtitle">Active runs, duplicate queue work, and open merge requests that overlap top planned actions</div>
    </div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Plan</th><th>Kind</th><th>Detail</th><th>Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

async function loadMrFileHints(state: KronosState, targets: Array<{ ticketKey?: string | null; projects: string[]; action: string }>): Promise<Record<string, MergeRequestChangedFile[]>> {
  const tickets = state.state?.tickets || {};
  const projectTargets = new Set<string>();
  const candidateKeys = new Set<string>();

  for (const target of targets) {
    if (!CODE_COLLISION_ACTIONS.has(target.action)) { continue; }
    for (const project of target.projects || []) {
      if (project) { projectTargets.add(project); }
    }
    if (target.ticketKey && tickets[target.ticketKey]?.mr?.state === 'opened') {
      candidateKeys.add(target.ticketKey);
    }
  }

  if (projectTargets.size === 0 && candidateKeys.size === 0) {
    return {};
  }

  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    if (candidateKeys.size >= LIVE_MR_DIFF_LIMIT) { break; }
    if (ticket.mr?.state !== 'opened') { continue; }
    if (ticket.projects?.some(project => projectTargets.has(project))) {
      candidateKeys.add(ticketKey);
    }
  }

  const hints: Record<string, MergeRequestChangedFile[]> = {};
  for (const ticketKey of Array.from(candidateKeys).slice(0, LIVE_MR_DIFF_LIMIT)) {
    try {
      const diff = await gitlabAdapter.mergeRequestDiff(state, ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
      const files = diff.files;
      if (files.length > 0) {
        hints[ticketKey] = files;
      }
    } catch {}
  }
  return hints;
}

function openQueuePlanWindowPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosPlanNextTwoHours',
    'Kronos Plan Next 2 Hours',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentPlans: PlannedAction[] = [];
  const render = () => {
    const window = planForMinutes(planNextActions(state), 120);
    currentPlans = window.plans;
    panel.webview.html = withWebviewCsp(buildQueuePlanModeHtml(
      'Kronos Plan Next 2 Hours',
      `${window.plans.length} action(s), estimated ${window.estimatedMinutes} minutes`,
      window.plans,
      nonce,
    ), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos planning action.');
      return;
    }
    await executePlanPanelAction(state, currentPlans, request);
    render();
  });
}

function openOvernightCandidatesPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosOvernightCandidates',
    'Kronos Overnight Candidates',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  let currentPlans: PlannedAction[] = [];
  const render = () => {
    currentPlans = overnightCandidatePlans(planNextActions(state), 20);
    panel.webview.html = withWebviewCsp(buildQueuePlanModeHtml(
      'Kronos Overnight Candidates',
      `${currentPlans.length} linked implementation/build candidate(s)`,
      currentPlans,
      nonce,
    ), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos overnight candidate action.');
      return;
    }
    await executePlanPanelAction(state, currentPlans, request);
    render();
  });
}

function buildQueuePlanModeHtml(title: string, subtitle: string, plans: PlannedAction[], nonce?: string): string {
  const rows = plans.map((plan, idx) => `<tr>
    <td>${idx + 1}</td>
    <td><strong>${escapeHtml(plan.ticketKey || 'Refresh')}</strong><div class="muted">${escapeHtml(plan.ticketSummary || '')}</div></td>
    <td>${escapeHtml(actionToLabel(plan.action))}</td>
    <td>${escapeHtml(plan.projects.join(', ') || 'unlinked')}</td>
    <td>${escapeHtml(String(plan.score))}</td>
    <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
    <td>${escapeHtml(plan.reason)}</td>
    <td class="action-cell">${planActionRow(plan)}</td>
  </tr>`).join('');
  const empty = plans.length === 0 ? '<div class="kronos-empty">No matching recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(title)}</h1>
      <div class="kronos-subtitle">${escapeHtml(subtitle)}</div>
    </div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>#</th><th>Ticket</th><th>Action</th><th>Projects</th><th>Score</th><th>Estimate</th><th>Reason</th><th>Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openAgentQualityScorePanel(state: KronosState): void {
  const score = computeAgentQualityScore({ runs: listRuns(), tickets: state.state?.tickets || {} });
  const panel = vscode.window.createWebviewPanel(
    'kronosAgentQualityScore',
    'Kronos Agent Quality Score',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildAgentQualityScoreHtml(score, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildAgentQualityScoreHtml(score: AgentQualityScore, nonce?: string): string {
  const componentRows = score.components.map(component => `<tr>
    <td>${escapeHtml(component.label)}</td>
    <td><strong>${escapeHtml(String(component.score))}</strong> / ${escapeHtml(String(component.max))}</td>
    <td>${escapeHtml(component.detail)}</td>
  </tr>`).join('');
  const metricRows = score.metrics.map(metric => `<div class="summary-card"><div class="num">${escapeHtml(metric.value)}</div><div class="lbl">${escapeHtml(metric.label)}</div></div>`).join('');
  const actions = operatorCommandRow([
    actionButton('runCenter', 'Run Center'),
    actionButton('stats', 'Session Stats'),
    actionButton('trendMetrics', 'Trend Metrics'),
    actionButton('evidenceGate', 'Evidence Gate'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Agent Quality Score</h1>
      <div class="kronos-subtitle">Run outcomes, evidence gates, builds, reviews, retries, and handoff readiness</div>
    </div>
  </div>
  ${actions}
  <div class="operator-hero">
    <div><span class="score">${score.score}</span><span class="grade">Grade ${escapeHtml(score.grade)}</span></div>
    <div>${escapeHtml(score.summary)}</div>
  </div>
  <div class="operator-summary">${metricRows}</div>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Component</th><th>Score</th><th>Detail</th></tr>${componentRows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openTrendMetricsPanel(state: KronosState): void {
  const report = computeTrendMetrics({
    runs: listRuns(),
    tickets: state.state?.tickets || {},
    windowDays: trendWindowDaysFromConfig(),
  });
  const panel = vscode.window.createWebviewPanel(
    'kronosTrendMetrics',
    'Kronos Trend Metrics',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildTrendMetricsHtml(report, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildTrendMetricsHtml(report: TrendMetricsReport, nonce?: string): string {
  const metricCards = report.metrics.map(metric => `<div class="summary-card ${escapeClass(metric.status)}">
    <div class="num">${escapeHtml(metric.value)}</div>
    <div class="lbl">${escapeHtml(metric.label)}</div>
    <div class="detail">${escapeHtml(metric.detail)}</div>
  </div>`).join('');
  const rows = report.metrics.map(metric => `<tr class="${escapeClass(metric.status)}">
    <td><span class="pill ${escapeClass(metric.status)}">${escapeHtml(metric.status)}</span></td>
    <td>${escapeHtml(metric.label)}</td>
    <td><strong>${escapeHtml(metric.value)}</strong></td>
    <td>${escapeHtml(metric.detail)}</td>
  </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('runCenter', 'Run Center'),
    actionButton('stats', 'Session Stats'),
    actionButton('agentQualityScore', 'Agent Quality'),
    actionButton('agingReport', 'Aging Report'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .summary-card.good .num { color: #4caf50; }
  .summary-card.warn .num { color: #ff9800; }
  .summary-card.bad .num { color: #f44336; }
  .pill.good { color: #4caf50; background: rgba(76,175,80,0.16); }
  .pill.warn { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.bad { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.neutral { color: var(--vscode-foreground); background: rgba(128,128,128,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Trend Metrics</h1>
      <div class="kronos-subtitle">${escapeHtml(report.summary)} ${report.runsConsidered} run(s), ${report.ticketsConsidered} ticket(s), ${report.windowDays}-day window.</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">${metricCards}</div>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Metric</th><th>Value</th><th>Detail</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openAgingReportPanel(state: KronosState): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosAgingReport',
    'Kronos Aging Report',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  const render = () => {
    const report = analyzeAging({
      tickets: state.state?.tickets || {},
      thresholds: agingThresholdsFromConfig(),
    });
    panel.webview.html = withWebviewCsp(buildAgingReportHtml(report, {
      actionsHtml: operatorCommandRow([
        actionButton('refreshPanel', 'Refresh'),
        actionButton('queuePlanner', 'Queue Planner'),
        actionButton('humanReviewInbox', 'Human Review'),
        actionButton('trendMetrics', 'Trend Metrics'),
        actionButton('evidenceGate', 'Evidence Gate'),
      ]),
      scriptHtml: kronosActionPanelScript(nonce),
    }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos aging report action.');
      return;
    }
    if (request.command === 'refreshPanel') {
      state.reloadAndNotify();
      render();
      return;
    }
    await executeOperatorCommandAction(request.command, request.ticket);
  });
}

function openIntegrationManifestPanel(): void {
  const status = readIntegrationManifest();
  const audit = auditIntegrationManifest(status);
  const panel = vscode.window.createWebviewPanel(
    'kronosIntegrationManifest',
    'Kronos Integration Manifest',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildIntegrationManifestHtml(status, audit, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

async function snapshotIntegrationManifest(): Promise<void> {
  const canSnapshot = await confirmSafetyGate({
    command: 'kronos.snapshotIntegrationManifest',
    title: 'Snapshot Integration Manifest',
    target: INTEGRATION_MANIFEST_FILE,
    risks: ['state-write'],
    changes: [
      'Write a manifest snapshot with SHA-256 hashes for the current script bundle.',
      'Write SHA-256 hashes for global prompt templates in the Kronos prompt directory.',
      'Use the snapshot as the future drift baseline for Doctor and Integration Manifest.',
    ],
    warnings: ['Existing manifest contents will be replaced by the current local snapshot.'],
    confirmationLabel: 'Snapshot Manifest',
  });
  if (!canSnapshot) { return; }

  try {
    const result = writeIntegrationManifestSnapshot();
    const action = await vscode.window.showInformationMessage(
      `Snapshot integration manifest written. ${result.audit.summary}`,
      'Open Manifest',
      'Run Doctor'
    );
    if (action === 'Open Manifest') {
      await openTextFileIfExists(result.path, 'Integration manifest not found.');
    } else if (action === 'Run Doctor') {
      vscode.commands.executeCommand('kronos.doctor');
    }
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to snapshot integration manifest.'));
  }
}

function buildIntegrationManifestHtml(status: IntegrationManifestStatus, audit: IntegrationManifestAudit, nonce?: string): string {
  const artifactByKey = new Map(audit.artifacts.map(artifact => [`${artifact.kind}:${artifact.name}`, artifact]));
  const hashCell = (artifact: IntegrationManifestAudit['artifacts'][number] | undefined) => {
    if (!artifact) {
      return '<span class="pill warn">UNCHECKED</span>';
    }
    const hashes = [
      artifact.expectedSha256 ? `expected ${artifact.expectedSha256.substring(0, 12)}` : '',
      artifact.actualSha256 ? `actual ${artifact.actualSha256.substring(0, 12)}` : '',
    ].filter(Boolean).join(', ');
    return `<span class="pill ${artifact.status}">${artifact.status.toUpperCase()}</span><br><span class="hash-detail">${escapeHtml(artifact.detail)}${hashes ? ` ${escapeHtml(hashes)}` : ''}</span>`;
  };
  const scripts = requiredScripts().map(script => {
    const entry = status.manifest?.scripts?.[script.name];
    const artifact = artifactByKey.get(`script:${script.name}`);
    return `<tr>
      <td>${escapeHtml(script.name)}</td>
      <td><span class="pill ${script.present ? 'pass' : 'fail'}">${script.present ? 'PRESENT' : 'MISSING'}</span></td>
      <td>${hashCell(artifact)}</td>
      <td>${escapeHtml(entry?.version || '-')}</td>
      <td>${escapeHtml(entry?.sha256 || '-')}</td>
      <td>${escapeHtml(script.path)}</td>
    </tr>`;
  }).join('');
  const prompts = Object.entries(status.manifest?.prompts || {}).map(([name, entry]) => {
    const artifact = artifactByKey.get(`prompt:${name}`);
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(entry.required ? 'required' : 'optional')}</td>
      <td>${hashCell(artifact)}</td>
      <td>${escapeHtml(entry.sha256 || '-')}</td>
    </tr>`;
  }).join('');
  const providers = Object.entries(status.manifest?.providers || {}).map(([name, entry]) => `<tr>
    <td>${escapeHtml(name)}</td>
    <td>${escapeHtml(entry.enabled === false ? 'disabled' : 'enabled')}</td>
    <td>${escapeHtml(entry.baseUrl || '-')}</td>
  </tr>`).join('');
  const messages = [...status.errors.map(error => ({ status: 'fail', text: error })), ...status.warnings.map(warning => ({ status: 'warn', text: warning }))];
  const messageRows = messages.map(message => `<div class="message ${message.status}">${escapeHtml(message.text)}</div>`).join('');
  const auditSummary = `<div class="message ${audit.status}">${escapeHtml(`Hash audit: ${audit.summary}`)}</div>`;
  const manifestPillClass = !status.present ? 'warn' : status.valid ? 'pass' : 'fail';
  const manifestPillLabel = status.present ? (status.valid ? 'VALID' : 'INVALID') : 'MISSING';
  const actions = operatorCommandRow([
    actionButton('snapshotIntegrationManifest', 'Snapshot'),
    actionButton('doctor', 'Doctor'),
    actionButton('profiles', 'Profiles'),
    actionButton('promptManager', 'Prompt Manager'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Integration Manifest</h1>
      <div class="kronos-subtitle">Script, prompt, and provider drift audit for the local integration bundle</div>
    </div>
    <span class="pill ${manifestPillClass}">${manifestPillLabel}</span>
  </div>
  ${actions}
  <div class="path">${escapeHtml(status.path)}</div>
  ${messageRows}
  ${auditSummary}
  <div class="operator-section"><h2>Required Scripts</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Script</th><th>Status</th><th>Hash Status</th><th>Version</th><th>Manifest SHA-256</th><th>Path</th></tr>${scripts}</table></div></div>
  <div class="operator-section"><h2>Prompts</h2>
  ${prompts ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Prompt</th><th>Required</th><th>Hash Status</th><th>Manifest SHA-256</th></tr>${prompts}</table></div>` : '<div class="kronos-empty">No prompt manifest entries.</div>'}</div>
  <div class="operator-section"><h2>Providers</h2>
  ${providers ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Provider</th><th>Status</th><th>Base URL</th></tr>${providers}</table></div>` : '<div class="kronos-empty">No provider manifest entries.</div>'}</div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openProfilesPanel(): void {
  const active = getActiveProfile();
  const panel = vscode.window.createWebviewPanel(
    'kronosProfiles',
    'Kronos Profiles',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  panel.webview.html = withWebviewCsp(buildProfilesHtml(active, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel);
}

function buildProfilesHtml(active: KronosProfile, nonce?: string): string {
  const rows = listProfiles().map(profile => {
    const providers = Object.entries(profile.providers)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ') || 'none';
    return `<tr class="${profile.id === active.id ? 'active' : ''}">
      <td>${escapeHtml(profile.label)}${profile.id === active.id ? ' <span class="pill pass profile-active-pill">ACTIVE</span>' : ''}</td>
      <td>${escapeHtml(profile.defaultBaseBranch)}</td>
      <td>${escapeHtml(providers)}</td>
      <td>${escapeHtml(profile.description)}</td>
    </tr>`;
  }).join('');
  const actions = operatorCommandRow([
    actionButton('settings', 'Settings'),
    actionButton('doctor', 'Doctor'),
    actionButton('integrationManifest', 'Manifest'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  tr.active { background: var(--vscode-textBlockQuote-background); }
  .profile-active-pill { margin-left: 6px; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Profiles</h1>
      <div class="kronos-subtitle">Current profile, default branch behavior, and enabled provider groups</div>
    </div>
  </div>
  ${actions}
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Profile</th><th>Default Branch</th><th>Providers</th><th>Description</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function openDoctorPanel(state: KronosState): void {
  const checks = runDoctorChecks(state);
  const panel = vscode.window.createWebviewPanel(
    'kronosDoctor',
    'Kronos Doctor',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );
  const nonce = createWebviewNonce();
  attachOperatorCommandHandler(panel);
  const pendingCheck: DoctorCheck = {
    name: 'Provider network reachability',
    status: 'warn',
    detail: 'Checking configured provider endpoints...',
  };
  const render = (currentChecks: DoctorCheck[]) => {
    panel.webview.html = withWebviewCsp(buildDoctorHtml(currentChecks, nonce), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render([...checks, pendingCheck]);
  runDoctorReachabilityChecks(state)
    .then(reachabilityChecks => render([...checks, ...reachabilityChecks]))
    .catch((e: unknown) => render([...checks, {
      name: 'Provider network reachability',
      status: 'fail',
      detail: unknownErrorMessage(e, 'Provider reachability checks failed.'),
    }]));
}

function doctorChecksInput(state: KronosState) {
  const model = vscode.workspace.getConfiguration('kronos').get<string>('dispatchModel', 'claude-opus-4-6');
  return {
    state: state.state,
    queue: state.queue,
    stateLoadErrors: state.loadIssues,
    sessionStoreIssues: listSessionStoreIssues(),
    profile: getActiveProfile(),
    requiredPrompts: REQUIRED_PROMPTS,
    dispatchModel: model,
  };
}

function runDoctorChecks(state: KronosState): DoctorCheck[] {
  return collectDoctorChecks(doctorChecksInput(state));
}

async function runDoctorReachabilityChecks(state: KronosState): Promise<DoctorCheck[]> {
  return collectDoctorReachabilityChecks(doctorChecksInput(state), { timeoutMs: 5000 });
}

function buildDoctorHtml(checks: DoctorCheck[], nonce?: string): string {
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
  };
  const rows = checks.map(c => `<tr class="${c.status}">
    <td><span class="pill ${c.status}">${c.status.toUpperCase()}</span></td>
    <td>${escapeHtml(c.name)}</td>
    <td>${escapeHtml(c.detail)}</td>
  </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('setup', 'Auth Check'),
    actionButton('settings', 'Settings'),
    actionButton('integrationManifest', 'Manifest'),
    actionButton('profiles', 'Profiles'),
    actionButton('recoveryCenter', 'Recovery'),
    actionButton('stateAuditLog', 'Audit Log'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Doctor</h1>
      <div class="kronos-subtitle">Commands, credentials, project config, state integrity, and provider reachability</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${summary.pass}</div><div class="lbl">Passing</div></div>
    <div class="summary-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${summary.fail}</div><div class="lbl">Failing</div></div>
  </div>
  <div class="table-wrap kronos-panel"><table class="kronos-table">
    <tr><th>Status</th><th>Check</th><th>Detail</th></tr>
    ${rows}
  </table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

async function startPlannedAction(
  state: KronosState,
  plan: PlannedAction,
  context = buildNextActionContext(plan, { state: state.state, queue: state.queue }),
): Promise<void> {
  const startDecision = buildNextActionStartDecision(plan, context);
  if (!startDecision.allowed) {
    vscode.window.showWarningMessage(startDecision.reason || 'Planned action is blocked.');
    return;
  }
  if (startDecision.safetyPlan) {
    const confirmed = await confirmSafetyGate(startDecision.safetyPlan);
    if (!confirmed) { return; }
  }
  if (startDecision.commandId === 'kronos.refresh') {
    vscode.window.showInformationMessage(`Starting: ${startDecision.safetyPlan?.target || 'refresh'}`);
    if (startDecision.refreshProjects.length > 0) {
      for (const project of startDecision.refreshProjects) { await state.refresh(project); }
    } else {
      await state.refresh();
    }
    return;
  }
  await vscode.commands.executeCommand('kronos.startQueueItem', { item: planToQueueItem(state, plan) });
}

function addPlanToQueue(state: KronosState, plan: PlannedAction, pinTop: boolean): void {
  const result = addPlanToQueueState(plan, { pinTop });
  state.reloadAndNotify();
  const label = plan.ticketKey || plan.action;
  if (result.alreadyQueued && result.pinned) {
    vscode.window.showInformationMessage(`Pinned ${label} to the top of the queue.`);
  } else if (result.alreadyQueued) {
    vscode.window.showInformationMessage(`${label} is already in the queue.`);
  } else {
    vscode.window.showInformationMessage(`${pinTop ? 'Pinned' : 'Added'} ${label} ${pinTop ? 'to the top of' : 'to'} the queue.`);
  }
}

function recordPlanDecision(
  state: KronosState,
  plan: PlannedAction,
  decision: 'rejected' | 'snoozed',
  snoozeMinutes?: number,
  reason?: string
): void {
  recordPlanQueueDecision(plan, decision, {
    snoozeMinutes,
    reason,
  });
  state.reloadAndNotify();
}

function minutesUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / (60 * 1000)));
}

function evidenceCountForTicket(state: KronosState, ticketKey: string): number {
  const ticket = state.state?.tickets?.[ticketKey];
  return ticket ? ticketEvidenceItemCount(ticket) : 0;
}

function ticketEvidenceItemCount(ticket: Ticket): number {
  return evidenceNotes(ticket).length + evidenceChecks(ticket).length + evidenceEnvironmentResults(ticket).length;
}

function ticketStringField(record: object | null | undefined, key: string, fallback = ''): string {
  const value = record ? Reflect.get(record, key) : undefined;
  return value === undefined || value === null ? fallback : String(value);
}

function ticketStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function ticketRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function existingAcceptanceCriterion(record: object): ExistingAcceptanceCriterion | undefined {
  const text = evidenceString(record, 'text');
  if (!text) { return undefined; }
  const source = evidenceString(record, 'source');
  return {
    id: evidenceString(record, 'id') || undefined,
    text,
    checked: evidenceChecked(record),
    source: source === 'description' || source === 'manual' ? source : undefined,
  };
}

function ticketAttachments(value: unknown): Array<{ filename: string; size: number; mimeType: string }> {
  if (!Array.isArray(value)) { return []; }
  return value
    .filter(item => ticketRecord(item))
    .map(item => ({
      filename: ticketStringField(item, 'filename', 'attachment'),
      size: Number.isFinite(Number(item.size)) ? Number(item.size) : 0,
      mimeType: ticketStringField(item, 'mimeType'),
    }));
}

async function removeTicketFromQueue(state: KronosState, ticketKey: string, interactive: boolean): Promise<boolean> {
  const ticket = state.state?.tickets?.[ticketKey];
  const gate = ticket ? evaluateEvidenceGate(ticketKey, ticket) : undefined;
  if (ticket && gate?.status === 'fail') {
    const failing = gate.checks.filter(check => check.status === 'fail').map(check => check.title).join('; ');
    if (!interactive) {
      vscode.window.showWarningMessage(`${ticketKey} stayed in queue because its evidence gate is failing: ${failing}`);
      return false;
    }
    const action = await vscode.window.showWarningMessage(
      `${ticketKey} has failing evidence gate checks: ${failing}`,
      'Open Gate',
      'Remove Anyway',
      'Cancel'
    );
    if (action === 'Open Gate') {
      openEvidenceGatePanel(state, [gate], `Evidence Gate: ${ticketKey}`);
      return false;
    }
    if (action !== 'Remove Anyway') {
      return false;
    }
  }
  if (ticket && evidenceCountForTicket(state, ticketKey) === 0) {
    if (!interactive) {
      vscode.window.showWarningMessage(`${ticketKey} stayed in queue because it has no evidence notes.`);
      return false;
    }
    const action = await vscode.window.showWarningMessage(
      `${ticketKey} has no evidence notes. Removing it from the queue will make the work harder to audit.`,
      'Add Evidence',
      'Remove Anyway',
      'Cancel'
    );
    if (action === 'Add Evidence') {
      await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
      return false;
    }
    if (action !== 'Remove Anyway') {
      return false;
    }
  }

  const result = removeTicketFromQueueState(ticketKey);
  state.reloadAndNotify();
  if (interactive && result.removed === 0) {
    vscode.window.showInformationMessage(`${ticketKey} was not in the queue.`);
  }
  return true;
}

function planNextActions(state: KronosState): PlannedAction[] {
  return buildNextActionPlan({ state: state.state, queue: state.queue });
}

function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem {
  return buildQueueItemFromPlan({
    state: state.state,
    queue: state.queue,
    resolveProjectPath: projectName => getProjectPath(state, projectName),
  }, plan);
}

function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void> {
  return async (_code: number, run: KronosRun) => {
    const resolvedTicketKey = ticketKey || run.ticket || undefined;
    if (projectName) {
      await state.refresh(projectName);
    } else if (resolvedTicketKey) {
      state.reloadAndNotify();
    }
    if (resolvedTicketKey) {
      let ticket = state.state?.tickets[resolvedTicketKey];
      if (shouldRecordRunCompletionEvidence({ run, ticket })) {
        try {
          addTicketEvidenceNote(resolvedTicketKey, {
            kind: 'note',
            text: buildRunCompletionEvidenceText(run),
          });
          state.reloadAndNotify();
          ticket = state.state?.tickets[resolvedTicketKey];
        } catch (e: unknown) {
          vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to add run completion evidence.'));
        }
      }
      run.readiness = evaluatePostRunReadiness({ run, ticketKey: resolvedTicketKey, ticket });
      run.failureKind = run.readiness.failureKind;
      if (run.status === 'completed' && run.readiness.status === 'ready') {
        run.status = 'waiting_for_review';
      } else if (run.status === 'completed' && run.readiness.status === 'needs_human') {
        run.status = 'needs_human';
      }
      writeRunRecord(run);
      if (ticket && ['await_review', 'done', 'deploy_monitor'].includes(ticket.next_action)) {
        await removeTicketFromQueue(state, resolvedTicketKey, false);
      }
      await showRunCompletionToast(resolvedTicketKey, ticket, run);
    } else {
      run.readiness = evaluatePostRunReadiness({ run });
      run.failureKind = run.readiness.failureKind;
      writeRunRecord(run);
    }
  };
}

async function showRunCompletionToast(ticketKey: string, ticket: Ticket | undefined, run: KronosRun): Promise<void> {
  if (run.status !== 'waiting_for_review') { return; }
  const skill = run.skill || 'run';
  const reviewTarget = ticket?.mr ? `MR !${ticket.mr.iid} ready for review` : 'ready for review';
  const action = await vscode.window.showInformationMessage(
    `${ticketKey} ${skill} completed - ${reviewTarget}.`,
    'Open Review',
    'Run Center'
  );
  if (action === 'Open Review') {
    if (ticket?.mr) {
      await vscode.commands.executeCommand('kronos.openMrDiff', { ticketKey, ticket });
    } else {
      await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey });
    }
  } else if (action === 'Run Center') {
    await vscode.commands.executeCommand('kronos.runCenter');
  }
}

async function confirmDispatchCollisions(state: KronosState, target: {
  ticketKey?: string | null;
  projects: string[];
  action: string;
  excludeQueueItemId?: string;
}): Promise<boolean> {
  const mrFiles = await loadMrFileHints(state, [target]);
  const collisions = detectDispatchCollisions({
    ...target,
    queue: state.queue,
    runs: listRuns(),
    tickets: state.state?.tickets,
    mrFiles,
  });
  if (collisions.length === 0) { return true; }

  const detail = collisions.slice(0, 5)
    .map(c => `${collisionSeverityLabel(c.severity)} ${c.title}: ${c.detail}`)
    .join('\n');
  const more = collisions.length > 5 ? `\n...and ${collisions.length - 5} more.` : '';
  const action = await vscode.window.showWarningMessage(
    `Potential Kronos work collision:\n${detail}${more}`,
    { modal: true },
    'Start Anyway',
    'Open Run Center',
    'Cancel'
  );
  if (action === 'Open Run Center') {
    openInteractiveRunCenter(state);
    return false;
  }
  return action === 'Start Anyway';
}

function collisionSeverityLabel(severity: DispatchCollision['severity']): string {
  if (severity === 'high') { return '[HIGH]'; }
  if (severity === 'medium') { return '[MED]'; }
  return '[LOW]';
}

function getProjectPath(state: KronosState, projectName?: string): string | undefined {
  if (!projectName || !state.state) { return undefined; }
  return state.state.projects[projectName]?.path;
}

function getActiveProfile(): KronosProfile {
  const config = vscode.workspace.getConfiguration('kronos');
  return resolveProfile(config.get<string>('profile'));
}

function getProjectBaseBranch(state: KronosState, projectName?: string): string {
  const config = vscode.workspace.getConfiguration('kronos');
  const configDefault = resolveDefaultBaseBranch(config.get<string>('profile'), config.get<string>('defaultBaseBranch'));
  if (!projectName || !state.state) { return sanitizeBranchName(configDefault); }
  const projectConfig = state.state.projects[projectName]?.config;
  return sanitizeBranchName(projectConfig?.base_branch || projectConfig?.default_branch || configDefault);
}

function sanitizeBranchName(branch: string): string {
  return sanitizeProfileBranch(branch) || 'develop';
}

function resolveProjectName(state: KronosState, item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const projectName = record.projectName;
  if (typeof projectName === 'string' && projectName.trim()) { return projectName; }
  const ticket = recordFromUnknown(record.ticket);
  const ticketProjects = ticket.projects;
  if (Array.isArray(ticketProjects) && typeof ticketProjects[0] === 'string' && ticketProjects[0].trim()) {
    return ticketProjects[0];
  }
  const ticketKey = record.ticketKey;
  if (typeof ticketKey === 'string' && state.state) {
    const t = state.state.tickets[ticketKey];
    if (t?.projects?.length) { return t.projects[0]; }
  }
  return undefined;
}

function resolveTicketKey(item: unknown): string | undefined {
  if (typeof item === 'string') { return item; }
  const record = recordFromUnknown(item);
  if (typeof record.ticketKey === 'string') { return record.ticketKey; }
  const nestedItem = recordFromUnknown(record.item);
  if (typeof nestedItem.ticket === 'string') { return nestedItem.ticket; }
  if (typeof record.ticket === 'string') { return record.ticket; }
  return undefined;
}

function startReviewAutomation(context: vscode.ExtensionContext, state: KronosState): void {
  const config = vscode.workspace.getConfiguration('kronos');
  const fallbackSec = positiveConfigNumber(config.get<number>('pollIntervalSec', 300), 300);
  const pollSec = Math.max(60, positiveConfigNumber(config.get<number>('reviewPollIntervalSec', fallbackSec), fallbackSec));
  let running = false;
  const poll = async () => {
    if (running) { return; }
    running = true;
    try {
      await pollReviewMergeRequests(state);
    } finally {
      running = false;
    }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, pollSec * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function positiveConfigNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

async function pollReviewMergeRequests(state: KronosState): Promise<void> {
  for (const candidate of reviewMergeRequestCandidates(state)) {
    try {
      const status = await gitlabAdapter.mergeRequestStatus(state, candidate.ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
      const update = updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status });
      if (update.changed) {
        state.reloadAndNotify();
      }
      if (update.mergedNow) {
        await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket);
      } else if (update.closedNow) {
        void vscode.window.showWarningMessage(`${candidate.ticketKey} MR closed - ticket moved to blocked.`);
      }
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, `Failed to poll MR status for ${candidate.ticketKey}.`));
    }
  }
}

type TicketWithOpenMergeRequest = Ticket & { mr: NonNullable<Ticket['mr']> };

function reviewMergeRequestCandidates(state: KronosState): Array<{ ticketKey: string; ticket: TicketWithOpenMergeRequest }> {
  if (!state.state) { return []; }
  return Object.entries(state.state.tickets || {})
    .filter(isOpenReviewMergeRequestEntry)
    .map(([ticketKey, ticket]) => ({ ticketKey, ticket }));
}

function isOpenReviewMergeRequestEntry(entry: [string, Ticket]): entry is [string, TicketWithOpenMergeRequest] {
  return entry[1].next_action === 'await_review' && entry[1].mr?.state === 'opened';
}

type ReviewBranchTicket = { key: string; summary: string; mr: TicketWithOpenMergeRequest['mr']; projects: string[] };

function reviewBranchTickets(state: KronosState): ReviewBranchTicket[] {
  return reviewMergeRequestCandidates(state).map(({ ticketKey, ticket }) => ({
    key: ticketKey,
    summary: ticket.summary,
    mr: ticket.mr,
    projects: ticket.projects,
  }));
}

async function startDeployMonitorForMergedTicket(state: KronosState, ticketKey: string, ticket: Ticket): Promise<void> {
  const projectName = ticket.projects?.[0];
  const projectPath = getProjectPath(state, projectName);
  if (!projectName || !projectPath || hasActiveDeployMonitorRun(projectName, projectPath, ticketKey)) { return; }
  await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey, {
    onComplete: refreshAfterDispatch(state, projectName, ticketKey),
    noWorktree: true,
    projectNameOverride: projectName,
  });
  void vscode.window.showInformationMessage(`${ticketKey} merged - deploy monitor started.`);
}

function hasActiveDeployMonitorRun(projectName: string, projectPath: string, ticketKey: string): boolean {
  return listRuns().some(run => isActiveRun(run)
    && run.skill === 'deploy-monitor'
    && (run.project === projectName || run.projectPath === projectPath)
    && (!run.ticket || run.ticket === ticketKey));
}

async function pickProjectFromTickets<T extends { key: string; projects: string[] }>(
  state: KronosState,
  tickets: T[],
  placeHolder: string,
  countLabel = 'tickets',
): Promise<{ projectName: string; projectPath: string; tickets: T[] } | null> {
  const byProject: Record<string, T[]> = {};
  for (const t of tickets) {
    for (const p of t.projects) {
      if (!byProject[p]) { byProject[p] = []; }
      if (!byProject[p].some(x => x.key === t.key)) { byProject[p].push(t); }
    }
  }

  let projectName: string;
  const projectNames = Object.keys(byProject);
  if (projectNames.length === 0) { return null; }
  if (projectNames.length === 1) { projectName = projectNames[0]; }
  else {
    const pick = await vscode.window.showQuickPick(
      projectNames.map(p => ({ label: p, description: `${byProject[p].length} ${countLabel}` })),
      { placeHolder }
    );
    if (!pick) { return null; }
    projectName = pick.label;
  }

  const projectPath = getProjectPath(state, projectName);
  if (!projectPath) { return null; }

  return { projectName, projectPath, tickets: byProject[projectName] };
}

function updateStatusBar(state: KronosState): void {
  if (state.loadIssues.length > 0) {
    statusBarItem.text = state.state ? '$(warning) Kronos: state warnings' : '$(error) Kronos: state error';
    statusBarItem.tooltip = state.loadIssues.map(issue => `${issue.target}: ${issue.detail}`).join('\n');
    statusBarItem.command = 'kronos.openDashboard';
    return;
  }
  if (!state.state) {
    statusBarItem.text = '$(clock) Kronos';
    statusBarItem.tooltip = 'Kronos state is not loaded.';
    statusBarItem.command = 'kronos.openDashboard';
    return;
  }
  const projects = state.state.projects;
  const count = Object.keys(projects).length;
  const sessions = state.sessions.length;
  const activeRuns = listRuns().filter(isActiveRun);
  if (activeRuns.length > 0) {
    statusBarItem.text = `$(sync~spin) Kronos: ${activeRuns.length} running`;
    statusBarItem.tooltip = `Kronos active runs: ${activeRunSummary(activeRuns) || `${activeRuns.length} running`}`;
    statusBarItem.command = 'kronos.runCenter';
    return;
  }
  const greens = Object.values(projects).filter(p => p.health === 'green').length;
  const reds = Object.values(projects).filter(p => p.health === 'red').length;
  const yellows = Object.values(projects).filter(p => p.health === 'yellow').length;

  let health = '';
  if (reds > 0) { health += ` ${reds} red`; }
  if (yellows > 0) { health += ` ${yellows} yellow`; }
  if (greens > 0) { health += ` ${greens} green`; }

  statusBarItem.text = `$(clock) Kronos: ${sessions} sessions |${health || ` ${count} projects`}`;
  statusBarItem.tooltip = `Kronos — ${count} projects tracked, ${sessions} active sessions`;
  statusBarItem.command = 'kronos.openDashboard';
}

function dashboardBriefRecord(brief: unknown): Record<string, unknown> {
  return Boolean(brief) && typeof brief === 'object' && !Array.isArray(brief) ? brief as Record<string, unknown> : {};
}

function dashboardBriefItems(brief: Record<string, unknown>, key: string): unknown[] {
  const value = brief[key];
  return Array.isArray(value) ? value : [];
}

function dashboardBriefCount(brief: Record<string, unknown>, key: string): number {
  const value = brief[key];
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function executeDashboardAction(command: string): Promise<void> {
  if (command === 'nextBestAction') {
    await vscode.commands.executeCommand('kronos.nextBestAction');
  } else if (command === 'queuePlanner') {
    await vscode.commands.executeCommand('kronos.queuePlanner');
  } else if (command === 'runCenter') {
    await vscode.commands.executeCommand('kronos.runCenter');
  } else if (command === 'humanReviewInbox') {
    await vscode.commands.executeCommand('kronos.humanReviewInbox');
  } else if (command === 'evidenceGate') {
    await vscode.commands.executeCommand('kronos.evidenceGate');
  } else if (command === 'recoveryCenter') {
    await vscode.commands.executeCommand('kronos.recoveryCenter');
  }
}

function buildDashboardHtml(state: KronosState, brief: unknown, nonce?: string): string {
  const safeBrief = dashboardBriefRecord(brief);
  const projects = state.state?.projects || {};

  const allTickets = state.state?.tickets || {};
  const runs = listRuns();
  const activeRuns = runs.filter(isActiveRun).length;
  const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'cancelled').length;
  const needsHumanRuns = runs.filter(r => r.status === 'needs_human').length;
  const waitingForReviewRuns = runs.filter(r => r.status === 'waiting_for_review').length;
  const evidenceGates = evaluateEvidenceGates(allTickets);
  const evidenceGateFailures = evidenceGates.filter(gate => gate.status === 'fail').length;
  const evidenceGateWarnings = evidenceGates.filter(gate => gate.status === 'warn').length;
  const qualityScore = computeAgentQualityScore({ runs, tickets: allTickets });
  const agingReport = analyzeAging({ tickets: allTickets, thresholds: agingThresholdsFromConfig() });
  const humanReviewInbox = buildHumanReviewInbox({ state: state.state, queue: state.queue, runs });
  const worklistLanes = buildDashboardWorklist({ runs, humanReviewInbox, evidenceGates, agingReport });
  const trendReport = computeTrendMetrics({ runs, tickets: allTickets, windowDays: trendWindowDaysFromConfig() });
  const trendMetric = (label: string) => trendReport.metrics.find(metric => metric.label === label);
  const reworkMetric = trendMetric('Rework rate');
  const buildPassMetric = trendMetric('Build pass rate');
  const cycleMetric = trendMetric('Average cycle time');
  const nextPlan = planNextActions(state)[0];
  const nextContext = nextPlan ? buildNextActionContext(nextPlan, { state: state.state, queue: state.queue }) : undefined;
  const dashboardActions = actionRow([
    actionButton('nextBestAction', 'Next Best Action', { primary: true }),
    actionButton('refreshPanel', 'Refresh'),
    actionButton('queuePlanner', 'Queue Planner'),
    actionButton('runCenter', 'Run Center'),
    actionButton('humanReviewInbox', 'Human Review'),
    actionButton('evidenceGate', 'Evidence Gate'),
    actionButton('recoveryCenter', 'Recovery'),
  ]);
  const cockpitHtml = `<div class="cockpit">
    <div class="metric"><div class="num">${qualityScore.score}</div><div class="lbl">Agent Quality</div></div>
    <div class="metric ${escapeClass(reworkMetric?.status || 'neutral')}"><div class="num">${escapeHtml(reworkMetric?.value || 'n/a')}</div><div class="lbl">Rework Rate</div></div>
    <div class="metric ${escapeClass(buildPassMetric?.status || 'neutral')}"><div class="num">${escapeHtml(buildPassMetric?.value || 'n/a')}</div><div class="lbl">Build Pass</div></div>
    <div class="metric ${escapeClass(cycleMetric?.status || 'neutral')}"><div class="num">${escapeHtml(cycleMetric?.value || 'n/a')}</div><div class="lbl">Avg Cycle</div></div>
    <div class="metric"><div class="num">${activeRuns}</div><div class="lbl">Active Runs</div></div>
    <div class="metric ok"><div class="num">${waitingForReviewRuns}</div><div class="lbl">Waiting Review</div></div>
    <div class="metric warn"><div class="num">${needsHumanRuns}</div><div class="lbl">Needs Human</div></div>
    <div class="metric fail"><div class="num">${failedRuns}</div><div class="lbl">Failed/Cancelled</div></div>
    <div class="metric fail"><div class="num">${evidenceGateFailures}</div><div class="lbl">Gate Fails</div></div>
    <div class="metric warn"><div class="num">${evidenceGateWarnings}</div><div class="lbl">Gate Warnings</div></div>
    <div class="metric fail"><div class="num">${agingReport.summary.critical}</div><div class="lbl">Stale Critical</div></div>
    <div class="metric warn"><div class="num">${agingReport.summary.warning}</div><div class="lbl">Stale Warnings</div></div>
    <div class="next-action">
      <div class="lbl">Next Best Action</div>
      <strong>${nextPlan ? `${escapeHtml(nextPlan.ticketKey || 'Refresh')} - ${escapeHtml(actionToLabel(nextPlan.action))}` : 'No actionable work'}</strong>
      ${nextPlan ? `<div>${escapeHtml(nextPlan.reason)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Command:</strong> ${escapeHtml(nextContext.commandLabel)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Risk:</strong> ${escapeHtml(nextContext.risks.join(', '))}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>${nextContext.blockers.length ? 'Blocked' : 'Preflight'}:</strong> ${escapeHtml((nextContext.blockers.length ? nextContext.blockers : nextContext.preflight).join('; '))}</div>` : ''}
      <div class="next-action-controls">${dashboardActions}</div>
    </div>
  </div>`;
  const projectCards = Object.entries(projects).map(([name, proj]) => {
    const healthColor = proj.health === 'green' ? '#4caf50' : proj.health === 'yellow' ? '#ff9800' : proj.health === 'red' ? '#f44336' : '#666';
    const linkedCount = Object.values(allTickets).filter(t => t.projects?.includes(name)).length;
    return `<div class="project-card kronos-panel pad">
      <div class="card-header"><span class="health-dot" style="background:${healthColor}"></span> ${escapeHtml(name)}</div>
      <div class="card-body">${escapeHtml(proj.summary)}<br><small>${linkedCount} tickets | ${proj.open_mr_count} open MRs</small></div>
    </div>`;
  }).join('');

  const completedBrief = dashboardBriefItems(safeBrief, 'completed').map((r: unknown) => escapeHtml(String(r))).join(', ');
  const attentionBrief = dashboardBriefItems(safeBrief, 'needs_attention').map((r: unknown) => escapeHtml(String(r))).join(', ');
  const overnightActions = dashboardBriefCount(safeBrief, 'overnight_actions');
  const vpnDrops = dashboardBriefCount(safeBrief, 'vpn_drops');
  const briefHtml = overnightActions > 0
    ? `<div class="brief">
        <h3>Overnight Summary</h3>
        <p>${escapeHtml(String(overnightActions))} actions, ${escapeHtml(String(vpnDrops))} VPN drops</p>
        ${completedBrief ? `<p><strong>Completed:</strong> ${completedBrief}</p>` : ''}
        ${attentionBrief ? `<p><strong>Needs Attention:</strong> ${attentionBrief}</p>` : ''}
      </div>`
    : '';

  const readyItems = dashboardBriefItems(safeBrief, 'ready_to_go').map((r: unknown) => `<li>${escapeHtml(String(r))}</li>`).join('');
  const attentionItems = dashboardBriefItems(safeBrief, 'needs_attention').map((r: unknown) => `<li>${escapeHtml(String(r))}</li>`).join('');
  const worklistHtml = buildDashboardWorklistHtml(worklistLanes);

  return `<!DOCTYPE html>
<html>
<head>
<style>
  ${kronosWebviewBaseCss()}
  .dashboard-shell { max-width: 1320px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0; }
  .cockpit { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 10px; margin: 12px 0 18px; }
  .metric, .next-action { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 12px; background: var(--k-surface-soft); }
  .metric { min-height: 72px; }
  .metric .num { font-size: 24px; line-height: 1.1; font-weight: 700; }
  .metric.good .num { color: #4caf50; }
  .metric.warn .num { color: #ff9800; }
  .metric.fail .num, .metric.bad .num { color: #f44336; }
  .lbl { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .next-action { grid-column: span 2; min-height: 0; font-size: 12px; border-color: color-mix(in srgb, var(--k-accent) 42%, var(--k-border)); }
  .next-action strong { display: block; margin: 4px 0; font-size: 14px; line-height: 1.35; }
  .next-meta { margin-top: 6px; color: var(--k-muted); line-height: 1.4; }
  .next-meta strong { display: inline; color: var(--k-fg); font-size: 12px; margin: 0; }
  .next-action-controls { margin-top: 10px; }
  .project-card { transition: border-color 0.15s, background-color 0.15s; }
  .project-card:hover { border-color: var(--k-accent); background: var(--k-surface-soft); }
  .card-header { font-weight: 650; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .card-body { color: var(--k-muted); font-size: 13px; }
  .health-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .brief { border-left: 3px solid var(--k-accent); padding: 12px; margin: 16px 0; border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .brief h3,
  .section h3 { margin: 0 0 8px; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .brief p { margin: 6px 0 0; }
  .section { margin: 20px 0; }
  .worklists { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
  .lane { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px 12px; background: var(--k-surface); }
  .lane h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 650; }
  .lane ul { list-style: none; padding: 0; margin: 0; }
  .work-item { border-top: 1px solid var(--k-border); padding: 8px 0; }
  .work-item:first-child { border-top: none; }
  .work-item strong { display: block; font-size: 12px; }
  .work-item div { color: var(--k-muted); font-size: 11px; margin-top: 2px; }
  .work-item.critical strong { color: #f44336; }
  .work-item.warning strong { color: #ff9800; }
  .work-item.ok strong { color: #4caf50; }
  .lane-empty { color: var(--k-muted); font-size: 12px; }
  .dashboard-list { display: grid; gap: 7px; list-style: none; padding: 0; margin: 8px 0 0; }
  .dashboard-list li { padding: 8px 10px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
  @media (max-width: 820px) {
    .next-action { grid-column: 1; }
  }
</style>
</head>
<body><div class="kronos-shell dashboard-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Dashboard</h1>
      <div class="kronos-subtitle">${Object.keys(projects).length} project${Object.keys(projects).length === 1 ? '' : 's'} tracked, ${Object.keys(allTickets).length} ticket${Object.keys(allTickets).length === 1 ? '' : 's'} in state</div>
    </div>
  </div>
  ${cockpitHtml}
  ${briefHtml}
  ${worklistHtml}

  <div class="section">
    <h3 class="kronos-section-title">Projects</h3>
    <div class="grid">${projectCards || '<div class="kronos-empty">No projects registered.</div>'}</div>
  </div>

  ${attentionItems ? `<div class="section"><h3>Needs Attention</h3><ul class="dashboard-list">${attentionItems}</ul></div>` : ''}
  ${readyItems ? `<div class="section"><h3>Ready to Implement</h3><ul class="dashboard-list">${readyItems}</ul></div>` : ''}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body>
</html>`;
}

function buildDashboardWorklistHtml(lanes: DashboardWorklistLane[]): string {
  const laneHtml = lanes.map(lane => {
    const items = lane.items.map(item => `<li class="work-item ${escapeClass(item.severity)}">
      <strong>${escapeHtml(item.title)}</strong>
      <div>${escapeHtml(item.detail)}</div>
      ${item.ticketKey || item.runId ? `<div>${escapeHtml([item.ticketKey, item.runId].filter(Boolean).join(' | '))}</div>` : ''}
    </li>`).join('');
    return `<div class="lane ${escapeClass(lane.kind)}">
      <h3>${escapeHtml(lane.title)}</h3>
      ${items ? `<ul>${items}</ul>` : `<div class="lane-empty">${escapeHtml(lane.emptyText)}</div>`}
    </div>`;
  }).join('');

  return `<div class="section">
    <h3 class="kronos-section-title">Command Center</h3>
    <div class="worklists">${laneHtml}</div>
  </div>`;
}

function buildDiffHtml(data: MergeRequestDiffResult): string {
  const mr = data.mr;
  const files = data.files;
  const esc = escapeHtml;
  const fileAnchor = (idx: number, filePath: string) => `file-${idx}-${encodeURIComponent(filePath || `file-${idx + 1}`)}`;

  const fileList = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const icon = f.new_file ? '+' : f.deleted_file ? '-' : '~';
    const kind = f.new_file ? 'add' : f.deleted_file ? 'del' : 'mod';
    return `<a href="#${fileAnchor(idx, filePath)}" class="file-link ${kind}">${icon} ${esc(filePath)}</a>`;
  }).join('');

  const diffs = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const lines = String(f.diff || '').split('\n').map((line: string) => {
      const escaped = esc(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<div class="line add">${escaped}</div>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `<div class="line del">${escaped}</div>`;
      } else if (line.startsWith('@@')) {
        return `<div class="line hunk">${escaped}</div>`;
      }
      return `<div class="line">${escaped}</div>`;
    }).join('');
    const label = f.new_file ? '(new file)' : f.deleted_file ? '(deleted)' : '';
    return `<div class="file-diff" id="${fileAnchor(idx, filePath)}">
      <div class="file-header">${esc(filePath)} ${label}</div>
      <div class="diff-content">${lines}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .diff-shell { max-width: none; }
  .mr-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--k-muted); font-size: 12px; }
  .file-list { display: grid; gap: 2px; margin: 12px 0 18px; padding: 8px; }
  .file-link { display: block; padding: 3px 6px; border-radius: var(--k-radius-sm); text-decoration: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .file-link.add { color: var(--k-ok); }
  .file-link.del { color: var(--k-danger); }
  .file-link.mod { color: var(--k-accent); }
  .file-link:hover { background: var(--k-hover); text-decoration: none; }
  .file-diff { margin: 16px 0; }
  .file-header { background: var(--k-surface-soft); padding: 7px 12px; font-weight: 650; border: 1px solid var(--k-border); border-bottom: none; border-radius: var(--k-radius-sm) var(--k-radius-sm) 0 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .diff-content { border: 1px solid var(--k-border); border-radius: 0 0 var(--k-radius-sm) var(--k-radius-sm); overflow-x: auto; background: var(--k-bg); }
  .line { padding: 0 12px; white-space: pre; min-height: 18px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 18px; }
  .line.add { background: rgba(40, 167, 69, 0.15); color: var(--vscode-gitDecoration-addedResourceForeground); }
  .line.del { background: rgba(220, 53, 69, 0.15); color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .line.hunk { background: var(--k-surface-soft); color: var(--k-accent); font-style: italic; }
</style></head><body><div class="kronos-shell diff-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">${esc(mr.title || 'Merge Request Diff')}</h1>
      <div class="mr-meta">
        <span>${esc(mr.source_branch || '')} &rarr; ${esc(mr.target_branch || '')}</span>
        <span>by ${esc(mr.author || '')}</span>
        <span>${files.length} files changed</span>
      </div>
    </div>
  </div>
  ${fileList ? `<div class="file-list kronos-panel">${fileList}</div>` : '<div class="kronos-empty">No changed files found.</div>'}
  ${diffs}
</div></body></html>`;
}

function buildJiraBoardHtml(state: KronosState, nonce: string): string {
  const esc = escapeHtml;
  const attr = escapeAttr;
  const tickets = state.state?.tickets || {};
  const projects = Object.keys(state.state?.projects || {});
  const queue = state.queue;
  const queuedKeys = new Set((queue?.items || []).map(i => i.ticket));

  const columns: Record<string, string[]> = {
    'To Do': [], 'Queued': [], 'In Progress': [], 'Review': [], 'Blocked': [], 'Done': [],
  };
  const columnMap: Record<string, string> = {
    implement: 'To Do', in_progress: 'In Progress', await_review: 'Review',
    deploy_monitor: 'In Progress', verify: 'In Progress', fix_build: 'In Progress',
    blocked: 'Blocked', done: 'Done', unknown: 'To Do',
  };

  const ticketData: Record<string, any> = {};

  for (const [key, t] of Object.entries(tickets)) {
    const isQueued = queuedKeys.has(key);
    const labels = ticketStringArray(t.labels);
    const linkedProjects = ticketStringArray(t.projects);
    const attachments = ticketAttachments(t.attachments);
    const mr = ticketRecord(t.mr) ? t.mr : null;
    const build = ticketRecord(t.build) ? t.build : null;
    const summary = ticketStringField(t, 'summary');
    const ticketType = ticketStringField(t, 'type');
    const priority = ticketStringField(t, 'priority');
    const jiraStatus = ticketStringField(t, 'jira_status');
    const nextAction = ticketStringField(t, 'next_action', 'unknown');
    ticketData[key] = {
      summary,
      type: ticketType,
      priority,
      status: jiraStatus,
      description: ticketStringField(t, 'description'),
      labels,
      projects: linkedProjects,
      attachments,
      mr: mr ? {
        iid: ticketStringField(mr, 'iid', '?'),
        status: ticketStringField(mr, 'review_status'),
      } : null,
      build: build ? {
        number: ticketStringField(build, 'number', '?'),
        status: ticketStringField(build, 'status'),
      } : null,
      evidenceCount: ticketEvidenceItemCount(t),
      hasJiraUrl: Boolean(t.jira_url),
      isQueued,
    };
    let col = queuedKeys.has(key) ? 'Queued' : (columnMap[nextAction] || 'To Do');

    const projs = linkedProjects.map((p: string) => `<span class="tag proj">${esc(p)}</span>`).join('');
    const typeClass = ticketType.toLowerCase().includes('bug') || ticketType.toLowerCase().includes('defect') ? 'bug' : 'story';
    const mrReviewStatus = mr ? ticketStringField(mr, 'review_status') : '';
    const mrLink = mr ? `<button type="button" class="badge mr clickable" data-action="openMr" data-ticket="${attr(key)}">MR !${esc(ticketStringField(mr, 'iid', '?'))} &middot; ${esc(mrReviewStatus.replace(/_/g, ' '))}</button>` : '';
    const attBadge = attachments.length > 0 ? `<span class="badge att">${attachments.length} attachment${attachments.length === 1 ? '' : 's'}</span>` : '';
    const evidenceCount = ticketEvidenceItemCount(t);
    const evidenceBadge = evidenceCount > 0 ? `<span class="badge evidence">${evidenceCount} evidence</span>` : '';
    const hasProjects = linkedProjects.length > 0;
    const statusTag = isQueued ? `<span class="tag status">${esc(jiraStatus)}</span>` : '';

    const linkButtons = projects.map(p => {
      const isLinked = linkedProjects.includes(p);
      return `<button type="button" class="link-btn ${isLinked ? 'linked' : ''}" data-action="${isLinked ? 'unlink' : 'link'}" data-ticket="${attr(key)}" data-project="${attr(p)}">${isLinked ? '&#10003;' : '+'} ${esc(p)}</button>`;
    }).join('');

    const queueBtn = isQueued
      ? `<button type="button" class="action-btn queued" data-action="removeFromQueue" data-ticket="${attr(key)}">Remove from Queue</button>`
      : hasProjects
        ? `<button type="button" class="action-btn" data-action="addToQueue" data-ticket="${attr(key)}">Add to Queue</button>`
        : '';

    const startBtn = isQueued && hasProjects
      ? `<button type="button" class="action-btn start" data-action="start" data-ticket="${attr(key)}">Start</button>`
      : '';

    const jiraLink = t.jira_url ? `<button type="button" class="jira-link clickable text-button" data-action="openJira" data-ticket="${attr(key)}">Jira</button>` : '';

    const searchText = [
      key,
      summary,
      priority,
      ticketType,
      jiraStatus,
      nextAction,
      ...linkedProjects,
      ...labels,
    ].map(value => String(value || '').toLowerCase()).join(' ');
    const card = `<div class="card ${typeClass}" data-ticket="${attr(key)}" data-search="${attr(searchText)}" tabindex="0" role="button">
      <div class="card-key">${esc(key)} <span class="priority">${esc(priority)}</span> ${statusTag}</div>
      <div class="card-summary">${esc(summary)}</div>
      <div class="card-tags">${projs} ${mrLink} ${attBadge} ${evidenceBadge}</div>
      <div class="card-links">${linkButtons}</div>
      <div class="card-actions">${queueBtn} ${startBtn} ${jiraLink}</div>
    </div>`;
    columns[col].push(card);
  }

  const colHtml = Object.entries(columns).map(([name, cards]) => {
    const colClass = name === 'Queued' ? 'column queue-col' : 'column';
    return `<div class="${colClass}" role="region" aria-label="${attr(name)} tickets"><div class="col-header">${name} <span class="count" data-count>${cards.length}</span></div><div class="column-cards">${cards.join('')}<div class="empty-column" data-empty>No tickets.</div></div></div>`;
  }).join('');

  const ticketJsonRaw = jsonForScript(ticketData);

  return `<!DOCTYPE html>
<html><head>
<style>
  ${kronosWebviewBaseCss()}
  .board-shell { max-width: none; }
  .board-toolbar { justify-content: space-between; }
  .board-filter { width: min(440px, 100%); }
  .board-filter-summary { color: var(--k-muted); font-size: 12px; }
  .board { display: flex; align-items: stretch; gap: 12px; overflow-x: auto; min-height: 480px; padding-bottom: 10px; scrollbar-gutter: stable; }
  .column { min-width: 250px; flex: 1 0 250px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px; }
  .queue-col { border-color: color-mix(in srgb, var(--k-accent) 55%, var(--k-border)); }
  .col-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 650; font-size: 11px; padding: 2px 2px 10px; margin-bottom: 4px; color: var(--k-muted); text-transform: uppercase; letter-spacing: 0; }
  .col-header .count { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; color: var(--k-fg); background: var(--k-bg); font-weight: 650; }
  .column-cards { display: grid; gap: 8px; }
  .empty-column { display: none; padding: 14px 10px; color: var(--k-muted); font-size: 12px; text-align: center; border: 1px dashed var(--k-border); border-radius: var(--k-radius-sm); }
  .column.filtered-empty .empty-column { display: block; }
  .card { display: grid; gap: 7px; background: var(--k-bg); border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px; font-size: 11px; cursor: pointer; transition: border-color 0.15s, background-color 0.15s; }
  .card:hover, .card:focus { border-color: var(--k-accent); background: var(--k-hover); outline: none; }
  .card.bug { border-left: 3px solid #f44336; }
  .card.story { border-left: 3px solid #4caf50; }
  .card:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--k-accent)); outline-offset: 2px; }
  .card-key { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 650; font-size: 11px; }
  .card-key .priority { font-weight: 550; color: var(--k-muted); font-size: 10px; }
  .card-summary { line-height: 1.35; font-size: 12px; }
  .card-tags, .card-links, .card-actions { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 7px; border: 1px solid transparent; border-radius: 999px; font-size: 10px; line-height: 1.2; }
  .tag.proj { background: rgba(33,150,243,0.2); color: var(--vscode-textLink-foreground); }
  .badge { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 7px; border-radius: 999px; font-size: 10px; line-height: 1.2; border: 1px solid transparent; font-family: inherit; }
  .badge.mr { background: rgba(255,152,0,0.2); color: #ff9800; text-decoration: none; }
  .badge.att { border-color: var(--k-border); background: var(--k-surface-soft); color: var(--k-muted); }
  .badge.evidence { background: rgba(76,175,80,0.18); color: #4caf50; }
  .badge.mr:hover { text-decoration: underline; }
  .tag.status { border-color: var(--k-border); color: var(--k-muted); background: var(--k-surface-soft); }
  .link-btn { display: inline-flex; align-items: center; min-height: 22px; background: none; border: 1px solid var(--k-border); color: var(--k-fg); padding: 2px 8px; border-radius: 999px; font-size: 10px; cursor: pointer; opacity: 0.7; font-family: inherit; line-height: 1.2; }
  .link-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  .link-btn.linked { border-color: #4caf50; color: #4caf50; opacity: 1; }
  .clickable { cursor: pointer; color: var(--k-accent); }
  .clickable:hover { text-decoration: underline; }
  .jira-link { font-size: 10px; }
  .badge.mr.clickable { cursor: pointer; }
  .action-btn { display: inline-flex; align-items: center; min-height: 24px; background: none; border: 1px solid var(--k-border); color: var(--k-fg); padding: 3px 8px; border-radius: var(--k-radius-sm); font-size: 10px; font-weight: 550; cursor: pointer; font-family: inherit; line-height: 1.2; }
  .action-btn:hover { background: var(--vscode-list-hoverBackground); }
  .action-btn.queued { border-color: #ff9800; color: #ff9800; }
  .action-btn.start { border-color: #4caf50; color: #4caf50; background: rgba(76,175,80,0.12); font-weight: 650; }
  .text-button { border: 0; background: none; padding: 0; font-family: inherit; }
  .muted { color: var(--k-muted); }

  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; padding: 24px 16px; background: rgba(0,0,0,0.62); z-index: 100; justify-content: center; align-items: flex-start; overflow-y: auto; }
  .modal-overlay.show { display: flex; }
  .modal { position: relative; background: var(--k-surface); border: 1px solid var(--k-border); border-radius: var(--k-radius); width: min(820px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 22px; box-shadow: 0 16px 48px rgba(0,0,0,0.35); }
  .modal h2 { margin: 0 30px 4px 0; font-size: 18px; line-height: 1.25; }
  .modal .meta { font-size: 12px; color: var(--k-muted); margin-bottom: 12px; }
  .modal .meta-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 12px 0 14px; padding: 12px; border: 1px solid var(--k-border); background: var(--k-surface-soft); border-radius: var(--k-radius); font-size: 12px; }
  .modal .meta-row .item { min-width: 0; word-break: break-word; }
  .modal .meta-row .item .lbl { color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; display: block; margin-bottom: 2px; }
  .modal .desc { max-height: 220px; overflow-y: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; background: var(--k-surface-soft); padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); margin: 8px 0; }
  .modal .close-btn { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: none; border: 1px solid transparent; border-radius: var(--k-radius-sm); color: var(--vscode-foreground); font-size: 20px; cursor: pointer; opacity: 0.72; z-index: 10; padding: 0; }
  .modal .close-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); border-radius: 4px; }
  .modal .section { margin: 12px 0; }
  .modal .section h3 { color: var(--k-muted); font-size: 11px; font-weight: 650; margin: 0 0 6px 0; text-transform: uppercase; }
  .modal .comments { display: grid; gap: 8px; max-height: 260px; overflow-y: auto; }
  .modal .comment { border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 8px 10px; font-size: 12px; background: var(--k-surface-soft); }
  .modal .comment .author { font-weight: 650; font-size: 11px; }
  .modal .comment .date { color: var(--k-muted); font-size: 10px; margin-left: 6px; }
  .modal .comment-body { margin-top: 5px; white-space: pre-wrap; line-height: 1.45; }
  .modal .modal-actions { position: sticky; bottom: -22px; display: flex; gap: 8px; margin: 18px -22px -22px; padding: 12px 22px; flex-wrap: wrap; border-top: 1px solid var(--k-border); background: var(--k-surface); }
  .modal .modal-actions button { min-height: 28px; }
  .modal .modal-actions button:hover { background: var(--vscode-list-hoverBackground); }
  .modal .modal-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  .modal .modal-actions .jira-action { margin-left: auto; color: var(--vscode-textLink-foreground); }
  .modal-key { color: var(--k-muted); font-size: 12px; font-weight: 650; text-transform: uppercase; }
  .attachment-item { display: inline-block; margin-right: 8px; }
  .modal-blocked-hint { align-self: center; color: var(--k-muted); font-size: 11px; }
  @media (max-width: 760px) {
    .board-toolbar { justify-content: stretch; }
    .board-filter { width: 100%; }
    .column { min-width: 220px; }
    .modal { width: calc(100vw - 24px); padding: 18px; }
    .modal .modal-actions { margin: 16px -18px -18px; padding: 12px 18px; }
    .modal .modal-actions .jira-action { margin-left: 0; }
  }
</style>
<script nonce="${escapeAttr(nonce)}">
function initKronosJiraBoard() {
${webviewVsCodeApiScript('Kronos Jira Board')}
const ticketData = ${ticketJsonRaw};
let currentModalKey = '';
let lastFocusedEl = null;

function byId(id) { return document.getElementById(id); }
function clearNode(el) {
  while (el.firstChild) { el.removeChild(el.firstChild); }
}
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) { el.className = className; }
  if (text !== undefined) { el.textContent = String(text); }
  return el;
}
function makeButton(text, className, onClick) {
  const btn = document.createElement('button');
  btn.className = ['kronos-button', className || ''].join(' ').trim();
  btn.type = 'button';
  btn.textContent = text;
  btn.addEventListener('click', onClick);
  return btn;
}
function setText(id, value) {
  const el = byId(id);
  if (el) { el.textContent = value === undefined || value === null || value === '' ? '' : String(value); }
}
function post(command, payload) {
  vscode.postMessage(Object.assign({ command: command }, payload || {}));
}
function showPlaceholder(el, text) {
  clearNode(el);
  el.appendChild(makeEl('div', 'muted', text));
}
function formatStatus(value) {
  return String(value || '').replace(/_/g, ' ');
}
function formatAttachment(a) {
  const filename = String(a.filename || 'attachment');
  const size = Number(a.size || 0);
  const sizeLabel = size > 1024 ? Math.round(size / 1024) + 'KB' : size + 'B';
  return filename + ' (' + sizeLabel + ')';
}
function showModal(key) {
  const t = ticketData[key]; if (!t) return;
  lastFocusedEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  currentModalKey = key;
  setText('modal-key', key);
  setText('modal-summary', t.summary);
  setText('modal-meta', t.type + ' - ' + t.priority + ' - ' + t.status);
  setText('modal-desc', t.description || 'No description');
  setText('modal-projects', t.projects.length > 0 ? t.projects.join(', ') : 'Not linked');
  setText('modal-labels', t.labels.join(', ') || 'None');
  setText('modal-evidence', t.evidenceCount > 0 ? t.evidenceCount + ' item' + (t.evidenceCount === 1 ? '' : 's') : 'None');
  const mrEl = byId('modal-mr');
  clearNode(mrEl);
  if (t.mr) {
    mrEl.appendChild(makeEl('span', '', 'MR !' + t.mr.iid + ' - ' + formatStatus(t.mr.status) + ' '));
    const mrLink = makeEl('button', 'text-button clickable', 'Open in GitLab');
    mrLink.addEventListener('click', function() { post('openMr', { ticket: currentModalKey }); });
    mrEl.appendChild(mrLink);
  } else {
    mrEl.textContent = 'No MR';
  }
  setText('modal-build', t.build ? 'Build #' + t.build.number + ' - ' + t.build.status : 'No build');
  var attEl = byId('modal-attachments');
  clearNode(attEl);
  if (t.attachments && t.attachments.length > 0) {
    t.attachments.forEach(function(a) {
      attEl.appendChild(makeEl('span', 'attachment-item', formatAttachment(a)));
    });
  } else {
    attEl.textContent = 'None';
  }
  var actionsEl = byId('modal-actions');
  var hasProjects = t.projects.length > 0;
  clearNode(actionsEl);
  if (hasProjects) {
    actionsEl.appendChild(makeButton('Start Work', 'primary', function() { post('start', { ticket: currentModalKey }); closeModal(); }));
    actionsEl.appendChild(makeButton(t.isQueued ? 'Remove from Queue' : 'Add to Queue', '', function() {
      post(t.isQueued ? 'removeFromQueue' : 'addToQueueFromModal', { ticket: currentModalKey });
      closeModal();
    }));
  } else {
    actionsEl.appendChild(makeEl('span', 'modal-blocked-hint', 'Link to a project first to start or queue.'));
  }
  actionsEl.appendChild(makeButton('Add Evidence', '', function() { post('addEvidence', { ticket: currentModalKey }); closeModal(); }));
  actionsEl.appendChild(makeButton('Add Check', '', function() { post('addEvidenceCheck', { ticket: currentModalKey }); closeModal(); }));
  actionsEl.appendChild(makeButton('Environment Result', '', function() { post('recordEnvironmentResult', { ticket: currentModalKey }); closeModal(); }));
  actionsEl.appendChild(makeButton('Export Evidence', '', function() { post('exportEvidence', { ticket: currentModalKey }); closeModal(); }));
  actionsEl.appendChild(makeButton('Handoff', '', function() { post('evidenceHandoff', { ticket: currentModalKey }); closeModal(); }));
  actionsEl.appendChild(makeButton('Publish Evidence', '', function() { post('publishEvidence', { ticket: currentModalKey }); closeModal(); }));
  if (t.hasJiraUrl) {
    var jiraBtn = makeEl('button', 'kronos-button jira-action clickable', 'Open in Jira');
    jiraBtn.type = 'button';
    jiraBtn.addEventListener('click', function() { post('openJira', { ticket: currentModalKey }); });
    actionsEl.appendChild(jiraBtn);
  }
  showPlaceholder(byId('modal-comments'), 'Loading comments...');
  post('getComments', { ticket: key });
  byId('modal-overlay').classList.add('show');
  byId('modal-close').focus();
}
function closeModal() {
  byId('modal-overlay').classList.remove('show');
  if (lastFocusedEl && document.contains(lastFocusedEl)) {
    lastFocusedEl.focus();
  }
  lastFocusedEl = null;
}
function applyBoardFilter() {
  const input = byId('board-filter');
  const query = input ? String(input.value || '').trim().toLowerCase() : '';
  var totalVisible = 0;
  var totalCards = 0;
  document.querySelectorAll('.column').forEach(function(column) {
    var visible = 0;
    column.querySelectorAll('.card[data-ticket]').forEach(function(card) {
      totalCards += 1;
      const search = String(card.getAttribute('data-search') || '');
      const match = !query || search.indexOf(query) >= 0;
      card.hidden = !match;
      if (match) { visible += 1; }
    });
    totalVisible += visible;
    const count = column.querySelector('[data-count]');
    if (count) { count.textContent = String(visible); }
    const empty = column.querySelector('[data-empty]');
    if (empty) { empty.textContent = query ? 'No matching tickets.' : 'No tickets.'; }
    column.classList.toggle('filtered-empty', visible === 0);
  });
  const summary = byId('board-filter-summary');
  if (summary) {
    summary.textContent = query ? totalVisible + ' of ' + totalCards + ' visible' : totalCards + ' total';
  }
}
function handleBoardClick(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target) { return; }
  const actionEl = target.closest('[data-action]');
  if (actionEl) {
    e.stopPropagation();
    const ticket = actionEl.getAttribute('data-ticket') || currentModalKey;
    const project = actionEl.getAttribute('data-project') || '';
    const action = actionEl.getAttribute('data-action');
    if (action === 'link' || action === 'unlink') {
      post(action, { ticket: ticket, project: project });
    } else if (action === 'addToQueue' || action === 'removeFromQueue' || action === 'start' || action === 'openJira' || action === 'openMr') {
      post(action, { ticket: ticket });
    }
    return;
  }
  const card = target.closest('.card[data-ticket]');
  if (card) {
    showModal(card.getAttribute('data-ticket'));
  }
}
document.querySelector('.board').addEventListener('click', handleBoardClick);
document.querySelector('.board').addEventListener('keydown', function(e) {
  const target = e.target instanceof Element ? e.target : null;
  if (!target || !target.matches('.card[data-ticket]')) { return; }
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    showModal(target.getAttribute('data-ticket'));
  }
});
byId('board-filter').addEventListener('input', applyBoardFilter);
applyBoardFilter();
byId('modal-overlay').addEventListener('click', function(e) {
  if (e.target === this) { closeModal(); }
});
byId('modal-close').addEventListener('click', closeModal);
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && byId('modal-overlay').classList.contains('show')) {
    closeModal();
  }
});
function normalizeCommentsPayload(raw) {
  var comments = raw;
  if (typeof comments === 'string') {
    try {
      comments = JSON.parse(comments || '[]');
    } catch {
      return null;
    }
  }
  if (!Array.isArray(comments)) { return null; }
  return comments.slice(0, 100).map(function(comment) {
    if (comment && typeof comment === 'object') { return comment; }
    return { body: String(comment || '') };
  });
}
window.addEventListener('message', function(e) {
  const msg = e.data && typeof e.data === 'object' ? e.data : {};
  if (msg.command === 'comments' && msg.ticket === currentModalKey) {
    const el = byId('modal-comments');
    if (msg.error) {
      showPlaceholder(el, String(msg.error));
      return;
    }
    const comments = normalizeCommentsPayload(msg.data);
    if (!comments) {
      showPlaceholder(el, 'Could not load comments');
      return;
    }
    if (comments.length === 0) {
      showPlaceholder(el, 'No comments');
      return;
    }
    clearNode(el);
    comments.forEach(function(c) {
      const row = makeEl('div', 'comment');
      row.appendChild(makeEl('span', 'author', c.author || c.authorName || 'Unknown'));
      row.appendChild(makeEl('span', 'date', c.created || ''));
      row.appendChild(makeEl('div', 'comment-body', c.body || ''));
      el.appendChild(row);
    });
  }
});
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKronosJiraBoard);
} else {
  initKronosJiraBoard();
}
</script>
</head><body><div class="kronos-shell board-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Jira Board</h1>
      <div class="kronos-subtitle">${Object.keys(tickets).length} ticket${Object.keys(tickets).length === 1 ? '' : 's'} across ${projects.length} project${projects.length === 1 ? '' : 's'}</div>
    </div>
  </div>
  <div class="kronos-toolbar board-toolbar">
    <input id="board-filter" class="board-filter kronos-input" type="search" placeholder="Filter tickets" aria-label="Filter tickets">
    <span id="board-filter-summary" class="board-filter-summary" aria-live="polite">${Object.keys(tickets).length} total</span>
  </div>
  <div class="board">${colHtml}</div>

  <div class="modal-overlay" id="modal-overlay">
    <div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-summary">
      <button class="close-btn" id="modal-close" type="button" aria-label="Close">&times;</button>
      <div id="modal-key" class="modal-key"></div>
      <h2 id="modal-summary"></h2>
      <div class="meta" id="modal-meta"></div>
      <div class="meta-row">
        <div class="item"><span class="lbl">Projects</span><span id="modal-projects"></span></div>
        <div class="item"><span class="lbl">Labels</span><span id="modal-labels"></span></div>
        <div class="item"><span class="lbl">Evidence</span><span id="modal-evidence"></span></div>
        <div class="item"><span class="lbl">MR</span><span id="modal-mr"></span></div>
        <div class="item"><span class="lbl">Build</span><span id="modal-build"></span></div>
        <div class="item"><span class="lbl">Attachments</span><span id="modal-attachments"></span></div>
      </div>
      <div class="section"><h3>Description</h3><div class="desc" id="modal-desc"></div></div>
      <div class="section"><h3>Comments</h3><div class="comments" id="modal-comments" aria-live="polite"></div></div>
      <div class="modal-actions" id="modal-actions"></div>
    </div>
  </div>
</div></body></html>`;
}

function buildTicketHtml(key: string, ticket: Ticket, state: KronosState, nonce?: string): string {
  const esc = escapeHtml;
  const projectList = ticketStringArray(ticket.projects);
  const labelList = ticketStringArray(ticket.labels);
  const ticketType = ticketStringField(ticket, 'type');
  const priority = ticketStringField(ticket, 'priority');
  const summary = ticketStringField(ticket, 'summary');
  const jiraStatus = ticketStringField(ticket, 'jira_status');
  const nextAction = ticketStringField(ticket, 'next_action');
  const description = ticketStringField(ticket, 'description');
  const mr = ticket.mr;
  const build = ticket.build;
  const projs = projectList.map((p: string) =>
    `<span class="tag project">${esc(p)}</span>`
  ).join(' ');
  const labels = labelList.map((l: string) => `<span class="tag label">${esc(l)}</span>`).join(' ');
  const gate = evaluateEvidenceGate(key, ticket);
  const gateHtml = buildTicketGateHtml(gate);
  const timeline = buildTicketTimeline({ ticketKey: key, ticket, queue: state.queue, runs: listRuns() });
  const timelineHtml = buildTicketTimelineHtml(timeline);
  const criteria = evidenceAcceptanceCriteria(ticket);
  const criteriaHtml = criteria.length > 0
    ? `<div class="section"><h3>Acceptance Criteria</h3><div class="criteria-list">${criteria.map(criterion => `
      <div class="criterion ${evidenceChecked(criterion) ? 'checked' : ''}">
        <span class="criterion-box">${evidenceChecked(criterion) ? '&#x2611;' : '&#x2610;'}</span>
        <span>${esc(evidenceString(criterion, 'text', 'Untitled criterion'))}</span>
      </div>`).join('')}</div></div>`
    : '';
  const notes = evidenceNotes(ticket);
  const evidenceHtml = notes.length > 0
    ? `<div class="section"><h3>Evidence Ledger</h3><div class="evidence-list">${notes.slice().reverse().map(note => {
      const at = formatWebviewDateTime(evidenceString(note, 'at'), 'Unknown time');
      return `<div class="evidence-note">
        <span class="evidence-kind">${esc(evidenceString(note, 'kind', 'note'))}</span>
        <span class="evidence-time">${esc(at)}</span>
        <div>${esc(evidenceString(note, 'text'))}</div>
      </div>`;
    }).join('')}</div></div>`
    : '';
  const checks = evidenceChecks(ticket);
  const checkHtml = checks.length > 0
    ? `<div class="section"><h3>Evidence Checks</h3><div class="evidence-list">${checks.slice().reverse().map(check => {
      const at = formatWebviewDateTime(evidenceString(check, 'at'), 'Unknown time');
      const result = evidenceString(check, 'result', 'unknown');
      const environment = evidenceString(check, 'environment');
      const confidence = evidenceString(check, 'confidence');
      const summary = evidenceString(check, 'summary');
      const command = evidenceString(check, 'command');
      const artifactPath = evidenceString(check, 'artifact_path');
      const artifact = safeHttpHref(artifactPath);
      return `<div class="evidence-check ${escapeClass(result)}">
        <span class="evidence-kind">${esc(result)}</span>
        <span class="evidence-time">${esc(at)}${environment ? ` - ${esc(environment)}` : ''}${confidence ? ` - ${esc(confidence)} confidence` : ''}</span>
        <div><strong>${esc(evidenceString(check, 'name', 'Check'))}</strong>${summary ? ` - ${esc(summary)}` : ''}</div>
        ${command ? `<div class="evidence-command">${esc(command)}</div>` : ''}
        ${artifact ? `<a href="${artifact}" class="link">Open artifact &rarr;</a>` : artifactPath ? `<div class="evidence-command">${esc(artifactPath)}</div>` : ''}
      </div>`;
    }).join('')}</div></div>`
    : '';
  const environmentResults = evidenceEnvironmentResults(ticket);
  const environmentHtml = environmentResults.length > 0
    ? `<div class="section"><h3>Environment Results</h3><div class="evidence-list">${environmentResults.map(result => {
      const at = formatWebviewDateTime(evidenceString(result, 'checked_at'), 'Unknown time');
      const status = evidenceString(result, 'status', 'unknown');
      const artifactPath = evidenceString(result, 'artifact_path');
      const artifact = safeHttpHref(artifactPath);
      return `<div class="environment-result ${escapeClass(status)}">
        <span class="evidence-kind">${esc(status)}</span>
        <span class="evidence-time">${esc(evidenceString(result, 'environment', 'env'))} - ${esc(at)}</span>
        <div>${esc(evidenceString(result, 'detail'))}</div>
        ${artifact ? `<a href="${artifact}" class="link">Open artifact &rarr;</a>` : artifactPath ? `<div class="evidence-command">${esc(artifactPath)}</div>` : ''}
      </div>`;
    }).join('')}</div></div>`
    : '';

  const statusColor = nextAction === 'blocked' ? '#f44336'
    : nextAction === 'await_review' ? '#ff9800'
    : nextAction === 'in_progress' ? '#2196f3'
    : nextAction === 'implement' ? '#666'
    : '#4caf50';

  const typeIcon = ticketType.toLowerCase().includes('bug') || ticketType.toLowerCase().includes('defect') ? 'Bug' : 'Story';

  let mrHtml = '';
  if (mr) {
    const reviewStatus = ticketStringField(mr, 'review_status', 'pending_review');
    const reviewColor = reviewStatus === 'approved' ? '#4caf50' : reviewStatus === 'changes_requested' ? '#f44336' : '#ff9800';
    const mrUrl = safeHttpHref(ticketStringField(mr, 'url'));
    const commentCount = ticketStringField(mr, 'comment_count');
    const lastCommentAt = ticketStringField(mr, 'last_comment_at');
    mrHtml = `<div class="section">
      <h3>Merge Request</h3>
      <div class="mr-card">
        <div><strong>MR !${esc(ticketStringField(mr, 'iid', '?'))}</strong> — <span style="color:${reviewColor}">${esc(reviewStatus.replace(/_/g, ' '))}</span></div>
        <div>State: ${esc(ticketStringField(mr, 'state', 'unknown'))}</div>
        ${commentCount ? `<div>Comments: ${esc(commentCount)}${lastCommentAt ? ` · latest ${esc(formatWebviewDateTime(lastCommentAt))}` : ''}</div>` : ''}
        ${mrUrl ? `<a href="${mrUrl}" class="link">Open in GitLab &rarr;</a>` : ''}
      </div>
    </div>`;
  }

  let buildHtml = '';
  if (build) {
    const buildStatus = ticketStringField(build, 'status', 'unknown');
    const buildColor = buildStatus === 'SUCCESS' ? '#4caf50' : buildStatus === 'FAILURE' ? '#f44336' : '#ff9800';
    const buildUrl = safeHttpHref(ticketStringField(build, 'url'));
    buildHtml = `<div class="section">
      <h3>Build</h3>
      <div class="build-card" style="border-left-color:${buildColor}">
        <strong>Build #${esc(ticketStringField(build, 'number', '?'))}</strong> — <span style="color:${buildColor}">${esc(buildStatus)}</span>
        ${buildUrl ? `<br><a href="${buildUrl}" class="link">View in Jenkins &rarr;</a>` : ''}
      </div>
    </div>`;
  }

  const jiraUrl = safeHttpHref(ticketStringField(ticket, 'jira_url'));
  const mrActionUrl = mr ? safeHttpHref(ticketStringField(mr, 'url')) : '';
  const buildActionUrl = build ? safeHttpHref(ticketStringField(build, 'url')) : '';
  const isQueued = Boolean(state.queue?.items?.some(item => item.ticket === key));
  const actionButtons = [
    projectList.length > 0
      ? actionButton('startTicket', 'Start Work', { ticket: key, primary: true })
      : actionButton('linkTicket', 'Link Project', { ticket: key, primary: true }),
    isQueued
      ? actionButton('removeFromQueue', 'Remove Queue', { ticket: key })
      : actionButton('addToQueue', 'Add Queue', { ticket: key }),
    actionButton('addEvidence', 'Add Evidence', { ticket: key }),
    actionButton('addEvidenceCheck', 'Add Check', { ticket: key }),
    actionButton('recordEnvironmentResult', 'Record Env', { ticket: key }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: key }),
    actionButton('evidenceHandoff', 'Handoff', { ticket: key }),
    actionButton('publishEvidence', 'Publish', { ticket: key }),
    actionButton('exportEvidence', 'Export', { ticket: key }),
    jiraUrl ? actionButton('openJira', 'Open Jira', { ticket: key }) : '',
    mrActionUrl ? actionButton('openMr', 'Open MR', { ticket: key }) : '',
    buildActionUrl ? actionButton('openBuild', 'Open Build', { ticket: key }) : '',
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .ticket-shell { max-width: 980px; }
  .ticket-header { margin-bottom: 18px; }
  .ticket-header h1 { margin-top: 4px; font-size: 22px; line-height: 1.25; }
  .ticket-header .key { color: var(--k-muted); font-size: 12px; font-weight: 650; text-transform: uppercase; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; padding: 12px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); }
  .meta-item { min-width: 0; font-size: 13px; word-break: break-word; }
  .meta-item .label { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; display: block; margin-bottom: 2px; }
  .status-badge { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 650; color: white; }
  .section { margin: 20px 0; }
  .section h3 { margin: 0 0 8px 0; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .description { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.6; padding: 12px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); }
  .tag { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11px; margin: 0 4px 4px 0; line-height: 1.2; }
  .tag.project { background: rgba(33, 150, 243, 0.2); color: var(--vscode-textLink-foreground); }
  .tag.label { border-color: var(--k-border); background: var(--k-surface-soft); color: var(--k-muted); }
  .mr-card, .build-card { padding: 12px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); margin: 4px 0; font-size: 13px; background: var(--k-surface-soft); }
  .gate { padding: 12px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); font-size: 12px; }
  .gate.pass { border-left-color: #4caf50; }
  .gate.warn { border-left-color: #ff9800; }
  .gate.fail { border-left-color: #f44336; }
  .gate-row { display: flex; gap: 8px; margin: 7px 0 0; align-items: flex-start; }
  .gate-status { display: inline-flex; align-items: center; flex: 0 0 auto; min-height: 20px; border: 1px solid var(--k-border); border-radius: 999px; padding: 2px 8px; font-weight: 650; font-size: 10px; line-height: 1.2; text-transform: uppercase; }
  .gate-status.pass { color: #4caf50; }
  .gate-status.warn { color: #ff9800; }
  .gate-status.fail { color: #f44336; }
  .timeline { border-left: 1px solid var(--k-border); margin-left: 8px; padding-top: 2px; }
  .timeline-event { position: relative; padding: 0 0 14px 18px; font-size: 12px; }
  .timeline-event::before { content: ""; position: absolute; left: -4px; top: 3px; width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .timeline-event.success::before { background: #4caf50; }
  .timeline-event.warning::before { background: #ff9800; }
  .timeline-event.failure::before { background: #f44336; }
  .timeline-title { font-weight: 650; }
  .timeline-meta { color: var(--k-muted); font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
  .timeline-detail { color: var(--k-muted); white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .criteria-list, .evidence-list { display: grid; gap: 7px; }
  .criterion { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); font-size: 12px; line-height: 1.45; }
  .criterion.checked { opacity: 0.72; }
  .criterion-box { flex: 0 0 auto; color: var(--vscode-textLink-foreground); }
  .evidence-note { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius-sm); padding: 9px 10px; background: var(--k-surface-soft); font-size: 12px; }
  .evidence-check, .environment-result { border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 9px 10px; background: var(--k-surface-soft); font-size: 12px; }
  .evidence-check.pass, .environment-result.pass { border-left-color: #4caf50; }
  .evidence-check.warn, .environment-result.warn, .evidence-check.unknown, .environment-result.unknown { border-left-color: #ff9800; }
  .evidence-check.fail, .environment-result.fail { border-left-color: #f44336; }
  .evidence-kind { display: inline-flex; align-items: center; min-height: 20px; margin-right: 8px; font-weight: 650; text-transform: uppercase; font-size: 10px; color: var(--k-muted); }
  .evidence-time { color: var(--k-muted); font-size: 10px; }
  .evidence-command { margin-top: 5px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--k-muted); white-space: pre-wrap; word-break: break-word; }
  .link { color: var(--k-accent); text-decoration: none; font-size: 12px; }
  .link:hover { text-decoration: underline; }
  .actions { display: flex; gap: 8px; margin: 20px 0; flex-wrap: wrap; }
  .actions .kronos-button { min-height: 30px; }
</style></head><body><div class="kronos-shell ticket-shell">
  <div class="kronos-header ticket-header">
    <div>
      <div class="key">${esc(key)} · ${esc(typeIcon)} · ${esc(priority)}</div>
      <h1 class="kronos-title">${esc(summary)}</h1>
    </div>
  </div>

  <div class="meta">
    <div class="meta-item"><span class="label">Status</span><span class="status-badge" style="background:${statusColor}">${esc(jiraStatus)}</span></div>
    <div class="meta-item"><span class="label">Type</span>${esc(ticketType)}</div>
    <div class="meta-item"><span class="label">Priority</span>${esc(priority)}</div>
    <div class="meta-item"><span class="label">Updated</span>${escapeHtml(formatWebviewDate(ticket.updated))}</div>
  </div>

  ${projs ? `<div class="section"><h3>Linked Projects</h3>${projs}</div>` : ''}
  ${labels ? `<div class="section"><h3>Labels</h3>${labels}</div>` : ''}

  ${description ? `<div class="section"><h3>Description</h3><div class="description">${esc(description)}</div></div>` : ''}

  ${gateHtml}
  ${criteriaHtml}
  ${timelineHtml}
  ${checkHtml}
  ${environmentHtml}
  ${evidenceHtml}
  ${mrHtml}
  ${buildHtml}

  <div class="actions">${actionButtons}</div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function buildTicketGateHtml(gate: EvidenceGateResult): string {
  const rows = gate.checks
    .filter(check => check.status !== 'pass')
    .map(check => `<div class="gate-row">
      <span class="gate-status ${escapeClass(check.status)}">${escapeHtml(check.status)}</span>
      <span>${escapeHtml(check.title)}${check.detail ? ` - ${escapeHtml(check.detail)}` : ''}</span>
    </div>`)
    .join('');
  const body = rows || '<div class="gate-row"><span class="gate-status pass">pass</span><span>No failing or warning checks.</span></div>';
  return `<div class="section"><h3>Evidence Gate</h3><div class="gate ${escapeClass(gate.status)}">
    <div><strong>${escapeHtml(gate.status.toUpperCase())}</strong> - ${escapeHtml(gate.summary)}</div>
    ${body}
  </div></div>`;
}

function buildTicketTimelineHtml(events: TimelineEvent[]): string {
  if (events.length === 0) { return ''; }
  const rows = events.map(event => {
    const at = formatWebviewDateTime(event.at, 'No timestamp');
    const href = safeHttpHref(event.url);
    const link = href ? ` <a href="${href}" class="link">Open</a>` : '';
    const artifact = event.artifactPath ? ` <span class="timeline-artifact">${escapeHtml(event.artifactPath)}</span>` : '';
    return `<div class="timeline-event ${escapeClass(event.severity)}">
      <div class="timeline-meta">${escapeHtml(event.source)} · ${escapeHtml(at)}</div>
      <div class="timeline-title">${escapeHtml(event.title)}${link}</div>
      ${event.detail ? `<div class="timeline-detail">${escapeHtml(event.detail)}${artifact}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="section"><h3>Ticket Timeline</h3><div class="timeline">${rows}</div></div>`;
}

export function deactivate() {}
