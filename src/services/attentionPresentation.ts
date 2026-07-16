import type { MonitorEvent, MonitorEventSource } from './monitorEventStore';
import { normalizeProviderPublicUrl } from './providerUrls';
import type { WorkSessionProviderBinding, WorkSessionRecord } from './workSessionStore';

export type AttentionSeverity = 'information' | 'warning' | 'failure' | 'recovery' | 'partial' | 'blocked';
export type AttentionProviderIconId = 'git-pull-request' | 'server-process' | 'shield';
export type AttentionSeverityColorId = 'charts.green' | 'charts.yellow' | 'charts.red';

export interface AttentionProviderChoice {
  label: string;
  description: string;
  url: string;
}

export interface AttentionEventPresentation {
  project: string;
  provider: string;
  subject: string;
  severity: AttentionSeverity;
  observedAt: string;
  changedAt: string;
  why: string;
  description: string;
}

export interface AttentionProjectGroupIdentity {
  key: string;
  id: string;
  label: string;
  projectName: string | undefined;
}

export interface AttentionProjectEntry {
  session?: Pick<WorkSessionRecord, 'projectName'> | undefined;
}

export interface AttentionProjectGroup<Entry> {
  identity: AttentionProjectGroupIdentity;
  entries: readonly Entry[];
}

export type AttentionActionContext =
  | 'attention_provider'
  | 'attention_repair'
  | 'attention_provider_project_gitlab'
  | 'attention_repair_project_gitlab'
  | 'attention_provider_project_ci'
  | 'attention_repair_project_ci'
  | 'attention_provider_project_ticket_gitlab'
  | 'attention_repair_project_ticket_gitlab'
  | 'attention_provider_project_ticket_ci'
  | 'attention_repair_project_ticket_ci'
  | 'attention_provider_ticket'
  | 'attention_repair_ticket'
  | 'attention_provider_ticket_gitlab'
  | 'attention_repair_ticket_gitlab'
  | 'attention_provider_ticket_ci'
  | 'attention_repair_ticket_ci';

/** Jira context never participates in top-level Attention identity; only an explicit local project does. */
export function attentionProjectGroupIdentity(projectName: unknown): AttentionProjectGroupIdentity {
  const normalized = typeof projectName === 'string'
    ? projectName.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    : '';
  if (!normalized) {
    return {
      key: 'unassigned-project',
      id: 'attention-group:unassigned-project',
      label: 'Unassigned project',
      projectName: undefined,
    };
  }
  return {
    key: `project:${normalized}`,
    id: `attention-group:project:${normalized}`,
    label: normalized,
    projectName: normalized,
  };
}

/** Groups current Attention rows only by their explicit local-project session identity. */
export function groupAttentionEntriesByProject<Entry extends AttentionProjectEntry>(
  entries: readonly Entry[],
): AttentionProjectGroup<Entry>[] {
  const grouped = new Map<string, { identity: AttentionProjectGroupIdentity; entries: Entry[] }>();
  for (const entry of entries) {
    const identity = attentionProjectGroupIdentity(entry.session?.projectName);
    const existing = grouped.get(identity.key);
    if (existing) {
      existing.entries.push(entry);
    } else {
      grouped.set(identity.key, { identity, entries: [entry] });
    }
  }
  return [...grouped.values()];
}

/** Keeps ticket actions tied to a Jira context that is actually stored on the session. */
export function attentionTicketKey(
  event: MonitorEvent,
  session: WorkSessionRecord | undefined,
): string | undefined {
  if (!session) { return undefined; }
  const explicit = event.subject?.ticketKey;
  if (explicit) { return session.ticketKeys.includes(explicit) ? explicit : undefined; }
  if (session.kind === 'ticket' && session.ticketKeys.includes(session.ticketKey)) { return session.ticketKey; }
  return session.ticketKeys.length === 1 ? session.ticketKeys[0] : undefined;
}

