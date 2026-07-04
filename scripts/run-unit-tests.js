const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const trackedTempDirs = new Set();

function makeTempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  trackedTempDirs.add(dir);
  return dir;
}

function cleanupTrackedTempDirs() {
  const dirs = [...trackedTempDirs].sort((a, b) => b.length - a.length);
  trackedTempDirs.clear();
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`Could not remove test temp dir ${dir}:`, e);
    }
  }
}

test.after(cleanupTrackedTempDirs);
process.once('exit', cleanupTrackedTempDirs);

process.env.KRONOS_DIR = makeTempDir('kronos-home-');
process.env.KRONOS_SCRIPTS_DIR = makeTempDir('kronos-scripts-');

function tryCreateSymlink(target, linkPath, type = 'file') {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch {
    return false;
  }
}

function kronosTestPath(...segments) {
  return path.join(process.env.KRONOS_DIR, ...segments);
}

const ACTION_SCRIPT_URI = 'vscode-resource://kronos/action-panel.js';

function readSourceFixture(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8').replace(/\r\n/g, '\n');
}

function mockCommandName(command) {
  return String(command).split(/[\\/]/).pop().replace(/\.(cmd|bat|exe)$/i, '').toLowerCase();
}

function mockCommandLine(command, args) {
  return [mockCommandName(command), ...args].join(' ');
}

function createVscodeTestModule() {
  class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (listener) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(item => item !== listener); } };
      };
    }
    fire(value) { this.listeners.forEach(listener => listener(value)); }
    dispose() { this.listeners = []; }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeColor {
    constructor(id) { this.id = id; }
  }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  class MarkdownString {
    constructor(value) { this.value = value; }
  }
  return {
    vscode: {
      EventEmitter,
      TreeItem,
      ThemeColor,
      ThemeIcon,
      MarkdownString,
      TreeItemCollapsibleState: { None: 0 },
      ViewColumn: { One: 1 },
      window: {
        createWebviewPanel() {
          const disposeListeners = [];
          return {
            webview: { html: '' },
            onDidDispose(listener) {
              disposeListeners.push(listener);
              return { dispose() {} };
            },
            dispose() {
              for (const listener of disposeListeners) {
                listener();
              }
            },
          };
        },
        showWarningMessage() { return Promise.resolve(undefined); },
        showErrorMessage() { return Promise.resolve(undefined); },
        showInformationMessage() { return Promise.resolve(undefined); },
        createTerminal() {
          return { sendText() {}, show() {}, dispose() {} };
        },
      },
      workspace: {
        isTrusted: true,
        getConfiguration() {
          return { get(_key, fallback) { return fallback; } };
        },
        onDidChangeConfiguration() { return { dispose() {} }; },
      },
      env: {
        openExternal() { return Promise.resolve(true); },
        clipboard: {
          writeText() { return Promise.resolve(); },
        },
      },
    },
    EventEmitter,
    TreeItem,
    ThemeColor,
    ThemeIcon,
    MarkdownString,
  };
}

async function withPatchedModuleLoad(resolveReplacement, callback) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    const replacement = resolveReplacement(request);
    if (replacement !== undefined) {
      return replacement;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return await callback();
  } finally {
    Module._load = originalLoad;
  }
}

const promptManager = require('../out/services/promptManager.js');
const promptWorkspaceModel = require('../out/services/promptWorkspaceModel.js');
const stateStore = require('../out/services/stateStore.js');
const queuePlanner = require('../out/services/queuePlanner.js');
const queueDispatchPlan = require('../out/services/queueDispatchPlan.js');
const actionCatalog = require('../out/services/actionCatalog.js');
const actionSemantics = require('../out/services/actionSemantics.js');
const buildStatus = require('../out/services/buildStatus.js');
const severityRank = require('../out/services/severityRank.js');
const records = require('../out/services/records.js');
const dateValues = require('../out/services/dateValues.js');
const regexp = require('../out/services/regexp.js');
const pathUtils = require('../out/services/pathUtils.js');
const jsonFiles = require('../out/services/jsonFiles.js');
const evidenceStore = require('../out/services/evidenceStore.js');
const evidenceCommandInputs = require('../out/services/evidenceCommandInputs.js');
const evidenceHandoff = require('../out/services/evidenceHandoff.js');
const evidencePublisher = require('../out/services/evidencePublisher.js');
const runStore = require('../out/services/runStore.js');
const recoveryCenter = require('../out/services/recoveryCenter.js');
const ticketTimeline = require('../out/services/ticketTimeline.js');
const collisionDetector = require('../out/services/collisionDetector.js');
const mergeRequestFileHints = require('../out/services/mergeRequestFileHints.js');
const scriptClient = require('../out/services/scriptClient.js');
const integrationAdapters = require('../out/services/integrationAdapters.js');
const acceptanceCriteria = require('../out/services/acceptanceCriteria.js');
const humanReviewInbox = require('../out/services/humanReviewInbox.js');
const evidenceGate = require('../out/services/evidenceGate.js');
const evidenceGatePolicy = require('../out/services/evidenceGatePolicy.js');
const queueRemovalPolicy = require('../out/services/queueRemovalPolicy.js');
const agentQualityScore = require('../out/services/agentQualityScore.js');
const dashboardWorklist = require('../out/services/dashboardWorklist.js');
const integrationManifest = require('../out/services/integrationManifest.js');
const profileManager = require('../out/services/profileManager.js');
const projectSelection = require('../out/services/projectSelection.js');
const agingAnalyzer = require('../out/services/agingAnalyzer.js');
const safetyGate = require('../out/services/safetyGate.js');
const trendMetrics = require('../out/services/trendMetrics.js');
const postRunReadiness = require('../out/services/postRunReadiness.js');
const ticketFilters = require('../out/services/ticketFilters.js');
const runRecovery = require('../out/services/runRecovery.js');
const providerReachability = require('../out/services/providerReachability.js');
const ticketMutations = require('../out/services/ticketMutations.js');
const mergeRequestNotifications = require('../out/services/mergeRequestNotifications.js');
const queueMutations = require('../out/services/queueMutations.js');
const projectMutations = require('../out/services/projectMutations.js');
const doctorChecks = require('../out/services/doctorChecks.js');
const stateScriptAdapter = require('../out/services/stateScriptAdapter.js');
const nextActionContext = require('../out/services/nextActionContext.js');
const gitWorkspace = require('../out/services/gitWorkspace.js');
const processTree = require('../out/services/processTree.js');
const webviewDiagnostics = require('../out/services/webviewDiagnostics.js');
const webviewSecurity = require('../out/services/webviewSecurity.js');
const operatorCommandRouting = require('../out/services/operatorCommandRouting.js');
const operatorPanel = require('../out/services/operatorPanel.js');
const reviewNotifications = require('../out/services/reviewNotifications.js');
const promptPanelView = require('../out/services/promptPanelView.js');
const recoveryPanelView = require('../out/services/recoveryPanelView.js');
const humanReviewPanelView = require('../out/services/humanReviewPanelView.js');
const evidencePanelView = require('../out/services/evidencePanelView.js');
const queuePlannerPanelView = require('../out/services/queuePlannerPanelView.js');
const operationsReportPanelView = require('../out/services/operationsReportPanelView.js');
const dashboardPanelView = require('../out/services/dashboardPanelView.js');
const diffPanelView = require('../out/services/diffPanelView.js');
const jiraBoardPanelView = require('../out/services/jiraBoardPanelView.js');
const runStatus = require('../out/services/runStatus.js');
const runProgress = require('../out/services/runProgress.js');
const runRecords = require('../out/services/runRecords.js');
const activeRunDisplay = require('../out/services/activeRunDisplay.js');
const queueActiveRun = require('../out/services/queueActiveRun.js');
const relativeTime = require('../out/services/relativeTime.js');
const runAttention = require('../out/services/runAttention.js');
const runCompletionNotification = require('../out/services/runCompletionNotification.js');
const runCenterSort = require('../out/services/runCenterSort.js');
const runActionHelpers = require('../out/services/runActionHelpers.js');
const attentionBadge = require('../out/services/attentionBadge.js');
const intervalConfig = require('../out/services/intervalConfig.js');
const commandPayloads = require('../out/services/commandPayloads.js');
const cliProbes = require('../out/services/cliProbes.js');
const discoveryQuickPick = require('../out/services/discoveryQuickPick.js');
const webviewMessages = require('../out/services/webviewMessages.js');
const errorUtils = require('../out/services/errorUtils.js');
const combinedVerification = require('../out/services/combinedVerification.js');
const changedFiles = require('../out/services/changedFiles.js');
const reviewWork = require('../out/services/reviewWork.js');
const reviewMonitor = require('../out/services/reviewMonitor.js');
const deployMonitorHandoff = require('../out/services/deployMonitorHandoff.js');
const sonarCommandPlan = require('../out/services/sonarCommandPlan.js');
const sonarReportView = require('../out/services/sonarReportView.js');
const agingReportView = require('../out/services/agingReportView.js');
const ticketPanelView = require('../out/services/ticketPanelView.js');
const webviewHtml = require('../out/services/webviewHtml.js');
const fileNames = require('../out/services/fileNames.js');
const sessionStore = require('../out/services/sessionStore.js');
const worktreeRegistry = require('../out/services/worktreeRegistry.js');
const terminalProfiles = require('../out/services/terminalProfiles.js');

function makeTempProject() {
  const root = makeTempDir('kronos-test-');
  fs.mkdirSync(path.join(root, '.claude', 'prompts'), { recursive: true });
  return root;
}

function baseState(tickets) {
  return {
    version: 1,
    last_updated: null,
    settings: {
      scan_dirs: [],
      overnight: {
        enabled: false,
        max_concurrent: 1,
        max_open_mrs_per_project: 1,
        nightly_implement_cap: 1,
        vpn_check_host: '',
        vpn_check_port: 0,
        vpn_check_interval_sec: 60,
      },
    },
    projects: {
      app: {
        path: '/repo/app',
        priority: 1,
        config: {},
        health: 'green',
        summary: '',
        last_polled: null,
        open_mr_count: 0,
      },
    },
    tickets,
    adhoc_tasks: {},
    overnight: { enabled: false, last_run: null },
    discovered_projects: [],
  };
}

function ticket(overrides) {
  return {
    summary: 'Summary',
    type: 'Story',
    priority: 'Medium',
    jira_status: 'Open',
    source: 'jira',
    projects: ['app'],
    mr: null,
    build: null,
    next_action: 'implement',
    last_action: null,
    last_action_at: null,
    ...overrides,
  };
}

test('file name sanitizer keeps long similar values bounded and distinct', () => {
  const first = fileNames.safeFileStem(`ticket/${'a'.repeat(260)}-one`, { fallback: 'ticket', maxLength: 80 });
  const second = fileNames.safeFileStem(`ticket/${'a'.repeat(260)}-two`, { fallback: 'ticket', maxLength: 80 });

  assert.notEqual(first, second);
  assert.equal(first.length <= 80, true);
  assert.equal(second.length <= 80, true);
  assert.match(first, /^[a-zA-Z0-9_.-]+$/);
  assert.equal(fileNames.safeFileStem('////', { fallback: 'ticket' }), 'ticket');
});

test('prompt manager renders project prompts with metadata and missing variables', () => {
  const project = makeTempProject();
  const promptPath = path.join(project, '.claude', 'prompts', 'alpha.md');
  fs.writeFileSync(promptPath, 'Hello {{NAME}} {{MISSING}} {{NAME}}\n');

  const rendered = promptManager.renderPrompt('alpha', { NAME: 'Ada' }, { projectPath: project });

  assert.equal(rendered.source, 'project');
  assert.equal(rendered.path, promptPath);
  assert.equal(rendered.text, 'Hello Ada {{MISSING}} Ada\n');
  assert.deepEqual(rendered.variables, ['MISSING', 'NAME']);
  assert.deepEqual(rendered.providedVariables, ['NAME']);
  assert.deepEqual(rendered.missingVariables, ['MISSING']);
  assert.match(rendered.templateHash, /^[a-f0-9]{64}$/);
  assert.match(rendered.renderedHash, /^[a-f0-9]{64}$/);
});

test('prompt manager prefers project overrides when listing templates', () => {
  const project = makeTempProject();
  fs.writeFileSync(path.join(project, '.claude', 'prompts', 'override.md'), 'Project {{VALUE}}\n');

  const templates = promptManager.listPromptTemplates(project);
  const found = templates.find(t => t.name === 'override');

  assert.ok(found);
  assert.equal(found.source, 'project');
  assert.deepEqual(found.variables, ['VALUE']);
});

test('prompt manager rejects path-like template names', () => {
  const project = makeTempProject();
  const outsidePromptPath = path.join(project, '.claude', 'outside.md');
  fs.writeFileSync(outsidePromptPath, 'Outside\n');

  assert.throws(
    () => promptManager.renderPrompt('../outside', {}, { projectPath: project }),
    /Invalid prompt template name/,
  );

  const promptDir = path.join(process.env.KRONOS_DIR, 'safe-prompt-repair');
  assert.throws(
    () => promptManager.repairRequiredPromptTemplates(['../outside'], { promptDir }),
    /Invalid prompt template name/,
  );
  assert.equal(fs.existsSync(path.join(process.env.KRONOS_DIR, 'outside.md')), false);
});

test('prompt manager runs default and manifest-style smoke tests', () => {
  const project = makeTempProject();
  fs.writeFileSync(path.join(project, '.claude', 'prompts', 'smoke.md'), 'Ticket {{TICKET_KEY}}\nRun {{COMMAND}}\n');
  const templates = promptManager.listPromptTemplates(project).filter(t => t.name === 'smoke');

  const defaults = promptManager.buildDefaultPromptSmokeTests(templates, { projectPath: project, idPrefix: 'project:test' });
  const defaultResults = promptManager.runPromptSmokeTests(defaults);
  assert.equal(defaultResults[0].status, 'pass');
  assert.match(defaultResults[0].renderedHash, /^[a-f0-9]{64}$/);

  const manifestResults = promptManager.runPromptSmokeTests([
    {
      id: 'manifest:smoke:good',
      templateName: 'smoke',
      projectPath: project,
      variables: { TICKET_KEY: 'K-1', COMMAND: 'npm test' },
      mustContain: ['Ticket K-1'],
      mustNotContain: ['{{'],
      source: 'manifest',
    },
    {
      id: 'manifest:smoke:bad',
      templateName: 'smoke',
      projectPath: project,
      variables: { TICKET_KEY: 'K-1' },
      mustContain: ['missing text'],
      source: 'manifest',
    },
  ]);

  assert.equal(manifestResults[0].status, 'pass');
  assert.equal(manifestResults[1].status, 'fail');
  assert.ok(manifestResults[1].errors.some(error => error.includes('Missing variables')));
  assert.ok(manifestResults[1].errors.some(error => error.includes('expected text')));

  const missingTemplateResults = promptManager.runPromptSmokeTests([{
    id: 'manifest:missing-template',
    templateName: 'missing-template',
    projectPath: project,
    source: 'manifest',
  }]);
  assert.equal(missingTemplateResults[0].status, 'fail');
  assert.ok(missingTemplateResults[0].errors.some(error => error.includes('Prompt template not found')));

  const source = readSourceFixture('src', 'services', 'promptManager.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Prompt smoke test failed')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    "e?.message || 'Prompt smoke test failed'",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('prompt workspace model collects project overrides and manifest smoke tests', () => {
  const projectA = makeTempProject();
  const projectB = makeTempProject();
  fs.writeFileSync(path.join(projectA, '.claude', 'prompts', 'beta.md'), 'Project A {{VALUE}}\n');
  fs.writeFileSync(path.join(projectB, '.claude', 'prompts', 'alpha.md'), 'Project B {{VALUE}}\n');
  fs.mkdirSync(path.join(process.env.KRONOS_DIR, 'prompts'), { recursive: true });
  fs.writeFileSync(path.join(process.env.KRONOS_DIR, 'prompts', 'global-one.md'), 'Global {{GLOBAL}}\n');

  const projects = {
    betaProject: { path: projectB },
    alphaProject: { path: projectA },
    missingProject: {},
  };
  const model = promptWorkspaceModel.buildPromptWorkspaceModel(projects);

  assert.deepEqual(model.projectOverrides.map(item => `${item.project}:${item.template.name}`), [
    'alphaProject:beta',
    'betaProject:alpha',
  ]);
  assert.ok(model.globalTemplates.some(template => template.name === 'global-one'));
  assert.ok(model.smokeTests.some(test => test.id === 'global:global-one'));
  assert.ok(model.smokeTests.some(test => test.id === 'project:alphaProject:beta' && test.projectPath === projectA));
  assert.ok(model.smokeTests.some(test => test.id === 'project:betaProject:alpha' && test.projectPath === projectB));

  const manifestTests = promptWorkspaceModel.buildPromptSmokeTestsForWorkspace(
    projects,
    model.globalTemplates,
    model.projectOverrides,
    {
      prompts: {
        beta: {
          smoke_tests: [{
            name: 'contains',
            variables: { VALUE: 'ok' },
            mustContain: ['ok'],
            mustNotContain: ['bad'],
            allowMissingVariables: true,
          }],
        },
      },
    },
  );
  const manifestTest = manifestTests.find(test => test.id === 'manifest:beta:contains');
  assert.ok(manifestTest);
  assert.deepEqual(manifestTest.variables, { VALUE: 'ok' });
  assert.deepEqual(manifestTest.mustContain, ['ok']);
  assert.deepEqual(manifestTest.mustNotContain, ['bad']);
  assert.equal(manifestTest.allowMissingVariables, true);

  const historyTemplates = promptWorkspaceModel.promptHistoryTemplatesForProjects(projects);
  assert.equal(new Set(historyTemplates.map(template => `${template.source}:${template.name}:${template.path}`)).size, historyTemplates.length);
  assert.ok(historyTemplates.some(template => template.name === 'global-one' && template.source === 'global'));
  assert.ok(historyTemplates.some(template => template.name === 'alpha' && template.source === 'project'));
  assert.ok(historyTemplates.some(template => template.name === 'beta' && template.source === 'project'));

  const source = readSourceFixture('src', 'services', 'promptWorkspaceModel.ts');
  for (const marker of [
    'export function buildPromptWorkspaceModel',
    'export function collectPromptProjectOverrides',
    'export function promptHistoryTemplatesForProjects',
    'export function buildPromptSmokeTestsForWorkspace',
    'readIntegrationManifest().manifest',
    "buildDefaultPromptSmokeTests(globalTemplates, { idPrefix: 'global' })",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('prompt manager snapshots prompt history and diffs metadata changes', () => {
  const project = makeTempProject();
  const alphaPath = path.join(project, '.claude', 'prompts', 'alpha.md');
  const betaPath = path.join(project, '.claude', 'prompts', 'beta.md');
  fs.writeFileSync(alphaPath, 'Alpha {{ONE}}\n');
  fs.writeFileSync(betaPath, 'Beta\n');

  const first = promptManager.createPromptHistorySnapshot(
    promptManager.listPromptTemplates(project),
    { scope: 'test-history', projectPath: project, now: new Date('2026-07-01T10:00:00.000Z') }
  );

  fs.writeFileSync(alphaPath, 'Alpha changed {{ONE}} {{TWO}}\n');
  fs.unlinkSync(betaPath);
  fs.writeFileSync(path.join(project, '.claude', 'prompts', 'gamma.md'), 'Gamma\n');
  const second = promptManager.createPromptHistorySnapshot(
    promptManager.listPromptTemplates(project),
    { scope: 'test-history', projectPath: project, now: new Date('2026-07-01T11:00:00.000Z') }
  );
  const secondPath = path.join(kronosTestPath('prompt-history'), `${second.id}.json`);
  fs.writeFileSync(secondPath, `\ufeff${fs.readFileSync(secondPath, 'utf8')}`, 'utf8');

  const diff = promptManager.diffPromptHistorySnapshots(second, first);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.changed, 1);
  assert.ok(diff.changes.some(change => change.kind === 'changed' && change.name === 'alpha' && change.afterVariables.includes('TWO')));
  assert.ok(fs.existsSync(secondPath));
  assert.equal(promptManager.latestPromptHistorySnapshot('test-history').id, second.id);
});

test('prompt manager keeps long prompt history scopes in distinct snapshot files', () => {
  const project = makeTempProject();
  fs.writeFileSync(path.join(project, '.claude', 'prompts', 'alpha.md'), 'Alpha\n');
  const templates = promptManager.listPromptTemplates(project);
  const commonScope = 'project/'.repeat(40);

  const first = promptManager.createPromptHistorySnapshot(templates, {
    scope: `${commonScope}-one`,
    projectPath: project,
    now: new Date('2026-07-01T12:30:00.000Z'),
  });
  const second = promptManager.createPromptHistorySnapshot(templates, {
    scope: `${commonScope}-two`,
    projectPath: project,
    now: new Date('2026-07-01T12:31:00.000Z'),
  });
  const files = fs.readdirSync(kronosTestPath('prompt-history')).filter(file => file.endsWith('.json'));

  assert.notEqual(first.id, second.id);
  assert.ok(files.some(file => file.includes(first.id.substring(0, 80))));
  assert.ok(files.some(file => file.includes(second.id.substring(0, 80))));
  assert.ok(files.every(file => path.basename(file).length <= 125));
});

test('prompt manager repairs missing required prompt templates without overwriting existing files', () => {
  const promptDir = path.join(process.env.KRONOS_DIR, 'repair-prompts');
  fs.mkdirSync(promptDir, { recursive: true });
  const existingPath = path.join(promptDir, 'verify-local.md');
  fs.writeFileSync(existingPath, 'Custom verify prompt\n');

  const result = promptManager.repairRequiredPromptTemplates(
    ['verify-local', 'sonar-scan', 'verify-combined'],
    { promptDir, now: new Date('2026-07-01T12:00:00.000Z') }
  );

  assert.deepEqual(result.created.sort(), ['sonar-scan', 'verify-combined']);
  assert.deepEqual(result.existing, ['verify-local']);
  assert.equal(fs.readFileSync(existingPath, 'utf8'), 'Custom verify prompt\n');
  assert.match(fs.readFileSync(path.join(promptDir, 'sonar-scan.md'), 'utf8'), /\{\{PROJECT_NAME\}\}/);
  assert.match(fs.readFileSync(path.join(promptDir, 'verify-combined.md'), 'utf8'), /\{\{MERGE_COMMANDS\}\}/);

  const second = promptManager.repairRequiredPromptTemplates(['verify-local', 'sonar-scan'], { promptDir });
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.existing.sort(), ['sonar-scan', 'verify-local']);
});

test('state store validates queue and ticket evidence shapes', () => {
  assert.doesNotThrow(() => stateStore.validateQueueState({
    items: [{
      id: '1',
      ticket: 'K-1',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'implement',
      priority_score: 10,
      reason: 'test',
    }],
    last_computed: null,
    decisions: {
      'K-1:implement': {
        plan_id: 'K-1:implement',
        ticket: 'K-1',
        action: 'implement',
        decision: 'snoozed',
        decided_at: '2026-07-01T00:00:00.000Z',
        snoozed_until: '2026-07-01T01:00:00.000Z',
      },
    },
  }));

  assert.throws(() => stateStore.validateQueueState({ items: [{ id: 'bad', ticket: 'K-1', projects: 'app' }] }), /projects array/);
  assert.throws(() => stateStore.validateQueueState({ items: [{
    id: 'bad',
    ticket: 'K-1',
    projects: ['app'],
    project_path: '/repo/app',
    action: 'implement',
    priority_score: 'high',
    reason: 'bad',
  }] }), /priority_score/);
  assert.throws(() => stateStore.validateQueueState({ items: [], decisions: { bad: { plan_id: 'bad', decision: 'maybe', action: 'implement', decided_at: 'now' } } }), /invalid decision/);
  assert.throws(() => stateStore.validateQueueState({ items: [{
    id: 'bad',
    ticket: 'K-1',
    projects: ['app'],
    project_path: '/repo/app',
    action: 'invented',
    priority_score: 1,
    reason: 'bad',
  }] }), /unsupported action/);
  assert.throws(() => stateStore.validateQueueState({
    items: [],
    decisions: { bad: { plan_id: 'bad', decision: 'rejected', action: 'invented', decided_at: 'now' } },
  }), /unsupported action/);
  assert.doesNotThrow(() => stateStore.validateStateFileShape(baseState({
    'K-1': ticket({
      evidence: {
        notes: [{ at: 'now', kind: 'test', text: 'ok' }],
        acceptance_criteria: [{ id: 'ac-1', text: 'works' }],
        checks: [{ id: 'chk-1', at: 'now', name: 'npm test', result: 'pass' }],
        environment_results: { local: { environment: 'local', status: 'pass', checked_at: 'now', detail: 'smoke passed' } },
        risk_notes: [{ at: 'now', text: 'manual QA still useful', severity: 'medium' }],
      },
    }),
  })));
  assert.doesNotThrow(() => stateStore.validateStateFileShape({
    ...baseState({
      'K-MR': ticket({
        mr: {
          iid: 3,
          state: 'opened',
          review_status: 'pending_review',
          url: 'https://gitlab.example/3',
          comments: [{ id: 'n1', author: 'Reviewer', created: '2026-07-02T01:00:00.000Z', body: 'Please update tests.' }],
          discussion_count: 2,
          unresolved_discussion_count: 1,
          resolved_discussion_count: 1,
          last_discussion_at: '2026-07-02T01:00:00.000Z',
          discussions_resolved: false,
        },
        build: { number: 4, status: 'SUCCESS', url: 'https://jenkins.example/4' },
      }),
    }),
    projects: {
      app: {
        path: '/repo/app',
        priority: 1,
        config: {
          gitlab_project_id: 123,
          sonar_project_key: 'app-key',
          extra_dirs: ['/repo/shared'],
          deploy_approvers: [{ name: 'Ada', id: 'ada', email: 'ada@example.com' }],
        },
        health: 'green',
        summary: '',
        last_polled: null,
        open_mr_count: 0,
      },
    },
  }));
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-1A': ticket({ evidence: 'bad' }),
  })), /evidence must be an object/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-2': ticket({ evidence: { notes: {} } }),
  })), /evidence\.notes/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-2A': ticket({ evidence: { notes: [{ at: 'now', kind: 'bad', text: 'nope' }] } }),
  })), /kind is invalid/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-3': ticket({ evidence: { acceptance_criteria: [{ id: 'bad' }] } }),
  })), /acceptance criterion 0/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-3A': ticket({ evidence: { acceptance_criteria: [{ id: 'bad', text: 'AC', checked: 'yes' }] } }),
  })), /checked must be boolean/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-4': ticket({ evidence: { checks: [{ id: 'bad', result: 'maybe' }] } }),
  })), /evidence check 0/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-4A': ticket({ evidence: { checks: [{ id: 'bad', name: 'check', result: 'pass', confidence: 'certain' }] } }),
  })), /invalid confidence/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-5': ticket({ evidence: { environment_results: { test: { status: 'maybe', detail: 'bad' } } } }),
  })), /environment result test/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-5A': ticket({ evidence: { risk_notes: [{ at: 'now', text: 'risk', severity: 'urgent' }] } }),
  })), /invalid severity/);
  assert.throws(() => stateStore.validateStateFileShape(baseState({
    'K-6': ticket({ next_action: 'invented' }),
  })), /unsupported action/);
  assert.throws(() => stateStore.validateStateFileShape({
    ...baseState({ 'K-7': ticket({}) }),
    projects: { app: { path: '/repo/app', priority: 'high', config: {}, health: 'green', summary: '', last_polled: null, open_mr_count: 0 } },
  }), /project app priority/);
  assert.throws(() => stateStore.validateStateFileShape({
    ...baseState({ 'K-8': ticket({ mr: { iid: 1, state: 'draft', review_status: 'pending_review', url: 'https://gitlab.example/1' } }) }),
  }), /mr\.state/);
  assert.throws(() => stateStore.validateStateFileShape({
    ...baseState({ 'K-9': ticket({ build: { number: '1', status: 'SUCCESS', url: 'https://jenkins.example/1' } }) }),
  }), /build\.number/);
});

test('state store reads UTF-8 BOM-prefixed JSON files from Windows tools', () => {
  const bomState = baseState({
    'K-BOM': ticket({ summary: 'Loaded despite BOM', next_action: 'fix_build' }),
  });
  const bomQueue = {
    items: [{
      id: 'bom-queue',
      ticket: 'K-BOM',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'fix_build',
      priority_score: 99,
      reason: 'PowerShell-written queue file',
    }],
    last_computed: null,
  };

  fs.mkdirSync(path.dirname(stateStore.STATE_FILE), { recursive: true });
  fs.writeFileSync(stateStore.STATE_FILE, `\ufeff${JSON.stringify(bomState, null, 2)}`, 'utf8');
  fs.writeFileSync(stateStore.QUEUE_FILE, `\ufeff${JSON.stringify(bomQueue, null, 2)}`, 'utf8');

  const stateResult = stateStore.readStateFileWithIssues();
  assert.equal(stateResult.issues.length, 0);
  assert.equal(stateResult.state.tickets['K-BOM'].summary, 'Loaded despite BOM');
  assert.equal(stateStore.readQueueFile().items[0].id, 'bom-queue');
});

test('state store lists and restores state backups', () => {
  const original = baseState({
    'K-1': ticket({ summary: 'Original' }),
  });
  const next = baseState({
    'K-2': ticket({ summary: 'Next' }),
  });

  fs.mkdirSync(path.dirname(stateStore.STATE_FILE), { recursive: true });
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(original, null, 2));
  stateStore.writeJsonFileAtomic(stateStore.STATE_FILE, next, 'unit-test-write');

  const backup = stateStore.listBackups().find(entry => entry.targetName === 'state.json');
  assert.ok(backup);
  assert.equal(JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8')).tickets['K-2'].summary, 'Next');
  let auditEvents = stateStore.listStateAuditEvents(5);
  assert.equal(auditEvents[0].action, 'unit-test-write');
  assert.equal(auditEvents[0].target, stateStore.STATE_FILE);
  assert.equal(typeof auditEvents[0].backup, 'string');

  const restored = stateStore.restoreBackup(backup.filePath);
  const restoredState = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  assert.equal(restored.targetName, 'state.json');
  assert.equal(restoredState.tickets['K-1'].summary, 'Original');
  auditEvents = stateStore.listStateAuditEvents(2);
  assert.deepEqual(auditEvents.map(event => event.action), ['restore-state.json', 'unit-test-write']);
});

test('state store write lock blocks concurrent writes and releases after success', () => {
  const next = baseState({
    'K-LOCK': ticket({ summary: 'Locked' }),
  });
  const stateWriteLockFile = path.join(stateStore.KRONOS_DIR, 'state.write.lock');

  fs.mkdirSync(path.dirname(stateWriteLockFile), { recursive: true });
  fs.writeFileSync(stateWriteLockFile, JSON.stringify({ pid: 123, action: 'held', createdAt: new Date().toISOString() }));
  assert.throws(
    () => stateStore.writeJsonFileAtomic(stateStore.STATE_FILE, next, 'blocked-write'),
    /state write lock is held/
  );
  fs.unlinkSync(stateWriteLockFile);

  stateStore.writeJsonFileAtomic(stateStore.STATE_FILE, next, 'locked-write');
  assert.equal(fs.existsSync(stateWriteLockFile), false);
  assert.equal(JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8')).tickets['K-LOCK'].summary, 'Locked');
});

test('state store migrates legacy state shape before validation and reads', () => {
  const legacy = {
    projects: {
      app: {
        path: '/repo/app',
      },
    },
    tickets: {
      'K-1': {
        summary: 'Legacy',
      },
    },
  };

  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(legacy, null, 2));
  const read = stateStore.readStateFile();
  assert.equal(read.version, 1);
  assert.deepEqual(read.settings.scan_dirs, []);
  assert.equal(read.projects.app.health, 'gray');
  assert.equal(read.projects.app.open_mr_count, 0);
  assert.deepEqual(read.tickets['K-1'].projects, []);
  assert.equal(read.tickets['K-1'].type, 'Story');
  assert.equal(read.tickets['K-1'].next_action, 'implement');
  assert.equal(read.tickets['K-1'].priority, 'Medium');
});

test('state store tolerant read reports bad nested records without blanking valid UI state', () => {
  const state = baseState({
    'K-GOOD': ticket({ summary: 'Good ticket' }),
    'K-REPAIRED': ticket({
      projects: ['app', 123],
      build: { number: '77', status: 200, url: 12345 },
      next_action: 'invented',
      evidence: { notes: {} },
    }),
    'K-SKIPPED': ticket({ mr: { iid: 'bad', state: 'draft', review_status: 'pending_review', url: 'https://gitlab.example/mr/1' } }),
  });
  state.projects.app.config = {
    default_branch: 'main',
    gitlab_project_id: '42',
    jenkins_url: 12345,
    extra_dirs: ['/repo/shared', 99],
  };

  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(state, null, 2));
  assert.throws(() => stateStore.readStateFile(), /gitlab_project_id|jenkins_url/);

  const result = stateStore.readStateFileWithIssues();
  assert.ok(result.state);
  assert.equal(result.state.projects.app.config.gitlab_project_id, 42);
  assert.equal(result.state.projects.app.config.jenkins_url, '12345');
  assert.deepEqual(result.state.projects.app.config.extra_dirs, ['/repo/shared']);
  assert.equal(result.state.tickets['K-GOOD'].summary, 'Good ticket');
  assert.equal(result.state.tickets['K-REPAIRED'].next_action, 'implement');
  assert.deepEqual(result.state.tickets['K-REPAIRED'].projects, ['app']);
  assert.equal(result.state.tickets['K-REPAIRED'].build.number, 77);
  assert.equal(result.state.tickets['K-REPAIRED'].build.status, '200');
  assert.equal(result.state.tickets['K-REPAIRED'].build.url, '12345');
  assert.equal(result.state.tickets['K-REPAIRED'].evidence?.notes, undefined);
  assert.equal(result.state.tickets['K-SKIPPED'], undefined);
  assert.ok(result.issues.some(issue => issue.detail.includes('gitlab_project_id was coerced')));
  assert.ok(result.issues.some(issue => issue.detail.includes('Skipped ticket K-SKIPPED')));
});

test('state store load issues normalize unknown errors', () => {
  const source = readSourceFixture('src', 'services', 'stateStore.ts');
  for (const marker of [
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
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    '} catch {}',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('state store migrations keep raw JSON payloads unknown until normalized', () => {
  const source = readSourceFixture('src', 'services', 'stateStore.ts');
  for (const marker of [
    'function migrateStateFileShape(raw: unknown): KronosState',
    'function migrateTicketEvidence(evidence: unknown): TicketEvidence | undefined',
    'function migrateQueueFileShape(raw: unknown): QueueState',
    'function migrateQueueItemShape(item: unknown, idx: number): QueueItem',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'export function migrateStateFileShape(raw: any)',
    'function migrateTicketEvidence(evidence: any): any',
    'export function migrateQueueFileShape(raw: any)',
    'function migrateQueueItemShape(item: any',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('state store validators keep raw JSON payloads unknown while checking shape', () => {
  const source = readSourceFixture('src', 'services', 'stateStore.ts');
  for (const marker of [
    'type MutableStateRecord = Record<string, unknown>',
    'interface StateWriteLock',
    'function requirePlainRecord(value: unknown, message: string): MutableStateRecord',
    'function repairProjectRecord(name: string, project: unknown, issues: StateFileLoadIssue[]): void',
    'function repairProjectConfig(config: unknown, label: string, issues: StateFileLoadIssue[]): void',
    'function repairTicketRecord(key: string, ticket: unknown, issues: StateFileLoadIssue[]): void',
    'function repairMergeRequest(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
    'function repairBuildStatus(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
    'function repairTicketEvidence(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void',
    'export function validateStateFileShape(raw: unknown): void',
    'function validateProjectConfig(config: unknown, label: string): void',
    'function readCurrentWriteLock(): StateWriteLock | null',
    "const evidenceValue = t['evidence']",
    "const environmentResults = evidence['environment_results']",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
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
    assert.equal(source.includes(marker), false, marker);
  }
  assert.equal(/\bany\b/.test(source), false, 'stateStore should use unknown plus guards instead of any');
});

test('KronosState load issues normalize unknown errors', () => {
  const source = readSourceFixture('src', 'state', 'KronosState.ts');
  for (const marker of [
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
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    '} catch {}',
    'export function migrateStateFileShape',
    'export function migrateQueueFileShape',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('state store migrates legacy queue shape before validation and reads', () => {
  const legacyQueue = {
    items: [
      { ticket: 'K-1', project: 'app', action: 'verify' },
      { ticket: 'K-2', projects: 'api', path: '/repo/api' },
    ],
  };

  fs.writeFileSync(stateStore.QUEUE_FILE, JSON.stringify(legacyQueue, null, 2));
  const read = stateStore.readQueueFile();
  assert.equal(read.last_computed, null);
  assert.equal(read.items[0].id, 'queued-K-1-0');
  assert.deepEqual(read.items[0].projects, ['app']);
  assert.equal(read.items[0].priority_score, 0);
  assert.equal(read.items[1].project_path, '/repo/api');
  assert.deepEqual(read.items[1].projects, ['api']);
  assert.equal(read.items[0].action, 'verify');
  assert.equal(read.items[1].reason, 'Migrated queue item for K-2');
});

test('state store restores queue backups with queue validation', () => {
  const originalQueue = {
    items: [{
      id: 'q1',
      ticket: 'K-1',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'implement',
      priority_score: 1,
      reason: 'original',
    }],
    last_computed: null,
  };
  const nextQueue = {
    items: [{
      id: 'q2',
      ticket: 'K-2',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'verify',
      priority_score: 2,
      reason: 'next',
    }],
    last_computed: null,
  };

  fs.mkdirSync(path.dirname(stateStore.QUEUE_FILE), { recursive: true });
  fs.writeFileSync(stateStore.QUEUE_FILE, JSON.stringify(originalQueue, null, 2));
  stateStore.writeJsonFileAtomic(stateStore.QUEUE_FILE, nextQueue, 'unit-test-queue-write');

  const backup = stateStore.listBackups().find(entry => entry.targetName === 'queue.json');
  assert.ok(backup);
  stateStore.restoreBackup(backup.filePath);
  const restoredQueue = JSON.parse(fs.readFileSync(stateStore.QUEUE_FILE, 'utf8'));
  assert.equal(restoredQueue.items[0].id, 'q1');
});

test('ticket mutation helpers centralize evidence, acceptance, and MR state writes', () => {
  const initial = baseState({
    'K-1': ticket({
      summary: 'Evidence target',
      evidence: {
        acceptance_criteria: [
          { id: 'ac-1', text: 'First AC' },
          { id: 'ac-2', text: 'Second AC', checked: true },
        ],
      },
    }),
    'K-RUN': ticket({
      summary: 'Completion evidence target',
      next_action: 'await_review',
      projects: ['app'],
    }),
    'orphan-99': ticket({
      summary: 'Orphan MR',
      projects: ['app', 'api'],
      mr: { iid: 99, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/99' },
    }),
  });
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(initial, null, 2));

  ticketMutations.addTicketEvidenceNote('K-1', {
    kind: 'risk',
    text: 'Manual QA should verify timeout copy',
    now: new Date('2026-07-01T01:00:00.000Z'),
  });
  ticketMutations.addTicketEvidenceCheck('K-1', {
    name: 'npm test',
    result: 'pass',
    environment: 'local',
    command: 'npm test',
    summary: 'all green',
    artifactPath: '',
    confidence: 'high',
    now: new Date('2026-07-01T01:05:00.000Z'),
  });
  ticketMutations.addTicketRunCompletionEvidence('K-RUN', {
    note: {
      kind: 'note',
      text: 'Kronos implement run run-atomic completed.',
      now: new Date('2026-07-01T01:07:00.000Z'),
    },
    check: {
      name: 'Kronos implement completion',
      result: 'pass',
      environment: 'kronos',
      command: 'kronos run run-atomic',
      summary: 'run run-atomic completed; 1 changed file',
      confidence: 'high',
      now: new Date('2026-07-01T01:07:00.000Z'),
    },
  });
  ticketMutations.recordTicketEnvironmentResult('K-1', {
    environment: 'test',
    status: 'warn',
    detail: 'smoke pending a manual browser pass',
    now: new Date('2026-07-01T01:10:00.000Z'),
  });
  ticketMutations.updateTicketAcceptanceCriteria('K-1', ['ac-1'], new Date('2026-07-01T01:15:00.000Z'));
  ticketMutations.replaceTicketAcceptanceCriteria('K-1', [
    { id: 'ac-new', text: 'Replacement AC', checked: true },
  ], new Date('2026-07-01T01:20:00.000Z'));

  const beforeLink = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  const preview = ticketMutations.previewLinkMergeRequestToTicket(beforeLink, {
    orphanKey: 'orphan-99',
    targetTicketKey: 'K-1',
    jiraBaseUrl: 'https://jira.example',
  });
  assert.equal(preview.reviewReady, true);
  assert.equal(preview.ticket.next_action, 'await_review');
  assert.equal(preview.ticket.mr.iid, 99);
  assert.ok(preview.ticket.projects.includes('api'));
  assert.equal(beforeLink.tickets['K-1'].mr, null);
  const handoffDecision = evidenceGatePolicy.decideEvidenceHandoff('K-1', preview.ticket);
  assert.equal(handoffDecision.allowed, true);
  assert.equal(handoffDecision.requiresConfirmation, true);
  assert.match(handoffDecision.message, /review handoff warnings/);

  assert.throws(() => ticketMutations.linkMergeRequestToTicket({
    orphanKey: 'orphan-99',
    targetTicketKey: 'K-1',
    jiraBaseUrl: 'https://jira.example',
  }), /allowReviewHandoffWithWarnings/);

  ticketMutations.linkMergeRequestToTicket({
    orphanKey: 'orphan-99',
    targetTicketKey: 'K-1',
    jiraBaseUrl: 'https://jira.example',
    allowReviewHandoffWithWarnings: true,
  });

  const persisted = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  const target = persisted.tickets['K-1'];
  assert.equal(target.evidence.notes[0].kind, 'risk');
  assert.equal(target.evidence.risk_notes[0].severity, 'medium');
  assert.equal(target.evidence.checks[0].name, 'npm test');
  assert.equal(target.evidence.checks[0].artifact_path, undefined);
  assert.equal(target.evidence.environment_results.test.status, 'warn');
  assert.deepEqual(target.evidence.acceptance_criteria, [
    { id: 'ac-new', text: 'Replacement AC', checked: true },
  ]);
  assert.equal(target.mr.iid, 99);
  assert.ok(target.projects.includes('api'));
  assert.equal(persisted.tickets['orphan-99'], undefined);
  assert.equal(persisted.tickets['K-RUN'].evidence.notes[0].text, 'Kronos implement run run-atomic completed.');
  assert.equal(persisted.tickets['K-RUN'].evidence.checks[0].name, 'Kronos implement completion');
  assert.equal(persisted.tickets['K-RUN'].evidence.checks[0].command, 'kronos run run-atomic');
  assert.equal(persisted.tickets['K-RUN'].evidence.updated_at, '2026-07-01T01:07:00.000Z');

  const failingPreview = ticketMutations.previewLinkMergeRequestToTicket(baseState({
    'K-2': ticket({ projects: ['app'] }),
    'orphan-100': ticket({
      summary: 'No proof MR',
      projects: ['app'],
      mr: { iid: 100, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/100' },
    }),
  }), {
    orphanKey: 'orphan-100',
    targetTicketKey: 'K-2',
  });
  const blockedDecision = evidenceGatePolicy.decideEvidenceHandoff('K-2', failingPreview.ticket);
  assert.equal(blockedDecision.allowed, false);
  assert.equal(blockedDecision.requiresConfirmation, false);
  assert.ok(blockedDecision.blockingChecks.some(check => check.title === 'No evidence records'));
  assert.match(blockedDecision.message, /not ready for review handoff/);
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(baseState({
    'K-2': ticket({ projects: ['app'] }),
    'orphan-100': ticket({
      summary: 'No proof MR',
      projects: ['app'],
      mr: { iid: 100, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/100' },
    }),
  }), null, 2));
  assert.throws(() => ticketMutations.linkMergeRequestToTicket({
    orphanKey: 'orphan-100',
    targetTicketKey: 'K-2',
    allowReviewHandoffWithWarnings: true,
  }), /not ready for review handoff/);

  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(baseState({
    'K-5': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 5, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/5' },
    }),
    'K-6': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 6, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/6' },
    }),
  }), null, 2));
  const statusUpdate = ticketMutations.updateTicketMergeRequestStatus({
    ticketKey: 'K-5',
    status: {
      state: 'merged',
      review_status: 'approved',
      title: 'Fix checkout',
      source_branch: 'feature/K-5',
      comment_count: 2,
      last_comment_at: '2026-07-02T01:00:00.000Z',
      discussion_count: 2,
      unresolved_discussion_count: 1,
      resolved_discussion_count: 1,
      last_discussion_at: '2026-07-02T01:00:00.000Z',
      discussions_resolved: false,
      comments: [
        { id: '2', author: 'Reviewer', created: '2026-07-02T01:00:00.000Z', body: 'Please add a Windows check.' },
        { id: '1', author: 'Reviewer', created: '2026-07-02T00:30:00.000Z', body: 'Looks close.' },
      ],
    },
    now: new Date('2026-07-02T01:05:00.000Z'),
  });
  assert.equal(statusUpdate.changed, true);
  assert.equal(statusUpdate.mergedNow, true);
  assert.equal(statusUpdate.previousMr.state, 'opened');
  assert.equal(statusUpdate.ticket.next_action, 'deploy_monitor');
  assert.equal(statusUpdate.ticket.last_action_at, '2026-07-02T01:05:00.000Z');
  const updatedMrTicket = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8')).tickets['K-5'];
  assert.equal(updatedMrTicket.mr.state, 'merged');
  assert.equal(updatedMrTicket.mr.review_status, 'approved');
  assert.equal(updatedMrTicket.mr.comment_count, 2);
  assert.equal(updatedMrTicket.mr.unresolved_discussion_count, 1);
  assert.equal(updatedMrTicket.mr.discussions_resolved, false);
  assert.deepEqual(updatedMrTicket.mr.comments.map(comment => comment.body), ['Looks close.', 'Please add a Windows check.']);
  assert.equal(updatedMrTicket.next_action, 'deploy_monitor');
  const noChange = ticketMutations.updateTicketMergeRequestStatus({
    ticketKey: 'K-5',
    status: {
      state: 'merged',
      review_status: 'approved',
      title: 'Fix checkout',
      source_branch: 'feature/K-5',
      comment_count: 2,
      last_comment_at: '2026-07-02T01:00:00.000Z',
      discussion_count: 2,
      unresolved_discussion_count: 1,
      resolved_discussion_count: 1,
      last_discussion_at: '2026-07-02T01:00:00.000Z',
      discussions_resolved: false,
      comments: [
        { id: '1', author: 'Reviewer', created: '2026-07-02T00:30:00.000Z', body: 'Looks close.' },
        { id: '2', author: 'Reviewer', created: '2026-07-02T01:00:00.000Z', body: 'Please add a Windows check.' },
      ],
    },
  });
  assert.equal(noChange.changed, false);
  assert.equal(noChange.mergedNow, false);
  assert.equal(noChange.closedNow, false);
  const closedUpdate = ticketMutations.updateTicketMergeRequestStatus({
    ticketKey: 'K-6',
    status: {
      state: 'closed',
      review_status: 'changes_requested',
    },
    now: new Date('2026-07-02T02:05:00.000Z'),
  });
  assert.equal(closedUpdate.changed, true);
  assert.equal(closedUpdate.mergedNow, false);
  assert.equal(closedUpdate.closedNow, true);
  assert.equal(closedUpdate.ticket.next_action, 'blocked');
  assert.equal(closedUpdate.ticket.last_action, 'MR !6 closed; human review is needed.');
  const closedMrTicket = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8')).tickets['K-6'];
  assert.equal(closedMrTicket.mr.state, 'closed');
  assert.equal(closedMrTicket.mr.review_status, 'changes_requested');
  assert.equal(closedMrTicket.next_action, 'blocked');

  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(baseState({
    'K-7': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 7, state: 'merged', review_status: 'approved', url: 'https://gitlab.example/mr/7' },
    }),
    'K-8': ticket({
      projects: ['app'],
      next_action: 'deploy_monitor',
      mr: { iid: 8, state: 'merged', review_status: 'approved', url: 'https://gitlab.example/mr/8' },
    }),
    'K-9': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 9, state: 'closed', review_status: 'changes_requested', url: 'https://gitlab.example/mr/9' },
    }),
    'K-10': ticket({
      projects: ['app'],
      next_action: 'blocked',
      mr: { iid: 10, state: 'closed', review_status: 'changes_requested', url: 'https://gitlab.example/mr/10' },
    }),
  }), null, 2));
  const terminalReconciliations = ticketMutations.reconcileTerminalMergeRequestState({
    now: new Date('2026-07-02T03:05:00.000Z'),
  });
  assert.deepEqual(terminalReconciliations.map(item => `${item.ticketKey}:${item.action}:${item.changed}`), [
    'K-7:deploy_monitor:true',
    'K-8:deploy_monitor:false',
    'K-9:blocked:true',
  ]);
  const reconciledTerminalState = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8')).tickets;
  assert.equal(reconciledTerminalState['K-7'].next_action, 'deploy_monitor');
  assert.equal(reconciledTerminalState['K-7'].last_action, 'MR !7 merged; deploy monitor is next.');
  assert.equal(reconciledTerminalState['K-7'].last_action_at, '2026-07-02T03:05:00.000Z');
  assert.equal(reconciledTerminalState['K-8'].next_action, 'deploy_monitor');
  assert.equal(reconciledTerminalState['K-8'].last_action, null);
  assert.equal(reconciledTerminalState['K-9'].next_action, 'blocked');
  assert.equal(reconciledTerminalState['K-9'].last_action, 'MR !9 closed; human review is needed.');
  assert.equal(reconciledTerminalState['K-10'].next_action, 'blocked');
});

test('merge request notifications summarize review status and new comment changes without duplicate terminal alerts', () => {
  const baseUpdate = {
    changed: true,
    mergedNow: false,
    closedNow: false,
    previousMr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
    ticket: ticket({
      mr: { iid: 1, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/1' },
    }),
  };

  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-1', baseUpdate), {
    severity: 'info',
    message: 'K-1: MR !1 approved.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-2', {
    ...baseUpdate,
    previousMr: { iid: 2, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/2' },
    ticket: ticket({
      mr: { iid: 2, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/2' },
    }),
  }), {
    severity: 'warning',
    message: 'K-2: MR !2 changes requested.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-3', {
    ...baseUpdate,
    previousMr: { iid: 3, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/3', comment_count: 2 },
    ticket: ticket({
      mr: { iid: 3, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/3', comment_count: 4 },
    }),
  }), {
    severity: 'info',
    message: 'K-3: MR !3 2 new MR comments.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4', {
    ...baseUpdate,
    previousMr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/4', last_comment_at: '2026-07-02T01:00:00.000Z' },
    ticket: ticket({
      mr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/4', last_comment_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    severity: 'info',
    message: 'K-4: MR !4 new MR comment.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4B', {
    ...baseUpdate,
    previousMr: { iid: 41, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/41', comment_count: 2, last_comment_at: '2026-07-02T01:00:00.000Z' },
    ticket: ticket({
      mr: { iid: 41, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/41', last_comment_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    severity: 'info',
    message: 'K-4B: MR !41 new MR comment.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4C', {
    ...baseUpdate,
    previousMr: { iid: 42, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/42', unresolved_discussion_count: 1 },
    ticket: ticket({
      mr: { iid: 42, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/42', unresolved_discussion_count: 3 },
    }),
  }), {
    severity: 'warning',
    message: 'K-4C: MR !42 2 new unresolved MR discussions.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4D', {
    ...baseUpdate,
    previousMr: { iid: 43, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/43', unresolved_discussion_count: 2 },
    ticket: ticket({
      mr: { iid: 43, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/43', unresolved_discussion_count: 0 },
    }),
  }), {
    severity: 'info',
    message: 'K-4D: MR !43 all MR discussions resolved.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4E', {
    ...baseUpdate,
    previousMr: { iid: 44, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/44', unresolved_discussion_count: 1, last_discussion_at: '2026-07-02T01:00:00.000Z' },
    ticket: ticket({
      mr: { iid: 44, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/44', unresolved_discussion_count: 1, last_discussion_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    severity: 'info',
    message: 'K-4E: MR !44 new MR discussion activity.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-4F', {
    ...baseUpdate,
    previousMr: { iid: 45, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/45' },
    ticket: ticket({
      mr: { iid: 45, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/45', last_discussion_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    severity: 'info',
    message: 'K-4F: MR !45 new MR discussion activity.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-5', {
    ...baseUpdate,
    previousMr: { iid: 5, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/5' },
    ticket: ticket({
      mr: { iid: 5, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/5', comment_count: 3 },
    }),
  }), {
    severity: 'info',
    message: 'K-5: MR !5 3 MR comments now tracked.',
  });
  assert.deepEqual(mergeRequestNotifications.describeMergeRequestStatusChange('K-5B', {
    ...baseUpdate,
    previousMr: { iid: 51, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/51' },
    ticket: ticket({
      mr: { iid: 51, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/51', last_comment_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    severity: 'info',
    message: 'K-5B: MR !51 new MR comment.',
  });
  assert.equal(mergeRequestNotifications.describeMergeRequestStatusChange('K-6', { ...baseUpdate, mergedNow: true }), null);
  assert.equal(mergeRequestNotifications.describeMergeRequestStatusChange('K-7', { ...baseUpdate, closedNow: true }), null);
});

test('review monitor decisions route merged, closed, comment, and no-op MR polls', () => {
  const baseUpdate = {
    changed: true,
    mergedNow: false,
    closedNow: false,
    previousMr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
    ticket: ticket({
      mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
    }),
  };

  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-1', {
    ...baseUpdate,
    mergedNow: true,
  }), {
    kind: 'deploy_monitor',
  });
  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-2', {
    ...baseUpdate,
    closedNow: true,
  }), {
    kind: 'blocked',
    severity: 'warning',
    message: 'K-2 MR closed - ticket moved to blocked.',
    url: 'https://gitlab.example/1',
  });
  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-3', {
    ...baseUpdate,
    previousMr: { iid: 3, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/3', comment_count: 1 },
    ticket: ticket({
      mr: { iid: 3, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/3', comment_count: 2 },
    }),
  }), {
    kind: 'notify',
    severity: 'info',
    message: 'K-3: MR !3 1 new MR comment.',
    url: 'https://gitlab.example/3',
  });
  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-4', {
    ...baseUpdate,
    previousMr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/4', unresolved_discussion_count: 0 },
    ticket: ticket({
      mr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/4', unresolved_discussion_count: 2 },
    }),
  }), {
    kind: 'notify',
    severity: 'warning',
    message: 'K-4: MR !4 2 new unresolved MR discussions.',
    url: 'https://gitlab.example/4',
  });
  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-4B', {
    ...baseUpdate,
    previousMr: { iid: 41, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/41', unresolved_discussion_count: 1, last_discussion_at: '2026-07-02T01:00:00.000Z' },
    ticket: ticket({
      mr: { iid: 41, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/41', unresolved_discussion_count: 1, last_discussion_at: '2026-07-02T02:00:00.000Z' },
    }),
  }), {
    kind: 'notify',
    severity: 'info',
    message: 'K-4B: MR !41 new MR discussion activity.',
    url: 'https://gitlab.example/41',
  });
  assert.deepEqual(reviewMonitor.decideReviewMonitorAction('K-5', baseUpdate), {
    kind: 'none',
  });
  assert.equal(reviewMonitor.reviewDeployMonitorActionHandled('started'), true);
  assert.equal(reviewMonitor.reviewDeployMonitorActionHandled('handled'), true);
  assert.equal(reviewMonitor.reviewDeployMonitorActionHandled('blocked'), true);
  assert.equal(reviewMonitor.reviewDeployMonitorActionHandled('failed'), false);
  assert.equal(reviewMonitor.reviewTerminalMergeRequestActionKey('K-1', 13, 'deploy_monitor'), 'K-1:13:deploy_monitor');
  assert.equal(reviewMonitor.reviewTerminalMergeRequestActionKey('K-2', '  14  ', 'blocked'), 'K-2:14:blocked');
  assert.equal(reviewMonitor.reviewTerminalMergeRequestActionKey('K-3', undefined, 'blocked'), 'K-3:mr:blocked');
});

test('deploy monitor handoff resolves projects and only suppresses handled runs', () => {
  const state = baseState({});
  state.projects.api = {
    path: '/repo/api',
    priority: 1,
    config: {},
    health: 'green',
    summary: '',
    last_polled: null,
    open_mr_count: 0,
  };
  const merged = ticket({
    projects: ['app'],
    next_action: 'deploy_monitor',
    mr: { iid: 13, state: 'merged', review_status: 'approved', url: 'https://gitlab.example/mr/13' },
  });

  assert.deepEqual(deployMonitorHandoff.resolveDeployMonitorProject(state, 'K-13', merged), {
    kind: 'ok',
    projectName: 'app',
    projectPath: '/repo/app',
  });
  assert.deepEqual(deployMonitorHandoff.resolveDeployMonitorProject(state, 'K-DUPE', ticket({ projects: [' ', 'app', 'app'], mr: merged.mr })), {
    kind: 'ok',
    projectName: 'app',
    projectPath: '/repo/app',
  });
  assert.match(
    deployMonitorHandoff.resolveDeployMonitorProject(state, 'K-NO-PROJECT', ticket({ projects: [], mr: merged.mr })).reason,
    /no linked project/,
  );
  assert.match(
    deployMonitorHandoff.resolveDeployMonitorProject(state, 'K-MULTI', ticket({ projects: ['app', 'api'], mr: merged.mr })).reason,
    /multiple projects \(app, api\)/,
  );
  assert.match(
    deployMonitorHandoff.resolveDeployMonitorProject(state, 'K-MISSING', ticket({ projects: ['missing'], mr: merged.mr })).reason,
    /missing has no registered path/,
  );

  const match = { projectName: 'app', projectPath: '/repo/app', ticketKey: 'K-13', mrIid: 13 };
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'running', promptMetadata: { mergeRequestIid: 13 } },
  ], match), true);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'completed', promptMetadata: { mergeRequestIid: 13 } },
  ], match), true);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', projectPath: '/repo/app/', status: 'completed', promptMetadata: { mergeRequestIid: 13 } },
  ], match), true);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', projectPath: '\\repo\\app\\', status: 'completed', promptMetadata: { mergeRequestIid: 13 } },
  ], match), true);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'failed', promptMetadata: { mergeRequestIid: 13 } },
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'needs_human', promptMetadata: { mergeRequestIid: 13 } },
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'cancelled', promptMetadata: { mergeRequestIid: 13 } },
  ], match), false);
  assert.match(deployMonitorHandoff.deployMonitorAttentionIssue([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'failed', failureReason: 'Jenkins build failed', promptMetadata: { mergeRequestIid: 13 } },
  ], match), /K-13 merged, but a prior deploy monitor failed: Jenkins build failed/);
  assert.match(deployMonitorHandoff.deployMonitorAttentionIssue([
    { skill: 'deploy-monitor', ticket: 'K-13', projectPath: '/repo/app', status: 'needs_human', failureReason: 'manual deploy check required', promptMetadata: { mergeRequestIid: 13 } },
  ], match), /prior deploy monitor needs human review: Needs human review: manual deploy check required/);
  assert.match(deployMonitorHandoff.deployMonitorAttentionIssue([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'cancelled', failureReason: 'operator cancelled retry', promptMetadata: { mergeRequestIid: 13 } },
  ], match), /prior deploy monitor was cancelled: operator cancelled retry/);
  assert.equal(deployMonitorHandoff.deployMonitorAttentionIssue([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'completed', promptMetadata: { mergeRequestIid: 13 } },
  ], match), undefined);
  assert.equal(deployMonitorHandoff.deployMonitorAttentionIssue([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'failed', promptMetadata: { mergeRequestIid: 99 } },
  ], match), undefined);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'completed', promptMetadata: { mergeRequestIid: 99 } },
  ], match), false);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'completed' },
  ], match), false);
  assert.equal(deployMonitorHandoff.hasHandledDeployMonitorRun([
    { skill: 'deploy-monitor', ticket: 'K-13', project: 'app', status: 'completed' },
  ], { projectName: 'app', projectPath: '/repo/app', ticketKey: 'K-13' }), true);

  const issueTicket = ticket({
    mr: merged.mr,
    evidence: {
      checks: [{
        id: 'check-1',
        at: '2026-07-03T01:00:00.000Z',
        name: 'Deploy monitor handoff MR !13',
        result: 'fail',
        confidence: 'high',
        summary: 'deploy monitor did not start',
      }, {
        id: 'check-2',
        at: '2026-07-03T01:05:00.000Z',
        name: 'Deploy monitor handoff MR !13',
        result: 'fail',
        confidence: 'high',
        summary: 'project path missing',
      }],
    },
  });
  assert.equal(deployMonitorHandoff.deployMonitorHandoffCheckName(issueTicket), 'Deploy monitor handoff MR !13');
  assert.equal(deployMonitorHandoff.hasDeployMonitorHandoffIssue(issueTicket, 'deploy monitor did not start'), true);
  assert.equal(deployMonitorHandoff.hasDeployMonitorHandoffIssue(issueTicket, 'project path missing'), true);
  assert.equal(deployMonitorHandoff.hasDeployMonitorHandoffIssue(issueTicket, 'different failure'), false);
  assert.equal(deployMonitorHandoff.hasDeployMonitorHandoffIssue(ticket({ mr: merged.mr }), 'deploy monitor did not start'), false);
});

test('queue mutation helpers centralize queue membership and ticket project links', () => {
  const initial = baseState({
    'K-1': ticket({
      projects: ['app'],
      next_action: 'verify',
      priority: 'High',
      evidence: { notes: [{ at: 'now', kind: 'test', text: 'smoke passed' }] },
    }),
    'K-2': ticket({
      projects: ['app'],
      next_action: 'implement',
      priority: 'Medium',
    }),
  });
  initial.projects.api = {
    path: '/repo/api',
    priority: 2,
    config: {},
    health: 'green',
    summary: '',
    last_polled: null,
    open_mr_count: 0,
  };
  fs.mkdirSync(path.dirname(stateStore.STATE_FILE), { recursive: true });
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(initial, null, 2));
  fs.writeFileSync(stateStore.QUEUE_FILE, JSON.stringify({ items: [], last_computed: null }, null, 2));

  const added = queueMutations.addTicketToQueue('K-1');
  assert.equal(added.added, true);
  assert.equal(added.alreadyInQueue, false);
  assert.equal(added.item.ticket, 'K-1');
  assert.equal(added.item.action, 'verify');
  assert.equal(added.item.project_path, '/repo/app');
  const duplicate = queueMutations.addTicketToQueue('K-1');
  assert.equal(duplicate.alreadyInQueue, true);
  const queued = JSON.parse(fs.readFileSync(stateStore.QUEUE_FILE, 'utf8'));
  assert.equal(queued.items.length, 1);
  const next = queueMutations.selectNextQueueItem();
  assert.equal(next.empty, false);
  assert.equal(next.item.ticket, 'K-1');
  assert.equal(next.item.action, 'verify');

  const linked = queueMutations.linkTicketToProject('K-1', 'api');
  assert.equal(linked.changed, true);
  let persisted = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  assert.deepEqual(persisted.tickets['K-1'].projects, ['api', 'app']);

  const unlinked = queueMutations.unlinkTicketFromProject('K-1', 'app');
  assert.equal(unlinked.changed, true);
  persisted = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  assert.deepEqual(persisted.tickets['K-1'].projects, ['api']);

  const removed = queueMutations.removeTicketFromQueue('K-1');
  assert.equal(removed.removed, 1);
  assert.equal(JSON.parse(fs.readFileSync(stateStore.QUEUE_FILE, 'utf8')).items.length, 0);
  assert.equal(queueMutations.selectNextQueueItem().empty, true);
  assert.equal(queueMutations.removeTicketFromQueue('K-1').removed, 0);

  const plan = {
    planId: 'K-1:verify',
    ticketKey: 'K-1',
    action: 'verify',
    projects: ['api'],
    score: 123,
    scoreBreakdown: [],
    reason: 'ready to verify',
    source: 'ticket',
    ticketSummary: 'Verify linked ticket',
  };
  const planAdd = queueMutations.addPlanToQueue(plan);
  assert.equal(planAdd.added, true);
  assert.equal(planAdd.alreadyQueued, false);
  assert.equal(planAdd.item.project_path, '/repo/api');
  let planQueue = JSON.parse(fs.readFileSync(stateStore.QUEUE_FILE, 'utf8'));
  assert.equal(planQueue.items[0].ticket, 'K-1');
  assert.equal(planQueue.items[0].priority_score, 123);
  const duplicatePlan = queueMutations.addPlanToQueue(plan);
  assert.equal(duplicatePlan.alreadyQueued, true);
  assert.equal(duplicatePlan.pinned, false);
  const pinnedPlan = queueMutations.addPlanToQueue(plan, { pinTop: true });
  assert.equal(pinnedPlan.alreadyQueued, true);
  assert.equal(pinnedPlan.pinned, true);
  const decision = queueMutations.recordPlanQueueDecision(plan, 'snoozed', {
    now: new Date('2026-07-01T12:00:00.000Z'),
    snoozeMinutes: 30,
    reason: 'wait for QA slot',
  });
  assert.equal(decision.decision.decision, 'snoozed');
  assert.equal(decision.decision.snoozed_until, '2026-07-01T12:30:00.000Z');
  planQueue = JSON.parse(fs.readFileSync(stateStore.QUEUE_FILE, 'utf8'));
  assert.equal(planQueue.decisions['K-1:verify'].reason, 'wait for QA slot');
  const secondQueued = queueMutations.addTicketToQueue('K-2');
  assert.equal(secondQueued.added, true);
  let reordered = queueMutations.reorderQueueItem(1, 'up');
  assert.equal(reordered.changed, true);
  assert.equal(reordered.items[0].ticket, 'K-2');
  reordered = queueMutations.reorderQueueItem(0, 'down');
  assert.equal(reordered.changed, true);
  assert.equal(reordered.items[1].ticket, 'K-2');
  reordered = queueMutations.reorderQueueItem(1, 'top');
  assert.equal(reordered.changed, true);
  assert.equal(reordered.items[0].ticket, 'K-2');
  assert.equal(queueMutations.reorderQueueItem(0, 'up').changed, false);
  assert.throws(() => queueMutations.addTicketToQueue('MISSING'), /Ticket not found/);
  assert.throws(() => queueMutations.linkTicketToProject('K-1', 'missing-project'), /Project not found/);

  const source = readSourceFixture('src', 'services', 'queueMutations.ts');
  for (const marker of [
    "import { recordFromUnknown } from './records'",
    'function normalizeQueueItem(item: unknown): QueueItem',
    'function queueString(value: unknown): string',
    'function queueNullableString(value: unknown): string | null',
    'function queueStringArray(value: unknown): string[]',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(source.includes('function normalizeQueueItem(item: any): QueueItem'), false);
  assert.equal(source.includes('function queueRecord(value: unknown): Record<string, unknown>'), false);
});

test('project mutation helpers centralize project config, scan dirs, and removal', () => {
  const projectRoot = makeTempDir('kronos-project-');
  fs.mkdirSync(path.join(projectRoot, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.claude', 'project.json'), '{}\n');
  const initial = baseState({
    'K-1': ticket({ projects: ['app'], summary: 'Linked ticket' }),
    'K-2': ticket({ projects: ['app', 'other'], summary: 'Multi project' }),
  });
  initial.projects.app.path = projectRoot;
  initial.projects.app.config = { repo_name: 'app', jira_project_key: 'APP' };
  initial.projects.other = {
    path: '/repo/other',
    priority: 2,
    config: {},
    health: 'green',
    summary: '',
    last_polled: null,
    open_mr_count: 0,
  };
  fs.mkdirSync(path.dirname(stateStore.STATE_FILE), { recursive: true });
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(initial, null, 2));

  const setupConfig = projectMutations.writeProjectSetupConfig({
    projectPath: projectRoot,
    projectName: 'app',
    gitlabProjectId: 456,
    sonarProjectKey: 'app-service',
    defaultBranch: 'main',
  });
  assert.equal(setupConfig.path, path.join(projectRoot, '.claude', 'project.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(setupConfig.path, 'utf8')), {
    project_name: 'app',
    gitlab_project_id: 456,
    sonar_project_key: 'app-service',
    default_branch: 'main',
  });
  const integrationUpdates = projectMutations.setProjectIntegrationConfig('app', {
    gitlabProjectId: 456,
    sonarProjectKey: 'app-service',
    defaultBranch: 'main',
  });
  assert.deepEqual(integrationUpdates.map(update => update.key), ['gitlab_project_id', 'sonar_project_key', 'default_branch']);
  assert.deepEqual(projectMutations.setProjectIntegrationConfig('app', {}), []);

  const gitlab = projectMutations.setProjectConfigValue('app', 'gitlab_project_id', '123');
  assert.equal(gitlab.value, 123);
  const sonar = projectMutations.setProjectConfigValue('app', 'sonar_project_key', 'app-sonar');
  assert.equal(sonar.value, 'app-sonar');
  const extraDirs = projectMutations.setProjectConfigValue('app', 'extra_dirs', '/repo/shared, /repo/lib');
  assert.deepEqual(extraDirs.value, ['/repo/shared', '/repo/lib']);
  const dirs = projectMutations.setScanDirs(['/repo', '/repo', ' /tmp/repos ']);
  assert.deepEqual(dirs.scanDirs, ['/repo', '/tmp/repos']);

  const removed = projectMutations.removeProject('app');
  assert.equal(removed.projectName, 'app');
  assert.deepEqual(removed.ticketsUnlinked.sort(), ['K-1', 'K-2']);
  const persisted = JSON.parse(fs.readFileSync(stateStore.STATE_FILE, 'utf8'));
  assert.equal(persisted.projects.app, undefined);
  assert.deepEqual(persisted.tickets['K-1'].projects, []);
  assert.deepEqual(persisted.tickets['K-2'].projects, ['other']);
  assert.ok(persisted.discovered_projects.some(project => project.repo_name === 'app' && project.path === projectRoot && project.has_project_json));
  assert.throws(() => projectMutations.setProjectConfigValue('missing', 'sonar_project_key', 'x'), /Project not found/);
  assert.throws(() => projectMutations.setProjectConfigValue('other', 'gitlab_project_id', 'not-number'), /positive number/);
  assert.throws(() => projectMutations.setProjectConfigValue('other', 'deploy_approvers', 'Ada'), /structured config editor/);
});

test('queue planner ranks queued items first and avoids duplicate queued tickets', () => {
  const state = baseState({
    'K-1': ticket({ next_action: 'fix_build', priority: 'Critical', build: { number: 1, status: 'FAILURE', url: '' } }),
    'K-2': ticket({
      next_action: 'verify',
      priority: 'High',
      evidence: {
        notes: [null, 'bad note'],
        checks: [null],
        environment_results: { broken: null },
      },
    }),
  });
  const queue = {
    items: [{
      id: 'queued',
      ticket: 'K-1',
      ticket_summary: 'Queued build fix',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'fix_build',
      priority_score: 50,
      reason: 'already queued',
    }],
    last_computed: null,
  };

  const plans = queuePlanner.planNextActions({ state, queue });

  assert.equal(plans[0].source, 'queue');
  assert.equal(plans[0].ticketKey, 'K-1');
  assert.ok(plans[0].scoreBreakdown.some(part => part.label === 'Queue position'));
  assert.equal(plans.filter(p => p.ticketKey === 'K-1').length, 1);
  const plannedTicket = plans.find(p => p.ticketKey === 'K-2');
  assert.ok(plannedTicket && plannedTicket.reason.includes('no evidence records yet'));
  assert.ok(plannedTicket.scoreBreakdown.some(part => part.label === 'Evidence' && part.value === 5));
});

test('queue planner converts a recommendation into a runnable queue item', () => {
  const plan = {
    planId: 'K-3:verify',
    ticketKey: 'K-3',
    action: 'verify',
    projects: ['app'],
    score: 105,
    scoreBreakdown: [{ label: 'Action', value: 85, detail: 'QA' }, { label: 'Priority', value: 20, detail: 'High' }],
    reason: 'high confidence',
    source: 'ticket',
    ticketSummary: 'Verify it',
  };

  const item = queuePlanner.planToQueueItem({
    state: baseState({}),
    queue: null,
    resolveProjectPath: name => `/repo/${name}`,
  }, plan);

  assert.equal(item.id, 'planned-K-3');
  assert.equal(item.project_path, '/repo/app');
  assert.equal(item.priority_score, 105);
});

test('queue dispatch plan resolves registered, missing, and direct project targets', () => {
  const resolveProjectPath = project => ({ app: '/repo/app', web: '/repo/web' })[project];

  assert.deepEqual(queueDispatchPlan.buildQueueDispatchPlan({
    projects: ['app', 'missing', 'web'],
    resolveProjectPath,
  }), {
    projects: ['app', 'missing', 'web'],
    directProjectPath: undefined,
    projectLabel: 'app, missing, web',
    dispatchTargets: [
      { projectName: 'app', projectPath: '/repo/app' },
      { projectName: 'web', projectPath: '/repo/web' },
    ],
    missingProjects: ['missing'],
  });

  assert.deepEqual(queueDispatchPlan.buildQueueDispatchPlan({
    projects: [],
    projectPath: '/repo/direct',
    resolveProjectPath,
  }), {
    projects: [],
    directProjectPath: '/repo/direct',
    projectLabel: '/repo/direct',
    dispatchTargets: [{ projectPath: '/repo/direct' }],
    missingProjects: [],
  });

  assert.deepEqual(queueDispatchPlan.buildQueueDispatchPlan({
    projects: [],
    projectPath: '/repo/app',
    pathProject: 'app',
    resolveProjectPath,
  }).dispatchTargets, [{ projectName: 'app', projectPath: '/repo/app' }]);

  assert.equal(
    queueDispatchPlan.queueDispatchMissingProjectMessage({ target: 'K-1', missingProjects: ['missing'] }),
    'Cannot start K-1; linked project missing is not registered.',
  );
  assert.equal(
    queueDispatchPlan.queueDispatchNoProjectPathMessage(null),
    'Cannot start queue item; no project path was found.',
  );
  assert.deepEqual(queueDispatchPlan.buildQueueDispatchCollisionTarget({
    ticket: 'K-1',
    id: 'queue-1',
    projects: ['app'],
    action: 'implement',
  }), {
    ticketKey: 'K-1',
    projects: ['app'],
    action: 'implement',
    excludeQueueItemId: 'queue-1',
  });
  assert.equal(queueDispatchPlan.buildQueueDispatchExtraPrompt('focus auth'), '\n\nADDITIONAL CONTEXT FROM USER: focus auth');
  assert.equal(
    queueDispatchPlan.buildQueueDispatchScopeHint({ projectName: 'app', projectPath: '/repo/app' }, ['app', 'web']),
    '\nYou are working in app. Focus ONLY on this codebase. Other projects: web.',
  );
  assert.equal(
    queueDispatchPlan.buildQueueDispatchAppendPrompt({
      codeAction: true,
      implementPrompt: 'impl',
      scopeHint: '\nscope',
      extraPrompt: '\nextra',
    }),
    'impl\nscope\nextra',
  );
  assert.equal(queueDispatchPlan.buildQueueDispatchAppendPrompt({
    codeAction: false,
    implementPrompt: 'impl',
    extraPrompt: '',
  }), undefined);

  const source = readSourceFixture('src', 'services', 'queueDispatchPlan.ts');
  for (const marker of [
    'export interface QueueDispatchTarget',
    'export interface QueueDispatchPlan',
    'export interface QueueDispatchCollisionTarget',
    'export function buildQueueDispatchPlan',
    'export function buildQueueDispatchCollisionTarget',
    'export function buildQueueDispatchExtraPrompt',
    'export function buildQueueDispatchScopeHint',
    'export function buildQueueDispatchAppendPrompt',
    'directProjectPath',
    'missingProjects',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('next action context explains command, risk, preflight, and blockers', () => {
  const state = baseState({
    'K-1': ticket({
      next_action: 'fix_build',
      projects: ['app'],
      evidence: { notes: [{ at: 'now', kind: 'test', text: 'build failed before fix' }] },
    }),
    'K-2': ticket({
      next_action: 'verify',
      projects: [],
      evidence: {
        notes: [null, 'bad note'],
        checks: [null],
        environment_results: { broken: null },
      },
    }),
  });
  const queuedPlan = {
    planId: 'K-1:fix_build',
    ticketKey: 'K-1',
    action: 'fix_build',
    projects: ['app'],
    score: 100,
    scoreBreakdown: [],
    reason: 'build failed',
    source: 'queue',
    queueItem: { id: 'queued-1' },
  };
  const queuedContext = nextActionContext.buildNextActionContext(queuedPlan, { state, queue: null });

  assert.equal(queuedContext.commandId, 'kronos.startQueueItem');
  assert.equal(queuedContext.skill, 'implement');
  assert.deepEqual(queuedContext.risks, ['repo-write']);
  assert.ok(queuedContext.preflight.some(item => item.includes('Claude auth preflight')));
  assert.ok(queuedContext.preflight.some(item => item.includes('Collision detector')));
  assert.ok(queuedContext.preflight.some(item => item.includes('queued-1')));
  assert.deepEqual(queuedContext.blockers, []);
  assert.match(queuedContext.summary, /command kronos\.startQueueItem/);
  const queuedStart = nextActionContext.buildNextActionStartDecision(queuedPlan, queuedContext);
  assert.equal(queuedStart.allowed, true);
  assert.equal(queuedStart.commandId, 'kronos.startQueueItem');
  assert.equal(queuedStart.safetyPlan.operationId, 'kronos.startQueueItem');
  assert.equal(queuedStart.safetyPlan.confirmationLabel, 'Start');
  assert.ok(queuedStart.safetyPlan.changes.some(item => item.includes('Dispatch Claude /implement')));
  assert.ok(queuedStart.safetyPlan.warnings.some(item => item.includes('Claude auth preflight')));

  const reviewPlan = {
    planId: 'K-1:await_review',
    ticketKey: 'K-1',
    action: 'await_review',
    projects: ['app'],
    score: 90,
    scoreBreakdown: [],
    reason: 'ready for review',
    source: 'ticket',
  };
  const reviewContext = nextActionContext.buildNextActionContext(reviewPlan, { state, queue: null });
  assert.equal(reviewContext.skill, 'verify-fix');
  assert.deepEqual(reviewContext.risks, ['repo-write']);
  const reviewStart = nextActionContext.buildNextActionStartDecision(reviewPlan, reviewContext);
  assert.equal(reviewStart.allowed, true);
  assert.ok(reviewStart.safetyPlan.changes.some(item => item.includes('Dispatch Claude /verify-fix')));

  const unlinkedPlan = {
    planId: 'K-2:verify',
    ticketKey: 'K-2',
    action: 'verify',
    projects: [],
    score: 10,
    scoreBreakdown: [],
    reason: 'needs proof',
    source: 'ticket',
  };
  const unlinkedContext = nextActionContext.buildNextActionContext(unlinkedPlan, { state, queue: null });
  assert.equal(unlinkedContext.skill, 'verify-fix');
  assert.ok(unlinkedContext.preflight.some(item => item.includes('Evidence ledger is empty')));
  assert.deepEqual(unlinkedContext.blockers, ['No linked project; link the ticket before dispatch.']);
  const blockedStart = nextActionContext.buildNextActionStartDecision(unlinkedPlan, unlinkedContext);
  assert.equal(blockedStart.allowed, false);
  assert.match(blockedStart.reason, /No linked project/);
  assert.equal(blockedStart.safetyPlan, undefined);

  const donePlan = {
    planId: 'K-1:done',
    ticketKey: 'K-1',
    action: 'done',
    projects: ['app'],
    score: 1,
    scoreBreakdown: [],
    reason: 'finished',
    source: 'ticket',
  };
  const doneContext = nextActionContext.buildNextActionContext(donePlan, { state, queue: null });
  assert.deepEqual(doneContext.blockers, ['Ticket is already done; no dispatch is needed.']);
  assert.equal(nextActionContext.buildNextActionStartDecision(donePlan, doneContext).allowed, false);

  const refreshPlan = {
    planId: 'refresh:refresh',
    ticketKey: null,
    action: 'refresh',
    projects: ['app'],
    score: 1,
    scoreBreakdown: [],
    reason: 'refresh provider data',
    source: 'ticket',
  };
  const refreshContext = nextActionContext.buildNextActionContext(refreshPlan, { state, queue: null });
  assert.equal(refreshContext.commandId, 'kronos.refresh');
  assert.deepEqual(refreshContext.risks, ['read-only']);
  assert.ok(refreshContext.preflight.some(item => item.includes('provider scripts')));
  const refreshStart = nextActionContext.buildNextActionStartDecision(refreshPlan, refreshContext);
  assert.equal(refreshStart.allowed, true);
  assert.deepEqual(refreshStart.refreshProjects, ['app']);
  assert.equal(refreshStart.safetyPlan.confirmationLabel, 'Refresh');
  assert.ok(refreshStart.safetyPlan.changes.some(item => item.includes('Refresh provider state for app')));
});

test('git workspace service owns origin parsing, branch lookup, and diff artifacts', () => {
  const workspace = makeTempDir('kronos-git-workspace-');
  const outputDir = makeTempDir('kronos-runs-');
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args, options });
    const joined = args.join(' ');
    if (joined === 'remote get-url origin') { return 'git@gitlab.example.com:group/app.git\n'; }
    if (joined === 'branch -r --list *K-1*') { return '  origin/feature/K-1-first\n  origin/feature/K-1-second\n'; }
    if (joined === 'status --short') { return ' M src/app.ts\n?? src/new.ts\n'; }
    if (joined === 'diff --') { return 'diff --git a/src/app.ts b/src/app.ts\n'; }
    if (joined === 'diff --cached --') { return ''; }
    throw new Error(`unexpected git call: ${joined}`);
  };

  assert.equal(gitWorkspace.originProjectPath(workspace, runner), 'group/app');
  const remoteRunner = remote => (args) => {
    if (args.join(' ') === 'remote get-url origin') { return `${remote}\n`; }
    throw new Error(`unexpected git call: ${args.join(' ')}`);
  };
  assert.equal(gitWorkspace.originProjectPath(workspace, remoteRunner('git@gitlab.company.internal:platform/api.git')), 'platform/api');
  assert.equal(gitWorkspace.originProjectPath(workspace, remoteRunner('https://gitlab.company.internal/platform/api.git')), 'platform/api');
  assert.equal(gitWorkspace.originProjectPath(workspace, remoteRunner('ssh://git@gitlab.company.internal:2222/platform/api.git')), 'platform/api');
  assert.equal(gitWorkspace.firstRemoteBranchMatching(workspace, '*K-1*', runner), 'origin/feature/K-1-first');

  const artifact = gitWorkspace.createWorkspaceDiffArtifact({
    id: 'run/needs:sanitize',
    worktreePath: workspace,
  }, outputDir, runner);
  const body = fs.readFileSync(artifact.filePath, 'utf8');
  assert.match(artifact.filePath, /run-needs-sanitize\.workspace\.diff\.txt$/);
  assert.match(body, /## git status --short\n M src\/app\.ts\n\?\? src\/new\.ts/);
  assert.match(body, /## git diff --\ndiff --git a\/src\/app\.ts b\/src\/app\.ts/);
  assert.match(body, /## git diff --cached --\n\(no staged diff\)/);
  assert.ok(calls.some(call => call.args.join(' ') === 'diff --cached --' && call.options.maxBuffer > 1024 * 1024));
});

test('git workspace diff artifacts keep long run ids in bounded distinct filenames', () => {
  const workspace = makeTempDir('kronos-git-workspace-');
  const outputDir = makeTempDir('kronos-runs-');
  const runner = args => {
    const joined = args.join(' ');
    if (joined === 'status --short' || joined === 'diff --' || joined === 'diff --cached --') { return ''; }
    throw new Error(`unexpected git call: ${joined}`);
  };

  const first = gitWorkspace.createWorkspaceDiffArtifact({
    id: `run/${'a'.repeat(260)}-one`,
    worktreePath: workspace,
  }, outputDir, runner);
  const second = gitWorkspace.createWorkspaceDiffArtifact({
    id: `run/${'a'.repeat(260)}-two`,
    worktreePath: workspace,
  }, outputDir, runner);

  assert.notEqual(first.filePath, second.filePath);
  assert.equal(path.basename(first.filePath).length <= 180, true);
  assert.equal(path.basename(second.filePath).length <= 180, true);
  assert.equal(path.dirname(first.filePath), outputDir);
  assert.equal(path.dirname(second.filePath), outputDir);
});

test('git workspace service owns branch metadata and safe worktree lifecycle commands', () => {
  const workspace = makeTempDir('kronos-worktree-');
  const projectPath = makeTempDir('kronos-project-');
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args, options });
    const joined = args.join(' ');
    if (joined === 'rev-parse --abbrev-ref HEAD') { return 'feature/K-1\n'; }
    if (joined === 'rev-parse HEAD') { return 'abc123\n'; }
    if (joined === 'fetch origin') { return ''; }
    if (joined === 'worktree add /tmp/wt feature/K-1') { return ''; }
    if (joined === 'pull --ff-only') { return ''; }
    if (joined === 'status --porcelain') { return ''; }
    if (joined === 'branch --show-current') { return 'feature/K-1\n'; }
    if (joined === 'rev-list --count origin/feature/K-1..HEAD') { return '0\n'; }
    if (joined === 'worktree remove /tmp/wt') { return ''; }
    throw new Error(`unexpected git call: ${joined}`);
  };

  assert.equal(gitWorkspace.currentGitRef(workspace, runner), 'feature/K-1');
  assert.equal(gitWorkspace.currentGitCommit(workspace, runner), 'abc123');
  const prepared = gitWorkspace.prepareManagedWorktree({
    projectPath,
    worktreePath: '/tmp/wt',
    targetRef: 'origin/feature/K-1',
    featureBranch: true,
    runner,
  });
  assert.equal(prepared.checkoutRef, 'feature/K-1');
  assert.equal(prepared.pullWarning, undefined);
  assert.ok(calls.some(call => call.args.join(' ') === 'fetch origin'));
  assert.ok(calls.some(call => call.args.join(' ') === 'worktree add /tmp/wt feature/K-1'));

  const preparedWithPullWarning = gitWorkspace.prepareManagedWorktree({
    projectPath,
    worktreePath: '/tmp/wt-warning',
    targetRef: 'origin/main',
    featureBranch: false,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'fetch origin') { return ''; }
      if (joined === 'worktree add /tmp/wt-warning origin/main') { return ''; }
      if (joined === 'pull --ff-only') { throw new Error('no upstream configured'); }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(preparedWithPullWarning.checkoutRef, 'origin/main');
  assert.equal(preparedWithPullWarning.pullWarning, 'no upstream configured');

  const entry = { projectPath, worktreePath: workspace, ticket: 'K-1', createdAt: 'now' };
  const inspected = gitWorkspace.inspectTrackedWorktree(entry, { runner });
  assert.equal(inspected.status, 'removable');
  const behindRemote = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return ''; }
      if (joined === 'branch --show-current') { return 'feature/behind\n'; }
      if (joined === 'rev-list --count origin/feature/behind..HEAD') { return '0\n'; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(behindRemote.status, 'removable');
  const aheadRemote = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return ''; }
      if (joined === 'branch --show-current') { return 'feature/ahead\n'; }
      if (joined === 'rev-list --count origin/feature/ahead..HEAD') { return '2\n'; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(aheadRemote.status, 'blocked');
  assert.match(aheadRemote.reason, /unpushed commits/);
  const invalidAheadCheck = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return ''; }
      if (joined === 'branch --show-current') { return 'feature/invalid\n'; }
      if (joined === 'rev-list --count origin/feature/invalid..HEAD') { return 'not-a-number\n'; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(invalidAheadCheck.status, 'blocked');
  assert.match(invalidAheadCheck.reason, /invalid result/);
  let removed = false;
  const warning = gitWorkspace.removeWorktreeSafely(projectPath, '/tmp/wt', {
    runner,
    exists: () => true,
    onRemoved: () => { removed = true; },
  });
  assert.equal(warning, null);
  assert.equal(removed, true);

  const dirty = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => args.join(' ') === 'status --porcelain' ? ' M src/app.ts\n' : '',
  });
  assert.equal(dirty.status, 'blocked');
  assert.match(dirty.reason, /Dirty worktree/);

  const onlyClaudeArtifacts = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return '?? .claude/\n?? .claude/settings.local.json\n'; }
      if (joined === 'branch --show-current') { return ''; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(onlyClaudeArtifacts.status, 'removable');

  const generatedClaudeWorkspace = makeTempDir('kronos-worktree-generated-');
  fs.mkdirSync(path.join(generatedClaudeWorkspace, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(generatedClaudeWorkspace, '.claude', 'settings.local.json'), '{}\n');
  const generatedWarning = gitWorkspace.removeWorktreeSafely(projectPath, generatedClaudeWorkspace, {
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return '?? .claude/\n?? .claude/settings.local.json\n'; }
      if (joined === 'branch --show-current') { return ''; }
      if (joined === `worktree remove ${generatedClaudeWorkspace}`) {
        assert.equal(fs.existsSync(path.join(generatedClaudeWorkspace, '.claude')), false);
        return '';
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(generatedWarning, null);

  const trackedClaudeWorkspace = makeTempDir('kronos-worktree-tracked-');
  fs.mkdirSync(path.join(trackedClaudeWorkspace, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(trackedClaudeWorkspace, '.claude', 'project.json'), '{}\n');
  fs.writeFileSync(path.join(trackedClaudeWorkspace, '.claude', 'settings.local.json'), '{}\n');
  const trackedClaudeWarning = gitWorkspace.removeWorktreeSafely(projectPath, trackedClaudeWorkspace, {
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return '?? .claude/settings.local.json\n'; }
      if (joined === 'branch --show-current') { return ''; }
      if (joined === `worktree remove ${trackedClaudeWorkspace}`) {
        assert.equal(fs.existsSync(path.join(trackedClaudeWorkspace, '.claude', 'project.json')), true);
        assert.equal(fs.existsSync(path.join(trackedClaudeWorkspace, '.claude', 'settings.local.json')), false);
        return '';
      }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(trackedClaudeWarning, null);

  const mixedClaudeArtifacts = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return '?? .claude/\n?? src/generated.ts\n'; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(mixedClaudeArtifacts.status, 'blocked');
  assert.match(mixedClaudeArtifacts.reason, /src\/generated\.ts/);
  assert.doesNotMatch(mixedClaudeArtifacts.reason, /\.claude/);

  const missingOrigin = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain') { return ''; }
      if (joined === 'branch --show-current') { return 'feature/no-origin\n'; }
      throw new Error('missing origin');
    },
  });
  assert.equal(missingOrigin.status, 'blocked');
  assert.match(missingOrigin.reason, /no matching origin branch/);

  const missing = gitWorkspace.inspectTrackedWorktree(entry, { exists: () => false });
  assert.equal(missing.status, 'missing');

  const inspectError = gitWorkspace.inspectTrackedWorktree(entry, {
    exists: () => true,
    runner: () => { throw 'git status failed'; },
  });
  assert.equal(inspectError.status, 'error');
  assert.equal(inspectError.reason, 'git status failed');

  const removeError = gitWorkspace.removeWorktreeSafely(projectPath, '/tmp/wt', {
    exists: () => true,
    runner: args => {
      const joined = args.join(' ');
      if (joined === 'status --porcelain' || joined === 'branch --show-current') { return ''; }
      if (joined === 'worktree remove /tmp/wt') { throw { message: '   ' }; }
      throw new Error(`unexpected git call: ${joined}`);
    },
  });
  assert.equal(removeError, 'Could not remove worktree safely');

  const source = readSourceFixture('src', 'services', 'gitWorkspace.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Could not remove worktree safely')",
    "unknownErrorMessage(e, 'Could not inspect worktree.')",
    'function blockingWorktreeStatus',
    'function isIgnorableWorktreeStatusLine',
    'function removeIgnorableWorktreeArtifacts',
    "import { isPathInside } from './pathUtils'",
    "path.join(worktreePath, '.claude')",
    "runner(['status', '--porcelain']",
    "runner(['rev-list', '--count', `origin/${branch}..HEAD`]",
    'unpushed commit check returned an invalid result',
    'const artifactPath = path.resolve(worktreePath, statusPath)',
    'fs.rmSync(artifactPath, { recursive: true, force: true })',
    "statusPath === '.claude' || statusPath === '.claude/' || statusPath.startsWith('.claude/')",
    'pullWarning?: string',
    "pullWarning = unknownErrorMessage(e, 'Could not fast-forward managed worktree after creation.')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    '} catch {}',
    'remote !== local',
    "runner(['rev-parse', `origin/${branch}`]",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('worktree registry tracks, deduplicates, and untracks entries safely', () => {
  const dir = makeTempDir('kronos-worktree-registry-');
  const registryPath = path.join(dir, 'active-worktrees.json');

  worktreeRegistry.trackActiveWorktree('/repo/app', '/repo/app/.claude/worktrees/K-1', 'K-1', new Date('2026-07-01T10:00:00.000Z'), registryPath);
  worktreeRegistry.trackActiveWorktree('/repo/app', '/repo/app/.claude/worktrees/K-1', 'K-1-retry', new Date('2026-07-01T11:00:00.000Z'), registryPath);
  fs.writeFileSync(registryPath, `\ufeff${fs.readFileSync(registryPath, 'utf8')}`, 'utf8');

  const tracked = worktreeRegistry.loadActiveWorktreeRegistry(registryPath);
  assert.equal(tracked.issue, undefined);
  assert.equal(tracked.entries.length, 1);
  assert.equal(tracked.entries[0].ticket, 'K-1-retry');
  assert.equal(tracked.entries[0].createdAt, '2026-07-01T11:00:00.000Z');

  const remaining = worktreeRegistry.untrackActiveWorktree('/repo/app/.claude/worktrees/K-1', registryPath);
  assert.deepEqual(remaining, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')), []);
});

test('worktree registry refuses to overwrite malformed registry files', () => {
  const dir = makeTempDir('kronos-worktree-registry-bad-');
  const registryPath = path.join(dir, 'active-worktrees.json');
  const malformed = JSON.stringify({ entries: [] }, null, 2);
  fs.writeFileSync(registryPath, malformed);

  const registry = worktreeRegistry.loadActiveWorktreeRegistry(registryPath);
  assert.match(registry.issue, /must be an array/);
  assert.throws(
    () => worktreeRegistry.trackActiveWorktree('/repo/app', '/repo/app/.claude/worktrees/K-2', 'K-2', new Date('2026-07-01T12:00:00.000Z'), registryPath),
    /needs manual review/,
  );
  assert.throws(
    () => worktreeRegistry.untrackActiveWorktree('/repo/app/.claude/worktrees/K-2', registryPath),
    /needs manual review/,
  );
  assert.equal(fs.readFileSync(registryPath, 'utf8'), malformed);

  fs.writeFileSync(registryPath, '{bad json');
  const invalidJson = worktreeRegistry.loadActiveWorktreeRegistry(registryPath);
  assert.match(invalidJson.issue, /Unexpected token|Expected property name/);

  const source = readSourceFixture('src', 'services', 'worktreeRegistry.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Could not parse active-worktrees.json.')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('process tree service centralizes stop and pause signaling behavior', () => {
  const killed = [];
  let scheduled;
  const stop = processTree.stopProcessTree(123, {
    platform: 'linux',
    kill: (pid, signal) => { killed.push([pid, signal || 'default']); },
    schedule: callback => { scheduled = callback; },
  });
  assert.deepEqual(stop, { attempted: true, signalled: true, method: 'process-group', fallbackUsed: false });
  assert.deepEqual(killed, [[-123, 'SIGTERM']]);
  scheduled();
  assert.deepEqual(killed, [[-123, 'SIGTERM'], [-123, 'SIGKILL']]);

  const fallbackCalls = [];
  const fallback = processTree.stopProcessTree(77, {
    platform: 'linux',
    kill: (pid, signal) => {
      fallbackCalls.push([pid, signal || 'default']);
      if (pid < 0) { throw new Error('no process group'); }
    },
    schedule: () => {},
  });
  assert.equal(fallback.signalled, true);
  assert.equal(fallback.method, 'process');
  assert.equal(fallback.fallbackUsed, true);
  assert.deepEqual(fallbackCalls, [[-77, 'SIGTERM'], [77, 'default']]);

  const taskkillCalls = [];
  const windows = processTree.stopProcessTree(55, {
    platform: 'win32',
    commandRunner: (command, args, options) => { taskkillCalls.push({ command, args, options }); },
  });
  assert.equal(windows.method, 'taskkill');
  assert.deepEqual(taskkillCalls[0].args, ['/PID', '55', '/T', '/F']);

  const failedWindowsStop = processTree.stopProcessTree(56, {
    platform: 'win32',
    commandRunner: () => { throw new Error('taskkill failed'); },
    kill: () => { throw new Error('process kill failed'); },
  });
  assert.equal(failedWindowsStop.attempted, true);
  assert.equal(failedWindowsStop.signalled, false);
  assert.equal(failedWindowsStop.fallbackUsed, true);
  assert.equal(failedWindowsStop.error, 'process kill failed');

  const signalCalls = [];
  const signalFallback = processTree.signalProcessTree(88, 'SIGSTOP', {
    platform: 'linux',
    kill: (pid, signal) => {
      signalCalls.push([pid, signal]);
      if (pid < 0) { throw new Error('no process group'); }
    },
  });
  assert.equal(signalFallback.signalled, true);
  assert.equal(signalFallback.method, 'process');
  assert.equal(signalFallback.fallbackUsed, true);
  assert.deepEqual(signalCalls, [[-88, 'SIGSTOP'], [88, 'SIGSTOP']]);

  const failedSignalFallback = processTree.signalProcessTree(89, 'SIGSTOP', {
    platform: 'linux',
    kill: (pid) => {
      if (pid < 0) { throw new Error('no group signal'); }
      throw new Error('no process signal');
    },
  });
  assert.equal(failedSignalFallback.signalled, false);
  assert.equal(failedSignalFallback.fallbackUsed, true);
  assert.equal(failedSignalFallback.error, 'no process signal');

  const failedStopFallback = processTree.stopProcessTree(78, {
    platform: 'linux',
    kill: (pid) => {
      if (pid < 0) { throw new Error('no group stop'); }
      throw { message: '   ' };
    },
    schedule: () => {},
  });
  assert.equal(failedStopFallback.signalled, false);
  assert.equal(failedStopFallback.fallbackUsed, true);
  assert.equal(failedStopFallback.error, 'no group stop');

  const unsupported = processTree.signalProcessTree(88, 'SIGCONT', { platform: 'win32' });
  assert.equal(unsupported.attempted, true);
  assert.equal(unsupported.signalled, false);
  assert.equal(unsupported.method, 'unsupported');
  assert.match(unsupported.error, /not supported/);
  assert.equal(processTree.supportsProcessTreeSuspend('win32'), false);
  assert.equal(processTree.supportsProcessTreeSuspend('linux'), true);

  assert.equal(processTree.stopProcessTree(undefined).attempted, false);
  assert.equal(processTree.signalProcessTree(-1, 'SIGSTOP').attempted, false);

  const source = readSourceFixture('src', 'services', 'processTree.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    'catch (fallbackError: unknown)',
    'export function supportsProcessTreeSuspend',
    "console.warn(unknownErrorMessage(e, 'Delayed process-group SIGKILL failed.'))",
    "unknownErrorMessage(fallbackError, unknownErrorMessage(e, 'process signal failed'))",
    "unknownErrorMessage(fallbackError, unknownErrorMessage(cause, 'process stop failed'))",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'catch (fallbackError: any)',
    'fallbackError?.message',
    'cause?.message',
    'e?.message',
    '} catch {}',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('webview security injects CSP and preserves existing nonce policies', () => {
  const readOnly = webviewSecurity.withWebviewCsp('<!DOCTYPE html><html><head><style>body{}</style></head><body>ok</body></html>');
  assert.match(readOnly, /Content-Security-Policy/);
  assert.match(readOnly, /default-src 'none'/);
  assert.match(readOnly, /script-src 'none'/);

  const scriptable = webviewSecurity.withWebviewCsp('<body>ok</body>', { allowScripts: true, nonce: 'abc123', imgSrc: ['data:', 'https:'] });
  assert.match(scriptable, /script-src 'nonce-abc123'/);
  assert.match(scriptable, /script-src-elem 'nonce-abc123'/);
  assert.match(scriptable, /script-src-attr 'none'/);
  assert.match(scriptable, /style-src-elem 'unsafe-inline'/);
  assert.match(scriptable, /style-src-attr 'unsafe-inline'/);
  assert.match(scriptable, /base-uri 'none'/);
  assert.match(scriptable, /form-action 'none'/);
  assert.match(scriptable, /img-src data: https:/);
  const scriptableWithSource = webviewSecurity.withWebviewCsp('<body>ok</body>', { allowScripts: true, nonce: 'abc123', cspSource: 'vscode-resource:' });
  assert.match(scriptableWithSource, /style-src vscode-resource: 'unsafe-inline'/);
  assert.match(scriptableWithSource, /script-src vscode-resource: 'nonce-abc123'/);
  assert.match(scriptableWithSource, /script-src-elem vscode-resource: 'nonce-abc123'/);

  const sourceOnlyScripts = webviewSecurity.withWebviewCsp('<body>ok</body>', { allowScripts: true, cspSource: 'vscode-resource:' });
  assert.match(sourceOnlyScripts, /script-src vscode-resource:/);
  assert.deepEqual(webviewSecurity.webviewScriptCspOptions('vscode-resource:', 'abc123'), {
    allowScripts: true,
    nonce: 'abc123',
    cspSource: 'vscode-resource:',
  });
  const bodyOnly = webviewSecurity.withWebviewCsp('<body><button>ok</button></body>');
  assert.match(bodyOnly, /^<!DOCTYPE html><html><head>\n<meta http-equiv="Content-Security-Policy"/);
  assert.match(bodyOnly, /<\/head><body><button>ok<\/button><\/body><\/html>$/);
  const fragment = webviewSecurity.withWebviewCsp('<main>ok</main>');
  assert.match(fragment, /<body><main>ok<\/main><\/body><\/html>$/);

  const nonce = webviewSecurity.createWebviewNonce();
  assert.match(nonce, /^[a-f0-9]{32}$/);
  assert.doesNotMatch(nonce, /[+/=]/);
  const nonceSource = webviewSecurity.withWebviewCsp('<body>ok</body>', { allowScripts: true, nonce });
  assert.match(nonceSource, new RegExp(`script-src 'nonce-${nonce}'`));
  const apiScript = webviewSecurity.webviewVsCodeApiScript();
  assert.match(apiScript, /function kronosVsCodeApi\(\) \{/);
  assert.match(apiScript, /Symbol\.for\('kronos\.vscodeApi'\)/);
  assert.match(apiScript, /typeof acquireVsCodeApi !== 'function'/);
  assert.match(apiScript, /__kronosFallbackVsCodeApi/);
  assert.match(apiScript, /Failed to acquire VS Code API for Kronos webview action/);
  assert.match(apiScript, /VS Code API unavailable for Kronos webview action/);
  assert.doesNotMatch(apiScript, /root\[cacheKey\] = kronosFallbackVsCodeApi\(\)/);
  assert.match(apiScript, /data-kronos-script-ready/);
  assert.match(apiScript, /Kronos webview script ready/);
  assert.match(apiScript, /Kronos webview script error/);
  assert.match(apiScript, /Kronos webview unhandled rejection/);
  assert.doesNotMatch(apiScript, /window\.__kronosVscodeApi/);
  assert.doesNotMatch(apiScript, /const vscode =/);
  assert.doesNotMatch(apiScript, /var vscode =/);
  assert.equal(webviewSecurity.WEBVIEW_READY_COMMAND, '__kronosWebviewReady');
  assert.equal(webviewSecurity.WEBVIEW_RUNTIME_SCRIPT, 'kronos-webview-runtime.js');
  assert.equal(Object.prototype.hasOwnProperty.call(webviewSecurity, 'webviewScriptDiagnosticBanner'), false);
  const scriptableHtml = webviewSecurity.withWebviewCsp('<!DOCTYPE html><html><head><style>body{}</style></head><body><button>ok</button></body></html>', {
    allowScripts: true,
    nonce: 'abc123',
  });
  assert.match(scriptableHtml, /data-kronos-script-required/);
  assert.match(scriptableHtml, /Webview Developer Tools/);
  assert.match(scriptableHtml, /Extension Host DevTools/);
  assert.match(scriptableHtml, /<body>\n<div class="kronos-script-required"/);
  assert.equal((scriptableHtml.match(/data-kronos-script-required/g) || []).length, 1);
  const alreadyDiagnosed = webviewSecurity.withWebviewCsp('<!DOCTYPE html><html><head></head><body><div data-kronos-script-required></div></body></html>', {
    allowScripts: true,
    nonce: 'abc123',
  });
  assert.equal((alreadyDiagnosed.match(/data-kronos-script-required/g) || []).length, 1);
  const fakeButton = {
    closest(selector) { return selector === '[data-action]' ? this : null; },
    getAttribute(name) {
      return {
        'data-action': 'openRunRecord',
        'data-ticket': 'K-1',
        'data-run-id': 'run-1',
      }[name] || '';
    },
  };
  assert.equal(webviewSecurity.WEBVIEW_ACTION_PANEL_SCRIPT, 'kronos-action-panel.js');
  assert.equal(webviewSecurity.WEBVIEW_JIRA_BOARD_SCRIPT, 'kronos-jira-board.js');
  const runtimeScript = readSourceFixture('media', webviewSecurity.WEBVIEW_RUNTIME_SCRIPT);
  assert.match(runtimeScript, /KronosWebviewRuntime/);
  assert.match(runtimeScript, /function vscodeApi\(\)/);
  assert.match(runtimeScript, /Symbol\.for\('kronos\.vscodeApi'\)/);
  assert.match(runtimeScript, /__kronosFallbackVsCodeApi/);
  assert.match(runtimeScript, /function createReadyPoster/);
  assert.match(runtimeScript, /var readyAttempts = 0/);
  assert.match(runtimeScript, /var maxReadyAttempts = 20/);
  assert.match(runtimeScript, /Kronos webview script ready/);
  assert.match(runtimeScript, /Kronos webview script error/);
  assert.match(runtimeScript, /Kronos webview unhandled rejection/);
  assert.doesNotMatch(runtimeScript, /root\[cacheKey\] = kronosFallbackVsCodeApi\(\)/);
  const externalScriptTag = webviewSecurity.webviewActionScriptTag('nonce<1>', 'Kronos External', [
    { messageKey: 'runId', dataAttribute: 'data-run-id' },
  ], { readyCommand: webviewSecurity.WEBVIEW_READY_COMMAND, scriptUri: 'vscode-resource://kronos/action.js?x=1&y=<2>' });
  assert.match(externalScriptTag, /<script nonce="nonce&lt;1&gt;"\s+id="kronos-webview-runtime-script"\s+src="vscode-resource:\/\/kronos\/kronos-webview-runtime\.js\?x=1&amp;y=&lt;2&gt;"/);
  assert.match(externalScriptTag, /<script nonce="nonce&lt;1&gt;"\s+id="kronos-action-panel-script"\s+src="vscode-resource:\/\/kronos\/action\.js\?x=1&amp;y=&lt;2&gt;"/);
  assert.match(externalScriptTag, /data-kronos-script-kind="action-panel"/);
  assert.match(externalScriptTag, /data-kronos-webview-name="Kronos External"/);
  assert.match(externalScriptTag, /data-kronos-action-fields="\[\{&quot;messageKey&quot;:&quot;runId&quot;,&quot;dataAttribute&quot;:&quot;data-run-id&quot;\}\]"/);
  assert.match(externalScriptTag, /data-kronos-ready-command="__kronosWebviewReady"/);
  assert.doesNotMatch(externalScriptTag, /data-kronos-inline-fallback="action-panel"/);
  assert.doesNotMatch(externalScriptTag, /function postKronosAction/);

  const externalActionScript = readSourceFixture('media', webviewSecurity.WEBVIEW_ACTION_PANEL_SCRIPT);
  assert.match(externalActionScript, /document\.currentScript/);
  assert.match(externalActionScript, /function findKronosActionScript/);
  assert.match(externalActionScript, /kronos-action-panel-script/);
  assert.match(externalActionScript, /KronosWebviewRuntime/);
  assert.match(externalActionScript, /runtime\.createReadyPoster/);
  assert.match(externalActionScript, /runtime\.vscodeApi\(\)\.postMessage/);
  assert.match(externalActionScript, /runtime\.markReady\(webviewName\)/);
  assert.match(externalActionScript, /runtime\.installDiagnostics\(webviewName\)/);
  assert.match(externalActionScript, /data-kronos-action-fields/);
  assert.match(externalActionScript, /function postKronosAction/);
  assert.match(externalActionScript, /function claimKronosActionHandler/);
  assert.match(externalActionScript, /__kronosActionHandlerAttached/);
  assert.match(externalActionScript, /data-kronos-action-handler-attached/);
  assert.doesNotMatch(externalActionScript, /Symbol\.for\('kronos\.actionHandlerAttached'\)/);
  assert.doesNotMatch(externalActionScript, /const vscode =/);
  const externalPostedMessages = [];
  const externalDocumentListeners = {};
  const externalDocumentElementAttributes = {};
  let externalAcquireCalls = 0;
  const externalSandbox = {
    acquireVsCodeApi: () => {
      externalAcquireCalls += 1;
      return { postMessage: message => externalPostedMessages.push(message) };
    },
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Kronos Windows Webview Test' },
    setTimeout(handler) { handler(); },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos External',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
            'data-kronos-action-fields': JSON.stringify([
              { messageKey: 'ticket', dataAttribute: 'data-ticket' },
              { messageKey: 'runId', dataAttribute: 'data-run-id' },
            ]),
          }[name] || '';
        },
      },
      documentElement: {
        setAttribute(name, value) { externalDocumentElementAttributes[name] = value; },
      },
      addEventListener(type, handler) { externalDocumentListeners[type] = handler; },
    },
  };
  vm.runInNewContext(`${runtimeScript}\n${externalActionScript}`, externalSandbox);
  assert.equal(externalDocumentElementAttributes['data-kronos-script-ready'], 'true');
  assert.equal(externalDocumentElementAttributes['data-kronos-actions-ready'], 'true');
  assert.equal(externalDocumentElementAttributes['data-kronos-webview'], 'Kronos External');
  assert.equal(externalPostedMessages[0].command, webviewSecurity.WEBVIEW_READY_COMMAND);
  assert.equal(externalPostedMessages[0].webviewName, 'Kronos External');
  assert.equal(typeof externalDocumentListeners.click, 'function');
  externalDocumentListeners.click({ target: fakeButton, preventDefault() {} });
  assert.equal(externalPostedMessages[1].command, 'openRunRecord');
  assert.equal(externalPostedMessages[1].ticket, 'K-1');
  assert.equal(externalPostedMessages[1].runId, 'run-1');
  assert.equal(externalAcquireCalls, 1);
  const externalReadyRetryMessages = [];
  const externalReadyRetryListeners = {};
  const externalReadyRetryTimeouts = [];
  let externalReadyRetryAcquireCalls = 0;
  vm.runInNewContext(`${runtimeScript}\n${externalActionScript}`, {
    acquireVsCodeApi: () => {
      externalReadyRetryAcquireCalls += 1;
      if (externalReadyRetryAcquireCalls === 1) { throw new Error('transient acquire failure'); }
      return { postMessage: message => externalReadyRetryMessages.push(message) };
    },
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Kronos Windows Webview External Ready Retry Test' },
    setTimeout(handler, ms) {
      externalReadyRetryTimeouts.push(ms);
      handler();
    },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos External Retry',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
            'data-kronos-action-fields': JSON.stringify([
              { messageKey: 'ticket', dataAttribute: 'data-ticket' },
              { messageKey: 'runId', dataAttribute: 'data-run-id' },
            ]),
          }[name] || '';
        },
      },
      documentElement: { setAttribute() {} },
      addEventListener(type, handler) { externalReadyRetryListeners[type] = handler; },
    },
  });
  assert.equal(externalReadyRetryAcquireCalls, 2);
  assert.deepEqual(externalReadyRetryTimeouts, [0, 50]);
  assert.equal(externalReadyRetryMessages.length, 1);
  assert.equal(externalReadyRetryMessages[0].command, webviewSecurity.WEBVIEW_READY_COMMAND);
  assert.equal(externalReadyRetryMessages[0].webviewName, 'Kronos External Retry');
  assert.equal(typeof externalReadyRetryListeners.click, 'function');
  const externalUnavailableTimeouts = [];
  const externalUnavailableWarnings = [];
  vm.runInNewContext(`${runtimeScript}\n${externalActionScript}`, {
    console: { info() {}, warn(...args) { externalUnavailableWarnings.push(args.join(' ')); }, error() {} },
    navigator: { userAgent: 'Kronos Windows Webview Missing API Test' },
    setTimeout(handler, ms) {
      externalUnavailableTimeouts.push(ms);
      handler();
    },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos External Missing API',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
            'data-kronos-action-fields': '[]',
          }[name] || '';
        },
      },
      documentElement: { setAttribute() {} },
      addEventListener() {},
    },
  });
  assert.equal(externalUnavailableTimeouts.length, 20);
  assert.equal(externalUnavailableTimeouts[0], 0);
  assert.deepEqual(externalUnavailableTimeouts.slice(1), Array(19).fill(50));
  assert.ok(externalUnavailableWarnings.some(message => message.includes('could not acquire VS Code API after ready retries')));
  const externalNullPostedMessages = [];
  const externalNullListeners = {};
  const externalNullScript = {
    getAttribute(name) {
      return {
        'data-kronos-webview-name': 'Kronos External Null CurrentScript',
        'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
        'data-kronos-action-fields': JSON.stringify([
          { messageKey: 'ticket', dataAttribute: 'data-ticket' },
          { messageKey: 'runId', dataAttribute: 'data-run-id' },
        ]),
      }[name] || '';
    },
  };
  vm.runInNewContext(`${runtimeScript}\n${externalActionScript}`, {
    acquireVsCodeApi: () => ({ postMessage: message => externalNullPostedMessages.push(message) }),
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Kronos Windows Webview Null CurrentScript Test' },
    setTimeout(handler) { handler(); },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: null,
      getElementById(id) { return id === 'kronos-action-panel-script' ? externalNullScript : null; },
      documentElement: { setAttribute() {} },
      addEventListener(type, handler) { externalNullListeners[type] = handler; },
    },
  });
  assert.equal(externalNullPostedMessages[0].webviewName, 'Kronos External Null CurrentScript');
  externalNullListeners.click({ target: fakeButton, preventDefault() {} });
  assert.equal(externalNullPostedMessages[1].ticket, 'K-1');

  const jiraBoardScript = readSourceFixture('media', webviewSecurity.WEBVIEW_JIRA_BOARD_SCRIPT);
  assert.match(jiraBoardScript, /document\.currentScript/);
  assert.match(jiraBoardScript, /function findKronosJiraBoardScript/);
  assert.match(jiraBoardScript, /kronos-jira-board-script/);
  assert.match(jiraBoardScript, /KronosWebviewRuntime/);
  assert.match(jiraBoardScript, /runtime\.createReadyPoster/);
  assert.match(jiraBoardScript, /runtime\.vscodeApi\(\)\.postMessage/);
  assert.match(jiraBoardScript, /runtime\.markReady\(webviewName\)/);
  assert.match(jiraBoardScript, /runtime\.installDiagnostics\(webviewName\)/);
  assert.match(jiraBoardScript, /function initKronosJiraBoard/);
  assert.match(jiraBoardScript, /function claimKronosJiraBoard/);
  assert.match(jiraBoardScript, /__kronosJiraBoardAttached/);
  assert.match(jiraBoardScript, /data-kronos-jira-board-attached/);
  assert.doesNotMatch(jiraBoardScript, /Symbol\.for\('kronos\.jiraBoardAttached'\)/);
  assert.match(jiraBoardScript, /kronos-jira-ticket-data/);
  assert.match(jiraBoardScript, /data-kronos-actions-ready/);
  assert.match(jiraBoardScript, /function closestBoardTarget/);
  assert.doesNotMatch(jiraBoardScript, /const vscode =/);
  const jiraPostedMessages = [];
  const jiraDocumentListeners = {};
  const jiraDocumentElementAttributes = {};
  const jiraActionButton = {
    parentElement: null,
    matches(selector) { return selector === '[data-action]'; },
    getAttribute(name) {
      return {
        'data-action': 'removeFromQueue',
        'data-ticket': 'K-77',
        'data-project': '',
      }[name] || '';
    },
  };
  const jiraBoardElement = {
    addEventListener(type, handler) { jiraDocumentListeners[`board:${type}`] = handler; },
  };
  const jiraSandbox = {
    acquireVsCodeApi: () => ({ postMessage: message => jiraPostedMessages.push(message) }),
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Kronos Windows Jira Board Webview Test' },
    setTimeout(handler) { handler(); },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos Jira Board',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
          }[name] || '';
        },
      },
      documentElement: {
        setAttribute(name, value) { jiraDocumentElementAttributes[name] = value; },
      },
      getElementById(id) {
        if (id === 'kronos-jira-ticket-data') { return { value: '{}' }; }
        return null;
      },
      querySelector(selector) {
        if (selector === '.board') { return jiraBoardElement; }
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener(type, handler) { jiraDocumentListeners[type] = handler; },
    },
  };
  vm.runInNewContext(`${runtimeScript}\n${jiraBoardScript}`, jiraSandbox);
  assert.equal(jiraDocumentElementAttributes['data-kronos-script-ready'], 'true');
  assert.equal(jiraDocumentElementAttributes['data-kronos-actions-ready'], 'true');
  assert.equal(jiraPostedMessages[0].command, webviewSecurity.WEBVIEW_READY_COMMAND);
  assert.equal(typeof jiraDocumentListeners['board:click'], 'function');
  let jiraStopped = false;
  jiraDocumentListeners['board:click']({
    target: { parentElement: jiraActionButton },
    stopPropagation() { jiraStopped = true; },
  });
  assert.equal(jiraStopped, true);
  assert.equal(jiraPostedMessages[1].command, 'removeFromQueue');
  assert.equal(jiraPostedMessages[1].ticket, 'K-77');

  const jiraReadyRetryMessages = [];
  let jiraReadyAcquireCalls = 0;
  const jiraReadyTimeouts = [];
  vm.runInNewContext(`${runtimeScript}\n${jiraBoardScript}`, {
    acquireVsCodeApi() {
      jiraReadyAcquireCalls += 1;
      if (jiraReadyAcquireCalls === 1) { throw new Error('transient acquire failure'); }
      return { postMessage: message => jiraReadyRetryMessages.push(message) };
    },
    console: { info() {}, warn() {}, error() {} },
    navigator: { userAgent: 'Kronos Windows Jira Ready Retry Test' },
    setTimeout(handler, ms) {
      jiraReadyTimeouts.push(ms);
      handler();
    },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos Jira Board',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
          }[name] || '';
        },
      },
      documentElement: { setAttribute() {} },
      getElementById(id) {
        if (id === 'kronos-jira-ticket-data') { return { value: '{}' }; }
        return null;
      },
      querySelector(selector) {
        if (selector === '.board') { return { addEventListener() {} }; }
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
  });
  assert.equal(jiraReadyAcquireCalls, 2);
  assert.deepEqual(jiraReadyTimeouts, [0, 50]);
  assert.equal(jiraReadyRetryMessages.length, 1);
  assert.equal(jiraReadyRetryMessages[0].command, webviewSecurity.WEBVIEW_READY_COMMAND);
  const jiraUnavailableTimeouts = [];
  const jiraUnavailableWarnings = [];
  vm.runInNewContext(`${runtimeScript}\n${jiraBoardScript}`, {
    console: { info() {}, warn(...args) { jiraUnavailableWarnings.push(args.join(' ')); }, error() {} },
    navigator: { userAgent: 'Kronos Windows Jira Missing API Test' },
    setTimeout(handler, ms) {
      jiraUnavailableTimeouts.push(ms);
      handler();
    },
    window: { addEventListener() {} },
    document: {
      readyState: 'complete',
      currentScript: {
        getAttribute(name) {
          return {
            'data-kronos-webview-name': 'Kronos Jira Board',
            'data-kronos-ready-command': webviewSecurity.WEBVIEW_READY_COMMAND,
          }[name] || '';
        },
      },
      documentElement: { setAttribute() {} },
      getElementById(id) {
        if (id === 'kronos-jira-ticket-data') { return { value: '{}' }; }
        return null;
      },
      querySelector(selector) {
        if (selector === '.board') { return { addEventListener() {} }; }
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() {},
    },
  });
  assert.equal(jiraUnavailableTimeouts.length, 20);
  assert.equal(jiraUnavailableTimeouts[0], 0);
  assert.deepEqual(jiraUnavailableTimeouts.slice(1), Array(19).fill(50));
  assert.ok(jiraUnavailableWarnings.some(message => message.includes('could not acquire VS Code API after ready retries')));

  const button = operatorPanel.actionButton('open<Thing>', 'Open & Check', {
    ticket: 'T-1',
    runId: 'run"1',
    planId: 'plan<1>',
    itemId: 'item&1',
    recoveryAction: 'openRunLog',
    primary: true,
  });
  assert.match(button, /class="kronos-button primary"/);
  assert.match(button, /data-action="open&lt;Thing&gt;"/);
  assert.match(button, /data-ticket="T-1"/);
  assert.match(button, /data-run-id="run&quot;1"/);
  assert.match(button, /data-plan-id="plan&lt;1&gt;"/);
  assert.match(button, /data-item-id="item&amp;1"/);
  assert.match(button, /data-recovery-action="openRunLog"/);
  assert.ok(button.endsWith('>Open &amp; Check</button>'));
  assert.equal(operatorPanel.actionRow([]), '<span class="muted">No action</span>');
  assert.equal(operatorPanel.operatorCommandRow([]), '');
  assert.match(operatorPanel.actionRow([button]), /inline-actions/);
  assert.match(operatorPanel.operatorCommandRow([button]), /operator-command-row/);
  const allowedActions = new Set(['openRunRecord']);
  assert.deepEqual(operatorPanel.normalizeActionPanelMessage({
    command: 'openRunRecord',
    ticket: ' K-1 ',
    runId: 'run-1',
    planId: 'plan-1',
    itemId: 'item-1',
    recoveryAction: 'retryRun',
  }, allowedActions), {
    command: 'openRunRecord',
    ticket: 'K-1',
    runId: 'run-1',
    planId: 'plan-1',
    itemId: 'item-1',
    recoveryAction: 'retryRun',
  });
  assert.deepEqual(operatorPanel.normalizeActionPanelMessage({
    command: 'openRunRecord',
    ticket: 42,
    runId: null,
    planId: false,
    itemId: { id: 'bad' },
    recoveryAction: 88,
  }, allowedActions), {
    command: 'openRunRecord',
    ticket: '',
    runId: '',
    planId: '',
    itemId: '',
    recoveryAction: '',
  });
  assert.equal(operatorPanel.normalizeActionPanelMessage({ command: 'unknown' }, allowedActions), null);
  assert.equal(operatorPanel.normalizeActionPanelMessage(null, allowedActions), null);
  assert.equal(webviewMessages.normalizeWebviewCommand({ command: 'openRunRecord' }, allowedActions), 'openRunRecord');
  assert.equal(webviewMessages.normalizeWebviewCommand({ command: 'unknown' }, allowedActions), null);
  assert.deepEqual(webviewMessages.normalizeBoardMessage({
    command: 'linkProject',
    ticket: ' K-BOARD ',
    project: ' app ',
  }, new Set(['linkProject'])), {
    command: 'linkProject',
    ticket: ' K-BOARD ',
    project: ' app ',
  });
  assert.deepEqual(webviewMessages.normalizeBoardMessage({
    command: 'linkProject',
    ticket: 42,
    project: null,
  }, new Set(['linkProject'])), {
    command: 'linkProject',
    ticket: '',
    project: '',
  });
  assert.equal(webviewMessages.normalizeBoardMessage({ command: 'unknown' }, new Set(['linkProject'])), null);
  assert.deepEqual(webviewMessages.normalizeRunCenterMessage({
    command: 'refreshPanel',
  }, new Set(['refreshPanel', 'openRunRecord']), new Set(['refreshPanel'])), {
    command: 'refreshPanel',
    runId: '',
  });
  assert.deepEqual(webviewMessages.normalizeRunCenterMessage({
    command: 'openRunRecord',
    runId: ' run-1 ',
  }, new Set(['refreshPanel', 'openRunRecord']), new Set(['refreshPanel'])), {
    command: 'openRunRecord',
    runId: ' run-1 ',
  });
  assert.equal(webviewMessages.normalizeRunCenterMessage({ command: 'openRunRecord', runId: ' ' }, new Set(['openRunRecord']), new Set()), null);
  assert.throws(
    () => operatorPanel.kronosActionPanelScript('nonce123', 'Kronos Missing Script'),
    /packaged webview script URI/,
  );
  const panelScript = operatorPanel.kronosActionPanelScript('nonce123', 'Kronos Test', 'vscode-resource://kronos/action.js');
  assert.match(panelScript, /script nonce="nonce123"/);
  assert.match(panelScript, /Kronos Test/);
  assert.match(panelScript, /data-ticket/);
  assert.match(panelScript, /data-run-id/);
  assert.match(panelScript, /data-plan-id/);
  assert.match(panelScript, /data-item-id/);
  assert.match(panelScript, /data-recovery-action/);
  assert.match(panelScript, /__kronosWebviewReady/);
  const defaultPanelScript = operatorPanel.kronosActionPanelScript('nonce-default', undefined, 'vscode-resource://kronos/action.js');
  assert.match(defaultPanelScript, /__kronosWebviewReady/);

  const existing = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src test"></head><body></body></html>';
  assert.equal(webviewSecurity.withWebviewCsp(existing), existing);
});

test('webview diagnostics centralize host ready monitoring', () => {
  const infoMessages = [];
  const originalInfo = console.info;
  console.info = (...args) => infoMessages.push(args.join(' '));
  try {
    let disposeListener;
    const panel = {
      onDidDispose(listener) {
        disposeListener = listener;
        return { dispose() {} };
      },
    };
    const monitor = webviewDiagnostics.createWebviewReadyMonitor(panel, 'Kronos Monitor Panel', 10000);
    assert.equal(monitor({ command: 'noop' }), false);
    assert.equal(monitor({
      command: webviewSecurity.WEBVIEW_READY_COMMAND,
      readyState: 'complete',
    }), true);
    assert.match(infoMessages.join('\n'), /Kronos Monitor Panel/);
    assert.equal(monitor({
      command: webviewSecurity.WEBVIEW_READY_COMMAND,
      webviewName: 'Kronos Monitor Panel',
      readyState: 'interactive',
    }), true);
    assert.match(infoMessages.join('\n'), /interactive/);
    const specificPanelMonitor = webviewDiagnostics.createWebviewReadyMonitor(panel, 'Specific Panel', 10000);
    assert.equal(specificPanelMonitor({
      command: webviewSecurity.WEBVIEW_READY_COMMAND,
      webviewName: 'Kronos action panel',
      readyState: 'complete',
    }), true);
    assert.match(infoMessages.join('\n'), /Specific Panel/);
    assert.equal(typeof disposeListener, 'function');
    disposeListener();
  } finally {
    console.info = originalInfo;
  }
});

test('webview diagnostics can re-arm readiness checks after rerender', () => {
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  const scheduled = [];
  const cleared = [];
  let disposeListener;
  global.setTimeout = (fn, ms) => {
    const timer = { fn, ms, id: scheduled.length + 1 };
    scheduled.push(timer);
    return timer;
  };
  global.clearTimeout = timer => {
    cleared.push(timer);
  };
  try {
    const panel = {
      onDidDispose(listener) {
        disposeListener = listener;
        return { dispose() {} };
      },
    };
    const monitor = webviewDiagnostics.createWebviewReadyMonitor(panel, 'Kronos Rerender Panel', 123);
    assert.equal(typeof monitor.arm, 'function');
    assert.equal(scheduled.length, 0);
    assert.equal(monitor({ command: 'noop' }), false);
    assert.equal(cleared.length, 0);
    assert.equal(monitor({
      command: webviewSecurity.WEBVIEW_READY_COMMAND,
      webviewName: 'Kronos Rerender Panel',
      readyState: 'complete',
    }), true);
    assert.equal(cleared.length, 0);

    monitor.arm();
    assert.equal(scheduled.length, 1);
    assert.equal(cleared.length, 0);
    monitor.arm();
    assert.equal(scheduled.length, 2);
    assert.equal(cleared.length, 1);
    assert.equal(typeof disposeListener, 'function');
    disposeListener();
    assert.equal(cleared.length, 2);
    monitor.arm();
    assert.equal(scheduled.length, 2);
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }
});

test('CLI probes centralize Claude and GCloud argv checks', () => {
  const calls = [];
  const commandRunner = (command, args, options) => {
    calls.push({ command, args, options });
    const joined = mockCommandLine(command, args);
    if (joined === 'claude agents --json') {
      return JSON.stringify([{ id: 'agent-1', status: 'running' }]);
    }
    if (joined === 'claude -p ok --model claude-sonnet-4-6 --permission-mode auto') {
      return 'ok\n';
    }
    if (joined === 'gcloud auth application-default print-access-token') {
      return 'token-value\n';
    }
    throw new Error(`unexpected command ${joined}`);
  };

  assert.deepEqual(cliProbes.readClaudeAgents({ commandRunner }), [{ id: 'agent-1', status: 'running' }]);
  assert.equal(cliProbes.checkClaudeModelAccess('claude-sonnet-4-6', { commandRunner }).ok, true);
  assert.equal(cliProbes.checkGcloudApplicationDefaultAuth({ platform: 'linux', commandRunner }).ok, true);

  assert.deepEqual(calls.map(call => [mockCommandName(call.command), call.args, call.options.timeoutMs]), [
    ['claude', ['agents', '--json'], 5000],
    ['claude', ['-p', 'ok', '--model', 'claude-sonnet-4-6', '--permission-mode', 'auto'], 15000],
    ['gcloud', ['auth', 'application-default', 'print-access-token'], 10000],
  ]);

  const missingWindowsCalls = [];
  const missingWindowsGcloud = cliProbes.checkGcloudApplicationDefaultAuth({
    platform: 'win32',
    existsSync: () => false,
    commandRunner(command, args, options) {
      missingWindowsCalls.push({ command, args, options });
      return commandRunner(command, args, options);
    },
  });
  assert.equal(missingWindowsGcloud.ok, false);
  assert.match(missingWindowsGcloud.error, /gcloud\.cmd unavailable/);
  assert.deepEqual(missingWindowsCalls, []);

  const pathGcloud = 'C:\\Tools\\Google Cloud SDK\\bin\\gcloud.cmd';
  const pathWindowsCalls = [];
  assert.equal(cliProbes.checkGcloudApplicationDefaultAuth({
    platform: 'win32',
    env: { Path: 'C:\\Tools\\Google Cloud SDK\\bin' },
    existsSync: filePath => filePath === pathGcloud,
    commandRunner(command, args, options) {
      pathWindowsCalls.push({ command, args, options });
      return commandRunner(command, args, options);
    },
  }).ok, true);
  assert.deepEqual(pathWindowsCalls.map(call => [mockCommandName(call.command), call.args, call.options.timeoutMs]), [
    ['gcloud', ['auth', 'application-default', 'print-access-token'], 10000],
  ]);
});

test('CLI probes normalize failures and invalid Claude agent output', () => {
  const failed = cliProbes.checkGcloudApplicationDefaultAuth({
    platform: 'linux',
    commandRunner: () => { throw new Error('expired application default credentials'); },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /expired application default credentials/);

  const stringFailure = cliProbes.checkClaudeModelAccess('claude-sonnet-4-6', {
    commandRunner: () => { throw 'claude unavailable'; },
  });
  assert.equal(stringFailure.ok, false);
  assert.equal(stringFailure.error, 'claude unavailable');

  const fallbackFailure = cliProbes.checkClaudeModelAccess('claude-sonnet-4-6', {
    commandRunner: () => { throw { message: '   ' }; },
  });
  assert.equal(fallbackFailure.ok, false);
  assert.equal(fallbackFailure.error, 'CLI probe failed');

  assert.deepEqual(cliProbes.readClaudeAgents({ commandRunner: () => '{bad json' }), []);
  assert.deepEqual(cliProbes.readClaudeAgents({ commandRunner: () => JSON.stringify({ id: 'not-an-array' }) }), []);

  const source = readSourceFixture('src', 'services', 'cliProbes.ts');
  for (const marker of [
    'catch (e: unknown)',
    "import { unknownErrorMessage } from './errorUtils'",
    "unknownErrorMessage(e, 'CLI probe failed')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    'function unknownErrorMessage(error: unknown',
    "Reflect.get(error, 'message')",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('error utils normalize unknown error shapes', () => {
  assert.equal(errorUtils.unknownErrorMessage(new Error('broken command'), 'fallback'), 'broken command');
  assert.equal(errorUtils.unknownErrorMessage('string failure', 'fallback'), 'string failure');
  assert.equal(errorUtils.unknownErrorMessage({ message: '   ' }, 'fallback'), 'fallback');
  assert.equal(errorUtils.unknownErrorMessage(null, 'fallback'), 'fallback');
  assert.equal(errorUtils.unknownErrorField({ stderr: 'stderr failure' }, 'stderr'), 'stderr failure');
  assert.equal(errorUtils.unknownErrorCode({ code: 'ENOENT' }), 'ENOENT');
  assert.equal(errorUtils.unknownErrorCode({ code: 13 }), '13');
  assert.equal(errorUtils.unknownErrorCode({ code: '   ' }), '');

  const source = readSourceFixture('src', 'services', 'errorUtils.ts');
  for (const marker of [
    'export function unknownErrorMessage(error: unknown, fallback: string): string',
    'export function unknownErrorCode(error: unknown): string',
    'export function unknownErrorField(error: unknown, key: string): unknown',
    "Reflect.get(error, key)",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('CLI probes resolve gcloud.cmd on Windows', () => {
  const gcloudCmd = 'C:\\Users\\dev\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
  const env = { LocalAppData: 'C:\\Users\\dev\\AppData\\Local' };
  assert.deepEqual(
    cliProbes.resolveGcloudCommandStatus({
      platform: 'win32',
      env,
      existsSync: filePath => filePath === gcloudCmd,
    }),
    { command: gcloudCmd, available: true },
  );
  assert.deepEqual(
    cliProbes.resolveGcloudCommandStatus({
      platform: 'win32',
      env: {},
      existsSync: () => false,
    }),
    { command: 'gcloud.cmd', available: false },
  );
  assert.deepEqual(
    cliProbes.resolveGcloudCommandStatus({
      platform: 'win32',
      env: {},
      existsSync: () => false,
    }),
    { command: 'gcloud.cmd', available: false },
  );
  assert.deepEqual(
    cliProbes.resolveGcloudCommandStatus({
      platform: 'win32',
      env: { Path: 'C:\\Tools\\Google Cloud SDK\\bin' },
      existsSync: filePath => filePath === 'C:\\Tools\\Google Cloud SDK\\bin\\gcloud.cmd',
    }),
    { command: 'C:\\Tools\\Google Cloud SDK\\bin\\gcloud.cmd', available: true },
  );

  const calls = [];
  const result = cliProbes.checkGcloudApplicationDefaultAuth({
    platform: 'win32',
    env,
    existsSync: filePath => filePath === gcloudCmd,
    commandRunner(command, args, options) {
      calls.push({ command, args, options });
      return 'token-value\n';
    },
  });

  assert.equal(result.ok, true);
  assert.equal(calls[0].command, gcloudCmd);
  assert.deepEqual(calls[0].args, ['auth', 'application-default', 'print-access-token']);

  assert.equal(cliProbes.commandNeedsCmdWrapper(gcloudCmd, 'win32'), true);
  assert.equal(cliProbes.commandNeedsCmdWrapper(gcloudCmd, 'linux'), false);
  const invocation = cliProbes.windowsCmdFileInvocation(gcloudCmd, ['auth', 'application-default', 'print-access-token'], {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args.slice(0, 2), ['/d', '/c']);
  assert.equal(invocation.args[2].startsWith('call "C:\\Users\\dev\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"'), true);
  assert.match(invocation.args[2], /"C:\\Users\\dev\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud\.cmd"/);
  assert.match(invocation.args[2], /application-default/);
  assert.doesNotMatch(invocation.args[2], /^call ""/);

  const fallbackInvocation = cliProbes.windowsCmdFileInvocation('gcloud.cmd', ['auth', 'application-default'], {
    ComSpec: 'C:\\Windows\\System32\\cmd.exe',
  });
  assert.equal(fallbackInvocation.args[2].startsWith('call gcloud.cmd auth application-default'), true);
  assert.doesNotMatch(fallbackInvocation.args[2], /"gcloud\.cmd"/);
});

test('CLI probes accept readable GOOGLE_APPLICATION_CREDENTIALS without running gcloud', () => {
  const dir = makeTempDir('kronos-gac-');
  const credentialsPath = path.join(dir, 'service-account.json');
  fs.writeFileSync(credentialsPath, '{}');
  const result = cliProbes.checkGcloudApplicationDefaultAuth({
    env: { GOOGLE_APPLICATION_CREDENTIALS: credentialsPath },
    commandRunner: () => { throw new Error('gcloud should not run'); },
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /GOOGLE_APPLICATION_CREDENTIALS file is readable/);
});

test('feedback readiness script runs npm and npx through the Windows shell', () => {
  const source = readSourceFixture('scripts', 'prepare-human-feedback.js');
  for (const marker of [
    "const IS_WINDOWS = process.platform === 'win32'",
    'shell: shouldUseWindowsShell(command)',
    "return IS_WINDOWS && (command === 'npm' || command === 'npx');",
    "run('npx', ['--yes', '@vscode/vsce', 'ls', '--tree', '--no-dependencies'], { capture: true })",
    "requireFile('HUMAN_FEEDBACK_CHECKLIST.md', [",
    "'HUMAN_FEEDBACK_CHECKLIST.md',\n  'GOOD_TO_GREAT_REVIEW.md',",
    "spawnSync('where.exe', [command]",
    "spawnSync('sh', ['-lc', `command -v ${command}`]",
    'function firstOutputLine(value)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('terminal profiles prefer Windows Git Bash and avoid PowerShell gcloud shims', () => {
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
  const windowsEnv = { ProgramFiles: 'C:\\Program Files' };
  const existsSync = filePath => filePath === gitBash;

  const authTerminal = terminalProfiles.kronosTerminalOptions(
    { name: 'Kronos Auth' },
    { platform: 'win32', env: windowsEnv, existsSync },
  );

  assert.equal(authTerminal.shellPath, gitBash);
  assert.deepEqual(authTerminal.shellArgs, ['--login']);
  assert.equal(
    terminalProfiles.gcloudApplicationDefaultLoginCommand(authTerminal.shellPath, { platform: 'win32' }),
    'gcloud auth application-default login',
  );

  const fallbackTerminal = terminalProfiles.kronosTerminalOptions(
    { name: 'Kronos Auth' },
    { platform: 'win32', env: windowsEnv, existsSync: () => false },
  );

  assert.equal(fallbackTerminal.shellPath, undefined);
  assert.equal(
    terminalProfiles.gcloudApplicationDefaultLoginCommand(fallbackTerminal.shellPath, { platform: 'win32' }),
    'gcloud.cmd auth application-default login',
  );

  const linuxClaudeTerminal = terminalProfiles.kronosLoginShellTerminalOptions(
    { name: 'Claude', cwd: '/repo/app' },
    { platform: 'linux', env: { BASH_PATH: '/custom/bash' }, existsSync: () => false },
  );

  assert.equal(linuxClaudeTerminal.shellPath, '/custom/bash');
  assert.deepEqual(linuxClaudeTerminal.shellArgs, ['--login']);
  assert.equal(linuxClaudeTerminal.cwd, '/repo/app');
});

test('combined verification plans merge real MR branches with safe fallbacks', () => {
  const plans = combinedVerification.buildCombinedVerificationPlan([
    { key: 'K-1', mr: { iid: 11, source_branch: 'feature/K-1-real', state: 'opened', review_status: 'pending_review', url: '' } },
    { key: 'K-2', mr: { iid: 12, state: 'opened', review_status: 'pending_review', url: '' } },
    { key: 'K-3', mr: { iid: 13, source_branch: 'origin/defect/K-3', state: 'opened', review_status: 'pending_review', url: '' } },
    { key: 'K-4', mr: { iid: 14, source_branch: 'feature/K-4;rm -rf /', state: 'opened', review_status: 'pending_review', url: '' } },
  ]);

  assert.equal(plans[0].branch, 'feature/K-1-real');
  assert.match(plans[0].mergeCommand, /git merge origin\/feature\/K-1-real --no-edit/);
  assert.equal(plans[1].branch, 'K-2');
  assert.match(plans[1].mergeCommand, /git merge origin\/K-2 --no-edit/);
  assert.match(plans[1].mergeCommand, /git merge origin\/defect\/K-2 --no-edit/);
  assert.equal(plans[2].branch, 'defect/K-3');
  assert.doesNotMatch(plans[2].mergeCommand, /origin\/defect\/defect\/K-3/);
  assert.equal(plans[3].branch, 'K-4');
  assert.doesNotMatch(plans[3].mergeCommand, /rm -rf/);

  const vars = combinedVerification.buildCombinedVerificationPromptVars(plans);
  assert.equal(vars.ticketKeys, 'K-1, K-2, K-3, K-4');
  assert.match(vars.branchTable, /\| K-1 \| feature\/K-1-real \| !11 \|/);
  assert.match(vars.mergeCommands, /Could not merge feature\/K-1-real/);
});

test('changed file helpers normalize GitLab path variants', () => {
  assert.deepEqual(changedFiles.changedFilePaths({ new_path: './src\\checkout\\retry.ts', old_path: 'src/checkout/old.ts' }), [
    'src/checkout/retry.ts',
    'src/checkout/old.ts',
  ]);
  assert.equal(changedFiles.primaryChangedFilePath({ filename: 'src/orders/create.ts' }), 'src/orders/create.ts');
  assert.deepEqual(changedFiles.changedFilePaths('src/app.ts'), ['src/app.ts']);
  assert.deepEqual(changedFiles.normalizeChangedFiles([42]), []);
  assert.equal(changedFiles.normalizeChangedFilePath, undefined);
  assert.equal(changedFiles.normalizeChangedFile, undefined);
  assert.deepEqual(changedFiles.normalizeChangedFiles([
    null,
    ' ./src\\app.ts ',
    { new_path: './src/new.ts', old_path: 'src/old.ts', diff: '+ok', new_file: true, deleted_file: 'no' },
    { diff: '@@ only diff @@' },
    { path: 42, diff: 99 },
  ]), [
    { path: 'src/app.ts' },
    { new_path: 'src/new.ts', old_path: 'src/old.ts', diff: '+ok', new_file: true },
    { diff: '@@ only diff @@' },
  ]);
});

test('sonar report view renders escaped report data and command buttons', () => {
  const report = sonarReportView.buildSonarReport({
    projectName: '<project>',
    branch: 'feature/<x>',
    sonarKey: 'proj:key',
    host: 'https://sonar.example/base',
    nonce: `nonce'"123`,
    gate: {
      projectStatus: {
        status: 'ERROR',
        conditions: [
          { status: 'OK', metricKey: 'new_coverage', comparator: 'LT', errorThreshold: '80', actualValue: '90' },
          { status: 'ERROR', metricKey: 'new_duplicated_lines_density', comparator: 'GT', errorThreshold: '3', actualValue: '9' },
        ],
      },
    },
    measures: { component: { measures: [{ metric: 'coverage', value: '82.5' }] } },
    issues: {
      issues: [
        { severity: 'CRITICAL"><script>', rule: 'java:S123', component: 'app:src/App.java', line: 12, message: '<bad>' },
      ],
    },
    actionScriptUri: ACTION_SCRIPT_URI,
  });

  assert.equal(report.issueList.length, 1);
  assert.equal(report.dashboardUrl, 'https://sonar.example/base/dashboard?id=proj%3Akey&branch=feature%2F%3Cx%3E');
  assert.match(report.html, /script nonce="nonce&#39;&quot;123"/);
  assert.doesNotMatch(report.html, /script nonce="nonce'"123"/);
  assert.match(report.html, /id="kronos-webview-runtime-script"/);
  assert.match(report.html, /id="kronos-action-panel-script"/);
  assert.match(report.html, /data-kronos-webview-name="Kronos Sonar Report"/);
  assert.match(report.html, /data-action="fixSonar"/);
  assert.doesNotMatch(report.html, /kronosVsCodeApi/);
  assert.match(report.html, /Open in SonarQube/);
  assert.match(report.html, /New Duplicated Lines Density/);
  assert.match(report.html, /&lt;project&gt;/);
  assert.match(report.html, /feature\/&lt;x&gt;/);
  assert.match(report.html, /&lt;bad&gt;/);
  assert.doesNotMatch(report.html, /<bad>/);
  assert.match(report.html, /class="kronos-shell sonar-shell"/);
  assert.match(report.html, /class="kronos-button primary"/);
  assert.match(report.html, /kronos-pill criticalscript/);

  const hiddenDashboard = sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    nonce: 'n',
    gate: {},
    measures: {},
    issues: {},
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.equal(hiddenDashboard.dashboardUrl, undefined);
  assert.doesNotMatch(hiddenDashboard.html, /open-sonar/);

  const malformedPayload = sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    nonce: 'n',
    gate: { projectStatus: { status: 'WARN', conditions: { not: 'an array' } } },
    measures: { component: { measures: { not: 'an array' } } },
    issues: { issues: [null, 'bad', { severity: 'MAJOR', message: 42, component: 42, rule: 42, line: 7 }] },
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.equal(malformedPayload.issueList.length, 1);
  assert.match(malformedPayload.html, /Quality Gate: WARN/);
  assert.match(malformedPayload.html, /No metrics available/);
  assert.match(malformedPayload.html, /kronos-pill major/);
  assert.doesNotThrow(() => sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    nonce: 'n',
    gate: null,
    measures: null,
    issues: null,
    actionScriptUri: ACTION_SCRIPT_URI,
  }));
  const unknownReport = sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    nonce: 'n',
    gate: null,
    measures: { measures: 'bad' },
    issues: {},
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.match(unknownReport.html, /Quality Gate: UNKNOWN/);
  assert.doesNotMatch(unknownReport.html, /Gate Conditions/);
  assert.match(unknownReport.html, /No metrics available/);

  const nonHttpDashboard = sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    host: 'file:///tmp/sonar',
    nonce: 'n',
    gate: {},
    measures: {},
    issues: {},
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.equal(nonHttpDashboard.dashboardUrl, undefined);
  assert.doesNotMatch(nonHttpDashboard.html, /Open in SonarQube/);
});

test('sonar command plan normalizes issue payloads and builds fix instructions', () => {
  const issues = sonarCommandPlan.normalizeSonarIssueCommandList([
    null,
    'bad',
    { severity: 'CRITICAL', rule: 'java:S123', component: 'app:src/App.java', line: 12, message: 'Fix it' },
    { line: 0 },
    { message: 42 },
  ]);
  assert.deepEqual(issues, [
    { severity: 'CRITICAL', rule: 'java:S123', component: 'app:src/App.java', line: 12, message: 'Fix it' },
    { line: 0 },
  ]);
  assert.equal(
    sonarCommandPlan.formatSonarIssuePromptLine(issues[0]),
    '- [CRITICAL] S123: src/App.java:12 — Fix it',
  );
  assert.equal(
    sonarCommandPlan.buildKnownSonarIssuesBlock(issues),
    'KNOWN ISSUES (already fetched — do NOT re-query SonarQube for the issue list):\n- [CRITICAL] S123: src/App.java:12 — Fix it\n- [-] -: ?:0 — ',
  );
  assert.equal(sonarCommandPlan.buildKnownSonarIssuesBlock([]), '');
  assert.match(
    sonarCommandPlan.buildSonarFixBranchStrategy('AppSvc', ''),
    /Create a NEW branch: bugfix\/sonar-appsvc from develop/,
  );
  assert.match(
    sonarCommandPlan.buildSonarFixBranchStrategy('AppSvc', 'feature/K-1'),
    /Stay on this branch — push directly/,
  );
  assert.deepEqual(sonarCommandPlan.buildSonarBranchPickItems([
    { name: 'main', isMain: true, status: { qualityGateStatus: 'OK' } },
    { name: 'feature/K-1', isMain: false, status: { qualityGateStatus: 'ERROR' } },
  ], 'develop'), [
    { label: 'main', description: '(main) OK' },
    { label: 'feature/K-1', description: 'ERROR' },
  ]);
  assert.deepEqual(sonarCommandPlan.buildSonarBranchPickItems([], 'develop'), [
    { label: 'develop', description: '(default)' },
  ]);
  assert.deepEqual(sonarCommandPlan.buildSonarBranchPickItems([], 'develop', 'offline'), [
    { label: 'develop', description: '(default; Sonar branches unavailable)', detail: 'offline' },
  ]);
  const instructions = sonarCommandPlan.buildSonarFixInstructionBlock({
    customInstructions: 'skip S1192',
    branchStrategy: sonarCommandPlan.buildSonarFixBranchStrategy('AppSvc', 'main'),
    issuesData: issues,
  });
  assert.match(instructions, /CUSTOM INSTRUCTIONS/);
  assert.match(instructions, /BRANCH STRATEGY/);
  assert.match(instructions, /KNOWN ISSUES/);

  const source = readSourceFixture('src', 'services', 'sonarCommandPlan.ts');
  for (const marker of [
    "import type { SonarIssue } from './sonarReportView'",
    "import { recordFromUnknown } from './records'",
    'export function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
    'export function buildSonarBranchPickItems',
    'export function formatSonarIssuePromptLine(issue: SonarIssue): string',
    'export function buildKnownSonarIssuesBlock(value: unknown): string',
    'export function buildSonarFixBranchStrategy(projectName: string, sourceBranch: string): string',
    'export function buildSonarFixInstructionBlock',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('queue planner records decisions, filters suppressed plans, and selects planning horizons', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');
  const state = baseState({
    'K-1': ticket({ next_action: 'implement', priority: 'High' }),
    'K-2': ticket({ next_action: 'fix_build', priority: 'Critical', build: { number: 1, status: 'FAILURE', url: '' } }),
    'K-3': ticket({ next_action: 'verify', priority: 'Medium' }),
  });
  const initialPlans = queuePlanner.planNextActions({ state, queue: null, now });
  const rejectedPlan = initialPlans.find(plan => plan.ticketKey === 'K-1');
  const snoozedPlan = initialPlans.find(plan => plan.ticketKey === 'K-2');
  assert.ok(rejectedPlan);
  assert.ok(snoozedPlan);

  let queue = queuePlanner.recordQueueDecision(null, rejectedPlan, 'rejected', { now, reason: 'not this sprint' });
  queue = queuePlanner.recordQueueDecision(queue, snoozedPlan, 'snoozed', { now, snoozeMinutes: 90 });

  const filtered = queuePlanner.planNextActions({ state, queue, now: new Date('2026-07-01T12:30:00.000Z') });
  assert.equal(filtered.some(plan => plan.ticketKey === 'K-1'), false);
  assert.equal(filtered.some(plan => plan.ticketKey === 'K-2'), false);
  assert.equal(filtered.some(plan => plan.ticketKey === 'K-3'), true);

  const afterSnooze = queuePlanner.planNextActions({ state, queue, now: new Date('2026-07-01T14:00:00.000Z') });
  assert.equal(afterSnooze.some(plan => plan.ticketKey === 'K-2'), true);

  const cleared = queuePlanner.clearQueueDecision(queue, rejectedPlan);
  assert.equal(cleared.decisions['K-1:implement'], undefined);

  const window = queuePlanner.planForMinutes(initialPlans, 75);
  assert.ok(window.plans.length >= 1);
  assert.ok(window.estimatedMinutes >= queuePlanner.estimatePlanMinutes(window.plans[0]));

  const overnight = queuePlanner.overnightCandidatePlans(initialPlans);
  assert.ok(overnight.every(plan => ['implement', 'in_progress', 'fix_build'].includes(plan.action)));
  assert.ok(overnight.every(plan => plan.projects.length > 0));
});

test('action semantics centralize code and handoff action groups', () => {
  assert.deepEqual(actionCatalog.TICKET_ACTIONS, [
    'implement',
    'in_progress',
    'fix_build',
    'await_review',
    'verify',
    'deploy_monitor',
    'blocked',
    'done',
  ]);
  assert.deepEqual(actionCatalog.QUEUE_ACTIONS, [...actionCatalog.TICKET_ACTIONS, 'refresh']);
  assert.equal(actionCatalog.actionDisplayLabel('fix_build'), 'Build Failed');
  assert.equal(actionCatalog.actionDisplayLabel('custom_action'), 'custom action');
  assert.equal(actionCatalog.actionSkill('await_review'), 'verify-fix');
  assert.equal(actionCatalog.actionSkill('deploy_monitor'), 'deploy-monitor');
  assert.equal(actionCatalog.actionSkill('verify'), 'verify-fix');
  assert.equal(actionCatalog.actionSkill('unknown'), 'implement');
  assert.equal(actionCatalog.actionEstimateMinutes('refresh'), 10);
  assert.equal(actionCatalog.actionPlanningScore('fix_build'), 95);
  const actionCatalogSource = readSourceFixture('src', 'services', 'actionCatalog.ts');
  const actionSemanticsSource = readSourceFixture('src', 'services', 'actionSemantics.ts');
  assert.equal(actionCatalogSource.includes('export type TicketAction'), false, 'unused ticket action alias should stay private or absent');
  assert.equal(actionCatalogSource.includes('export type QueueAction'), false, 'unused queue action alias should stay private or absent');
  assert.ok(actionSemanticsSource.includes('isActionCode as isCodeAction'));
  assert.ok(actionSemanticsSource.includes('isActionProofSensitive as isHandoffAction'));
  assert.equal(actionSemanticsSource.includes('function isCodeAction'), false);
  assert.equal(actionSemantics.isCodeAction('implement'), true);
  assert.equal(actionSemantics.isCodeAction('in_progress'), true);
  assert.equal(actionSemantics.isCodeAction('fix_build'), true);
  assert.equal(actionSemantics.isCodeAction('verify'), false);
  assert.equal(actionSemantics.isProofSensitiveAction('await_review'), true);
  assert.equal(actionSemantics.isProofSensitiveAction('done'), true);
  assert.equal(actionSemantics.isReviewReadyAction('deploy_monitor'), true);
  assert.equal(actionSemantics.isHandoffAction('done'), true);
  assert.equal(actionSemantics.isHandoffAction(undefined), false);
});

test('severity rank helper centralizes attention ordering vocabularies', () => {
  assert.equal(severityRank.severityRank('critical'), 3);
  assert.equal(severityRank.severityRank('high'), 3);
  assert.equal(severityRank.severityRank('warning'), 2);
  assert.equal(severityRank.severityRank('medium'), 2);
  assert.equal(severityRank.severityRank('info'), 1);
  assert.equal(severityRank.severityRank('low'), 1);
  for (const file of [
    'humanReviewInbox.ts',
    'collisionDetector.ts',
    'agingAnalyzer.ts',
    'recoveryCenter.ts',
    'queuePlanner.ts',
  ]) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes("import { severityRank } from './severityRank'"), `${file} should use shared severity ranking`);
    assert.equal(source.includes('function severityWeight'), false, `${file} should not carry a local severityWeight helper`);
  }
});

test('build status helper centralizes Jenkins status classification', () => {
  assert.equal(buildStatus.normalizedBuildStatus(' success '), 'SUCCESS');
  assert.equal(buildStatus.normalizedBuildStatus(null), '');
  assert.equal(buildStatus.buildStatusKind('PASSED'), 'pass');
  assert.equal(buildStatus.buildStatusKind(' ok '), 'pass');
  assert.equal(buildStatus.buildStatusKind('FAILED'), 'fail');
  assert.equal(buildStatus.buildStatusKind(' error '), 'fail');
  assert.equal(buildStatus.buildStatusKind('ABORTED'), 'other');
  assert.equal(buildStatus.isPassingBuildStatus('SUCCESS'), true);
  assert.equal(buildStatus.isFailingBuildStatus('FAILURE'), true);
  assert.equal(buildStatus.isPassingBuildStatus('FAILURE'), false);

  const helperSource = readSourceFixture('src', 'services', 'buildStatus.ts');
  for (const marker of [
    "export type BuildStatusKind = 'pass' | 'fail' | 'other'",
    'export function normalizedBuildStatus(status: unknown): string',
    'export function buildStatusKind(status: unknown): BuildStatusKind',
    'export function isPassingBuildStatus(status: unknown): boolean',
    'export function isFailingBuildStatus(status: unknown): boolean',
  ]) {
    assert.ok(helperSource.includes(marker), marker);
  }

  for (const [file, marker] of [
    ['src/services/agentQualityScore.ts', "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
    ['src/services/agingAnalyzer.ts', "import { isFailingBuildStatus } from './buildStatus'"],
    ['src/services/evidenceGate.ts', "import { buildStatusKind } from './buildStatus'"],
    ['src/services/postRunReadiness.ts', "import { isPassingBuildStatus } from './buildStatus'"],
    ['src/services/queuePlanner.ts', "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
    ['src/services/ticketTimeline.ts', "import { buildStatusKind } from './buildStatus'"],
    ['src/services/ticketPanelView.ts', "import { buildStatusKind } from './buildStatus'"],
    ['src/services/trendMetrics.ts', "import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus'"],
    ['src/views/TicketTreeProvider.ts', "import { buildStatusKind } from '../services/buildStatus'"],
  ]) {
    assert.ok(readSourceFixture(...file.split('/')).includes(marker), `${file} should use shared build status helper`);
  }
});

test('record guard helper centralizes unknown object narrowing', () => {
  assert.equal(records.isRecord({ ok: true }), true);
  assert.equal(records.isRecord(Object.create(null)), true);
  assert.equal(records.isRecord([]), false);
  assert.equal(records.isRecord(null), false);
  assert.equal(records.isRecord('value'), false);
  assert.deepEqual(records.recordFromUnknown({ ok: true }), { ok: true });
  assert.deepEqual(records.recordFromUnknown(null), {});
  assert.equal(records.recordString({ ticket: ' K-1 ' }, 'ticket'), 'K-1');
  assert.equal(records.recordString({ ticket: 42 }, 'ticket'), '');
  assert.equal(runRecords.isRunLikeRecord({ id: 'run-1' }), true);
  assert.equal(runRecords.isRunLikeRecord([]), false);
  assert.equal(runRecords.hasRetryMetadata({ promptMetadata: { retryOfRunId: 'run-0' } }), true);
  assert.equal(runRecords.hasRetryMetadata({ promptMetadata: 'run-0' }), false);

  for (const [file, marker] of [
    ['changedFiles.ts', "import { isRecord } from './records'"],
    ['evidenceData.ts', "import { isRecord } from './records'"],
    ['integrationAdapters.ts', "import { isRecord } from './records'"],
    ['queuePlanner.ts', "import { isRecord } from './records'"],
    ['runStatus.ts', "import { isRecord } from './records'"],
    ['runRecords.ts', "import { isRecord, recordString } from './records'"],
    ['runStore.ts', "import { isRecord, recordString } from './records'"],
    ['sessionStore.ts', "import { isRecord } from './records'"],
    ['sonarReportView.ts', "import { isRecord } from './records'"],
    ['stateStore.ts', "import { isRecord as isPlainObject } from './records'"],
    ['stateScriptAdapter.ts', "import { isRecord as isPlainObject } from './records'"],
  ]) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes(marker), `${file} should import shared record guard`);
    assert.equal(source.includes('function isRecord'), false, `${file} should not carry a local isRecord helper`);
    assert.equal(source.includes('function isObjectRecord'), false, `${file} should not carry a local isObjectRecord helper`);
    assert.equal(source.includes('function isPlainObject'), false, `${file} should not carry a local isPlainObject helper`);
  }

  const extensionSource = readSourceFixture('src', 'extension.ts');
  assert.ok(extensionSource.includes("import { isRecord, recordFromUnknown, recordString } from './services/records'"));
  assert.equal(extensionSource.includes('function ticketRecord'), false, 'extension should use shared record helper for ticket payload records');

  const dispatcherSource = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  assert.ok(dispatcherSource.includes("import { isRecord } from '../services/records'"));
  assert.equal(dispatcherSource.includes('function isRecord'), false);

  for (const [file, marker] of [
    ['activeRunDisplay.ts', "import { recordFromUnknown, recordString } from './records'"],
    ['webviewMessages.ts', "import { recordFromUnknown, recordString } from './records'"],
    ['runAttention.ts', "import { recordFromUnknown } from './records'"],
    ['runCompletionNotification.ts', "import { recordFromUnknown, recordString } from './records'"],
    ['runProgress.ts', "import { isRecord, recordFromUnknown, recordString } from './records'"],
  ]) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes(marker), `${file} should import shared unknown-record helper`);
    assert.equal(source.includes('function runRecord(value: unknown): Record<string, unknown>'), false, `${file} should not carry a local runRecord helper`);
    assert.equal(source.includes('function objectRecord(value: unknown): Record<string, unknown>'), false, `${file} should not carry a local objectRecord helper`);
    assert.equal(source.includes('function objectRecordOrNull(value: unknown): value is Record<string, unknown>'), false, `${file} should not carry a local objectRecordOrNull helper`);
  }
  const operatorPanelSource = readSourceFixture('src', 'services', 'operatorPanel.ts');
  assert.equal(operatorPanelSource.includes('function recordFromUnknown(value: unknown): Record<string, unknown>'), false, 'operatorPanel should not carry a local recordFromUnknown helper');
  const runStoreSource = readSourceFixture('src', 'services', 'runStore.ts');
  assert.ok(runStoreSource.includes("import { isRecord, recordString } from './records'"));
  assert.equal(runStoreSource.includes('function stringField(value: unknown): string'), false, 'runStore should not carry a local stringField helper');

  for (const file of [
    'activeRunDisplay.ts',
    'agentQualityScore.ts',
    'dashboardWorklist.ts',
    'humanReviewInbox.ts',
    'queueActiveRun.ts',
    'runProgress.ts',
    'ticketTimeline.ts',
  ]) {
    const source = readSourceFixture('src', 'services', file);
    const marker = file === 'activeRunDisplay.ts'
      ? "import { recordFromUnknown, recordString } from './records'"
      : file === 'runProgress.ts'
        ? "import { isRecord, recordFromUnknown, recordString } from './records'"
        : "import { recordString } from './records'";
    assert.ok(source.includes(marker), `${file} should import shared record string helper`);
    assert.equal(source.includes('function runString'), false, `${file} should not carry a local runString helper`);
    assert.equal(source.includes('function eventString'), false, `${file} should not carry a local eventString helper`);
  }
});

test('command payload helpers normalize tree, webview, queue, and run payloads', () => {
  const state = {
    state: {
      tickets: {
        'K-1': ticket({ projects: ['api', 'web'] }),
        'K-2': ticket({ projects: ['svc'] }),
      },
    },
  };

  assert.equal(commandPayloads.stringFromUnknown(' K-1 '), 'K-1');
  assert.equal(commandPayloads.stringFromUnknown('   '), undefined);
  assert.equal(commandPayloads.resolveProjectName(state, { projectName: ' api ' }), ' api ');
  assert.equal(commandPayloads.resolveProjectName(state, { ticket: { projects: ['web'] } }), 'web');
  assert.equal(commandPayloads.resolveProjectName(state, { ticketKey: 'K-2' }), 'svc');
  assert.equal(commandPayloads.explicitProjectName({ item: { projectName: 'nested' } }), 'nested');
  assert.deepEqual(commandPayloads.ticketProjectNamesForCommand(state, { ticket: { projects: [' api ', 'api', '', 42, 'web'] } }, undefined), ['api', 'web']);
  assert.deepEqual(commandPayloads.ticketProjectNamesForCommand(state, { item: { ticket: { projects: [' nested '] } } }, undefined), ['nested']);
  assert.deepEqual(commandPayloads.ticketProjectNamesForCommand(state, {}, 'K-1'), ['api', 'web']);
  assert.deepEqual(commandPayloads.uniqueProjectNames([' api ', 'api', '', 42, 'web']), ['api', 'web']);

  assert.equal(commandPayloads.resolveRunId(' run-1 '), 'run-1');
  assert.equal(commandPayloads.resolveRunId({ runId: ' run-2 ' }), 'run-2');
  assert.equal(commandPayloads.resolveRunId({ id: ' run-3 ' }), 'run-3');
  assert.equal(commandPayloads.resolveRecoveryFocusId({ itemId: ' item-1 ', runId: 'run-1', worktreePath: '/repo/worktree' }), 'item-1');
  assert.equal(commandPayloads.resolveRecoveryFocusId({ runId: ' run-1 ', worktreePath: '/repo/worktree' }), 'run-1');
  assert.equal(commandPayloads.resolveRecoveryFocusId({ worktreePath: ' /repo/worktree ' }), '/repo/worktree');
  assert.equal(commandPayloads.resolveTicketKey('K-1'), 'K-1');
  assert.equal(commandPayloads.resolveTicketKey({ ticketKey: 'K-2' }), 'K-2');
  assert.equal(commandPayloads.resolveTicketKey({ item: { ticket: 'K-3' } }), 'K-3');
  assert.equal(commandPayloads.resolveTicketKey({ ticket: 'K-4' }), 'K-4');
  assert.equal(commandPayloads.resolveMergeRequestUrl({ ticket: { mr: { url: ' https://gitlab.example/mr/1 ' } } }), 'https://gitlab.example/mr/1');

  assert.deepEqual(commandPayloads.resolveQueueCommandItem({
    id: ' q-1 ',
    ticket: ' K-1 ',
    projects: [' api ', 'api'],
    project_path: ' /repo/api ',
    action: ' implement ',
  }), { id: 'q-1', ticket: 'K-1', projects: ['api', 'api'], projectPath: '/repo/api', action: 'implement' });
  assert.deepEqual(commandPayloads.resolveQueueCommandItem({
    item: { ticket: 'K-2', projects: ['svc'], projectPath: 'C:\\Repo\\Svc', action: 'verify' },
  }), { ticket: 'K-2', projects: ['svc'], projectPath: 'C:\\Repo\\Svc', action: 'verify' });
  assert.equal(commandPayloads.resolveQueueCommandItem({ ticket: 'K-1' }), undefined);
  assert.equal(commandPayloads.resolveQueueIndex({ index: 2 }), 2);
  assert.equal(commandPayloads.resolveQueueIndex({ index: -1 }), undefined);
  assert.equal(commandPayloads.resolveQueueIndex({ index: 1.5 }), undefined);
  assert.equal(commandPayloads.resolveTaskId({ taskId: ' task-1 ' }), ' task-1 ');

  const source = readSourceFixture('src', 'services', 'commandPayloads.ts');
  for (const marker of [
    "import { recordFromUnknown } from './records'",
    'export interface QueueCommandPayload',
    'export function resolveProjectName',
    'export function ticketProjectNamesForCommand',
    'export function resolveRecoveryFocusId',
    'export function resolveQueueCommandItem',
    'export function queueCommandPayloadFromRecord',
    "stringFromUnknown(record['project_path']) || stringFromUnknown(record['projectPath'])",
    "typeof index === 'number' && Number.isInteger(index) && index >= 0",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('project selection helpers build project and ticket group picks', () => {
  assert.deepEqual(projectSelection.buildRegisteredProjectItems({
    web: { path: '/repo/web' },
    api: { path: '/repo/api' },
  }), [
    { label: 'api', description: '/repo/api' },
    { label: 'web', description: '/repo/web' },
  ]);
  assert.deepEqual(projectSelection.buildTicketProjectItems(['api', 'missing'], { api: { path: '/repo/api' } }), [
    { label: 'api', description: '/repo/api' },
    { label: 'missing', description: 'Project is not registered' },
  ]);

  const grouped = projectSelection.groupTicketsByProject([
    { key: 'K-1', projects: ['api', 'web', 'api'] },
    { key: 'K-2', projects: ['api'] },
  ]);
  assert.deepEqual(Object.keys(grouped), ['api', 'web']);
  assert.deepEqual(grouped.api.map(item => item.key), ['K-1', 'K-2']);
  assert.deepEqual(grouped.web.map(item => item.key), ['K-1']);
  assert.deepEqual(projectSelection.buildTicketGroupProjectItems(grouped, 'tickets'), [
    { label: 'api', description: '2 tickets' },
    { label: 'web', description: '1 tickets' },
  ]);
});

test('date value helper centralizes valid date coercion', () => {
  const date = new Date('2026-07-02T10:00:00.000Z');
  assert.equal(dateValues.toValidDate(date), date);
  assert.equal(dateValues.toValidDate(date.toISOString())?.toISOString(), date.toISOString());
  assert.equal(dateValues.toValidDate(date.getTime())?.toISOString(), date.toISOString());
  assert.equal(dateValues.toValidDate('not-a-date'), null);
  assert.equal(dateValues.toValidDate({}), null);

  const runCenterSortSource = readSourceFixture('src', 'services', 'runCenterSort.ts');
  assert.ok(runCenterSortSource.includes("import { toValidDate } from './dateValues'"));
  assert.equal(runCenterSortSource.includes('function toValidDate'), false);

  for (const file of ['agingAnalyzer.ts', 'agingReportView.ts', 'collisionDetector.ts', 'dashboardWorklist.ts', 'integrationAdapters.ts', 'mergeRequestComments.ts', 'mergeRequestNotifications.ts', 'queuePlanner.ts', 'relativeTime.ts', 'recoveryCenter.ts', 'runProgress.ts', 'runStatus.ts', 'runStore.ts', 'sessionStore.ts', 'ticketFilters.ts', 'ticketTimeline.ts', 'trendMetrics.ts']) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes("import { toValidDate } from './dateValues'"), `${file} should use shared date value helper`);
    assert.equal(source.includes('function dateValue'), false, `${file} should not carry a local dateValue helper`);
    assert.equal(source.includes('function validDate'), false, `${file} should not carry a local validDate helper`);
    assert.equal(source.includes('function parseDate'), false, `${file} should not carry a local parseDate helper`);
  }

  const dispatcherSource = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  assert.ok(dispatcherSource.includes("import { toValidDate } from '../services/dateValues'"));
  assert.equal(dispatcherSource.includes('function toValidDate'), false);

  const extensionSource = readSourceFixture('src', 'extension.ts');
  assert.ok(extensionSource.includes("import { toValidDate } from './services/dateValues'"));
  assert.ok(extensionSource.includes('return toValidDate(value)?.toLocaleString() || fallback'));
  const ticketPanelViewSource = readSourceFixture('src', 'services', 'ticketPanelView.ts');
  assert.ok(ticketPanelViewSource.includes("import { toValidDate } from './dateValues'"));
  assert.ok(ticketPanelViewSource.includes('return toValidDate(value)?.toLocaleDateString() || fallback'));

  const sessionTreeSource = readSourceFixture('src', 'views', 'SessionTreeProvider.ts');
  assert.ok(sessionTreeSource.includes("import { toValidDate } from '../services/dateValues'"));
  assert.equal(sessionTreeSource.includes('new Date(session.startedAt)'), false);
});

test('regexp helper centralizes regex literal escaping', () => {
  const escaped = regexp.escapeRegExp('EDIPVR-3413 (a+b)[x]? ^$.*\\');
  assert.equal(escaped, 'EDIPVR-3413 \\(a\\+b\\)\\[x\\]\\? \\^\\$\\.\\*\\\\');
  assert.equal(new RegExp(escaped).test('prefix EDIPVR-3413 (a+b)[x]? ^$.*\\ suffix'), true);

  for (const file of ['promptManager.ts', 'postRunReadiness.ts']) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes("import { escapeRegExp } from './regexp'"), `${file} should import shared regexp escaping`);
    assert.equal(source.includes('function escapeRegExp'), false, `${file} should not carry a local escapeRegExp helper`);
  }
});

test('path util helper centralizes directory containment checks', () => {
  const root = path.join(os.tmpdir(), 'kronos-path-root');
  assert.equal(pathUtils.isPathInside(path.join(root, 'child', 'file.txt'), root), true);
  assert.equal(pathUtils.isPathInside(root, root), true);
  assert.equal(pathUtils.isPathInside(path.join(root, '..', 'sibling.txt'), root), false);
  const realRoot = makeTempDir('kronos-realpath-root-');
  const realChildDir = path.join(realRoot, 'child');
  fs.mkdirSync(realChildDir);
  const realChildFile = path.join(realChildDir, 'file.txt');
  fs.writeFileSync(realChildFile, 'ok');
  const realOutside = makeTempDir('kronos-realpath-outside-');
  const realOutsideFile = path.join(realOutside, 'file.txt');
  fs.writeFileSync(realOutsideFile, 'outside');
  assert.equal(pathUtils.isExistingRealPathInside(realChildFile, realRoot), true);
  assert.equal(pathUtils.isExistingRealPathInside(realOutsideFile, realRoot), false);
  assert.equal(pathUtils.projectPathKey('/repo/app/'), '/repo/app');
  assert.equal(pathUtils.projectPathKey('\\repo\\app\\'), '/repo/app');
  assert.equal(pathUtils.projectPathKey('C:\\Repo\\App\\', 'win32'), 'c:/repo/app');
  assert.equal(pathUtils.projectPathKey('C:\\Repo\\App\\', 'linux'), 'C:/Repo/App');

  for (const file of ['runStore.ts', 'gitWorkspace.ts']) {
    const source = readSourceFixture('src', 'services', file);
    const marker = file === 'runStore.ts'
      ? "import { isExistingRealPathInside, isPathInside } from './pathUtils'"
      : "import { isPathInside } from './pathUtils'";
    assert.ok(source.includes(marker), `${file} should import shared path containment`);
    assert.equal(source.includes('function isPathInside'), false, `${file} should not carry a local isPathInside helper`);
  }
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const runActionHelpersSource = readSourceFixture('src', 'services', 'runActionHelpers.ts');
  assert.ok(extensionSource.includes("import { projectPathKey } from './services/pathUtils'"));
  assert.ok(runActionHelpersSource.includes("import { isExistingRealPathInside } from './pathUtils'"));
  assert.equal(extensionSource.includes('function isPathInsideDirectory'), false);
  assert.ok(runActionHelpersSource.includes('isExistingRealPathInside(filePath, RUNS_DIR)'));
});

test('run action helpers resolve safe artifacts and quick-pick labels', () => {
  fs.mkdirSync(runStore.RUNS_DIR, { recursive: true });
  const promptPath = path.join(runStore.RUNS_DIR, 'run-action.prompt.txt');
  const logPath = path.join(runStore.RUNS_DIR, 'run-action.log');
  const externalPath = path.join(makeTempDir('kronos-run-action-external-'), 'outside.log');
  fs.writeFileSync(promptPath, 'saved prompt');
  fs.writeFileSync(logPath, 'saved log');
  fs.writeFileSync(externalPath, 'outside');

  assert.deepEqual(runActionHelpers.resolveRunArtifactFile(promptPath), { ok: true, filePath: promptPath });
  assert.deepEqual(runActionHelpers.resolveRunArtifactFile(path.join(runStore.RUNS_DIR, 'missing.log')), { ok: false, reason: 'missing' });
  assert.deepEqual(runActionHelpers.resolveRunArtifactFile(externalPath), { ok: false, reason: 'outside-runs-dir' });

  assert.equal(runActionHelpers.isRetryableRun({ status: 'completed', promptPath }), true);
  assert.equal(runActionHelpers.isRetryableRun({ status: 'running', promptPath }), false);
  assert.equal(runActionHelpers.isResumableRun({ status: 'completed', logPath }), true);
  assert.equal(runActionHelpers.isResumableRun({ status: 'completed' }), false);

  const workspace = makeTempDir('kronos-run-workspace-');
  assert.equal(runActionHelpers.resolveRunWorkspace({ worktreePath: '/missing/worktree', cwd: workspace, projectPath: '/missing/project' }), workspace);
  assert.equal(runActionHelpers.resolveRunWorkspace({ worktreePath: '/missing/worktree' }), null);

  assert.equal(runActionHelpers.runQuickPickDescription({ status: 'completed' }), 'completed');
  assert.equal(runActionHelpers.runQuickPickDescription({ status: 'needs_human', failureReason: 'manual QA needed' }), 'needs_human - Needs human review: manual QA needed');
  assert.match(runActionHelpers.runQuickPickDetail({
    status: 'completed',
    startedAt: '2026-07-01T12:00:00.000Z',
    cwd: '/repo/app',
    events: [{ label: 'Session complete' }],
  }), /Session complete$/);
  assert.deepEqual(
    runActionHelpers.RUN_ACTION_QUICK_PICK_ITEMS.map(item => item.runCommand),
    ['openRunLog', 'openRunPrompt', 'openRunRecord', 'openRunWorkspace', 'openRunDiff', 'markNeedsHuman', 'pauseRun', 'continueRun', 'cancelRun', 'resumeRun', 'retryRun', 'archiveRun'],
  );
  assert.deepEqual(runActionHelpers.buildRunQuickPickItems([{
    project: 'app',
    skill: 'implement',
    ticket: 'K-1',
    status: 'completed',
    startedAt: '2026-07-01T12:00:00.000Z',
    events: [{ label: 'Done' }],
  }]).map(item => ({
    label: item.label,
    description: item.description,
    run: item.run.ticket,
  })), [{
    label: 'app - implement K-1',
    description: 'completed',
    run: 'K-1',
  }]);
  assert.equal(runActionHelpers.isFinishedArchiveRun({ status: 'completed' }), true);
  assert.equal(runActionHelpers.isFinishedArchiveRun({ status: 'waiting_for_review' }), true);
  assert.equal(runActionHelpers.isFinishedArchiveRun({ status: 'running' }), false);
  assert.equal(runActionHelpers.runCountLabel(1), '1 finished run');
  assert.equal(runActionHelpers.runCountLabel(2), '2 finished runs');
  assert.equal(runActionHelpers.runProcessPid({ processPid: '1234' }), 1234);
  assert.equal(runActionHelpers.runProcessPid({ pid: '5678' }), 5678);
  assert.equal(runActionHelpers.runProcessPid({ processPid: '-1' }), undefined);
});

test('json file helper centralizes labeled script output parsing', () => {
  assert.deepEqual(jsonFiles.parseJsonWithLabel(`${String.fromCharCode(0xFEFF)}{"ok":true}`, 'demo'), { ok: true });
  assert.throws(
    () => jsonFiles.parseJsonWithLabel('not json', 'demo-script'),
    /Invalid JSON from demo-script:/
  );
  assert.throws(
    () => jsonFiles.parseJsonWithLabel('not json', 'demo-script', { includePreview: true }),
    /Invalid JSON from demo-script: .*; output: not json/
  );

  for (const [file, marker] of [
    ['scriptClient.ts', "import { parseJsonWithLabel } from './jsonFiles'"],
    ['stateScriptAdapter.ts', "import { parseJsonWithLabel } from './jsonFiles'"],
    ['integrationAdapters.ts', "import { parseJsonWithLabel } from './jsonFiles'"],
    ['doctorChecks.ts', "import { parseJsonWithLabel } from './jsonFiles'"],
  ]) {
    const source = readSourceFixture('src', 'services', file);
    assert.ok(source.includes(marker), `${file} should import shared labeled JSON parsing`);
    assert.equal(source.includes('const content = stripUtf8Bom(raw)'), false, `${file} should not parse labeled JSON locally`);
  }
});

test('review work service centralizes open review merge request semantics', () => {
  const tickets = {
    'K-OPEN': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/1' },
    }),
    'K-MERGED': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 2, state: 'merged', review_status: 'approved', url: 'https://gitlab.example/mr/2' },
    }),
    'K-CLOSED': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 3, state: 'closed', review_status: 'changes_requested', url: 'https://gitlab.example/mr/3' },
    }),
    'K-VERIFY': ticket({
      projects: ['app'],
      next_action: 'verify',
      mr: { iid: 4, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/mr/4' },
    }),
  };
  assert.equal(reviewWork.isOpenReviewTicket(tickets['K-OPEN']), true);
  assert.equal(reviewWork.isOpenReviewTicket(tickets['K-MERGED']), false);
  assert.deepEqual(reviewWork.openReviewTicketEntries(tickets).map(([key]) => key), ['K-OPEN']);
  assert.deepEqual(reviewWork.reviewBranchTickets(tickets), [{
    key: 'K-OPEN',
    summary: tickets['K-OPEN'].summary,
    mr: tickets['K-OPEN'].mr,
    projects: ['app'],
  }]);
});

test('review tree persists seen review keys across reloads', async () => {
  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => {
    if (request === 'vscode') {
      return vscodeStub.vscode;
    }
    return undefined;
  }, async () => {
    const reviewTreePath = require.resolve('../out/views/ReviewTreeProvider.js');
    delete require.cache[reviewTreePath];
    const { ReviewTreeProvider } = require(reviewTreePath);
    let storedSeenKeys;
    const seenKeysStore = {
      get: () => storedSeenKeys,
      update: keys => { storedSeenKeys = [...keys]; },
    };
    const stateEmitter = new vscodeStub.EventEmitter();
    const reviewTicket = (iid, mrFields = {}, ticketFields = {}) => ticket({
      next_action: 'await_review',
      ...ticketFields,
      mr: { iid, state: 'opened', review_status: 'pending_review', url: `https://gitlab.example/mr/${iid}`, ...mrFields },
    });
    let currentState = baseState({ 'K-1': reviewTicket(1) });
    const kronosState = {
      get state() { return currentState; },
      onDidChange: stateEmitter.event,
    };

    const firstProvider = new ReviewTreeProvider(kronosState, seenKeysStore);
    assert.equal(firstProvider.getNewReviewCount(), 0);
    assert.equal(storedSeenKeys.length, 1);
    assert.match(storedSeenKeys[0], /^K-1\|mr:1\|opened\|pending_review\|/);

    currentState = baseState({ 'K-1': reviewTicket(1), 'K-2': reviewTicket(2) });
    stateEmitter.fire(undefined);
    assert.equal(firstProvider.getNewReviewCount(), 1);
    assert.deepEqual(firstProvider.getNewReviewItems().map(item => item.ticketKey), ['K-2']);
    firstProvider.dispose();

    const reloadedProvider = new ReviewTreeProvider(kronosState, seenKeysStore);
    assert.equal(reloadedProvider.getNewReviewCount(), 1);
    assert.deepEqual(reloadedProvider.getNewReviewItems().map(item => item.ticketKey), ['K-2']);
    const newReviewCountEvents = [];
    const eventSubscription = reloadedProvider.onDidChangeNewReviewCount(count => newReviewCountEvents.push(count));

    currentState = baseState({ 'K-1': reviewTicket(1), 'K-3': reviewTicket(3) });
    stateEmitter.fire(undefined);
    assert.equal(reloadedProvider.getNewReviewCount(), 1);
    assert.deepEqual(reloadedProvider.getNewReviewItems().map(item => item.ticketKey), ['K-3']);
    assert.deepEqual(newReviewCountEvents, [1]);
    eventSubscription.dispose();

    reloadedProvider.markVisibleReviewItemsSeen();
    assert.equal(reloadedProvider.getNewReviewCount(), 0);
    assert.equal(storedSeenKeys.length, 2);
    assert.ok(storedSeenKeys.some(key => key.startsWith('K-1|mr:1|opened|pending_review|')));
    assert.ok(storedSeenKeys.some(key => key.startsWith('K-3|mr:3|opened|pending_review|')));

    currentState = baseState({
      'K-3': reviewTicket(3, {
        comment_count: 1,
        last_comment_at: '2026-07-03T01:00:00.000Z',
        comments: [{ id: 'n1', author: 'Reviewer', created: '2026-07-03T01:00:00.000Z', body: 'Please recheck the Windows smoke.' }],
      }),
    });
    stateEmitter.fire(undefined);
    assert.equal(reloadedProvider.getNewReviewCount(), 1);
    const commentReviewItems = reloadedProvider.getNewReviewItems();
    assert.deepEqual(commentReviewItems.map(item => item.ticketKey), ['K-3']);
    assert.match(commentReviewItems[0].activity, /1 comment/);
    assert.match(commentReviewItems[0].activityKey, /^K-3\|mr:3\|opened\|pending_review\|1\|2026-07-03T01:00:00.000Z\|/);
    reloadedProvider.markVisibleReviewItemsSeen();
    assert.equal(reloadedProvider.getNewReviewCount(), 0);

    currentState = baseState({
      'K-5': reviewTicket(5, {}, { projects: ['app'] }),
      'K-6': reviewTicket(6, {}, { projects: ['api'] }),
    });
    stateEmitter.fire(undefined);
    assert.equal(reloadedProvider.getNewReviewCount(), 2);
    reloadedProvider.setFilter({ project: 'app' });
    reloadedProvider.markVisibleReviewItemsSeen();
    assert.deepEqual(reloadedProvider.getNewReviewItems().map(item => item.ticketKey), ['K-6']);
    assert.ok(storedSeenKeys.some(key => key.startsWith('K-5|mr:5|opened|pending_review|')));
    assert.equal(storedSeenKeys.some(key => key.startsWith('K-6|mr:6|opened|pending_review|')), false);
    reloadedProvider.clearFilter();
    reloadedProvider.markVisibleReviewItemsSeen();
    assert.equal(reloadedProvider.getNewReviewCount(), 0);
    reloadedProvider.dispose();

    storedSeenKeys = ['K-1'];
    currentState = baseState({ 'K-1': reviewTicket(1) });
    const migratedProvider = new ReviewTreeProvider(kronosState, seenKeysStore);
    assert.equal(migratedProvider.getNewReviewCount(), 0);
    assert.equal(storedSeenKeys.length, 1);
    assert.match(storedSeenKeys[0], /^K-1\|mr:1\|opened\|pending_review\|/);
    migratedProvider.dispose();
  });
});

test('review notification helpers normalize seen keys and plan new-item toasts', () => {
  assert.equal(reviewNotifications.REVIEW_SEEN_KEYS_STORAGE_KEY, 'kronos.review.seenKeys.v1');
  assert.equal(reviewNotifications.normalizeReviewSeenKeys(undefined), undefined);
  assert.deepEqual(reviewNotifications.normalizeReviewSeenKeys('bad'), []);
  assert.deepEqual(reviewNotifications.normalizeReviewSeenKeys([' K-2 ', 'K-1', '', 42, 'K-2']), ['K-1', 'K-2']);

  const items = [
    { ticketKey: 'K-1', activityKey: 'K-1|mr:11|opened|approved', mrIid: 11, activity: 'approved' },
    { ticketKey: 'K-2' },
  ];
  const firstPlan = reviewNotifications.planNewReviewNotification(items, new Set(['stale']));
  assert.deepEqual(firstPlan.nextNotifiedKeys, ['K-1|mr:11|opened|approved', 'K-2']);
  assert.equal(firstPlan.message, 'K-1: MR !11 needs review - approved (+1 more)');

  const secondPlan = reviewNotifications.planNewReviewNotification(items, new Set([...firstPlan.nextNotifiedKeys, 'stale']));
  assert.deepEqual(secondPlan.nextNotifiedKeys, firstPlan.nextNotifiedKeys);
  assert.equal(secondPlan.message, undefined);
});

test('queue planner builds backlog triage report for grooming lanes', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');
  const state = baseState({
    'K-UNLINKED': ticket({ projects: [], next_action: 'implement', updated: '2026-06-30T12:00:00.000Z' }),
    'K-BLOCKED': ticket({ next_action: 'blocked', updated: '2026-06-30T12:00:00.000Z' }),
    'K-BUILD': ticket({
      next_action: 'fix_build',
      build: { number: 42, status: 'FAILURE', url: 'https://ci.example/build/42' },
      updated: '2026-06-30T12:00:00.000Z',
    }),
    'K-REVIEW': ticket({
      next_action: 'await_review',
      mr: { iid: 9, state: 'opened', review_status: 'changes_requested', url: 'https://git.example/mr/9' },
      evidence: { notes: [] },
      updated: '2026-06-30T12:00:00.000Z',
    }),
    'K-STALE': ticket({ next_action: 'implement', updated: '2026-06-01T12:00:00.000Z' }),
    'K-READY': ticket({ next_action: 'verify', evidence: { notes: [null, 'bad note', { at: 'now', kind: 'test', text: 'manual smoke passed' }] }, updated: '2026-06-30T12:00:00.000Z' }),
    'K-DONE': ticket({ next_action: 'done', projects: [], updated: '2026-06-01T12:00:00.000Z' }),
  });
  const queue = {
    items: [{
      id: 'queued-build',
      ticket: 'K-BUILD',
      projects: ['app'],
      action: 'fix_build',
    }],
    last_computed: null,
  };

  const report = queuePlanner.buildBacklogTriageReport({ state, queue, now });

  assert.equal(report.generatedAt, now.toISOString());
  assert.deepEqual(report.summary, {
    unlinked: 1,
    blocked: 1,
    build_failed: 1,
    review_ready: 1,
    evidence_gap: 1,
    stale: 1,
    ready_to_plan: 1,
  });
  assert.equal(report.items.some(item => item.ticketKey === 'K-DONE'), false);
  assert.equal(report.items.find(item => item.kind === 'unlinked').ticketKey, 'K-UNLINKED');
  assert.equal(report.items.find(item => item.kind === 'blocked').ticketKey, 'K-BLOCKED');
  assert.equal(report.items.find(item => item.kind === 'build_failed').ticketKey, 'K-BUILD');
  assert.equal(report.items.find(item => item.kind === 'review_ready').severity, 'critical');
  assert.equal(report.items.find(item => item.kind === 'evidence_gap').ticketKey, 'K-REVIEW');
  assert.equal(report.items.find(item => item.kind === 'stale').ageDays, 30);
  assert.deepEqual(report.items.filter(item => item.kind === 'ready_to_plan').map(item => item.ticketKey), ['K-READY']);
  assert.equal(report.items.some(item => item.ticketKey === 'K-BUILD' && item.kind === 'ready_to_plan'), false);
});

test('queue planner groups recommendations into project batch plans', () => {
  const plans = [
    {
      planId: 'K-1:fix_build',
      ticketKey: 'K-1',
      action: 'fix_build',
      projects: ['api'],
      score: 100,
      scoreBreakdown: [],
      reason: 'build failed',
      source: 'ticket',
    },
    {
      planId: 'K-2:verify',
      ticketKey: 'K-2',
      action: 'verify',
      projects: ['api', 'web'],
      score: 90,
      scoreBreakdown: [],
      reason: 'needs verification',
      source: 'ticket',
    },
    {
      planId: 'K-3:implement',
      ticketKey: 'K-3',
      action: 'implement',
      projects: ['api'],
      score: 50,
      scoreBreakdown: [],
      reason: 'lower priority',
      source: 'ticket',
    },
    {
      planId: 'K-4:implement',
      ticketKey: 'K-4',
      action: 'implement',
      projects: [],
      score: 80,
      scoreBreakdown: [],
      reason: 'missing link',
      source: 'ticket',
    },
  ];

  const batches = queuePlanner.planByProject(plans, 2);
  const api = batches.find(batch => batch.project === 'api');
  const web = batches.find(batch => batch.project === 'web');
  const unlinked = batches.find(batch => batch.project === 'unlinked');

  assert.deepEqual(api.plans.map(plan => plan.ticketKey), ['K-1', 'K-2']);
  assert.equal(api.totalScore, 190);
  assert.equal(api.estimatedMinutes, 75);
  assert.deepEqual(api.actionCounts, { fix_build: 1, verify: 1 });
  assert.deepEqual(web.plans.map(plan => plan.ticketKey), ['K-2']);
  assert.deepEqual(unlinked.plans.map(plan => plan.ticketKey), ['K-4']);
});

test('queue planner groups recommendations into release batch plans', () => {
  const queuePlannerSource = readSourceFixture('src', 'services', 'queuePlanner.ts');
  const state = baseState({
    'K-1': ticket({
      next_action: 'fix_build',
      fixVersions: [{ name: '2026.07' }],
      build: { number: 1, status: 'FAILURE', url: '' },
    }),
    'K-2': ticket({
      next_action: 'verify',
      labels: ['checkout', 'release:2026.07'],
      evidence: { notes: ['smoke passed'] },
    }),
    'K-3': ticket({
      next_action: 'implement',
      milestone: { name: 'Mobile MVP' },
      sprint: 'Sprint 12',
    }),
    'K-4': ticket({
      next_action: 'implement',
      labels: ['checkout'],
    }),
  });
  const plans = queuePlanner.planNextActions({ state, queue: null });

  assert.deepEqual(plans.find(plan => plan.ticketKey === 'K-1').releaseKeys, ['2026.07']);
  assert.deepEqual(plans.find(plan => plan.ticketKey === 'K-2').releaseKeys, ['2026.07']);
  assert.deepEqual(plans.find(plan => plan.ticketKey === 'K-3').releaseKeys, ['Mobile MVP', 'Sprint 12']);
  assert.deepEqual(plans.find(plan => plan.ticketKey === 'K-4').releaseKeys, []);

  const batches = queuePlanner.planByRelease(plans, 10);
  const release = batches.find(batch => batch.release === '2026.07');
  const milestone = batches.find(batch => batch.release === 'Mobile MVP');
  const sprint = batches.find(batch => batch.release === 'Sprint 12');
  const unassigned = batches.find(batch => batch.release === 'unassigned');

  assert.deepEqual(release.plans.map(plan => plan.ticketKey).sort(), ['K-1', 'K-2']);
  assert.equal(release.actionCounts.fix_build, 1);
  assert.equal(release.actionCounts.verify, 1);
  assert.deepEqual(milestone.plans.map(plan => plan.ticketKey), ['K-3']);
  assert.deepEqual(sprint.plans.map(plan => plan.ticketKey), ['K-3']);
  assert.deepEqual(unassigned.plans.map(plan => plan.ticketKey), ['K-4']);

  for (const marker of [
    'QueueItem, QueueState, Ticket',
    'interface PlannerInput',
    'queueItem?: QueueItem',
    'export function planToQueueItem(input: PlannerInput, plan: PlannedAction): QueueItem',
    "import { evidenceRecordCount } from './evidenceData'",
    'evidenceRecordCount(ticket)',
    'function releaseKeysForPlan(ticket?: Ticket, queueItem?: unknown): string[]',
    'function releaseField(source: unknown, field: string): unknown',
    'function collectReleaseValues(target: string[], value: unknown): void',
    'function releaseFromLabel(label: unknown): string | undefined',
  ]) {
    assert.ok(queuePlannerSource.includes(marker), marker);
  }
  assert.equal(queuePlannerSource.includes('export interface PlannerInput'), false);
  assert.equal(/\bany\b/.test(queuePlannerSource), false, 'queuePlanner should keep planner payloads typed without any');
});

test('queue planner panel view renders escaped actions for planning panels', () => {
  const plan = {
    planId: 'K-1:implement',
    ticketKey: 'K-1',
    action: 'implement',
    projects: ['web<script>'],
    score: 42,
    scoreBreakdown: [{ label: 'Priority <x>', value: 10, detail: 'High & urgent' }],
    reason: 'Implement <unsafe> & verify',
    source: 'ticket',
    ticketSummary: 'Summary <body>',
  };
  const queueHtml = queuePlannerPanelView.buildQueuePlannerHtml([plan], 'nonce-queue', ACTION_SCRIPT_URI);
  assert.ok(queueHtml.includes('Priority &lt;x&gt;'));
  assert.ok(queueHtml.includes('High &amp; urgent'));
  assert.ok(queueHtml.includes('Implement &lt;unsafe&gt; &amp; verify'));
  assert.ok(queueHtml.includes('data-action="startPlan"'));
  assert.ok(queueHtml.includes('data-action="snoozePlanToday"'));
  assert.ok(queueHtml.includes('data-plan-id="K-1:implement"'));
  assert.equal(queueHtml.includes('<script>'), false);

  const backlogHtml = queuePlannerPanelView.buildBacklogTriageHtml({
    generatedAt: '2026-07-01T12:00:00.000Z',
    summary: { unlinked: 1, blocked: 0, build_failed: 0, review_ready: 0, evidence_gap: 1, stale: 0, ready_to_plan: 0 },
    items: [
      { ticketKey: 'K-HTML', summary: 'Unsafe <summary>', kind: 'unlinked', severity: 'critical', action: 'Link', projects: [], detail: 'Needs <project>' },
      { ticketKey: 'K-EVID', summary: 'Evidence gap', kind: 'evidence_gap', severity: 'warning', action: 'Evidence', projects: ['api'], detail: 'No notes' },
    ],
  }, 'nonce-backlog', ACTION_SCRIPT_URI);
  assert.ok(backlogHtml.includes('Unsafe &lt;summary&gt;'));
  assert.ok(backlogHtml.includes('Needs &lt;project&gt;'));
  assert.ok(backlogHtml.includes('data-action="linkTicket"'));
  assert.ok(backlogHtml.includes('data-action="addEvidenceCheck"'));

  const projectHtml = queuePlannerPanelView.buildProjectBatchPlanHtml([
    { project: 'web<app>', plans: [plan], totalScore: 42, estimatedMinutes: 45, actionCounts: { implement: 1 } },
  ], 'nonce-project', ACTION_SCRIPT_URI);
  assert.ok(projectHtml.includes('web&lt;app&gt;'));
  assert.ok(projectHtml.includes('To Do: 1'));
  assert.ok(projectHtml.includes('45m'));

  const releaseHtml = queuePlannerPanelView.buildReleaseBatchPlanHtml([
    { release: '2026.07<release>', plans: [plan], totalScore: 42, estimatedMinutes: 45, actionCounts: { implement: 1 } },
  ], 'nonce-release', ACTION_SCRIPT_URI);
  assert.ok(releaseHtml.includes('2026.07&lt;release&gt;'));
  assert.ok(releaseHtml.includes('web&lt;script&gt;'));

  const collisionHtml = queuePlannerPanelView.buildCollisionReportHtml([
    { plan, collisions: [{ id: 'c1', severity: 'high', kind: 'active_run', title: 'Overlap <run>', detail: 'Same file & branch' }] },
  ], 'nonce-collision', ACTION_SCRIPT_URI);
  assert.ok(collisionHtml.includes('Overlap &lt;run&gt;'));
  assert.ok(collisionHtml.includes('Same file &amp; branch'));
  assert.ok(collisionHtml.includes('data-action="startPlan"'));

  const windowHtml = queuePlannerPanelView.buildQueuePlanModeHtml('Plan <Now>', '2 <hours>', [plan], 'nonce-window', ACTION_SCRIPT_URI);
  assert.ok(windowHtml.includes('Plan &lt;Now&gt;'));
  assert.ok(windowHtml.includes('2 &lt;hours&gt;'));

  const source = readSourceFixture('src', 'services', 'queuePlannerPanelView.ts');
  for (const marker of [
    'export function buildQueuePlannerHtml',
    'export function buildBacklogTriageHtml',
    'export function buildProjectBatchPlanHtml',
    'export function buildReleaseBatchPlanHtml',
    'export function buildCollisionReportHtml',
    'export function buildQueuePlanModeHtml',
    'function planActionRow',
    'function triageActionButtons',
    "import { escapeClass, escapeHtml } from './webviewHtml'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(/\bany\b/.test(source), false, 'queuePlannerPanelView should keep renderer payloads typed without any');
});

test('operations report panel view renders escaped data and command actions', () => {
  const scoreHtml = operationsReportPanelView.buildAgentQualityScoreHtml({
    score: 92,
    grade: 'A',
    summary: 'Ready <ship> & review',
    components: [{ label: 'Run <completion>', score: 20, max: 25, detail: 'Good & improving' }],
    metrics: [{ label: 'Retries <low>', value: '1 & falling' }],
  }, 'nonce-score', ACTION_SCRIPT_URI);
  assert.ok(scoreHtml.includes('Ready &lt;ship&gt; &amp; review'));
  assert.ok(scoreHtml.includes('Run &lt;completion&gt;'));
  assert.ok(scoreHtml.includes('data-action="trendMetrics"'));
  assert.ok(scoreHtml.includes('nonce="nonce-score"'));

  const trendHtml = operationsReportPanelView.buildTrendMetricsHtml({
    generatedAt: '2026-07-01T12:00:00.000Z',
    windowDays: 7,
    runsConsidered: 1,
    ticketsConsidered: 2,
    summary: 'Trend <ok> & stable.',
    metrics: [{ label: 'Build <pass>', value: '95%', detail: 'Good & steady', status: 'good' }],
  }, 'nonce-trend', ACTION_SCRIPT_URI);
  assert.ok(trendHtml.includes('Trend &lt;ok&gt; &amp; stable.'));
  assert.ok(trendHtml.includes('Build &lt;pass&gt;'));
  assert.ok(trendHtml.includes('data-action="agentQualityScore"'));

  const statsHtml = operationsReportPanelView.buildSessionStatsHtml({
    sessions: [
      {
        project: 'api<script>',
        skill: 'implement<one>',
        ticket: 'K-STATS<script>',
        startedAt: '2026-07-01T12:00:00.000Z',
        verdict: 'success',
        durationSec: 30,
        toolCalls: 5,
        toolErrors: 1,
        filesEdited: 2,
      },
      {
        project: 'web',
        skill: 'verify',
        ticket: '',
        startedAt: '2026-07-01T12:05:00.000Z',
        verdict: 'failed',
        durationSec: 90,
        toolCalls: 7,
        toolErrors: 2,
        filesEdited: 1,
      },
    ],
  }, 'nonce-stats', ACTION_SCRIPT_URI);
  assert.ok(statsHtml.includes('Kronos Session Stats'));
  assert.ok(statsHtml.includes('api&lt;script&gt;'));
  assert.ok(statsHtml.includes('implement&lt;one&gt;'));
  assert.ok(statsHtml.includes('K-STATS&lt;script&gt;'));
  assert.ok(statsHtml.includes('2</div><div class="lbl">Sessions</div>'));
  assert.ok(statsHtml.includes('1/2'));
  assert.ok(statsHtml.includes('data-action="sessionHistory"'));
  assert.ok(statsHtml.includes('nonce="nonce-stats"'));
  assert.equal(statsHtml.includes('api<script>'), false);

  const manifestHtml = operationsReportPanelView.buildIntegrationManifestHtml({
    present: true,
    valid: false,
    path: '/tmp/manifest<bad>.json',
    manifest: {
      prompts: { 'prompt<one>': { required: true, sha256: 'abcdef123456' } },
      providers: { jira: { enabled: true, baseUrl: 'https://jira.example/<team>' } },
    },
    errors: ['Bad <json>'],
    warnings: ['Warn & watch'],
  }, {
    status: 'warn',
    summary: '1 <drift>',
    artifacts: [{
      kind: 'prompt',
      name: 'prompt<one>',
      path: '/tmp/prompt',
      status: 'fail',
      detail: 'Hash <bad>',
      expectedSha256: 'abcdef1234567890',
      actualSha256: '123456abcdef7890',
    }],
  }, 'nonce-manifest', ACTION_SCRIPT_URI);
  assert.ok(manifestHtml.includes('/tmp/manifest&lt;bad&gt;.json'));
  assert.ok(manifestHtml.includes('Bad &lt;json&gt;'));
  assert.ok(manifestHtml.includes('Warn &amp; watch'));
  assert.ok(manifestHtml.includes('Hash &lt;bad&gt;'));
  assert.ok(manifestHtml.includes('data-action="snapshotIntegrationManifest"'));

  const activeProfile = profileManager.listProfiles()[0];
  const profilesHtml = operationsReportPanelView.buildProfilesHtml(activeProfile, 'nonce-profiles', ACTION_SCRIPT_URI);
  assert.ok(profilesHtml.includes('Kronos Profiles'));
  assert.ok(profilesHtml.includes('data-action="integrationManifest"'));
  assert.ok(profilesHtml.includes('ACTIVE'));

  const doctorHtml = operationsReportPanelView.buildDoctorHtml([
    { name: 'Git <cli>', status: 'fail', detail: 'Missing & blocked' },
  ], 'nonce-doctor', ACTION_SCRIPT_URI);
  assert.ok(doctorHtml.includes('Git &lt;cli&gt;'));
  assert.ok(doctorHtml.includes('Missing &amp; blocked'));
  assert.ok(doctorHtml.includes('data-action="setup"'));
  assert.equal(doctorHtml.includes('Git <cli>'), false);
});

test('ticket filters match operator search facets and grouped views', () => {
  const now = new Date('2026-07-01T12:00:00.000Z');
  const entries = Object.entries({
    'K-1': ticket({
      summary: 'Fix checkout retry',
      priority: 'High',
      next_action: 'fix_build',
      labels: ['checkout'],
      updated: '2026-06-20T12:00:00.000Z',
      build: { number: 12, status: 'FAILURE', url: '' },
      mr: { iid: 1, state: 'opened', review_status: 'changes_requested', url: '' },
    }),
    'K-2': ticket({
      summary: 'Review profile page',
      priority: 'Medium',
      next_action: 'await_review',
      projects: ['web'],
      labels: ['profile'],
      updated: '2026-07-01T10:00:00.000Z',
      build: { number: 13, status: 'SUCCESS', url: '' },
      mr: { iid: 2, state: 'opened', review_status: 'approved', url: '' },
    }),
    'K-3': ticket({
      summary: 'Unlinked intake bug',
      projects: [],
      labels: ['intake'],
      updated: '2026-06-01T12:00:00.000Z',
    }),
  });

  assert.deepEqual(ticketFilters.filterTickets(entries, { query: 'checkout', label: 'checkout', buildStatus: 'FAILURE' }, now).map(([key]) => key), ['K-1']);
  assert.deepEqual(ticketFilters.filterTickets(entries, { project: 'web', mrState: 'approved' }, now).map(([key]) => key), ['K-2']);
  assert.deepEqual(ticketFilters.filterTickets(entries, { linked: 'unlinked', staleDays: 7 }, now).map(([key]) => key), ['K-3']);
  assert.match(ticketFilters.describeTicketFilter({ query: 'retry', staleDays: 7 }), /search "retry".*stale 7\+ days/);
  assert.deepEqual(ticketFilters.cleanTicketFilter({
    query: ' retry ',
    project: ' ',
    action: 'await_review',
    staleDays: 0,
    linked: 'unlinked',
  }), { query: 'retry', action: 'await_review', linked: 'unlinked' });
  const mutableFilter = {};
  ticketFilters.setTicketFilterString(mutableFilter, 'project', ' api ');
  ticketFilters.setTicketFilterString(mutableFilter, 'priority', ' ');
  assert.deepEqual(mutableFilter, { project: 'api' });
  assert.deepEqual(ticketFilters.uniqueTicketFilterValues([' web ', 'api', '', 'web', 'api']), ['api', 'web']);
  assert.deepEqual(ticketFilters.ticketFilterPromptFields(false).map(field => field.id), [
    'query',
    'project',
    'action',
    'priority',
    'label',
    'mrState',
    'buildStatus',
    'staleDays',
    'linked',
    'groupBy',
    'clear',
  ]);
  assert.deepEqual(ticketFilters.ticketFilterPromptFields(true).map(field => field.id), [
    'query',
    'project',
    'action',
    'priority',
    'label',
    'mrState',
    'buildStatus',
    'staleDays',
    'clear',
  ]);
  assert.deepEqual(ticketFilters.ticketFilterChoiceItems(['api', 'web'], 'web'), [
    { label: 'Any' },
    { label: 'api' },
    { label: 'web', description: 'current' },
  ]);
  const tickets = entries.map(([, value]) => value);
  assert.deepEqual(ticketFilters.ticketFilterFacetValues('project', tickets, { ops: {} }), ['app', 'ops', 'web']);
  assert.deepEqual(ticketFilters.ticketFilterFacetValues('action', tickets), ['await_review', 'fix_build', 'implement']);
  assert.ok(ticketFilters.ticketFilterFacetValues('mrState', tickets).includes('changes_requested'));
  assert.ok(ticketFilters.ticketFilterFacetValues('buildStatus', tickets).includes('SUCCESS'));

  const grouped = ticketFilters.groupTicketEntries(entries, 'project');
  assert.ok(grouped.some(([label, groupEntries]) => label === 'Unlinked' && groupEntries.length === 1));
  assert.ok(ticketFilters.TICKET_FILTER_PRESETS.some(preset => preset.id === 'stale_week'));
});

test('evidence store formats markdown and compact comment handoff', () => {
  const t = ticket({
    summary: 'Fix checkout',
    next_action: 'await_review',
    mr: { iid: 42, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/mr/42' },
    build: { number: 77, status: 'SUCCESS', url: 'https://jenkins.example/77' },
    evidence: {
      acceptance_criteria: [
        null,
        'bad criterion',
        { id: 'ac-1', text: 'User can retry checkout after timeout', checked: true },
        { id: 'ac-2', text: 'Timeout errors are logged with request id', checked: false },
      ],
      notes: [
        null,
        'bad note',
        { at: '2026-07-01T00:00:00.000Z', kind: 'test', text: 'npm test passed' },
        { at: '2026-07-01T00:01:00.000Z', kind: 'risk', text: 'QA should recheck timeout flow' },
      ],
      checks: [
        null,
        {
          id: 'check-1',
          at: '2026-07-01T00:02:00.000Z',
          name: 'checkout retry smoke',
          result: 'pass',
          environment: 'local',
          command: 'npm test -- checkout',
          summary: 'Retry path passed',
          confidence: 'high',
          artifact_path: '/tmp/checkout.log',
        },
      ],
      environment_results: {
        broken: null,
        test: {
          environment: 'test',
          status: 'warn',
          checked_at: '2026-07-01T00:03:00.000Z',
          detail: 'TEST deploy pending final data refresh',
          artifact_path: 'https://jenkins.example/77',
        },
      },
      risk_notes: [
        null,
        { at: '2026-07-01T00:04:00.000Z', text: 'Timeout flow needs QA data refresh', severity: 'medium' },
      ],
    },
  });

  const exported = evidenceStore.writeEvidenceExport('K-9', t);
  const markdown = exported.markdown;
  const comment = evidenceStore.formatEvidenceComment('K-9', t);

  assert.match(markdown, /# Evidence for K-9/);
  assert.match(markdown, /## Acceptance Criteria/);
  assert.match(markdown, /- \[x\] User can retry checkout after timeout/);
  assert.match(markdown, /Build: #77 SUCCESS/);
  assert.match(markdown, /## Evidence Checks/);
  assert.match(markdown, /checkout retry smoke/);
  assert.match(markdown, /## Environment Results/);
  assert.match(markdown, /TEST deploy pending final data refresh/);
  assert.match(markdown, /QA should recheck timeout flow/);
  assert.match(comment, /Kronos evidence for K-9/);
  assert.match(comment, /Acceptance criteria:/);
  assert.match(comment, /Evidence checks:/);
  assert.match(comment, /\[pass\] checkout retry smoke/);
  assert.match(comment, /Environment results:/);
  assert.match(comment, /\[test\] npm test passed/);
});

test('evidence store keeps long ticket keys in bounded distinct filenames', () => {
  const t = ticket({
    summary: 'Long ticket key',
    evidence: {
      notes: [{ at: '2026-07-01T00:00:00.000Z', kind: 'test', text: 'evidence captured' }],
    },
  });
  const firstKey = `TEAM/${'a'.repeat(260)}-one`;
  const secondKey = `TEAM/${'a'.repeat(260)}-two`;

  const first = evidenceStore.writeEvidenceExport(firstKey, t);
  const second = evidenceStore.writeEvidenceExport(secondKey, t);

  assert.notEqual(first.filePath, second.filePath);
  assert.equal(path.basename(first.filePath).length <= 163, true);
  assert.equal(path.basename(second.filePath).length <= 163, true);
  assert.equal(path.dirname(first.filePath), path.dirname(second.filePath));
  assert.equal(fs.existsSync(first.filePath), true);
  assert.equal(fs.existsSync(second.filePath), true);
});

test('evidence handoff plan prepares Jira, MR, file destinations and manual posting steps', () => {
  const t = ticket({
    summary: 'Fix checkout',
    jira_url: 'https://jira.example/K-9',
    mr: { iid: 42, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/mr/42' },
    evidence: {
      checks: [{ id: 'check-1', at: 'now', name: 'npm test', result: 'pass' }],
    },
  });
  const exported = {
    markdown: '# Evidence',
    comment: evidenceStore.formatEvidenceComment('K-9', t),
    filePath: '/tmp/K-9.md',
  };

  const plan = evidenceHandoff.buildEvidenceHandoffPlan('K-9', t, exported);

  assert.equal(plan.ticketKey, 'K-9');
  assert.equal(plan.exportPath, '/tmp/K-9.md');
  assert.match(plan.comment, /Kronos evidence for K-9/);
  assert.ok(plan.destinations.some(d => d.kind === 'jira' && d.available && d.url === 'https://jira.example/K-9'));
  assert.ok(plan.destinations.some(d => d.kind === 'mr' && d.available && d.url === 'https://gitlab.example/mr/42'));
  assert.ok(plan.destinations.some(d => d.kind === 'file' && d.available));
  assert.ok(plan.manualSteps.some(step => step.includes('Paste the comment')));

  const missing = evidenceHandoff.buildEvidenceHandoffPlan('K-10', ticket({ summary: 'No links' }), exported);
  assert.ok(missing.destinations.some(d => d.kind === 'jira' && !d.available));
  assert.ok(missing.destinations.some(d => d.kind === 'mr' && !d.available));
});

test('evidence publisher plans and posts Jira and GitLab comments through injectable transport', async () => {
  const t = ticket({
    summary: 'Publish evidence',
    jira_url: 'https://jira.example/browse/K-77',
    mr: { iid: 12, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/group/app/-/merge_requests/12' },
  });
  const plan = evidencePublisher.buildEvidencePublishPlan('K-77', t, 'Kronos evidence\n- npm test passed', {
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-token',
    GITLAB_TOKEN: 'gitlab-token',
  });

  const jira = plan.destinations.find(destination => destination.kind === 'jira');
  const gitlab = plan.destinations.find(destination => destination.kind === 'gitlab_mr');
  assert.equal(jira.status, 'ready');
  assert.equal(jira.endpoint, 'https://jira.example/rest/api/3/issue/K-77/comment');
  assert.equal(gitlab.status, 'ready');
  assert.equal(gitlab.endpoint, 'https://gitlab.example/api/v4/projects/group%2Fapp/merge_requests/12/notes');
  assert.equal(evidencePublisher.readyPublishDestinations(plan).length, 2);

  const jiraWithBasePath = evidencePublisher.buildEvidencePublishPlan('K-77', ticket({
    summary: 'Publish evidence with Jira context path',
  }), 'body', {
    JIRA_BASE_URL: 'https://jira.example/jira/',
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-token',
  }).destinations.find(destination => destination.kind === 'jira');
  assert.equal(jiraWithBasePath.endpoint, 'https://jira.example/jira/rest/api/3/issue/K-77/comment');
  const jiraFromIssuePath = evidencePublisher.buildEvidencePublishPlan('K-78', ticket({
    summary: 'Publish evidence with Jira issue context path',
    jira_url: 'https://jira.example/jira/browse/K-78',
  }), 'body', {
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-token',
  }).destinations.find(destination => destination.kind === 'jira');
  assert.equal(jiraFromIssuePath.endpoint, 'https://jira.example/jira/rest/api/3/issue/K-78/comment');

  const configuredGitlab = evidencePublisher.buildEvidencePublishPlan('K-77', {
    ...t,
    mr: { iid: 12, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/group/app/-/merge_requests/34/diffs' },
  }, 'body', {
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-token',
    GITLAB_TOKEN: 'gitlab-token',
    GITLAB_API_BASE_URL: 'https://gitlab.internal/api/v4/',
  }).destinations.find(destination => destination.kind === 'gitlab_mr');
  assert.equal(configuredGitlab.endpoint, 'https://gitlab.internal/api/v4/projects/group%2Fapp/merge_requests/34/notes');

  const requests = [];
  const results = await evidencePublisher.publishEvidencePlan(plan, ['jira'], async request => {
    requests.push(request);
    assert.equal(request.method, 'POST');
    assert.match(request.headers['Content-Type'], /application\/json/);
    assert.doesNotMatch(request.body, /jira-token|gitlab-token/);
    return { statusCode: 201, body: '{"id":1}' };
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, jira.endpoint);
  assert.match(requests[0].headers.Authorization, /^Basic /);
  assert.equal(results.find(result => result.kind === 'jira').status, 'posted');
  assert.equal(results.find(result => result.kind === 'gitlab_mr').status, 'skipped');

  const failed = await evidencePublisher.publishEvidencePlan(plan, ['gitlab_mr'], async () => ({ statusCode: 403, body: 'denied by API token' }));
  assert.equal(failed.find(result => result.kind === 'gitlab_mr').status, 'failed');
  assert.match(failed.find(result => result.kind === 'gitlab_mr').detail, /denied/);

  const thrown = await evidencePublisher.publishEvidencePlan(plan, ['gitlab_mr'], async () => {
    throw new Error('network is down');
  });
  assert.equal(thrown.find(result => result.kind === 'gitlab_mr').status, 'failed');
  assert.match(thrown.find(result => result.kind === 'gitlab_mr').detail, /network is down/);

  const thrownWithoutMessage = await evidencePublisher.publishEvidencePlan(plan, ['gitlab_mr'], async () => {
    throw { message: '   ' };
  });
  assert.equal(thrownWithoutMessage.find(result => result.kind === 'gitlab_mr').status, 'failed');
  assert.equal(thrownWithoutMessage.find(result => result.kind === 'gitlab_mr').detail, 'Evidence publish request failed.');

  const badEndpoint = await evidencePublisher.publishEvidencePlan({
    ticketKey: 'K-BAD-ENDPOINT',
    comment: 'body',
    destinations: [{
      kind: 'jira',
      label: 'Bad Jira',
      status: 'ready',
      detail: 'bad endpoint',
      endpoint: 'file:///tmp/comment',
      headers: {},
      body: { body: 'x' },
    }],
  }, ['jira'], async () => {
    throw new Error('transport should not be called for non-http endpoint');
  });
  assert.equal(badEndpoint[0].status, 'failed');
  assert.match(badEndpoint[0].detail, /HTTP or HTTPS/);

  const missing = evidencePublisher.buildEvidencePublishPlan('K-78', ticket({ summary: 'Missing config' }), 'body', {});
  assert.equal(evidencePublisher.readyPublishDestinations(missing).length, 0);
  assert.ok(missing.destinations.every(destination => destination.status === 'missing_config'));

  const unsupported = evidencePublisher.buildEvidencePublishPlan('K-79', {
    ...t,
    jira_url: 'file:///tmp/K-79',
    mr: { iid: 79, state: 'opened', review_status: 'pending_review', url: 'file:///group/app/-/merge_requests/79' },
  }, 'body', {
    JIRA_BASE_URL: 'file:///tmp',
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-token',
    GITLAB_TOKEN: 'gitlab-token',
  });
  assert.equal(unsupported.destinations.find(destination => destination.kind === 'jira').status, 'unsupported_url');
  assert.equal(unsupported.destinations.find(destination => destination.kind === 'gitlab_mr').status, 'unsupported_url');
  assert.equal(evidencePublisher.readyPublishDestinations(unsupported).length, 0);

  const source = readSourceFixture('src', 'services', 'evidencePublisher.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Evidence publish request failed.')",
    'function jiraCommentEndpoint(jiraBase: string, ticketKey: string): string',
    "new URL(`rest/api/3/issue/${encodeURIComponent(ticketKey)}/comment`, base).toString()",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    '} catch (e) {',
    "e?.message || 'Evidence publish request failed.'",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('run store archives run record, log, and prompt artifacts', () => {
  const run = {
    id: 'run-1',
    project: 'app',
    skill: 'implement',
    ticket: 'K-10',
    status: 'failed',
    logPath: path.join(runStore.RUNS_DIR, 'run-1.log'),
  };
  const promptPath = runStore.writeRunPrompt(run.id, 'saved prompt');
  run.promptPath = promptPath;
  runStore.writeRunRecord(run);
  runStore.appendRunLog(run.logPath, 'log line\n');

  const archived = runStore.archiveRun(run.id);

  assert.equal(fs.existsSync(runStore.runRecordPath(run.id)), false);
  assert.equal(fs.existsSync(archived.runPath), true);
  assert.equal(fs.existsSync(archived.logPath), true);
  assert.equal(fs.existsSync(archived.promptPath), true);
  assert.equal(fs.readFileSync(archived.promptPath, 'utf8'), 'saved prompt');
  assert.equal(runStore.readRunRecord(run.id), null);
  assert.equal(runStore.readArchivedRuns().some(r => r.id === run.id), true);
  assert.equal(JSON.parse(fs.readFileSync(archived.runPath, 'utf8')).id, run.id);
});

test('run store reads UTF-8 BOM-prefixed JSON files from Windows tools', () => {
  const run = {
    id: 'run-bom',
    project: 'app',
    skill: 'implement',
    ticket: 'K-BOM',
    status: 'completed',
  };
  fs.mkdirSync(runStore.RUNS_DIR, { recursive: true });
  fs.writeFileSync(runStore.runRecordPath(run.id), `\ufeff${JSON.stringify(run, null, 2)}`, 'utf8');

  const read = runStore.readRunRecord(run.id);
  const issues = runStore.listRunStoreIssues();

  assert.equal(read.id, run.id);
  assert.equal(issues.some(issue => issue.filePath === runStore.runRecordPath(run.id)), false);
});

test('run store returns normalized active views and repairs only on explicit request', () => {
  const completed = {
    id: 'run-terminal-completed',
    project: 'app',
    skill: 'implement',
    ticket: 'K-DONE',
    status: 'running',
    exitCode: 0,
    endedAt: '2026-07-02T10:00:00.000Z',
  };
  const failed = {
    id: 'run-terminal-failed',
    project: 'app',
    skill: 'verify',
    ticket: 'K-FAIL',
    status: 'preflight',
    events: [{ type: 'error', label: 'Session exited with code 1', timestamp: '2026-07-02T10:05:00.000Z' }],
  };
  const timestampOnly = {
    id: 'run-terminal-unknown',
    project: 'app',
    skill: 'implement',
    ticket: 'K-UNKNOWN',
    status: 'running',
    endedAt: '2026-07-02T10:10:00.000Z',
  };
  const deadProcess = {
    id: 'run-dead-process',
    project: 'app',
    skill: 'implement',
    ticket: 'K-DEAD',
    status: 'running',
    processPid: 99999999,
    startedAt: '2026-07-02T10:15:00.000Z',
  };
  const staleProcessless = {
    id: 'run-stale-processless',
    project: 'app',
    skill: 'implement',
    ticket: 'K-STALE',
    status: 'running',
    startedAt: '2000-01-01T00:00:00.000Z',
  };
  const staleUntimestamped = {
    id: 'run-stale-untimestamped',
    project: 'app',
    skill: 'implement',
    ticket: 'K-STALE-NO-START',
    status: 'running',
  };
  const logCompleted = {
    id: 'run-terminal-log',
    project: 'app',
    skill: 'implement',
    ticket: 'K-LOG',
    status: 'running',
    logPath: path.join(runStore.RUNS_DIR, 'run-terminal-log.log'),
  };
  const logCompletedDeadProcess = {
    id: 'run-terminal-log-dead-process',
    project: 'app',
    skill: 'implement',
    ticket: 'K-LOG-DEAD',
    status: 'running',
    processPid: 99999999,
    startedAt: '2026-07-02T10:15:00.000Z',
    logPath: path.join(runStore.RUNS_DIR, 'run-terminal-log-dead-process.log'),
  };
  const logCompletedStaleProcessless = {
    id: 'run-terminal-log-stale-processless',
    project: 'app',
    skill: 'implement',
    ticket: 'K-LOG-STALE',
    status: 'running',
    startedAt: '2000-01-01T00:00:00.000Z',
    logPath: path.join(runStore.RUNS_DIR, 'run-terminal-log-stale-processless.log'),
  };
  const externalLog = path.join(makeTempDir('kronos-external-run-log-'), 'external.log');
  const unsafeLog = {
    id: 'run-terminal-external-log',
    project: 'app',
    skill: 'implement',
    ticket: 'K-EXT',
    status: 'running',
    logPath: externalLog,
  };

  runStore.writeRunRecord(completed);
  runStore.writeRunRecord(failed);
  runStore.writeRunRecord(timestampOnly);
  runStore.writeRunRecord(deadProcess);
  runStore.writeRunRecord(staleProcessless);
  runStore.writeRunRecord(staleUntimestamped);
  runStore.writeRunRecord(logCompleted);
  runStore.writeRunRecord(logCompletedDeadProcess);
  runStore.writeRunRecord(logCompletedStaleProcessless);
  runStore.writeRunRecord(unsafeLog);
  fs.utimesSync(
    runStore.runRecordPath(staleUntimestamped.id),
    new Date('2000-01-01T00:00:00.000Z'),
    new Date('2000-01-01T00:00:00.000Z'),
  );
  runStore.appendRunLog(logCompleted.logPath, 'tool output: Session exited with code 1\n{"type":"assistant","message":{"content":[]}}\n{"type":"result","subtype":"success","result":"done"}\n');
  runStore.appendRunLog(logCompletedDeadProcess.logPath, '{"type":"result","subtype":"success","result":"done"}\n');
  runStore.appendRunLog(logCompletedStaleProcessless.logPath, '{"type":"result","subtype":"success","result":"done"}\n');
  fs.writeFileSync(externalLog, '{"type":"result","subtype":"success","result":"done"}\n');

  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(completed.id), 'utf8')).status, 'running');
  const completedRead = runStore.readRunRecord(completed.id);
  const failedRead = runStore.readRunRecord(failed.id);
  const timestampOnlyRead = runStore.readRunRecord(timestampOnly.id);
  const deadProcessRead = runStore.readRunRecord(deadProcess.id);
  const staleProcesslessRead = runStore.readRunRecord(staleProcessless.id);
  const staleUntimestampedRead = runStore.readRunRecord(staleUntimestamped.id);
  const logCompletedRead = runStore.readRunRecord(logCompleted.id);
  const logCompletedDeadProcessRead = runStore.readRunRecord(logCompletedDeadProcess.id);
  const logCompletedStaleProcesslessRead = runStore.readRunRecord(logCompletedStaleProcessless.id);
  const unsafeLogRead = runStore.readRunRecord(unsafeLog.id);
  assert.equal(completedRead.status, 'completed');
  assert.equal(failedRead.status, 'failed');
  assert.equal(failedRead.failureKind, 'unknown');
  assert.equal(timestampOnlyRead.status, 'needs_human');
  assert.match(timestampOnlyRead.failureReason, /terminal metadata/);
  assert.equal(deadProcessRead.status, 'failed');
  assert.equal(deadProcessRead.failureKind, 'unknown');
  assert.match(deadProcessRead.failureReason, /process 99999999 is no longer running/);
  assert.ok(deadProcessRead.endedAt);
  assert.ok(deadProcessRead.events.some(event => event.label === 'Run process no longer exists'));
  assert.equal(staleProcesslessRead.status, 'needs_human');
  assert.match(staleProcesslessRead.failureReason, /stale active-run threshold/);
  assert.ok(staleProcesslessRead.endedAt);
  assert.ok(staleProcesslessRead.events.some(event => event.label === 'Stale active run needs human review'));
  assert.equal(staleUntimestampedRead.status, 'needs_human');
  assert.match(staleUntimestampedRead.failureReason, /stale active-run threshold/);
  assert.ok(staleUntimestampedRead.endedAt);
  assert.ok(staleUntimestampedRead.events.some(event => event.label === 'Stale active run needs human review'));
  assert.equal(logCompletedRead.status, 'completed');
  assert.ok(logCompletedRead.endedAt);
  assert.equal(logCompletedDeadProcessRead.status, 'completed');
  assert.equal(logCompletedDeadProcessRead.failureReason, undefined);
  assert.equal(Array.isArray(logCompletedDeadProcessRead.events) && logCompletedDeadProcessRead.events.some(event => event.label === 'Run process no longer exists'), false);
  assert.equal(logCompletedStaleProcesslessRead.status, 'completed');
  assert.equal(logCompletedStaleProcesslessRead.failureReason, undefined);
  assert.equal(Array.isArray(logCompletedStaleProcesslessRead.events) && logCompletedStaleProcesslessRead.events.some(event => event.label === 'Stale active run needs human review'), false);
  assert.equal(unsafeLogRead.status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(completed.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(failed.id), 'utf8')).status, 'preflight');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(timestampOnly.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(deadProcess.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(staleProcessless.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(staleUntimestamped.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompleted.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompletedDeadProcess.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompletedStaleProcessless.id), 'utf8')).status, 'running');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(unsafeLog.id), 'utf8')).status, 'running');

  const repaired = runStore.repairActiveRunRecords();
  assert.equal(repaired.repaired, 9);
  assert.equal(repaired.runs.some(run => run.id === unsafeLog.id && run.status === 'running'), true);
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(completed.id), 'utf8')).status, 'completed');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(failed.id), 'utf8')).status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(timestampOnly.id), 'utf8')).status, 'needs_human');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(deadProcess.id), 'utf8')).status, 'failed');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(staleProcessless.id), 'utf8')).status, 'needs_human');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(staleUntimestamped.id), 'utf8')).status, 'needs_human');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompleted.id), 'utf8')).status, 'completed');
  const persistedLogCompletedDeadProcess = JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompletedDeadProcess.id), 'utf8'));
  const persistedLogCompletedStaleProcessless = JSON.parse(fs.readFileSync(runStore.runRecordPath(logCompletedStaleProcessless.id), 'utf8'));
  assert.equal(persistedLogCompletedDeadProcess.status, 'completed');
  assert.equal(persistedLogCompletedDeadProcess.failureReason, undefined);
  assert.equal(persistedLogCompletedStaleProcessless.status, 'completed');
  assert.equal(persistedLogCompletedStaleProcessless.failureReason, undefined);
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(unsafeLog.id), 'utf8')).status, 'running');

  const archived = runStore.archiveRun(failed.id);
  const archivedRun = JSON.parse(fs.readFileSync(archived.runPath, 'utf8'));
  assert.equal(archivedRun.status, 'failed');
  assert.equal(runStore.readRunRecord(failed.id), null);
  assert.equal(archivedRun.id, failed.id);
});

test('dispatcher listRuns persists stale active run repairs for UI callers', async () => {
  const run = {
    id: 'run-dispatcher-stale-active',
    project: 'app',
    skill: 'implement',
    ticket: 'K-DISPATCHER-STALE',
    status: 'running',
    endedAt: '2026-07-02T10:10:00.000Z',
  };
  runStore.writeRunRecord(run);
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(run.id), 'utf8')).status, 'running');

  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => request === 'vscode' ? vscodeStub.vscode : undefined, async () => {
    const dispatcherPath = require.resolve('../out/runners/sessionDispatcher.js');
    delete require.cache[dispatcherPath];
    const dispatcher = require(dispatcherPath);
    const runs = dispatcher.listRuns();
    assert.equal(runs.find(r => r.id === run.id).status, 'needs_human');
  });

  const persisted = JSON.parse(fs.readFileSync(runStore.runRecordPath(run.id), 'utf8'));
  assert.equal(persisted.status, 'needs_human');
  assert.match(persisted.failureReason, /terminal metadata/);
});

test('dispatcher listRuns backfills terminal run readiness from current ticket state', async () => {
  fs.rmSync(runStore.RUNS_DIR, { recursive: true, force: true });
  const readyTicket = ticket({
    next_action: 'await_review',
    projects: ['app'],
    mr: { iid: 21, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/mr/21' },
    build: { number: 21, status: 'SUCCESS', url: 'https://jenkins.example/21' },
    evidence: {
      acceptance_criteria: [{ id: 'ac-1', text: 'Works', checked: true }],
      notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }],
      checks: [{ id: 'check-1', at: 'now', name: 'smoke', result: 'pass' }],
    },
  });
  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(baseState({ 'K-BACKFILL': readyTicket }), null, 2));
  const run = {
    id: 'run-readiness-backfill',
    project: 'app',
    skill: 'implement',
    ticket: 'K-BACKFILL',
    status: 'completed',
    startedAt: '2026-07-02T10:00:00.000Z',
    endedAt: '2026-07-02T10:05:00.000Z',
  };
  runStore.writeRunRecord(run);

  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => request === 'vscode' ? vscodeStub.vscode : undefined, async () => {
    const dispatcherPath = require.resolve('../out/runners/sessionDispatcher.js');
    delete require.cache[dispatcherPath];
    const dispatcher = require(dispatcherPath);
    const runs = dispatcher.listRuns();
    const backfilled = runs.find(r => r.id === run.id);
    assert.equal(backfilled.status, 'waiting_for_review');
    assert.equal(backfilled.readiness.status, 'ready');
    assert.equal(backfilled.readiness.ticketKey, 'K-BACKFILL');
  });

  const persisted = JSON.parse(fs.readFileSync(runStore.runRecordPath(run.id), 'utf8'));
  assert.equal(persisted.status, 'waiting_for_review');
  assert.equal(persisted.readiness.status, 'ready');
  assert.equal(persisted.readiness.ticketKey, 'K-BACKFILL');

  const unresolved = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'completed' },
    ticketKey: 'K-MISSING',
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(unresolved.status, 'needs_human');
  assert.match(unresolved.summary, /could not resolve current ticket state/);
});

test('run store limit selects newest records before repairing active runs', () => {
  const oldRun = {
    id: 'zz-run-limit-old',
    project: 'app',
    skill: 'implement',
    ticket: 'K-LIMIT-OLD',
    status: 'running',
    endedAt: '2026-07-01T10:00:00.000Z',
  };
  const newRun = {
    id: 'aa-run-limit-new',
    project: 'app',
    skill: 'implement',
    ticket: 'K-LIMIT-NEW',
    status: 'running',
    endedAt: '2026-07-02T10:00:00.000Z',
  };
  runStore.writeRunRecord(oldRun);
  runStore.writeRunRecord(newRun);
  fs.utimesSync(runStore.runRecordPath(oldRun.id), new Date('2035-01-01T00:00:00.000Z'), new Date('2035-01-01T00:00:00.000Z'));
  fs.utimesSync(runStore.runRecordPath(newRun.id), new Date('2035-01-02T00:00:00.000Z'), new Date('2035-01-02T00:00:00.000Z'));

  const repaired = runStore.repairActiveRunRecords(1);
  assert.deepEqual(repaired.runs.map(run => run.id), [newRun.id]);
  assert.equal(repaired.repaired, 1);
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(newRun.id), 'utf8')).status, 'needs_human');
  assert.equal(JSON.parse(fs.readFileSync(runStore.runRecordPath(oldRun.id), 'utf8')).status, 'running');
});

test('run store archive does not overwrite existing archived records or artifacts', () => {
  const logPath = path.join(runStore.RUNS_DIR, 'shared.log');
  const promptPath = path.join(runStore.RUNS_DIR, 'shared.prompt.txt');
  const existingRun = {
    id: 'run-collision',
    project: 'app',
    skill: 'implement',
    ticket: 'K-COLLIDE',
    status: 'failed',
    logPath,
    promptPath,
  };
  runStore.writeRunRecord(existingRun);
  runStore.appendRunLog(logPath, 'old log\n');
  fs.writeFileSync(promptPath, 'old prompt\n');
  const existingArchived = runStore.archiveRun(existingRun.id);

  const run = {
    id: 'run-collision',
    project: 'app',
    skill: 'implement',
    ticket: 'K-COLLIDE',
    status: 'failed',
    logPath,
    promptPath,
  };
  runStore.writeRunRecord(run);
  runStore.appendRunLog(logPath, 'new log\n');
  fs.writeFileSync(promptPath, 'new prompt\n');

  const archived = runStore.archiveRun(run.id);

  assert.notEqual(archived.runPath, existingArchived.runPath);
  assert.notEqual(archived.logPath, existingArchived.logPath);
  assert.notEqual(archived.promptPath, existingArchived.promptPath);
  assert.equal(fs.readFileSync(existingArchived.logPath, 'utf8'), 'old log\n');
  assert.equal(fs.readFileSync(existingArchived.promptPath, 'utf8'), 'old prompt\n');
  assert.equal(fs.readFileSync(archived.logPath, 'utf8'), 'new log\n');
  assert.equal(fs.readFileSync(archived.promptPath, 'utf8'), 'new prompt\n');
  assert.ok(archived.warnings.some(warning => warning.includes('already exists')));
});

test('run store keeps long run ids in bounded distinct filenames', () => {
  const firstId = `run-${'a'.repeat(260)}-one`;
  const secondId = `run-${'a'.repeat(260)}-two`;
  const firstPath = runStore.runRecordPath(firstId);
  const secondPath = runStore.runRecordPath(secondId);

  assert.notEqual(firstPath, secondPath);
  assert.equal(path.basename(firstPath).length <= 165, true);
  assert.equal(path.basename(secondPath).length <= 165, true);
  assert.equal(path.dirname(firstPath), runStore.RUNS_DIR);
  assert.equal(path.dirname(secondPath), runStore.RUNS_DIR);
});

test('run store archive refuses to move artifacts outside runs directory', () => {
  const externalDir = makeTempDir('kronos-external-artifact-');
  const externalLog = path.join(externalDir, 'external.log');
  const externalPrompt = path.join(externalDir, 'external.prompt.txt');
  fs.writeFileSync(externalLog, 'external log\n');
  fs.writeFileSync(externalPrompt, 'external prompt\n');
  const run = {
    id: 'run-external-artifact',
    project: 'app',
    skill: 'implement',
    ticket: 'K-EXT',
    status: 'failed',
    logPath: externalLog,
    promptPath: externalPrompt,
  };
  runStore.writeRunRecord(run);

  const archived = runStore.archiveRun(run.id);
  const persisted = JSON.parse(fs.readFileSync(archived.runPath, 'utf8'));

  assert.equal(fs.existsSync(externalLog), true);
  assert.equal(fs.existsSync(externalPrompt), true);
  assert.equal(archived.logPath, undefined);
  assert.equal(archived.promptPath, undefined);
  assert.ok(archived.warnings.some(warning => warning.includes('outside active runs directory')));
  assert.ok(persisted.archiveWarnings.some(warning => warning.includes(externalLog)));
  assert.equal(persisted.logPath, externalLog);
  assert.equal(persisted.promptPath, externalPrompt);
});

test('run store archive refuses symlink artifacts escaping runs directory', () => {
  const externalDir = makeTempDir('kronos-external-symlink-artifact-');
  const externalLog = path.join(externalDir, 'external.log');
  fs.writeFileSync(externalLog, 'external log\n');
  fs.mkdirSync(runStore.RUNS_DIR, { recursive: true });
  const activeLogLink = path.join(runStore.RUNS_DIR, 'symlink-escape.log');
  if (!tryCreateSymlink(externalLog, activeLogLink)) { return; }
  const run = {
    id: 'run-symlink-artifact',
    project: 'app',
    skill: 'implement',
    ticket: 'K-SYMLINK',
    status: 'failed',
    logPath: activeLogLink,
  };
  runStore.writeRunRecord(run);

  const archived = runStore.archiveRun(run.id);
  const persisted = JSON.parse(fs.readFileSync(archived.runPath, 'utf8'));

  assert.equal(fs.existsSync(externalLog), true);
  assert.equal(fs.lstatSync(activeLogLink).isSymbolicLink(), true);
  assert.equal(archived.logPath, undefined);
  assert.ok(archived.warnings.some(warning => warning.includes('outside active runs directory')));
  assert.equal(persisted.logPath, activeLogLink);
});

test('run store refuses to append logs outside active runs directory', () => {
  const externalDir = makeTempDir('kronos-external-log-');
  const externalLog = path.join(externalDir, 'run.log');
  const activeLog = path.join(runStore.RUNS_DIR, 'archived.log');
  runStore.writeRunRecord({
    id: 'run-archived-log',
    project: 'app',
    skill: 'implement',
    ticket: 'K-ARCHIVE-LOG',
    status: 'failed',
    logPath: activeLog,
  });
  runStore.appendRunLog(activeLog, 'archived log\n');
  const archived = runStore.archiveRun('run-archived-log');
  assert.ok(archived.logPath);

  assert.throws(
    () => runStore.appendRunLog(externalLog, 'bad\n'),
    /outside active runs directory/,
  );
  assert.throws(
    () => runStore.appendRunLog(archived.logPath, 'bad\n'),
    /outside active runs directory/,
  );
  assert.equal(fs.existsSync(externalLog), false);
  assert.equal(fs.readFileSync(archived.logPath, 'utf8'), 'archived log\n');
});

test('run store refuses to append through symlink escapes under active runs directory', () => {
  const externalDir = makeTempDir('kronos-external-symlink-log-');
  const externalLog = path.join(externalDir, 'run.log');
  fs.writeFileSync(externalLog, 'external log\n');
  fs.mkdirSync(runStore.RUNS_DIR, { recursive: true });
  const activeLogLink = path.join(runStore.RUNS_DIR, 'symlink-run.log');
  if (!tryCreateSymlink(externalLog, activeLogLink)) { return; }

  assert.throws(
    () => runStore.appendRunLog(activeLogLink, 'bad\n'),
    /outside active runs directory/,
  );
  assert.equal(fs.readFileSync(externalLog, 'utf8'), 'external log\n');
});

test('run store refuses to append through symlink parent directories under active runs directory', () => {
  const externalDir = makeTempDir('kronos-external-symlink-parent-');
  fs.mkdirSync(runStore.RUNS_DIR, { recursive: true });
  const activeDirLink = path.join(runStore.RUNS_DIR, 'symlink-parent');
  if (!tryCreateSymlink(externalDir, activeDirLink, 'dir')) { return; }
  const escapedLog = path.join(activeDirLink, 'run.log');

  assert.throws(
    () => runStore.appendRunLog(escapedLog, 'bad\n'),
    /outside active runs directory/,
  );
  assert.equal(fs.existsSync(path.join(externalDir, 'run.log')), false);
});

test('run store marks runs needs-human with recovery metadata', () => {
  const run = {
    id: 'run-human',
    project: 'app',
    skill: 'implement',
    ticket: 'K-11',
    status: 'completed',
    events: [],
  };
  runStore.writeRunRecord(run);

  const updated = runStore.markRunNeedsHuman('run-human', 'manual QA required', new Date('2026-07-01T12:00:00.000Z'));
  const persisted = JSON.parse(fs.readFileSync(runStore.runRecordPath('run-human'), 'utf8'));

  assert.equal(updated.status, 'needs_human');
  assert.equal(persisted.status, 'needs_human');
  assert.equal(persisted.failureReason, 'manual QA required');
  assert.equal(persisted.failureKind, 'unknown');
  assert.equal(persisted.endedAt, '2026-07-01T12:00:00.000Z');
  assert.equal(persisted.recoveryActions[0].action, 'mark-needs-human');
  assert.equal(persisted.events[0].label, 'Marked needs human');
});

test('run store marks runs cancelled with recovery metadata', () => {
  const run = {
    id: 'run-cancelled',
    project: 'app',
    skill: 'implement',
    ticket: 'K-12',
    status: 'running',
    events: [],
  };
  runStore.writeRunRecord(run);

  const updated = runStore.markRunCancelled('run-cancelled', 'operator stopped it', new Date('2026-07-01T12:30:00.000Z'));
  const persisted = JSON.parse(fs.readFileSync(runStore.runRecordPath('run-cancelled'), 'utf8'));

  assert.equal(updated.status, 'cancelled');
  assert.equal(persisted.status, 'cancelled');
  assert.equal(persisted.failureReason, 'operator stopped it');
  assert.equal(persisted.failureKind, 'cancelled');
  assert.equal(persisted.endedAt, '2026-07-01T12:30:00.000Z');
  assert.equal(persisted.recoveryActions[0].action, 'cancel-run');
  assert.equal(persisted.events[0].label, 'Run cancelled');
});

test('run store pauses and continues runs with recovery metadata', () => {
  const run = {
    id: 'run-paused',
    project: 'app',
    skill: 'verify',
    ticket: 'K-13',
    status: 'running',
    events: [],
  };
  runStore.writeRunRecord(run);

  const paused = runStore.markRunPaused('run-paused', 'operator pause', new Date('2026-07-01T13:00:00.000Z'));
  assert.equal(paused.status, 'paused');
  assert.equal(paused.pausedAt, '2026-07-01T13:00:00.000Z');
  assert.equal(paused.recoveryActions[0].action, 'pause-run');
  assert.equal(paused.events[0].label, 'Run paused');

  const continued = runStore.markRunContinued('run-paused', 'operator continue', new Date('2026-07-01T13:15:00.000Z'));
  const persisted = JSON.parse(fs.readFileSync(runStore.runRecordPath('run-paused'), 'utf8'));
  assert.equal(continued.status, 'running');
  assert.equal(persisted.status, 'running');
  assert.equal(persisted.resumedAt, '2026-07-01T13:15:00.000Z');
  assert.equal(persisted.recoveryActions[1].action, 'continue-run');
  assert.equal(persisted.events[1].label, 'Run continued');
});

test('run store surfaces invalid records and blocks strict mutations', () => {
  const valid = { id: 'run-valid-after-corrupt-record', status: 'completed' };
  runStore.writeRunRecord(valid);
  const invalidJsonPath = runStore.runRecordPath('run-bad-json');
  const missingIdPath = path.join(runStore.RUNS_DIR, 'run-missing-id.json');
  const mismatchedIdPath = runStore.runRecordPath('run-mismatched-request');
  fs.writeFileSync(invalidJsonPath, '{ invalid json');
  fs.writeFileSync(missingIdPath, JSON.stringify({ status: 'running' }));
  fs.writeFileSync(mismatchedIdPath, JSON.stringify({ id: 'run-mismatched-other', status: 'running' }));

  const runs = runStore.repairActiveRunRecords().runs;
  const issues = runStore.listRunStoreIssues();

  assert.ok(runs.some(r => r.id === valid.id));
  assert.equal(runs.some(r => r.id === 'run-bad-json'), false);
  assert.equal(runs.some(r => r.id === 'run-mismatched-other'), false);
  assert.ok(issues.some(issue => issue.filePath === invalidJsonPath && issue.scope === 'active' && issue.kind === 'invalid_run_record'));
  assert.ok(issues.some(issue => issue.filePath === invalidJsonPath && /Unexpected token|Expected property name/.test(issue.detail)));
  assert.ok(issues.some(issue => issue.filePath === missingIdPath && /id/.test(issue.detail)));
  assert.ok(issues.some(issue => issue.filePath === mismatchedIdPath && /does not match file name/.test(issue.detail)));
  assert.throws(
    () => runStore.markRunCancelled('run-bad-json', 'operator stopped it'),
    /Invalid run record/,
  );
  assert.throws(
    () => runStore.markRunPaused('run-mismatched-request', 'operator pause'),
    /Invalid run record/,
  );
  assert.equal(fs.existsSync(runStore.runRecordPath('run-mismatched-other')), false);

  const source = readSourceFixture('src', 'services', 'runStore.ts');
  for (const marker of [
    "import { unknownErrorCode, unknownErrorMessage } from './errorUtils'",
    "import { toValidDate } from './dateValues'",
    '[key: string]: unknown',
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Unable to parse JSON.')",
    "path.basename(filePath) !== expectedFileName",
    'does not match file name',
    'const PROCESS_BACKED_ACTIVE_STATUSES',
    'function terminalRunOutcomeFromDeadProcess',
    'function terminalRunOutcomeFromStaleProcesslessRun',
    'isStaleActiveRun(run)',
    'Stale active run needs human review',
    'function processIsGone',
    "unknownErrorCode(e) === 'ESRCH'",
    'export function repairActiveRunRecords',
    'function normalizeRunView',
    'writeJsonAtomic(filePath, normalized)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    '[key: string]: any',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('dispatcher close handler preserves operator terminal run statuses', () => {
  const source = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  for (const marker of [
    'function addRunEventBestEffort',
    'function updateRunBestEffort',
    'const preservedTerminalStatus = preservedTerminalRunStatus(persisted)',
    'if (preservedTerminalStatus && persisted)',
    "preservedTerminalStatus === 'needs_human'",
    "'Session marked needs human'",
    "addRunEventBestEffort(run, finalEvent, 'Failed to persist terminal run event.')",
    "const finalStatus = preservedTerminalStatus || (code === 0 ? 'completed' : 'failed')",
    "const finalFailureReason = preservedTerminalStatus ? persisted?.failureReason",
    "updateRunBestEffort(run, finalPatch, 'Failed to persist terminal run status.')",
    "addRunEventBestEffort(run, event, 'Failed to persist worktree cleanup warning event.')",
    "const cleanupStatus = preservedTerminalStatus || (code === 0 ? 'needs_human' : 'failed')",
    "terminalStatusLabel(preservedTerminalStatus)",
    "'Failed to persist worktree cleanup blocked status.'",
    "function preservedTerminalRunStatus(run: KronosRun | null): 'cancelled' | 'needs_human' | undefined",
    "run?.status === 'cancelled' || run?.status === 'needs_human'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('dispatcher completion callback refreshes progress panel after successful mutations', () => {
  const source = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  const successCallbackBlock = /try \{\n    await opts\.onComplete\(code, run\);\n    writeRun\(run\);\n    renderProgressPanel\(context\.panel, context\.projectName, context\.skill, context\.ticket, context\.events, run\);\n    saveSession\(context\.projectName, context\.skill, context\.ticket, context\.events\);\n  \} catch/.exec(source);
  assert.ok(successCallbackBlock, 'successful post-run callback should persist and re-render mutated run state');
});

test('dispatcher marks run failed when managed worktree setup fails before launch', async () => {
  fs.rmSync(runStore.RUNS_DIR, { recursive: true, force: true });
  const projectPath = makeTempProject();
  const credentialsDir = makeTempDir('kronos-gcloud-creds-');
  const credentialsPath = path.join(credentialsDir, 'application-default.json');
  fs.writeFileSync(credentialsPath, '{}\n');
  const previousCredentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

  const vscodeStub = createVscodeTestModule();
  const gitWorkspaceStub = {
    ...gitWorkspace,
    currentGitRef: () => 'main',
    currentGitCommit: () => 'abc123',
    prepareManagedWorktree() {
      throw new Error('git worktree add timed out');
    },
  };
  const completionCalls = [];

  try {
    await withPatchedModuleLoad(request => {
      if (request === 'vscode') {
        return vscodeStub.vscode;
      }
      if (
        request === '../services/gitWorkspace' ||
        request.endsWith('/services/gitWorkspace') ||
        request.endsWith('\\services\\gitWorkspace')
      ) {
        return gitWorkspaceStub;
      }
      return undefined;
    }, async () => {
      const dispatcherPath = require.resolve('../out/runners/sessionDispatcher.js');
      delete require.cache[dispatcherPath];
      const dispatcher = require(dispatcherPath);
      const result = await dispatcher.dispatchClaudeSession(projectPath, 'implement', 'K-WT-FAIL', {
        parallel: true,
        onComplete: (code, run) => {
          completionCalls.push({ code, status: run.status, failureReason: run.failureReason });
        },
      });

      assert.equal(result.launched, false);
      assert.equal(typeof result.runId, 'string');
      assert.equal(result.status, 'failed');
      assert.match(result.failureReason, /Git worktree setup failed: git worktree add timed out/);

      const runRecords = fs.readdirSync(runStore.RUNS_DIR).filter(name => name.endsWith('.json'));
      assert.equal(runRecords.length, 1);
      const run = runStore.readRunRecord(result.runId);
      assert.ok(run);
      assert.equal(run.status, 'failed');
      assert.equal(run.exitCode, 1);
      assert.equal(run.failureKind, 'git');
      assert.ok(run.endedAt);
      assert.match(run.failureReason, /Git worktree setup failed: git worktree add timed out/);
      assert.ok(run.events.some(event => event.label === 'Git worktree setup failed'));
      assert.equal(completionCalls.length, 1);
      assert.deepEqual(completionCalls[0], {
        code: 1,
        status: 'failed',
        failureReason: run.failureReason,
      });
      assert.equal(worktreeRegistry.loadActiveWorktreeRegistry().entries.length, 0);
    });
  } finally {
    if (previousCredentials === undefined) {
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    } else {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = previousCredentials;
    }
  }
});

test('dispatcher parses every assistant content block for progress metrics', async () => {
  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => request === 'vscode' ? vscodeStub.vscode : undefined, async () => {
    const dispatcherPath = require.resolve('../out/runners/sessionDispatcher.js');
    delete require.cache[dispatcherPath];
    const dispatcher = require(dispatcherPath);
    const payload = {
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', name: 'Read', input: { file_path: 'src/app.ts' } },
          { type: 'tool_use', name: 'Edit', input: { file_path: 'src/run.ts', old_string: 'const oldValue = true;' } },
          { type: 'thinking', thinking: 'checking the live run state before patching' },
          { type: 'text', text: 'Queued the next validation step.' },
        ],
      },
    };

    const events = dispatcher.parseStreamEvents(payload);
    assert.deepEqual(events.map(event => event.type), ['tool', 'tool', 'thinking', 'text']);
    assert.deepEqual(events.map(event => event.label), [
      'Reading src/app.ts',
      'Editing src/run.ts',
      'checking the live run state before patching',
      'Queued the next validation step.',
    ]);
    assert.equal(events[0].label, 'Reading src/app.ts');
    const progress = runProgress.runProgressSummary({ events });
    assert.equal(progress.toolCalls, 2);
    assert.equal(progress.toolErrors, 0);
    assert.equal(progress.filesRead, 1);
    assert.equal(progress.filesChanged, 1);
    assert.equal(progress.elapsedSeconds, 0);
  });
});

test('dispatcher treats post-completion errors as attention outcomes', async () => {
  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => request === 'vscode' ? vscodeStub.vscode : undefined, async () => {
    const dispatcherPath = require.resolve('../out/runners/sessionDispatcher.js');
    delete require.cache[dispatcherPath];
    const dispatcher = require(dispatcherPath);
    const doneThenError = [
      { type: 'text', label: 'Starting', detail: '', timestamp: new Date('2026-07-01T10:00:00.000Z') },
      { type: 'done', label: 'Complete - 2.0s', detail: 'Implemented', timestamp: new Date('2026-07-01T10:00:02.000Z') },
      { type: 'error', label: 'Post-run completion callback failed', detail: 'Evidence write failed', timestamp: new Date('2026-07-01T10:00:03.000Z') },
    ];
    const errorThenDone = [
      { type: 'error', label: 'Retryable parse error', detail: '', timestamp: new Date('2026-07-01T10:00:01.000Z') },
      { type: 'done', label: 'Complete - 2.0s', detail: 'Implemented', timestamp: new Date('2026-07-01T10:00:02.000Z') },
    ];

    assert.equal(dispatcher.computeStats(doneThenError).verdict, 'error');
    assert.equal(dispatcher.computeStats(errorThenDone).verdict, 'success');
    assert.deepEqual(dispatcher.progressStatusPresentation(doneThenError), {
      isDone: true,
      statusColor: '#f44336',
      statusText: 'Error',
    });
    assert.deepEqual(dispatcher.progressStatusPresentation(doneThenError, { status: 'needs_human' }), {
      isDone: true,
      statusColor: '#f44336',
      statusText: 'Needs Attention',
    });
    assert.deepEqual(dispatcher.progressStatusPresentation(errorThenDone), {
      isDone: true,
      statusColor: '#4caf50',
      statusText: 'Complete',
    });
  });
});

test('dispatcher records branch and permission metadata for persisted runs', () => {
  const source = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  for (const marker of [
    'branch?: RunBranchMetadata',
    'permissions?: RunPermissionMetadata',
    'interface RunBranchMetadata',
    'interface RunPermissionMetadata',
    'projectBaseBranch?: string',
    'projectBaseSource?: string',
    'projectBaseWarning?: string',
    'function buildRunPermissionMetadata',
    'function buildRunBranchMetadata',
    'permissions: buildRunPermissionMetadata([\'~/.claude\'])',
    'const permissions = buildRunPermissionMetadata(addDirs)',
    'const branch = buildRunBranchMetadata({',
    'permissionSummary',
    'branchSummary',
    'function configuredDefaultBaseBranch',
    'resolveDefaultBaseBranch',
    'function configuredStateBaseBranch',
    'function configuredProjectJsonBaseBranch',
    'Could not fully resolve project base branch config',
    'function configuredProjectExtraDirs',
    'const state = readStateFile()',
    'Could not read project extra_dirs',
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
    "const failureDetail = unknownErrorMessage(e, 'Git worktree setup failed.')",
    "vscode.window.showWarningMessage('Git worktree setup failed; run marked failed before launch.')",
    "label: 'Git worktree setup failed'",
    "failureKind: 'git'",
    'type ClaudeProcess = ReturnType<typeof spawn>',
    'let proc: ClaudeProcess',
    '}) as ClaudeProcess',
    "const failureDetail = unknownErrorMessage(e, 'Failed to launch Claude CLI.')",
    "label: 'Failed to launch Claude CLI'",
    "from '../services/sessionStore'",
    "type PostRunReadiness",
    'readiness?: PostRunReadiness',
    "import { unknownErrorMessage } from '../services/errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Could not read Kronos state for base branch.')",
    "unknownErrorMessage(e, 'Invalid JSON')",
    "unknownErrorMessage(e, 'Failed to read Kronos state.')",
    "unknownErrorMessage(e, 'Invalid dispatch model.')",
    "unknownErrorMessage(e, 'Failed to parse Claude stream event.')",
    "label: 'Failed to parse Claude stream event'",
    'export function computeStats(events: ProgressEvent[]): SessionStats',
    'function lastProgressTerminalEvent(events: ProgressEvent[]): ProgressEvent | undefined',
    'writeSavedSession(session)',
    'export { getAggregateStats, listSavedSessions, listSessionStoreIssues }',
    'const id = safeSessionId',
    "from '../services/webviewSecurity'",
    "import { isFreshActiveRun } from '../services/runStatus'",
    "import { runProgressSummary } from '../services/runProgress'",
    "import { isAttentionRunStatus, runAttentionDetail } from '../services/runAttention'",
    'createWebviewNonce',
    'webviewScriptCspOptions',
    'WEBVIEW_ACTION_PANEL_SCRIPT',
    'webviewActionScriptTag',
    'webviewScriptCspOptions(panel.webview.cspSource, nonce)',
    "const nonce = interactive ? createWebviewNonce() : ''",
    "webviewActionScriptTag(nonce, 'Kronos Run Center', [",
    "{ messageKey: 'runId', dataAttribute: 'data-run-id' }",
    'extensionUri?: vscode.Uri | undefined',
    'localResourceRoots: [vscode.Uri.joinPath(options.extensionUri,',
    "'refreshPanel'",
    "'archiveFinishedRuns'",
    'pollIntervalMs?: number',
    'const pollTimer = setInterval',
    'panel.onDidDispose(() => clearInterval(pollTimer))',
    "import { toValidDate } from '../services/dateValues'",
    'function progressDateOr',
    'function progressEventTimeLabel',
    'function progressDateTimeLabel',
    'function stringOrDefault',
    "import { isRecord } from '../services/records'",
    'function recordField(record: Record<string, unknown>, key: string): Record<string, unknown>',
    'function arrayField(record: Record<string, unknown>, key: string): unknown[]',
    'function streamString(value: unknown): string',
    'export function parseStreamEvents(event: unknown): ProgressEvent[]',
    'function parseAssistantContentBlock(rawBlock: unknown, now: Date): ProgressEvent | null',
    'const payload = isRecord(event) ? event : {}',
    "arrayField(message, 'content')",
    'for (const pe of parseStreamEvents(JSON.parse(trimmed)))',
    "export function progressStatusPresentation(events: ProgressEvent[], run?: Pick<KronosRun, 'status'>)",
    'const statusPresentation = progressStatusPresentation(events, run)',
    "statusText: 'Needs Attention'",
    'const sessionStart = progressDateOr(session.startedAt, new Date())',
    'timestamp: progressDateOr(e.timestamp, sessionStart)',
    'const progress = runProgressSummary({ events })',
    'durationSec: progress.elapsedSeconds',
    'Duration: ${progress.elapsedSeconds}s',
    'const statusClass = escapeClass(status)',
    'const started = progressDateTimeLabel(run.startedAt)',
    'const runEvents = Array.isArray(run.events) ? run.events : []',
    'const progress = runProgressSummary(run)',
    "export type { RunCenterActionRequest } from '../services/webviewMessages'",
    "import { normalizeRunCenterMessage, type RunCenterActionRequest } from '../services/webviewMessages'",
    'const RUN_CENTER_MESSAGE_COMMANDS = new Set',
    'const RUN_CENTER_RUNLESS_MESSAGE_COMMANDS = new Set',
    'normalizeRunCenterMessage(msg, RUN_CENTER_MESSAGE_COMMANDS, RUN_CENTER_RUNLESS_MESSAGE_COMMANDS)',
    "import { createWebviewReadyMonitor } from '../services/webviewDiagnostics'",
    "const logReady = interactive ? createWebviewReadyMonitor(panel, 'Kronos Run Center') : undefined",
    'logReady?.arm()',
    'if (logReady?.(msg)) { return; }',
    'function runCenterActionButtons',
    "runCenterActionButton('refreshPanel', 'Refresh')",
    "runCenterActionButton('archiveFinishedRuns', 'Archive Finished')",
    'webviewActionScriptTag',
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
    "runCenterActionButton('cancelRun', 'Stop'",
    'panel.webview.onDidReceiveMessage(async msg =>',
    'buildRunCenterHtml(runs, interactive ? nonce : undefined, actionScriptUri, options.focusRunId)',
    'const interactive = Boolean(nonce)',
    '<th>Progress</th>',
    'class="progress-cell"',
    "const actionHeader = interactive ? '<th>Actions</th>' : ''",
    'const actionCell = interactive ?',
    'const promptMeta = isRecord(run.promptMetadata) ? run.promptMetadata : undefined',
    '${escapeClass(readinessStatus)}',
    "stringOrDefault(run.worktreePath || run.cwd, 'unknown workspace')",
    "const id = safeFileStem(`${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`, { fallback: 'run', maxLength: 160 })",
    "safeFileStem(ticket || skill, { fallback: 'worktree', maxLength: 80 })",
    'onComplete?: (code: number, run: KronosRun) => void | Promise<void>',
    'async function runCompletionCallback',
    'await opts.onComplete(code, run)',
    "unknownErrorMessage(e, 'Post-run completion callback failed.')",
    "label: 'Post-run completion callback failed'",
    "addRunEventBestEffort(run, event, 'Failed to persist post-run callback failure event.')",
    "'Failed to persist post-run callback failure status.'",
    'function renderProgressPanel(panel: vscode.WebviewPanel, project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun): void',
    'renderProgressPanel(context.panel, context.projectName, context.skill, context.ticket, context.events, run)',
    "function buildProgressHtml(project: string, skill: string, ticket: string, events: ProgressEvent[], run?: KronosRun)",
    'const attentionDetail = run && isAttentionRunStatus(run.status) ? runAttentionDetail(run) :',
    'attention-banner',
    '<strong>Needs Attention</strong>',
    "renderProgressPanel(panel, projectName, skill, ticket || '', events, run)",
    "label: 'Managed worktree pull skipped'",
    'updateRun(run, { warnings: [...(run.warnings || []), warning] })',
    'await runCompletionCallback(opts, code ?? 1, run',
    "repairActiveRunRecords(100).runs as KronosRun[]",
    'function backfillRunReadiness(runs: KronosRun[]): KronosRun[]',
    'evaluatePostRunReadiness',
    'postRunReadinessRunPatch(run, readiness)',
    'resolvePostRunTicket',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'export interface RunBranchMetadata',
    'export interface RunPermissionMetadata',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }

  assert.equal(
    source.includes("fs.readFileSync(path.join(KRONOS_DIR, 'state.json')"),
    false,
    'dispatcher should not bypass validated stateStore reads for project config',
  );
  assert.equal(
    source.includes("get<string>('defaultBaseBranch', 'develop')"),
    false,
    'dispatcher should use profile-aware default base branch resolution',
  );
  assert.equal(
    source.includes("const id = `${project}-${skill}-${ticket || 'no-ticket'}-${Date.now().toString(36)}`;"),
    false,
    'saved session filenames should be sanitized before path.join',
  );
  assert.equal(
    source.includes('const statusClass = escapeHtml(run.status)'),
    false,
    'run center CSS classes should use escapeClass, not escapeHtml',
  );
  assert.equal(
    source.includes('Could not create worktree; running in main repo'),
    false,
    'worktree setup failures should fail the run instead of launching in the main repo',
  );
  assert.equal(
    source.includes('new Date(run.startedAt).toLocaleString()'),
    false,
    'run center should render invalid timestamps with a safe fallback',
  );
  assert.equal(
    source.includes("randomBytes(16).toString('base64')"),
    false,
    'Run Center webview nonce should use hex helper, not base64',
  );
  assert.equal(
    source.includes('function webviewScriptCsp('),
    false,
    'dispatcher webview CSP options should come from the shared webview security helper',
  );
  assert.equal(
    source.includes('run.events[run.events.length - 1]'),
    false,
    'run center should tolerate missing or malformed run.events',
  );
  assert.equal(
    source.includes('catch (e: any)'),
    false,
    'dispatcher should keep caught errors unknown until normalized',
  );
  assert.equal(
    source.includes('} catch {}'),
    false,
    'dispatcher should not silently swallow run stream failures',
  );
  assert.equal(
    source.includes('e?.message'),
    false,
    'dispatcher should normalize unknown error messages through errorUtils',
  );
  assert.equal(
    source.includes('parseStreamEvent(event: any)'),
    false,
    'dispatcher should parse stream events from unknown payloads',
  );
  assert.equal(
    source.includes('export function parseStreamEvent('),
    false,
    'dispatcher should not keep an unused single-event parser wrapper',
  );
  assert.equal(
    source.includes('value is Record<string, any>'),
    false,
    'dispatcher record guards should preserve unknown field types',
  );
  assert.equal(
    source.includes('readiness?: any'),
    false,
    'dispatcher should type run readiness with the post-run readiness contract',
  );
  assert.equal(
    source.includes('if (opts.onComplete) { opts.onComplete'),
    false,
    'completion callbacks should be routed through runCompletionCallback',
  );
  assert.equal(
    source.includes("target.closest('[data-action][data-run-id]')"),
    false,
    'Run Center script should allow panel-level actions without a run id',
  );

  assert.ok(
    source.indexOf('permissions: buildRunPermissionMetadata([\'~/.claude\'])') < source.indexOf('const authed = await ensureAuth()'),
    'default permissions should be persisted before auth preflight',
  );
  assert.ok(
    source.indexOf('const permissions = buildRunPermissionMetadata(addDirs)') < source.indexOf('proc = spawn(CLAUDE_PATH'),
    'final permissions should be persisted before process launch',
  );
  assert.ok(
    source.indexOf('trackWorktree(projectPath, wtDir, ticket || skill);') < source.indexOf('const prepared = prepareManagedWorktree({'),
    'managed worktrees should be registered before git setup so partial setup failures remain recoverable',
  );
});

test('dispatcher lists saved sessions newest first by startedAt', () => {
  const sessionsDir = path.join(process.env.KRONOS_DIR, 'sessions');
  fs.rmSync(sessionsDir, { recursive: true, force: true });
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, 'zzz-old.json'), JSON.stringify({
    id: 'zzz-old',
    project: 'zeta',
    skill: 'verify',
    ticket: 'K-1',
    startedAt: '2026-07-01T10:00:00.000Z',
    events: [],
    stats: {},
  }));
  fs.writeFileSync(path.join(sessionsDir, 'aaa-new.json'), `\ufeff${JSON.stringify({
    id: 'aaa-new',
    project: 'alpha',
    skill: 'implement',
    ticket: 'K-2',
    startedAt: '2026-07-01T12:00:00.000Z',
    events: [
      null,
      'bad',
      { type: ' done ', label: ' Complete ', detail: ' ok ', timestamp: ' 2026-07-01T12:01:00.000Z ' },
      { type: 42, label: null, detail: undefined, timestamp: '' },
    ],
    stats: {},
  })}`);
  fs.mkdirSync(path.join(sessionsDir, 'folder.json'));
  const malformedSessionPath = path.join(sessionsDir, 'bad-json.json');
  fs.writeFileSync(malformedSessionPath, '{ bad json');

  const sessions = sessionStore.listSavedSessions();
  const issues = sessionStore.listSessionStoreIssues();

  assert.deepEqual(sessions.map(session => session.id), ['aaa-new', 'zzz-old']);
  assert.deepEqual(sessions[0].events, [
    { type: 'done', label: 'Complete', detail: 'ok', timestamp: '2026-07-01T12:01:00.000Z' },
    { type: 'unknown', label: '', detail: '', timestamp: '' },
  ]);
  assert.ok(issues.some(issue => issue.kind === 'invalid_saved_session' && issue.filePath === malformedSessionPath));
  assert.ok(issues.some(issue => issue.kind === 'invalid_saved_session' && /Unexpected token|Expected property name/.test(issue.detail)));
});

test('session store normalizes aggregate stats rows for rendering', () => {
  const statsPath = path.join(process.env.KRONOS_DIR, 'stats.json');
  fs.writeFileSync(statsPath, `\ufeff${JSON.stringify({
    sessions: [
      null,
      'bad',
      {
        id: ' run-1 ',
        project: ' app ',
        skill: ' implement ',
        ticket: ' K-1 ',
        startedAt: ' 2026-07-01T10:00:00.000Z ',
        toolCalls: '7',
        toolErrors: 'bad',
        thinkingCount: 2,
        filesRead: 3,
        filesEdited: '4',
        durationSec: 91.7,
        verdict: ' success ',
      },
      { id: 42, project: null, skill: '', ticket: undefined, startedAt: '', toolCalls: Infinity, verdict: 12 },
    ],
    lastUpdated: 42,
  })}`);

  assert.deepEqual(sessionStore.getAggregateStats(), {
    sessions: [
      {
        id: 'run-1',
        project: 'app',
        skill: 'implement',
        ticket: 'K-1',
        startedAt: '2026-07-01T10:00:00.000Z',
        toolCalls: 7,
        toolErrors: 0,
        thinkingCount: 2,
        filesRead: 3,
        filesEdited: 4,
        durationSec: 91.7,
        verdict: 'success',
      },
      {
        id: 'unknown',
        project: 'unknown',
        skill: 'unknown',
        ticket: '',
        startedAt: '',
        toolCalls: 0,
        toolErrors: 0,
        thinkingCount: 0,
        filesRead: 0,
        filesEdited: 0,
        durationSec: 0,
        verdict: 'unknown',
      },
    ],
  });

  fs.writeFileSync(statsPath, JSON.stringify({ sessions: 'bad' }));
  assert.deepEqual(sessionStore.getAggregateStats(), { sessions: [] });
  assert.ok(sessionStore.listSessionStoreIssues().some(issue => issue.kind === 'invalid_session_stats'));

  fs.writeFileSync(statsPath, '{ bad stats');
  assert.deepEqual(sessionStore.getAggregateStats(), { sessions: [] });
  assert.ok(sessionStore.listSessionStoreIssues().some(issue => issue.kind === 'invalid_session_stats' && /Unexpected token|Expected property name/.test(issue.detail)));

  const source = readSourceFixture('src', 'services', 'sessionStore.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Unable to parse saved session JSON.')",
    "unknownErrorMessage(e, 'Unable to parse stats.json.')",
    'stats.sessions = stats.sessions.filter(existing => existing.id !== aggregateSession.id)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('session store updates aggregate stats idempotently for rewritten sessions', () => {
  const statsPath = path.join(process.env.KRONOS_DIR, 'stats.json');
  fs.rmSync(statsPath, { force: true });

  sessionStore.writeSavedSession({
    id: 'same-session',
    project: 'app',
    skill: 'implement',
    ticket: 'K-1',
    startedAt: '2026-07-01T10:00:00.000Z',
    events: [],
    stats: {
      toolCalls: 1,
      toolErrors: 0,
      thinkingCount: 0,
      filesRead: 1,
      filesEdited: 0,
      durationSec: 30,
      verdict: 'unknown',
    },
  });
  sessionStore.writeSavedSession({
    id: 'same-session',
    project: 'app',
    skill: 'implement',
    ticket: 'K-1',
    startedAt: '2026-07-01T10:00:00.000Z',
    events: [],
    stats: {
      toolCalls: 3,
      toolErrors: 1,
      thinkingCount: 2,
      filesRead: 4,
      filesEdited: 2,
      durationSec: 90,
      verdict: 'success',
    },
  });

  assert.deepEqual(sessionStore.getAggregateStats().sessions, [{
    id: 'same-session',
    project: 'app',
    skill: 'implement',
    ticket: 'K-1',
    startedAt: '2026-07-01T10:00:00.000Z',
    toolCalls: 3,
    toolErrors: 1,
    thinkingCount: 2,
    filesRead: 4,
    filesEdited: 2,
    durationSec: 90,
    verdict: 'success',
  }]);
});

test('run recovery builds resume prompts from saved prompt and log tail', () => {
  const logPath = path.join(makeTempDir('kronos-run-log-'), 'run.log');
  fs.writeFileSync(logPath, `${'x'.repeat(40)}\nrecent failure line\n`);

  const logTail = runRecovery.readRunLogTail(logPath, 24);
  const prompt = runRecovery.buildRunResumePrompt({
    id: 'run-7',
    project: 'app',
    skill: 'implement',
    ticket: 'K-12',
    status: 'failed',
    failureReason: 'unit test failed',
    cwd: '/repo/app',
    promptHash: 'abc123',
  }, 'Original task text', logTail);

  assert.ok(logTail.includes('recent failure line'));
  assert.equal(logTail.includes('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), false);
  assert.match(prompt, /Resume Kronos run run-7/);
  assert.match(prompt, /unit test failed/);
  assert.match(prompt, /Original task text/);
  assert.match(prompt, /recent failure line/);
});

test('run attention summarizes actionable failure reasons', () => {
  const buildFailure = runAttention.runAttentionDetail({
    id: 'run-9',
    status: 'needs_human',
    skill: 'fix_build',
    events: [
      { label: 'Session started', detail: 'Working' },
      { label: 'Process exited with code 1', detail: 'Jenkins build failed' },
    ],
  });
  assert.match(buildFailure, /Jenkins build failed/);
  assert.notEqual(buildFailure, 'Run status is needs human');

  const genericBuildFailure = runAttention.runAttentionDetail({
    status: 'failed',
    skill: 'fix_build',
    failureReason: 'Process exited with code 1',
  });
  assert.match(genericBuildFailure, /Build failed/);
  assert.match(genericBuildFailure, /Process exited with code 1/);

  const authFailure = runAttention.runAttentionDetail({
    status: 'needs_human',
    failureKind: 'auth',
  });
  assert.equal(authFailure, 'Auth or credential issue');
  assert.equal(runAttention.isAttentionRunStatus('failed'), true);
  assert.equal(runAttention.isAttentionRunStatus('needs_human'), true);
  assert.equal(runAttention.isAttentionRunStatus('cancelled'), true);
  assert.equal(runAttention.isAttentionRunStatus('completed'), false);
  assert.equal(runAttention.runAttentionLine({
    status: 'failed',
    failureReason: 'First line\nSecond line',
  }), 'Run failed: First line Second line');
  assert.equal(runAttention.runAttentionLine({
    status: 'failed',
    failureReason: 'x'.repeat(200),
  }, 20), 'Run failed: xxxxx...');
});

test('run completion notifications route review-ready and attention outcomes', () => {
  const withMr = runCompletionNotification.buildRunCompletionNotification(
    'K-1',
    ticket({ mr: { iid: 17, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/17' } }),
    { status: 'waiting_for_review', skill: 'implement' },
  );
  assert.deepEqual(withMr, {
    kind: 'review_ready',
    severity: 'info',
    message: 'K-1 implement completed - MR !17 ready for review.',
    actions: ['Open Review', 'Run Center'],
    reviewTarget: 'mr',
  });

  const withoutMr = runCompletionNotification.buildRunCompletionNotification(
    'K-2',
    ticket({ mr: null }),
    { status: 'waiting_for_review', skill: 'verify-local' },
  );
  assert.deepEqual(withoutMr, {
    kind: 'review_ready',
    severity: 'info',
    message: 'K-2 verify-local completed - ready for review.',
    actions: ['Open Review', 'Run Center'],
    reviewTarget: 'ticket',
  });

  const needsHuman = runCompletionNotification.buildRunCompletionNotification(
    'K-3',
    ticket({}),
    { status: 'needs_human', skill: 'implement', failureReason: 'Build failed in Jenkins' },
  );
  assert.equal(needsHuman.kind, 'attention');
  assert.equal(needsHuman.severity, 'warning');
  assert.match(needsHuman.message, /K-3 implement needs human - Build failed/);
  assert.deepEqual(needsHuman.actions, ['Run Center']);

  assert.equal(runCompletionNotification.buildRunCompletionNotification(
    'K-4',
    ticket({}),
    { status: 'completed', skill: 'verify-local' },
  ), null);
});

test('recovery center prioritizes failed runs, unsafe worktrees, doctor failures, and backups', () => {
  const inventory = recoveryCenter.buildRecoveryInventory({
    now: new Date('2026-07-01T12:00:00.000Z'),
    staleRunMs: 60 * 60 * 1000,
    runs: [
      {
        id: 'failed-run',
        project: 'app',
        skill: 'fix_build',
        ticket: 'K-1',
        status: 'failed',
        events: [{ label: 'Process exited with code 1', detail: 'Jenkins build failed' }],
        logPath: '/tmp/run.log',
        promptPath: '/tmp/prompt.txt',
      },
      {
        id: 'stale-run',
        project: 'app',
        skill: 'verify',
        status: 'running',
        startedAt: '2026-07-01T09:00:00.000Z',
      },
      {
        id: 'ok-run',
        status: 'completed',
      },
    ],
    tickets: {
      'MR-7': ticket({
        source: 'adhoc',
        summary: 'Unlinked checkout MR',
        mr: { iid: 7, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/7' },
      }),
      'K-OK': ticket({
        source: 'jira',
        summary: 'Linked MR',
        mr: { iid: 8, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/mr/8' },
      }),
    },
    worktreeReport: {
      results: [
        {
          status: 'blocked',
          reason: 'Dirty worktree',
          entry: {
            projectPath: '/repo/app',
            worktreePath: '/repo/app/.claude/worktrees/dirty',
            ticket: 'K-2',
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        },
        {
          status: 'removable',
          reason: 'Clean worktree',
          entry: {
            projectPath: '/repo/app',
            worktreePath: '/repo/app/.claude/worktrees/clean',
            ticket: 'K-3',
            createdAt: '2026-07-01T10:00:00.000Z',
          },
        },
      ],
      removable: 1,
      removed: 0,
      blocked: 1,
    },
    doctorChecks: [
      { name: 'GitLab API', status: 'fail', detail: 'missing token' },
      { name: 'Prompt templates', status: 'warn', detail: '1 missing' },
      { name: 'Git', status: 'pass', detail: 'ok' },
    ],
    backups: [
      {
        filePath: '/tmp/state.json.bak',
        targetName: 'state.json',
        createdAt: '2026-07-01T11:00:00.000Z',
        size: 128,
      },
    ],
  });

  assert.equal(inventory.summary.critical, 2);
  assert.equal(inventory.summary.warning, 4);
  assert.equal(inventory.summary.info, 2);
  assert.equal(inventory.summary.total, 8);
  assert.equal(inventory.items[0].severity, 'critical');
  const failedRunItem = inventory.items.find(item => item.id === 'run:failed-run');
  assert.ok(failedRunItem);
  assert.equal(failedRunItem.action, 'resumeRun');
  assert.deepEqual(failedRunItem.secondaryActions.map(action => action.action), ['openRunLog', 'openRunPrompt', 'retryRun', 'archiveRun']);
  assert.equal(recoveryCenter.resolveRecoveryActionForRequest(failedRunItem), 'resumeRun');
  assert.equal(recoveryCenter.resolveRecoveryActionForRequest(failedRunItem, 'openRunLog'), 'openRunLog');
  assert.equal(recoveryCenter.resolveRecoveryActionForRequest(failedRunItem, 'missing'), undefined);
  assert.ok(inventory.items.some(item => item.id === 'run:failed-run' && item.detail === 'Jenkins build failed'));
  assert.ok(inventory.items.some(item => item.id === 'mr:MR-7:7' && item.action === 'linkMrToTicket' && item.ticketKey === 'MR-7'));
  assert.ok(inventory.items.some(item => item.id === 'run:stale-run' && item.title.includes('may be abandoned')));
  assert.ok(inventory.items.some(item => item.id === 'worktree:/repo/app/.claude/worktrees/dirty' && item.detail.includes('/repo/app/.claude/worktrees/dirty')));
  assert.ok(inventory.items.some(item => item.kind === 'backup' && item.action === 'restoreBackup'));
});

test('recovery panel view renders escaped recovery and state audit rows', () => {
  const recoveryHtml = recoveryPanelView.buildRecoveryHtml({
    generatedAt: '2026-07-01T12:00:00.000Z',
    summary: { critical: 1, warning: 0, info: 0, total: 1 },
    items: [
      {
        id: 'item-1',
        kind: 'run',
        severity: 'critical',
        title: 'Broken <run>',
        detail: 'Needs & review',
        action: 'resumeRun',
        secondaryActions: [
          { action: 'openRunLog', label: 'Log' },
          { action: 'openRunPrompt', label: 'Prompt' },
          { action: 'retryRun', label: 'Retry' },
          { action: 'archiveRun', label: 'Archive' },
        ],
        runId: 'run-1',
        ticketKey: 'K-1',
      },
    ],
  }, 'nonce-1', 'run-1', ACTION_SCRIPT_URI);
  assert.ok(recoveryHtml.includes('Kronos Recovery Center'));
  assert.ok(recoveryHtml.includes('focused on run-1'));
  assert.ok(recoveryHtml.includes('focused-recovery-item'));
  assert.ok(recoveryHtml.includes('data-action="refreshPanel"'));
  assert.ok(recoveryHtml.includes('data-focused-item="true"'));
  assert.ok(recoveryHtml.includes('data-item-id="item-1"'));
  assert.ok(recoveryHtml.includes('data-run-id="run-1"'));
  assert.ok(recoveryHtml.includes('Broken &lt;run&gt;'));
  assert.ok(recoveryHtml.includes('Needs &amp; review'));
  assert.ok(recoveryHtml.includes('data-action="executeRecoveryItem"'));
  assert.ok(recoveryHtml.includes('data-item-id="item-1"'));
  assert.ok(recoveryHtml.includes('data-recovery-action="resumeRun"'));
  assert.ok(recoveryHtml.includes('data-recovery-action="openRunLog"'));
  assert.ok(recoveryHtml.includes('data-recovery-action="openRunPrompt"'));
  assert.ok(recoveryHtml.includes('data-recovery-action="retryRun"'));
  assert.ok(recoveryHtml.includes('data-recovery-action="archiveRun"'));
  const worktreeRecoveryHtml = recoveryPanelView.buildRecoveryHtml({
    generatedAt: '2026-07-01T12:00:00.000Z',
    summary: { critical: 0, warning: 1, info: 0, total: 1 },
    items: [{
      id: 'worktree:/repo/app/.claude/worktrees/K-2',
      kind: 'worktree',
      severity: 'warning',
      title: 'K-2 worktree needs manual review',
      detail: '/repo/app/.claude/worktrees/K-2\nDirty worktree',
      action: 'cleanupWorktrees',
      worktreePath: '/repo/app/.claude/worktrees/K-2',
    }],
  }, 'nonce-worktree', 'worktree:/repo/app/.claude/worktrees/K-2', ACTION_SCRIPT_URI);
  assert.ok(worktreeRecoveryHtml.includes('focused on worktree:/repo/app/.claude/worktrees/K-2'));
  assert.ok(worktreeRecoveryHtml.includes('data-focused-item="true"'));
  assert.ok(worktreeRecoveryHtml.includes('data-worktree-path="/repo/app/.claude/worktrees/K-2"'));
  assert.ok(recoveryHtml.includes('Resume Run'));
  assert.ok(recoveryHtml.includes('Log'));
  assert.ok(recoveryHtml.includes('Prompt'));
  assert.ok(recoveryHtml.includes('Retry'));
  assert.ok(recoveryHtml.includes('Archive'));
  const externalRecoveryHtml = recoveryPanelView.buildRecoveryHtml({
    generatedAt: '2026-07-01T12:00:00.000Z',
    summary: { critical: 0, warning: 0, info: 0, total: 0 },
    items: [],
  }, 'nonce-ext', undefined, ACTION_SCRIPT_URI);
  assert.match(externalRecoveryHtml, /src="vscode-resource:\/\/kronos\/action-panel\.js"/);
  assert.ok(externalRecoveryHtml.includes('data-kronos-webview-name="Kronos Recovery Center"'));

  const auditHtml = recoveryPanelView.buildStateAuditLogHtml([
    {
      at: '2026-07-01T12:00:00.000Z',
      action: 'restore<backup>',
      target: 'state.json',
      backup: null,
      note: '<unsafe>',
    },
  ], '/tmp/audit<log>.jsonl', 'nonce-2', ACTION_SCRIPT_URI);
  assert.ok(auditHtml.includes('Kronos State Audit Log'));
  assert.ok(auditHtml.includes('/tmp/audit&lt;log&gt;.jsonl'));
  assert.ok(auditHtml.includes('restore&lt;backup&gt;'));
  assert.ok(auditHtml.includes('note: &lt;unsafe&gt;'));
  assert.ok(auditHtml.includes('none'));
});

test('recovery center surfaces invalid run store records', () => {
  const inventory = recoveryCenter.buildRecoveryInventory({
    now: new Date('2026-07-01T12:00:00.000Z'),
    runStoreIssues: [
      {
        kind: 'invalid_run_record',
        scope: 'active',
        filePath: '/tmp/kronos/runs/bad.json',
        detail: 'Unexpected token',
      },
      {
        kind: 'invalid_run_record',
        scope: 'archived',
        filePath: '/tmp/kronos/runs/archive/old.json',
        detail: 'Run record id must be a non-empty string.',
      },
    ],
  });

  assert.equal(inventory.summary.critical, 1);
  assert.equal(inventory.summary.warning, 1);
  assert.ok(inventory.items.some(item =>
    item.id === 'run-store:active:/tmp/kronos/runs/bad.json' &&
    item.kind === 'run' &&
    item.action === 'openRunCenter' &&
    item.title === 'Invalid active run record',
  ));
  assert.ok(inventory.items.some(item =>
    item.id === 'run-store:archived:/tmp/kronos/runs/archive/old.json' &&
    item.title === 'Invalid archived run record',
  ));
});

test('recovery center surfaces invalid worktree registry state', () => {
  const inventory = recoveryCenter.buildRecoveryInventory({
    worktreeReport: {
      results: [],
      removable: 0,
      removed: 0,
      blocked: 0,
      registryPath: '/tmp/kronos/active-worktrees.json',
      registryIssue: 'active-worktrees.json must be an array.',
    },
  });

  assert.equal(inventory.summary.critical, 1);
  assert.ok(inventory.items.some(item =>
    item.id === 'worktree-registry:/tmp/kronos/active-worktrees.json' &&
    item.kind === 'worktree' &&
    item.action === 'cleanupWorktrees' &&
    item.title === 'Active worktree registry needs manual review',
  ));
});

test('ticket timeline combines queue, runs, evidence, MR, build, and ticket events newest first', () => {
  const t = ticket({
    summary: 'Wire audit trail',
    jira_status: 'In Progress',
    updated: '2026-07-01T10:00:00.000Z',
    last_action: 'verify-local',
    last_action_at: '2026-07-01T09:00:00.000Z',
    next_action: 'fix_build',
    jira_url: 'https://jira.example/K-44',
    mr: { iid: 44, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/44' },
    build: { number: 12, status: 'FAILURE', url: 'https://jenkins.example/12' },
    evidence: {
      notes: [
        null,
        'bad note',
        { at: '2026-07-01T11:00:00.000Z', kind: 'test', text: 'npm test failed before fix' },
      ],
      checks: [
        null,
        { id: 'check-44', at: '2026-07-01T11:05:00.000Z', name: 'unit suite', result: 'fail', command: 'npm test', summary: 'one test failed' },
      ],
      environment_results: {
        broken: null,
        local: { environment: 'local', status: 'fail', checked_at: '2026-07-01T11:10:00.000Z', detail: 'local replay failed' },
      },
    },
  });
  const queue = {
    items: [{
      id: 'queue-44',
      ticket: 'K-44',
      projects: ['app'],
      project_path: '/repo/app',
      action: 'fix_build',
      priority_score: 99,
      reason: 'build failure',
    }],
    last_computed: '2026-07-01T08:00:00.000Z',
  };
  const runs = [
    null,
    'not-a-run',
    {
      id: 'run-44',
      ticket: 'K-44',
      project: 'app',
      skill: 'verify-local',
      status: 'failed',
      startedAt: '2026-07-01T07:00:00.000Z',
      endedAt: '2026-07-01T07:30:00.000Z',
      failureReason: 'unit test failed',
      promptHash: 'abcdef1234567890',
    },
    {
      id: 'bad-hash',
      ticket: 'K-44',
      status: 'failed',
      endedAt: '2026-06-30T12:00:00.000Z',
      promptHash: 123,
    },
    {
      id: 'needs-human',
      ticket: 'K-44',
      status: 'needs_human',
      endedAt: '2026-06-30T13:00:00.000Z',
      events: [{ label: 'Worktree cleanup blocked', detail: 'Dirty worktree: .claude/' }],
    },
    {
      id: 'other-run',
      ticket: 'K-45',
      status: 'failed',
    },
  ];

  const events = ticketTimeline.buildTicketTimeline({ ticketKey: 'K-44', ticket: t, queue, runs });

  assert.equal(events[0].source, 'evidence');
  assert.ok(events.some(event => event.title.includes('Evidence check: unit suite') && event.severity === 'failure'));
  assert.ok(events.some(event => event.title.includes('Environment local') && event.detail.includes('local replay failed')));
  assert.ok(events.some(event => event.source === 'queue' && event.detail.includes('score 99')));
  assert.ok(events.some(event => event.source === 'run' && event.detail.includes('unit test failed')));
  assert.ok(events.some(event => event.source === 'run' && event.id.includes('needs-human') && event.detail.includes('Dirty worktree: .claude/')));
  assert.ok(events.some(event => event.source === 'mr' && event.severity === 'failure'));
  assert.ok(events.some(event => event.source === 'build' && event.severity === 'failure'));
  assert.equal(events.some(event => event.id.includes('other-run')), false);

  const source = readSourceFixture('src', 'services', 'ticketTimeline.ts');
  assert.ok(source.includes("import { isRunLikeRecord, type RunLikeRecord } from './runRecords'"));
  assert.ok(source.includes('const rawRuns: unknown[] = Array.isArray(input.runs) ? input.runs : []'));
  assert.ok(source.includes('const runs = rawRuns.filter(isRunLikeRecord)'));
  assert.ok(source.includes("import { isAttentionRunStatus, runAttentionDetail } from './runAttention'"));
  assert.ok(source.includes('const attentionDetail = isAttentionRunStatus(status) ? runAttentionDetail(run) :'));
  assert.equal(source.includes('type TimelineRunRecord = TimelineRun & Record<string, unknown>'), false);
  assert.equal(source.includes('type TimelineRunRecord = TimelineRun & Record<string, any>'), false);
  assert.equal(source.includes('function isRunRecord'), false);
});

test('run status helper centralizes active persisted run semantics', () => {
  assert.equal(runStatus.isActiveRunStatus('running'), true);
  assert.equal(runStatus.isActiveRunStatus('preflight'), true);
  assert.equal(runStatus.isActiveRunStatus('queued'), false);
  assert.equal(runStatus.isActiveRunStatus('paused'), true);
  assert.equal(runStatus.isActiveRunStatus('completed'), false);
  assert.equal(runStatus.isActiveRun({ status: 'queued' }), false);
  assert.equal(runStatus.isActiveRun({ status: 'running' }), true);
  assert.equal(runStatus.isFreshActiveRun({ status: 'running', startedAt: '2026-07-01T11:00:00.000Z' }, new Date('2026-07-01T12:00:00.000Z')), true);
  assert.equal(runStatus.isFreshActiveRun({ status: 'running', startedAt: '2026-06-30T23:00:00.000Z' }, new Date('2026-07-01T12:00:00.000Z')), false);
  assert.equal(runStatus.isStaleActiveRun({ status: 'running', startedAt: '2026-06-30T23:00:00.000Z' }, new Date('2026-07-01T12:00:00.000Z')), true);
  assert.equal(runStatus.isFreshActiveRun({ status: 'running', startedAt: '2000-01-01T00:00:00.000Z', processPid: process.pid }, new Date('2026-07-01T12:00:00.000Z')), true);
  assert.equal(runStatus.isStaleActiveRun({ status: 'running', startedAt: '2000-01-01T00:00:00.000Z', processPid: process.pid }, new Date('2026-07-01T12:00:00.000Z')), false);
  assert.equal(runStatus.isStaleActiveRun({ status: 'running', startedAt: '2000-01-01T00:00:00.000Z', processPid: 999999999 }, new Date('2026-07-01T12:00:00.000Z')), true);
  assert.equal(runStatus.isFreshActiveRun({ status: 'paused', startedAt: '2026-06-30T23:00:00.000Z' }, new Date('2026-07-01T12:00:00.000Z')), true);
  assert.equal(runStatus.isActiveRun({ status: 'running', endedAt: '2026-07-01T10:00:00.000Z' }), false);
  assert.equal(runStatus.isActiveRun({ status: 'running', exitCode: 0 }), false);
  assert.equal(runStatus.isActiveRun({ status: 'running', events: [{ type: 'done', label: 'Complete - 1.0s' }] }), false);
  assert.equal(runStatus.isActiveRun({ status: 'running', events: [{ type: 'error', label: 'Session exited with code 1' }] }), false);
  assert.equal(runStatus.isActiveRun({ status: 'waiting_for_review' }), false);
  assert.equal(runStatus.effectiveRunStatus({ status: 'running' }), 'running');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', exitCode: 0 }), 'completed');
  assert.equal(runStatus.effectiveRunStatus({ status: 'preflight', exitCode: 1 }), 'failed');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', endedAt: '2026-07-01T10:00:00.000Z' }), 'needs_human');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', events: [{ type: 'error', label: 'Session cancelled' }] }), 'cancelled');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', events: [{ type: 'done', label: 'Complete - 1.0s' }] }), 'completed');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', exitCode: 1, events: [{ type: 'done', label: 'Complete - 1.0s' }] }), 'failed');
  assert.equal(runStatus.effectiveRunStatus({ status: 'running', exitCode: 1, events: [{ type: 'error', label: 'Session cancelled' }] }), 'cancelled');
  assert.equal(runStatus.terminalRunOutcome({ status: 'running', events: [{ label: 'Session exited with code 1' }] }), 'failed');
  assert.equal(runStatus.ACTIVE_RUN_STATUSES, undefined);
  assert.equal(runStatus.STALEABLE_ACTIVE_RUN_STATUSES, undefined);
  assert.equal(runStatus.DEFAULT_STALE_ACTIVE_RUN_MS, undefined);
  assert.equal(runStatus.hasTerminalRunSignal, undefined);
  assert.equal(runStatus.activeRunSummary([
    { status: 'running' },
    { status: 'running' },
    { status: 'running', endedAt: '2026-07-01T10:00:00.000Z' },
    { status: 'preflight', exitCode: 1 },
    { status: 'preflight' },
    { status: 'queued' },
    { status: 'paused' },
    { status: 'running', startedAt: '2000-01-01T00:00:00.000Z' },
    { status: 'completed' },
  ]), '2 running, 1 preflight, 1 paused');

  const source = readSourceFixture('src', 'services', 'runStatus.ts');
  for (const marker of [
    "import { toValidDate } from './dateValues'",
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
    'processPid?: unknown',
    "if (hasLiveProcess(run['processPid'])) { return false; }",
    'function hasLiveProcess',
    'function numericPid',
    'process.kill(pid, 0)',
    "hasDateLikeValue(run['endedAt'])",
    'label.startsWith(\'Session exited with code\')',
    'export function activeRunSummary',
    "['running', 'preflight', 'paused']",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'export const ACTIVE_RUN_STATUSES',
    'export const STALEABLE_ACTIVE_RUN_STATUSES',
    'export const DEFAULT_STALE_ACTIVE_RUN_MS',
    'export interface RunStatusLike',
    'export function hasTerminalRunSignal',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('run progress helper summarizes active run activity', () => {
  const summary = runProgress.runProgressSummary({
    status: 'running',
    startedAt: '2026-07-02T00:00:00.000Z',
    events: [
      { type: 'tool', label: 'Reading src/app.ts', timestamp: '2026-07-02T00:01:00.000Z' },
      { type: 'tool', label: 'Editing src/app.ts', timestamp: '2026-07-02T00:02:00.000Z' },
      { type: 'tool', label: 'Writing src/new.ts', timestamp: '2026-07-02T00:03:00.000Z' },
      { type: 'error', label: 'Command failed', timestamp: '2026-07-02T00:04:00.000Z' },
    ],
  }, new Date('2026-07-02T00:05:30.000Z'));
  assert.equal(summary.toolCalls, 3);
  assert.equal(summary.toolErrors, 1);
  assert.equal(summary.filesRead, 1);
  assert.equal(summary.filesChanged, 2);
  assert.equal(summary.elapsedSeconds, 330);
  assert.equal(summary.label, '3 tools | 2 changed | 5m 30s');
  assert.equal(summary.detail, '1 read | 1 error');
  assert.equal(runProgress.formatRunProgress({ events: [] }, new Date('2026-07-02T00:05:30.000Z')), '0 tools | 0 changed | 0s');

  const source = readSourceFixture('src', 'services', 'runProgress.ts');
  for (const marker of [
    "import { isActiveRunStatus } from './runStatus'",
    "import { toValidDate } from './dateValues'",
    "import { isRecord, recordFromUnknown, recordString } from './records'",
    'export function runProgressSummary',
    'export function formatRunProgress',
    'function elapsedRunSeconds',
    'function fileCount',
    'function formatElapsed',
    "countLabel(toolCalls, 'tool')",
    "countLabel(filesChanged, 'changed', 'changed')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('active run display summarizes status bar text and tooltip progress', () => {
  const now = new Date('2026-07-02T00:05:30.000Z');
  const single = activeRunDisplay.activeRunStatusBarSummary([{
    status: 'running',
    project: 'app',
    ticket: 'K-1',
    skill: 'implement',
    startedAt: '2026-07-02T00:00:00.000Z',
    events: [
      { type: 'tool', label: 'Reading src/app.ts', timestamp: '2026-07-02T00:01:00.000Z' },
      { type: 'tool', label: 'Editing src/app.ts', timestamp: '2026-07-02T00:02:00.000Z' },
    ],
  }], now);
  assert.equal(single.count, 1);
  assert.match(single.text, /^1 running - 2 tools \| 1 changed \| /);
  assert.match(single.tooltip, /app K-1 implement: running - 2 tools \| 1 changed \| /);

  const multiple = activeRunDisplay.activeRunStatusBarSummary([
    { status: 'running', project: 'app', ticket: 'K-1', skill: 'implement' },
    { status: 'paused', project: 'api', ticket: 'K-2', skill: 'verify' },
    { status: 'completed', project: 'api', ticket: 'K-3', skill: 'verify' },
  ], now);
  assert.equal(multiple.count, 2);
  assert.equal(multiple.text, '1 running, 1 paused');
  assert.match(multiple.tooltip, /Kronos active runs: 1 running, 1 paused/);
  assert.match(multiple.tooltip, /api K-2 verify: paused - 0 tools \| 0 changed \| 0s/);
  assert.equal(activeRunDisplay.activeRunStatusBarSummary([{ status: 'completed' }]), null);

  const source = readSourceFixture('src', 'services', 'activeRunDisplay.ts');
  for (const marker of [
    "import { formatRunProgress } from './runProgress'",
    "import { activeRunSummary, isFreshActiveRun, runStatus } from './runStatus'",
    "import { recordFromUnknown, recordString } from './records'",
    'export function activeRunStatusBarSummary',
    'activeRuns.length === 1',
    'activeRunTooltipLine',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('queue active-run helper matches active runs without broad fallbacks', () => {
  const queueItem = (overrides = {}) => ({
    id: 'q-1',
    projects: ['app'],
    project_path: '/repo/app',
    ticket: 'APP-123',
    action: 'implement',
    priority_score: 90,
    reason: 'fixture',
    ...overrides,
  });
  const run = (overrides = {}) => ({
    id: 'run-1',
    project: 'app',
    projectPath: '/repo/app',
    ticket: 'APP-123',
    skill: 'implement',
    status: 'running',
    startedAt: '2026-07-03T22:59:00.000Z',
    events: [],
    ...overrides,
  });
  const now = new Date('2026-07-03T23:00:00.000Z');
  const activeMatch = (candidate, item = queueItem()) => queueActiveRun.activeRunForQueueItem(item, [candidate], now) === candidate;

  assert.equal(activeMatch(run()), true);
  assert.equal(activeMatch(run({ ticket: 'APP-999' })), false);
  assert.equal(activeMatch(run({ skill: 'verify-local' })), false);
  assert.equal(activeMatch(run({ project: 'other', projectPath: '/repo/other' })), false);
  assert.equal(activeMatch(run({ project: 'other', projectPath: '/repo/app/' })), true);
  assert.equal(activeMatch(run({ project: 'other', projectPath: '\\repo\\app\\' })), true);
  assert.equal(activeMatch(run({ project: 'other', projectPath: '/repo/other' }), queueItem({ projects: [], project_path: '' })), true);

  const stale = run({ id: 'stale', startedAt: '2026-07-03T10:00:00.000Z' });
  const completed = run({ id: 'completed', exitCode: 0 });
  const fresh = run({ id: 'fresh', startedAt: '2026-07-03T22:59:00.000Z' });
  assert.equal(queueActiveRun.activeRunForQueueItem(queueItem(), [stale, completed, fresh], now), fresh);

  const source = readSourceFixture('src', 'services', 'queueActiveRun.ts');
  for (const marker of [
    "import { skillForAction } from './nextActionContext'",
    "import { projectPathKey } from './pathUtils'",
    "import { isFreshActiveRun } from './runStatus'",
    'interface QueueActiveRunLike',
    'export function activeRunForQueueItem<T extends QueueActiveRunLike>',
    'return runs.find(run => isFreshActiveRun(run, now) && runMatchesQueueItem(run, item));',
    'function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean',
    "projectPathKey(recordString(run, 'projectPath'))",
    'projectPathKey(item.project_path)',
    "recordString(run, 'skill') === skillForAction(item.action)",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('relative time formatter handles invalid, past, and future timestamps', () => {
  const now = new Date('2026-07-02T12:00:00.000Z');

  assert.equal(relativeTime.formatRelativeTime('not-a-date', now), 'not-a-date');
  assert.equal(relativeTime.formatRelativeTime('2026-07-02T11:59:45.000Z', now), 'just now');
  assert.equal(relativeTime.formatRelativeTime('2026-07-02T11:55:00.000Z', now), '5m ago');
  assert.equal(relativeTime.formatRelativeTime('2026-07-02T10:00:00.000Z', now), '2h ago');
  assert.equal(relativeTime.formatRelativeTime('2026-06-29T12:00:00.000Z', now), '3d ago');
  assert.equal(relativeTime.formatRelativeTime('2026-07-02T12:05:00.000Z', now), 'in 5m');
  assert.equal(relativeTime.formatRelativeTime('2026-07-02T14:00:00.000Z', now), 'in 2h');
  assert.equal(relativeTime.formatRelativeTime('2026-07-05T12:00:00.000Z', now), 'in 3d');

  const source = readSourceFixture('src', 'services', 'relativeTime.ts');
  for (const marker of [
    'export function formatRelativeTime',
    'const absMins = Math.floor(Math.abs(diffMs) / 60000)',
    "return past ? `${value}${unit} ago` : `in ${value}${unit}`",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('interval config helpers clamp invalid polling values and parse settings input', () => {
  assert.equal(intervalConfig.positiveConfigNumber(250, 5000), 250);
  assert.equal(intervalConfig.positiveConfigNumber(0, 5000), 5000);
  assert.equal(intervalConfig.positiveConfigNumber(Number.NaN, 5000), 5000);
  assert.equal(intervalConfig.positiveConfigNumber(100, 0), 100);
  assert.equal(intervalConfig.positiveConfigNumber(0, 0), 1);

  assert.equal(intervalConfig.configIntervalMs(250, 5000, 1000), 1000);
  assert.equal(intervalConfig.configIntervalMs(2500, 5000, 1000), 2500);
  assert.equal(intervalConfig.configIntervalMs(-1, 5000, 1000), 5000);
  assert.equal(intervalConfig.configIntervalMs(999999999999, 5000, 1000), 2147483647);
  assert.equal(intervalConfig.configIntervalSeconds(30, 300, 60), 60);
  assert.equal(intervalConfig.configIntervalSeconds(90, 300, 60), 90);
  assert.equal(intervalConfig.configIntervalSeconds(999999999, 300, 60), 2147483);
  assert.equal(intervalConfig.configIntervalSecondsMs(90, 300, 60), 90000);

  assert.deepEqual(intervalConfig.parsePositiveNumberInput(undefined), { kind: 'empty' });
  assert.deepEqual(intervalConfig.parsePositiveNumberInput('  '), { kind: 'empty' });
  assert.deepEqual(intervalConfig.parsePositiveNumberInput('15'), { kind: 'value', value: 15 });
  assert.deepEqual(intervalConfig.parsePositiveNumberInput('2.5'), { kind: 'value', value: 2.5 });
  assert.deepEqual(intervalConfig.parsePositiveNumberInput('0'), { kind: 'invalid', raw: '0' });
  assert.deepEqual(intervalConfig.parsePositiveNumberInput('abc'), { kind: 'invalid', raw: 'abc' });
});

test('run center sort orders active work first and failed or cancelled runs last', () => {
  const recentIso = (minutesAgo) => new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  const ordered = runCenterSort.sortedRunCenterRuns([
    { id: 'queued-new', status: 'queued', startedAt: recentIso(10) },
    { id: 'unknown-new', status: 'unknown', startedAt: '2026-07-02T10:00:00.000Z' },
    { id: 'failed-newer', status: 'failed', startedAt: '2026-07-02T09:00:00.000Z', endedAt: '2026-07-02T09:30:00.000Z' },
    { id: 'completed-latest', status: 'completed', startedAt: '2026-07-02T08:00:00.000Z', endedAt: '2026-07-02T12:00:00.000Z' },
    { id: 'running-terminal', status: 'running', startedAt: '2026-07-02T07:00:00.000Z', endedAt: '2026-07-02T07:30:00.000Z' },
    { id: 'active-old', status: 'running', startedAt: recentIso(60) },
    { id: 'active-new', status: 'preflight', startedAt: recentIso(5) },
    { id: 'active-no-timestamp', status: 'running' },
    { id: 'review-ready', status: 'waiting_for_review', startedAt: '2026-07-02T05:00:00.000Z', endedAt: '2026-07-02T05:30:00.000Z' },
    { id: 'needs-human', status: 'needs_human', startedAt: '2026-07-02T04:00:00.000Z', endedAt: '2026-07-02T04:30:00.000Z' },
    { id: 'cancelled-old', status: 'cancelled', startedAt: '2026-07-02T03:00:00.000Z', endedAt: '2026-07-02T03:30:00.000Z' },
  ]).map(run => run.id);

  assert.deepEqual(ordered, [
    'active-new',
    'active-old',
    'active-no-timestamp',
    'review-ready',
    'needs-human',
    'completed-latest',
    'queued-new',
    'unknown-new',
    'running-terminal',
    'failed-newer',
    'cancelled-old',
  ]);
});

test('attention badge aggregates review, aging, and paused-run signals', () => {
  const summary = attentionBadge.computeAttentionBadge({
    state: baseState({
      'K-1': ticket({
        next_action: 'blocked',
        last_action: 'Waiting on product',
        last_action_at: '2026-06-28T00:00:00.000Z',
        evidence: {
          notes: [{ at: '2026-06-28T00:00:00.000Z', kind: 'note', text: 'Blocked by dependency' }],
        },
      }),
    }),
    runs: [
      { id: 'run-1', status: 'paused' },
      { id: 'run-2', status: 'running' },
      { id: 'run-3', status: 'paused', endedAt: '2026-07-01T10:00:00.000Z' },
    ],
    newReviewItems: 2,
    now: new Date('2026-07-02T00:00:00.000Z'),
    agingThresholds: { blockedDays: 2 },
  });

  assert.equal(summary.humanReviewItems, 1);
  assert.equal(summary.evidenceGateFailures, 0);
  assert.equal(summary.evidenceGateWarnings, 0);
  assert.equal(summary.staleCritical, 1);
  assert.equal(summary.staleWarning, 0);
  assert.equal(summary.pausedRuns, 1);
  assert.equal(summary.newReviewItems, 2);
  assert.equal(summary.count, 5);
  assert.match(summary.tooltip, /Kronos: 5 items need attention/);
  assert.match(summary.tooltip, /2 new review items/);
  assert.match(summary.tooltip, /1 paused run/);
  assert.equal(attentionBadge.computeAttentionBadge({ state: baseState({}) }).count, 0);
  assert.equal(attentionBadge.computeAttentionBadge({
    state: baseState({}),
    newReviewItems: 1.8,
    runs: [{ id: 'paused', status: 'paused' }],
  }).count, 2);
  assert.equal(attentionBadge.computeAttentionBadge({
    state: baseState({}),
    newReviewItems: Number.NaN,
  }).count, 0);

  const source = readSourceFixture('src', 'services', 'attentionBadge.ts');
  for (const marker of [
    'export function computeAttentionBadge',
    'function attentionBadgeCount',
    'buildHumanReviewInbox',
    'evaluateEvidenceGates',
    'analyzeAging',
    'runStatus(run)',
    'isActiveRun(run)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('collision detector flags active runs, duplicate queue work, and open MRs', () => {
  const tickets = {
    'K-1': ticket({ projects: ['app'], summary: 'Fix checkout retry routing', labels: ['checkout'] }),
    'K-2': ticket({
      projects: ['app'],
      summary: 'Review checkout retry handler',
      labels: ['checkout'],
      mr: { iid: 7, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/7' },
    }),
    'K-3': ticket({ projects: ['app'], summary: 'Repair checkout retry tests', labels: ['checkout'] }),
  };
  const queue = {
    items: [
      {
        id: 'same-ticket',
        ticket: 'K-1',
        projects: ['app'],
        project_path: '/repo/app',
        action: 'implement',
        priority_score: 50,
        reason: 'already planned',
      },
      {
        id: 'same-project',
        ticket: 'K-3',
        projects: ['app'],
        project_path: '/repo/app',
        action: 'fix_build',
        priority_score: 40,
        reason: 'build failed',
      },
    ],
    last_computed: null,
  };

  const collisions = collisionDetector.detectDispatchCollisions({
    ticketKey: 'K-1',
    projects: ['app'],
    action: 'implement',
    queue,
    mrFiles: {
      'K-1': [{ new_path: 'src/checkout/retry.ts' }],
      'K-2': [{ old_path: 'src/checkout/retry.ts' }, { filename: 'src/orders/create.ts' }],
    },
    runs: [
      { id: 'run-ticket', ticket: 'K-1', project: 'app', status: 'running', skill: 'implement' },
      { id: 'run-project', ticket: 'K-4', project: 'app', status: 'preflight', skill: 'implement' },
      { id: 'queued-ticket', ticket: 'K-1', project: 'app', status: 'queued', skill: 'implement' },
      { id: 'paused-run', ticket: 'K-7', project: 'app', status: 'paused', skill: 'implement', startedAt: '2026-06-30T23:00:00.000Z' },
      { id: 'stale-queued', ticket: 'K-1', project: 'app', status: 'queued', skill: 'implement', startedAt: '2026-06-30T23:00:00.000Z' },
      { id: 'stale-running', ticket: 'K-1', project: 'app', status: 'running', skill: 'implement', startedAt: '2026-06-30T23:00:00.000Z' },
      { id: 'terminal-running', ticket: 'K-1', project: 'app', status: 'running', skill: 'implement', endedAt: '2026-07-01T11:45:00.000Z' },
      {
        id: 'recent-run',
        ticket: 'K-5',
        project: 'app',
        status: 'completed',
        endedAt: '2026-07-01T11:00:00.000Z',
        events: [
          { label: 'Editing src/checkout/retry.ts' },
          { label: 'Writing test/checkout/retry.test.ts' },
        ],
      },
      { id: 'malformed-events', ticket: 'K-8', project: 'app', status: 'completed', endedAt: '2026-07-01T11:30:00.000Z', events: { bad: true } },
      { id: 'done-run', ticket: 'K-6', project: 'app', status: 'completed', endedAt: '2026-06-01T11:00:00.000Z', events: [{ label: 'Editing src/old.ts' }] },
    ],
    tickets,
    now: new Date('2026-07-01T12:00:00.000Z'),
  });

  assert.equal(collisions[0].severity, 'high');
  assert.ok(collisions.some(c => c.kind === 'active_run' && c.id.includes('run-ticket')));
  assert.equal(collisions.some(c => c.kind === 'active_run' && c.id.includes('queued-ticket')), false);
  assert.ok(collisions.some(c => c.kind === 'active_run' && c.id.includes('paused-run')));
  assert.equal(collisions.some(c => c.id.includes('stale-running')), false);
  assert.equal(collisions.some(c => c.id.includes('stale-queued')), false);
  assert.ok(collisions.some(c => c.kind === 'queued_ticket'));
  assert.ok(collisions.some(c => c.kind === 'queued_project'));
  assert.ok(collisions.some(c => c.kind === 'open_mr'));
  assert.ok(collisions.some(c => c.kind === 'recent_file' && c.detail.includes('src/checkout/retry.ts')));
  assert.equal(collisions.some(c => c.id.includes('terminal-running')), false);
  assert.equal(collisions.some(c => c.id.includes('malformed-events')), false);
  assert.ok(collisions.some(c => c.kind === 'ticket_area' && c.detail.includes('checkout')));
  assert.ok(collisions.some(c => c.kind === 'mr_file' && c.severity === 'high' && c.detail.includes('src/checkout/retry.ts')));
  assert.equal(collisions.some(c => c.id.includes('done-run')), false);

  const excluded = collisionDetector.detectDispatchCollisions({
    ticketKey: 'K-1',
    projects: ['app'],
    action: 'implement',
    queue,
    runs: [],
    tickets,
    excludeQueueItemId: 'same-ticket',
  });
  assert.equal(excluded.some(c => c.kind === 'queued_ticket'), false);

  const staleThresholdDisabled = collisionDetector.detectDispatchCollisions({
    ticketKey: 'K-1',
    projects: ['app'],
    action: 'implement',
    runs: [
      { id: 'stale-running', ticket: 'K-1', project: 'app', status: 'running', skill: 'implement', startedAt: '2026-06-30T23:00:00.000Z' },
      { id: 'stale-queued', ticket: 'K-1', project: 'app', status: 'queued', skill: 'implement', startedAt: '2026-06-30T23:00:00.000Z' },
    ],
    tickets,
    now: new Date('2026-07-01T12:00:00.000Z'),
    staleActiveRunHours: 0,
  });
  assert.ok(staleThresholdDisabled.some(c => c.id.includes('stale-running')));
  assert.equal(staleThresholdDisabled.some(c => c.id.includes('stale-queued')), false);

  const source = readSourceFixture('src', 'services', 'collisionDetector.ts');
  for (const marker of [
    'staleActiveRunHours?: number',
    'const staleActiveRunHours = input.staleActiveRunHours ?? 12',
    'const isActive = isCollisionActiveRun(run, now, staleActiveRunHours)',
    'function isCollisionActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean',
    'isStaleActiveRun(run, now, staleActiveRunHours * 60 * 60 * 1000)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('collision detector selects MR file hint candidates for code work', () => {
  const tickets = {
    'K-TARGET': ticket({
      projects: ['app'],
      mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
    }),
    'K-SAME-1': ticket({
      projects: ['app'],
      mr: { iid: 2, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/2' },
    }),
    'K-SAME-2': ticket({
      projects: ['app', 'web'],
      mr: { iid: 3, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/3' },
    }),
    'K-CLOSED': ticket({
      projects: ['app'],
      mr: { iid: 4, state: 'closed', review_status: 'pending_review', url: 'https://gitlab.example/4' },
    }),
    'K-OTHER': ticket({
      projects: ['ops'],
      mr: { iid: 5, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/5' },
    }),
  };

  assert.deepEqual(collisionDetector.mrFileHintCandidateKeys({
    targets: [{ ticketKey: 'K-TARGET', projects: ['app'], action: 'implement' }],
    tickets,
    limit: 3,
  }), ['K-TARGET', 'K-SAME-1', 'K-SAME-2']);
  assert.deepEqual(collisionDetector.mrFileHintCandidateKeys({
    targets: [{ ticketKey: 'K-TARGET', projects: ['app'], action: 'add_evidence' }],
    tickets,
    limit: 3,
  }), []);
  const closedTargetCandidates = collisionDetector.mrFileHintCandidateKeys({
    targets: [{ ticketKey: 'K-CLOSED', projects: ['app'], action: 'implement' }],
    tickets,
    limit: 2,
  });
  assert.deepEqual(closedTargetCandidates, ['K-TARGET', 'K-SAME-1']);
  assert.equal(closedTargetCandidates.includes('K-CLOSED'), false);
  assert.deepEqual(collisionDetector.mrFileHintCandidateKeys({
    targets: [{ projects: ['ops'], action: 'fix_build' }],
    tickets,
    limit: 3,
  }), ['K-OTHER']);
  assert.deepEqual(collisionDetector.mrFileHintCandidateKeys({
    targets: [{ projects: [], action: 'implement' }],
    tickets,
    limit: 3,
  }), []);

  const source = readSourceFixture('src', 'services', 'collisionDetector.ts');
  for (const marker of [
    'export interface MrFileHintTarget',
    'export function mrFileHintCandidateKeys',
    'if (!isCodeAction(target.action)) { continue; }',
    "ticket.mr?.state !== 'opened'",
    'return Array.from(candidateKeys).slice(0, input.limit)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('MR file hint service loads candidate diffs and keeps failed hints non-fatal', async () => {
  const tickets = {
    'K-TARGET': ticket({
      projects: ['app'],
      mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
    }),
    'K-EMPTY': ticket({
      projects: ['app'],
      mr: { iid: 2, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/2' },
    }),
    'K-FAIL': ticket({
      projects: ['app'],
      mr: { iid: 3, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/3' },
    }),
    'K-SAME': ticket({
      projects: ['app'],
      mr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/4' },
    }),
  };
  const state = { state: { tickets } };
  const calls = [];
  const warnings = [];

  const hints = await mergeRequestFileHints.loadMrFileHints(state, [
    { ticketKey: 'K-TARGET', projects: ['app'], action: 'implement' },
  ], {
    limit: 4,
    timeoutMs: 1234,
    logWarning: message => warnings.push(message),
    loadDiff: async (_state, ticketKey, options) => {
      calls.push({ ticketKey, timeoutMs: options.timeoutMs });
      if (ticketKey === 'K-EMPTY') { return { files: [] }; }
      if (ticketKey === 'K-FAIL') { throw {}; }
      return { files: [{ new_path: `src/${ticketKey}.ts` }] };
    },
  });

  assert.deepEqual(calls, [
    { ticketKey: 'K-TARGET', timeoutMs: 1234 },
    { ticketKey: 'K-EMPTY', timeoutMs: 1234 },
    { ticketKey: 'K-FAIL', timeoutMs: 1234 },
    { ticketKey: 'K-SAME', timeoutMs: 1234 },
  ]);
  assert.deepEqual(hints, {
    'K-TARGET': [{ new_path: 'src/K-TARGET.ts' }],
    'K-SAME': [{ new_path: 'src/K-SAME.ts' }],
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Failed to load MR diff hints for K-FAIL/);

  const noHints = await mergeRequestFileHints.loadMrFileHints(state, [
    { ticketKey: 'K-TARGET', projects: ['app'], action: 'add_evidence' },
  ], {
    loadDiff: async () => {
      throw new Error('non-code actions should not load diffs');
    },
  });
  assert.deepEqual(noHints, {});

  const source = readSourceFixture('src', 'services', 'mergeRequestFileHints.ts');
  for (const marker of [
    'export const LIVE_MR_DIFF_LIMIT = 4',
    'export const LIVE_MR_DIFF_TIMEOUT_MS = 8000',
    'export interface MergeRequestFileHintOptions',
    'mrFileHintCandidateKeys({',
    'loadDiff(state, ticketKey, { timeoutMs })',
    'logWarning(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`))',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('script client reports required scripts and wraps Python JSON contracts', async () => {
  const kronosStatePath = path.join(process.env.KRONOS_SCRIPTS_DIR, 'kronos_state.py');
  const pipelinePath = path.join(process.env.KRONOS_SCRIPTS_DIR, 'pipeline_monitor.py');
  fs.writeFileSync(kronosStatePath, 'import sys\nprint("state:" + " ".join(sys.argv[1:]))\n');
  fs.writeFileSync(pipelinePath, 'import json, sys\nprint(json.dumps({"args": sys.argv[1:]}))\n');

  const health = scriptClient.requiredScripts();
  assert.equal(health.find(s => s.name === 'kronos_state.py').present, true);
  assert.equal(health.find(s => s.name === 'pipeline_monitor.py').present, true);
  assert.equal(health.find(s => s.name === 'gitlab_api.py').present, false);

  assert.equal(scriptClient.runKronosStateScript(['--next']).trim(), 'state:--next');
  const parsed = await scriptClient.runPipelineJson(['--sonar-gate', 'app']);
  assert.deepEqual(parsed.args, ['--sonar-gate', 'app']);
  fs.writeFileSync(pipelinePath, 'import json, sys\nprint("\\ufeff" + json.dumps({"args": sys.argv[1:], "bom": True}))\n');
  const bomParsed = await scriptClient.runPipelineJson(['--sonar-gate', 'windows']);
  assert.deepEqual(bomParsed, { args: ['--sonar-gate', 'windows'], bom: true });

  fs.writeFileSync(pipelinePath, 'print("not json")\n');
  await assert.rejects(
    () => scriptClient.runPipelineJson(['--bad-json']),
    /Invalid JSON from pipeline_monitor\.py/
  );
  await assert.rejects(
    () => scriptClient.runGitlabJson(['--project-id', 'app']),
    error => {
      assert.equal(scriptClient.isKronosScriptMissingError(error), true);
      assert.equal(error.name, 'KronosScriptMissingError');
      assert.equal(error.scriptName, 'gitlab_api.py');
      assert.match(error.message, /Kronos integration script unavailable: gitlab_api\.py/);
      return true;
    }
  );
  assert.equal(scriptClient.isKronosScriptMissingError({
    name: 'KronosScriptMissingError',
    scriptName: 'kronos_state.py',
    filePath: kronosStatePath,
  }), true);
  assert.equal(scriptClient.isKronosScriptMissingError({
    name: 'KronosScriptMissingError',
    scriptName: 'not-a-script.py',
    filePath: kronosStatePath,
  }), false);
  assert.equal(scriptClient.isKronosScriptMissingError(new Error(`Kronos script missing: ${kronosStatePath}`)), true);
  assert.equal(scriptClient.isKronosScriptMissingError(new Error('Kronos integration script unavailable: kronos_state.py. Run Kronos: Doctor for setup details.')), true);
  assert.equal(scriptClient.isKronosScriptMissingError(new Error('Kronos script missing: old string')), false);
});

test('script client keeps raw JSON and process errors unknown by default', () => {
  const source = readSourceFixture('src', 'services', 'scriptClient.ts');
  for (const marker of [
    'class KronosScriptMissingError extends Error',
    'Object.setPrototypeOf(this, KronosScriptMissingError.prototype)',
    'export function isKronosScriptMissingError(error: unknown): boolean',
    "const REQUIRED_SCRIPT_NAMES = new Set<RequiredScriptName>(['kronos_state.py', 'pipeline_monitor.py', 'gitlab_api.py'])",
    "const MISSING_SCRIPT_MESSAGE_PREFIX = 'Kronos integration script unavailable: '",
    'function isRequiredScriptName(value: unknown): value is RequiredScriptName',
    'function isKronosScriptMissingMessage(value: unknown): boolean',
    'value.startsWith(MISSING_SCRIPT_MESSAGE_PREFIX)',
    "value.startsWith('Kronos script missing: ')",
    'throw new KronosScriptMissingError(scriptName, filePath)',
    'async function runJsonScript<T = unknown>',
    'export function runGitlabJson<T = unknown>',
    'export function runPipelineJson<T = unknown>',
    'function parseScriptJson<T = unknown>',
    'function scriptError(scriptName: RequiredScriptName, args: string[], error: unknown)',
    'function pythonCandidateAvailable(candidate: string): boolean',
    "import { parseJsonWithLabel } from './jsonFiles'",
    'return parseJsonWithLabel<T>(raw, `${scriptName} ${args.join(\' \')}`, { includePreview: true })',
    "import { unknownErrorField, unknownErrorMessage } from './errorUtils'",
    "unknownErrorField(error, 'stderr')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(source.includes('export class KronosScriptMissingError'), false);
  for (const marker of [
    '<T = any>',
    'catch (e: any)',
    'error: any',
    'e?.message',
    'error?.stderr',
    'function unknownErrorMessage(error: unknown',
    'function errorField(error: unknown',
    '} catch {}',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('state script adapter owns typed kronos_state operations', () => {
  const calls = [];
  const runner = (args, options) => {
    calls.push({ args, options });
    if (args[0] === '--discover') {
      return JSON.stringify({ candidates: [{ repo_name: 'app', path: '/repo/app', has_project_json: true }] });
    }
    if (args[0] === '--morning-brief') {
      return JSON.stringify({ completed: ['K-1'], ready_to_go: ['K-2'] });
    }
    return `ran:${args.join(' ')}`;
  };
  const options = { runner, scriptOptions: { timeout: 1234 } };

  assert.equal(stateScriptAdapter.refreshKronosState(undefined, options), 'ran:--refresh-all');
  assert.equal(stateScriptAdapter.refreshKronosState('api', options), 'ran:--refresh api');
  assert.deepEqual(stateScriptAdapter.discoverProjectsJson(options).candidates.map(c => c.repo_name), ['app']);
  assert.deepEqual(stateScriptAdapter.discoverProjectsJson({
    runner: () => String.fromCharCode(0xFEFF) + JSON.stringify({
      candidates: [{ repo_name: 'bom-app', path: '/repo/bom-app', has_project_json: true }],
    }),
  }).candidates.map(c => c.repo_name), ['bom-app']);
  assert.deepEqual(stateScriptAdapter.discoverProjectsJson({
    runner: () => JSON.stringify({
      candidates: [
        null,
        'bad',
        { repo_name: 'missing-path' },
        { repo_name: ' api ', path: ' /repo/api ', has_project_json: true, git_remote: ' git@example.test:api.git ', pom_artifact_id: '', suggested_jira_key: ' API ' },
        { path: '/repo/derived', has_project_json: 'yes', git_remote: 42, suggested_jira_key: null },
        { repo_name: 'duplicate', path: '/repo/derived', suggested_jira_key: 'DUP' },
      ],
    }),
  }).candidates, [
    {
      repo_name: 'api',
      path: '/repo/api',
      has_project_json: true,
      git_remote: 'git@example.test:api.git',
      pom_artifact_id: null,
      suggested_jira_key: 'API',
    },
    {
      repo_name: 'derived',
      path: '/repo/derived',
      has_project_json: false,
      git_remote: null,
      pom_artifact_id: null,
      suggested_jira_key: null,
    },
  ]);
  assert.equal(stateScriptAdapter.registerProject('/repo/app', options), 'ran:--register /repo/app');
  assert.equal(stateScriptAdapter.addAdhocTask('Fix docs', 'Update README', options), 'ran:--adhoc-add Fix docs Update README');
  assert.equal(stateScriptAdapter.completeAdhocTask('task-1', options), 'ran:--adhoc-done task-1');
  assert.deepEqual(stateScriptAdapter.readMorningBriefJson(options).ready_to_go, ['K-2']);
  assert.deepEqual(stateScriptAdapter.readMorningBriefJson({
    runner: () => String.fromCharCode(0xFEFF) + JSON.stringify({ ready_to_go: ['K-BOM'] }),
  }).ready_to_go, ['K-BOM']);
  assert.deepEqual(stateScriptAdapter.discoverProjectsJson({ runner: () => JSON.stringify({}) }).candidates, []);
  assert.deepEqual(stateScriptAdapter.discoverProjectsJson({ runner: () => JSON.stringify(null) }).candidates, []);
  assert.deepEqual(stateScriptAdapter.readMorningBriefJson({ runner: () => JSON.stringify([]) }), {});
  assert.deepEqual(stateScriptAdapter.readMorningBriefJson({
    runner: () => JSON.stringify({
      completed: 'K-1',
      needs_attention: { ticket: 'K-2' },
      ready_to_go: ['K-3'],
      overnight_actions: '4',
      vpn_drops: 'not a number',
    }),
  }), {
    completed: [],
    needs_attention: [],
    ready_to_go: ['K-3'],
    overnight_actions: 4,
    vpn_drops: 0,
  });
  assert.throws(
    () => stateScriptAdapter.discoverProjectsJson({ runner: () => 'not json' }),
    /Invalid JSON from kronos_state\.py --discover/
  );
  assert.deepEqual(calls.map(call => call.args), [
    ['--refresh-all'],
    ['--refresh', 'api'],
    ['--discover'],
    ['--register', '/repo/app'],
    ['--adhoc-add', 'Fix docs', 'Update README'],
    ['--adhoc-done', 'task-1'],
    ['--morning-brief'],
  ]);
  assert.ok(calls.every(call => call.options.timeout === 1234));
});

test('discovery quick-pick groups candidates by registration readiness', () => {
  const entries = discoveryQuickPick.buildDiscoveryQuickPickEntries([
    { repo_name: 'configured', path: '/scan/configured', has_project_json: true },
    { repo_name: 'guessed', path: '/scan/team/guessed', has_project_json: false, suggested_jira_key: 'TEAM' },
    { repo_name: 'needs-key', path: 'C:\\scan\\team\\needs-key', has_project_json: false },
  ]);

  assert.deepEqual(entries.map(entry => entry.label), [
    '--- Ready to register (has config) ---',
    'configured',
    '--- Jira key guessed (1 repos) ---',
    'guessed',
    '--- No config (1 repos) ---',
    'needs-key',
  ]);
  assert.equal(entries[0].separator, true);
  assert.equal(entries[1].description, '$(check) Has .claude/project.json');
  assert.equal(entries[1].picked, true);
  assert.equal(entries[3].description, 'Jira: TEAM | team');
  assert.equal(entries[5].description, 'team — needs Jira key');
  assert.equal(discoveryQuickPick.discoveryCandidateNeedsJiraKey({ repo_name: 'needs-key', path: '/scan/needs-key', has_project_json: false }), true);
  assert.equal(discoveryQuickPick.discoveryCandidateNeedsJiraKey({ repo_name: 'ready', path: '/scan/ready', has_project_json: true }), false);

  const source = readSourceFixture('src', 'services', 'discoveryQuickPick.ts');
  for (const marker of [
    'export function buildDiscoveryQuickPickEntries',
    'export function discoveryCandidateNeedsJiraKey',
    'function parentDirName(projectPath: string): string',
    '--- Ready to register (has config) ---',
    '--- Jira key guessed (${withJiraGuess.length} repos) ---',
    '--- No config (${noConfig.length} repos) ---',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('state script adapter keeps raw JSON payloads unknown until normalized', () => {
  const source = readSourceFixture('src', 'services', 'stateScriptAdapter.ts');
  for (const marker of [
    '[key: string]: unknown',
    "parseJsonWithLabel(discoverProjects(options), 'kronos_state.py --discover', { includePreview: true })",
    "import { isRecord as isPlainObject } from './records'",
    "import { parseJsonWithLabel } from './jsonFiles'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    '[key: string]: any',
    'function parseStateScriptJson',
    'catch (e: any)',
    'e?.message',
    'value is Record<string, any>',
    'function unknownErrorMessage(error: unknown',
    "Reflect.get(error, 'message')",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('integration adapters wrap selected Jira, GitLab, and Sonar script contracts', async () => {
  const calls = [];
  const runner = {
    async runScript(args) {
      calls.push(args);
      if (args[0] === '--ticket-comments') {
        return '\ufeff[{"body":"ok"}]';
      }
      if (args[0] === '--mr-diff' || args[0] === '--mr-status') {
        return `\ufeff${JSON.stringify({
          mr: {
            title: 'Fix it',
            iid: 7,
            state: 'merged',
            review_status: 'approved',
            web_url: 'https://gitlab.example/mr/7',
            source_branch: 'feature/K-7',
          },
          comments: [
            { id: 1, body: 'approved', created_at: '2026-07-02T01:00:00.000Z', author: { username: 'ada' } },
            { id: '2', note: 'merged', created_at: '2026-07-02T02:00:00.000Z' },
          ],
          discussions: [
            { id: 'd1', notes: [{ body: 'fixed', created_at: '2026-07-02T02:30:00.000Z', resolvable: true, resolved: true }] },
            { id: 'd2', notes: [{ body: 'still failing', created_at: '2026-07-02T03:00:00.000Z', resolvable: true, resolved: false }] },
          ],
          files: [{ path: 'src/app.ts' }],
        })}`;
      }
      if (args[0] === '--mr-branch') {
        return '\ufeff' + JSON.stringify({ branch: 'feature/K-7' });
      }
      return '{}';
    },
  };

  assert.deepEqual(await integrationAdapters.jiraAdapter.ticketComments(runner, 'K-7'), [{ body: 'ok' }]);
  const diff = await integrationAdapters.gitlabAdapter.mergeRequestDiff(runner, 'K-7');
  assert.equal(diff.mr.title, 'Fix it');
  assert.equal(diff.files[0].path, 'src/app.ts');
  assert.equal(await integrationAdapters.gitlabAdapter.mergeRequestBranch(runner, 'K-7'), 'feature/K-7');
  const status = await integrationAdapters.gitlabAdapter.mergeRequestStatus(runner, 'K-7');
  assert.equal(status.state, 'merged');
  assert.equal(status.review_status, 'approved');
  assert.equal(status.url, 'https://gitlab.example/mr/7');
  assert.equal(status.source_branch, 'feature/K-7');
  assert.equal(status.comment_count, 2);
  assert.equal(status.last_comment_at, '2026-07-02T02:00:00.000Z');
  assert.equal(status.discussion_count, 2);
  assert.equal(status.resolved_discussion_count, 1);
  assert.equal(status.unresolved_discussion_count, 1);
  assert.equal(status.last_discussion_at, '2026-07-02T03:00:00.000Z');
  assert.equal(status.discussions_resolved, false);
  assert.deepEqual(status.comments.map(comment => comment.id), ['1', '2']);
  const discussionOnlyStatus = integrationAdapters.normalizeMergeRequestStatus({
    mr: {
      title: 'Thread only',
      iid: 8,
      state: 'opened',
      review_status: 'pending_review',
      web_url: 'https://gitlab.example/mr/8',
    },
    discussions: [
      { id: 'thread-1', notes: [{ id: 'n1', body: 'thread note', created_at: '2026-07-02T03:30:00.000Z', resolvable: true, resolved: false }] },
    ],
  });
  assert.equal(discussionOnlyStatus.comment_count, undefined);
  assert.equal(discussionOnlyStatus.last_comment_at, undefined);
  assert.equal(discussionOnlyStatus.discussion_count, 1);
  assert.equal(discussionOnlyStatus.unresolved_discussion_count, 1);
  assert.equal(discussionOnlyStatus.last_discussion_at, '2026-07-02T03:30:00.000Z');
  assert.deepEqual(calls, [
    ['--ticket-comments', 'K-7'],
    ['--mr-diff', 'K-7'],
    ['--mr-branch', 'K-7'],
    ['--mr-status', 'K-7'],
  ]);
  const fallbackCalls = [];
  const fallbackStatus = await integrationAdapters.gitlabAdapter.mergeRequestStatus({
    async runScript(args) {
      fallbackCalls.push(args);
      if (args[0] === '--mr-status') {
        throw new Error('gitlab_api.py --mr-status K-8 failed: unrecognized arguments: --mr-status');
      }
      return JSON.stringify({ mr: { state: 'closed', review_status: 'changes_requested', web_url: 'https://gitlab.example/mr/8' } });
    },
  }, 'K-8');
  assert.equal(fallbackStatus.state, 'closed');
  assert.equal(fallbackStatus.review_status, 'changes_requested');
  assert.deepEqual(fallbackCalls, [
    ['--mr-status', 'K-8'],
    ['--mr-diff', 'K-8'],
  ]);
  const stdoutFallbackCalls = [];
  const stdoutFallbackStatus = await integrationAdapters.gitlabAdapter.mergeRequestStatus({
    async runScript(args) {
      stdoutFallbackCalls.push(args);
      if (args[0] === '--mr-status') {
        return 'usage: gitlab_api.py [-h]\nerror: unrecognized arguments: --mr-status K-9';
      }
      return JSON.stringify({ mr: { state: 'merged', approved: true } });
    },
  }, 'K-9');
  assert.equal(stdoutFallbackStatus.state, 'merged');
  assert.equal(stdoutFallbackStatus.review_status, 'approved');
  assert.deepEqual(stdoutFallbackCalls, [
    ['--mr-status', 'K-9'],
    ['--mr-diff', 'K-9'],
  ]);
  await assert.rejects(
    () => integrationAdapters.gitlabAdapter.mergeRequestStatus({
      runScript: async () => JSON.stringify({ error: 'not found' }),
    }, 'K-404'),
    /not found/
  );
  await assert.rejects(
    () => integrationAdapters.gitlabAdapter.mergeRequestStatus({
      async runScript(args) {
        if (args[0] === '--mr-status') {
          throw new Error('gitlab_api.py --mr-status K-500 failed: upstream timeout');
        }
        return JSON.stringify({ mr: { state: 'merged' } });
      },
    }, 'K-500'),
    /upstream timeout/
  );
  assert.deepEqual(await integrationAdapters.jiraAdapter.ticketComments({
    runScript: async () => JSON.stringify({
      comments: [
        'plain text',
        null,
        { body: ' hello ', author: { displayName: ' Ada ' }, created: ' 2026-07-01 ' },
        { renderedBody: 'rendered', author: { name: 'jira-user' }, authorName: ' A. User ' },
        { body: 42 },
      ],
    }),
  }, 'K-8'), [
    { body: 'plain text' },
    { body: '' },
    { author: 'Ada', created: '2026-07-01', body: 'hello' },
    { author: 'jira-user', authorName: 'A. User', body: 'rendered' },
    { body: '' },
  ]);
  assert.deepEqual(await integrationAdapters.jiraAdapter.ticketComments({
    runScript: async () => JSON.stringify({ comments: 'bad' }),
  }, 'K-8'), []);
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: { state: 'open', approved: true, author: { name: 'Ada' }, branch: ' feature/K-8 ' },
    discussions: [
      { id: 'd1', notes: [{ body: 'Looks good', created_at: '2026-07-02T03:00:00.000Z', resolvable: true, resolved: true }] },
      { id: 'd2', notes: [{ body: 'Needs tests', created_at: '2026-07-02T04:00:00.000Z', resolvable: true, resolved: false }] },
    ],
  }), {
    state: 'opened',
    review_status: 'approved',
    author: 'Ada',
    branch: 'feature/K-8',
    discussion_count: 2,
    unresolved_discussion_count: 1,
    resolved_discussion_count: 1,
    last_discussion_at: '2026-07-02T04:00:00.000Z',
    discussions_resolved: false,
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: { state: 'reopened', approved: false, review_status: 'approval required' },
  }), {
    state: 'opened',
    review_status: 'pending_review',
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: { state: 'locked', review_status: 'requested changes' },
  }), {
    state: 'opened',
    review_status: 'changes_requested',
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: {
      state: 'opened',
      review_status: 'pending_review',
      user_notes_count: '3',
      last_note_at: '2026-07-02T04:00:00.000Z',
    },
  }), {
    state: 'opened',
    review_status: 'pending_review',
    comment_count: 3,
    last_comment_at: '2026-07-02T04:00:00.000Z',
  });
  const paginatedStatus = integrationAdapters.normalizeMergeRequestStatus({
    mr: {
      state: 'opened',
      review_status: 'pending_review',
      user_notes_count: 9,
      last_note_at: '2026-07-02T05:00:00.000Z',
      last_discussion_updated_at: '2026-07-02T06:00:00.000Z',
    },
    comments: [
      { body: 'older visible page', created_at: '2026-07-02T03:00:00.000Z' },
    ],
    discussions: [
      { notes: [{ body: 'resolved earlier', created_at: '2026-07-02T04:00:00.000Z', resolvable: true, resolved: true }] },
    ],
  });
  assert.equal(paginatedStatus.comment_count, 9);
  assert.equal(paginatedStatus.comments.length, 1);
  assert.equal(paginatedStatus.last_comment_at, '2026-07-02T05:00:00.000Z');
  assert.equal(paginatedStatus.last_discussion_at, '2026-07-02T06:00:00.000Z');
  const newestFirstStatus = integrationAdapters.normalizeMergeRequestStatus({
    comments: [
      { id: 'new', body: 'newest first', created_at: '2026-07-02T07:00:00.000Z' },
      { id: 'old', body: 'older second', created_at: '2026-07-02T06:00:00.000Z' },
    ],
  });
  assert.deepEqual(newestFirstStatus.comments.map(comment => comment.id), ['old', 'new']);
  assert.equal(newestFirstStatus.last_comment_at, '2026-07-02T07:00:00.000Z');
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: {
      state: 'opened',
      review_status: 'pending_review',
      discussions_count: '3',
      unresolved_discussions_count: '0',
      resolved_discussions_count: '3',
      last_discussion_updated_at: '2026-07-02T06:00:00.000Z',
      blocking_discussions_resolved: true,
    },
  }), {
    state: 'opened',
    review_status: 'pending_review',
    discussion_count: 3,
    unresolved_discussion_count: 0,
    resolved_discussion_count: 3,
    last_discussion_at: '2026-07-02T06:00:00.000Z',
    discussions_resolved: true,
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: {
      state: 'opened',
      review_status: 'pending_review',
      last_activity_at: '2026-07-02T05:00:00.000Z',
    },
  }), {
    state: 'opened',
    review_status: 'pending_review',
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    comments: ['plain', { body: 42 }],
  }).comments, [{ body: 'plain' }, { body: '' }]);
  await assert.rejects(
    () => integrationAdapters.jiraAdapter.ticketComments({ runScript: async () => 'not json' }, 'K-8'),
    /Invalid JSON from Jira comments/
  );

  const malformedDiff = await integrationAdapters.gitlabAdapter.mergeRequestDiff({
    runScript: async () => JSON.stringify({
      mr: 'not an object',
      files: [null, 'src/raw.ts', { path: 42, diff: '@@ diff only @@' }, { path: './src/good.ts', diff: { bad: true }, deleted_file: true }],
    }),
  }, 'K-9');
  assert.deepEqual(malformedDiff.mr, {});
  assert.deepEqual(malformedDiff.files, [
    { path: 'src/raw.ts' },
    { diff: '@@ diff only @@' },
    { path: 'src/good.ts', deleted_file: true },
  ]);
  const nullDiff = await integrationAdapters.gitlabAdapter.mergeRequestDiff({ runScript: async () => 'null' }, 'K-10');
  assert.deepEqual(nullDiff.mr, {});
  assert.deepEqual(nullDiff.files, []);
  assert.equal(await integrationAdapters.gitlabAdapter.mergeRequestBranch({ runScript: async () => JSON.stringify({ branch: ' feature/K-8 ' }) }, 'K-8'), 'feature/K-8');
  assert.equal(await integrationAdapters.gitlabAdapter.mergeRequestBranch({ runScript: async () => 'null' }, 'K-8'), 'K-8');
  const originalRunPipelineJson = scriptClient.runPipelineJson;
  try {
    scriptClient.runPipelineJson = async () => ({
      branches: [
        null,
        '',
        ' develop ',
        { name: ' feature/K-7 ', isMain: true, status: { qualityGateStatus: ' OK ' } },
        { name: 42, status: { qualityGateStatus: 'ERROR' } },
        { name: 'broken-status', status: { qualityGateStatus: 12 } },
      ],
    });
    assert.deepEqual(await integrationAdapters.sonarAdapter.branches('app'), {
      branches: [
        { name: 'develop', isMain: false },
        { name: 'feature/K-7', isMain: true, status: { qualityGateStatus: 'OK' } },
        { name: 'broken-status', isMain: false },
      ],
    });
    scriptClient.runPipelineJson = async () => ({ branches: { branches: [] } });
    assert.deepEqual(await integrationAdapters.sonarAdapter.branches('app'), { branches: [] });
  } finally {
    scriptClient.runPipelineJson = originalRunPipelineJson;
  }

  await assert.rejects(
    () => integrationAdapters.gitlabAdapter.mergeRequestDiff({ runScript: async () => '{"error":"not found"}' }, 'K-8'),
    /not found/
  );
  await assert.rejects(
    () => integrationAdapters.gitlabAdapter.mergeRequestDiff({ runScript: async () => 'not json' }, 'K-8'),
    /Invalid JSON from MR diff/
  );
});

test('integration adapters keep raw provider payloads unknown until normalized', () => {
  const source = readSourceFixture('src', 'services', 'integrationAdapters.ts');
  for (const marker of [
    'gate(sonarKey: string, branch: string): Promise<unknown>',
    'measures(sonarKey: string, branch: string): Promise<unknown>',
    'issues(sonarKey: string, branch: string): Promise<unknown>',
    'return runPipelineJson<unknown>',
    "import { parseJsonWithLabel } from './jsonFiles'",
    'parseJsonWithLabel(await runner.runScript',
    'catch (e: unknown)',
    "import { isRecord } from './records'",
    "import { unknownErrorMessage } from './errorUtils'",
    'async function runMergeRequestStatusJson',
    "runner.runScript(['--mr-status', ticketKey], options)",
    "runner.runScript(['--mr-diff', ticketKey], options)",
    'function isUnsupportedMergeRequestStatusCommand',
    'function isUnsupportedMergeRequestStatusText',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'Promise<any>',
    'runPipelineJson<any>',
    'function parseJson(raw: string, label: string)',
    'catch (e: any)',
    'e?.message',
    'value is Record<string, any>',
    'function unknownErrorMessage(error: unknown',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('integration manifest reports missing, valid, and malformed manifests', () => {
  const missingPath = path.join(process.env.KRONOS_DIR, 'missing-manifest.json');
  const missing = integrationManifest.readIntegrationManifest(missingPath);
  assert.equal(missing.present, false);
  assert.equal(missing.valid, true);
  assert.ok(missing.warnings.some(w => w.includes('not found')));

  const manifestPath = path.join(process.env.KRONOS_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, `\ufeff${JSON.stringify({
    version: '1.0.0',
    scripts: {
      'kronos_state.py': { version: '1.0.0', required: true },
      'pipeline_monitor.py': { version: '1.0.0', required: true },
      'gitlab_api.py': { version: '1.0.0', required: true },
    },
    prompts: {
      'implement-system': {
        required: true,
        sha256: 'abc',
        smoke_tests: [{ name: 'basic', variables: { TICKET_KEY: 'K-1' }, mustContain: ['K-1'], mustNotContain: ['{{'] }],
      },
    },
    providers: {
      gitlab: { enabled: true, baseUrl: 'https://gitlab.example' },
    },
  }, null, 2)}`);
  const valid = integrationManifest.readIntegrationManifest(manifestPath);
  assert.equal(valid.present, true);
  assert.equal(valid.valid, true);
  assert.equal(valid.warnings.length, 0);

  const badPath = path.join(process.env.KRONOS_DIR, 'bad-manifest.json');
  fs.writeFileSync(badPath, JSON.stringify({ scripts: [], prompts: { alpha: { smoke_tests: { name: 'bad' } } } }));
  const bad = integrationManifest.readIntegrationManifest(badPath);
  assert.equal(bad.present, true);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some(e => e.includes('manifest.scripts')));
  assert.ok(bad.errors.some(e => e.includes('smoke_tests')));

  const invalidPromptPath = path.join(process.env.KRONOS_DIR, 'bad-prompt-manifest.json');
  fs.writeFileSync(invalidPromptPath, JSON.stringify({ scripts: {}, prompts: { '../outside': { required: true } } }));
  const invalidPrompt = integrationManifest.readIntegrationManifest(invalidPromptPath);
  assert.equal(invalidPrompt.valid, false);
  assert.ok(invalidPrompt.errors.some(e => e.includes('invalid prompt name')));

  const invalidJsonPath = path.join(process.env.KRONOS_DIR, 'invalid-json-manifest.json');
  fs.writeFileSync(invalidJsonPath, '{bad json');
  const invalidJson = integrationManifest.readIntegrationManifest(invalidJsonPath);
  assert.equal(invalidJson.present, true);
  assert.equal(invalidJson.valid, false);
  assert.match(invalidJson.errors[0], /Unexpected token|Expected property name/);

  const source = readSourceFixture('src', 'services', 'integrationManifest.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Could not parse integration manifest.')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('integration manifest audits script and prompt SHA-256 drift', () => {
  const scriptDir = process.env.KRONOS_SCRIPTS_DIR;
  const promptDir = path.join(process.env.KRONOS_DIR, 'prompts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(promptDir, { recursive: true });

  const scriptContents = {
    'kronos_state.py': 'print("state")\n',
    'pipeline_monitor.py': 'print("pipeline")\n',
    'gitlab_api.py': 'print("gitlab")\n',
  };
  for (const [name, content] of Object.entries(scriptContents)) {
    fs.writeFileSync(path.join(scriptDir, name), content);
  }
  const promptContent = 'Implement {{TICKET_KEY}}\n';
  fs.writeFileSync(path.join(promptDir, 'implement-system.md'), promptContent);

  const manifestPath = path.join(process.env.KRONOS_DIR, 'hash-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    scripts: Object.fromEntries(Object.entries(scriptContents).map(([name, content]) => [
      name,
      { version: '1.0.0', required: true, sha256: sha256(content) },
    ])),
    prompts: {
      'implement-system': { required: true, sha256: sha256(promptContent) },
    },
  }, null, 2));

  const status = integrationManifest.readIntegrationManifest(manifestPath);
  const audit = integrationManifest.auditIntegrationManifest(status, { promptDir });
  assert.equal(audit.status, 'pass');
  assert.equal(audit.artifacts.filter(artifact => artifact.status === 'pass').length, 4);

  fs.writeFileSync(path.join(scriptDir, 'gitlab_api.py'), 'print("changed")\n');
  const drifted = integrationManifest.auditIntegrationManifest(status, { promptDir });
  assert.equal(drifted.status, 'fail');
  assert.ok(drifted.artifacts.some(artifact =>
    artifact.kind === 'script' &&
    artifact.name === 'gitlab_api.py' &&
    artifact.status === 'fail' &&
    artifact.detail.includes('does not match')
  ));
});

test('integration manifest snapshot writes current script and prompt hashes', () => {
  const scriptDir = process.env.KRONOS_SCRIPTS_DIR;
  const promptDir = path.join(process.env.KRONOS_DIR, 'snapshot-prompts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.mkdirSync(promptDir, { recursive: true });

  const scriptContents = {
    'kronos_state.py': 'print("snapshot-state")\n',
    'pipeline_monitor.py': 'print("snapshot-pipeline")\n',
    'gitlab_api.py': 'print("snapshot-gitlab")\n',
  };
  for (const [name, content] of Object.entries(scriptContents)) {
    fs.writeFileSync(path.join(scriptDir, name), content);
  }
  const promptContent = 'Snapshot prompt\n';
  fs.writeFileSync(path.join(promptDir, 'alpha.md'), promptContent);

  const filePath = path.join(process.env.KRONOS_DIR, 'snapshot-manifest.json');
  const result = integrationManifest.writeIntegrationManifestSnapshot({ filePath, promptDir, version: 'test-snapshot' });
  const persisted = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  assert.equal(result.path, filePath);
  assert.equal(result.audit.status, 'pass');
  assert.equal(persisted.version, 'test-snapshot');
  assert.equal(persisted.scripts['kronos_state.py'].sha256, sha256(scriptContents['kronos_state.py']));
  assert.equal(persisted.prompts.alpha.sha256, sha256(promptContent));
});

test('provider reachability probes configured endpoints without secrets', async () => {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (req.method === 'HEAD' && pathname === '/head-ok') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (req.method === 'HEAD' && pathname === '/head-blocked') {
      res.statusCode = 405;
      res.end();
      return;
    }
    if (req.method === 'GET' && pathname === '/head-blocked') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }
    res.statusCode = 500;
    res.end('bad');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    const results = await providerReachability.probeProviderReachability([
      { name: 'Local HEAD', enabled: true, url: `http://127.0.0.1:${port}/head-ok?token=secret` },
      { name: 'Local GET fallback', enabled: true, url: `http://127.0.0.1:${port}/head-blocked` },
      { name: 'Missing URL', enabled: true },
      { name: 'Disabled Provider', enabled: false },
      { name: 'Bad Scheme', enabled: true, url: 'ftp://example.test' },
    ], { timeoutMs: 1000 });

    assert.equal(results.find(result => result.name === 'Local HEAD').status, 'pass');
    assert.equal(results.find(result => result.name === 'Local GET fallback').status, 'pass');
    assert.equal(results.find(result => result.name === 'Missing URL').status, 'warn');
    assert.equal(results.find(result => result.name === 'Disabled Provider').status, 'pass');
    assert.equal(results.find(result => result.name === 'Bad Scheme').status, 'fail');
    assert.doesNotMatch(results.find(result => result.name === 'Local HEAD').detail, /secret/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('provider reachability keeps request and URL errors unknown', () => {
  const source = readSourceFixture('src', 'services', 'providerReachability.ts');
  assert.equal((source.match(/catch \(e: unknown\)/g) || []).length, 2);
  for (const marker of [
    "unknownErrorMessage(e, 'Reachability check failed.')",
    "unknownErrorMessage(e, 'Invalid provider URL.')",
    "import { unknownErrorMessage } from './errorUtils'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    'function unknownErrorMessage(error: unknown',
    "Reflect.get(error, 'message')",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('doctor checks centralize command, credential, project config, and reachability inputs', async () => {
  fs.writeFileSync(path.join(process.env.KRONOS_SCRIPTS_DIR, 'kronos_state.py'), 'print("{}")\n');
  const state = baseState({
    'K-1': ticket({ summary: 'Doctor ticket' }),
  });
  state.projects.app.config = {
    default_branch: 'main',
    gitlab_project_id: 42,
    sonar_project_key: 'app-key',
  };
  const profile = profileManager.resolveProfile('enterprise-gitlab-jira');
  const env = {
    JIRA_BASE_URL: 'https://jira.example',
    JIRA_EMAIL: 'dev@example.com',
    JIRA_API_TOKEN: 'jira-secret',
    Path: 'C:\\Tools\\Google Cloud SDK\\bin',
    GITLAB_TOKEN: 'gitlab-secret',
    GITLAB_HOST: 'gitlab.example',
    SONAR_HOST_URL: 'https://sonar.example',
  };
  const gcloudCmd = 'C:\\Tools\\Google Cloud SDK\\bin\\gcloud.cmd';
  const commandRunner = (command, args) => {
    const joined = mockCommandLine(command, args);
    if (joined === 'python --version') { return 'Python 3.12.0\n'; }
    if (command === 'python' && String(args[0]).endsWith('kronos_state.py') && args[1] === '--mr-status') {
      return JSON.stringify({
        mr: {
          state: 'opened',
          review_status: 'pending_review',
          comment_count: 0,
          discussion_count: 0,
          unresolved_discussion_count: 0,
          discussions_resolved: true,
        },
      });
    }
    if (joined === 'git --version') { return 'git version 2.45.0\n'; }
    if (joined === 'claude --version') { return 'claude 1.2.3\n'; }
    if (joined === 'gcloud --version') { return 'Google Cloud SDK 500.0.0\n'; }
    if (joined === 'gcloud auth application-default print-access-token') { return 'token-value\n'; }
    throw new Error(`unexpected command ${joined}`);
  };

  const checks = doctorChecks.runDoctorChecks({
    state,
    queue: { items: [{ id: '1', ticket: 'K-1', projects: ['app'], project_path: '/repo/app', action: 'verify', priority_score: 1, reason: 'test' }], last_computed: null },
    profile,
    requiredPrompts: [],
    dispatchModel: 'bad model ; rm',
    env,
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const byName = Object.fromEntries(checks.map(check => [check.name, check]));

  assert.equal(byName.Python.status, 'pass');
  assert.equal(byName['Claude CLI compatible version'].status, 'pass');
  assert.equal(byName['GCP application default auth'].status, 'pass');
  assert.equal(byName['Jira credentials'].status, 'pass');
  assert.doesNotMatch(byName['Jira credentials'].detail, /jira-secret/);
  assert.equal(byName['Jenkins credentials'].status, 'warn');
  assert.match(byName['Jenkins credentials'].detail, /missing JENKINS_URL/);
  assert.equal(byName['GitHub Actions credentials'].status, 'pass');
  assert.match(byName['GitHub Actions credentials'].detail, /Provider disabled/);
  assert.equal(byName['Project config completeness'].status, 'warn');
  assert.match(byName['Project config completeness'].detail, /app: missing jenkins_url/);
  assert.equal(byName['queue.json parse'].detail, '1 queue item(s)');
  assert.equal(byName['Session store integrity'].status, 'pass');
  assert.equal(byName['Dispatch model setting'].status, 'fail');
  assert.equal(byName['Review MR polling prerequisites'].status, 'pass');
  assert.match(byName['Review MR polling prerequisites'].detail, /No open review merge requests/);

  const reviewState = baseState({
    'K-REVIEW': ticket({
      summary: 'Review ticket',
      next_action: 'await_review',
      projects: ['app'],
      mr: { iid: 7, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/7' },
    }),
  });
  reviewState.projects.app.config = { default_branch: 'main', gitlab_project_id: 42 };
  const reviewChecks = doctorChecks.runDoctorChecks({
    state: reviewState,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const reviewByName = Object.fromEntries(reviewChecks.map(check => [check.name, check]));
  assert.equal(reviewByName['Review MR polling prerequisites'].status, 'pass');
  assert.match(reviewByName['Review MR polling prerequisites'].detail, /1 open review MR\(s\) ready/);
  assert.match(reviewByName['Review MR polling prerequisites'].detail, /--mr-status contract OK for K-REVIEW/);

  const staleContractChecks = doctorChecks.runDoctorChecks({
    state: reviewState,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner: (command, args, options) => {
      if (command === 'python' && String(args[0]).endsWith('kronos_state.py') && args[1] === '--mr-status') {
        return JSON.stringify({ mr: { state: 'opened' } });
      }
      return commandRunner(command, args, options);
    },
    kronosDir: process.env.KRONOS_DIR,
  });
  const staleContractByName = Object.fromEntries(staleContractChecks.map(check => [check.name, check]));
  assert.equal(staleContractByName['Review MR polling prerequisites'].status, 'warn');
  assert.match(staleContractByName['Review MR polling prerequisites'].detail, /--mr-status K-REVIEW missing review_status or approved flag/);
  assert.match(staleContractByName['Review MR polling prerequisites'].detail, /comment metadata/);
  assert.match(staleContractByName['Review MR polling prerequisites'].detail, /discussion metadata/);

  const blockedReviewState = baseState({
    'K-BLOCKED': ticket({
      summary: 'Blocked review ticket',
      next_action: 'await_review',
      projects: ['app'],
      mr: { iid: 8, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/8' },
    }),
  });
  blockedReviewState.projects.app.config = { default_branch: 'main' };
  const blockedReviewChecks = doctorChecks.runDoctorChecks({
    state: blockedReviewState,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { ...env, GITLAB_TOKEN: undefined },
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const blockedReviewByName = Object.fromEntries(blockedReviewChecks.map(check => [check.name, check]));
  assert.equal(blockedReviewByName['Review MR polling prerequisites'].status, 'warn');
  assert.match(blockedReviewByName['Review MR polling prerequisites'].detail, /missing GITLAB_TOKEN/);
  assert.match(blockedReviewByName['Review MR polling prerequisites'].detail, /K-BLOCKED\/app: missing gitlab_project_id/);

  let targets = [];
  const reachabilityChecks = await doctorChecks.runDoctorReachabilityChecks({
    state,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    commandRunner,
  }, {
    timeoutMs: 1234,
    manifest: {
      providers: {
        jira: { baseUrl: 'https://manifest-jira.example' },
        gitlab: { baseUrl: 'https://manifest-gitlab.example' },
        jenkins: { baseUrl: 'https://manifest-jenkins.example' },
        sonar: { baseUrl: 'https://manifest-sonar.example' },
      },
    },
    providerProbe: async (providerTargets, options) => {
      targets = providerTargets;
      assert.equal(options.timeoutMs, 1234);
      return providerTargets.map(target => ({
        name: target.name,
        status: 'pass',
        detail: target.url || 'Provider disabled by active profile.',
      }));
    },
  });
  assert.equal(reachabilityChecks.find(check => check.name === 'Jira network reachability').detail, 'https://jira.example');
  assert.equal(targets.find(target => target.name === 'Jira network reachability').url, 'https://jira.example');
  assert.equal(targets.find(target => target.name === 'GitLab network reachability').url, 'gitlab.example');
  assert.equal(targets.find(target => target.name === 'Jenkins network reachability').url, 'https://manifest-jenkins.example');
  assert.equal(targets.find(target => target.name === 'SonarQube network reachability').url, 'https://sonar.example');
  assert.equal(targets.find(target => target.name === 'GitHub API network reachability').enabled, false);

  const githubProfile = profileManager.resolveProfile('github-actions');
  const githubState = baseState({ 'GH-1': ticket({ summary: 'Actions ticket' }) });
  githubState.projects.app.config = { default_branch: 'main' };
  const githubChecks = doctorChecks.runDoctorChecks({
    state: githubState,
    queue: null,
    profile: githubProfile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { GH_TOKEN: 'github-secret', GITHUB_API_URL: 'https://github.enterprise.example/api/v3' },
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const githubByName = Object.fromEntries(githubChecks.map(check => [check.name, check]));
  assert.equal(githubByName['GitHub Actions credentials'].status, 'pass');
  assert.doesNotMatch(githubByName['GitHub Actions credentials'].detail, /github-secret/);
  assert.match(githubByName['Project config completeness'].detail, /app: missing github_repository/);
  githubState.projects.app.config.github_repository = 'owner/app';
  const completeGithubChecks = doctorChecks.runDoctorChecks({
    state: githubState,
    queue: null,
    profile: githubProfile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { GH_TOKEN: 'github-secret', GITHUB_API_URL: 'https://github.enterprise.example/api/v3' },
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  assert.equal(Object.fromEntries(completeGithubChecks.map(check => [check.name, check]))['Project config completeness'].status, 'pass');
  let githubTargets = [];
  await doctorChecks.runDoctorReachabilityChecks({
    state: githubState,
    queue: null,
    profile: githubProfile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { GITHUB_API_URL: 'https://github.enterprise.example/api/v3' },
    commandRunner,
  }, {
    providerProbe: async providerTargets => {
      githubTargets = providerTargets;
      return providerTargets.map(target => ({
        name: target.name,
        status: 'pass',
        detail: target.url || 'Provider disabled by active profile.',
      }));
    },
  });
  assert.equal(githubTargets.find(target => target.name === 'GitHub API network reachability').enabled, true);
  assert.equal(githubTargets.find(target => target.name === 'GitHub API network reachability').url, 'https://github.enterprise.example/api/v3');

  const warningChecks = doctorChecks.runDoctorChecks({
    state,
    queue: null,
    stateLoadErrors: [
      { target: 'state.json', filePath: '/tmp/kronos/state.json', detail: 'project app config.gitlab_project_id was coerced to a number.' },
    ],
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const warningByName = Object.fromEntries(warningChecks.map(check => [check.name, check]));
  assert.equal(warningByName['state.json parse'].status, 'warn');
  assert.match(warningByName['state.json parse'].detail, /gitlab_project_id was coerced/);

  const loadErrorChecks = doctorChecks.runDoctorChecks({
    state: null,
    queue: null,
    stateLoadErrors: [
      { target: 'state.json', filePath: '/tmp/kronos/state.json', detail: 'state.json must be an object' },
      { target: 'queue.json', filePath: '/tmp/kronos/queue.json', detail: 'Unexpected token }' },
    ],
    sessionStoreIssues: [
      { kind: 'invalid_saved_session', filePath: '/tmp/kronos/sessions/bad.json', detail: 'Saved session events must be an array.' },
      { kind: 'invalid_session_stats', filePath: '/tmp/kronos/stats.json', detail: 'stats.sessions must be an array.' },
    ],
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const loadErrorByName = Object.fromEntries(loadErrorChecks.map(check => [check.name, check]));
  assert.equal(loadErrorByName['state.json parse'].status, 'fail');
  assert.match(loadErrorByName['state.json parse'].detail, /state\.json must be an object/);
  assert.equal(loadErrorByName['Project config completeness'].status, 'fail');
  assert.equal(loadErrorByName['queue.json parse'].status, 'fail');
  assert.match(loadErrorByName['queue.json parse'].detail, /Unexpected token/);
  assert.equal(loadErrorByName['Session store integrity'].status, 'warn');
  assert.match(loadErrorByName['Session store integrity'].detail, /invalid_saved_session/);
  assert.match(loadErrorByName['Session store integrity'].detail, /invalid_session_stats/);
  assert.equal(loadErrorByName['Review MR polling prerequisites'].status, 'warn');
  assert.match(loadErrorByName['Review MR polling prerequisites'].detail, /No readable state loaded/);

  const fallbackChecks = doctorChecks.runDoctorChecks({
    state,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    platform: 'win32',
    gcloudExistsSync: filePath => filePath === gcloudCmd,
    commandRunner: (command, args) => {
      const joined = mockCommandLine(command, args);
      if (joined === 'python --version') { throw { message: '   ' }; }
      if (joined === 'claude --version') { throw { message: '   ' }; }
      if (joined === 'gcloud auth application-default print-access-token') { throw { message: '   ' }; }
      return commandRunner(command, args);
    },
    kronosDir: process.env.KRONOS_DIR,
  });
  const fallbackByName = Object.fromEntries(fallbackChecks.map(check => [check.name, check]));
  assert.equal(fallbackByName.Python.detail, 'python unavailable');
  assert.equal(fallbackByName['Claude CLI compatible version'].detail, 'claude unavailable');
  assert.equal(fallbackByName['GCP application default auth'].detail, 'Auth check failed');

  const source = readSourceFixture('src', 'services', 'doctorChecks.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    "unknownErrorMessage(e, 'Could not read prompt directory')",
    "unknownErrorMessage(e, 'Auth check failed')",
    "unknownErrorMessage(e, 'Provider reachability checks failed.')",
    "unknownErrorMessage(e, `${command} unavailable`)",
    "unknownErrorMessage(e, 'claude unavailable')",
    "import { normalizeMergeRequestStatus } from './integrationAdapters'",
    "import { parseJsonWithLabel } from './jsonFiles'",
    'function addReviewPollingPrerequisiteCheck',
    'function reviewMergeRequestStatusContractIssue',
    'function hasMergeRequestCommentSignal',
    'function hasMergeRequestDiscussionSignal',
    'parseJsonWithLabel(raw, `MR status for ${ticketKey}`)',
    "'Review MR polling prerequisites'",
    "ticket.next_action === 'await_review' && ticket.mr?.state === 'opened'",
    "commandRunner('python', [scriptPath, '--mr-status', ticketKey]",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('doctor checks skip gcloud commands when GOOGLE_APPLICATION_CREDENTIALS is readable', () => {
  const credentialsDir = makeTempDir('kronos-gac-doctor-');
  const credentialsPath = path.join(credentialsDir, 'credentials.json');
  fs.writeFileSync(credentialsPath, '{}');
  const calls = [];
  const commandRunner = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'python') { return 'Python 3.12.0\n'; }
    if (command === 'git') { return 'git version 2.45.0\n'; }
    if (command === 'claude') { return 'claude 1.2.3\n'; }
    throw new Error(`unexpected command ${command}`);
  };

  const checks = doctorChecks.runDoctorChecks({
    state: baseState({ 'K-GAC': ticket({ summary: 'GAC ticket' }) }),
    queue: null,
    profile: profileManager.resolveProfile('personal-local'),
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { GOOGLE_APPLICATION_CREDENTIALS: credentialsPath },
    commandRunner,
    kronosDir: process.env.KRONOS_DIR,
  });
  const byName = Object.fromEntries(checks.map(check => [check.name, check]));

  assert.equal(byName['GCloud CLI'].status, 'pass');
  assert.match(byName['GCloud CLI'].detail, /Skipped because GOOGLE_APPLICATION_CREDENTIALS/);
  assert.equal(byName['GCP application default auth'].status, 'pass');
  assert.match(byName['GCP application default auth'].detail, /skipped gcloud token command/);
  assert.equal(calls.some(call => call.includes('gcloud')), false);
});

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

test('profile manager resolves built-in profiles and base branches safely', () => {
  const profiles = profileManager.listProfiles();
  assert.ok(profiles.some(profile => profile.id === 'enterprise-gitlab-jira'));
  assert.equal(profileManager.resolveProfile('personal-local').defaultBaseBranch, 'main');
  assert.equal(profileManager.resolveProfile('missing').id, 'enterprise-gitlab-jira');
  assert.equal(profileManager.resolveDefaultBaseBranch('personal-local'), 'main');
  assert.equal(profileManager.resolveDefaultBaseBranch('personal-local', 'origin/release/2026.07'), 'release/2026.07');
  assert.equal(profileManager.sanitizeBranch('../bad'), undefined);
});

test('safety gate classifies risk, confirmation, and operator prompt text', () => {
  const readOnly = safetyGate.assessSafetyGate({
    operationId: 'kronos.openDashboard',
    title: 'Open Dashboard',
    risks: ['read-only'],
    changes: ['Open a read-only panel.'],
  });
  assert.equal(readOnly.requiresConfirmation, false);
  assert.equal(readOnly.requiresWorkspaceTrust, false);
  assert.equal(readOnly.workspaceTrustSummary, 'change Kronos state');
  assert.equal(readOnly.modal, false);
  assert.equal(readOnly.highestRisk, 'read-only');
  assert.equal(readOnly.operationId, 'kronos.openDashboard');

  const destructive = safetyGate.assessSafetyGate({
    operationId: 'kronos.cleanupWorktrees',
    title: 'Cleanup Stale Worktrees',
    target: '2 clean / 1 blocked',
    risks: ['state-write', 'destructive', 'repo-write'],
    changes: ['Remove clean worktrees.', 'Leave dirty worktrees untouched.'],
    warnings: ['Dry-run result controls removal.'],
    confirmationLabel: 'Remove Clean Worktrees',
  });
  assert.equal(destructive.requiresConfirmation, true);
  assert.equal(destructive.requiresWorkspaceTrust, true);
  assert.equal(destructive.modal, true);
  assert.equal(destructive.highestRisk, 'destructive');
  assert.equal(destructive.operationId, 'kronos.cleanupWorktrees');
  assert.deepEqual(destructive.risks, ['destructive', 'repo-write', 'state-write']);
  assert.equal(destructive.confirmationLabel, 'Remove Clean Worktrees');
  assert.equal(destructive.workspaceTrustSummary, 'remove files or clean managed worktrees');
  assert.match(destructive.message, /Kronos Safety Gate: Cleanup Stale Worktrees/);
  assert.match(destructive.message, /Highest risk: destructive/);
  assert.match(destructive.message, /Remove clean worktrees/);
  assert.match(destructive.message, /Dry-run result controls removal/);
});

test('acceptance criteria extractor handles AC lines, bullets, and Given/When/Then blocks', () => {
  const description = `Context before

Acceptance Criteria
- User can retry checkout after timeout
1. Timeout errors are logged with request id

AC3: Duplicate criteria are ignored
AC4: Duplicate criteria are ignored

Given a user has a stale session
When they retry checkout
Then the request is accepted`;

  const criteria = acceptanceCriteria.extractAcceptanceCriteria(description, [
    { id: 'existing', text: 'User can retry checkout after timeout', checked: true },
  ]);

  assert.equal(criteria.length, 4);
  assert.equal(criteria[0].id, 'existing');
  assert.equal(criteria[0].checked, true);
  assert.ok(criteria.some(item => item.text === 'Timeout errors are logged with request id'));
  assert.ok(criteria.some(item => item.text === 'Given a user has a stale session When they retry checkout Then the request is accepted'));
  assert.equal(criteria.filter(item => item.text === 'Duplicate criteria are ignored').length, 1);

  const updated = acceptanceCriteria.setAcceptanceCriteriaChecked(criteria, [criteria[1].id, criteria[3].id]);
  assert.equal(updated[0].checked, false);
  assert.equal(updated[1].checked, true);
  assert.equal(updated[3].checked, true);
});

test('evidence command input helpers build mutation inputs from prompt values', () => {
  assert.deepEqual(evidenceCommandInputs.EVIDENCE_NOTE_KIND_OPTIONS.map(item => item.label), ['note', 'test', 'risk', 'decision']);
  assert.deepEqual(evidenceCommandInputs.EVIDENCE_CHECK_ENVIRONMENT_OPTIONS.map(item => item.label), ['local', 'develop', 'test', 'prod', 'n/a']);

  assert.deepEqual(evidenceCommandInputs.buildTicketEvidenceCheckInput({
    name: ' npm test ',
    result: 'pass',
    environment: 'n/a',
    command: ' npm test ',
    summary: ' ok ',
    artifactPath: ' /tmp/test.log ',
    confidence: 'high',
  }), {
    name: 'npm test',
    result: 'pass',
    command: ' npm test ',
    summary: ' ok ',
    artifactPath: ' /tmp/test.log ',
    confidence: 'high',
  });

  assert.deepEqual(evidenceCommandInputs.buildTicketEvidenceCheckInput({
    name: 'Jenkins',
    result: 'warn',
    environment: 'test',
    command: '',
    summary: '',
    artifactPath: '',
    confidence: 'medium',
  }), {
    name: 'Jenkins',
    result: 'warn',
    environment: 'test',
    command: '',
    summary: '',
    artifactPath: '',
    confidence: 'medium',
  });

  assert.deepEqual(evidenceCommandInputs.buildTicketEnvironmentResultInput({
    environment: 'develop',
    status: 'fail',
    detail: ' build failed ',
    artifactPath: ' https://jenkins/job/1 ',
  }), {
    environment: 'develop',
    status: 'fail',
    detail: 'build failed',
    artifactPath: ' https://jenkins/job/1 ',
  });
});

test('human review inbox aggregates runs, tickets, evidence gaps, integrations, worktrees, and duplicate queue items', () => {
  const state = baseState({
    'K-1': ticket({ projects: [], summary: 'Unlinked ticket' }),
    'K-2': ticket({ projects: ['app'], next_action: 'blocked', last_action: 'waiting on product' }),
    'K-3': ticket({ projects: ['app'], next_action: 'await_review', description: 'Acceptance Criteria\n- Must work' }),
  });
  const queue = {
    items: [
      { id: 'q1', ticket: 'K-3', projects: ['app'], project_path: '/repo/app', action: 'verify', priority_score: 10, reason: 'first' },
      { id: 'q2', ticket: 'K-3', projects: ['app'], project_path: '/repo/app', action: 'verify', priority_score: 9, reason: 'second' },
    ],
    last_computed: null,
  };

  const inbox = humanReviewInbox.buildHumanReviewInbox({
    state,
    queue,
    runs: [
      null,
      'not-a-run',
      { id: 'run-1', status: 'needs_human', project: 'app', ticket: 'K-2', skill: 'fix_build', events: [{ label: 'Process exited with code 1', detail: 'Jenkins build failed' }] },
      { id: 'run-2', status: 'completed', project: 'app' },
      { id: 'run-3', status: 'cancelled', project: 'app', ticket: 'K-3', skill: 'verify', failureReason: 'operator cancelled' },
    ],
    worktreeReport: {
      results: [{
        status: 'blocked',
        reason: 'Dirty worktree',
        entry: { projectPath: '/repo/app', worktreePath: '/repo/app/.claude/worktrees/K-2', ticket: 'K-2', createdAt: 'now' },
      }],
      removable: 0,
      removed: 0,
      blocked: 1,
    },
    doctorChecks: [
      { name: 'GitLab API', status: 'fail', detail: 'missing script' },
      { name: 'Git', status: 'pass', detail: 'ok' },
    ],
  });

  assert.equal(inbox.summary.critical, 6);
  assert.equal(inbox.summary.warning, 5);
  assert.equal(inbox.summary.info, 1);
  assert.equal(inbox.items[0].severity, 'critical');
  assert.ok(inbox.items.some(item => item.id === 'run:run-1'));
  assert.ok(inbox.items.some(item => item.id === 'run:run-1' && item.detail === 'Jenkins build failed'));
  assert.ok(inbox.items.some(item => item.id === 'run:run-3' && item.detail === 'operator cancelled'));
  assert.ok(inbox.items.some(item => item.id === 'queue:duplicate:K-3'));
  assert.ok(inbox.items.some(item => item.title.includes('No evidence records')));
  assert.ok(inbox.items.some(item => item.title.includes('Acceptance criteria not extracted')));
  assert.ok(inbox.items.some(item => item.id === 'worktree:/repo/app/.claude/worktrees/K-2' && item.worktreePath === '/repo/app/.claude/worktrees/K-2'));

  const source = readSourceFixture('src', 'services', 'humanReviewInbox.ts');
  assert.ok(source.includes("import { isRunLikeRecord, type RunLikeRecord } from './runRecords'"));
  assert.ok(source.includes('const rawRuns: unknown[] = Array.isArray(input.runs) ? input.runs : []'));
  assert.ok(source.includes('const runs = rawRuns.filter(isRunLikeRecord)'));
  assert.equal(source.includes('type HumanReviewRunRecord = HumanReviewRun & Record<string, unknown>'), false);
  assert.equal(source.includes('type HumanReviewRunRecord = HumanReviewRun & Record<string, any>'), false);
  assert.equal(source.includes('function isRunRecord'), false);

  const html = humanReviewPanelView.buildHumanReviewInboxHtml(inbox, {
    tickets: state.tickets,
    nonce: 'nonce-hr',
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.ok(html.includes('Kronos Human Review Inbox'));
  assert.ok(html.includes('data-action="refreshPanel"'));
  assert.ok(html.includes('data-action="extractAcceptanceCriteria"'));
  assert.ok(html.includes('data-action="startTicket"'));
  assert.ok(html.includes('data-action="runCenter"'));
  assert.ok(html.includes('data-action="runCenter" data-run-id="run-1"'));
  assert.ok(html.includes('data-action="recoveryCenter" data-run-id="run-1"'));
  assert.ok(html.includes('/repo/app/.claude/worktrees/K-2'));
  assert.ok(html.includes('data-action="recoveryCenter" data-item-id="worktree:/repo/app/.claude/worktrees/K-2"'));
  assert.ok(html.includes('Kronos Human Review Inbox'));

  const escapedHtml = humanReviewPanelView.buildHumanReviewInboxHtml({
    summary: { critical: 1, warning: 0, info: 0, total: 1 },
    items: [{
      id: 'unsafe',
      kind: 'ticket',
      severity: 'critical',
      title: 'Unsafe <ticket>',
      detail: 'Needs & review',
      ticketKey: 'BAD-1',
    }],
  }, {
    tickets: { 'BAD-1': ticket({ projects: [] }) },
    nonce: 'nonce-escape',
    actionScriptUri: ACTION_SCRIPT_URI,
  });
  assert.ok(escapedHtml.includes('Unsafe &lt;ticket&gt;'));
  assert.ok(escapedHtml.includes('Needs &amp; review'));
  assert.ok(escapedHtml.includes('data-action="viewTicket"'));
});

test('evidence panel renderers emit safe links and action buttons', () => {
  const gateHtml = evidencePanelView.buildEvidenceGateHtml([{
    ticketKey: 'K-1',
    status: 'warn',
    ready: true,
    summary: 'Needs <proof>',
    checks: [
      { kind: 'notes', status: 'fail', title: 'No evidence records', detail: 'Add <note> & proof' },
      { kind: 'acceptance', status: 'warn', title: 'Acceptance criteria not extracted', detail: 'Run extraction' },
      { kind: 'environment', status: 'warn', title: 'Environment pending', detail: 'test: unknown' },
    ],
  }], 'Gate <unsafe>', 'nonce-evidence', ACTION_SCRIPT_URI);

  assert.ok(gateHtml.includes('Gate &lt;unsafe&gt;'));
  assert.ok(gateHtml.includes('Add &lt;note&gt; &amp; proof'));
  assert.ok(gateHtml.includes('data-action="refreshPanel"'));
  assert.ok(gateHtml.includes('data-action="addEvidence"'));
  assert.ok(gateHtml.includes('data-action="extractAcceptanceCriteria"'));
  assert.ok(gateHtml.includes('data-action="recordEnvironmentResult"'));
  assert.ok(gateHtml.includes('data-action="evidenceHandoff"'));
  assert.ok(gateHtml.includes('data-action="publishEvidence"'));
  assert.ok(gateHtml.includes('__kronosWebviewReady'));
  assert.ok(gateHtml.includes('Kronos Evidence Gate'));

  const handoffHtml = evidencePanelView.buildEvidenceHandoffHtml({
    ticketKey: 'K-1',
    summary: 'Summary <unsafe>',
    destinations: [
      { kind: 'jira', label: 'Jira <ticket>', available: true, url: 'https://jira.example/K-1?x=1&y=2', detail: 'Paste & review' },
      { kind: 'mr', label: 'Unsafe MR', available: false, url: 'javascript:alert(1)', detail: 'Bad URL' },
    ],
    exportPath: '/tmp/evidence-<unsafe>.md',
    comment: 'Comment <body> & evidence',
    manualSteps: ['Check <payload>'],
  }, 'nonce-handoff', ACTION_SCRIPT_URI);

  assert.ok(handoffHtml.includes('Summary &lt;unsafe&gt;'));
  assert.ok(handoffHtml.includes('Jira &lt;ticket&gt;'));
  assert.ok(handoffHtml.includes('Paste &amp; review'));
  assert.ok(handoffHtml.includes('Comment &lt;body&gt; &amp; evidence'));
  assert.ok(handoffHtml.includes('href="https://jira.example/K-1?x=1&amp;y=2"'));
  assert.equal(handoffHtml.includes('href="javascript:alert(1)"'), false);
  assert.ok(handoffHtml.includes('Kronos did not call a posting API'));
  assert.ok(handoffHtml.includes('data-action="publishEvidence"'));

  const publishHtml = evidencePanelView.buildEvidencePublishHtml([
    { kind: 'jira', label: 'Jira <comment>', status: 'failed', detail: 'Boom <body>', endpoint: 'https://jira.example/api?x=1&y=2', httpStatus: 500 },
    { kind: 'gitlab_mr', label: 'MR', status: 'posted', detail: 'OK & done', endpoint: 'javascript:alert(1)' },
  ], 'K-1', 'nonce-publish', ACTION_SCRIPT_URI);

  assert.ok(publishHtml.includes('Jira &lt;comment&gt;'));
  assert.ok(publishHtml.includes('Boom &lt;body&gt;'));
  assert.ok(publishHtml.includes('OK &amp; done'));
  assert.ok(publishHtml.includes('HTTP 500'));
  assert.ok(publishHtml.includes('href="https://jira.example/api?x=1&amp;y=2"'));
  assert.equal(publishHtml.includes('href="javascript:alert(1)"'), false);
  assert.ok(publishHtml.includes('data-action="evidenceHandoff"'));
});

test('evidence gate fails objective blockers and warns on incomplete proof', () => {
  const failing = evidenceGate.evaluateEvidenceGate('K-1', ticket({
    projects: [],
    next_action: 'await_review',
    description: 'Acceptance Criteria\n- Must retry checkout',
    mr: { iid: 1, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/1' },
    build: { number: 10, status: 'FAILURE', url: 'https://jenkins.example/10' },
    evidence: {
      notes: [],
      checks: [{ id: 'check-1', at: 'now', name: 'smoke checkout', result: 'fail', summary: 'timeout replay failed' }],
      environment_results: { test: { environment: 'test', status: 'fail', checked_at: 'now', detail: 'deploy smoke failed' } },
    },
  }));

  assert.equal(failing.status, 'fail');
  assert.equal(failing.ready, false);
  assert.ok(failing.checks.some(check => check.kind === 'project' && check.status === 'fail'));
  assert.ok(failing.checks.some(check => check.kind === 'notes' && check.status === 'warn' && check.title === 'No narrative evidence note'));
  assert.ok(failing.checks.some(check => check.kind === 'build' && check.status === 'fail'));
  assert.ok(failing.checks.some(check => check.kind === 'mr' && check.status === 'fail'));
  assert.ok(failing.checks.some(check => check.kind === 'test' && check.status === 'fail' && check.title.includes('evidence check')));
  assert.ok(failing.checks.some(check => check.kind === 'environment' && check.status === 'fail'));
  assert.ok(failing.checks.some(check => check.kind === 'acceptance' && check.status === 'warn'));

  const warning = evidenceGate.evaluateEvidenceGate('K-2', ticket({
    projects: ['app'],
    next_action: 'await_review',
    description: 'Acceptance Criteria\n- Must retry checkout',
    mr: { iid: 2, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/2' },
    build: { number: 11, status: 'SUCCESS', url: 'https://jenkins.example/11' },
    evidence: {
      acceptance_criteria: [{ id: 'ac-1', text: 'Must retry checkout', checked: false }],
      notes: [{ at: 'now', kind: 'note', text: 'Implemented retry' }],
    },
  }));

  assert.equal(warning.status, 'warn');
  assert.equal(warning.ready, true);
  assert.ok(warning.checks.some(check => check.kind === 'test' && check.status === 'warn'));
  assert.ok(warning.checks.some(check => check.kind === 'acceptance' && check.status === 'warn'));

  const structuredOnly = evidenceGate.evaluateEvidenceGate('K-STRUCTURED', ticket({
    projects: ['app'],
    next_action: 'await_review',
    mr: { iid: 3, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/3' },
    build: { number: 12, status: 'SUCCESS', url: 'https://jenkins.example/12' },
    evidence: {
      checks: [{ id: 'check-2', at: 'now', name: 'unit suite', result: 'pass', summary: 'passed' }],
    },
  }));
  assert.equal(structuredOnly.status, 'warn');
  assert.equal(structuredOnly.ready, true);
  assert.ok(structuredOnly.checks.some(check => check.kind === 'notes' && check.status === 'warn' && check.title === 'No narrative evidence note'));
  assert.equal(structuredOnly.checks.some(check => check.kind === 'notes' && check.status === 'fail'), false);
  assert.ok(structuredOnly.checks.some(check => check.kind === 'test' && check.status === 'pass'));

  const structuredRisk = evidenceGate.evaluateEvidenceGate('K-RISK', ticket({
    projects: ['app'],
    next_action: 'await_review',
    mr: { iid: 6, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/6' },
    build: { number: 15, status: 'SUCCESS', url: 'https://jenkins.example/15' },
    evidence: {
      notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }],
      risk_notes: [{ at: 'now', text: 'Manual QA should recheck data refresh', severity: 'medium' }],
    },
  }));
  assert.equal(structuredRisk.status, 'warn');
  assert.equal(structuredRisk.ready, true);
  assert.ok(structuredRisk.checks.some(check => check.kind === 'risk' && check.status === 'warn' && check.title === '1 risk note recorded'));

  const warningOnlyCheck = evidenceGate.evaluateEvidenceGate('K-WARN-CHECK', ticket({
    projects: ['app'],
    next_action: 'await_review',
    mr: { iid: 4, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/4' },
    build: { number: 13, status: 'SUCCESS', url: 'https://jenkins.example/13' },
    evidence: {
      notes: [{ at: 'now', kind: 'note', text: 'Implemented retry' }],
      checks: [{ id: 'check-3', at: 'now', name: 'manual smoke', result: 'warn', summary: 'manual follow-up pending' }],
    },
  }));
  assert.equal(warningOnlyCheck.status, 'warn');
  assert.equal(warningOnlyCheck.ready, true);
  assert.ok(warningOnlyCheck.checks.some(check => check.kind === 'test' && check.status === 'warn' && check.title === 'No passing test evidence'));
  assert.equal(warningOnlyCheck.checks.some(check => check.kind === 'test' && check.status === 'pass'), false);

  const unknownOnlyCheck = evidenceGate.evaluateEvidenceGate('K-UNKNOWN-CHECK', ticket({
    projects: ['app'],
    next_action: 'await_review',
    mr: { iid: 5, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/5' },
    build: { number: 14, status: 'SUCCESS', url: 'https://jenkins.example/14' },
    evidence: {
      notes: [{ at: 'now', kind: 'note', text: 'Implemented retry' }],
      checks: [{ id: 'check-4', at: 'now', name: 'probe inconclusive', result: 'unknown', summary: 'could not verify' }],
    },
  }));
  assert.equal(unknownOnlyCheck.status, 'warn');
  assert.equal(unknownOnlyCheck.ready, true);
  assert.ok(unknownOnlyCheck.checks.some(check => check.kind === 'test' && check.status === 'warn' && check.title === 'No passing test evidence'));
  assert.equal(unknownOnlyCheck.checks.some(check => check.kind === 'test' && check.status === 'pass'), false);

  const panelGates = evidenceGate.panelEvidenceGates({
    'K-FAIL': ticket({ projects: [], next_action: 'implement' }),
    'K-PASS-ACTIVE': ticket({
      projects: ['app'],
      next_action: 'implement',
      evidence: { notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }] },
    }),
    'K-PASS-DONE': ticket({
      projects: ['app'],
      next_action: 'done',
      build: { number: 16, status: 'SUCCESS', url: 'https://jenkins.example/16' },
      evidence: { notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }] },
    }),
  });
  assert.deepEqual(panelGates.map(gate => gate.ticketKey), ['K-FAIL', 'K-PASS-DONE']);
  assert.deepEqual(evidenceGate.panelEvidenceGates(undefined), []);
});

test('evidence gate tolerates malformed direct evidence entries', () => {
  const gate = evidenceGate.evaluateEvidenceGate('K-MALFORMED', ticket({
    projects: ['app'],
    next_action: 'await_review',
    description: 'Acceptance Criteria\n- Must work',
    evidence: {
      notes: [null, 'bad note', { kind: 'test', text: 'npm test passed' }],
      checks: [null, 'bad check', { name: 'unit suite', result: 'fail' }],
      acceptance_criteria: [null, 'bad criterion', { text: 'Must work', checked: true }],
      environment_results: {
        broken: null,
        local: { environment: 'local', status: 'warn', detail: 'manual smoke pending' },
      },
      risk_notes: [null, 'bad risk'],
    },
  }));

  assert.equal(gate.status, 'fail');
  assert.ok(gate.checks.some(check => check.kind === 'test' && check.detail.includes('unit suite')));
  assert.ok(gate.checks.some(check => check.kind === 'environment' && check.detail.includes('local: warn')));
  assert.ok(gate.checks.some(check => check.kind === 'acceptance' && check.status === 'pass'));
});

test('queue removal policy protects evidence gates without blocking evidenced tickets', () => {
  const reviewNoEvidence = ticket({
    next_action: 'await_review',
    projects: ['app'],
    mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
  });

  const automaticFail = queueRemovalPolicy.decideQueueRemoval('K-1', reviewNoEvidence, false);
  assert.equal(automaticFail.kind, 'block_failing_gate');
  assert.equal(automaticFail.allowed, false);
  assert.equal(automaticFail.requiresConfirmation, false);
  assert.match(automaticFail.message, /stayed in queue because its evidence gate is failing/);
  assert.ok(automaticFail.failingSummary.includes('No evidence records'));

  const interactiveFail = queueRemovalPolicy.decideQueueRemoval('K-1', reviewNoEvidence, true);
  assert.equal(interactiveFail.kind, 'confirm_failing_gate');
  assert.equal(interactiveFail.allowed, false);
  assert.equal(interactiveFail.requiresConfirmation, true);

  const implementNoEvidence = ticket({
    next_action: 'implement',
    projects: ['app'],
  });
  const missing = queueRemovalPolicy.decideQueueRemoval('K-2', implementNoEvidence, false);
  assert.equal(missing.kind, 'block_missing_evidence');
  assert.equal(missing.allowed, false);
  assert.equal(missing.requiresConfirmation, false);
  assert.match(missing.message, /stayed in queue because it has no evidence records/);

  const evidenced = ticket({
    next_action: 'await_review',
    projects: ['app'],
    mr: { iid: 2, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/2' },
    build: { number: 2, status: 'SUCCESS', url: 'https://jenkins.example/2' },
    evidence: {
      notes: [{ at: 'now', kind: 'test', text: 'smoke passed' }],
      checks: [{ id: 'check-1', at: 'now', name: 'smoke', result: 'pass' }],
    },
  });
  const allowed = queueRemovalPolicy.decideQueueRemoval('K-3', evidenced, false);
  assert.equal(allowed.kind, 'allow');
  assert.equal(allowed.allowed, true);

  assert.equal(queueRemovalPolicy.decideQueueRemoval('K-4', undefined, false).kind, 'allow');
});

test('post-run readiness distinguishes process completion from handoff readiness', () => {
  const readyTicket = ticket({
    next_action: 'await_review',
    projects: ['app'],
    mr: { iid: 1, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/1' },
    build: { number: 1, status: 'SUCCESS', url: 'https://jenkins.example/1' },
    evidence: {
      acceptance_criteria: [{ id: 'ac-1', text: 'Works', checked: true }],
      notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }],
      checks: [{ id: 'check-1', at: 'now', name: 'smoke', result: 'pass' }],
    },
  });
  const ready = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'completed' },
    ticketKey: 'K-1',
    ticket: readyTicket,
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.failureKind, 'none');
  assert.equal(ready.evidenceGate.status, 'pass');
  assert.deepEqual(postRunReadiness.postRunReadinessRunPatch({ status: 'completed' }, ready), {
    readiness: ready,
    failureKind: 'none',
    status: 'waiting_for_review',
  });

  const waitingForReview = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'waiting_for_review' },
    ticketKey: 'K-1',
    ticket: readyTicket,
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(waitingForReview.status, 'ready');
  assert.equal(waitingForReview.failureKind, 'none');
  const needsHumanPatch = postRunReadiness.postRunReadinessRunPatch({ status: 'completed' }, {
    ...waitingForReview,
    status: 'blocked',
    summary: 'Evidence gate failed.',
    failureKind: 'test',
  });
  assert.deepEqual(needsHumanPatch, {
    readiness: {
      ...waitingForReview,
      status: 'blocked',
      summary: 'Evidence gate failed.',
      failureKind: 'test',
    },
    failureKind: 'test',
    status: 'needs_human',
    failureReason: 'Evidence gate failed.',
  });
  assert.equal(postRunReadiness.postRunReadinessRunPatch({ status: 'failed' }, waitingForReview).status, undefined);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: ticket({ next_action: 'await_review', projects: ['app'] }),
  }), true);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: {
      id: 'run-cleanup-needs-human',
      skill: 'implement',
      status: 'needs_human',
      exitCode: 0,
      failureReason: 'Worktree not removed: Dirty worktree',
    },
    ticket: ticket({ next_action: 'await_review', projects: ['app'] }),
  }), true);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: readyTicket,
  }), true);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: ticket({
      next_action: 'await_review',
      projects: ['app'],
      evidence: {
        notes: [{ at: 'now', kind: 'note', text: 'Kronos implement run run-1 completed.' }],
        checks: [{ id: 'check-1', at: 'now', name: 'smoke', result: 'pass' }],
      },
    }),
  }), false);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: ticket({
      next_action: 'await_review',
      projects: ['app'],
      evidence: {
        notes: [{ at: 'now', kind: 'test', text: 'smoke passed' }],
        checks: [{ id: 'check-1', at: 'now', name: 'Kronos implement completion', result: 'pass', command: 'kronos run run-1' }],
      },
    }),
  }), false);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'verify-local', status: 'completed' },
    ticket: ticket({ next_action: 'await_review', projects: ['app'] }),
  }), false);

  const resolutionTickets = {
    'K-READY': ticket({ next_action: 'await_review', projects: ['app'] }),
    'K-DONE': ticket({ next_action: 'done', projects: ['app'] }),
    'K-API': ticket({ next_action: 'await_review', projects: ['api'] }),
  };
  const directResolution = postRunReadiness.resolvePostRunTicket({ tickets: resolutionTickets, ticketKey: 'k-ready' });
  assert.equal(directResolution.ticketKey, 'K-READY');
  assert.equal(directResolution.ticket, resolutionTickets['K-READY']);
  const inferredResolution = postRunReadiness.resolvePostRunTicket({ tickets: resolutionTickets, ticketKey: 'K-MISSING', projectName: 'app' });
  assert.equal(inferredResolution.ticketKey, 'K-READY');
  assert.equal(inferredResolution.ticket, resolutionTickets['K-READY']);
  const runProjectResolution = postRunReadiness.resolvePostRunTicket({ tickets: resolutionTickets, run: { project: 'api' } });
  assert.equal(runProjectResolution.ticketKey, 'K-API');
  const runMetadataResolution = postRunReadiness.resolvePostRunTicket({
    tickets: {
      'K-ONE': ticket({ next_action: 'await_review', projects: ['app'] }),
      'K-TWO': ticket({ next_action: 'await_review', projects: ['app'] }),
    },
    ticketKey: 'K-MISSING',
    projectName: 'app',
    run: {
      id: 'app-implement-K-TWO-run',
      promptPreview: '/implement K-TWO',
      branch: { currentRef: 'feature/K-TWO' },
      events: [{ label: 'Editing src/app.ts', detail: 'Handled K-TWO review notes' }],
    },
  });
  assert.equal(runMetadataResolution.ticketKey, 'K-TWO');
  const ambiguousResolution = postRunReadiness.resolvePostRunTicket({
    tickets: {
      'K-ONE': ticket({ next_action: 'await_review', projects: ['app'] }),
      'K-TWO': ticket({ next_action: 'verify', projects: ['app'] }),
    },
    projectName: 'app',
  });
  assert.equal(ambiguousResolution.ticket, undefined);
  assert.equal(postRunReadiness.resolvePostRunTicket({ tickets: { 'K-DONE': resolutionTickets['K-DONE'] }, projectName: 'app' }).ticket, undefined);

  const completionEvidence = postRunReadiness.buildRunCompletionEvidenceText({
    id: 'run-1',
    status: 'completed',
    exitCode: 0,
    testCount: 105,
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T00:01:00.000Z',
    events: [
      { type: 'tool', label: 'Editing src/app.ts', detail: '', timestamp: '2026-07-01T00:00:10.000Z' },
    ],
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
    sonar_status: 'OK',
    mr: {
      iid: 1,
      state: 'opened',
      review_status: 'approved',
      url: 'https://gitlab.example/1',
      changed_files: [{ path: 'src/app.ts' }],
    },
    build: { number: 12, status: 'SUCCESS', url: 'https://jenkins.example/12' },
  }));
  assert.match(completionEvidence, /run-1 completed/);
  assert.match(completionEvidence, /Progress: 1 tool \| 1 changed \| 1m/);
  assert.match(completionEvidence, /Files changed: 1 from run events; 1 in MR/);
  assert.match(completionEvidence, /Test count: 105/);
  assert.match(completionEvidence, /SonarQube: OK/);
  assert.match(completionEvidence, /MR: !1 opened\/approved - https:\/\/gitlab\.example\/1/);
  assert.match(completionEvidence, /Build: SUCCESS #12 - https:\/\/jenkins\.example\/12/);
  const completionCheck = postRunReadiness.buildRunCompletionEvidenceCheck({
    id: 'run-1',
    status: 'completed',
    exitCode: 0,
    testCount: 105,
    startedAt: '2026-07-01T00:00:00.000Z',
    endedAt: '2026-07-01T00:01:00.000Z',
    events: [
      { type: 'tool', label: 'Editing src/app.ts', detail: '', timestamp: '2026-07-01T00:00:10.000Z' },
    ],
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
    sonar_status: 'OK',
    mr: { iid: 1, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/1' },
    build: { number: 12, status: 'SUCCESS', url: 'https://jenkins.example/12' },
  }));
  assert.equal(completionCheck.name, 'Kronos implement completion');
  assert.equal(completionCheck.result, 'pass');
  assert.equal(completionCheck.environment, 'kronos');
  assert.equal(completionCheck.command, 'kronos run run-1');
  assert.equal(completionCheck.confidence, 'high');
  assert.match(completionCheck.summary, /105 tests/);
  assert.match(completionCheck.summary, /SonarQube OK/);
  assert.match(completionCheck.summary, /MR !1 opened\/approved/);
  const weakCompletionCheck = postRunReadiness.buildRunCompletionEvidenceCheck({
    id: 'run-weak',
    status: 'completed',
    exitCode: 0,
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
  }));
  assert.equal(weakCompletionCheck.result, 'warn');
  assert.equal(weakCompletionCheck.confidence, 'medium');
  assert.match(weakCompletionCheck.summary, /test count not captured/);
  const zeroTestCompletionCheck = postRunReadiness.buildRunCompletionEvidenceCheck({
    id: 'run-zero-tests',
    status: 'completed',
    exitCode: 0,
    testsPassed: 0,
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
  }));
  assert.equal(zeroTestCompletionCheck.result, 'warn');
  assert.equal(zeroTestCompletionCheck.confidence, 'medium');
  assert.match(zeroTestCompletionCheck.summary, /0 tests/);
  const zeroTestWithBuildCheck = postRunReadiness.buildRunCompletionEvidenceCheck({
    id: 'run-zero-tests-with-build',
    status: 'completed',
    exitCode: 0,
    testsPassed: 0,
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
    build: { number: 15, status: 'SUCCESS', url: 'https://jenkins.example/15' },
  }));
  assert.equal(zeroTestWithBuildCheck.result, 'pass');
  assert.equal(zeroTestWithBuildCheck.confidence, 'high');
  assert.match(zeroTestWithBuildCheck.summary, /0 tests/);
  assert.match(zeroTestWithBuildCheck.summary, /build SUCCESS #15/);
  const cleanupBlockedCompletionCheck = postRunReadiness.buildRunCompletionEvidenceCheck({
    id: 'run-cleanup-needs-human',
    status: 'needs_human',
    exitCode: 0,
    testCount: 105,
  }, ticket({
    next_action: 'await_review',
    projects: ['app'],
    sonar_status: 'OK',
    mr: { iid: 2, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/2' },
  }));
  assert.equal(cleanupBlockedCompletionCheck.result, 'pass');
  assert.match(cleanupBlockedCompletionCheck.summary, /run-cleanup-needs-human needs_human exit 0/);

  const notReady = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'completed' },
    ticketKey: 'K-2',
    ticket: ticket({ next_action: 'implement', projects: ['app'] }),
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(notReady.status, 'not_ready');
  assert.match(notReady.summary, /still implement/);

  const blocked = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'failed', failureReason: 'Jenkins build failed' },
    ticketKey: 'K-3',
    ticket: readyTicket,
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failureKind, 'build');
  assert.match(blocked.summary, /build: Jenkins build failed/);

  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', failureReason: 'Sonar quality gate failed' }), 'sonar');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'cancelled', failureReason: 'Progress panel disposed by user' }), 'cancelled');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', failureReason: 'Failed to launch Claude CLI: spawn claude ENOENT' }), 'script');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', skill: 'sonar-scan', exitCode: 1, failureReason: 'Process exited with code 1' }), 'sonar');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', skill: 'verify-local', exitCode: 1, failureReason: 'Process exited with code 1' }), 'test');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', skill: 'fix_build', exitCode: 1, failureReason: 'Process exited with code 1' }), 'build');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', skill: 'verify-local', exitCode: 124, failureReason: 'Process exited with code 124' }), 'timeout');
  assert.equal(postRunReadiness.classifyRunFailure({ status: 'failed', events: [{ label: 'Jenkins', detail: 'compile failed' }] }), 'build');
  assert.equal(postRunReadiness.classifyRunFailure('not a run'), 'unknown');
  assert.equal(postRunReadiness.evaluatePostRunReadiness({
    run: 'not a run',
    now: new Date('2026-07-01T00:00:00.000Z'),
  }).status, 'blocked');

  const source = readSourceFixture('src', 'services', 'postRunReadiness.ts');
  for (const marker of [
    'run: unknown',
    "import { runProgressSummary } from './runProgress'",
    "import { terminalRunOutcome } from './runStatus'",
    "import { evidenceChecks, evidenceNotes, evidenceString } from './evidenceData'",
    'export function shouldRecordRunCompletionEvidence',
    'export function resolvePostRunTicket',
    'export function postRunReadinessRunPatch',
    'function postRunReadinessStatusTransition',
    "const READINESS_STATUS_TRANSITION_RUN_STATUSES = new Set(['completed', 'waiting_for_review'])",
    'interface PostRunTicketResolution',
    'const runResolved = resolveTicketFromRunRecord(tickets, input.run)',
    'const matchedProjectTickets',
    'matchedProjectTickets.length === 1',
    'function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean',
    'function resolveTicketFromRunRecord(tickets: Record<string, Ticket>, run: unknown): PostRunTicketResolution | undefined',
    'function runSearchStrings(record: Record<string, unknown>): string[]',
    'function ticketKeyAppearsInStrings(ticketKey: string, values: string[]): boolean',
    "import { escapeRegExp } from './regexp'",
    'function trimmedString(value: unknown): string | undefined',
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
    'interface RunCompletionEvidenceCheck',
    'function ticketSonarStatus(ticket?: Ticket): string | undefined',
    "import { isPassingBuildStatus } from './buildStatus'",
    'function isPassingSonar',
    'export function classifyRunFailure(run: unknown): RunFailureKind',
    "import { recordFromUnknown } from './records'",
    'function runCompletedForEvidence(record: Record<string, unknown>): boolean',
    'function runString(value: unknown): string',
    'function runText(value: unknown): string | undefined',
    'function runFailureReason(record: Record<string, unknown>): string',
    'function failureSummaryDetail(kind: RunFailureKind, reason: string): string',
    'function runEventDetails(value: unknown): unknown[]',
    'function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined',
    'function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined',
    'function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'run: any',
    'event: any',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('aging analyzer flags stale reviews, builds, blockers, verification, and tickets', () => {
  const report = agingAnalyzer.analyzeAging({
    now: new Date('2026-07-10T00:00:00.000Z'),
    tickets: {
      'K-REVIEW': ticket({
        next_action: 'await_review',
        last_action_at: '2026-07-06T00:00:00.000Z',
        mr: { iid: 1, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/1' },
      }),
      'K-BUILD': ticket({
        next_action: 'fix_build',
        last_action_at: '2026-07-08T00:00:00.000Z',
        build: { number: 2, status: 'FAILURE', url: 'https://jenkins.example/2' },
      }),
      'K-BLOCKED': ticket({
        next_action: 'blocked',
        last_action_at: '2026-07-05T00:00:00.000Z',
        last_action: 'waiting on product decision',
      }),
      'K-VERIFY': ticket({
        next_action: 'verify',
        last_action_at: '2026-07-05T00:00:00.000Z',
      }),
      'K-TICKET': ticket({
        next_action: 'implement',
        last_action_at: '2026-06-25T00:00:00.000Z',
        jira_url: 'https://jira.example/K-TICKET',
      }),
      'K-FRESH': ticket({
        next_action: 'verify',
        last_action_at: '2026-07-09T00:00:00.000Z',
      }),
    },
  });

  assert.equal(report.summary.total, 5);
  assert.equal(report.summary.critical, 2);
  assert.equal(report.summary.warning, 2);
  assert.equal(report.summary.info, 1);
  assert.equal(report.items[0].severity, 'critical');
  assert.ok(report.items.some(item => item.ticketKey === 'K-REVIEW' && item.title.includes('has been waiting for review')));
  assert.ok(report.items.some(item => item.ticketKey === 'K-BUILD' && item.kind === 'build' && item.severity === 'critical'));
  assert.ok(report.items.some(item => item.ticketKey === 'K-BLOCKED' && item.kind === 'blocked' && item.severity === 'critical'));
  assert.ok(report.items.some(item => item.ticketKey === 'K-VERIFY' && item.kind === 'verification' && item.severity === 'warning'));
  assert.ok(report.items.some(item => item.ticketKey === 'K-TICKET' && item.kind === 'ticket' && item.severity === 'info'));
  assert.equal(report.items.some(item => item.ticketKey === 'K-FRESH'), false);
});

test('aging report view escapes data and only links HTTP URLs', () => {
  const html = agingReportView.buildAgingReportHtml({
    generatedAt: '2026-07-10T00:00:00.000Z',
    summary: { critical: 1, warning: 1, info: 0, total: 2 },
    items: [
      {
        id: 'review:K-1',
        ticketKey: 'K-<script>',
        kind: 'review',
        severity: 'critical',
        ageDays: 4,
        thresholdDays: 3,
        title: '<b>unsafe</b>',
        detail: 'quote " amp & tag <x>',
        url: 'javascript:alert(1)',
      },
      {
        id: 'build:K-2',
        ticketKey: 'K-2',
        kind: 'build',
        severity: 'warning',
        ageDays: 2,
        thresholdDays: 1,
        title: 'Build failed',
        detail: 'Jenkins output',
        url: 'https://ci.example/job?x=1&name="bad"',
      },
    ],
  });

  assert.match(html, /K-&lt;script&gt;/);
  assert.match(html, /&lt;b&gt;unsafe&lt;\/b&gt;/);
  assert.match(html, /quote &quot; amp &amp; tag &lt;x&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /href="https:\/\/ci\.example\/job\?x=1&amp;name=%22bad%22"/);
  assert.match(html, /class="kronos-shell aging-shell"/);
  assert.match(html, /class="kronos-stat-grid"/);
  assert.match(html, /class="kronos-table"/);
});

test('webview html helpers centralize escaping and safe HTTP links', () => {
  assert.equal(webviewHtml.escapeHtml('<tag a="1">&'), '&lt;tag a=&quot;1&quot;&gt;&amp;');
  assert.equal(webviewHtml.escapeAttr(`a'b"&`), 'a&#39;b&quot;&amp;');
  assert.equal(webviewHtml.escapeClass('warn bad<script>'), 'warnbadscript');
  assert.equal(webviewHtml.safeHttpHref('file:///tmp/log.txt'), '');
  assert.equal(webviewHtml.safeHttpHref('javascript:alert(1)'), '');
  assert.equal(webviewHtml.safeHttpHref('https://example.test/a?b=1&c=2'), 'https://example.test/a?b=1&amp;c=2');
  assert.equal(webviewHtml.safeHttpHref(' https://example.test/a\n?b=1&name="bad" '), 'https://example.test/a?b=1&amp;name=%22bad%22');
  const baseCss = webviewHtml.kronosWebviewBaseCss();
  assert.match(baseCss, /--k-bg: var\(--vscode-editor-background\)/);
  assert.match(baseCss, /\.kronos-header/);
  assert.match(baseCss, /\.kronos-table/);
  assert.match(baseCss, /\.kronos-stat-grid/);
  assert.match(baseCss, /\.kronos-pill\.pass/);
  assert.match(baseCss, /\.kronos-input/);
  assert.match(baseCss, /\.kronos-toolbar/);
  assert.match(baseCss, /\.kronos-card/);
  assert.match(baseCss, /\.kronos-empty\.compact/);
  assert.match(baseCss, /\.kronos-script-required/);
  assert.match(baseCss, /html\[data-kronos-script-ready="true"\] \.kronos-script-required/);
  assert.match(baseCss, /@media \(max-width: 760px\)/);
});

test('dashboard panel view renders escaped command center data', () => {
  const startedAt = new Date().toISOString();
  const html = dashboardPanelView.buildDashboardHtml({
    state: {
      projects: {
        'web<script>': {
          health: 'green',
          summary: 'Project <summary> & details',
          open_mr_count: 2,
        },
      },
      tickets: {
        'K-DASH': ticket({
          summary: 'Dashboard ticket',
          projects: ['web<script>'],
          updated: '2026-07-01T12:00:00.000Z',
        }),
      },
    },
    queue: { items: [{ id: 'q1', ticket: 'K-DASH', action: 'implement' }], last_computed: startedAt },
    runs: [{
      id: 'run<script>',
      project: 'web<script>',
      ticket: 'K-DASH',
      skill: 'implement',
      status: 'running',
      startedAt,
    }],
    plans: [{
      planId: 'K-DASH:implement',
      ticketKey: 'K-DASH',
      action: 'implement',
      projects: ['web<script>'],
      score: 99,
      scoreBreakdown: [],
      reason: 'Needs <work> & review',
      source: 'queue',
    }],
    brief: { overnight_actions: '2', vpn_drops: '1', completed: ['Done <one>'] },
    trendWindowDays: 14,
    agingThresholds: { ticketDays: 1 },
    nonce: 'nonce-dashboard',
    loadWarning: 'Brief <failed> & retry',
    actionScriptUri: ACTION_SCRIPT_URI,
  });

  assert.match(html, /class="kronos-shell dashboard-shell"/);
  assert.match(html, /Command Center/);
  assert.match(html, /web&lt;script&gt;/);
  assert.match(html, /Project &lt;summary&gt; &amp; details/);
  assert.match(html, /Needs &lt;work&gt; &amp; review/);
  assert.match(html, /Brief &lt;failed&gt; &amp; retry/);
  assert.match(html, /Done &lt;one&gt;/);
  assert.match(html, /run&lt;script&gt;/);
  assert.match(html, /data-action="refreshPanel"/);
  assert.match(html, /data-action="runCenter"/);
  assert.match(html, /data-kronos-ready-command="__kronosWebviewReady"/);
  assert.doesNotMatch(html, /Project <summary>/);
  assert.doesNotMatch(html, /Brief <failed>/);
});

test('jira board panel view renders escaped ticket data and packaged script', () => {
  const html = jiraBoardPanelView.buildJiraBoardHtml({
    state: {
      projects: { 'app<script>': { health: 'green', summary: 'App', open_mr_count: 1 } },
      tickets: {
        'K-BOARD': ticket({
          summary: 'Board <summary> & detail',
          description: 'Unsafe <description>',
          type: 'Bug',
          priority: 'High <p>',
          jira_status: 'In Review',
          next_action: 'await_review',
          labels: ['label<script>'],
          projects: ['app<script>'],
          jira_url: 'https://jira.example/K-BOARD',
          attachments: [{ filename: 'trace <one>.log', size: '99', mimeType: 'text/plain' }],
          mr: { iid: 12, review_status: 'changes_requested', url: 'https://gitlab.example/mr/12' },
          build: { number: 34, status: 'FAILURE' },
          evidence: { notes: [{ text: 'proof' }] },
        }),
      },
    },
    queue: { items: [{ id: 'q-board', ticket: 'K-BOARD', action: 'await_review' }], last_computed: '2026-07-01T12:00:00.000Z' },
    nonce: 'nonce-board',
    scriptUri: ACTION_SCRIPT_URI,
  });

  assert.match(html, /class="kronos-shell board-shell"/);
  assert.match(html, /Board &lt;summary&gt; &amp; detail/);
  assert.match(html, /High &lt;p&gt;/);
  assert.match(html, /app&lt;script&gt;/);
  assert.match(html, /label&lt;script&gt;/);
  assert.match(html, /trace &lt;one&gt;\.log/);
  assert.match(html, /data-action="removeFromQueue"/);
  assert.match(html, /data-action="start"/);
  assert.match(html, /id="kronos-jira-board-script"/);
  assert.match(html, /data-kronos-script-kind="jira-board"/);
  assert.match(html, /data-kronos-ready-command="__kronosWebviewReady"/);
  assert.doesNotMatch(html, /Board <summary>/);
  assert.doesNotMatch(html, /trace <one>/);
});

test('operator command routing preserves ticket, run, and item targets', () => {
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'missingCommand' }), { kind: 'unknown' });
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'addEvidence' }), {
    kind: 'missingTicket',
    commandId: 'kronos.addEvidence',
  });
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'addEvidence', ticketKey: 'K-1' }), {
    kind: 'execute',
    commandId: 'kronos.addEvidence',
    argument: { ticketKey: 'K-1' },
  });
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'evidenceGate', ticketKey: 'K-1' }), {
    kind: 'execute',
    commandId: 'kronos.evidenceGate',
    argument: { ticketKey: 'K-1' },
  });
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'evidenceGate' }), {
    kind: 'execute',
    commandId: 'kronos.evidenceGate',
  });
  assert.deepEqual(operatorCommandRouting.resolveOperatorCommandRoute({ command: 'runCenter', itemId: 'item-1' }), {
    kind: 'execute',
    commandId: 'kronos.runCenter',
    argument: { runId: '', itemId: 'item-1' },
  });
  assert.equal(operatorCommandRouting.isTicketOperatorCommand('viewTicket'), true);
  assert.equal(operatorCommandRouting.isTicketOperatorCommand('runCenter'), false);
});

test('extension webviews use shared UI shell and board filtering affordances', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const operatorPanelSource = readSourceFixture('src', 'services', 'operatorPanel.ts');
  const promptPanelViewSource = readSourceFixture('src', 'services', 'promptPanelView.ts');
  const recoveryPanelViewSource = readSourceFixture('src', 'services', 'recoveryPanelView.ts');
  const humanReviewPanelViewSource = readSourceFixture('src', 'services', 'humanReviewPanelView.ts');
  const evidencePanelViewSource = readSourceFixture('src', 'services', 'evidencePanelView.ts');
  const queuePlannerPanelViewSource = readSourceFixture('src', 'services', 'queuePlannerPanelView.ts');
  const operationsReportPanelViewSource = readSourceFixture('src', 'services', 'operationsReportPanelView.ts');
  const dashboardPanelViewSource = readSourceFixture('src', 'services', 'dashboardPanelView.ts');
  const diffPanelViewSource = readSourceFixture('src', 'services', 'diffPanelView.ts');
  const jiraBoardPanelViewSource = readSourceFixture('src', 'services', 'jiraBoardPanelView.ts');
  const ticketPanelViewSource = readSourceFixture('src', 'services', 'ticketPanelView.ts');
  const webviewMessagesSource = readSourceFixture('src', 'services', 'webviewMessages.ts');
  const webviewCommandRegistrySource = readSourceFixture('src', 'services', 'webviewCommandRegistry.ts');
  const operatorCommandRoutingSource = readSourceFixture('src', 'services', 'operatorCommandRouting.ts');
  const runActionHelpersSource = readSourceFixture('src', 'services', 'runActionHelpers.ts');
  const collisionDetectorSource = readSourceFixture('src', 'services', 'collisionDetector.ts');
  const mergeRequestFileHintsSource = readSourceFixture('src', 'services', 'mergeRequestFileHints.ts');
  const jiraBoardSource = readSourceFixture('media', 'kronos-jira-board.js');
  const uiSource = `${source}\n${queuePlannerPanelViewSource}\n${operationsReportPanelViewSource}\n${dashboardPanelViewSource}\n${diffPanelViewSource}\n${jiraBoardPanelViewSource}\n${ticketPanelViewSource}\n${webviewCommandRegistrySource}\n${operatorCommandRoutingSource}\n${runActionHelpersSource}\n${collisionDetectorSource}\n${mergeRequestFileHintsSource}\n${jiraBoardSource}`;
  const boardHandlerStart = source.indexOf('panel.webview.onDidReceiveMessage(async (msg) => {\n        if (logReady(msg)) { return; }\n        const request = normalizeBoardMessage(msg, BOARD_MESSAGE_COMMANDS);');
  const boardHandlerEnd = source.indexOf("    vscode.commands.registerCommand('kronos.viewTicket'", boardHandlerStart);
  assert.ok(boardHandlerStart >= 0 && boardHandlerEnd > boardHandlerStart, 'Jira board message handler should be present');
  const boardHandlerSource = source.slice(boardHandlerStart, boardHandlerEnd);
  for (const marker of [
    "import { WEBVIEW_ACTION_PANEL_SCRIPT, WEBVIEW_JIRA_BOARD_SCRIPT, createWebviewNonce, webviewScriptCspOptions, withWebviewCsp } from './services/webviewSecurity'",
    "import { normalizeBoardMessage, normalizeWebviewCommand } from './services/webviewMessages'",
    "from './services/webviewCommandRegistry'",
    "import { actionButton, kronosActionPanelScript, normalizeActionPanelMessage, operatorCommandRow, type ActionPanelMessage } from './services/operatorPanel'",
    "import { buildPromptHistoryHtml, buildPromptManagerHtml, buildPromptSmokeTestsHtml } from './services/promptPanelView'",
    "import { buildRecoveryHtml, buildStateAuditLogHtml } from './services/recoveryPanelView'",
    "import { buildHumanReviewInboxHtml } from './services/humanReviewPanelView'",
    "import { decideReviewMonitorAction, reviewDeployMonitorActionHandled, reviewTerminalMergeRequestActionKey, type ReviewDeployMonitorResult, type ReviewMonitorDecision, type ReviewTerminalMergeRequestAction } from './services/reviewMonitor'",
    "import { buildEvidenceGateHtml, buildEvidenceHandoffHtml, buildEvidencePublishHtml } from './services/evidencePanelView'",
    "import { buildBacklogTriageHtml, buildCollisionReportHtml, buildProjectBatchPlanHtml, buildQueuePlanModeHtml, buildQueuePlannerHtml, buildReleaseBatchPlanHtml } from './services/queuePlannerPanelView'",
    "import { isCodeAction } from './services/actionSemantics'",
    "import { createWebviewReadyMonitor } from './services/webviewDiagnostics'",
    'const nonce = createWebviewNonce()',
    'webviewScriptCspOptions(panel.webview.cspSource, nonce)',
    'kronosWebviewBaseCss',
    'class="kronos-shell dashboard-shell"',
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
    'class="kronos-shell board-shell"',
    'class="kronos-shell ticket-shell"',
    'class="kronos-shell diff-shell"',
    'id="board-filter"',
    'id="board-filter-summary"',
    'id="kronos-jira-ticket-data"',
    'class="kronos-data-payload"',
    'WEBVIEW_JIRA_BOARD_SCRIPT',
    'function kronosJiraBoardScriptUri',
    "vscode.Uri.joinPath(extensionUri, 'media', scriptFile)",
    'buildJiraBoardHtml({',
    'defer src="${escapeAttr(input.scriptUri)}"',
    'data-kronos-ready-command="${escapeAttr(WEBVIEW_READY_COMMAND)}"',
    'function initKronosJiraBoard',
    'function claimKronosJiraBoard',
    "document.addEventListener('DOMContentLoaded', initKronosJiraBoard, { once: true })",
    "document.documentElement.setAttribute('data-kronos-actions-ready', 'true')",
    'function applyBoardFilter',
    'data-search="${attr(searchText)}"',
    'function formatWebviewDateTime',
    'escapeClass',
    "'To Do': [], 'Queued': [], 'In Progress': [], 'Review': [], 'Blocked': [], 'Done': []",
    "done: 'Done'",
    'data-empty',
    "empty.textContent = query ? 'No matching tickets.' : 'No tickets.'",
    'isQueued,',
    "makeButton(t.isQueued ? 'Remove from Queue' : 'Add to Queue'",
    'function normalizeCommentsPayload',
    "console.warn('Kronos Jira Board could not parse comments payload', error)",
    "post(t.isQueued ? 'removeFromQueue' : 'addToQueue'",
    "await startTicketFromActionPanel(state, ticket);",
    "unknownErrorMessage(e, 'Failed to link ticket.')",
    "unknownErrorMessage(e, 'Failed to unlink ticket.')",
    "unknownErrorMessage(e, 'Failed to add ticket to queue.')",
    "const logReady = createWebviewReadyMonitor(panel, 'Kronos Jira Board')",
    'logReady.arm();',
    'if (logReady(msg)) { return; }',
    'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
    'const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set',
    'const DASHBOARD_MESSAGE_COMMANDS = new Set',
    "'startTicket',",
    "'viewTicket',",
    'const AGING_REPORT_MESSAGE_COMMANDS = new Set',
    'const PLAN_MESSAGE_COMMANDS = new Set',
    'const BACKLOG_TRIAGE_MESSAGE_COMMANDS = new Set',
    'const TICKET_DETAIL_MESSAGE_COMMANDS = new Set',
    'const RECOVERY_MESSAGE_COMMANDS = new Set',
    'const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>',
    'const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set(OPERATOR_COMMAND_TO_VSCODE_COMMAND.keys())',
    'const TICKET_SCOPED_OPERATOR_COMMANDS = new Set',
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
    'normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS)',
    'normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS)',
    'normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS)',
    'async function runWebviewPanelAction',
    "warnUnexpectedPanelIntegrationError(e, fallback)",
    "runWebviewPanelAction(async () =>",
    "'Kronos board action failed.'",
    "'Kronos dashboard action failed.'",
    "'Kronos human review action failed.'",
    "'Kronos evidence gate action failed.'",
    "'Kronos operator action failed.'",
    'await executeOperatorCommandAction(command, ticketKey)',
    'executeOperatorCommandAction(request.command, request.ticket, request.runId, request.itemId)',
    'await executeHumanReviewAction(state, request.command, request.ticket, request.runId, request.itemId)',
    "await executeOperatorCommandAction(command, '', runId, itemId)",
    "if ((input.command === 'runCenter' || input.command === 'recoveryCenter') && (input.runId || input.itemId))",
    'await vscode.commands.executeCommand(route.commandId, route.argument)',
    "command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner'",
    'const render = (currentChecks: DoctorCheck[]) =>',
    ".catch((e: unknown) => render([...checks, {",
    "unknownErrorMessage(e, 'Provider reachability checks failed.')",
    "request.command === 'refreshPanel'",
    "if (request.command === 'refreshPanel') {\n        state.reloadAndNotify();\n        render();\n        return;\n      }",
    "openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true, extensionUri: context.extensionUri })",
    'options.refreshAllEvidenceGates',
    'function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[]',
    'panelEvidenceGates(state.state?.tickets)',
    'isCodeAction(target.action)',
    'function openInteractiveRunCenter',
    'function kronosScriptableWebviewOptions',
    'function kronosActionPanelScriptUri',
    'function kronosMediaScriptUri',
    "vscode.Uri.joinPath(extensionUri, 'media', scriptFile)",
    'function executeRunCenterAction',
    'async function archiveFinishedRuns',
    'export const FINISHED_ARCHIVE_STATUSES',
    'No completed, review-ready, failed, or cancelled Kronos runs to archive.',
    'Active, paused, and needs-human runs stay visible.',
    "request.command === 'archiveFinishedRuns'",
    'unknownErrorMessage(e, `Failed to archive ${run.id}.`)',
    'function executeTicketDetailAction',
    'function openTicketExternalUrl',
    'const updateReviewBadge = () =>',
    "import { REVIEW_SEEN_KEYS_STORAGE_KEY, normalizeReviewSeenKeys, planNewReviewNotification } from './services/reviewNotifications'",
    'function reviewSeenKeysStore(globalState: vscode.Memento): ReviewSeenKeysStore',
    'new ReviewTreeProvider(state, reviewSeenKeysStore(context.globalState))',
    'reviewTree.getNewReviewCount()',
    'view.badge = count > 0',
    'reviewTree.onDidChangeNewReviewCount(updateReviewBadge)',
    'reviewTree.onDidChangeNewReviewCount(() => notifyNewReviewItems(reviewTree, notifiedReviewKeys))',
    'reviewTree.markVisibleReviewItemsSeen()',
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
    "import { computeAttentionBadge } from './services/attentionBadge'",
    "import { configIntervalMs, configIntervalSeconds, configIntervalSecondsMs, parsePositiveNumberInput, positiveConfigNumber } from './services/intervalConfig'",
    'const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000',
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
    "e.affectsConfiguration('kronos.profile')",
    "const sessionPollMs = configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000)",
    'startBackgroundRefreshPoll(throttledRefresh, configIntervalSecondsMs(config.get<number>(\'pollIntervalSec\', 300), 300, 1))',
    'if (!getActiveProfile().providers.gitlab)',
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
    'function reconcileTerminalReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true): Promise<void>',
    'const updates = reconcileTerminalMergeRequestState();',
    'reviewTerminalMergeRequestActions',
    'gitlabAdapter.mergeRequestStatus',
    'updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status })',
    'const decision = decideReviewMonitorAction(candidate.ticketKey, update)',
    "decision.kind === 'deploy_monitor'",
    'const result = await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket)',
    'if (reviewDeployMonitorActionHandled(result))',
    "decision.kind === 'blocked'",
    'notifyReviewMonitorDecision(decision)',
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
    '): Promise<ReviewDeployMonitorResult>',
    'type DispatchOptions',
    'const launch = await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt)',
    'return launch.launched',
    "return 'blocked';",
    "return 'handled';",
    "return 'started';",
    'unknownErrorMessage(e, `Failed to start ${skill} session.`)',
    "import { deployMonitorAttentionIssue, deployMonitorHandoffCheckName, hasDeployMonitorHandoffIssue, hasHandledDeployMonitorRun, resolveDeployMonitorProject } from './services/deployMonitorHandoff'",
    'const result = await startDeployMonitorForMergedTicket(state, update.ticketKey, update.ticket)',
    'if (reviewDeployMonitorActionHandled(result)) { reviewTerminalMergeRequestActions.add(actionKey); }',
    'logWarning(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`))',
    "const started = await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey",
    'if (!started) {',
    'deploy monitor did not start',
    'projectNameOverride: projectName',
    'promptMetadata.mergeRequestIid = mrIid',
    'const currentTicket = state.state?.tickets?.[ticketKey] || ticket',
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
    "import { activeRunStatusBarSummary } from './services/activeRunDisplay'",
    "import { isFreshActiveRun } from './services/runStatus'",
    'const activeRunDisplay = activeRunStatusBarSummary(listRuns())',
    "statusBarItem.command = 'kronos.runCenter'",
    "statusBarItem.command = 'kronos.openDashboard'",
    '$(sync~spin) Kronos: ${activeRunDisplay.text}',
    'statusBarItem.tooltip = activeRunDisplay.tooltip',
    'queueTree.startPolling(sessionPollMs)',
    'queueTree.dispose()',
    'ticket && shouldRecordRunCompletionEvidence({ run, ticket })',
    'const ticketResolutionInput:',
    'if (state.state?.tickets) { ticketResolutionInput.tickets = state.state.tickets; }',
    'const resolvedTicket = resolvePostRunTicket(ticketResolutionInput)',
    'projectName,',
    'const refreshWarning = await reloadStateAfterDispatch(state, projectName);',
    'run.warnings = [...(run.warnings || []), refreshWarning];',
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
    'let resolvedTicketKey = resolveDispatchTicketKey(ticketKey, run)',
    'await reloadStateAfterDispatch(state, projectName)',
    'function resolveDispatchTicketKey(ticketKey: string | undefined, run: KronosRun): string | undefined',
    "import { buildRunCompletionEvidenceCheck, buildRunCompletionEvidenceText, evaluatePostRunReadiness, postRunReadinessRunPatch, resolvePostRunTicket, shouldRecordRunCompletionEvidence } from './services/postRunReadiness'",
    'addTicketRunCompletionEvidence',
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
    'function runQuickPickDetail',
    'const route = resolveOperatorCommandRoute({ command, ticketKey, runId, itemId })',
    "vscode.window.showWarningMessage('Ignored unknown Kronos operator action.')",
    "if (route.kind === 'missingTicket')",
    'await vscode.commands.executeCommand(route.commandId, route.argument)',
    'await vscode.commands.executeCommand(route.commandId)',
    'This Kronos action needs a ticket context.',
    'if (!isTicketOperatorCommand(command))',
    'function executePlanPanelAction',
    'function executeBacklogTriageAction',
    'function executeDashboardAction',
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
    'function buildRecoveryInventoryForState',
    "actionButton('startTicket', 'Start Work'",
    "actionButton('evidenceGate', 'Evidence Gate'",
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
    'hasMrUrl: Boolean(mr && ticketStringField(mr, \'url\'))',
    "vscode.window.showWarningMessage(`${ticketKey} has no ${kind === 'jira' ? 'Jira' : 'merge request'} URL recorded.`)",
    'const projectList = ticketStringArray(ticket.projects)',
    'const mr = ticket.mr',
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
    assert.ok(uiSource.includes(marker), marker);
  }
  assert.equal(uiSource.includes('addToQueueFromModal'), false, 'Jira board modal should use the standard addToQueue command');
  assert.equal(uiSource.includes('pick.label.includes'), false, 'Settings menu should route by stable item ids');
  for (const marker of [
    'function kronosMediaScriptInlineFallback',
    'inlineFallbackScript',
    'function sanitizeInlineScript(script: string): string',
  ]) {
    assert.equal(source.includes(marker), false, `Jira Board should rely on packaged media scripts without inline fallback: ${marker}`);
  }
  assert.equal(
    uiSource.includes('data-kronos-inline-fallback="jira-board"'),
    false,
    'Jira Board should not emit an inline fallback script when the packaged script is required',
  );
  for (const marker of [
    'vscode.commands.executeCommand(`kronos.${command}`',
    'await vscode.commands.executeCommand(`kronos.${command}`',
  ]) {
    assert.equal(uiSource.includes(marker), false, marker);
  }
  for (const marker of [
    'export function actionButton',
    'export function actionRow',
    'export function operatorCommandRow',
    "export { normalizeActionPanelMessage, type ActionPanelMessage } from './webviewMessages'",
    'export function kronosActionPanelScript',
    'export function kronosOperatorPanelCss',
    'kronosWebviewBaseCss',
    'webviewActionScriptTag',
    'scriptUri?: string',
    'readyCommand: WEBVIEW_READY_COMMAND',
    "{ messageKey: 'ticket', dataAttribute: 'data-ticket' }",
    "{ messageKey: 'runId', dataAttribute: 'data-run-id' }",
    "{ messageKey: 'planId', dataAttribute: 'data-plan-id' }",
    "{ messageKey: 'itemId', dataAttribute: 'data-item-id' }",
    "data-action=\"${escapeAttr(action)}\"",
    "data-plan-id=\"${escapeAttr(options.planId)}\"",
    "data-item-id=\"${escapeAttr(options.itemId)}\"",
  ]) {
    assert.ok(operatorPanelSource.includes(marker), marker);
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
    assert.ok(webviewMessagesSource.includes(marker), marker);
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
    "kronosActionPanelScript(nonce, 'Kronos Prompt Manager', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Prompt History', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Prompt Smoke Tests', actionScriptUri)",
  ]) {
    assert.ok(promptPanelViewSource.includes(marker), marker);
  }
  for (const marker of [
    'export function buildRecoveryHtml',
    'export function buildStateAuditLogHtml',
    'StateAuditEvent',
    'Kronos Recovery Center',
    'Kronos State Audit Log',
    "actionButton('refreshPanel', 'Refresh')",
    "actionButton('executeRecoveryItem'",
    'recoveryActionLabel',
    'kronosOperatorPanelCss',
    "kronosActionPanelScript(nonce, 'Kronos Recovery Center', actionScriptUri)",
  ]) {
    assert.ok(recoveryPanelViewSource.includes(marker), marker);
  }
  for (const marker of [
    'export function buildHumanReviewInboxHtml',
    'interface HumanReviewInboxHtmlOptions',
    'actionScriptUri?: string | undefined',
    'Kronos Human Review Inbox',
    'humanReviewActionButtons',
    "actionButton('refreshPanel', 'Refresh')",
    "actionButton('extractAcceptanceCriteria', 'Extract AC'",
    "actionButton('startTicket', 'Start'",
    "actionButton('evidenceGate', 'Gate'",
    "actionButton('runCenter', 'Open Run Center'",
    'const runOptions = item.runId ? { runId: item.runId } : {}',
    "actionButton('recoveryCenter', 'Recovery', runOptions)",
    "actionButton('doctor', 'Open Doctor'",
    'kronosOperatorPanelCss',
    "kronosActionPanelScript(options.nonce, 'Kronos Human Review Inbox', options.actionScriptUri)",
  ]) {
    assert.ok(humanReviewPanelViewSource.includes(marker), marker);
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
    "kronosActionPanelScript(nonce, 'Kronos Evidence Gate', actionScriptUri)",
  ]) {
    assert.ok(evidencePanelViewSource.includes(marker), marker);
  }
  for (const marker of [
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
    'kronosOperatorPanelCss',
    'actionScriptUri?: string',
    "kronosActionPanelScript(nonce, 'Kronos Session Stats', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Agent Quality Score', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Trend Metrics', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Integration Manifest', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Profiles', actionScriptUri)",
    "kronosActionPanelScript(nonce, 'Kronos Doctor', actionScriptUri)",
  ]) {
    assert.ok(operationsReportPanelViewSource.includes(marker), marker);
  }
  assert.equal(/^\s*vscode\.window\.withProgress\(/m.test(source), false, 'progress tasks should be awaited by their command handlers');
  assert.equal((source.match(/dispatchClaudeSession\(/g) || []).length, 1, 'command handlers should use startClaudeDispatch for Claude session startup');
  assert.equal(source.includes('await startClaudeDispatch('), true, 'Claude session startup should await the wrapper preflight');
  assert.equal(
    source.includes("randomBytes(16).toString('base64')"),
    false,
    'webview nonces should use hex helper, not base64',
  );
  assert.equal(
    source.includes('function createNonce('),
    false,
    'extension webview nonces should come directly from the shared webview security helper',
  );
  assert.equal(
    source.includes('function webviewScriptCsp('),
    false,
    'extension webview CSP options should come from the shared webview security helper',
  );
  assert.equal(source.includes('instanceof Element'), false, 'webview handlers should not depend on sandbox-exposed Element constructors');
  assert.equal(source.includes('instanceof HTMLElement'), false, 'webview handlers should not depend on sandbox-exposed HTMLElement constructors');
  assert.equal(
    source.includes('run.events[run.events.length - 1]'),
    false,
    'extension run pickers should tolerate missing or malformed run.events',
  );
  assert.ok(source.includes('function startActiveRunPanelRefresh('), 'webview panels should share active-run auto-refresh');
  assert.ok(source.includes("warnUnexpectedPanelIntegrationError(e, 'Kronos panel auto-refresh failed.')"), 'panel auto-refresh errors should be normalized');
  assert.ok(
    source.includes("      .then(() => {\n        state.reloadAndNotify();\n        return render();\n      })\n      .catch((e: unknown) => { warnUnexpectedPanelIntegrationError(e, 'Kronos panel auto-refresh failed.'); })"),
    'panel auto-refresh should keep state reload inside the guarded render promise',
  );
  assert.ok(
    source.includes('wasActive = listRuns().some(run => isFreshActiveRun(run));'),
    'panel auto-refresh should recheck active runs after render so finished runs stop polling cleanly',
  );
  for (const marker of [
    'const readyItems = dashboardBriefItems',
    'const attentionItems = dashboardBriefItems',
    'dashboard-list',
  ]) {
    assert.equal(source.includes(marker), false, `Dashboard should rely on Command Center instead of duplicate passive lists: ${marker}`);
  }
  for (const [label, startMarker, endMarker] of [
    ['Dashboard', "vscode.commands.registerCommand('kronos.openDashboard'", "    vscode.commands.registerCommand('kronos.queueMoveUp'"],
    ['Human Review Inbox', 'function openHumanReviewInbox', 'async function executeHumanReviewAction'],
    ['Evidence Gate', 'function openEvidenceGatePanel', 'function evidenceGatePanelGatesForState'],
    ['Aging Report', 'function openAgingReportPanel', 'function openIntegrationManifestPanel'],
  ]) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start, `${label} panel block should be present`);
    assert.ok(source.slice(start, end).includes('startActiveRunPanelRefresh(panel, state, render)'), `${label} should auto-refresh while runs are active`);
  }
  const evidenceGateHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);');
  const evidenceGateHandlerEnd = source.indexOf('function openEvidenceHandoffPanel', evidenceGateHandlerStart);
  assert.ok(evidenceGateHandlerStart >= 0 && evidenceGateHandlerEnd > evidenceGateHandlerStart, 'Evidence Gate message handler should be present');
  const evidenceGateHandlerSource = source.slice(evidenceGateHandlerStart, evidenceGateHandlerEnd);
  assert.ok(
    evidenceGateHandlerSource.includes("if (request.command === 'refreshPanel') {\n        state.reloadAndNotify();\n        render();\n        return;\n      }"),
    'Evidence Gate refresh should reload state before rendering',
  );
  const dashboardHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);');
  const dashboardHandlerEnd = source.indexOf("    vscode.commands.registerCommand('kronos.queueMoveUp'", dashboardHandlerStart);
  assert.ok(dashboardHandlerStart >= 0 && dashboardHandlerEnd > dashboardHandlerStart, 'Dashboard message handler should be present');
  const dashboardHandlerSource = source.slice(dashboardHandlerStart, dashboardHandlerEnd);
  assert.ok(
    dashboardHandlerSource.includes("if (request.command === 'refreshPanel') {\n              state.reloadAndNotify();\n              await render();\n              return;\n            }"),
    'Dashboard refresh should reload state before rendering',
  );
  const agingHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);');
  const agingHandlerEnd = source.indexOf('function openIntegrationManifestPanel', agingHandlerStart);
  assert.ok(agingHandlerStart >= 0 && agingHandlerEnd > agingHandlerStart, 'Aging Report message handler should be present');
  const agingHandlerSource = source.slice(agingHandlerStart, agingHandlerEnd);
  assert.ok(agingHandlerSource.includes("if (request.command === 'refreshPanel') {"), 'Aging Report refresh branch should be present');
  assert.ok(
    agingHandlerSource.includes("await runWebviewPanelAction(() => {\n        state.reloadAndNotify();\n        render();"),
    'Aging Report refresh should reload state before rendering through the shared action wrapper',
  );
  assert.ok(agingHandlerSource.includes("'Kronos aging report action failed.'"), 'Aging Report refresh should use panel action error handling');
  assert.equal(
    source.includes('normalizeActionPanelMessage(msg, OPERATOR_COMMAND_MESSAGE_COMMANDS)'),
    false,
    'generic operator panels should pass panel-specific allow-lists',
  );
  assert.equal(
    source.includes(".filter(([_, t]) => t.next_action === 'await_review' && t.mr)"),
    false,
    'review branch commands should share the open-MR review candidate helper',
  );
  assert.equal(source.includes('mr: ticket.mr!'), false, 'review branch helper should not need non-null assertions');
  for (const forbidden of [
    "actionButton('openEvidenceGate'",
    "actionButton('openRunCenter'",
    "actionButton('openRecoveryCenter'",
    "actionButton('openDoctor'",
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    "await vscode.commands.executeCommand('kronos.implement', { ticketKey: ticket });",
  ]) {
    assert.equal(boardHandlerSource.includes(marker), false, marker);
  }
});

test('security check validates semantic webview script policy', () => {
  const source = readSourceFixture('scripts', 'check-security.js');
  for (const marker of [
    'function listCreateWebviewPanelCalls',
    'function assertExplicitWebviewScriptPolicy',
    'function assertPanelUsesScriptableWebviewOptions',
    "assertExplicitWebviewScriptPolicy('src/extension.ts', extension)",
    "assertExplicitWebviewScriptPolicy('src/runners/sessionDispatcher.ts', dispatcher)",
    "for (const panelId of ['kronosJiraBoard', 'kronosDashboard', 'kronosHumanReviewInbox', 'kronosEvidenceGate', 'kronosAgingReport'])",
    'kronosScriptableWebviewOptions for media-backed scripts',
    'const webviewOptions: vscode.WebviewOptions',
    ': { enableScripts: true, localResourceRoots: [] }',
    "createKronosActionWebviewPanel('sonarReport', `Sonar: ${projectName}`, context.extensionUri)",
    "'src/services/promptPanelView.ts'",
    "'src/services/recoveryPanelView.ts'",
    "'src/services/humanReviewPanelView.ts'",
    "'src/services/evidencePanelView.ts'",
    "'src/services/sonarReportView.ts'",
    "'src/services/agingReportView.ts'",
    "'src/services/webviewHtml.ts'",
    'function listFilesRecursive(dir, predicate)',
    'const namedFiles = [',
    'const liveSecurityScanFiles = [',
    "...listFilesRecursive('src', file => file.endsWith('.ts'))",
    "...listFilesRecursive('media', file => file.endsWith('.js'))",
    'const files = [...new Set([...namedFiles, ...liveSecurityScanFiles])].sort();',
    "assertAbsent(/(^|[^\\w.])exec\\s*\\(/m, 'Use execFile instead of shell-string exec.');",
    "const promptPanelView = sources['src/services/promptPanelView.ts']",
    "const webviewActionPanelScript = sources['media/kronos-action-panel.js']",
    "const webviewRuntimeScript = sources['media/kronos-webview-runtime.js']",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'enableScriptsTrue !== 27',
    'Expected exactly 27 literal script-enabled webviews',
    "assertAbsent(/\\bexec\\s*\\(/, 'Use execFile instead of shell-string exec.');",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('extension activation tracks long-lived disposables', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const activateStart = source.indexOf('export function activate');
  const activateEnd = source.indexOf('export function deactivate', activateStart);
  assert.ok(activateStart >= 0 && activateEnd > activateStart, 'activate block should be present');
  const activateSource = source.slice(activateStart, activateEnd);
  for (const marker of [
    "vscode.window.registerTreeDataProvider('kronosSessions', sessionTree),",
    "vscode.window.registerTreeDataProvider('kronosTasks', taskTree),",
    'const visibilitySubscription = view.onDidChangeVisibility',
    'context.subscriptions.push(view, visibilitySubscription)',
    'state.onDidChange(() => updateStatusBar(state)),',
    'state.onDidSessionChange(() => updateStatusBar(state)),',
    'const stopRuntimePolling = () =>',
    'for (const disposable of runtimePollingDisposables.splice(0))',
    'startStatusBarRunRefresh(state, sessionPollMs)',
    "vscode.workspace.onDidChangeConfiguration(e =>",
  ]) {
    assert.ok(activateSource.includes(marker), marker);
  }
  for (const marker of [
    'function startBackgroundRefreshPoll(throttledRefresh: () => Promise<void>, intervalMs: number): vscode.Disposable',
    'function startStatusBarRunRefresh(state: KronosState, intervalMs: number): vscode.Disposable',
    'const hasActiveRuns = listRuns().some(run => isFreshActiveRun(run))',
    'if (hasActiveRuns || hadActiveRuns)',
    'return { dispose: () => clearInterval(timer) }',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(
    activateSource.includes("vscode.window.registerTreeDataProvider('kronosSessions', sessionTree);\n  vscode.window.registerTreeDataProvider('kronosTasks', taskTree);"),
    false,
    'tree data provider registrations should be tracked in context subscriptions',
  );
  assert.equal(
    activateSource.includes('\n    view.onDidChangeVisibility(e => {'),
    false,
    'tree view visibility listeners should be tracked in context subscriptions',
  );
  assert.equal(
    activateSource.includes('\n  state.onDidChange(() => updateStatusBar(state));'),
    false,
    'status bar state listener should be tracked in context subscriptions',
  );
  assert.equal(
    activateSource.includes('\n  state.onDidSessionChange(() => updateStatusBar(state));'),
    false,
    'status bar session listener should be tracked in context subscriptions',
  );
});

test('extension declares limited Restricted Mode support and blocks trust-sensitive actions', () => {
  const manifest = JSON.parse(readSourceFixture('package.json'));
  assert.equal(manifest.capabilities?.untrustedWorkspaces?.supported, 'limited');
  assert.match(
    manifest.capabilities.untrustedWorkspaces.description,
    /Read-only Kronos dashboards and review panels are available in Restricted Mode/,
  );
  assert.match(
    manifest.capabilities.untrustedWorkspaces.description,
    /Dispatching agents, modifying repositories, publishing evidence, and destructive cleanup require workspace trust/,
  );

  const source = readSourceFixture('src', 'extension.ts');
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
    'this action can ${assessment.workspaceTrustSummary}',
    'Trust this workspace before ${assessment.title}',
    'Manage Workspace Trust',
    "vscode.commands.executeCommand('workbench.trust.manage')",
    "unknownErrorMessage(e, 'Could not open Workspace Trust management.')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }

  const safetyGateSource = readSourceFixture('src', 'services', 'safetyGate.ts');
  for (const marker of [
    'requiresWorkspaceTrust: boolean',
    'workspaceTrustSummary: string',
    'const TRUST_REQUIRED_RISKS = new Set<SafetyRisk>',
    "  'repo-write',",
    "  'branch-switch',",
    "  'destructive',",
    "  'external-publish',",
    'const requiresWorkspaceTrust = risks.some(risk => TRUST_REQUIRED_RISKS.has(risk));',
    'workspaceTrustSummary: workspaceTrustRiskSummary(risks)',
    'function workspaceTrustRiskSummary(risks: SafetyRisk[]): string',
  ]) {
    assert.ok(safetyGateSource.includes(marker), marker);
  }
});

test('extension run recovery helpers use typed run records', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const runActionHelpersSource = readSourceFixture('src', 'services', 'runActionHelpers.ts');
  const runActionSources = `${source}\n${runActionHelpersSource}`;
  const runActionStart = source.indexOf('async function resumeSelectedRun');
  const runActionEnd = source.indexOf('function findRunById');
  assert.ok(runActionStart >= 0 && runActionEnd > runActionStart, 'run action helper block should be present');
  for (const marker of [
    "import { unknownErrorCode, unknownErrorMessage } from './services/errorUtils'",
    "import type { DiscoveredProject, QueueItem, Ticket } from './state/types'",
    'function openExternalHttpUrl(url: string): void',
    "console.warn(unknownErrorMessage(e, 'Invalid external URL.'))",
    'type KronosRun',
    'function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem',
    'function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void>',
    'return async (_code: number, run: KronosRun)',
    'await refreshAfterDispatch(state, projectName)(code, run)',
    'async function retryRunFromPrompt(state: KronosState, run: KronosRun)',
    'onComplete: refreshAfterDispatch(state, projectName, ticketKey)',
    'async function reloadStateAfterDispatch(state: KronosState, projectName?: string): Promise<string | undefined>',
    "unknownErrorMessage(e, `Failed to refresh Kronos state after dispatch for ${projectName}.`)",
    'vscode.window.showWarningMessage(refreshWarning);',
    'await retryRunFromPrompt(state, run)',
    'function resolveRunWorkspace(run: RunActionRecord)',
    'type RunArtifactPathResult',
    "import { projectPathKey } from './services/pathUtils'",
    "import { isExistingRealPathInside } from './pathUtils'",
    'isExistingRealPathInside(filePath, RUNS_DIR)',
    'function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult',
    "'outside-runs-dir'",
    "Refusing to open run artifact outside Kronos runs directory.",
    'async function openRunArtifactFileIfExists(filePath: string | undefined, missingMessage: string): Promise<void>',
    'function warnIfRunStillActive(run: KronosRun, action: \'retry\' | \'resume\'): boolean',
    'function isRetryableRun(run: RunActionRecord): boolean',
    'function isResumableRun(run: RunActionRecord): boolean',
    'export const FINISHED_ARCHIVE_STATUSES',
    'function isFinishedArchiveRun(run: RunActionRecord): boolean',
    'function runCountLabel(count: number): string',
    'return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok',
    "Run ${run.id} is still active. Stop it or let it finish before attempting to ${action}.",
    'async function resumeSelectedRun(state: KronosState, run: KronosRun)',
    'async function pauseSelectedRun(run: KronosRun)',
    'async function continueSelectedRun(run: KronosRun)',
    'supportsProcessTreeSuspend()',
    'Run ${run.id} was not paused because no process signal was sent',
    'Run ${run.id} was not continued because no process signal was sent',
    'async function cancelSelectedRun(run: KronosRun)',
    'if (stopResult.attempted && !stopResult.signalled) {',
    'Run ${run.id} was not cancelled because process stop failed',
    'async function openRunDiffArtifact(run: KronosRun)',
    "await openRunArtifactFileIfExists(run.logPath, 'Run log not found.')",
    "await openRunArtifactFileIfExists(run.promptPath, 'Run prompt artifact not found.')",
    'pickRun(listRuns().filter(isRetryableRun)',
    'pickRun(listRuns().filter(isResumableRun)',
    'async function markSelectedRunNeedsHuman(run: KronosRun)',
    'function runLastEventLabel(run: RunActionRecord)',
    "import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './runAttention'",
    'function runQuickPickDetail(run: RunActionRecord)',
    'function runQuickPickDescription(run: RunActionRecord)',
    'export const RUN_ACTION_QUICK_PICK_ITEMS',
    'export function buildRunQuickPickItems<T extends RunActionRecord>',
    'description: runQuickPickDescription(run)',
    'const picked = await vscode.window.showQuickPick(buildRunQuickPickItems(runs), { placeHolder })',
    'function runProcessPid(run: RunActionRecord)',
    "Reflect.get(run, 'pid')",
    'function findRunById(runId: string): KronosRun | undefined',
    'function resolveRunItem(item: unknown): KronosRun | undefined',
    'async function pickRun(runs: KronosRun[], placeHolder: string, emptyMessage: string): Promise<KronosRun | undefined>',
    'const run = resolveRunItem(item) || await pickRun',
    "from './services/commandPayloads'",
    'resolveProjectName,',
    'resolveTicketKey,',
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Failed to resume run.')",
    "unknownErrorMessage(e, 'Failed to archive run.')",
    'unknownErrorMessage(e, `Could not inspect run workspace ${candidate}.`)',
    "unknownErrorMessage(e, 'Failed to pause run.')",
    "unknownErrorMessage(e, 'Failed to continue run.')",
    "unknownErrorMessage(e, 'Failed to cancel run.')",
    "unknownErrorMessage(e, 'Failed to open run diff.')",
    "unknownErrorMessage(e, 'Failed to mark run needs-human.')",
  ]) {
    assert.ok(runActionSources.includes(marker), marker);
  }
  for (const marker of [
    'retryRunFromPrompt(run: any)',
    'resumeSelectedRun(state: KronosState, run: any)',
    'pauseSelectedRun(run: any)',
    'continueSelectedRun(run: any)',
    'cancelSelectedRun(run: any)',
    'openRunDiffArtifact(run: any)',
    'markSelectedRunNeedsHuman(run: any)',
    'findRunById(runId: string): any',
    'function planToQueueItem(state: KronosState, plan: PlannedAction): any',
    'function resolveProjectName(state: KronosState, item: any)',
    'function resolveTicketKey(item: any)',
    'return async (_code: number, run?: any)',
    'await refreshAfterDispatch(state, projectName)(code);',
    'description: run.status',
    "openTextFileIfExists(run.logPath || '', 'Run log not found.')",
    "openTextFileIfExists(run.promptPath || '', 'Run prompt artifact not found.')",
    "openTextFileIfExists(picked.run.logPath, 'Run log not found.')",
    "openTextFileIfExists(picked.run.promptPath || '', 'Run prompt artifact not found.')",
    "fs.readFileSync(run.promptPath, 'utf-8')",
    'readRunLogTail(run.logPath)',
    'run.promptPath && fs.existsSync(run.promptPath)',
    'listRuns().filter(run => run.promptPath && fs.existsSync(run.promptPath))',
    'listRuns().filter(run => run.promptPath || run.logPath)',
  ]) {
    assert.equal(runActionSources.includes(marker), false, marker);
  }
  assert.equal(
    source.includes('try { await state.refresh(); } catch {}'),
    false,
    'background refresh failures should be logged',
  );
  assert.equal(
    source.includes('} catch {}'),
    false,
    'extension helpers should not silently swallow errors',
  );
  assert.equal(
    source.includes('skip failures silently'),
    false,
    'discovery registration failures should be visible',
  );
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(runActionSources.includes(marker), false, marker);
  }
});

test('extension dispatch command handlers normalize tree payloads before use', () => {
  const source = readSourceFixture('src', 'extension.ts');
  for (const marker of [
    "from './services/queueDispatchPlan'",
    "vscode.commands.registerCommand('kronos.refreshProject', async (item: unknown)",
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
    'const projectName = resolveProjectName(state, item) || await pickProjectName(state,',
    'async function pickProjectName(state: KronosState, placeHolder: string): Promise<string | undefined>',
    'async function pickTicketProjectNameForDispatch(',
    'if (!ticketKey) {\n      return pickProjectName(state, placeHolder);\n    }',
    'ticketProjectNamesForCommand,',
    'buildTicketProjectItems(projects, state.state?.projects)',
    'const projects = buildRegisteredProjectItems(state.state?.projects)',
    'const byProject = groupTicketsByProject(tickets)',
    'buildTicketGroupProjectItems(byProject, countLabel)',
    'const ticketKey = resolveTicketKey(item);',
    'const taskId = resolveTaskId(item);',
    "await startClaudeDispatch(projectPath, 'verify-fix', ticketKey,",
    'resolveTaskId,',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  const startNextStart = source.indexOf("vscode.commands.registerCommand('kronos.startNext'");
  const startNextEnd = source.indexOf("    vscode.commands.registerCommand('kronos.nextBestAction'", startNextStart);
  assert.ok(startNextStart >= 0 && startNextEnd > startNextStart, 'start next command handler should be present');
  const startNextSource = source.slice(startNextStart, startNextEnd);
  const startNextTargetResolutionIdx = startNextSource.indexOf('const dispatchPlan = buildQueueDispatchPlan({');
  const startNextCollisionIdx = startNextSource.indexOf('const canStart = await confirmDispatchCollisions');
  assert.ok(
    startNextTargetResolutionIdx >= 0 && startNextCollisionIdx > startNextTargetResolutionIdx,
    'Start Next should resolve dispatch targets before collision checks',
  );
  for (const marker of [
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
    "await startClaudeDispatch(projectPath, 'verify-fix', item?.ticketKey,",
    'if (item?.taskId)',
    'const projectPath = getProjectPath(state, item?.projectName);',
    'name: item.projectName,',
    'const name = item?.projectName;',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('extension evidence command handlers normalize payloads and unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const evidenceCommandInputsSource = readSourceFixture('src', 'services', 'evidenceCommandInputs.ts');
  assert.ok(source.includes("from './services/evidenceCommandInputs'"), "from './services/evidenceCommandInputs'");
  for (const marker of [
    'export const EVIDENCE_NOTE_KIND_OPTIONS',
    'export const EVIDENCE_CHECK_RESULT_OPTIONS',
    'export const EVIDENCE_CHECK_ENVIRONMENT_OPTIONS',
    'export const EVIDENCE_ENVIRONMENT_RESULT_OPTIONS',
    'export function buildTicketEvidenceCheckInput',
    "if (input.environment !== 'n/a')",
    'export function buildTicketEnvironmentResultInput',
  ]) {
    assert.ok(evidenceCommandInputsSource.includes(marker), marker);
  }
  const evidenceCommandStart = source.indexOf("vscode.commands.registerCommand('kronos.viewTicket'");
  const evidenceCommandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.addToQueue'", evidenceCommandStart);
  assert.ok(evidenceCommandStart >= 0 && evidenceCommandEnd > evidenceCommandStart, 'evidence command handler block should be present');
  const evidenceCommandSource = source.slice(evidenceCommandStart, evidenceCommandEnd);
  for (const marker of [
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
    'const ticketKey = resolveTicketKey(treeItem);',
    "unknownErrorMessage(e, 'Failed to add ticket evidence.')",
    "unknownErrorMessage(e, 'Failed to add evidence check.')",
    "unknownErrorMessage(e, 'Failed to record environment result.')",
    "unknownErrorMessage(e, 'Failed to extract acceptance criteria.')",
    "unknownErrorMessage(e, 'Failed to update acceptance criteria.')",
    'EVIDENCE_NOTE_KIND_OPTIONS',
    'EVIDENCE_CHECK_RESULT_OPTIONS',
    'EVIDENCE_CHECK_CONFIDENCE_OPTIONS',
    'buildTicketEvidenceCheckInput({',
    'buildTicketEnvironmentResultInput({',
  ]) {
    assert.ok(evidenceCommandSource.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
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
    'const ticketKey = treeItem?.ticketKey;',
    'const evidenceCheck: TicketEvidenceCheckInput',
  ]) {
    assert.equal(evidenceCommandSource.includes(marker), false, marker);
  }
});

test('extension queue command handlers normalize payloads before use', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const queueCommandStart = source.indexOf("vscode.commands.registerCommand('kronos.addToQueue'");
  const queueCommandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.sonarScan'", queueCommandStart);
  assert.ok(queueCommandStart >= 0 && queueCommandEnd > queueCommandStart, 'queue command handler block should be present');
  const queueCommandSource = source.slice(queueCommandStart, queueCommandEnd);
  for (const marker of [
    "vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: unknown)",
    "vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: unknown)",
    'const ticketKey = resolveTicketKey(treeItem);',
    'const queueData = resolveQueueCommandItem(treeItemOrData);',
    'pathProject: getProjectNameForPath(state, queueData.projectPath),',
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
    'resolveQueueCommandItem,',
    'function getProjectNameForPath(state: KronosState, projectPath?: string): string | undefined',
    "import { projectPathKey } from './services/pathUtils'",
    'projectPathKey(project.path)',
    'resolveQueueIndex,',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  const projectResolutionIdx = queueCommandSource.indexOf('const dispatchPlan = buildQueueDispatchPlan({');
  const collisionIdx = queueCommandSource.indexOf('const canStart = await confirmDispatchCollisions');
  const contextPromptIdx = queueCommandSource.indexOf('const extra = await vscode.window.showInputBox');
  assert.ok(projectResolutionIdx >= 0 && collisionIdx > projectResolutionIdx, 'queue dispatch should resolve project targets before collision checks');
  assert.ok(contextPromptIdx > collisionIdx, 'queue dispatch should only ask for extra context after validation and collision checks');
  for (const marker of [
    "vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: any)",
    "vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: any)",
    "vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: any)",
    'const ticketKey = treeItem?.ticketKey;',
    'const ticketKey = (treeItem?.item || treeItem)?.ticket;',
    'const queueData = treeItemOrData?.item || treeItemOrData;',
    'const idx = treeItem?.index;',
    'const mr = treeItem?.ticket?.mr;',
    'await startClaudeDispatch(projectPath, skill, queueData.ticket,',
  ]) {
    assert.equal(queueCommandSource.includes(marker), false, marker);
  }
  for (const marker of [
    "linkTicketToProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
    "unlinkTicketFromProject(ticket, project);\n              state.reloadAndNotify();\n              renderBoard();",
    "const result = addTicketToQueue(ticket);\n              state.reloadAndNotify();\n              renderBoard();",
    "await removeTicketFromQueue(state, ticket, true, context.extensionUri);\n            renderBoard();",
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('extension publish and project command handlers normalize unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const commandStart = source.indexOf("vscode.commands.registerCommand('kronos.publishEvidence'");
  const commandEnd = source.indexOf('            const setupPrompt = `Set up project', commandStart);
  assert.ok(commandStart >= 0 && commandEnd > commandStart, 'publish/project command handler block should be present');
  const commandSource = source.slice(commandStart, commandEnd);
  for (const marker of [
    "unknownErrorMessage(e, 'Failed to publish evidence.')",
    "unknownErrorMessage(e, 'Failed to add to queue.')",
    'unknownErrorMessage(e, `Failed to remove ${name}.`)',
    "unknownErrorMessage(e, 'Could not resolve GitLab project ID.')",
    "unknownErrorMessage(e, 'Could not resolve SonarQube project key.')",
    "unknownErrorMessage(e, 'Could not update Kronos project integration config.')",
  ]) {
    assert.ok(commandSource.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(commandSource.includes(marker), false, marker);
  }
});

test('extension MR and ticket link handlers normalize payloads and unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const commandStart = source.indexOf("vscode.commands.registerCommand('kronos.rejectReview'");
  const commandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.sessionHistory'", commandStart);
  assert.ok(commandStart >= 0 && commandEnd > commandStart, 'MR and ticket link command block should be present');
  const commandSource = source.slice(commandStart, commandEnd);
  for (const marker of [
    "vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: unknown)",
    "vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: unknown)",
    "vscode.commands.registerCommand('kronos.unlinkTicket', async (item: unknown)",
    'const ticketKey = resolveTicketKey(treeItem);',
    'let orphanKey = resolveTicketKey(treeItem);',
    'orphanKey = await pickOrphanMergeRequestTicket(state.state);',
    'const url = resolveMergeRequestUrl(treeItem);',
    'const ticketKey = resolveTicketKey(ticketKeyOrItem);',
    "const projectName = stringFromUnknown(recordFromUnknown(item)['linkedProject']);",
    "unknownErrorMessage(e, 'Failed to preview merge request link.')",
    "unknownErrorMessage(e, 'Failed to link merge request to ticket.')",
    "unknownErrorMessage(e, 'Failed to update ticket project links.')",
    "unknownErrorMessage(e, 'Failed to unlink ticket.')",
  ]) {
    assert.ok(commandSource.includes(marker), marker);
  }
  assert.ok(source.includes('resolveMergeRequestUrl,'));
  assert.ok(source.includes('async function pickOrphanMergeRequestTicket(state: KronosStateSnapshot): Promise<string | undefined>'));
  assert.ok(source.includes("vscode.window.showWarningMessage('No orphan merge requests found to link.');"));
  for (const marker of [
    'catch (e: any)',
    'e?.message',
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
    assert.equal(commandSource.includes(marker), false, marker);
  }
});

test('extension command handlers normalize remaining unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const sourceWithSonarCommandPlan = `${source}\n${readSourceFixture('src', 'services', 'sonarCommandPlan.ts')}`;
  for (const marker of [
    "unknownErrorMessage(e, 'Failed to fetch SonarQube report.')",
    "unknownErrorMessage(e, 'Failed to update scan dirs.')",
    "unknownErrorMessage(e, 'Failed to restore backup.')",
    "unknownErrorMessage(e, 'Failed to snapshot integration manifest.')",
    'unknownErrorMessage(e, `Could not load Kronos env file ${envPath}.`)',
    "import { unknownErrorCode, unknownErrorMessage } from './services/errorUtils'",
    "unknownErrorMessage(e, 'Could not inspect project remotes for setup.')",
    "unknownErrorMessage(e, 'Failed to get next queue item.')",
    "warnUnexpectedPanelIntegrationError(e, 'Could not load comments')",
    "import { isKronosScriptMissingError } from './services/scriptClient'",
    'const OPTIONAL_SCRIPT_PANEL_WARNING =',
    'function warnUnexpectedPanelIntegrationError(error: unknown, fallback: string): string',
    'if (!isKronosScriptMissingError(error))',
    "unknownErrorMessage(e, 'Failed to register project.')",
    "unknownErrorMessage(e, 'Could not load SonarQube branches.')",
    "'(default; Sonar branches unavailable)'",
    'unknownErrorMessage(e, `Could not resolve MR branch for ${ticket.key}.`)',
    'unknownErrorMessage(e, `Could not resolve MR branch for ${k}.`)',
    'unknownErrorMessage(e, `Could not find fallback remote branch for ${ticket.key}.`)',
  ]) {
    assert.ok(sourceWithSonarCommandPlan.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
    '} catch {}',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
  for (const pattern of [
    /^\s+vscode\.commands\.executeCommand\('kronos\.viewTicket', \{ ticketKey: picked\.plan\.ticketKey \}\);/m,
    /^\s+vscode\.commands\.executeCommand\('kronos\.addEvidence', \{ ticketKey: picked\.plan\.ticketKey \}\);/m,
    /^\s+vscode\.commands\.executeCommand\('kronos\.implement', \{ ticketKey: ticket \}\);/m,
    /^\s+vscode\.commands\.executeCommand\('kronos\.doctor'\);/m,
  ]) {
    assert.equal(pattern.test(source), false, String(pattern));
  }
});

test('extension Sonar commands normalize webview and issue payloads', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const sonarCommandPlanSource = readSourceFixture('src', 'services', 'sonarCommandPlan.ts');
  const sonarCommandStart = source.indexOf("vscode.commands.registerCommand('kronos.sonarScan'");
  const sonarCommandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.verifyTest'", sonarCommandStart);
  assert.ok(sonarCommandStart >= 0 && sonarCommandEnd > sonarCommandStart, 'Sonar command handler block should be present');
  const sonarCommandSource = source.slice(sonarCommandStart, sonarCommandEnd);
  for (const marker of [
    "import { buildSonarReport }",
    "import { buildSonarBranchPickItems, buildSonarFixBranchStrategy, buildSonarFixInstructionBlock } from './services/sonarCommandPlan'",
    "import { isRecord, recordFromUnknown, recordString } from './services/records'",
    'stringFromUnknown,',
    "vscode.commands.registerCommand('kronos.sonarScan', async (item: unknown)",
    "vscode.commands.registerCommand('kronos.sonarReport', async (item: unknown)",
    "vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: unknown)",
    "vscode.commands.registerCommand('kronos.fixFinding', async (args: unknown)",
    "vscode.commands.registerCommand('kronos.verifyDevelop', async (item: unknown)",
    "const branch = mode.value === 'new' ? (stringFromUnknown(commandArg['branch']) || baseBranch) : '';",
    "const sourceBranch = stringFromUnknown(commandArg['sourceBranch']) || '';",
    "projectName = await pickProjectName(state, 'Run SonarQube scan for which project?');",
    "projectName = await pickProjectName(state, 'Open SonarQube report for which project?');",
    "projectName = await pickProjectName(state, 'Fix SonarQube issues in which project?');",
    "projectName = await pickProjectName(state, 'Fix verification finding in which project?');",
    'let projectName = resolveProjectName(state, args);',
    "const projectPath = stringFromUnknown(commandArg['projectPath']) || getProjectPath(state, projectName);",
    'let projectName = resolveProjectName(state, item);',
    'panel.webview.onDidReceiveMessage(async (msg: unknown) =>',
    'const commandArg = recordFromUnknown(item)',
    'const branchStrategy = buildSonarFixBranchStrategy(projectName, sourceBranch)',
    'const instructionBlock = buildSonarFixInstructionBlock({',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null',
    'export function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
    'export function buildSonarBranchPickItems',
    'export function formatSonarIssuePromptLine(issue: SonarIssue): string',
    'export function buildKnownSonarIssuesBlock(value: unknown): string',
    'export function buildSonarFixBranchStrategy(projectName: string, sourceBranch: string): string',
    'export function buildSonarFixInstructionBlock',
  ]) {
    assert.ok(sonarCommandPlanSource.includes(marker), marker);
  }
  for (const marker of [
    'panel.webview.onDidReceiveMessage(async (msg: any)',
    'issuesData.map((iss: any)',
    'item?.sourceBranch ||',
    "vscode.commands.registerCommand('kronos.sonarScan', async (item: any)",
    "vscode.commands.registerCommand('kronos.sonarReport', async (item: any)",
    "vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: any)",
    "vscode.commands.registerCommand('kronos.fixFinding', async (args: any)",
    "vscode.commands.registerCommand('kronos.verifyDevelop', async (item: any)",
    'item?.branch',
    'args?.projectName',
    'args?.projectPath',
    'let projectName = item?.projectName;',
  ]) {
    assert.equal(sonarCommandSource.includes(marker), false, marker);
  }
  for (const pattern of [
    /^\s+vscode\.commands\.executeCommand\('kronos\.sonarReport', \{ projectName \}\);/m,
    /^\s+vscode\.commands\.executeCommand\('kronos\.fixSonarIssues', \{ projectName, sourceBranch: branch, issuesData: report\.issueList \}\);/m,
    /^\s+vscode\.commands\.executeCommand\('kronos\.fixFinding', \{ projectName, projectPath, tickets: ticketList \}\);/m,
  ]) {
    assert.equal(pattern.test(sonarCommandSource), false, String(pattern));
  }
});

test('ticket detail rendering uses typed tickets and evidence records', () => {
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const ticketPanelViewSource = readSourceFixture('src', 'services', 'ticketPanelView.ts');
  const evidenceData = readSourceFixture('src', 'services', 'evidenceData.ts');
  const acceptanceCriteriaSource = readSourceFixture('src', 'services', 'acceptanceCriteria.ts');
  for (const marker of [
    'import type { DiscoveredProject, QueueItem, Ticket }',
    'function evidenceRecordCount(ticket: Ticket | null | undefined): number',
    "import { buildTicketHtml } from './services/ticketPanelView'",
    'buildTicketHtml(ticketKey, freshTicket, {',
    'runs: listRuns()',
  ]) {
    assert.ok(marker.startsWith('function evidenceRecordCount')
      ? evidenceData.includes(marker)
      : extensionSource.includes(marker), marker);
  }
  assert.ok(
    acceptanceCriteriaSource.includes('export function existingAcceptanceCriterion(record: object)'),
    'export function existingAcceptanceCriterion(record: object)',
  );
  for (const marker of [
    'export function buildTicketHtml(key: string, ticket: Ticket',
    'export function buildTicketGateHtml',
    'export function buildTicketTimelineHtml',
    'interface TicketPanelRenderInput',
    'queue?: QueueState | null',
    'runs?: TicketTimelineRuns',
    'const mr = ticket.mr',
    'const build = ticket.build',
    'function mergeRequestComments(record: object | null | undefined)',
    'const comments = mergeRequestComments(mr).slice(-5).reverse()',
    'class="mr-comments"',
    "const discussionCount = ticketStringField(mr, 'discussion_count')",
    'Discussions: ${esc(discussionCount ||',
    'const timeline = buildTicketTimeline({',
    '...(input.runs !== undefined ? { runs: input.runs } : {})',
    "kronosActionPanelScript(input.nonce, 'Kronos Ticket Detail', input.actionScriptUri)",
  ]) {
    assert.ok(ticketPanelViewSource.includes(marker), marker);
  }
  for (const marker of [
    "import { isRecord } from './records'",
    'type EvidenceRecord = object',
    'if (!isRecord(record)) { return fallback; }',
    'const value = record[key]',
    "return isRecord(record) && record['checked'] === true",
    'return Array.isArray(value) ? value.filter(isRecord) : []',
  ]) {
    assert.ok(evidenceData.includes(marker), marker);
  }
  const html = ticketPanelView.buildTicketHtml('K-DETAIL', ticket({
    summary: '<b>unsafe</b>',
    description: 'quote " amp & tag <x>',
    next_action: 'await_review',
    jira_url: 'javascript:alert(1)',
    mr: {
      iid: 7,
      state: 'opened',
      review_status: 'approved',
      url: 'https://gitlab.example/mr/7?x=1&name="bad"',
      comments: [
        { author: 'Reviewer <A>', created: '2026-07-01T12:00:00.000Z', body: 'Looks <good> & safe' },
      ],
      discussion_count: 2,
      unresolved_discussion_count: 1,
      discussions_resolved: false,
    },
    build: { number: 77, status: 'SUCCESS', url: 'https://jenkins.example/job?x=1&name="bad"' },
    evidence: {
      notes: [{ at: '2026-07-01T13:00:00.000Z', kind: 'test', text: 'npm test <passed>' }],
      checks: [{ id: 'check-1', at: '2026-07-01T13:05:00.000Z', name: 'unit <suite>', result: 'pass', artifact_path: 'javascript:alert(2)' }],
    },
  }), {
    queue: { items: [{ id: 'q1', ticket: 'K-DETAIL', action: 'verify' }], last_computed: '2026-07-01T11:00:00.000Z' },
    runs: [{ id: 'run-1', ticket: 'K-DETAIL', skill: 'verify-local', status: 'completed', startedAt: '2026-07-01T10:00:00.000Z', logPath: '/tmp/run.log' }],
  });
  assert.match(html, /&lt;b&gt;unsafe&lt;\/b&gt;/);
  assert.match(html, /quote &quot; amp &amp; tag &lt;x&gt;/);
  assert.match(html, /Reviewer &lt;A&gt;/);
  assert.match(html, /Looks &lt;good&gt; &amp; safe/);
  assert.match(html, /Remove Queue/);
  assert.match(html, /Run completed: verify-local/);
  assert.match(html, /href="https:\/\/gitlab\.example\/mr\/7\?x=1&amp;name=%22bad%22"/);
  assert.match(html, /href="https:\/\/jenkins\.example\/job\?x=1&amp;name=%22bad%22"/);
  assert.doesNotMatch(html, /href="javascript:/);
  for (const marker of [
    'function ticketEvidenceItemCount(ticket: any)',
    'function buildTicketHtml(key: string, ticket: any',
    'criteria.map((criterion: any)',
    'notes.slice().reverse().map((note: any)',
    'checks.slice().reverse().map((check: any)',
    'environmentResults.map((result: any)',
    'type EvidenceRecord = Record<string, any>',
    'const ticketData: Record<string, any>',
  ]) {
    assert.equal(extensionSource.includes(marker) || ticketPanelViewSource.includes(marker) || evidenceData.includes(marker), false, marker);
  }
  for (const marker of [
    'type EvidenceRecord = Record<string, unknown>',
    'Reflect.get(record',
    'function isEvidenceRecord',
  ]) {
    assert.equal(evidenceData.includes(marker), false, marker);
  }
});

test('merge request diff rendering uses normalized adapter results', () => {
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const diffPanelViewSource = readSourceFixture('src', 'services', 'diffPanelView.ts');
  const integrationAdapters = readSourceFixture('src', 'services', 'integrationAdapters.ts');
  const mergeRequestFileHintsSource = readSourceFixture('src', 'services', 'mergeRequestFileHints.ts');
  assert.ok(extensionSource.includes("import { buildDiffHtml } from './services/diffPanelView'"));
  assert.ok(extensionSource.includes('panel.webview.html = withWebviewCsp(buildDiffHtml(data));'));
  for (const marker of [
    "import type { MergeRequestDiffResult } from './integrationAdapters'",
    'export function buildDiffHtml(data: MergeRequestDiffResult)',
    'const files = data.files',
    'primaryChangedFilePath(f)',
  ]) {
    assert.ok(diffPanelViewSource.includes(marker), marker);
  }
  assert.ok(mergeRequestFileHintsSource.includes('const files = diff.files'));
  const html = diffPanelView.buildDiffHtml({
    mr: {
      title: 'MR <unsafe>',
      source_branch: 'feature/<x>',
      target_branch: 'main',
      author: 'Reviewer <A>',
    },
    files: [{
      new_path: 'src/<unsafe>.ts',
      old_path: 'src/old.ts',
      new_file: true,
      deleted_file: false,
      diff: '@@ -1 +1 @@\n-const oldValue = 1;\n+const value = "<tag>" & more;',
    }],
  });
  for (const marker of [
    'MR &lt;unsafe&gt;',
    'feature/&lt;x&gt;',
    'Reviewer &lt;A&gt;',
    'src/&lt;unsafe&gt;.ts',
    'const value = &quot;&lt;tag&gt;&quot; &amp; more;',
    'class="line add"',
    'class="file-link add"',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
  for (const marker of [
    'function normalizeChangedFileHints',
    'function buildDiffHtml(data: any)',
    'normalizeChangedFiles(payload.files)',
  ]) {
    assert.equal(`${extensionSource}\n${diffPanelViewSource}`.includes(marker), false, marker);
  }
  assert.ok(integrationAdapters.includes('export interface MergeRequestDiffResult'));
  assert.ok(integrationAdapters.includes("files: normalizeChangedFiles(data['files'])"));
  assert.ok(integrationAdapters.includes('[key: string]: unknown'));
});

test('tree providers share action labels and icons', () => {
  const ticketTree = readSourceFixture('src', 'views', 'TicketTreeProvider.ts');
  const projectTree = readSourceFixture('src', 'views', 'ProjectTreeProvider.ts');
  const queueTree = readSourceFixture('src', 'views', 'QueueTreeProvider.ts');
  const sessionTree = readSourceFixture('src', 'views', 'SessionTreeProvider.ts');
  const reviewTree = readSourceFixture('src', 'views', 'ReviewTreeProvider.ts');
  const taskTree = readSourceFixture('src', 'views', 'TaskTreeProvider.ts');
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const nextActionContext = readSourceFixture('src', 'services', 'nextActionContext.ts');
  const actionCatalog = readSourceFixture('src', 'services', 'actionCatalog.ts');
  const actionIcons = readSourceFixture('src', 'views', 'actionIcons.ts');
  const queuePlanner = readSourceFixture('src', 'services', 'queuePlanner.ts');
  const queuePlannerPanelView = readSourceFixture('src', 'services', 'queuePlannerPanelView.ts');
  const queueActiveRunSource = readSourceFixture('src', 'services', 'queueActiveRun.ts');

  for (const marker of [
    "import { actionDisplayLabel as actionToLabel } from '../services/actionCatalog'",
    "import { buildStatusKind } from '../services/buildStatus'",
    "import { evidenceRecordCount } from '../services/evidenceData'",
    "import { ticketActionIcon } from './actionIcons'",
    'this.iconPath = ticketActionIcon(action)',
    'const buildKind = buildStatusKind(t.build.status)',
    'evidenceRecordCount(t)',
  ]) {
    assert.ok(ticketTree.includes(marker), marker);
  }
  for (const marker of [
    "import { formatRelativeTime } from '../services/relativeTime'",
    'formatRelativeTime(proj.last_polled)',
  ]) {
    assert.ok(projectTree.includes(marker), marker);
  }
  for (const [name, source] of [
    ['ProjectTreeProvider', projectTree],
    ['TicketTreeProvider', ticketTree],
    ['QueueTreeProvider', queueTree],
    ['ReviewTreeProvider', reviewTree],
    ['TaskTreeProvider', taskTree],
  ]) {
    assert.ok(source.includes('private readonly stateSubscription: vscode.Disposable'), `${name} should own its state listener`);
    assert.ok(source.includes('this.stateSubscription = kronosState.onDidChange'), `${name} should store its state listener`);
    assert.ok(source.includes('this.stateSubscription.dispose()'), `${name} should dispose its state listener`);
    assert.ok(source.includes('this._onDidChangeTreeData.dispose()'), `${name} should dispose its tree event emitter`);
  }

  for (const marker of [
    "import { actionDisplayLabel as actionToLabel } from '../services/actionCatalog'",
    "import { queueActionIcon } from './actionIcons'",
    'queueActionIcon(item.action)',
    "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
    "import { isFreshActiveRun } from '../services/runStatus'",
    "import { formatRunProgress } from '../services/runProgress'",
    "import { activeRunForQueueItem } from '../services/queueActiveRun'",
    'const activeRuns = listRuns().filter(run => isFreshActiveRun(run))',
    'private hadActiveRuns = false',
    'this.hadActiveRuns = activeRuns.length > 0',
    'const activeNow = listRuns().some(run => isFreshActiveRun(run))',
    'if (activeNow || this.hadActiveRuns)',
    'this.hadActiveRuns = activeNow',
    'new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns))',
    'startPolling(intervalMs: number): void',
    'const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000',
    'const progress = activeRun ? formatRunProgress(activeRun) :',
    'Active run: ${activeRun.id}',
    "new vscode.ThemeIcon('sync~spin'",
  ]) {
    assert.ok(queueTree.includes(marker), marker);
  }
  for (const marker of [
    "import { skillForAction } from './nextActionContext'",
    "import { isFreshActiveRun } from './runStatus'",
    'interface QueueActiveRunLike',
    'export function activeRunForQueueItem<T extends QueueActiveRunLike>',
    'return runs.find(run => isFreshActiveRun(run, now) && runMatchesQueueItem(run, item));',
    'function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean',
    'function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean',
    "recordString(run, 'skill') === skillForAction(item.action)",
  ]) {
    assert.ok(queueActiveRunSource.includes(marker), marker);
  }
  assert.equal(
    `${queueTree}\n${queueActiveRunSource}`.includes('activeRuns.find(run => runMatchesQueueTicket(run, item))\n    || activeRuns.find'),
    false,
    'queue active-run matching should not mark a row active from ticket-only or project-only fallbacks',
  );

  assert.ok(actionIcons.includes("import { queueActionIconSpec, ticketActionIconSpec } from '../services/actionCatalog'"));
  assert.ok(actionCatalog.includes("ticketIcon: { id: 'tools'"), 'shared icons should use the valid tools codicon');
  assert.equal(actionIcons.includes("'wrench'"), false, 'shared action icons should not use the invalid wrench codicon');
  for (const marker of [
    "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
    "import { isFreshActiveRun } from '../services/runStatus'",
    "import { formatRunProgress } from '../services/runProgress'",
    "import { isAttentionRunStatus, runAttentionLine } from '../services/runAttention'",
    "import { unknownErrorMessage } from '../services/errorUtils'",
    'private _refreshing = false',
    'private readonly sessionSubscription: vscode.Disposable',
    'this.sessionSubscription = kronosState.onDidSessionChange',
    'this.sessionSubscription.dispose()',
    'this._onDidChangeTreeData.dispose()',
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
    'this.id = run.id',
    "this.command = { command: 'kronos.runCenter'",
    'arguments: [{ runId: run.id }]',
  ]) {
    assert.ok(sessionTree.includes(marker), marker);
  }
  assert.equal(sessionTree.includes('setInterval(async () =>'), false, 'session tree polling should not leave rejected async intervals unhandled');
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
    'this._onDidChangeNewReviewCount.dispose()',
    'private seedInitialReviewKeys(): void',
    'const storedSeenKeys = this.seenKeysStore?.get()',
    'this.seenReviewKeys = new Set(initialKeys)',
    'private persistSeenReviewKeys(): void',
    'this.persistSeenReviewKeys()',
    'Kronos review seen-key persistence failed.',
    'function reviewActivityKey(ticketKey: string, ticket: TicketWithOpenMergeRequest): string',
    'function reviewActivitySummary(ticket: TicketWithOpenMergeRequest): string',
    "this.description = `${isNew ? 'NEW · ' : ''}",
    'const unresolvedSuffix = mr.unresolved_discussion_count !== undefined',
    'Unresolved discussions: ${mr.unresolved_discussion_count}',
    "new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'))",
    "new vscode.ThemeIcon('circle-filled'",
    "new vscode.ThemeIcon('git-pull-request', color)",
    "import { openReviewTicketEntries } from '../services/reviewWork'",
    'type TicketWithOpenMergeRequest = ReturnType<typeof openReviewTicketEntries>[number][1]',
    'return openReviewTicketEntries(state.tickets)',
  ]) {
    assert.ok(reviewTree.includes(marker), marker);
  }
  for (const marker of [
    'projectTree.dispose()',
    'ticketTree.dispose()',
    'queueTree.dispose()',
    'reviewTree.dispose()',
    'sessionTree.dispose()',
    'taskTree.dispose()',
    'state.dispose()',
  ]) {
    assert.ok(extensionSource.includes(marker), marker);
  }
  assert.equal(reviewTree.includes("ticket.mr.state === 'merged'"), false, 'review tree should not keep merged MRs in the active review inbox');
  assert.ok(actionCatalog.includes('export function actionDisplayLabel'), 'action labels should live in the action catalog');
  assert.equal(queuePlanner.includes("export { actionToLabel } from './actionLabels'"), false, 'queuePlanner should not keep stale action label re-exports');
  for (const [name, source] of [
    ['extension', extensionSource],
    ['next action context', nextActionContext],
    ['queue planner', queuePlanner],
    ['queue planner panel view', queuePlannerPanelView],
  ]) {
    assert.ok(source.includes('actionDisplayLabel as actionToLabel'), `${name} should import action labels from actionCatalog`);
    assert.equal(source.includes('actionLabels'), false, `${name} should not import the removed actionLabels wrapper`);
  }
  assert.equal(ticketTree.includes('function actionToLabel'), false, 'ticket tree should not duplicate action labels');
  assert.equal(ticketTree.includes('function evidenceItemCount'), false, 'ticket tree should not duplicate evidence counting');
  assert.equal(queueTree.includes('function actionIcon'), false, 'queue tree should not duplicate action icons');
  assert.equal(extensionSource.includes('function evidenceCountForTicket'), false, 'extension should call shared evidenceRecordCount directly');
  assert.equal(extensionSource.includes('function isAttentionRunStatus'), false, 'extension should use shared run attention status helper');
  assert.equal(extensionSource.includes('function singleLineRunSummary'), false, 'extension should use shared run attention line formatter');
});

test('queue tree polling clears active-run decorations after runs finish', async () => {
  let runs = [{
    id: 'run-1',
    status: 'running',
    ticket: 'K-1',
    project: 'app',
    skill: 'implement',
    startedAt: new Date().toISOString(),
  }];
  const vscodeStub = createVscodeTestModule();
  await withPatchedModuleLoad(request => {
    if (request === 'vscode') {
      return vscodeStub.vscode;
    }
    if (request.endsWith('/runners/sessionDispatcher') || request.endsWith('\\runners\\sessionDispatcher') || request === '../runners/sessionDispatcher') {
      return { listRuns: () => runs };
    }
    return undefined;
  }, async () => {
    const queueTreePath = require.resolve('../out/views/QueueTreeProvider.js');
    delete require.cache[queueTreePath];
    const { QueueTreeProvider } = require(queueTreePath);
    const provider = new QueueTreeProvider({
      queue: {
        items: [{
          id: 'q1',
          projects: ['app'],
          project_path: '/repo/app',
          ticket: 'K-1',
          action: 'implement',
          priority_score: 10,
          reason: 'active work',
        }],
      },
      onDidChange: () => ({ dispose() {} }),
    });
    let fired = 0;
    const eventSubscription = provider.onDidChangeTreeData(() => { fired += 1; });
    provider.getChildren();
    runs = [];
    provider.startPolling(5);
    await new Promise(resolve => setTimeout(resolve, 20));
    provider.stopPolling();
    eventSubscription.dispose();
    provider.dispose();
    assert.equal(fired > 0, true, 'queue tree should refresh once after the last active run disappears');
  });
});

test('action icon helpers preserve ticket and queue icon semantics', async () => {
  const vscodeStub = createVscodeTestModule();
  const { ThemeColor, ThemeIcon } = vscodeStub;
  await withPatchedModuleLoad(request => {
    if (request === 'vscode') {
      return vscodeStub.vscode;
    }
    return undefined;
  }, async () => {
    const actionIconsPath = require.resolve('../out/views/actionIcons.js');
    delete require.cache[actionIconsPath];
    const actionIcons = require(actionIconsPath);
    assert.deepEqual(actionIcons.ticketActionIcon('implement'), new ThemeIcon('circle-outline', new ThemeColor('disabledForeground')));
    assert.deepEqual(actionIcons.queueActionIcon('implement'), new ThemeIcon('play-circle', new ThemeColor('charts.green')));
    assert.deepEqual(actionIcons.ticketActionIcon('await_review'), new ThemeIcon('git-pull-request', new ThemeColor('charts.yellow')));
    assert.deepEqual(actionIcons.queueActionIcon('await_review'), new ThemeIcon('git-pull-request', new ThemeColor('charts.yellow')));
    assert.deepEqual(actionIcons.queueActionIcon('refresh'), new ThemeIcon('refresh'));
    assert.deepEqual(actionIcons.ticketActionIcon('unknown'), new ThemeIcon('circle-outline', new ThemeColor('disabledForeground')));
    assert.deepEqual(actionIcons.queueActionIcon('unknown'), new ThemeIcon('circle-outline'));
    assert.equal(Object.prototype.hasOwnProperty.call(actionIcons, 'themeIcon'), false);
  });
});

test('trend metrics report rework, build pass, verification pass, and cycle time', () => {
  const tickets = {
    'K-1': ticket({
      updated: '2026-07-01T08:00:00.000Z',
      last_action_at: '2026-07-02T08:00:00.000Z',
      mr: { iid: 1, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/1' },
      build: { number: 1, status: 'SUCCESS', url: 'https://jenkins.example/1' },
      evidence: {
        updated_at: '2026-07-02T10:00:00.000Z',
        checks: [null, { id: 'check-1', at: '2026-07-02T09:00:00.000Z', name: 'npm test', result: 'pass' }],
        environment_results: { broken: null, local: { environment: 'local', status: 'pass', checked_at: '2026-07-02T09:30:00.000Z', detail: 'smoke passed' } },
      },
    }),
    'K-2': ticket({
      updated: '2026-07-03T08:00:00.000Z',
      last_action_at: '2026-07-04T08:00:00.000Z',
      mr: { iid: 2, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/2' },
      build: { number: 2, status: 'FAILURE', url: 'https://jenkins.example/2' },
      evidence: {
        checks: ['bad check', { id: 'check-2', at: '2026-07-04T09:00:00.000Z', name: 'smoke', result: 'fail' }],
        environment_results: { broken: 'bad environment', test: { environment: 'test', status: 'fail', checked_at: '2026-07-04T09:30:00.000Z', detail: 'smoke failed' } },
      },
    }),
  };

  const report = trendMetrics.computeTrendMetrics({
    now: new Date('2026-07-05T00:00:00.000Z'),
    windowDays: 7,
    tickets,
    runs: [
      null,
      'not-a-run',
      { id: 'bad-date', ticket: 'K-1', skill: 'verify-local', status: 'completed', startedAt: { value: '2026-07-04T09:00:00.000Z' } },
      { id: 'bad-metadata', ticket: 'K-1', skill: 'verify-local', status: 'completed', promptMetadata: 'retry-ish' },
      { id: 'r1', ticket: 'K-1', skill: 'verify-local', status: 'waiting_for_review', startedAt: '2026-07-01T09:00:00.000Z', endedAt: '2026-07-01T10:00:00.000Z' },
      { id: 'r2', ticket: 'K-2', skill: 'implement', status: 'failed', startedAt: '2026-07-03T09:00:00.000Z', endedAt: '2026-07-03T10:00:00.000Z' },
      { id: 'r3', ticket: 'K-2', skill: 'verify-local', status: 'needs_human', startedAt: '2026-07-04T09:00:00.000Z', endedAt: '2026-07-04T10:00:00.000Z', promptMetadata: { retryOfRunId: 'r2' } },
      { id: 'old', ticket: 'K-3', skill: 'verify-local', status: 'completed', startedAt: '2026-06-01T09:00:00.000Z', endedAt: '2026-06-01T10:00:00.000Z' },
    ],
  });

  assert.equal(report.windowDays, 7);
  assert.equal(report.runsConsidered, 3);
  assert.equal(report.ticketsConsidered, 2);
  assert.match(report.summary, /rework/);
  assert.ok(report.metrics.some(metric => metric.label === 'Rework rate' && metric.value === '80%' && metric.status === 'bad'));
  assert.ok(report.metrics.some(metric => metric.label === 'Build pass rate' && metric.value === '50%' && metric.status === 'bad'));
  assert.ok(report.metrics.some(metric => metric.label === 'Verification pass rate' && metric.value === '50%' && metric.status === 'bad'));
  assert.ok(report.metrics.some(metric => metric.label === 'Average cycle time' && metric.value !== 'n/a'));

  const source = readSourceFixture('src', 'services', 'trendMetrics.ts');
  for (const marker of [
    'runs: unknown[]',
    "import { recordString } from './records'",
    "import { hasRetryMetadata, isRunLikeRecord, type RunLikeRecord } from './runRecords'",
    'const rawRuns = Array.isArray(input.runs) ? input.runs : []',
    '.filter(isRunLikeRecord)',
    'function cycleTimesHours(tickets: Record<string, Ticket>, runs: RunLikeRecord[]): number[]',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'runs: any[]',
    'Record<string, any>',
    'type RunMetricRecord',
    'function hasRetryMetadata',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('dashboard worklist builds command-center lanes from review, run, gate, and aging signals', () => {
  const lanes = dashboardWorklist.buildDashboardWorklist({
    runs: [
      null,
      'not-a-run',
      { id: 'active-old', status: 'running', project: 'api', skill: 'implement', ticket: 'K-1', startedAt: '2026-07-01T09:00:00.000Z' },
      { id: 'terminal-active', status: 'running', project: 'api', skill: 'implement', ticket: 'K-DONE', startedAt: '2026-07-01T09:30:00.000Z', endedAt: '2026-07-01T09:45:00.000Z' },
      { id: 'active-new', status: 'paused', project: 'web', skill: 'verify', ticket: 'K-2', startedAt: '2026-07-01T10:00:00.000Z' },
      { id: 'done', status: 'completed', project: 'web', skill: 'verify', ticket: 'K-PASS', endedAt: '2026-07-01T11:00:00.000Z' },
    ],
    humanReviewInbox: {
      summary: { critical: 1, warning: 0, info: 0, total: 1 },
      items: [{ id: 'run:r2', kind: 'run', severity: 'critical', title: 'web verify needs review', detail: 'auth expired', ticketKey: 'K-2', runId: 'r2' }],
    },
    evidenceGates: [
      { ticketKey: 'K-FAIL', status: 'fail', ready: false, summary: '2 failing, 1 warning, 3 passing', checks: [] },
      { ticketKey: 'K-PASS', status: 'pass', ready: true, summary: '0 failing, 0 warning, 4 passing', checks: [] },
    ],
    agingReport: {
      generatedAt: '2026-07-01T12:00:00.000Z',
      summary: { critical: 0, warning: 1, info: 0, total: 1 },
      items: [{
        id: 'ticket:K-OLD',
        ticketKey: 'K-OLD',
        kind: 'ticket',
        severity: 'warning',
        ageDays: 16,
        thresholdDays: 14,
        title: 'K-OLD has not moved recently',
        detail: 'Next action is implement.',
      }],
    },
  }, 3);
  const lane = kind => lanes.find(item => item.kind === kind);

  assert.deepEqual(lanes.map(item => item.kind), ['needs_human', 'active_runs', 'failing_gates', 'recent_completed', 'stale_items']);
  assert.equal(lane('needs_human').items[0].title, 'web verify needs review');
  assert.equal(lane('active_runs').items[0].runId, 'active-new');
  assert.equal(lane('active_runs').items[0].severity, 'warning');
  assert.match(lane('active_runs').items[0].detail, /paused for K-2; 0 tools \| 0 changed \| /);
  assert.equal(lane('active_runs').items.some(item => item.runId === 'terminal-active'), false);
  assert.equal(lane('failing_gates').items[0].ticketKey, 'K-FAIL');
  assert.match(lane('recent_completed').items[0].detail, /evidence gate pass/);
  assert.equal(lane('stale_items').items[0].ticketKey, 'K-OLD');

  const source = readSourceFixture('src', 'services', 'dashboardWorklist.ts');
  assert.ok(source.includes("import { formatRunProgress } from './runProgress'"));
  assert.ok(source.includes("import { isFreshActiveRun } from './runStatus'"));
  assert.ok(source.includes("import { isRunLikeRecord, type RunLikeRecord } from './runRecords'"));
  assert.ok(source.includes('const rawRuns: unknown[] = Array.isArray(input.runs) ? input.runs : []'));
  assert.ok(source.includes('const runs = rawRuns.filter(isRunLikeRecord)'));
  assert.ok(source.includes('function isDashboardActiveRun'));
  assert.ok(source.includes('return isFreshActiveRun(run);'));
  assert.ok(source.includes('function activeRunDetail(run: RunLikeRecord, status: string, ticketKey: string): string'));
  assert.ok(source.includes('formatRunProgress(run)'));
  assert.equal(source.includes('type DashboardRunRecord = RunRecord & Record<string, unknown>'), false);
  assert.equal(source.includes('type DashboardRunRecord = RunRecord & Record<string, any>'), false);
  assert.equal(source.includes('function isRunRecord'), false);
});

test('agent quality score combines run outcomes, evidence gates, builds, reviews, and retries', () => {
  const tickets = {
    'K-1': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 1, state: 'opened', review_status: 'approved', url: 'https://gitlab.example/1' },
      build: { number: 1, status: 'SUCCESS', url: 'https://jenkins.example/1' },
      evidence: {
        acceptance_criteria: [{ id: 'ac-1', text: 'Works', checked: true }],
        notes: [{ at: 'now', kind: 'test', text: 'npm test passed' }],
      },
    }),
    'K-2': ticket({
      projects: ['app'],
      next_action: 'await_review',
      mr: { iid: 2, state: 'opened', review_status: 'changes_requested', url: 'https://gitlab.example/2' },
      build: { number: 2, status: 'FAILURE', url: 'https://jenkins.example/2' },
      evidence: { notes: [] },
    }),
  };
  const score = agentQualityScore.computeAgentQualityScore({
    tickets,
    runs: [
      null,
      'not-a-run',
      { id: 'r1', status: 'waiting_for_review', ticket: 'K-1' },
      { id: 'r2', status: 'failed', ticket: 'K-2' },
      { id: 'r3', status: 'needs_human', ticket: 'K-2', promptMetadata: { retryOfRunId: 'r2' } },
    ],
  });

  assert.ok(score.score < 80);
  assert.ok(score.components.some(component => component.label === 'Run completion'));
  assert.ok(score.components.some(component => component.label === 'Evidence readiness' && component.detail.includes('failing evidence gates')));
  assert.ok(score.metrics.some(metric => metric.label === 'Retries' && metric.value === '1'));
  assert.match(score.summary, /needs-human run/);

  const source = readSourceFixture('src', 'services', 'agentQualityScore.ts');
  assert.ok(source.includes("import { isActiveRun } from './runStatus'"));
  assert.ok(source.includes("import { hasRetryMetadata, isRunLikeRecord } from './runRecords'"));
  assert.ok(source.includes('runs: unknown[]'));
  assert.ok(source.includes('.filter(isRunLikeRecord)'));
  assert.equal(source.includes('type RunQualityRecord'), false);
  assert.equal(source.includes('type RunQualityRecord = RunRecord & Record<string, any>'), false);
  assert.equal(source.includes('function hasRetryMetadata'), false);
});
