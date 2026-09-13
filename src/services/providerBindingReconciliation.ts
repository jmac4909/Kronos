import type { KronosState } from '../state/types';
import type { MergeRequest, ProjectBranchProfile, ProjectConfig, Ticket } from '../state/types';
import { configuredGitLabProjectPathFromMergeRequestUrl } from './gitlabRestClient';
import type { GitLabMergeRequestDigest } from './gitlabMergeRequestTransitions';
import type { MonitorEvent } from './monitorEventStore';
import {
  projectConfigurationForTicket,
  readProjectGitBranch,
  selectProjectBranchProfile,
} from './projectCatalog';
import { optionalTrimmedStringFromUnknown } from './records';
import { normalizeProviderPublicUrl } from './providerUrls';
import { sonarDashboardUrl } from './sonarRestClient';
import {
  newestWorkSessionProviderBinding,
  type AddWorkSessionProviderBindingInput,
  type WorkSessionProviderBinding,
  type WorkSessionRecord,
} from './workSessionStore';

export interface ReconciledGitLabMergeRequestTarget {
  iid: number;
  projectIdOrPath: string;
  source: 'binding' | 'catalog';
  url?: string;
}

export interface ConfiguredGitLabPollingTarget {
  iid: number;
  projectIdOrPath: string;
  providerUrl?: string;
}

export interface ConfiguredCiPollingTargets {
  jenkinsUrl?: string;
  jenkinsBranch?: string;
  sonar?: { projectKey: string; branch: string; providerUrl?: string };
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
    const bindingUrl = normalizeProviderPublicUrl(binding?.url, 'gitlab', env);
    const projectIdOrPath = binding?.projectId
      || configuredGitLabProjectPathFromMergeRequestUrl(bindingUrl, env)
      || configuredProjectId;
    if (!projectIdOrPath) { return undefined; }
    return {
      iid: bindingIid,
      projectIdOrPath,
      source: 'binding',
      ...(bindingUrl ? { url: bindingUrl } : {}),
    };
  }
  if (!catalogIid) { return undefined; }
  const catalogUrl = normalizeProviderPublicUrl(ticket?.mr?.url, 'gitlab', env);
  const projectIdOrPath = configuredProjectId
    || configuredGitLabProjectPathFromMergeRequestUrl(catalogUrl, env);
  if (!projectIdOrPath) { return undefined; }
  return {
    iid: catalogIid,
    projectIdOrPath,
    source: 'catalog',
    ...(catalogUrl ? { url: catalogUrl } : {}),
  };
}

/** Chooses the source branch used before ticket-key MR discovery. */
export function mergeRequestDiscoverySourceBranch(
  ticket: Ticket | null | undefined,
  observedProjectBranch?: string,
): string | undefined {
  const branch = ticket?.mr?.source_branch
    || observedProjectBranch;
  return branch && !branch.startsWith('detached@') ? branch : undefined;
}

/** Returns the newest locally bound merge request. */
export function latestGitLabMergeRequestBinding(
  workSession: WorkSessionRecord | null | undefined,
): WorkSessionProviderBinding | undefined {
  return newestWorkSessionProviderBinding(
    workSession?.providerBindings || [],
    binding => binding.provider === 'gitlab' && binding.resource === 'merge-request',
  );
}

/**
 * Produces only the catalog-owned binding write still needed by a session.
 * A different current binding is never replaced by stale Work evidence.
 */
