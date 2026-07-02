const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.KRONOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-home-'));
process.env.KRONOS_SCRIPTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-scripts-'));

function readSourceFixture(...segments) {
  return fs.readFileSync(path.join(__dirname, '..', ...segments), 'utf8').replace(/\r\n/g, '\n');
}

function mockCommandName(command) {
  return String(command).split(/[\\/]/).pop().replace(/\.(cmd|bat|exe)$/i, '').toLowerCase();
}

function mockCommandLine(command, args) {
  return [mockCommandName(command), ...args].join(' ');
}

const promptManager = require('../out/services/promptManager.js');
const stateStore = require('../out/services/stateStore.js');
const queuePlanner = require('../out/services/queuePlanner.js');
const evidenceStore = require('../out/services/evidenceStore.js');
const evidenceHandoff = require('../out/services/evidenceHandoff.js');
const evidencePublisher = require('../out/services/evidencePublisher.js');
const runStore = require('../out/services/runStore.js');
const recoveryCenter = require('../out/services/recoveryCenter.js');
const ticketTimeline = require('../out/services/ticketTimeline.js');
const collisionDetector = require('../out/services/collisionDetector.js');
const scriptClient = require('../out/services/scriptClient.js');
const integrationAdapters = require('../out/services/integrationAdapters.js');
const acceptanceCriteria = require('../out/services/acceptanceCriteria.js');
const humanReviewInbox = require('../out/services/humanReviewInbox.js');
const evidenceGate = require('../out/services/evidenceGate.js');
const evidenceGatePolicy = require('../out/services/evidenceGatePolicy.js');
const agentQualityScore = require('../out/services/agentQualityScore.js');
const dashboardWorklist = require('../out/services/dashboardWorklist.js');
const integrationManifest = require('../out/services/integrationManifest.js');
const profileManager = require('../out/services/profileManager.js');
const agingAnalyzer = require('../out/services/agingAnalyzer.js');
const safetyGate = require('../out/services/safetyGate.js');
const trendMetrics = require('../out/services/trendMetrics.js');
const postRunReadiness = require('../out/services/postRunReadiness.js');
const ticketFilters = require('../out/services/ticketFilters.js');
const runRecovery = require('../out/services/runRecovery.js');
const providerReachability = require('../out/services/providerReachability.js');
const ticketMutations = require('../out/services/ticketMutations.js');
const queueMutations = require('../out/services/queueMutations.js');
const projectMutations = require('../out/services/projectMutations.js');
const doctorChecks = require('../out/services/doctorChecks.js');
const stateScriptAdapter = require('../out/services/stateScriptAdapter.js');
const nextActionContext = require('../out/services/nextActionContext.js');
const gitWorkspace = require('../out/services/gitWorkspace.js');
const processTree = require('../out/services/processTree.js');
const webviewSecurity = require('../out/services/webviewSecurity.js');
const runStatus = require('../out/services/runStatus.js');
const runProgress = require('../out/services/runProgress.js');
const attentionBadge = require('../out/services/attentionBadge.js');
const cliProbes = require('../out/services/cliProbes.js');
const errorUtils = require('../out/services/errorUtils.js');
const combinedVerification = require('../out/services/combinedVerification.js');
const changedFiles = require('../out/services/changedFiles.js');
const sonarReportView = require('../out/services/sonarReportView.js');
const agingReportView = require('../out/services/agingReportView.js');
const webviewHtml = require('../out/services/webviewHtml.js');
const fileNames = require('../out/services/fileNames.js');
const sessionStore = require('../out/services/sessionStore.js');
const worktreeRegistry = require('../out/services/worktreeRegistry.js');
const terminalProfiles = require('../out/services/terminalProfiles.js');

function makeTempProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-test-'));
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

  const diff = promptManager.diffPromptHistorySnapshots(second, first);
  assert.equal(diff.summary.added, 1);
  assert.equal(diff.summary.removed, 1);
  assert.equal(diff.summary.changed, 1);
  assert.ok(diff.changes.some(change => change.kind === 'changed' && change.name === 'alpha' && change.afterVariables.includes('TWO')));
  assert.ok(fs.existsSync(path.join(promptManager.PROMPT_HISTORY_DIR, `${second.id}.json`)));
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
  const files = fs.readdirSync(promptManager.PROMPT_HISTORY_DIR).filter(file => file.endsWith('.json'));

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
        mr: { iid: 3, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/3' },
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

  fs.mkdirSync(path.dirname(stateStore.STATE_WRITE_LOCK_FILE), { recursive: true });
  fs.writeFileSync(stateStore.STATE_WRITE_LOCK_FILE, JSON.stringify({ pid: 123, action: 'held', createdAt: new Date().toISOString() }));
  assert.throws(
    () => stateStore.writeJsonFileAtomic(stateStore.STATE_FILE, next, 'blocked-write'),
    /state write lock is held/
  );
  fs.unlinkSync(stateStore.STATE_WRITE_LOCK_FILE);

  stateStore.writeJsonFileAtomic(stateStore.STATE_FILE, next, 'locked-write');
  assert.equal(fs.existsSync(stateStore.STATE_WRITE_LOCK_FILE), false);
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

  const migrated = stateStore.migrateStateFileShape(legacy);
  assert.equal(migrated.version, 1);
  assert.deepEqual(migrated.settings.scan_dirs, []);
  assert.equal(migrated.projects.app.health, 'gray');
  assert.equal(migrated.projects.app.open_mr_count, 0);
  assert.deepEqual(migrated.tickets['K-1'].projects, []);
  assert.equal(migrated.tickets['K-1'].type, 'Story');
  assert.equal(migrated.tickets['K-1'].next_action, 'implement');
  assert.doesNotThrow(() => stateStore.validateStateFileShape(migrated));

  fs.writeFileSync(stateStore.STATE_FILE, JSON.stringify(legacy, null, 2));
  const read = stateStore.readStateFile();
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
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'unknown validation error')",
    "unknownErrorMessage(e, 'Failed to load state.json')",
    "unknownErrorMessage(e, 'invalid project record')",
    "unknownErrorMessage(e, 'invalid ticket record')",
    "unknownErrorMessage(e, 'Invalid audit JSONL entry')",
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

