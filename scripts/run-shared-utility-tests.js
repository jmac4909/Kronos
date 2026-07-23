const assert = require('node:assert/strict');
const test = require('node:test');

const errorUtils = require('../out/services/errorUtils.js');
const fileNames = require('../out/services/fileNames.js');
const operationStages = require('../out/services/operationStageOutcome.js');
const providerDiagnostics = require('../out/services/providerReadDiagnostics.js');
const providerReadTransitions = require('../out/services/providerReadTransitions.js');
const records = require('../out/services/records.js');
const webviewHtml = require('../out/services/webviewHtml.js');
const webviewMessages = require('../out/services/webviewMessages.js');
const { createOperatorTerminalRegistry } = require('../out/services/operatorTerminalRegistry.js');
const { configureWorkFilterFlow } = require('../out/commands/workFilterFlow.js');
const runtimeResolutions = require('../out/commands/runtimeResolutionFlows.js');
const runtimeSettings = require('../out/services/runtimeSettings.js');
const runtimePresentation = require('../out/services/runtimePresentation.js');
const runtimeOperations = require('../out/services/runtimeOperationsPresentation.js');
const providerPollingPresentation = require('../out/services/providerPollingPresentation.js');
const projectCommandPresentation = require('../out/services/projectCommandPresentation.js');
const attentionPresentation = require('../out/services/attentionPresentation.js');
const attentionProjection = require('../out/services/attentionProjection.js');
const operationsReadiness = require('../out/services/operationsReadiness.js');
const sessionInventory = require('../out/services/sessionInventoryPresentation.js');
const workSessionLifecycle = require('../out/services/workSessionLifecycle.js');
const workTicketFilters = require('../out/services/workTicketFilters.js');

function sessionFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'session-fixture',
    kind: 'standalone',
    title: 'Fixture session',
    ticketKeys: [],
    status: 'active',
    createdAt: '2026-07-20T10:00:00.000Z',
    updatedAt: '2026-07-20T11:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: false },
    ...overrides,
  };
}

function eventFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'event-fixture',
    at: '2026-07-20T11:00:00.000Z',
    sessionId: 'session-fixture',
    type: 'provider.transition',
    source: 'gitlab',
    summary: 'Provider changed.',
    subject: { kind: 'merge-request', id: '7' },
    after: { state: 'opened', fingerprint: 'a'.repeat(64) },
    metadata: {},
    ...overrides,
  };
}

test('shared record and filename normalization covers every accepted and rejected primitive shape', () => {
  assert.equal(records.isRecord({ value: 1 }), true);
  for (const value of [null, undefined, [], 'text', 1, false]) {
    assert.equal(records.isRecord(value), false);
    assert.deepEqual(records.recordFromUnknown(value), {});
    assert.deepEqual(records.recordEntriesFromUnknown(value), []);
  }
  assert.deepEqual(records.recordFromUnknown({ value: 1 }), { value: 1 });
  assert.deepEqual(records.arrayFromUnknown(['a']), ['a']);
  assert.deepEqual(records.arrayFromUnknown({ 0: 'a' }), []);
  assert.equal(records.trimmedStringFromUnknown(' value '), 'value');
  assert.equal(records.trimmedStringFromUnknown(1, 'fallback'), 'fallback');
  assert.equal(records.optionalTrimmedStringFromUnknown('   '), undefined);
  assert.equal(records.optionalTrimmedStringFromUnknown(' ready '), 'ready');

  for (const [value, expected] of [
    [4.5, 4.5], [' 6.25 ', 6.25], ['', undefined], ['nope', undefined],
    [Number.NaN, undefined], [Number.POSITIVE_INFINITY, undefined], [null, undefined],
  ]) {
    assert.equal(records.optionalFiniteNumberFromUnknown(value), expected);
  }
  assert.equal(records.nonNegativeIntegerFromUnknown('5.9'), 5);
  assert.equal(records.nonNegativeIntegerFromUnknown(-1), undefined);
  assert.equal(records.boundedInteger(undefined, 7, 1, 10), 7);
  assert.equal(records.boundedInteger(Number.NaN, 7, 1, 10), 7);
  assert.equal(records.boundedInteger(-4.2, 7, 1, 10), 1);
  assert.equal(records.boundedInteger(20.9, 7, 1, 10), 10);
  assert.equal(records.boundedInteger(4.9, 7, 1, 10), 4);
  assert.equal(records.firstNonEmptyString(undefined, ' ', ' value ', 'later'), 'value');
  assert.equal(records.firstNonEmptyString(undefined, ' '), undefined);
  assert.deepEqual(records.recordEntriesFromUnknown({ b: 2, a: 1 }), [['b', 2], ['a', 1]]);
  assert.equal(records.recordString({ name: ' value ' }, 'name'), 'value');
  assert.equal(records.recordString({}, 'missing'), '');

  assert.equal(fileNames.safeFileStem('alpha.beta'), 'alpha.beta');
  assert.equal(fileNames.safeFileStem('---'), 'artifact');
  assert.equal(fileNames.safeFileStem('***', { fallback: 'safe' }), 'safe');
  const shortened = fileNames.safeFileStem('unsafe path/'.repeat(10), { maxLength: 24, hashLength: 8 });
  assert.match(shortened, /^[A-Za-z0-9_.-]{10,24}$/);
  assert.equal(shortened.length, 24);
  const minimumPrefix = fileNames.safeFileStem('long value', { maxLength: 4, hashLength: 8 });
  assert.match(minimumPrefix, /^[A-Za-z0-9_.-]+$/);
  assert.ok(minimumPrefix.length > 4, 'a one-character prefix remains when a caller chooses an inconsistent hash bound');
});

test('operation-stage outcomes retain every stage and report independent bookkeeping failures', () => {
  const skipped = operationStages.finalizeInsertedContext({
    operation: '  Place\ncontext  ',
    providerRead: { state: 'partial', detail: ' one\nwarning ' },
  });
  assert.equal(skipped.operation, 'Place context');
  assert.equal(skipped.partial, true);
  assert.equal(skipped.failed, false);
  assert.deepEqual(skipped.steps.map(step => [step.stage, step.state]), [
    ['provider-read', 'partial'],
    ['artifact-write', 'succeeded'],
    ['snapshot', 'succeeded'],
    ['insertion', 'succeeded'],
    ['session-update', 'skipped'],
    ['audit', 'skipped'],
  ]);

  let audited;
  const complete = operationStages.finalizeInsertedContext({
    operation: 'Place context',
    providerRead: { state: 'succeeded' },
    artifactWrite: { state: 'succeeded' },
    snapshot: { state: 'succeeded' },
    sessionUpdate: () => ({ id: 'session' }),
    auditAppend: session => { audited = session; },
  });
  assert.deepEqual(audited, { id: 'session' });
  assert.equal(complete.failed, false);
  assert.equal(complete.partial, false);

  let auditAttempted = false;
  const failed = operationStages.finalizeInsertedContext({
    operation: 'Place context',
    providerRead: { state: 'succeeded' },
    sessionUpdate: () => { throw new Error('token=private-value'); },
    auditAppend: session => {
      auditAttempted = true;
      assert.equal(session, undefined);
      throw { code: 'ENOSPC', message: 'disk full' };
    },
  });
  assert.equal(auditAttempted, true);
  assert.equal(failed.failed, true);
  assert.equal(failed.steps.filter(step => step.state === 'failed').length, 2);
  assert.doesNotMatch(failed.display, /private-value/);

  const fromArray = operationStages.buildOperationStageOutcome('   ', [
    { stage: 'provider-read', state: 'succeeded', detail: ' ok\t now ' },
    { stage: 'artifact-write', state: 'failed', detail: '', failure: errorUtils.boundedOperationFailure('unavailable', 'fallback') },
  ]);
  assert.equal(fromArray.operation, 'Operation');
  assert.equal(fromArray.steps.length, 6);
  assert.equal(fromArray.steps[0].detail, 'ok now');
  assert.equal(fromArray.steps[1].failure.kind, 'unavailable');
  assert.equal(fromArray.steps[2].state, 'not-attempted');

  const preparedFailure = operationStages.failedOperationStageOutcome(
    'Prepare context',
    [{ stage: 'provider-read', state: 'succeeded', detail: ' ' }],
    'artifact-write',
    new Error('HTTP 429'),
    'Artifact unavailable.',
  );
  assert.equal(preparedFailure.steps[1].failure.kind, 'rate_limit');
  const wrapped = new operationStages.OperationStageOutcomeError(preparedFailure);
  assert.equal(wrapped.name, 'OperationStageOutcomeError');
  assert.equal(wrapped.message, preparedFailure.display);
  assert.equal(operationStages.isOperationStageOutcomeError(wrapped), true);
  assert.equal(operationStages.isOperationStageOutcomeError(new Error('other')), false);
});

test('bounded failure classification covers HTTP, transport, safety, and local-state conditionals', () => {
  const cases = [
    [new Error('HTTP 401'), 'authentication', false],
    [new Error('HTTP 403'), 'permission', false],
    [new Error('HTTP 404'), 'not_found', false],
    [new Error('HTTP 429'), 'rate_limit', true],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo failed' }, 'dns', true],
    [{ code: 'ETIMEDOUT', message: 'socket timed out' }, 'timeout', true],
    [new Error('self signed certificate TLS failure'), 'tls', false],
    [new Error('redirect outside the configured provider origin'), 'redirect', false],
    [new Error('response exceeds the byte limit'), 'response_limit', false],
    [new Error('invalid JSON response'), 'malformed_response', true],
    [new Error('next page pagination failed'), 'pagination', true],
    [new Error('another Kronos window owns the lease'), 'lease_busy', true],
    [new Error('configuration missing JIRA_TOKEN'), 'configuration', false],
    [{ code: 'EACCES', message: 'unsafe private state path' }, 'local_state', false],
    [{ code: 'ECONNREFUSED', message: 'network unavailable' }, 'network', true],
    [new Error('unknown failure'), 'unavailable', true],
  ];
  for (const [error, kind, retryable] of cases) {
    const result = errorUtils.boundedOperationFailure(error, 'Fallback unavailable.');
    assert.equal(result.kind, kind);
    assert.equal(result.retryable, retryable);
    assert.match(result.display, new RegExp(`\\[${String(kind).replace('_', ' ')}\\]`));
  }
  assert.equal(errorUtils.unknownErrorMessage(' direct ', 'fallback'), ' direct ');
  assert.equal(errorUtils.unknownErrorMessage({ message: ' object ' }, 'fallback'), ' object ');
  assert.equal(errorUtils.unknownErrorMessage({}, 'fallback'), 'fallback');
  assert.equal(errorUtils.unknownErrorCode({ code: ' EFAIL ' }), ' EFAIL ');
  assert.equal(errorUtils.unknownErrorCode({ code: 503 }), '503');
  assert.equal(errorUtils.unknownErrorCode(null), '');
  assert.equal(errorUtils.unknownErrorField({ code: 'x' }, 'code'), 'x');
  assert.equal(errorUtils.unknownErrorField('not-record', 'code'), undefined);
  const fallback = errorUtils.boundedOperationFailure({ message: ' \n\t ' }, '  ');
  assert.equal(fallback.summary, 'Operation unavailable.');
});

test('webview escaping and URL normalization reject non-http authority', () => {
  assert.equal(webviewHtml.escapeHtml(null), '');
  assert.equal(webviewHtml.escapeHtml('<a title="x">&'), '&lt;a title=&quot;x&quot;&gt;&amp;');
  assert.equal(webviewHtml.escapeAttr("'quoted'"), '&#39;quoted&#39;');
  assert.equal(webviewHtml.escapeClass(' safe bad:value '), 'safebadvalue');
  assert.equal(webviewHtml.safeHttpHref(undefined), '');
  assert.equal(webviewHtml.safeHttpHref('not a url'), '');
  assert.equal(webviewHtml.safeHttpHref('file:///tmp/private'), '');
  assert.equal(webviewHtml.safeHttpHref('https://example.test/path?a=1&b=2'), 'https://example.test/path?a=1&amp;b=2');
  assert.equal(webviewHtml.safeHttpHref('http://127.0.0.1:8080/a'), 'http://127.0.0.1:8080/a');
  assert.match(webviewHtml.kronosWebviewBaseCss(), /:focus-visible/);
});

test('provider read signatures normalize precedence, ordering, and failed-state components', () => {
  for (const kind of ['provider_read_failed', 'provider_read_partial', 'provider_read_recovered']) {
    assert.equal(providerReadTransitions.isProviderReadTransitionKind(kind), true);
  }
  for (const value of ['provider_read_unknown', '', null, 1]) {
    assert.equal(providerReadTransitions.isProviderReadTransitionKind(value), false);
  }
  assert.equal(
    providerReadTransitions.providerReadStateSignature(' Partial ', 'monitoring/failed', ' Permission ', ' tests, stages,tests '),
    JSON.stringify({ state: 'partial', reason: 'permission', components: 'stages,tests,tests' }),
  );
  assert.equal(
    providerReadTransitions.providerReadStateSignature('', 'monitoring/Complete', '', 4),
    JSON.stringify({ state: 'complete', reason: 'complete', components: '' }),
  );
  assert.equal(
    providerReadTransitions.providerReadStateSignature(undefined, 'monitoring/failed', undefined, 'tests'),
    JSON.stringify({ state: 'failed', reason: 'unavailable', components: '' }),
  );
  assert.equal(
    providerReadTransitions.providerReadStateSignature(undefined, undefined, undefined, undefined),
    JSON.stringify({ state: 'unknown', reason: 'unavailable', components: '' }),
  );
});

