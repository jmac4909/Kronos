const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-attention-conditionals-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const providerReadHealth = require('../out/services/providerReadHealth.js');
const monitorEvents = require('../out/services/monitorEventStore.js');
const attentionEventContexts = require('../out/services/attentionEventContextStore.js');
const terminalContextInsertion = require('../out/services/terminalContextInsertion.js');

const vscode = createVscodeMock();
const originalLoad = Module._load;
Module._load = function loadWithVscodeMock(request, parent, isMain) {
  if (request === 'vscode') { return vscode; }
  return originalLoad.call(this, request, parent, isMain);
};
let attentionTree;
try {
  attentionTree = require('../out/views/AttentionTreeProvider.js');
} finally {
  Module._load = originalLoad;
}

test('provider read health maps every bounded failure and operator label without leaking raw errors', () => {
  const withCode = (message, code) => Object.assign(new Error(message), { code });
  const cases = [
    [new Error('Provider request failed with HTTP 401.'), 'authentication', 'authentication unavailable'],
    [new Error('Provider request failed with HTTP 403.'), 'permission', 'read permission unavailable'],
    [new Error('Provider request failed with HTTP 404.'), 'not_found', 'merge request not found'],
    [new Error('Provider request failed with HTTP 429.'), 'rate_limited', 'provider rate limited'],
    [new Error('Provider response exceeded the response safety limit.'), 'safety_limit', 'bounded read limit reached'],
    [new Error('Provider configuration missing GITLAB_TOKEN.'), 'configuration', 'provider configuration unavailable'],
    [withCode('connect timed out', 'ETIMEDOUT'), 'timeout', 'request timed out'],
    [withCode('getaddrinfo failed', 'ENOTFOUND'), 'dns', 'provider hostname unavailable'],
    [new Error('TLS certificate verification failed.'), 'tls', 'provider TLS verification failed'],
    [withCode('socket hang up', 'ECONNRESET'), 'network', 'network unavailable'],
    [new Error('Provider returned malformed JSON.'), 'malformed_response', 'provider response was malformed'],
    [new Error('Provider request failed with HTTP 503.'), 'provider_5xx', 'provider server error'],
    [new Error('Provider returned malformed JSON with HTTP 503.'), 'provider_5xx', 'provider server error'],
    [new Error('Provider request failed with HTTP 418.'), 'provider_4xx', 'provider request refused'],
    [new Error('Redirect outside the configured origin.'), 'unavailable', 'provider unavailable'],
  ];
  for (const [error, reason, label] of cases) {
    assert.equal(providerReadHealth.providerReadFailureReason(error), reason);
    assert.equal(providerReadHealth.readFailureLabel(reason), label);
  }
  assert.equal(providerReadHealth.readFailureLabel('future_reason'), 'provider unavailable');
  assert.equal(providerReadHealth.readFailureLabel('toString'), 'provider unavailable');
  assert.equal(providerReadHealth.readFailureLabel('__proto__'), 'provider unavailable');
});

test('provider read fingerprints and incomplete-component lists change only with normalized evidence', () => {
  const fingerprint = providerReadHealth.deterministicReadStatusFingerprint(
    'jenkins', 'partial', 'bounded', 2, 'tests,stages',
  );
  assert.equal(
    fingerprint,
    providerReadHealth.deterministicReadStatusFingerprint('jenkins', 'partial', 'bounded', 2, 'tests,stages'),
  );
  for (const changed of [
    ['sonar', 'partial', 'bounded', 2, 'tests,stages'],
    ['jenkins', 'failed', 'bounded', 2, 'tests,stages'],
    ['jenkins', 'partial', 'timeout', 2, 'tests,stages'],
    ['jenkins', 'partial', 'bounded', 3, 'tests,stages'],
    ['jenkins', 'partial', 'bounded', 2, 'tests'],
  ]) {
    assert.notEqual(fingerprint, providerReadHealth.deterministicReadStatusFingerprint(...changed));
  }

  assert.deepEqual(providerReadHealth.jenkinsIncompleteReadComponents({
    completeness: { buildComplete: false, testReport: 'partial', stages: 'partial' },
  }), ['build', 'tests', 'stages']);
  assert.deepEqual(providerReadHealth.jenkinsIncompleteReadComponents({
    completeness: { buildComplete: true, testReport: 'complete', stages: 'complete' },
  }), []);
  assert.deepEqual(providerReadHealth.sonarIncompleteReadComponents({
    completeness: { qualityGateComplete: false, measuresComplete: false, issuesComplete: false },
  }), ['quality-gate', 'measures', 'issues']);
  assert.deepEqual(providerReadHealth.sonarIncompleteReadComponents({
    completeness: { qualityGateComplete: true, measuresComplete: true, issuesComplete: true },
  }), []);
});

