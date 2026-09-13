const assert = require('node:assert/strict');
const test = require('node:test');

const { buildLocalEvidenceSearchIndex } = require('../out/services/localEvidenceSearch.js');

test('local evidence search covers sessions, tickets, projects, branches, providers, artifacts, and events without terminal content', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [project('Application', 'feature/SEARCH-1')],
    sessions: [session({
      title: 'Fix account synchronization',
      ticketKeys: ['SEARCH-1'],
      providerBindings: [providerBinding()],
      artifacts: [artifact()],
      terminals: [{ name: 'TERMINAL-CONTENT-MUST-NOT-INDEX', transcript: 'SECRET-SCROLLBACK' }],
    })],
    events: [event()],
  });
  assert.deepEqual(new Set(index.map(entry => entry.kind)), new Set([
    'project', 'session', 'ticket', 'provider', 'artifact', 'event',
  ]));
  const searchable = index.map(entry => `${entry.label} ${entry.description} ${entry.detail}`).join('\n');
  for (const expected of [
    'Application',
    'feature/SEARCH-1',
    'Fix account synchronization',
    'SEARCH-1',
    'GitLab merge-request: 77',
    '[MR-77] review evidence',
    'Merge request now needs review',
  ]) {
    assert.match(searchable, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(searchable, /TERMINAL-CONTENT-MUST-NOT-INDEX|SECRET-SCROLLBACK/);
});

test('local evidence search enforces independent source budgets and a 2000-entry total ceiling', () => {
  const sessions = Array.from({ length: 200 }, (_, index) => session({
    id: `session-${index}`,
    title: `Session ${index}`,
    ticketKeys: [`SEARCH-${index + 1}`, `SEARCH-${index + 201}`],
    providerBindings: [providerBinding(`provider-${index}-a`), providerBinding(`provider-${index}-b`)],
    artifacts: [artifact(`artifact-${index}-a`), artifact(`artifact-${index}-b`)],
  }));
  const index = buildLocalEvidenceSearchIndex({
    projects: Array.from({ length: 250 }, (_, index) => project(`Project ${index}`, `branch-${index}`)),
    sessions,
    events: Array.from({ length: 700 }, (_, index) => event({ id: `event-${index}`, sessionId: `session-${index % 200}` })),
  });
  assert.equal(index.length, 2_000);
  assert.deepEqual(Object.fromEntries([...new Set(index.map(entry => entry.kind))].map(kind => [
    kind,
    index.filter(entry => entry.kind === kind).length,
  ])), {
    project: 200,
    session: 200,
    ticket: 300,
    provider: 400,
    artifact: 400,
    event: 500,
  });
});

test('local evidence search stops oversized per-session collections at each independent budget', () => {
  const oversized = session({
    id: 'session-oversized-sources',
    ticketKeys: Array.from({ length: 301 }, (_, index) => `LIMIT-${index + 1}`),
    providerBindings: Array.from({ length: 401 }, (_, index) => providerBinding(`provider-limit-${index}`)),
    artifacts: Array.from({ length: 401 }, (_, index) => artifact(`artifact-limit-${index}`)),
  });
  const index = buildLocalEvidenceSearchIndex({ projects: [], sessions: [oversized], events: [] });
  assert.equal(index.filter(entry => entry.kind === 'ticket').length, 300);
  assert.equal(index.filter(entry => entry.kind === 'provider').length, 400);
  assert.equal(index.filter(entry => entry.kind === 'artifact').length, 400);
});

test('local evidence search strips controls and bounds every visible field', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [project(`Project\n${'x'.repeat(500)}`, `branch\u0000${'y'.repeat(800)}`)],
    sessions: [],
    events: [event({ summary: `Changed\n${'z'.repeat(1_500)}` })],
  });
  for (const entry of index) {
    assert.doesNotMatch(`${entry.id}${entry.label}${entry.description}${entry.detail}`, /[\u0000-\u001f\u007f\u2028\u2029]/);
    assert.ok(entry.label.length <= 300);
    assert.ok(entry.description.length <= 700);
    assert.ok(entry.detail.length <= 1_000);
  }
});

