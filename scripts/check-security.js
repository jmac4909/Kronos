const fs = require('fs');

function readSource(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const files = [
  'src/extension.ts',
  'src/runners/sessionDispatcher.ts',
  'src/state/KronosState.ts',
  'src/services/scriptClient.ts',
  'src/services/queueActiveRun.ts',
  'src/services/queuePlannerPanelView.ts',
  'src/services/operationsReportPanelView.ts',
  'src/views/ProjectTreeProvider.ts',
  'src/views/TicketTreeProvider.ts',
];

const sources = Object.fromEntries(files.map((file) => [file, readSource(file)]));
const allSource = Object.values(sources).join('\n');
const nonScriptClientSource = [
  sources['src/extension.ts'],
  sources['src/runners/sessionDispatcher.ts'],
  sources['src/state/KronosState.ts'],
].join('\n');
const stateStore = readSource('src/services/stateStore.ts');
const runStore = readSource('src/services/runStore.ts');
const fileNames = readSource('src/services/fileNames.ts');
const sessionStore = readSource('src/services/sessionStore.ts');
const worktreeRegistry = readSource('src/services/worktreeRegistry.ts');
const sessionTreeProvider = readSource('src/views/SessionTreeProvider.ts');
const queueTreeProvider = readSource('src/views/QueueTreeProvider.ts');
const reviewTreeProvider = readSource('src/views/ReviewTreeProvider.ts');
const queueActiveRun = sources['src/services/queueActiveRun.ts'];
const projectTreeProvider = sources['src/views/ProjectTreeProvider.ts'];
const ticketTreeProvider = sources['src/views/TicketTreeProvider.ts'];
const dispatcher = sources['src/runners/sessionDispatcher.ts'];
const scriptClient = sources['src/services/scriptClient.ts'];
const acceptanceCriteria = readSource('src/services/acceptanceCriteria.ts');
const evidenceStore = readSource('src/services/evidenceStore.ts');
const evidenceData = readSource('src/services/evidenceData.ts');
const evidenceHandoff = readSource('src/services/evidenceHandoff.ts');
const evidencePublisher = readSource('src/services/evidencePublisher.ts');
const humanReviewInbox = readSource('src/services/humanReviewInbox.ts');
const recoveryCenter = readSource('src/services/recoveryCenter.ts');
const evidenceGate = readSource('src/services/evidenceGate.ts');
const evidenceGatePolicy = readSource('src/services/evidenceGatePolicy.ts');
const queueRemovalPolicy = readSource('src/services/queueRemovalPolicy.ts');
const collisionDetector = readSource('src/services/collisionDetector.ts');
const runStatus = readSource('src/services/runStatus.ts');
const runProgress = readSource('src/services/runProgress.ts');
const activeRunDisplay = readSource('src/services/activeRunDisplay.ts');
const runCompletionNotification = readSource('src/services/runCompletionNotification.ts');
const runCenterSort = readSource('src/services/runCenterSort.ts');
const attentionBadge = readSource('src/services/attentionBadge.ts');
const queuePlanner = readSource('src/services/queuePlanner.ts');
const actionCatalog = readSource('src/services/actionCatalog.ts');
const actionSemantics = readSource('src/services/actionSemantics.ts');
const queuePlannerPanelView = sources['src/services/queuePlannerPanelView.ts'];
const operationsReportPanelView = sources['src/services/operationsReportPanelView.ts'];
const agentQualityScore = readSource('src/services/agentQualityScore.ts');
const integrationManifest = readSource('src/services/integrationManifest.ts');
const profileManager = readSource('src/services/profileManager.ts');
const agingAnalyzer = readSource('src/services/agingAnalyzer.ts');
const safetyGate = readSource('src/services/safetyGate.ts');
const trendMetrics = readSource('src/services/trendMetrics.ts');
const dashboardWorklist = readSource('src/services/dashboardWorklist.ts');
const ticketTimeline = readSource('src/services/ticketTimeline.ts');
const integrationAdapters = readSource('src/services/integrationAdapters.ts');
const postRunReadiness = readSource('src/services/postRunReadiness.ts');
const ticketFilters = readSource('src/services/ticketFilters.ts');
const reviewWork = readSource('src/services/reviewWork.ts');
const reviewMonitor = readSource('src/services/reviewMonitor.ts');
const deployMonitorHandoff = readSource('src/services/deployMonitorHandoff.ts');
const promptManager = readSource('src/services/promptManager.ts');
const runRecovery = readSource('src/services/runRecovery.ts');
const providerReachability = readSource('src/services/providerReachability.ts');
const ticketMutations = readSource('src/services/ticketMutations.ts');
const queueMutations = readSource('src/services/queueMutations.ts');
const projectMutations = readSource('src/services/projectMutations.ts');
const doctorChecks = readSource('src/services/doctorChecks.ts');
const stateScriptAdapter = readSource('src/services/stateScriptAdapter.ts');
const nextActionContext = readSource('src/services/nextActionContext.ts');
const gitWorkspace = readSource('src/services/gitWorkspace.ts');
const processTree = readSource('src/services/processTree.ts');
const webviewDiagnostics = readSource('src/services/webviewDiagnostics.ts');
const webviewSecurity = readSource('src/services/webviewSecurity.ts');
const webviewActionPanelScript = readSource('media/kronos-action-panel.js');
const operatorPanel = readSource('src/services/operatorPanel.ts');
const promptPanelView = readSource('src/services/promptPanelView.ts');
const recoveryPanelView = readSource('src/services/recoveryPanelView.ts');
const humanReviewPanelView = readSource('src/services/humanReviewPanelView.ts');
const evidencePanelView = readSource('src/services/evidencePanelView.ts');
const cliProbes = readSource('src/services/cliProbes.ts');
const combinedVerification = readSource('src/services/combinedVerification.ts');
const changedFiles = readSource('src/services/changedFiles.ts');
const sonarReportView = readSource('src/services/sonarReportView.ts');
const agingReportView = readSource('src/services/agingReportView.ts');
const webviewHtml = readSource('src/services/webviewHtml.ts');
const relativeTime = readSource('src/services/relativeTime.ts');
const unitTests = readSource('scripts/run-unit-tests.js');
const vscodeIgnore = readSource('.vscodeignore');
const packageManifest = readSource('package.json');
const extension = sources['src/extension.ts'];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function assertAbsent(pattern, message) {
  if (pattern.test(allSource)) {
    fail(message);
  }
}

function lineNumberAt(source, offset) {
  return source.slice(0, offset).split('\n').length;
}

function extractCallExpression(source, callStart) {
  const openParen = source.indexOf('(', callStart);
  if (openParen === -1) {
    return source.slice(callStart);
  }

  let depth = 0;
  let quote = '';
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let idx = openParen; idx < source.length; idx += 1) {
    const char = source[idx];
    const next = source[idx + 1];

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        idx += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      inLineComment = true;
      idx += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      idx += 1;
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(callStart, idx + 1);
      }
    }
  }
  return source.slice(callStart);
}

function listCreateWebviewPanelCalls(file, source) {
  const calls = [];
  const pattern = /\bvscode\.window\.createWebviewPanel\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    calls.push({
      file,
      line: lineNumberAt(source, match.index),
      text: extractCallExpression(source, match.index),
    });
  }
  return calls;
}

