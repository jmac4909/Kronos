const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-conditional-unit-'));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const dateValues = require('../out/services/dateValues.js');
const pipelineTransitions = require('../out/services/pipelineTransitions.js');
const pipelineStore = require('../out/services/gitlabPipelineMonitorStore.js');
const stateStore = require('../out/services/stateStore.js');
const workSessions = require('../out/services/workSessionStore.js');
const { createOperatorTerminalRegistry } = require('../out/services/operatorTerminalRegistry.js');
const coveragePolicy = require('./run-code-coverage.js');
const { testSuiteFiles } = require('./test-suite-files.js');

const gitEvidenceByPath = new Map();
const vscode = createVscodeMock();
const originalLoad = Module._load;
Module._load = function loadWithVscodeMocks(request, parent, isMain) {
  if (request === 'vscode') { return vscode; }
  if (request === '../services/vscodeGitReadService') {
    return {
      readProjectGitEvidence: async projectPath => gitEvidenceByPath.get(path.resolve(projectPath)) || gitEvidence(projectPath),
    };
  }
  if (request === '../services/providerReadiness') {
    return {
      providerReadiness: () => ({
        jira: { configured: true },
        gitlab: { configured: true },
        jenkins: { configured: false },
        sonar: { configured: true },
      }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
let ManagedSessionTreeItem;
let ManagedSessionTreeProvider;
let ProjectTreeProvider;
try {
  ({ ManagedSessionTreeItem, ManagedSessionTreeProvider } = require('../out/views/ManagedSessionTreeProvider.js'));
  ({ ProjectTreeProvider } = require('../out/views/ProjectTreeProvider.js'));
} finally {
  Module._load = originalLoad;
}

test('date normalization covers valid, invalid, primitive, and unsupported values', () => {
  const valid = new Date('2026-07-15T12:00:00.000Z');
  assert.equal(dateValues.toValidDate(valid), valid);
  assert.equal(dateValues.toValidDate(new Date(Number.NaN)), null);
  assert.equal(dateValues.toValidDate('2026-07-15T12:00:00.000Z').toISOString(), valid.toISOString());
  assert.equal(dateValues.toValidDate(0).toISOString(), '1970-01-01T00:00:00.000Z');
  assert.equal(dateValues.toValidDate('not-a-date'), null);
  for (const unsupported of [undefined, null, true, {}, [], Symbol('date')]) {
    assert.equal(dateValues.toValidDate(unsupported), null);
  }
});

test('coverage policy discovers the npm test graph and fails closed on missing or regressed metrics', () => {
  assert.doesNotThrow(() => coveragePolicy.assertSupportedNodeVersion('22.5.0'));
  assert.doesNotThrow(() => coveragePolicy.assertSupportedNodeVersion('24.0.0'));
  assert.throws(
    () => coveragePolicy.assertSupportedNodeVersion('20.19.0'),
    /requires Node 22\.5 or newer; received 20\.19\.0/,
  );
  assert.throws(() => coveragePolicy.assertSupportedNodeVersion('invalid'), /received invalid/);
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const testFiles = testSuiteFiles(manifest);
  assert.ok(testFiles.includes('scripts/run-conditional-unit-tests.js'));
  assert.ok(testFiles.includes('scripts/run-unit-tests.js'));
  assert.equal(testFiles.length, new Set(testFiles).size);

  const report = coveragePolicy.parseCoverageReport([
    '# file | line % | branch % | funcs % | uncovered lines',
    '# dateValues.js | 100.00 | 100.00 | 100.00 |',
    '# all files | 80.71 | 72.02 | 86.65 |',
  ].join('\n'));
  assert.deepEqual(report.get('dateValues.js'), { lines: 100, branches: 100, functions: 100 });
  assert.deepEqual(
    coveragePolicy.coverageFailures(report, { lines: 80, branches: 72, functions: 86 }, {
      'dateValues.js': { lines: 100, branches: 100, functions: 100 },
    }),
    [],
  );
  const failures = coveragePolicy.coverageFailures(
    report,
    { lines: 81, branches: 73, functions: 87 },
    { 'missing.js': { lines: 1, branches: 1, functions: 1 } },
  );
  assert.equal(failures.length, 4);
  assert.ok(failures.some(failure => failure.includes('missing.js is missing')));
  assert.ok(failures.some(failure => failure.includes('branches coverage 72.02% is below 73.00%')));
});

test('GitLab pipeline snapshot persistence covers missing, complete, malformed, and unsafe identities', () => {
  const options = { kronosDir: path.join(tempRoot, 'pipeline-store') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Pipeline persistence' }, options);
  const digest = requiredPipelineDigest({
    pipeline: {
      id: 904,
      status: 'success',
      web_url: 'https://gitlab.example/group/app/-/pipelines/904',
      ref: 'feature/coverage',
      sha: 'a'.repeat(40),
    },
    jobs: [],
    testReportSummary: { available: true, total: 3, failed: 0, error: 0, skipped: 1 },
    fetchedAt: '2026-07-15T12:00:00.000Z',
  });

  assert.equal(pipelineStore.readGitLabPipelineMonitorSnapshot(session.id, options), null);
  const snapshotPath = pipelineStore.writeGitLabPipelineMonitorSnapshot(session.id, digest, options);
  assert.equal(snapshotPath, pipelineStore.gitLabPipelineMonitorSnapshotPath(`  ${session.id}  `, options));
  assert.deepEqual(pipelineStore.readGitLabPipelineMonitorSnapshot(session.id, options), digest);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(snapshotPath).mode & 0o777, 0o600); }

  fs.writeFileSync(snapshotPath, '{"schemaVersion":1,', { mode: 0o600 });
  assert.throws(() => pipelineStore.readGitLabPipelineMonitorSnapshot(session.id, options), SyntaxError);
  fs.writeFileSync(snapshotPath, '{}\n', { mode: 0o600 });
  assert.equal(pipelineStore.readGitLabPipelineMonitorSnapshot(session.id, options), null);

  for (const unsafe of ['', 'with/slash', '.starts-with-dot', 'x'.repeat(181)]) {
    assert.throws(
      () => pipelineStore.gitLabPipelineMonitorSnapshotPath(unsafe, options),
      /work session id is missing or invalid/i,
    );
  }
});

test('managed Sessions tree covers every lifecycle context and loader fallback', async t => {
  const projectPath = createGitProject('managed-session-project', 'feature/conditional-coverage');
  const options = { kronosDir: path.join(tempRoot, 'managed-session-store') };
  let standalone = workSessions.createStandaloneWorkSession({
    title: 'Standalone attached',
    projectName: 'Application',
    projectPath,
  }, options);
  standalone = workSessions.attachWorkSessionTerminal(standalone.id, {
    bindingId: 'terminal-standalone',
    name: 'Operator terminal',
  }, options);
  const standaloneAttached = new ManagedSessionTreeItem(standalone, ['live-z', 'live-a'], 300_000, 'Customer API');
  assert.equal(standaloneAttached.contextValue, 'standalone_session_attached');
  assert.deepEqual(standaloneAttached.liveTerminalBindingIds, ['live-a', 'live-z']);
  assert.equal(standaloneAttached.iconPath.id, 'terminal');
  assert.match(standaloneAttached.description, /Customer API @ feature\/conditional-coverage/);

  const standaloneDetached = new ManagedSessionTreeItem(standalone, [], 300_000);
  assert.equal(standaloneDetached.contextValue, 'standalone_session_detached');
  assert.equal(standaloneDetached.iconPath.id, 'debug-disconnect');
  const standaloneClosedRecord = workSessions.closeWorkSession(standalone.id, options);
  const standaloneClosed = new ManagedSessionTreeItem(standaloneClosedRecord, [], 300_000);
  assert.equal(standaloneClosed.contextValue, 'standalone_session_closed');
  assert.equal(standaloneClosed.iconPath.id, 'circle-slash');

  let projectSession = workSessions.createStandaloneWorkSession({
    title: 'Project monitoring',
    projectName: 'Application',
    projectPath,
  }, options);
  projectSession = workSessions.addWorkSessionTicketContext(projectSession.id, 'APP-101', options);
  projectSession = workSessions.attachWorkSessionTerminal(projectSession.id, {
    bindingId: 'terminal-project',
    name: 'Project terminal',
  }, options);
  assert.equal(new ManagedSessionTreeItem(projectSession, ['live-project'], 300_000).contextValue, 'work_session_attached');

  let ticket = workSessions.createOrGetWorkSessionByTicket({ ticketKey: 'APP-102', title: 'Ticket lifecycle' }, options);
  ticket = workSessions.attachWorkSessionTerminal(ticket.id, {
    bindingId: 'terminal-ticket',
    name: 'Ticket terminal',
  }, options);
  ticket = workSessions.setWorkSessionMonitoring(ticket.id, false, undefined, options);
  const pausedAttached = new ManagedSessionTreeItem(ticket, ['live-ticket'], 300_000);
  assert.equal(pausedAttached.contextValue, 'work_session_attached_paused');
  assert.equal(pausedAttached.ticketKey, 'APP-102');
  assert.equal(pausedAttached.command.arguments[0].ticketKey, 'APP-102');
  assert.equal(new ManagedSessionTreeItem(ticket, [], 300_000).contextValue, 'work_session_detached_paused');
  const ticketClosed = workSessions.closeWorkSession(ticket.id, options);
  assert.equal(new ManagedSessionTreeItem(ticketClosed, [], 300_000).contextValue, 'work_session_closed');

  const registry = createOperatorTerminalRegistry();
  registry.attach({ name: 'Live operator terminal' }, { sessionId: projectSession.id, bindingId: 'live-project' });
  const provider = new ManagedSessionTreeProvider(registry, () => [ticketClosed, projectSession], () => 60_000, () => 'Customer API');
  const changes = [];
  provider.onDidChangeTreeData(value => changes.push(value));
  const roots = await provider.getChildren();
  assert.equal(roots.length, 2);
  assert.equal(roots[0].session.id, projectSession.id, 'active sessions sort before stopped sessions');
  assert.equal(provider.getTreeItem(roots[0]), roots[0]);
  assert.deepEqual(await provider.getChildren(roots[0]), []);
  provider.refresh();
  assert.deepEqual(changes, [undefined]);
  provider.dispose();

  const empty = await new ManagedSessionTreeProvider(registry, () => []).getChildren();
  assert.equal(empty[0].contextValue, 'managed_session_empty');
  assert.equal(empty[0].command.command, 'kronos.newClaudeSession');
  const warning = t.mock.method(console, 'warn', () => {});
  const secret = ['glpat-', 'conditionalunitfixturevalue'].join('');
  const failed = await new ManagedSessionTreeProvider(
    registry,
    () => { throw new Error(`Authorization: Bearer ${secret}`); },
  ).getChildren();
  assert.equal(failed[0].contextValue, 'managed_session_empty');
  assert.equal(warning.mock.callCount(), 1);
  assert.equal(warning.mock.calls[0].arguments[0].includes(secret), false);
  assert.match(warning.mock.calls[0].arguments[0], /REDACTED/);
});

test('Projects tree covers empty, clean, changed, unavailable, action, and failed-loader branches', async t => {
  const cleanPath = createGitProject('project-clean', 'main');
  const changedPath = createGitProject('project-changed', 'feature/changed');
  const unavailablePath = createGitProject('project-unavailable', 'release/unavailable');
  gitEvidenceByPath.set(path.resolve(cleanPath), gitEvidence(cleanPath, { branch: 'main', available: true }));
  gitEvidenceByPath.set(path.resolve(changedPath), gitEvidence(changedPath, {
    branch: 'feature/changed',
    available: true,
    changeCount: 2,
    changes: [
      { path: 'src/changed.ts', status: 'modified', staged: false },
      { path: 'src/conflict.ts', status: 'both modified', staged: true },
    ],
    warning: 'Diff remained bounded.',
  }));
  gitEvidenceByPath.set(path.resolve(unavailablePath), gitEvidence(unavailablePath, {
    branch: 'release/unavailable',
    warning: 'VS Code Git model is not ready.',
  }));

  const state = stateStore.emptyWorkCatalog();
  state.projects = {
    Clean: {
      path: cleanPath,
      display_name: 'Customer API',
      config: {
        gitlab_project_path: 'group/customer-api',
        jenkins_url: 'https://jenkins.example/job/customer-api',
        sonar_project_key: 'customer-api',
      },
    },
    Changed: { path: changedPath, config: {} },
    Unavailable: { path: unavailablePath, config: {} },
  };
  const sessionOptions = { kronosDir: path.join(tempRoot, 'project-tree-sessions') };
  let linked = workSessions.createStandaloneWorkSession({
    title: 'Linked project session',
    projectName: 'Clean',
    projectPath: cleanPath,
  }, sessionOptions);
  linked = workSessions.addWorkSessionTicketContext(linked.id, 'APP-201', sessionOptions);
  const ignored = [
    { ...linked, id: 'ignored-paused', monitoring: { ...linked.monitoring, enabled: false } },
    { ...linked, id: 'ignored-closed', status: 'closed' },
    { ...linked, id: 'ignored-no-ticket', ticketKeys: [] },
    { ...linked, id: 'ignored-other-project', projectName: 'Changed' },
  ];

  const provider = new ProjectTreeProvider(() => state, () => [linked, ...ignored], () => 120_000);
  const changes = [];
  provider.onDidChangeTreeData(value => changes.push(value));
  const roots = await provider.getChildren();
  assert.equal(roots.length, 3);
  const byName = Object.fromEntries(roots.map(item => [item.projectName, item]));
  assert.equal(byName.Clean.label, 'Customer API');
  assert.match(byName.Clean.description, /^main • clean • /);
  assert.equal(byName.Clean.iconPath.color.id, 'testing.iconPassed');
  assert.match(byName.Clean.tooltip, /Active monitored ticket sessions: 1/);
  assert.match(byName.Clean.tooltip, /GitLab: automatic polling active for 1 ticket session/);
  assert.equal(byName.Changed.iconPath.color.id, 'gitDecoration.modifiedResourceForeground');
  assert.match(byName.Changed.description, /2 changes · 1 staged · 1 conflict/);
  assert.match(byName.Changed.tooltip, /Git read note: Diff remained bounded\./);
  assert.equal(byName.Unavailable.iconPath.color.id, 'problemsWarningIcon.foreground');
  assert.match(byName.Unavailable.description, /^release\/unavailable • status unavailable • /);
  assert.equal(provider.getTreeItem(byName.Clean), byName.Clean);

  const actions = await provider.getChildren(byName.Clean);
  assert.equal(actions.length, 8);
  assert.equal(actions[0].command.command, 'kronos.newClaudeSession');
  assert.equal(actions[0].command.arguments[0].projectPath, cleanPath);
  assert.equal(actions[0].description, 'no Jira ticket');
  assert.equal(actions[3].description, undefined);
  assert.deepEqual(await provider.getChildren(actions[0]), []);
  provider.refresh();
  assert.deepEqual(changes, [undefined]);
  provider.dispose();

  const empty = await new ProjectTreeProvider(() => stateStore.emptyWorkCatalog(), () => []).getChildren();
  assert.equal(empty[0].contextValue, 'registered_project_empty');
  assert.equal(empty[0].command.command, 'kronos.registerWorkspaceProject');

  const warning = t.mock.method(console, 'warn', () => {});
  const secret = ['glpat-', 'projecttreefixturevalue'].join('');
  const stateFailure = await new ProjectTreeProvider(
    () => { throw new Error(`Authorization: Bearer ${secret}`); },
    () => [],
  ).getChildren();
  assert.equal(stateFailure[0].contextValue, 'registered_project_empty');
  const sessionFailureProvider = new ProjectTreeProvider(
    () => state,
    () => { throw new Error(`Authorization: Bearer ${secret}`); },
  );
  assert.equal((await sessionFailureProvider.getChildren()).length, 3);
  assert.equal(warning.mock.callCount(), 2);
  const warnings = warning.mock.calls.map(call => call.arguments[0]).join(' ');
  assert.equal(warnings.includes(secret), false);
  assert.match(warnings, /REDACTED/);
});

function requiredPipelineDigest(snapshot) {
  const digest = pipelineTransitions.normalizeGitLabPipelineDigest(snapshot);
  assert.ok(digest);
  return digest;
}

function createGitProject(name, branch) {
  const projectPath = path.join(tempRoot, name);
  fs.mkdirSync(path.join(projectPath, '.git'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(projectPath, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`, { mode: 0o600 });
  return fs.realpathSync(projectPath);
}

function gitEvidence(projectPath, overrides = {}) {
  return {
    projectPath: path.resolve(projectPath),
    changes: [],
    changeCount: 0,
    diff: '',
    diffTruncated: false,
    available: false,
    ...overrides,
  };
}

function createVscodeMock() {
  class EventEmitter {
    constructor() {
      this.listeners = new Set();
      this.event = listener => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
    }
    fire(value) { for (const listener of this.listeners) { listener(value); } }
    dispose() { this.listeners.clear(); }
  }
  class TreeItem {
    constructor(label, collapsibleState) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }
  class ThemeColor { constructor(id) { this.id = id; } }
  class ThemeIcon {
    constructor(id, color) {
      this.id = id;
      this.color = color;
    }
  }
  return {
    EventEmitter,
    TreeItem,
    ThemeColor,
    ThemeIcon,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  };
}
