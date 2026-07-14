import type { MergeRequest, ProjectConfig, Ticket } from '../state/types';
import { configuredGitLabProjectPathFromMergeRequestUrl } from './gitlabRestClient';
import type { GitLabMergeRequestDigest } from './gitlabMergeRequestTransitions';
import {
  newestWorkSessionProviderBinding,
  type WorkSessionProviderBinding,
  type WorkSessionRecord,
} from './workSessionStore';

export interface ReconciledGitLabMergeRequestTarget {
  iid: number;
  projectIdOrPath: string;
  source: 'binding' | 'catalog';
  url?: string;
}

/** Returns the explicit GitLab project identity configured for one local project. */
export function configuredGitLabProjectIdentity(config: ProjectConfig | null | undefined): string | undefined {
  const value = config?.gitlab_project_id || config?.gitlab_project_path;
  return value ? String(value) : undefined;
}

/**
 * Reconciles durable session identity, Work projection, and explicit project
 * configuration. A valid session binding always owns MR identity; catalog
 * evidence may enrich only the same IID and can never override it.
 */
export function reconcileKnownGitLabMergeRequestTarget(
  ticket: Ticket | null | undefined,
  workSession: WorkSessionRecord | null | undefined,
  configuredProject: string | number | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ReconciledGitLabMergeRequestTarget | undefined {
  const binding = latestGitLabMergeRequestBinding(workSession);
  const bindingIid = positiveInteger(binding?.subjectId);
  const catalogIid = positiveInteger(ticket?.mr?.iid);
  const configuredProjectId = configuredProject ? String(configuredProject) : undefined;
  if (bindingIid) {
    const projectIdOrPath = binding?.projectId
      || configuredGitLabProjectPathFromMergeRequestUrl(binding?.url, env)
      || configuredProjectId;
    if (!projectIdOrPath) { return undefined; }
    return {
      iid: bindingIid,
      projectIdOrPath,
      source: 'binding',
      ...(binding?.url ? { url: binding.url } : {}),
    };
  }
  if (!catalogIid) { return undefined; }
  const projectIdOrPath = configuredProjectId
    || configuredGitLabProjectPathFromMergeRequestUrl(ticket?.mr?.url, env);
  if (!projectIdOrPath) { return undefined; }
  return {
    iid: catalogIid,
    projectIdOrPath,
    source: 'catalog',
    ...(ticket?.mr?.url ? { url: ticket.mr.url } : {}),
  };
}

/** Chooses the source branch used before ticket-key MR discovery. */
export function mergeRequestDiscoverySourceBranch(
  ticket: Ticket | null | undefined,
  observedProjectBranch?: string,
): string | undefined {
  const branch = ticket?.mr?.source_branch
    || ticket?.mr?.sourceBranch
    || ticket?.mr?.branch
    || ticket?.mr?.head_branch
    || observedProjectBranch;
  return branch && !branch.startsWith('detached@') ? branch : undefined;
}

/**
 * Returns the newest locally bound merge request. Provider discovery writes
 * this binding; work.json remains the Jira catalog and is not its owner.
 */
export function latestGitLabMergeRequestBinding(
  workSession: WorkSessionRecord | null | undefined,
): WorkSessionProviderBinding | undefined {
  return newestWorkSessionProviderBinding(
    workSession?.providerBindings || [],
    binding => binding.provider === 'gitlab' && binding.resource === 'merge-request',
  );
}

export function latestGitLabMergeRequestBindingAcrossSessions(
  workSessions: readonly WorkSessionRecord[],
): WorkSessionProviderBinding | undefined {
  return newestWorkSessionProviderBinding(
    workSessions.flatMap(session => session.providerBindings),
    binding => binding.provider === 'gitlab' && binding.resource === 'merge-request',
  );
}

/**
 * Composes the Jira catalog value with locally discovered identity and the
 * latest matching poll digest. A binding always wins identity because it is
 * the durable result of explicit insertion or automatic discovery.
 */
export function effectiveTicketMergeRequest(
  ticket: Ticket,
  workSession: WorkSessionRecord | null | undefined,
  digest: GitLabMergeRequestDigest | null | undefined,
): MergeRequest | null {
  const binding = latestGitLabMergeRequestBinding(workSession);
  const bindingIid = positiveInteger(binding?.subjectId);
  const catalogIid = positiveInteger(ticket.mr?.iid);
  const digestIid = positiveInteger(digest?.iid);
  const iid = bindingIid || catalogIid || digestIid;
  if (!iid) { return null; }

  const catalog = catalogIid === iid ? ticket.mr : null;
  const observed = digestIid === iid ? digest : null;
  const projected: MergeRequest = catalog
    ? { ...catalog }
    : {
      iid,
      state: 'opened',
      review_status: 'pending_review',
      url: '',
    };

  projected.iid = iid;
  if (bindingIid === iid && binding?.url) { projected.url = binding.url; }
  else if (observed?.url) { projected.url = observed.url; }

  if (!observed) { return projected; }
  projected.state = mergeRequestState(observed.state, projected.state);
  projected.review_status = mergeRequestReviewStatus(observed, projected.review_status);
  if (observed.title) { projected.title = observed.title; }
  if (observed.sourceBranch) {
    projected.source_branch = observed.sourceBranch;
    projected.sourceBranch = observed.sourceBranch;
  }
  if (observed.targetBranch) {
    projected.target_branch = observed.targetBranch;
    projected.targetBranch = observed.targetBranch;
  }
  if (observed.discussionsComplete) {
    projected.unresolved_discussion_count = observed.unresolvedDiscussions.count;
    projected.discussions_resolved = observed.unresolvedDiscussions.count === 0;
  } else if (observed.blockingDiscussionsResolved !== null) {
    projected.discussions_resolved = observed.blockingDiscussionsResolved;
  }
  return projected;
}

export function withEffectiveTicketMergeRequest(
  ticket: Ticket,
  workSession: WorkSessionRecord | null | undefined,
  digest: GitLabMergeRequestDigest | null | undefined,
): Ticket {
  const mr = effectiveTicketMergeRequest(ticket, workSession, digest);
  return mr === ticket.mr ? ticket : { ...ticket, mr };
}

function mergeRequestState(value: string, fallback: MergeRequest['state']): MergeRequest['state'] {
  return value === 'opened' || value === 'merged' || value === 'closed' ? value : fallback;
}

function mergeRequestReviewStatus(
  digest: GitLabMergeRequestDigest,
  fallback: MergeRequest['review_status'],
): MergeRequest['review_status'] {
  if (digest.changesRequested === true) { return 'changes_requested'; }
  if (digest.approvalsComplete && digest.approval.approved === true) { return 'approved'; }
  if (digest.changesRequested === false || digest.approvalsComplete) { return 'pending_review'; }
  return fallback;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9][0-9]*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
