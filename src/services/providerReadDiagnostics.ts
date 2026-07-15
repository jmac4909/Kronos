import { boundedOperationFailure } from './errorUtils';
import type { MonitorEvent, MonitorEventSource } from './monitorEventStore';
import { readFailureLabel } from './providerReadHealth';
import type { JiraWorkRefreshStatus } from './workRefreshStatus';

export type ProviderDiagnosticId = 'jira' | 'gitlab' | 'jenkins' | 'sonar';
export type ProviderDiagnosticStatus = 'warn' | 'fail';
export type ProviderDiagnosticAction = 'openProviderEnvironment' | 'openJiraBoard' | 'pollProvidersNow';

export interface ProviderReadDiagnostic {
  provider: ProviderDiagnosticId;
  status: ProviderDiagnosticStatus;
  detail: string;
  action: ProviderDiagnosticAction;
  actionLabel: string;
  problemCount: number;
  observedAt?: string;
}

/**
 * Projects current provider-read truth from bounded Jira state and append-only
 * audit events. A later complete read clears only its own provider stream.
 */
export function currentProviderReadDiagnostics(
  events: readonly MonitorEvent[],
  jiraStatus?: JiraWorkRefreshStatus,
): ProviderReadDiagnostic[] {
  const diagnostics: ProviderReadDiagnostic[] = [];
  const jira = jiraDiagnostic(jiraStatus);
  if (jira) { diagnostics.push(jira); }

  const latestByStream = new Map<string, MonitorEvent>();
  for (const event of [...events].sort(compareNewestFirst)) {
    const source = diagnosticProvider(event.source);
    const readState = metadataString(event, 'readState');
    const subject = event.subject;
    if (!source || !subject || event.type !== 'provider.transition'
      || !['complete', 'partial', 'failed'].includes(readState)) {
      continue;
    }
    const stream = `${event.sessionId}\u0000${source}\u0000${subject.kind}\u0000${subject.id}`;
    if (!latestByStream.has(stream)) { latestByStream.set(stream, event); }
  }

  for (const provider of ['gitlab', 'jenkins', 'sonar'] as const) {
    const problems = [...latestByStream.values()]
      .filter(event => event.source === provider && metadataString(event, 'readState') !== 'complete')
      .sort(compareProblemPriority);
    const latest = problems[0];
    if (!latest) { continue; }
    const state = metadataString(latest, 'readState');
    const observedAt = safeTimestamp(latest.at);
    if (state === 'failed') {
      const failure = failureForReadReason(metadataString(latest, 'readReason'));
      diagnostics.push({
        provider,
        status: 'fail',
        detail: `${problems.length} current provider read stream${problems.length === 1 ? '' : 's'} failed or remained partial. Latest failure: ${failure.display}`,
        action: failure.retryable ? 'pollProvidersNow' : 'openProviderEnvironment',
        actionLabel: failure.retryable ? 'Poll Now' : 'Repair Private Config',
        problemCount: problems.length,
        ...(observedAt ? { observedAt } : {}),
      });
      continue;
    }
    const components = metadataString(latest, 'readComponents')
      .split(',').map(value => safeSingleLine(value, 100)).filter(value => value && value !== 'none');
    diagnostics.push({
      provider,
      status: 'warn',
      detail: `${problems.length} current provider read stream${problems.length === 1 ? ' is' : 's are'} partial. Latest incomplete components: ${components.join(', ') || 'bounded provider evidence'}. Last-known complete facets remain retained.`,
      action: 'pollProvidersNow',
      actionLabel: 'Poll Now',
      problemCount: problems.length,
      ...(observedAt ? { observedAt } : {}),
    });
  }
  return diagnostics;
}

function jiraDiagnostic(status: JiraWorkRefreshStatus | undefined): ProviderReadDiagnostic | undefined {
  if (!status || (status.phase !== 'error' && status.phase !== 'partial')) { return undefined; }
  const observedAt = safeTimestamp(status.completedAt || status.startedAt);
  if (status.phase === 'partial') {
    return {
      provider: 'jira',
      status: 'warn',
      detail: `The latest Jira read is partial with ${boundedCount(status.warningCount)} warning${status.warningCount === 1 ? '' : 's'}; ${boundedCount(status.retainedFromPrevious)} prior ticket${status.retainedFromPrevious === 1 ? ' was' : 's were'} retained.`,
      action: 'openJiraBoard',
      actionLabel: 'Open Jira Board',
      problemCount: 1,
      ...(observedAt ? { observedAt } : {}),
    };
  }
  const detail = safeSingleLine(status.detail, 1_600) || 'Jira ticket refresh failed safely.';
  return {
    provider: 'jira',
    status: 'fail',
    detail,
    action: 'openJiraBoard',
    actionLabel: 'Open Jira Board',
    problemCount: 1,
    ...(observedAt ? { observedAt } : {}),
  };
}

function failureForReadReason(reason: string) {
  const label = readFailureLabel(reason);
  const message = reason === 'authentication' ? `Provider read failed with HTTP 401 (${label}).`
    : reason === 'permission' ? `Provider read failed with HTTP 403 (${label}).`
      : reason === 'rate_limited' ? `Provider read failed with HTTP 429 (${label}).`
        : reason === 'not_found' ? `Provider read failed with HTTP 404 (${label}).`
          : reason === 'safety_limit' ? `Provider response exceeded the response safety limit (${label}).`
            : reason === 'malformed_response' ? `Provider returned a malformed response (${label}).`
              : label;
  return boundedOperationFailure(new Error(message), 'Provider read unavailable.');
}

function diagnosticProvider(source: MonitorEventSource): Exclude<ProviderDiagnosticId, 'jira'> | undefined {
  return source === 'gitlab' || source === 'jenkins' || source === 'sonar' ? source : undefined;
}

function compareNewestFirst(left: MonitorEvent, right: MonitorEvent): number {
  return right.at.localeCompare(left.at) || right.id.localeCompare(left.id);
}

function compareProblemPriority(left: MonitorEvent, right: MonitorEvent): number {
  const leftFailed = metadataString(left, 'readState') === 'failed' ? 1 : 0;
  const rightFailed = metadataString(right, 'readState') === 'failed' ? 1 : 0;
  return rightFailed - leftFailed || compareNewestFirst(left, right);
}

function metadataString(event: MonitorEvent, key: string): string {
  const value = event.metadata?.[key];
  return typeof value === 'string' ? safeSingleLine(value, 500) : '';
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function safeTimestamp(value: unknown): string | undefined {
  const text = safeSingleLine(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function boundedCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0;
}
