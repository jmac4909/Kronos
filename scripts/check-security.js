const fs = require('fs');

function readSource(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const files = [
  'src/extension.ts',
  'src/runners/sessionDispatcher.ts',
  'src/state/KronosState.ts',
  'src/services/scriptClient.ts',
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
const collisionDetector = readSource('src/services/collisionDetector.ts');
const runStatus = readSource('src/services/runStatus.ts');
const runProgress = readSource('src/services/runProgress.ts');
const runCenterSort = readSource('src/services/runCenterSort.ts');
const attentionBadge = readSource('src/services/attentionBadge.ts');
const queuePlanner = readSource('src/services/queuePlanner.ts');
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

for (const requiredIgnore of ['.git/**', '.claude/**', 'node_modules/**', 'scripts/**', 'CLAUDE.md', '*.zip', '*.tgz', '*.log', '.env*', 'GOOD_TO_GREAT_REVIEW.md', 'WINDOWS_FEEDBACK_*.md']) {
  if (!vscodeIgnore.split(/\r?\n/).includes(requiredIgnore)) {
    fail(`.vscodeignore must exclude ${requiredIgnore}`);
  }
}
const extensionUiSource = `${extension}\n${queuePlannerPanelView}\n${operationsReportPanelView}`;
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

const enableScriptsTrue = [...extension.matchAll(/enableScripts:\s*true/g)].length;
if (enableScriptsTrue !== 28) {
  fail(`Expected exactly 28 script-enabled webviews, found ${enableScriptsTrue}.`);
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
if (directDispatchCallCount !== 1 || !extension.includes('await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt)')) {
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
  'buildJiraBoardHtml(state, nonce)',
  'webviewScriptCspOptions(panel.webview.cspSource, nonce)',
  'script nonce="${escapeAttr(nonce)}"',
  "${webviewVsCodeApiScript('Kronos Jira Board')}",
  "${webviewReadyPostScript('Kronos Jira Board')}",
  "import { createWebviewReadyMonitor } from './services/webviewDiagnostics'",
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
  "unknownErrorMessage(e, 'Could not load comments')",
  "unknownErrorMessage(e, 'Failed to register project.')",
  "unknownErrorMessage(e, 'Could not load SonarQube branches.')",
  "'(default; Sonar branches unavailable)'",
  'unknownErrorMessage(e, `Could not resolve MR branch for ${k}.`)',
  "from './services/webviewHtml'",
  'kronos.openExternalUrl',
  'async function confirmSafetyGate',
  'async function removeTicketFromQueue',
  'stayed in queue because it has no evidence records',
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
  'evidenceRecordCount(ticket)',
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
  'await executeOperatorCommandAction(command, ticketKey)',
  "command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner'",
  'kronos.evidenceGate',
  'openEvidenceGatePanel',
  'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
  "if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }",
  "openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true })",
  'options.refreshAllEvidenceGates',
  'function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[]',
  'function isProofSensitiveAction',
  'kronos.evidenceHandoff',
  'openEvidenceHandoffPanel',
  'kronos.publishEvidence',
  'openEvidencePublishPanel',
  'Publish Evidence Comment',
  "risks: ['external-publish']",
  'stayed in queue because its evidence gate is failing',
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
  'startReviewAutomation(context, state)',
  "import { describeMergeRequestStatusChange } from './services/mergeRequestNotifications'",
  'const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000',
  "const sessionPollMs = configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000)",
  "setInterval(throttledRefresh, configIntervalSecondsMs(config.get<number>('pollIntervalSec', 300), 300, 1))",
  "const pollIntervalMs = configIntervalSecondsMs(config.get<number>('reviewPollIntervalSec', fallbackSec), fallbackSec, 60)",
  'function updatePositiveNumberSetting',
  'parsePositiveNumberInput(input)',
  'void poll();',
  'function pollReviewMergeRequests',
  'state.reloadAndNotify();',
  'gitlabAdapter.mergeRequestStatus',
  'updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status })',
  'update.closedNow',
  'MR closed - ticket moved to blocked.',
  'notifyMergeRequestStatusChange(candidate.ticketKey, update)',
  'notifyReviewMergeRequestPollFailure(candidate.ticketKey, e)',
  'function notifyReviewMergeRequestPollFailure(ticketKey: string, error: unknown): void',
  'MR status polling failed:',
  'function notifyMergeRequestStatusChange(ticketKey: string, update: MergeRequestStatusUpdate): void',
  'describeMergeRequestStatusChange(ticketKey, update)',
  'type TicketWithOpenMergeRequest = Ticket & { mr: NonNullable<Ticket[\'mr\']> }',
  'function isOpenReviewMergeRequestEntry(entry: [string, Ticket]): entry is [string, TicketWithOpenMergeRequest]',
  '.filter(isOpenReviewMergeRequestEntry)',
  'function reviewBranchTickets(state: KronosState): ReviewBranchTicket[]',
  'return reviewMergeRequestCandidates(state).map(({ ticketKey, ticket }) => ({',
  "vscode.window.showInformationMessage('No open review MRs to fix.')",
  "vscode.window.showInformationMessage('Need at least 2 open review MRs to resolve conflicts.')",
  "vscode.window.showInformationMessage('No open review MRs to verify.')",
  'startDeployMonitorForMergedTicket',
  'async function startClaudeDispatch',
  'type DispatchOptions',
  'await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt)',
  'unknownErrorMessage(e, `Failed to start ${skill} session.`)',
  "await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey",
  'projectNameOverride: projectName',
  'hasActiveDeployMonitorRun(projectName, projectPath, ticketKey)',
  'MR merged, but no linked project was found for deploy monitoring.',
  'has no registered path for deploy monitoring.',
  'run.project === projectName || run.projectPath === projectPath',
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
  '`${primary.ticketKey}: ${mr} ready for review${suffix}`',
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
  'const ticketResolutionInput:',
  'if (state.state?.tickets) { ticketResolutionInput.tickets = state.state.tickets; }',
  'const resolvedTicket = resolvePostRunTicket(ticketResolutionInput)',
  'projectName,',
  'evaluatePostRunReadiness',
  'ticket && shouldRecordRunCompletionEvidence({ run, ticket })',
  'addTicketEvidenceNote(resolvedTicketKey, {',
  "kind: 'note'",
  'buildRunCompletionEvidenceText(run, ticket)',
  'addTicketEvidenceCheck(resolvedTicketKey, buildRunCompletionEvidenceCheck(run, ticket))',
  "unknownErrorMessage(e, 'Failed to add run completion evidence.')",
  'const reloadedTicketInput:',
  'const reloadedTicket = resolvePostRunTicket(reloadedTicketInput)',
  'resolvedTicketKey = reloadedTicket.ticketKey || resolvedTicketKey',
  'ticket = reloadedTicket.ticket',
  'run.failureReason = run.failureReason || run.readiness.summary',
  'writeRunRecord(run)',
  'await showRunCompletionToast(resolvedTicketKey, ticket, run)',
  'async function showRunCompletionToast(ticketKey: string, ticket: Ticket | undefined, run: KronosRun): Promise<void>',
  "status === 'waiting_for_review'",
  '!isAttentionRunStatus(status)',
  'vscode.window.showWarningMessage',
  'runAttentionLine(run, 180)',
  "'Open Review'",
  "'Run Center'",
  "vscode.commands.executeCommand('kronos.openMrDiff'",
  'async function runCommandProgress',
  'await runCommandProgress(',
  'await vscode.window.withProgress(',
  'unknownErrorMessage(e, failureFallback)',
  "unknownErrorMessage(e, 'Kronos auto-refresh failed.')",
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
  'export function kronosActionPanelScript',
  'export function kronosOperatorPanelCss',
  'kronosWebviewBaseCss',
  'webviewActionPostScript(webviewName, [',
  'readyDiagnostic ? { readyCommand: WEBVIEW_READY_COMMAND } : {}',
  "{ messageKey: 'ticket', dataAttribute: 'data-ticket' }",
  "{ messageKey: 'runId', dataAttribute: 'data-run-id' }",
  "{ messageKey: 'planId', dataAttribute: 'data-plan-id' }",
  "{ messageKey: 'itemId', dataAttribute: 'data-item-id' }",
  'script nonce="${escapeAttr(nonce)}"',
  "data-action=\"${escapeAttr(action)}\"",
  "data-plan-id=\"${escapeAttr(options.planId)}\"",
  "data-item-id=\"${escapeAttr(options.itemId)}\"",
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
if (!extension.includes("unknownErrorMessage(e, 'Kronos panel auto-refresh failed.')")) {
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
const evidenceGateHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);');
const evidenceGateHandlerEnd = extension.indexOf('function openEvidenceHandoffPanel', evidenceGateHandlerStart);
if (evidenceGateHandlerStart < 0 || evidenceGateHandlerEnd <= evidenceGateHandlerStart) {
  fail('Missing Evidence Gate message handler block.');
}
const evidenceGateHandlerSource = extension.slice(evidenceGateHandlerStart, evidenceGateHandlerEnd);
if (!evidenceGateHandlerSource.includes("if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }")) {
  fail('Evidence Gate refresh should reload state before rendering.');
}
const dashboardHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);');
const dashboardHandlerEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.queueMoveUp'", dashboardHandlerStart);
if (dashboardHandlerStart < 0 || dashboardHandlerEnd <= dashboardHandlerStart) {
  fail('Missing Dashboard message handler block.');
}
const dashboardHandlerSource = extension.slice(dashboardHandlerStart, dashboardHandlerEnd);
if (!dashboardHandlerSource.includes("if (request.command === 'refreshPanel') {\n            state.reloadAndNotify();\n            await render();\n            return;\n          }")) {
  fail('Dashboard refresh should reload state before rendering.');
}
const agingHandlerStart = extension.indexOf('const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);');
const agingHandlerEnd = extension.indexOf('function openIntegrationManifestPanel', agingHandlerStart);
if (agingHandlerStart < 0 || agingHandlerEnd <= agingHandlerStart) {
  fail('Missing Aging Report message handler block.');
}
const agingHandlerSource = extension.slice(agingHandlerStart, agingHandlerEnd);
if (!agingHandlerSource.includes("if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }")) {
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
]) {
  if (extension.includes(forbidden)) {
    fail(`Extension command handlers must normalize unknown errors instead of using ${forbidden}.`);
  }
}
for (const marker of [
  "vscode.commands.registerCommand('kronos.refreshProject', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.implement', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.deployMonitor', async (item: unknown)",
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
  'recoveryActionLabel',
  'kronosOperatorPanelCss',
  'kronosActionPanelScript(nonce)',
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
  "kronosActionPanelScript(nonce, 'Kronos Evidence Gate', true)",
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
  "linkTicketToProject(ticket, project);\n            state.reloadAndNotify();\n            renderBoard();",
  "unlinkTicketFromProject(ticket, project);\n            state.reloadAndNotify();\n            renderBoard();",
  "const result = addTicketToQueue(ticket);\n            state.reloadAndNotify();\n            renderBoard();",
  "await removeTicketFromQueue(state, ticket, true);\n          renderBoard();",
  "unknownErrorMessage(e, 'Failed to link ticket.')",
  "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  "unknownErrorMessage(e, 'Failed to add ticket to queue.')",
  'class="kronos-shell board-shell"',
  'class="kronos-shell dashboard-shell"',
  'let data: unknown = {}',
  'let loadWarning: string | undefined',
  "loadWarning = unknownErrorMessage(e, 'Morning brief unavailable.')",
  'buildDashboardHtml(state, data, nonce, loadWarning)',
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
  'kronosActionPanelScript(nonce)',
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
  "import { unknownErrorMessage } from './errorUtils'",
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
  "import { effectiveRunStatus, isActiveRunStatus } from './runStatus'",
  'function normalizeTerminalActiveRun',
  'const effectiveStatus = effectiveRunStatus(run)',
  'Run record had terminal metadata while persisted status was ${status}',
  'function normalizeRunFile',
  "scope === 'active' && normalized !== run",
  'writeJsonAtomic(filePath, normalized)',
]) {
  if (!runStore.includes(marker)) {
    fail(`Missing run store marker: ${marker}`);
  }
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
  "import { isActiveRun } from '../services/runStatus'",
  "import { runProgressSummary } from '../services/runProgress'",
  "'refreshPanel'",
  "'archiveFinishedRuns'",
  'pollIntervalMs?: number',
  'const pollTimer = setInterval',
  'panel.onDidDispose(() => clearInterval(pollTimer))',
  "import { createWebviewReadyMonitor } from '../services/webviewDiagnostics'",
  "const logReady = createWebviewReadyMonitor(panel, 'Kronos Run Center')",
  'if (logReady(msg)) { return; }',
  "message.command === 'refreshPanel' || message.command === 'archiveFinishedRuns'",
  "runCenterActionButton('refreshPanel', 'Refresh')",
  "runCenterActionButton('archiveFinishedRuns', 'Archive Finished')",
  'webviewActionPostScript',
  "${webviewActionPostScript('Kronos Run Center', [",
  '{ readyCommand: WEBVIEW_READY_COMMAND }',
  "import { sortedRunCenterRuns } from '../services/runCenterSort'",
  'const sortedRuns = sortedRunCenterRuns(runs)',
  'sorted by status and time',
  "const pausable = status === 'running' || status === 'preflight'",
  "const stoppable = isActiveRun(run) && status !== 'paused'",
  'if (stoppable) {',
  "if (pausable) { buttons.push(runCenterActionButton('pauseRun', 'Pause', runId)); }",
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
  "import { isActiveRun } from './runStatus'",
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
  'Kronos script missing',
]) {
  if (!scriptClient.includes(marker)) {
    fail(`Missing script client marker: ${marker}`);
  }
}
if (scriptClient.includes('} catch {}')) {
  fail('Script client must not silently swallow Python discovery failures.');
}

for (const marker of [
  'export function runStateScript',
  'export function refreshKronosState',
  'export function discoverProjects',
  'export function discoverProjectsJson',
  'export function normalizeDiscoveredProjects',
  'function normalizeDiscoveredProject',
  "normalizeDiscoveredProjects(data['candidates'])",
  'export function registerProject',
  'export function addAdhocTask',
  'export function completeAdhocTask',
  'export function readMorningBrief',
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
  'export function buildNextActionContext',
  'export function buildNextActionStartDecision',
  'export function skillForAction',
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
  "import { isActiveRun } from '../services/runStatus'",
  "import { formatRunProgress } from '../services/runProgress'",
  "import { unknownErrorMessage } from '../services/errorUtils'",
  'private _refreshing = false',
  'const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000',
  'void this.refreshSessionsSafely()',
  'private async refreshSessionsSafely(): Promise<void>',
  "unknownErrorMessage(e, 'Kronos session refresh failed.')",
  'const activeRuns = listRuns().filter(isActiveRun)',
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
  "import { isActiveRun } from '../services/runStatus'",
  "import { skillForAction } from '../services/nextActionContext'",
  "import { formatRunProgress } from '../services/runProgress'",
  'const activeRuns = listRuns().filter(isActiveRun)',
  'new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns))',
  'startPolling(intervalMs: number): void',
  'queueTree.startPolling(sessionPollMs)',
  'queueTree.dispose()',
  'const progress = activeRun ? formatRunProgress(activeRun) :',
  'Active run: ${activeRun.id}',
  "new vscode.ThemeIcon('sync~spin'",
  'function activeRunForQueueItem(item: QueueItem, activeRuns: KronosRun[]): KronosRun | undefined',
  'return activeRuns.find(run => runMatchesQueueItem(run, item));',
  'function runMatchesQueueItem(run: KronosRun, item: QueueItem): boolean',
  'function runMatchesQueueTicket(run: KronosRun, item: QueueItem): boolean',
  'function runMatchesQueueProject(run: KronosRun, item: QueueItem): boolean',
  'function runMatchesQueueProjectScope(run: KronosRun, item: QueueItem): boolean',
  'function runMatchesQueueAction(run: KronosRun, item: QueueItem): boolean',
  'run.skill === skillForAction(item.action)',
]) {
  if (!queueTreeProvider.includes(marker) && !extension.includes(marker)) {
    fail(`Missing queue tree active-run marker: ${marker}`);
  }
}
if (queueTreeProvider.includes('activeRuns.find(run => runMatchesQueueTicket(run, item))\n    || activeRuns.find')) {
  fail('Queue active-run matching must not use broad ticket-only or project-only fallbacks.');
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
  'private currentReviewKeys = new Set<string>()',
  'private seenReviewKeys = new Set<string>()',
  'private newReviewKeys = new Set<string>()',
  'private spinningReviewKeys = new Map<string, number>()',
  'this.seedInitialReviewKeys()',
  'getNewReviewCount(): number',
  'export interface NewReviewItemSummary',
  'getNewReviewItems(): NewReviewItemSummary[]',
  'if (ticket.mr?.iid !== undefined) { summary.mrIid = ticket.mr.iid; }',
  'markVisibleReviewItemsSeen(): void',
  'this.spinningReviewKeys.set(key, Date.now() + NEW_REVIEW_SPIN_MS)',
  'new ReviewItem(key, ticket, isNew, isNew && this.isReviewItemSpinning(key))',
  'private scheduleSpinRefresh(): void',
  'private clearSpinTimer(): void',
  'dispose(): void',
  'private seedInitialReviewKeys(): void',
  'this.seenReviewKeys = new Set(initialKeys)',
  "this.description = `${isNew ? 'NEW · ' : ''}",
  "new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'))",
  "new vscode.ThemeIcon('circle-filled'",
  "new vscode.ThemeIcon('git-pull-request', color)",
  'function isReviewTicket(ticket: Ticket): boolean',
  "ticket.next_action === 'await_review' && ticket.mr.state === 'opened'",
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
  'export function webviewVsCodeApiScript',
  'const vscode = (function() {',
  "typeof acquireVsCodeApi !== 'function'",
  "console.error('Failed to acquire VS Code API for Kronos webview action', error)",
  "document.documentElement.setAttribute('data-kronos-script-ready', 'true')",
  "console.info('Kronos webview script ready', webviewName, navigator.userAgent)",
  "console.error('Kronos webview script error', webviewName",
  "console.error('Kronos webview unhandled rejection', webviewName",
  'export const WEBVIEW_READY_COMMAND',
  'export function webviewReadyPostScript',
  "vscode.postMessage({ command: readyCommand",
  "console.warn('Kronos webview could not post script readiness', error)",
  'export function webviewScriptDiagnosticBanner',
  'data-kronos-script-required',
  'Webview Developer Tools',
  'Extension Host DevTools',
  'function injectWebviewScriptDiagnostic(html: string): string',
  'injectWebviewScriptDiagnostic(value)',
  'export function webviewActionPostScript',
  'function postKronosAction(event)',
  "document.addEventListener('click', postKronosAction, true)",
  "document.addEventListener('DOMContentLoaded', attachKronosActionHandler, { once: true })",
  "document.documentElement.setAttribute('data-kronos-actions-ready', 'true')",
  'message[field.messageKey]',
  'options.readyCommand ? webviewReadyPostScript(webviewName, options.readyCommand) :',
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
  'export function checkGcloudApplicationDefaultAuth',
  'export function checkClaudeModelAccess',
  'export function commandNeedsCmdWrapper',
  'export function windowsCmdFileInvocation',
  'export function readableGoogleApplicationCredentials',
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
  'export function normalizeChangedFilePath',
  'export function changedFilePaths',
  'export function primaryChangedFilePath',
  'export function normalizeChangedFile',
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
  "vscode.postMessage({ command: 'fixSonar' })",
  "vscode.postMessage({ command: 'openSonar' })",
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
  'REVIEW_READY_ACTIONS',
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
  'REVIEW_READY_ACTIONS',
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
  "ACTIVE_RUN_STATUSES = new Set(['queued', 'preflight', 'running', 'paused'])",
  'export function isActiveRunStatus',
  'export function isActiveRun',
  'export function effectiveRunStatus',
  'export function hasTerminalRunSignal',
  'export function terminalRunOutcome',
  'function isCancellationEvent',
  'function terminalEventOutcome',
  'function numericExitCode',
  "hasDateLikeValue(run['endedAt'])",
  "label.startsWith('Session exited with code')",
  'export function activeRunSummary',
  "['running', 'preflight', 'queued', 'paused']",
]) {
  if (!runStatus.includes(marker)) {
    fail(`Missing run status marker: ${marker}`);
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
  "import { isActiveRun } from './runStatus'",
  'ticket_area',
  'mr_file',
  "STALEABLE_ACTIVE_RUN_STATUSES = new Set(['queued', 'preflight', 'running'])",
  'staleActiveRunHours?: number',
  'const staleActiveRunHours = input.staleActiveRunHours ?? 12',
  'const isActive = isCollisionActiveRun(run, now, staleActiveRunHours)',
  'editedFilesForRun',
  'const events = Array.isArray(run.events) ? run.events : []',
  'changedFilesForTicket',
  'ticketAreaTokens',
  'isRecentRun',
  'function isCollisionActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean',
  'function isStaleActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean',
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
  'kronosActionPanelScript(nonce)',
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
  "import { isActiveRun } from './runStatus'",
  'function isDashboardActiveRun',
  'return isActiveRun(run);',
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
  'const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord)',
  'const notes = evidenceNotes(ticket)',
  'const checks = evidenceChecks(ticket)',
  'const environmentResults = evidenceEnvironmentResults(ticket)',
  "runString(run, 'promptHash')",
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
  "import { evidenceNotes } from './evidenceData'",
  'export function shouldRecordRunCompletionEvidence',
  'export function resolvePostRunTicket',
  'interface PostRunTicketResolution',
  'const matchedProjectTickets',
  'matchedProjectTickets.length === 1',
  'function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean',
  'function trimmedString(value: unknown): string | undefined',
  "runString(record['skill']) === 'implement'",
  "input.ticket.next_action === 'await_review'",
  'evidenceNotes(input.ticket).length === 0',
  'export function buildRunCompletionEvidenceText',
  'export function buildRunCompletionEvidenceCheck',
  'interface RunCompletionEvidenceCheck',
  'function ticketSonarStatus(ticket?: Ticket): string | undefined',
  'function isPassingBuild',
  'function isPassingSonar',
  'export function classifyRunFailure(run: unknown): RunFailureKind',
  'HANDOFF_ACTIONS',
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
  'function normalizeJiraComment',
  'function normalizeMergeRequestComment',
  'mergeRequestDiff',
  'mergeRequestStatus',
  "normalizeChangedFiles(data['files'])",
  "isRecord(data['mr'])",
  'last_comment_at',
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
