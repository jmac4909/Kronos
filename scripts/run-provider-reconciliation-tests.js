const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kronosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-provider-reconciliation-'));
process.env.KRONOS_DIR = kronosDir;

const { appendTransitionOnce, deterministicEventId } = require('../out/services/providerTransitionRecorder.js');
const {
  deterministicReadStatusFingerprint,
  jenkinsIncompleteReadComponents,
  providerReadFailureReason,
  readFailureLabel,
  sonarIncompleteReadComponents,
} = require('../out/services/providerReadHealth.js');
const { listMonitorEvents } = require('../out/services/monitorEventStore.js');

test.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

test('provider transition recorder gives one deterministic event to one transition', () => {
  const input = transitionInput({
    transitionKey: 'pipeline:42:failed',
    fingerprint: 'pipeline-fingerprint',
    metadata: { transitionKind: 'pipeline_failed' },
  });
  const first = appendTransitionOnce(input);
  const duplicate = appendTransitionOnce(input);
  assert.ok(first);
  assert.equal(duplicate, null);
  assert.equal(first.id, deterministicEventId(
    input.session.id,
    input.source,
    input.transitionKey,
    input.subject.id,
    input.fingerprint,
  ));
});

test('provider transition recorder suppresses unchanged read health but records a real change', () => {
  const failed = transitionInput({
    source: 'jenkins',
    subject: { kind: 'provider-read', id: 'jenkins', ticketKey: 'CHECK-1' },
    state: 'monitoring/failed',
    transitionKey: 'read:jenkins:1',
    fingerprint: 'failed-generation-1',
    metadata: {
      transitionKind: 'provider_read_failed',
      readState: 'failed',
      readReason: 'network',
      readComponents: 'none',
      readGeneration: 1,
    },
  });
  assert.ok(appendTransitionOnce(failed));
  assert.equal(appendTransitionOnce({
    ...failed,
    transitionKey: 'read:jenkins:2',
    fingerprint: 'failed-generation-2',
    metadata: { ...failed.metadata, readGeneration: 2 },
  }), null, 'generation churn must not duplicate the same normalized failure');
  assert.ok(appendTransitionOnce({
    ...failed,
    state: 'monitoring/complete',
    transitionKey: 'read:jenkins:3',
    fingerprint: 'recovered-generation-3',
    metadata: {
      ...failed.metadata,
      transitionKind: 'provider_read_recovered',
      readState: 'complete',
      readReason: 'complete',
      readGeneration: 3,
    },
  }));
  assert.equal(listMonitorEvents({ sessionId: failed.session.id, source: 'jenkins', limit: 20 }).length, 2);
});

test('provider read failures normalize to stable operator-safe categories', () => {
  assert.equal(providerReadFailureReason(new Error('Provider request failed with HTTP 401.')), 'authentication');
  assert.equal(providerReadFailureReason(new Error('Provider request failed with HTTP 403.')), 'permission');
  assert.equal(providerReadFailureReason(new Error('Provider request failed with HTTP 429.')), 'rate_limited');
  assert.equal(providerReadFailureReason(new Error('Timed out reaching provider.')), 'timeout');
  assert.equal(readFailureLabel('authentication'), 'authentication unavailable');
  assert.equal(readFailureLabel('safety_limit'), 'bounded read limit reached');
  assert.equal(readFailureLabel('unknown-future-reason'), 'provider unavailable');
});

test('provider read components and fingerprints are canonical and bounded', () => {
  assert.deepEqual(jenkinsIncompleteReadComponents({ completeness: {
    complete: false,
    buildComplete: false,
    testReport: 'partial',
    stages: 'unavailable',
    warnings: [],
  } }), ['build', 'tests']);
  assert.deepEqual(sonarIncompleteReadComponents({ completeness: {
    complete: false,
    qualityGateComplete: true,
    measuresComplete: false,
    issuesComplete: false,
    warnings: [],
  } }), ['measures', 'issues']);
  const first = deterministicReadStatusFingerprint('jenkins', 'failed', 'network', 1, 'none');
  assert.equal(first, deterministicReadStatusFingerprint('jenkins', 'failed', 'network', 1, 'none'));
  assert.notEqual(first, deterministicReadStatusFingerprint('jenkins', 'failed', 'network', 2, 'none'));
  assert.match(first, /^[a-f0-9]{64}$/);
});

function transitionInput(overrides = {}) {
  return {
    session: {
      schemaVersion: 1,
      id: 'session-check-1',
      kind: 'ticket',
      ticketKey: 'CHECK-1',
      ticketKeys: ['CHECK-1'],
      title: 'Provider reconciliation fixture',
      status: 'active',
      createdAt: '2026-07-14T12:00:00.000Z',
      updatedAt: '2026-07-14T12:00:00.000Z',
      terminals: [],
      providerBindings: [],
      artifacts: [],
      monitoring: { enabled: true },
    },
    source: 'gitlab',
    summary: 'Provider state changed.',
    subject: { kind: 'pipeline', id: '42', ticketKey: 'CHECK-1' },
    state: 'failed',
    fingerprint: 'fixture-fingerprint',
    artifactPath: path.join(kronosDir, 'artifact.json'),
    transitionKey: 'fixture-transition',
    metadata: { transitionKind: 'fixture_changed' },
    ...overrides,
  };
}
