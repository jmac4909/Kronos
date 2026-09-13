const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mergeRequests = require('../out/services/gitlabMergeRequestTransitions.js');
const pipelines = require('../out/services/pipelineTransitions.js');
const ci = require('../out/services/ciTransitions.js');
const {
  attentionProjectSessionForEvent,
  currentAttentionTransitions,
} = require('../out/services/attentionProjection.js');
const attention = require('../out/services/attentionPresentation.js');
const activeAttention = require('../out/services/activeAttentionMonitor.js');

test('active Attention shows only current project delivery work and derives review readiness', () => {
  const owner = activeAttentionOwner();
  const healthyCi = {
    schemaVersion: 1,
    fingerprint: 'healthy-ci',
    jenkins: jenkinsDigest({ status: 'success' }),
    sonar: sonarDigest(),
  };
  const idle = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    pipeline: pipelineDigest({ status: 'success' }),
    ci: healthyCi,
  }));
  assert.equal(idle, null, 'healthy completed work without an open MR stays in Projects instead of Attention');

  const running = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'running' }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'running-ci',
      jenkins: jenkinsDigest({ status: 'running' }),
      sonar: sonarDigest(),
    },
  }));
  assert.ok(running);
  assert.equal(running.state, 'in-progress');
  assert.deepEqual(running.rows.map(row => row.event.subject.kind).sort(), [
    'build',
    'merge-request',
    'pipeline',
    'quality-gate',
  ].sort());
  assert.equal(running.rows.every(row => row.exactEvent === false), true);
  assert.equal(running.rows.every(row => row.event.metadata.liveSnapshot === true), true);
  assert.equal(attention.attentionEventCanUsePromptContext(running.rows[0].event), false);
  assert.match(running.rows.find(row => row.event.subject.kind === 'pipeline').event.summary, /is running/i);
  assert.match(running.rows.find(row => row.event.subject.kind === 'build').event.summary, /is running/i);

  const readyForReview = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest({ approved: false, approvalsLeft: 1 }),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: healthyCi,
  }));
  assert.equal(readyForReview.state, 'ready-for-review');
  assert.match(
    readyForReview.rows.find(row => row.event.subject.kind === 'merge-request').event.summary,
    /1 approval remaining/,
  );

  const readyToMerge = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest({ approved: true, approvalsLeft: 0, approvedBy: [{ user: { id: 9 } }] }),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: healthyCi,
  }));
  assert.equal(readyToMerge.state, 'ready-to-merge');
  assert.match(
    readyToMerge.rows.find(row => row.event.subject.kind === 'merge-request').event.summary,
    /approval requirements satisfied/,
  );

  const noOptionalProviders = activeAttention.activeAttentionProject(activeAttentionInput({
    ...owner,
    providerBindings: owner.providerBindings.filter(binding => binding.provider === 'gitlab'),
  }, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
  }));
  assert.equal(noOptionalProviders.state, 'ready-for-review');

  const awaitingConfiguredChecks = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
  }));
  assert.equal(awaitingConfiguredChecks.state, 'in-progress');
  assert.deepEqual(
    awaitingConfiguredChecks.rows.filter(row => row.event.subject.id === 'pending').map(row => row.event.source),
    ['jenkins', 'sonar'],
  );
  assert.match(awaitingConfiguredChecks.rows.find(row => row.event.source === 'jenkins').event.summary, /Waiting/);
  assert.match(awaitingConfiguredChecks.rows.find(row => row.event.source === 'sonar').event.summary, /Waiting/);
});

test('completed Jenkins and available Sonar rows clear locally until current truth changes', () => {
  const owner = activeAttentionOwner();
  const failedCi = {
    schemaVersion: 1,
    fingerprint: 'failed-clearable-ci',
    jenkins: jenkinsDigest({
      status: 'failed',
      failedTestCount: 1,
      failedStageNames: ['verify'],
    }),
    sonar: sonarDigest({ gateStatus: 'ERROR', unresolvedIssueCount: 3 }),
  };
  const current = activeAttention.activeAttentionProject(activeAttentionInput(owner, { ci: failedCi }));
  assert.ok(current);
  assert.equal(current.state, 'needs-fixes');
  assert.deepEqual(
    Object.fromEntries(current.rows.map(row => [row.event.source, row.dismissible])),
    { jenkins: true, sonar: true },
  );

  const acknowledgements = current.rows.map((row, index) => ({
    schemaVersion: 1,
    id: `clear-provider-${index}`,
    at: `2026-07-15T12:11:0${index}.000Z`,
    sessionId: owner.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: `Cleared ${row.event.source} current result.`,
    metadata: { acknowledgedEventId: row.event.id },
  }));
  assert.equal(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: failedCi,
    events: acknowledgements,
  })), null, 'acknowledging every completed standalone result removes the project from Attention');

  const openMergeRequest = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: failedCi,
    events: acknowledgements,
  }));
  assert.ok(openMergeRequest);
  assert.equal(openMergeRequest.state, 'in-progress', 'clearing rows never promotes failed checks to ready');
  assert.deepEqual(
    openMergeRequest.rows.map(row => row.event.source),
    ['gitlab', 'gitlab'],
    'the open MR remains monitored without the locally cleared CI rows',
  );

  const changed = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: {
      schemaVersion: 1,
      fingerprint: 'changed-clearable-ci',
      jenkins: jenkinsDigest({
        buildNumber: 12,
        status: 'failed',
        failedTestCount: 2,
        failedStageNames: ['verify'],
      }),
      sonar: sonarDigest({ gateStatus: 'ERROR', unresolvedIssueCount: 4 }),
    },
    events: acknowledgements,
  }));
  assert.ok(changed);
  assert.deepEqual(changed.rows.map(row => row.event.source).sort(), ['jenkins', 'sonar']);

  const inFlight = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'running' }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'pending-ci',
      jenkins: jenkinsDigest({ status: 'running' }),
      sonar: sonarDigest({ gateAvailable: false }),
    },
  }));
  assert.equal(inFlight.rows.find(row => row.event.source === 'jenkins').dismissible, false);
  assert.equal(inFlight.rows.find(row => row.event.source === 'sonar').dismissible, false);
});

test('active Attention keeps failures and incomplete reads visible until current truth recovers', () => {
  const owner = activeAttentionOwner();
  const failed = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest({ detailedStatus: 'requested_changes' }),
    pipeline: pipelineDigest({
      status: 'failed',
      failedTests: 2,
      jobs: [{ id: 5, name: 'verify', status: 'failed', allow_failure: false }],
    }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'failed-ci',
      jenkins: jenkinsDigest({
        status: 'failed',
        failedTestCount: 1,
        failedStageNames: ['verify'],
      }),
      sonar: sonarDigest({ gateStatus: 'ERROR', unresolvedIssueCount: 3 }),
    },
  }));
  assert.ok(failed);
  assert.equal(failed.state, 'needs-fixes');
  assert.equal(failed.rows.filter(row => row.severity === 'failure').length, 3);
  assert.match(failed.rows.find(row => row.event.subject.kind === 'pipeline').event.summary, /1 blocking job.*2 failed tests/);
  assert.match(failed.rows.find(row => row.event.source === 'jenkins').event.summary, /1 failed stage.*1 failed test/);
  assert.match(failed.rows.find(row => row.event.source === 'sonar').event.summary, /3 unresolved issues/);

  const readEvents = [
    resourceTransition('gitlab-read-failed', '2026-07-15T12:06:00.000Z', 'gitlab', 'merge-request', '77', 'provider_read_failed', {
      readState: 'failed',
      readGeneration: 4,
    }),
    resourceTransition('jenkins-read-partial', '2026-07-15T12:05:00.000Z', 'jenkins', 'provider-read', 'jenkins', 'provider_read_partial', {
      readState: 'partial',
    }),
    resourceTransition('sonar-read-failed', '2026-07-15T12:04:00.000Z', 'sonar', 'provider-read', 'sonar', 'provider_read_failed', {
      readState: 'failed',
    }),
    resourceTransition('monitor-blocked', '2026-07-15T12:03:00.000Z', 'kronos', 'monitoring-blocker', 'provider-configuration', 'monitoring_blocked'),
  ].map(event => ({ ...event, sessionId: owner.id }));
  const incomplete = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'last-known-ci',
      jenkins: jenkinsDigest({ status: 'success' }),
      sonar: sonarDigest(),
    },
    events: readEvents,
    gitLabRead: {
      schemaVersion: 1,
      generation: 4,
      state: 'failed',
      components: ['approvals'],
      reason: 'timeout',
      updatedAt: '2026-07-15T12:06:00.000Z',
      fingerprint: 'read-fingerprint',
    },
    snapshotError: true,
  }));
  assert.ok(incomplete);
  assert.equal(incomplete.state, 'status-incomplete');
  assert.deepEqual(
    incomplete.rows.map(row => `${row.event.source}:${row.event.subject.kind}`).sort(),
    [
      'gitlab:merge-request',
      'jenkins:provider-read',
      'sonar:provider-read',
      'kronos:monitoring-blocker',
    ].sort(),
    'current read problems replace stale provider results and a real blocker suppresses a duplicate snapshot warning',
  );
  assert.equal(incomplete.rows.every(row => row.exactEvent), true);

  const incompleteWithoutEvent = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    gitLabRead: {
      schemaVersion: 1,
      generation: 5,
      state: 'partial',
      components: ['approvals', 'discussions'],
      reason: 'bounded-read-incomplete',
      updatedAt: '2026-07-15T12:08:00.000Z',
      fingerprint: 'partial-read-fingerprint',
    },
  }));
  assert.equal(incompleteWithoutEvent.state, 'status-incomplete');
  assert.equal(incompleteWithoutEvent.rows.length, 1);
  assert.equal(incompleteWithoutEvent.rows[0].event.subject.kind, 'provider-read');
  assert.equal(incompleteWithoutEvent.rows[0].event.metadata.liveSnapshot, true);
  assert.equal(incompleteWithoutEvent.rows[0].exactEvent, false);
  assert.match(incompleteWithoutEvent.rows[0].event.summary, /approvals, discussions/);

  const incompleteSnapshots = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success', jobsComplete: false }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'partial-snapshot-ci',
      jenkins: jenkinsDigest({ status: 'success', testsAvailable: false }),
      sonar: sonarDigest({ gateAvailable: false }),
    },
  }));
  assert.equal(incompleteSnapshots.state, 'status-incomplete');
  assert.equal(incompleteSnapshots.rows.filter(row => row.severity === 'partial').length, 3);
  assert.match(incompleteSnapshots.rows.find(row => row.event.subject.kind === 'pipeline').event.summary, /status is incomplete/);
  assert.match(incompleteSnapshots.rows.find(row => row.event.source === 'jenkins').event.summary, /status is incomplete/);
  assert.match(incompleteSnapshots.rows.find(row => row.event.source === 'sonar').event.summary, /not yet available/);

  const monitoringHealthOnly = activeAttention.activeAttentionProject(activeAttentionInput({
    ...owner,
    monitoring: {
      ...owner.monitoring,
      currentError: 'provider_read_failed',
    },
  }));
  assert.equal(monitoringHealthOnly.state, 'status-incomplete');
  assert.equal(monitoringHealthOnly.rows.length, 1);
  assert.equal(monitoringHealthOnly.rows[0].event.subject.kind, 'monitoring-health');

  const recoveredEvents = [
    resourceTransition('jenkins-read-recovered', '2026-07-15T12:07:00.000Z', 'jenkins', 'provider-read', 'jenkins', 'provider_read_recovered', {
      readState: 'complete',
    }),
    resourceTransition('sonar-read-recovered', '2026-07-15T12:07:00.000Z', 'sonar', 'provider-read', 'sonar', 'provider_read_recovered', {
      readState: 'complete',
    }),
    resourceTransition('monitor-recovered', '2026-07-15T12:07:00.000Z', 'kronos', 'monitoring-blocker', 'provider-configuration', 'monitoring_recovered'),
  ].map(event => ({ ...event, sessionId: owner.id }));
  const recovered = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'recovered-ci',
      jenkins: jenkinsDigest({ status: 'success' }),
      sonar: sonarDigest(),
    },
    events: recoveredEvents,
  }));
  assert.equal(recovered.state, 'ready-for-review');

  const corruptSnapshot = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    snapshotError: true,
  }));
  assert.equal(corruptSnapshot.state, 'status-incomplete');
  assert.equal(corruptSnapshot.rows.length, 1);
  assert.equal(corruptSnapshot.rows[0].event.metadata.liveSnapshot, true);
  assert.match(corruptSnapshot.rows[0].event.summary, /could not be loaded/i);
});