test('local evidence search actions retain only the bounded local target needed to open a result', () => {
  const index = buildLocalEvidenceSearchIndex({
    projects: [],
    sessions: [session({ providerBindings: [providerBinding()], artifacts: [artifact()] })],
    events: [event({ responseBody: 'PROVIDER-BODY-MUST-NOT-INDEX' })],
  });
  const provider = index.find(entry => entry.kind === 'provider');
  const savedArtifact = index.find(entry => entry.kind === 'artifact');
  const savedEvent = index.find(entry => entry.kind === 'event');
  assert.deepEqual(provider.action, {
    kind: 'provider',
    sessionId: 'session-search',
    url: 'https://gitlab.example/group/app/-/merge_requests/77',
  });
  assert.deepEqual(savedArtifact.action, {
    kind: 'artifact',
    sessionId: 'session-search',
    promptPath: '/private/kronos/MR-77/prompt.md',
  });
  assert.deepEqual(savedEvent.action, { kind: 'event', sessionId: 'session-search' });
  assert.doesNotMatch(JSON.stringify(index), /PROVIDER-BODY-MUST-NOT-INDEX/);
});

test('local evidence search explains sparse and unavailable extra-feature metadata without inventing targets', () => {
  const sparseSession = session({
    id: 'session-sparse',
    kind: 'standalone',
    title: 'Sparse standalone',
    projectName: undefined,
    projectPath: undefined,
    ticketKey: undefined,
    ticketKeys: [],
    providerBindings: [
      ...['jenkins', 'sonar', 'jira', 'operator', 'kronos', 'custom'].map((provider, index) => ({
        ...providerBinding(`provider-${provider}`),
        provider,
        resource: index === 0 ? 'build' : 'evidence',
        subjectId: String(index + 1),
        projectId: undefined,
        url: undefined,
      })),
    ],
    artifacts: [{
      ...artifact('artifact-partial'),
      complete: false,
      contentSha256: undefined,
    }],
  });
  const index = buildLocalEvidenceSearchIndex({
    projects: [
      { name: 'missing', displayName: 'Missing checkout', path: '/projects/missing', detached: false, available: false },
      { name: 'detached', displayName: '', path: '/projects/detached', branch: 'abc1234', detached: true, available: true },
    ],
    sessions: [sparseSession],
    events: [event({
      id: 'event-fallback',
      sessionId: sparseSession.id,
      source: 'custom',
      subject: undefined,
    })],
  });
  const missing = index.find(entry => entry.id === 'project:missing');
  assert.equal(missing.label, 'Missing checkout');
  assert.equal(missing.description, 'branch unavailable');
  assert.match(missing.detail, /registered path unavailable/);
  assert.equal(index.find(entry => entry.id === 'project:detached').description, 'detached abc1234');
  const sessionEntry = index.find(entry => entry.id === 'session:session-sparse');
  assert.match(sessionEntry.description, /no project.*standalone/);
  assert.equal(sessionEntry.detail, 'No Jira context attached');
  assert.equal(index.some(entry => entry.kind === 'ticket'), false);
  assert.deepEqual(
    index.filter(entry => entry.kind === 'provider').map(entry => entry.label),
    ['Jenkins build: 1', 'SonarQube evidence: 2', 'Jira evidence: 3', 'Operator evidence: 4', 'Kronos evidence: 5', 'custom evidence: 6'],
  );
  assert.ok(index.filter(entry => entry.kind === 'provider').every(entry => Object.hasOwn(entry.action, 'url') === false));
  const partial = index.find(entry => entry.kind === 'artifact');
  assert.match(partial.description, /partial/);
  assert.doesNotMatch(partial.detail, /SHA/);
  assert.equal(index.find(entry => entry.id === 'event:event-fallback').detail, 'Session session-sparse');
});

function project(name, branch) {
  return { name, path: `/projects/${name}`, branch, detached: false, available: true };
}

function session(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'session-search',
    kind: 'ticket',
    ticketKey: 'SEARCH-1',
    ticketKeys: ['SEARCH-1'],
    title: 'Search session',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
    projectName: 'Application',
    projectPath: '/projects/Application',
    ...overrides,
  };
}

function providerBinding(id = 'provider-gitlab-77') {
  return {
    id,
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '77',
    projectId: 'group/app',
    url: 'https://gitlab.example/group/app/-/merge_requests/77',
    attachedAt: '2026-07-15T12:00:00.000Z',
  };
}

function artifact(id = 'artifact-mr-77') {
  return {
    id,
    kind: 'gitlab-merge-request',
    label: '[MR-77] review evidence',
    promptPath: '/private/kronos/MR-77/prompt.md',
    fetchedAt: '2026-07-15T12:00:00.000Z',
    recordedAt: '2026-07-15T12:00:00.000Z',
    complete: true,
    warnings: [],
    contentSha256: 'a'.repeat(64),
  };
}

function event(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'event-search',
    at: '2026-07-15T12:05:00.000Z',
    sessionId: 'session-search',
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'Merge request now needs review',
    subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'SEARCH-1' },
    ...overrides,
  };
}
