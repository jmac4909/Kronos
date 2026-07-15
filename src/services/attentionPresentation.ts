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

export type AttentionActionContext =
  | 'attention_provider'
  | 'attention_repair'
  | 'attention_provider_ticket'
  | 'attention_repair_ticket'
  | 'attention_provider_ticket_gitlab'
  | 'attention_repair_ticket_gitlab'
  | 'attention_provider_ticket_ci'
  | 'attention_repair_ticket_ci';

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
): AttentionActionContext {
  const prefix = providerUrl ? 'attention_provider' : 'attention_repair';
  if (!ticketKey) { return prefix; }
  if (source === 'gitlab') { return `${prefix}_ticket_gitlab`; }
  if (source === 'jenkins' || source === 'sonar') { return `${prefix}_ticket_ci`; }
  return `${prefix}_ticket`;
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
  return {
    project,
    provider,
    subject,
    severity,
    observedAt,
    changedAt,
    why: event.summary,
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
