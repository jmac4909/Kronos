const assert = require('node:assert/strict');
const crypto = require('node:crypto');
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
const mergeRequestMonitor = require('../out/services/gitlabMergeRequestMonitorStore.js');

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

test('Work catalog normalization covers malformed rows, optional provider config, and legacy MR variants', () => {
  const linkedProjectPath = path.join(tempRoot, 'catalog-linked-project');
  fs.mkdirSync(linkedProjectPath, { recursive: true });
  const catalog = stateStore.normalizeWorkCatalog({
    schemaVersion: 1,
    projects: {
      linked: {
        path: linkedProjectPath,
        display_name: '  Linked\u0000 project  ',
        config: {
          repo_name: ' service ',
          jira_ticket_filter: ' project = KRONOS ',
          gitlab_project_id: '42',
          gitlab_project_path: 'ignored/when-id-present',
          jenkins_url: 'https://jenkins.example/job/service',
          sonar_project_key: 'service-key',
          sonar_branch: 'release/1',
          base_branch: 'develop',
          default_branch: 'main',
          extra_dirs: [' docs ', '', 'docs', 12],
          branch_profiles: [
            null,
            { branch: '' },
            { branch: 'no-provider' },
            { branch: 'main', jenkins_url: 'https://jenkins.example/job/main' },
            { branch: 'main', sonar_project_key: 'duplicate' },
            { branch: 'release/1', sonar_project_key: 'service-key', sonar_branch: 'release/1' },
          ],
          active_branch_profile: 'release/1',
        },
      },
      duplicate: { path: path.join(linkedProjectPath, '.'), config: {} },
      relative: { path: 'relative/path', config: { gitlab_project_path: 'group/service' } },
      '\u0000': null,
    },
    tickets: {
      'kr-1': {
        summary: ' Rich ticket ',
        type: 'Story',
        priority: 'High',
        status: 'In Progress',
        updated: '2026-07-20T10:00:00Z',
        jira_status_category: 'Doing',
        jira_project_key: 'KR',
        description: 'line one\r\nline two\u0000',
        jira_url: 'https://jira.example/browse/KR-1#activity',
        launch_project: 'linked',
        labels: ['backend', '', 'backend', 1],
        source: 'jira',
        mr: {
          iid: '7',
          url: 'https://gitlab.example/group/service/-/merge_requests/7#note',
          state: 'merged',
          review_status: 'approved',
          title: 'MR title',
          author: 'Reviewer',
          last_comment_at: '2026-07-20T10:01:00Z',
          last_discussion_at: '2026-07-20T10:02:00Z',
          branch: 'feature/KR-1',
          targetBranch: 'main',
          comment_count: '0',
          discussion_count: 2,
          unresolved_discussion_count: 1,
          resolved_discussion_count: 1,
          discussions_resolved: false,
        },
        build: { number: '8', status: 'SUCCESS', url: 'https://jenkins.example/job/service/8#console' },
        attachments: [
          null,
          { size: 1 },
          { filename: 'empty.bin', size: 0 },
          { filename: 'unknown.bin', size: 'invalid', mimeType: '' },
          { filename: 'report.txt', size: '12', mimeType: 'text/plain' },
        ],
      },
      'KR-2': {
        summary: 'Head branch fallback',
        source: 'jira',
        mr: {
          iid: 2,
          url: 'http://gitlab.example/mr/2',
          state: 'closed',
          review_status: 'changes_requested',
          head_branch: 'feature/KR-2',
        },
        build: { number: 0, status: 'FAILED', url: 'ftp://invalid.example/build' },
      },
      'KR-3': {
        summary: 'Source branch fallback',
        source: 'jira',
        mr: { iid: 3, url: 'https://gitlab.example/mr/3', sourceBranch: 'feature/KR-3' },
      },
      'KR-4': {
        summary: 'Defaults and invalid URL',
        source: 'jira',
        jira_url: 'not a URL',
        linked_local_project: 'missing',
        mr: { iid: 4, url: 'https://user:secret@gitlab.example/mr/4' },
      },
      'bad key': { summary: 'invalid identity', source: 'jira' },
      'KR-5': { source: 'jira' },
      'KR-6': { summary: 'adhoc is rejected', source: 'adhoc' },
    },
  }, '/fixture/normalization-matrix.json');

  assert.deepEqual(Object.keys(catalog.state.projects), ['linked', 'relative']);
  assert.equal(catalog.state.projects.linked.display_name, 'Linked project');
  assert.deepEqual(catalog.state.projects.linked.config.extra_dirs, ['docs']);
  assert.deepEqual(catalog.state.projects.linked.config.branch_profiles, [
    { branch: 'main', jenkins_url: 'https://jenkins.example/job/main' },
    { branch: 'release/1', sonar_project_key: 'service-key', sonar_branch: 'release/1' },
  ]);
  assert.equal(catalog.state.projects.linked.config.active_branch_profile, 'release/1');
  assert.equal(catalog.state.projects.relative.path, undefined);
  assert.equal(catalog.state.projects.relative.config.gitlab_project_path, 'group/service');
  assert.deepEqual(Object.keys(catalog.state.tickets), ['KR-1', 'KR-2', 'KR-3', 'KR-4']);
  assert.equal(catalog.state.tickets['KR-1'].description, 'line one\nline two');
  assert.equal(catalog.state.tickets['KR-1'].mr.source_branch, 'feature/KR-1');
  assert.equal(catalog.state.tickets['KR-1'].mr.target_branch, 'main');
  assert.equal(catalog.state.tickets['KR-1'].mr.discussions_resolved, false);
  assert.deepEqual(catalog.state.tickets['KR-1'].attachments, [
    { filename: 'empty.bin', size: 0, mimeType: 'application/octet-stream' },
    { filename: 'unknown.bin', size: 0, mimeType: 'application/octet-stream' },
    { filename: 'report.txt', size: 12, mimeType: 'text/plain' },
  ]);
  assert.equal(catalog.state.tickets['KR-1'].build.url, 'https://jenkins.example/job/service/8');
  assert.equal(catalog.state.tickets['KR-2'].mr.source_branch, 'feature/KR-2');
  assert.equal(catalog.state.tickets['KR-2'].build, null);
  assert.equal(catalog.state.tickets['KR-3'].mr.source_branch, 'feature/KR-3');
  assert.equal(catalog.state.tickets['KR-4'].linked_local_project, undefined);
  assert.equal(catalog.state.tickets['KR-4'].mr, null);
  assert.equal(catalog.issues.some(issue => /duplicate local project path/i.test(issue.detail)), true);
  assert.equal(catalog.issues.some(issue => /invalid project \(unnamed\)/i.test(issue.detail)), true);
  assert.equal(catalog.issues.some(issue => /invalid Jira ticket bad key/i.test(issue.detail)), true);
  assert.equal(catalog.issues.some(issue => /cleared unavailable local project link for KR-4/i.test(issue.detail)), true);

  const inactiveProfile = stateStore.normalizeWorkCatalog({
    schemaVersion: 2,
    projects: {
      app: {
        config: {
          branch_profiles: [{ branch: 'main', sonar_project_key: 'app' }],
          active_branch_profile: 'missing',
        },
      },
    },
    tickets: {},
  }).state.projects.app.config;
  assert.equal(inactiveProfile.active_branch_profile, undefined);
});