test('webview message normalization covers every bounded command family', () => {
  const allowed = new Set(['open', 'refresh']);
  assert.deepEqual(webviewMessages.normalizeActionPanelMessage({ command: 'open', ticket: ' demo_1-9 ' }, allowed), {
    command: 'open', ticket: 'DEMO_1-9',
  });
  assert.equal(webviewMessages.normalizeActionPanelMessage({ command: 'missing', ticket: 'DEMO-1' }, allowed), null);
  assert.equal(webviewMessages.normalizeActionPanelMessage({ command: 'open', ticket: 'bad' }, allowed), null);
  assert.deepEqual(webviewMessages.normalizeOperationsActionMessage({ command: 'refresh' }, allowed), { command: 'refresh' });
  assert.equal(webviewMessages.normalizeOperationsActionMessage({ command: 4 }, allowed), null);

  for (const command of ['openArtifact', 'addToBasket', 'cancel']) {
    assert.deepEqual(webviewMessages.normalizeContextComposerMessage({ command, focus: 'ignored' }), { command });
  }
  assert.deepEqual(webviewMessages.normalizeContextComposerMessage({ command: 'insertDraft', focus: 'review' }), {
    command: 'insertDraft', focus: 'review',
  });
  assert.equal(webviewMessages.normalizeContextComposerMessage({ command: 'insertDraft', focus: 1 }), null);
  assert.equal(webviewMessages.normalizeContextComposerMessage({ command: 'insertDraft', focus: 'x'.repeat(4_001) }), null);

  assert.deepEqual(webviewMessages.normalizeContextBasketMessage({ command: 'close' }), { command: 'close' });
  for (const command of ['clear', 'insert']) {
    assert.deepEqual(webviewMessages.normalizeContextBasketMessage({ command, focus: 'review' }), { command, focus: 'review' });
    assert.equal(webviewMessages.normalizeContextBasketMessage({ command, focus: 'x'.repeat(4_001) }), null);
  }
  for (const command of ['remove', 'refresh']) {
    assert.deepEqual(webviewMessages.normalizeContextBasketMessage({ command, entryId: 'entry-1', focus: '' }), {
      command, entryId: 'entry-1', focus: '',
    });
  }
  assert.equal(webviewMessages.normalizeContextBasketMessage({ command: 'remove', entryId: '/unsafe', focus: '' }), null);
  assert.equal(webviewMessages.normalizeContextBasketMessage({ command: 'unknown' }), null);

  for (const command of ['openSettings', 'cancel']) {
    assert.deepEqual(webviewMessages.normalizePromptLibraryComposerMessage({ command }), { command });
  }
  assert.deepEqual(webviewMessages.normalizePromptLibraryComposerMessage({ command: 'insertPrompt', body: 'body' }), {
    command: 'insertPrompt', body: 'body',
  });
  assert.equal(webviewMessages.normalizePromptLibraryComposerMessage({ command: 'insertPrompt', body: 3 }), null);
  assert.equal(webviewMessages.normalizePromptLibraryComposerMessage({ command: 'insertPrompt', body: 'x'.repeat(20_001) }), null);

  assert.deepEqual(webviewMessages.normalizeProjectIntegrationMessage({ command: 'cancel' }), { command: 'cancel' });
  const project = {
    name: ' Project\nOne ', nickname: '', gitlabProject: ' group/project ', jenkinsUrl: '',
    sonarProjectKey: '', defaultBranch: '', branchProfiles: ' main | job\r\n dev | job ', activeBranchProfile: '',
  };
  assert.deepEqual(webviewMessages.normalizeProjectIntegrationMessage({ command: 'save', projects: [project] }), {
    command: 'save',
    projects: [{
      name: 'Project One', nickname: '', gitlabProject: 'group/project', jenkinsUrl: '',
      sonarProjectKey: '', defaultBranch: '', branchProfiles: 'main | job\n dev | job', activeBranchProfile: '',
    }],
  });
  assert.equal(webviewMessages.normalizeProjectIntegrationMessage({ command: 'save', projects: 'bad' }), null);
  assert.equal(webviewMessages.normalizeProjectIntegrationMessage({ command: 'save', projects: new Array(101).fill(project) }), null);
  for (const field of Object.keys(project)) {
    const invalid = { ...project, [field]: field === 'name' ? '' : 4 };
    assert.equal(webviewMessages.normalizeProjectIntegrationMessage({ command: 'save', projects: [invalid] }), null, field);
  }
});

test('operator terminal registry preserves exact object identity through replacement and repair paths', () => {
  const registry = createOperatorTerminalRegistry();
  const terminalA = { name: 'same' };
  const terminalB = { name: 'same' };
  const terminalC = { name: 'other' };
  assert.deepEqual(registry.attach(terminalA, { sessionId: ' session-a ', bindingId: ' binding-2 ' }), {
    sessionId: 'session-a', bindingId: 'binding-2',
  });
  registry.attach(terminalB, { sessionId: 'session-a', bindingId: 'binding-1' });
  assert.deepEqual(registry.resolve('session-a'), { kind: 'ambiguous', bindingIds: ['binding-1', 'binding-2'] });
  assert.equal(registry.resolve('session-a', 'missing').kind, 'missing');
  assert.equal(registry.resolve('missing').kind, 'missing');

  registry.attach(terminalC, { sessionId: 'session-a', bindingId: 'binding-1' });
  assert.equal(registry.bindingForTerminal(terminalB), undefined);
  assert.deepEqual(registry.bindingForTerminal(terminalC), { sessionId: 'session-a', bindingId: 'binding-1' });
  registry.attach(terminalA, { sessionId: 'session-b', bindingId: 'binding-3' });
  assert.equal(registry.resolve('session-a', 'binding-2').kind, 'missing');
  assert.equal(registry.resolve('session-a').kind, 'resolved');
  assert.deepEqual(registry.listBindings(), [
    { sessionId: 'session-a', bindingId: 'binding-1' },
    { sessionId: 'session-b', bindingId: 'binding-3' },
  ]);
  assert.deepEqual(registry.listBindings('session-b'), [{ sessionId: 'session-b', bindingId: 'binding-3' }]);
  assert.equal(registry.detachTerminal(terminalB), undefined);
  assert.deepEqual(registry.detachTerminal(terminalC), { sessionId: 'session-a', bindingId: 'binding-1' });
  assert.equal(registry.detachBinding('session-a', 'binding-1'), undefined);
  registry.attach(terminalB, { sessionId: 'session-b', bindingId: 'binding-1' });
  assert.deepEqual(registry.detachSession('session-b'), [
    { sessionId: 'session-b', bindingId: 'binding-1' },
    { sessionId: 'session-b', bindingId: 'binding-3' },
  ]);
  assert.deepEqual(registry.detachSession('session-b'), []);
  registry.attach(terminalA, { sessionId: 'session-c', bindingId: 'binding-1' });
  registry.clear();
  assert.deepEqual(registry.listBindings(), []);
  assert.equal(registry.bindingForTerminal(terminalA), undefined);

  assert.throws(() => registry.resolve(3), /work session id must be a string/);
  assert.throws(() => registry.resolve('bad id'), /work session id is missing or invalid/);
  assert.throws(() => registry.detachBinding('session-a', '/bad'), /terminal binding id is missing or invalid/);
  assert.throws(() => registry.attach({}, { sessionId: '', bindingId: 'binding' }), /work session id is missing or invalid/);
});

test('provider diagnostics cover Jira partial state and every bounded provider failure reason', () => {
  const partialJira = providerDiagnostics.currentProviderReadDiagnostics([], {
    phase: 'partial',
    startedAt: '2026-07-20T10:00:00.000Z',
    warningCount: 2,
    retainedFromPrevious: 1,
  });
  assert.equal(partialJira[0].provider, 'jira');
  assert.match(partialJira[0].detail, /2 warnings.*1 earlier ticket remains/);
  assert.equal(providerDiagnostics.currentProviderReadDiagnostics([], { phase: 'complete', warningCount: 0, retainedFromPrevious: 0 }).length, 0);

  const event = (id, source, readState, readReason, readComponents, at = '2026-07-20T10:00:00.000Z') => ({
    schemaVersion: 1,
    id,
    at,
    sessionId: `session-${id}`,
    type: 'provider.transition',
    source,
    summary: 'safe',
    subject: { kind: source === 'gitlab' ? 'merge-request' : 'provider-read', id: `subject-${id}` },
    metadata: { readState, readReason, readComponents },
  });
  const reasons = ['authentication', 'permission', 'rate_limited', 'not_found', 'safety_limit', 'malformed_response', 'timeout'];
  for (const reason of reasons) {
    const result = providerDiagnostics.currentProviderReadDiagnostics([
      event(`gitlab-${reason}`, 'gitlab', 'failed', reason, 'none'),
    ]);
    assert.equal(result.length, 1, reason);
    assert.equal(result[0].provider, 'gitlab');
    assert.equal(result[0].status, 'fail');
  }
  const prioritized = providerDiagnostics.currentProviderReadDiagnostics([
    event('jenkins-partial', 'jenkins', 'partial', 'unavailable', 'tests, none, stages', '2026-07-20T10:02:00.000Z'),
    event('jenkins-failed', 'jenkins', 'failed', 'timeout', '', '2026-07-20T10:01:00.000Z'),
    event('ignored-type', 'jenkins', 'complete', 'complete', '', '2026-07-20T10:03:00.000Z'),
    { ...event('ignored-source', 'operator', 'failed', 'timeout', ''), type: 'decision.recorded' },
  ]);
  assert.equal(prioritized[0].status, 'fail');
  assert.equal(prioritized[0].problemCount, 2);
  const invalidTime = providerDiagnostics.currentProviderReadDiagnostics([
    event('sonar-partial', 'sonar', 'partial', 'unavailable', '', 'not-a-time'),
  ])[0];
  assert.equal(invalidTime.observedAt, undefined);
  assert.match(invalidTime.detail, /some provider details/);
});

test('Work filter flow owns every query, completion, status, and facet interaction branch', async () => {
  const options = {
    jiraStatuses: ['In Progress'],
    jiraProjects: ['DEMO'],
    localProjects: ['app'],
    labels: ['urgent'],
  };
  const execute = async ({ current = {}, defaultCompletion = 'active', picks = [], inputs = [] }) => {
    const filters = [];
    let clears = 0;
    const menus = [];
    await configureWorkFilterFlow({
      current,
      options,
      defaultCompletion,
      ui: {
        pick: async (items, config) => {
          menus.push({ items, config });
          const wanted = picks.shift();
          if (wanted === undefined) { return undefined; }
          return items.find(item => item.id === wanted || item.value === wanted);
        },
        input: async () => inputs.shift(),
      },
      setFilter: filter => filters.push(filter),
      clearFilter: () => { clears += 1; },
    });
    return { filters, clears, menus };
  };

  assert.equal((await execute({ picks: [] })).filters.length, 0);
  assert.equal((await execute({ picks: ['clear'] })).clears, 1);
  assert.deepEqual((await execute({ current: { query: 'old' }, picks: ['query'], inputs: [undefined] })).filters, []);
  assert.deepEqual((await execute({ current: { query: 'old' }, picks: ['query'], inputs: ['new'] })).filters, [{ query: 'new' }]);
  for (const completion of ['active', 'completed', 'all']) {
    assert.deepEqual(
      (await execute({ current: { jiraStatus: 'In Progress' }, picks: ['completion', completion] })).filters,
      [{ completion }],
    );
  }
  assert.deepEqual((await execute({ picks: ['completion'] })).filters, []);
  assert.deepEqual(
    (await execute({ current: { completion: 'active' }, picks: ['status', 'In Progress'] })).filters,
    [{ completion: 'all', jiraStatus: 'In Progress' }],
  );
  assert.deepEqual(
    (await execute({ current: { jiraStatus: 'In Progress', completion: 'all' }, picks: ['status', ''] })).filters,
    [{ completion: 'active' }],
  );
  assert.deepEqual((await execute({ picks: ['status'] })).filters, []);

  const facetCases = [
    ['label', 'urgent', { label: 'urgent' }],
    ['label', '', {}],
    ['jiraProject', 'DEMO', { jiraProject: 'DEMO' }],
    ['jiraProject', '', {}],
    ['localProject', 'app', { localProject: 'app' }],
    ['localProject', '', {}],
  ];
  for (const [selection, value, expected] of facetCases) {
    const current = selection === 'label' ? { label: 'old' }
      : selection === 'jiraProject' ? { jiraProject: 'OLD' }
        : { localProject: 'old' };
    assert.deepEqual((await execute({ current, picks: [selection, value] })).filters, [expected]);
  }
  assert.deepEqual((await execute({ picks: ['label'] })).filters, []);

  const active = await execute({ picks: [], defaultCompletion: 'active' });
  const completed = await execute({ current: { completion: 'completed' }, picks: [] });
  const all = await execute({ defaultCompletion: 'all', picks: [] });
  const status = await execute({ current: { jiraStatus: 'Review' }, picks: [] });
  assert.equal(active.menus[0].items[1].description, 'Active');
  assert.equal(completed.menus[0].items[1].description, 'Completed');
  assert.equal(all.menus[0].items[1].description, 'All');
  assert.equal(status.menus[0].items[1].description, 'Status: Review');
});