function callHasExplicitWebviewScriptPolicy(file, source, call) {
  if (/\benableScripts\s*:\s*(true|false|interactive)\b/.test(call.text)) {
    return true;
  }
  if (/\bkronosScriptableWebviewOptions\s*\(/.test(call.text)) {
    return true;
  }
  if (
    file === 'src/runners/sessionDispatcher.ts'
    && /\bwebviewOptions\b/.test(call.text)
    && source.includes('const webviewOptions: vscode.WebviewOptions')
    && source.includes("{ enableScripts: interactive, localResourceRoots: [vscode.Uri.joinPath(options.extensionUri, 'media')] }")
    && source.includes('{ enableScripts: interactive }')
  ) {
    return true;
  }
  return false;
}

function assertExplicitWebviewScriptPolicy(file, source) {
  for (const call of listCreateWebviewPanelCalls(file, source)) {
    if (!callHasExplicitWebviewScriptPolicy(file, source, call)) {
      fail(`${file}:${call.line} createWebviewPanel must declare enableScripts or use kronosScriptableWebviewOptions.`);
    }
  }
}

function assertPanelUsesScriptableWebviewOptions(file, source, panelId) {
  const matches = listCreateWebviewPanelCalls(file, source).filter(call => call.text.includes(`'${panelId}'`));
  if (matches.length !== 1) {
    fail(`${file} must have exactly one ${panelId} webview panel, found ${matches.length}.`);
    return;
  }
  if (!/\bkronosScriptableWebviewOptions\s*\(/.test(matches[0].text)) {
    fail(`${file}:${matches[0].line} ${panelId} must use kronosScriptableWebviewOptions for media-backed scripts.`);
  }
}

assertAbsent(/\bexecSync\b/, 'Use execFileSync instead of execSync.');
assertAbsent(/\bexec\s*\(/, 'Use execFile instead of shell-string exec.');
assertAbsent(/onclick\s*=/, 'Inline webview onclick handlers are not allowed.');
assertAbsent(/\.innerHTML\s*=/, 'Use DOM text APIs instead of assigning innerHTML.');
assertAbsent(/vscode\.env\.openExternal\s*\(\s*vscode\.Uri\.parse/, 'Open external URLs through openExternalHttpUrl.');
assertAbsent(/command:\s*['"]vscode\.open['"]/, 'Tree views must route external links through kronos.openExternalUrl.');
assertAbsent(/worktree\s+remove[^;\n]*--force/, 'Forced git worktree removal is not allowed.');
assertAbsent(/--untracked-files=no/, 'Worktree cleanliness checks must include untracked files.');
assertAbsent(/git checkout develop/, 'Dispatch must not checkout develop in the main worktree.');
assertAbsent(/opts\.worktreeBranch\s*&&\s*opts\.worktreeBranch\s*!==\s*['"]origin\/develop['"]/, 'Worktree branch handling must not special-case origin/develop.');
assertAbsent(/const\s+KRONOS_DIR\s*=\s*path\.join\(os\.homedir\(\),\s*['"]\.claude['"],\s*['"]kronos['"]\)/, 'Use the shared stateStore KRONOS_DIR.');
assertAbsent(/source ~\/\.bashrc/, 'Dispatched Claude sessions must not use shell startup files.');
assertAbsent(/function shellQuote/, 'Dispatched Claude sessions must use argv spawning instead of shell quoting.');
assertAbsent(/spawn\(BASH_PATH,\s*\[\s*['"]--login['"],\s*['"]-c['"]/, 'Dispatched Claude sessions must not run through bash -c.');
assertAbsent(/noWorktree/, 'Do not reintroduce unused noWorktree dispatch options; managed worktrees are controlled by parallel.');
if (packageManifest.includes('kronos.useWorktrees')) {
  fail('Do not contribute stale kronos.useWorktrees settings without implemented behavior.');
}
if (/execFile(?:Sync)?\(\s*['"]python['"]/.test(nonScriptClientSource)) {
  fail('External Python scripts must be invoked through scriptClient.');
}
if (/writeJsonFileAtomic\(STATE_FILE/.test(extension)) {
  fail('Ticket state mutations must go through ticketMutations service helpers.');
}
if (/writeJsonFileAtomic/.test(extension)) {
  fail('Extension commands must route JSON file writes through service helpers.');
}
if (/saveQueueState/.test(extension)) {
  fail('Queue state writes must go through queueMutations service helpers.');
}
if (/execFileSync\(\s*['"]git['"]/.test(extension)) {
  fail('Extension commands must use gitWorkspace service instead of direct git execFileSync calls.');
}
if (/execFileSync\(\s*['"]git['"]/.test(dispatcher)) {
  fail('Dispatcher must use gitWorkspace service instead of direct git execFileSync calls.');
}
if (/execFileSync\s*\(/.test(extension)) {
  fail('Extension commands must use services instead of direct execFileSync calls.');
}
if (/execFileSync\s*\(/.test(sources['src/state/KronosState.ts'])) {
  fail('KronosState must use cliProbes/stateScriptAdapter instead of direct execFileSync calls.');
}
if (/execFileSync\s*\(/.test(dispatcher)) {
  fail('Dispatcher must use service helpers instead of direct execFileSync calls.');
}
if (/git merge origin\/\$\{b\}/.test(extension)) {
  fail('Combined verification must use combinedVerification branch planning instead of ticket-key merge guesses.');
}
for (const forbidden of ['--refresh-all', '--refresh', '--discover', '--register', '--adhoc-add', '--adhoc-done', '--morning-brief']) {
  if (sources['src/state/KronosState.ts'].includes(forbidden)) {
    fail(`KronosState must use stateScriptAdapter instead of raw script flag ${forbidden}.`);
  }
}
for (const forbidden of ['--ticket-comments', '--mr-diff', '--mr-branch', '--sonar-branches', '--sonar-gate', '--sonar-measures', '--sonar-issues', '--find-sonar-key', '--project-id']) {
  if (extension.includes(forbidden)) {
    fail(`Extension must use integrationAdapters instead of raw script flag ${forbidden}.`);
  }
}
for (const forbidden of ['--add-to-queue', '--remove-from-queue', '--link', '--unlink', '--next']) {
  if (extension.includes(forbidden)) {
    fail(`Extension must use queueMutations instead of raw queue/link script flag ${forbidden}.`);
  }
}
for (const forbidden of ['--set-project-config', '--unregister', '--set-setting']) {
  if (extension.includes(forbidden)) {
    fail(`Extension must use projectMutations instead of raw project/settings script flag ${forbidden}.`);
  }
}

for (const requiredIgnore of ['.git/**', '.claude/**', 'node_modules/**', 'scripts/**', 'vscode-user-*/**', 'CLAUDE.md', '*.zip', '*.tgz', '*.log', '.env*', 'GOOD_TO_GREAT_REVIEW.md', 'WINDOWS_FEEDBACK_*.md']) {
  if (!vscodeIgnore.split(/\r?\n/).includes(requiredIgnore)) {
    fail(`.vscodeignore must exclude ${requiredIgnore}`);
  }
}
const jiraBoardScript = readSource('media/kronos-jira-board.js');
const extensionUiSource = `${extension}\n${queuePlannerPanelView}\n${operationsReportPanelView}\n${jiraBoardScript}`;
for (const marker of [
  'function mockCommandName(command)',
  'function mockCommandLine(command, args)',
  "replace(/\\.(cmd|bat|exe)$/i, '')",
  "platform: 'win32'",
  "['gcloud', ['auth', 'application-default', 'print-access-token'], 10000]",
]) {
  if (!unitTests.includes(marker)) {
    fail(`Missing Windows command mock marker: ${marker}`);
  }
}
if (unitTests.includes("const joined = [command, ...args].join(' ');")) {
  fail('Unit test command mocks must normalize command names so gcloud.cmd works on Windows.');
}

assertExplicitWebviewScriptPolicy('src/extension.ts', extension);
assertExplicitWebviewScriptPolicy('src/runners/sessionDispatcher.ts', dispatcher);
for (const panelId of ['kronosJiraBoard', 'kronosDashboard', 'kronosHumanReviewInbox', 'kronosEvidenceGate', 'kronosAgingReport']) {
  assertPanelUsesScriptableWebviewOptions('src/extension.ts', extension, panelId);
}
for (const [file, source] of Object.entries({ 'src/extension.ts': extension, 'src/runners/sessionDispatcher.ts': dispatcher })) {
  for (const [idx, line] of source.split(/\r?\n/).entries()) {
    if (/panel\.webview\.html\s*=/.test(line) && !line.includes('withWebviewCsp(')) {
      fail(`${file}:${idx + 1} must assign webview HTML through withWebviewCsp.`);
    }
  }
}
for (const [idx, line] of extension.split(/\r?\n/).entries()) {
  if (/^\s*vscode\.window\.withProgress\(/.test(line)) {
    fail(`src/extension.ts:${idx + 1} must await progress tasks so command failures are surfaced.`);
  }
}
const directDispatchCallCount = (extension.match(/dispatchClaudeSession\(/g) || []).length;
if (directDispatchCallCount !== 1 || !extension.includes('const launch = await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt)') || !extension.includes('return launch.launched')) {
  fail('Extension command handlers must start Claude sessions through startClaudeDispatch.');
}
for (const [file, source] of Object.entries({
  'src/extension.ts': extension,
  'src/runners/sessionDispatcher.ts': dispatcher,
  'src/services/sonarReportView.ts': sonarReportView,
})) {
  if (source.includes('const vscode = acquireVsCodeApi()')) {
    fail(`${file} must use webviewVsCodeApiScript for webview API acquisition.`);
  }
}

const runCreateIndex = dispatcher.indexOf('const run = createRun');
const authPreflightIndex = dispatcher.indexOf('const authed = await ensureAuth()');
if (runCreateIndex < 0 || authPreflightIndex < 0 || runCreateIndex > authPreflightIndex) {
  fail('Dispatch must create a persisted run record before auth preflight.');
}
if (dispatcher.includes("fs.readFileSync(path.join(KRONOS_DIR, 'state.json')")) {
  fail('Dispatch must load project config through validated stateStore reads.');
}
if (dispatcher.includes('if (opts.onComplete) { opts.onComplete')) {
  fail('Dispatch completion callbacks must be awaited through runCompletionCallback.');
}
for (const marker of [
  "import { readStateFile } from '../services/stateStore'",
  'function configuredProjectExtraDirs',
  'const state = readStateFile()',
  'Could not read project extra_dirs',
]) {
  if (!dispatcher.includes(marker)) {
    fail(`Missing dispatcher state config marker: ${marker}`);
  }
}

for (const marker of [
  'buildJiraBoardHtml(state, nonce, scriptUri)',
  'webviewScriptCspOptions(panel.webview.cspSource, nonce)',
  'WEBVIEW_JIRA_BOARD_SCRIPT',
  'function kronosJiraBoardScriptUri',
  "vscode.Uri.joinPath(extensionUri, 'media', scriptFile)",
  'defer src="${escapeAttr(scriptUri)}"',
  'id="kronos-jira-ticket-data"',
  'class="kronos-data-payload"',
  "import { createWebviewReadyMonitor } from './services/webviewDiagnostics'",
  "import { isCodeAction, isProofSensitiveAction } from './services/actionSemantics'",
  "const logReady = createWebviewReadyMonitor(panel, 'Kronos Jira Board')",
  'if (logReady(msg)) { return; }',
  'BOARD_MESSAGE_COMMANDS',
  'function normalizeWebviewCommand',
  'function normalizeBoardMessage',
  'const request = normalizeBoardMessage(msg)',
  'const command = normalizeWebviewCommand(msg, sonarCommands)',
  'function openExternalHttpUrl',
  "console.warn(unknownErrorMessage(e, 'Invalid external URL.'))",
  "unknownErrorMessage(e, 'Failed to get next queue item.')",
  "warnUnexpectedPanelIntegrationError(e, 'Could not load comments')",
  "import { isKronosScriptMissingError } from './services/scriptClient'",
  'const OPTIONAL_SCRIPT_PANEL_WARNING =',
  'function warnUnexpectedPanelIntegrationError(error: unknown, fallback: string): string',
  'if (!isKronosScriptMissingError(error))',
  "unknownErrorMessage(e, 'Failed to register project.')",
  "unknownErrorMessage(e, 'Could not load SonarQube branches.')",
  "'(default; Sonar branches unavailable)'",
  'unknownErrorMessage(e, `Could not resolve MR branch for ${k}.`)',
  "from './services/webviewHtml'",
  'kronos.openExternalUrl',
  'async function confirmSafetyGate',
  'async function removeTicketFromQueue',
  "import { decideQueueRemoval } from './services/queueRemovalPolicy'",
  'const decision = decideQueueRemoval(ticketKey, ticket, interactive)',
  "decision.kind === 'block_failing_gate' || decision.kind === 'block_missing_evidence'",
  "decision.kind === 'confirm_failing_gate'",
  "decision.kind === 'confirm_missing_evidence'",
  "import { unknownErrorCode, unknownErrorMessage } from './services/errorUtils'",
  "import type { DiscoveredProject, MergeRequestChangedFile, QueueItem, Ticket } from './state/types'",
  'function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem',
  'function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void>',
  'return async (_code: number, run: KronosRun)',
  'await refreshAfterDispatch(state, projectName)(code, run)',
  "import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './services/runAttention'",
  'function runQuickPickDescription(run: KronosRun)',
  'description: runQuickPickDescription(run)',
  'const refreshWarning = await reloadStateAfterDispatch(state, projectName);',
  'run.warnings = [...(run.warnings || []), refreshWarning];',
  'async function reloadStateAfterDispatch(state: KronosState, projectName?: string): Promise<string | undefined>',
  "unknownErrorMessage(e, `Failed to refresh Kronos state after dispatch for ${projectName}.`)",
  'vscode.window.showWarningMessage(refreshWarning);',
  'function warnIfRunStillActive(run: KronosRun, action: \'retry\' | \'resume\'): boolean',
  'function isRetryableRun(run: KronosRun): boolean',
  'function isResumableRun(run: KronosRun): boolean',
  'return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok',
  "Run ${run.id} is still active. Stop it or let it finish before attempting to ${action}.",
  'async function retryRunFromPrompt(state: KronosState, run: KronosRun)',
  'onComplete: refreshAfterDispatch(state, projectName, ticketKey)',
  'await retryRunFromPrompt(state, run)',
  'async function resumeSelectedRun',
  'function resolveRunWorkspace',
  'async function archiveSelectedRun',
  'async function archiveFinishedRuns',
  "const FINISHED_ARCHIVE_STATUSES = new Set<KronosRun['status']>(['completed', 'waiting_for_review', 'failed', 'cancelled'])",
  'No completed, review-ready, failed, or cancelled Kronos runs to archive.',
  'Active, paused, and needs-human runs stay visible.',
  'async function openRunDiffArtifact',
  'async function markSelectedRunNeedsHuman',
  'async function cancelSelectedRun',
  'stopProcessTree(processPid)',
  'Open Workspace Diff',
  'Mark Needs Human',
  'Cancel Run',
  'Resume Run',
  'async function openRecoveryCenter',
  'buildRecoveryInventory',
  'function executeRecoveryAction',
  'function recoveryActionForRequest',
  'function openRecoveryPanel',
  'buildTicketTimeline',
  'function buildTicketTimelineHtml',
  'confirmDispatchCollisions',
  'detectDispatchCollisions',
  'kronos.extractAcceptanceCriteria',
  'extractAcceptanceCriteria',
  'kronos.updateAcceptanceCriteria',
  "from './services/evidenceData'",
  'const existingCriteria = evidenceAcceptanceCriteria(ticket)',
  'const criteria = evidenceAcceptanceCriteria(ticket)',
  'const notes = evidenceNotes(ticket)',
  'const checks = evidenceChecks(ticket)',
  'const environmentResults = evidenceEnvironmentResults(ticket)',
  'evidenceCount: evidenceRecordCount(t)',
  'function ticketStringArray',
  'function ticketAttachments',
  'interface TicketAttachmentSummary',
  'interface JiraBoardTicketPayload',
  'const ticketData: Record<string, JiraBoardTicketPayload>',
  'const linkedProjects = ticketStringArray(t.projects)',
  'const attachments = ticketAttachments(t.attachments)',
  'const projectList = ticketStringArray(ticket.projects)',
  'const mr = ticket.mr',
  'kronos.addEvidenceCheck',
  'kronos.recordEnvironmentResult',
  'addTicketEvidenceNote',
  'addTicketEvidenceCheck',
  'recordTicketEnvironmentResult',
  'replaceTicketAcceptanceCriteria',
  'updateTicketAcceptanceCriteria',
  "unknownErrorMessage(e, 'Failed to add ticket evidence.')",
  "unknownErrorMessage(e, 'Failed to add evidence check.')",
  "unknownErrorMessage(e, 'Failed to record environment result.')",
  "unknownErrorMessage(e, 'Failed to extract acceptance criteria.')",
  "unknownErrorMessage(e, 'Failed to update acceptance criteria.')",
  "unknownErrorMessage(e, 'Failed to publish evidence.')",
  "unknownErrorMessage(e, 'Failed to add to queue.')",
  'unknownErrorMessage(e, `Failed to remove ${name}.`)',
  "unknownErrorMessage(e, 'Could not resolve GitLab project ID.')",
  "unknownErrorMessage(e, 'Could not resolve SonarQube project key.')",
  "unknownErrorMessage(e, 'Could not update Kronos project integration config.')",
  "unknownErrorMessage(e, 'Failed to preview merge request link.')",
  "unknownErrorMessage(e, 'Failed to link merge request to ticket.')",
  "unknownErrorMessage(e, 'Failed to update ticket project links.')",
  "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  'kronos.humanReviewInbox',
  'openHumanReviewInbox',
  'const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set',
  "request.command === 'refreshPanel'",
  'const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>',
  'const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set(OPERATOR_COMMAND_TO_VSCODE_COMMAND.keys())',
  'const EVIDENCE_HANDOFF_OPERATOR_COMMANDS = operatorCommandSet([',
  'const DOCTOR_OPERATOR_COMMANDS = operatorCommandSet([',
  'function operatorCommandSet(commands: string[]): ReadonlySet<string>',
  'function attachOperatorCommandHandler(panel: vscode.WebviewPanel, webviewName: string, allowedCommands: ReadonlySet<string>): void',
  'normalizeActionPanelMessage(msg, allowedCommands)',
  "attachOperatorCommandHandler(panel, 'Kronos Evidence Handoff', EVIDENCE_HANDOFF_OPERATOR_COMMANDS)",
  "attachOperatorCommandHandler(panel, 'Kronos Doctor', DOCTOR_OPERATOR_COMMANDS)",
  'const commandId = OPERATOR_COMMAND_TO_VSCODE_COMMAND.get(command)',
  "vscode.window.showWarningMessage('Ignored unknown Kronos operator action.')",
  'await executeOperatorCommandAction(command, ticketKey)',
  "command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner'",
  'kronos.evidenceGate',
  'openEvidenceGatePanel',
  'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
  "if (request.command === 'refreshPanel') {\n        state.reloadAndNotify();\n        render();\n        return;\n      }",
  "openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true, extensionUri: context.extensionUri })",
  'options.refreshAllEvidenceGates',
  'function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[]',
  'isProofSensitiveAction(currentState.tickets[gate.ticketKey]?.next_action)',
  'isCodeAction(target.action)',
  'kronos.evidenceHandoff',
  'openEvidenceHandoffPanel',
  'kronos.publishEvidence',
  'openEvidencePublishPanel',
  'Publish Evidence Comment',
  "risks: ['external-publish']",
  'decideQueueRemoval(ticketKey, ticket, interactive)',
  'Gate Fails',
  'kronos.nextBestAction',
  'buildNextActionContext',
  'kronos.queuePlanner',
  'openQueuePlannerPanel',
  'kronos.backlogTriage',
  'openBacklogTriagePanel',
  'buildBacklogTriageHtml',
  'kronos.projectBatchPlan',
  'openProjectBatchPlanPanel',
  'buildProjectBatchPlanHtml',
  'Project Batch Plan',
  'kronos.releaseBatchPlan',
  'openReleaseBatchPlanPanel',
  'buildReleaseBatchPlanHtml',
  'Release Batch Plan',
  'kronos.filterTickets',
  'promptTicketView',
  'kronos.ticketSavedView',
  'kronos.clearTicketFilters',
  'kronos.filterReviews',
  'kronos.clearReviewFilters',
  'const updateReviewBadge = () =>',
  "const REVIEW_SEEN_KEYS_STORAGE_KEY = 'kronos.review.seenKeys.v1'",
  'function reviewSeenKeysStore(globalState: vscode.Memento): ReviewSeenKeysStore',
  'function normalizeReviewSeenKeys(value: unknown): string[] | undefined',
  'new ReviewTreeProvider(state, reviewSeenKeysStore(context.globalState))',
  'reviewTree.getNewReviewCount()',
  'view.badge = count > 0',
  'reviewTree.onDidChangeNewReviewCount(updateReviewBadge)',
  'reviewTree.onDidChangeNewReviewCount(() => notifyNewReviewItems(reviewTree, notifiedReviewKeys))',
  'reviewTree.markVisibleReviewItemsSeen()',
  "import { computeAttentionBadge } from './services/attentionBadge'",
  "import { configIntervalMs, configIntervalSeconds, configIntervalSecondsMs, parsePositiveNumberInput, positiveConfigNumber } from './services/intervalConfig'",
  'const updateAttentionBadge = () =>',
  'newReviewItems: reviewTree.getNewReviewCount()',
  'attentionBadgeTarget.badge = summary.count > 0',
  'reviewTree.onDidChangeNewReviewCount(updateAttentionBadge)',
  'const startRuntimePolling = () =>',
  'startRuntimePolling()',
  'vscode.workspace.onDidChangeConfiguration(e =>',
  "e.affectsConfiguration('kronos.pollIntervalSec')",
  "e.affectsConfiguration('kronos.sessionPollIntervalMs')",
  "e.affectsConfiguration('kronos.reviewPollIntervalSec')",
  "import { decideReviewMonitorAction, type ReviewMonitorDecision } from './services/reviewMonitor'",
  'const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000',
  "const sessionPollMs = configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000)",
  'startBackgroundRefreshPoll(throttledRefresh, configIntervalSecondsMs(config.get<number>(\'pollIntervalSec\', 300), 300, 1))',
  "const pollIntervalMs = configIntervalSecondsMs(config.get<number>('reviewPollIntervalSec', fallbackSec), fallbackSec, 60)",
  'let disposed = false',
  'if (disposed || running) { return; }',
  'await pollReviewMergeRequests(state, () => !disposed)',
  'disposed = true',
  'function updatePositiveNumberSetting',
  'parsePositiveNumberInput(input)',
  "console.warn(unknownErrorMessage(e, 'Review MR polling failed.'))",
  'void poll();',
  'function pollReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true)',
  'if (!shouldContinue()) { return; }',
  'state.reloadAndNotify();',
  'gitlabAdapter.mergeRequestStatus',
  'updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status })',
  'const decision = decideReviewMonitorAction(candidate.ticketKey, update)',
  "decision.kind === 'deploy_monitor'",
  'const started = await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket)',
  "if (started) {\n          rememberReviewTerminalMergeRequestAction(candidate.ticketKey, update.ticket, 'deploy_monitor');\n        }",
  "decision.kind === 'blocked'",
  'notifyReviewMonitorDecision(decision)',
  'notifyReviewMergeRequestPollFailure(candidate.ticketKey, e)',
  'function notifyReviewMergeRequestPollFailure(ticketKey: string, error: unknown): void',
  'MR status polling failed:',
  'function rememberReviewTerminalMergeRequestAction',
  'function reviewTerminalMergeRequestActionKey',
  'function notifyReviewMonitorDecision(decision: ReviewMonitorDecision): void',
  "const actions = decision.url ? ['Open MR', 'Open Review'] : ['Open Review']",
  "action === 'Open MR' && decision.url",
  'openExternalHttpUrl(decision.url)',
  "import { openReviewTicketEntries, reviewBranchTickets as buildReviewBranchTickets, type ReviewBranchTicket, type TicketWithOpenMergeRequest } from './services/reviewWork'",
  'return openReviewTicketEntries(state.state?.tickets)',
  'function reviewBranchTickets(state: KronosState): ReviewBranchTicket[]',
  'return buildReviewBranchTickets(state.state?.tickets)',
  "vscode.window.showInformationMessage('No open review MRs to fix.')",
  "vscode.window.showInformationMessage('Need at least 2 open review MRs to resolve conflicts.')",
  "vscode.window.showInformationMessage('No open review MRs to verify.')",
  'startDeployMonitorForMergedTicket',
  'async function startClaudeDispatch',
  'type DispatchOptions',
  'const launch = await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt)',
  'return launch.launched',
  'unknownErrorMessage(e, `Failed to start ${skill} session.`)',
  "import { deployMonitorAttentionIssue, deployMonitorHandoffCheckName, deployMonitorHandoffIssueSummary, hasDeployMonitorHandoffIssue, hasHandledDeployMonitorRun, resolveDeployMonitorProject } from './services/deployMonitorHandoff'",
  'const started = await startDeployMonitorForMergedTicket(state, update.ticketKey, update.ticket)',
  'if (started) { reviewTerminalMergeRequestActions.add(actionKey); }',
  "await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey",
  'projectNameOverride: projectName',
  'promptMetadata.mergeRequestIid = mrIid',
  'const currentTicket = state.state?.tickets?.[ticketKey] || ticket',
  'if (deployMonitorHandoffIssueSummary(currentTicket))',
  'resolveDeployMonitorProject(state.state, ticketKey, currentTicket)',
  'const deployMonitorRuns = [...listRuns(), ...readArchivedRuns()]',
  'const deployMonitorMatch = { projectName, projectPath, ticketKey, mrIid }',
  'hasHandledDeployMonitorRun(deployMonitorRuns, deployMonitorMatch)',
  'deploy monitor already handled',
  'const attentionIssue = deployMonitorAttentionIssue(deployMonitorRuns, deployMonitorMatch)',
  "vscode.window.showWarningMessage(attentionIssue, 'Run Center')",
  'recordDeployMonitorHandoffIssue(state, ticketKey, currentTicket, reason)',
  'hasDeployMonitorHandoffIssue(currentTicket, summary)',
  'deployMonitorHandoffCheckName(currentTicket)',
  "command: `kronos run deploy-monitor ${ticketKey}`",
  "environment: 'Kronos review monitor'",
  'kronos.collisionReport',
  'openCollisionReportPanel',
  'loadMrFileHints',
  'LIVE_MR_DIFF_TIMEOUT_MS',
  'console.warn(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`))',
  'kronos.planNextTwoHours',
  'openQueuePlanWindowPanel',
  'kronos.overnightCandidates',
  'openOvernightCandidatesPanel',
  'addPlanToQueue',
  'recordPlanDecision',
  'kronos.agentQualityScore',
  'openAgentQualityScorePanel',
  'Agent Quality',
  'buildDashboardWorklist',
  'buildDashboardWorklistHtml',
  'Command Center',
  'await executeDashboardAction(state, request, context.extensionUri)',
  'function dashboardWorkItemActions',
  "actionButton('evidenceGate', 'Gate', { ticket, primary: true })",
  "actionButton('runCenter', 'Run Center', { runId })",
  'openInteractiveRunCenter(state, extensionUri, runId || undefined)',
  'await openRecoveryCenter(state, extensionUri, runId || undefined)',
  'await openRecoveryCenter(state, context.extensionUri, resolveRunId(item))',
  'openRecoveryPanel(state, inventory, backups, focusRunId, extensionUri)',
  'kronosScriptableWebviewOptions(extensionUri)',
  "actionButton('viewTicket', 'View', { ticket, primary: true })",
  "actionButton('startTicket', 'Start', { ticket })",
  'kronos.trendMetrics',
  'openTrendMetricsPanel',
  'Rework Rate',
  'kronos.agingReport',
  'openAgingReportPanel',
  'const AGING_REPORT_MESSAGE_COMMANDS = new Set',
  'Stale Critical',
  'kronos.integrationManifest',
  'openIntegrationManifestPanel',
  'Integration manifest',
  'kronos.snapshotIntegrationManifest',
  'snapshotIntegrationManifest',
  'kronos.profiles',
  'openProfilesPanel',
  'getActiveProfile',
  'kronos.promptSmokeTests',
  'openPromptSmokeTestsPanel',
  'buildPromptSmokeTests',
  'kronos.snapshotPromptPack',
  'snapshotPromptPack',
  'kronos.promptHistory',
  'openPromptHistoryPanel',
  'kronos.repairPromptPack',
  'repairPromptPack',
  'Repair Prompt Pack',
  'doctorChecksInput',
  'runDoctorReachabilityChecks',
  'const render = (currentChecks: DoctorCheck[]) =>',
  ".catch((e: unknown) => render([...checks, {",
  "unknownErrorMessage(e, 'Provider reachability checks failed.')",
  'function runNotificationCommandAction',
  'function notifyNewReviewItems(reviewTree: ReviewTreeProvider, notifiedReviewKeys: Set<string>): void',
  'const items = reviewTree.getNewReviewItems()',
  'const currentKeys = new Set(items.map(item => item.activityKey || item.ticketKey))',
  'const freshItems = items.filter(item => !notifiedReviewKeys.has(item.activityKey || item.ticketKey))',
  'const activity = primary.activity ? ` - ${primary.activity}` :',
  '`${primary.ticketKey}: ${mr} needs review${activity}${suffix}`',
  "'kronosReview.focus'",
  'void selection.then(action => {',
  'void vscode.commands.executeCommand(command).then(undefined, (e: unknown) => {',
  'unknownErrorMessage(e, failureFallback)',
  "'Run Doctor',",
  "'kronos.doctor',",
  "'Failed to open Kronos Doctor.'",
  "'Run Setup',",
  "'kronos.setup',",
  "'Failed to start Kronos setup.'",
  "'Review Cleanup',",
  "'kronos.cleanupWorktrees',",
  "'Failed to open Kronos worktree cleanup.'",
  "from './services/doctorChecks'",
  "from './services/cliProbes'",
  "from './services/combinedVerification'",
  "from './services/changedFiles'",
  "from './services/sonarReportView'",
  'Retry Saved Prompt',
  'kronos.resumeRun',
  'async function pauseSelectedRun',
  'async function continueSelectedRun',
  'supportsProcessTreeSuspend()',
  'Run ${run.id} was not paused because no process signal was sent',
  'Run ${run.id} was not continued because no process signal was sent',
  'signalProcessTree(processPid',
  'Pause Run',
  'Continue Run',
  'kronos.pauseRun',
  'kronos.continueRun',
  'Archive Run',
  'Archive Finished',
  'kronos.cancelRun',
  "unknownErrorMessage(e, 'Failed to resume run.')",
  "unknownErrorMessage(e, 'Failed to archive run.')",
  'unknownErrorMessage(e, `Failed to archive ${run.id}.`)',
  'function isPathInsideDirectory(filePath: string, directoryPath: string): boolean',
  'fs.realpathSync(directoryPath)',
  'function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult',
  'async function openRunArtifactFileIfExists(filePath: string | undefined, missingMessage: string): Promise<void>',
  'Refusing to open run artifact outside Kronos runs directory.',
  "unknownErrorMessage(e, 'Failed to pause run.')",
  "unknownErrorMessage(e, 'Failed to continue run.')",
  "unknownErrorMessage(e, 'Failed to cancel run.')",
  "unknownErrorMessage(e, 'Failed to open run diff.')",
  "unknownErrorMessage(e, 'Failed to mark run needs-human.')",
  'runRecordPath(picked.run.id)',
  'let resolvedTicketKey = resolveDispatchTicketKey(ticketKey, run)',
  'await reloadStateAfterDispatch(state, projectName)',
  'function resolveDispatchTicketKey(ticketKey: string | undefined, run: KronosRun): string | undefined',
  "import { buildRunCompletionEvidenceCheck, buildRunCompletionEvidenceText, evaluatePostRunReadiness, resolvePostRunTicket, shouldRecordRunCompletionEvidence } from './services/postRunReadiness'",
  'addTicketRunCompletionEvidence',
  'const ticketResolutionInput:',
  'if (state.state?.tickets) { ticketResolutionInput.tickets = state.state.tickets; }',
  'const resolvedTicket = resolvePostRunTicket(ticketResolutionInput)',
  'projectName,',
  'evaluatePostRunReadiness',
  'ticket && shouldRecordRunCompletionEvidence({ run, ticket })',
  'addTicketRunCompletionEvidence(resolvedTicketKey, {',
  'note: {',
  "kind: 'note'",
  'buildRunCompletionEvidenceText(run, ticket)',
  'check: buildRunCompletionEvidenceCheck(run, ticket)',
  "unknownErrorMessage(e, 'Failed to add run completion evidence.')",
  'const reloadedTicketInput:',
  'const reloadedTicket = resolvePostRunTicket(reloadedTicketInput)',
  'resolvedTicketKey = reloadedTicket.ticketKey || resolvedTicketKey',
  'ticket = reloadedTicket.ticket',
  'run.failureReason = run.failureReason || run.readiness.summary',
  'writeRunRecord(run)',
  'await showRunCompletionToast(resolvedTicketKey, ticket, run)',
  'async function showRunCompletionToast(ticketKey: string, ticket: Ticket | undefined, run: KronosRun): Promise<void>',
  "import { buildRunCompletionNotification } from './services/runCompletionNotification'",
  'const notification = buildRunCompletionNotification(ticketKey, ticket, run)',
  "notification.severity === 'warning'",
  'vscode.window.showWarningMessage',
  "'Open Review'",
  "'Run Center'",
  "vscode.commands.executeCommand('kronos.openMrDiff'",
  'async function runCommandProgress',
  'await runCommandProgress(',
  'await vscode.window.withProgress(',
  'unknownErrorMessage(e, failureFallback)',
  "warnUnexpectedPanelIntegrationError(e, 'Kronos auto-refresh failed.')",
  'unknownErrorMessage(e, `Failed to register ${s.label || s.detail}.`)',
  "unknownErrorMessage(e, 'Failed to parse discovery results.')",
  "unknownErrorMessage(e, 'Failed to load MR diff.')",
  "unknownErrorMessage(e, 'Failed to generate dashboard.')",
  "'Failed to refresh Kronos projects.'",
  "'Failed to discover Kronos projects.'",
  "'Failed to open merge request diff.'",
  'kronos.recoveryCenter',
  'kronos.stateAuditLog',
  'openStateAuditLogPanel',
  'buildStateAuditLogHtml',
  'linkMrToTicket',
  'confirmSafetyGate({',
  'kronos.cleanupWorktrees',
  'kronos.restoreBackup',
  'kronos.resolveConflicts',
  'kronos.verifyCombined',
  "unknownErrorMessage(e, 'Failed to fetch SonarQube report.')",
  "unknownErrorMessage(e, 'Failed to update scan dirs.')",
  "unknownErrorMessage(e, 'Failed to restore backup.')",
  "unknownErrorMessage(e, 'Failed to snapshot integration manifest.')",
  'unknownErrorMessage(e, `Could not load Kronos env file ${envPath}.`)',
  "unknownErrorMessage(e, 'Could not inspect project remotes for setup.')",
  'unknownErrorMessage(e, `Could not inspect run workspace ${candidate}.`)',
  'unknownErrorMessage(e, `Could not resolve MR branch for ${ticket.key}.`)',
  'unknownErrorMessage(e, `Could not find fallback remote branch for ${ticket.key}.`)',
  "import { buildSonarReport, type SonarIssue }",
  'function recordFromUnknown(value: unknown): Record<string, unknown>',
  'function resolveProjectName(state: KronosState, item: unknown): string | undefined',
  "const ticket = recordFromUnknown(record['ticket'])",
  'function resolveTicketKey(item: unknown): string | undefined',
  "const nestedItem = recordFromUnknown(record['item'])",
  'panel.webview.onDidReceiveMessage(async (msg: unknown) =>',
  'function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
  'function formatSonarIssuePromptLine(issue: SonarIssue): string',
  "const issuesData = normalizeSonarIssueCommandList(commandArg['issuesData'])",
  'const lines = issuesData.map(formatSonarIssuePromptLine)',
  "from './services/stateStore'",
  "from './services/integrationAdapters'",
  "from './services/projectMutations'",
]) {
  if (!extension.includes(marker)) {
    fail(`Missing safety marker: ${marker}`);
  }
}
for (const marker of [
  'function kronosMediaScriptInlineFallback',
  'inlineFallbackScript',
  'data-kronos-inline-fallback="jira-board"',
  'function sanitizeInlineScript(script: string): string',
]) {
  if (extension.includes(marker)) {
    fail(`Jira Board should rely on packaged media scripts without inline fallback: ${marker}`);
  }
}
for (const marker of [
  "import { SafetyPlan, assessSafetyGate } from './services/safetyGate'",
  'async function confirmWorkspaceTrustForAssessment(assessment: ReturnType<typeof assessSafetyGate>): Promise<boolean>',
  '!assessment.requiresWorkspaceTrust || vscode.workspace.isTrusted',
  'const hasWorkspaceTrust = await confirmWorkspaceTrustForAssessment(assessment);',
  'const canDispatch = await confirmWorkspaceTrustForAssessment(assessSafetyGate({',
  "command: 'kronos.startClaudeDispatch'",
  'title: `Start Claude /${skill}`',
  "risks: ['repo-write']",
  'if (!canDispatch) { return false; }',
  'assessment.workspaceTrustSummary',
  'Manage Workspace Trust',
  "vscode.commands.executeCommand('workbench.trust.manage')",
  "unknownErrorMessage(e, 'Could not open Workspace Trust management.')",
]) {
  if (!extension.includes(marker)) {
    fail(`Missing workspace trust marker: ${marker}`);
  }
}
for (const marker of [
  'export type ReviewMonitorDecisionKind',
  'export interface ReviewMonitorDecision',
  'export function decideReviewMonitorAction',
  'update.mergedNow',
  "kind: 'deploy_monitor'",
  'update.closedNow',
  "kind: 'blocked'",
  'describeMergeRequestStatusChange(ticketKey, update)',
  "kind: 'notify'",
  "kind: 'none'",
]) {
  if (!reviewMonitor.includes(marker)) {
    fail(`Missing review monitor marker: ${marker}`);
  }
}
for (const marker of [
  'export function resolveDeployMonitorProject',
  'linkedProjects.length > 1',
  'export function hasHandledDeployMonitorRun',
  'isHandledDeployMonitorRun(run)',
  'HANDLED_DEPLOY_MONITOR_STATUSES',
  "'completed', 'waiting_for_review'",
  'promptMetadataMergeRequestIid',
  'if (match.mrIid === undefined) { return true; }',
  'if (runMrIid === undefined) { return false; }',
  'DEPLOY_MONITOR_HANDOFF_CHECK_PREFIX',
  'deployMonitorHandoffIssueSummary',
  'hasDeployMonitorHandoffIssue',
]) {
  if (!deployMonitorHandoff.includes(marker)) {
    fail(`Missing deploy monitor handoff marker: ${marker}`);
  }
}
for (const marker of [
  'function notifyMergeRequestStatusChange',
  "import { describeMergeRequestStatusChange } from './services/mergeRequestNotifications'",
]) {
  if (extension.includes(marker)) {
    fail(`Extension must route MR polling decisions through reviewMonitor instead of ${marker}.`);
  }
}
if (extension.includes('try { await state.refresh(); } catch {}')) {
  fail('Background Kronos refresh failures must be logged with a normalized warning.');
}
if (extension.includes('} catch {}')) {
  fail('Extension helpers must not silently swallow errors.');
}
if (extension.includes('const ticketData: Record<string, any>')) {
  fail('Jira board ticket data payload must stay typed, not Record<string, any>.');
}
if (extension.includes('skip failures silently')) {
  fail('Discovery registration failures must be visible to operators.');
}
if (extension.includes('function webviewScriptCsp(') || dispatcher.includes('function webviewScriptCsp(')) {
  fail('Webview CSP option construction must stay centralized in webviewSecurity.');
}

for (const marker of [
  'export function actionButton',
  'export function actionRow',
  'export function operatorCommandRow',
  'export interface ActionPanelMessage',
  'export function normalizeActionPanelMessage',
  'export function kronosActionPanelScript',
  'export function kronosOperatorPanelCss',
  'kronosWebviewBaseCss',
  "const command = message['command']",
  'ticket: stringField(message,',
  'runId: stringField(message,',
  'planId: stringField(message,',
  'itemId: stringField(message,',
  'recoveryAction: stringField(message,',
  'webviewActionScriptTag',
  'scriptUri?: string',
  'readyDiagnostic ? { readyCommand: WEBVIEW_READY_COMMAND } : {}',
  "{ messageKey: 'ticket', dataAttribute: 'data-ticket' }",
  "{ messageKey: 'runId', dataAttribute: 'data-run-id' }",
  "{ messageKey: 'planId', dataAttribute: 'data-plan-id' }",
  "{ messageKey: 'itemId', dataAttribute: 'data-item-id' }",
  "{ messageKey: 'recoveryAction', dataAttribute: 'data-recovery-action' }",
  "data-action=\"${escapeAttr(action)}\"",
  "data-plan-id=\"${escapeAttr(options.planId)}\"",
  "data-item-id=\"${escapeAttr(options.itemId)}\"",
  "data-recovery-action=\"${escapeAttr(options.recoveryAction)}\"",
]) {
  if (!operatorPanel.includes(marker)) {
    fail(`Missing operator panel helper marker: ${marker}`);
  }
}

const boardHandlerStart = extension.indexOf('panel.webview.onDidReceiveMessage(async (msg) => {\n        if (logReady(msg)) { return; }\n        const request = normalizeBoardMessage(msg);');
const boardHandlerEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.viewTicket'", boardHandlerStart);
if (boardHandlerStart < 0 || boardHandlerEnd <= boardHandlerStart) {
  fail('Missing Jira board message handler block.');
}
const boardHandlerSource = extension.slice(boardHandlerStart, boardHandlerEnd);
if (extension.includes(".filter(([_, t]) => t.next_action === 'await_review' && t.mr)")) {
  fail('Review branch commands should share the open-MR review candidate helper.');
}
if (extension.includes('mr: ticket.mr!')) {
  fail('Review branch helper should not need non-null assertions.');
}
if (!extension.includes('function startActiveRunPanelRefresh(')) {
  fail('Missing shared active-run webview panel refresh helper.');
}
if (!extension.includes("warnUnexpectedPanelIntegrationError(e, 'Kronos panel auto-refresh failed.')")) {
  fail('Panel auto-refresh errors should be normalized.');
}
for (const [label, startMarker, endMarker] of [
  ['Dashboard', "vscode.commands.registerCommand('kronos.openDashboard'", "    vscode.commands.registerCommand('kronos.queueMoveUp'"],
  ['Human Review Inbox', 'function openHumanReviewInbox', 'async function executeHumanReviewAction'],
  ['Evidence Gate', 'function openEvidenceGatePanel', 'function evidenceGatePanelGatesForState'],
  ['Aging Report', 'function openAgingReportPanel', 'function openIntegrationManifestPanel'],
]) {
  const start = extension.indexOf(startMarker);
  const end = extension.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    fail(`Missing ${label} panel block.`);
  }
  if (!extension.slice(start, end).includes('startActiveRunPanelRefresh(panel, state, render)')) {
    fail(`${label} should auto-refresh while runs are active.`);
  }
}
if (extension.includes('normalizeActionPanelMessage(msg, OPERATOR_COMMAND_MESSAGE_COMMANDS)')) {
  fail('Generic operator panels must pass panel-specific allow-lists.');
}
const evidenceGateHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);');
const evidenceGateHandlerEnd = extension.indexOf('function openEvidenceHandoffPanel', evidenceGateHandlerStart);
if (evidenceGateHandlerStart < 0 || evidenceGateHandlerEnd <= evidenceGateHandlerStart) {
  fail('Missing Evidence Gate message handler block.');
}
const evidenceGateHandlerSource = extension.slice(evidenceGateHandlerStart, evidenceGateHandlerEnd);
if (!evidenceGateHandlerSource.includes("if (request.command === 'refreshPanel') {\n        state.reloadAndNotify();\n        render();\n        return;\n      }")) {
  fail('Evidence Gate refresh should reload state before rendering.');
}
const dashboardHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);');
const dashboardHandlerEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.queueMoveUp'", dashboardHandlerStart);
if (dashboardHandlerStart < 0 || dashboardHandlerEnd <= dashboardHandlerStart) {
  fail('Missing Dashboard message handler block.');
}
const dashboardHandlerSource = extension.slice(dashboardHandlerStart, dashboardHandlerEnd);
if (!dashboardHandlerSource.includes("if (request.command === 'refreshPanel') {\n              state.reloadAndNotify();\n              await render();\n              return;\n            }")) {
  fail('Dashboard refresh should reload state before rendering.');
}
const agingHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);');
const agingHandlerEnd = extension.indexOf('function openIntegrationManifestPanel', agingHandlerStart);
if (agingHandlerStart < 0 || agingHandlerEnd <= agingHandlerStart) {
  fail('Missing Aging Report message handler block.');
}
const agingHandlerSource = extension.slice(agingHandlerStart, agingHandlerEnd);
if (!agingHandlerSource.includes("if (request.command === 'refreshPanel') {")
  || !agingHandlerSource.includes("await runWebviewPanelAction(() => {\n        state.reloadAndNotify();\n        render();")
  || !agingHandlerSource.includes("'Kronos aging report action failed.'")
  || !agingHandlerSource.includes('return;')) {
  fail('Aging Report refresh should reload state before rendering.');
}
for (const forbidden of [
  "actionButton('openEvidenceGate'",
  "actionButton('openRunCenter'",
  "actionButton('openRecoveryCenter'",
  "actionButton('openDoctor'",
]) {
  if (extension.includes(forbidden)) {
    fail(`Human review actions should use canonical operator commands, not ${forbidden}.`);
  }
}
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (boardHandlerSource.includes(forbidden)) {
    fail(`Jira board handler must normalize unknown errors instead of using ${forbidden}.`);
  }
}

const evidenceCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.addEvidence'");
const evidenceCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.evidenceGate'", evidenceCommandStart);
if (evidenceCommandStart < 0 || evidenceCommandEnd <= evidenceCommandStart) {
  fail('Missing evidence command handler block.');
}
const evidenceCommandSource = extension.slice(evidenceCommandStart, evidenceCommandEnd);
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (evidenceCommandSource.includes(forbidden)) {
    fail(`Evidence command handlers must normalize unknown errors instead of using ${forbidden}.`);
  }
}

const publishProjectCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.publishEvidence'");
const publishProjectCommandEnd = extension.indexOf('            const setupPrompt = `Set up project', publishProjectCommandStart);
if (publishProjectCommandStart < 0 || publishProjectCommandEnd <= publishProjectCommandStart) {
  fail('Missing publish/project command handler block.');
}
const publishProjectCommandSource = extension.slice(publishProjectCommandStart, publishProjectCommandEnd);
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (publishProjectCommandSource.includes(forbidden)) {
    fail(`Publish/project command handlers must normalize unknown errors instead of using ${forbidden}.`);
  }
}

const mrTicketLinkCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.linkMrToTicket'");
const mrTicketLinkCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.sessionHistory'", mrTicketLinkCommandStart);
if (mrTicketLinkCommandStart < 0 || mrTicketLinkCommandEnd <= mrTicketLinkCommandStart) {
  fail('Missing MR and ticket link command handler block.');
}
const mrTicketLinkCommandSource = extension.slice(mrTicketLinkCommandStart, mrTicketLinkCommandEnd);
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (mrTicketLinkCommandSource.includes(forbidden)) {
    fail(`MR and ticket link command handlers must normalize unknown errors instead of using ${forbidden}.`);
  }
}

const runActionStart = extension.indexOf('async function resumeSelectedRun');
const runActionEnd = extension.indexOf('function runLastEventLabel');
if (runActionStart < 0 || runActionEnd <= runActionStart) {
  fail('Missing extension run action helper block.');
}
const runActionSource = extension.slice(runActionStart, runActionEnd);
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (runActionSource.includes(forbidden)) {
    fail(`Run action helpers must normalize unknown errors instead of using ${forbidden}.`);
  }
}

for (const forbidden of [
  'catch (e: any)',
  'e?.message',
  'panel.webview.onDidReceiveMessage(async (msg: any)',
  'issuesData.map((iss: any)',
  "vscode.commands.registerCommand('kronos.refreshProject', async (item: any)",
  "vscode.commands.registerCommand('kronos.implement', async (item: any)",
  "vscode.commands.registerCommand('kronos.deployMonitor', async (item: any)",
  "vscode.commands.registerCommand('kronos.verifyFix', async (item: any)",
  "vscode.commands.registerCommand('kronos.completeTask', async (item: any)",
  "vscode.commands.registerCommand('kronos.openProject', async (item: any)",
  "vscode.commands.registerCommand('kronos.openInClaude', async (item: any)",
  "vscode.commands.registerCommand('kronos.removeProject', async (item: any)",
  "vscode.commands.registerCommand('kronos.viewTicket', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.addEvidence', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.addEvidenceCheck', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.recordEnvironmentResult', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.extractAcceptanceCriteria', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.updateAcceptanceCriteria', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.evidenceGate', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.exportEvidence', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.evidenceHandoff', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.publishEvidence', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: any)",
  "vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.sonarScan', async (item: any)",
  "vscode.commands.registerCommand('kronos.sonarReport', async (item: any)",
  "vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: any)",
  "vscode.commands.registerCommand('kronos.fixFinding', async (args: any)",
  "vscode.commands.registerCommand('kronos.verifyDevelop', async (item: any)",
  "vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: any)",
  "vscode.commands.registerCommand('kronos.unlinkTicket', async (item: any)",
  "await startClaudeDispatch(projectPath, 'verify-fix', item?.ticketKey,",
  'if (item?.taskId)',
  'const projectPath = getProjectPath(state, item?.projectName);',
  'name: item.projectName,',
  'const name = item?.projectName;',
  'item?.sourceBranch ||',
  'function planToQueueItem(state: KronosState, plan: PlannedAction): any',
  'function resolveProjectName(state: KronosState, item: any)',
  'function resolveTicketKey(item: any)',
  'return async (_code: number, run?: any)',
  'await refreshAfterDispatch(state, projectName)(code);',
  'vscode.commands.executeCommand(`kronos.${command}`',
  'await vscode.commands.executeCommand(`kronos.${command}`',
]) {
  if (extension.includes(forbidden)) {
    fail(`Extension command handlers must normalize unknown errors instead of using ${forbidden}.`);
  }
}
for (const forbiddenPattern of [
  /^\s+vscode\.commands\.executeCommand\('kronos\.viewTicket', \{ ticketKey: picked\.plan\.ticketKey \}\);/m,
  /^\s+vscode\.commands\.executeCommand\('kronos\.addEvidence', \{ ticketKey: picked\.plan\.ticketKey \}\);/m,
  /^\s+vscode\.commands\.executeCommand\('kronos\.implement', \{ ticketKey: ticket \}\);/m,
  /^\s+vscode\.commands\.executeCommand\('kronos\.doctor'\);/m,
]) {
  if (forbiddenPattern.test(extension)) {
    fail(`Extension command handlers must await command promises: ${forbiddenPattern}`);
  }
}
for (const marker of [
  "vscode.commands.registerCommand('kronos.refreshProject', async (item: unknown)",
  'const projectName = resolveProjectName(state, item) || await pickProjectName(state,',
  'async function pickProjectName(state: KronosState, placeHolder: string): Promise<string | undefined>',
  "vscode.commands.registerCommand('kronos.implement', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.deployMonitor', async (item: unknown)",
  "handoff: 'manual-deploy-monitor'",
  "const mrIid = ticketKey ? state.state?.tickets?.[ticketKey]?.mr?.iid : undefined",
  'promptMetadata.mergeRequestIid = mrIid',
  'promptMetadata,',
  "vscode.commands.registerCommand('kronos.verifyFix', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.completeTask', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.openProject', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.openInClaude', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.removeProject', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.viewTicket', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.addEvidence', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.addEvidenceCheck', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.recordEnvironmentResult', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.extractAcceptanceCriteria', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.updateAcceptanceCriteria', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.evidenceGate', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.exportEvidence', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.evidenceHandoff', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.publishEvidence', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: unknown)",
  "vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.sonarScan', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.sonarReport', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.fixFinding', async (args: unknown)",
  "vscode.commands.registerCommand('kronos.verifyDevelop', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: unknown)",
  "vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: unknown)",
  "vscode.commands.registerCommand('kronos.unlinkTicket', async (item: unknown)",
  'const queueData = resolveQueueCommandItem(treeItemOrData);',
  'const idx = resolveQueueIndex(treeItem);',
  'await startClaudeDispatch(projectPath, skill, queueData.ticket || undefined,',
  'interface QueueCommandPayload',
  'function resolveQueueCommandItem(item: unknown): QueueCommandPayload | undefined',
  'function queueCommandPayloadFromRecord(record: Record<string, unknown>): QueueCommandPayload | undefined',
  'function resolveQueueIndex(item: unknown): number | undefined',
  'function stringFromUnknown(value: unknown): string | undefined',
  "const branch = mode.value === 'new' ? (stringFromUnknown(commandArg['branch']) || baseBranch) : '';",
  "const sourceBranch = stringFromUnknown(commandArg['sourceBranch']) || '';",
  'const projectName = resolveProjectName(state, args);',
  "const projectPath = stringFromUnknown(commandArg['projectPath']) || getProjectPath(state, projectName);",
  'let projectName = resolveProjectName(state, item);',
  'function resolveMergeRequestUrl(item: unknown): string | undefined',
  'const orphanKey = resolveTicketKey(treeItem);',
  'const url = resolveMergeRequestUrl(treeItem);',
  'const ticketKey = resolveTicketKey(ticketKeyOrItem);',
  "const projectName = stringFromUnknown(recordFromUnknown(item)['linkedProject']);",
  'function resolveTaskId(item: unknown): string | undefined',
]) {
  if (!extension.includes(marker)) {
    fail(`Extension dispatch command must keep tree payloads unknown: ${marker}`);
  }
}

const queueCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.addToQueue'");
const queueCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.sonarScan'", queueCommandStart);
if (queueCommandStart < 0 || queueCommandEnd <= queueCommandStart) {
  fail('Missing queue command handler block.');
}
const queueCommandSource = extension.slice(queueCommandStart, queueCommandEnd);
for (const forbidden of [
  'const ticketKey = treeItem?.ticketKey;',
  'const ticketKey = (treeItem?.item || treeItem)?.ticket;',
  'const queueData = treeItemOrData?.item || treeItemOrData;',
  'const idx = treeItem?.index;',
  'const mr = treeItem?.ticket?.mr;',
  'await startClaudeDispatch(projectPath, skill, queueData.ticket,',
]) {
  if (queueCommandSource.includes(forbidden)) {
    fail(`Queue command handlers must normalize payloads before use: ${forbidden}`);
  }
}

const sonarCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.sonarScan'");
const sonarCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.verifyTest'", sonarCommandStart);
if (sonarCommandStart < 0 || sonarCommandEnd <= sonarCommandStart) {
  fail('Missing Sonar command handler block.');
}
const sonarCommandSource = extension.slice(sonarCommandStart, sonarCommandEnd);
for (const forbidden of [
  "vscode.commands.registerCommand('kronos.sonarScan', async (item: any)",
  "vscode.commands.registerCommand('kronos.sonarReport', async (item: any)",
  "vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: any)",
  "vscode.commands.registerCommand('kronos.fixFinding', async (args: any)",
  "vscode.commands.registerCommand('kronos.verifyDevelop', async (item: any)",
  'item?.branch',
  'args?.projectName',
  'args?.projectPath',
  'let projectName = item?.projectName;',
  'item?.sourceBranch ||',
]) {
  if (sonarCommandSource.includes(forbidden)) {
    fail(`Sonar command handlers must normalize payloads before use: ${forbidden}`);
  }
}
for (const forbiddenPattern of [
  /^\s+vscode\.commands\.executeCommand\('kronos\.sonarReport', \{ projectName \}\);/m,
  /^\s+vscode\.commands\.executeCommand\('kronos\.fixSonarIssues', \{ projectName, sourceBranch: branch, issuesData: report\.issueList \}\);/m,
  /^\s+vscode\.commands\.executeCommand\('kronos\.fixFinding', \{ projectName, projectPath, tickets: ticketList \}\);/m,
]) {
  if (forbiddenPattern.test(sonarCommandSource)) {
    fail(`Sonar command handlers must await command promises: ${forbiddenPattern}`);
  }
}

const mrLinkCommandStart = extension.indexOf("vscode.commands.registerCommand('kronos.rejectReview'");
const mrLinkCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.sessionHistory'", mrLinkCommandStart);
if (mrLinkCommandStart < 0 || mrLinkCommandEnd <= mrLinkCommandStart) {
  fail('Missing MR and ticket link command handler block.');
}
const mrLinkCommandSource = extension.slice(mrLinkCommandStart, mrLinkCommandEnd);
for (const forbidden of [
  "vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: any)",
  "vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: any)",
  "vscode.commands.registerCommand('kronos.unlinkTicket', async (item: any)",
  'treeItem?.ticketKey',
  'treeItem?.ticket?.mr',
  'ticketKeyOrItem?.ticketKey',
  'item?.linkedProject',
]) {
  if (mrLinkCommandSource.includes(forbidden)) {
    fail(`MR and ticket link command handlers must normalize payloads before use: ${forbidden}`);
  }
}

for (const marker of [
  'merge_request',
  'linkMrToTicket',
  'RecoveryTicket',
  'runStoreIssues',
  'recoveryItemForRunStoreIssue',
  'Invalid ${scopeLabel} run record',
  'registryIssue',
  'recoveryItemForWorktreeRegistryIssue',
  'Active worktree registry needs manual review',
  'recoveryItemForOrphanMergeRequest',
  'Link MR to Ticket',
  'secondaryActions',
  'terminalRunSecondaryActions',
  "'openRunLog'",
  "'openRunPrompt'",
  "'retryRun'",
  "'archiveRun'",
]) {
  if (!recoveryCenter.includes(marker)) {
    fail(`Missing recovery center marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildRecoveryHtml',
  'export function buildStateAuditLogHtml',
  'StateAuditEvent',
  'Kronos Recovery Center',
  'Kronos State Audit Log',
  "actionButton('executeRecoveryItem'",
  'recoveryActionButtons',
  'actionRow(buttons)',
  'recoveryActionOptions(item, action.action, false)',
  'focusedRecoveryItemSort',
  'focused-recovery-item',
  'recoveryActionLabel',
  'kronosOperatorPanelCss',
  "kronosActionPanelScript(nonce, 'Kronos Recovery Center', true, actionScriptUri)",
]) {
  if (!recoveryPanelView.includes(marker)) {
    fail(`Missing recovery panel view marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildHumanReviewInboxHtml',
  'HumanReviewInboxHtmlOptions',
  'Kronos Human Review Inbox',
  'humanReviewActionButtons',
  "actionButton('refreshPanel', 'Refresh')",
  "actionButton('extractAcceptanceCriteria', 'Extract AC'",
  "actionButton('startTicket', 'Start'",
  "actionButton('evidenceGate', 'Gate'",
  "actionButton('runCenter', 'Open Run Center'",
  "actionButton('recoveryCenter', 'Recovery'",
  "actionButton('doctor', 'Open Doctor'",
  'kronosOperatorPanelCss',
  'kronosActionPanelScript(options.nonce',
]) {
  if (!humanReviewPanelView.includes(marker)) {
    fail(`Missing human review panel view marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildEvidenceGateHtml',
  'export function buildEvidenceHandoffHtml',
  'export function buildEvidencePublishHtml',
  'Evidence Handoff:',
  'Evidence Publish:',
  'Kronos Evidence Gate',
  'Kronos did not call a posting API',
  'publishPillClass',
  'evidenceGateActionButtons',
  "actionButton('refreshPanel', 'Refresh')",
  "actionButton('addEvidence', 'Add Evidence'",
  "actionButton(isMissingExtraction ? 'extractAcceptanceCriteria' : 'updateAcceptanceCriteria'",
  "actionButton('recordEnvironmentResult', 'Record Env'",
  "actionButton('evidenceHandoff', 'Handoff'",
  "actionButton('publishEvidence', 'Publish'",
  'safeHttpHref',
  'kronosOperatorPanelCss',
  "kronosActionPanelScript(nonce, 'Kronos Evidence Gate', true, actionScriptUri)",
]) {
  if (!evidencePanelView.includes(marker)) {
    fail(`Missing evidence panel view marker: ${marker}`);
  }
}

for (const marker of [
  'export function kronosWebviewBaseCss',
  '--k-bg: var(--vscode-editor-background)',
  '.kronos-header',
  '.kronos-table',
  '.kronos-empty',
  '.kronos-stat-grid',
  '.kronos-pill.pass',
  '.kronos-input',
  '.kronos-toolbar',
  '.kronos-card',
  '.kronos-empty.compact',
  '.kronos-script-required',
  'html[data-kronos-script-ready="true"] .kronos-script-required',
]) {
  if (!webviewHtml.includes(marker)) {
    fail(`Missing shared webview design marker: ${marker}`);
  }
}

for (const marker of [
  'kronosWebviewBaseCss',
  'id="board-filter"',
  'id="board-filter-summary"',
  'function applyBoardFilter',
  'let lastFocusedEl = null',
  'function formatWebviewDateTime',
  'escapeClass',
  'data-search="${attr(searchText)}"',
  "'To Do': [], 'Queued': [], 'In Progress': [], 'Review': [], 'Blocked': [], 'Done': []",
  "done: 'Done'",
  'data-empty',
  "empty.textContent = query ? 'No matching tickets.' : 'No tickets.'",
  'isQueued,',
  "makeButton(t.isQueued ? 'Remove from Queue' : 'Add to Queue'",
  'function normalizeCommentsPayload',
  "console.warn('Kronos Jira Board could not parse comments payload', error)",
  "post(t.isQueued ? 'removeFromQueue' : 'addToQueueFromModal'",
  "linkTicketToProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
  "unlinkTicketFromProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
  "const result = addTicketToQueue(ticket);\n              state.reloadAndNotify();\n              renderBoard();",
  "await removeTicketFromQueue(state, ticket, true, context.extensionUri);\n            renderBoard();",
  "unknownErrorMessage(e, 'Failed to link ticket.')",
  "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  "unknownErrorMessage(e, 'Failed to add ticket to queue.')",
  'class="kronos-shell board-shell"',
  'class="kronos-shell dashboard-shell"',
  'let data: unknown = {}',
  'let loadWarning: string | undefined',
  "loadWarning = warnUnexpectedPanelIntegrationError(e, 'Morning brief unavailable.')",
  'const actionScriptUri = kronosActionPanelScriptUri(panel, context.extensionUri)',
  'buildDashboardHtml(state, data, nonce, loadWarning, actionScriptUri)',
  "kronosActionPanelScript(nonce, 'Kronos Dashboard', true, actionScriptUri)",
  "function openAgingReportPanel(state: KronosState, extensionUri?: vscode.Uri)",
  "kronosActionPanelScript(nonce, 'Kronos Aging Report', true, actionScriptUri)",
  'Morning brief unavailable',
  'dashboard-warning',
  'class="kronos-shell ticket-shell"',
  'class="kronos-shell diff-shell"',
  'function dashboardBriefRecord',
  'function dashboardBriefItems',
  'function dashboardBriefCount',
  'class="kronos-shell operator-shell"',
  'operator-summary',
  'summary-card',
  'table-wrap kronos-panel',
  'operator-card',
  'operator-hero',
  'plan-list',
  '.file-link.add',
  'Kronos Prompt Manager',
  'Kronos Doctor',
]) {
  if (!extensionUiSource.includes(marker)) {
    fail(`Missing UI/UX marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildPromptManagerHtml',
  'export function buildPromptHistoryHtml',
  'export function buildPromptSmokeTestsHtml',
  'requiredPrompts.filter',
  'Kronos Prompt Manager',
  'Kronos Prompt History',
  'Kronos Prompt Smoke Tests',
  'promptSmokeResultRow',
  'promptTemplateRow',
  'kronosOperatorPanelCss',
  'actionScriptUri?: string',
  "kronosActionPanelScript(nonce, 'Kronos Prompt Manager', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Prompt History', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Prompt Smoke Tests', true, actionScriptUri)",
]) {
  if (!promptPanelView.includes(marker)) {
    fail(`Missing prompt panel view marker: ${marker}`);
  }
}

for (const marker of [
  'export function archiveRun',
  'export function readRunRecord',
  'export function listRunStoreIssues',
  'export interface RunStoreIssue',
  '[key: string]: unknown',
  'function readRequiredRunRecord',
  'Invalid run record',
  'export function markRunNeedsHuman',
  'export function markRunCancelled',
  'export function markRunPaused',
  'export function markRunContinued',
  'mark-needs-human',
  'cancel-run',
  'pause-run',
  'continue-run',
  "run.failureKind = run.failureKind || 'unknown'",
  "run.failureKind = 'cancelled'",
  "import { unknownErrorCode, unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Unable to parse JSON.')",
  'writeTextAtomic(promptPath, prompt)',
  'ARCHIVED_RUNS_DIR',
  "safeFileStem(runId, { fallback: 'run' })",
  'Refusing to append run log outside active runs directory',
  'function moveRunArtifactIfExists',
  'function isPathInside',
  'outside active runs directory',
  'run.archiveWarnings = warnings',
  "import { effectiveRunStatus, isActiveRunStatus, isStaleActiveRun } from './runStatus'",
  'function normalizeTerminalActiveRun',
  'const effectiveStatus = effectiveRunStatus(run)',
  'const PROCESS_BACKED_ACTIVE_STATUSES',
  'function terminalRunOutcomeFromDeadProcess',
  'function terminalRunOutcomeFromStaleProcesslessRun',
  'isStaleActiveRun(run)',
  'Stale active run needs human review',
  'function processIsGone',
  "unknownErrorCode(e) === 'ESRCH'",
  'Run record had terminal metadata while persisted status was ${status}',
  'export function repairActiveRunRecords',
  'function normalizeRunView',
  'writeJsonAtomic(filePath, normalized)',
]) {
  if (!runStore.includes(marker)) {
    fail(`Missing run store marker: ${marker}`);
  }
}
if (runStore.includes('function normalizeRunFile')) {
  fail('Run store reads must not persist terminal-active repairs through normalizeRunFile.');
}
if (runStore.includes('[key: string]: any')) {
  fail('Run store records must keep extension fields unknown, not any.');
}

for (const marker of [
  'export function safeFileStem',
  'export function safePromptFileName',
  'Invalid prompt template name',
  "createHash('sha256')",
  'hashLength',
  'maxLength',
  "replace(/[^a-zA-Z0-9_.-]/g, '-')",
]) {
  if (!fileNames.includes(marker)) {
    fail(`Missing file name sanitizer marker: ${marker}`);
  }
}

for (const marker of [
  "safeFileStem(ticketKey, { fallback: 'ticket' })",
]) {
  if (!evidenceStore.includes(marker)) {
    fail(`Missing evidence store safe filename marker: ${marker}`);
  }
}

for (const marker of [
  'const fileName = safePromptFileName(name)',
  "safeFileStem(value, { fallback: 'prompt-snapshot', maxLength: 120 })",
]) {
  if (!promptManager.includes(marker)) {
    fail(`Missing prompt manager safe filename marker: ${marker}`);
  }
}

for (const marker of [
  'safePromptFileName(promptName)',
  'invalid prompt name',
  'path.join(promptDir, safePromptFileName(name))',
]) {
  if (!integrationManifest.includes(marker)) {
    fail(`Missing manifest prompt filename marker: ${marker}`);
  }
}

for (const marker of [
  'promptPath?: string',
  'writeRunPrompt(id, prompt)',
  'retryOfRunId?: string',
  'readiness?: PostRunReadiness',
  'type PostRunReadiness',
  'failureKind?: RunFailureKind',
  "'paused'",
  "'waiting_for_review'",
  'processPid?: number',
  'branch?: RunBranchMetadata',
  'permissions?: RunPermissionMetadata',
  'export interface RunBranchMetadata',
  'export interface RunPermissionMetadata',
  'readRunRecord(run.id)',
  'markRunCancelled(run.id',
  'const CLAUDE_PATH',
  'CLAUDE_PERMISSION_MODE',
  'CLAUDE_ALLOWED_TOOL_PATTERNS',
  'function buildClaudeArgs',
  'function buildRunPermissionMetadata',
  'function buildRunBranchMetadata',
  "from '../services/gitWorkspace'",
  'const currentRef = currentGitRef(input.cwd)',
  'if (currentRef) { metadata.currentRef = currentRef; }',
  'const currentCommit = currentGitCommit(input.cwd)',
  'if (currentCommit) { metadata.currentCommit = currentCommit; }',
  'function resolveCliPath',
  'spawn(CLAUDE_PATH, claudeArgs',
  "permissions: buildRunPermissionMetadata(['~/.claude'])",
  'const permissions = buildRunPermissionMetadata(addDirs)',
  'const branch = buildRunBranchMetadata({',
  'requestedWorktreeBranch',
  'resolvedWorktreeRef',
  'checkoutRef',
  'permissionSummary',
  'branchSummary',
  'Failed to launch Claude CLI',
  'type ClaudeProcess = ReturnType<typeof spawn>',
  'let proc: ClaudeProcess',
  '}) as ClaudeProcess',
  "const failureDetail = unknownErrorMessage(e, 'Failed to launch Claude CLI.')",
  "label: 'Failed to launch Claude CLI'",
  'GCP auth expired or missing.',
  'Authenticate and retry the saved prompt from Run Center.',
  "const failureDetail = unknownErrorMessage(e, 'Git worktree setup failed.')",
  "vscode.window.showWarningMessage('Git worktree setup failed; run marked failed before launch.')",
  "label: 'Git worktree setup failed'",
  "label: 'Managed worktree pull skipped'",
  'updateRun(run, { warnings: [...(run.warnings || []), warning] })',
  "failureKind: 'git'",
  'classifyRunFailure({ ...run',
  'spawnErrorHandled',
  'workspaceCwd?: string',
  'projectNameOverride?: string',
  'managedWorktreePath',
  'onComplete?: (code: number, run: KronosRun) => void | Promise<void>',
  'async function runCompletionCallback',
  'await opts.onComplete(code, run)',
  "unknownErrorMessage(e, 'Post-run completion callback failed.')",
  "label: 'Post-run completion callback failed'",
  "const nextStatus = run.status === 'completed' || run.status === 'waiting_for_review' ? 'needs_human' : run.status",
  'buildProgressHtml(context.projectName, context.skill, context.ticket, context.events, run)',
  'await runCompletionCallback(opts, code ?? 1, run',
  'Readiness',
  'function resolveBaseRef',
  'function configuredStateBaseBranch',
  'function configuredProjectJsonBaseBranch',
  'resolveDefaultBaseBranch',
  'projectBaseSource',
  'projectBaseWarning',
  'Could not fully resolve project base branch config',
  "from '../services/sessionStore'",
  "import { unknownErrorMessage } from '../services/errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Could not read Kronos state for base branch.')",
  "unknownErrorMessage(e, 'Invalid JSON')",
  "unknownErrorMessage(e, 'Failed to read Kronos state.')",
  "unknownErrorMessage(e, 'Invalid dispatch model.')",
  "unknownErrorMessage(e, 'Failed to parse Claude stream event.')",
  "label: 'Failed to parse Claude stream event'",
  "import { isFreshActiveRun } from '../services/runStatus'",
  "import { runProgressSummary } from '../services/runProgress'",
  "import { isAttentionRunStatus, runAttentionDetail } from '../services/runAttention'",
  "function buildProgressHtml(project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun)",
  'const attentionDetail = run && isAttentionRunStatus(run.status) ? runAttentionDetail(run) :',
  'attention-banner',
  '<strong>Needs Attention</strong>',
  "buildProgressHtml(projectName, skill, ticket || '', events, run)",
  'WEBVIEW_ACTION_PANEL_SCRIPT',
  "'refreshPanel'",
  "'archiveFinishedRuns'",
  'pollIntervalMs?: number',
  'extensionUri?: vscode.Uri | undefined',
  'localResourceRoots: [vscode.Uri.joinPath(options.extensionUri,',
  'const pollTimer = setInterval',
  'panel.onDidDispose(() => clearInterval(pollTimer))',
  "import { createWebviewReadyMonitor } from '../services/webviewDiagnostics'",
  "const logReady = createWebviewReadyMonitor(panel, 'Kronos Run Center')",
  'if (logReady(msg)) { return; }',
  "message.command === 'refreshPanel' || message.command === 'archiveFinishedRuns'",
  "runCenterActionButton('refreshPanel', 'Refresh')",
  "runCenterActionButton('archiveFinishedRuns', 'Archive Finished')",
  'webviewActionScriptTag',
  "webviewActionScriptTag(nonce, 'Kronos Run Center', [",
  '{ readyCommand: WEBVIEW_READY_COMMAND, scriptUri }',
  "import { sortedRunCenterRuns } from '../services/runCenterSort'",
  'const sortedRuns = sortedRunCenterRuns(runs)',
  'focusRunId?: string | undefined',
  'focusedRunSort',
  'data-focused-run="true"',
  'sorted by status and time',
  'const canSuspend = supportsProcessTreeSuspend()',
  "const pausable = canSuspend && (status === 'running' || status === 'preflight')",
  "const stoppable = isFreshActiveRun(run) && status !== 'paused'",
  "const paused = canSuspend && status === 'paused'",
  'const canRetry = hasPrompt && !isFreshActiveRun(run)',
  'if (stoppable) {',
  "if (pausable) { buttons.push(runCenterActionButton('pauseRun', 'Pause', runId)); }",
  "if (canRetry) { buttons.push(runCenterActionButton('retryRun', 'Retry', runId)); }",
  'writeSavedSession(session)',
  'export { getAggregateStats, listSavedSessions, listSessionStoreIssues }',
  'const id = safeSessionId',
  'function toValidDate',
  'function progressDateOr',
  'function progressEventTimeLabel',
  'function progressDateTimeLabel',
  'function stringOrDefault',
  'function isRecord(value: unknown): value is Record<string, unknown>',
  'function recordField(record: Record<string, unknown>, key: string): Record<string, unknown>',
  'function arrayField(record: Record<string, unknown>, key: string): unknown[]',
  'function streamString(value: unknown): string',
  'export function parseStreamEvent(event: unknown): ProgressEvent | null',
  'const payload = isRecord(event) ? event : {}',
  "for (const rawBlock of arrayField(message, 'content'))",
  'const sessionStart = progressDateOr(session.startedAt, new Date())',
  'timestamp: progressDateOr(e.timestamp, sessionStart)',
  'const progress = runProgressSummary({ events })',
  'durationSec: progress.elapsedSeconds',
  'Duration: ${progress.elapsedSeconds}s',
  'const statusClass = escapeClass(status)',
  'const started = progressDateTimeLabel(run.startedAt)',
  'const runEvents = Array.isArray(run.events) ? run.events : []',
  'const progress = runProgressSummary(run)',
  '<th>Progress</th>',
  'class="progress-cell"',
  'const promptMeta = isRecord(run.promptMetadata) ? run.promptMetadata : undefined',
  '${escapeClass(readinessStatus)}',
  "stringOrDefault(run.worktreePath || run.cwd, 'unknown workspace')",
  "const id = safeFileStem(`${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`, { fallback: 'run', maxLength: 160 })",
  "safeFileStem(ticket || skill, { fallback: 'worktree', maxLength: 80 })",
]) {
  if (!dispatcher.includes(marker)) {
    fail(`Missing run recovery marker: ${marker}`);
  }
}
if (dispatcher.includes("target.closest('[data-action][data-run-id]')")) {
  fail('Run Center script must allow panel-level actions without a run id.');
}
if (dispatcher.includes('} catch {}')) {
  fail('Dispatcher must not silently swallow run stream failures.');
}
if (extension.includes('description: run.status')) {
  fail('Run quick-pick descriptions must include attention reasons instead of raw status only.');
}

for (const marker of [
  "import { isFreshActiveRun } from './runStatus'",
  'export function sortedRunCenterRuns',
  'export function compareRunCenterRuns',
  'export function runCenterStatusPriority',
  'export function runCenterSortTimestamp',
  'if (status === \'failed\' || status === \'cancelled\') { return 5; }',
  'return 4;',
]) {
  if (!runCenterSort.includes(marker)) {
    fail(`Missing run center sort marker: ${marker}`);
  }
}

for (const marker of [
  'export interface SessionStoreIssue',
  'export function listSessionStoreIssues',
  'export function listSavedSessions',
  'export function writeSavedSession',
  'export interface SavedSessionEvent',
  'export interface AggregateStats',
  'export function normalizeSavedSessionEvents',
  'function normalizeSavedSessionEvent',
  'export function normalizeAggregateSessions',
  'function normalizeAggregateSession',
  'function finiteNumber',
  'function readSavedSessionFileResult',
  'function readAggregateStatsResult',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Unable to parse saved session JSON.')",
  "unknownErrorMessage(e, 'Unable to parse stats.json.')",
  'invalid_session_stats',
  'function listSessionJsonFiles',
  'function compareSessionsNewestFirst',
  'function safeSessionId',
  "safeFileStem(sessionId, { fallback: `session-${Date.now().toString(36)}`, maxLength: 180 })",
]) {
  if (!sessionStore.includes(marker)) {
    fail(`Missing session store marker: ${marker}`);
  }
}
if (dispatcher.includes("const id = `${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`;")) {
  fail('Saved session filenames must be sanitized before writing to disk.');
}
if (dispatcher.includes('const statusClass = escapeHtml(run.status)')) {
  fail('Run Center status classes must use escapeClass, not escapeHtml.');
}
if (dispatcher.includes('new Date(run.startedAt).toLocaleString()')) {
  fail('Run Center timestamps must render through safe date fallback helpers.');
}
if (dispatcher.includes('run.events[run.events.length - 1]')) {
  fail('Run Center must tolerate missing or malformed run.events.');
}
for (const forbidden of [
  'catch (e: any)',
  'e?.message',
  'parseStreamEvent(event: any)',
  'value is Record<string, any>',
  'readiness?: any',
]) {
  if (dispatcher.includes(forbidden)) {
    fail(`Dispatcher must normalize unknown errors instead of using ${forbidden}.`);
  }
}

for (const marker of [
  'export function readRunLogTail',
  'export function buildRunResumePrompt',
  'Resume Kronos run',
  'Recent run log tail',
]) {
  if (!runRecovery.includes(marker)) {
    fail(`Missing run recovery marker: ${marker}`);
  }
}

for (const marker of [
  'export function addTicketEvidenceNote',
  'export function addTicketEvidenceCheck',
  'export function recordTicketEnvironmentResult',
  'export function replaceTicketAcceptanceCriteria',
  'export function updateTicketAcceptanceCriteria',
  'export function linkMergeRequestToTicket',
  'export function previewLinkMergeRequestToTicket',
  'export function updateTicketMergeRequestStatus',
  'update-ticket-mr-status',
  'function mergeRequestStatus',
  'function validMergeRequestState',
  'const closedNow',
  "ticket.next_action = 'blocked'",
  'human review is needed',
  'reviewReady',
  'decideEvidenceHandoff',
  'allowReviewHandoffWithWarnings',
  'add-evidence-check',
  'record-environment-result',
  'setAcceptanceCriteriaChecked',
  'function mutateState',
  "writeJsonFileAtomic(STATE_FILE, state, action)",
  'validateStateFileShape(state)',
]) {
  if (!ticketMutations.includes(marker)) {
    fail(`Missing ticket mutation marker: ${marker}`);
  }
}

for (const marker of [
  'export function addTicketToQueue',
  'export function selectNextQueueItem',
  'export function addPlanToQueue',
  'export function recordPlanQueueDecision',
  'export function reorderQueueItem',
  'export function removeTicketFromQueue',
  'export function linkTicketToProject',
  'export function unlinkTicketFromProject',
  'writeJsonFileAtomic(QUEUE_FILE',
  'writeJsonFileAtomic(STATE_FILE',
  'queue-add-plan',
  'queue-pin-plan',
  'queue-plan-snoozed',
  'queue-plan-rejected',
  'queue-reorder',
  'queue-add-ticket',
  'ticket-link-project',
  'function normalizeQueueItem(item: unknown): QueueItem',
  'function queueRecord(value: unknown): Record<string, unknown>',
  'function queueString(value: unknown): string',
  'function queueNullableString(value: unknown): string | null',
  'function queueStringArray(value: unknown): string[]',
]) {
  if (!queueMutations.includes(marker)) {
    fail(`Missing queue mutation marker: ${marker}`);
  }
}
if (queueMutations.includes('function normalizeQueueItem(item: any): QueueItem')) {
  fail('Queue mutation normalization must accept unknown raw queue items.');
}

for (const marker of [
  'export function setProjectConfigValue',
  'export function setProjectIntegrationConfig',
  'export function writeProjectSetupConfig',
  'export function removeProject',
  'export function setScanDirs',
  'writeJsonFileAtomic(STATE_FILE',
  'project-setup-config',
  'project-integration-config-update',
  'validateStateFileShape(state)',
  'project-config-update',
  'project-remove',
  'settings-scan-dirs',
  'upsertDiscoveredProject',
]) {
  if (!projectMutations.includes(marker)) {
    fail(`Missing project mutation marker: ${marker}`);
  }
}

for (const marker of [
  'export async function probeProviderReachability',
  'ProviderReachabilityTarget',
  'Unsupported URL scheme',
  'No base URL configured for this enabled provider',
  'safeUrlLabel',
  "'User-Agent': 'kronos-doctor'",
]) {
  if (!providerReachability.includes(marker)) {
    fail(`Missing provider reachability marker: ${marker}`);
  }
}

for (const marker of [
  'export function runKronosStateScript',
  'export function runGitlabJson',
  'export function runPipelineJson',
  'export function requiredScripts',
  'function pythonCandidateAvailable(candidate: string): boolean',
  'Invalid JSON from',
  'Kronos integration script unavailable:',
]) {
  if (!scriptClient.includes(marker)) {
    fail(`Missing script client marker: ${marker}`);
  }
}
if (scriptClient.includes('} catch {}')) {
  fail('Script client must not silently swallow Python discovery failures.');
}

for (const marker of [
  "import { isActionCode, isActionProofSensitive } from './actionCatalog'",
  'return isActionCode(action)',
  'return isActionProofSensitive(action)',
  'export function isCodeAction',
  'export function isProofSensitiveAction',
  'export function isReviewReadyAction',
  'export function isHandoffAction',
]) {
  if (!actionSemantics.includes(marker)) {
    fail(`Missing action semantics marker: ${marker}`);
  }
}

for (const marker of [
  'export const TICKET_ACTIONS',
  'export const QUEUE_ACTIONS',
  'export function actionDisplayLabel',
  'export function actionSkill',
  'export function actionEstimateMinutes',
  'export function actionPlanningScore',
  'export function isActionCode',
  'export function isActionProofSensitive',
  'export function ticketActionIconSpec',
  'export function queueActionIconSpec',
  "fix_build: {",
  "skill: 'deploy-monitor'",
  "planningScore: 95",
  "queueIcon: { id: 'refresh' }",
]) {
  if (!actionCatalog.includes(marker)) {
    fail(`Missing action catalog marker: ${marker}`);
  }
}

for (const [name, source, marker] of [
  ['src/extension.ts', extension, 'const CODE_COLLISION_ACTIONS'],
  ['src/extension.ts', extension, "['implement', 'in_progress', 'fix_build'].includes"],
  ['src/extension.ts', extension, 'function isProofSensitiveAction'],
  ['src/services/collisionDetector.ts', collisionDetector, "const CODE_ACTIONS = new Set(['implement'"],
  ['src/services/nextActionContext.ts', nextActionContext, "const CODE_ACTIONS = new Set(['implement'"],
  ['src/services/nextActionContext.ts', nextActionContext, 'const PROOF_SENSITIVE_ACTIONS = new Set'],
  ['src/services/evidenceGate.ts', evidenceGate, 'const REVIEW_READY_ACTIONS'],
  ['src/services/humanReviewInbox.ts', humanReviewInbox, 'const REVIEW_READY_ACTIONS'],
  ['src/services/postRunReadiness.ts', postRunReadiness, 'const HANDOFF_ACTIONS'],
  ['src/services/queuePlanner.ts', queuePlanner, 'const overnightActions'],
  ['src/services/queuePlanner.ts', queuePlanner, 'function scoreAction'],
  ['src/services/queuePlanner.ts', queuePlanner, "case 'fix_build': return 95"],
  ['src/services/queuePlanner.ts', queuePlanner, "case 'refresh':"],
  ['src/services/ticketMutations.ts', ticketMutations, "['await_review', 'verify', 'deploy_monitor', 'done'].includes"],
  ['src/services/agentQualityScore.ts', agentQualityScore, "['await_review', 'verify', 'deploy_monitor', 'done'].includes"],
]) {
  if (source.includes(marker)) {
    fail(`${name} must use actionSemantics instead of local action set marker: ${marker}`);
  }
}

for (const marker of [
  'export type TicketWithOpenMergeRequest',
  'export interface ReviewBranchTicket',
  'export function isOpenReviewTicket',
  "ticket.next_action === 'await_review' && ticket.mr?.state === 'opened'",
  'export function openReviewTicketEntries',
  'export function reviewBranchTickets',
]) {
  if (!reviewWork.includes(marker)) {
    fail(`Missing review work marker: ${marker}`);
  }
}

for (const [name, source, marker] of [
  ['src/extension.ts', extension, 'function isOpenReviewMergeRequestEntry'],
  ['src/views/ReviewTreeProvider.ts', reviewTreeProvider, 'function isReviewTicket'],
  ['src/services/agingAnalyzer.ts', agingAnalyzer, "ticket.next_action === 'await_review' && ticket.mr?.state === 'opened'"],
]) {
  if (source.includes(marker)) {
    fail(`${name} must use reviewWork instead of local open-review marker: ${marker}`);
  }
}

for (const marker of [
  'export function runStateScript',
  'export function refreshKronosState',
  'function discoverProjects(',
  'export function discoverProjectsJson',
  'export function normalizeDiscoveredProjects',
  'function normalizeDiscoveredProject',
  "normalizeDiscoveredProjects(data['candidates'])",
  'export function registerProject',
  'export function addAdhocTask',
  'export function completeAdhocTask',
  'function readMorningBrief(',
  'export function readMorningBriefJson',
  'function arrayOrEmpty',
  'function finiteNumberOrZero',
  'function stringOrNull',
  "completed: arrayOrEmpty(parsed['completed'])",
  "ready_to_go: arrayOrEmpty(parsed['ready_to_go'])",
  'function parseStateScriptJson',
  'kronos_state.py --discover',
  'kronos_state.py --morning-brief',
  'runKronosStateScript',
]) {
  if (!stateScriptAdapter.includes(marker)) {
    fail(`Missing state script adapter marker: ${marker}`);
  }
}
for (const marker of [
  'export function discoverProjects(',
  'export function readMorningBrief(',
]) {
  if (stateScriptAdapter.includes(marker)) {
    fail(`State script adapter raw string helper should remain private: ${marker}`);
  }
}

for (const marker of [
  'export function buildNextActionContext',
  'export function buildNextActionStartDecision',
  'export function skillForAction',
  "import { actionSkill } from './actionCatalog'",
  "import { isCodeAction, isProofSensitiveAction } from './actionSemantics'",
  'return actionSkill(action)',
  'commandLabel',
  'risks',
  'preflight',
  'blockers',
  'Cannot start',
  'Claude auth preflight must pass before dispatch.',
  'Collision detector checks active runs',
  "import { evidenceRecordCount } from './evidenceData'",
  'evidenceRecordCount(ticket)',
]) {
  if (!nextActionContext.includes(marker)) {
    fail(`Missing next action context marker: ${marker}`);
  }
}

for (const marker of [
  'export function originProjectPath',
  'export function firstRemoteBranchMatching',
  'export function currentGitRef',
  'export function currentGitCommit',
  'export function prepareManagedWorktree',
  'export function inspectTrackedWorktree',
  'export function removeWorktreeSafely',
  'export function createWorkspaceDiffArtifact',
  'const scpLike = remoteRaw.match',
  'new URL(remoteRaw)',
  'function stripGitRemotePath',
  "safeFileStem(String(run.id || 'run'), { fallback: 'run' })",
  "runner(['status', '--short']",
  "runner(['status', '--porcelain']",
  'function blockingWorktreeStatus',
  'function isIgnorableWorktreeStatusLine',
  'function removeIgnorableWorktreeArtifacts',
  "path.join(worktreePath, '.claude')",
  'fs.rmSync(dotClaudePath, { recursive: true, force: true })',
  "statusPath === '.claude' || statusPath === '.claude/' || statusPath.startsWith('.claude/')",
  'pullWarning?: string',
  "pullWarning = unknownErrorMessage(e, 'Could not fast-forward managed worktree after creation.')",
  "runner(['worktree', 'add'",
  "runner(['worktree', 'remove'",
  "runner(['diff', '--cached', '--']",
]) {
  if (!gitWorkspace.includes(marker)) {
    fail(`Missing git workspace marker: ${marker}`);
  }
}
if (gitWorkspace.includes('} catch {}')) {
  fail('Git workspace must not silently swallow managed worktree failures.');
}

for (const marker of [
  'export function stopProcessTree',
  'export function signalProcessTree',
  'export function supportsProcessTreeSuspend',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  'catch (fallbackError: unknown)',
  "console.warn(unknownErrorMessage(e, 'Delayed process-group SIGKILL failed.'))",
  "unknownErrorMessage(fallbackError, unknownErrorMessage(e, 'process signal failed'))",
  "unknownErrorMessage(fallbackError, unknownErrorMessage(cause, 'process stop failed'))",
  "'taskkill'",
  "'SIGTERM'",
  "'SIGKILL'",
  "'SIGSTOP'",
  "'SIGCONT'",
  'fallbackKill',
]) {
  if (!processTree.includes(marker)) {
    fail(`Missing process tree marker: ${marker}`);
  }
}
if (processTree.includes('} catch {}')) {
  fail('Process tree must not silently swallow delayed kill failures.');
}

for (const marker of [
  "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
  "import { isFreshActiveRun } from '../services/runStatus'",
  "import { formatRunProgress } from '../services/runProgress'",
  "import { isAttentionRunStatus, runAttentionLine } from '../services/runAttention'",
  "import { unknownErrorMessage } from '../services/errorUtils'",
  'private _refreshing = false',
  'const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000',
  'void this.refreshSessionsSafely()',
  'private async refreshSessionsSafely(): Promise<void>',
  "unknownErrorMessage(e, 'Kronos session refresh failed.')",
  'const runs = listRuns()',
  'const activeRuns = runs.filter(run => isFreshActiveRun(run))',
  'const attentionRuns = runs.filter(run => isAttentionRunStatus(run.status)).slice(0, 5)',
  'const attention = isAttentionRunStatus(run.status) ? runAttentionLine(run, 90) :',
  'Reason: ${attention}',
  "new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'))",
  'const progress = formatRunProgress(run)',
  'Progress: ${progress}',
  "new vscode.ThemeIcon('sync~spin'",
  "this.command = { command: 'kronos.runCenter'",
]) {
  if (!sessionTreeProvider.includes(marker)) {
    fail(`Missing session tree active-run marker: ${marker}`);
  }
}
if (sessionTreeProvider.includes('setInterval(async () =>')) {
  fail('Session tree polling must not leave rejected async intervals unhandled.');
}

for (const marker of [
  "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
  "import { isFreshActiveRun } from '../services/runStatus'",
  "import { formatRunProgress } from '../services/runProgress'",
  "import { activeRunForQueueItem } from '../services/queueActiveRun'",
  'const activeRuns = listRuns().filter(run => isFreshActiveRun(run))',
  'new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns))',
  'startPolling(intervalMs: number): void',
  'queueTree.startPolling(sessionPollMs)',
  'queueTree.dispose()',
  'const progress = activeRun ? formatRunProgress(activeRun) :',
  'Active run: ${activeRun.id}',
  "new vscode.ThemeIcon('sync~spin'",
]) {
  if (!queueTreeProvider.includes(marker) && !extension.includes(marker)) {
    fail(`Missing queue tree active-run marker: ${marker}`);
  }
}
for (const marker of [
  "import { skillForAction } from './nextActionContext'",
  "import { isFreshActiveRun } from './runStatus'",
  'export interface QueueActiveRunLike',
  'export function activeRunForQueueItem<T extends QueueActiveRunLike>',
  'return runs.find(run => isFreshActiveRun(run, now) && runMatchesQueueItem(run, item));',
  'export function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean',
  'runString(run.skill) === skillForAction(item.action)',
]) {
  if (!queueActiveRun.includes(marker)) {
    fail(`Missing queue active-run service marker: ${marker}`);
  }
}
if (`${queueTreeProvider}\n${queueActiveRun}`.includes('activeRuns.find(run => runMatchesQueueTicket(run, item))\n    || activeRuns.find')) {
  fail('Queue active-run matching must not use broad ticket-only or project-only fallbacks.');
}
if (queueTreeProvider.includes('export class QueueTreeItem')) {
  fail('QueueTreeItem should stay internal to QueueTreeProvider.');
}

for (const marker of [
  "import { evidenceRecordCount } from '../services/evidenceData'",
  'evidenceRecordCount(t)',
]) {
  if (!ticketTreeProvider.includes(marker)) {
    fail(`Missing ticket tree evidence-count marker: ${marker}`);
  }
}
if (ticketTreeProvider.includes('function evidenceItemCount')) {
  fail('Ticket tree must not duplicate evidence counting.');
}
if (extension.includes('function evidenceCountForTicket')) {
  fail('Extension must call shared evidenceRecordCount directly instead of wrapping it locally.');
}
if (extension.includes('function isAttentionRunStatus')) {
  fail('Extension must use the shared run attention status helper.');
}
if (extension.includes('function singleLineRunSummary')) {
  fail('Extension must use the shared run attention line formatter.');
}

for (const marker of [
  'readonly onDidChangeNewReviewCount',
  'const NEW_REVIEW_SPIN_MS = 6000',
  'export interface ReviewSeenKeysStore',
  'private currentReviewKeys = new Set<string>()',
  'private seenReviewKeys = new Set<string>()',
  'private newReviewKeys = new Set<string>()',
  'private spinningReviewKeys = new Map<string, number>()',
  'this.seedInitialReviewKeys()',
  'getNewReviewCount(): number',
  'export interface NewReviewItemSummary',
  'getNewReviewItems(): NewReviewItemSummary[]',
  'activityKey: string',
  'activityKey,',
  'if (ticket.mr?.iid !== undefined) { summary.mrIid = ticket.mr.iid; }',
  'if (activity) { summary.activity = activity; }',
  'markVisibleReviewItemsSeen(): void',
  'const visibleKeys = this.visibleReviewKeys()',
  'this.newReviewKeys.delete(key)',
  'this._onDidChangeNewReviewCount.fire(this.getNewReviewCount())',
  'this.spinningReviewKeys.set(snapshot.activityKey, Date.now() + NEW_REVIEW_SPIN_MS)',
  'new ReviewItem(',
  'reviewActivityKey(ticketKey, ticket)',
  'private visibleReviewKeys(): Set<string>',
  'private scheduleSpinRefresh(): void',
  'private clearSpinTimer(): void',
  'dispose(): void',
  'private seedInitialReviewKeys(): void',
  'const storedSeenKeys = this.seenKeysStore?.get()',
  'this.seenReviewKeys = new Set(initialKeys)',
  'private persistSeenReviewKeys(): void',
  'this.persistSeenReviewKeys()',
  'Kronos review seen-key persistence failed.',
  'function reviewActivityKey(ticketKey: string, ticket: TicketWithOpenMergeRequest): string',
  'function reviewActivitySummary(ticket: TicketWithOpenMergeRequest): string',
  "this.description = `${isNew ? 'NEW · ' : ''}",
  "new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'))",
  "new vscode.ThemeIcon('circle-filled'",
  "new vscode.ThemeIcon('git-pull-request', color)",
  "import { TicketWithOpenMergeRequest, openReviewTicketEntries } from '../services/reviewWork'",
  'return openReviewTicketEntries(state.tickets)',
]) {
  if (!reviewTreeProvider.includes(marker)) {
    fail(`Missing review tree new-item marker: ${marker}`);
  }
}
if (!extension.includes('reviewTree.dispose()')) {
  fail('Review tree timed spin timer must be disposed with the extension');
}
if (reviewTreeProvider.includes("ticket.mr.state === 'merged'")) {
  fail('Review tree should not keep merged MRs in the active review inbox');
}

for (const marker of [
  'export interface WebviewDisposeTarget',
  'export function createWebviewReadyMonitor',
  'export function logWebviewReadyMessage',
  "message.command !== WEBVIEW_READY_COMMAND",
  'fallbackWebviewName',
  'Kronos webview script did not report ready:',
  'Check VS Code Webview Developer Tools and the Extension Host DevTools console for CSP or sandbox errors.',
  "console.info(`Kronos webview script ready:",
]) {
  if (!webviewDiagnostics.includes(marker)) {
    fail(`Missing webview diagnostics marker: ${marker}`);
  }
}
for (const staleMarker of [
  'function logRunCenterWebviewReadyMessage',
  'function createRunCenterReadyMonitor',
]) {
  if (dispatcher.includes(staleMarker)) {
    fail(`Dispatcher should use shared webview diagnostics instead of ${staleMarker}.`);
  }
}
if (extension.includes('function logWebviewReadyMessage') || extension.includes('function createWebviewReadyMonitor')) {
  fail('Extension should use shared webview diagnostics instead of local ready monitor helpers.');
}

for (const marker of [
  'export function createWebviewNonce',
  "toString('hex')",
  'export function webviewScriptCspOptions',
  'return { allowScripts: true, nonce, cspSource }',
  'export const WEBVIEW_ACTION_PANEL_SCRIPT',
  "'kronos-action-panel.js'",
  'export const WEBVIEW_JIRA_BOARD_SCRIPT',
  "'kronos-jira-board.js'",
  'export function webviewVsCodeApiScript',
  'function kronosVsCodeApi() {',
  "Symbol.for('kronos.vscodeApi')",
  "typeof acquireVsCodeApi !== 'function'",
  "console.error('Failed to acquire VS Code API for Kronos webview action', error)",
  "document.documentElement.setAttribute('data-kronos-script-ready', 'true')",
  "console.info('Kronos webview script ready', webviewName, navigator.userAgent)",
  "console.error('Kronos webview script error', webviewName",
  "console.error('Kronos webview unhandled rejection', webviewName",
  'export const WEBVIEW_READY_COMMAND',
  'export function webviewReadyPostScript',
  "kronosVsCodeApi().postMessage({ command: readyCommand",
  "console.warn('Kronos webview could not post script readiness', error)",
  'export function webviewScriptDiagnosticBanner',
  'data-kronos-script-required',
  'Webview Developer Tools',
  'Extension Host DevTools',
  'function injectWebviewScriptDiagnostic(html: string): string',
  'injectWebviewScriptDiagnostic(value)',
  'export function webviewActionPostScript',
  'function closestKronosActionTarget(target)',
  'target.parentElement',
  'function postKronosAction(event)',
  "document.addEventListener('click', postKronosAction, true)",
  "document.addEventListener('DOMContentLoaded', attachKronosActionHandler, { once: true })",
  "document.documentElement.setAttribute('data-kronos-actions-ready', 'true')",
  '__kronosActionHandlerAttached',
  'data-kronos-action-handler-attached',
  'message[field.messageKey]',
  'options.readyCommand ? webviewReadyPostScript(webviewName, options.readyCommand) :',
  'export function webviewActionScriptTag',
  'data-kronos-webview-name',
  'data-kronos-action-fields',
  'data-kronos-ready-command',
  'options.scriptUri',
  '!options.scriptUri',
  'cspSource?: string',
  'options.cspSource?.trim()',
  'scriptSources.join',
  'export function webviewCspMeta',
  'export function withWebviewCsp',
  'function wrapWebviewHtmlWithCsp(html: string, meta: string): string',
  "html.replace(/^\\s*<!doctype[^>]*>\\s*/i, '')",
  'return `<!DOCTYPE html><html><head>\\n${meta}\\n</head>${body}</html>`',
  'return `<!DOCTYPE html><html><head>\\n${meta}\\n</head><body>${body}</body></html>`',
  "default-src 'none'",
  'style-src ${styleSrc}',
  'style-src-elem ${styleSrc}',
  "style-src-attr 'unsafe-inline'",
  "script-src ${scriptSrc}",
  'script-src-elem ${scriptSrc}',
  "script-src-attr 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'Content-Security-Policy',
]) {
  if (!webviewSecurity.includes(marker)) {
    fail(`Missing webview security marker: ${marker}`);
  }
}

for (const marker of [
  'document.currentScript',
  'data-kronos-webview-name',
  'data-kronos-ready-command',
  'data-kronos-action-fields',
  'function kronosVsCodeApi()',
  "Symbol.for('kronos.vscodeApi')",
  "typeof acquireVsCodeApi !== 'function'",
  "document.documentElement.setAttribute('data-kronos-script-ready', 'true')",
  "document.documentElement.setAttribute('data-kronos-actions-ready', 'true')",
  '__kronosActionHandlerAttached',
  'data-kronos-action-handler-attached',
  "console.info('Kronos webview script ready', webviewName, navigator.userAgent)",
  "console.error('Kronos webview script error', webviewName",
  "console.error('Kronos webview unhandled rejection', webviewName",
  'function postReady()',
  'function closestKronosActionTarget(target)',
  'target.parentElement',
  'function postKronosAction(event)',
  "document.addEventListener('click', postKronosAction, true)",
]) {
  if (!webviewActionPanelScript.includes(marker)) {
    fail(`Missing packaged webview action script marker: ${marker}`);
  }
}

for (const marker of [
  'function claimKronosJiraBoard()',
  '__kronosJiraBoardAttached',
  'data-kronos-jira-board-attached',
]) {
  if (!jiraBoardScript.includes(marker)) {
    fail(`Missing packaged Jira board script guard marker: ${marker}`);
  }
}
for (const [label, source, marker] of [
  ['inline action script', webviewSecurity, "Symbol.for('kronos.actionHandlerAttached')"],
  ['packaged action script', webviewActionPanelScript, "Symbol.for('kronos.actionHandlerAttached')"],
  ['packaged Jira board script', jiraBoardScript, "Symbol.for('kronos.jiraBoardAttached')"],
]) {
  if (source.includes(marker)) {
    fail(`${label} should use document-scoped handler guards, not ${marker}`);
  }
}
for (const marker of [
  'const vscode =',
  'var vscode =',
  'window.__kronosVscodeApi',
]) {
  if (webviewActionPanelScript.includes(marker)) {
    fail(`Packaged webview action script must not use stale VS Code API cache marker: ${marker}`);
  }
}

for (const marker of [
  "import { formatRelativeTime } from '../services/relativeTime'",
  'formatRelativeTime(proj.last_polled)',
]) {
  if (!projectTreeProvider.includes(marker)) {
    fail(`Missing project tree date marker: ${marker}`);
  }
}

for (const marker of [
  'export function formatRelativeTime',
  'const absMins = Math.floor(Math.abs(diffMs) / 60000)',
  "return past ? `${value}${unit} ago` : `in ${value}${unit}`",
]) {
  if (!relativeTime.includes(marker)) {
    fail(`Missing relative time marker: ${marker}`);
  }
}

for (const marker of [
  'export function defaultCliProbeCommandRunner',
  'export function runCliProbe',
  'export function readClaudeAgents',
  'export function resolveGcloudCommandStatus',
  'export function checkGcloudApplicationDefaultAuth',
  'export function checkClaudeModelAccess',
  'export function commandNeedsCmdWrapper',
  'export function windowsCmdFileInvocation',
  'export function readableGoogleApplicationCredentials',
  'function resolveCommandOnPath(command: string',
  'if (!resolution.available)',
  'install Google Cloud SDK or set GOOGLE_APPLICATION_CREDENTIALS',
  "const shellLine = ['call', quoteWindowsCmdToken(command), ...args.map(quoteWindowsCmdToken)].join(' ')",
  "args: ['/d', '/c', shellLine]",
  "execFileSync(command, args",
  "execFileSync(invocation.command, invocation.args",
  "GOOGLE_APPLICATION_CREDENTIALS file is readable",
  "['agents', '--json']",
  "['auth', 'application-default', 'print-access-token']",
  "['-p', 'ok', '--model', model, '--permission-mode', 'auto']",
]) {
  if (!cliProbes.includes(marker)) {
    fail(`Missing CLI probes marker: ${marker}`);
  }
}
if (cliProbes.includes("args: ['/d', '/s', '/c', shellLine]")) {
  fail('Windows .cmd probes must not use cmd.exe /s because it can preserve quotes around bare commands like gcloud.cmd.');
}

for (const marker of [
  'export function sanitizeGitBranchRef',
  'export function resolveReviewBranch',
  'export function mergeRefsForBranch',
  'export function buildCombinedVerificationPlan',
  'export function buildCombinedVerificationPromptVars',
  'mr.source_branch',
  'mr.sourceBranch',
  'mr.head_branch',
  'git merge ${ref} --no-edit',
]) {
  if (!combinedVerification.includes(marker)) {
    fail(`Missing combined verification marker: ${marker}`);
  }
}

for (const marker of [
  'function normalizeChangedFilePath',
  'export function changedFilePaths',
  'export function primaryChangedFilePath',
  'function normalizeChangedFile',
  'export function normalizeChangedFiles',
  'file.new_path',
  'file.old_path',
  'file.newPath',
  'file.oldPath',
  'file.filename',
  "typeof file['diff'] === 'string'",
]) {
  if (!changedFiles.includes(marker)) {
    fail(`Missing changed files marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildSonarDashboardUrl',
  'const base = new URL(host)',
  "base.protocol !== 'http:' && base.protocol !== 'https:'",
  'export function formatSonarMetricName',
  'export function sonarGateStatus',
  'export function sonarConditionList',
  'export function sonarMeasureList',
  'export function sonarIssueList',
  'export function buildSonarReport',
  'SonarReportRenderInput',
  'gate: unknown',
  'measures: unknown',
  'issues: unknown',
  'kronosWebviewBaseCss',
  'class="kronos-shell sonar-shell"',
  'class="kronos-button primary"',
  'script nonce="${input.nonce}"',
  "kronosVsCodeApi().postMessage({ command: 'fixSonar' })",
  "kronosVsCodeApi().postMessage({ command: 'openSonar' })",
  'issueList.slice(0, 50)',
]) {
  if (!sonarReportView.includes(marker)) {
    fail(`Missing Sonar report view marker: ${marker}`);
  }
}

for (const [file, source, marker] of [
  ['src/state/KronosState.ts', sources['src/state/KronosState.ts'], "from '../services/cliProbes'"],
  ['src/runners/sessionDispatcher.ts', dispatcher, "from '../services/cliProbes'"],
  ['src/extension.ts', extension, "from './services/cliProbes'"],
]) {
  if (!source.includes(marker)) {
    fail(`${file} must route CLI readiness checks through cliProbes.`);
  }
}

for (const marker of [
  'export function runDoctorChecks',
  'export function buildDoctorReachabilityTargets',
  'export async function runDoctorReachabilityChecks',
  'export function projectConfigGaps',
  'credentialCheck',
  'Claude CLI compatible version',
  'Project config completeness',
  'Manifest artifact hashes',
  'Provider network reachability',
  'GitHub Actions credentials',
  'GitHub API network reachability',
  'github_repository',
  'readableGoogleApplicationCredentials',
  'Skipped because GOOGLE_APPLICATION_CREDENTIALS',
  'probeProviderReachability',
  "import { unknownErrorMessage } from './errorUtils'",
  "unknownErrorMessage(e, 'Could not read prompt directory')",
  "unknownErrorMessage(e, 'Auth check failed')",
  "unknownErrorMessage(e, 'Provider reachability checks failed.')",
  "unknownErrorMessage(e, `${command} unavailable`)",
  "unknownErrorMessage(e, 'claude unavailable')",
  'Values are not displayed',
  'DoctorCommandRunner',
]) {
  if (!doctorChecks.includes(marker)) {
    fail(`Missing doctor checks marker: ${marker}`);
  }
}

for (const marker of [
  "if (options.remove) {\n        untrackWorktree(entry.worktreePath);",
  "r.status === 'removable' || r.status === 'missing'",
  "from '../services/worktreeRegistry'",
  'trackActiveWorktree(projectPath, worktreePath, ticket)',
  'untrackActiveWorktree(worktreePath)',
  'Active worktree registry needs manual review before creating a worktree',
  'if (registry.issue) { report.registryIssue = registry.issue; }',
]) {
  if (!dispatcher.includes(marker)) {
    fail(`Missing worktree cleanup safety marker: ${marker}`);
  }
}

for (const marker of [
  'export const ACTIVE_WORKTREES_FILE',
  'export interface ActiveWorktreeRegistry',
  'export function loadActiveWorktreeRegistry',
  'export function trackActiveWorktree',
  'export function untrackActiveWorktree',
  'active-worktrees.json must be an array',
  'assertMutableRegistry',
  'needs manual review before it can be changed',
]) {
  if (!worktreeRegistry.includes(marker)) {
    fail(`Missing worktree registry marker: ${marker}`);
  }
}

for (const marker of [
  'export function writeJsonFileAtomic',
  'export function validateQueueState',
  'export function validateStateFileShape',
  'export function listBackups',
  'export function restoreBackup',
  'export function listStateAuditEvents',
  'STATE_AUDIT_FILE',
  'VALID_TICKET_ACTIONS',
  'VALID_QUEUE_ACTIONS',
  "import { QUEUE_ACTIONS, TICKET_ACTIONS } from './actionCatalog'",
  'function validateProjectRecord',
  'function validateProjectConfig',
  'function validateMergeRequest',
  'function validateBuildStatus',
  'function validateEvidenceNote',
  'function isPlainObject',
  'function requireFiniteNumber',
  "validateActionValue(t['next_action']",
  'validateActionValue(item.action',
  'type MutableStateRecord = Record<string, unknown>',
  'interface StateWriteLock',
  'function requirePlainRecord(value: unknown, message: string): MutableStateRecord',
  'function repairProjectRecord(name: string, project: unknown, issues: StateFileLoadIssue[]): void',
  'function repairProjectConfig(config: unknown, label: string, issues: StateFileLoadIssue[]): void',
  'function repairTicketRecord(key: string, ticket: unknown, issues: StateFileLoadIssue[]): void',
  'function repairMergeRequest(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
  'function repairBuildStatus(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
  'function repairTicketEvidence(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
  'export function migrateStateFileShape',
  'export function migrateStateFileShape(raw: unknown): KronosState',
  'export function readStateFileWithIssues',
  'export function migrateQueueFileShape',
  'export function migrateQueueFileShape(raw: unknown): QueueState',
  'function migrateQueueItemShape',
  'function migrateQueueItemShape(item: unknown, idx: number): QueueItem',
  'function migrateTicketEvidence(evidence: unknown): TicketEvidence | undefined',
  'export function validateStateFileShape(raw: unknown): void',
  'function validateProjectConfig(config: unknown, label: string): void',
  'function readCurrentWriteLock(): StateWriteLock | null',
  'export function readStateFile',
  'export function readQueueFile',
  'STATE_WRITE_LOCK_FILE',
  'acquireStateWriteLock',
  'clearStaleWriteLock',
  'DEFAULT_OVERNIGHT',
  "import { unknownErrorCode, unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'unknown validation error')",
  "unknownErrorMessage(e, 'Failed to load state.json')",
  "unknownErrorMessage(e, 'invalid project record')",
  "unknownErrorMessage(e, 'invalid ticket record')",
  "unknownErrorMessage(e, 'Invalid audit JSONL entry')",
  "unknownErrorMessage(closeError, 'Could not close failed Kronos state write lock descriptor.')",
  "unknownErrorMessage(e, 'state lock unavailable')",
  "unknownErrorCode(e) !== 'ENOENT'",
  "unknownErrorMessage(e, 'Could not release Kronos state write lock.')",
  "unknownErrorMessage(e, 'Could not clear stale Kronos state write lock.')",
]) {
  if (!stateStore.includes(marker)) {
    fail(`Missing state store marker: ${marker}`);
  }
}

for (const forbidden of [
  'catch (e: any)',
  'e?.message',
  'export function migrateStateFileShape(raw: any)',
  'function migrateTicketEvidence(evidence: any): any',
  'export function migrateQueueFileShape(raw: any)',
  'function migrateQueueItemShape(item: any',
  'const d = decision as any',
  'export function validateStateFileShape(raw: any)',
  'const t = ticket as any',
  'const evidence = t.evidence as any',
  'const r = result as any',
  'const p = project as any',
  'function validateProjectConfig(config: any',
  'const value = mr as any',
  'const value = build as any',
  'const value = note as any',
  'function readCurrentWriteLock(): any',
  'function repairProjectRecord(name: string, project: any',
  'function repairProjectConfig(config: any',
  'filter((approver: any',
  'function repairTicketRecord(key: string, ticket: any',
  'function repairMergeRequest(ticket: any',
  'const mr = ticket.mr as any',
  'function repairBuildStatus(ticket: any',
  'const build = ticket.build as any',
  'function repairTicketEvidence(ticket: any',
]) {
  if (stateStore.includes(forbidden)) {
    fail(`State store must normalize unknown errors instead of using ${forbidden}.`);
  }
}
if (/\bany\b/.test(stateStore)) {
  fail('State store must keep untrusted JSON typed as unknown, not any.');
}
if (stateStore.includes('} catch {}')) {
  fail('State store must not silently swallow lock cleanup failures.');
}

if (!sources['src/state/KronosState.ts'].includes('const result = readStateFileWithIssues()')) {
  fail('KronosState must load UI state through readStateFileWithIssues.');
}
for (const marker of [
  'export interface KronosStateLoadIssue',
  'private _loadIssues',
  'get loadIssues()',
  "import { unknownErrorMessage } from '../services/errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Failed to load state.json')",
  "unknownErrorMessage(e, 'Failed to load queue.json')",
  'console.warn(unknownErrorMessage(e, `Kronos file watcher failed for ${filepath}.`))',
  'private _suppressWatchTimer: NodeJS.Timeout | undefined',
  'clearTimeout(this._suppressWatchTimer)',
  'this._suppressWatchTimer = setTimeout(() =>',
  'this._suppressWatchTimer = undefined',
  'console.warn(unknownErrorMessage(e, `Failed to render Kronos prompt ${name}.`))',
  "target: 'state.json'",
  "target: 'queue.json'",
]) {
  if (!sources['src/state/KronosState.ts'].includes(marker)) {
    fail(`Missing KronosState load issue marker: ${marker}`);
  }
}
if (sources['src/state/KronosState.ts'].includes('} catch {}')) {
  fail('KronosState must not silently swallow state watcher failures.');
}
for (const marker of [
  'stateLoadErrors?:',
  'sessionStoreIssues?:',
  "add('state.json parse', 'fail'",
  "add('queue.json parse', 'fail'",
  "add('Session store integrity', 'warn'",
  "add('Session store integrity', 'pass'",
  'state.json could not be parsed or validated',
]) {
  if (!doctorChecks.includes(marker)) {
    fail(`Missing doctor load issue marker: ${marker}`);
  }
}
for (const marker of [
  'stateLoadErrors: state.loadIssues',
  'sessionStoreIssues: listSessionStoreIssues()',
  'No readable saved sessions',
  'No readable session stats',
  "state.state ? '$(warning) Kronos: state warnings' : '$(error) Kronos: state error'",
  'Run Doctor for details.',
]) {
  if (!extension.includes(marker)) {
    fail(`Missing extension load issue marker: ${marker}`);
  }
}

for (const marker of [
  'export function extractAcceptanceCriteria',
  'export function extractCriterionTexts',
  'Given|When|Then|And|But',
  'criterionId',
  'setAcceptanceCriteriaChecked',
]) {
  if (!acceptanceCriteria.includes(marker)) {
    fail(`Missing acceptance criteria marker: ${marker}`);
  }
}

for (const marker of [
  'export function evidenceNotes',
  'export function evidenceChecks',
  'export function evidenceRiskNotes',
  'export function evidenceEnvironmentResults',
  'export function evidenceString',
  'function arrayRecords',
]) {
  if (!evidenceData.includes(marker)) {
    fail(`Missing evidence data marker: ${marker}`);
  }
}

for (const marker of [
  '## Evidence Checks',
  '## Environment Results',
  'evidenceRiskNotes(ticket)',
  'evidenceNotes(ticket)',
  'evidenceChecks(ticket)',
  'evidenceEnvironmentResults(ticket)',
  'evidenceString',
]) {
  if (!evidenceStore.includes(marker)) {
    fail(`Missing evidence store marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildEvidenceHandoffPlan',
  'Jira ticket comment',
  'Merge request comment',
  'manualSteps',
  'Paste the comment',
]) {
  if (!evidenceHandoff.includes(marker)) {
    fail(`Missing evidence handoff marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildHumanReviewInbox',
  'duplicateQueuedTickets',
  "import { isReviewReadyAction } from './actionSemantics'",
  'isReviewReadyAction(ticket.next_action)',
  'needs_human',
  "status === 'cancelled'",
  'type HumanReviewRunRecord = HumanReviewRun & Record<string, unknown>',
  'const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord)',
  'function runString',
  'function isRunRecord',
]) {
  if (!humanReviewInbox.includes(marker)) {
    fail(`Missing human review inbox marker: ${marker}`);
  }
}
if (humanReviewInbox.includes('type HumanReviewRunRecord = HumanReviewRun & Record<string, any>')) {
  fail('Human review run records must preserve unknown extension fields.');
}

for (const marker of [
  'export function evaluateEvidenceGate',
  'export function evaluateEvidenceGates',
  "import { isReviewReadyAction } from './actionSemantics'",
  'const reviewReady = isReviewReadyAction(ticket.next_action)',
  'No evidence records',
  'evidenceRecordCount, evidenceString',
  'const evidenceCount = evidenceRecordCount(ticket)',
  'No narrative evidence note',
  'Build #',
  'changes requested',
  'environment',
  'evidence check',
  'evidenceNotes(ticket)',
  'evidenceChecks(ticket)',
  'evidenceEnvironmentResults(ticket)',
  'evidenceString',
]) {
  if (!evidenceGate.includes(marker)) {
    fail(`Missing evidence gate marker: ${marker}`);
  }
}

for (const marker of [
  'export function decideEvidenceHandoff',
  'requiresConfirmation',
  'blockingChecks',
  'not ready for review handoff',
  'review handoff warnings',
]) {
  if (!evidenceGatePolicy.includes(marker)) {
    fail(`Missing evidence gate policy marker: ${marker}`);
  }
}

for (const marker of [
  'export type QueueRemovalDecisionKind',
  'export interface QueueRemovalDecision',
  'export function decideQueueRemoval',
  "'block_failing_gate'",
  "'confirm_failing_gate'",
  "'block_missing_evidence'",
  "'confirm_missing_evidence'",
  "kind: 'allow'",
  'evaluateEvidenceGate(ticketKey, ticket)',
  'evidenceRecordCount(ticket) === 0',
  'stayed in queue because its evidence gate is failing',
  'stayed in queue because it has no evidence records',
]) {
  if (!queueRemovalPolicy.includes(marker)) {
    fail(`Missing queue removal policy marker: ${marker}`);
  }
}

for (const marker of [
  "const ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused'])",
  "const STALEABLE_ACTIVE_RUN_STATUSES = new Set(['preflight', 'running'])",
  'const DEFAULT_STALE_ACTIVE_RUN_MS = 12 * 60 * 60 * 1000',
  'interface RunStatusLike',
  'export function isActiveRunStatus',
  'export function isActiveRun',
  'export function isStaleActiveRun',
  'export function isFreshActiveRun',
  'export function effectiveRunStatus',
  'function hasTerminalRunSignal',
  'export function terminalRunOutcome',
  'function isCancellationEvent',
  'function terminalEventOutcome',
  'function numericExitCode',
  "hasDateLikeValue(run['endedAt'])",
  "label.startsWith('Session exited with code')",
  'export function activeRunSummary',
  "['running', 'preflight', 'paused']",
]) {
  if (!runStatus.includes(marker)) {
    fail(`Missing run status marker: ${marker}`);
  }
}
for (const staleMarker of [
  'export const ACTIVE_RUN_STATUSES',
  'export const STALEABLE_ACTIVE_RUN_STATUSES',
  'export const DEFAULT_STALE_ACTIVE_RUN_MS',
  'export interface RunStatusLike',
  'export function hasTerminalRunSignal',
]) {
  if (runStatus.includes(staleMarker)) {
    fail(`Run status internals should not be exported: ${staleMarker}`);
  }
}

for (const marker of [
  "import { isActiveRunStatus } from './runStatus'",
  'export function runProgressSummary',
  'export function formatRunProgress',
  'function elapsedRunSeconds',
  'function fileCount',
  'function formatElapsed',
  "countLabel(toolCalls, 'tool')",
  "countLabel(filesChanged, 'changed', 'changed')",
]) {
  if (!runProgress.includes(marker)) {
    fail(`Missing run progress marker: ${marker}`);
  }
}

for (const marker of [
  "import { formatRunProgress } from './runProgress'",
  "import { activeRunSummary, isFreshActiveRun, runStatus } from './runStatus'",
  'export function activeRunStatusBarSummary',
  'activeRuns.length === 1',
  'activeRunTooltipLine',
]) {
  if (!activeRunDisplay.includes(marker)) {
    fail(`Missing active run display marker: ${marker}`);
  }
}

for (const marker of [
  'export type RunCompletionNotificationKind',
  'export interface RunCompletionNotification',
  'export function buildRunCompletionNotification',
  "status === 'waiting_for_review'",
  "kind: 'review_ready'",
  "severity: 'info'",
  "actions: ['Open Review', 'Run Center']",
  "reviewTarget: hasMr ? 'mr' : 'ticket'",
  '!isAttentionRunStatus(status)',
  'runAttentionLine(run, 180)',
  "kind: 'attention'",
  "severity: 'warning'",
  "actions: ['Run Center']",
]) {
  if (!runCompletionNotification.includes(marker)) {
    fail(`Missing run completion notification marker: ${marker}`);
  }
}

for (const marker of [
  'export function computeAttentionBadge',
  'export function attentionBadgeCount',
  'buildHumanReviewInbox',
  'evaluateEvidenceGates',
  'analyzeAging',
  'runStatus(run)',
  'isActiveRun(run)',
]) {
  if (!attentionBadge.includes(marker)) {
    fail(`Missing attention badge marker: ${marker}`);
  }
}

for (const marker of [
  'recent_file',
  "import { isCodeAction } from './actionSemantics'",
  "import { isActiveRun, isStaleActiveRun } from './runStatus'",
  'ticket_area',
  'mr_file',
  'const codeAction = isCodeAction(input.action)',
  'staleActiveRunHours?: number',
  'const staleActiveRunHours = input.staleActiveRunHours ?? 12',
  'const isActive = isCollisionActiveRun(run, now, staleActiveRunHours)',
  'editedFilesForRun',
  'const events = Array.isArray(run.events) ? run.events : []',
  'changedFilesForTicket',
  'ticketAreaTokens',
  'isRecentRun',
  'function isCollisionActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean',
  'isStaleActiveRun(run, now, staleActiveRunHours * 60 * 60 * 1000)',
  'sharedFilePaths',
]) {
  if (!collisionDetector.includes(marker)) {
    fail(`Missing collision detector marker: ${marker}`);
  }
}

for (const marker of [
  'export interface TicketFilter',
  'TICKET_FILTER_PRESETS',
  'filterTickets',
  'ticketMatchesFilter',
  'groupTicketEntries',
  'staleDays',
]) {
  if (!ticketFilters.includes(marker)) {
    fail(`Missing ticket filter marker: ${marker}`);
  }
}

for (const marker of [
  'export interface ScoreBreakdownItem',
  'scoreBreakdown',
  'Queue position',
  'Project link',
  'sumBreakdown',
  'recordQueueDecision',
  'clearQueueDecision',
  'planForMinutes',
  'overnightCandidatePlans',
  'isPlanSuppressed',
  'QueueItem, QueueState, Ticket',
  'queueItem?: QueueItem',
  'export function planToQueueItem(input: PlannerInput, plan: PlannedAction): QueueItem',
  'function releaseKeysForPlan(ticket?: Ticket, queueItem?: unknown): string[]',
  'function releaseField(source: unknown, field: string): unknown',
  'function unknownArray(value: unknown): unknown[]',
  'function collectReleaseValues(target: string[], value: unknown): void',
  'function releaseFromLabel(label: unknown): string | undefined',
  'export interface BacklogTriageReport',
  'buildBacklogTriageReport',
  'ready_to_plan',
  'evidence_gap',
  'export interface ProjectBatchPlan',
  'planByProject',
  'export interface ReleaseBatchPlan',
  'planByRelease',
  'releaseFromLabel',
  'summarizePlanActions',
  "import { actionEstimateMinutes, actionPlanningScore } from './actionCatalog'",
  "import { isCodeAction } from './actionSemantics'",
  'isCodeAction(plan.action)',
  'actionEstimateMinutes(plan.action)',
  'actionPlanningScore(ticket.next_action)',
  "import { evidenceRecordCount } from './evidenceData'",
  'evidenceRecordCount(ticket)',
]) {
  if (!queuePlanner.includes(marker)) {
    fail(`Missing queue planner marker: ${marker}`);
  }
}
if (/\bany\b/.test(queuePlanner)) {
  fail('Queue planner should not use any for planner payload normalization.');
}

for (const marker of [
  'export function buildQueuePlannerHtml',
  'export function buildBacklogTriageHtml',
  'export function buildProjectBatchPlanHtml',
  'export function buildReleaseBatchPlanHtml',
  'export function buildCollisionReportHtml',
  'export function buildQueuePlanModeHtml',
  'function planActionRow',
  'function triageActionButtons',
  "actionButton('startPlan', 'Start'",
  "actionButton('snoozePlanToday', 'Tomorrow'",
  "actionButton('addEvidenceCheck', 'Add Check'",
  "import { escapeClass, escapeHtml } from './webviewHtml'",
]) {
  if (!queuePlannerPanelView.includes(marker)) {
    fail(`Missing queue planner panel view marker: ${marker}`);
  }
}
if (/\bany\b/.test(queuePlannerPanelView)) {
  fail('Queue planner panel view should keep renderer payloads typed without any.');
}

for (const marker of [
  'export function buildAgentQualityScoreHtml',
  'export function buildTrendMetricsHtml',
  'export function buildIntegrationManifestHtml',
  'export function buildProfilesHtml',
  'export function buildDoctorHtml',
  'Kronos Agent Quality Score',
  'Kronos Trend Metrics',
  'Kronos Integration Manifest',
  'Kronos Profiles',
  'Kronos Doctor',
  'Hash Status',
  'manifestPillClass',
  "actionButton('snapshotIntegrationManifest', 'Snapshot')",
  "actionButton('stateAuditLog', 'Audit Log')",
  'requiredScripts().map',
  'listProfiles().map',
  'kronosOperatorPanelCss',
  'actionScriptUri?: string',
  "kronosActionPanelScript(nonce, 'Kronos Agent Quality Score', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Trend Metrics', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Integration Manifest', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Profiles', true, actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Doctor', true, actionScriptUri)",
]) {
  if (!operationsReportPanelView.includes(marker)) {
    fail(`Missing operations report panel view marker: ${marker}`);
  }
}
if (/\bany\b/.test(operationsReportPanelView)) {
  fail('Operations report panel view should keep renderer payloads typed without any.');
}

for (const marker of [
  'export function computeAgentQualityScore',
  'SUCCESS_RUN_STATUSES',
  'waiting_for_review',
  'Run completion',
  'Evidence readiness',
  'Build and review health',
  'Retry discipline',
  "import { isActiveRun } from './runStatus'",
  'gradeForScore',
  'type RunQualityRecord = RunRecord & Record<string, unknown>',
  'const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord)',
  'function hasRetryMetadata',
  'function runString',
  'function isRunRecord',
]) {
  if (!agentQualityScore.includes(marker)) {
    fail(`Missing agent quality score marker: ${marker}`);
  }
}
if (agentQualityScore.includes('type RunQualityRecord = RunRecord & Record<string, any>')) {
  fail('Agent quality run records must preserve unknown extension fields.');
}

for (const marker of [
  'export function readIntegrationManifest',
  'export function validateIntegrationManifest',
  'export function auditIntegrationManifest',
  'export function writeIntegrationManifestSnapshot',
  'export function buildIntegrationManifestSnapshot',
  'ManifestArtifactAudit',
  'sha256File',
  'PromptManifestSmokeTest',
  'smoke_tests',
  'INTEGRATION_MANIFEST_FILE',
  'Required script not listed in manifest',
  'Unknown script in manifest',
]) {
  if (!integrationManifest.includes(marker)) {
    fail(`Missing integration manifest marker: ${marker}`);
  }
}

for (const marker of [
  'export interface PromptSmokeTest',
  'export interface PromptSmokeResult',
  'export interface PromptHistorySnapshot',
  'PROMPT_HISTORY_DIR',
  'buildDefaultPromptSmokeTests',
  'runPromptSmokeTests',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Prompt smoke test failed')",
  'createPromptHistorySnapshot',
  'diffPromptHistorySnapshots',
  'latestPromptHistorySnapshot',
  'repairRequiredPromptTemplates',
  'STARTER_PROMPT_VARIABLES',
  'Rendered prompt still contains unresolved',
]) {
  if (!promptManager.includes(marker)) {
    fail(`Missing prompt manager marker: ${marker}`);
  }
}

for (const marker of [
  'export const BUILTIN_PROFILES',
  'enterprise-gitlab-jira',
  'personal-local',
  'github-actions',
  'no-sonar',
  'resolveDefaultBaseBranch',
]) {
  if (!profileManager.includes(marker)) {
    fail(`Missing profile manager marker: ${marker}`);
  }
}

for (const marker of [
  'export function analyzeAging',
  'DEFAULT_AGING_THRESHOLDS',
  'buildFailureDays',
  'verificationDays',
  'has been waiting for review',
]) {
  if (!agingAnalyzer.includes(marker)) {
    fail(`Missing aging analyzer marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildAgingReportHtml',
  "from './webviewHtml'",
  'safeHttpHref(item.url)',
  'kronosWebviewBaseCss',
  'class="kronos-shell aging-shell"',
  'kronos-stat-grid',
  'Kronos Aging Report',
]) {
  if (!agingReportView.includes(marker)) {
    fail(`Missing aging report view marker: ${marker}`);
  }
}

for (const marker of [
  'export function escapeHtml',
  'export function escapeAttr',
  'export function escapeClass',
  'export function safeHttpHref',
  "parsed.protocol !== 'http:'",
  "parsed.protocol !== 'https:'",
]) {
  if (!webviewHtml.includes(marker)) {
    fail(`Missing webview HTML helper marker: ${marker}`);
  }
}

for (const marker of [
  'export function assessSafetyGate',
  'Kronos Safety Gate',
  'destructive',
  'branch-switch',
  'external-publish',
  'requiresConfirmation',
  'requiresWorkspaceTrust: boolean',
  'workspaceTrustSummary: string',
  'const TRUST_REQUIRED_RISKS = new Set<SafetyRisk>',
  'function workspaceTrustRiskSummary(risks: SafetyRisk[]): string',
]) {
  if (!safetyGate.includes(marker)) {
    fail(`Missing safety gate marker: ${marker}`);
  }
}

for (const marker of [
  'export function buildEvidencePublishPlan',
  'export async function publishEvidencePlan',
  'export function readyPublishDestinations',
  '/rest/api/3/issue/',
  '/api/v4/projects/',
  'const urlIid = parsed.pathname.slice(markerIndex + marker.length)',
  'const targetIid = urlIid || String(iid)',
  'function isHttpUrl',
  'function isHttpProtocol',
  'Evidence publish endpoint must use HTTP or HTTPS.',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Evidence publish request failed.')",
  'JIRA_API_TOKEN',
  'GITLAB_TOKEN',
  'Evidence publish request timed out',
]) {
  if (!evidencePublisher.includes(marker)) {
    fail(`Missing evidence publisher marker: ${marker}`);
  }
}

for (const marker of [
  'export function computeTrendMetrics',
  'runs: unknown[]',
  'type RunMetricRecord = Record<string, unknown>',
  'SUCCESS_RUN_STATUSES',
  'FINISHED_RUN_STATUSES',
  'Rework rate',
  'Build pass rate',
  'Verification pass rate',
  'Average cycle time',
  'Review health',
  'const rawRuns = Array.isArray(input.runs) ? input.runs : []',
  '.filter(isRecord)',
  'evidenceChecks(ticket)',
  'evidenceEnvironmentResults(ticket)',
  "evidenceString(check, 'result')",
  'function hasRetryMetadata',
  'function runString',
  'function isRecord',
]) {
  if (!trendMetrics.includes(marker)) {
    fail(`Missing trend metrics marker: ${marker}`);
  }
}
for (const forbidden of [
  'runs: any[]',
  'Record<string, any>',
]) {
  if (trendMetrics.includes(forbidden)) {
    fail(`Trend metrics must normalize raw run payloads instead of using ${forbidden}.`);
  }
}

for (const marker of [
  'export function buildDashboardWorklist',
  'needs_human',
  'active_runs',
  'failing_gates',
  'recent_completed',
  'stale_items',
  'evidenceStatusForRun',
  "import { formatRunProgress } from './runProgress'",
  "import { isFreshActiveRun } from './runStatus'",
  'function isDashboardActiveRun',
  'return isFreshActiveRun(run);',
  'function activeRunDetail(run: DashboardRunRecord, status: string, ticketKey: string): string',
  'formatRunProgress(run)',
  'type DashboardRunRecord = RunRecord & Record<string, unknown>',
  'const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord)',
  "runString(run, 'status')",
  'function runId',
  'function isRunRecord',
]) {
  if (!dashboardWorklist.includes(marker)) {
    fail(`Missing dashboard worklist marker: ${marker}`);
  }
}
if (dashboardWorklist.includes('type DashboardRunRecord = RunRecord & Record<string, any>')) {
  fail('Dashboard worklist run records must preserve unknown extension fields.');
}

for (const marker of [
  'export function buildTicketTimeline',
  'type TimelineRunRecord = TimelineRun & Record<string, unknown>',
  "import { isAttentionRunStatus, runAttentionDetail } from './runAttention'",
  'const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord)',
  'const notes = evidenceNotes(ticket)',
  'const checks = evidenceChecks(ticket)',
  'const environmentResults = evidenceEnvironmentResults(ticket)',
  "runString(run, 'promptHash')",
  'const attentionDetail = isAttentionRunStatus(status) ? runAttentionDetail(run) :',
  'function runDetail',
  'function isRunRecord',
]) {
  if (!ticketTimeline.includes(marker)) {
    fail(`Missing ticket timeline marker: ${marker}`);
  }
}
if (ticketTimeline.includes('type TimelineRunRecord = TimelineRun & Record<string, any>')) {
  fail('Ticket timeline run records must preserve unknown extension fields.');
}

for (const marker of [
  'export function evaluatePostRunReadiness',
  'run: unknown',
  "import { runProgressSummary } from './runProgress'",
  "import { evidenceChecks, evidenceNotes, evidenceString } from './evidenceData'",
  'export function shouldRecordRunCompletionEvidence',
  'export function resolvePostRunTicket',
  'interface PostRunTicketResolution',
  'const runResolved = resolveTicketFromRunRecord(tickets, input.run)',
  'const matchedProjectTickets',
  'matchedProjectTickets.length === 1',
  'function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean',
  'function resolveTicketFromRunRecord(tickets: Record<string, Ticket>, run: unknown): PostRunTicketResolution | undefined',
  'function runSearchStrings(record: Record<string, unknown>): string[]',
  'function ticketKeyAppearsInStrings(ticketKey: string, values: string[]): boolean',
  'function escapeRegExp(value: string): string',
  'function trimmedString(value: unknown): string | undefined',
  "runString(record['skill']) === 'implement'",
  "input.ticket.next_action === 'await_review'",
  '!hasRunCompletionEvidence(input.ticket, runId)',
  'function completionEvidenceRunId(record: Record<string, unknown>): string',
  'function hasRunCompletionEvidence(ticket: Ticket, runId: string): boolean',
  'function evidenceCheckMatchesRunCompletion(check: object, runId: string, command: string): boolean',
  'function evidenceNoteMatchesRunCompletion(note: object, runId: string): boolean',
  'function runCompletionEvidenceCommand(runId: string): string',
  "command: runCompletionEvidenceCommand(runId)",
  'export function buildRunCompletionEvidenceText',
  'export function buildRunCompletionEvidenceCheck',
  'interface RunCompletionEvidenceCheck',
  'function ticketSonarStatus(ticket?: Ticket): string | undefined',
  'function isPassingBuild',
  'function isPassingSonar',
  'export function classifyRunFailure(run: unknown): RunFailureKind',
  "import { isHandoffAction } from './actionSemantics'",
  'isHandoffAction(input.ticket.next_action)',
  'SUCCESS_RUN_STATUSES',
  'claude cli',
  'exitCode === 124',
  "skill.includes('sonar')",
  "skill.includes('verify')",
  'function runRecord(value: unknown): Record<string, unknown>',
  'function runString(value: unknown): string',
  'function runText(value: unknown): string | undefined',
  'function runFailureReason(record: Record<string, unknown>): string',
  'function failureSummaryDetail(kind: RunFailureKind, reason: string): string',
  'function runEventDetails(value: unknown): unknown[]',
  'function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined',
  'function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined',
  'function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined',
  'evidence gate is failing',
  'Run completed, but ticket next action',
]) {
  if (!postRunReadiness.includes(marker)) {
    fail(`Missing post-run readiness marker: ${marker}`);
  }
}
for (const forbidden of [
  'run: any',
  'event: any',
]) {
  if (postRunReadiness.includes(forbidden)) {
    fail(`Post-run readiness must normalize raw run payloads instead of using ${forbidden}.`);
  }
}

for (const marker of [
  'export const jiraAdapter',
  'export const gitlabAdapter',
  'export const sonarAdapter',
  'export interface JiraComment',
  'export function normalizeJiraComments',
  'export interface MergeRequestStatusResult',
  'export function normalizeMergeRequestStatus',
  'export function normalizeMergeRequestComments',
  'async function runMergeRequestStatusJson',
  "runner.runScript(['--mr-status', ticketKey], options)",
  "runner.runScript(['--mr-diff', ticketKey], options)",
  'function isUnsupportedMergeRequestStatusCommand',
  'function isUnsupportedMergeRequestStatusText',
  'function normalizeJiraComment',
  'function normalizeMergeRequestComment',
  'mergeRequestDiff',
  'mergeRequestStatus',
  "normalizeChangedFiles(data['files'])",
  "isRecord(data['mr'])",
  'last_comment_at',
  'status.comment_count = providedCommentCount ?? comments.length',
  'latestIsoTimestamp(latestComment, providedLastCommentAt)',
  'latestIsoTimestamp(discussionStats.last_discussion_at, providedLastDiscussionAt)',
  'export function normalizeSonarBranches',
  'function normalizeSonarBranch',
  "normalizeSonarBranches(data['branches'])",
  'runPipelineJson<unknown>',
  'ticketComments',
  'Jira comments for ${ticketKey}',
  'projectKey',
]) {
  if (!integrationAdapters.includes(marker)) {
    fail(`Missing integration adapter marker: ${marker}`);
  }
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Security invariants OK.');
