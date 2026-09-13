import * as crypto from 'crypto';
import type { CiMonitorDigest, JenkinsCiDigest, SonarCiDigest } from './ciTransitions';
import {
  jenkinsStatusIsFailure,
  jenkinsStatusIsSuccess,
  sonarGateStatusIsFailure,
  sonarGateStatusIsSuccess,
} from './ciTransitions';
import type {
  GitLabMergeRequestDigest,
} from './gitlabMergeRequestTransitions';
import { gitLabMergeRequestNeedsAttention } from './gitlabMergeRequestTransitions';
import type { GitLabMergeRequestReadStatus } from './gitlabMergeRequestMonitorStore';
import type { MonitorEvent, MonitorEventSource } from './monitorEventStore';
import type { GitLabPipelineDigest } from './pipelineTransitions';
import { gitLabPipelineStatusIsUnhealthy } from './pipelineTransitions';
import type { AttentionSeverity } from './attentionPresentation';
import type { WorkSessionRecord } from './workSessionStore';

export type ActiveAttentionProjectState =
  | 'needs-fixes'
  | 'status-incomplete'
  | 'ready-for-review'
  | 'ready-to-merge'
  | 'in-progress';

type SonarAttentionTarget = Pick<SonarCiDigest, 'projectKey' | 'branch'>;

export interface ActiveAttentionProjectInput {
  projectName: string;
  projectPath: string;
  displayName?: string;
  owner: WorkSessionRecord;
  events: readonly MonitorEvent[];
  mergeRequest?: GitLabMergeRequestDigest | null;
  pipeline?: GitLabPipelineDigest | null;
  ci?: CiMonitorDigest | null;
  gitLabRead?: GitLabMergeRequestReadStatus | null;
  sonarTarget?: SonarAttentionTarget;
  snapshotError?: boolean;
}

export interface ActiveAttentionRow {
  event: MonitorEvent;
  severity: AttentionSeverity;
  providerUrl?: string | undefined;
  exactEvent: boolean;
  dismissible: boolean;
}

export interface ActiveAttentionProject {
  projectName: string;
  projectPath: string;
  displayName?: string;
  owner: WorkSessionRecord;
  state: ActiveAttentionProjectState;
  observedAt: string;
  changedAt: string;
  rows: ActiveAttentionRow[];
}

const ACTIVE_PIPELINE_STATES = new Set([
  'created',
  'manual',
  'pending',
  'preparing',
  'running',
  'scheduled',
  'waiting_for_resource',
]);
const SUCCESS_PIPELINE_STATES = new Set(['pass', 'passed', 'success', 'succeeded', 'successful']);

/**
 * Builds the current project-owned delivery monitor. Completed healthy work is
 * omitted; an open MR, an in-flight build, or an unresolved problem keeps the
 * project visible.
 */