/** Encodes only the context-menu actions that are valid for this current row. */
export function attentionActionContext(
  source: MonitorEventSource,
  ticketKey: string | undefined,
  providerUrl: string | undefined,
  projectName?: string,
): AttentionActionContext {
  const prefix = providerUrl ? 'attention_provider' : 'attention_repair';
  if (projectName && ticketKey) {
    if (source === 'gitlab') { return `${prefix}_project_ticket_gitlab`; }
    if (source === 'jenkins' || source === 'sonar') { return `${prefix}_project_ticket_ci`; }
  }
  if (ticketKey) {
    if (source === 'gitlab') { return `${prefix}_ticket_gitlab`; }
    if (source === 'jenkins' || source === 'sonar') { return `${prefix}_ticket_ci`; }
    return `${prefix}_ticket`;
  }
  if (projectName) {
    if (source === 'gitlab') { return `${prefix}_project_gitlab`; }
    if (source === 'jenkins' || source === 'sonar') { return `${prefix}_project_ci`; }
  }
  return prefix;
}

export function attentionEventPresentation(
  event: MonitorEvent,
  session: WorkSessionRecord | undefined,
): AttentionEventPresentation {
  const project = session?.projectName || event.subject?.project || 'Unassigned project';
  const provider = attentionProviderLabel(event.source);
  const subject = attentionSubjectLabel(event);
  const severity = attentionSeverity(event);
  const observedAt = session?.monitoring.lastAttemptAt || event.at;
  const changedAt = event.at;
  const headline = attentionEventHeadline(event);
  return {
    project,
    provider,
    subject,
    severity,
    observedAt,
    changedAt,
    why: headline,
    description: [
      project,
      provider,
      subject,
      severity,
      `observed ${displayAttentionTimestamp(observedAt)}`,
      `changed ${displayAttentionTimestamp(changedAt)}`,
    ].join(' • '),
  };
}

