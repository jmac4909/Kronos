import type { ProviderPollingViewStatus } from './ticketWorkspaceView';
import { gitLabPipelineStatusIsUnhealthy, type GitLabPipelineDigest } from './pipelineTransitions';
import type {
  GitLabMergeRequestDigest,
  GitLabMergeRequestTransition,
  GitLabMergeRequestTransitionKind,
} from './gitlabMergeRequestTransitions';
import type { GitLabMergeRequestReadStatus } from './gitlabMergeRequestMonitorStore';
import type { GitLabMergeRequestMonitorSnapshot } from './gitlabRestClient';
import type { CiMonitorDigest } from './ciTransitions';
import { readFailureLabel } from './providerReadHealth';

export interface ManagedProviderPollResult {
  polled: number;
  transitions: number;
  failures: number;
  skipped: number;
  unconfigured: number;
  leaseUnavailable: boolean;
  leaseReason?: string;
}

export interface ManagedProviderPollNotice {
  kind: 'lease-unavailable' | 'missing-configuration' | 'failed' | 'complete';
  message: string;
  warning: boolean;
}

export function managedProviderPollNotice(result: ManagedProviderPollResult): ManagedProviderPollNotice {
  if (result.leaseUnavailable && result.polled === 0) {
    return {
      kind: 'lease-unavailable',
      message: 'Provider updates are already being checked in another VS Code window. Wait for it to finish, or close that window and choose Check Updates again.',
      warning: false,
    };
  }
  const message = `Checked ${result.polled} provider source${result.polled === 1 ? '' : 's'}: ${result.transitions} new Attention item${result.transitions === 1 ? '' : 's'}, ${result.failures} problem${result.failures === 1 ? '' : 's'}, ${result.skipped} skipped, ${result.unconfigured} project${result.unconfigured === 1 ? '' : 's'} need setup.`;
  if (result.unconfigured > 0) { return { kind: 'missing-configuration', message, warning: true }; }
  if (result.failures > 0 || result.leaseUnavailable) { return { kind: 'failed', message, warning: true }; }
  return { kind: 'complete', message, warning: false };
}

export interface ProviderPollingPresentationInput {
  polling: boolean;
  gitlab: {
    configured: boolean;
    credentialsConfigured: boolean;
    target?: { iid: number };
  };
  jenkins: {
    configured: boolean;
    credentialsConfigured: boolean;
  };
  sonar: {
    configured: boolean;
    credentialsConfigured: boolean;
    target?: { projectKey: string; branch: string };
  };
}