test('active Attention applies Sonar read health only to the currently monitored target', () => {
  const owner = activeAttentionOwner();
  const currentSonar = sonarDigest();
  const staleTargetProblems = [
    resourceTransition(
      'sonar-old-branch-partial',
      '2026-07-15T12:12:00.000Z',
      'sonar',
      'provider-read',
      'sonar',
      'provider_read_partial',
      {
        readState: 'partial',
        readGeneration: 1,
        projectKey: currentSonar.projectKey,
        branch: 'feature/old-branch',
      },
    ),
    resourceTransition(
      'sonar-old-project-failed',
      '2026-07-15T12:13:00.000Z',
      'sonar',
      'provider-read',
      'sonar',
      'provider_read_failed',
      {
        readState: 'failed',
        readGeneration: 2,
        projectKey: 'retired-project',
        branch: currentSonar.branch,
      },
    ),
    resourceTransition(
      'sonar-current-initial-healthy',
      '2026-07-15T12:14:00.000Z',
      'sonar',
      'quality-gate',
      `${currentSonar.projectKey}:${currentSonar.branch}`,
      'initial_healthy',
      {
        projectKey: currentSonar.projectKey,
        branch: currentSonar.branch,
      },
    ),
  ].map(event => ({ ...event, sessionId: owner.id }));
  const currentTarget = {
    projectKey: currentSonar.projectKey,
    branch: currentSonar.branch,
  };

  assert.equal(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: { schemaVersion: 1, fingerprint: 'current-sonar-ci', sonar: currentSonar },
    events: staleTargetProblems,
    sonarTarget: currentTarget,
  })), null, 'historical read problems from another branch or project do not keep healthy work visible');

  const openMergeRequest = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest(),
    pipeline: pipelineDigest({ status: 'success' }),
    ci: {
      schemaVersion: 1,
      fingerprint: 'current-sonar-review-ci',
      jenkins: jenkinsDigest({ status: 'success' }),
      sonar: currentSonar,
    },
    events: staleTargetProblems,
    sonarTarget: currentTarget,
  }));
  assert.equal(openMergeRequest.state, 'ready-for-review');
  const sonarRow = openMergeRequest.rows.find(row => row.event.source === 'sonar');
  assert.equal(sonarRow.event.subject.kind, 'quality-gate');
  assert.notEqual(sonarRow.severity, 'partial');

  const currentReadProblem = resourceTransition(
    'sonar-current-branch-partial',
    '2026-07-15T12:15:00.000Z',
    'sonar',
    'provider-read',
    'sonar',
    'provider_read_partial',
    {
      readState: 'partial',
      readGeneration: 1,
      projectKey: currentSonar.projectKey,
      branch: currentSonar.branch,
    },
  );
  const incomplete = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: { schemaVersion: 1, fingerprint: 'stale-current-sonar-ci', sonar: currentSonar },
    events: [...staleTargetProblems, { ...currentReadProblem, sessionId: owner.id }],
    sonarTarget: currentTarget,
  }));
  assert.equal(incomplete.state, 'status-incomplete');
  assert.equal(incomplete.rows.length, 1);
  assert.equal(incomplete.rows[0].event.id, currentReadProblem.id);

  const failedNewTarget = resourceTransition(
    'sonar-new-target-failed',
    '2026-07-15T12:16:00.000Z',
    'sonar',
    'provider-read',
    'sonar',
    'provider_read_failed',
    {
      readState: 'failed',
      readGeneration: 1,
      projectKey: currentSonar.projectKey,
      branch: 'release/current',
    },
  );
  const switchedTargetFailure = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: { schemaVersion: 1, fingerprint: 'retained-old-sonar-ci', sonar: currentSonar },
    events: [{ ...failedNewTarget, sessionId: owner.id }],
    sonarTarget: { projectKey: currentSonar.projectKey, branch: 'release/current' },
  }));
  assert.equal(switchedTargetFailure.state, 'status-incomplete');
  assert.equal(switchedTargetFailure.rows[0].event.id, failedNewTarget.id,
    'configured target identity wins over a retained snapshot from the previous branch');
});

test('active Attention reuses exact current events and removes finished standalone builds', () => {
  const owner = activeAttentionOwner();
  const mr = mrDigest();
  const pipeline = pipelineDigest({ status: 'running' });
  const jenkins = jenkinsDigest({ status: 'running' });
  const sonar = sonarDigest();
  const events = [
    exactSnapshotEvent(owner, 'exact-mr', 'gitlab', 'merge-request', String(mr.iid), mr.fingerprint),
    exactSnapshotEvent(owner, 'exact-pipeline', 'gitlab', 'pipeline', String(pipeline.id), pipeline.fingerprint),
    exactSnapshotEvent(owner, 'exact-jenkins', 'jenkins', 'build', String(jenkins.buildNumber), jenkins.fingerprint),
    exactSnapshotEvent(owner, 'exact-sonar', 'sonar', 'quality-gate', `${sonar.projectKey}:${sonar.branch}`, sonar.fingerprint),
  ];
  const projected = activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mr,
    pipeline,
    ci: { schemaVersion: 1, fingerprint: 'exact-ci', jenkins, sonar },
    events,
  }));
  assert.deepEqual(projected.rows.map(row => row.event.id).sort(), [
    'exact-mr',
    'exact-pipeline',
    'exact-jenkins',
    'exact-sonar',
  ].sort());
  assert.equal(projected.rows.every(row => row.exactEvent), true);
  assert.equal(attention.attentionEventCanUsePromptContext(projected.rows[0].event), true);

  assert.ok(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    pipeline: pipelineDigest({ status: 'pending' }),
  })), 'an in-flight standalone pipeline is active work');
  assert.ok(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: { schemaVersion: 1, fingerprint: 'building-ci', jenkins: jenkinsDigest({ status: 'running' }) },
  })), 'an in-flight standalone Jenkins build is active work');
  assert.equal(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    pipeline: pipelineDigest({ status: 'success' }),
  })), null, 'a successful standalone pipeline disappears');
  assert.equal(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    ci: { schemaVersion: 1, fingerprint: 'complete-ci', jenkins: jenkinsDigest({ status: 'success' }) },
  })), null, 'a successful standalone Jenkins build disappears');
  assert.ok(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest({ state: 'closed' }),
    pipeline: pipelineDigest({ status: 'failed' }),
  })), 'an unresolved failure remains visible after its MR closes');
  assert.equal(activeAttention.activeAttentionProject(activeAttentionInput(owner, {
    mergeRequest: mrDigest({ state: 'merged' }),
    pipeline: pipelineDigest({ status: 'success' }),
  })), null, 'merged work with complete healthy checks disappears');
});

test('active Attention state language, order, and pop-up boundary are exhaustive', () => {
  const expected = [
    ['needs-fixes', 'Needs fixes', 'failure', 0],
    ['status-incomplete', 'Status incomplete', 'partial', 1],
    ['ready-for-review', 'Ready for review', 'warning', 2],
    ['ready-to-merge', 'Ready to merge', 'information', 3],
    ['in-progress', 'In progress', 'information', 4],
  ];
  for (const [state, label, severity, rank] of expected) {
    assert.equal(activeAttention.activeAttentionProjectStateLabel(state), label);
    assert.equal(activeAttention.activeAttentionProjectStateSeverity(state), severity);
    assert.equal(activeAttention.activeAttentionProjectSortRank(state), rank);
  }

  const problems = [
    'monitoring_blocked',
    'provider_read_failed',
    'provider_read_partial',
    'changes_requested',
    'initial_mr_attention',
    'unresolved_discussions_observed',
    'unresolved_discussions_increased',
    'pipeline_failed',
    'pipeline_canceled',
    'blocking_jobs_failed',
    'tests_failed',
    'jenkins_failed',
    'jenkins_tests_failed',
    'jenkins_stages_failed',
    'sonar_gate_failed',
    'initial_unhealthy',
  ];
  for (const transitionKind of problems) {
    assert.equal(
      activeAttention.activeAttentionNotificationKind(
        transitionEvent(`notify-${transitionKind}`, '2026-07-15T12:00:00.000Z', transitionKind, 'changed'),
        'in-progress',
      ),
      'problem',
      transitionKind,
    );
  }
  assert.equal(
    activeAttention.activeAttentionNotificationKind(
      transitionEvent('notify-generic-failure', '2026-07-15T12:00:00.000Z', 'custom_transition', 'ERROR'),
      undefined,
    ),
    'problem',
  );
  const readinessEnablers = [
    'initial_mr_observed',
    'approval_required',
    'approval_state_changed',
    'pipeline_recovered',
    'pipeline_succeeded',
    'blocking_jobs_recovered',
    'tests_recovered',
    'jenkins_recovered',
    'jenkins_succeeded',
    'jenkins_tests_recovered',
    'jenkins_stages_recovered',
    'sonar_gate_recovered',
    'changes_request_cleared',
    'unresolved_discussions_decreased',
    'unresolved_discussions_changed',
  ];
  for (const transitionKind of readinessEnablers) {
    assert.equal(
      activeAttention.activeAttentionNotificationKind(
        transitionEvent(`notify-${transitionKind}`, '2026-07-15T12:00:00.000Z', transitionKind, 'success'),
        'ready-for-review',
      ),
      'ready-for-review',
      transitionKind,
    );
  }
  assert.equal(
    activeAttention.activeAttentionNotificationKind(
      transitionEvent('notify-running', '2026-07-15T12:00:00.000Z', 'new_pipeline', 'running'),
      'in-progress',
    ),
    undefined,
    'ordinary running state stays silent',
  );
  assert.equal(
    activeAttention.activeAttentionNotificationKind(
      transitionEvent('notify-merge', '2026-07-15T12:00:00.000Z', 'approval_satisfied', 'approved'),
      'ready-to-merge',
    ),
    undefined,
    'ready-to-merge remains in the monitor without broadening the agreed pop-up boundary',
  );
});

