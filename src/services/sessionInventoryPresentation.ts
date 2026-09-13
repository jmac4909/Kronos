import {
  resumableWorkSessionTerminalBindings,
  workSessionDisplayName,
  type WorkSessionRecord,
} from './workSessionStore';
import { formatDateTimeLabel } from './dateLabels';
import { workSessionLifecycle } from './workSessionLifecycle';
import {
  providerMonitoringHealthSummary,
  sessionProviderMonitoringHealth,
} from './providerMonitoringHealth';

export interface SessionInventoryPresentation {
  label: string;
  description: string;
  tooltip: string;
}

/** Pure Sessions-view projection; it accepts metadata and never terminal content. */
export function sessionInventoryPresentation(
  session: WorkSessionRecord,
  liveCount: number,
  pollIntervalMs: number,
  observedBranch?: string,
  projectDisplayName?: string,
): SessionInventoryPresentation {
  const projectLabel = normalizedProjectLabel(session, projectDisplayName);
  return {
    label: sessionInventoryLabel(session, projectLabel),
    description: sessionInventoryDescription(session, liveCount, pollIntervalMs),
    tooltip: sessionInventoryTooltip(session, liveCount, pollIntervalMs, observedBranch, projectLabel),
  };
}

export function sessionInventorySortOrder(left: WorkSessionRecord, right: WorkSessionRecord): number {
  if (left.status !== right.status) { return left.status === 'active' ? -1 : 1; }
  return right.updatedAt.localeCompare(left.updatedAt)
    || sessionInventoryLabel(left).localeCompare(sessionInventoryLabel(right))
    || left.id.localeCompare(right.id);
}

export function sessionInventoryLabel(session: WorkSessionRecord, projectDisplayName?: string): string {
  const sessionName = workSessionDisplayName(session);
  if (session.projectName) { return `${normalizedProjectLabel(session, projectDisplayName)}: ${sessionName}`; }
  return session.kind === 'ticket' ? `${session.ticketKey}: ${sessionName}` : sessionName;
}

function sessionInventoryDescription(
  session: WorkSessionRecord,
  liveCount: number,
  pollIntervalMs: number,
): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const exactResumeAvailable = liveCount === 0
    && resumableWorkSessionTerminalBindings(session).length > 0;
  if (lifecycle.management === 'stopped') {
    return 'Tracking stopped';
  }
  const segments = [lifecycle.terminal === 'attached'
    ? liveCount === 1 ? 'Connected' : `${liveCount} terminals connected`
    : exactResumeAvailable ? 'Resume available' : 'Reconnect needed'];
  if (session.ticketKeys.length > 0) {
    const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
    segments.push(lifecycle.monitoring === 'running'
      ? providerMonitoringHealthSummary(health)
      : lifecycle.monitoring === 'paused' ? 'Checks paused' : 'Checks unavailable');
  }
  return segments.join(' • ');
}