export function activeAttentionProject(
  input: ActiveAttentionProjectInput,
): ActiveAttentionProject | null {
  const events = newestFirst(input.events.filter(event => event.sessionId === input.owner.id));
  const mergeRequestOpen = isOpenMergeRequest(input.mergeRequest);
  const pipelineActive = Boolean(input.pipeline && pipelineIsActive(input.pipeline));
  const pipelineFailed = Boolean(input.pipeline && pipelineIsFailure(input.pipeline));
  const jenkins = input.ci?.jenkins;
  const sonar = input.ci?.sonar;
  const jenkinsActive = Boolean(jenkins?.building);
  const jenkinsFailed = Boolean(jenkins && jenkinsIsFailure(jenkins));
  const sonarFailed = Boolean(sonar && sonarIsFailure(sonar));
  const pipelineEvidenceIncomplete = Boolean(
    input.pipeline && !pipelineActive && (!input.pipeline.jobsComplete || !input.pipeline.testsComplete)
  );
  const jenkinsEvidenceIncomplete = Boolean(
    jenkins && !jenkins.building && (!jenkins.testsAvailable || !jenkins.stagesAvailable)
  );
  const sonarEvidenceIncomplete = Boolean(sonar && !sonar.gateAvailable);
  const gitLabReadProblem = currentGitLabReadProblem(input.gitLabRead, events);
  const gitLabReadIncomplete = Boolean(input.gitLabRead && input.gitLabRead.state !== 'complete');
  const jenkinsReadProblem = currentProviderReadProblem(events, 'jenkins');
  const sonarTarget = input.sonarTarget || (sonar
    ? { projectKey: sonar.projectKey, branch: sonar.branch }
    : undefined);
  const sonarReadProblem = currentProviderReadProblem(events, 'sonar', sonarTarget);
  const monitoringBlocker = currentMonitoringBlocker(events);
  const monitoringHealthIncomplete = Boolean(input.owner.monitoring.currentError);
  const snapshotIncomplete = input.snapshotError === true;
  const reviewProblem = Boolean(
    mergeRequestOpen && input.mergeRequest && gitLabMergeRequestNeedsAttention(input.mergeRequest)
  );
  const rows: ActiveAttentionRow[] = [];
  if (monitoringBlocker) {
    rows.push(rowFromCurrentEvent(monitoringBlocker, 'blocked'));
  }
  if (snapshotIncomplete && !monitoringBlocker) {
    rows.push(syntheticRow(input, {
      source: 'kronos',
      kind: 'monitoring-blocker',
      subjectId: 'snapshot-read',
      summary: 'Current delivery status could not be loaded. Open Check Setup and refresh Attention.',
      state: 'monitoring/unavailable',
      transitionKind: 'live_snapshot_unavailable',
      severity: 'blocked',
    }));
  }
  if (monitoringHealthIncomplete
    && !snapshotIncomplete
    && !monitoringBlocker
    && !gitLabReadProblem
    && !jenkinsReadProblem
    && !sonarReadProblem) {
    rows.push(syntheticRow(input, {
      source: 'kronos',
      kind: 'monitoring-health',
      subjectId: input.projectName,
      summary: 'The latest project check was incomplete. Open Check Setup and check updates again.',
      state: input.owner.monitoring.currentError || 'provider-status-incomplete',
      transitionKind: 'live_monitoring_incomplete',
      severity: 'partial',
    }));
  }

  if (gitLabReadIncomplete) {
    if (gitLabReadProblem) {
      rows.push(rowFromCurrentEvent(gitLabReadProblem, gitLabReadProblem.metadata?.['readState'] === 'partial' ? 'partial' : 'failure'));
    } else {
      const readStatus = input.gitLabRead!;
      const missing = readStatus.components.length > 0
        ? ` Missing: ${readStatus.components.join(', ')}.`
        : '';
      rows.push(syntheticRow(input, {
        source: 'gitlab',
        kind: 'provider-read',
        subjectId: `gitlab-read-${readStatus.generation}`,
        summary: `GitLab status is ${readStatus.state}.${missing}`,
        state: readStatus.state,
        transitionKind: `live_provider_read_${readStatus.state}`,
        severity: readStatus.state === 'partial' ? 'partial' : 'failure',
        providerUrl: input.mergeRequest?.url,
        fingerprint: readStatus.fingerprint,
        metadata: {
          readState: readStatus.state,
          readGeneration: readStatus.generation,
          readReason: readStatus.reason,
          readComponents: readStatus.components.join(','),
        },
      }));
    }
  } else {
    if (input.mergeRequest && mergeRequestOpen) {
      rows.push(mergeRequestRow(input, input.mergeRequest, events));
    }
    if (input.pipeline && (mergeRequestOpen || pipelineActive || pipelineFailed)) {
      rows.push(pipelineRow(input, input.pipeline, events));
    } else if (mergeRequestOpen) {
      rows.push(syntheticRow(input, {
        source: 'gitlab',
        kind: 'pipeline',
        subjectId: 'pending',
        summary: 'Waiting for the merge request pipeline to start.',
        state: 'pending',
        transitionKind: 'live_pipeline_waiting',
        severity: 'information',
        providerUrl: input.mergeRequest?.url,
      }));
    }
  }

  if (jenkinsReadProblem) {
    rows.push(rowFromCurrentEvent(jenkinsReadProblem, jenkinsReadProblem.metadata?.['readState'] === 'partial' ? 'partial' : 'failure'));
  } else if (jenkins && (mergeRequestOpen || jenkinsActive || jenkinsFailed || jenkinsEvidenceIncomplete)) {
    rows.push(jenkinsRow(input, jenkins, events));
  } else if (mergeRequestOpen && providerConfigured(input.owner, 'jenkins')) {
    rows.push(syntheticRow(input, {
      source: 'jenkins',
      kind: 'build',
      subjectId: 'pending',
      summary: 'Waiting for the configured Jenkins build.',
      state: 'pending',
      transitionKind: 'live_jenkins_waiting',
      severity: 'information',
    }));
  }

  if (sonarReadProblem) {
    rows.push(rowFromCurrentEvent(sonarReadProblem, sonarReadProblem.metadata?.['readState'] === 'partial' ? 'partial' : 'failure'));
  } else if (sonar && (mergeRequestOpen || sonarFailed || sonarEvidenceIncomplete)) {
    rows.push(sonarRow(input, sonar, events));
  } else if (mergeRequestOpen && providerConfigured(input.owner, 'sonar')) {
    rows.push(syntheticRow(input, {
      source: 'sonar',
      kind: 'quality-gate',
      subjectId: 'pending',
      summary: 'Waiting for the configured SonarQube quality gate.',
      state: 'pending',
      transitionKind: 'live_sonar_waiting',
      severity: 'information',
    }));
  }

  const acknowledged = acknowledgedAttentionEventIds(events);
  const visibleRows = rows.filter(row => !row.dismissible || !acknowledged.has(row.event.id));
  const dismissedJenkins = rows.some(row =>
    row.dismissible
    && row.event.source === 'jenkins'
    && acknowledged.has(row.event.id)
  );
  const dismissedSonar = rows.some(row =>
    row.dismissible
    && row.event.source === 'sonar'
    && acknowledged.has(row.event.id)
  );
  const hasFailure = pipelineFailed
    || reviewProblem
    || (jenkinsFailed && !dismissedJenkins)
    || (sonarFailed && !dismissedSonar);
  const hasIncomplete = snapshotIncomplete
    || gitLabReadIncomplete
    || pipelineEvidenceIncomplete
    || (jenkinsEvidenceIncomplete && !dismissedJenkins)
    || (sonarEvidenceIncomplete && !dismissedSonar)
    || monitoringHealthIncomplete
    || Boolean(gitLabReadProblem || jenkinsReadProblem || sonarReadProblem || monitoringBlocker);
  const visible = mergeRequestOpen || pipelineActive || jenkinsActive || hasFailure || hasIncomplete;
  if (!visible) { return null; }

  const state = projectState(input, {
    mergeRequestOpen,
    hasFailure,
    hasIncomplete,
    pipeline: input.pipeline,
    jenkins,
    sonar,
  });
  const observedAt = input.owner.monitoring.lastAttemptAt
    || newestTimestamp(rows.map(row => row.event.at))
    || input.owner.updatedAt;
  const changedAt = newestTimestamp(visibleRows.map(row => row.event.at)) || observedAt;
  return {
    projectName: input.projectName,
    projectPath: input.projectPath,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    owner: input.owner,
    state,
    observedAt,
    changedAt,
    rows: visibleRows.sort((left, right) => rowOrder(left, right)),
  };
}