/** Converts internal transition vocabulary into the delivery impact an operator cares about. */
export function attentionEventHeadline(event: MonitorEvent): string {
  const transition = metadataString(event, 'transitionKind').toLowerCase();
  const ticket = safeAttentionText(event.subject?.ticketKey, 128);
  const prefix = ticket ? `${ticket} ` : '';
  const subject = attentionSubjectLabel(event);
  const pipeline = metadataIdentifier(event, 'pipelineId', event.subject?.kind === 'pipeline' ? event.subject.id : undefined);
  const build = metadataIdentifier(event, 'buildNumber', event.subject?.kind === 'build' ? event.subject.id : undefined);
  const branch = safeAttentionText(event.metadata?.['branch'], 500) || 'the monitored branch';
  const failedJobs = metadataCount(event, 'failedJobCount');
  const failedTests = metadataCount(event, 'failedTestCount');
  const failedStages = metadataCount(event, 'failedStageCount');
  const unresolvedIssues = metadataCount(event, 'unresolvedIssueCount');
  const issueDelta = metadataSignedCount(event, 'issueDelta');
  const mr = metadataIdentifier(
    event,
    'mergeRequestIid',
    event.subject?.kind === 'merge-request' ? event.subject.id : undefined,
  );
  const mrLabel = mr ? `MR !${mr}` : subject;
  const pipelineLabel = pipeline ? `pipeline ${pipeline}` : 'the pipeline';
  const buildLabel = build ? `Jenkins build #${build}` : 'the Jenkins build';

  switch (transition) {
    case 'monitoring_blocked':
      return `${prefix}Monitoring is off. Configure GitLab, Jenkins, or SonarQube for this project to track delivery changes.`;
    case 'monitoring_recovered':
      return `${prefix}Monitoring is ready. New merge-request, build, and quality changes will appear here.`;
    case 'provider_read_failed':
      return `${providerDataScope(event, prefix, mr)} could not be refreshed (${readFailureMessage(event)}). Last known results remain visible.`;
    case 'provider_read_partial':
      return `${providerDataScope(event, prefix, mr)} is incomplete: ${readComponentMessage(event)}. Available results remain visible.`;
    case 'provider_read_recovered':
      return `${providerDataScope(event, prefix, mr)} is current again.`;

    case 'initial_mr_observed':
      return mergeRequestOpenHeadline(prefix, mrLabel, event.after?.state);
    case 'initial_mr_attention':
      return `${prefix}${mrLabel} needs review${mergeRequestAttentionReasons(event)}.`;
    case 'open_mr_reminder':
      return `${prefix}${mrLabel} is still open${mergeRequestAttentionReasons(event)}.`;
    case 'merge_request_merged':
      return `${prefix}${mrLabel} was merged.`;
    case 'merge_request_closed':
      return `${prefix}${mrLabel} was closed without merging.`;
    case 'merge_request_reopened':
      return `${prefix}${mrLabel} was reopened.`;
    case 'merge_request_state_changed':
      return `${prefix}${mrLabel} changed to ${humanState(event.after?.state)}.`;
    case 'changes_requested':
      return `${prefix}${mrLabel} has requested changes.`;
    case 'changes_request_cleared':
      return `${prefix}${mrLabel} no longer has requested changes.`;
    case 'approval_satisfied':
      return `${prefix}${mrLabel} now has the required approvals.`;
    case 'approval_required':
      return `${prefix}${mrLabel} needs ${pluralCount(metadataCount(event, 'approvalsLeft'), 'more approval')}.`;
    case 'approval_state_changed':
      return `${prefix}${mrLabel} approval progress changed: ${pluralCount(metadataCount(event, 'approvalCount'), 'approval')}, ${remainingCount(metadataCount(event, 'approvalsLeft'))}.`;
    case 'reviewers_changed':
      return `${prefix}${mrLabel} reviewer assignment changed: ${pluralCount(metadataCount(event, 'reviewerCount'), 'reviewer')}.`;
    case 'unresolved_discussions_observed':
    case 'unresolved_discussions_increased':
      return `${prefix}${mrLabel} has ${pluralCount(metadataCount(event, 'unresolvedDiscussionCount'), 'unresolved discussion')}.`;
    case 'unresolved_discussions_decreased':
      return `${prefix}${mrLabel} review discussions were resolved; ${pluralCount(metadataCount(event, 'unresolvedDiscussionCount'), 'unresolved discussion')} remain.`;
    case 'unresolved_discussions_changed':
      return `${prefix}${mrLabel} review discussions changed; ${pluralCount(metadataCount(event, 'unresolvedDiscussionCount'), 'unresolved discussion')} remain.`;
    case 'review_activity_added':
      return `${prefix}${mrLabel} has new review activity (${pluralCount(metadataCount(event, 'reviewActivityCount'), 'comment')} total).`;
    case 'review_activity_changed':
      return `${prefix}${mrLabel} review activity changed (${pluralCount(metadataCount(event, 'reviewActivityCount'), 'comment')} total).`;

    case 'new_pipeline':
      return `${prefix}New ${pipelineLabel} is ${humanState(event.after?.state)}.`;
    case 'pipeline_failed':
      return `${prefix}${capitalize(pipelineLabel)} failed${deliveryFailureDetails(failedJobs, failedTests)}.`;
    case 'pipeline_canceled':
      return `${prefix}${capitalize(pipelineLabel)} was canceled.`;
    case 'pipeline_recovered':
      return `${prefix}${capitalize(pipelineLabel)} is passing again.`;
    case 'pipeline_succeeded':
      return `${prefix}${capitalize(pipelineLabel)} passed.`;
    case 'blocking_jobs_failed':
      return `${prefix}${pluralCount(failedJobs, 'blocking job')} failed in ${pipelineLabel}.`;
    case 'blocking_jobs_recovered':
      return `${prefix}${pluralCount(failedJobs, 'blocking job')} in ${pipelineLabel} ${countVerb(failedJobs)} passing again.`;
    case 'tests_failed':
      return `${prefix}${pluralCount(failedTests, 'test')} failed in ${pipelineLabel}.`;
    case 'tests_recovered':
      return `${prefix}Tests in ${pipelineLabel} are passing again.`;

    case 'jenkins_new_build':
      return `${prefix}New ${buildLabel} is ${humanState(event.after?.state)}.`;
    case 'jenkins_failed':
      return `${prefix}${capitalize(buildLabel)} failed${deliveryFailureDetails(failedStages, failedTests, 'stage')}.`;
    case 'jenkins_recovered':
    case 'build_recovered':
      return `${prefix}${capitalize(buildLabel)} is passing again.`;
    case 'jenkins_succeeded':
      return `${prefix}${capitalize(buildLabel)} passed.`;
    case 'jenkins_tests_failed':
      return `${prefix}${pluralCount(failedTests, 'test')} failed in ${buildLabel}.`;
    case 'jenkins_tests_recovered':
      return `${prefix}Tests in ${buildLabel} are passing again.`;
    case 'jenkins_stages_failed':
      return `${prefix}${pluralCount(failedStages, 'stage')} failed in ${buildLabel}.`;
    case 'jenkins_stages_recovered':
      return `${prefix}${pluralCount(failedStages, 'stage')} in ${buildLabel} ${countVerb(failedStages)} passing again.`;

    case 'sonar_gate_failed':
      return `${prefix}SonarQube quality gate failed for ${branch}.`;
    case 'sonar_gate_recovered':
      return `${prefix}SonarQube quality gate is passing again for ${branch}.`;
    case 'sonar_issues_increased':
      return `${prefix}SonarQube reports ${pluralCount(unresolvedIssues, 'unresolved issue')} for ${branch}${signedDelta(issueDelta)}.`;
    case 'sonar_issues_decreased':
      return `${prefix}SonarQube reports ${pluralCount(unresolvedIssues, 'unresolved issue')} for ${branch}${signedDelta(issueDelta)}.`;

    case 'initial_healthy':
      return initialHealthHeadline(event, prefix, true, branch, buildLabel);
    case 'initial_unhealthy':
      return initialHealthHeadline(event, prefix, false, branch, buildLabel, failedJobs, failedTests, failedStages);
  }

  if (transition.includes('recovered')) {
    return `${prefix}${attentionProviderLabel(event.source)} results are healthy again.`;
  }
  const summary = safeAttentionText(event.summary, 1_000);
  if (/provider reads? recovered/i.test(summary)) {
    return `${prefix}${attentionProviderLabel(event.source)} results are current again.`;
  }
  return summary || `${prefix}${attentionProviderLabel(event.source)} delivery status changed.`;
}