test('runtime settings normalize intervals, bounded values, arrays, and platform path identity', () => {
  assert.equal(runtimeSettings.runtimeIntervalMilliseconds(1, 300), 15_000);
  assert.equal(runtimeSettings.runtimeIntervalMilliseconds(16.9, 300), 16_000);
  assert.equal(runtimeSettings.runtimeIntervalMilliseconds(Number.NaN, 300), 300_000);
  assert.equal(runtimeSettings.runtimeIntervalMilliseconds('30', 300), 300_000);
  assert.equal(runtimeSettings.boundedRuntimeInteger(3.9, 2, 0, 5), 3);
  assert.equal(runtimeSettings.boundedRuntimeInteger(-1, 2, 0, 5), 0);
  assert.equal(runtimeSettings.boundedRuntimeInteger(8, 2, 0, 5), 5);
  assert.equal(runtimeSettings.boundedRuntimeInteger(undefined, 2, 0, 5), 2);
  assert.deepEqual(runtimeSettings.normalizeRuntimeStringArray('not-array', 2, 20), []);
  assert.deepEqual(runtimeSettings.normalizeRuntimeStringArray([
    ' alpha ', 'alpha', 'beta\nvalue', 3, '', 'gamma',
  ], 2, 20), ['alpha', 'beta value']);
  assert.deepEqual(runtimeSettings.normalizeRuntimeStringArray(['abcdef'], 2, 3), ['abc']);
  assert.deepEqual(runtimeSettings.uniqueRuntimePaths([
    ' /Projects/App ', '/Projects/App', '', null, '/Projects/Other\n', '/Projects/Third',
  ], 2, 'linux'), ['/Projects/App', '/Projects/Other']);
  assert.deepEqual(runtimeSettings.uniqueRuntimePaths([
    'C:\\Projects\\App', 'c:\\projects\\app', 'C:\\Projects\\Other',
  ], 5, 'win32'), ['C:\\Projects\\App', 'C:\\Projects\\Other']);
});

test('runtime presentation normalizes command arguments, provider choices, labels, and polling configuration', () => {
  assert.equal(runtimePresentation.normalizeRuntimeTicketKey(' demo_2-17 '), 'DEMO_2-17');
  for (const value of [undefined, '', '2DEMO-1', 'DEMO-0', 'DEMO-no']) {
    assert.equal(runtimePresentation.normalizeRuntimeTicketKey(value), undefined);
  }
  assert.deepEqual(
    ['session', 'ticket', 'project', 'provider', 'artifact', 'event'].map(runtimePresentation.localEvidenceSearchIcon),
    ['terminal', 'issues', 'repo', 'plug', 'file-text', 'history'],
  );
  assert.equal(runtimePresentation.runtimeStringProperty(null, 'name'), undefined);
  assert.equal(runtimePresentation.runtimeStringProperty({ name: 7 }, 'name'), undefined);
  assert.equal(runtimePresentation.runtimeStringProperty({ name: '  ' }, 'name'), undefined);
  assert.equal(runtimePresentation.runtimeStringProperty({ name: ' demo ' }, 'name'), 'demo');
  assert.equal(runtimePresentation.projectTargetStringProperty({ projectName: ' direct ' }, 'projectName'), 'direct');
  assert.equal(runtimePresentation.projectTargetStringProperty({ target: { projectPath: ' /repo ' } }, 'projectPath'), '/repo');
  assert.equal(runtimePresentation.projectTargetStringProperty('invalid', 'projectName'), undefined);

  assert.deepEqual(runtimePresentation.providerOpenChoices(null), []);
  assert.deepEqual(runtimePresentation.providerOpenChoices({ providerChoices: 'invalid' }), []);
  const choices = runtimePresentation.providerOpenChoices({
    providerChoices: [
      null,
      { label: ' Jira\n ', description: ' Ticket ', url: ' https://jira.example/1 ' },
      { label: 'GitLab', description: '', url: 'https://gitlab.example/1' },
      { label: '', url: 'https://invalid.example' },
      { label: 'Missing URL' },
      { label: 'Oversized URL', url: 'x'.repeat(8_193) },
    ],
  });
  assert.deepEqual(choices, [
    { label: 'Jira', description: 'Ticket', url: 'https://jira.example/1' },
    { label: 'GitLab', url: 'https://gitlab.example/1' },
  ]);
  assert.equal(runtimePresentation.providerOpenChoices({
    providerChoices: Array.from({ length: 101 }, (_, index) => ({ label: `P${index}`, url: `https://example/${index}` })),
  }).length, 100);
  assert.equal(runtimePresentation.safeProjectName(7), '');
  assert.equal(runtimePresentation.safeProjectName('  one\n\ttwo  '), 'one two');
  assert.equal(runtimePresentation.safeProjectName('x'.repeat(201)).length, 200);

  assert.equal(runtimePresentation.configuredProjectPollingEnabled({}), false);
  for (const config of [
    { gitlab_project_id: 1 },
    { gitlab_project_path: 'group/app' },
    { jenkins_url: 'https://jenkins.example' },
    { sonar_project_key: 'app' },
    { branch_profiles: [{ name: 'main', jenkins_url: 'https://jenkins.example' }] },
    { branch_profiles: [{ name: 'main', sonar_project_key: 'app' }] },
  ]) {
    assert.equal(runtimePresentation.configuredProjectPollingEnabled(config), true);
  }
  assert.equal(runtimePresentation.configuredProjectPollingEnabled({ branch_profiles: [{ name: 'main' }] }), false);
  assert.equal(runtimePresentation.sonarProjectKeySuggestion(undefined, 'bad key', ' valid:key '), 'valid:key');
  assert.equal(runtimePresentation.sonarProjectKeySuggestion(null, 'bad key'), undefined);
  assert.deepEqual(['local', 'remote', 'cache'].map(runtimePresentation.promptLibrarySourceKindLabel), [
    'Local file', 'Remote', 'Cached copy',
  ]);
  assert.deepEqual(runtimePresentation.contextProviderReadStep(true, 'read'), { state: 'succeeded', detail: 'read' });
  assert.deepEqual(runtimePresentation.contextProviderReadStep(false, 'read'), { state: 'partial', detail: 'read' });
  assert.equal(runtimePresentation.contextSnapshotStep(true).state, 'succeeded');
  assert.match(runtimePresentation.contextSnapshotStep(false).detail, /warnings/);
});

test('runtime composer evidence renders bounded attention, Jira, GitLab, Jenkins, and Sonar details', () => {
  const minimalAttention = runtimePresentation.attentionEventComposerEvidence({
    provider: 'jira',
    severity: 'info',
    event: { at: '2026-07-20T00:00:00.000Z' },
  });
  assert.equal(minimalAttention.length, 1);
  const fullAttention = runtimePresentation.attentionEventComposerEvidence({
    provider: 'gitlab',
    severity: 'critical',
    projectName: 'app',
    ticketKey: 'DEMO-1',
    event: {
      at: '2026-07-20T00:00:00.000Z',
      subject: { kind: 'merge-request', id: '7' },
      before: { state: 'open' },
      metadata: Object.fromEntries(Array.from({ length: 18 }, (_, index) => [`field${index}`, index])),
    },
  });
  assert.deepEqual(fullAttention.map(item => item.label), [
    'Exact retained transition', 'Subject', 'State change', 'Event details',
  ]);
  assert.match(fullAttention[2].detail, /open → not recorded/);
  assert.equal(fullAttention[3].detail.split('\n').length, 16);
  assert.match(runtimePresentation.attentionEventComposerEvidence({
    provider: 'sonar', severity: 'warning', event: { at: 'now', after: { state: 'failed' } },
  })[1].detail, /not recorded → failed/);

  assert.deepEqual(runtimePresentation.jiraComposerEvidence({ comments: [] }), []);
  const jira = runtimePresentation.jiraComposerEvidence({
    status: 'In Progress', priority: 'High', assignee: 'Ari', updated: 'today', description: 'details',
    comments: [
      { body: 'old', author: '', updated: 'yesterday' },
      { body: 'new', author: 'Nia', created: 'today' },
    ],
  });
  assert.deepEqual(jira.map(item => item.label), [
    'Ticket facts', 'Description', 'Nia • today', 'Jira comment • yesterday',
  ]);

  const gitlab = runtimePresentation.gitLabComposerEvidence({
    mergeRequest: {
      state: 'opened', sourceBranch: 'feature', targetBranch: 'main', draft: true, description: 'MR details',
    },
    discussions: [
      { resolved: false, notes: [{ body: 'unresolved', author: { name: 'Nia' }, createdAt: 'today' }] },
      { resolved: true, notes: [{ body: 'resolved', author: { username: 'ari' } }] },
      { notes: [{ body: 'unknown author' }] },
    ],
    notes: [
      { body: 'plain', author: { username: 'sam' }, createdAt: 'today' },
      { body: 'fallback' },
    ],
  });
  assert.match(gitlab[0].detail, /draft/);
  assert.equal(gitlab.some(item => /unresolved/.test(item.label)), true);
  assert.equal(gitlab.some(item => /resolved/.test(item.label)), true);
  assert.equal(gitlab.some(item => item.label === 'GitLab discussion'), true);
  assert.equal(gitlab.some(item => item.label === 'GitLab note'), true);
  assert.equal(runtimePresentation.gitLabComposerEvidence({
    mergeRequest: { state: 'closed', sourceBranch: 'a', targetBranch: 'b', draft: false },
    discussions: [], notes: [],
  })[0].detail.includes('draft'), false);

  assert.deepEqual(runtimePresentation.ciComposerEvidence(undefined, undefined), []);
  const jenkinsWithoutTests = runtimePresentation.ciComposerEvidence({
    build: { number: 1, status: 'SUCCESS' },
    completeness: { testReport: 'unavailable' },
    fetchedAt: 'today',
  }, undefined);
  assert.match(jenkinsWithoutTests[0].detail, /test report unavailable • 0 stages/);
  const ci = runtimePresentation.ciComposerEvidence({
    build: { number: 2, status: 'FAILURE' },
    completeness: { testReport: 'complete' },
    fetchedAt: 'today',
    tests: {
      passCount: 3, failCount: 2, skipCount: 1,
      failedCases: [
        { className: 'Suite', name: 'first', errorDetails: 'details', status: 'FAILED' },
        { name: 'second', errorStackTrace: 'stack', status: 'FAILED' },
        { name: 'third', status: 'FAILED' },
      ],
    },
    stages: [
      { name: 'Build', status: 'SUCCESS' },
      { name: 'Skipped', status: 'NOT_BUILT' },
      { name: 'Test', status: 'FAILED' },
    ],
  }, {
    projectKey: 'app', branch: 'main', fetchedAt: 'today',
    qualityGate: { status: 'ERROR' },
    measures: [
      { metric: 'coverage', value: '95' },
      { metric: 'new_coverage', periodValue: '90' },
      { metric: 'bugs' },
    ],
    issues: [
      { message: 'first', severity: 'BLOCKER', line: 7 },
      { message: 'second', severity: 'MAJOR' },
      { message: 'third', line: 9 },
      { message: 'fourth' },
    ],
  });
  assert.equal(ci.some(item => item.label === 'Failed test • Suite.first'), true);
  assert.equal(ci.some(item => item.label === 'Jenkins stage • Test'), true);
  assert.equal(ci.some(item => item.label === 'SonarQube measures'), true);
  assert.equal(ci.some(item => /BLOCKER • line 7/.test(item.label)), true);

  assert.equal(runtimePresentation.contextComposerPreview(' short '), 'short');
  assert.equal(runtimePresentation.contextComposerPreview('a\u0000b', 10), 'a b');
  assert.equal(runtimePresentation.contextComposerPreview('abcdef', 4), 'abc…');
  assert.equal(runtimePresentation.contextComposerPreview('abcdef', 0), 'a…');
});