export function activeAttentionProjectStateLabel(state: ActiveAttentionProjectState): string {
  return {
    'needs-fixes': 'Needs fixes',
    'status-incomplete': 'Status incomplete',
    'ready-for-review': 'Ready for review',
    'ready-to-merge': 'Ready to merge',
    'in-progress': 'In progress',
  }[state];
}

export function activeAttentionProjectStateSeverity(state: ActiveAttentionProjectState): AttentionSeverity {
  if (state === 'needs-fixes') { return 'failure'; }
  if (state === 'status-incomplete') { return 'partial'; }
  if (state === 'ready-for-review') { return 'warning'; }
  return 'information';
}

export function activeAttentionProjectSortRank(state: ActiveAttentionProjectState): number {
  return {
    'needs-fixes': 0,
    'status-incomplete': 1,
    'ready-for-review': 2,
    'ready-to-merge': 3,
    'in-progress': 4,
  }[state];
}

/** Pop-ups are reserved for unresolved problems and the review-ready milestone. */
export function activeAttentionNotificationKind(
  event: MonitorEvent,
  projectState: ActiveAttentionProjectState | undefined,
): 'problem' | 'ready-for-review' | undefined {
  const transition = metadataString(event, 'transitionKind');
  const signal = `${transition} ${event.after?.state || ''}`.toLowerCase();
  if (transition === 'monitoring_blocked'
    || transition === 'provider_read_failed'
    || transition === 'provider_read_partial'
    || transition === 'changes_requested'
    || transition === 'initial_mr_attention'
    || transition === 'unresolved_discussions_observed'
    || transition === 'unresolved_discussions_increased'
    || [
      'pipeline_failed',
      'pipeline_canceled',
      'blocking_jobs_failed',
      'tests_failed',
      'jenkins_failed',
      'jenkins_tests_failed',
      'jenkins_stages_failed',
      'sonar_gate_failed',
      'initial_unhealthy',
    ].includes(transition)
    || /\b(?:failed|failure|error|blocked|unhealthy|aborted|cancelled|canceled)\b/.test(signal)) {
    return 'problem';
  }
  if (projectState === 'ready-for-review' && [
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
  ].includes(transition)) {
    return 'ready-for-review';
  }
  return undefined;
}