test('GitLab merge-request transition matrix covers every declared structural transition', () => {
  const thread = (id, noteId = id) => ({
    id,
    notes: [{ id: noteId, resolvable: true, resolved: false, updated_at: `2026-07-15T12:${String(noteId).padStart(2, '0')}:00.000Z` }],
  });
  const note = (id, updated = id) => ({ id, updated_at: `2026-07-15T13:${String(updated).padStart(2, '0')}:00.000Z` });
  const cases = [
    ['merge_request_merged', mrDigest({ state: 'opened' }), mrDigest({ state: 'merged' })],
    ['merge_request_closed', mrDigest({ state: 'opened' }), mrDigest({ state: 'closed' })],
    ['merge_request_reopened', mrDigest({ state: 'closed' }), mrDigest({ state: 'opened' })],
    ['merge_request_state_changed', mrDigest({ state: 'opened' }), mrDigest({ state: 'locked' })],
    ['changes_requested', mrDigest({ detailedStatus: 'mergeable' }), mrDigest({ detailedStatus: 'requested_changes' })],
    ['changes_request_cleared', mrDigest({ detailedStatus: 'requested_changes' }), mrDigest({ detailedStatus: 'mergeable' })],
    ['approval_satisfied', mrDigest({ approved: false, approvalsLeft: 1 }), mrDigest({ approved: true, approvalsLeft: 0, approvedBy: [{ user: { id: 9 } }] })],
    ['approval_required', mrDigest({ approved: true, approvalsLeft: 0, approvedBy: [{ user: { id: 9 } }] }), mrDigest({ approved: false, approvalsLeft: 1 })],
    ['approval_state_changed', mrDigest({ approved: false, approvalsRequired: 2, approvalsLeft: 2 }), mrDigest({ approved: false, approvalsRequired: 2, approvalsLeft: 1 })],
    ['reviewers_changed', mrDigest({ reviewers: [{ id: 1 }] }), mrDigest({ reviewers: [{ id: 2 }] })],
    ['unresolved_discussions_observed', mrDigest({ discussionsComplete: false }), mrDigest({ discussions: [thread('thread-1', 1)] })],
    ['unresolved_discussions_increased', mrDigest({ discussions: [thread('thread-1', 1)] }), mrDigest({ discussions: [thread('thread-1', 1), thread('thread-2', 2)] })],
    ['unresolved_discussions_decreased', mrDigest({ discussions: [thread('thread-1', 1), thread('thread-2', 2)] }), mrDigest({ discussions: [thread('thread-1', 1)] })],
    ['unresolved_discussions_changed', mrDigest({ discussions: [thread('thread-1', 1)] }), mrDigest({ discussions: [thread('thread-2', 2)] })],
    ['review_activity_added', mrDigest({ notes: [] }), mrDigest({ notes: [note(10)] })],
    ['review_activity_changed', mrDigest({ notes: [note(10, 10)] }), mrDigest({ notes: [note(10, 11)] })],
  ];
  assertMatrixCoverage(
    'src/services/gitlabMergeRequestTransitions.ts',
    'GitLabMergeRequestTransitionKind',
    cases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of cases) {
    const kinds = mergeRequests.compareGitLabMergeRequestDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
    assert.deepEqual(
      mergeRequests.compareGitLabMergeRequestDigests(current, current),
      [],
      `${expected} must remain quiet when the normalized digest is unchanged`,
    );
  }
});

test('GitLab pipeline transition matrix covers every declared pipeline, job, and test transition', () => {
  for (const status of ['failed', 'failure', 'error', 'canceled', 'cancelled']) {
    assert.equal(pipelines.gitLabPipelineStatusIsUnhealthy(status), true, `${status} must be unhealthy at baseline`);
  }
  for (const status of ['created', 'pending', 'running', 'success', 'skipped', 'manual']) {
    assert.equal(pipelines.gitLabPipelineStatusIsUnhealthy(status), false, `${status} must not be a baseline failure`);
  }
  const failedJob = { id: 4, name: 'verify', stage: 'test', status: 'failed', allow_failure: false };
  const cases = [
    ['new_pipeline', pipelineDigest({ id: 70 }), pipelineDigest({ id: 71 })],
    ['pipeline_failed', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'failed' })],
    ['pipeline_canceled', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'canceled' })],
    ['pipeline_recovered', pipelineDigest({ status: 'failed' }), pipelineDigest({ status: 'success' })],
    ['pipeline_succeeded', pipelineDigest({ status: 'running' }), pipelineDigest({ status: 'success' })],
    ['blocking_jobs_failed', pipelineDigest(), pipelineDigest({ jobs: [failedJob] })],
    ['blocking_jobs_recovered', pipelineDigest({ jobs: [failedJob] }), pipelineDigest()],
    ['tests_failed', pipelineDigest({ failedTests: 0 }), pipelineDigest({ failedTests: 2 })],
    ['tests_recovered', pipelineDigest({ failedTests: 2 }), pipelineDigest({ failedTests: 0 })],
  ];
  assertMatrixCoverage(
    'src/services/pipelineTransitions.ts',
    'GitLabPipelineTransitionKind',
    cases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of cases) {
    const kinds = pipelines.compareGitLabPipelineDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
});

test('GitLab pipeline normalization keeps complete evidence across partial reads and ignores non-blocking job noise', () => {
  const complete = pipelines.normalizeGitLabPipelineDigest({
    mr: {
      sha: 'abc123',
      head_pipeline: { id: 70, project_id: 4815, status: 'running' },
    },
    pipeline: {
      id: 70,
      project_id: 4815,
      status: { text: 'Failed' },
      web_url: 'https://user:password@gitlab.example/group/app/-/pipelines/70?token=secret#trace',
    },
    pipelines: [{ id: 70, project_id: 4815, ref: 'feature/APP-70', sha: 'abc123' }],
    jobs: [
      { id: 1, name: 'verify', stage: 'test', status: 'failed', retried: true },
      { id: 2, name: 'verify', stage: 'test', status: 'success' },
      { id: 3, name: 'optional', stage: 'test', status: 'failed', allow_failure: 'true' },
      { id: 4, name: 'blocking', stage: 'test', status: 'failed', web_url: 'https://gitlab.example/jobs/4?trace=secret' },
      null,
      { id: 0, name: 'invalid', status: 'failed' },
    ],
    testReportSummary: { available: false },
    testReport: {
      test_suites: [
        { total_count: '7', success_count: '5', failed_count: '1', error_count: '1', skipped_count: '0' },
        { totalCount: 3, successCount: 3, failedCount: 0, errorCount: 0, skippedCount: 0 },
        null,
      ],
    },
    fetchedAt: '2026-07-16T12:00:00.000Z',
    completeness: { jobsComplete: true, testsComplete: true },
  });
  assert.ok(complete);
  assert.equal(complete.status, 'failed');
  assert.equal(complete.projectIdOrPath, '4815');
  assert.equal(complete.ref, 'feature/APP-70');
  assert.equal(complete.url, 'https://gitlab.example/group/app/-/pipelines/70');
  assert.deepEqual(complete.failedJobs, [{
    id: 4,
    name: 'blocking',
    status: 'failed',
    stage: 'test',
    url: 'https://gitlab.example/jobs/4',
  }]);
  assert.deepEqual(complete.tests, { available: true, total: 10, failed: 1, error: 1, skipped: 0 });

  const partial = pipelines.normalizeGitLabPipelineDigest({
    pipeline: { id: 70, project_id: 4815, status: 'success' },
    jobs: [],
    fetchedAt: '2026-07-16T12:01:00.000Z',
    completeness: { jobsComplete: false, testsComplete: false },
  });
  assert.ok(partial);
  const merged = pipelines.mergeGitLabPipelineDigest(complete, partial);
  assert.ok(merged);
  assert.equal(merged.status, 'success');
  assert.equal(merged.jobsComplete, true);
  assert.deepEqual(merged.failedJobs, complete.failedJobs);
  assert.equal(merged.testsComplete, true);
  assert.deepEqual(merged.tests, complete.tests);
  assert.deepEqual(
    pipelines.compareGitLabPipelineDigests(complete, merged).map(transition => transition.kind),
    ['pipeline_recovered'],
    'retained component evidence must not fabricate job or test recovery transitions',
  );

  const differentProject = pipelines.normalizeGitLabPipelineDigest({
    pipeline: { id: 70, project_id: 9000, status: 'success' },
    jobs: [],
    fetchedAt: '2026-07-16T12:02:00.000Z',
    completeness: { jobsComplete: false, testsComplete: false },
  });
  assert.ok(differentProject);
  assert.deepEqual(pipelines.mergeGitLabPipelineDigest(complete, differentProject), differentProject);
  assert.equal(pipelines.normalizeStoredGitLabPipelineDigest(null), null);
  assert.equal(pipelines.mergeGitLabPipelineDigest(complete, null), null);
});