test('runtime operations presentation maps setup, doctor, platform, Claude, and polling states', () => {
  const readiness = [
    {
      title: 'Ready', detail: 'done', status: 'pass', action: 'openSettings', actionLabel: 'Open',
      actionWhenReady: false, surfaces: ['setup', 'doctor'],
    },
    {
      title: 'Warning', detail: 'check', status: 'warn', action: 'chooseProjectDiscoveryFolders',
      actionLabel: 'Choose', actionWhenReady: false, surfaces: ['setup', 'doctor'],
    },
    {
      title: 'Doctor only', detail: 'doctor', status: 'fail', action: 'openDoctor', actionLabel: 'Open',
      surfaces: ['doctor'],
    },
  ];
  assert.deepEqual(runtimeOperations.runtimeSetupSteps(readiness), [
    { title: 'Ready', detail: 'done', status: 'pass' },
    { title: 'Warning', detail: 'check', status: 'warn', action: 'chooseProjectDiscoveryFolders', actionLabel: 'Choose' },
  ]);
  assert.deepEqual(runtimeOperations.runtimeDoctorChecks(readiness), [
    { name: 'Ready', detail: 'done', status: 'pass', action: 'openSettings', actionLabel: 'Open' },
    { name: 'Warning', detail: 'check', status: 'warn', action: 'openSetup', actionLabel: 'Open Guided Setup' },
    { name: 'Doctor only', detail: 'doctor', status: 'fail', action: 'openDoctor', actionLabel: 'Open' },
  ]);
  assert.deepEqual(
    ['win32', 'darwin', 'linux', 'freebsd'].map(platform =>
      runtimeOperations.runtimeOperationsGuide(platform, '/state', '/env').platformLabel),
    ['Windows', 'macOS', 'Linux', 'freebsd'],
  );

  const claudeBase = {
    available: true,
    executable: 'claude',
    trusted: true,
    permissionMode: 'manual',
    permissionLabel: 'Manual',
  };
  assert.equal(runtimeOperations.runtimeClaudeReadinessCheck({ ...claudeBase, available: false }).status, 'fail');
  assert.match(runtimeOperations.runtimeClaudeReadinessCheck({ ...claudeBase, available: false }).detail, /extension-host PATH/);
  assert.equal(runtimeOperations.runtimeClaudeReadinessCheck({ ...claudeBase, trusted: false }).status, 'warn');
  assert.match(runtimeOperations.runtimeClaudeReadinessCheck({
    ...claudeBase, permissionMode: 'bypassPermissions', permissionLabel: 'Bypass', branch: 'feature/test',
  }).detail, /modal warning; terminal tabs will show branch feature\/test/);
  assert.match(runtimeOperations.runtimeClaudeReadinessCheck({
    ...claudeBase, permissionMode: 'auto', permissionLabel: 'Auto',
  }).detail, /supported Claude CLI/);
  assert.deepEqual(runtimeOperations.runtimeClaudeReadinessCheck(claudeBase), {
    name: 'Claude settings', status: 'pass',
    detail: 'claude is available; syntax and starting directory are valid; permission mode Manual.',
  });

  assert.deepEqual(runtimeOperations.runtimeProviderPollingSummary([], []), {
    sessions: 0, gitlab: 0, jenkins: 0, sonar: 0,
    detail: 'No project has provider updates configured. Configure a registered project to start automatic checks; no Jira link or terminal Session is required.',
  });
  const single = runtimeOperations.runtimeProviderPollingSummary([
    { config: { gitlab_project_id: 7, jenkins_url: 'https://jenkins', sonar_project_key: 'app' } },
  ], []);
  assert.deepEqual({ sessions: single.sessions, gitlab: single.gitlab, jenkins: single.jenkins, sonar: single.sonar }, {
    sessions: 1, gitlab: 1, jenkins: 1, sonar: 1,
  });
  assert.match(single.detail, /^1 registered project checked automatically/);

  const multiple = runtimeOperations.runtimeProviderPollingSummary([
    { config: { gitlab_project_path: 'group/app', branch_profiles: [
      { name: 'main' },
      { name: 'release', jenkins_url: 'https://jenkins', sonar_project_key: 'app' },
    ] } },
    { config: {} },
  ], [
    { statuses: [
      { provider: 'GitLab', state: 'discovering', detail: '' },
      { provider: 'Jenkins', state: 'active', detail: '' },
      { provider: 'SonarQube', state: 'active', detail: '' },
    ] },
    { statuses: [
      { provider: 'GitLab', state: 'active', detail: '' },
      { provider: 'GitLab', state: 'paused', detail: '' },
      { provider: 'Jenkins', state: 'paused', detail: '' },
      { provider: 'SonarQube', state: 'setup', detail: '' },
    ] },
  ]);
  assert.deepEqual({ sessions: multiple.sessions, gitlab: multiple.gitlab, jenkins: multiple.jenkins, sonar: multiple.sonar }, {
    sessions: 4, gitlab: 3, jenkins: 2, sonar: 2,
  });
  assert.match(multiple.detail, /2 registered projects.*2 ticket-linked Sessions also checked/);
});

test('provider polling presentation covers setup, credential, paused, discovering, and active states', () => {
  const base = {
    polling: false,
    gitlab: { configured: false, credentialsConfigured: false },
    jenkins: { configured: false, credentialsConfigured: false },
    sonar: { configured: false, credentialsConfigured: false },
  };
  assert.deepEqual(providerPollingPresentation.providerPollingViewStatuses(base).map(status => status.state), [
    'setup', 'setup', 'setup',
  ]);
  assert.deepEqual(providerPollingPresentation.providerPollingViewStatuses({
    ...base,
    gitlab: { configured: true, credentialsConfigured: false },
    jenkins: { configured: true, credentialsConfigured: false },
    sonar: { configured: true, credentialsConfigured: false },
  }).map(status => status.detail), [
    'Project linked; check setup for credentials.',
    'Job linked; check setup for credentials.',
    'Add or discover the branch used for SonarQube checks.',
  ]);
  assert.deepEqual(providerPollingPresentation.providerPollingViewStatuses({
    ...base,
    gitlab: { configured: true, credentialsConfigured: true },
    jenkins: { configured: true, credentialsConfigured: true },
    sonar: { configured: true, credentialsConfigured: true, target: { projectKey: 'app', branch: 'main' } },
  }).map(status => status.state), ['paused', 'paused', 'paused']);
  const discovering = providerPollingPresentation.providerPollingViewStatuses({
    polling: true,
    gitlab: { configured: true, credentialsConfigured: true },
    jenkins: { configured: true, credentialsConfigured: true },
    sonar: { configured: true, credentialsConfigured: false, target: { projectKey: 'app', branch: 'main' } },
  });
  assert.deepEqual(discovering.map(status => status.state), ['discovering', 'active', 'setup']);
  const active = providerPollingPresentation.providerPollingViewStatuses({
    polling: true,
    gitlab: { configured: true, credentialsConfigured: true, target: { iid: 17 } },
    jenkins: { configured: true, credentialsConfigured: true },
    sonar: { configured: true, credentialsConfigured: true, target: { projectKey: 'app', branch: 'release' } },
  });
  assert.deepEqual(active.map(status => status.state), ['active', 'active', 'active']);
  assert.match(active[0].detail, /!17/);
  assert.match(active[2].detail, /app on release/);
});

test('provider monitor presentation covers every transition, health, read-state, and count decision', () => {
  const digest = (overrides = {}) => ({
    iid: 17,
    state: 'opened',
    detailedMergeStatus: 'mergeable',
    changesRequested: false,
    approval: { approvedByCount: 2, approvalsLeft: 1 },
    reviewers: { count: 2 },
    unresolvedDiscussions: { count: 2 },
    reviewActivity: { count: 3 },
    updatedAt: '2026-07-20T12:00:00.000Z',
    approvalsComplete: true,
    discussionsComplete: true,
    reviewActivityComplete: true,
    ...overrides,
  });
  const previous = digest({ state: 'opened', reviewers: { count: 1 }, unresolvedDiscussions: { count: 1 }, reviewActivity: { count: 1 } });
  const current = digest();
  const kinds = [
    'merge_request_merged',
    'merge_request_closed',
    'merge_request_reopened',
    'merge_request_state_changed',
    'changes_requested',
    'changes_request_cleared',
    'approval_satisfied',
    'approval_required',
    'approval_state_changed',
    'reviewers_changed',
    'unresolved_discussions_observed',
    'unresolved_discussions_increased',
    'unresolved_discussions_decreased',
    'unresolved_discussions_changed',
    'review_activity_added',
    'review_activity_changed',
  ];
  const summaries = kinds.map(kind => providerPollingPresentation.mergeRequestTransitionSummary(
    'PROJECT', { kind, previous, current },
  ));
  assert.equal(summaries.length, kinds.length);
  assert.ok(summaries.every(summary => summary.startsWith('PROJECT MR !17')));
  assert.match(summaries[kinds.indexOf('merge_request_state_changed')], /opened to opened/);
  assert.match(summaries[kinds.indexOf('review_activity_added')], /2 new review comments/);

  const singular = digest({
    approval: { approvedByCount: 1, approvalsLeft: null },
    reviewers: { count: 1 },
    unresolvedDiscussions: { count: 1 },
    reviewActivity: { count: 1 },
    updatedAt: '',
  });
  assert.match(providerPollingPresentation.mergeRequestTransitionSummary('PROJECT', {
    kind: 'reviewers_changed', previous, current: singular,
  }), /1 reviewer\)/);
  assert.match(providerPollingPresentation.mergeRequestTransitionSummary('PROJECT', {
    kind: 'unresolved_discussions_observed', previous, current: singular,
  }), /1 unresolved discussion on/);
  assert.match(providerPollingPresentation.mergeRequestTransitionSummary('PROJECT', {
    kind: 'review_activity_added', previous: singular, current: singular,
  }), /1 new review comment\./);
  assert.match(providerPollingPresentation.mergeRequestTransitionSummary('PROJECT', {
    kind: 'review_activity_changed', previous, current: singular,
  }), /1 comment\)/);
  assert.equal(providerPollingPresentation.approvalSummary(singular), '1 approval');
  assert.equal(providerPollingPresentation.approvalSummary(current), '2 approvals, 1 remaining');
  assert.equal(providerPollingPresentation.mergeRequestMetadata(singular, 'baseline').mergeRequestUpdatedAt, null);
  assert.equal(providerPollingPresentation.mergeRequestMetadata(current, 'changes_requested').mergeRequestUpdatedAt, current.updatedAt);
  assert.equal(providerPollingPresentation.mergeRequestEventState(digest({ detailedMergeStatus: 'unknown' })), 'opened');
  assert.equal(providerPollingPresentation.mergeRequestEventState(current), 'opened/mergeable');
  assert.equal(providerPollingPresentation.mergeRequestDigestIsTerminal(digest({ state: 'merged' })), true);
  assert.equal(providerPollingPresentation.mergeRequestDigestIsTerminal(digest({ state: 'closed' })), true);
  assert.equal(providerPollingPresentation.mergeRequestDigestIsTerminal(current), false);
  for (const kind of ['merge_request_closed', 'changes_requested', 'approval_required', 'unresolved_discussions_observed', 'unresolved_discussions_increased']) {
    assert.equal(providerPollingPresentation.mergeRequestTransitionIsWarning(kind), true, kind);
  }
  assert.equal(providerPollingPresentation.mergeRequestTransitionIsWarning('reviewers_changed'), false);

  const readStatus = (state, components = [], reason = 'complete') => ({ state, components, reason });
  assert.match(providerPollingPresentation.mergeRequestReadStatusSummary(
    'PROJECT', 17, readStatus('partial'), readStatus('complete'),
  ), /recovered and are complete/);
  assert.match(providerPollingPresentation.mergeRequestReadStatusSummary(
    'PROJECT', 17, null, readStatus('failed', [], 'permission_denied'),
  ), /read failed/);
  assert.match(providerPollingPresentation.mergeRequestReadStatusSummary(
    'PROJECT', 17, null, readStatus('partial'),
  ), /partial \(review data\)/);
  assert.match(providerPollingPresentation.mergeRequestReadStatusSummary(
    'PROJECT', 17, readStatus('partial'), readStatus('partial', ['notes']),
  ), /scope changed \(notes\)/);

  const pipelineDigest = (status, failedJobs = [], failed = 0, error = 0) => ({
    status, failedJobs, tests: { failed, error },
  });
  assert.equal(providerPollingPresentation.gitLabDigestUnhealthy(pipelineDigest('failed')), true);
  assert.equal(providerPollingPresentation.gitLabDigestUnhealthy(pipelineDigest('success', [{}])), true);
  assert.equal(providerPollingPresentation.gitLabDigestUnhealthy(pipelineDigest('success', [], 1)), true);
  assert.equal(providerPollingPresentation.gitLabDigestUnhealthy(pipelineDigest('success')), false);
  assert.equal(providerPollingPresentation.ciDigestState({}), 'observed');
  assert.equal(providerPollingPresentation.ciDigestState({ jenkins: { status: 'SUCCESS' } }), 'SUCCESS');
  assert.equal(providerPollingPresentation.ciDigestState({ sonar: { gateStatus: 'OK' } }), 'OK');
  assert.equal(providerPollingPresentation.ciDigestState({ jenkins: { status: 'FAILURE' }, sonar: { gateStatus: 'ERROR' } }), 'FAILURE / ERROR');
  for (const kind of ['build_failed', 'build_canceled', 'failure_count_increased', 'initial_unhealthy']) {
    assert.equal(providerPollingPresentation.transitionIsFailure(kind), true, kind);
  }
  assert.equal(providerPollingPresentation.transitionIsFailure('recovered'), false);
  assert.equal(providerPollingPresentation.transitionLabel('quality_gate_failed'), 'quality gate failed');

  const complete = {
    pipelinesComplete: true,
    jobsComplete: true,
    testsComplete: true,
    notesComplete: true,
    discussionsComplete: true,
    approvalsComplete: true,
  };
  assert.deepEqual(providerPollingPresentation.gitLabIncompleteMonitorComponents(complete), []);
  assert.deepEqual(providerPollingPresentation.gitLabIncompleteMonitorComponents(Object.fromEntries(
    Object.keys(complete).map(key => [key, false]),
  )), ['pipelines', 'jobs', 'tests', 'notes', 'discussions', 'approvals']);

  const pollResult = overrides => ({
    polled: 0, transitions: 0, failures: 0, skipped: 0, unconfigured: 0, leaseUnavailable: false, ...overrides,
  });
  assert.equal(providerPollingPresentation.managedProviderPollNotice(pollResult({ leaseUnavailable: true })).kind, 'lease-unavailable');
  const singularNotice = providerPollingPresentation.managedProviderPollNotice(pollResult({ polled: 1, transitions: 1, failures: 1, unconfigured: 1 }));
  assert.equal(singularNotice.kind, 'missing-configuration');
  assert.match(singularNotice.message, /1 provider source: 1 new Attention item, 1 problem.*1 project need setup/);
  assert.equal(providerPollingPresentation.managedProviderPollNotice(pollResult({ failures: 1 })).kind, 'failed');
  assert.equal(providerPollingPresentation.managedProviderPollNotice(pollResult({ polled: 2, leaseUnavailable: true })).kind, 'failed');
  assert.equal(providerPollingPresentation.managedProviderPollNotice(pollResult({ polled: 2 })).kind, 'complete');
});