function providerDataScope(event: MonitorEvent, prefix: string, mergeRequestIid?: string): string {
  if (event.source === 'gitlab') {
    return mergeRequestIid
      ? `${prefix}MR !${mergeRequestIid} review and pipeline data`
      : `${prefix}GitLab merge-request and pipeline data`;
  }
  if (event.source === 'jenkins') { return `${prefix}Jenkins build results`; }
  if (event.source === 'sonar') { return `${prefix}SonarQube quality results`; }
  return `${prefix}Delivery monitoring data`;
}

function readComponentMessage(event: MonitorEvent): string {
  const labels: Record<string, string> = {
    approvals: 'approvals',
    discussions: 'review discussions',
    jobs: 'job results',
    notes: 'review comments',
    pipelines: 'pipeline status',
    stages: 'stage results',
    tests: 'test results',
  };
  const components = metadataString(event, 'readComponents')
    .split(',')
    .map(value => value.trim().toLowerCase())
    .filter(value => value && value !== 'none')
    .map(value => labels[value] || value.replace(/[_-]+/g, ' '));
  return [...new Set(components)].join(', ') || 'some expected details are unavailable';
}

function readFailureMessage(event: MonitorEvent): string {
  const reason = metadataString(event, 'readReason').trim().toLowerCase();
  const labels: Record<string, string> = {
    authentication: 'authentication failed',
    credentials: 'credentials need attention',
    dns: 'host could not be resolved',
    forbidden: 'access was denied',
    network: 'network request failed',
    not_found: 'configured resource was not found',
    permission: 'access was denied',
    rate_limit: 'request limit was reached',
    timeout: 'request timed out',
    tls: 'secure connection failed',
    unavailable: 'service is unavailable',
  };
  return labels[reason] || safeAttentionText(reason.replace(/[_-]+/g, ' '), 160) || 'service is unavailable';
}

function mergeRequestOpenHeadline(prefix: string, mrLabel: string, state: string | undefined): string {
  const normalized = safeAttentionText(state, 200).toLowerCase();
  if (normalized.includes('opened') && normalized.includes('mergeable')) {
    return `${prefix}${mrLabel} is open and mergeable.`;
  }
  if (normalized.includes('opened')) { return `${prefix}${mrLabel} is open.`; }
  return `${prefix}${mrLabel} is ${humanState(state)}.`;
}

function mergeRequestAttentionReasons(event: MonitorEvent): string {
  const reasons: string[] = [];
  if (event.metadata?.['changesRequested'] === true) { reasons.push('changes were requested'); }
  const discussions = metadataCount(event, 'unresolvedDiscussionCount');
  const approvals = metadataCount(event, 'approvalsLeft');
  if (discussions !== undefined && discussions > 0) { reasons.push(pluralCount(discussions, 'unresolved discussion')); }
  if (approvals !== undefined && approvals > 0) { reasons.push(pluralCount(approvals, 'approval remaining')); }
  return reasons.length > 0 ? `: ${reasons.join('; ')}` : '';
}