function sessionInventoryTooltip(
  session: WorkSessionRecord,
  liveCount: number,
  pollIntervalMs: number,
  observedBranch?: string,
  projectDisplayName?: string,
): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const exactResumeAvailable = liveCount === 0
    && resumableWorkSessionTerminalBindings(session).length > 0;
  const providerBindings = session.providerBindings.length > 0
    ? boundedListSummary(
      session.providerBindings.map(binding => providerBindingLabel(binding.provider, binding.resource, binding.subjectId)),
      12,
    )
    : 'None yet';
  const completeArtifacts = session.artifacts.filter(artifact => artifact.complete).length;
  const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
  const sessionName = workSessionDisplayName(session);
  const lines = [
    `${session.displayName ? 'Display name' : 'Title'}: ${sessionName}`,
    ...(session.displayName ? [`Original title: ${session.title}`] : []),
    `Jira tickets: ${session.ticketKeys.length > 0 ? boundedListSummary(session.ticketKeys, 20) : 'None'}`,
    `Terminal: ${exactResumeAvailable ? 'Exact Claude resume available' : terminalStateLabel(lifecycle.terminal, liveCount)}`,
    ...(lifecycle.management === 'stopped' ? ['Tracking: Stopped'] : []),
    `Saved context: ${completeArtifacts} complete, ${session.artifacts.length - completeArtifacts} partial`,
    `Connected sources: ${providerBindings}`,
    ...(session.ticketKeys.length > 0 ? [
      `Provider updates: ${lifecycle.monitoring === 'running'
        ? providerMonitoringHealthSummary(health)
        : lifecycle.monitoring === 'paused' ? 'Paused' : 'Unavailable'}`,
      ...(session.monitoring.lastSummary ? [`Last result: ${session.monitoring.lastSummary}`] : []),
      ...(session.monitoring.lastFailureCount ? [`Problems: ${session.monitoring.lastFailureCount}`] : []),
      ...(session.monitoring.lastSkippedCount ? [`Skipped sources: ${session.monitoring.lastSkippedCount}`] : []),
      `Last checked: ${formatDateTimeLabel(session.monitoring.lastAttemptAt, 'Never')}`,
      `Last successful check: ${formatDateTimeLabel(health.lastSuccessfulAt, 'Never')}`,
      `Last provider change: ${formatDateTimeLabel(health.lastMeaningfulChangeAt, 'Never')}`,
      `Next check: ${formatDateTimeLabel(health.nextScheduledAt, 'Not scheduled')}`,
      ...(health.currentError ? [`Current issue: ${humanState(health.currentError)}`] : []),
    ] : []),
    `Created: ${formatDateTimeLabel(session.createdAt, 'Unknown')}`,
    `Updated: ${formatDateTimeLabel(session.updatedAt, 'Unknown')}`,
    lifecycle.terminal === 'attached'
      ? 'Select to open the terminal.'
      : exactResumeAvailable
        ? 'Select to resume the exact Claude conversation in its saved folder.'
      : lifecycle.management === 'stopped'
        ? 'Select to reconnect the terminal and resume tracking.'
        : 'Select to reconnect the terminal.',
    lifecycle.management === 'stopped'
      ? 'Right-click to view history or remove the Session from Kronos.'
      : lifecycle.terminal === 'attached'
        ? 'Right-click for context, history, and connection actions.'
        : 'Right-click for history and tracking actions.',
  ];
  if (session.projectName) {
    const projectLabel = normalizedProjectLabel(session, projectDisplayName);
    lines.splice(1, 0, `Project: ${projectLabel}`);
  }
  if (session.projectPath) { lines.splice(session.projectName ? 2 : 1, 0, `Folder: ${session.projectPath}`); }
  if (observedBranch) { lines.splice(session.projectName ? 3 : 2, 0, `Branch: ${observedBranch}`); }
  if (session.closedAt) { lines.push(`Closed: ${formatDateTimeLabel(session.closedAt, 'Unknown')}`); }
  return lines.join('\n');
}

function normalizedProjectLabel(session: WorkSessionRecord, displayName?: string): string {
  const normalized = typeof displayName === 'string'
    ? displayName.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
  return normalized || session.projectName || 'Project';
}

function boundedListSummary(values: readonly string[], limit: number): string {
  const visible = values.slice(0, limit).join(', ');
  const remaining = values.length - Math.min(values.length, limit);
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}

function terminalStateLabel(state: ReturnType<typeof workSessionLifecycle>['terminal'], liveCount: number): string {
  if (state === 'attached') { return liveCount === 1 ? 'Connected' : `${liveCount} connected`; }
  if (state === 'closed') { return 'Closed'; }
  if (state === 'none') { return 'Not connected'; }
  return 'Disconnected';
}

function providerBindingLabel(provider: string, resource: string, subjectId: string): string {
  const providerLabel = { jira: 'Jira', gitlab: 'GitLab', jenkins: 'Jenkins', sonar: 'SonarQube' }[provider] || provider;
  const resourceLabel = humanState(resource);
  const identifier = resource === 'merge-request' && /^[1-9][0-9]*$/.test(subjectId) ? `!${subjectId}` : subjectId;
  return `${providerLabel} ${resourceLabel}${identifier ? ` ${identifier}` : ''}`;
}

function humanState(value: string): string {
  const normalized = value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}` : 'Unknown';
}
