const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-schema-invariants-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const stateStore = require('../out/services/stateStore.js');
const workSessions = require('../out/services/workSessionStore.js');
const monitorEvents = require('../out/services/monitorEventStore.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('state ownership matrix covers every canonical record family and ingress boundary', () => {
  const ownership = fs.readFileSync(path.join(root, 'docs', 'state-ownership.md'), 'utf8');
  for (const row of [
    '| Provider environment |',
    '| Work catalog |',
    '| Jira refresh lifecycle |',
    '| Work session and terminal-binding history |',
    '| Provider binding |',
    '| MR, pipeline, read-health, and CI baselines |',
    '| Current Attention projection |',
    '| Monitor and audit event ledger |',
    '| Jira, GitLab, CI, and Git context artifacts |',
    '| Setup and Doctor readiness |',
  ]) {
    assert.match(ownership, new RegExp(escapeRegex(row)), row);
  }
  assert.match(ownership, /normalizes data at provider, file, and webview-message ingress/i);
  assert.match(ownership, /Compatibility aliases exist only at documented migration boundaries/i);
  assert.match(ownership, /Unsupported future persisted schemas fail closed/i);
});

test('Work catalog migrates legacy aliases once and current schema exposes only canonical fields', () => {
  const legacy = stateStore.normalizeWorkCatalog({
    schemaVersion: 1,
    last_updated: '2026-07-15 12:30:00Z',
    projects: { App: { path: tempRoot, config: {}, unknown: 'drop' } },
    tickets: {
      'abc-123': {
        summary: 'Legacy shape',
        status: 'In Progress',
        launch_project: 'App',
        source: 'jira',
        mr: {
          iid: 12,
          url: 'https://gitlab.example/group/app/-/merge_requests/12#note_1',
          sourceBranch: 'feature/ABC-123',
          targetBranch: 'main',
          unknown: 'drop',
        },
        build: null,
        unknown: 'drop',
      },
    },
    unknown: 'drop',
  });
  assert.equal(legacy.state.refreshedAt, '2026-07-15T12:30:00.000Z');
  assert.equal(legacy.state.tickets['ABC-123'].jira_status, 'In Progress');
  assert.equal(legacy.state.tickets['ABC-123'].linked_local_project, 'App');
  assert.equal(legacy.state.tickets['ABC-123'].mr.source_branch, 'feature/ABC-123');
  assert.equal(legacy.state.tickets['ABC-123'].mr.target_branch, 'main');
  assert.equal(legacy.state.tickets['ABC-123'].mr.url, 'https://gitlab.example/group/app/-/merge_requests/12');
  assert.equal('sourceBranch' in legacy.state.tickets['ABC-123'].mr, false);
  assert.equal('unknown' in legacy.state.tickets['ABC-123'], false);

  const current = stateStore.normalizeWorkCatalog({
    schemaVersion: 2,
    last_updated: '2026-07-15T12:30:00Z',
    projects: { App: { path: tempRoot, config: {} } },
    tickets: {
      'ABC-124': {
        summary: 'Current shape',
        status: 'Retired alias',
        launch_project: 'App',
        source: 'jira',
        mr: {
          iid: 13,
          url: 'https://gitlab.example/group/app/-/merge_requests/13',
          source_branch: 'feature/ABC-124',
          sourceBranch: 'wrong-alias',
          target_branch: 'main',
        },
        build: null,
      },
    },
  });
  assert.equal(current.state.refreshedAt, null);
  assert.equal(current.state.tickets['ABC-124'].jira_status, 'Unknown');
  assert.equal(current.state.tickets['ABC-124'].linked_local_project, undefined);
  assert.equal(current.state.tickets['ABC-124'].mr.source_branch, 'feature/ABC-124');
  assert.equal('sourceBranch' in current.state.tickets['ABC-124'].mr, false);

  const internalSources = [
    'src/state/types.ts',
    'src/services/providerBindingReconciliation.ts',
    'src/services/ticketWorkspaceView.ts',
  ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(internalSources, /mr\?*\.?(?:sourceBranch|targetBranch|head_branch)|mr\?*\.branch/);
});

test('session and event normalizers strip unknown fields while preserving explicit partial state', () => {
  const options = { kronosDir: path.join(tempRoot, 'canonical-records') };
  let session = workSessions.createStandaloneWorkSession({ title: 'Canonical records' }, options);
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '42',
    url: 'https://gitlab.example/group/app/-/merge_requests/42',
  }, options);
  session = workSessions.recordWorkSessionContextArtifact(session.id, {
    kind: 'gitlab',
    label: 'Partial MR evidence',
    promptPath: path.join(options.kronosDir, 'contexts', 'mr-42.md'),
    complete: false,
    warnings: ['Discussions unavailable'],
    contentSha256: 'a'.repeat(64),
  }, options);
  session = workSessions.recordWorkSessionMonitoringResult(session.id, {
    polled: 1,
    transitions: 0,
    failures: 0,
    skipped: 1,
  }, options);
  const raw = JSON.parse(JSON.stringify(session));
  raw.unknown = 'drop';
  raw.monitoring.unknown = 'drop';
  raw.providerBindings[0].unknown = 'drop';
  raw.artifacts[0].unknown = 'drop';
  const normalized = workSessions.normalizeWorkSessionRecord(raw, options);
  assert.equal(normalized.monitoring.lastState, 'partial');
  assert.equal(normalized.monitoring.currentError, 'provider_evidence_partial');
  assert.equal(normalized.artifacts[0].complete, false);
  assert.deepEqual(normalized.artifacts[0].warnings, ['Discussions unavailable']);
  assert.equal('unknown' in normalized, false);
  assert.equal('unknown' in normalized.monitoring, false);
  assert.equal('unknown' in normalized.providerBindings[0], false);
  assert.equal('unknown' in normalized.artifacts[0], false);

  const event = monitorEvents.normalizeMonitorEvent({
    schemaVersion: 1,
    id: 'event-canonical',
    at: '2026-07-15 13:00:00Z',
    sessionId: session.id,
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'Provider evidence is partial.',
    subject: { kind: 'merge-request', id: '42', unknown: 'drop' },
    after: { state: 'partial', fingerprint: 'a'.repeat(64), unknown: 'drop' },
    unknown: 'drop',
  }, options);
  assert.equal(event.at, '2026-07-15T13:00:00.000Z');
  assert.equal('unknown' in event, false);
  assert.equal('unknown' in event.subject, false);
  assert.equal('unknown' in event.after, false);
});