test('runtime resolution flows handle direct, nested, picker, empty, stale, and failed lookup branches', async () => {
  const tickets = {
    'DEMO-1': { summary: 'One', jira_status: 'Open', jira_project_key: 'DEMO', linked_local_project: 'app' },
    'DEMO-2': { summary: 'Two', jira_status: 'Review' },
  };
  const warnings = [];
  const ticketInput = (overrides = {}) => ({
    argument: undefined,
    allowPick: true,
    tickets,
    pick: async items => items[1],
    warn: message => warnings.push(message),
    ...overrides,
  });
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({ argument: ' demo-1 ' })), 'DEMO-1');
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({ argument: { ticket: 'demo-1' } })), 'DEMO-1');
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({
    argument: 'MISSING-1', allowPick: false,
  })), undefined);
  let seenTicketChoices;
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({
    pick: async items => { seenTicketChoices = items; return items[1]; },
  })), 'DEMO-2');
  assert.match(seenTicketChoices[0].detail, /Jira DEMO • local app/);
  assert.match(seenTicketChoices[1].detail, /Jira unknown • local unlinked/);
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({ pick: async () => undefined })), undefined);
  assert.equal(await runtimeResolutions.resolveRuntimeTicketKey(ticketInput({ tickets: {} })), undefined);
  assert.match(warnings.at(-1), /No Jira work is loaded/);

  const standalone = {
    id: 'standalone', kind: 'standalone', title: 'Standalone', status: 'active',
    monitoring: { enabled: false }, ticketKeys: [],
  };
  const monitored = {
    id: 'ticket-on', kind: 'ticket', title: 'Ticket On', status: 'active', ticketKey: 'DEMO-1',
    monitoring: { enabled: true }, ticketKeys: ['DEMO-1'],
  };
  const paused = {
    id: 'ticket-off', kind: 'ticket', title: 'Ticket Off', status: 'closed', ticketKey: 'DEMO-2',
    monitoring: { enabled: false }, ticketKeys: ['DEMO-2'],
  };
  const failures = [];
  let seenSessionChoices;
  const sessionInput = (overrides = {}) => ({
    argument: undefined,
    allowPick: true,
    readSession: id => id === monitored.id ? monitored : null,
    sessionForTicket: key => key === 'DEMO-2' ? paused : null,
    listSessions: () => [monitored, paused, standalone],
    sessionLabel: session => `Session ${session.id}`,
    pick: async items => { seenSessionChoices = items; return items[2]; },
    logFailure: error => failures.push(error),
    ...overrides,
  });
  assert.equal((await runtimeResolutions.resolveRuntimeWorkSession(sessionInput({ argument: monitored.id }))).id, monitored.id);
  assert.equal((await runtimeResolutions.resolveRuntimeWorkSession(sessionInput({
    argument: { ticketKey: 'demo-2' },
  }))).id, paused.id);
  const lookupError = new Error('lookup failed');
  assert.equal((await runtimeResolutions.resolveRuntimeWorkSession(sessionInput({
    argument: { sessionId: 'broken' },
    readSession: () => { throw lookupError; },
  }))).id, standalone.id);
  assert.equal(failures.at(-1), lookupError);
  assert.deepEqual(seenSessionChoices.map(item => item.description), [
    'active • monitoring on', 'closed • monitoring off', 'active • standalone',
  ]);
  assert.equal(await runtimeResolutions.resolveRuntimeWorkSession(sessionInput({
    argument: 'missing', allowPick: false,
  })), undefined);
  assert.equal(await runtimeResolutions.resolveRuntimeWorkSession(sessionInput({
    argument: 'missing', pick: async () => undefined,
  })), undefined);

  const projects = [
    { name: 'app', displayName: 'App', path: '/projects/app', available: true },
    { name: 'api', displayName: 'API', path: '/projects/api', available: true },
  ];
  const projectWarnings = [];
  assert.deepEqual(runtimeResolutions.resolveRuntimeRegisteredProject(
    { projectName: 'app' }, projects, message => projectWarnings.push(message),
  ), { projectName: 'app', projectPath: '/projects/app', displayName: 'App' });
  assert.equal(runtimeResolutions.resolveRuntimeRegisteredProject(
    { target: { projectPath: '/projects/api' } }, projects, message => projectWarnings.push(message),
  ).projectName, 'api');
  assert.equal(runtimeResolutions.resolveRuntimeRegisteredProject(
    { projectName: 'missing' }, projects, message => projectWarnings.push(message),
  ), undefined);
  assert.match(projectWarnings.at(-1), /stale or no longer registered/);

  const refreshCalls = [];
  const refreshInput = item => ({
    item: { label: 'Saved evidence', refresh: item },
    projects,
    insertJira: async ticketKey => refreshCalls.push(['jira', ticketKey]),
    insertGitLab: async target => refreshCalls.push(['gitlab', target]),
    insertCi: async target => refreshCalls.push(['ci', target]),
    insertGit: async target => refreshCalls.push(['git', target]),
    warn: message => refreshCalls.push(['warn', message]),
  });
  for (const target of [
    { kind: 'jira', ticketKey: 'DEMO-1' },
    { kind: 'gitlab', ticketKey: 'DEMO-1' },
    { kind: 'ci', ticketKey: 'DEMO-1' },
    { kind: 'gitlab', projectName: 'app' },
    { kind: 'ci', projectName: 'api' },
    { kind: 'git', projectName: 'app' },
    { kind: 'git', projectName: 'missing' },
    { kind: 'jira' },
  ]) {
    await runtimeResolutions.refreshRuntimeContextBasketItem(refreshInput(target));
  }
  assert.deepEqual(refreshCalls.slice(0, 6).map(call => call[0]), ['jira', 'gitlab', 'ci', 'gitlab', 'ci', 'git']);
  assert.deepEqual(refreshCalls[3][1], { projectName: 'app', projectPath: '/projects/app' });
  assert.deepEqual(refreshCalls.slice(6).map(call => call[0]), ['warn', 'warn']);

  const routeCalls = [];
  const routeInput = action => ({
    entry: { action },
    ticketLoaded: ticketKey => ticketKey === 'DEMO-1',
    focusSession: async id => routeCalls.push(['session', id]),
    openTicket: async key => routeCalls.push(['ticket', key]),
    openAudit: async id => routeCalls.push(['audit', id]),
    openProject: async target => routeCalls.push(['project', target]),
    openArtifact: async promptPath => {
      routeCalls.push(['artifact', promptPath]);
      if (promptPath === '/missing') throw new Error('missing artifact');
    },
    openProvider: async url => routeCalls.push(['provider', url]),
    artifactUnavailable: error => routeCalls.push(['unavailable', error.message]),
  });
  for (const action of [
    { kind: 'session', sessionId: 'one' },
    { kind: 'ticket', ticketKey: 'DEMO-1', sessionId: 'one' },
    { kind: 'ticket', ticketKey: 'DEMO-2', sessionId: 'two' },
    { kind: 'project', projectName: 'app', projectPath: '/projects/app' },
    { kind: 'artifact', sessionId: 'one', promptPath: '/present' },
    { kind: 'artifact', sessionId: 'one', promptPath: '/missing' },
    { kind: 'provider', sessionId: 'one', url: 'https://provider.example' },
    { kind: 'provider', sessionId: 'one' },
    { kind: 'event', sessionId: 'two' },
  ]) {
    await runtimeResolutions.openRuntimeLocalEvidenceResult(routeInput(action));
  }
  assert.deepEqual(routeCalls.map(call => call[0]), [
    'session', 'ticket', 'audit', 'project', 'artifact', 'artifact', 'unavailable', 'provider', 'audit', 'audit',
  ]);
});

test('runtime GitLab resolution flows cover known, discovered, ambiguous, failed, and rebound targets', async () => {
  const warnings = [];
  const logs = [];
  const bindings = [];
  const refreshes = [];
  const base = (overrides = {}) => ({
    ownerLabel: 'DEMO-1',
    configuredProject: 'group/app',
    knownTarget: undefined,
    sourceBranch: 'feature/DEMO-1',
    sessionActive: false,
    discover: async () => ({ candidateCount: 0, ambiguous: false }),
    bind: target => bindings.push(target),
    refresh: () => refreshes.push(true),
    warn: message => warnings.push(message),
    log: error => logs.push(error),
    ...overrides,
  });
  const known = { iid: 1, projectIdOrPath: 'group/app', url: 'https://gitlab.example/mr/1' };
  assert.equal((await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({ knownTarget: known }))).iid, 1);
  assert.equal(await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({ configuredProject: undefined })), undefined);
  assert.match(warnings.at(-1), /needs a GitLab project ID/i);
  assert.equal(await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({
    discover: async () => { throw new Error('discovery failed'); },
  })), undefined);
  assert.equal(logs.at(-1).message, 'discovery failed');
  assert.equal(await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({
    discover: async () => ({ candidateCount: 3, ambiguous: true }),
  })), undefined);
  assert.match(warnings.at(-1), /3 possible open merge requests/i);
  assert.equal(await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({
    sourceBranch: undefined,
  })), undefined);
  assert.doesNotMatch(warnings.at(-1), /or branch/);
  const inactive = await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({
    sourceBranch: undefined,
    discover: async request => {
      assert.equal('sourceBranch' in request, false);
      return { match: { iid: 2 }, candidateCount: 1, ambiguous: false };
    },
  }));
  assert.deepEqual(inactive, { iid: 2, projectIdOrPath: 'group/app' });
  const active = await runtimeResolutions.resolveRuntimeGitLabInsertionTarget(base({
    sessionActive: true,
    discover: async request => {
      assert.equal(request.sourceBranch, 'feature/DEMO-1');
      return { match: { iid: 3, webUrl: 'https://gitlab.example/mr/3' }, candidateCount: 1, ambiguous: false };
    },
  }));
  assert.equal(active.url, 'https://gitlab.example/mr/3');
  assert.equal(bindings.at(-1).iid, 3);
  assert.equal(refreshes.length, 1);

  const presented = [];
  const present = discovery => runtimeResolutions.presentRuntimeProjectGitLabInsertionTarget({
    projectLabel: 'Application API',
    projectName: 'app',
    discovery,
    warn: message => presented.push(['warn', message]),
    log: detail => presented.push(['log', detail]),
  });
  assert.equal(present({ kind: 'matched', target: known }), known);
  assert.equal(present({ kind: 'unconfigured' }), undefined);
  assert.equal(present({ kind: 'failed', detail: 'provider failed' }), undefined);
  assert.deepEqual(presented.slice(-2).map(item => item[0]), ['log', 'warn']);
  assert.equal(present({ kind: 'ambiguous', candidateCount: 2 }), undefined);
  assert.match(presented.at(-1)[1], /the current project/);
  assert.equal(present({ kind: 'ambiguous', candidateCount: 2, sourceBranch: 'feature' }), undefined);
  assert.match(presented.at(-1)[1], /for feature/);
  assert.equal(present({ kind: 'not-found' }), undefined);
  assert.match(presented.at(-1)[1], /Application API/);
  assert.equal(present({ kind: 'not-found', sourceBranch: 'feature' }), undefined);
  assert.match(presented.at(-1)[1], /branch feature/);

  const discoveredBindings = [];
  let discoveredRefreshes = 0;
  const discoverBase = (overrides = {}) => ({
    configuredProject: 'group/app',
    sourceBranch: 'feature',
    discover: async () => ({ candidateCount: 0, ambiguous: false }),
    failureDetail: error => `bounded: ${error.message}`,
    prepareOwner: () => ({ knownTarget: undefined, bind: target => discoveredBindings.push(target) }),
    refresh: () => { discoveredRefreshes += 1; },
    ...overrides,
  });
  assert.deepEqual(await runtimeResolutions.discoverRuntimeRegisteredProjectGitLabTarget(discoverBase({
    configuredProject: undefined,
  })), { kind: 'unconfigured' });
  assert.deepEqual(await runtimeResolutions.discoverRuntimeRegisteredProjectGitLabTarget(discoverBase({
    sourceBranch: undefined,
    discover: async request => {
      assert.equal('sourceBranch' in request, false);
      throw new Error('offline');
    },
  })), { kind: 'failed', detail: 'bounded: offline' });
  assert.deepEqual(await runtimeResolutions.discoverRuntimeRegisteredProjectGitLabTarget(discoverBase({
    discover: async () => { throw new Error('offline'); },
  })), { kind: 'failed', detail: 'bounded: offline', sourceBranch: 'feature' });
  for (const [sourceBranch, ambiguous, expected] of [
    [undefined, true, { kind: 'ambiguous', candidateCount: 2 }],
    ['feature', true, { kind: 'ambiguous', candidateCount: 2, sourceBranch: 'feature' }],
    [undefined, false, { kind: 'not-found' }],
    ['feature', false, { kind: 'not-found', sourceBranch: 'feature' }],
  ]) {
    assert.deepEqual(await runtimeResolutions.discoverRuntimeRegisteredProjectGitLabTarget(discoverBase({
      sourceBranch,
      discover: async () => ({ candidateCount: 2, ambiguous }),
    })), expected);
  }

  const matched = async (knownTarget, match = { iid: 4, webUrl: 'https://gitlab.example/mr/4' }) => (
    runtimeResolutions.discoverRuntimeRegisteredProjectGitLabTarget(discoverBase({
      discover: async () => ({ match, candidateCount: 1, ambiguous: false }),
      prepareOwner: () => ({ knownTarget, bind: target => discoveredBindings.push(target) }),
    }))
  );
  for (const previous of [
    undefined,
    { iid: 3, projectIdOrPath: 'group/app', url: 'https://gitlab.example/mr/4' },
    { iid: 4, projectIdOrPath: 'other', url: 'https://gitlab.example/mr/4' },
    { iid: 4, projectIdOrPath: 'group/app', url: 'old' },
  ]) assert.equal((await matched(previous)).kind, 'matched');
  const bindingCount = discoveredBindings.length;
  assert.equal((await matched({ iid: 4, projectIdOrPath: 'group/app', url: 'https://gitlab.example/mr/4' })).kind, 'matched');
  assert.equal(discoveredBindings.length, bindingCount, 'an identical target is not rebound');
  assert.deepEqual(await matched({ iid: 5, projectIdOrPath: 'group/app' }, { iid: 5 }), {
    kind: 'matched', target: { iid: 5, projectIdOrPath: 'group/app' }, sourceBranch: 'feature',
  });
  assert.ok(discoveredRefreshes >= 4);
});