export function catalogGitLabBindingCandidate(
  ticket: Ticket,
  workSession: WorkSessionRecord,
  config: ProjectConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AddWorkSessionProviderBindingInput | undefined {
  const catalogIid = positiveInteger(ticket.mr?.iid);
  if (!catalogIid) { return undefined; }
  const current = latestGitLabMergeRequestBinding(workSession);
  const currentIid = positiveInteger(current?.subjectId);
  if (currentIid && currentIid !== catalogIid) { return undefined; }
  const projectId = configuredGitLabProjectIdentity(config);
  const catalogUrl = normalizeProviderPublicUrl(ticket.mr?.url, 'gitlab', env);
  const needsEnrichment = Boolean(current && (
    (projectId && !current.projectId)
    || (catalogUrl && !current.url)
  ));
  if (current && !needsEnrichment) { return undefined; }
  return {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: String(catalogIid),
    ...(projectId ? { projectId } : {}),
    ...(catalogUrl ? { url: catalogUrl } : {}),
  };
}

/** Composes catalog fields with only a matching observed digest; binding owns identity. */
export function effectiveTicketMergeRequest(
  ticket: Ticket,
  workSession: WorkSessionRecord | null | undefined,
  digest: GitLabMergeRequestDigest | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): MergeRequest | null {
  const binding = latestGitLabMergeRequestBinding(workSession);
  const bindingIid = positiveInteger(binding?.subjectId);
  const catalogIid = positiveInteger(ticket.mr?.iid);
  const digestIid = positiveInteger(digest?.iid);
  const iid = bindingIid || catalogIid || digestIid;
  if (!iid) { return null; }

  const catalog = catalogIid === iid ? ticket.mr : null;
  const observed = digestIid === iid ? digest : null;
  const catalogUrl = normalizeProviderPublicUrl(catalog?.url, 'gitlab', env);
  const bindingUrl = bindingIid === iid
    ? normalizeProviderPublicUrl(binding?.url, 'gitlab', env)
    : undefined;
  const observedUrl = normalizeProviderPublicUrl(observed?.url, 'gitlab', env);
  const projected: MergeRequest = catalog
    ? { ...catalog, url: catalogUrl || '' }
    : { iid, state: 'opened', review_status: 'pending_review', url: '' };
  projected.iid = iid;
  if (bindingUrl) { projected.url = bindingUrl; }
  else if (observedUrl) { projected.url = observedUrl; }
  if (!observed) { return projected; }
  projected.state = mergeRequestState(observed.state, projected.state);
  projected.review_status = mergeRequestReviewStatus(observed, projected.review_status);
  if (observed.title) { projected.title = observed.title; }
  if (observed.sourceBranch) {
    projected.source_branch = observed.sourceBranch;
  }
  if (observed.targetBranch) {
    projected.target_branch = observed.targetBranch;
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
  env: NodeJS.ProcessEnv = process.env,
): Ticket {
  const mr = effectiveTicketMergeRequest(ticket, workSession, digest, env);
  return mr === ticket.mr ? ticket : { ...ticket, mr };
}

export function configuredGitLabPollingTarget(
  state: KronosState | null,
  session: WorkSessionRecord,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredGitLabPollingTarget | null {
  const ticket = session.ticketKey ? state?.tickets[session.ticketKey] : undefined;
  const config = projectConfigurationForMonitoringSession(state, session);
  const target = reconcileKnownGitLabMergeRequestTarget(
    ticket,
    session,
    configuredGitLabProjectIdentity(config),
    env,
  );
  return target ? {
    iid: target.iid,
    projectIdOrPath: target.projectIdOrPath,
    ...(target.url ? { providerUrl: target.url } : {}),
  } : null;
}

export function configuredCiPollingTargets(
  state: KronosState | null,
  session: WorkSessionRecord,
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredCiPollingTargets {
  const ticket = session.ticketKey ? state?.tickets[session.ticketKey] : undefined;
  const config = projectConfigurationForMonitoringSession(state, session);
  const jenkinsJobBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'jenkins' && candidate.resource === 'job',
  );
  const jenkinsBuildBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'jenkins' && candidate.resource === 'build',
  );
  const sonarBinding = newestWorkSessionProviderBinding(
    session.providerBindings,
    candidate => candidate.provider === 'sonar' && candidate.resource === 'quality-gate',
  );
  const ticketBranchCandidates = ticketProviderBranchCandidates(ticket);
  const observedProjectBranch = session.projectPath
    ? readProjectGitBranch(session.projectPath)?.branch
    : undefined;
  const branchCandidates = [...ticketBranchCandidates, observedProjectBranch];
  const profile = selectProjectBranchProfile(config, branchCandidates);
  const jenkinsCandidate = optionalTrimmedStringFromUnknown(profile?.jenkins_url)
    || optionalTrimmedStringFromUnknown(config.jenkins_url)
    || jenkinsJobBinding?.url
    || ticket?.build?.url
    || jenkinsBuildBinding?.url;
  const jenkinsUrl = normalizeProviderPublicUrl(jenkinsCandidate, 'jenkins', env);
  const configuredBranch = configuredProfileSonarBranch(profile)
    || optionalTrimmedStringFromUnknown(config.sonar_branch)
    || ticketBranchCandidates.map(optionalTrimmedStringFromUnknown).find(Boolean)
    || optionalTrimmedStringFromUnknown(config.default_branch)
    || optionalTrimmedStringFromUnknown(config.base_branch)
    || optionalTrimmedStringFromUnknown(observedProjectBranch);
  const configuredProjectKey = optionalTrimmedStringFromUnknown(profile?.sonar_project_key)
    || optionalTrimmedStringFromUnknown(config.sonar_project_key);
  const configuredSonar = configuredProjectKey && configuredBranch
    ? { projectKey: configuredProjectKey, branch: configuredBranch }
    : null;
  const boundProjectKey = sonarBinding?.projectId;
  const boundPrefix = boundProjectKey ? `${boundProjectKey}:` : '';
  const boundBranch = boundPrefix && sonarBinding?.subjectId.startsWith(boundPrefix)
    ? sonarBinding.subjectId.slice(boundPrefix.length).trim()
    : '';
  const boundSonarUrl = normalizeProviderPublicUrl(sonarBinding?.url, 'sonar', env);
  let sonar: ConfiguredCiPollingTargets['sonar'];
  if (configuredSonar) {
    const providerUrl = sonarDashboardUrl(configuredSonar.projectKey, configuredSonar.branch, env);
    sonar = { ...configuredSonar, ...(providerUrl ? { providerUrl } : {}) };
  } else if (boundProjectKey && boundBranch) {
    sonar = {
      projectKey: boundProjectKey,
      branch: boundBranch,
      ...(boundSonarUrl ? { providerUrl: boundSonarUrl } : {}),
    };
  }
  const jenkinsBranch = optionalTrimmedStringFromUnknown(profile?.branch);
  return {
    ...(jenkinsUrl ? { jenkinsUrl } : {}),
    ...(jenkinsUrl && jenkinsBranch ? { jenkinsBranch } : {}),
    ...(sonar ? { sonar } : {}),
  };
}

export function configuredSonarBranch(
  state: KronosState | null,
  ticketKey: string,
): { projectKey: string; branch: string } | null {
  const ticket = state?.tickets[ticketKey];
  const config = projectConfigurationForTicket(state, ticket);
  const profile = selectProjectBranchProfile(config, ticketProviderBranchCandidates(ticket));
  const projectKey = optionalTrimmedStringFromUnknown(profile?.sonar_project_key)
    || optionalTrimmedStringFromUnknown(config?.sonar_project_key);
  const branch = configuredSonarBranchName(state, ticketKey);
  return projectKey && branch ? { projectKey, branch } : null;
}

export function configuredSonarBranchName(state: KronosState | null, ticketKey: string): string | null {
  const ticket = state?.tickets[ticketKey];
  const config = projectConfigurationForTicket(state, ticket);
  const candidates = ticketProviderBranchCandidates(ticket);
  const profile = selectProjectBranchProfile(config, candidates);
  const branch = configuredProfileSonarBranch(profile)
    || optionalTrimmedStringFromUnknown(config?.sonar_branch)
    || candidates.map(optionalTrimmedStringFromUnknown).find(Boolean)
    || optionalTrimmedStringFromUnknown(config?.default_branch)
    || optionalTrimmedStringFromUnknown(config?.base_branch);
  return optionalTrimmedStringFromUnknown(branch) || null;
}

export function projectConfigurationForMonitoringSession(
  state: KronosState | null,
  session: WorkSessionRecord,
): ProjectConfig {
  const ticket = session.ticketKey ? state?.tickets[session.ticketKey] : undefined;
  const config = projectConfigurationForTicket(state, ticket);
  return session.projectName
    ? { ...config, ...(state?.projects[session.projectName]?.config || {}) }
    : config;
}

/** Orders the current event's exact binding first, then its resource and safe fallbacks. */
export function providerBindingsForEvent(
  event: MonitorEvent,
  session: WorkSessionRecord | undefined,
): WorkSessionProviderBinding[] {
  if (!session || !isProviderSource(event.source)) { return []; }
  return session.providerBindings
    .filter(binding => binding.provider === event.source && Boolean(binding.url))
    .sort((left, right) => {
      const leftExact = left.subjectId === event.subject?.id ? 1 : 0;
      const rightExact = right.subjectId === event.subject?.id ? 1 : 0;
      const leftResource = subjectMatchesResource(event.subject?.kind, left) ? 1 : 0;
      const rightResource = subjectMatchesResource(event.subject?.kind, right) ? 1 : 0;
      return rightExact - leftExact
        || rightResource - leftResource
        || right.attachedAt.localeCompare(left.attachedAt)
        || right.subjectId.localeCompare(left.subjectId, undefined, { numeric: true, sensitivity: 'base' })
        || right.id.localeCompare(left.id);
    });
}

function ticketProviderBranchCandidates(ticket: Ticket | undefined): Array<string | undefined> {
  return [ticket?.mr?.source_branch];
}

function configuredProfileSonarBranch(profile: ProjectBranchProfile | undefined): string | undefined {
  return optionalTrimmedStringFromUnknown(profile?.sonar_branch)
    || (profile?.sonar_project_key
      ? optionalTrimmedStringFromUnknown(profile.branch)
      : undefined);
}

function isProviderSource(source: string): source is WorkSessionProviderBinding['provider'] {
  return source === 'jira' || source === 'gitlab' || source === 'jenkins' || source === 'sonar';
}

function subjectMatchesResource(kind: string | undefined, binding: WorkSessionProviderBinding): boolean {
  if (!kind) { return false; }
  if (kind === binding.resource) { return true; }
  return (kind === 'pipeline' && binding.resource === 'merge-request')
    || (kind === 'build' && binding.resource === 'job')
    || (kind === 'quality-gate' && binding.resource === 'branch');
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