test('KronosState load issues normalize unknown errors', () => {
  const source = readSourceFixture('src', 'state', 'KronosState.ts');
  for (const marker of [
    "import { unknownErrorMessage } from '../services/errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Failed to load state.json')",
    "unknownErrorMessage(e, 'Failed to load queue.json')",
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

test('state store migrates legacy queue shape before validation and reads', () => {
  const legacyQueue = {
    items: [
      { ticket: 'K-1', project: 'app', action: 'verify' },
      { ticket: 'K-2', projects: 'api', path: '/repo/api' },
    ],
  };

  const migrated = stateStore.migrateQueueFileShape(legacyQueue);
  assert.equal(migrated.last_computed, null);
  assert.equal(migrated.items[0].id, 'queued-K-1-0');
  assert.deepEqual(migrated.items[0].projects, ['app']);
  assert.equal(migrated.items[0].priority_score, 0);
  assert.equal(migrated.items[1].project_path, '/repo/api');
  assert.deepEqual(migrated.items[1].projects, ['api']);
  assert.doesNotThrow(() => stateStore.validateQueueState(migrated));

  fs.writeFileSync(stateStore.QUEUE_FILE, JSON.stringify(legacyQueue, null, 2));
  const read = stateStore.readQueueFile();
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
  assert.ok(blockedDecision.blockingChecks.some(check => check.title === 'No evidence notes'));
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
    'function normalizeQueueItem(item: unknown): QueueItem',
    'function queueRecord(value: unknown): Record<string, unknown>',
    'function queueString(value: unknown): string',
    'function queueNullableString(value: unknown): string | null',
    'function queueStringArray(value: unknown): string[]',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(source.includes('function normalizeQueueItem(item: any): QueueItem'), false);
});

test('project mutation helpers centralize project config, scan dirs, and removal', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-project-'));
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
  assert.ok(plannedTicket && plannedTicket.reason.includes('no evidence notes yet'));
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
  assert.equal(queuedStart.safetyPlan.command, 'kronos.startQueueItem');
  assert.equal(queuedStart.safetyPlan.confirmationLabel, 'Start');
  assert.ok(queuedStart.safetyPlan.changes.some(item => item.includes('Dispatch Claude /implement')));
  assert.ok(queuedStart.safetyPlan.warnings.some(item => item.includes('Claude auth preflight')));

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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-git-workspace-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-runs-'));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-git-workspace-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-runs-'));
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
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-worktree-'));
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-project-'));
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
    if (joined === 'rev-parse origin/feature/K-1') { return 'abc123\n'; }
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
  assert.ok(calls.some(call => call.args.join(' ') === 'fetch origin'));
  assert.ok(calls.some(call => call.args.join(' ') === 'worktree add /tmp/wt feature/K-1'));

  const entry = { projectPath, worktreePath: workspace, ticket: 'K-1', createdAt: 'now' };
  const inspected = gitWorkspace.inspectTrackedWorktree(entry, { runner });
  assert.equal(inspected.status, 'removable');
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

test('worktree registry tracks, deduplicates, and untracks entries safely', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-worktree-registry-'));
  const registryPath = path.join(dir, 'active-worktrees.json');

  worktreeRegistry.trackActiveWorktree('/repo/app', '/repo/app/.claude/worktrees/K-1', 'K-1', new Date('2026-07-01T10:00:00.000Z'), registryPath);
  worktreeRegistry.trackActiveWorktree('/repo/app', '/repo/app/.claude/worktrees/K-1', 'K-1-retry', new Date('2026-07-01T11:00:00.000Z'), registryPath);

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-worktree-registry-bad-'));
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
  assert.deepEqual(stop, { attempted: true, signalled: true, method: 'process-group', fallbackUsed: false, error: undefined });
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

  assert.equal(processTree.stopProcessTree(undefined).attempted, false);
  assert.equal(processTree.signalProcessTree(-1, 'SIGSTOP').attempted, false);

  const source = readSourceFixture('src', 'services', 'processTree.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    'catch (e: unknown)',
    'catch (fallbackError: unknown)',
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
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('webview security injects CSP and preserves existing nonce policies', () => {
  const readOnly = webviewSecurity.withWebviewCsp('<!DOCTYPE html><html><head><style>body{}</style></head><body>ok</body></html>');
  assert.match(readOnly, /Content-Security-Policy/);
  assert.match(readOnly, /default-src 'none'/);
  assert.match(readOnly, /script-src 'none'/);

  const scriptable = webviewSecurity.webviewCspMeta({ allowScripts: true, nonce: 'abc123', imgSrc: ['data:', 'https:'] });
  assert.match(scriptable, /script-src 'nonce-abc123'/);
  assert.match(scriptable, /img-src data: https:/);
  const scriptableWithSource = webviewSecurity.webviewCspMeta({ allowScripts: true, nonce: 'abc123', cspSource: 'vscode-resource:' });
  assert.match(scriptableWithSource, /style-src vscode-resource: 'unsafe-inline'/);
  assert.match(scriptableWithSource, /script-src 'nonce-abc123'/);
  assert.doesNotMatch(scriptableWithSource, /script-src vscode-resource:/);

  const nonce = webviewSecurity.createWebviewNonce();
  assert.match(nonce, /^[a-f0-9]{32}$/);
  assert.doesNotMatch(nonce, /[+/=]/);
  const nonceSource = webviewSecurity.webviewCspMeta({ allowScripts: true, nonce });
  assert.match(nonceSource, new RegExp(`script-src 'nonce-${nonce}'`));
  const apiScript = webviewSecurity.webviewVsCodeApiScript();
  assert.match(apiScript, /const vscode = \(function\(\) \{/);
  assert.match(apiScript, /typeof acquireVsCodeApi !== 'function'/);
  assert.match(apiScript, /Failed to acquire VS Code API for Kronos webview action/);
  assert.match(apiScript, /VS Code API unavailable for Kronos webview action/);
  assert.match(apiScript, /data-kronos-script-ready/);
  assert.match(apiScript, /Kronos webview script ready/);
  assert.match(apiScript, /Kronos webview script error/);
  assert.match(apiScript, /Kronos webview unhandled rejection/);
  assert.doesNotMatch(apiScript, /window\.__kronosVscodeApi/);
  assert.doesNotMatch(apiScript, /var vscode =/);

  const existing = '<html><head><meta http-equiv="Content-Security-Policy" content="default-src test"></head><body></body></html>';
  assert.equal(webviewSecurity.withWebviewCsp(existing), existing);
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
  assert.equal(cliProbes.checkGcloudApplicationDefaultAuth({ commandRunner }).ok, true);

  assert.deepEqual(calls.map(call => [mockCommandName(call.command), call.args, call.options.timeoutMs]), [
    ['claude', ['agents', '--json'], 5000],
    ['claude', ['-p', 'ok', '--model', 'claude-sonnet-4-6', '--permission-mode', 'auto'], 15000],
    ['gcloud', ['auth', 'application-default', 'print-access-token'], 10000],
  ]);

  const windowsCalls = [];
  assert.equal(cliProbes.checkGcloudApplicationDefaultAuth({
    platform: 'win32',
    existsSync: () => false,
    commandRunner(command, args, options) {
      windowsCalls.push({ command, args, options });
      return commandRunner(command, args, options);
    },
  }).ok, true);
  assert.deepEqual(windowsCalls.map(call => [mockCommandName(call.command), call.args, call.options.timeoutMs]), [
    ['gcloud', ['auth', 'application-default', 'print-access-token'], 10000],
  ]);
});

test('CLI probes normalize failures and invalid Claude agent output', () => {
  const failed = cliProbes.checkGcloudApplicationDefaultAuth({
    commandRunner: () => { throw new Error('expired application default credentials'); },
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /expired application default credentials/);

  const stringFailure = cliProbes.runCliProbe('claude', ['agents', '--json'], {
    commandRunner: () => { throw 'claude unavailable'; },
  });
  assert.equal(stringFailure.ok, false);
  assert.equal(stringFailure.error, 'claude unavailable');

  const fallbackFailure = cliProbes.runCliProbe('claude', ['agents', '--json'], {
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

  const source = readSourceFixture('src', 'services', 'errorUtils.ts');
  for (const marker of [
    'export function unknownErrorMessage(error: unknown, fallback: string): string',
    'export function unknownErrorField(error: unknown, key: string): unknown',
    "Reflect.get(error, key)",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
});

test('CLI probes resolve gcloud.cmd on Windows', () => {
  const gcloudCmd = 'C:\\Users\\dev\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd';
  const env = { LocalAppData: 'C:\\Users\\dev\\AppData\\Local' };
  assert.equal(
    cliProbes.resolveGcloudCommand({
      platform: 'win32',
      env,
      existsSync: filePath => filePath === gcloudCmd,
    }),
    gcloudCmd,
  );
  assert.equal(
    cliProbes.resolveGcloudCommand({
      platform: 'win32',
      env: {},
      existsSync: () => false,
    }),
    'gcloud.cmd',
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
  assert.deepEqual(invocation.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(invocation.args[3], /"C:\\Users\\dev\\AppData\\Local\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud\.cmd"/);
  assert.match(invocation.args[3], /"application-default"/);
});

test('CLI probes accept readable GOOGLE_APPLICATION_CREDENTIALS without running gcloud', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-gac-'));
  const credentialsPath = path.join(dir, 'service-account.json');
  fs.writeFileSync(credentialsPath, '{}');
  const result = cliProbes.checkGcloudApplicationDefaultAuth({
    env: { GOOGLE_APPLICATION_CREDENTIALS: credentialsPath },
    commandRunner: () => { throw new Error('gcloud should not run'); },
  });

  assert.equal(result.ok, true);
  assert.match(result.output, /GOOGLE_APPLICATION_CREDENTIALS file is readable/);
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
  assert.equal(changedFiles.normalizeChangedFilePath(42), '');
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
    nonce: 'nonce123',
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
  });

  assert.equal(report.issueList.length, 1);
  assert.equal(report.dashboardUrl, 'https://sonar.example/dashboard?id=proj%3Akey&branch=feature%2F%3Cx%3E');
  assert.match(report.html, /script nonce="nonce123"/);
  assert.match(report.html, /vscode\.postMessage\(\{ command: 'fixSonar' \}\)/);
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
  }));
  assert.equal(sonarReportView.sonarGateStatus(null), 'UNKNOWN');
  assert.deepEqual(sonarReportView.sonarConditionList({ projectStatus: { conditions: 'bad' } }), []);
  assert.deepEqual(sonarReportView.sonarMeasureList({ measures: 'bad' }), []);

  const nonHttpDashboard = sonarReportView.buildSonarReport({
    projectName: 'app',
    branch: 'main',
    sonarKey: 'app',
    host: 'file:///tmp/sonar',
    nonce: 'n',
    gate: {},
    measures: {},
    issues: {},
  });
  assert.equal(nonHttpDashboard.dashboardUrl, undefined);
  assert.doesNotMatch(nonHttpDashboard.html, /Open in SonarQube/);
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
    'queueItem?: QueueItem',
    'export function planToQueueItem(input: PlannerInput, plan: PlannedAction): QueueItem',
    'function evidenceItemCount(ticket: Ticket): number',
    'function releaseKeysForPlan(ticket?: Ticket, queueItem?: unknown): string[]',
    'function releaseField(source: unknown, field: string): unknown',
    'function collectReleaseValues(target: string[], value: unknown): void',
    'function releaseFromLabel(label: unknown): string | undefined',
  ]) {
    assert.ok(queuePlannerSource.includes(marker), marker);
  }
  assert.equal(/\bany\b/.test(queuePlannerSource), false, 'queuePlanner should keep planner payloads typed without any');
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

  const markdown = evidenceStore.formatEvidenceMarkdown('K-9', t);
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
  assert.equal(evidenceStore.hasEvidence(t), true);
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
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
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
  assert.equal(runStore.readRuns().some(r => r.id === run.id), false);
  assert.equal(runStore.readArchivedRuns().some(r => r.id === run.id), true);
});

test('run store archive does not overwrite existing archived records or artifacts', () => {
  fs.mkdirSync(runStore.ARCHIVED_RUNS_DIR, { recursive: true });
  const existingRunPath = runStore.archivedRunRecordPath('run-collision');
  const existingLogPath = path.join(runStore.ARCHIVED_RUNS_DIR, 'shared.log');
  const existingPromptPath = path.join(runStore.ARCHIVED_RUNS_DIR, 'shared.prompt.txt');
  fs.writeFileSync(existingRunPath, JSON.stringify({ id: 'run-collision', archivedAt: 'old' }, null, 2));
  fs.writeFileSync(existingLogPath, 'old log\n');
  fs.writeFileSync(existingPromptPath, 'old prompt\n');

  const logPath = path.join(runStore.RUNS_DIR, 'shared.log');
  const promptPath = path.join(runStore.RUNS_DIR, 'shared.prompt.txt');
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

  assert.notEqual(archived.runPath, existingRunPath);
  assert.notEqual(archived.logPath, existingLogPath);
  assert.notEqual(archived.promptPath, existingPromptPath);
  assert.equal(fs.readFileSync(existingRunPath, 'utf8'), JSON.stringify({ id: 'run-collision', archivedAt: 'old' }, null, 2));
  assert.equal(fs.readFileSync(existingLogPath, 'utf8'), 'old log\n');
  assert.equal(fs.readFileSync(existingPromptPath, 'utf8'), 'old prompt\n');
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
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-external-artifact-'));
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

test('run store refuses to append logs outside active runs directory', () => {
  const externalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-external-log-'));
  const externalLog = path.join(externalDir, 'run.log');
  const archivedLog = path.join(runStore.ARCHIVED_RUNS_DIR, 'old.log');
  fs.mkdirSync(runStore.ARCHIVED_RUNS_DIR, { recursive: true });

  assert.throws(
    () => runStore.appendRunLog(externalLog, 'bad\n'),
    /outside active runs directory/,
  );
  assert.throws(
    () => runStore.appendRunLog(archivedLog, 'bad\n'),
    /outside active runs directory/,
  );
  assert.equal(fs.existsSync(externalLog), false);
  assert.equal(fs.existsSync(archivedLog), false);
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
  fs.writeFileSync(invalidJsonPath, '{ invalid json');
  fs.writeFileSync(missingIdPath, JSON.stringify({ status: 'running' }));

  const runs = runStore.readRuns();
  const issues = runStore.listRunStoreIssues();

  assert.ok(runs.some(r => r.id === valid.id));
  assert.equal(runs.some(r => r.id === 'run-bad-json'), false);
  assert.ok(issues.some(issue => issue.filePath === invalidJsonPath && issue.scope === 'active' && issue.kind === 'invalid_run_record'));
  assert.ok(issues.some(issue => issue.filePath === invalidJsonPath && /Unexpected token|Expected property name/.test(issue.detail)));
  assert.ok(issues.some(issue => issue.filePath === missingIdPath && /id/.test(issue.detail)));
  assert.throws(
    () => runStore.markRunCancelled('run-bad-json', 'operator stopped it'),
    /Invalid run record/,
  );

  const source = readSourceFixture('src', 'services', 'runStore.ts');
  for (const marker of [
    "import { unknownErrorMessage } from './errorUtils'",
    '[key: string]: unknown',
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Unable to parse JSON.')",
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

test('dispatcher records branch and permission metadata for persisted runs', () => {
  const source = readSourceFixture('src', 'runners', 'sessionDispatcher.ts');
  for (const marker of [
    'branch?: RunBranchMetadata',
    'permissions?: RunPermissionMetadata',
    'export interface RunBranchMetadata',
    'export interface RunPermissionMetadata',
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
    'registryIssue: registry.issue',
    "const failureDetail = unknownErrorMessage(e, 'Git worktree setup failed.')",
    "vscode.window.showWarningMessage('Git worktree setup failed; run marked failed before launch.')",
    "label: 'Git worktree setup failed'",
    "failureKind: 'git'",
    "from '../services/sessionStore'",
    "type PostRunReadiness",
    'readiness?: PostRunReadiness',
    "import { unknownErrorMessage } from '../services/errorUtils'",
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Could not read Kronos state for base branch.')",
    "unknownErrorMessage(e, 'Invalid JSON')",
    "unknownErrorMessage(e, 'Failed to read Kronos state.')",
    "unknownErrorMessage(e, 'Invalid dispatch model.')",
    'writeSavedSession(session)',
    'export { getAggregateStats, listSavedSessions, listSessionStoreIssues }',
    'const id = safeSessionId',
    "from '../services/webviewSecurity'",
    "import { isActiveRun } from '../services/runStatus'",
    "import { runProgressSummary } from '../services/runProgress'",
    'createWebviewNonce',
    'webviewVsCodeApiScript',
    "const nonce = interactive ? createWebviewNonce() : ''",
    "${webviewVsCodeApiScript('Kronos Run Center')}",
    "'refreshPanel'",
    'pollIntervalMs?: number',
    'const pollTimer = setInterval',
    'panel.onDidDispose(() => clearInterval(pollTimer))',
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
    'const progress = runProgressSummary(run)',
    'export interface RunCenterActionRequest',
    'const RUN_CENTER_MESSAGE_COMMANDS = new Set',
    'function normalizeRunCenterMessage',
    "message.command === 'refreshPanel'",
    'function runCenterActionButtons',
    "runCenterActionButton('refreshPanel', 'Refresh')",
    "runCenterActionButton('cancelRun', 'Stop'",
    'panel.webview.onDidReceiveMessage(async msg =>',
    'buildRunCenterHtml(runs, interactive ? nonce : undefined)',
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
  ]) {
    assert.ok(source.includes(marker), marker);
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
    source.includes('value is Record<string, any>'),
    false,
    'dispatcher record guards should preserve unknown field types',
  );
  assert.equal(
    source.includes('readiness?: any'),
    false,
    'dispatcher should type run readiness with the post-run readiness contract',
  );

  assert.ok(
    source.indexOf('permissions: buildRunPermissionMetadata([\'~/.claude\'])') < source.indexOf('const authed = await ensureAuth()'),
    'default permissions should be persisted before auth preflight',
  );
  assert.ok(
    source.indexOf('const permissions = buildRunPermissionMetadata(addDirs)') < source.indexOf('const proc = spawn(CLAUDE_PATH'),
    'final permissions should be persisted before process launch',
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
  fs.writeFileSync(path.join(sessionsDir, 'aaa-new.json'), JSON.stringify({
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
  }));
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
  assert.deepEqual(sessionStore.normalizeSavedSessionEvents({ bad: true }), []);
});

test('session store normalizes aggregate stats rows for rendering', () => {
  const statsPath = path.join(process.env.KRONOS_DIR, 'stats.json');
  fs.writeFileSync(statsPath, JSON.stringify({
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
  }));

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

test('run recovery builds resume prompts from saved prompt and log tail', () => {
  const logPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-run-log-')), 'run.log');
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

test('recovery center prioritizes failed runs, unsafe worktrees, doctor failures, and backups', () => {
  const inventory = recoveryCenter.buildRecoveryInventory({
    now: new Date('2026-07-01T12:00:00.000Z'),
    staleRunMs: 60 * 60 * 1000,
    runs: [
      {
        id: 'failed-run',
        project: 'app',
        skill: 'implement',
        ticket: 'K-1',
        status: 'failed',
        failureReason: 'tests failed',
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
  assert.ok(inventory.items.some(item => item.id === 'run:failed-run' && item.action === 'resumeRun'));
  assert.ok(inventory.items.some(item => item.id === 'mr:MR-7:7' && item.action === 'linkMrToTicket' && item.ticketKey === 'MR-7'));
  assert.ok(inventory.items.some(item => item.id === 'run:stale-run' && item.title.includes('may be abandoned')));
  assert.ok(inventory.items.some(item => item.kind === 'backup' && item.action === 'restoreBackup'));
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
  assert.ok(events.some(event => event.source === 'mr' && event.severity === 'failure'));
  assert.ok(events.some(event => event.source === 'build' && event.severity === 'failure'));
  assert.equal(events.some(event => event.id.includes('other-run')), false);

  const source = readSourceFixture('src', 'services', 'ticketTimeline.ts');
  assert.ok(source.includes('type TimelineRunRecord = TimelineRun & Record<string, unknown>'));
  assert.equal(source.includes('type TimelineRunRecord = TimelineRun & Record<string, any>'), false);
});

test('run status helper centralizes active persisted run semantics', () => {
  assert.equal(runStatus.isActiveRunStatus('running'), true);
  assert.equal(runStatus.isActiveRunStatus('preflight'), true);
  assert.equal(runStatus.isActiveRunStatus('paused'), true);
  assert.equal(runStatus.isActiveRunStatus('completed'), false);
  assert.equal(runStatus.isActiveRun({ status: 'running' }), true);
  assert.equal(runStatus.isActiveRun({ status: 'waiting_for_review' }), false);
  assert.equal(runStatus.activeRunSummary([
    { status: 'running' },
    { status: 'running' },
    { status: 'preflight' },
    { status: 'paused' },
    { status: 'completed' },
  ]), '2 running, 1 preflight, 1 paused');

  const source = readSourceFixture('src', 'services', 'runStatus.ts');
  for (const marker of [
    "ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused'])",
    'export function isActiveRunStatus',
    'export function isActiveRun',
    'export function activeRunSummary',
    "['running', 'preflight', 'paused']",
  ]) {
    assert.ok(source.includes(marker), marker);
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
  assert.equal(attentionBadge.attentionBadgeCount({
    humanReviewItems: 1,
    evidenceGateFailures: -1,
    evidenceGateWarnings: Number.NaN,
    staleCritical: 1.8,
    staleWarning: 0,
    newReviewItems: 0,
    pausedRuns: 1,
  }), 3);

  const source = readSourceFixture('src', 'services', 'attentionBadge.ts');
  for (const marker of [
    'export function computeAttentionBadge',
    'export function attentionBadgeCount',
    'buildHumanReviewInbox',
    'evaluateEvidenceGates',
    'analyzeAging',
    'runStatus(run)',
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
      { id: 'paused-run', ticket: 'K-7', project: 'app', status: 'paused', skill: 'implement' },
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
  assert.ok(collisions.some(c => c.kind === 'active_run' && c.id.includes('paused-run')));
  assert.ok(collisions.some(c => c.kind === 'queued_ticket'));
  assert.ok(collisions.some(c => c.kind === 'queued_project'));
  assert.ok(collisions.some(c => c.kind === 'open_mr'));
  assert.ok(collisions.some(c => c.kind === 'recent_file' && c.detail.includes('src/checkout/retry.ts')));
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

  fs.writeFileSync(pipelinePath, 'print("not json")\n');
  await assert.rejects(
    () => scriptClient.runPipelineJson(['--bad-json']),
    /Invalid JSON from pipeline_monitor\.py/
  );
  await assert.rejects(
    () => scriptClient.runGitlabJson(['--project-id', 'app']),
    /Kronos script missing/
  );
});

test('script client keeps raw JSON and process errors unknown by default', () => {
  const source = readSourceFixture('src', 'services', 'scriptClient.ts');
  for (const marker of [
    'export async function runJsonScript<T = unknown>',
    'export function runGitlabJson<T = unknown>',
    'export function runPipelineJson<T = unknown>',
    'function parseScriptJson<T = unknown>',
    'function scriptError(scriptName: RequiredScriptName, args: string[], error: unknown)',
    "import { unknownErrorField, unknownErrorMessage } from './errorUtils'",
    "unknownErrorField(error, 'stderr')",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    '<T = any>',
    'catch (e: any)',
    'error: any',
    'e?.message',
    'error?.stderr',
    'function unknownErrorMessage(error: unknown',
    'function errorField(error: unknown',
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

test('state script adapter keeps raw JSON payloads unknown until normalized', () => {
  const source = readSourceFixture('src', 'services', 'stateScriptAdapter.ts');
  for (const marker of [
    '[key: string]: unknown',
    'function parseStateScriptJson(raw: string, label: string): unknown',
    'function isPlainObject(value: unknown): value is Record<string, unknown>',
    "import { unknownErrorMessage } from './errorUtils'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    '[key: string]: any',
    'function parseStateScriptJson(raw: string, label: string): any',
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
        return '[{"body":"ok"}]';
      }
      if (args[0] === '--mr-diff') {
        return JSON.stringify({
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
          files: [{ path: 'src/app.ts' }],
        });
      }
      if (args[0] === '--mr-branch') {
        return JSON.stringify({ branch: 'feature/K-7' });
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
  assert.deepEqual(status.comments.map(comment => comment.id), ['1', '2']);
  assert.deepEqual(calls, [
    ['--ticket-comments', 'K-7'],
    ['--mr-diff', 'K-7'],
    ['--mr-branch', 'K-7'],
    ['--mr-diff', 'K-7'],
  ]);
  assert.deepEqual(integrationAdapters.normalizeJiraComments({
    comments: [
      'plain text',
      null,
      { body: ' hello ', author: { displayName: ' Ada ' }, created: ' 2026-07-01 ' },
      { renderedBody: 'rendered', author: { name: 'jira-user' }, authorName: ' A. User ' },
      { body: 42 },
    ],
  }), [
    { body: 'plain text' },
    { body: '' },
    { author: 'Ada', created: '2026-07-01', body: 'hello' },
    { author: 'jira-user', authorName: 'A. User', body: 'rendered' },
    { body: '' },
  ]);
  assert.deepEqual(integrationAdapters.normalizeJiraComments({ comments: 'bad' }), []);
  assert.deepEqual(integrationAdapters.normalizeMergeRequestStatus({
    mr: { state: 'open', approved: true, author: { name: 'Ada' }, branch: ' feature/K-8 ' },
    discussions: [{ notes: [{ body: 'Looks good', created_at: '2026-07-02T03:00:00.000Z' }] }],
  }), {
    state: 'opened',
    review_status: 'approved',
    author: 'Ada',
    branch: 'feature/K-8',
    comment_count: 1,
    last_comment_at: '2026-07-02T03:00:00.000Z',
    comments: [{ created: '2026-07-02T03:00:00.000Z', body: 'Looks good' }],
  });
  assert.deepEqual(integrationAdapters.normalizeMergeRequestComments(['plain', { body: 42 }]), [{ body: 'plain' }, { body: '' }]);
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
  assert.deepEqual(integrationAdapters.normalizeSonarBranches([
    null,
    '',
    ' develop ',
    { name: ' feature/K-7 ', isMain: true, status: { qualityGateStatus: ' OK ' } },
    { name: 42, status: { qualityGateStatus: 'ERROR' } },
    { name: 'broken-status', status: { qualityGateStatus: 12 } },
  ]), [
    { name: 'develop', isMain: false },
    { name: 'feature/K-7', isMain: true, status: { qualityGateStatus: 'OK' } },
    { name: 'broken-status', isMain: false },
  ]);
  assert.deepEqual(integrationAdapters.normalizeSonarBranches({ branches: [] }), []);

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
    'function parseJson(raw: string, label: string): unknown',
    'catch (e: unknown)',
    'function isRecord(value: unknown): value is Record<string, unknown>',
    "import { unknownErrorMessage } from './errorUtils'",
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'Promise<any>',
    'runPipelineJson<any>',
    'function parseJson(raw: string, label: string): any',
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
  fs.writeFileSync(manifestPath, JSON.stringify({
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
  }, null, 2));
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
    const systemCa = providerReachability.systemCaCertificatesForHttps();
    if (systemCa) {
      assert.equal(systemCa.length > 0, true);
    }
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

test('doctor checks centralize command, credential, project config, and reachability inputs', () => {
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
    GITLAB_TOKEN: 'gitlab-secret',
    GITLAB_HOST: 'gitlab.example',
    SONAR_HOST_URL: 'https://sonar.example',
  };
  const commandRunner = (command, args) => {
    const joined = mockCommandLine(command, args);
    if (joined === 'python --version') { return 'Python 3.12.0\n'; }
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

  assert.deepEqual(doctorChecks.projectConfigGaps(state, profile), ['app: missing jenkins_url']);
  const targets = doctorChecks.buildDoctorReachabilityTargets({
    state,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
    commandRunner,
  }, {
    providers: {
      jira: { baseUrl: 'https://manifest-jira.example' },
      gitlab: { baseUrl: 'https://manifest-gitlab.example' },
      jenkins: { baseUrl: 'https://manifest-jenkins.example' },
      sonar: { baseUrl: 'https://manifest-sonar.example' },
    },
  });
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
  assert.deepEqual(doctorChecks.projectConfigGaps(githubState, githubProfile), ['app: missing github_repository']);
  githubState.projects.app.config.github_repository = 'owner/app';
  assert.deepEqual(doctorChecks.projectConfigGaps(githubState, githubProfile), []);
  const githubTargets = doctorChecks.buildDoctorReachabilityTargets({
    state: githubState,
    queue: null,
    profile: githubProfile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env: { GITHUB_API_URL: 'https://github.enterprise.example/api/v3' },
    commandRunner,
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

  const fallbackChecks = doctorChecks.runDoctorChecks({
    state,
    queue: null,
    profile,
    requiredPrompts: [],
    dispatchModel: 'claude-opus-4-6',
    env,
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
  const credentialsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-gac-doctor-'));
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
    command: 'kronos.openDashboard',
    title: 'Open Dashboard',
    risks: ['read-only'],
    changes: ['Open a read-only panel.'],
  });
  assert.equal(readOnly.requiresConfirmation, false);
  assert.equal(readOnly.modal, false);
  assert.equal(readOnly.highestRisk, 'read-only');

  const destructive = safetyGate.assessSafetyGate({
    command: 'kronos.cleanupWorktrees',
    title: 'Cleanup Stale Worktrees',
    target: '2 clean / 1 blocked',
    risks: ['state-write', 'destructive', 'repo-write'],
    changes: ['Remove clean worktrees.', 'Leave dirty worktrees untouched.'],
    warnings: ['Dry-run result controls removal.'],
    confirmationLabel: 'Remove Clean Worktrees',
  });
  assert.equal(destructive.requiresConfirmation, true);
  assert.equal(destructive.modal, true);
  assert.equal(destructive.highestRisk, 'destructive');
  assert.deepEqual(destructive.risks, ['destructive', 'repo-write', 'state-write']);
  assert.equal(destructive.confirmationLabel, 'Remove Clean Worktrees');
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
      { id: 'run-1', status: 'needs_human', project: 'app', ticket: 'K-2', skill: 'implement', failureReason: 'dirty worktree' },
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
  assert.ok(inbox.items.some(item => item.id === 'run:run-3' && item.detail === 'operator cancelled'));
  assert.ok(inbox.items.some(item => item.id === 'queue:duplicate:K-3'));
  assert.ok(inbox.items.some(item => item.title.includes('No evidence notes')));
  assert.ok(inbox.items.some(item => item.title.includes('Acceptance criteria not extracted')));

  const source = readSourceFixture('src', 'services', 'humanReviewInbox.ts');
  assert.ok(source.includes('type HumanReviewRunRecord = HumanReviewRun & Record<string, unknown>'));
  assert.equal(source.includes('type HumanReviewRunRecord = HumanReviewRun & Record<string, any>'), false);
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
  assert.ok(failing.checks.some(check => check.kind === 'notes' && check.status === 'fail'));
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

  const waitingForReview = postRunReadiness.evaluatePostRunReadiness({
    run: { status: 'waiting_for_review' },
    ticketKey: 'K-1',
    ticket: readyTicket,
    now: new Date('2026-07-01T00:00:00.000Z'),
  });
  assert.equal(waitingForReview.status, 'ready');
  assert.equal(waitingForReview.failureKind, 'none');
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: ticket({ next_action: 'await_review', projects: ['app'] }),
  }), true);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'implement', status: 'completed' },
    ticket: readyTicket,
  }), false);
  assert.equal(postRunReadiness.shouldRecordRunCompletionEvidence({
    run: { id: 'run-1', skill: 'verify-local', status: 'completed' },
    ticket: ticket({ next_action: 'await_review', projects: ['app'] }),
  }), false);
  assert.match(postRunReadiness.buildRunCompletionEvidenceText({ id: 'run-1' }), /run-1 completed/);

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
    "import { evidenceNotes } from './evidenceData'",
    'export function shouldRecordRunCompletionEvidence',
    "runString(record.skill) === 'implement'",
    "input.ticket.next_action === 'await_review'",
    'evidenceNotes(input.ticket).length === 0',
    'export function buildRunCompletionEvidenceText',
    'export function classifyRunFailure(run: unknown): RunFailureKind',
    'function runRecord(value: unknown): Record<string, unknown>',
    'function runString(value: unknown): string',
    'function runText(value: unknown): string | undefined',
    'function runEventDetails(value: unknown): unknown[]',
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
  assert.match(html, /href="https:\/\/ci\.example\/job\?x=1&amp;name=&quot;bad&quot;"/);
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
  assert.match(baseCss, /@media \(max-width: 760px\)/);
});

test('extension webviews use shared UI shell and board filtering affordances', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const boardHandlerStart = source.indexOf('panel.webview.onDidReceiveMessage(async (msg) => {\n        const request = normalizeBoardMessage(msg);');
  const boardHandlerEnd = source.indexOf("    vscode.commands.registerCommand('kronos.viewTicket'", boardHandlerStart);
  assert.ok(boardHandlerStart >= 0 && boardHandlerEnd > boardHandlerStart, 'Jira board message handler should be present');
  const boardHandlerSource = source.slice(boardHandlerStart, boardHandlerEnd);
  for (const marker of [
    "import { createWebviewNonce, webviewVsCodeApiScript, withWebviewCsp } from './services/webviewSecurity'",
    'function createNonce(): string',
    'return createWebviewNonce()',
    'function webviewScriptCsp(webview: vscode.Webview, nonce: string)',
    'cspSource: webview.cspSource',
    'webviewScriptCsp(panel.webview, nonce)',
    'kronosWebviewBaseCss',
    'class="kronos-shell dashboard-shell"',
    'class="kronos-shell board-shell"',
    'class="kronos-shell ticket-shell"',
    'class="kronos-shell diff-shell"',
    'id="board-filter"',
    'id="board-filter-summary"',
    'function initKronosJiraBoard',
    "document.addEventListener('DOMContentLoaded', initKronosJiraBoard)",
    'function applyBoardFilter',
    'let lastFocusedEl = null',
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
    "post(t.isQueued ? 'removeFromQueue' : 'addToQueueFromModal'",
    "linkTicketToProject(ticket, project);\n            state.reloadAndNotify();\n            renderBoard();",
    "unlinkTicketFromProject(ticket, project);\n            state.reloadAndNotify();\n            renderBoard();",
    "const result = addTicketToQueue(ticket);\n            state.reloadAndNotify();\n            renderBoard();",
    "await removeTicketFromQueue(state, ticket, true);\n          renderBoard();",
    "unknownErrorMessage(e, 'Failed to link ticket.')",
    "unknownErrorMessage(e, 'Failed to unlink ticket.')",
    "unknownErrorMessage(e, 'Failed to add ticket to queue.')",
    "${webviewVsCodeApiScript('Kronos Jira Board')}",
    'function kronosOperatorPanelCss',
    'const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set',
    'const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set',
    'const DASHBOARD_MESSAGE_COMMANDS = new Set',
    'const AGING_REPORT_MESSAGE_COMMANDS = new Set',
    'const PLAN_MESSAGE_COMMANDS = new Set',
    'const BACKLOG_TRIAGE_MESSAGE_COMMANDS = new Set',
    'const TICKET_DETAIL_MESSAGE_COMMANDS = new Set',
    'const RECOVERY_MESSAGE_COMMANDS = new Set',
    'const TICKET_SCOPED_OPERATOR_COMMANDS = new Set',
    'function normalizeActionPanelMessage',
    'planId: typeof message.planId === \'string\' ? message.planId : \'\'',
    'itemId: typeof message.itemId === \'string\' ? message.itemId : \'\'',
    'function humanReviewActionButtons',
    "actionButton('extractAcceptanceCriteria', 'Extract AC'",
    "actionButton('startTicket', 'Start'",
    "actionButton('evidenceGate', 'Gate'",
    "actionButton('runCenter', 'Open Run Center'",
    "actionButton('recoveryCenter', 'Recovery'",
    "actionButton('doctor', 'Open Doctor'",
    'await executeOperatorCommandAction(command, ticketKey)',
    "command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner'",
    'function evidenceGateActionButtons',
    "actionButton('addEvidence', 'Add Evidence'",
    "actionButton(isMissingExtraction ? 'extractAcceptanceCriteria' : 'updateAcceptanceCriteria'",
    "actionButton('refreshPanel', 'Refresh')",
    "request.command === 'refreshPanel'",
    "if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }",
    "openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true })",
    'options.refreshAllEvidenceGates',
    'function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[]',
    'function isProofSensitiveAction',
    'function kronosActionPanelScript',
    "${webviewVsCodeApiScript('Kronos action panel')}",
    'script nonce="${escapeAttr(nonce)}"',
    "data-action=\"${escapeAttr(action)}\"",
    "data-plan-id=\"${escapeAttr(options.planId)}\"",
    "data-item-id=\"${escapeAttr(options.itemId)}\"",
    'function openInteractiveRunCenter',
    'function executeRunCenterAction',
    'function executeTicketDetailAction',
    'function openTicketExternalUrl',
    'const updateReviewBadge = () =>',
    'reviewTree.getNewReviewCount()',
    'view.badge = count > 0',
    'reviewTree.onDidChangeNewReviewCount(updateReviewBadge)',
    'reviewTree.markVisibleReviewItemsSeen()',
    "import { computeAttentionBadge } from './services/attentionBadge'",
    'const updateAttentionBadge = () =>',
    'newReviewItems: reviewTree.getNewReviewCount()',
    'attentionBadgeTarget.badge = summary.count > 0',
    'reviewTree.onDidChangeNewReviewCount(updateAttentionBadge)',
    'startReviewAutomation(context, state)',
    'positiveConfigNumber(config.get<number>(\'reviewPollIntervalSec\', fallbackSec), fallbackSec)',
    'function positiveConfigNumber',
    'void poll();',
    'function pollReviewMergeRequests',
    'gitlabAdapter.mergeRequestStatus',
    'updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status })',
    'update.closedNow',
    'MR closed - ticket moved to blocked.',
    'type TicketWithOpenMergeRequest = Ticket & { mr: NonNullable<Ticket[\'mr\']> }',
    'function isOpenReviewMergeRequestEntry(entry: [string, Ticket]): entry is [string, TicketWithOpenMergeRequest]',
    '.filter(isOpenReviewMergeRequestEntry)',
    'function reviewBranchTickets(state: KronosState): ReviewBranchTicket[]',
    'return reviewMergeRequestCandidates(state).map(({ ticketKey, ticket }) => ({',
    "vscode.window.showInformationMessage('No open review MRs to fix.')",
    "vscode.window.showInformationMessage('Need at least 2 open review MRs to resolve conflicts.')",
    "vscode.window.showInformationMessage('No open review MRs to verify.')",
    'startDeployMonitorForMergedTicket',
    "dispatchClaudeSession(projectPath, 'deploy-monitor', ticketKey",
    'projectNameOverride: projectName',
    'hasActiveDeployMonitorRun(projectName, projectPath, ticketKey)',
    'run.project === projectName || run.projectPath === projectPath',
    "import { activeRunSummary, isActiveRun } from './services/runStatus'",
    'const activeRuns = listRuns().filter(isActiveRun)',
    "statusBarItem.command = 'kronos.runCenter'",
    "statusBarItem.command = 'kronos.openDashboard'",
    '$(sync~spin) Kronos: ${activeRuns.length} running',
    'shouldRecordRunCompletionEvidence({ run, ticket })',
    'addTicketEvidenceNote(resolvedTicketKey, {',
    "kind: 'note'",
    'buildRunCompletionEvidenceText(run)',
    "unknownErrorMessage(e, 'Failed to add run completion evidence.')",
    'const resolvedTicketKey = ticketKey || run.ticket || undefined',
    'await showRunCompletionToast(resolvedTicketKey, ticket, run)',
    'async function showRunCompletionToast(ticketKey: string, ticket: Ticket | undefined, run: KronosRun): Promise<void>',
    "run.status !== 'waiting_for_review'",
    "'Open Review'",
    "'Run Center'",
    "vscode.commands.executeCommand('kronos.openMrDiff'",
    'function runQuickPickDetail',
    'This Kronos action needs a ticket context.',
    "if (command === 'evidenceGate' && ticketKey)",
    'function planActionRow',
    'function executePlanPanelAction',
    'function triageActionButtons',
    'function executeBacklogTriageAction',
    'function executeDashboardAction',
    'function buildRecoveryInventoryForState',
    "actionButton('executeRecoveryItem'",
    "actionButton('startTicket', 'Start Work'",
    "actionButton('evidenceGate', 'Evidence Gate'",
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
    assert.ok(source.includes(marker), marker);
  }
  assert.equal(
    source.includes("randomBytes(16).toString('base64')"),
    false,
    'webview nonces should use hex helper, not base64',
  );
  assert.equal(
    source.includes('run.events[run.events.length - 1]'),
    false,
    'extension run pickers should tolerate missing or malformed run.events',
  );
  const evidenceGateHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);');
  const evidenceGateHandlerEnd = source.indexOf('function openEvidenceHandoffPanel', evidenceGateHandlerStart);
  assert.ok(evidenceGateHandlerStart >= 0 && evidenceGateHandlerEnd > evidenceGateHandlerStart, 'Evidence Gate message handler should be present');
  const evidenceGateHandlerSource = source.slice(evidenceGateHandlerStart, evidenceGateHandlerEnd);
  assert.ok(
    evidenceGateHandlerSource.includes("if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }"),
    'Evidence Gate refresh should reload state before rendering',
  );
  const dashboardHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);');
  const dashboardHandlerEnd = source.indexOf("    vscode.commands.registerCommand('kronos.queueMoveUp'", dashboardHandlerStart);
  assert.ok(dashboardHandlerStart >= 0 && dashboardHandlerEnd > dashboardHandlerStart, 'Dashboard message handler should be present');
  const dashboardHandlerSource = source.slice(dashboardHandlerStart, dashboardHandlerEnd);
  assert.ok(
    dashboardHandlerSource.includes("if (request.command === 'refreshPanel') {\n            state.reloadAndNotify();\n            await render();\n            return;\n          }"),
    'Dashboard refresh should reload state before rendering',
  );
  const agingHandlerStart = source.indexOf('const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);');
  const agingHandlerEnd = source.indexOf('function openIntegrationManifestPanel', agingHandlerStart);
  assert.ok(agingHandlerStart >= 0 && agingHandlerEnd > agingHandlerStart, 'Aging Report message handler should be present');
  const agingHandlerSource = source.slice(agingHandlerStart, agingHandlerEnd);
  assert.ok(
    agingHandlerSource.includes("if (request.command === 'refreshPanel') {\n      state.reloadAndNotify();\n      render();\n      return;\n    }"),
    'Aging Report refresh should reload state before rendering',
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
  ]) {
    assert.equal(boardHandlerSource.includes(marker), false, marker);
  }
});

test('extension run recovery helpers use typed run records', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const runActionStart = source.indexOf('async function resumeSelectedRun');
  const runActionEnd = source.indexOf('function runLastEventLabel');
  assert.ok(runActionStart >= 0 && runActionEnd > runActionStart, 'run action helper block should be present');
  const runActionSource = source.slice(runActionStart, runActionEnd);
  for (const marker of [
    "import { unknownErrorMessage } from './services/errorUtils'",
    "import type { DiscoveredProject, MergeRequestChangedFile, QueueItem, Ticket } from './state/types'",
    'type KronosRun',
    'function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem',
    'function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void>',
    'return async (_code: number, run: KronosRun)',
    'await refreshAfterDispatch(state, projectName)(code, run)',
    'async function retryRunFromPrompt(run: KronosRun)',
    'function resolveRunWorkspace(run: KronosRun)',
    'async function resumeSelectedRun(state: KronosState, run: KronosRun)',
    'async function pauseSelectedRun(run: KronosRun)',
    'async function continueSelectedRun(run: KronosRun)',
    'async function cancelSelectedRun(run: KronosRun)',
    'async function openRunDiffArtifact(run: KronosRun)',
    'async function markSelectedRunNeedsHuman(run: KronosRun)',
    'function runLastEventLabel(run: KronosRun)',
    'function runQuickPickDetail(run: KronosRun)',
    'function runProcessPid(run: KronosRun)',
    "Reflect.get(run, 'pid')",
    'function findRunById(runId: string): KronosRun | undefined',
    'catch (e: unknown)',
    "unknownErrorMessage(e, 'Failed to resume run.')",
    "unknownErrorMessage(e, 'Failed to archive run.')",
    "unknownErrorMessage(e, 'Failed to pause run.')",
    "unknownErrorMessage(e, 'Failed to continue run.')",
    "unknownErrorMessage(e, 'Failed to cancel run.')",
    "unknownErrorMessage(e, 'Failed to open run diff.')",
    "unknownErrorMessage(e, 'Failed to mark run needs-human.')",
  ]) {
    assert.ok(source.includes(marker), marker);
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
    'return async (_code: number, run?: any)',
    'await refreshAfterDispatch(state, projectName)(code);',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(runActionSource.includes(marker), false, marker);
  }
});

test('extension evidence command handlers normalize unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const evidenceCommandStart = source.indexOf("vscode.commands.registerCommand('kronos.addEvidence'");
  const evidenceCommandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.evidenceGate'", evidenceCommandStart);
  assert.ok(evidenceCommandStart >= 0 && evidenceCommandEnd > evidenceCommandStart, 'evidence command handler block should be present');
  const evidenceCommandSource = source.slice(evidenceCommandStart, evidenceCommandEnd);
  for (const marker of [
    "unknownErrorMessage(e, 'Failed to add ticket evidence.')",
    "unknownErrorMessage(e, 'Failed to add evidence check.')",
    "unknownErrorMessage(e, 'Failed to record environment result.')",
    "unknownErrorMessage(e, 'Failed to extract acceptance criteria.')",
    "unknownErrorMessage(e, 'Failed to update acceptance criteria.')",
  ]) {
    assert.ok(evidenceCommandSource.includes(marker), marker);
  }
  for (const marker of [
    'catch (e: any)',
    'e?.message',
  ]) {
    assert.equal(evidenceCommandSource.includes(marker), false, marker);
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

test('extension MR and ticket link handlers normalize unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  const commandStart = source.indexOf("vscode.commands.registerCommand('kronos.linkMrToTicket'");
  const commandEnd = source.indexOf("    vscode.commands.registerCommand('kronos.sessionHistory'", commandStart);
  assert.ok(commandStart >= 0 && commandEnd > commandStart, 'MR and ticket link command block should be present');
  const commandSource = source.slice(commandStart, commandEnd);
  for (const marker of [
    "unknownErrorMessage(e, 'Failed to preview merge request link.')",
    "unknownErrorMessage(e, 'Failed to link merge request to ticket.')",
    "unknownErrorMessage(e, 'Failed to update ticket project links.')",
    "unknownErrorMessage(e, 'Failed to unlink ticket.')",
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

test('extension command handlers normalize remaining unknown errors', () => {
  const source = readSourceFixture('src', 'extension.ts');
  for (const marker of [
    "unknownErrorMessage(e, 'Failed to fetch SonarQube report.')",
    "unknownErrorMessage(e, 'Failed to update scan dirs.')",
    "unknownErrorMessage(e, 'Failed to restore backup.')",
    "unknownErrorMessage(e, 'Failed to snapshot integration manifest.')",
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

test('extension Sonar commands normalize webview and issue payloads', () => {
  const source = readSourceFixture('src', 'extension.ts');
  for (const marker of [
    "import { buildSonarReport, type SonarIssue }",
    'function recordFromUnknown(value: unknown): Record<string, unknown>',
    'panel.webview.onDidReceiveMessage(async (msg: unknown) =>',
    'function normalizeSonarIssueCommandList(value: unknown): SonarIssue[]',
    'function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null',
    'function formatSonarIssuePromptLine(issue: SonarIssue): string',
    'const commandArg = recordFromUnknown(item)',
    'const issuesData = normalizeSonarIssueCommandList(commandArg.issuesData)',
    'const lines = issuesData.map(formatSonarIssuePromptLine)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'panel.webview.onDidReceiveMessage(async (msg: any)',
    'issuesData.map((iss: any)',
    'item?.sourceBranch ||',
  ]) {
    assert.equal(source.includes(marker), false, marker);
  }
});

test('ticket detail rendering uses typed tickets and evidence records', () => {
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const evidenceData = readSourceFixture('src', 'services', 'evidenceData.ts');
  for (const marker of [
    'import type { DiscoveredProject, MergeRequestChangedFile, QueueItem, Ticket }',
    'function ticketEvidenceItemCount(ticket: Ticket)',
    'function buildTicketHtml(key: string, ticket: Ticket',
    'const mr = ticket.mr',
    'const build = ticket.build',
    'function existingAcceptanceCriterion(record: object)',
    'export type EvidenceRecord = object',
    'Reflect.get(record, key)',
    "Reflect.get(record, 'checked')",
  ]) {
    assert.ok((marker.startsWith('export type') || marker.startsWith('Reflect.'))
      ? evidenceData.includes(marker)
      : extensionSource.includes(marker), marker);
  }
  for (const marker of [
    'function ticketEvidenceItemCount(ticket: any)',
    'function buildTicketHtml(key: string, ticket: any',
    'criteria.map((criterion: any)',
    'notes.slice().reverse().map((note: any)',
    'checks.slice().reverse().map((check: any)',
    'environmentResults.map((result: any)',
    'export type EvidenceRecord = Record<string, any>',
  ]) {
    assert.equal(extensionSource.includes(marker) || evidenceData.includes(marker), false, marker);
  }
});

test('merge request diff rendering uses normalized adapter results', () => {
  const extensionSource = readSourceFixture('src', 'extension.ts');
  const integrationAdapters = readSourceFixture('src', 'services', 'integrationAdapters.ts');
  for (const marker of [
    'type MergeRequestDiffResult',
    'function buildDiffHtml(data: MergeRequestDiffResult)',
    'const files = data.files',
    'const files = diff.files',
  ]) {
    assert.ok(extensionSource.includes(marker), marker);
  }
  for (const marker of [
    'function normalizeChangedFileHints',
    'function buildDiffHtml(data: any)',
    'normalizeChangedFiles(payload.files)',
  ]) {
    assert.equal(extensionSource.includes(marker), false, marker);
  }
  assert.ok(integrationAdapters.includes('export interface MergeRequestDiffResult'));
  assert.ok(integrationAdapters.includes('files: normalizeChangedFiles(data.files)'));
  assert.ok(integrationAdapters.includes('[key: string]: unknown'));
});

test('tree providers share action labels and icons', () => {
  const ticketTree = readSourceFixture('src', 'views', 'TicketTreeProvider.ts');
  const queueTree = readSourceFixture('src', 'views', 'QueueTreeProvider.ts');
  const sessionTree = readSourceFixture('src', 'views', 'SessionTreeProvider.ts');
  const reviewTree = readSourceFixture('src', 'views', 'ReviewTreeProvider.ts');
  const actionIcons = readSourceFixture('src', 'views', 'actionIcons.ts');
  const actionLabels = readSourceFixture('src', 'services', 'actionLabels.ts');
  const queuePlanner = readSourceFixture('src', 'services', 'queuePlanner.ts');

  for (const marker of [
    "import { actionToLabel } from '../services/actionLabels'",
    "import { themeIcon, ticketActionIcon } from './actionIcons'",
    'themeIcon(ticketActionIcon(action))',
  ]) {
    assert.ok(ticketTree.includes(marker), marker);
  }

  for (const marker of [
    "import { actionToLabel } from '../services/actionLabels'",
    "import { queueActionIcon, themeIcon } from './actionIcons'",
    'themeIcon(queueActionIcon(item.action))',
  ]) {
    assert.ok(queueTree.includes(marker), marker);
  }

  assert.ok(actionIcons.includes("case 'in_progress': return { id: 'tools'"), 'shared icons should use the valid tools codicon');
  assert.equal(actionIcons.includes("'wrench'"), false, 'shared action icons should not use the invalid wrench codicon');
  for (const marker of [
    "import { KronosRun, listRuns } from '../runners/sessionDispatcher'",
    "import { isActiveRun } from '../services/runStatus'",
    "import { formatRunProgress } from '../services/runProgress'",
    'const activeRuns = listRuns().filter(isActiveRun)',
    'const progress = formatRunProgress(run)',
    'Progress: ${progress}',
    "new vscode.ThemeIcon('sync~spin'",
    "this.command = { command: 'kronos.runCenter'",
  ]) {
    assert.ok(sessionTree.includes(marker), marker);
  }
  for (const marker of [
    'readonly onDidChangeNewReviewCount',
    'private currentReviewKeys = new Set<string>()',
    'private seenReviewKeys = new Set<string>()',
    'private newReviewKeys = new Set<string>()',
    'getNewReviewCount(): number',
    'markVisibleReviewItemsSeen(): void',
    "this.description = `${isNew ? 'NEW · ' : ''}",
    "new vscode.ThemeIcon('circle-filled'",
    "new vscode.ThemeIcon('git-pull-request', color)",
    'function isReviewTicket(ticket: Ticket): boolean',
    "ticket.next_action === 'await_review' && ticket.mr.state === 'opened'",
  ]) {
    assert.ok(reviewTree.includes(marker), marker);
  }
  assert.equal(reviewTree.includes("ticket.mr.state === 'merged'"), false, 'review tree should not keep merged MRs in the active review inbox');
  assert.ok(actionLabels.includes('export function actionToLabel'), 'action labels should live outside queue planning');
  assert.ok(queuePlanner.includes("export { actionToLabel } from './actionLabels'"), 'queuePlanner should keep a compatibility re-export');
  assert.equal(ticketTree.includes('function actionToLabel'), false, 'ticket tree should not duplicate action labels');
  assert.equal(queueTree.includes('function actionIcon'), false, 'queue tree should not duplicate action icons');
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
    'type RunMetricRecord = Record<string, unknown>',
    'const rawRuns = Array.isArray(input.runs) ? input.runs : []',
    '.filter(isRecord)',
  ]) {
    assert.ok(source.includes(marker), marker);
  }
  for (const marker of [
    'runs: any[]',
    'Record<string, any>',
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
  assert.equal(lane('failing_gates').items[0].ticketKey, 'K-FAIL');
  assert.match(lane('recent_completed').items[0].detail, /evidence gate pass/);
  assert.equal(lane('stale_items').items[0].ticketKey, 'K-OLD');

  const source = readSourceFixture('src', 'services', 'dashboardWorklist.ts');
  assert.ok(source.includes("import { ACTIVE_RUN_STATUSES } from './runStatus'"));
  assert.ok(source.includes("const WORKLIST_RUN_STATUSES = new Set(['queued', ...ACTIVE_RUN_STATUSES])"));
  assert.ok(source.includes('type DashboardRunRecord = RunRecord & Record<string, unknown>'));
  assert.equal(source.includes('type DashboardRunRecord = RunRecord & Record<string, any>'), false);
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
  assert.ok(source.includes('type RunQualityRecord = RunRecord & Record<string, unknown>'));
  assert.equal(source.includes('type RunQualityRecord = RunRecord & Record<string, any>'), false);
});