function projectState(
  input: ActiveAttentionProjectInput,
  current: {
    mergeRequestOpen: boolean;
    hasFailure: boolean;
    hasIncomplete: boolean;
    pipeline?: GitLabPipelineDigest | null | undefined;
    jenkins?: JenkinsCiDigest | undefined;
    sonar?: SonarCiDigest | undefined;
  },
): ActiveAttentionProjectState {
  if (current.hasFailure) { return 'needs-fixes'; }
  if (current.hasIncomplete) { return 'status-incomplete'; }
  if (!current.mergeRequestOpen || !input.mergeRequest) { return 'in-progress'; }
  if (!allConfiguredChecksPass(input.owner, current.pipeline, current.jenkins, current.sonar)) {
    return 'in-progress';
  }
  if (!input.mergeRequest.approvalsComplete || !input.mergeRequest.approval.available) {
    return 'in-progress';
  }
  const approved = input.mergeRequest.approval.approved === true
    || input.mergeRequest.approval.approvalsLeft === 0;
  return approved ? 'ready-to-merge' : 'ready-for-review';
}

function allConfiguredChecksPass(
  owner: WorkSessionRecord,
  pipeline: GitLabPipelineDigest | null | undefined,
  jenkins: JenkinsCiDigest | undefined,
  sonar: SonarCiDigest | undefined,
): boolean {
  if (!pipeline || !pipelineIsSuccess(pipeline)) { return false; }
  if (providerConfigured(owner, 'jenkins') && (!jenkins || !jenkinsIsSuccess(jenkins))) { return false; }
  if (providerConfigured(owner, 'sonar') && (!sonar || !sonarIsSuccess(sonar))) { return false; }
  return true;
}

function mergeRequestRow(
  input: ActiveAttentionProjectInput,
  digest: GitLabMergeRequestDigest,
  events: readonly MonitorEvent[],
): ActiveAttentionRow {
  const severity: AttentionSeverity = gitLabMergeRequestNeedsAttention(digest)
    ? 'warning'
    : 'information';
  const approvals = digest.approvalsComplete && digest.approval.available
    ? digest.approval.approved === true || digest.approval.approvalsLeft === 0
      ? 'approval requirements satisfied'
      : `${digest.approval.approvalsLeft ?? 'more'} approval${digest.approval.approvalsLeft === 1 ? '' : 's'} remaining`
    : 'approval status still loading';
  return currentOrSyntheticRow(input, events, {
    source: 'gitlab',
    kind: 'merge-request',
    subjectId: String(digest.iid),
    fingerprint: digest.fingerprint,
    summary: `MR !${digest.iid} is open; ${approvals}.`,
    state: digest.state,
    transitionKind: 'live_mr_open',
    severity,
    providerUrl: digest.url,
    metadata: {
      mergeRequestIid: digest.iid,
      approvalsLeft: digest.approval.approvalsLeft,
      approvalCount: digest.approval.approvedByCount,
      unresolvedDiscussionCount: digest.unresolvedDiscussions.count,
      changesRequested: digest.changesRequested,
    },
  });
}