test('Jenkins and SonarQube transition matrices cover every declared CI transition', () => {
  const jenkinsCases = [
    ['jenkins_new_build', jenkinsDigest({ buildNumber: 11 }), jenkinsDigest({ buildNumber: 12 })],
    ['jenkins_failed', jenkinsDigest({ status: 'running' }), jenkinsDigest({ status: 'failure' })],
    ['jenkins_recovered', jenkinsDigest({ status: 'failure' }), jenkinsDigest({ status: 'success' })],
    ['jenkins_succeeded', jenkinsDigest({ status: 'running' }), jenkinsDigest({ status: 'success' })],
    ['jenkins_tests_failed', jenkinsDigest({ failedTestCount: 0 }), jenkinsDigest({ failedTestCount: 2 })],
    ['jenkins_tests_recovered', jenkinsDigest({ failedTestCount: 2 }), jenkinsDigest({ failedTestCount: 0 })],
    ['jenkins_stages_failed', jenkinsDigest({ failedStageNames: [] }), jenkinsDigest({ failedStageNames: ['Verify'] })],
    ['jenkins_stages_recovered', jenkinsDigest({ failedStageNames: ['Verify'] }), jenkinsDigest({ failedStageNames: [] })],
  ];
  const sonarCases = [
    ['sonar_gate_failed', sonarDigest({ gateStatus: 'OK' }), sonarDigest({ gateStatus: 'ERROR' })],
    ['sonar_gate_recovered', sonarDigest({ gateStatus: 'ERROR' }), sonarDigest({ gateStatus: 'OK' })],
    ['sonar_issues_increased', sonarDigest({ unresolvedIssueCount: 1 }), sonarDigest({ unresolvedIssueCount: 2 })],
    ['sonar_issues_decreased', sonarDigest({ unresolvedIssueCount: 2 }), sonarDigest({ unresolvedIssueCount: 1 })],
  ];
  assertMatrixCoverage(
    'src/services/ciTransitions.ts',
    'JenkinsCiTransitionKind',
    jenkinsCases.map(([kind]) => kind),
  );
  assertMatrixCoverage(
    'src/services/ciTransitions.ts',
    'SonarCiTransitionKind',
    sonarCases.map(([kind]) => kind),
  );
  for (const [expected, previous, current] of jenkinsCases) {
    const kinds = ci.compareJenkinsCiDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
  for (const [expected, previous, current] of sonarCases) {
    const kinds = ci.compareSonarCiDigests(previous, current).map(transition => transition.kind);
    assert.ok(kinds.includes(expected), `${expected} was not emitted; received ${kinds.join(', ') || 'none'}`);
  }
  for (const failureStatus of ['aborted', 'canceled', 'cancelled', 'unstable']) {
    const failedKinds = ci.compareJenkinsCiDigests(
      jenkinsDigest({ status: 'running' }),
      jenkinsDigest({ status: failureStatus }),
    ).map(transition => transition.kind);
    assert.ok(failedKinds.includes('jenkins_failed'), `${failureStatus} must be a Jenkins failure transition`);
    const recoveryKinds = ci.compareJenkinsCiDigests(
      jenkinsDigest({ status: failureStatus }),
      jenkinsDigest({ status: 'success' }),
    ).map(transition => transition.kind);
    assert.ok(recoveryKinds.includes('jenkins_recovered'), `${failureStatus} must recover to Jenkins success`);
  }
  assert.ok(
    ci.compareSonarCiDigests(
      sonarDigest({ gateStatus: 'OK' }),
      sonarDigest({ gateStatus: 'WARN' }),
    ).some(transition => transition.kind === 'sonar_gate_failed'),
    'a SonarQube WARN gate must use the same unhealthy classification at baseline and transition time',
  );
  assert.ok(
    ci.compareSonarCiDigests(
      sonarDigest({ gateStatus: 'WARN' }),
      sonarDigest({ gateStatus: 'OK' }),
    ).some(transition => transition.kind === 'sonar_gate_recovered'),
    'a SonarQube WARN gate must recover to OK',
  );
});

test('Jenkins and SonarQube digests reject malformed evidence and retain complete bounded facets', () => {
  for (const value of [null, {}, { provider: 'gitlab', build: {} }, { provider: 'jenkins' }]) {
    assert.equal(ci.jenkinsCiDigestFromContext(value), null);
  }
  assert.equal(ci.jenkinsCiDigestFromContext({
    provider: 'jenkins',
    jobOrBuildUrl: 'file:///tmp/job',
    build: { number: 1 },
  }), null);
  assert.equal(ci.jenkinsCiDigestFromContext({
    provider: 'jenkins',
    jobOrBuildUrl: 'https://jenkins.example/job/app',
    build: { number: -1 },
  }), null);

  const failedStages = Array.from({ length: 102 }, (_, index) => ({
    name: index === 0 ? '' : index === 1 ? 'x'.repeat(300) : `Stage ${index}`,
    status: index === 2 ? 'success' : 'failed',
  }));
  failedStages.push(null, { name: 'ignored', status: 'running' });
  const jenkins = ci.jenkinsCiDigestFromContext({
    provider: 'jenkins',
    jobOrBuildUrl: 'https://operator:secret@jenkins.example/job/app?token=hidden#fragment',
    build: {
      number: 41,
      status: 'FAILED BUILD',
      building: true,
      url: 'https://other.example/job/app/41?token=hidden',
    },
    tests: { failCount: -5, complete: false },
    stages: failedStages,
    completeness: { testReport: 'complete', stages: 'complete' },
  });
  assert.ok(jenkins);
  assert.equal(jenkins.jobOrBuildUrl, 'https://jenkins.example/job/app');
  assert.equal(jenkins.buildUrl, jenkins.jobOrBuildUrl, 'cross-origin build links are not retained');
  assert.equal(jenkins.status, 'failed_build');
  assert.equal(jenkins.testsAvailable, false);
  assert.equal(jenkins.failedTestCount, 0);
  assert.equal(jenkins.failedStageNames.length, 100);
  assert.equal(jenkins.failedStageNamesTruncated, true);

  const invalidJenkinsBase = { ...jenkins };
  for (const mutate of [
    value => { value.schemaVersion = 2; },
    value => { value.provider = 'gitlab'; },
    value => { value.building = 'yes'; },
    value => { value.testsAvailable = 'yes'; },
    value => { value.stagesAvailable = 'yes'; },
    value => { value.failedStageNamesTruncated = 'yes'; },
    value => { value.buildUrl = 'https://other.example/job/app/41'; },
    value => { value.buildNumber = -1; },
    value => { value.failedTestCount = 1.5; },
    value => { value.failedStageNames = [' spaced ']; },
    value => { value.failedStageNames = Array.from({ length: 101 }, () => 'stage'); },
  ]) {
    const value = structuredClone(invalidJenkinsBase);
    mutate(value);
    assert.equal(ci.normalizeJenkinsCiDigest(value), null);
  }

  for (const value of [null, {}, { provider: 'jenkins', qualityGate: {} }, { provider: 'sonarqube' }]) {
    assert.equal(ci.sonarCiDigestFromContext(value), null);
  }
  const sonar = ci.sonarCiDigestFromContext({
    provider: 'sonarqube',
    projectKey: 'app:key',
    branch: 'feature/quality',
    dashboardUrl: 'https://operator:secret@sonar.example/dashboard?token=hidden#fragment',
    qualityGate: { status: 'Warning Gate' },
    issues: [
      null,
      { status: 'OPEN' },
      { issueStatus: 'fixed' },
      { status: 'OPEN', resolution: 'FIXED' },
    ],
    measures: [
      null,
      { metric: 'coverage', value: ' 95.0 ', periodValue: '96.0' },
      { metric: 'coverage', value: '97.0' },
      { metric: 'not_retained', value: '1' },
      { metric: 'invalid metric', value: '1' },
      { metric: 'bugs' },
    ],
    completeness: { qualityGateComplete: true, issuesComplete: true, measuresComplete: true },
  });
  assert.ok(sonar);
  assert.equal(sonar.dashboardUrl, 'https://sonar.example/dashboard?id=app%3Akey&branch=feature%2Fquality');
  assert.equal(sonar.unresolvedIssueCount, 1);
  assert.deepEqual(sonar.metrics, [{ metric: 'bugs' }, { metric: 'coverage', value: '97.0' }]);

  const invalidSonarBase = { ...sonar };
  for (const mutate of [
    value => { value.schemaVersion = 2; },
    value => { value.provider = 'jenkins'; },
    value => { value.gateAvailable = 'yes'; },
    value => { value.issueCountAvailable = 'yes'; },
    value => { value.metricsAvailable = 'yes'; },
    value => { value.projectKey = ''; },
    value => { value.branch = ''; },
    value => { value.dashboardUrl = 'file:///tmp/dashboard'; },
    value => { value.unresolvedIssueCount = -1; },
    value => { value.metrics = null; },
    value => { value.metrics = [{ metric: 'coverage' }, { metric: 'coverage' }]; },
    value => { value.metrics = [{ metric: 'unknown_metric' }]; },
    value => { value.metrics = [{ metric: 'coverage', value: ' spaced ' }]; },
    value => { value.metrics = [{ metric: 'coverage', periodValue: '' }]; },
    value => { value.metrics = Array.from({ length: 65 }, () => ({ metric: 'coverage' })); },
  ]) {
    const value = structuredClone(invalidSonarBase);
    mutate(value);
    assert.equal(ci.normalizeSonarCiDigest(value), null);
  }

  assert.equal(ci.buildCiMonitorDigest({}), null);
  assert.equal(ci.normalizeCiMonitorDigest(null), null);
  assert.equal(ci.normalizeCiMonitorDigest({ schemaVersion: 1, jenkins: {} }), null);
  assert.equal(ci.normalizeCiMonitorDigest({ schemaVersion: 1, sonar: {} }), null);
  const combined = ci.buildCiMonitorDigest({
    jenkins: {
      provider: 'jenkins', jobOrBuildUrl: 'https://jenkins.example/job/app',
      build: { number: 41, status: 'failure', url: 'https://jenkins.example/job/app/41' },
      stages: [], completeness: { stages: 'complete' },
    },
    sonar: {
      provider: 'sonarqube', projectKey: 'app:key', branch: 'main',
      dashboardUrl: 'https://sonar.example/dashboard', qualityGate: { status: 'ERROR' },
      completeness: { qualityGateComplete: true, issuesTotal: 3 },
    },
  });
  assert.ok(combined.jenkins && combined.sonar);
  assert.equal(ci.normalizeCiMonitorDigest(combined).fingerprint, combined.fingerprint);
  assert.equal(ci.mergeCiMonitorDigest(combined, null), null);
  assert.deepEqual(ci.compareCiMonitorDigests(null, combined), []);
  assert.equal(ci.jenkinsStatusIsFailure('failed_compile'), true);
  assert.equal(ci.jenkinsStatusIsFailure('compile_failed'), true);
  assert.equal(ci.jenkinsStatusIsFailure('running'), false);
  assert.equal(ci.jenkinsStatusIsSuccess('successful'), true);
  assert.equal(ci.sonarGateStatusIsFailure('warning'), true);
  assert.equal(ci.sonarGateStatusIsSuccess('passed'), true);
});

test('pipeline and CI normalization cover partial retention, alternate provider shapes, and quiet comparisons', () => {
  const direct = pipelines.normalizeGitLabPipelineDigest({
    pipeline: { id: 81, project: { id: 12 }, status: { group: 'success' }, url: 'https://gitlab.example/pipeline/81' },
    pipelines: [{ id: 80, sha: 'other' }, { id: 79, sha: 'older' }],
    jobs: [],
    testReportSummary: { total: { count: 20, success: 4, failed: 1, error: 1, skipped: 1 } },
    fetchedAt: '2026-07-16T13:00:00.000Z',
  });
  assert.ok(direct);
  assert.equal(direct.projectIdOrPath, '12');
  assert.deepEqual(direct.tests, { available: true, total: 20, failed: 1, error: 1, skipped: 1 });

  const fromNewestList = pipelines.normalizeGitLabPipelineDigest({
    mr: { sha: 'no-match' },
    pipelines: [
      { id: 82, project_path: 'group/app', status: 'running' },
      { id: 84, project_id_or_path: 'group/app', status: 'running' },
    ],
    jobs: [], testReport: {}, fetchedAt: '2026-07-16T13:01:00.000Z',
  });
  assert.ok(fromNewestList);
  assert.equal(fromNewestList.id, 84);
  assert.equal(fromNewestList.tests.available, false);

  const malformedUrl = pipelines.normalizeGitLabPipelineDigest({
    pipeline: { id: 85, projectId: 12, detailed_status: { label: 'not/a/status' }, web_url: 'not a URL' },
    jobs: [{ id: 1, name: 'failed', status: 'failed', allowFailure: 'false', url: 'file:///private' }],
    testReportSummary: { available: 'false' },
  });
  assert.ok(malformedUrl);
  assert.equal(malformedUrl.status, 'unknown');
  assert.equal(malformedUrl.url, undefined);
  assert.equal(malformedUrl.failedJobs.length, 1);
  assert.equal(malformedUrl.failedJobs[0].url, undefined);

  const completeCurrent = pipelineDigest({ failedTests: 1, jobs: [{ id: 9, name: 'verify', status: 'failed' }] });
  const mergedComplete = pipelines.mergeGitLabPipelineDigest(pipelineDigest(), completeCurrent);
  assert.deepEqual(mergedComplete.failedJobs, completeCurrent.failedJobs);
  assert.deepEqual(mergedComplete.tests, completeCurrent.tests);
  const incompleteCurrent = pipelines.normalizeStoredGitLabPipelineDigest({
    ...completeCurrent, jobsComplete: false, testsComplete: false,
  });
  assert.ok(incompleteCurrent);
  assert.deepEqual(pipelines.compareGitLabPipelineDigests(completeCurrent, incompleteCurrent), []);
  assert.deepEqual(pipelines.compareGitLabPipelineDigests(null, completeCurrent), []);
  assert.deepEqual(pipelines.compareGitLabPipelineDigests(completeCurrent, null), []);

  const sameFailure = pipelineDigest({ status: 'failed' });
  const changedFailure = pipelines.normalizeStoredGitLabPipelineDigest({ ...sameFailure, fetchedAt: 'later' });
  assert.ok(changedFailure);
  assert.equal(
    pipelines.compareGitLabPipelineDigests(sameFailure, changedFailure).some(item => item.kind === 'pipeline_failed'),
    false,
  );
  const partialJobs = pipelines.normalizeStoredGitLabPipelineDigest({ ...completeCurrent, jobsComplete: false });
  const unavailableTests = pipelines.normalizeStoredGitLabPipelineDigest({
    ...completeCurrent, tests: { available: false, total: 0, failed: 0, error: 0, skipped: 0 },
  });
  assert.ok(partialJobs && unavailableTests);
  assert.equal(pipelines.compareGitLabPipelineDigests(pipelineDigest(), partialJobs).some(item => item.kind.includes('jobs')), false);
  assert.equal(pipelines.compareGitLabPipelineDigests(pipelineDigest(), unavailableTests).some(item => item.kind.startsWith('tests_')), false);

  const baseJenkins = jenkinsDigest({ failedTestCount: 3, failedStageNames: ['Verify'] });
  const partialJenkins = requiredDigest(ci.normalizeJenkinsCiDigest({
    ...baseJenkins,
    testsAvailable: false,
    failedTestCount: 0,
    stagesAvailable: false,
    failedStageNames: [],
    failedStageNamesTruncated: false,
  }), 'partial Jenkins');
  const baseSonar = sonarDigest({ gateStatus: 'ERROR', unresolvedIssueCount: 4 });
  const partialSonar = requiredDigest(ci.normalizeSonarCiDigest({
    ...baseSonar,
    gateAvailable: false,
    gateStatus: 'unknown',
    issueCountAvailable: false,
    unresolvedIssueCount: 0,
    metricsAvailable: false,
    metrics: [],
  }), 'partial SonarQube');
  const priorCombined = requiredDigest(ci.normalizeCiMonitorDigest({
    schemaVersion: 1, jenkins: baseJenkins, sonar: baseSonar,
  }), 'prior combined CI');
  const partialCombined = requiredDigest(ci.normalizeCiMonitorDigest({
    schemaVersion: 1, jenkins: partialJenkins, sonar: partialSonar,
  }), 'partial combined CI');
  const retained = ci.mergeCiMonitorDigest(priorCombined, partialCombined);
  assert.ok(retained);
  assert.equal(retained.jenkins.failedTestCount, 3);
  assert.deepEqual(retained.jenkins.failedStageNames, ['Verify']);
  assert.equal(retained.sonar.gateStatus, 'error');
  assert.equal(retained.sonar.unresolvedIssueCount, 4);

  const currentComplete = requiredDigest(ci.normalizeCiMonitorDigest({
    schemaVersion: 1,
    jenkins: jenkinsDigest({ failedTestCount: 1, failedStageNames: ['Package'] }),
    sonar: sonarDigest({ gateStatus: 'WARN', unresolvedIssueCount: 2 }),
  }), 'current complete CI');
  const preferred = ci.mergeCiMonitorDigest(priorCombined, currentComplete);
  assert.equal(preferred.jenkins.failedTestCount, 1);
  assert.deepEqual(preferred.jenkins.failedStageNames, ['Package']);
  assert.equal(preferred.sonar.gateStatus, 'warn');
  assert.equal(preferred.sonar.unresolvedIssueCount, 2);

  assert.deepEqual(ci.compareJenkinsCiDigests(null, baseJenkins), []);
  assert.deepEqual(ci.compareJenkinsCiDigests(baseJenkins, null), []);
  assert.deepEqual(ci.compareSonarCiDigests(baseSonar, { ...baseSonar, projectKey: 'other' }), []);
  assert.deepEqual(ci.compareSonarCiDigests(baseSonar, { ...baseSonar, branch: 'other' }), []);
  const newFailedBuild = jenkinsDigest({ buildNumber: 12, status: 'failure', failedTestCount: 2, failedStageNames: ['Verify'] });
  const newBuildKinds = ci.compareJenkinsCiDigests(jenkinsDigest({ buildNumber: 11 }), newFailedBuild).map(item => item.kind);
  assert.ok(newBuildKinds.includes('jenkins_failed'));
  assert.ok(newBuildKinds.includes('jenkins_tests_failed'));
  assert.ok(newBuildKinds.includes('jenkins_stages_failed'));
  const unavailableGate = requiredDigest(ci.normalizeSonarCiDigest({ ...baseSonar, gateAvailable: false }), 'unavailable gate');
  assert.equal(ci.compareSonarCiDigests(unavailableGate, baseSonar).some(item => item.kind === 'sonar_gate_failed'), true);

  assert.equal(ci.jenkinsCiDigestFromContext({
    provider: 'jenkins', jobOrBuildUrl: 'https://jenkins.example', build: { number: 1, status: 'success' },
  }).stagesAvailable, false);
  assert.equal(ci.sonarCiDigestFromContext({
    provider: 'sonarqube', projectKey: '', branch: 'main', dashboardUrl: 'https://sonar.example', qualityGate: {},
  }), null);
  assert.equal(ci.sonarCiDigestFromContext({
    provider: 'sonarqube', projectKey: 'app', branch: '', dashboardUrl: 'https://sonar.example', qualityGate: {},
  }), null);
  assert.equal(ci.sonarCiDigestFromContext({
    provider: 'sonarqube', projectKey: 'app', branch: 'main', dashboardUrl: 'not a URL', qualityGate: {},
  }), null);
  assert.equal(ci.normalizeSonarCiDigest({ ...baseSonar, metrics: [null] }), null);
});

test('merge-request normalization bounds provider noise and partial reads without invented transitions', () => {
  assert.equal(mergeRequests.normalizeGitLabMergeRequestDigest(null), null);
  assert.equal(mergeRequests.normalizeGitLabMergeRequestDigest({ mr: null }), null);
  assert.equal(mergeRequests.normalizeGitLabMergeRequestDigest({ mr: { iid: 0 } }), null);
  assert.equal(mergeRequests.normalizeStoredGitLabMergeRequestDigest(null), null);
  assert.equal(mergeRequests.normalizeStoredGitLabMergeRequestDigest({ schemaVersion: 1, iid: -1 }), null);

  const snapshot = {
    mr: {
      iid: 77.9,
      state: 'OPENED state',
      merge_status: 'checking',
      blocking_discussions_resolved: false,
      updated_at: '2026-07-16T12:00:00.000Z',
      web_url: 'https://operator:secret@gitlab.example/group/app/-/merge_requests/77?token=hidden#fragment',
      sha: 'abc123',
      title: 'Review bounded evidence',
      source_branch: 'feature/review',
      target_branch: 'main',
      reviewers: [null, { id: 9.8 }, { username: '  REVIEWER ' }, { username: '' }],
    },
    approvals: {
      approved: false,
      approvals_required: 2.9,
      approvals_left: -1,
      approved_by: [
        null,
        { user: null },
        { user: { username: 'Approver' } },
        { user: { id: 4 }, approved_at: '2026-07-16T11:00:00.000Z' },
      ],
    },
    discussions: [
      null,
      { notes: [{ resolvable: true, resolved: false, created_at: '2026-07-16T10:00:00.000Z', author: { username: 'author' } }] },
      { id: 'resolved-thread', notes: [{ id: 2, resolvable: true, resolved: true }] },
      { id: 'system-thread', notes: [{ id: 3, system: true }] },
    ],
    notes: [
      null,
      { id: 10, updated_at: '2026-07-16T10:01:00.000Z' },
      { created_at: '2026-07-16T10:02:00.000Z', author: { username: 'Writer' } },
      { id: 11, system: true },
    ],
    completeness: { approvalsComplete: true, discussionsComplete: true, notesComplete: true },
    fetchedAt: '2026-07-16T12:00:01.000Z',
  };
  const digest = mergeRequests.normalizeGitLabMergeRequestDigest(snapshot);
  assert.ok(digest);
  assert.equal(digest.iid, 77);
  assert.equal(digest.state, 'opened_state');
  assert.equal(digest.changesRequested, null);
  assert.equal(digest.blockingDiscussionsResolved, false);
  assert.equal(digest.url, 'https://gitlab.example/group/app/-/merge_requests/77');
  assert.equal(digest.reviewers.count, 2);
  assert.equal(digest.approval.approvalsRequired, 2);
  assert.equal(digest.approval.approvalsLeft, null);
  assert.equal(digest.approval.approvedByCount, 2);
  assert.equal(digest.unresolvedDiscussions.count, 1);
  assert.equal(digest.reviewActivity.count, 4);

  const noApprovals = mergeRequests.normalizeGitLabMergeRequestDigest({
    mr: { iid: 78, detailed_merge_status: 'requested_changes' },
    discussions: Array.from({ length: 2_001 }, () => null),
    notes: Array.from({ length: 2_001 }, () => null),
    completeness: { approvalsComplete: true, discussionsComplete: true, notesComplete: true },
  });
  assert.ok(noApprovals);
  assert.equal(noApprovals.changesRequested, true);
  assert.equal(noApprovals.approvalsComplete, false);
  assert.equal(noApprovals.discussionsComplete, false);
  assert.equal(noApprovals.reviewActivityComplete, false);
  assert.equal(noApprovals.approval.available, false);

  const stored = mergeRequests.normalizeStoredGitLabMergeRequestDigest({
    ...digest,
    reviewers: null,
    approval: null,
    unresolvedDiscussions: null,
    reviewActivity: null,
    changesRequested: 'yes',
    blockingDiscussionsResolved: 'yes',
    approvalsComplete: false,
    discussionsComplete: false,
    reviewActivityComplete: false,
    url: 'file:///tmp/not-provider',
    fetchedAt: '',
  });
  assert.ok(stored);
  assert.equal(stored.changesRequested, null);
  assert.equal(stored.blockingDiscussionsResolved, null);
  assert.equal(stored.url, undefined);
  assert.equal(stored.reviewers.count, 0);

  const complete = mrDigest({ detailedStatus: 'requested_changes', discussions: [{
    id: 'thread-1', notes: [{ id: 1, resolvable: true, resolved: false }],
  }], notes: [{ id: 4 }] });
  const partial = mergeRequests.normalizeStoredGitLabMergeRequestDigest({
    ...complete,
    changesRequested: null,
    approvalsComplete: false,
    discussionsComplete: false,
    reviewActivityComplete: false,
  });
  const merged = mergeRequests.mergeGitLabMergeRequestDigest(complete, partial);
  assert.equal(merged.changesRequested, true);
  assert.equal(merged.approvalsComplete, true);
  assert.equal(merged.discussionsComplete, true);
  assert.equal(merged.reviewActivityComplete, true);
  assert.equal(mergeRequests.mergeGitLabMergeRequestDigest(complete, null), null);
  assert.equal(mergeRequests.mergeGitLabMergeRequestDigest(complete, { ...partial, iid: 99 }).iid, 99);
  assert.deepEqual(mergeRequests.compareGitLabMergeRequestDigests(null, complete), []);
  assert.deepEqual(mergeRequests.compareGitLabMergeRequestDigests(complete, { ...complete, iid: 99 }), []);
  assert.equal(mergeRequests.gitLabMergeRequestNeedsAttention(complete), true);
  assert.equal(mergeRequests.gitLabMergeRequestNeedsAttention({ ...complete, state: 'closed' }), false);
  assert.equal(mergeRequests.gitLabMergeRequestNeedsAttention({
    ...complete, changesRequested: false, discussionsComplete: false,
  }), false);
});

test('Attention collapses provider-read health into GitLab MR, Jenkins build, and SonarQube branch truth', () => {
  const session = workSession();
  const sonarGate = resourceTransition(
    'sonar-gate-failing',
    '2026-07-15T11:00:00.000Z',
    'sonar',
    'quality-gate',
    'app:main',
    'initial_unhealthy',
    { projectKey: 'app', branch: 'main' },
  );
  const sonarReadFailed = transitionEvent(
    'sonar-read-failed',
    '2026-07-15T11:01:00.000Z',
    'provider_read_failed',
    'monitoring/failed',
    {
      source: 'sonar',
      subject: { kind: 'provider-read', id: 'sonar:app:main', project: 'Application', ticketKey: 'MATRIX-1' },
      metadata: {
        transitionKind: 'provider_read_failed',
        readState: 'failed',
        readReason: 'timeout',
        projectKey: 'app',
        branch: 'main',
      },
    },
  );
  const sonarReadRecovered = transitionEvent(
    'sonar-read-recovered',
    '2026-07-15T11:02:00.000Z',
    'provider_read_recovered',
    'monitoring/complete',
    {
      source: 'sonar',
      subject: { kind: 'provider-read', id: 'sonar:app:main', project: 'Application', ticketKey: 'MATRIX-1' },
      metadata: {
        transitionKind: 'provider_read_recovered',
        readState: 'complete',
        readReason: 'complete',
        projectKey: 'app',
        branch: 'main',
      },
    },
  );
  assert.deepEqual(
    currentAttentionTransitions([sonarGate, sonarReadFailed], [session]).map(event => event.id),
    ['sonar-read-failed'],
    'a failed read temporarily replaces stale quality data',
  );
  assert.deepEqual(
    currentAttentionTransitions([sonarGate, sonarReadFailed, sonarReadRecovered], [session]).map(event => event.id),
    ['sonar-gate-failing'],
    'a recovered read reveals the newest quality-gate truth instead of adding a second green row',
  );
  const legacySession = {
    ...session,
    providerBindings: [{
      id: 'sonar-main-binding',
      provider: 'sonar',
      resource: 'quality-gate',
      subjectId: 'app:main',
      projectId: 'app',
      attachedAt: '2026-07-15T10:59:00.000Z',
    }],
  };
  const legacySonarRead = {
    ...sonarReadFailed,
    id: 'legacy-sonar-read-failed',
    subject: { ...sonarReadFailed.subject, id: 'sonar' },
    metadata: {
      transitionKind: 'provider_read_failed',
      readState: 'failed',
      readReason: 'timeout',
    },
  };
  assert.deepEqual(
    currentAttentionTransitions([sonarGate, legacySonarRead], [legacySession]).map(event => event.id),
    ['legacy-sonar-read-failed'],
    'persisted pre-fix SonarQube read-health rows collapse through the durable branch binding',
  );

  const jenkinsBuild = resourceTransition(
    'jenkins-build-healthy',
    '2026-07-15T11:03:00.000Z',
    'jenkins',
    'build',
    '42',
    'initial_healthy',
    { buildNumber: 42 },
  );
  const jenkinsPartial = transitionEvent(
    'jenkins-read-partial',
    '2026-07-15T11:04:00.000Z',
    'provider_read_partial',
    'monitoring/partial',
    {
      source: 'jenkins',
      subject: { kind: 'provider-read', id: 'jenkins', project: 'Application', ticketKey: 'MATRIX-1' },
      metadata: { transitionKind: 'provider_read_partial', readState: 'partial', readReason: 'bounded' },
    },
  );
  assert.deepEqual(
    currentAttentionTransitions([jenkinsBuild, jenkinsPartial], [session]).map(event => event.id),
    ['jenkins-read-partial'],
  );

  const gitLabMr = resourceTransition(
    'gitlab-mr-open',
    '2026-07-15T11:05:00.000Z',
    'gitlab',
    'merge-request',
    '77',
    'initial_mr_observed',
    { mergeRequestIid: 77 },
  );
  const gitLabPartial = transitionEvent(
    'gitlab-read-partial',
    '2026-07-15T11:06:00.000Z',
    'provider_read_partial',
    'monitoring/partial',
    {
      source: 'gitlab',
      subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'MATRIX-1' },
      metadata: { transitionKind: 'provider_read_partial', readState: 'partial', mergeRequestIid: 77 },
    },
  );
  assert.deepEqual(
    currentAttentionTransitions([gitLabMr, gitLabPartial], [session]).map(event => event.id),
    ['gitlab-read-partial'],
  );

  const sameTimestampRecovery = { ...sonarReadRecovered, id: 'same-time-read-recovery', at: '2026-07-15T11:07:00.000Z' };
  const sameTimestampGate = {
    ...sonarGate,
    id: 'same-time-gate-current',
    at: '2026-07-15T11:07:00.000Z',
    metadata: { ...sonarGate.metadata, transitionKind: 'sonar_gate_recovered' },
  };
  assert.deepEqual(
    currentAttentionTransitions([sameTimestampRecovery, sameTimestampGate], [session]).map(event => event.id),
    ['same-time-gate-current'],
    'later append order wins when provider observations share one timestamp',
  );
  const sameTimestampPartial = {
    ...sonarReadFailed,
    id: 'same-time-read-partial',
    at: '2026-07-15T11:08:00.000Z',
    after: { state: 'monitoring/partial', fingerprint: 'same-time-read-partial-fingerprint' },
    metadata: {
      ...sonarReadFailed.metadata,
      transitionKind: 'provider_read_partial',
      readState: 'partial',
    },
  };
  const sameTimestampPartialGate = {
    ...sonarGate,
    id: 'same-time-partial-gate',
    at: '2026-07-15T11:08:00.000Z',
  };
  assert.deepEqual(
    currentAttentionTransitions([sameTimestampPartial, sameTimestampPartialGate], [session]).map(event => event.id),
    ['same-time-read-partial'],
    'same-poll partial read health remains actionable even when bounded quality evidence was retained afterward',
  );
});