test('project command presentation plans discovery, removal, integration forms, and ticket choices', () => {
  const registered = [
    { name: 'app', displayName: 'App', path: '/projects/app', branch: 'main', available: true },
    { name: 'missing-branch', displayName: 'Missing Branch', path: '/projects/missing-branch', available: true },
    { name: 'missing-folder', displayName: 'Missing Folder', path: '/projects/missing-folder', available: false },
  ];
  const discovered = [
    { name: 'discovered-app', path: '/projects/app', branch: 'main', source: 'workspace' },
    { name: 'new-workspace', path: '/projects/new-workspace', branch: 'feature/new', source: 'workspace' },
    { name: 'new-root', path: '/projects/new-root', source: 'configured-root' },
  ];
  const management = projectCommandPresentation.buildProjectManagementChoices(discovered, registered);
  assert.deepEqual(management.choices.map(choice => [choice.label, choice.registered, choice.project.name]), [
    ['App', true, 'app'],
    ['Missing Branch', true, 'missing-branch'],
    ['Missing Folder', true, 'missing-folder'],
    ['new-workspace', false, 'new-workspace'],
    ['new-root', false, 'new-root'],
  ]);
  assert.match(management.choices[0].description, /Registered • main/);
  assert.match(management.choices[1].description, /Branch unavailable/);
  assert.match(management.choices[2].description, /Folder unavailable/);
  assert.match(management.choices[3].description, /Open workspace/);
  assert.match(management.choices[4].description, /Branch unavailable • Project folder/);
  assert.equal(management.registeredPathKeys.has('/projects/app'), true);

  const tickets = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`DEMO-${index + 1}`, {
    linked_local_project: index < 6 ? 'missing-branch' : 'other',
  }]));
  const removal = projectCommandPresentation.planProjectRemoval(
    management.choices.filter(choice => choice.project.name === 'app'), registered, tickets,
  );
  assert.deepEqual(removal.removedProjects.map(project => project.name), ['missing-branch', 'missing-folder']);
  assert.equal(removal.linkedTicketKeys.length, 6);
  assert.match(projectCommandPresentation.projectUnregisterWarning(
    removal.removedProjects, removal.linkedTicketKeys,
  ), /6 tickets.*DEMO-1.*DEMO-5, …/);
  assert.match(projectCommandPresentation.projectUnregisterWarning([registered[0]], ['DEMO-1']), /1 ticket \(DEMO-1\)/);
  assert.equal(projectCommandPresentation.projectRegistrationResultMessage({
    registrations: 1, removed: 0, linkedTickets: 0, truncated: false,
  }), '1 local project is registered; 0 unregistered.');
  assert.equal(projectCommandPresentation.projectRegistrationResultMessage({
    registrations: 2, removed: 1, linkedTickets: 2, truncated: true,
  }), '2 local projects are registered; 1 unregistered and unlinked from 2 tickets from the current results.');
  assert.match(projectCommandPresentation.projectRegistrationResultMessage({
    registrations: 0, removed: 1, linkedTickets: 1, truncated: false,
  }), /unlinked from 1 ticket\./);

  const state = {
    schemaVersion: 2, refreshedAt: null, tickets: {},
    projects: {
      app: {
        path: '/projects/app', display_name: 'Application',
        config: {
          gitlab_project_id: 7,
          jenkins_url: 'https://jenkins/job/app',
          sonar_project_key: 'app:key',
          default_branch: 'main',
          branch_profiles: [{ branch: 'release', jenkins_url: 'https://jenkins/job/app/release' }],
          active_branch_profile: 'release',
        },
      },
      api: {
        path: '/projects/api', display_name: 'api',
        config: { gitlab_project_path: 'group/api', repo_name: 'api:key', base_branch: 'trunk' },
      },
      plain: { path: '/projects/plain', config: { repo_name: 'bad key' } },
    },
  };
  const forms = projectCommandPresentation.buildProjectIntegrationFormProjects([
    { name: 'app', displayName: 'Application', path: '/projects/app', branch: 'main', available: true },
    { name: 'api', displayName: 'API', path: '/projects/api', available: true },
    { name: 'plain', displayName: 'Plain', path: '/projects/plain', available: true },
  ], state);
  assert.deepEqual(forms[0], {
    name: 'app', displayName: 'Application', nickname: 'Application', path: '/projects/app', branch: 'main',
    gitlabProject: '7', jenkinsUrl: 'https://jenkins/job/app', sonarProjectKey: 'app:key', defaultBranch: 'main',
    branchProfiles: 'release | https://jenkins/job/app/release |  | ', activeBranchProfile: 'release',
  });
  assert.equal(forms[1].nickname, undefined);
  assert.equal(forms[1].gitlabProject, 'group/api');
  assert.equal(forms[1].sonarProjectKey, 'api:key');
  assert.equal(forms[1].defaultBranch, 'trunk');
  assert.equal(forms[2].sonarProjectKey, 'plain');
  assert.deepEqual(projectCommandPresentation.buildProjectIntegrationFormProjects([], null), []);

  const ticketChoices = projectCommandPresentation.buildTicketProjectChoices([
    registered[2], registered[0], registered[1],
  ], registered[1]);
  assert.match(ticketChoices[0].label, /^Missing Branch \$\(check\)/);
  assert.equal(ticketChoices[1].unlink, true);
  assert.equal(ticketChoices[2].label, 'App');
  assert.equal(projectCommandPresentation.buildTicketProjectChoices([registered[2]], undefined)[0].description, 'folder unavailable');
  assert.equal(
    projectCommandPresentation.buildTicketProjectChoices([registered[0]], registered[1])[0].label,
    'App',
    'a stale current project must not add an unlink action or reorder an unrelated choice',
  );
  assert.deepEqual(projectCommandPresentation.buildTicketProjectChoices([], registered[0]), []);
});

test('session lifecycle and inventory projections cover every management, terminal, and monitoring state', () => {
  const attached = sessionFixture({
    kind: 'ticket', ticketKey: 'SAFE-1', ticketKeys: ['SAFE-1'], projectName: 'app', projectPath: '/projects/app',
    terminals: [{ id: 'terminal-1', name: 'Terminal', status: 'attached', attachedAt: '2026-07-20T10:00:00.000Z' }],
    providerBindings: [
      { id: 'gitlab', provider: 'gitlab', resource: 'merge-request', subjectId: '7', attachedAt: '2026-07-20T10:00:00.000Z', url: 'https://gitlab.example/mr/7' },
      { id: 'jenkins', provider: 'jenkins', resource: 'build', subjectId: 'latest', projectId: 'app', attachedAt: '2026-07-20T10:01:00.000Z', url: 'https://jenkins.example/job/app/7' },
    ],
    artifacts: [{ complete: true }, { complete: false }],
    monitoring: {
      enabled: true, lastAttemptAt: '2026-07-20T10:30:00.000Z', lastSuccessfulAt: '2026-07-20T10:20:00.000Z',
      lastMeaningfulChangeAt: '2026-07-20T10:10:00.000Z', lastSummary: 'One source checked.',
      lastFailureCount: 1, lastSkippedCount: 2, currentError: 'provider_read_failed',
    },
  });
  assert.deepEqual(workSessionLifecycle.workSessionLifecycle(attached, 1), {
    management: 'active', terminal: 'attached', monitoring: 'running',
    canInsertContext: true, canPollProviders: true, canReconnect: false,
  });
  assert.match(sessionInventory.sessionInventoryPresentation(attached, 1, 300_000, 'feature/SAFE-1', ' Application\nAPI ').tooltip, /Project: Application API/);
  assert.match(sessionInventory.sessionInventoryPresentation(attached, 2, 300_000).description, /2 terminals connected/);
  const detached = sessionFixture({
    ticketKeys: ['SAFE-1'],
    terminals: [
      { id: 'a', name: 'A', status: 'attached', attachedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'b', name: 'B', status: 'detached', attachedAt: '2026-07-20T10:00:00.000Z', detachedAt: '2026-07-20T11:00:00.000Z' },
    ],
    monitoring: { enabled: false },
  });
  assert.equal(workSessionLifecycle.workSessionLifecycle(detached, 0).terminal, 'detached');
  assert.match(sessionInventory.sessionInventoryPresentation(detached, 0, 300_000).description, /Reconnect needed.*Checks paused/);
  const closedTerminal = sessionFixture({
    terminals: [{ id: 'z', name: 'Z', status: 'closed', attachedAt: '2026-07-20T10:00:00.000Z' }],
  });
  assert.equal(workSessionLifecycle.workSessionLifecycle(closedTerminal, 0).terminal, 'closed');
  assert.equal(workSessionLifecycle.workSessionLifecycle(sessionFixture(), 0).terminal, 'none');
  assert.equal(workSessionLifecycle.workSessionLifecycle(sessionFixture(), 0).monitoring, 'ineligible');
  const stopped = sessionFixture({ status: 'closed', closedAt: '2026-07-20T12:00:00.000Z' });
  assert.equal(workSessionLifecycle.workSessionLifecycle(stopped, 3).terminal, 'none');
  assert.equal(workSessionLifecycle.workSessionLifecycle(stopped, 3).monitoring, 'stopped');
  assert.equal(sessionInventory.sessionInventoryPresentation(stopped, 0, 300_000).description, 'Tracking stopped');
  assert.equal(sessionInventory.sessionInventoryLabel(attached, 'Application'), 'Application: Fixture session');
  assert.equal(sessionInventory.sessionInventoryLabel(sessionFixture({ kind: 'ticket', ticketKey: 'SAFE-2' })), 'SAFE-2: Fixture session');
  assert.equal(sessionInventory.sessionInventorySortOrder(attached, stopped), -1);
  assert.equal(sessionInventory.sessionInventorySortOrder(stopped, attached), 1);
  assert.equal(sessionInventory.sessionInventorySortOrder(
    sessionFixture({ id: 'b', title: 'B', updatedAt: 'same' }),
    sessionFixture({ id: 'a', title: 'A', updatedAt: 'same' }),
  ) > 0, true);

  const sameLabelLeft = sessionFixture({ id: 'b', title: 'Same', updatedAt: 'same' });
  const sameLabelRight = sessionFixture({ id: 'a', title: 'Same', updatedAt: 'same' });
  assert.ok(sessionInventory.sessionInventorySortOrder(sameLabelLeft, sameLabelRight) > 0);
  const standaloneMetadata = sessionFixture({
    kind: 'standalone', ticketKey: undefined, ticketKeys: [], projectName: undefined,
    projectPath: '/projects/standalone',
    providerBindings: [
      { id: 'unknown-empty', provider: 'custom', resource: '', subjectId: '', attachedAt: '2026-07-20T10:00:00.000Z' },
      { id: 'known-mr', provider: 'gitlab', resource: 'merge-request', subjectId: '19', attachedAt: '2026-07-20T10:01:00.000Z' },
    ],
  });
  const standaloneTooltip = sessionInventory.sessionInventoryPresentation(
    standaloneMetadata, 0, 300_000, 'feature/standalone', 17,
  ).tooltip;
  assert.match(standaloneTooltip, /Folder: \/projects\/standalone/);
  assert.match(standaloneTooltip, /Branch: feature\/standalone/);
  assert.match(standaloneTooltip, /custom Unknown/);
  assert.match(standaloneTooltip, /GitLab Merge request !19/);
});