function pipelineRow(
  input: ActiveAttentionProjectInput,
  digest: GitLabPipelineDigest,
  events: readonly MonitorEvent[],
): ActiveAttentionRow {
  const failure = pipelineIsFailure(digest);
  const active = pipelineIsActive(digest);
  const incomplete = !active && (!digest.jobsComplete || !digest.testsComplete);
  const severity: AttentionSeverity = failure ? 'failure' : incomplete ? 'partial' : 'information';
  const summary = failure
    ? `Pipeline ${digest.id} failed with ${digest.failedJobs.length} blocking job${digest.failedJobs.length === 1 ? '' : 's'} and ${digest.tests.failed + digest.tests.error} failed test${digest.tests.failed + digest.tests.error === 1 ? '' : 's'}.`
    : active
      ? `Pipeline ${digest.id} is ${displayState(digest.status)}.`
      : incomplete
        ? `Pipeline ${digest.id} passed, but current job or test status is incomplete.`
      : `Pipeline ${digest.id} passed.`;
  return currentOrSyntheticRow(input, events, {
    source: 'gitlab',
    kind: 'pipeline',
    subjectId: String(digest.id),
    fingerprint: digest.fingerprint,
    summary,
    state: digest.status,
    transitionKind: active ? 'live_pipeline_running' : failure ? 'live_pipeline_failed' : 'live_pipeline_passed',
    severity,
    providerUrl: digest.url,
    metadata: {
      pipelineId: digest.id,
      failedJobCount: digest.failedJobs.length,
      failedTestCount: digest.tests.failed + digest.tests.error,
    },
  });
}

function jenkinsRow(
  input: ActiveAttentionProjectInput,
  digest: JenkinsCiDigest,
  events: readonly MonitorEvent[],
): ActiveAttentionRow {
  const failure = jenkinsIsFailure(digest);
  const incomplete = !digest.building && (!digest.testsAvailable || !digest.stagesAvailable);
  const severity: AttentionSeverity = failure ? 'failure' : incomplete ? 'partial' : 'information';
  const summary = digest.building
    ? `Jenkins build #${digest.buildNumber} is running.`
    : failure
      ? `Jenkins build #${digest.buildNumber} failed with ${digest.failedStageNames.length} failed stage${digest.failedStageNames.length === 1 ? '' : 's'} and ${digest.failedTestCount} failed test${digest.failedTestCount === 1 ? '' : 's'}.`
      : incomplete
        ? `Jenkins build #${digest.buildNumber} passed, but current test or stage status is incomplete.`
      : `Jenkins build #${digest.buildNumber} passed.`;
  return currentOrSyntheticRow(input, events, {
    source: 'jenkins',
    kind: 'build',
    subjectId: String(digest.buildNumber),
    fingerprint: digest.fingerprint,
    summary,
    state: digest.building ? 'running' : digest.status,
    transitionKind: digest.building ? 'live_jenkins_running' : failure ? 'live_jenkins_failed' : 'live_jenkins_passed',
    severity,
    dismissible: !digest.building,
    providerUrl: digest.buildUrl,
    metadata: {
      buildNumber: digest.buildNumber,
      failedStageCount: digest.failedStageNames.length,
      failedTestCount: digest.failedTestCount,
    },
  });
}

function sonarRow(
  input: ActiveAttentionProjectInput,
  digest: SonarCiDigest,
  events: readonly MonitorEvent[],
): ActiveAttentionRow {
  const failure = sonarIsFailure(digest);
  const severity: AttentionSeverity = failure ? 'failure' : digest.gateAvailable ? 'information' : 'partial';
  const summary = digest.gateAvailable
    ? `SonarQube quality gate is ${failure ? 'failing' : 'passing'} for ${digest.branch} with ${digest.unresolvedIssueCount} unresolved issue${digest.unresolvedIssueCount === 1 ? '' : 's'}.`
    : `SonarQube quality gate is not yet available for ${digest.branch}.`;
  return currentOrSyntheticRow(input, events, {
    source: 'sonar',
    kind: 'quality-gate',
    subjectId: `${digest.projectKey}:${digest.branch}`,
    fingerprint: digest.fingerprint,
    summary,
    state: digest.gateAvailable ? digest.gateStatus : 'pending',
    transitionKind: digest.gateAvailable ? failure ? 'live_sonar_failed' : 'live_sonar_passed' : 'live_sonar_waiting',
    severity,
    dismissible: digest.gateAvailable,
    providerUrl: digest.dashboardUrl,
    metadata: {
      projectKey: digest.projectKey,
      branch: digest.branch,
      unresolvedIssueCount: digest.unresolvedIssueCount,
    },
  });
}

