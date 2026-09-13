import type { WorkSessionRecord, WorkSessionTerminalBinding } from './workSessionStore';

export type WorkSessionManagementLifecycle = 'active' | 'stopped';
export type WorkSessionTerminalLifecycle = 'none' | 'attached' | 'detached' | 'closed';
export type WorkSessionMonitoringLifecycle = 'running' | 'paused' | 'ineligible' | 'stopped';

export interface WorkSessionLifecycle {
  management: WorkSessionManagementLifecycle;
  terminal: WorkSessionTerminalLifecycle;
  monitoring: WorkSessionMonitoringLifecycle;
  canInsertContext: boolean;
  canPollProviders: boolean;
  canReconnect: boolean;
}

/**
 * One read-only lifecycle projection used by Sessions, polling, and insertion.
 * Durable terminal rows describe history; only the ephemeral live-binding
 * count proves that an exact VS Code Terminal object is currently attached.
 */
export function workSessionLifecycle(
  session: WorkSessionRecord,
  liveTerminalCount: number,
): WorkSessionLifecycle {
  const management: WorkSessionManagementLifecycle = session.status === 'active' ? 'active' : 'stopped';
  const terminal = terminalLifecycle(session.terminals, liveTerminalCount, management);
  const monitoring: WorkSessionMonitoringLifecycle = management === 'stopped'
    ? 'stopped'
    : session.ticketKeys.length === 0
      ? 'ineligible'
      : session.monitoring.enabled ? 'running' : 'paused';
  return {
    management,
    terminal,
    monitoring,
    canInsertContext: management === 'active' && terminal === 'attached',
    canPollProviders: management === 'active' && monitoring === 'running',
    canReconnect: terminal !== 'attached',
  };
}

function terminalLifecycle(
  terminals: readonly WorkSessionTerminalBinding[],
  liveTerminalCount: number,
  management: WorkSessionManagementLifecycle,
): WorkSessionTerminalLifecycle {
  if (management === 'active' && liveTerminalCount > 0) { return 'attached'; }
  const newest = newestTerminalBinding(terminals);
  if (!newest) { return 'none'; }
  if (newest.status === 'closed') { return 'closed'; }
  // Persisted "attached" without an in-memory object is expected after reload.
  return 'detached';
}

function newestTerminalBinding(
  terminals: readonly WorkSessionTerminalBinding[],
): WorkSessionTerminalBinding | undefined {
  return terminals.reduce<WorkSessionTerminalBinding | undefined>((newest, candidate) => {
    if (!newest) { return candidate; }
    const candidateAt = candidate.detachedAt || candidate.attachedAt;
    const newestAt = newest.detachedAt || newest.attachedAt;
    return candidateAt > newestAt || (candidateAt === newestAt && candidate.id > newest.id)
      ? candidate
      : newest;
  }, undefined);
}