test('Attention projection rebuilds after restart without stale-row resurrection', () => {
  const session = workSession();
  const oldFailure = transitionEvent('failure-old', '2026-07-15T12:00:00.000Z', 'provider_read_failed', 'failed');
  const recovery = transitionEvent('recovery-current', '2026-07-15T12:01:00.000Z', 'provider_read_recovered', 'complete');
  const sonar = transitionEvent('sonar-current', '2026-07-15T12:02:00.000Z', 'sonar_gate_failed', 'ERROR', {
    source: 'sonar',
    subject: { kind: 'quality-gate', id: 'app:main', project: 'Application', ticketKey: 'MATRIX-1' },
  });
  const audit = [oldFailure, recovery, sonar];
  const first = currentAttentionTransitions(audit, [session]);
  assert.deepEqual(first.map(event => event.id), ['sonar-current', 'recovery-current']);

  const acknowledged = {
    schemaVersion: 1,
    id: 'ack-recovery-current',
    at: '2026-07-15T12:03:00.000Z',
    sessionId: session.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: 'Acknowledged current GitLab health.',
    metadata: { acknowledgedEventId: recovery.id },
  };
  const reloadedAudit = JSON.parse(JSON.stringify([...audit, acknowledged]));
  const afterRestart = currentAttentionTransitions(reloadedAudit, [JSON.parse(JSON.stringify(session))]);
  assert.deepEqual(afterRestart.map(event => event.id), ['sonar-current']);
  assert.equal(afterRestart.some(event => event.id === oldFailure.id), false, 'acknowledging newest state must not resurrect stale history');
  assert.equal(reloadedAudit.filter(event => event.type === 'provider.transition').length, 3, 'the append-only audit still reconstructs all transitions');

  const laterFailure = transitionEvent('failure-later', '2026-07-15T12:04:00.000Z', 'provider_read_failed', 'failed');
  assert.deepEqual(
    currentAttentionTransitions([...reloadedAudit, laterFailure], [session]).map(event => event.id),
    ['failure-later', 'sonar-current'],
    'a later real change becomes current even after the prior state was acknowledged',
  );
});