interface SyntheticRowInput {
  source: MonitorEventSource;
  kind: string;
  subjectId: string;
  summary: string;
  state: string;
  transitionKind: string;
  severity: AttentionSeverity;
  dismissible?: boolean;
  providerUrl?: string | undefined;
  fingerprint?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

function currentOrSyntheticRow(
  input: ActiveAttentionProjectInput,
  events: readonly MonitorEvent[],
  row: SyntheticRowInput,
): ActiveAttentionRow {
  const current = row.fingerprint
    ? events.find(event => event.type === 'provider.transition'
      && event.source === row.source
      && event.subject?.kind === row.kind
      && event.subject.id === row.subjectId
      && event.after?.fingerprint === row.fingerprint)
    : undefined;
  if (current) {
    return {
      event: current,
      severity: row.severity,
      providerUrl: row.providerUrl,
      exactEvent: true,
      dismissible: row.dismissible === true,
    };
  }
  return syntheticRow(input, row);
}

function syntheticRow(
  input: ActiveAttentionProjectInput,
  row: SyntheticRowInput,
): ActiveAttentionRow {
  const at = input.owner.monitoring.lastAttemptAt || input.owner.updatedAt;
  const fingerprint = row.fingerprint || stableId(`${row.source}:${row.kind}:${row.subjectId}:${row.state}`);
  const metadata: Record<string, string | number | boolean | null> = {
    transitionKind: row.transitionKind,
    liveSnapshot: true,
    ...(row.metadata || {}),
  };
  const event: MonitorEvent = {
    schemaVersion: 1,
    id: `live-${stableId(`${input.owner.id}:${row.source}:${row.kind}:${row.subjectId}:${fingerprint}`)}`,
    at,
    sessionId: input.owner.id,
    type: 'provider.transition',
    source: row.source,
    summary: row.summary,
    subject: {
      kind: row.kind,
      id: row.subjectId,
      project: input.projectName,
    },
    after: { state: row.state, fingerprint },
    metadata,
  };
  return {
    event,
    severity: row.severity,
    ...(row.providerUrl ? { providerUrl: row.providerUrl } : {}),
    exactEvent: false,
    dismissible: row.dismissible === true,
  };
}

function rowFromCurrentEvent(event: MonitorEvent, severity: AttentionSeverity): ActiveAttentionRow {
  return { event, severity, exactEvent: true, dismissible: false };
}

function acknowledgedAttentionEventIds(events: readonly MonitorEvent[]): Set<string> {
  const acknowledged = new Set<string>();
  for (const event of events) {
    if (event.type !== 'notification.acknowledged') { continue; }
    const eventId = event.metadata?.['acknowledgedEventId'];
    if (typeof eventId === 'string' && eventId) { acknowledged.add(eventId); }
  }
  return acknowledged;
}

function currentGitLabReadProblem(
  status: GitLabMergeRequestReadStatus | null | undefined,
  events: readonly MonitorEvent[],
): MonitorEvent | undefined {
  if (status) {
    if (status.state === 'complete') { return undefined; }
    const matching = events.find(event => event.source === 'gitlab'
      && event.type === 'provider.transition'
      && event.metadata?.['readState'] === status.state
      && event.metadata?.['readGeneration'] === status.generation);
    if (matching) { return matching; }
    return undefined;
  }
  return currentProviderReadProblem(events, 'gitlab');
}

function currentProviderReadProblem(
  events: readonly MonitorEvent[],
  source: 'gitlab' | 'jenkins' | 'sonar',
  sonarTarget?: SonarAttentionTarget,
): MonitorEvent | undefined {
  const latest = events.find(event => event.source === source
    && event.type === 'provider.transition'
    && (event.subject?.kind === 'provider-read'
      || metadataString(event, 'transitionKind').startsWith('provider_read_'))
    && (!sonarTarget || sonarReadMatchesTarget(event, sonarTarget)));
  const state = metadataString(latest, 'readState');
  return latest && (state === 'failed' || state === 'partial') ? latest : undefined;
}

function sonarReadMatchesTarget(
  event: MonitorEvent,
  target: SonarAttentionTarget,
): boolean {
  const projectKey = metadataString(event, 'projectKey');
  const branch = metadataString(event, 'branch');
  if (!projectKey && !branch) { return true; }
  return projectKey === target.projectKey && branch === target.branch;
}

function currentMonitoringBlocker(events: readonly MonitorEvent[]): MonitorEvent | undefined {
  const latest = events.find(event => event.source === 'kronos'
    && event.type === 'provider.transition'
    && event.subject?.kind === 'monitoring-blocker');
  return latest && metadataString(latest, 'transitionKind') === 'monitoring_blocked' ? latest : undefined;
}

function isOpenMergeRequest(digest: GitLabMergeRequestDigest | null | undefined): boolean {
  const state = digest?.state.trim().toLowerCase();
  return state === 'open' || state === 'opened' || state === 'reopened';
}

function pipelineIsActive(digest: GitLabPipelineDigest): boolean {
  return ACTIVE_PIPELINE_STATES.has(digest.status.trim().toLowerCase());
}

function pipelineIsFailure(digest: GitLabPipelineDigest): boolean {
  return gitLabPipelineStatusIsUnhealthy(digest.status)
    || digest.failedJobs.length > 0
    || digest.tests.failed + digest.tests.error > 0;
}

function pipelineIsSuccess(digest: GitLabPipelineDigest): boolean {
  return SUCCESS_PIPELINE_STATES.has(digest.status.trim().toLowerCase())
    && digest.jobsComplete
    && digest.testsComplete
    && !pipelineIsFailure(digest);
}

function jenkinsIsFailure(digest: JenkinsCiDigest): boolean {
  return jenkinsStatusIsFailure(digest.status)
    || digest.failedTestCount > 0
    || digest.failedStageNames.length > 0;
}

function jenkinsIsSuccess(digest: JenkinsCiDigest): boolean {
  return !digest.building
    && digest.testsAvailable
    && digest.stagesAvailable
    && jenkinsStatusIsSuccess(digest.status)
    && !jenkinsIsFailure(digest);
}

function sonarIsFailure(digest: SonarCiDigest): boolean {
  return digest.gateAvailable && sonarGateStatusIsFailure(digest.gateStatus);
}

function sonarIsSuccess(digest: SonarCiDigest): boolean {
  return digest.gateAvailable && sonarGateStatusIsSuccess(digest.gateStatus);
}

function providerConfigured(owner: WorkSessionRecord, provider: 'jenkins' | 'sonar'): boolean {
  return owner.providerBindings.some(binding => binding.provider === provider);
}

function newestFirst(events: readonly MonitorEvent[]): MonitorEvent[] {
  return events.map((event, index) => ({ event, index }))
    .sort((left, right) => right.event.at.localeCompare(left.event.at)
      || right.index - left.index
      || right.event.id.localeCompare(left.event.id))
    .map(item => item.event);
}

function newestTimestamp(values: readonly string[]): string | undefined {
  return values.filter(Boolean).sort((left, right) => right.localeCompare(left))[0];
}

function rowOrder(left: ActiveAttentionRow, right: ActiveAttentionRow): number {
  const severityRank: Record<AttentionSeverity, number> = {
    failure: 0,
    blocked: 1,
    partial: 2,
    warning: 3,
    information: 4,
    recovery: 5,
  };
  return severityRank[left.severity] - severityRank[right.severity]
    || right.event.at.localeCompare(left.event.at)
    || left.event.id.localeCompare(right.event.id);
}

function metadataString(event: MonitorEvent | undefined, key: string): string {
  const value = event?.metadata?.[key];
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function stableId(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 32);
}

function displayState(value: string): string {
  return value.replace(/[_/.-]+/g, ' ').trim().toLowerCase() || 'running';
}