test('Attention event context freezes exactly one supported transition for non-submitting prompt use', () => {
  const event = transitionEvent(
    'event-context-mr',
    'session-context-mr',
    '2026-07-16T12:00:00.000Z',
    'gitlab',
    'changes_requested',
    {
      summary: 'MR !77 has requested changes.',
      subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'ATTN-77' },
      before: { state: 'approved' },
      after: { state: 'changes-requested' },
      metadata: { transitionKind: 'changes_requested', mergeRequestIid: 77, unresolvedDiscussionCount: 2 },
    },
  );
  const context = attentionEventContexts.buildAttentionEventPromptContext({
    ...event,
    artifactPath: path.join(tempRoot, 'prior-context', 'prompt.md'),
  }, {
    projectName: 'Application',
    ticketKey: 'ATTN-77',
  });
  assert.equal(context.source, 'gitlab');
  assert.equal(context.provider, 'GitLab');
  assert.equal(context.event.id, event.id);
  assert.equal(context.event.artifactPath, undefined, 'an exact event snapshot cannot recursively retain another artifact');
  assert.equal(context.headline, 'ATTN-77 MR !77 has requested changes.');
  const artifactRoot = path.join(tempRoot, 'event-context-artifacts');
  const artifact = attentionEventContexts.writeAttentionEventContextArtifacts(context, { kronosDir: artifactRoot });
  const repeated = attentionEventContexts.writeAttentionEventContextArtifacts(context, { kronosDir: artifactRoot });
  assert.equal(repeated.promptPath, artifact.promptPath, 'the same retained transition is content-addressed once');
  assert.match(artifact.contextId, /^ATTENTION-GITLAB-[A-F0-9]{24}$/);
  assert.equal(fs.statSync(artifact.promptPath).mode & 0o777, 0o600);
  const prompt = fs.readFileSync(artifact.promptPath, 'utf8');
  assert.match(prompt, /exactly one previously retained Attention transition/i);
  assert.match(prompt, /event-context-mr/);
  assert.match(prompt, /unresolvedDiscussionCount/);
  assert.doesNotMatch(prompt, /event-context-other/);
  const reference = terminalContextInsertion.buildAttentionEventContextReference(artifact.contextId, artifact.promptPath);
  assert.equal(terminalContextInsertion.isSafeTerminalContextReference(reference), true);
  assert.match(reference, /^\[ATTENTION-GITLAB-[A-F0-9]{24}\] Read exact Attention event context file /);

  assert.doesNotThrow(() => attentionEventContexts.buildAttentionEventPromptContext({
    ...event,
    id: 'event-context-jenkins',
    source: 'jenkins',
    subject: { kind: 'build', id: '32' },
  }));
  assert.doesNotThrow(() => attentionEventContexts.buildAttentionEventPromptContext({
    ...event,
    id: 'event-context-sonar',
    source: 'sonar',
    subject: { kind: 'quality-gate', id: 'application:main' },
  }));
  assert.throws(
    () => attentionEventContexts.buildAttentionEventPromptContext({
      ...event,
      id: 'event-context-pipeline',
      subject: { kind: 'pipeline', id: '412' },
    }),
    /Only GitLab merge-request, Jenkins, and SonarQube/,
  );
  assert.throws(
    () => attentionEventContexts.writeAttentionEventContextArtifacts({ ...context, source: 'sonar' }, { kronosDir: artifactRoot }),
    /unsupported or mismatched provider source/,
  );
});