export function providerPollingViewStatuses(input: ProviderPollingPresentationInput): ProviderPollingViewStatus[] {
  const gitLab: ProviderPollingViewStatus = !input.gitlab.configured
    ? { provider: 'GitLab', state: 'setup', detail: 'Add the project ID or group/project path.' }
    : !input.gitlab.credentialsConfigured
      ? { provider: 'GitLab', state: 'setup', detail: 'Project linked; check setup for credentials.' }
      : !input.polling
        ? { provider: 'GitLab', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' }
        : input.gitlab.target
          ? { provider: 'GitLab', state: 'active', detail: `Checking merge request !${input.gitlab.target.iid}, reviews, pipeline, jobs, and tests.` }
          : { provider: 'GitLab', state: 'discovering', detail: 'Provider checks are active and looking for an open merge request by branch or ticket key.' };

  const jenkins: ProviderPollingViewStatus = !input.jenkins.configured
    ? { provider: 'Jenkins', state: 'setup', detail: 'Add the project Jenkins job URL.' }
    : !input.jenkins.credentialsConfigured
      ? { provider: 'Jenkins', state: 'setup', detail: 'Job linked; check setup for credentials.' }
      : input.polling
        ? { provider: 'Jenkins', state: 'active', detail: 'Checking the configured job, stages, and tests.' }
        : { provider: 'Jenkins', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' };

  const sonar: ProviderPollingViewStatus = !input.sonar.configured
    ? { provider: 'SonarQube', state: 'setup', detail: 'Add the SonarQube project key.' }
    : !input.sonar.target
      ? { provider: 'SonarQube', state: 'setup', detail: 'Add or discover the branch used for SonarQube checks.' }
      : !input.sonar.credentialsConfigured
        ? { provider: 'SonarQube', state: 'setup', detail: 'Project linked; check setup for credentials.' }
        : input.polling
          ? { provider: 'SonarQube', state: 'active', detail: `Checking ${input.sonar.target.projectKey} on ${input.sonar.target.branch}.` }
          : { provider: 'SonarQube', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' };
  return [gitLab, jenkins, sonar];
}

export function gitLabDigestUnhealthy(digest: GitLabPipelineDigest): boolean {
  return gitLabPipelineStatusIsUnhealthy(digest.status)
    || digest.failedJobs.length > 0
    || digest.tests.failed + digest.tests.error > 0;
}

export function mergeRequestTransitionSummary(
  ownerLabel: string,
  transition: GitLabMergeRequestTransition,
): string {
  const iid = transition.current.iid;
  const prefix = `${ownerLabel} MR !${iid}`;
  switch (transition.kind) {
    case 'merge_request_merged':
      return `${prefix} merged.`;
    case 'merge_request_closed':
      return `${prefix} closed without merging.`;
    case 'merge_request_reopened':
      return `${prefix} reopened.`;
    case 'merge_request_state_changed':
      return `${prefix} state changed from ${transition.previous.state} to ${transition.current.state}.`;
    case 'changes_requested':
      return `${prefix} has requested changes.`;
    case 'changes_request_cleared':
      return `${prefix} no longer has requested changes.`;
    case 'approval_satisfied':
      return `${prefix} now satisfies its approval requirements.`;
    case 'approval_required':
      return `${prefix} no longer satisfies its approval requirements.`;
    case 'approval_state_changed':
      return `${prefix} approval state changed (${approvalSummary(transition.current)}).`;
    case 'reviewers_changed':
      return `${prefix} reviewer assignment changed (${transition.current.reviewers.count} reviewer${transition.current.reviewers.count === 1 ? '' : 's'}).`;
    case 'unresolved_discussions_observed':
      return `${prefix} has ${transition.current.unresolvedDiscussions.count} unresolved discussion${transition.current.unresolvedDiscussions.count === 1 ? '' : 's'} on the first complete discussion read.`;
    case 'unresolved_discussions_increased':
      return `${prefix} has more unresolved discussions (${transition.previous.unresolvedDiscussions.count} -> ${transition.current.unresolvedDiscussions.count}).`;
    case 'unresolved_discussions_decreased':
      return `${prefix} resolved discussions (${transition.previous.unresolvedDiscussions.count} -> ${transition.current.unresolvedDiscussions.count} unresolved).`;
    case 'unresolved_discussions_changed':
      return `${prefix} unresolved discussion set changed (${transition.current.unresolvedDiscussions.count} unresolved).`;
    case 'review_activity_added': {
      const added = Math.max(1, transition.current.reviewActivity.count - transition.previous.reviewActivity.count);
      return `${prefix} has ${added} new review comment${added === 1 ? '' : 's'}.`;
    }
    case 'review_activity_changed':
      return `${prefix} review activity changed (${transition.current.reviewActivity.count} comment${transition.current.reviewActivity.count === 1 ? '' : 's'}).`;
  }
}

export function mergeRequestMetadata(
  digest: GitLabMergeRequestDigest,
  transitionKind: GitLabMergeRequestTransitionKind | 'initial_mr_attention' | 'initial_mr_observed' | 'open_mr_reminder' | 'baseline',
): Record<string, string | number | boolean | null> {
  return {
    transitionKind,
    mergeRequestIid: digest.iid,
    mergeRequestState: digest.state,
    changesRequested: digest.changesRequested,
    approvalCount: digest.approval.approvedByCount,
    approvalsLeft: digest.approval.approvalsLeft,
    reviewerCount: digest.reviewers.count,
    unresolvedDiscussionCount: digest.unresolvedDiscussions.count,
    reviewActivityCount: digest.reviewActivity.count,
    mergeRequestUpdatedAt: digest.updatedAt || null,
    approvalsComplete: digest.approvalsComplete,
    discussionsComplete: digest.discussionsComplete,
    reviewActivityComplete: digest.reviewActivityComplete,
  };
}

export function approvalSummary(digest: GitLabMergeRequestDigest): string {
  const approvals = `${digest.approval.approvedByCount} approval${digest.approval.approvedByCount === 1 ? '' : 's'}`;
  return digest.approval.approvalsLeft === null
    ? approvals
    : `${approvals}, ${digest.approval.approvalsLeft} remaining`;
}

export function mergeRequestEventState(digest: GitLabMergeRequestDigest): string {
  return digest.detailedMergeStatus === 'unknown'
    ? digest.state
    : `${digest.state}/${digest.detailedMergeStatus}`;
}

export function mergeRequestDigestIsTerminal(digest: GitLabMergeRequestDigest): boolean {
  return digest.state === 'merged' || digest.state === 'closed';
}

export function mergeRequestTransitionIsWarning(kind: GitLabMergeRequestTransitionKind): boolean {
  return kind === 'merge_request_closed'
    || kind === 'changes_requested'
    || kind === 'approval_required'
    || kind === 'unresolved_discussions_observed'
    || kind === 'unresolved_discussions_increased';
}

export function mergeRequestReadStatusSummary(
  ownerLabel: string,
  iid: number,
  previous: GitLabMergeRequestReadStatus | null,
  current: GitLabMergeRequestReadStatus,
): string {
  const prefix = `${ownerLabel} MR !${iid}`;
  if (current.state === 'complete') {
    return `${prefix} provider reads recovered and are complete.`;
  }
  if (current.state === 'failed') {
    return `${prefix} provider read failed (${readFailureLabel(current.reason)}).`;
  }
  const components = current.components.join(', ') || 'review data';
  return previous?.state === 'partial'
    ? `${prefix} partial provider-read scope changed (${components}).`
    : `${prefix} provider reads are partial (${components}).`;
}

export function ciDigestState(digest: CiMonitorDigest): string {
  const values = [digest.jenkins?.status, digest.sonar?.gateStatus].filter((value): value is string => Boolean(value));
  return values.join(' / ') || 'observed';
}

export function transitionIsFailure(kind: string): boolean {
  return kind.includes('failed')
    || kind.includes('canceled')
    || kind.includes('increased')
    || kind === 'initial_unhealthy';
}

export function transitionLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

export function gitLabIncompleteMonitorComponents(
  completeness: GitLabMergeRequestMonitorSnapshot['completeness'],
): string[] {
  return [
    ...(!completeness.pipelinesComplete ? ['pipelines'] : []),
    ...(!completeness.jobsComplete ? ['jobs'] : []),
    ...(!completeness.testsComplete ? ['tests'] : []),
    ...(!completeness.notesComplete ? ['notes'] : []),
    ...(!completeness.discussionsComplete ? ['discussions'] : []),
    ...(!completeness.approvalsComplete ? ['approvals'] : []),
  ];
}
