const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kronosDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-provider-health-')));
process.env.KRONOS_DIR = kronosDir;

const {
  projectProviderMonitoringHealth,
  providerMonitoringHealthSummary,
  sessionProviderMonitoringHealth,
} = require('../out/services/providerMonitoringHealth.js');
const { currentProviderReadDiagnostics } = require('../out/services/providerReadDiagnostics.js');
const { listMonitorEvents } = require('../out/services/monitorEventStore.js');
const {
  createOrGetWorkSessionByTicket,
  readWorkSession,
  recordWorkSessionMonitoringResult,
} = require('../out/services/workSessionStore.js');

test.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

test('session provider health derives the next poll and legacy successful-poll fallback', () => {
  const health = sessionProviderMonitoringHealth(session({
    lastAttemptAt: '2026-07-14T12:00:00.000Z',
    lastPolledAt: '2026-07-14T12:00:00.000Z',
    lastFailureCount: 0,
    lastState: 'healthy',
    suppressedUnchangedCount: 4,
  }), 300_000);
  assert.equal(health.lastSuccessfulAt, '2026-07-14T12:00:00.000Z');
  assert.equal(health.nextScheduledAt, '2026-07-14T12:05:00.000Z');
  assert.equal(health.suppressedUnchangedCount, 4);
  assert.equal(providerMonitoringHealthSummary(health), 'poll healthy • quiet 4');
});

test('project provider health aggregates latest evidence and earliest scheduled poll', () => {
  const health = projectProviderMonitoringHealth([
    session({
      lastAttemptAt: '2026-07-14T12:00:00.000Z',
      lastSuccessfulAt: '2026-07-14T11:55:00.000Z',
      lastMeaningfulChangeAt: '2026-07-14T11:50:00.000Z',
      lastState: 'healthy',
      suppressedUnchangedCount: 3,
    }),
    session({
      lastAttemptAt: '2026-07-14T12:01:00.000Z',
      lastSuccessfulAt: '2026-07-14T12:01:00.000Z',
      lastMeaningfulChangeAt: '2026-07-14T11:59:00.000Z',
      lastState: 'partial',
      currentError: 'provider_evidence_partial',
      suppressedUnchangedCount: 2,
    }),
  ], 300_000);
  assert.equal(health.state, 'partial');
  assert.equal(health.lastSuccessfulAt, '2026-07-14T12:01:00.000Z');
  assert.equal(health.lastMeaningfulChangeAt, '2026-07-14T11:59:00.000Z');
  assert.equal(health.nextScheduledAt, '2026-07-14T12:05:00.000Z');
  assert.equal(health.currentError, 'provider_evidence_partial');
  assert.equal(health.suppressedUnchangedCount, 5);
});

test('monitoring results persist success, meaningful change, and quiet suppression separately', () => {
  const created = createOrGetWorkSessionByTicket({ ticketKey: 'HEALTH-1', title: 'Health fixture' });
  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 1,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:00:00.000Z',
  });
  let stored = readWorkSession(created.id);
  assert.equal(stored.monitoring.lastSuccessfulAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.lastMeaningfulChangeAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.suppressedUnchangedCount, 0);

  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 0,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:05:00.000Z',
  });
  stored = readWorkSession(created.id);
  assert.equal(stored.monitoring.lastSuccessfulAt, '2026-07-14T12:05:00.000Z');
  assert.equal(stored.monitoring.lastMeaningfulChangeAt, '2026-07-14T12:00:00.000Z');
  assert.equal(stored.monitoring.suppressedUnchangedCount, 1);
  assert.equal(stored.monitoring.currentError, undefined);
});

test('health-only updates stay out of Attention history and use observation-only language', () => {
  const created = createOrGetWorkSessionByTicket({ ticketKey: 'HEALTH-3', title: 'Quiet health fixture' });
  assert.deepEqual(listMonitorEvents({
    sessionId: created.id,
    types: ['provider.transition'],
    limit: 20,
  }), []);

  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 0,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:15:00.000Z',
  });

  const stored = readWorkSession(created.id);
  const health = sessionProviderMonitoringHealth(stored, 300_000);
  assert.equal(providerMonitoringHealthSummary(health), 'poll healthy • quiet 1');
  assert.doesNotMatch(providerMonitoringHealthSummary(health), /repair|remediat|fixed automatically/i);
  assert.deepEqual(listMonitorEvents({
    sessionId: created.id,
    types: ['provider.transition'],
    limit: 20,
  }), [], 'persisting poll health must not manufacture an Attention transition');
});