test('monitor event ledger round-trips full records, filters independently, and acknowledges once', () => {
  const options = { kronosDir: path.join(tempRoot, 'ledger') };
  const artifactDir = path.join(options.kronosDir, 'contexts');
  fs.mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  const artifactPath = path.join(artifactDir, 'mr.md');
  fs.writeFileSync(artifactPath, '# evidence\n', { mode: 0o600 });

  const first = monitorEvents.appendMonitorEvent({
    id: 'event-first',
    at: '2026-07-15T12:00:00.000Z',
    sessionId: 'session-one',
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'MR state changed.',
    subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'ATTN-1' },
    before: { state: 'opened', fingerprint: 'before-fingerprint' },
    after: { state: 'merged', fingerprint: 'after-fingerprint' },
    artifactPath,
    metadata: {
      transitionStreamKey: 'project:Application:gitlab:merge-request:77:state',
      transitionKind: 'merge_request_merged',
      count: 0,
      visible: false,
      optional: null,
    },
  }, options);
  const second = monitorEvents.appendMonitorEvent({
    id: 'event-second',
    at: '2026-07-15T12:01:00.000Z',
    sessionId: 'session-two',
    type: 'provider.transition',
    source: 'sonar',
    summary: 'Quality gate failed.',
    subject: { kind: 'quality-gate', id: 'app-main', project: 'Backend', ticketKey: 'ATTN-2' },
    after: { state: 'ERROR' },
  }, options);

  assert.equal(monitorEvents.monitorEventsPath(options), path.join(options.kronosDir, 'monitor-events.jsonl'));
  assert.deepEqual(monitorEvents.listMonitorEvents({}, options).map(event => event.id), [second.id, first.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ sessionId: 'session-one' }, options).map(event => event.id), [first.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ ticketKey: 'attn-2' }, options).map(event => event.id), [second.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ source: 'gitlab' }, options).map(event => event.id), [first.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ types: ['provider.transition'] }, options).map(event => event.id), [second.id, first.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ since: '2026-07-15T12:00:30.000Z' }, options).map(event => event.id), [second.id]);
  assert.deepEqual(monitorEvents.listMonitorEvents({ limit: 1 }, options).map(event => event.id), [second.id]);
  assert.equal(monitorEvents.readMonitorEvent(first.id, options).artifactPath, artifactPath);
  assert.equal(monitorEvents.readMonitorEvent('event-missing', options), null);

  fs.appendFileSync(monitorEvents.monitorEventsPath(options), '{not-json}\n', { mode: 0o600 });
  assert.deepEqual(monitorEvents.listMonitorEvents({ limit: Number.NaN }, options).map(event => event.id), [second.id, first.id]);

  const acknowledged = monitorEvents.acknowledgeMonitorEvent(first.id, first.sessionId, options);
  assert.equal(acknowledged.subject.ticketKey, 'ATTN-1');
  assert.equal(acknowledged.metadata.acknowledgedEventId, first.id);
  assert.equal(acknowledged.metadata.transitionStreamKey, first.metadata.transitionStreamKey);
  assert.equal(monitorEvents.acknowledgeMonitorEvent(first.id, first.sessionId, options).id, acknowledged.id);
  assert.throws(
    () => monitorEvents.acknowledgeMonitorEvent(second.id, first.sessionId, options),
    /Monitor event not found for work session/,
  );
});

