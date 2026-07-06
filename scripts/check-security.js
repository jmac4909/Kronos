const fs = require('fs');
const path = require('path');

function readSource(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function listFilesRecursive(dir, predicate) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, predicate));
    } else if (predicate(fullPath)) {
      files.push(fullPath.replace(/\\/g, '/'));
    }
  }
  return files;
}

const liveSecurityScanFiles = [
  ...listFilesRecursive('src', file => file.endsWith('.ts')),
  ...listFilesRecursive('media', file => file.endsWith('.js')),
].sort();
const files = liveSecurityScanFiles;

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
const jsonFiles = readSource('src/services/jsonFiles.ts');
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
const evidenceCommandInputs = readSource('src/services/evidenceCommandInputs.ts');
const evidenceHandoff = readSource('src/services/evidenceHandoff.ts');
const evidencePublisher = readSource('src/services/evidencePublisher.ts');
const humanReviewInbox = readSource('src/services/humanReviewInbox.ts');
const recoveryCenter = readSource('src/services/recoveryCenter.ts');
const evidenceGate = readSource('src/services/evidenceGate.ts');
const evidenceGatePolicy = readSource('src/services/evidenceGatePolicy.ts');
const queueRemovalPolicy = readSource('src/services/queueRemovalPolicy.ts');
const collisionDetector = readSource('src/services/collisionDetector.ts');
const mergeRequestFileHints = readSource('src/services/mergeRequestFileHints.ts');
const runStatus = readSource('src/services/runStatus.ts');
const runRecords = readSource('src/services/runRecords.ts');
const runProgress = readSource('src/services/runProgress.ts');
const runOperatorSummary = readSource('src/services/runOperatorSummary.ts');
const runActionHelpers = readSource('src/services/runActionHelpers.ts');
const activeRunDisplay = readSource('src/services/activeRunDisplay.ts');
const runCompletionNotification = readSource('src/services/runCompletionNotification.ts');
const runAttention = readSource('src/services/runAttention.ts');
const runLabels = readSource('src/services/runLabels.ts');
const runCenterSort = readSource('src/services/runCenterSort.ts');
const attentionBadge = readSource('src/services/attentionBadge.ts');
const queuePlanner = readSource('src/services/queuePlanner.ts');
const queueDispatchPlan = readSource('src/services/queueDispatchPlan.ts');
const actionCatalog = readSource('src/services/actionCatalog.ts');
const actionSemantics = readSource('src/services/actionSemantics.ts');
const projectSelection = readSource('src/services/projectSelection.ts');
const projectSetupPlan = readSource('src/services/projectSetupPlan.ts');
const severityRank = readSource('src/services/severityRank.ts');
const doctorAttention = readSource('src/services/doctorAttention.ts');
const records = readSource('src/services/records.ts');
const commandPayloads = readSource('src/services/commandPayloads.ts');
const countLabels = readSource('src/services/countLabels.ts');
const textFormat = readSource('src/services/textFormat.ts');
const dateValues = readSource('src/services/dateValues.ts');
const dateLabels = sources['src/services/dateLabels.ts'];
const ticketFields = sources['src/services/ticketFields.ts'];
const mergeRequestLabels = sources['src/services/mergeRequestLabels.ts'];
const buildStatus = readSource('src/services/buildStatus.ts');
const regexp = readSource('src/services/regexp.ts');
const pathUtils = readSource('src/services/pathUtils.ts');
const webviewFormat = sources['src/services/webviewFormat.ts'];
const queuePlannerPanelView = sources['src/services/queuePlannerPanelView.ts'];
const operationsReportPanelView = sources['src/services/operationsReportPanelView.ts'];
const dashboardPanelView = sources['src/services/dashboardPanelView.ts'];
const diffPanelView = sources['src/services/diffPanelView.ts'];
const jiraBoardPanelView = sources['src/services/jiraBoardPanelView.ts'];
const agentQualityScore = readSource('src/services/agentQualityScore.ts');
const integrationManifest = readSource('src/services/integrationManifest.ts');
const profileManager = readSource('src/services/profileManager.ts');
const agingAnalyzer = readSource('src/services/agingAnalyzer.ts');
const safetyGate = readSource('src/services/safetyGate.ts');
const trendMetrics = readSource('src/services/trendMetrics.ts');
const dashboardWorklist = readSource('src/services/dashboardWorklist.ts');
const ticketTimeline = readSource('src/services/ticketTimeline.ts');
const ticketPanelView = readSource('src/services/ticketPanelView.ts');
const integrationAdapters = readSource('src/services/integrationAdapters.ts');
const mergeRequestComments = readSource('src/services/mergeRequestComments.ts');
const mergeRequestNotifications = readSource('src/services/mergeRequestNotifications.ts');
const postRunReadiness = readSource('src/services/postRunReadiness.ts');
const ticketFilters = readSource('src/services/ticketFilters.ts');
const reviewWork = readSource('src/services/reviewWork.ts');
const reviewMonitor = readSource('src/services/reviewMonitor.ts');
const reviewNotifications = readSource('src/services/reviewNotifications.ts');
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
const webviewSecurity = sources['src/services/webviewSecurity.ts'];
const webviewMessages = readSource('src/services/webviewMessages.ts');
const webviewRuntimeScript = sources['media/kronos-webview-runtime.js'];
const webviewActionPanelScript = sources['media/kronos-action-panel.js'];
const jiraBoardScript = sources['media/kronos-jira-board.js'];
const operatorPanel = sources['src/services/operatorPanel.ts'];
const promptPanelView = sources['src/services/promptPanelView.ts'];
const recoveryPanelView = sources['src/services/recoveryPanelView.ts'];
const humanReviewPanelView = sources['src/services/humanReviewPanelView.ts'];
const evidencePanelView = sources['src/services/evidencePanelView.ts'];
const cliProbes = readSource('src/services/cliProbes.ts');
const terminalProfiles = readSource('src/services/terminalProfiles.ts');
const stringLists = readSource('src/services/stringLists.ts');
const envValues = readSource('src/services/envValues.ts');
const combinedVerification = readSource('src/services/combinedVerification.ts');
const changedFiles = readSource('src/services/changedFiles.ts');
const sonarCommandPlan = sources['src/services/sonarCommandPlan.ts'];
const sonarReportView = sources['src/services/sonarReportView.ts'];
const agingReportView = sources['src/services/agingReportView.ts'];
const webviewHtml = sources['src/services/webviewHtml.ts'];
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
    && source.includes('{ enableScripts: interactive, localResourceRoots: [] }')
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
  const sharedPanelMatches = [...source.matchAll(new RegExp(`createKronosActionWebviewPanel\\('${panelId}'`, 'g'))];
  if (matches.length + sharedPanelMatches.length !== 1) {
    fail(`${file} must have exactly one ${panelId} webview panel, found ${matches.length + sharedPanelMatches.length}.`);
    return;
  }
  if (sharedPanelMatches.length === 1) {
    if (!source.includes('function createKronosActionWebviewPanel') || !source.includes('kronosScriptableWebviewOptions(extensionUri)')) {
      fail(`${file} ${panelId} must use a shared action panel backed by kronosScriptableWebviewOptions.`);
    }
    return;
  }
  if (!/\bkronosScriptableWebviewOptions\s*\(/.test(matches[0].text)) {
    fail(`${file}:${matches[0].line} ${panelId} must use kronosScriptableWebviewOptions for media-backed scripts.`);
  }
}