test('Attention gives one registered project ownership of the same MR across legacy ticket sessions', () => {
  const attachedAt = '2026-07-15T12:00:00.000Z';
  const legacyTicketSession = {
    ...workSession(),
    id: 'session-legacy-ticket',
    projectName: 'MATRIX',
    providerBindings: [binding(
      'binding-legacy-mr',
      'gitlab',
      'merge-request',
      '77',
      attachedAt,
      'https://gitlab.example/group/application/-/merge_requests/77',
      'group/application',
    )],
  };
  const projectSession = {
    ...workSession(),
    id: 'session-project-owner',
    kind: 'standalone',
    projectName: 'Application',
    projectPath: '/workspace/application',
    providerBindings: [binding(
      'binding-project-mr',
      'gitlab',
      'merge-request',
      '77',
      attachedAt,
      'https://gitlab.example/group/application/-/merge_requests/77',
      'group/application',
    )],
  };
  delete projectSession.ticketKey;
  const projectEvent = resourceTransition(
    'project-owned-mr',
    '2026-07-15T17:00:00.000Z',
    'gitlab',
    'merge-request',
    '77',
    'initial_mr_observed',
    { mergeRequestIid: 77 },
  );
  projectEvent.sessionId = projectSession.id;
  delete projectEvent.subject.project;
  const newerLegacyEvent = resourceTransition(
    'legacy-ticket-mr-newer',
    '2026-07-15T17:01:00.000Z',
    'gitlab',
    'merge-request',
    '77',
    'review_activity_added',
    { mergeRequestIid: 77, reviewActivityCount: 3 },
  );
  newerLegacyEvent.sessionId = legacyTicketSession.id;
  delete newerLegacyEvent.subject.project;
  const sessions = [legacyTicketSession, projectSession];
  const projects = [{ name: 'Application', path: '/workspace/application' }];

  assert.deepEqual(
    currentAttentionTransitions([projectEvent, newerLegacyEvent], sessions, projects).map(event => event.id),
    ['legacy-ticket-mr-newer'],
    'the latest state wins while the legacy ticket copy and project copy become one stream',
  );
  const projectedSession = attentionProjectSessionForEvent(
    newerLegacyEvent,
    legacyTicketSession,
    sessions,
    projects,
  );
  assert.equal(projectedSession.projectName, 'Application');
  assert.equal(projectedSession.projectPath, '/workspace/application');
  assert.deepEqual(projectedSession.ticketKeys, ['MATRIX-1'], 'optional Jira context remains attached to the row');

  const acknowledgement = {
    schemaVersion: 1,
    id: 'ack-legacy-ticket-mr-newer',
    at: '2026-07-15T17:02:00.000Z',
    sessionId: legacyTicketSession.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: 'Cleared the canonical project MR row.',
    metadata: { acknowledgedEventId: newerLegacyEvent.id },
  };
  assert.deepEqual(
    currentAttentionTransitions([projectEvent, newerLegacyEvent, acknowledgement], sessions, projects),
    [],
    'clearing the canonical row must not resurrect the older project or ticket copy',
  );
});

test('Attention read-health state replaces failure, recovery, partial, and later failure in one stream', () => {
  const session = workSession();
  const states = [
    transitionEvent('health-failed-first', '2026-07-15T14:00:00.000Z', 'provider_read_failed', 'failed', {
      metadata: {
        transitionKind: 'provider_read_failed',
        mergeRequestIid: 77,
        readState: 'failed',
        readReason: 'timeout',
        readComponents: 'merge-request',
      },
    }),
    transitionEvent('health-recovered', '2026-07-15T14:01:00.000Z', 'provider_read_recovered', 'complete', {
      metadata: {
        transitionKind: 'provider_read_recovered',
        mergeRequestIid: 77,
        readState: 'complete',
        readReason: 'complete',
        readComponents: 'none',
      },
    }),
    transitionEvent('health-partial', '2026-07-15T14:02:00.000Z', 'provider_read_partial', 'partial', {
      metadata: {
        transitionKind: 'provider_read_partial',
        mergeRequestIid: 77,
        readState: 'partial',
        readReason: 'bounded_read_incomplete',
        readComponents: 'discussions,notes',
      },
    }),
    transitionEvent('health-failed-later', '2026-07-15T14:03:00.000Z', 'provider_read_failed', 'failed', {
      metadata: {
        transitionKind: 'provider_read_failed',
        mergeRequestIid: 77,
        readState: 'failed',
        readReason: 'authentication',
        readComponents: 'merge-request',
      },
    }),
  ];

  for (let index = 0; index < states.length; index += 1) {
    assert.deepEqual(
      currentAttentionTransitions(states.slice(0, index + 1), [session]).map(event => event.id),
      [states[index].id],
      'each meaningful read-health change replaces the prior current row',
    );
  }

  const acknowledgement = {
    schemaVersion: 1,
    id: 'ack-health-failed-later',
    at: '2026-07-15T14:04:00.000Z',
    sessionId: session.id,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: 'Acknowledged the newest provider-read state.',
    metadata: { acknowledgedEventId: states.at(-1).id },
  };
  const audit = [...states, acknowledgement];
  assert.deepEqual(currentAttentionTransitions(audit, [session]), []);
  assert.equal(audit.filter(event => event.type === 'provider.transition').length, 4);
});