test('monitor event normalization fails closed on unsafe identities, payloads, metadata, and paths', () => {
  const options = { kronosDir: path.join(tempRoot, 'normalization') };
  const base = () => ({
    schemaVersion: 1,
    id: 'event-safe',
    at: '2026-07-15T12:00:00.000Z',
    sessionId: 'session-safe',
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'Safe summary.',
  });
  const rejects = [
    [null, /must be an object/],
    [{ ...base(), schemaVersion: 2 }, /Unsupported monitor event schema/],
    [{ ...base(), id: 'unsafe/id' }, /monitor event id is missing or invalid/],
    [{ ...base(), at: 'not-a-date' }, /timestamp is invalid/],
    [{ ...base(), sessionId: '' }, /work session id is missing or invalid/],
    [{ ...base(), type: 'provider.write' }, /event type is invalid/],
    [{ ...base(), source: 'unknown' }, /event source is invalid/],
    [{ ...base(), summary: 'line\u0000break' }, /monitor event summary is missing/],
    [{ ...base(), subject: [] }, /subject must be an object/],
    [{ ...base(), subject: { kind: 'mr', id: '77', ticketKey: 'bad key' } }, /Ticket key is missing or invalid/],
    [{ ...base(), before: {} }, /before state is empty/],
    [{ ...base(), after: [] }, /after state must be an object/],
    [{ ...base(), metadata: [] }, /metadata must be an object/],
    [{ ...base(), metadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index}`, index])) }, /32-entry limit/],
    [{ ...base(), metadata: { token: 'not-retained' } }, /metadata key is unsafe/],
    [{ ...base(), metadata: { nested: {} } }, /must be a primitive value/],
    [{ ...base(), metadata: { infinite: Number.POSITIVE_INFINITY } }, /must be a primitive value/],
    [{ ...base(), artifactPath: 'relative/context.md' }, /artifact path must be absolute/],
    [{ ...base(), artifactPath: path.join(tempRoot, 'outside.md') }, /must stay inside the Kronos data directory/],
  ];
  for (const [value, pattern] of rejects) {
    assert.throws(() => monitorEvents.normalizeMonitorEvent(value, options), pattern);
  }

  assert.throws(
    () => monitorEvents.appendMonitorEvent({
      sessionId: 'session-safe',
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'Invalid implicit timestamp.',
    }, { ...options, now: new Date(Number.NaN) }),
    /timestamp is invalid/,
  );
  assert.throws(
    () => monitorEvents.appendMonitorEvent({
      sessionId: 'session-safe',
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'Oversized normalized event.',
      metadata: Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`field${index}`, 'x'.repeat(1000)])),
    }, options),
    /exceeds the 16384-byte limit/,
  );
});

test('Attention tree groups newest project state, preserves nicknames, and redacts loader failures', t => {
  const application = workSession('session-application', 'Application', '/workspace/application', 'ATTN-1');
  application.providerBindings = [providerBinding(
    'gitlab-binding', 'gitlab', 'merge-request', '77',
    'https://gitlab.example/group/application/-/merge_requests/77?noise=1',
  )];
  const unassigned = workSession('session-unassigned', undefined, undefined, 'ATTN-2');
  const events = [
    transitionEvent('event-application', application.id, '2026-07-15T12:00:00.000Z', 'gitlab', 'initial_mr_observed', {
      subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'ATTN-1' },
      after: { state: 'opened/mergeable' },
      metadata: { transitionKind: 'initial_mr_observed', mergeRequestIid: 77 },
    }),
    transitionEvent('event-unassigned', unassigned.id, '2026-07-15T12:01:00.000Z', 'kronos', 'monitoring_blocked', {
      subject: { kind: 'monitoring-blocker', id: 'setup' },
      after: { state: 'monitoring/blocked' },
    }),
  ];
  const provider = new attentionTree.AttentionTreeProvider({
    loadMonitorEvents: () => events,
    loadWorkSessions: () => [application, unassigned],
    loadRegisteredProjects: () => [{ name: 'Application', path: '/workspace/application' }],
    loadProjectDisplayName: name => name === 'Application' ? 'Customer API' : undefined,
  });
  const changes = [];
  provider.onDidChangeTreeData(value => changes.push(value));
  const groups = provider.getChildren();
  assert.deepEqual(groups.map(group => group.label), ['Unassigned project', 'Customer API']);
  assert.equal(groups[1].id, 'attention-group:project:Application');
  assert.equal(groups[1].projectName, 'Application');
  assert.doesNotMatch(groups[1].tooltip, /Stable project identity|work session|provider transition/i);
  const rows = provider.getChildren(groups[1]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].command.command, 'kronos.openProvider');
  assert.equal(rows[0].providerUrl, 'https://gitlab.example/group/application/-/merge_requests/77');
  assert.match(rows[0].tooltip, /Right-click to use this exact event in a prompt/);
  assert.equal(provider.getTreeItem(rows[0]), rows[0]);
  assert.deepEqual(provider.getChildren(rows[0]), []);
  provider.refresh();
  assert.deepEqual(changes, [undefined]);
  provider.dispose();

  const empty = new attentionTree.AttentionTreeProvider({
    loadMonitorEvents: () => [],
    loadWorkSessions: () => [],
  }).getChildren();
  assert.equal(empty[0].contextValue, 'attention_empty');
  assert.equal(empty[0].iconPath.id, 'check');
  assert.equal(empty[0].description, undefined);
  assert.doesNotMatch(empty[0].tooltip, /provider-health|local-monitoring|transition/i);
  assert.match(empty[0].tooltip, /Clear an item after review/);

  const defaultDisplayName = new attentionTree.AttentionTreeProvider({
    loadMonitorEvents: () => [events[0]],
    loadWorkSessions: () => [application],
    loadRegisteredProjects: () => [{ name: 'Application', path: '/workspace/application' }],
  }).getChildren();
  assert.equal(defaultDisplayName[0].label, 'Application');

  const warning = t.mock.method(console, 'warn', () => {});
  const secret = ['glpat-', 'attentionconditionalfixture'].join('');
  const failedEvents = new attentionTree.AttentionTreeProvider({
    loadMonitorEvents: () => { throw new Error(`Authorization: Bearer ${secret}`); },
  }).getChildren();
  const failedCorrelations = new attentionTree.AttentionTreeProvider({
    loadMonitorEvents: () => events,
    loadWorkSessions: () => { throw new Error(`Authorization: Bearer ${secret}`); },
    loadRegisteredProjects: () => { throw new Error(`Authorization: Bearer ${secret}`); },
  }).getChildren();
  for (const failed of [failedEvents[0], failedCorrelations[0]]) {
    assert.equal(failed.label, 'Attention may be incomplete');
    assert.equal(failed.contextValue, 'attention_error');
    assert.equal(failed.iconPath.id, 'warning');
    assert.equal(failed.command.command, 'kronos.doctor');
    assert.equal(failed.command.title, 'Check Setup');
    assert.match(failed.tooltip, /could not load all saved provider updates/i);
  }
  assert.equal(warning.mock.callCount(), 3);
  const warnings = warning.mock.calls.map(call => call.arguments[0]).join(' ');
  assert.equal(warnings.includes(secret), false);
  assert.match(warnings, /REDACTED/);
});

test('Attention rows exhaust primary actions, provider choices, tooltips, and generic severity icons', () => {
  const target = {
    eventId: 'event-target',
    sessionId: 'session-target',
    workSessionId: 'session-target',
    ticketKey: undefined,
    source: 'gitlab',
    providerUrl: 'https://gitlab.example/group/app/-/merge_requests/77',
  };
  assert.equal(attentionTree.attentionPrimaryCommand(target, true).command, 'kronos.openProvider');
  assert.equal(attentionTree.attentionPrimaryCommand({ ...target, providerUrl: undefined }, true).command, 'kronos.configureProjectIntegrations');
  assert.equal(attentionTree.attentionPrimaryCommand({ ...target, providerUrl: undefined }, false).command, 'kronos.doctor');

  const session = workSession('session-target', 'Application', '/workspace/application', 'ATTN-7');
  const event = transitionEvent('event-target', session.id, '2026-07-15T13:00:00.000Z', 'gitlab', 'open_mr_reminder', {
    subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'ATTN-7' },
    before: { state: 'opened' },
    after: { state: 'opened/mergeable' },
    metadata: {
      transitionKind: 'open_mr_reminder',
      mergeRequestIid: 77,
      pipelineId: 412,
      failedJobCount: 0,
      branch: 'feature/attention',
    },
  });
  const choices = [
    { label: 'Build 42', description: 'newest', url: 'https://jenkins.example/job/app/42/' },
    { label: 'Build 41', description: 'older', url: 'https://jenkins.example/job/app/41/' },
  ];
  const row = new attentionTree.AttentionEventTreeItem({
    event,
    session,
    ticketKey: 'ATTN-7',
    providerUrl: target.providerUrl,
    providerChoices: choices,
  });
  assert.equal(row.contextValue, 'attention_provider_project_ticket_gitlab_event');
  assert.deepEqual(row.command.arguments[0].providerChoices, choices);
  assert.equal(row.command.arguments[0].projectName, 'Application');
  assert.equal(row.command.arguments[0].projectPath, '/workspace/application');
  assert.match(row.tooltip, /open merge request returns after the next successful check/);
  assert.match(row.tooltip, /Pipeline: 412/);
  assert.match(row.tooltip, /Failed jobs: 0/);
  assert.equal(row.iconPath.id, 'git-pull-request');
  assert.equal(row.iconPath.color.id, 'charts.green');

  const severityCases = [
    ['partial', 'warning', 'list.warningForeground'],
    ['monitoring_blocked', 'debug-disconnect', 'list.errorForeground'],
    ['pipeline_failed', 'error', 'testing.iconFailed'],
    ['pipeline_recovered', 'check', 'testing.iconPassed'],
    ['changes_requested', 'warning', 'list.warningForeground'],
    ['initial_observation', 'bell-dot', 'charts.yellow'],
  ];
  for (const [transitionKind, icon, color] of severityCases) {
    const generic = new attentionTree.AttentionEventTreeItem({
      event: transitionEvent(`event-${transitionKind}`, session.id, '2026-07-15T13:01:00.000Z', 'kronos', transitionKind),
      session: undefined,
      ticketKey: undefined,
      providerUrl: undefined,
      providerChoices: [],
    });
    assert.equal(generic.iconPath.id, icon, transitionKind);
    assert.equal(generic.iconPath.color.id, color, transitionKind);
    assert.equal(generic.command.command, 'kronos.doctor');
    assert.match(generic.tooltip, /item stays cleared until its state changes/);
  }

  assert.throws(() => new attentionTree.AttentionGroupTreeItem([]), /require at least one event/);
  const invalidTimeGroup = new attentionTree.AttentionGroupTreeItem([{
    event: { ...event, at: 'invalid-time' },
    session,
    ticketKey: 'ATTN-7',
    providerUrl: undefined,
    providerChoices: [],
  }]);
  assert.match(invalidTimeGroup.description, /1 item • invalid-time/);
});

function transitionEvent(id, sessionId, at, source, transitionKind, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    at,
    sessionId,
    type: 'provider.transition',
    source,
    summary: `${transitionKind} fixture`,
    subject: { kind: 'provider-read', id: `${source}:read` },
    after: { state: transitionKind },
    metadata: { transitionKind },
    ...overrides,
  };
}

function workSession(id, projectName, projectPath, ticketKey) {
  return {
    schemaVersion: 1,
    id,
    kind: ticketKey ? 'ticket' : 'standalone',
    ...(ticketKey ? { ticketKey, ticketKeys: [ticketKey] } : { ticketKeys: [] }),
    title: `${id} session`,
    ...(projectName ? { projectName } : {}),
    ...(projectPath ? { projectPath } : {}),
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
  };
}

function providerBinding(id, provider, resource, subjectId, url) {
  return {
    id,
    provider,
    resource,
    subjectId,
    attachedAt: '2026-07-15T12:00:00.000Z',
    url,
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
    TreeItemCollapsibleState: { None: 0, Expanded: 2 },
  };
}