test('dates branches URLs paths and hashes fail closed at record ingress', () => {
  const catalog = stateStore.normalizeWorkCatalog({
    schemaVersion: 2,
    refreshedAt: 'not-a-date',
    projects: {
      App: {
        path: tempRoot,
        config: {
          jenkins_url: 'https://operator:secret@jenkins.example/job/app',
          default_branch: '../unsafe',
        },
      },
    },
    tickets: {
      'ABC-200': {
        summary: 'Invalid canonical values',
        jira_status: 'Open',
        source: 'jira',
        updated: 'not-a-date',
        mr: {
          iid: 200,
          url: 'https://operator:secret@gitlab.example/group/app/-/merge_requests/200',
          source_branch: '../unsafe',
        },
        build: null,
      },
    },
  });
  assert.equal(catalog.state.refreshedAt, null);
  assert.equal(catalog.state.projects.App.config.jenkins_url, undefined);
  assert.equal(catalog.state.projects.App.config.default_branch, undefined);
  assert.equal(catalog.state.tickets['ABC-200'].updated, undefined);
  assert.equal(catalog.state.tickets['ABC-200'].mr, null);

  const options = { kronosDir: path.join(tempRoot, 'bounded-records') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Bounded records' }, options);
  const raw = JSON.parse(JSON.stringify(session));
  raw.createdAt = 'not-a-date';
  assert.throws(() => workSessions.normalizeWorkSessionRecord(raw, options), /createdAt.*invalid/i);

  const externalArtifact = JSON.parse(JSON.stringify(session));
  externalArtifact.artifacts = [{
    id: 'artifact-external',
    kind: 'jira',
    label: 'External path',
    promptPath: path.join(tempRoot, 'outside.md'),
    fetchedAt: '2026-07-15T13:00:00.000Z',
    recordedAt: '2026-07-15T13:00:00.000Z',
    complete: true,
    warnings: [],
    contentSha256: 'b'.repeat(64),
  }];
  assert.throws(
    () => workSessions.normalizeWorkSessionRecord(externalArtifact, options),
    /must stay inside the Kronos data directory/i,
  );
  externalArtifact.artifacts[0].promptPath = path.join(options.kronosDir, 'context.md');
  externalArtifact.artifacts[0].contentSha256 = 'not-a-hash';
  assert.throws(
    () => workSessions.normalizeWorkSessionRecord(externalArtifact, options),
    /SHA-256 is invalid/i,
  );

  assert.throws(() => monitorEvents.normalizeMonitorEvent({
    schemaVersion: 1,
    id: 'event-external',
    at: '2026-07-15T13:00:00.000Z',
    sessionId: session.id,
    type: 'context.inserted',
    source: 'operator',
    summary: 'External artifact path.',
    artifactPath: path.join(tempRoot, 'outside.md'),
  }, options), /must stay inside the Kronos data directory/i);
});

test('future schemas fail closed without compatibility probing', () => {
  const futureCatalog = stateStore.normalizeWorkCatalog({
    schemaVersion: 99,
    projects: { App: { path: tempRoot, config: {} } },
    tickets: {},
  });
  assert.deepEqual(futureCatalog.state, stateStore.emptyWorkCatalog());
  assert.match(futureCatalog.issues[0].detail, /newer than supported/i);

  const options = { kronosDir: path.join(tempRoot, 'future-records') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Future record' }, options);
  assert.throws(
    () => workSessions.normalizeWorkSessionRecord({ ...session, schemaVersion: 99 }, options),
    /Unsupported work session schema version/i,
  );
  assert.throws(() => monitorEvents.normalizeMonitorEvent({
    schemaVersion: 99,
    id: 'event-future',
    at: '2026-07-15T13:00:00.000Z',
    sessionId: session.id,
    type: 'provider.transition',
    source: 'kronos',
    summary: 'Future event.',
  }, options), /Unsupported monitor event schema version/i);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