function initialHealthHeadline(
  event: MonitorEvent,
  prefix: string,
  healthy: boolean,
  branch: string,
  buildLabel: string,
  failedJobs?: number,
  failedTests?: number,
  failedStages?: number,
): string {
  if (event.source === 'sonar') {
    const issues = metadataCount(event, 'unresolvedIssueCount');
    return `${prefix}SonarQube quality gate is ${healthy ? 'passing' : 'failing'} for ${branch}${issues === undefined ? '' : ` with ${pluralCount(issues, 'unresolved issue')}`}.`;
  }
  if (event.source === 'jenkins') {
    return `${prefix}${capitalize(buildLabel)} is ${healthy ? 'passing' : `failing${deliveryFailureDetails(failedStages, failedTests, 'stage')}`}.`;
  }
  if (event.source === 'gitlab') {
    const pipeline = metadataIdentifier(event, 'pipelineId', event.subject?.id);
    const label = pipeline ? `Pipeline ${pipeline}` : 'The pipeline';
    return `${prefix}${label} is ${healthy ? 'passing' : `failing${deliveryFailureDetails(failedJobs, failedTests)}`}.`;
  }
  return `${prefix}Delivery monitoring is ${healthy ? 'healthy' : 'unhealthy'}.`;
}

function deliveryFailureDetails(
  primaryCount: number | undefined,
  failedTests: number | undefined,
  primaryNoun = 'blocking job',
): string {
  const details: string[] = [];
  if (primaryCount !== undefined && primaryCount > 0) { details.push(pluralCount(primaryCount, primaryNoun)); }
  if (failedTests !== undefined && failedTests > 0) { details.push(pluralCount(failedTests, 'test')); }
  return details.length > 0 ? `: ${details.join(' and ')}` : '';
}

