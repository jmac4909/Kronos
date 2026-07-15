const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const mergeRequests = require('../out/services/gitlabMergeRequestTransitions.js');
const pipelines = require('../out/services/pipelineTransitions.js');
const ci = require('../out/services/ciTransitions.js');
const { currentAttentionTransitions } = require('../out/services/attentionProjection.js');
const attention = require('../out/services/attentionPresentation.js');

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
  for (const visible of ['Application', 'GitLab', 'MR !77', 'warning', 'observed', 'changed']) {
    assert.match(presented.description, new RegExp(visible.replace(/[!]/g, '\\$&'), 'i'));
  }
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

test('Attention action contexts expose only validated URLs and explicit ticket-source actions', () => {
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

test('Attention action language is read-only or local and explains clear versus audit history', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commands = new Map(manifest.contributes.commands.map(command => [command.command, command.title]));
  assert.equal(commands.get('kronos.acknowledgeAttention'), 'Kronos: Clear Attention Item (Audit Retained)');
  const menus = manifest.contributes.menus['view/item/context'].filter(menu => String(menu.when).includes('attention_'));
  assert.ok(menus.some(menu => menu.command === 'kronos.openWorkSessionAudit'));
  assert.ok(menus.some(menu => menu.command === 'kronos.openProvider' && menu.when === 'viewItem =~ /^attention_provider/'));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertGitLabContext' && menu.when.endsWith('_ticket_gitlab$/')));
  assert.ok(menus.some(menu => menu.command === 'kronos.insertCiContext' && menu.when.endsWith('_ticket_ci$/')));
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
    completeness: { jobsComplete: true, testsComplete: true },
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
    testsAvailable: true,
    failedTestCount: overrides.failedTestCount || 0,
    stagesAvailable: true,
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
    gateAvailable: true,
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

function binding(id, provider, resource, subjectId, attachedAt, url, projectId) {
  return { id, provider, resource, subjectId, attachedAt, url, ...(projectId ? { projectId } : {}) };
}
