import type { WorkSessionRecord } from './workSessionStore';
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
): SessionInventoryPresentation {
  return {
    label: sessionInventoryLabel(session),
    description: sessionInventoryDescription(session, liveCount, pollIntervalMs, observedBranch),
    tooltip: sessionInventoryTooltip(session, liveCount, pollIntervalMs, observedBranch),
  };
}

export function sessionInventorySortOrder(left: WorkSessionRecord, right: WorkSessionRecord): number {
  if (left.status !== right.status) { return left.status === 'active' ? -1 : 1; }
  return right.updatedAt.localeCompare(left.updatedAt)
    || sessionInventoryLabel(left).localeCompare(sessionInventoryLabel(right))
    || left.id.localeCompare(right.id);
}

export function sessionInventoryLabel(session: WorkSessionRecord): string {
  if (session.projectName) { return `${session.projectName}: ${session.title}`; }
  return session.kind === 'ticket' ? `${session.ticketKey}: ${session.title}` : session.title;
}

function sessionInventoryDescription(
  session: WorkSessionRecord,
  liveCount: number,
  pollIntervalMs: number,
  observedBranch?: string,
): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const segments: string[] = [];
  if (session.projectName) {
    segments.push(observedBranch ? `${session.projectName} @ ${observedBranch}` : session.projectName);
  } else if (observedBranch) {
    segments.push(`project @ ${observedBranch}`);
  }
  segments.push(session.ticketKeys.length > 0
    ? `${session.ticketKeys.length} Jira context${session.ticketKeys.length === 1 ? '' : 's'}`
    : 'no Jira context');
  segments.push(lifecycle.terminal === 'attached'
    ? `${liveCount} terminal${liveCount === 1 ? '' : 's'} attached`
    : lifecycle.terminal === 'closed' ? 'terminal closed'
      : lifecycle.terminal === 'none' ? 'no terminal attached'
        : 'terminal detached');
  if (lifecycle.management === 'stopped') {
    segments.push('management stopped');
  } else if (session.ticketKeys.length > 0) {
    const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
    segments.push(lifecycle.monitoring === 'running'
      ? providerMonitoringHealthSummary(health)
      : lifecycle.monitoring === 'paused' ? 'poll paused' : 'poll unavailable');
  }
  return segments.join(' • ');
}

function sessionInventoryTooltip(
  session: WorkSessionRecord,
  liveCount: number,
  pollIntervalMs: number,
  observedBranch?: string,
): string {
  const lifecycle = workSessionLifecycle(session, liveCount);
  const terminalCounts = { attached: 0, detached: 0, closed: 0 };
  for (const terminal of session.terminals) { terminalCounts[terminal.status] += 1; }
  const providerBindings = session.providerBindings.length > 0
    ? boundedListSummary(
      session.providerBindings.map(binding => `${binding.provider} ${binding.resource} ${binding.subjectId}`),
      12,
    )
    : 'none yet; configured providers are discovered automatically';
  const completeArtifacts = session.artifacts.filter(artifact => artifact.complete).length;
  const health = sessionProviderMonitoringHealth(session, pollIntervalMs);
  const lines = [
    `Work session: ${session.id}`,
    `Ticket contexts: ${session.ticketKeys.length > 0 ? boundedListSummary(session.ticketKeys, 20) : 'none'}`,
    `Title: ${session.title}`,
    `Management lifecycle: ${lifecycle.management}`,
    `Terminal lifecycle: ${lifecycle.terminal}`,
    `Monitoring lifecycle: ${lifecycle.monitoring}`,
    'Primary action: Open Terminal.',
    'Reconnect choices appear only when the recorded terminal is no longer attached.',
    'Terminal ownership: operator',
    `Live terminal bindings: ${liveCount}`,
    `Durable terminal history: ${terminalCounts.attached} attached, ${terminalCounts.detached} detached, ${terminalCounts.closed} closed`,
    `Provider bindings: ${providerBindings}`,
    `Context artifacts: ${completeArtifacts} complete, ${session.artifacts.length - completeArtifacts} partial`,
    `Automatic provider polling: ${session.monitoring.enabled ? 'enabled' : 'paused'}`,
    `Monitoring state: ${session.monitoring.lastState || 'not yet polled'}`,
    `Monitoring result: ${session.monitoring.lastSummary || 'none'}`,
    `Monitoring failures: ${session.monitoring.lastFailureCount ?? 0}`,
    `Monitoring skipped: ${session.monitoring.lastSkippedCount ?? 0}`,
    `Last monitoring attempt: ${session.monitoring.lastAttemptAt || 'never'}`,
    `Last successful poll: ${health.lastSuccessfulAt || 'never'}`,
    `Last meaningful provider change: ${health.lastMeaningfulChangeAt || 'never'}`,
    `Next scheduled poll: ${health.nextScheduledAt || 'not scheduled'}`,
    `Current normalized error: ${health.currentError || 'none'}`,
    `Suppressed unchanged polls since last change: ${health.suppressedUnchangedCount}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
  ];
  if (session.projectName) { lines.splice(4, 0, `Project: ${session.projectName}`); }
  if (session.projectPath) { lines.splice(5, 0, `Project path: ${session.projectPath}`); }
  if (observedBranch) { lines.splice(6, 0, `Git branch: ${observedBranch}`); }
  if (session.closedAt) { lines.push(`Closed: ${session.closedAt}`); }
  return lines.join('\n');
}

function boundedListSummary(values: readonly string[], limit: number): string {
  const visible = values.slice(0, limit).join(', ');
  const remaining = values.length - Math.min(values.length, limit);
  return remaining > 0 ? `${visible}, +${remaining} more` : visible;
}