test('current normalized provider error clears only after a non-failing result', () => {
  const created = createOrGetWorkSessionByTicket({ ticketKey: 'HEALTH-2', title: 'Error fixture' });
  recordWorkSessionMonitoringResult(created.id, {
    polled: 0,
    transitions: 1,
    failures: 1,
    skipped: 0,
    attemptedAt: '2026-07-14T12:00:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, 'provider_read_failed');
  recordWorkSessionMonitoringResult(created.id, {
    polled: 2,
    transitions: 1,
    failures: 0,
    skipped: 1,
    attemptedAt: '2026-07-14T12:05:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, 'provider_evidence_partial');
  recordWorkSessionMonitoringResult(created.id, {
    polled: 3,
    transitions: 1,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-14T12:10:00.000Z',
  });
  assert.equal(readWorkSession(created.id).monitoring.currentError, undefined);
});

test('provider diagnostics retain current live failures and partial reads until their own recovery', () => {
  const event = ({ id, at, source, sessionId = 'session-one', subjectId = source, state, reason, components = 'none' }) => ({
    schemaVersion: 1,
    id,
    at,
    sessionId,
    type: 'provider.transition',
    source,
    summary: 'Ignored private summary with token=must-not-surface.',
    subject: { kind: source === 'gitlab' ? 'merge-request' : 'provider-read', id: subjectId },
    after: { state: `monitoring/${state}`, fingerprint: id },
    metadata: {
      transitionKind: state === 'complete' ? 'provider_read_recovered' : `provider_read_${state}`,
      readState: state,
      readReason: reason,
      readComponents: components,
    },
  });
  const events = [
    event({ id: 'gitlab-old-permission', at: '2026-07-14T12:00:00.000Z', source: 'gitlab', subjectId: '77', state: 'failed', reason: 'permission' }),
    event({ id: 'gitlab-recovered', at: '2026-07-14T12:05:00.000Z', source: 'gitlab', subjectId: '77', state: 'complete', reason: 'complete' }),
    event({ id: 'gitlab-auth-current', at: '2026-07-14T12:06:00.000Z', source: 'gitlab', sessionId: 'session-two', subjectId: '88', state: 'failed', reason: 'authentication' }),
    event({ id: 'jenkins-partial', at: '2026-07-14T12:07:00.000Z', source: 'jenkins', state: 'partial', reason: 'unavailable', components: 'stages,tests' }),
    event({ id: 'sonar-complete', at: '2026-07-14T12:08:00.000Z', source: 'sonar', state: 'complete', reason: 'complete' }),
    event({ id: 'sonar-timeout-current', at: '2026-07-14T12:09:00.000Z', source: 'sonar', sessionId: 'session-two', state: 'failed', reason: 'timeout' }),
  ];
  const diagnostics = currentProviderReadDiagnostics(events, {
    phase: 'error',
    completedAt: '2026-07-14T12:09:00.000Z',
    detail: 'Jira request failed with HTTP 403. [permission] Verify read access.',
    retainedFromPrevious: 3,
    warningCount: 0,
  });

  assert.deepEqual(diagnostics.map(item => [item.provider, item.status, item.action]), [
    ['jira', 'fail', 'openJiraBoard'],
    ['gitlab', 'fail', 'openProviderEnvironment'],
    ['jenkins', 'warn', 'pollProvidersNow'],
    ['sonar', 'fail', 'pollProvidersNow'],
  ]);
  assert.match(diagnostics.find(item => item.provider === 'gitlab').detail, /authentication unavailable/);
  assert.doesNotMatch(JSON.stringify(diagnostics), /must-not-surface|session-one|session-two/);
  assert.match(diagnostics.find(item => item.provider === 'jenkins').detail, /stages, tests/);
  assert.match(diagnostics.find(item => item.provider === 'sonar').detail, /timed out.*reachability/i);

  const recovered = currentProviderReadDiagnostics([
    ...events,
    event({ id: 'gitlab-auth-recovered', at: '2026-07-14T12:10:00.000Z', source: 'gitlab', sessionId: 'session-two', subjectId: '88', state: 'complete', reason: 'complete' }),
    event({ id: 'jenkins-recovered', at: '2026-07-14T12:11:00.000Z', source: 'jenkins', state: 'complete', reason: 'complete' }),
    event({ id: 'sonar-timeout-recovered', at: '2026-07-14T12:12:00.000Z', source: 'sonar', sessionId: 'session-two', state: 'complete', reason: 'complete' }),
  ], { phase: 'complete', retainedFromPrevious: 0, warningCount: 0 });
  assert.deepEqual(recovered, []);
});

function session(monitoring) {
  return { status: 'active', monitoring: { enabled: true, ...monitoring } };
}