test('Attention collapses newer pipeline, build, test, gate, and issue occurrences without deleting audit history', () => {
  const session = workSession();
  const events = [
    resourceTransition('pipeline-failed', '2026-07-15T15:00:00.000Z', 'gitlab', 'pipeline', '100', 'pipeline_failed', {
      mergeRequestIid: 77,
      pipelineId: 100,
    }),
    resourceTransition('pipeline-jobs', '2026-07-15T15:01:00.000Z', 'gitlab', 'pipeline', '100', 'blocking_jobs_failed', {
      mergeRequestIid: 77,
      pipelineId: 100,
    }),
    resourceTransition('pipeline-tests-new', '2026-07-15T15:02:00.000Z', 'gitlab', 'pipeline', '101', 'tests_failed', {
      mergeRequestIid: 77,
      pipelineId: 101,
    }),
    resourceTransition('jenkins-failed', '2026-07-15T15:03:00.000Z', 'jenkins', 'build', '31', 'jenkins_failed', {
      buildNumber: 31,
    }),
    resourceTransition('jenkins-stages', '2026-07-15T15:04:00.000Z', 'jenkins', 'build', '31', 'jenkins_stages_failed', {
      buildNumber: 31,
    }),
    resourceTransition('jenkins-tests-new', '2026-07-15T15:05:00.000Z', 'jenkins', 'build', '32', 'jenkins_tests_failed', {
      buildNumber: 32,
    }),
    resourceTransition('sonar-gate', '2026-07-15T15:06:00.000Z', 'sonar', 'quality-gate', 'app:main', 'sonar_gate_failed', {
      projectKey: 'app',
      branch: 'main',
    }),
    resourceTransition('sonar-issues', '2026-07-15T15:07:00.000Z', 'sonar', 'quality-gate', 'app:main', 'sonar_issues_increased', {
      projectKey: 'app',
      branch: 'main',
    }),
    resourceTransition('sonar-feature', '2026-07-15T15:08:00.000Z', 'sonar', 'quality-gate', 'app:feature', 'sonar_gate_failed', {
      projectKey: 'app',
      branch: 'feature',
    }),
  ];
  const reloadedAudit = JSON.parse(JSON.stringify(events));
  assert.deepEqual(
    currentAttentionTransitions(reloadedAudit, [JSON.parse(JSON.stringify(session))]).map(event => event.id),
    ['sonar-feature', 'sonar-issues', 'jenkins-tests-new', 'pipeline-tests-new'],
  );
  assert.equal(reloadedAudit.length, 9, 'the append-only audit retains every stale occurrence and current row');
});

test('Attention presentation covers information, warning, failure, recovery, partial, and blocked severities', () => {
  const cases = [
    ['information', 'charts.green', 'initial_mr_observed', 'opened/mergeable'],
    ['warning', 'charts.yellow', 'changes_requested', 'opened/requested_changes'],
    ['failure', 'charts.red', 'pipeline_failed', 'failed'],
    ['recovery', 'charts.green', 'pipeline_recovered', 'success'],
    ['partial', 'charts.yellow', 'provider_read_partial', 'monitoring/partial'],
    ['blocked', 'charts.red', 'monitoring_blocked', 'monitoring/blocked'],
  ];
  for (const [expected, color, transitionKind, state] of cases) {
    assert.equal(
      attention.attentionSeverity(transitionEvent(`severity-${expected}`, '2026-07-15T16:00:00.000Z', transitionKind, state)),
      expected,
    );
    assert.equal(attention.attentionSeverityColorId(expected), color);
  }
  const providers = [
    ['gitlab', 'git-pull-request'],
    ['jenkins', 'server-process'],
    ['sonar', 'shield'],
  ];
  for (const [provider, icon] of providers) {
    assert.equal(attention.attentionProviderIconId(provider), icon);
    for (const [severity, color] of cases) {
      assert.equal(attention.attentionSeverityColorId(severity), color, `${provider} ${severity} color`);
    }
  }
  assert.equal(attention.attentionProviderIconId('jira'), undefined);
});

test('Attention rows expose project, provider, subject, observed time, changed time, and why', () => {
  const session = {
    ...workSession(),
    monitoring: { enabled: true, lastAttemptAt: '2026-07-15T16:02:00.000Z' },
  };
  const event = resourceTransition(
    'visible-row',
    '2026-07-15T16:01:00.000Z',
    'gitlab',
    'merge-request',
    '77',
    'changes_requested',
    { mergeRequestIid: 77 },
  );
  const presented = attention.attentionEventPresentation(event, session);
  assert.equal(presented.project, 'Application');
  assert.equal(presented.provider, 'GitLab');
  assert.equal(presented.subject, 'MR !77');
  assert.equal(presented.observedAt, session.monitoring.lastAttemptAt);
  assert.equal(presented.changedAt, event.at);
  assert.equal(presented.why, 'MATRIX-1 MR !77 has requested changes.');
  assert.match(presented.description, /^GitLab • Needs review • /);
  assert.doesNotMatch(presented.description, /Application|MR !77|observed|changed/i);
});

test('Attention headlines explain delivery impact instead of internal provider transitions', () => {
  const recoveredRead = transitionEvent(
    'headline-read-recovered',
    '2026-07-15T16:02:00.000Z',
    'provider_read_recovered',
    'monitoring/complete',
    {
      subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'MATRIX-1' },
      metadata: { transitionKind: 'provider_read_recovered', mergeRequestIid: 77, readState: 'complete' },
    },
  );
  assert.equal(
    attention.attentionEventHeadline(recoveredRead),
    'MATRIX-1 MR !77 review and pipeline data is current again.',
  );
  assert.equal(
    attention.attentionEventHeadline(resourceTransition(
      'headline-pipeline',
      '2026-07-15T16:03:00.000Z',
      'gitlab',
      'pipeline',
      '412',
      'pipeline_recovered',
      { pipelineId: 412 },
    )),
    'MATRIX-1 Pipeline 412 is passing again.',
  );
  assert.equal(
    attention.attentionEventHeadline(resourceTransition(
      'headline-sonar',
      '2026-07-15T16:04:00.000Z',
      'sonar',
      'quality-gate',
      'app:main',
      'sonar_issues_decreased',
      { projectKey: 'app', branch: 'main', unresolvedIssueCount: 2, issueDelta: -4 },
    )),
    'MATRIX-1 SonarQube reports 2 unresolved issues for main (down 4).',
  );
  assert.equal(
    attention.attentionEventHeadline(transitionEvent(
      'headline-partial',
      '2026-07-15T16:05:00.000Z',
      'provider_read_partial',
      'monitoring/partial',
      {
        subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'MATRIX-1' },
        metadata: {
          transitionKind: 'provider_read_partial',
          mergeRequestIid: 77,
          readState: 'partial',
          readComponents: 'approvals,discussions',
        },
      },
    )),
    'MATRIX-1 MR !77 review and pipeline data is incomplete: approvals, review discussions. Available results remain visible.',
  );

  const allUserFacingKinds = [
    'monitoring_blocked', 'monitoring_recovered',
    'provider_read_failed', 'provider_read_partial', 'provider_read_recovered',
    'initial_mr_observed', 'initial_mr_attention', 'open_mr_reminder',
    'merge_request_merged', 'merge_request_closed', 'merge_request_reopened', 'merge_request_state_changed',
    'changes_requested', 'changes_request_cleared', 'approval_satisfied', 'approval_required',
    'approval_state_changed', 'reviewers_changed', 'unresolved_discussions_observed',
    'unresolved_discussions_increased', 'unresolved_discussions_decreased', 'unresolved_discussions_changed',
    'review_activity_added', 'review_activity_changed',
    'new_pipeline', 'pipeline_failed', 'pipeline_canceled', 'pipeline_recovered', 'pipeline_succeeded',
    'blocking_jobs_failed', 'blocking_jobs_recovered', 'tests_failed', 'tests_recovered',
    'jenkins_new_build', 'jenkins_failed', 'jenkins_recovered', 'jenkins_succeeded',
    'jenkins_tests_failed', 'jenkins_tests_recovered', 'jenkins_stages_failed', 'jenkins_stages_recovered',
    'sonar_gate_failed', 'sonar_gate_recovered', 'sonar_issues_increased', 'sonar_issues_decreased',
    'initial_healthy', 'initial_unhealthy',
  ];
  for (const kind of allUserFacingKinds) {
    const isJenkins = kind.startsWith('jenkins_');
    const isSonar = kind.startsWith('sonar_') || kind.startsWith('initial_');
    const isPipeline = ['new_pipeline', 'pipeline_failed', 'pipeline_canceled', 'pipeline_recovered', 'pipeline_succeeded',
      'blocking_jobs_failed', 'blocking_jobs_recovered', 'tests_failed', 'tests_recovered'].includes(kind);
    const isMonitoring = kind.startsWith('monitoring_');
    const source = isJenkins ? 'jenkins' : isSonar ? 'sonar' : isMonitoring ? 'kronos' : 'gitlab';
    const subject = isJenkins
      ? { kind: 'build', id: '412', project: 'Application', ticketKey: 'MATRIX-1' }
      : isSonar
        ? { kind: 'quality-gate', id: 'app:main', project: 'Application', ticketKey: 'MATRIX-1' }
        : isMonitoring
          ? { kind: 'monitoring-blocker', id: 'provider-configuration', project: 'Application', ticketKey: 'MATRIX-1' }
          : isPipeline
            ? { kind: 'pipeline', id: '412', project: 'Application', ticketKey: 'MATRIX-1' }
            : { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'MATRIX-1' };
    const headline = attention.attentionEventHeadline(transitionEvent(
      `headline-${kind}`,
      '2026-07-15T16:06:00.000Z',
      kind,
      kind.includes('failed') ? 'failed' : 'success',
      {
        source,
        subject,
        metadata: {
          transitionKind: kind,
          mergeRequestIid: 77,
          pipelineId: 412,
          buildNumber: 412,
          branch: 'main',
          failedJobCount: 2,
          failedTestCount: 3,
          failedStageCount: 1,
          unresolvedIssueCount: 4,
          unresolvedDiscussionCount: 2,
          approvalCount: 1,
          approvalsLeft: 1,
          reviewerCount: 2,
          reviewActivityCount: 3,
          issueDelta: kind.endsWith('decreased') ? -2 : 2,
          readReason: 'timeout',
          readComponents: 'approvals,discussions',
          changesRequested: true,
        },
      },
    ));
    assert.match(headline, /MATRIX-1/);
    assert.doesNotMatch(headline, /provider reads?|provider recovered|fixture|_/i, `${kind} leaked internal vocabulary: ${headline}`);
  }
});