function pluralCount(value: number | undefined, noun: string): string {
  if (value === undefined) { return noun; }
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

function remainingCount(value: number | undefined): string {
  return value === undefined ? 'remaining requirement unknown' : `${value} remaining`;
}

function countVerb(value: number | undefined): 'is' | 'are' {
  return value === 1 ? 'is' : 'are';
}

function signedDelta(value: number | undefined): string {
  if (value === undefined || value === 0) { return ''; }
  return value > 0 ? ` (up ${value})` : ` (down ${Math.abs(value)})`;
}

function humanState(value: unknown): string {
  return safeAttentionText(value, 200).replace(/[_/.-]+/g, ' ').toLowerCase() || 'updated';
}

function capitalize(value: string): string {
  return value ? `${value[0]?.toUpperCase() || ''}${value.slice(1)}` : value;
}

function metadataIdentifier(event: MonitorEvent, key: string, fallback: unknown): string | undefined {
  const value = event.metadata?.[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) { return String(value); }
  const candidate = safeAttentionText(value, 128) || safeAttentionText(fallback, 128);
  return candidate || undefined;
}

function metadataCount(event: MonitorEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function metadataSignedCount(event: MonitorEvent, key: string): number | undefined {
  const value = event.metadata?.[key];
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function safeAttentionText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

export function attentionSeverity(event: MonitorEvent): AttentionSeverity {
  const transition = metadataString(event, 'transitionKind').toLowerCase();
  const state = event.after?.state?.toLowerCase() || '';
  const signal = `${transition} ${state} ${event.summary.toLowerCase()}`;
  if (signal.includes('partial')) { return 'partial'; }
  if (['blocked', 'unavailable', 'missing_configuration', 'missing configuration', 'lease_busy']
    .some(value => signal.includes(value))) {
    return 'blocked';
  }
  if (['failed', 'failure', 'error', 'canceled', 'cancelled', 'unhealthy', 'aborted']
    .some(value => signal.includes(value))) {
    return 'failure';
  }
  if (['recovered', 'request_cleared', 'approval_satisfied', 'discussions_decreased', 'issues_decreased',
    'passed', 'success', 'succeeded', 'reopened']
    .some(value => transition.includes(value))) {
    return 'recovery';
  }
  if (['warning', 'changes_requested', 'initial_mr_attention', 'approval_required', 'pending', 'increased', 'unstable']
    .some(value => signal.includes(value))) {
    return 'warning';
  }
  return 'information';
}

/** Keeps provider identity in the glyph while every provider shares one state-color language. */
export function attentionProviderIconId(source: MonitorEventSource): AttentionProviderIconId | undefined {
  switch (source) {
    case 'gitlab': return 'git-pull-request';
    case 'jenkins': return 'server-process';
    case 'sonar': return 'shield';
    default: return undefined;
  }
}

/** Green is healthy/recovered, yellow needs review/is partial, and red is failed/blocked. */
export function attentionSeverityColorId(severity: AttentionSeverity): AttentionSeverityColorId {
  switch (severity) {
    case 'information':
    case 'recovery':
      return 'charts.green';
    case 'warning':
    case 'partial':
      return 'charts.yellow';
    case 'failure':
    case 'blocked':
      return 'charts.red';
  }
}

/** Multiple retained Jenkins builds and SonarQube branches are always newest-first. */
export function attentionProviderChoicesForEvent(
  event: MonitorEvent,
  session: WorkSessionRecord | undefined,
): AttentionProviderChoice[] {
  if (!session || (event.source !== 'sonar' && event.source !== 'jenkins')) { return []; }
  const source = event.source;
  const candidates = session.providerBindings
    .map((binding, index) => ({ binding, index }))
    .filter(({ binding }) => binding.provider === source
      && (source !== 'jenkins' || binding.resource === 'build'))
    .map(({ binding, index }) => {
      const url = normalizeProviderPublicUrl(binding.url, source);
      return url ? { binding, index, url } : undefined;
    })
    .filter((candidate): candidate is { binding: WorkSessionProviderBinding; index: number; url: string } => Boolean(candidate))
    .sort((left, right) => right.binding.attachedAt.localeCompare(left.binding.attachedAt)
      || right.index - left.index
      || right.binding.subjectId.localeCompare(left.binding.subjectId, undefined, { numeric: true, sensitivity: 'base' })
      || right.binding.id.localeCompare(left.binding.id));
  const choices: AttentionProviderChoice[] = [];
  const seen = new Set<string>();
  for (const { binding, url } of candidates) {
    if (seen.has(url)) { continue; }
    seen.add(url);
    if (source === 'sonar') {
      choices.push({
        label: sonarBindingBranch(binding, url) || binding.subjectId,
        description: `${binding.projectId ? `SonarQube ${binding.projectId}` : 'SonarQube branch'} • saved ${displayAttentionTimestamp(binding.attachedAt)}`,
        url,
      });
    } else {
      choices.push({
        label: binding.subjectId === 'latest' ? 'Latest Jenkins build' : `Jenkins build ${binding.subjectId}`,
        description: `${binding.projectId || 'Jenkins'} • saved ${displayAttentionTimestamp(binding.attachedAt)}`,
        url,
      });
    }
  }
  return choices;
}

export function attentionProviderLabel(source: MonitorEventSource): string {
  switch (source) {
    case 'gitlab': return 'GitLab';
    case 'jira': return 'Jira';
    case 'jenkins': return 'Jenkins';
    case 'sonar': return 'SonarQube';
    case 'kronos': return 'Kronos';
    case 'operator': return 'Operator';
  }
}

function attentionSubjectLabel(event: MonitorEvent): string {
  const subject = event.subject;
  if (!subject) { return 'Provider state'; }
  switch (subject.kind) {
    case 'merge-request': return `MR !${subject.id}`;
    case 'pipeline': return `Pipeline ${subject.id}`;
    case 'build': return `Build #${subject.id}`;
    case 'quality-gate': return `Quality gate ${metadataString(event, 'branch') || subject.id}`;
    case 'provider-read': return 'Provider health';
    case 'monitoring-blocker': return 'Monitoring setup';
    default: return `${subject.kind.replace(/-/g, ' ')} ${subject.id}`;
  }
}

function sonarBindingBranch(binding: WorkSessionProviderBinding, url: string): string | undefined {
  try {
    const urlBranch = new URL(url).searchParams.get('branch')?.trim();
    if (urlBranch) { return urlBranch; }
  } catch {
    return undefined;
  }
  const prefix = binding.projectId ? `${binding.projectId}:` : '';
  return prefix && binding.subjectId.startsWith(prefix)
    ? binding.subjectId.slice(prefix.length).trim() || undefined
    : undefined;
}

function displayAttentionTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function metadataString(event: MonitorEvent, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? value : '';
}
