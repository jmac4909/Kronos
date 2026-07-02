const fs = require('fs');

function readSource(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const files = [
  'src/extension.ts',
  'src/runners/sessionDispatcher.ts',
  'src/state/KronosState.ts',
  'src/services/scriptClient.ts',
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
const queuePlanner = readSource('src/services/queuePlanner.ts');
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
const webviewSecurity = readSource('src/services/webviewSecurity.ts');
const cliProbes = readSource('src/services/cliProbes.ts');
const combinedVerification = readSource('src/services/combinedVerification.ts');
const changedFiles = readSource('src/services/changedFiles.ts');
const sonarReportView = readSource('src/services/sonarReportView.ts');
const agingReportView = readSource('src/services/agingReportView.ts');
const webviewHtml = readSource('src/services/webviewHtml.ts');
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

for (const requiredIgnore of ['.git/**', '.claude/**', 'node_modules/**', 'scripts/**', 'CLAUDE.md', '*.zip', '*.tgz', '*.log', '.env*', 'GOOD_TO_GREAT_REVIEW.md']) {
  if (!vscodeIgnore.split(/\r?\n/).includes(requiredIgnore)) {
    fail(`.vscodeignore must exclude ${requiredIgnore}`);
  }
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

const runCreateIndex = dispatcher.indexOf('const run = createRun');
const authPreflightIndex = dispatcher.indexOf('const authed = await ensureAuth()');
if (runCreateIndex < 0 || authPreflightIndex < 0 || runCreateIndex > authPreflightIndex) {
  fail('Dispatch must create a persisted run record before auth preflight.');
}
if (dispatcher.includes("fs.readFileSync(path.join(KRONOS_DIR, 'state.json')")) {
  fail('Dispatch must load project config through validated stateStore reads.');
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
  'webviewScriptCsp(panel.webview, nonce)',
  'cspSource: webview.cspSource',
  'script nonce="${escapeAttr(nonce)}"',
  'BOARD_MESSAGE_COMMANDS',
  'function normalizeWebviewCommand',
  'function normalizeBoardMessage',
  'const request = normalizeBoardMessage(msg)',
  'const command = normalizeWebviewCommand(msg, sonarCommands)',
  'function openExternalHttpUrl',
  "from './services/webviewHtml'",
  'kronos.openExternalUrl',
  'async function confirmSafetyGate',
  'async function removeTicketFromQueue',
  'stayed in queue because it has no evidence notes',
  "import { unknownErrorMessage } from './services/errorUtils'",
  'async function retryRunFromPrompt',
  'async function resumeSelectedRun',
  'function resolveRunWorkspace',
  'async function archiveSelectedRun',
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
  'return evidenceNotes(ticket).length + evidenceChecks(ticket).length + evidenceEnvironmentResults(ticket).length',
  'function ticketStringArray',
  'function ticketAttachments',
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
  "unknownErrorMessage(e, 'Failed to preview merge request link.')",
  "unknownErrorMessage(e, 'Failed to link merge request to ticket.')",
  "unknownErrorMessage(e, 'Failed to update ticket project links.')",
  "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  'kronos.humanReviewInbox',
  'openHumanReviewInbox',
  'const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set',
  'function humanReviewActionButtons',
  "actionButton('startTicket', 'Start'",
  'kronos.evidenceGate',
  'openEvidenceGatePanel',
  'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
  'function evidenceGateActionButtons',
  "actionButton('extractAcceptanceCriteria', 'Extract AC'",
  'function kronosActionPanelScript',
  'kronos.evidenceHandoff',
  'openEvidenceHandoffPanel',
  'Kronos did not call a posting API',
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
  'kronos.collisionReport',
  'openCollisionReportPanel',
  'loadMrFileHints',
  'LIVE_MR_DIFF_TIMEOUT_MS',
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
  'Stale Critical',
  'kronos.integrationManifest',
  'openIntegrationManifestPanel',
  'Integration manifest',
  'Hash Status',
  'manifestPillClass',
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
  'kronos.cancelRun',
  "unknownErrorMessage(e, 'Failed to resume run.')",
  "unknownErrorMessage(e, 'Failed to archive run.')",
  "unknownErrorMessage(e, 'Failed to pause run.')",
  "unknownErrorMessage(e, 'Failed to continue run.')",
  "unknownErrorMessage(e, 'Failed to cancel run.')",
  "unknownErrorMessage(e, 'Failed to open run diff.')",
  "unknownErrorMessage(e, 'Failed to mark run needs-human.')",
  'runRecordPath(picked.run.id)',
  'evaluatePostRunReadiness',
  'writeRunRecord(run)',
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
  "import { buildSonarReport, type SonarIssue }",
  'function recordFromUnknown(value: unknown): Record<string, unknown>',
  'panel.webview.onDidReceiveMessage(async (msg: unknown) =>',
  'function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
  'function formatSonarIssuePromptLine(issue: SonarIssue): string',
  'const issuesData = normalizeSonarIssueCommandList(commandArg.issuesData)',
  'const lines = issuesData.map(formatSonarIssuePromptLine)',
  "from './services/stateStore'",
  "from './services/integrationAdapters'",
  "from './services/projectMutations'",
]) {
  if (!extension.includes(marker)) {
    fail(`Missing safety marker: ${marker}`);
  }
}

const boardHandlerStart = extension.indexOf('panel.webview.onDidReceiveMessage(async (msg) => {\n        const request = normalizeBoardMessage(msg);');
const boardHandlerEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.viewTicket'", boardHandlerStart);
if (boardHandlerStart < 0 || boardHandlerEnd <= boardHandlerStart) {
  fail('Missing Jira board message handler block.');
}
const boardHandlerSource = extension.slice(boardHandlerStart, boardHandlerEnd);
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
  'item?.sourceBranch ||',
]) {
  if (extension.includes(forbidden)) {
    fail(`Extension command handlers must normalize unknown errors instead of using ${forbidden}.`);
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
  'class="kronos-shell ticket-shell"',
  'class="kronos-shell diff-shell"',
  'function dashboardBriefRecord',
  'function dashboardBriefItems',
  'function dashboardBriefCount',
  'function kronosOperatorPanelCss',
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
  if (!extension.includes(marker)) {
    fail(`Missing UI/UX marker: ${marker}`);
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
  'export function readArchivedRuns',
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
  'currentRef: currentGitRef(input.cwd)',
  'currentCommit: currentGitCommit(input.cwd)',
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
  'GCP auth expired or missing.',
  'Authenticate and retry the saved prompt from Run Center.',
  'classifyRunFailure({ ...run',
  'spawnErrorHandled',
  'workspaceCwd?: string',
  'projectNameOverride?: string',
  'managedWorktreePath',
  'onComplete?: (code: number, run: KronosRun) => void',
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
  'writeSavedSession(session)',
  'export { getAggregateStats, listSavedSessions, listSessionStoreIssues }',
  'const id = safeSessionId',
  'function toValidDate',
  'function progressDateOr',
  'function progressEventTimeLabel',
  'function progressDurationSeconds',
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
  'const durationSec = progressDurationSeconds(events)',
  'Duration: ${progressDurationSeconds(events)}s',
  'const statusClass = escapeClass(status)',
  'const started = progressDateTimeLabel(run.startedAt)',
  'const runEvents = Array.isArray(run.events) ? run.events : []',
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
  'Invalid JSON from',
  'Kronos script missing',
]) {
  if (!scriptClient.includes(marker)) {
    fail(`Missing script client marker: ${marker}`);
  }
}

for (const marker of [
  'export function runStateScript',
  'export function refreshKronosState',
  'export function discoverProjects',
  'export function discoverProjectsJson',
  'export function normalizeDiscoveredProjects',
  'function normalizeDiscoveredProject',
  'normalizeDiscoveredProjects(data.candidates)',
  'export function registerProject',
  'export function addAdhocTask',
  'export function completeAdhocTask',
  'export function readMorningBrief',
  'export function readMorningBriefJson',
  'function arrayOrEmpty',
  'function finiteNumberOrZero',
  'function stringOrNull',
  'completed: arrayOrEmpty(parsed.completed)',
  'ready_to_go: arrayOrEmpty(parsed.ready_to_go)',
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
  'evidenceNotes(ticket).length',
  'evidenceChecks(ticket).length',
  'evidenceEnvironmentResults(ticket).length',
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
  "runner(['worktree', 'add'",
  "runner(['worktree', 'remove'",
  "runner(['diff', '--cached', '--']",
]) {
  if (!gitWorkspace.includes(marker)) {
    fail(`Missing git workspace marker: ${marker}`);
  }
}

for (const marker of [
  'export function stopProcessTree',
  'export function signalProcessTree',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  'catch (fallbackError: unknown)',
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

for (const marker of [
  'export function createWebviewNonce',
  "toString('hex')",
  'cspSource?: string',
  'options.cspSource',
  'export function webviewCspMeta',
  'export function withWebviewCsp',
  "default-src 'none'",
  'style-src ${styleSrc}',
  "script-src ${scriptSrc}",
  'Content-Security-Policy',
]) {
  if (!webviewSecurity.includes(marker)) {
    fail(`Missing webview security marker: ${marker}`);
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
  "typeof file.diff === 'string'",
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
  'registryIssue: registry.issue',
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
  'validateActionValue(t.next_action',
  'validateActionValue(item.action',
  'export function migrateStateFileShape',
  'export function readStateFileWithIssues',
  'export function migrateQueueFileShape',
  'function migrateQueueItemShape',
  'export function readStateFile',
  'export function readQueueFile',
  'STATE_WRITE_LOCK_FILE',
  'acquireStateWriteLock',
  'clearStaleWriteLock',
  'DEFAULT_OVERNIGHT',
  "import { unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'unknown validation error')",
  "unknownErrorMessage(e, 'Failed to load state.json')",
  "unknownErrorMessage(e, 'invalid project record')",
  "unknownErrorMessage(e, 'invalid ticket record')",
  "unknownErrorMessage(e, 'Invalid audit JSONL entry')",
]) {
  if (!stateStore.includes(marker)) {
    fail(`Missing state store marker: ${marker}`);
  }
}

for (const forbidden of [
  'catch (e: any)',
  'e?.message',
]) {
  if (stateStore.includes(forbidden)) {
    fail(`State store must normalize unknown errors instead of using ${forbidden}.`);
  }
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
  "target: 'state.json'",
  "target: 'queue.json'",
]) {
  if (!sources['src/state/KronosState.ts'].includes(marker)) {
    fail(`Missing KronosState load issue marker: ${marker}`);
  }
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
  'No evidence notes',
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
  'recent_file',
  "ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused'])",
  'ticket_area',
  'mr_file',
  'editedFilesForRun',
  'const events = Array.isArray(run.events) ? run.events : []',
  'changedFilesForTicket',
  'ticketAreaTokens',
  'isRecentRun',
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
  'evidenceNotes(ticket).length',
  'evidenceChecks(ticket).length',
  'evidenceEnvironmentResults(ticket).length',
]) {
  if (!queuePlanner.includes(marker)) {
    fail(`Missing queue planner marker: ${marker}`);
  }
}

for (const marker of [
  'export function computeAgentQualityScore',
  'SUCCESS_RUN_STATUSES',
  'waiting_for_review',
  'Run completion',
  'Evidence readiness',
  'Build and review health',
  'Retry discipline',
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
  'function runEventDetails(value: unknown): unknown[]',
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
  'function normalizeJiraComment',
  'mergeRequestDiff',
  'normalizeChangedFiles(data.files)',
  'isRecord(data.mr)',
  'export function normalizeSonarBranches',
  'function normalizeSonarBranch',
  'normalizeSonarBranches(data.branches)',
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