test('Attention action contexts expose validated ticket and registered-project evidence actions', () => {
  const session = workSession();
  const gitlab = resourceTransition('gitlab-action', '2026-07-15T16:03:00.000Z', 'gitlab', 'merge-request', '77', 'initial_mr_observed');
  const ticketKey = attention.attentionTicketKey(gitlab, session);
  assert.equal(ticketKey, 'MATRIX-1');
  assert.equal(
    attention.attentionActionContext('gitlab', ticketKey, 'https://gitlab.example/group/app/-/merge_requests/77'),
    'attention_provider_ticket_gitlab',
  );
  assert.equal(attention.attentionActionContext('gitlab', ticketKey, undefined), 'attention_repair_ticket_gitlab');
  assert.equal(attention.attentionActionContext('jenkins', ticketKey, 'https://jenkins.example/job/app/2/'), 'attention_provider_ticket_ci');
  assert.equal(attention.attentionActionContext('kronos', ticketKey, undefined), 'attention_repair_ticket');

  const unlinkedStandalone = { ...session, kind: 'standalone', ticketKeys: [] };
  delete unlinkedStandalone.ticketKey;
  assert.equal(attention.attentionTicketKey(gitlab, unlinkedStandalone), undefined);
  assert.equal(attention.attentionTicketKey({ ...gitlab, subject: { ...gitlab.subject, ticketKey: 'OTHER-2' } }, session), undefined);
  assert.equal(attention.attentionActionContext('gitlab', undefined, undefined), 'attention_repair');
  assert.equal(attention.attentionActionContext('gitlab', undefined, undefined, 'app'), 'attention_repair_project_gitlab');
  assert.equal(
    attention.attentionActionContext('jenkins', undefined, 'https://jenkins.example/job/app/2/', 'app'),
    'attention_provider_project_ci',
  );
  assert.equal(
    attention.attentionActionContext('gitlab', 'JIRA-123', 'https://gitlab.example/group/app/-/merge_requests/7', 'app'),
    'attention_provider_project_ticket_gitlab',
    'project provider context wins while the validated ticket remains a secondary action',
  );
});

test('Attention Jenkins builds and SonarQube branches are validated and latest-first', () => {
  const session = {
    ...workSession(),
    providerBindings: [
      binding('sonar-one', 'sonar', 'quality-gate', 'app:feature/one', '2026-07-15T16:04:00.000Z', 'https://sonar.example/dashboard?id=app&branch=feature%2Fone', 'app'),
      binding('sonar-two', 'sonar', 'quality-gate', 'app:feature/two', '2026-07-15T16:04:00.000Z', 'https://sonar.example/dashboard?id=app&branch=feature%2Ftwo', 'app'),
      binding('sonar-invalid', 'sonar', 'quality-gate', 'app:invalid', '2026-07-15T16:05:00.000Z', 'file:///tmp/sonar', 'app'),
    ],
  };
  const sonar = resourceTransition('sonar-choices', '2026-07-15T16:06:00.000Z', 'sonar', 'quality-gate', 'app:feature/one', 'sonar_gate_failed', { projectKey: 'app', branch: 'feature/one' });
  assert.deepEqual(
    attention.attentionProviderChoicesForEvent(sonar, session).map(choice => choice.label),
    ['feature/two', 'feature/one'],
  );
  session.providerBindings = [
    binding('build-31', 'jenkins', 'build', '31', '2026-07-15T16:07:00.000Z', 'https://jenkins.example/job/app/31/'),
    binding('build-32', 'jenkins', 'build', '32', '2026-07-15T16:08:00.000Z', 'https://jenkins.example/job/app/32/'),
  ];
  const jenkins = resourceTransition('jenkins-choices', '2026-07-15T16:09:00.000Z', 'jenkins', 'build', '31', 'jenkins_failed', { buildNumber: 31 });
  assert.deepEqual(
    attention.attentionProviderChoicesForEvent(jenkins, session).map(choice => choice.label),
    ['Jenkins build 32', 'Jenkins build 31'],
  );
});

test('Attention action language limits live clearing to completed CI results', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = new Map(manifest.contributes.commands.map(command => [command.command, command.title]));
  assert.equal(commands.get('kronos.acknowledgeAttention'), 'Kronos: Clear from Attention');
  assert.equal(commands.get('kronos.insertAttentionEventContext'), 'Kronos: Use Attention Event in Prompt');
  const menus = manifest.contributes.menus['view/item/context'].filter(menu => String(menu.when).includes('attention_'));
  assert.ok(menus.some(menu => menu.command === 'kronos.openWorkSessionAudit'));
  assert.ok(menus.some(menu => menu.command === 'kronos.openProvider' && menu.when.includes('live_provider')));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertAttentionEventContext' && menu.when.endsWith('_event$/')));
  const clearMenus = menus.filter(menu => menu.command === 'kronos.acknowledgeAttention');
  assert.equal(clearMenus.length, 2);
  assert.ok(clearMenus.some(menu => menu.group === 'inline@2' && menu.when.includes('_clearable')));
  assert.ok(clearMenus.some(menu =>
    menu.group === 'management@1'
    && menu.when.includes('live_')
    && menu.when.includes('_clearable')
  ));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertGitLabContext' && menu.when.includes('_ticket_gitlab')));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertCiContext' && menu.when.includes('_ticket_ci')));
  assert.ok(menus.some(menu => menu.command === 'kronos.openTicketWorkspace' && menu.when.includes('(project_)?ticket')));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertProjectGitLabContext' && menu.when.includes('project(_ticket)?_gitlab')));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertProjectCiContext' && menu.when.includes('project(_ticket)?_ci')));
  assert.equal(menus.some(menu => /connect provider|approve|retry build|run build|create merge request/i.test(commands.get(menu.command) || '')), false);
});

function mrDigest(overrides = {}) {
  const snapshot = {
    mr: {
      iid: 77,
      state: overrides.state || 'opened',
      detailed_merge_status: overrides.detailedStatus || 'mergeable',
      updated_at: '2026-07-15T12:00:00.000Z',
      web_url: 'https://gitlab.example/group/app/-/merge_requests/77',
      reviewers: overrides.reviewers || [{ id: 1 }],
    },
    approvals: {
      approved: overrides.approved === true,
      approvals_required: overrides.approvalsRequired ?? 1,
      approvals_left: overrides.approvalsLeft ?? (overrides.approved ? 0 : 1),
      approved_by: overrides.approvedBy || [],
    },
    discussions: overrides.discussions || [],
    notes: overrides.notes || [],
    fetchedAt: '2026-07-15T12:00:01.000Z',
    completeness: {
      approvalsComplete: true,
      discussionsComplete: overrides.discussionsComplete !== false,
      notesComplete: overrides.notesComplete !== false,
    },
  };
  return requiredDigest(mergeRequests.normalizeGitLabMergeRequestDigest(snapshot), 'merge request');
}

function pipelineDigest(overrides = {}) {
  const failedTests = overrides.failedTests || 0;
  return requiredDigest(pipelines.normalizeGitLabPipelineDigest({
    mr: { head_pipeline: {
      id: overrides.id || 70,
      status: overrides.status || 'running',
      web_url: `https://gitlab.example/group/app/-/pipelines/${overrides.id || 70}`,
    } },
    jobs: overrides.jobs || [],
    testReportSummary: {
      total: { count: 10, failed: failedTests, error: 0, skipped: 0, success: 10 - failedTests },
    },
    fetchedAt: '2026-07-15T12:00:00.000Z',
    completeness: {
      jobsComplete: overrides.jobsComplete !== false,
      testsComplete: overrides.testsComplete !== false,
    },
  }), 'pipeline');
}

function jenkinsDigest(overrides = {}) {
  const buildNumber = overrides.buildNumber || 11;
  return requiredDigest(ci.normalizeJenkinsCiDigest({
    schemaVersion: 1,
    provider: 'jenkins',
    jobOrBuildUrl: 'https://jenkins.example/job/app',
    buildUrl: `https://jenkins.example/job/app/${buildNumber}`,
    buildNumber,
    status: overrides.status || 'running',
    building: overrides.status === 'running',
    testsAvailable: overrides.testsAvailable !== false,
    failedTestCount: overrides.failedTestCount || 0,
    stagesAvailable: overrides.stagesAvailable !== false,
    failedStageNames: overrides.failedStageNames || [],
    failedStageNamesTruncated: false,
  }), 'Jenkins');
}

function sonarDigest(overrides = {}) {
  return requiredDigest(ci.normalizeSonarCiDigest({
    schemaVersion: 1,
    provider: 'sonarqube',
    projectKey: 'app:key',
    branch: 'main',
    dashboardUrl: 'https://sonar.example/dashboard?id=app%3Akey&branch=main',
    gateAvailable: overrides.gateAvailable !== false,
    gateStatus: overrides.gateStatus || 'OK',
    issueCountAvailable: true,
    unresolvedIssueCount: overrides.unresolvedIssueCount || 0,
    metricsAvailable: true,
    metrics: [],
  }), 'SonarQube');
}

function requiredDigest(value, label) {
  assert.ok(value, `${label} fixture did not normalize`);
  return value;
}

function assertMatrixCoverage(relativeFile, typeName, coveredKinds) {
  const source = fs.readFileSync(path.join(root, relativeFile), 'utf8');
  const start = source.indexOf(`export type ${typeName} =`);
  const end = source.indexOf(';', start);
  assert.ok(start >= 0 && end > start, `could not locate ${typeName}`);
  const declared = [...source.slice(start, end).matchAll(/'([^']+)'/g)].map(match => match[1]).sort();
  assert.deepEqual([...new Set(coveredKinds)].sort(), declared, `${typeName} declarations and matrix cases drifted`);
}

function transitionEvent(id, at, transitionKind, state, overrides = {}) {
  return {
    schemaVersion: 1,
    id,
    at,
    sessionId: 'session-matrix-1',
    type: 'provider.transition',
    source: 'gitlab',
    summary: `${transitionKind} fixture`,
    subject: { kind: 'provider-read', id: 'gitlab:77', project: 'Application', ticketKey: 'MATRIX-1' },
    after: { state, fingerprint: `${id}-fingerprint` },
    metadata: { transitionKind, readState: state, readReason: state },
    ...overrides,
  };
}

function resourceTransition(id, at, source, kind, subjectId, transitionKind, metadata = {}) {
  return transitionEvent(id, at, transitionKind, transitionKind, {
    source,
    subject: { kind, id: subjectId, project: 'Application', ticketKey: 'MATRIX-1' },
    metadata: { transitionKind, ...metadata },
  });
}

function workSession() {
  return {
    schemaVersion: 1,
    id: 'session-matrix-1',
    kind: 'ticket',
    ticketKey: 'MATRIX-1',
    ticketKeys: ['MATRIX-1'],
    title: 'Transition matrix session',
    projectName: 'Application',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
  };
}

function activeAttentionOwner() {
  return {
    ...workSession(),
    id: 'project-monitor-active-attention',
    kind: 'standalone',
    ticketKeys: [],
    title: 'Application provider monitoring',
    projectName: 'Application',
    projectPath: '/projects/application',
    providerBindings: [
      binding('gitlab-mr', 'gitlab', 'merge-request', '77', '2026-07-15T12:00:00.000Z', 'https://gitlab.example/group/app/-/merge_requests/77', 'group/app'),
      binding('jenkins-job', 'jenkins', 'job', 'configured', '2026-07-15T12:00:00.000Z', 'https://jenkins.example/job/app'),
      binding('sonar-gate', 'sonar', 'quality-gate', 'app:key:main', '2026-07-15T12:00:00.000Z', 'https://sonar.example/dashboard?id=app%3Akey&branch=main', 'app:key'),
    ],
    monitoring: {
      enabled: true,
      lastAttemptAt: '2026-07-15T12:10:00.000Z',
    },
  };
}

function activeAttentionInput(owner, overrides = {}) {
  return {
    projectName: 'Application',
    projectPath: '/projects/application',
    displayName: 'Customer API',
    owner,
    events: [],
    ...overrides,
  };
}

function exactSnapshotEvent(owner, id, source, kind, subjectId, fingerprint) {
  return {
    schemaVersion: 1,
    id,
    at: '2026-07-15T12:09:00.000Z',
    sessionId: owner.id,
    type: 'provider.transition',
    source,
    summary: `${source} exact current event`,
    subject: { kind, id: subjectId, project: owner.projectName },
    after: { state: 'current', fingerprint },
    metadata: { transitionKind: 'current_fixture' },
  };
}

function binding(id, provider, resource, subjectId, attachedAt, url, projectId) {
  return { id, provider, resource, subjectId, attachedAt, url, ...(projectId ? { projectId } : {}) };
}