test('bounded Work catalog reads validate limits and distinguish present from missing files', () => {
  const fixturePath = path.join(tempRoot, 'bounded-catalog.json');
  fs.writeFileSync(fixturePath, 'catalog');
  assert.equal(stateStore.readBoundedPrivateUtf8File(fixturePath, 7, 'Fixture catalog'), 'catalog');
  assert.throws(
    () => stateStore.readBoundedPrivateUtf8File(fixturePath, 0, 'Fixture catalog'),
    /byte limit must be a positive safe integer/i,
  );
  assert.throws(
    () => stateStore.readBoundedPrivateUtf8File(path.join(tempRoot, 'missing.json'), 100, 'Fixture catalog'),
    error => error?.code === 'ENOENT' && /is unavailable/i.test(error.message),
  );
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

test('work-session normalization accepts every durable enum and optional field variant', () => {
  const options = { kronosDir: path.join(tempRoot, 'session-normalization-matrix') };
  const created = workSessions.createStandaloneWorkSession({ title: 'Normalization matrix' }, options);
  const base = JSON.parse(JSON.stringify(created));
  const at = '2026-07-20T12:34:56.000Z';
  const claudeSessionId = crypto.randomUUID();
  const claudeLaunchSessionId = crypto.randomUUID();
  base.projectName = 'Kronos';
  base.projectPath = tempRoot;
  base.terminals = [{
    id: 'terminal-matrix',
    name: 'Operator terminal',
    status: 'attached',
    attachedAt: at,
    cwd: tempRoot,
    processId: 123,
    shell: 'bash',
    claudeSessionId,
    claudeLaunchSessionId,
    claudeIdentityObservedAt: at,
    editorSessionId: 'editor-session-matrix',
    claudePermissionMode: 'default',
    detachedAt: at,
    detachReason: 'Fixture detach reason',
  }];
  base.providerBindings = [{
    id: 'provider-matrix',
    provider: 'jira',
    resource: 'ticket',
    subjectId: 'KRONOS-1',
    projectId: 'KRONOS',
    attachedAt: at,
    url: 'https://jira.example/browse/KRONOS-1?token=secret#fragment',
  }];
  base.artifacts = [{
    id: 'artifact-matrix',
    kind: 'jira',
    label: 'Ticket evidence',
    promptPath: path.join(options.kronosDir, 'contexts', 'ticket.md'),
    fetchedAt: at,
    recordedAt: at,
    complete: false,
    warnings: ['Partial evidence', 'Partial evidence'],
    contentSha256: 'a'.repeat(64),
  }];
  base.monitoring = {
    enabled: true,
    lastPolledAt: at,
    lastAttemptAt: at,
    lastSuccessfulAt: at,
    lastMeaningfulChangeAt: at,
    lastState: 'healthy',
    lastSummary: 'Healthy fixture',
    lastFailureCount: 0,
    lastSkippedCount: 0,
    suppressedUnchangedCount: 1,
    currentError: 'provider_read_failed',
  };
  const normalized = workSessions.normalizeWorkSessionRecord(base, options);
  assert.equal(normalized.terminals[0].processId, 123);
  assert.equal(normalized.terminals[0].claudeSessionId, claudeSessionId);
  assert.equal(normalized.terminals[0].claudeLaunchSessionId, claudeLaunchSessionId);
  assert.equal(normalized.terminals[0].claudeIdentityObservedAt, at);
  assert.equal(normalized.providerBindings[0].url, 'https://jira.example/browse/KRONOS-1');
  assert.deepEqual(normalized.artifacts[0].warnings, ['Partial evidence']);
  assert.equal(normalized.monitoring.lastState, 'healthy');
  const malformedUrlTitle = workSessions.normalizeWorkSessionRecord({
    ...base,
    title: 'Review http://%.',
  }, options);
  assert.match(malformedUrlTitle.title, /\[REDACTED URL\]\./);
  const portableWindowsProject = workSessions.normalizeWorkSessionRecord({
    ...base,
    projectPath: 'C:\\workspace\\kronos',
  }, options);
  assert.equal(portableWindowsProject.projectPath, 'C:\\workspace\\kronos');
  if (process.platform !== 'win32') {
    const portableWindowsArtifact = structuredClone(base);
    portableWindowsArtifact.artifacts[0].promptPath = 'C:\\kronos\\contexts\\ticket.md';
    assert.equal(
      workSessions.normalizeWorkSessionRecord(portableWindowsArtifact, options).artifacts[0].promptPath,
      'C:\\kronos\\contexts\\ticket.md',
    );
  }

  for (const status of ['attached', 'detached', 'closed']) {
    const candidate = structuredClone(base);
    candidate.terminals[0].status = status;
    assert.equal(workSessions.normalizeWorkSessionRecord(candidate, options).terminals[0].status, status);
  }
  for (const provider of ['jira', 'gitlab', 'jenkins', 'sonar']) {
    const candidate = structuredClone(base);
    candidate.providerBindings[0].provider = provider;
    delete candidate.providerBindings[0].url;
    assert.equal(workSessions.normalizeWorkSessionRecord(candidate, options).providerBindings[0].provider, provider);
  }
  for (const resource of ['ticket', 'merge-request', 'pipeline', 'job', 'build', 'branch', 'quality-gate']) {
    const candidate = structuredClone(base);
    candidate.providerBindings[0].resource = resource;
    assert.equal(workSessions.normalizeWorkSessionRecord(candidate, options).providerBindings[0].resource, resource);
  }
  for (const state of ['healthy', 'partial', 'blocked', 'idle']) {
    const candidate = structuredClone(base);
    candidate.monitoring.lastState = state;
    assert.equal(workSessions.normalizeWorkSessionRecord(candidate, options).monitoring.lastState, state);
  }
  for (const currentError of ['provider_read_failed', 'provider_evidence_partial', 'provider_target_unavailable', 'ignored']) {
    const candidate = structuredClone(base);
    candidate.monitoring.currentError = currentError;
    const result = workSessions.normalizeWorkSessionRecord(candidate, options).monitoring;
    assert.equal(result.currentError, currentError === 'ignored' ? undefined : currentError);
  }

  const ticket = structuredClone(base);
  ticket.kind = 'ticket';
  ticket.ticketKey = 'KRONOS-42';
  ticket.ticketKeys = [];
  assert.deepEqual(workSessions.normalizeWorkSessionRecord(ticket, options).ticketKeys, ['KRONOS-42']);
  delete ticket.kind;
  assert.equal(workSessions.normalizeWorkSessionRecord(ticket, options).kind, 'ticket');

  const closed = structuredClone(base);
  closed.status = 'closed';
  closed.closedAt = at;
  assert.equal(workSessions.normalizeWorkSessionRecord(closed, options).closedAt, at);
});

test('work-session normalization rejects malformed values at every nested boundary', () => {
  const options = { kronosDir: path.join(tempRoot, 'session-invalid-matrix') };
  const base = workSessions.createStandaloneWorkSession({ title: 'Invalid matrix' }, options);
  const invalidCases = [
    [null, /must be an object/i],
    [{ ...base, kind: 'unknown' }, /kind is missing or invalid/i],
    [{ ...base, id: 1 }, /id must be a string/i],
    [{ ...base, id: '../escape' }, /id is missing or invalid/i],
    [{ ...base, title: 1 }, /title must be a string/i],
    [{ ...base, title: '' }, /title is missing/i],
    [{ ...base, title: 'x'.repeat(301) }, /title is missing/i],
    [{ ...base, title: 'line\nbreak' }, /control characters/i],
    [{ ...base, status: 'paused' }, /status is invalid/i],
    [{ ...base, createdAt: 1 }, /createdAt must be a timestamp/i],
    [{ ...base, createdAt: 'not-a-date' }, /createdAt is invalid/i],
    [{ ...base, projectPath: 7 }, /project path is missing or invalid/i],
    [{ ...base, projectPath: 'relative/project' }, /project path must be absolute/i],
    [{ ...base, projectPath: 'bad\npath' }, /project path is missing or invalid/i],
    [{ ...base, ticketKeys: Array(101).fill('KRONOS-1') }, /ticket contexts exceed/i],
    [{ ...base, terminals: {} }, /terminals must be an array/i],
    [{ ...base, terminals: Array(65).fill({}) }, /terminals exceed/i],
    [{ ...base, terminals: [null] }, /terminal binding must be an object/i],
    [{ ...base, terminals: [{ id: 't', name: 'T', status: 'unknown', attachedAt: base.createdAt }] }, /terminal binding status/i],
    [{ ...base, terminals: [{ id: 't', name: 'T', status: 'attached', attachedAt: base.createdAt, processId: 0 }] }, /positive safe integer/i],
    [{ ...base, terminals: [{
      id: 't', name: 'T', status: 'attached', attachedAt: base.createdAt,
      claudeLaunchSessionId: crypto.randomUUID(),
    }] }, /lifecycle identity requires a complete managed Claude identity/i],
    [{ ...base, terminals: [{
      id: 't', name: 'T', status: 'attached', attachedAt: base.createdAt,
      claudeSessionId: crypto.randomUUID(), editorSessionId: 'editor-one', claudePermissionMode: 'default',
      claudeIdentityObservedAt: base.createdAt,
    }] }, /lifecycle timestamp requires a launch session id/i],
    [{ ...base, providerBindings: {} }, /provider bindings must be an array/i],
    [{ ...base, providerBindings: Array(65).fill({}) }, /provider bindings exceed/i],
    [{ ...base, providerBindings: [null] }, /provider binding must be an object/i],
    [{ ...base, providerBindings: [{ id: 'p', provider: 'unknown', resource: 'ticket', subjectId: '1', attachedAt: base.createdAt }] }, /provider is invalid/i],
    [{ ...base, providerBindings: [{ id: 'p', provider: 'jira', resource: 'unknown', subjectId: '1', attachedAt: base.createdAt }] }, /resource is invalid/i],
    [{ ...base, providerBindings: [{ id: 'p', provider: 'jira', resource: 'ticket', subjectId: '1', attachedAt: base.createdAt, url: 'file:///tmp/no' }] }, /HTTP\(S\) URL/i],
    [{ ...base, artifacts: {} }, /artifacts must be an array/i],
    [{ ...base, artifacts: Array(201).fill({}) }, /artifacts exceed/i],
    [{ ...base, artifacts: [null] }, /context artifact must be an object/i],
    [{ ...base, monitoring: null }, /monitoring must be an object/i],
    [{ ...base, monitoring: { enabled: 'yes' } }, /enabled must be a boolean/i],
    [{ ...base, monitoring: { enabled: true, lastState: 'unknown' } }, /monitoring result state/i],
    [{ ...base, monitoring: { enabled: true, lastFailureCount: -1 } }, /non-negative safe integer/i],
    [{ ...base, status: 'closed' }, /closedAt/i],
    [{ ...base, kind: 'standalone', ticketKey: 'KRONOS-1' }, /must not include a ticket key/i],
  ];
  for (const [candidate, expected] of invalidCases) {
    assert.throws(() => workSessions.normalizeWorkSessionRecord(candidate, options), expected);
  }
  assert.throws(
    () => workSessions.createStandaloneWorkSession(
      { title: 'Invalid clock fixture' },
      { ...options, now: new Date('invalid') },
    ),
    /timestamp is invalid/i,
  );

  for (const ticketKey of [1, '', 'bad', 'ABC-0']) {
    assert.throws(
      () => workSessions.normalizeWorkSessionRecord({ ...base, kind: 'ticket', ticketKey, ticketKeys: [ticketKey] }, options),
      /ticket key/i,
    );
  }
  for (const warnings of [null, [1]]) {
    const candidate = structuredClone(base);
    candidate.artifacts = [{
      id: 'artifact-invalid',
      kind: 'jira',
      label: 'Invalid warning fixture',
      promptPath: path.join(options.kronosDir, 'contexts', 'invalid.md'),
      fetchedAt: base.createdAt,
      recordedAt: base.createdAt,
      complete: true,
      warnings,
    }];
    assert.throws(() => workSessions.normalizeWorkSessionRecord(candidate, options), /warnings must be an array|warning must be a string/i);
  }
});

test('work-session pure projections cover every health result and binding selection branch', () => {
  const at = '2026-07-20T12:34:56.000Z';
  const baseline = { enabled: true, suppressedUnchangedCount: Number.MAX_SAFE_INTEGER };
  const cases = [
    [{ polled: 0, failures: 1, skipped: 0 }, 'blocked', 'provider_read_failed'],
    [{ polled: 1, failures: 1, skipped: 0 }, 'partial', 'provider_read_failed'],
    [{ polled: 0, failures: 0, skipped: 1 }, 'blocked', 'provider_target_unavailable'],
    [{ polled: 1, failures: 0, skipped: 1 }, 'partial', 'provider_evidence_partial'],
    [{ polled: 1, failures: 0, skipped: 0 }, 'healthy', undefined],
    [{ polled: 0, failures: 0, skipped: 0 }, 'idle', undefined],
  ];
  for (const [input, state, currentError] of cases) {
    const result = workSessions.nextWorkSessionMonitoring(baseline, input, at);
    assert.equal(result.lastState, state);
    assert.equal(result.currentError, currentError);
  }
  const changed = workSessions.nextWorkSessionMonitoring(baseline, {
    polled: 1,
    failures: 0,
    skipped: 0,
    transitions: 1,
    attemptedAt: at,
    summary: 'Meaningful transition',
  }, '2026-07-20T00:00:00.000Z');
  assert.equal(changed.lastMeaningfulChangeAt, at);
  assert.equal(changed.suppressedUnchangedCount, 0);

  const bindings = [
    { id: 'invalid-date', attachedAt: 'invalid' },
    { id: 'older', attachedAt: '2026-07-19T00:00:00.000Z' },
    { id: 'newer', attachedAt: '2026-07-20T00:00:00.000Z' },
  ];
  assert.equal(workSessions.newestWorkSessionProviderBinding(bindings).id, 'newer');
  assert.equal(workSessions.newestWorkSessionProviderBinding(bindings, binding => binding.id === 'older').id, 'older');
  assert.equal(workSessions.newestWorkSessionProviderBinding([], () => true), undefined);
});

test('GitLab merge-request read status normalizes, deduplicates, persists, and rejects malformed state', () => {
  const session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'SCHEMA-950',
    title: 'GitLab read-status schema matrix',
  });
  try {
    assert.equal(mergeRequestMonitor.readGitLabMergeRequestMonitorSnapshot(session.id), null);
    assert.equal(mergeRequestMonitor.readGitLabMergeRequestReadStatus(session.id), null);
    assert.throws(() => mergeRequestMonitor.gitLabMergeRequestMonitorSnapshotPath(' bad/id '), /session id/i);
    assert.throws(() => mergeRequestMonitor.gitLabMergeRequestReadStatusPath(''), /session id/i);

    const first = mergeRequestMonitor.advanceGitLabMergeRequestReadStatus(null, {
      state: 'partial',
      components: [' Jobs ', 'notes', 'jobs', 7, 'unknown'],
      reason: ' BOUNDED_READ_INCOMPLETE ',
      updatedAt: '2026-07-20T12:00:00.000Z',
    });
    assert.equal(first.changed, true);
    assert.deepEqual(first.status.components, ['jobs', 'notes']);
    assert.equal(first.status.reason, 'bounded_read_incomplete');
    assert.equal(first.status.generation, 1);
    const unchanged = mergeRequestMonitor.advanceGitLabMergeRequestReadStatus(first.status, {
      state: 'partial', components: ['notes', 'jobs'], reason: 'bounded_read_incomplete',
    });
    assert.equal(unchanged.changed, false);
    assert.equal(unchanged.status, first.status);

    const fallback = mergeRequestMonitor.advanceGitLabMergeRequestReadStatus({
      ...first.status,
      generation: Number.MAX_SAFE_INTEGER,
    }, {
      state: 'unsupported', components: [], reason: 'bad reason with spaces',
      updatedAt: '2026-07-20T12:01:00.000Z',
    });
    assert.equal(fallback.status.state, 'failed');
    assert.equal(fallback.status.reason, 'unavailable');
    assert.equal(fallback.status.generation, Number.MAX_SAFE_INTEGER);
    assert.throws(() => mergeRequestMonitor.advanceGitLabMergeRequestReadStatus(null, {
      state: 'complete', reason: 'complete', updatedAt: 'not-a-date',
    }), /timestamp is invalid/i);

    const writtenPath = mergeRequestMonitor.writeGitLabMergeRequestReadStatus(session.id, first.status);
    assert.equal(writtenPath, mergeRequestMonitor.gitLabMergeRequestReadStatusPath(session.id));
    assert.deepEqual(mergeRequestMonitor.readGitLabMergeRequestReadStatus(session.id), first.status);
    assert.throws(() => mergeRequestMonitor.writeGitLabMergeRequestReadStatus(session.id, {
      ...first.status, fingerprint: 'wrong',
    }), /read status is invalid/i);

    const statusPath = mergeRequestMonitor.gitLabMergeRequestReadStatusPath(session.id);
    const malformed = [
      null,
      [],
      {},
      { ...first.status, schemaVersion: 2 },
      { ...first.status, generation: 0 },
      { ...first.status, generation: 1.5 },
      { ...first.status, state: 'unknown' },
      { ...first.status, components: 'jobs' },
      { ...first.status, reason: 7 },
      { ...first.status, fingerprint: 'wrong' },
    ];
    for (const value of malformed) {
      fs.writeFileSync(statusPath, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      if (process.platform !== 'win32') fs.chmodSync(statusPath, 0o600);
      assert.equal(mergeRequestMonitor.readGitLabMergeRequestReadStatus(session.id), null);
    }
    fs.writeFileSync(statusPath, `${JSON.stringify({ ...first.status, updatedAt: 'not-a-date' })}\n`, { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(statusPath, 0o600);
    assert.throws(() => mergeRequestMonitor.readGitLabMergeRequestReadStatus(session.id), /timestamp is invalid/i);
  } finally {
    workSessions.removeWorkSession(session.id);
  }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