test('attention presentation matrices cover provider, severity, action, grouping, and retained target choices', () => {
  assert.equal(attentionPresentation.attentionProjectGroupIdentity(undefined).label, 'Unassigned project');
  assert.equal(attentionPresentation.attentionProjectGroupIdentity(' Project\nOne ').label, 'Project One');
  const grouped = attentionPresentation.groupAttentionEntriesByProject([
    { id: 1, session: { projectName: 'One' } }, { id: 2, session: { projectName: 'One' } }, { id: 3 },
  ]);
  assert.deepEqual(grouped.map(group => group.entries.length), [2, 1]);
  for (const providerUrl of [undefined, 'https://provider.example']) {
    const prefix = providerUrl ? 'attention_provider' : 'attention_repair';
    assert.equal(attentionPresentation.attentionActionContext('gitlab', undefined, providerUrl), prefix);
    assert.equal(attentionPresentation.attentionActionContext('jira', 'SAFE-1', providerUrl), `${prefix}_ticket`);
    assert.equal(attentionPresentation.attentionActionContext('gitlab', 'SAFE-1', providerUrl), `${prefix}_ticket_gitlab`);
    assert.equal(attentionPresentation.attentionActionContext('jenkins', 'SAFE-1', providerUrl), `${prefix}_ticket_ci`);
    assert.equal(attentionPresentation.attentionActionContext('sonar', undefined, providerUrl, 'App'), `${prefix}_project_ci`);
    assert.equal(attentionPresentation.attentionActionContext('gitlab', undefined, providerUrl, 'App'), `${prefix}_project_gitlab`);
    assert.equal(attentionPresentation.attentionActionContext('gitlab', 'SAFE-1', providerUrl, 'App'), `${prefix}_project_ticket_gitlab`);
    assert.equal(attentionPresentation.attentionActionContext('sonar', 'SAFE-1', providerUrl, 'App'), `${prefix}_project_ticket_ci`);
  }
  for (const [transitionKind, expected] of [
    ['partial', 'partial'], ['blocked', 'blocked'], ['failed', 'failure'],
    ['provider_read_recovered', 'recovery'], ['changes_requested', 'warning'], ['', 'information'],
  ]) assert.equal(attentionPresentation.attentionSeverity(eventFixture({ metadata: { transitionKind } })), expected);
  assert.deepEqual(['gitlab', 'jenkins', 'sonar', 'jira'].map(attentionPresentation.attentionProviderIconId), [
    'git-pull-request', 'server-process', 'shield', undefined,
  ]);
  assert.deepEqual(['information', 'recovery', 'warning', 'partial', 'failure', 'blocked'].map(attentionPresentation.attentionSeverityColorId), [
    'charts.green', 'charts.green', 'charts.yellow', 'charts.yellow', 'charts.red', 'charts.red',
  ]);
  assert.deepEqual(['gitlab', 'jira', 'jenkins', 'sonar', 'kronos', 'operator'].map(attentionPresentation.attentionProviderLabel), [
    'GitLab', 'Jira', 'Jenkins', 'SonarQube', 'Kronos', 'Operator',
  ]);
  const ticketSession = sessionFixture({ kind: 'ticket', ticketKey: 'SAFE-1', ticketKeys: ['SAFE-1'] });
  assert.equal(attentionPresentation.attentionTicketKey(eventFixture(), ticketSession), 'SAFE-1');
  assert.equal(attentionPresentation.attentionTicketKey(eventFixture({ subject: { kind: 'merge-request', id: '7', ticketKey: 'OTHER-1' } }), ticketSession), undefined);
  assert.equal(attentionPresentation.attentionTicketKey(eventFixture(), undefined), undefined);
  assert.equal(attentionPresentation.attentionEventCanUsePromptContext(eventFixture()), true);
  assert.equal(attentionPresentation.attentionEventCanUsePromptContext(eventFixture({ source: 'gitlab', subject: { kind: 'pipeline', id: '7' } })), false);
  assert.equal(attentionPresentation.attentionEventCanUsePromptContext(eventFixture({ source: 'jenkins' })), true);
  assert.equal(attentionPresentation.attentionEventCanUsePromptContext(eventFixture({ type: 'provider.baseline' })), false);
  const sonarSession = sessionFixture({ providerBindings: [
    { id: 'old', provider: 'sonar', resource: 'quality-gate', subjectId: 'app:main', projectId: 'app', attachedAt: '2026-07-20T10:00:00.000Z', url: 'https://sonar.example/dashboard?id=app&branch=main' },
    { id: 'duplicate', provider: 'sonar', resource: 'quality-gate', subjectId: 'app:main', projectId: 'app', attachedAt: '2026-07-20T11:00:00.000Z', url: 'https://sonar.example/dashboard?id=app&branch=main' },
    { id: 'branch', provider: 'sonar', resource: 'quality-gate', subjectId: 'app:dev', attachedAt: '2026-07-20T12:00:00.000Z', url: 'https://sonar.example/dashboard?id=app&branch=dev' },
    { id: 'unsafe', provider: 'sonar', resource: 'quality-gate', subjectId: 'unsafe', attachedAt: '2026-07-20T13:00:00.000Z', url: 'file:///tmp/private' },
  ] });
  assert.deepEqual(attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'sonar' }), sonarSession).map(choice => choice.label), ['dev', 'main']);
  assert.deepEqual(attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'jira' }), sonarSession), []);
});

test('attention headlines cover incomplete reads, count fallbacks, initial health, subjects, and retained URL ties', () => {
  const headline = (source, transitionKind, overrides = {}) => {
    const { metadata = {}, ...rest } = overrides;
    return attentionPresentation.attentionEventHeadline(eventFixture({
      source,
      ...rest,
      metadata: { transitionKind, ...metadata },
    }));
  };
  assert.match(headline('gitlab', 'provider_read_failed', {
    subject: { kind: 'merge-request', id: '7' }, metadata: { readReason: 'unknown_reason' },
  }), /unknown reason/);
  assert.match(headline('jenkins', 'provider_read_failed', { metadata: { readReason: '' } }), /service is unavailable/);
  assert.match(headline('sonar', 'provider_read_partial', { metadata: { readComponents: 'tests,custom_value,none,tests' } }), /test results, custom value/);
  assert.match(headline('kronos', 'provider_read_partial', { metadata: { readComponents: '' } }), /Delivery monitoring data.*some expected details/);
  assert.match(headline('gitlab', 'provider_read_recovered', { subject: undefined }), /GitLab merge-request and pipeline data/);
  assert.match(headline('jenkins', 'provider_read_recovered'), /Jenkins build results/);
  assert.match(headline('sonar', 'provider_read_recovered'), /SonarQube quality results/);

  assert.match(headline('gitlab', 'initial_mr_observed', { after: { state: 'opened' } }), /is open\./);
  assert.match(headline('gitlab', 'initial_mr_observed', { after: { state: 'draft' } }), /is draft/);
  assert.match(headline('gitlab', 'initial_mr_attention', {
    metadata: { changesRequested: true, unresolvedDiscussionCount: 1, approvalsLeft: 2 },
  }), /changes were requested.*1 unresolved discussion.*2 approvals remaining/);
  assert.match(headline('gitlab', 'approval_required'), /more approval/);
  assert.match(headline('gitlab', 'approval_state_changed'), /remaining requirement unknown/);
  assert.match(headline('gitlab', 'reviewers_changed'), /reviewer/);
  assert.match(headline('gitlab', 'pipeline_failed', {
    subject: { kind: 'pipeline', id: '8' }, metadata: { failedJobCount: 1, failedTestCount: 2 },
  }), /1 blocking job and 2 tests/);
  assert.match(headline('gitlab', 'blocking_jobs_recovered', { metadata: { failedJobCount: 1 } }), /is passing/);
  assert.match(headline('gitlab', 'blocking_jobs_recovered', { metadata: { failedJobCount: 2 } }), /are passing/);
  assert.match(headline('jenkins', 'jenkins_failed', { metadata: { failedStageCount: 1, failedTestCount: 1 } }), /1 stage and 1 test/);
  assert.match(headline('sonar', 'sonar_issues_increased', { metadata: { unresolvedIssueCount: 2, issueDelta: 3 } }), /up 3/);
  assert.match(headline('sonar', 'sonar_issues_decreased', { metadata: { unresolvedIssueCount: 1, issueDelta: -2 } }), /down 2/);
  assert.doesNotMatch(headline('sonar', 'sonar_issues_decreased', { metadata: { issueDelta: 0 } }), /\((?:up|down)/);
  assert.match(headline('sonar', 'initial_healthy', { metadata: { unresolvedIssueCount: 0 } }), /passing.*0 unresolved issues/);
  assert.match(headline('sonar', 'initial_unhealthy'), /failing/);
  assert.match(headline('jenkins', 'initial_healthy'), /passing/);
  assert.match(headline('jenkins', 'initial_unhealthy'), /failing/);
  assert.match(headline('gitlab', 'initial_healthy', { metadata: { pipelineId: 0 } }), /Pipeline 0 is passing/);
  assert.match(headline('gitlab', 'initial_unhealthy', { subject: undefined }), /The pipeline is failing/);
  assert.match(headline('operator', 'initial_healthy'), /Delivery monitoring is healthy/);
  assert.match(headline('operator', 'initial_unhealthy'), /Delivery monitoring is unhealthy/);
  assert.match(headline('gitlab', 'custom_recovered'), /results are healthy again/);
  assert.match(attentionPresentation.attentionEventHeadline(eventFixture({ summary: 'Provider reads recovered after retry' })), /results are current again/);
  assert.match(attentionPresentation.attentionEventHeadline(eventFixture({ summary: '' })), /delivery status changed/);

  assert.equal(attentionPresentation.attentionTicketKey(eventFixture(), sessionFixture({ kind: 'standalone', ticketKeys: ['ONE-1'] })), 'ONE-1');
  assert.equal(attentionPresentation.attentionTicketKey(eventFixture(), sessionFixture({ kind: 'standalone', ticketKeys: ['ONE-1', 'TWO-2'] })), undefined);
  const subjectEvents = [
    { kind: 'merge-request', id: '1' }, { kind: 'pipeline', id: '2' }, { kind: 'build', id: '3' },
    { kind: 'quality-gate', id: '4' }, { kind: 'provider-read', id: '5' }, { kind: 'monitoring-blocker', id: '6' },
    { kind: 'custom-subject', id: '7' },
  ].map(subject => attentionPresentation.attentionEventPresentation(eventFixture({ subject }), undefined).subject);
  assert.deepEqual(subjectEvents, ['MR !1', 'Pipeline 2', 'Build #3', 'Quality gate 4', 'Provider health', 'Monitoring setup', 'custom subject 7']);
  assert.equal(attentionPresentation.attentionEventPresentation(eventFixture({ subject: undefined }), undefined).subject, 'Provider state');

  const tied = sessionFixture({ providerBindings: [
    { id: 'b', provider: 'jenkins', resource: 'build', subjectId: '2', attachedAt: 'invalid', url: 'https://jenkins.example/job/app/2' },
    { id: 'a', provider: 'jenkins', resource: 'build', subjectId: '10', attachedAt: 'invalid', url: 'https://jenkins.example/job/app/10' },
    { id: 'latest', provider: 'jenkins', resource: 'build', subjectId: 'latest', attachedAt: 'invalid', url: 'https://jenkins.example/job/app/latest' },
    { id: 'job', provider: 'jenkins', resource: 'job', subjectId: 'configured', attachedAt: 'invalid', url: 'https://jenkins.example/job/app' },
  ] });
  const choices = attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'jenkins' }), tied);
  assert.equal(choices.some(choice => choice.label === 'Latest Jenkins build'), true);
  assert.match(choices[0].description, /saved invalid/);
  const sonarFallback = sessionFixture({ providerBindings: [{
    id: 'sonar-fallback', provider: 'sonar', resource: 'quality-gate', subjectId: 'app:release', projectId: 'app',
    attachedAt: 'invalid', url: 'https://sonar.example/dashboard?id=app',
  }] });
  assert.equal(attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'sonar' }), sonarFallback)[0].label, 'release');
});