assertAbsent(/\bexecSync\b/, 'Use execFileSync instead of execSync.');
assertAbsent(/(^|[^\w.])exec\s*\(/m, 'Use execFile instead of shell-string exec.');
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

for (const requiredIgnore of ['.git/**', '.claude/**', 'node_modules/**', 'scripts/**', 'vscode-user-*/**', 'CLAUDE.md', '*.zip', '*.tgz', '*.log', '.env*', 'out/**/*.map', 'GOOD_TO_GREAT_REVIEW.md', 'HUMAN_FEEDBACK_CHECKLIST.md', 'WINDOWS_FEEDBACK_*.md']) {
  if (!vscodeIgnore.split(/\r?\n/).includes(requiredIgnore)) {
    fail(`.vscodeignore must exclude ${requiredIgnore}`);
  }
}
const extensionUiSource = `${extension}\n${queuePlannerPanelView}\n${operationsReportPanelView}\n${dashboardPanelView}\n${diffPanelView}\n${jiraBoardPanelView}\n${ticketPanelView}\n${jiraBoardScript}`;
const dashboardRendererSafetyMarkers = new Set([
  'id="kronos-jira-board-script"',
  'data-kronos-script-kind="jira-board"',
  'defer src="${escapeAttr(input.scriptUri)}"',
  'id="kronos-jira-ticket-data"',
  'class="kronos-data-payload"',
  'evidenceCount: evidenceRecordCount(t)',
  "import { ticketStringArray, ticketStringField } from './ticketFields'",
  'function ticketAttachments',
  "import { finiteNumberFromUnknown, isRecord, recordEntriesFromUnknown, recordKeysFromUnknown, recordsFromUnknown } from './records'",
  'return recordsFromUnknown(value)',
  'interface TicketAttachmentSummary',
  'interface JiraBoardTicketPayload',
  'const ticketData: Record<string, JiraBoardTicketPayload>',
  'const linkedProjects = ticketStringArray(t.projects)',
  'const attachments = ticketAttachments(t.attachments)',
  'Gate Fails',
  'buildDashboardWorklist',
  'buildDashboardWorklistHtml',
  'Command Center',
  'function dashboardWorkItemActions',
  "actionButton('evidenceGate', 'Gate', { ticket, primary: true })",
  "actionButton('runCenter', 'Run Center', { runId })",
  "actionButton('viewTicket', 'View', { ticket, primary: true })",
  "actionButton('startTicket', 'Start', { ticket })",
  'Rework Rate',
  'Stale Critical',
]);
const serviceOwnedSafetyMarkers = new Set([
  "from './changedFiles'",
  "from './webviewHtml'",
  'const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set',
  'const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>',
  'const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set(OPERATOR_COMMAND_TO_VSCODE_COMMAND.keys())',
  'const EVIDENCE_HANDOFF_OPERATOR_COMMANDS = operatorCommandSet([',
  'const DOCTOR_OPERATOR_COMMANDS = operatorCommandSet([',
  'function operatorCommandSet(commands: string[]): ReadonlySet<string>',
  'export function resolveOperatorCommandRoute(input: OperatorCommandRouteInput): OperatorCommandRoute',
  'export function isTicketOperatorCommand(command: string): boolean',
  'const commandId = OPERATOR_COMMAND_TO_VSCODE_COMMAND.get(input.command)',
  "return { kind: 'missingTicket', commandId }",
  "if ((input.command === 'runCenter' || input.command === 'recoveryCenter') && (input.runId || input.itemId))",
  'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
  "const RECOVERY_MESSAGE_COMMANDS = new Set([\n  'refreshPanel',",
  'const AGING_REPORT_MESSAGE_COMMANDS = new Set',
  "import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './runAttention'",
  'function runQuickPickDescription(run: RunActionRecord)',
  'export const RUN_ACTION_QUICK_PICK_ITEMS',
  'export function buildRunQuickPickItems<T extends RunActionRecord>',
  'description: runQuickPickDescription(run)',
  'function isRetryableRun(run: RunActionRecord): boolean',
  'function isResumableRun(run: RunActionRecord): boolean',
  'export const FINISHED_ARCHIVE_STATUSES',
  'function isFinishedArchiveRun(run: RunActionRecord): boolean',
  'return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok',
  'function resolveRunWorkspace',
  "import { isExistingRealPathInside } from './pathUtils'",
  'isExistingRealPathInside(filePath, RUNS_DIR)',
  'function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult',
  'unknownErrorMessage(e, `Could not inspect run workspace ${candidate}.`)',
  'isCodeAction(target.action)',
  "'(default; Sonar branches unavailable)'",
  'Open Workspace Diff',
  'Mark Needs Human',
  'Retry Saved Prompt',
  'Archive Run',
]);

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
for (const marker of [
  'const trackedTempDirs = new Set();',
  'function makeTempDir(prefix)',
  'test.after(cleanupTrackedTempDirs);',
  "process.once('exit', cleanupTrackedTempDirs);",
  "process.env.KRONOS_DIR = makeTempDir('kronos-home-');",
  "process.env.KRONOS_SCRIPTS_DIR = makeTempDir('kronos-scripts-');",
]) {
  if (!unitTests.includes(marker)) {
    fail(`Missing unit-test temp cleanup marker: ${marker}`);
  }
}
const mkdtempCalls = unitTests.match(/fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\),/g) || [];
if (mkdtempCalls.length !== 1 || !unitTests.includes('fs.mkdtempSync(path.join(os.tmpdir(), prefix))')) {
  fail('Unit tests must create temp dirs through makeTempDir so tracked directories are removed.');
}
if (unitTests.includes("fs.mkdtempSync(path.join(os.tmpdir(), '")) {
  fail('Unit tests must not create untracked kronos temp dirs directly.');
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
    fail(`${file} must use shared webview runtime helpers for webview API acquisition.`);
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
  'buildJiraBoardHtml({',
  'webviewScriptCspOptions(panel.webview.cspSource, nonce)',
  'WEBVIEW_JIRA_BOARD_SCRIPT',
  'function kronosJiraBoardScriptUri',
  "vscode.Uri.joinPath(extensionUri, 'media', scriptFile)",
  'id="kronos-jira-board-script"',
  'data-kronos-script-kind="jira-board"',
  'defer src="${escapeAttr(input.scriptUri)}"',
  'id="kronos-jira-ticket-data"',
  'class="kronos-data-payload"',
  "import { createWebviewReadyMonitor } from './services/webviewDiagnostics'",
  "import { isCodeAction } from './services/actionSemantics'",
  "const logReady = createWebviewReadyMonitor(panel, 'Kronos Jira Board')",
  'logReady.arm();',
  'if (logReady(msg)) { return; }',
  ': { enableScripts: true, localResourceRoots: [] }',
  "createKronosActionWebviewPanel('sonarReport', `Sonar: ${projectName}`, context.extensionUri)",
  'BOARD_MESSAGE_COMMANDS',
  "import { normalizeBoardMessage, normalizeWebviewCommand } from './services/webviewMessages'",
  'const request = normalizeBoardMessage(msg, BOARD_MESSAGE_COMMANDS)',
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
  "from './webviewHtml'",
  'kronos.openExternalUrl',
  'async function confirmSafetyGate',
  'async function removeTicketFromQueue',
  "import { decideQueueRemoval } from './services/queueRemovalPolicy'",
  'const decision = decideQueueRemoval(ticketKey, ticket, interactive)',
  "decision.kind === 'block_failing_gate' || decision.kind === 'block_missing_evidence'",
  "decision.kind === 'confirm_failing_gate'",
  "decision.kind === 'confirm_missing_evidence'",
  "import { unknownErrorCode, unknownErrorMessage } from './services/errorUtils'",
  "import type { DiscoveredProject, QueueItem, Ticket } from './state/types'",
  'function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem',
  'function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void>',
  'return async (_code: number, run: KronosRun)',
  'await refreshAfterDispatch(state, projectName)(code, run)',
  "import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './runAttention'",
  'function runQuickPickDescription(run: RunActionRecord)',
  'export const RUN_ACTION_QUICK_PICK_ITEMS',
  'export function buildRunQuickPickItems<T extends RunActionRecord>',
  'description: runQuickPickDescription(run)',
  'const refreshWarning = await reloadStateAfterDispatch(state, projectName);',
  'run.warnings = [...(run.warnings || []), refreshWarning];',
  'async function reloadStateAfterDispatch(state: KronosState, projectName?: string): Promise<string | undefined>',
  "unknownErrorMessage(e, `Failed to refresh Kronos state after dispatch for ${projectName}.`)",
  'vscode.window.showWarningMessage(refreshWarning);',
  'function warnIfRunStillActive(run: KronosRun, action: \'retry\' | \'resume\'): boolean',
  'function isRetryableRun(run: RunActionRecord): boolean',
  'function isResumableRun(run: RunActionRecord): boolean',
  'return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok',
  "Run ${run.id} is still active. Stop it or let it finish before attempting to ${action}.",
  'async function retryRunFromPrompt(state: KronosState, run: KronosRun)',
  'onComplete: refreshAfterDispatch(state, projectName, ticketKey)',
  'await retryRunFromPrompt(state, run)',
  'async function resumeSelectedRun',
  'function resolveRunWorkspace',
  'async function archiveSelectedRun',
  'async function archiveFinishedRuns',
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
  'resolveRecoveryActionForRequest(item, requestedAction)',
  'function openRecoveryPanel',
  "import { buildTicketHtml } from './services/ticketPanelView'",
  "import { buildDashboardHtml } from './services/dashboardPanelView'",
  "import { buildDiffHtml } from './services/diffPanelView'",
  "import { buildJiraBoardHtml } from './services/jiraBoardPanelView'",
  'buildTicketHtml(ticketKey, freshTicket, {',
  'runs: listRuns()',
  'confirmDispatchCollisions',
  'detectDispatchCollisions',
  'kronos.extractAcceptanceCriteria',
  'extractAcceptanceCriteria',
  'kronos.updateAcceptanceCriteria',
  "from './services/evidenceData'",
  'const existingCriteria = evidenceAcceptanceCriteria(ticket)',
  'const criteria = evidenceAcceptanceCriteria(ticket)',
  'evidenceCount: evidenceRecordCount(t)',
  "import { ticketStringArray, ticketStringField } from './ticketFields'",
  'function ticketAttachments',
  "import { finiteNumberFromUnknown, isRecord, recordEntriesFromUnknown, recordKeysFromUnknown, recordsFromUnknown } from './records'",
  'return recordsFromUnknown(value)',
  'interface TicketAttachmentSummary',
  'interface JiraBoardTicketPayload',
  'const ticketData: Record<string, JiraBoardTicketPayload>',
  'const linkedProjects = ticketStringArray(t.projects)',
  'const attachments = ticketAttachments(t.attachments)',
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
  'export function resolveOperatorCommandRoute(input: OperatorCommandRouteInput): OperatorCommandRoute',
  'export function isTicketOperatorCommand(command: string): boolean',
  'const commandId = OPERATOR_COMMAND_TO_VSCODE_COMMAND.get(input.command)',
  "return { kind: 'missingTicket', commandId }",
  'function attachOperatorCommandHandler(panel: vscode.WebviewPanel, webviewName: string, allowedCommands: ReadonlySet<string>): ReturnType<typeof createWebviewReadyMonitor>',
  'normalizeActionPanelMessage(msg, allowedCommands)',
  "attachOperatorCommandHandler(panel, 'Kronos Evidence Handoff', EVIDENCE_HANDOFF_OPERATOR_COMMANDS)",
  "const logReady = attachOperatorCommandHandler(panel, 'Kronos Doctor', DOCTOR_OPERATOR_COMMANDS)",
  'const route = resolveOperatorCommandRoute({ command, ticketKey, runId, itemId })',
  "vscode.window.showWarningMessage('Ignored unknown Kronos operator action.')",
  'await executeOperatorCommandAction(command, ticketKey)',
  'executeOperatorCommandAction(request.command, request.ticket, request.runId, request.itemId)',
  'await executeHumanReviewAction(state, request.command, request.ticket, request.runId, request.itemId)',
  "await executeOperatorCommandAction(command, '', runId, itemId)",
  "if ((input.command === 'runCenter' || input.command === 'recoveryCenter') && (input.runId || input.itemId))",
  'await vscode.commands.executeCommand(route.commandId, route.argument)',
  "command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner'",
  'kronos.evidenceGate',
  'openEvidenceGatePanel',
  'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
  "if (request.command === 'refreshPanel') {\n        state.reloadAndNotify();\n        render();\n        return;\n      }",
  "openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true, extensionUri: context.extensionUri })",
  'options.refreshAllEvidenceGates',
  'function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[]',
  'panelEvidenceGates(state.state?.tickets)',
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
  "import { REVIEW_SEEN_KEYS_STORAGE_KEY, normalizeReviewSeenKeys, planNewReviewNotification } from './services/reviewNotifications'",
  'function reviewSeenKeysStore(globalState: vscode.Memento): ReviewSeenKeysStore',
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
  'const runStartupSideEffects = () =>',
  'const startupSideEffectsTimer = setTimeout(runStartupSideEffects, 0)',
  "warnUnexpectedPanelIntegrationError(e, 'Kronos startup state notification failed.')",
  "warnUnexpectedPanelIntegrationError(e, 'Kronos startup cleanup check failed.')",
  'vscode.workspace.onDidChangeConfiguration(e =>',
  "e.affectsConfiguration('kronos.pollIntervalSec')",
  "e.affectsConfiguration('kronos.sessionPollIntervalMs')",
  "e.affectsConfiguration('kronos.reviewPollIntervalSec')",
  "import { decideReviewMonitorAction, reviewDeployMonitorActionHandled, reviewMergeRequestNotificationKey, reviewTerminalMergeRequestActionKey, type ReviewDeployMonitorResult, type ReviewMonitorDecision, type ReviewTerminalMergeRequestAction } from './services/reviewMonitor'",
  'const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000',
  "const sessionPollMs = configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000)",
  'const safeIntervalMs = configIntervalMs(intervalMs, 5000)',
  'startBackgroundRefreshPoll(throttledRefresh, configIntervalSecondsMs(config.get<number>(\'pollIntervalSec\', 300), 300, 1))',
  "const pollIntervalMs = configIntervalSecondsMs(config.get<number>('reviewPollIntervalSec', fallbackSec), fallbackSec, 60)",
  'let disposed = false',
  'if (disposed || running) { return; }',
  'await pollReviewMergeRequests(state, () => !disposed)',
  'disposed = true',
  'async function runSettingsMenu(state: KronosState): Promise<void>',
  "type SettingsMenuItemId = 'profile' | 'dispatchModel' | 'pollInterval' | 'sessionPoll' | 'scanDirectories' | 'authCheck'",
  'const pick = await vscode.window.showQuickPick<SettingsMenuItem>',
  'switch (pick.id)',
  "case 'profile':",
  "case 'authCheck':",
  'const exhaustive: never = pick.id',
  'function updatePositiveNumberSetting',
  'parsePositiveNumberInput(input)',
  "console.warn(unknownErrorMessage(e, 'Review MR polling failed.'))",
  'void poll();',
  'function pollReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true)',
  'if (!shouldContinue()) { return; }',
  'state.reloadAndNotify();',
  'await reconcileTerminalReviewMergeRequests(state, shouldContinue);',
  'function reconcileTerminalReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true)',
  'reviewMergeRequestNotifications',
  'gitlabAdapter.mergeRequestStatus',
  'updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status })',
  'const decision = decideReviewMonitorAction(candidate.ticketKey, update)',
  "decision.kind === 'deploy_monitor'",
  'const result = await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket)',
  'if (reviewDeployMonitorActionHandled(result))',
  "decision.kind === 'blocked'",
  'notifyReviewMonitorDecision(decision)',
  'const notificationKey = reviewMergeRequestNotificationKey(candidate.ticketKey, update)',
  'if (reviewMergeRequestNotifications.has(notificationKey)) { continue; }',
  'reviewMergeRequestNotifications.add(notificationKey)',
  'notifyReviewMergeRequestPollFailure(candidate.ticketKey, e)',
  'function notifyReviewMergeRequestPollFailure(ticketKey: string, error: unknown): void',
  'MR status polling failed:',
  'function rememberReviewTerminalMergeRequestAction',
  'reviewTerminalMergeRequestActionKey(update.ticketKey, update.ticket.mr?.iid, update.action)',
  'reviewTerminalMergeRequestActionKey(ticketKey, ticket.mr?.iid, action)',
  'function notifyReviewMonitorDecision(decision: ReviewMonitorDecision): void',
  "const actions = decision.url ? ['Open MR', 'Open Review'] : ['Open Review']",
  "action === 'Open MR' && decision.url",
  'openExternalHttpUrl(decision.url)',
  "import { openReviewTicketEntries, reviewBranchTickets as buildReviewBranchTickets } from './services/reviewWork'",
  'return openReviewTicketEntries(state.state?.tickets)',
  'function reviewBranchTickets(state: KronosState)',
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
  "import { deployMonitorAttentionIssue, deployMonitorHandoffCheckName, hasDeployMonitorHandoffIssue, hasHandledDeployMonitorRun, resolveDeployMonitorProject } from './services/deployMonitorHandoff'",
  'const result = await startDeployMonitorForMergedTicket(state, update.ticketKey, update.ticket)',
  'if (reviewDeployMonitorActionHandled(result)) { reviewTerminalMergeRequestActions.add(actionKey); }',
  "await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey",
  'projectNameOverride: projectName',
  'promptMetadata.mergeRequestIid = mrIid',
  'const currentTicket = state.state?.tickets?.[ticketKey] || ticket',
  'Promise<ReviewDeployMonitorResult>',
  "return 'blocked';",
  "return 'handled';",
  "return 'started';",
  'if (hasDeployMonitorHandoffIssue(currentTicket, reason))',
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
  "import { LIVE_MR_DIFF_TIMEOUT_MS, loadMrFileHints } from './services/mergeRequestFileHints'",
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
  'await executeDashboardAction(state, request, context.extensionUri)',
  'function dashboardWorkItemActions',
  "actionButton('evidenceGate', 'Gate', { ticket, primary: true })",
  "actionButton('runCenter', 'Run Center', { runId })",
  'openInteractiveRunCenter(state, extensionUri, runId || undefined)',
  'await openRecoveryCenter(state, extensionUri, runId || undefined)',
  'await openRecoveryCenter(state, context.extensionUri, resolveRecoveryFocusId(item))',
  'openRecoveryPanel(state, inventory, backups, focusItemId, extensionUri)',
  'resolveRecoveryFocusId,',
  "const RECOVERY_MESSAGE_COMMANDS = new Set([\n  'refreshPanel',",
  'startActiveRunPanelRefresh(panel, state, () => render(true))',
  "if (request.command === 'refreshPanel') {\n      await runWebviewPanelAction(() => render(true), 'Kronos recovery action failed.');\n      return;\n    }",
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
  'planNewReviewNotification(reviewTree.getNewReviewItems(), notifiedReviewKeys)',
  'notifiedReviewKeys.clear()',
  'if (!plan.message) { return; }',
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
  "from './changedFiles'",
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
  'getProjectNameForPath, getProjectPath',
  "from './services/projectSelection'",
  "import { isExistingRealPathInside } from './pathUtils'",
  'isExistingRealPathInside(filePath, RUNS_DIR)',
  'function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult',
  'async function openRunArtifactFileIfExists(filePath: string | undefined, missingMessage: string): Promise<void>',
  'Refusing to open run artifact outside Kronos runs directory.',
  "unknownErrorMessage(e, 'Failed to pause run.')",
  "unknownErrorMessage(e, 'Failed to continue run.')",
  "unknownErrorMessage(e, 'Failed to cancel run.')",
  "unknownErrorMessage(e, 'Failed to open run diff.')",
  "unknownErrorMessage(e, 'Failed to mark run needs-human.')",
  'runRecordPath(run.id)',
  'let resolvedTicketKey = resolveDispatchTicketKey(ticketKey, run)',
  'await reloadStateAfterDispatch(state, projectName)',
  'function resolveDispatchTicketKey(ticketKey: string | undefined, run: KronosRun): string | undefined',
  "import { buildRunCompletionEvidenceCheck, buildRunCompletionEvidenceText, evaluatePostRunReadiness, postRunReadinessRunPatch, resolvePostRunTicket, shouldRecordRunCompletionEvidence } from './services/postRunReadiness'",
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
  'Object.assign(run, postRunReadinessRunPatch(run, run.readiness))',
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
  "operationId: 'restoreBackup'",
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
  "import { buildSonarReport }",
  "import { buildSonarBranchPickItems, buildSonarFixBranchStrategy, buildSonarFixInstructionBlock } from './services/sonarCommandPlan'",
  "import { isRecord, recordEntriesFromUnknown, recordFromUnknown, recordKeysFromUnknown, recordString } from './services/records'",
  "from './services/commandPayloads'",
  'resolveProjectName,',
  'resolveQueueCommandItem,',
  'resolveTicketKey,',
  'panel.webview.onDidReceiveMessage(async (msg: unknown) =>',
  'const branchStrategy = buildSonarFixBranchStrategy(projectName, sourceBranch)',
  'const instructionBlock = buildSonarFixInstructionBlock({',
  "from './services/stateStore'",
  "from './services/integrationAdapters'",
  "from './services/projectMutations'",
]) {
  const safetySource = dashboardRendererSafetyMarkers.has(marker)
    ? extensionUiSource
    : serviceOwnedSafetyMarkers.has(marker)
      ? allSource
      : extension;
  if (!safetySource.includes(marker)) {
    fail(`Missing safety marker: ${marker}`);
  }
}
if (runActionHelpers.includes('function runCountLabel')) {
  fail('runActionHelpers must not keep a wrapper around the shared count label helper.');
}
if (extension.includes('runCountLabel(')) {
  fail('extension should use the shared count label helper directly for archive messages.');
}
if (extension.includes('Number.isFinite' + '(intervalMs)')) {
  fail('Extension polling helpers must use the shared interval config helper.');
}
if (extension.indexOf('const startupSideEffectsTimer = setTimeout(runStartupSideEffects, 0)') < extension.indexOf("vscode.commands.registerCommand('kronos.cleanupWorktrees'")) {
  fail('Kronos startup side effects must be deferred until after command registration.');
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
  "operationId: 'startClaudeDispatch'",
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
  'type ReviewMonitorDecisionKind',
  'interface ReviewMonitorDecision',
  'export function decideReviewMonitorAction',
  'export function reviewMergeRequestNotificationKey',
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
  "import { arrayFromUnknown, optionalTrimmedStringFromUnknown } from './records'",
  "export const REVIEW_SEEN_KEYS_STORAGE_KEY = 'kronos.review.seenKeys.v1'",
  'export function normalizeReviewSeenKeys',
  'for (const item of arrayFromUnknown(value))',
  'const key = optionalTrimmedStringFromUnknown(item)',
  'export function planNewReviewNotification',
  'nextNotifiedKeys',
  'newReviewNotificationMessage',
  'reviewNotificationItemKey',
]) {
  if (!reviewNotifications.includes(marker)) {
    fail(`Missing review notification marker: ${marker}`);
  }
}
for (const marker of [
  'export function resolveDeployMonitorProject',
  "import { projectPathKey } from './pathUtils'",
  "import { isFailedTerminalRunStatus, isFreshActiveRun, isSuccessfulRunStatus } from './runStatus'",
  "import { optionalFiniteNumberFromUnknown } from './records'",
  "import { ticketStringArray } from './ticketFields'",
  'const linkedProjects = [...new Set(ticketStringArray(ticket.projects))]',
  'linkedProjects.length > 1',
  'export function hasHandledDeployMonitorRun',
  'isHandledDeployMonitorRun(run)',
  'isSuccessfulRunStatus(run.status)',
  'isFailedTerminalRunStatus(run.status)',
  'promptMetadataMergeRequestIid',
  'const parsed = optionalFiniteNumberFromUnknown(raw)',
  'if (match.mrIid === undefined) { return true; }',
  'if (runMrIid === undefined) { return false; }',
  'const runKey = projectPathKey(runPath)',
  'const matchKey = projectPathKey(matchPath)',
  'DEPLOY_MONITOR_HANDOFF_CHECK_PREFIX',
  'deployMonitorHandoffIssueSummaries',
  'hasDeployMonitorHandoffIssue',
]) {
  if (!deployMonitorHandoff.includes(marker)) {
    fail(`Missing deploy monitor handoff marker: ${marker}`);
  }
}
if (deployMonitorHandoff.includes('function deployMonitorProjectPathKey')) {
  fail('deployMonitorHandoff must use the shared project path identity helper.');
}
if (deployMonitorHandoff.includes('HANDLED_DEPLOY_MONITOR_STATUSES') || deployMonitorHandoff.includes('ATTENTION_DEPLOY_MONITOR_STATUSES')) {
  fail('deployMonitorHandoff must use shared run status predicates instead of local deploy monitor status sets.');
}
if (deployMonitorHandoff.includes("(ticket.projects || []).filter(project => typeof project === 'string' && project.trim()).map(project => project.trim())")) {
  fail('deployMonitorHandoff must use ticketStringArray for linked project normalization.');
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
  'export interface OperatorDecisionBrief',
  'export function operatorDecisionBrief',
  "export { normalizeActionPanelMessage, type ActionPanelMessage } from './webviewMessages'",
  'export function kronosActionPanelScript',
  'export function kronosOperatorPanelCss',
  '.decision-brief',
  'kronosWebviewBaseCss',
  'webviewActionScriptTag',
  'scriptUri?: string',
  'readyCommand: WEBVIEW_READY_COMMAND',
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

for (const marker of [
  'export interface ActionPanelMessage',
  'export function normalizeActionPanelMessage',
  'export function normalizeWebviewCommand',
  'export function normalizeBoardMessage',
  'export function normalizeRunCenterMessage',
  'const command = normalizeWebviewCommand(raw, allowed)',
  "ticket: recordString(message, 'ticket')",
  "runId: recordString(message, 'runId')",
  "planId: recordString(message, 'planId')",
  "itemId: recordString(message, 'itemId')",
  "recoveryAction: recordString(message, 'recoveryAction')",
]) {
  if (!webviewMessages.includes(marker)) {
    fail(`Missing webview message helper marker: ${marker}`);
  }
}

const boardHandlerStart = extension.indexOf('panel.webview.onDidReceiveMessage(async (msg) => {\n        if (logReady(msg)) { return; }\n        const request = normalizeBoardMessage(msg, BOARD_MESSAGE_COMMANDS);');
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
if (extensionUiSource.includes('addToQueueFromModal')) {
  fail('Jira board modal should use the standard addToQueue command.');
}
if (extensionUiSource.includes('pick.label.includes')) {
  fail('Settings menu routing should use stable item ids, not display labels.');
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
const publishProjectCommandEnd = extension.indexOf("    vscode.commands.registerCommand('kronos.startQueueItem'", publishProjectCommandStart);
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
for (const marker of [
  'projectSetupConfirmation(projectName)',
  'const setupPrompt = buildProjectSetupPrompt({',
]) {
  if (!publishProjectCommandSource.includes(marker)) {
    fail(`Project setup command should use service-owned setup planning: ${marker}`);
  }
}
for (const forbidden of [
  'This will generate CLAUDE.md',
  'Check for existing CLAUDE.md',
  'The CLAUDE.md should document',
]) {
  if (publishProjectCommandSource.includes(forbidden)) {
    fail(`Project setup command should not ask agents to write docs: ${forbidden}`);
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
const runActionEnd = extension.indexOf('function findRunById');
if (runActionStart < 0 || runActionEnd <= runActionStart) {
  fail('Missing extension run action helper block.');
}
const runActionSource = `${extension.slice(runActionStart, runActionEnd)}\n${runActionHelpers}`;
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
  "vscode.commands.registerCommand('kronos.deployMonitor', async (item: unknown) => {\n      const projectName = resolveProjectName(state, item)",
  "vscode.commands.registerCommand('kronos.verifyFix', async (item: unknown) => {\n      const projectName = resolveProjectName(state, item)",
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
  'const projects = ticket.projects || []',
  'const projs: string[] = item.projects || []',
  'const projs = ticket?.projects || []',
  'if (!ticket.projects?.length)',
  'projects: ticket.projects',
  'const current = state.state.tickets[ticketKey]?.projects || []',
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
  'async function pickTicketProjectNameForDispatch(',
  'if (!ticketKey) {\n      return pickProjectName(state, placeHolder);\n    }',
  'ticketProjectNamesForCommand,',
  'buildTicketProjectItems(projects, state.state?.projects)',
  'const projects = buildRegisteredProjectItems(state.state?.projects)',
  'const byProject = groupTicketsByProject(tickets)',
  'buildTicketGroupProjectItems(byProject, countLabel)',
  "import { ticketStringArray } from './services/ticketFields'",
  'const projects = ticketStringArray(ticket.projects)',
  'const projs = ticketStringArray(item.projects)',
  "vscode.commands.registerCommand('kronos.implement', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.deployMonitor', async (item: unknown)",
  'const projectName = await pickTicketProjectNameForDispatch(',
  "handoff: 'manual-deploy-monitor'",
  "const mrIid = ticketKey ? state.state?.tickets?.[ticketKey]?.mr?.iid : undefined",
  'promptMetadata.mergeRequestIid = mrIid',
  'promptMetadata,',
  "vscode.commands.registerCommand('kronos.verifyFix', async (item: unknown)",
  "vscode.commands.registerCommand('kronos.startNext', async () =>",
  'const selection = selectNextQueueItem();',
  "from './services/queueDispatchPlan'",
  'const dispatchPlan = buildQueueDispatchPlan({',
  'queueDispatchMissingProjectMessage({ target: item.ticket || item.id',
  'queueDispatchNoProjectPathMessage(item.ticket)',
  'buildQueueDispatchCollisionTarget({',
  "buildQueueDispatchAppendPrompt({ codeAction, implementPrompt: codeAction ? getImplementPrompt(state) : '' })",
  'dispatchOptions.projectNameOverride = target.projectName',
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
  'pathProject: getProjectNameForPath(state.state?.projects, queueData.projectPath),',
  'const projs = dispatchPlan.projects;',
  'const projLabel = dispatchPlan.projectLabel;',
  'if (projs.length === 0 && !dispatchPlan.directProjectPath)',
  'dispatchPlan.dispatchTargets',
  'dispatchPlan.missingProjects',
  'queueDispatchMissingProjectMessage({ target: queueData.ticket || queueData.id',
  'queueDispatchNoProjectPathMessage(queueData.ticket)',
  'const collisionTarget = buildQueueDispatchCollisionTarget({',
  'const extraPrompt = buildQueueDispatchExtraPrompt(extra)',
  'const scopeHint = buildQueueDispatchScopeHint(target, projs)',
  'if (target.projectName) { dispatchOptions.projectNameOverride = target.projectName; }',
  'const idx = resolveQueueIndex(treeItem);',
  'await startClaudeDispatch(target.projectPath, skill, queueData.ticket || undefined,',
  "const branch = mode.value === 'new' ? (stringFromUnknown(commandArg['branch']) || baseBranch) : '';",
  "const sourceBranch = stringFromUnknown(commandArg['sourceBranch']) || '';",
  "projectName = await pickProjectName(state, 'Run SonarQube scan for which project?');",
  "projectName = await pickProjectName(state, 'Open SonarQube report for which project?');",
  "projectName = await pickProjectName(state, 'Fix SonarQube issues in which project?');",
  "projectName = await pickProjectName(state, 'Fix verification finding in which project?');",
  'let projectName = resolveProjectName(state, args);',
  "const projectPath = stringFromUnknown(commandArg['projectPath']) || getProjectPath(state.state?.projects, projectName);",
  'let projectName = resolveProjectName(state, item);',
  'const projs = ticketStringArray(ticket?.projects)',
  'let orphanKey = resolveTicketKey(treeItem);',
  'orphanKey = await pickOrphanMergeRequestTicket(state.state);',
  'async function pickOrphanMergeRequestTicket(state: KronosStateSnapshot): Promise<string | undefined>',
  'const url = resolveMergeRequestUrl(treeItem);',
  'const ticketKey = resolveTicketKey(ticketKeyOrItem);',
  "const projectName = stringFromUnknown(recordFromUnknown(item)['linkedProject']);",
]) {
  if (!extension.includes(marker)) {
    fail(`Extension dispatch command must keep tree payloads unknown: ${marker}`);
  }
}
for (const marker of [
  "import { optionalTrimmedStringFromUnknown, recordFromUnknown } from './records'",
  "import { ticketStringArray } from './ticketFields'",
  'export interface QueueCommandPayload',
  'export function resolveProjectName',
  "const ticket = recordFromUnknown(record['ticket'])",
  "const projectName = stringFromUnknown(record['projectName'])",
  "const firstTicketProject = ticketStringArray(ticket['projects'])[0]",
  "const firstStateProject = ticketStringArray(t?.projects)[0]",
  'export function resolveTicketKey',
  "const nestedItem = recordFromUnknown(record['item'])",
  'export function resolveQueueCommandItem',
  'export function queueCommandPayloadFromRecord',
  'return [...new Set(ticketStringArray(value))]',
  "const projects = ticketStringArray(record['projects'])",
  'export function resolveQueueIndex',
  "typeof index === 'number' && Number.isInteger(index) && index >= 0",
  'export function stringFromUnknown',
  'return optionalTrimmedStringFromUnknown(value)',
  'export function resolveMergeRequestUrl',
  'export function resolveTaskId',
  'export function resolveRecoveryFocusId',
  'export function ticketProjectNamesForCommand',
  'export function uniqueProjectNames',
]) {
  if (!commandPayloads.includes(marker)) {
    fail(`Missing command payload helper marker: ${marker}`);
  }
}
for (const forbidden of [
  "import { arrayFromUnknown, recordFromUnknown } from './records'",
  "Array.isArray(record['projects'])",
  'if (!Array.isArray(value)) { return []; }',
  "recordFromUnknown(recordFromUnknown(item)['ticket'])",
  "recordFromUnknown(recordFromUnknown(item)['item'])",
  'function projectNames(value: unknown): string[]',
  't?.projects?.length',
  'return arrayFromUnknown(value)',
]) {
  if (commandPayloads.includes(forbidden)) {
    fail(`Command payload helpers must use shared normalizers instead of ${forbidden}`);
  }
}
for (const marker of [
  'export function buildRegisteredProjectItems',
  'export function buildTicketProjectItems',
  'export function groupTicketsByProject',
  'export function buildTicketGroupProjectItems',
  'export function getProjectPath',
  'export function getProjectNameForPath',
  "import { projectPathKey } from './pathUtils'",
]) {
  if (!projectSelection.includes(marker)) {
    fail(`Missing project selection helper marker: ${marker}`);
  }
}
for (const marker of [
  'export interface QueueDispatchTarget',
  'export interface QueueDispatchPlan',
  'export interface QueueDispatchCollisionTarget',
  'export function buildQueueDispatchPlan',
  'export function queueDispatchMissingProjectMessage',
  'export function queueDispatchNoProjectPathMessage',
  'export function buildQueueDispatchCollisionTarget',
  'export function buildQueueDispatchExtraPrompt',
  'export function buildQueueDispatchScopeHint',
  'export function buildQueueDispatchAppendPrompt',
  'directProjectPath',
  'missingProjects',
]) {
  if (!queueDispatchPlan.includes(marker)) {
    fail(`Missing queue dispatch plan marker: ${marker}`);
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
  'interface RecoveryTicket',
  "import { DoctorAttentionCheck, doctorCheckAttentionId, doctorCheckAttentionSeverity, doctorCheckNeedsAttention } from './doctorAttention'",
  'export interface RecoveryCheck extends DoctorAttentionCheck',
  'doctorCheckNeedsAttention(check)',
  'doctorCheckAttentionId(check)',
  'doctorCheckAttentionSeverity(check)',
  'runStoreIssues',
  'recoveryItemForRunStoreIssue',
  'Invalid ${scopeLabel} run record',
  'registryIssue',
  'recoveryItemForWorktreeRegistryIssue',
  'Active worktree registry needs manual review',
  'recoveryItemForOrphanMergeRequest',
  'export function resolveRecoveryActionForRequest',
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
if (recoveryCenter.includes("check.status === 'fail' ? 'critical' : 'warning'")) {
  fail('Recovery center must use shared Doctor check severity helper.');
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
  "import { countLabel } from './countLabels'",
  "countLabel(events.length, 'event')",
  'recoveryActionLabel',
  'kronosOperatorPanelCss',
  "kronosActionPanelScript(nonce, 'Kronos Recovery Center', actionScriptUri)",
]) {
  if (!recoveryPanelView.includes(marker)) {
    fail(`Missing recovery panel view marker: ${marker}`);
  }
}
if (recoveryPanelView.includes('event(s)')) {
  fail('Recovery panel view must use the shared count label helper for event counts.');
}

for (const marker of [
  'export function buildHumanReviewInboxHtml',
  'interface HumanReviewInboxHtmlOptions',
  'Kronos Human Review Inbox',
  'operatorDecisionBrief',
  'function humanReviewBrief',
  'function humanReviewNextStep',
  'humanReviewActionButtons',
  "import { ticketStringArray } from './ticketFields'",
  'const hasLinkedProject = ticketStringArray(ticket?.projects).length > 0',
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
if (humanReviewPanelView.includes('ticket?.projects?.length')) {
  fail('Human review panel must normalize linked project checks through ticketStringArray.');
}

for (const marker of [
  'export function buildEvidenceGateHtml',
  'export function buildEvidenceHandoffHtml',
  'export function buildEvidencePublishHtml',
  'Evidence Handoff:',
  'Evidence Publish:',
  'Kronos Evidence Gate',
  'operatorDecisionBrief',
  'function evidenceGateBrief',
  'function evidenceGateNextStep',
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
  "kronosActionPanelScript(nonce, 'Kronos Evidence Gate', actionScriptUri)",
]) {
  if (!evidencePanelView.includes(marker)) {
    fail(`Missing evidence panel view marker: ${marker}`);
  }
}
if (humanReviewPanelView.includes('.decision-brief {') || evidencePanelView.includes('.decision-brief {')) {
  fail('Decision brief CSS must stay in the shared operator panel helper.');
}

for (const marker of [
  'export function buildTicketHtml',
  'export function buildTicketGateHtml',
  'export function buildTicketTimelineHtml',
  'interface TicketPanelRenderInput',
  'queue?: QueueState | null',
  'runs?: TicketTimelineRuns',
  "import { mergeRequestCommentsFromRecord } from './mergeRequestComments'",
  "import { ticketStringArray, ticketStringField } from './ticketFields'",
  'const timeline = buildTicketTimeline({',
  '...(input.runs !== undefined ? { runs: input.runs } : {})',
  'const projectList = ticketStringArray(ticket.projects)',
  'const mr = ticket.mr',
  'const build = ticket.build',
  'const comments = mergeRequestCommentsFromRecord(mr).slice(-5).reverse()',
  'class="mr-comments"',
  "const discussionCount = ticketStringField(mr, 'discussion_count')",
  'Discussions: ${esc(discussionCount ||',
  'const notes = evidenceNotes(ticket)',
  'const checks = evidenceChecks(ticket)',
  'const environmentResults = evidenceEnvironmentResults(ticket)',
  'safeHttpHref',
  "kronosActionPanelScript(input.nonce, 'Kronos Ticket Detail', input.actionScriptUri)",
]) {
  if (!ticketPanelView.includes(marker)) {
    fail(`Missing ticket panel view marker: ${marker}`);
  }
}
if (ticketPanelView.includes('function mergeRequestComments')) {
  fail('Ticket panel view must not carry local merge request comment normalization.');
}
for (const [name, source] of [
  ['src/services/jiraBoardPanelView.ts', jiraBoardPanelView],
  ['src/services/ticketPanelView.ts', ticketPanelView],
]) {
  if (!source.includes("import { ticketStringArray, ticketStringField } from './ticketFields'")) {
    fail(`${name} must import shared ticket field helpers.`);
  }
  if (source.includes('function ticketStringField') || source.includes('function ticketStringArray')) {
    fail(`${name} must not carry local ticket field helpers.`);
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
  'function formatStatus',
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
  "post(t.isQueued ? 'removeFromQueue' : 'addToQueue'",
  "unknownErrorMessage(e, 'Failed to link ticket.')",
  "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  "unknownErrorMessage(e, 'Failed to add ticket to queue.')",
  'class="kronos-shell board-shell"',
  'class="kronos-shell dashboard-shell"',
  'dashboard-operator-brief',
  'function buildDashboardOperatorBrief',
  'function dashboardBriefFact',
  'let data: unknown = {}',
  'let loadWarning: string | undefined',
  "loadWarning = warnUnexpectedPanelIntegrationError(e, 'Morning brief unavailable.')",
  "createKronosActionWebviewPanel('kronosDashboard', 'Kronos Dashboard', context.extensionUri)",
  'buildDashboardHtml({',
  "kronosActionPanelScript(input.nonce, 'Kronos Dashboard', input.actionScriptUri)",
  "function openAgingReportPanel(state: KronosState, extensionUri?: vscode.Uri)",
  "kronosActionPanelScript(nonce, 'Kronos Aging Report', actionScriptUri)",
  'Morning brief unavailable',
  'dashboard-warning',
  'class="kronos-shell ticket-shell"',
  'class="kronos-shell diff-shell"',
  'const safeBrief = recordFromUnknown(input.brief)',
  'function dashboardBriefItems',
  'function dashboardBriefCount',
  'return finiteNumberFromUnknown(brief[key])',
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
for (const forbidden of [
  "linkTicketToProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
  "unlinkTicketFromProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
  "const result = addTicketToQueue(ticket);\n              state.reloadAndNotify();\n              renderBoard();",
  "await removeTicketFromQueue(state, ticket, true, context.extensionUri);\n            renderBoard();",
]) {
  if (extension.includes(forbidden)) {
    fail('Jira board mutations must rely on the single final renderBoard call.');
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
  "import { countLabel } from './countLabels'",
  "countLabel(template.variables.length, 'variable')",
  'kronosOperatorPanelCss',
  'actionScriptUri?: string',
  "kronosActionPanelScript(nonce, 'Kronos Prompt Manager', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Prompt History', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Prompt Smoke Tests', actionScriptUri)",
]) {
  if (!promptPanelView.includes(marker)) {
    fail(`Missing prompt panel view marker: ${marker}`);
  }
}
if (promptPanelView.includes('variable(s)')) {
  fail('Prompt panel view must use the shared count label helper for variable counts.');
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
  'function markRunRecovery(runId: string, reason: string, now: Date, mutation: RunRecoveryMutation): RunRecord',
  'mark-needs-human',
  'cancel-run',
  'pause-run',
  'continue-run',
  "fallbackFailureKind: 'unknown'",
  "failureKind: 'cancelled'",
  'run.failureKind = run.failureKind || mutation.fallbackFailureKind',
  "type RunRecoveryAction = NonNullable<RunRecord['recoveryActions']>[number]",
  "type RunStoreEvent = NonNullable<RunRecord['events']>[number]",
  'function appendRunRecoveryAction(run: RunRecord, action: RunRecoveryAction): void',
  'function appendRunEvent(run: RunRecord, event: RunStoreEvent, options: { copyExisting?: boolean } = {}): void',
  'appendRunRecoveryAction(run, { at, action: mutation.action, reason: detail })',
  "appendRunEvent(run, { type: 'recovery', label: mutation.label, detail, timestamp: at })",
  'copyExisting ? [...events] : events',
  "import { unknownErrorCode, unknownErrorMessage } from './errorUtils'",
  'catch (e: unknown)',
  "unknownErrorMessage(e, 'Unable to parse JSON.')",
  'writeTextAtomic(promptPath, prompt)',
  'const ARCHIVED_RUNS_DIR',
  'function archivedRunRecordPath',
  "safeFileStem(runId, { fallback: 'run' })",
  'Refusing to append run log outside active runs directory',
  'function moveRunArtifactIfExists',
  "import { isExistingRealPathInside, isPathInside } from './pathUtils'",
  'function isWritableActiveRunLogPath',
  'function isExistingActiveRunPath',
  'function isExistingArchivedRunPath',
  'function isActiveRunPath',
  'isExistingRealPathInside(filePath, RUNS_DIR)',
  'isExistingRealPathInside(filePath, ARCHIVED_RUNS_DIR)',
  'outside active runs directory',
  'run.archiveWarnings = warnings',
  "import { effectiveRunStatus, isActiveRunStatus, isStaleActiveRun, numericPid } from './runStatus'",
  "import { toValidDate } from './dateValues'",
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
for (const staleMarker of [
  'run.recoveryActions.push({ at, action: mutation.action, reason: detail })',
  "run.events.push({ type: 'recovery', label: mutation.label, detail, timestamp: at })",
  'normalized.events = Array.isArray(normalized.events) ? [...normalized.events] : []',
]) {
  if (runStore.includes(staleMarker)) {
    fail(`Run store must use shared append helpers instead of ${staleMarker}.`);
  }
}
for (const marker of [
  'export const ARCHIVED_RUNS_DIR',
  'export function archivedRunRecordPath',
  'export function readRuns',
]) {
  if (runStore.includes(marker)) {
    fail(`Run store archive path helper should stay private: ${marker}`);
  }
}
if (runStore.includes('function normalizeRunFile')) {
  fail('Run store reads must not persist terminal-active repairs through normalizeRunFile.');
}
if (runStore.includes('[key: string]: any')) {
  fail('Run store records must keep extension fields unknown, not any.');
}
if (runStore.includes('function numericPid(value: unknown): number | undefined')) {
  fail('Run store must use the shared runStatus numericPid helper.');
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
  'interface RunBranchMetadata',
  'interface RunPermissionMetadata',
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
  'function addRunEventBestEffort',
  'function updateRunBestEffort',
  "addRunEventBestEffort(run, finalEvent, 'Failed to persist terminal run event.')",
  "updateRunBestEffort(run, finalPatch, 'Failed to persist terminal run status.')",
  "addRunEventBestEffort(run, event, 'Failed to persist worktree cleanup warning event.')",
  "'Failed to persist worktree cleanup blocked status.'",
  'onComplete?: (code: number, run: KronosRun) => void | Promise<void>',
  'async function runCompletionCallback',
  'await opts.onComplete(code, run)',
  "unknownErrorMessage(e, 'Post-run completion callback failed.')",
  "label: 'Post-run completion callback failed'",
  "addRunEventBestEffort(run, event, 'Failed to persist post-run callback failure event.')",
  "'Failed to persist post-run callback failure status.'",
  "const nextStatus = run.status === 'completed' || run.status === 'waiting_for_review' ? 'needs_human' : run.status",
  'function renderProgressPanel(panel: vscode.WebviewPanel, project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun): void',
  'renderProgressPanel(context.panel, context.projectName, context.skill, context.ticket, context.events, run)',
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
  "import { buildRunOperatorSummary, type RunOperatorSummary, type RunOperatorTone } from '../services/runOperatorSummary'",
  "import { isAttentionRunStatus, runAttentionDetail } from '../services/runAttention'",
  "function buildProgressHtml(project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun)",
  'const attentionDetail = run && isAttentionRunStatus(run.status) ? runAttentionDetail(run) :',
  'attention-banner',
  '<strong>Needs Attention</strong>',
  "renderProgressPanel(panel, projectName, skill, ticket || '', events, run)",
  'WEBVIEW_ACTION_PANEL_SCRIPT',
  "'refreshPanel'",
  "'archiveFinishedRuns'",
  'pollIntervalMs?: number',
  'extensionUri?: vscode.Uri | undefined',
  'localResourceRoots: [vscode.Uri.joinPath(options.extensionUri,',
  'const pollTimer = setInterval',
  'panel.onDidDispose(() => clearInterval(pollTimer))',
  "import { createWebviewReadyMonitor } from '../services/webviewDiagnostics'",
  "const logReady = interactive ? createWebviewReadyMonitor(panel, 'Kronos Run Center') : undefined",
  'logReady?.arm()',
  'if (logReady?.(msg)) { return; }',
  "import { normalizeRunCenterMessage, type RunCenterActionRequest } from '../services/webviewMessages'",
  "export type { RunCenterActionRequest } from '../services/webviewMessages'",
  'const RUN_CENTER_RUNLESS_MESSAGE_COMMANDS = new Set',
  'normalizeRunCenterMessage(msg, RUN_CENTER_MESSAGE_COMMANDS, RUN_CENTER_RUNLESS_MESSAGE_COMMANDS)',
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
  "import { toValidDate } from '../services/dateValues'",
  "import { formatDateTimeLabel, formatTimeLabel } from '../services/dateLabels'",
  'function progressDateOr',
  'formatTimeLabel(e.timestamp)',
  "formatDateTimeLabel(run.startedAt, 'Unknown')",
  'function stringOrDefault',
  "import { arrayFromUnknown, isRecord, recordEntriesFromUnknown, recordFromUnknown } from '../services/records'",
  'function streamString(value: unknown): string',
  'export function parseStreamEvents(event: unknown): ProgressEvent[]',
  'function parseAssistantContentBlock(rawBlock: unknown, now: Date): ProgressEvent | null',
  'const payload = isRecord(event) ? event : {}',
  "const message = recordFromUnknown(payload['message'])",
  "return arrayFromUnknown(message['content'])",
  "const input = recordFromUnknown(block['input'])",
  'for (const pe of parseStreamEvents(JSON.parse(trimmed)))',
  'export function computeStats(events: ProgressEvent[]): SessionStats',
  'function lastProgressTerminalEvent(events: ProgressEvent[]): ProgressEvent | undefined',
  "export function progressStatusPresentation(events: ProgressEvent[], run?: Pick<KronosRun, 'status'>)",
  'const statusPresentation = progressStatusPresentation(events, run)',
  "statusText: 'Needs Attention'",
  'const sessionStart = progressDateOr(session.startedAt, new Date())',
  'timestamp: progressDateOr(e.timestamp, sessionStart)',
  'const progress = runProgressSummary({ events })',
  'const operatorSummary = buildRunOperatorSummary(summaryRun)',
  'Automatic run summary',
  'function renderRunOperatorFacts(summary: RunOperatorSummary)',
  'durationSec: progress.elapsedSeconds',
  'Duration: ${progress.elapsedSeconds}s',
  'const statusClass = escapeClass(status)',
  "const started = formatDateTimeLabel(run.startedAt, 'Unknown')",
  'const runEvents = arrayFromUnknown(run.events)',
  'const lastEvent = runEvents.length ? recordFromUnknown(runEvents[runEvents.length - 1]) : undefined',
  'const missingVariables = arrayFromUnknown(rawMissingVariables).map(String)',
  'const operatorSummary = buildRunOperatorSummary(run)',
  'buildRunCenterOperatorBoard',
  'class="progress-cell outcome-cell',
  '<th>Progress</th>',
  'class="progress-cell outcome-cell',
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
for (const staleMarker of [
  'function recordField(record: Record<string, unknown>, key: string): Record<string, unknown>',
  'function arrayField(record: Record<string, unknown>, key: string): unknown[]',
  "arrayField(message, 'content')",
  'const runEvents = Array.isArray(run.events) ? run.events : []',
  'const missingVariables = Array.isArray(rawMissingVariables) ? rawMissingVariables.map(String) : []',
]) {
  if (dispatcher.includes(staleMarker)) {
    fail(`Dispatcher must use shared record/array helpers instead of ${staleMarker}.`);
  }
}
if (dispatcher.includes('function progressEventTimeLabel') || dispatcher.includes('function progressDateTimeLabel')) {
  fail('Dispatcher should use shared date label helpers directly instead of private progress date wrappers.');
}
for (const marker of [
  'export interface RunBranchMetadata',
  'export interface RunPermissionMetadata',
]) {
  if (dispatcher.includes(marker)) {
    fail(`Run metadata helper type should stay private: ${marker}`);
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
  'function compareRunCenterRuns',
  'function runCenterStatusPriority',
  'function runCenterSortTimestamp',
  'if (status === \'failed\' || status === \'cancelled\') { return 5; }',
  'return 4;',
]) {
  if (!runCenterSort.includes(marker)) {
    fail(`Missing run center sort marker: ${marker}`);
  }
}

for (const marker of [
  'interface SessionStoreIssue',
  'export function listSessionStoreIssues',
  'export function listSavedSessions',
  'export function writeSavedSession',
  'interface SavedSessionEvent',
  'interface AggregateStats',
  'function normalizeSavedSessionEvents',
  'recordsFromUnknown(value)',
  'function normalizeSavedSessionEvent',
  'function normalizeAggregateSessions',
  'function normalizeAggregateSession',
  "toolCalls: finiteNumberFromUnknown(value['toolCalls'])",
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
if (!sessionStore.includes("import { finiteNumberFromUnknown, isRecord, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records'")) {
  fail('Session store must import the shared record-list normalizer.');
}
if (sessionStore.includes('if (!Array.isArray(value)) { return []; }')) {
  fail('Session store normalizers must use recordsFromUnknown instead of local array guards.');
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
  'export function parseStreamEvent(',
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
  "import { isRecord, optionalTrimmedStringFromUnknown } from './records'",
  "import { ticketStringArray } from './ticketFields'",
  'if (!isRecord(value)) { return null; }',
  "const body = optionalTrimmedStringFromUnknown(value['body'])",
  'for (const project of ticketStringArray(orphan.projects))',
  'function mutateState',
  "writeJsonFileAtomic(STATE_FILE, state, action)",
  'validateStateFileShape(state)',
]) {
  if (!ticketMutations.includes(marker)) {
    fail(`Missing ticket mutation marker: ${marker}`);
  }
}
if (ticketMutations.includes('function optionalTrim(value: string | undefined): string | undefined')) {
  fail('Ticket mutations must use the shared optional trimmed string helper.');
}
if (ticketMutations.includes('for (const project of orphan.projects || [])')) {
  fail('Ticket MR linking must normalize orphan project links through ticketStringArray.');
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
  "import { finiteNumberFromUnknown, recordFromUnknown } from './records'",
  "import { ticketStringArray } from './ticketFields'",
  'function queueString(value: unknown): string',
  'function queueNullableString(value: unknown): string | null',
  'const current = ticketStringArray(ticket.projects)',
  'const projects = ticketStringArray(ticket.projects)',
  "projects: ticketStringArray(record['projects'])",
  "priority_score: finiteNumberFromUnknown(record['priority_score'])",
]) {
  if (!queueMutations.includes(marker)) {
    fail(`Missing queue mutation marker: ${marker}`);
  }
}
if (queueMutations.includes('function normalizeQueueItem(item: any): QueueItem')) {
  fail('Queue mutation normalization must accept unknown raw queue items.');
}
if (queueMutations.includes('return Array.isArray(value) ? value.map(queueString).filter(Boolean) : []')) {
  fail('Queue mutation string-array normalization must use the shared array fallback helper.');
}
if (queueMutations.includes('const current = Array.isArray(ticket.projects) ? ticket.projects : []')) {
  fail('Queue ticket project mutations must use the shared ticket string-array helper.');
}
if (queueMutations.includes('const projects = ticket.projects || []')) {
  fail('Queue fallback item creation must normalize ticket projects before resolving paths.');
}
if (queueMutations.includes('function queueStringArray')) {
  fail('Queue mutations must use the shared ticket string-array helper.');
}

for (const marker of [
  'export function setProjectConfigValue',
  'export function setProjectIntegrationConfig',
  'export function writeProjectSetupConfig',
  'export function removeProject',
  'export function setScanDirs',
  "import { ticketStringArray } from './ticketFields'",
  'const projects = ticketStringArray(ticket.projects)',
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
if (projectMutations.includes('ticket.projects?.includes(projectName)')) {
  fail('Project removal must normalize ticket project links through ticketStringArray.');
}
for (const marker of [
  'export function projectSetupConfirmation',
  'export function buildProjectSetupPrompt',
  'Do not create or edit CLAUDE.md or other documentation files',
  'Do NOT touch .claude/project.json',
]) {
  if (!projectSetupPlan.includes(marker)) {
    fail(`Missing project setup plan marker: ${marker}`);
  }
}
for (const forbidden of [
  'generate CLAUDE.md',
  'update it, or create one if missing',
  'The CLAUDE.md should document',
]) {
  if (projectSetupPlan.includes(forbidden)) {
    fail(`Project setup plan should not ask agents to write docs: ${forbidden}`);
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
  'class KronosScriptMissingError extends Error',
  'export function isKronosScriptMissingError(error: unknown): boolean',
  'export function runKronosStateScript',
  'export function runGitlabJson',
  'export function runPipelineJson',
  'export function requiredScripts',
  'function pythonCandidateAvailable(candidate: string): boolean',
  "import { parseJsonWithLabel } from './jsonFiles'",
  "import { definedValues } from './records'",
  "const candidates = definedValues([process.env['PYTHON'], 'python', 'python3'])",
  "return parseJsonWithLabel<T>(raw, `${scriptName} ${args.join(' ')}`, { includePreview: true })",
  'Kronos integration script unavailable:',
]) {
  if (!scriptClient.includes(marker)) {
    fail(`Missing script client marker: ${marker}`);
  }
}
if (scriptClient.includes('} catch {}')) {
  fail('Script client must not silently swallow Python discovery failures.');
}
if (scriptClient.includes('export class KronosScriptMissingError')) {
  fail('KronosScriptMissingError should stay private behind isKronosScriptMissingError.');
}

for (const marker of [
  'export {',
  'isActionCode as isCodeAction',
  'isActionProofSensitive as isProofSensitiveAction',
  'isActionProofSensitive as isReviewReadyAction',
  'isActionProofSensitive as isHandoffAction',
  "} from './actionCatalog';",
]) {
  if (!actionSemantics.includes(marker)) {
    fail(`Missing action semantics marker: ${marker}`);
  }
}
if (actionSemantics.includes('export function')) {
  fail('Action semantics should stay a re-export layer over actionCatalog.');
}

for (const marker of [
  "export type RankedSeverity = 'critical' | 'high' | 'warning' | 'medium' | 'info' | 'low'",
  "export type SeveritySummary = Record<'critical' | 'warning' | 'info', number> & { total: number }",
  'export function severityRank(severity: RankedSeverity): number',
  'export function severitySummary(items: Array<{ severity: RankedSeverity }>): SeveritySummary',
  "severity === 'critical' || severity === 'high'",
  "severity === 'warning' || severity === 'medium'",
]) {
  if (!severityRank.includes(marker)) {
    fail(`Missing severity rank marker: ${marker}`);
  }
}
for (const marker of [
  'export interface DoctorAttentionCheck',
  'export function doctorCheckNeedsAttention(check: DoctorAttentionCheck): boolean',
  'export function doctorCheckAttentionId(check: DoctorAttentionCheck): string',
  "return `integration:${check.name}`",
  "export function doctorCheckAttentionSeverity(check: DoctorAttentionCheck): 'critical' | 'warning'",
]) {
  if (!doctorAttention.includes(marker)) {
    fail(`Missing Doctor attention marker: ${marker}`);
  }
}
for (const [name, source] of [
  ['src/services/humanReviewInbox.ts', humanReviewInbox],
  ['src/services/collisionDetector.ts', collisionDetector],
  ['src/services/agingAnalyzer.ts', agingAnalyzer],
  ['src/services/recoveryCenter.ts', recoveryCenter],
  ['src/services/queuePlanner.ts', queuePlanner],
]) {
  if (!source.includes("from './severityRank'")) {
    fail(`${name} must use shared severity helpers.`);
  }
  if (source.includes('function severityWeight')) {
    fail(`${name} must not carry local severityWeight helper.`);
  }
}
for (const [name, source, marker] of [
  ['src/services/humanReviewInbox.ts', humanReviewInbox, 'summary: severitySummary(sorted)'],
  ['src/services/agingAnalyzer.ts', agingAnalyzer, 'summary: severitySummary(sorted)'],
  ['src/services/recoveryCenter.ts', recoveryCenter, 'summary: severitySummary(items)'],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must use shared severity summary helper.`);
  }
  if (source.includes(".filter(i => i.severity === 'critical')") || source.includes(".filter(item => item.severity === 'critical')")) {
    fail(`${name} must not count severity summaries with repeated local filters.`);
  }
}

for (const marker of [
  'export function isRecord(value: unknown): value is Record<string, unknown>',
  'export function recordFromUnknown(value: unknown): Record<string, unknown>',
  'export function arrayFromUnknown(value: unknown): unknown[]',
  'export function definedValues<T>(values: Array<T | null | undefined>): T[]',
  'export function trimmedStringFromUnknown(value: unknown, fallback = \'\'): string',
  'export function optionalTrimmedStringFromUnknown(value: unknown): string | undefined',
  'export function optionalFiniteNumberFromUnknown(value: unknown): number | undefined',
  'export function finiteNumberFromUnknown(value: unknown, fallback = 0): number',
  'export function recordsFromUnknown(value: unknown): Record<string, unknown>[]',
  'export function recordEntriesFromUnknown<T>(value: Record<string, T> | null | undefined): Array<[string, T]>',
  'export function recordKeysFromUnknown(value: unknown): string[]',
  'export function recordValuesFromUnknown(value: unknown): Record<string, unknown>[]',
  'export function recordString(record: Record<string, unknown>, key: string): string',
  'return isRecord(value) ? value : {}',
  'return Array.isArray(value) ? value : []',
  'value !== undefined && value !== null',
  "if (typeof value === 'number')",
  "if (typeof value !== 'string' || !value.trim())",
  'const parsed = Number(value)',
  'return Number.isFinite(parsed) ? parsed : undefined',
  'return optionalFiniteNumberFromUnknown(value) ?? fallback',
  'return arrayFromUnknown(value).filter(isRecord)',
  'return isRecord(value) ? Object.entries(value) : []',
  'return isRecord(value) ? Object.keys(value) : []',
  'return isRecord(value) ? Object.values(value).filter(isRecord) : []',
  "typeof value === 'object'",
  '!Array.isArray(value)',
  "typeof value === 'string' ? value.trim() : fallback",
  'return trimmed || undefined',
]) {
  if (!records.includes(marker)) {
    fail(`Missing record helper marker: ${marker}`);
  }
}

for (const marker of [
  "import { arrayFromUnknown, trimmedStringFromUnknown } from './records'",
  'export function ticketStringField(record: object | null | undefined, key: string, fallback = \'\'): string',
  'Reflect.get(record, key)',
  'export function ticketStringArray(value: unknown): string[]',
  'return arrayFromUnknown(value).map(item => trimmedStringFromUnknown(item)).filter(Boolean)',
]) {
  if (!ticketFields.includes(marker)) {
    fail(`Missing ticket field helper marker: ${marker}`);
  }
}
if (ticketFields.includes('return Array.isArray(value)')) {
  fail('Ticket field string-array normalization must use the shared array fallback helper.');
}

for (const marker of [
  "import { optionalFiniteNumberFromUnknown } from './records'",
  'export function countLabel(count: number, singular: string, plural = `${singular}s`): string',
  'export function nonZeroCountLabel(count: unknown, singular: string, plural = `${singular}s`): string',
  'const parsed = optionalFiniteNumberFromUnknown(count)',
  "return safeCount === 0 ? '' : countLabel(safeCount, singular, plural)",
]) {
  if (!countLabels.includes(marker)) {
    fail(`Missing count label helper marker: ${marker}`);
  }
}
for (const marker of [
  "countLabel(cleanupPreview.results.length, 'tracked worktree')",
  "countLabel(registered, 'project')",
  "countLabel(existingCount, 'acceptance criterion item')",
  "countLabel(result.ticketsUnlinked.length, 'ticket')",
  "countLabel(tickets.length, 'merged ticket')",
  "countLabel(issues.length, 'saved session store issue')",
  "countLabel(preview.removable, 'clean tracked Kronos worktree')",
  "countLabel(missing.length, 'missing required prompt template file')",
  "countLabel(planWindow.plans.length, 'action')",
  "countLabel(plans.length, 'linked implementation/build candidate')",
]) {
  if (!extension.includes(marker)) {
    fail(`Missing extension count label marker: ${marker}`);
  }
}
for (const forbidden of [
  'worktree(s)',
  'project(s)',
  'acceptance criterion item(s)',
  'ticket(s)',
  'session store issue(s)',
  'prompt template(s)',
  'action(s)',
  'candidate(s)',
]) {
  if (extension.includes(forbidden)) {
    fail(`Extension must use the shared count label helper instead of ${forbidden}.`);
  }
}

for (const marker of [
  'export function compactSingleLineText(value: unknown, maxLength: number): string',
  "String(value ?? '').replace(/\\s+/g, ' ').trim()",
  "`${compact.substring(0, maxLength - 3)}...`",
]) {
  if (!textFormat.includes(marker)) {
    fail(`Missing compact text helper marker: ${marker}`);
  }
}

for (const marker of [
  'export function uniqueCaseInsensitiveStrings(values: Array<string | undefined>): string[]',
  'const seen = new Set<string>()',
  'const key = value.toLowerCase()',
]) {
  if (!stringLists.includes(marker)) {
    fail(`Missing string list helper marker: ${marker}`);
  }
}

for (const marker of [
  'export function firstEnvValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined',
  'const value = env[key]',
  'return undefined',
]) {
  if (!envValues.includes(marker)) {
    fail(`Missing env value helper marker: ${marker}`);
  }
}

for (const marker of [
  'export function mergeRequestCommentsFromRecord(record: object | null | undefined): MergeRequestComment[]',
  'Reflect.get(record, \'comments\')',
  "import { recordsFromUnknown } from './records'",
  'recordsFromUnknown(value)',
  "if (typeof item['body'] !== 'string') { return []; }",
  "return [{ ...item, body: item['body'] } as MergeRequestComment]",
]) {
  if (!mergeRequestComments.includes(marker)) {
    fail(`Missing merge request comment helper marker: ${marker}`);
  }
}
if (mergeRequestComments.includes('isRecord(item)')) {
  fail('Merge request comments must use shared record-list normalization.');
}
if (mergeRequestComments.includes('(item): item is MergeRequestComment')) {
  fail('Merge request comments must not use a local record type predicate.');
}

for (const marker of [
  "import { optionalTrimmedStringFromUnknown } from './records'",
  'export function mergeRequestReviewStatusLabel(status: unknown, fallback = \'\'): string',
  'const value = optionalTrimmedStringFromUnknown(status)',
  "value.replace(/_/g, ' ')",
]) {
  if (!mergeRequestLabels.includes(marker)) {
    fail(`Missing merge request label helper marker: ${marker}`);
  }
}

for (const [name, source, marker] of [
  ['src/extension.ts', extension, "import { mergeRequestReviewStatusLabel } from './services/mergeRequestLabels'"],
  ['src/services/agingAnalyzer.ts', agingAnalyzer, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/collisionDetector.ts', collisionDetector, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/jiraBoardPanelView.ts', jiraBoardPanelView, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/queuePlanner.ts', queuePlanner, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/recoveryCenter.ts', recoveryCenter, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/ticketPanelView.ts', ticketPanelView, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/services/ticketTimeline.ts', ticketTimeline, "import { mergeRequestReviewStatusLabel } from './mergeRequestLabels'"],
  ['src/views/ReviewTreeProvider.ts', reviewTreeProvider, "import { mergeRequestReviewStatusLabel } from '../services/mergeRequestLabels'"],
  ['src/views/TicketTreeProvider.ts', ticketTreeProvider, "import { mergeRequestReviewStatusLabel } from '../services/mergeRequestLabels'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared MR review status label helper.`);
  }
  if (/review_status\??\.replace\(|reviewStatus\??\.replace\(|mrReviewStatus\??\.replace\(/.test(source)) {
    fail(`${name} must not format MR review status labels locally.`);
  }
}

for (const marker of [
  'export function toValidDate(value: unknown): Date | null',
  'value instanceof Date',
  "typeof value === 'string' || typeof value === 'number'",
  'Number.isFinite',
]) {
  if (!dateValues.includes(marker)) {
    fail(`Missing date value helper marker: ${marker}`);
  }
}

for (const marker of [
  "import { toValidDate } from './dateValues'",
  'export function formatDateTimeLabel(value: unknown',
  'return toValidDate(value)?.toLocaleString() || fallback',
  'export function formatDateLabel(value: unknown',
  'return toValidDate(value)?.toLocaleDateString() || fallback',
  'export function formatTimeLabel(value: unknown',
  'return toValidDate(value)?.toLocaleTimeString() || fallback',
]) {
  if (!dateLabels.includes(marker)) {
    fail(`Missing date label helper marker: ${marker}`);
  }
}

for (const marker of [
  "import { formatDateLabel, formatDateTimeLabel } from './dateLabels'",
  'export function formatWebviewDateTime(value: unknown',
  'return formatDateTimeLabel(value, fallback)',
  'export function formatWebviewDate(value: unknown',
  'return formatDateLabel(value, fallback)',
]) {
  if (!webviewFormat.includes(marker)) {
    fail(`Missing webview date format helper marker: ${marker}`);
  }
}

for (const marker of [
  'export function escapeRegExp(value: string): string',
  "value.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')",
]) {
  if (!regexp.includes(marker)) {
    fail(`Missing regexp helper marker: ${marker}`);
  }
}

for (const [name, source] of [
  ['src/services/promptManager.ts', promptManager],
  ['src/services/postRunReadiness.ts', postRunReadiness],
]) {
  if (!source.includes("import { escapeRegExp } from './regexp'")) {
    fail(`${name} must import the shared regexp escaping helper.`);
  }
  if (source.includes('function escapeRegExp')) {
    fail(`${name} must not carry a local escapeRegExp helper.`);
  }
}

for (const marker of [
  'export function parseJsonWithLabel<T = unknown>',
  'const content = stripUtf8Bom(raw)',
  "unknownErrorMessage(e, 'parse failed')",
  "options.includePreview ? content.trim().substring(0, previewLength) : ''",
]) {
  if (!jsonFiles.includes(marker)) {
    fail(`Missing JSON file helper marker: ${marker}`);
  }
}

for (const [name, source] of [
  ['src/services/scriptClient.ts', scriptClient],
  ['src/services/stateScriptAdapter.ts', stateScriptAdapter],
  ['src/services/integrationAdapters.ts', integrationAdapters],
  ['src/services/doctorChecks.ts', doctorChecks],
]) {
  if (!source.includes("import { parseJsonWithLabel } from './jsonFiles'")) {
    fail(`${name} must import the shared labeled JSON parser.`);
  }
  if (source.includes('const content = stripUtf8Bom(raw)')) {
    fail(`${name} must not parse labeled JSON locally.`);
  }
}

for (const marker of [
  "import * as fs from 'fs'",
  'export function isPathInside(filePath: string, directoryPath: string): boolean',
  'path.relative(path.resolve(directoryPath), path.resolve(filePath))',
  "!relative.startsWith('..')",
  '!path.isAbsolute(relative)',
  'export function isExistingRealPathInside(filePath: string, directoryPath: string): boolean',
  'const realDirectory = fs.realpathSync(directoryPath)',
  'const realPath = fs.realpathSync(filePath)',
  'return isPathInside(realPath, realDirectory)',
  'export function projectPathKey(value: unknown',
  "trimmed.replace(/\\\\/g, '/')",
  'path.posix.normalize',
  "platform === 'win32'",
]) {
  if (!pathUtils.includes(marker)) {
    fail(`Missing path utils marker: ${marker}`);
  }
}

for (const [name, source] of [
  ['src/services/runStore.ts', runStore],
  ['src/services/gitWorkspace.ts', gitWorkspace],
]) {
  const marker = name === 'src/services/runStore.ts'
    ? "import { isExistingRealPathInside, isPathInside } from './pathUtils'"
    : "import { isPathInside } from './pathUtils'";
  if (!source.includes(marker)) {
    fail(`${name} must import the shared path containment helper.`);
  }
  if (source.includes('function isPathInside')) {
    fail(`${name} must not carry a local isPathInside helper.`);
  }
}
if (!projectSelection.includes("import { projectPathKey } from './pathUtils'")) {
  fail('src/services/projectSelection.ts must import the shared project path helper.');
}
if (!runActionHelpers.includes("import { isExistingRealPathInside } from './pathUtils'")) {
  fail('src/services/runActionHelpers.ts must import the shared path containment helper.');
}
if (extension.includes('function isPathInsideDirectory')) {
  fail('src/extension.ts must not carry a local path containment helper.');
}
if (extension.includes('function projectPathKey(')) {
  fail('src/extension.ts must not carry a local project path identity helper.');
}
if (extension.includes('function getProjectPath(') || extension.includes('function getProjectNameForPath(')) {
  fail('src/extension.ts must not carry local project registry lookup helpers.');
}
if (!runActionHelpers.includes('isExistingRealPathInside(filePath, RUNS_DIR)')) {
  fail('src/services/runActionHelpers.ts must use the shared realpath containment helper for run artifacts.');
}
if (!runActionHelpers.includes("import { recordsFromUnknown } from './records'")) {
  fail('Run action helpers must import the shared record-list normalizer.');
}
if (!runActionHelpers.includes('const events = recordsFromUnknown(run.events)')) {
  fail('Run action helpers must normalize run events through recordsFromUnknown.');
}
if (runActionHelpers.includes('const events = Array.isArray(run.events) ? run.events : []')) {
  fail('Run action helpers must not open-code run event array checks.');
}

for (const [name, source, marker] of [
  ['src/services/agingAnalyzer.ts', agingAnalyzer, "import { toValidDate } from './dateValues'"],
  ['src/services/collisionDetector.ts', collisionDetector, "import { toValidDate } from './dateValues'"],
  ['src/services/dateLabels.ts', dateLabels, "import { toValidDate } from './dateValues'"],
  ['src/services/dashboardWorklist.ts', dashboardWorklist, "import { toValidDate } from './dateValues'"],
  ['src/services/integrationAdapters.ts', integrationAdapters, "import { toValidDate } from './dateValues'"],
  ['src/services/mergeRequestComments.ts', mergeRequestComments, "import { toValidDate } from './dateValues'"],
  ['src/services/mergeRequestNotifications.ts', mergeRequestNotifications, "import { toValidDate } from './dateValues'"],
  ['src/services/queuePlanner.ts', queuePlanner, "import { toValidDate } from './dateValues'"],
  ['src/services/relativeTime.ts', relativeTime, "import { toValidDate } from './dateValues'"],
  ['src/services/recoveryCenter.ts', recoveryCenter, "import { toValidDate } from './dateValues'"],
  ['src/services/runCenterSort.ts', runCenterSort, "import { toValidDate } from './dateValues'"],
  ['src/services/runProgress.ts', runProgress, "import { toValidDate } from './dateValues'"],
  ['src/services/runStatus.ts', runStatus, "import { toValidDate } from './dateValues'"],
  ['src/services/runStore.ts', runStore, "import { toValidDate } from './dateValues'"],
  ['src/services/sessionStore.ts', sessionStore, "import { toValidDate } from './dateValues'"],
  ['src/services/ticketFilters.ts', ticketFilters, "import { toValidDate } from './dateValues'"],
  ['src/services/ticketTimeline.ts', ticketTimeline, "import { toValidDate } from './dateValues'"],
  ['src/services/trendMetrics.ts', trendMetrics, "import { toValidDate } from './dateValues'"],
  ['src/runners/sessionDispatcher.ts', dispatcher, "import { toValidDate } from '../services/dateValues'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared date value helper.`);
  }
  if (source.includes('function toValidDate')) {
    fail(`${name} must not carry a local toValidDate helper.`);
  }
  if (source.includes('function dateValue') || source.includes('function validDate') || source.includes('function parseDate')) {
    fail(`${name} must not carry a local date coercion helper.`);
  }
}

for (const [name, source, marker] of [
  ['src/extension.ts', extension, "import { formatDateTimeLabel } from './services/dateLabels'"],
  ['src/runners/sessionDispatcher.ts', dispatcher, "import { formatDateTimeLabel, formatTimeLabel } from '../services/dateLabels'"],
  ['src/services/runActionHelpers.ts', runActionHelpers, "import { formatDateTimeLabel } from './dateLabels'"],
  ['src/services/webviewFormat.ts', webviewFormat, "import { formatDateLabel, formatDateTimeLabel } from './dateLabels'"],
  ['src/views/SessionTreeProvider.ts', sessionTreeProvider, "import { formatTimeLabel } from '../services/dateLabels'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared date label helper.`);
  }
}
if (extension.includes("import { toValidDate } from './services/dateValues'")) {
  fail('src/extension.ts must use shared date label helpers instead of importing date coercion directly for labels.');
}
if (sessionTreeProvider.includes("import { toValidDate } from '../services/dateValues'")) {
  fail('Session tree provider must use shared date label helpers instead of importing date coercion directly for labels.');
}
if (runActionHelpers.includes('function formatRunDateTime')) {
  fail('Run action helpers must not carry a local date-time label helper.');
}

for (const [name, source, marker] of [
  ['src/services/jiraBoardPanelView.ts', jiraBoardPanelView, "import { finiteNumberFromUnknown, isRecord, recordEntriesFromUnknown, recordKeysFromUnknown, recordsFromUnknown } from './records'"],
  ['src/services/jiraBoardPanelView.ts', jiraBoardPanelView, "size: finiteNumberFromUnknown(item['size'])"],
  ['src/services/mergeRequestNotifications.ts', mergeRequestNotifications, "import { optionalFiniteNumberFromUnknown } from './records'"],
  ['src/services/mergeRequestNotifications.ts', mergeRequestNotifications, 'const numeric = optionalFiniteNumberFromUnknown(value)'],
  ['src/services/stateStore.ts', stateStore, "version: finiteNumberFromUnknown(raw['version'], 1)"],
  ['src/services/stateStore.ts', stateStore, "priority: finiteNumberFromUnknown(p['priority'])"],
  ['src/services/stateStore.ts', stateStore, "open_mr_count: finiteNumberFromUnknown(p['open_mr_count'])"],
  ['src/services/stateStore.ts', stateStore, "priority_score: finiteNumberFromUnknown(item['priority_score'])"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must use the shared finite number helper: ${marker}`);
  }
}

for (const [name, source, marker] of [
  ['src/extension.ts', extension, "import { isRecord, recordEntriesFromUnknown, recordFromUnknown, recordKeysFromUnknown, recordString } from './services/records'"],
  ['src/services/changedFiles.ts', changedFiles, "import { isRecord } from './records'"],
  ['src/services/agingAnalyzer.ts', agingAnalyzer, "import { recordEntriesFromUnknown } from './records'"],
  ['src/services/evidenceData.ts', evidenceData, "import { isRecord, recordsFromUnknown, recordValuesFromUnknown, trimmedStringFromUnknown } from './records'"],
  ['src/services/integrationAdapters.ts', integrationAdapters, "import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records'"],
  ['src/services/ticketMutations.ts', ticketMutations, "import { isRecord, optionalTrimmedStringFromUnknown } from './records'"],
  ['src/services/queuePlanner.ts', queuePlanner, "import { arrayFromUnknown, isRecord } from './records'"],
  ['src/services/runStatus.ts', runStatus, "import { isRecord, recordsFromUnknown } from './records'"],
  ['src/services/runRecords.ts', runRecords, "import { isRecord, recordsFromUnknown, recordString } from './records'"],
  ['src/services/runStore.ts', runStore, "import { isRecord, recordString } from './records'"],
  ['src/services/sessionStore.ts', sessionStore, "import { finiteNumberFromUnknown, isRecord, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records'"],
  ['src/services/sonarReportView.ts', sonarReportView, "import { isRecord, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records'"],
  ['src/services/trendMetrics.ts', trendMetrics, "import { definedValues, recordEntriesFromUnknown, recordString } from './records'"],
  ['src/services/stateStore.ts', stateStore, "import { finiteNumberFromUnknown, isRecord as isPlainObject } from './records'"],
  ['src/services/stateScriptAdapter.ts', stateScriptAdapter, "import { arrayFromUnknown, finiteNumberFromUnknown, isRecord as isPlainObject, optionalTrimmedStringFromUnknown } from './records'"],
  ['src/runners/sessionDispatcher.ts', dispatcher, "import { arrayFromUnknown, isRecord, recordEntriesFromUnknown, recordFromUnknown } from '../services/records'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared record guard.`);
  }
  if (source.includes('function isRecord')) {
    fail(`${name} must not carry a local isRecord helper.`);
  }
  if (source.includes('function isObjectRecord')) {
    fail(`${name} must not carry a local isObjectRecord helper.`);
  }
  if (source.includes('function isPlainObject')) {
    fail(`${name} must not carry a local isPlainObject helper.`);
  }
}
if (!dashboardPanelView.includes("import { arrayFromUnknown, finiteNumberFromUnknown, recordFromUnknown, recordString } from './records'")) {
  fail('src/services/dashboardPanelView.ts must import the shared array and record fallback helpers.');
}
if (!dashboardPanelView.includes("import { runLikeRecordsFromUnknown } from './runRecords'")) {
  fail('Dashboard panel must import the shared run record list helper.');
}
if (!dashboardPanelView.includes("import { ticketStringArray } from './ticketFields'") || !dashboardPanelView.includes('ticketStringArray(t.projects).includes(name)')) {
  fail('Dashboard panel project cards must normalize linked project counts through ticketStringArray.');
}
if (!dashboardPanelView.includes('const runs = runLikeRecordsFromUnknown(input.runs)')) {
  fail('Dashboard panel runs must use the shared run record list helper.');
}
if (dashboardPanelView.includes('filter(isRunLikeRecord)')) {
  fail('Dashboard panel must not normalize run arrays locally.');
}
if (!dashboardPanelView.includes('return arrayFromUnknown(brief[key])')) {
  fail('Dashboard panel brief items must use the shared array fallback helper.');
}
if (dashboardPanelView.includes('return Array.isArray(value) ? value : []')) {
  fail('Dashboard panel must not carry a local unknown-array fallback.');
}
if (dashboardPanelView.includes('function dashboardBriefRecord')) {
  fail('Dashboard panel must use the shared record fallback helper for morning brief payloads.');
}
if (!dashboardPanelView.includes("import { isFailedOrCancelledRunStatus, isFreshActiveRun } from './runStatus'")) {
  fail('Dashboard panel must import shared run status predicates.');
}
if (!dashboardPanelView.includes("runs.filter(run => isFailedOrCancelledRunStatus(recordString(run, 'status'))).length")) {
  fail('Dashboard panel failed-run count must use the shared failed/cancelled run predicate.');
}
if (dashboardPanelView.includes("['failed', 'cancelled'].includes(recordString(run, 'status'))")) {
  fail('Dashboard panel must not carry a local failed/cancelled status list.');
}
if (dashboardPanelView.includes('t.projects?.includes(name)')) {
  fail('Dashboard panel must not count linked tickets from raw project arrays.');
}

for (const [name, source, marker] of [
  ['src/services/activeRunDisplay.ts', activeRunDisplay, "import { recordFromUnknown, recordString } from './records'"],
  ['src/services/webviewMessages.ts', webviewMessages, "import { recordFromUnknown, recordString } from './records'"],
  ['src/services/runAttention.ts', runAttention, "import { recordsFromUnknown, recordFromUnknown } from './records'"],
  ['src/services/runCompletionNotification.ts', runCompletionNotification, "import { recordFromUnknown, recordString } from './records'"],
  ['src/services/runProgress.ts', runProgress, "import { recordsFromUnknown, recordFromUnknown, recordString } from './records'"],
  ['src/services/queueMutations.ts', queueMutations, "import { finiteNumberFromUnknown, recordFromUnknown } from './records'"],
  ['src/services/postRunReadiness.ts', postRunReadiness, "import { arrayFromUnknown, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared unknown-record helper.`);
  }
  if (
    source.includes('function runRecord(value: unknown): Record<string, unknown>')
    || source.includes('function objectRecord(value: unknown): Record<string, unknown>')
    || source.includes('function objectRecordOrNull(value: unknown): value is Record<string, unknown>')
    || source.includes('function queueRecord(value: unknown): Record<string, unknown>')
  ) {
    fail(`${name} must not carry a local unknown-record helper.`);
  }
}
if (operatorPanel.includes('function recordFromUnknown(value: unknown): Record<string, unknown>')) {
  fail('Operator panel must use the shared unknown-record helper.');
}
if (runStore.includes('function stringField(value: unknown): string')) {
  fail('Run store must use the shared record string helper instead of a local stringField helper.');
}

for (const [name, source, marker] of [
  ['src/services/activeRunDisplay.ts', activeRunDisplay, "import { recordFromUnknown, recordString } from './records'"],
  ['src/services/agentQualityScore.ts', agentQualityScore, "import { definedValues, recordString } from './records'"],
  ['src/services/dashboardWorklist.ts', dashboardWorklist, "import { recordString } from './records'"],
  ['src/services/humanReviewInbox.ts', humanReviewInbox, "import { recordString } from './records'"],
  ['src/services/queueActiveRun.ts', queueActiveRun, "import { recordString } from './records'"],
  ['src/services/runProgress.ts', runProgress, "import { recordsFromUnknown, recordFromUnknown, recordString } from './records'"],
  ['src/services/ticketTimeline.ts', ticketTimeline, "import { recordString } from './records'"],
  ['src/services/trendMetrics.ts', trendMetrics, "import { definedValues, recordEntriesFromUnknown, recordString } from './records'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared record string helper.`);
  }
  if (source.includes('function runString(record: Record<string, unknown>, key: string): string')) {
    fail(`${name} must not carry a local runString record helper.`);
  }
  if (source.includes('function eventString')) {
    fail(`${name} must not carry a local eventString helper.`);
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
for (const marker of [
  'export type TicketAction',
  'export type QueueAction',
]) {
  if (actionCatalog.includes(marker)) {
    fail(`Action catalog should not export unused action alias: ${marker}`);
  }
}
for (const marker of [
  "import { actionDisplayLabel as actionToLabel } from './services/actionCatalog'",
  'const actionLabel = actionToLabel(queueData.action)',
]) {
  if (!extension.includes(marker)) {
    fail(`Extension queue dispatch should use shared action labels: ${marker}`);
  }
}
if (extension.includes('queueData.action.replace(')) {
  fail('Extension queue dispatch must not format action labels locally.');
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
  'type TicketWithOpenMergeRequest',
  'interface ReviewBranchTicket',
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
  'function normalizeDiscoveredProjects',
  'function normalizeDiscoveredProject',
  "normalizeDiscoveredProjects(data['candidates'])",
  'for (const item of arrayFromUnknown(value))',
  'export function registerProject',
  'export function addAdhocTask',
  'export function completeAdhocTask',
  'function readMorningBrief(',
  'export function readMorningBriefJson',
  "import { arrayFromUnknown, finiteNumberFromUnknown, isRecord as isPlainObject, optionalTrimmedStringFromUnknown } from './records'",
  "overnight_actions: finiteNumberFromUnknown(parsed['overnight_actions'])",
  "vpn_drops: finiteNumberFromUnknown(parsed['vpn_drops'])",
  "const path = optionalTrimmedStringFromUnknown(value['path']) ?? null",
  "completed: arrayFromUnknown(parsed['completed'])",
  "ready_to_go: arrayFromUnknown(parsed['ready_to_go'])",
  "parseJsonWithLabel(discoverProjects(options), 'kronos_state.py --discover', { includePreview: true })",
  'kronos_state.py --discover',
  'kronos_state.py --morning-brief',
  'runKronosStateScript',
]) {
  if (!stateScriptAdapter.includes(marker)) {
    fail(`Missing state script adapter marker: ${marker}`);
  }
}
if (stateScriptAdapter.includes('function arrayOrEmpty')) {
  fail('State script adapter must use the shared array fallback helper.');
}
if (stateScriptAdapter.includes('function stringOrNull')) {
  fail('State script adapter must use the shared optional trimmed string helper.');
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
  "import { countLabel } from './countLabels'",
  "import { evidenceRecordCount } from './evidenceData'",
  'evidenceRecordCount(ticket)',
  "countLabel(evidenceCount, 'item')",
]) {
  if (!nextActionContext.includes(marker)) {
    fail(`Missing next action context marker: ${marker}`);
  }
}
if (nextActionContext.includes('item(s)')) {
  fail('Next action context must use the shared count label helper for item counts.');
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
  "import { isPathInside } from './pathUtils'",
  "path.join(worktreePath, '.claude')",
  'const artifactPath = path.resolve(worktreePath, statusPath)',
  'fs.rmSync(artifactPath, { recursive: true, force: true })',
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
  "import { configIntervalMs } from '../services/intervalConfig'",
  'private _refreshing = false',
  'const safeIntervalMs = configIntervalMs(intervalMs, 5000)',
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
if (sessionTreeProvider.includes('Number.isFinite' + '(intervalMs)')) {
  fail('Session tree polling must use the shared interval config helper.');
}

for (const marker of [
  "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
  "import { isFreshActiveRun } from '../services/runStatus'",
  "import { formatRunProgress } from '../services/runProgress'",
  "import { activeRunForQueueItem } from '../services/queueActiveRun'",
  "import { configIntervalMs } from '../services/intervalConfig'",
  "import { ticketStringArray } from '../services/ticketFields'",
  'const activeRuns = listRuns().filter(run => isFreshActiveRun(run))',
  'new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns))',
  'startPolling(intervalMs: number): void',
  'const safeIntervalMs = configIntervalMs(intervalMs, 5000)',
  'queueTree.startPolling(sessionPollMs)',
  'queueTree.dispose()',
  'const projectLabel = ticketStringArray(item.projects).join(\', \') || \'unlinked\'',
  'const progress = activeRun ? formatRunProgress(activeRun) :',
  '${projectLabel} / ${item.ticket || \'refresh\'}',
  'Active run: ${activeRun.id}',
  "new vscode.ThemeIcon('sync~spin'",
]) {
  if (!queueTreeProvider.includes(marker) && !extension.includes(marker)) {
    fail(`Missing queue tree active-run marker: ${marker}`);
  }
}
for (const marker of [
  "import { skillForAction } from './nextActionContext'",
  "import { projectPathKey } from './pathUtils'",
  "import { isFreshActiveRun } from './runStatus'",
  "import { ticketStringArray } from './ticketFields'",
  'interface QueueActiveRunLike',
  'export function activeRunForQueueItem<T extends QueueActiveRunLike>',
  'return runs.find(run => isFreshActiveRun(run, now) && runMatchesQueueItem(run, item));',
  'function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean',
  'function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean',
  'const projects = ticketStringArray(item.projects)',
  "projectPathKey(recordString(run, 'projectPath'))",
  'projectPathKey(item.project_path)',
  'ticketStringArray(item.projects).length === 0',
  "recordString(run, 'skill') === skillForAction(item.action)",
]) {
  if (!queueActiveRun.includes(marker)) {
    fail(`Missing queue active-run service marker: ${marker}`);
  }
}
if (queueActiveRun.includes('item.projects || []')) {
  fail('Queue active-run matching must normalize queue projects through ticketStringArray.');
}
if (`${queueTreeProvider}\n${queueActiveRun}`.includes('activeRuns.find(run => runMatchesQueueTicket(run, item))\n    || activeRuns.find')) {
  fail('Queue active-run matching must not use broad ticket-only or project-only fallbacks.');
}
if (queueTreeProvider.includes('export class QueueTreeItem')) {
  fail('QueueTreeItem should stay internal to QueueTreeProvider.');
}
if (queueTreeProvider.includes('Number.isFinite' + '(intervalMs)')) {
  fail('Queue tree polling must use the shared interval config helper.');
}
if (queueTreeProvider.includes('item.projects || []')) {
  fail('Queue tree must normalize project labels through ticketStringArray.');
}

for (const marker of [
  "import { evidenceRecordCount } from '../services/evidenceData'",
  "import { ticketStringArray } from '../services/ticketFields'",
  'evidenceRecordCount(t)',
  'const projs = ticketStringArray(t.projects)',
  'const projs = ticketStringArray(ticket.projects)',
]) {
  if (!ticketTreeProvider.includes(marker)) {
    fail(`Missing ticket tree evidence-count marker: ${marker}`);
  }
}
if (ticketTreeProvider.includes('function evidenceItemCount')) {
  fail('Ticket tree must not duplicate evidence counting.');
}
if (ticketTreeProvider.includes('t.projects || []') || ticketTreeProvider.includes('ticket.projects || []')) {
  fail('Ticket tree must use ticketStringArray before rendering linked projects.');
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
  'interface NewReviewItemSummary',
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
  "import { openReviewTicketEntries } from '../services/reviewWork'",
  'type TicketWithOpenMergeRequest = ReturnType<typeof openReviewTicketEntries>[number][1]',
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
  'interface WebviewDisposeTarget',
  'interface WebviewReadyMonitor',
  'arm(): void',
  'export function createWebviewReadyMonitor',
  'function logWebviewReadyMessage',
  'const arm = (): void =>',
  'reportedReady = false',
  'monitor.arm = arm',
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
for (const [file, source] of Object.entries({
  'src/services/webviewSecurity.ts': webviewSecurity,
  'media/kronos-webview-runtime.js': webviewRuntimeScript,
  'media/kronos-action-panel.js': webviewActionPanelScript,
  'media/kronos-jira-board.js': jiraBoardScript,
})) {
  if (source.includes('root[cacheKey] = kronosFallbackVsCodeApi()')) {
    fail(`${file} must not cache the fallback VS Code API; retry acquisition on later actions.`);
  }
}

for (const marker of [
  'export function createWebviewNonce',
  "toString('hex')",
  'export function webviewScriptCspOptions',
  'return { allowScripts: true, nonce, cspSource }',
  'export const WEBVIEW_RUNTIME_SCRIPT',
  "'kronos-webview-runtime.js'",
  'export const WEBVIEW_ACTION_PANEL_SCRIPT',
  "'kronos-action-panel.js'",
  'export const WEBVIEW_JIRA_BOARD_SCRIPT',
  "'kronos-jira-board.js'",
  'export function webviewVsCodeApiScript',
  'function kronosVsCodeApi() {',
  "Symbol.for('kronos.vscodeApi')",
  "typeof acquireVsCodeApi !== 'function'",
  '__kronosFallbackVsCodeApi',
  "!cached.__kronosFallbackVsCodeApi",
  "console.error('Failed to acquire VS Code API for Kronos webview action', error)",
  "document.documentElement.setAttribute('data-kronos-script-ready', 'true')",
  "console.info('Kronos webview script ready', webviewName, navigator.userAgent)",
  "console.error('Kronos webview script error', webviewName",
  "console.error('Kronos webview unhandled rejection', webviewName",
  'export const WEBVIEW_READY_COMMAND',
  'function webviewScriptDiagnosticBanner',
  'data-kronos-script-required',
  'Webview Developer Tools',
  'Extension Host DevTools',
  'function injectWebviewScriptDiagnostic(html: string): string',
  'injectWebviewScriptDiagnostic(value)',
  'export function webviewActionScriptTag',
  'webviewRuntimeScriptTag(nonce, webviewRuntimeScriptUri(options.scriptUri))',
  'scriptUri: string',
  'export function webviewRuntimeScriptTag',
  'id="kronos-webview-runtime-script"',
  'data-kronos-script-kind="runtime"',
  'export function webviewRuntimeScriptUri',
  'WEBVIEW_RUNTIME_SCRIPT',
  'id="kronos-action-panel-script"',
  'data-kronos-script-kind="action-panel"',
  'data-kronos-webview-name',
  'data-kronos-action-fields',
  'data-kronos-ready-command',
  'options.scriptUri',
  'cspSource?: string',
  'options.cspSource?.trim()',
  'scriptSources.join',
  'function webviewCspMeta',
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
if (webviewSecurity.includes('export function webviewCspMeta')) {
  fail('webviewCspMeta should stay private; callers should use withWebviewCsp.');
}
if (webviewSecurity.includes('export function webviewScriptDiagnosticBanner')) {
  fail('webviewScriptDiagnosticBanner should stay private; callers should use withWebviewCsp.');
}

for (const marker of [
  'export function webviewReadyPostScript',
  'export function webviewActionPostScript',
]) {
  if (webviewSecurity.includes(marker)) {
    fail(`webviewSecurity must not reintroduce inline action startup helper: ${marker}`);
  }
}

for (const marker of [
  'KronosWebviewRuntime',
  'version: 1',
  'function kronosFallbackVsCodeApi()',
  'function vscodeApi()',
  "Symbol.for('kronos.vscodeApi')",
  "typeof acquireVsCodeApi !== 'function'",
  '__kronosFallbackVsCodeApi',
  '!cached.__kronosFallbackVsCodeApi',
  "console.error('Failed to acquire VS Code API for Kronos webview action', error)",
  "document.documentElement.setAttribute('data-kronos-script-ready', 'true')",
  "console.info('Kronos webview script ready', webviewName, navigator.userAgent)",
  "console.error('Kronos webview script error', diagnosticWebviewName",
  "console.error('Kronos webview unhandled rejection', diagnosticWebviewName",
  'function createReadyPoster(input)',
  'var readyPosted = false',
  'var readyAttempts = 0',
  'var maxReadyAttempts = 20',
  'if (readyPosted || !readyCommand) { return; }',
  'readyPosted = true',
  'if (readyAttempts < maxReadyAttempts) { setTimeout(postReady, 50); }',
  "console.warn('Kronos webview could not acquire VS Code API after ready retries', webviewName)",
]) {
  if (!webviewRuntimeScript.includes(marker)) {
    fail(`Missing packaged webview runtime marker: ${marker}`);
  }
}

for (const marker of [
  'document.currentScript',
  'function findKronosActionScript()',
  'kronos-action-panel-script',
  'data-kronos-webview-name',
  'data-kronos-ready-command',
  'data-kronos-action-fields',
  'KronosWebviewRuntime',
  'var runtime = null',
  'var runtimeAttempts = 0',
  'var maxRuntimeAttempts = 20',
  'function waitForKronosActionRuntime()',
  'setTimeout(waitForKronosActionRuntime, 50)',
  'runtime.createReadyPoster',
  'runtime.vscodeApi().postMessage(message)',
  'runtime.markReady(webviewName)',
  'runtime.installDiagnostics(webviewName)',
  "document.documentElement.setAttribute('data-kronos-actions-ready', 'true')",
  '__kronosActionHandlerAttached',
  'data-kronos-action-handler-attached',
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
  'function findKronosJiraBoardScript()',
  'kronos-jira-board-script',
  'KronosWebviewRuntime',
  'var runtime = null',
  'var runtimeAttempts = 0',
  'var maxRuntimeAttempts = 20',
  'function waitForKronosJiraBoardRuntime()',
  'setTimeout(waitForKronosJiraBoardRuntime, 50)',
  'runtime.createReadyPoster',
  'runtime.vscodeApi().postMessage(Object.assign({ command: command }, payload || {}))',
  'runtime.markReady(webviewName)',
  'runtime.installDiagnostics(webviewName)',
  'function claimKronosJiraBoard()',
  'function closestBoardTarget',
  '__kronosJiraBoardAttached',
  'data-kronos-jira-board-attached',
]) {
  if (!jiraBoardScript.includes(marker)) {
    fail(`Missing packaged Jira board script guard marker: ${marker}`);
  }
}
for (const [label, source] of [
  ['packaged action script', webviewActionPanelScript],
  ['packaged Jira board script', jiraBoardScript],
]) {
  if (source.includes('if (api.__kronosFallbackVsCodeApi) { setTimeout(postReady, 50); return; }')) {
    fail(`${label} must cap VS Code API ready retries.`);
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
  "import { countLabel } from '../services/countLabels'",
  "import { formatRelativeTime } from '../services/relativeTime'",
  "import { ticketStringArray } from '../services/ticketFields'",
  'ticketStringArray(t.projects).includes(name)',
  "countLabel(proj.open_mr_count, 'open MR')",
  'formatRelativeTime(proj.last_polled)',
]) {
  if (!projectTreeProvider.includes(marker)) {
    fail(`Missing project tree date marker: ${marker}`);
  }
}
if (projectTreeProvider.includes('open MR(s)')) {
  fail('Project tree provider must use the shared count label helper for MR counts.');
}
if (projectTreeProvider.includes('t.projects?.includes(name)')) {
  fail('Project tree provider must normalize linked ticket counts through ticketStringArray.');
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
  'function runCliProbe',
  'export function readClaudeAgents',
  'export function resolveGcloudCommandStatus',
  'export function checkGcloudApplicationDefaultAuth',
  'export function checkClaudeModelAccess',
  'export function commandNeedsCmdWrapper',
  'export function windowsCmdFileInvocation',
  'export function readableGoogleApplicationCredentials',
  "import { firstEnvValue } from './envValues'",
  "import { arrayFromUnknown } from './records'",
  "import { uniqueCaseInsensitiveStrings } from './stringLists'",
  'function resolveCommandOnPath(command: string',
  'firstEnvValue(env, [',
  'return arrayFromUnknown(parsed) as T[]',
  'uniqueCaseInsensitiveStrings([',
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
if (cliProbes.includes('function unique(values: Array<string | undefined>): string[]')) {
  fail('cliProbes must use the shared case-insensitive string list helper.');
}
if (cliProbes.includes('function envValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined')) {
  fail('cliProbes must use the shared env value helper.');
}
if (cliProbes.includes('return Array.isArray(parsed) ? parsed : []')) {
  fail('cliProbes must use the shared array fallback helper for parsed Claude agents.');
}
for (const marker of [
  "import { firstEnvValue } from './envValues'",
  "import { uniqueCaseInsensitiveStrings } from './stringLists'",
  'function gitBashCandidatePaths',
  'firstEnvValue(env, [',
  'uniqueCaseInsensitiveStrings([',
]) {
  if (!terminalProfiles.includes(marker)) {
    fail(`Missing terminal profile marker: ${marker}`);
  }
}
if (terminalProfiles.includes('function unique(values: Array<string | undefined>): string[]')) {
  fail('terminalProfiles must use the shared case-insensitive string list helper.');
}
if (terminalProfiles.includes('function envValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined')) {
  fail('terminalProfiles must use the shared env value helper.');
}

for (const marker of [
  'function sanitizeGitBranchRef',
  'function resolveReviewBranch',
  'function mergeRefsForBranch',
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
  'function buildSonarDashboardUrl',
  'const base = new URL(host)',
  "base.protocol !== 'http:' && base.protocol !== 'https:'",
  'base.pathname = `${base.pathname.replace(/\\/+$/, \'\')}/`',
  "const url = new URL('dashboard', base)",
  'function formatSonarMetricName',
  'function sonarGateStatus',
  'function sonarConditionList',
  'function sonarMeasureList',
  'function sonarIssueList',
  'export function buildSonarReport',
  'SonarReportRenderInput',
  'gate: unknown',
  'measures: unknown',
  'issues: unknown',
  'actionScriptUri: string',
  "import { kronosActionPanelScript } from './operatorPanel'",
  'kronosWebviewBaseCss',
  'class="kronos-shell sonar-shell"',
  'class="kronos-button primary"',
  'data-action="fixSonar"',
  'data-action="openSonar"',
  "kronosActionPanelScript(input.nonce, 'Kronos Sonar Report', input.actionScriptUri)",
  "optionalTrimmedStringFromUnknown(projectStatus['status'])",
  "const severity = optionalTrimmedStringFromUnknown(issue['severity'])",
  'issueList.slice(0, 50)',
]) {
  if (!sonarReportView.includes(marker)) {
    fail(`Missing Sonar report view marker: ${marker}`);
  }
}
for (const forbidden of [
  "import { webviewVsCodeApiScript } from './webviewSecurity'",
  'kronosVsCodeApi().postMessage',
]) {
  if (sonarReportView.includes(forbidden)) {
    fail(`Sonar report view must use the packaged action-panel runtime: ${forbidden}`);
  }
}
for (const marker of [
  "import type { SonarIssue } from './sonarReportView'",
  "import { arrayFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records'",
  'export interface SonarBranchPickItem',
  'export function buildSonarBranchPickItems',
  'export function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
  'export function formatSonarIssuePromptLine(issue: SonarIssue): string',
  'export function buildKnownSonarIssuesBlock(value: unknown): string',
  'export function buildSonarFixBranchStrategy(projectName: string, sourceBranch: string): string',
  'export function buildSonarFixInstructionBlock',
  'function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null',
  "const severity = optionalTrimmedStringFromUnknown(record['severity'])",
]) {
  if (!sonarCommandPlan.includes(marker)) {
    fail(`Missing Sonar command plan marker: ${marker}`);
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
  'function buildDoctorReachabilityTargets',
  'export async function runDoctorReachabilityChecks',
  'function projectConfigGaps',
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
  "import { countLabel } from './countLabels'",
  "unknownErrorMessage(e, 'Could not read prompt directory')",
  "unknownErrorMessage(e, 'Auth check failed')",
  "unknownErrorMessage(e, 'Provider reachability checks failed.')",
  "unknownErrorMessage(e, `${command} unavailable`)",
  "unknownErrorMessage(e, 'claude unavailable')",
  "import { normalizeMergeRequestStatus } from './integrationAdapters'",
  "import { parseJsonWithLabel } from './jsonFiles'",
  "import { ticketStringArray } from './ticketFields'",
  'Values are not displayed',
  'DoctorCommandRunner',
  'function reviewMergeRequestStatusContractIssue',
  "commandRunner('python', [scriptPath, '--mr-status', ticketKey]",
  'function hasMergeRequestCommentSignal',
  'function hasMergeRequestDiscussionSignal',
  'parseJsonWithLabel(raw, `MR status for ${ticketKey}`)',
  'REVIEW_STATUS_SMOKE_TIMEOUT_MS',
  "countLabel(templates.length, 'template')",
  "countLabel(projectCount, 'project')",
  "countLabel(input.queue.items?.length || 0, 'queue item')",
  "countLabel(openReviewTickets.length, 'open review MR')",
  'for (const projectName of ticketStringArray(ticket.projects))',
]) {
  if (!doctorChecks.includes(marker)) {
    fail(`Missing doctor checks marker: ${marker}`);
  }
}
if (doctorChecks.includes('ticket.projects || []')) {
  fail('Doctor checks must normalize ticket project links through ticketStringArray.');
}
for (const forbidden of ['template(s)', 'project(s)', 'ticket(s)', 'queue item(s)', 'issue(s)', 'open review MR(s)']) {
  if (doctorChecks.includes(forbidden)) {
    fail(`Doctor checks must use the shared count label helper instead of ${forbidden}.`);
  }
}

for (const marker of [
  "if (options.remove) {\n        untrackWorktree(entry.worktreePath);",
  "r.status === 'removable' || r.status === 'missing'",
  "from '../services/worktreeRegistry'",
  'trackActiveWorktree(projectPath, worktreePath, ticket)',
  'untrackActiveWorktree(worktreePath)',
  'Active worktree registry needs manual review before creating a worktree',
  'let trackedManagedWorktree = false;',
  'managedWorktreePath = wtDir;',
  'trackWorktree(projectPath, wtDir, ticket || skill);',
  'trackedManagedWorktree = true;',
  'let spawnErrorHandled = false;',
  'stopProcessTree(proc.pid);',
  "const failureDetail = unknownErrorMessage(e, 'Failed to persist launched Claude process.');",
  "label: 'Failed to persist launched Claude process'",
  "console.warn(unknownErrorMessage(persistError, 'Failed to persist run launch failure.'));",
  'const worktreeExists = fs.existsSync(wtDir);',
  'if (trackedManagedWorktree && !worktreeExists)',
  'untrackWorktree(wtDir);',
  'failurePatch.worktreePath = wtDir;',
  "action: 'cleanup-worktree'",
  'if (registry.issue) { report.registryIssue = registry.issue; }',
]) {
  if (!dispatcher.includes(marker)) {
    fail(`Missing worktree cleanup safety marker: ${marker}`);
  }
}
if (dispatcher.indexOf('trackWorktree(projectPath, wtDir, ticket || skill);') > dispatcher.indexOf('const prepared = prepareManagedWorktree({')) {
  fail('Managed worktree setup must register cleanup tracking before git worktree creation.');
}

for (const marker of [
  'export const ACTIVE_WORKTREES_FILE',
  'interface ActiveWorktreeRegistry',
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
  'const VALID_TICKET_ACTION_SET = new Set<string>(TICKET_ACTIONS)',
  'const VALID_QUEUE_ACTION_SET = new Set<string>(QUEUE_ACTIONS)',
  "import { QUEUE_ACTIONS, TICKET_ACTIONS } from './actionCatalog'",
  'function validateProjectRecord',
  'function validateProjectConfig',
  'function validateMergeRequest',
  'function validateBuildStatus',
  'function validateEvidenceNote',
  "import { finiteNumberFromUnknown, isRecord as isPlainObject } from './records'",
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
  'function migrateStateFileShape',
  'function migrateStateFileShape(raw: unknown): KronosState',
  'export function readStateFileWithIssues',
  'function migrateQueueFileShape',
  'function migrateQueueFileShape(raw: unknown): QueueState',
  'function migrateQueueItemShape',
  'function migrateQueueItemShape(item: unknown, idx: number): QueueItem',
  'function migrateTicketEvidence(evidence: unknown): TicketEvidence | undefined',
  'export function validateStateFileShape(raw: unknown): void',
  'function validateProjectConfig(config: unknown, label: string): void',
  'function readCurrentWriteLock(): StateWriteLock | null',
  'export function readStateFile',
  'export function readQueueFile',
  "const STATE_WRITE_LOCK_FILE = path.join(KRONOS_DIR, 'state.write.lock')",
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
  'export const STATE_WRITE_LOCK_FILE',
  'export function migrateStateFileShape',
  'export function migrateStateFileShape(raw: any)',
  'function migrateTicketEvidence(evidence: any): any',
  'export function migrateQueueFileShape',
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
  'interface KronosStateLoadIssue',
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
  'export function existingAcceptanceCriterion(record: object)',
  "if (source === 'description' || source === 'manual')",
]) {
  if (!acceptanceCriteria.includes(marker)) {
    fail(`Missing acceptance criteria marker: ${marker}`);
  }
}

for (const marker of [
  "import { isRecord, recordsFromUnknown, recordValuesFromUnknown, trimmedStringFromUnknown } from './records'",
  'type EvidenceRecord = object',
  'export function evidenceNotes',
  'export function evidenceChecks',
  'export function evidenceRiskNotes',
  'export function evidenceEnvironmentResults',
  'export function evidenceString',
  'if (!isRecord(record)) { return fallback; }',
  'return trimmedStringFromUnknown(record[key], fallback)',
  "return isRecord(record) && record['checked'] === true",
  'recordsFromUnknown(ticket.evidence?.notes)',
  'recordsFromUnknown(ticket.evidence?.acceptance_criteria)',
  'recordsFromUnknown(ticket.evidence?.checks)',
  'recordsFromUnknown(ticket.evidence?.risk_notes)',
  'recordValuesFromUnknown(ticket.evidence?.environment_results)',
]) {
  if (!evidenceData.includes(marker)) {
    fail(`Missing evidence data marker: ${marker}`);
  }
}
for (const forbidden of [
  'type EvidenceRecord = Record<string, unknown>',
  'Reflect.get(record',
  'function isEvidenceRecord',
  'function arrayRecords',
  'value.filter(isRecord)',
]) {
  if (evidenceData.includes(forbidden)) {
    fail(`Evidence data must use shared record helpers: ${forbidden}`);
  }
}

for (const marker of [
  'export const EVIDENCE_NOTE_KIND_OPTIONS',
  'export const EVIDENCE_CHECK_RESULT_OPTIONS',
  'export const EVIDENCE_CHECK_ENVIRONMENT_OPTIONS',
  'export const EVIDENCE_ENVIRONMENT_RESULT_OPTIONS',
  'export function buildTicketEvidenceCheckInput',
  "if (input.environment !== 'n/a')",
  'export function buildTicketEnvironmentResultInput',
]) {
  if (!evidenceCommandInputs.includes(marker)) {
    fail(`Missing evidence command input marker: ${marker}`);
  }
}

for (const marker of [
  '## Evidence Checks',
  '## Environment Results',
  "import { ticketStringArray } from './ticketFields'",
  "ticketStringArray(ticket.projects).join(', ') || 'none'",
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
if (evidenceStore.includes('(ticket.projects || []).join')) {
  fail('Evidence store must normalize project lists through ticketStringArray.');
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
  "import { runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords'",
  "import { doctorCheckAttentionId, doctorCheckAttentionSeverity, doctorCheckNeedsAttention } from './doctorAttention'",
  'doctorCheckNeedsAttention(check)',
  'doctorCheckAttentionId(check)',
  'doctorCheckAttentionSeverity(check)',
  'const runs = runLikeRecordsFromUnknown(input.runs)',
  "import { recordString } from './records'",
]) {
  if (!humanReviewInbox.includes(marker)) {
    fail(`Missing human review inbox marker: ${marker}`);
  }
}
for (const forbidden of [
  'type HumanReviewRunRecord',
  'function isRunRecord',
  'const rawRuns',
  'filter(isRunLikeRecord)',
]) {
  if (humanReviewInbox.includes(forbidden)) {
    fail(`Human review inbox must use shared run record helpers: ${forbidden}`);
  }
}
if (humanReviewInbox.includes("check.status === 'fail' ? 'critical' : 'warning'")) {
  fail('Human review inbox must use shared Doctor check severity helper.');
}

for (const marker of [
  'export function evaluateEvidenceGate',
  'export function evaluateEvidenceGates',
  'export function panelEvidenceGates',
  "import { isProofSensitiveAction, isReviewReadyAction } from './actionSemantics'",
  "gate.status !== 'pass' || isProofSensitiveAction(tickets[gate.ticketKey]?.next_action)",
  'const reviewReady = isReviewReadyAction(ticket.next_action)',
  'No evidence records',
  'evidenceRecordCount, evidenceRiskNotes, evidenceString',
  'const evidenceCount = evidenceRecordCount(ticket)',
  'evidenceRiskNotes(ticket)',
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
  'type QueueRemovalDecisionKind',
  'interface QueueRemovalDecision',
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
  "import { toValidDate } from './dateValues'",
  "const ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused'])",
  "const STALEABLE_ACTIVE_RUN_STATUSES = new Set(['preflight', 'running'])",
  "const SUCCESSFUL_RUN_STATUSES = new Set(['completed', 'waiting_for_review'])",
  "const FAILED_OR_CANCELLED_RUN_STATUSES = new Set(['failed', 'cancelled'])",
  "const FAILED_TERMINAL_RUN_STATUSES = new Set(['failed', 'cancelled', 'needs_human'])",
  'const FINISHED_RUN_STATUSES = new Set([...SUCCESSFUL_RUN_STATUSES, ...FAILED_TERMINAL_RUN_STATUSES])',
  'const DEFAULT_STALE_ACTIVE_RUN_MS = 12 * 60 * 60 * 1000',
  'interface RunStatusLike',
  'export function isActiveRunStatus',
  'export function isSuccessfulRunStatus',
  'export function isFailedOrCancelledRunStatus',
  'export function isFailedTerminalRunStatus',
  'export function isFinishedRunStatus',
  'export function isActiveRun',
  'export function isStaleActiveRun',
  'export function isFreshActiveRun',
  'export function effectiveRunStatus',
  'function hasTerminalRunSignal',
  'export function terminalRunOutcome',
  'function isCancellationEvent',
  'function terminalEventOutcome',
  "recordsFromUnknown(run['events'])",
  'function numericExitCode',
  'processPid?: unknown',
  "if (hasLiveProcess(run['processPid'])) { return false; }",
  'function hasLiveProcess',
  'export function numericPid',
  'process.kill(pid, 0)',
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
  'export const SUCCESSFUL_RUN_STATUSES',
  'export const FINISHED_RUN_STATUSES',
  'export const DEFAULT_STALE_ACTIVE_RUN_MS',
  'export interface RunStatusLike',
  'export function hasTerminalRunSignal',
]) {
  if (runStatus.includes(staleMarker)) {
    fail(`Run status internals should not be exported: ${staleMarker}`);
  }
}

for (const [name, source, marker] of [
  ['src/services/agingReportView.ts', agingReportView, "import { formatWebviewDateTime } from './webviewFormat'"],
  ['src/services/operationsReportPanelView.ts', operationsReportPanelView, "import { formatWebviewDateTime } from './webviewFormat'"],
  ['src/services/ticketPanelView.ts', ticketPanelView, "import { formatWebviewDate, formatWebviewDateTime } from './webviewFormat'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared webview date formatter.`);
  }
  if (source.includes('function formatWebviewDateTime')) {
    fail(`${name} must not carry a local formatWebviewDateTime helper.`);
  }
  if (source.includes('function formatWebviewDate(')) {
    fail(`${name} must not carry a local formatWebviewDate helper.`);
  }
}

for (const marker of [
  "import { isActiveRunStatus } from './runStatus'",
  "import { toValidDate } from './dateValues'",
  'export function runProgressSummary',
  'export function formatRunProgress',
  "import { recordsFromUnknown, recordFromUnknown, recordString } from './records'",
  "import { countLabel } from './countLabels'",
  'function elapsedRunSeconds',
  'function fileCount',
  'function formatElapsed',
  "return recordsFromUnknown(record['events'])",
  "countLabel(toolCalls, 'tool')",
  "countLabel(filesChanged, 'changed', 'changed')",
]) {
  if (!runProgress.includes(marker)) {
    fail(`Missing run progress marker: ${marker}`);
  }
}
if (runProgress.includes('function countLabel')) {
  fail('runProgress must use the shared count label helper.');
}
if (runProgress.includes('filter(isRecord)')) {
  fail('runProgress must use shared record-list normalization.');
}

for (const marker of [
  "import { formatRunProgress } from './runProgress'",
  "import { activeRunSummary, isFreshActiveRun, runStatus } from './runStatus'",
  "import { recordFromUnknown, recordString } from './records'",
  'export function activeRunStatusBarSummary',
  'activeRuns.length === 1',
  'activeRunTooltipLine',
]) {
  if (!activeRunDisplay.includes(marker)) {
    fail(`Missing active run display marker: ${marker}`);
  }
}

for (const marker of [
  'type RunCompletionNotificationKind',
  'interface RunCompletionNotification',
  "import { recordFromUnknown, recordString } from './records'",
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
  "import { optionalTrimmedStringFromUnknown } from './records'",
  'export function runStatusDisplayLabel(status: unknown, fallback = \'unknown\'): string',
  'const value = optionalTrimmedStringFromUnknown(status)',
  "value.replace(/_/g, ' ')",
]) {
  if (!runLabels.includes(marker)) {
    fail(`Missing run label helper marker: ${marker}`);
  }
}
for (const [name, source, marker] of [
  ['src/services/runAttention.ts', runAttention, "import { runStatusDisplayLabel } from './runLabels'"],
  ['src/services/runCompletionNotification.ts', runCompletionNotification, "import { runStatusDisplayLabel } from './runLabels'"],
  ['src/services/runOperatorSummary.ts', runOperatorSummary, "import { runStatusDisplayLabel } from './runLabels'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared run status label helper.`);
  }
  if (/status\.replace\(/.test(source)) {
    fail(`${name} must not format run status labels locally.`);
  }
}
for (const [name, source, marker] of [
  ['src/services/runAttention.ts', runAttention, "import { compactSingleLineText } from './textFormat'"],
  ['src/services/runOperatorSummary.ts', runOperatorSummary, "import { compactSingleLineText } from './textFormat'"],
  ['src/views/ReviewTreeProvider.ts', reviewTreeProvider, "import { compactSingleLineText } from '../services/textFormat'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} must import the shared compact text helper.`);
  }
}
if (!runAttention.includes('return compactSingleLineText(runAttentionDetail(run), maxLength)')) {
  fail('runAttentionLine should use shared compact text helper.');
}
if (!runOperatorSummary.includes('return compactSingleLineText(value, 160)')) {
  fail('runOperatorSummary should use shared compact text helper.');
}
if (!runAttention.includes("import { isFailedTerminalRunStatus } from './runStatus'")) {
  fail('runAttention must import the shared failed terminal run predicate.');
}
if (!runAttention.includes('return isFailedTerminalRunStatus(status)')) {
  fail('runAttention must use the shared failed terminal run predicate for attention status.');
}
if (!runAttention.includes('const eventRecords = recordsFromUnknown(events)')) {
  fail('runAttention must normalize event lists through recordsFromUnknown.');
}
if (runAttention.includes('if (!Array.isArray(events)) { return undefined; }')) {
  fail('runAttention must not open-code event array checks.');
}
if (runAttention.includes('ATTENTION_RUN_STATUSES')) {
  fail('runAttention must not carry a local attention status set.');
}
if (!runOperatorSummary.includes("import { effectiveRunStatus, isActiveRunStatus, isFailedTerminalRunStatus, isSuccessfulRunStatus } from './runStatus'")) {
  fail('runOperatorSummary must import shared success and failed terminal run predicates.');
}
if (!runOperatorSummary.includes("import { recordsFromUnknown, recordFromUnknown, recordString } from './records'")) {
  fail('runOperatorSummary must import shared record-list normalization.');
}
if (!runOperatorSummary.includes("return recordsFromUnknown(record['events'])")) {
  fail('runOperatorSummary run events must use shared record-list normalization.');
}
if (runOperatorSummary.includes('filter(isRecord)')) {
  fail('runOperatorSummary must not normalize event records locally.');
}
if (!runOperatorSummary.includes("if (isFailedTerminalRunStatus(status) || readinessStatus === 'blocked')")) {
  fail('runOperatorSummary bad tone must use the shared failed terminal run predicate.');
}
if (!runOperatorSummary.includes("if (isSuccessfulRunStatus(status) || readinessStatus === 'ready')")) {
  fail('runOperatorSummary good tone must use the shared successful run predicate.');
}
if (!runOperatorSummary.includes("if (!isFailedTerminalRunStatus(status)) { return ''; }")) {
  fail('runOperatorSummary attention summary must use the shared failed terminal run predicate.');
}
if (runOperatorSummary.includes("['failed', 'cancelled', 'needs_human'].includes(status)")) {
  fail('runOperatorSummary must not carry a local failed terminal status list.');
}
if (!reviewTreeProvider.includes('const summary = compactSingleLineText(latest.body, 180)')) {
  fail('ReviewTreeProvider should use shared compact text helper for MR comment summaries.');
}
if (!reviewTreeProvider.includes("import { ticketStringArray } from '../services/ticketFields'") || !reviewTreeProvider.includes('projectNames: ticketStringArray(ticket.projects)') || !reviewTreeProvider.includes("const projs = ticketStringArray(ticket.projects).join(', ') || 'unlinked'")) {
  fail('ReviewTreeProvider should normalize project names through ticketStringArray.');
}
if (reviewTreeProvider.includes('projectNames: ticket.projects || []')) {
  fail('ReviewTreeProvider must not expose raw ticket project arrays.');
}
if (reviewTreeProvider.includes('ticket.projects?.join')) {
  fail('ReviewTreeProvider must not render raw ticket project arrays.');
}
for (const [name, source] of [
  ['src/services/runAttention.ts', runAttention],
  ['src/services/runOperatorSummary.ts', runOperatorSummary],
  ['src/views/ReviewTreeProvider.ts', reviewTreeProvider],
]) {
  if (/replace\(\/\\s\+\/g, ' '\)\.trim\(\)|function compactText/.test(source)) {
    fail(`${name} must not carry local compact text formatting.`);
  }
}

for (const marker of [
  "import { runLikeRecordsFromUnknown } from './runRecords'",
  "import { nonZeroCountLabel } from './countLabels'",
  'export function computeAttentionBadge',
  'function attentionBadgeCount',
  'const runs = runLikeRecordsFromUnknown(input.runs)',
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
if (attentionBadge.includes('function countLabel')) {
  fail('attentionBadge must use the shared count label helper.');
}
if (attentionBadge.includes('Array.isArray(input.runs)')) {
  fail('attentionBadge must use the shared run record normalizer.');
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
  "import { recordEntriesFromUnknown, recordsFromUnknown } from './records'",
  'for (const event of recordsFromUnknown(run.events))',
  'changedFilesForTicket',
  'ticketAreaTokens',
  'isRecentRun',
  'function isCollisionActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean',
  'isStaleActiveRun(run, now, staleActiveRunHours * 60 * 60 * 1000)',
  'sharedFilePaths',
  "import { ticketStringArray } from './ticketFields'",
  'const targetProjects = new Set(ticketStringArray(input.projects))',
  'for (const project of ticketStringArray(target.projects))',
  'const linkedProjects = ticketStringArray(ticket.projects)',
  'const itemProjects = ticketStringArray(item.projects)',
  'const ticketProjects = ticketStringArray(ticket.projects)',
  'for (const label of ticketStringArray(ticket.labels))',
]) {
  if (!collisionDetector.includes(marker)) {
    fail(`Missing collision detector marker: ${marker}`);
  }
}
if (collisionDetector.includes('const events = Array.isArray(run.events) ? run.events : []')) {
  fail('Collision detector must normalize run events through recordsFromUnknown.');
}
if (collisionDetector.includes('target.projects || []') || collisionDetector.includes('input.projects || []') || collisionDetector.includes('ticket.labels || []')) {
  fail('Collision detector must normalize project and label lists through ticketStringArray.');
}
for (const marker of [
  'export const LIVE_MR_DIFF_LIMIT = 4',
  'export const LIVE_MR_DIFF_TIMEOUT_MS = 8000',
  'export interface MergeRequestFileHintOptions',
  "import { mrFileHintCandidateKeys, type MrFileHintTarget } from './collisionDetector'",
  "import { gitlabAdapter } from './integrationAdapters'",
  'mrFileHintCandidateKeys({',
  'loadDiff(state, ticketKey, { timeoutMs })',
  'logWarning(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`))',
]) {
  if (!mergeRequestFileHints.includes(marker)) {
    fail(`Missing merge request file hint marker: ${marker}`);
  }
}

for (const marker of [
  'export interface TicketFilter',
  "import { ticketStringArray } from './ticketFields'",
  'TICKET_FILTER_PRESETS',
  'filterTickets',
  'ticketMatchesFilter',
  'const projects = ticketStringArray(ticket.projects)',
  'const labels = ticketStringArray(ticket.labels)',
  'cleanTicketFilter',
  'setTicketFilterString',
  'ticketFilterPromptFields',
  'ticketFilterChoiceItems',
  'ticketFilterFacetValues',
  '...tickets.flatMap(ticket => ticketStringArray(ticket.projects))',
  'tickets.flatMap(ticket => ticketStringArray(ticket.labels))',
  'uniqueTicketFilterValues',
  'groupTicketEntries',
  'return ticketStringArray(ticket.projects)[0] || \'Unlinked\'',
  '...ticketStringArray(ticket.labels)',
  '...ticketStringArray(ticket.projects)',
  'staleDays',
]) {
  if (!ticketFilters.includes(marker)) {
    fail(`Missing ticket filter marker: ${marker}`);
  }
}
if (ticketFilters.includes('ticket.projects || []') || ticketFilters.includes('ticket.labels || []')) {
  fail('Ticket filters must normalize project and label lists through ticketStringArray.');
}

for (const marker of [
  'interface ScoreBreakdownItem',
  'scoreBreakdown',
  'Queue position',
  'Project link',
  'sumBreakdown',
  'recordQueueDecision',
  'clearQueueDecision',
  'planForMinutes',
  'overnightCandidatePlans',
  'isPlanSuppressed',
  'interface PlannerInput',
  'QueueItem, QueueState, Ticket',
  'queueItem?: QueueItem',
  'export function planToQueueItem(input: PlannerInput, plan: PlannedAction): QueueItem',
  'function releaseKeysForPlan(ticket?: Ticket, queueItem?: unknown): string[]',
  'function releaseField(source: unknown, field: string): unknown',
  "import { arrayFromUnknown, isRecord } from './records'",
  "arrayFromUnknown(releaseField(queueItem, 'labels'))",
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
  "import { countLabel } from './countLabels'",
  "import { evidenceRecordCount } from './evidenceData'",
  'evidenceRecordCount(ticket)',
  "countLabel(ageDays, 'day')",
  "import { ticketStringArray } from './ticketFields'",
  'const itemProjects = ticketStringArray(item.projects)',
  'const ticketProjects = ticketStringArray(ticket.projects)',
  'const normalizedProjects = ticketStringArray(plan.projects)',
  'const projects = ticketStringArray(ticket.projects)',
  'projects: ticketStringArray(ticket.projects)',
  '...ticketStringArray(ticket?.labels)',
  '.filter(plan => ticketStringArray(plan.projects).length > 0)',
]) {
  if (!queuePlanner.includes(marker)) {
    fail(`Missing queue planner marker: ${marker}`);
  }
}
if (queuePlanner.includes('day(s)')) {
  fail('Queue planner must use the shared count label helper for day counts.');
}
if (queuePlanner.includes('export interface PlannerInput')) {
  fail('PlannerInput should stay private to queuePlanner.');
}
if (queuePlanner.includes('function unknownArray')) {
  fail('Queue planner must use the shared array fallback helper.');
}
if (queuePlanner.includes('ticket.projects || []') || queuePlanner.includes('item.projects || []') || queuePlanner.includes('ticket?.labels || []')) {
  fail('Queue planner must normalize project and label lists through ticketStringArray.');
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
  "import { countLabel } from './countLabels'",
  "countLabel(batch.plans.length, 'action')",
  "import { escapeClass, escapeHtml } from './webviewHtml'",
]) {
  if (!queuePlannerPanelView.includes(marker)) {
    fail(`Missing queue planner panel view marker: ${marker}`);
  }
}
if (queuePlannerPanelView.includes('action(s)')) {
  fail('Queue planner panel view must use the shared count label helper for action counts.');
}
if (/\bany\b/.test(queuePlannerPanelView)) {
  fail('Queue planner panel view should keep renderer payloads typed without any.');
}

for (const marker of [
  "import { formatWebviewDateTime } from './webviewFormat'",
  'export function buildAgentQualityScoreHtml',
  'export function buildSessionStatsHtml',
  'export function buildTrendMetricsHtml',
  'export function buildIntegrationManifestHtml',
  'export function buildProfilesHtml',
  'export function buildDoctorHtml',
  'Kronos Agent Quality Score',
  'Kronos Session Stats',
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
  "import { countLabel } from './countLabels'",
  "countLabel(report.runsConsidered, 'run')",
  "countLabel(report.ticketsConsidered, 'ticket')",
  'kronosOperatorPanelCss',
  'actionScriptUri?: string',
  "kronosActionPanelScript(nonce, 'Kronos Session Stats', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Agent Quality Score', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Trend Metrics', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Integration Manifest', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Profiles', actionScriptUri)",
  "kronosActionPanelScript(nonce, 'Kronos Doctor', actionScriptUri)",
]) {
  if (!operationsReportPanelView.includes(marker)) {
    fail(`Missing operations report panel view marker: ${marker}`);
  }
}
if (/\bany\b/.test(operationsReportPanelView)) {
  fail('Operations report panel view should keep renderer payloads typed without any.');
}
for (const forbidden of ['run(s)', 'ticket(s)']) {
  if (operationsReportPanelView.includes(forbidden)) {
    fail(`Operations report panel view must use the shared count label helper instead of ${forbidden}.`);
  }
}

for (const marker of [
  "export type BuildStatusKind = 'pass' | 'fail' | 'other'",
  'const PASSING_BUILD_STATUSES',
  'const FAILING_BUILD_STATUSES',
  'export function normalizedBuildStatus(status: unknown): string',
  'export function buildStatusKind(status: unknown): BuildStatusKind',
  'export function isPassingBuildStatus(status: unknown): boolean',
  'export function isFailingBuildStatus(status: unknown): boolean',
]) {
  if (!buildStatus.includes(marker)) {
    fail(`Missing build status helper marker: ${marker}`);
  }
}

for (const [name, source, marker] of [
  ['agent quality score', agentQualityScore, "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
  ['aging analyzer', agingAnalyzer, "import { isFailingBuildStatus } from './buildStatus'"],
  ['evidence gate', evidenceGate, "import { buildStatusKind } from './buildStatus'"],
  ['post-run readiness', postRunReadiness, "import { isPassingBuildStatus } from './buildStatus'"],
  ['queue planner', queuePlanner, "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
  ['ticket panel view', ticketPanelView, "import { buildStatusKind } from './buildStatus'"],
  ['ticket timeline', ticketTimeline, "import { buildStatusKind } from './buildStatus'"],
  ['ticket tree', ticketTreeProvider, "import { buildStatusKind } from '../services/buildStatus'"],
  ['trend metrics', trendMetrics, "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
]) {
  if (!source.includes(marker)) {
    fail(`${name} should use shared build status helper.`);
  }
}

for (const marker of [
  'export type RunLikeRecord = Record<string, unknown>',
  'export function runLikeRecordsFromUnknown',
  'return recordsFromUnknown(value)',
  'export function hasRetryMetadata',
  "const promptMetadata = run['promptMetadata']",
  "recordString(promptMetadata, 'retryOfRunId')",
]) {
  if (!runRecords.includes(marker)) {
    fail(`Missing run records helper marker: ${marker}`);
  }
}
if (runRecords.includes('export function isRunLikeRecord')) {
  fail('runRecords must not export unused run-like record predicates.');
}

for (const marker of [
  'export function computeAgentQualityScore',
  "import { hasRetryMetadata, runLikeRecordsFromUnknown } from './runRecords'",
  'runs: unknown[]',
  'Run completion',
  'Evidence readiness',
  'Build and review health',
  'Retry discipline',
  "import { countLabel } from './countLabels'",
  "import { isActiveRun, isFailedOrCancelledRunStatus, isSuccessfulRunStatus } from './runStatus'",
  "isSuccessfulRunStatus(recordString(run, 'status'))",
  "isFailedOrCancelledRunStatus(recordString(run, 'status'))",
  'gradeForScore',
  'const runs = runLikeRecordsFromUnknown(input.runs)',
  "import { definedValues, recordString } from './records'",
  "countLabel(totalRuns, 'run')",
  "countLabel(gateFailures, 'failing evidence gate')",
  "countLabel(needsHumanRuns, 'needs-human run')",
  "countLabel(changesRequestedMrs, 'change-requested MR')",
]) {
  if (!agentQualityScore.includes(marker)) {
    fail(`Missing agent quality score marker: ${marker}`);
  }
}
for (const forbidden of [
  'type RunQualityRecord',
  'function hasRetryMetadata',
  'function isRunRecord',
  'filter(isRunLikeRecord)',
  'const SUCCESS_RUN_STATUSES',
]) {
  if (agentQualityScore.includes(forbidden)) {
    fail(`Agent quality score must use shared run record helpers: ${forbidden}`);
  }
}
if (agentQualityScore.includes('type RunQualityRecord = RunRecord & Record<string, any>')) {
  fail('Agent quality run records must preserve unknown extension fields.');
}
for (const forbidden of ['build(s)', 'MR(s)', 'evidence gate(s)', 'run(s)']) {
  if (agentQualityScore.includes(forbidden)) {
    fail(`Agent quality score must use the shared count label helper instead of ${forbidden}.`);
  }
}

for (const marker of [
  'export function readIntegrationManifest',
  'function validateIntegrationManifest',
  'export function auditIntegrationManifest',
  'export function writeIntegrationManifestSnapshot',
  'function buildIntegrationManifestSnapshot',
  'interface ManifestArtifactAudit',
  'sha256File',
  'interface PromptManifestSmokeTest',
  'smoke_tests',
  'INTEGRATION_MANIFEST_FILE',
  'Required script not listed in manifest',
  'Unknown script in manifest',
  "import { countLabel } from './countLabels'",
  "countLabel(passes, 'artifact hash check')",
  "countLabel(warnings, 'warning')",
  "countLabel(failures, 'failure')",
]) {
  if (!integrationManifest.includes(marker)) {
    fail(`Missing integration manifest marker: ${marker}`);
  }
}
for (const forbidden of ['check(s)', 'warning(s)', 'failure(s)']) {
  if (integrationManifest.includes(forbidden)) {
    fail(`Integration manifest must use the shared count label helper instead of ${forbidden}.`);
  }
}

for (const marker of [
  'export interface PromptSmokeTest',
  'export interface PromptSmokeResult',
  'export interface PromptHistorySnapshot',
  'const PROMPT_HISTORY_DIR',
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
  'Rendered prompt still contains one or more unresolved {{VARIABLE}} placeholders.',
]) {
  if (!promptManager.includes(marker)) {
    fail(`Missing prompt manager marker: ${marker}`);
  }
}
if (promptManager.includes('placeholder(s)')) {
  fail('Prompt manager should use plain wording instead of placeholder(s).');
}
if (promptManager.includes('export const PROMPT_HISTORY_DIR')) {
  fail('Prompt history directory should stay private to promptManager.');
}

for (const marker of [
  'const BUILTIN_PROFILES',
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
  "import { formatWebviewDateTime } from './webviewFormat'",
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
  'function jiraCommentEndpoint(jiraBase: string, ticketKey: string): string',
  'rest/api/3/issue/${encodeURIComponent(ticketKey)}/comment',
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
if (evidencePublisher.includes('} catch (e) {')) {
  fail('Evidence publisher caught values must stay explicitly unknown.');
}

for (const marker of [
  'export function computeTrendMetrics',
  'runs: unknown[]',
  'Rework rate',
  'Build pass rate',
  'Verification pass rate',
  'Average cycle time',
  'Review health',
  "import { definedValues, recordEntriesFromUnknown, recordString } from './records'",
  "import { isFailedTerminalRunStatus, isFinishedRunStatus, isSuccessfulRunStatus } from './runStatus'",
  "import { hasRetryMetadata, runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords'",
  "import { countLabel } from './countLabels'",
  'const runs = runLikeRecordsFromUnknown(input.runs)',
  "const finishedRuns = runs.filter(run => isFinishedRunStatus(recordString(run, 'status')))",
  "const completedRuns = finishedRuns.filter(run => isSuccessfulRunStatus(recordString(run, 'status'))).length",
  "const failedRuns = finishedRuns.filter(run => isFailedTerminalRunStatus(recordString(run, 'status'))).length",
  'function cycleTimesHours(tickets: Record<string, Ticket>, runs: RunLikeRecord[]): number[]',
  'evidenceChecks(ticket)',
  'evidenceEnvironmentResults(ticket)',
  "evidenceString(check, 'result')",
  "recordString(run, 'status')",
  "countLabel(finishedRuns.length, 'finished run')",
  "countLabel(changesRequestedMrs, 'change-requested MR')",
  "countLabel(tickets.length, 'active ticket')",
]) {
  if (!trendMetrics.includes(marker)) {
    fail(`Missing trend metrics marker: ${marker}`);
  }
}
for (const forbidden of [
  'runs: any[]',
  'Record<string, any>',
  'type RunMetricRecord',
  'function hasRetryMetadata',
  'const rawRuns',
  'filter(isRunLikeRecord)',
  'const SUCCESS_RUN_STATUSES',
  'const FINISHED_RUN_STATUSES',
  'function isFailedRunStatus',
]) {
  if (trendMetrics.includes(forbidden)) {
    fail(`Trend metrics must normalize raw run payloads instead of using ${forbidden}.`);
  }
}
for (const forbidden of ['run(s)', 'ticket(s)', 'MR(s)', 'build(s)', 'check(s)', 'environment result(s)']) {
  if (trendMetrics.includes(forbidden)) {
    fail(`Trend metrics must use the shared count label helper instead of ${forbidden}.`);
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
  "import { isFreshActiveRun, isSuccessfulRunStatus } from './runStatus'",
  "import { runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords'",
  'const runs = runLikeRecordsFromUnknown(input.runs)',
  'function isDashboardActiveRun',
  'return isFreshActiveRun(run);',
  'function activeRunDetail(run: RunLikeRecord, status: string, ticketKey: string): string',
  'formatRunProgress(run)',
  "runs.filter(run => isSuccessfulRunStatus(recordString(run, 'status')))",
  "recordString(run, 'status')",
  'function runId',
]) {
  if (!dashboardWorklist.includes(marker)) {
    fail(`Missing dashboard worklist marker: ${marker}`);
  }
}
for (const forbidden of [
  'type DashboardRunRecord',
  'function isRunRecord',
  'const rawRuns',
  'filter(isRunLikeRecord)',
  'const COMPLETED_RUN_STATUSES',
]) {
  if (dashboardWorklist.includes(forbidden)) {
    fail(`Dashboard worklist must use shared run record helpers: ${forbidden}`);
  }
}

for (const marker of [
  'export function buildTicketTimeline',
  "import { runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords'",
  "import { isAttentionRunStatus, runAttentionDetail } from './runAttention'",
  "import { isSuccessfulRunStatus } from './runStatus'",
  'const runs = runLikeRecordsFromUnknown(input.runs)',
  'const notes = evidenceNotes(ticket)',
  'const checks = evidenceChecks(ticket)',
  'const environmentResults = evidenceEnvironmentResults(ticket)',
  "recordString(run, 'promptHash')",
  'const attentionDetail = isAttentionRunStatus(status) ? runAttentionDetail(run) :',
  "if (isSuccessfulRunStatus(status)) { return 'success'; }",
  'function runDetail',
]) {
  if (!ticketTimeline.includes(marker)) {
    fail(`Missing ticket timeline marker: ${marker}`);
  }
}
for (const forbidden of [
  'type TimelineRunRecord',
  'function isRunRecord',
  'const rawRuns',
  'filter(isRunLikeRecord)',
]) {
  if (ticketTimeline.includes(forbidden)) {
    fail(`Ticket timeline must use shared run record helpers: ${forbidden}`);
  }
}

for (const marker of [
  'export function evaluatePostRunReadiness',
  'run: unknown',
  "import { runProgressSummary } from './runProgress'",
  "import { evidenceChecks, evidenceNotes, evidenceString } from './evidenceData'",
  "import { arrayFromUnknown, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records'",
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
  "import { escapeRegExp } from './regexp'",
  'const ticketKey = optionalTrimmedStringFromUnknown(input.ticketKey)',
  "runString(record['skill']) === 'implement'",
  "input.ticket.next_action === 'await_review'",
  '!hasRunCompletionEvidence(input.ticket, runId)',
  'function completionEvidenceRunId(record: Record<string, unknown>): string',
  'function hasRunCompletionEvidence(ticket: Ticket, runId: string): boolean',
  'function evidenceCheckMatchesRunCompletion(check: object, runId: string, command: string): boolean',
  'function evidenceNoteMatchesRunCompletion(note: object, runId: string): boolean',
  'function runCompletionEvidenceCommand(runId: string): string',
  'command: runCompletionEvidenceCommand(context.runId)',
  'export function buildRunCompletionEvidenceText',
  'export function buildRunCompletionEvidenceCheck',
  'function runCompletionEvidenceContext(run: unknown, ticket?: Ticket): RunCompletionEvidenceContext',
  'export function postRunReadinessRunPatch',
  'function postRunReadinessStatusTransition',
  'interface RunCompletionEvidenceCheck',
  'function ticketSonarStatus(ticket?: Ticket): string | undefined',
  "import { isPassingBuildStatus } from './buildStatus'",
  'function isPassingSonar',
  'export function classifyRunFailure(run: unknown): RunFailureKind',
  "import { isHandoffAction } from './actionSemantics'",
  "import { isSuccessfulRunStatus, terminalRunOutcome } from './runStatus'",
  'isHandoffAction(input.ticket.next_action)',
  'if (!isSuccessfulRunStatus(runStatus)) { return undefined; }',
  'isSuccessfulRunStatus(status)',
  'claude cli',
  'exitCode === 124',
  "skill.includes('sonar')",
  "skill.includes('verify')",
  "import { arrayFromUnknown, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records'",
  'arrayFromUnknown(value).flatMap',
  'function runString(value: unknown): string',
  'function runText(value: unknown): string | undefined',
  'function runFailureReason(record: Record<string, unknown>): string',
  'function failureSummaryDetail(kind: RunFailureKind, reason: string): string',
  'function runEventDetails(value: unknown): unknown[]',
  'function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined',
  'function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined',
  'function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined',
  'const parsed = optionalFiniteNumberFromUnknown(record[key])',
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
  'const SUCCESS_RUN_STATUSES',
  'const READINESS_STATUS_TRANSITION_RUN_STATUSES',
]) {
  if (postRunReadiness.includes(forbidden)) {
    fail(`Post-run readiness must normalize raw run payloads instead of using ${forbidden}.`);
  }
}

for (const marker of [
  'export const jiraAdapter',
  'export const gitlabAdapter',
  'export const sonarAdapter',
  'interface JiraComment',
  'function normalizeJiraComments',
  "const rawComments = isRecord(value) ? arrayFromUnknown(value['comments']) : arrayFromUnknown(value)",
  'interface MergeRequestStatusResult',
  'export function normalizeMergeRequestStatus',
  'function normalizeMergeRequestComments',
  'function mergeRequestCommentInputs',
  "const notes = arrayFromUnknown(item['notes'])",
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
  'function normalizeSonarBranches',
  'function normalizeSonarBranch',
  "import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records'",
  "const authorRecord = isRecord(value['author']) ? value['author'] : undefined",
  "const str = optionalTrimmedStringFromUnknown(value)",
  'const numeric = optionalFiniteNumberFromUnknown(value)',
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
if (integrationAdapters.includes("Array.isArray(value) ? value : isRecord(value) ? arrayFromUnknown(value['comments']) : []")) {
  fail('Integration adapters must use the shared array fallback helper for Jira comment payloads.');
}
if (integrationAdapters.includes('function stringField(value: unknown): string | undefined')) {
  fail('Integration adapters must use the shared optional trimmed string helper.');
}

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('Security invariants OK.');