test('attention presentation covers sparse tickets, independent review reasons, and provider choice fallbacks', () => {
  const ticketSession = sessionFixture({
    kind: 'ticket', ticketKey: 'ONE-1', ticketKeys: ['ONE-1', 'TWO-2'], projectName: 'Application',
    monitoring: { enabled: true, lastAttemptAt: '2026-07-20T12:00:00.000Z' },
  });
  assert.equal(attentionPresentation.attentionTicketKey(eventFixture({ subject: undefined }), ticketSession), 'ONE-1');
  assert.equal(attentionPresentation.attentionTicketKey(
    eventFixture({ subject: undefined }),
    sessionFixture({ kind: 'ticket', ticketKey: 'MISSING-1', ticketKeys: ['ONE-1'] }),
  ), 'ONE-1');
  assert.equal(attentionPresentation.attentionEventCanUsePromptContext(eventFixture({ source: 'sonar' })), true);
  assert.match(attentionPresentation.attentionActionContext('jira', undefined, undefined, 'Application'), /attention_repair$/);
  assert.equal(attentionPresentation.attentionActionContext('jenkins', undefined, undefined, 'Application'), 'attention_repair_project_ci');
  const presented = attentionPresentation.attentionEventPresentation(eventFixture({ subject: undefined }), ticketSession);
  assert.equal(presented.project, 'Application');
  assert.equal(presented.observedAt, '2026-07-20T12:00:00.000Z');

  const headline = (transitionKind, metadata = {}, overrides = {}) => attentionPresentation.attentionEventHeadline(eventFixture({
    ...overrides,
    metadata: { transitionKind, ...metadata },
  }));
  assert.match(headline('initial_mr_observed', {}, { after: { state: 'opened/mergeable' } }), /open and mergeable/);
  assert.equal(headline('initial_mr_attention'), 'MR !7 needs review.');
  assert.match(headline('initial_mr_attention', { changesRequested: true }), /changes were requested/);
  assert.match(headline('initial_mr_attention', { unresolvedDiscussionCount: 2 }), /2 unresolved discussions/);
  assert.match(headline('initial_mr_attention', { approvalsLeft: 1 }), /1 approval remaining/);
  assert.equal(headline('initial_mr_attention', { unresolvedDiscussionCount: 0, approvalsLeft: 0 }), 'MR !7 needs review.');
  assert.match(headline('approval_state_changed', { approvalCount: 1, approvalsLeft: 1 }), /1 approval, 1 remaining/);
  assert.match(headline('merge_request_state_changed', {}, { after: { state: undefined } }), /changed to updated/);
  assert.match(headline('provider_read_failed', { readReason: 'tls' }, { source: 'sonar' }), /secure connection failed/);
  assert.match(headline('initial_healthy', {}, { source: 'sonar' }), /passing.*monitored branch/);

  const noSessionChoices = attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'jenkins' }), undefined);
  assert.deepEqual(noSessionChoices, []);
  const providerNamed = sessionFixture({ providerBindings: [{
    id: 'jenkins-named', provider: 'jenkins', resource: 'build', subjectId: '3', projectId: 'application-job',
    attachedAt: '2026-07-20T12:30:00.000Z', url: 'https://jenkins.example/job/application/3',
  }] });
  assert.match(
    attentionPresentation.attentionProviderChoicesForEvent(eventFixture({ source: 'jenkins' }), providerNamed)[0].description,
    /application-job/,
  );
  const sonarSubjectOnly = sessionFixture({ providerBindings: [{
    id: 'sonar-subject', provider: 'sonar', resource: 'quality-gate', subjectId: 'subject-only',
    attachedAt: '2026-07-20T12:30:00.000Z', url: 'https://sonar.example/dashboard?id=app',
  }] });
  assert.equal(attentionPresentation.attentionProviderChoicesForEvent(
    eventFixture({ source: 'sonar' }), sonarSubjectOnly,
  )[0].label, 'subject-only');
  assert.equal(attentionPresentation.attentionEventPresentation(eventFixture({
    source: 'sonar', subject: { kind: 'quality-gate', id: 'fallback' }, metadata: { branch: 'feature/quality' },
  }), undefined).subject, 'Quality gate feature/quality');
});

test('attention projection retains one current event per stream through failure, recovery, and acknowledgement', () => {
  const session = sessionFixture({ id: 'session-fixture', projectName: 'App', projectPath: '/projects/app' });
  const provider = eventFixture({ id: 'provider', at: '2026-07-20T10:00:00.000Z' });
  const failed = eventFixture({
    id: 'failed', at: '2026-07-20T11:00:00.000Z', subject: { kind: 'provider-read', id: 'merge-request:7' },
    metadata: { transitionKind: 'provider_read_failed', readState: 'failed', mergeRequestIid: 7 },
  });
  assert.deepEqual(attentionProjection.currentAttentionTransitions([provider, failed], [session]).map(event => event.id), ['failed']);
  const recovered = { ...failed, id: 'recovered', at: '2026-07-20T12:00:00.000Z', metadata: { transitionKind: 'provider_read_recovered', readState: 'complete', mergeRequestIid: 7 } };
  assert.deepEqual(attentionProjection.currentAttentionTransitions([provider, failed, recovered], [session]).map(event => event.id), ['provider']);
  const acknowledged = eventFixture({ id: 'ack', type: 'notification.acknowledged', source: 'operator', metadata: { acknowledgedEventId: 'provider' } });
  assert.deepEqual(attentionProjection.currentAttentionTransitions([provider, recovered, acknowledged], [session]), []);
  assert.deepEqual(attentionProjection.currentAttentionTransitions([provider], []), []);
  assert.equal(attentionProjection.attentionProjectSessionForEvent(provider, session, [session], undefined), session);
  const projected = attentionProjection.attentionProjectSessionForEvent(
    { ...provider, subject: { ...provider.subject, project: 'App' } },
    sessionFixture({ projectName: undefined, projectPath: undefined }),
    [session],
    [{ name: 'App', path: '/projects/app' }],
  );
  assert.equal(projected.projectName, 'App');
});

test('operations readiness covers provider environment, project, catalog, diagnostic, and plural states', () => {
  const base = {
    claude: { status: 'pass', detail: 'Ready' },
    providerEnvironment: { present: false, invalid: 0, configuredProviders: 0, path: '/private/providers.env' },
    discovery: { roots: 0, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: { count: 0, unavailable: 0, detail: 'No projects', configuredIntegrations: 0, gitlabTargets: 0, jenkinsTargets: 0, sonarTargets: 0 },
    workCatalog: { available: true, tickets: 0, issues: 0 },
    jiraVisibility: { hideCompleted: true, additionalCompletedStatuses: 0 },
    promptLibrary: { localPaths: 0, remoteUrls: 0 },
    providers: [
      { id: 'jira', name: 'Jira', state: 'missing', detail: 'Missing', nextAction: 'Configure' },
      { id: 'gitlab', name: 'GitLab', state: 'invalid', detail: 'Invalid', nextAction: 'Repair' },
    ],
    polling: { activeTargets: 0, detail: 'No targets' }, sessions: { count: 0, issues: 0 },
  };
  const empty = operationsReadiness.buildOperationsReadiness(base);
  assert.equal(empty.find(item => item.id === 'provider-environment').status, 'warn');
  assert.match(empty.find(item => item.id === 'prompt-library').detail, /No prompt sources/);
  assert.equal(empty.find(item => item.id === 'provider-gitlab').status, 'fail');
  const ready = operationsReadiness.buildOperationsReadiness({
    ...base,
    providerEnvironment: { present: true, invalid: 0, configuredProviders: 4, path: '/private/providers.env' },
    discovery: { ...base.discovery, roots: 1 },
    projects: { ...base.projects, count: 1, configuredIntegrations: 1, detail: 'One project', gitlabTargets: 1 },
    workCatalog: { available: true, tickets: 1, issues: 0 },
    jiraVisibility: { hideCompleted: false, additionalCompletedStatuses: 1 },
    promptLibrary: { localPaths: 1, remoteUrls: 1 },
    providers: [{ id: 'jira', name: 'Jira', state: 'ready', detail: 'Ready', nextAction: 'None' }],
    providerDiagnostics: [{ provider: 'jira', status: 'fail', detail: 'HTTP 401', action: 'openProviderEnvironment', actionLabel: 'Repair', observedAt: 'now' }],
    polling: { activeTargets: 1, detail: 'One target' }, sessions: { count: 1, issues: 0 },
  });
  assert.equal(ready.find(item => item.id === 'provider-jira').status, 'fail');
  assert.match(ready.find(item => item.id === 'provider-jira').detail, /Observed now/);
  assert.match(ready.find(item => item.id === 'project-integrations').detail, /1\/1 project connected/);
  const failures = operationsReadiness.buildOperationsReadiness({
    ...base,
    providerEnvironment: { present: true, invalid: 2, configuredProviders: 0, error: 'Unreadable', path: '/private/providers.env' },
    projects: { ...base.projects, count: 2, unavailable: 1, detail: 'One unavailable' },
    workCatalog: { available: false, tickets: 2, issues: 1, firstIssue: 'Corrupt record' },
    sessions: { count: 2, issues: 1, firstIssue: 'Invalid session' },
  });
  assert.equal(failures.find(item => item.id === 'provider-environment').status, 'fail');
  assert.equal(failures.find(item => item.id === 'local-projects').status, 'fail');
  assert.equal(failures.find(item => item.id === 'session-state').status, 'fail');
});

test('work ticket filter matrices cover normalization, matching, completion preferences, and option collection', () => {
  assert.deepEqual(workTicketFilters.normalizeWorkTicketFilter({
    query: ' Feature ', jiraProject: ' APP ', localProject: ' Repo ', label: ' Bug ',
    source: 'jira', jiraStatus: ' In Progress ', completion: 'all',
  }), {
    query: 'Feature', jiraProject: 'APP', localProject: 'Repo', label: 'Bug',
    source: 'jira', jiraStatus: 'In Progress', completion: 'all',
  });
  const ticket = {
    summary: 'Fix provider polling', description: 'Bounded REST reads', jira_status: 'Done',
    jira_project_key: 'APP', linked_local_project: 'Repo', labels: ['Bug', 'Backend'], source: 'jira', mr: null, build: null,
  };
  assert.equal(workTicketFilters.workTicketMatchesFilter('APP-1', ticket, { query: 'polling', completion: 'all' }), true);
  assert.equal(workTicketFilters.workTicketMatchesFilter('APP-1', ticket, { query: 'missing', completion: 'all' }), false);
  assert.equal(workTicketFilters.workTicketMatchesFilter('APP-1', ticket, { jiraProject: 'other' }), false);
  assert.equal(workTicketFilters.workTicketMatchesFilter('APP-1', ticket, { localProject: 'repo', label: 'bug', source: 'jira', jiraStatus: 'done', completion: 'completed' }), true);
  assert.equal(workTicketFilters.workTicketMatchesFilter('APP-1', ticket, { completion: 'active' }), false);
  assert.equal(workTicketFilters.isCompletedWorkTicket(ticket), true);
  assert.equal(workTicketFilters.isCompletedWorkTicket({ ...ticket, jira_status: 'Released' }, new Set(['released'])), true);
  assert.equal(workTicketFilters.isCompletedWorkTicket({ ...ticket, jira_status: 'Open' }), false);
  const options = workTicketFilters.collectWorkTicketFilterOptions({
    'APP-1': ticket,
    'API-2': { ...ticket, jira_project_key: undefined, linked_local_project: undefined, labels: ['backend'], jira_status: 'Open' },
  });
  assert.deepEqual(options.jiraProjects, ['APP']);
  assert.deepEqual(options.localProjects, ['Repo']);
  assert.deepEqual(options.labels, ['Backend', 'Bug']);
  assert.deepEqual(options.jiraStatuses, ['Done', 'Open']);
});

test('work filter matching is deterministic when the host locale has special casing rules', () => {
  const ticket = {
    summary: 'Invoice ingestion', description: 'Inspect identity matching', jira_status: 'In Progress',
    jira_project_key: 'INVOICE', linked_local_project: 'INVOICE', labels: ['INVOICE'], source: 'jira',
    mr: null, build: null,
  };
  const originalLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function localeSensitiveLowerCaseFixture() {
    return String(this).replaceAll('I', 'ı').toLowerCase();
  };
  try {
    assert.equal(workTicketFilters.workTicketMatchesFilter('INVOICE-1', ticket, {
      query: 'invoice',
      jiraProject: 'invoice',
      localProject: 'invoice',
      label: 'invoice',
      jiraStatus: 'in progress',
      completion: 'all',
    }), true);
  } finally {
    String.prototype.toLocaleLowerCase = originalLocaleLowerCase;
  }
});
