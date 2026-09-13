import type { WorkSessionRecord } from './workSessionStore';

export interface ProviderMonitoringHealth {
  enabled: boolean;
  state: 'healthy' | 'partial' | 'blocked' | 'idle' | 'paused';
  lastAttemptAt?: string;
  lastSuccessfulAt?: string;
  lastMeaningfulChangeAt?: string;
  nextScheduledAt?: string;
  currentError?: string;
  suppressedUnchangedCount: number;
}

export function sessionProviderMonitoringHealth(
  session: Pick<WorkSessionRecord, 'status' | 'monitoring'>,
  pollIntervalMs: number,
): ProviderMonitoringHealth {
  const monitoring = session.monitoring;
  const enabled = session.status === 'active' && monitoring.enabled;
  const lastSuccessfulAt = monitoring.lastSuccessfulAt
    || ((monitoring.lastFailureCount || 0) === 0 ? monitoring.lastPolledAt : undefined);
  const result: ProviderMonitoringHealth = {
    enabled,
    state: enabled ? monitoring.lastState || 'idle' : 'paused',
    suppressedUnchangedCount: monitoring.suppressedUnchangedCount || 0,
  };
  assign(result, 'lastAttemptAt', monitoring.lastAttemptAt);
  assign(result, 'lastSuccessfulAt', lastSuccessfulAt);
  assign(result, 'lastMeaningfulChangeAt', monitoring.lastMeaningfulChangeAt);
  assign(result, 'currentError', monitoring.currentError);
  const nextScheduledAt = enabled ? nextPollAt(monitoring.lastAttemptAt, pollIntervalMs) : undefined;
  assign(result, 'nextScheduledAt', nextScheduledAt);
  return result;
}

export function projectProviderMonitoringHealth(
  sessions: readonly Pick<WorkSessionRecord, 'status' | 'monitoring'>[],
  pollIntervalMs: number,
): ProviderMonitoringHealth {
  const values = sessions.map(session => sessionProviderMonitoringHealth(session, pollIntervalMs));
  const enabled = values.some(value => value.enabled);
  const state = values.some(value => value.state === 'blocked') ? 'blocked'
    : values.some(value => value.state === 'partial') ? 'partial'
      : values.some(value => value.state === 'healthy') ? 'healthy'
        : enabled ? 'idle' : 'paused';
  const result: ProviderMonitoringHealth = {
    enabled,
    state,
    suppressedUnchangedCount: values.reduce(
      (total, value) => Math.min(Number.MAX_SAFE_INTEGER, total + value.suppressedUnchangedCount),
      0,
    ),
  };
  assign(result, 'lastAttemptAt', newest(values.map(value => value.lastAttemptAt)));
  assign(result, 'lastSuccessfulAt', newest(values.map(value => value.lastSuccessfulAt)));
  assign(result, 'lastMeaningfulChangeAt', newest(values.map(value => value.lastMeaningfulChangeAt)));
  assign(result, 'nextScheduledAt', oldest(values.filter(value => value.enabled).map(value => value.nextScheduledAt)));
  assign(result, 'currentError', values.find(value => value.currentError)?.currentError);
  return result;
}

export function providerMonitoringHealthSummary(health: ProviderMonitoringHealth): string {
  return {
    healthy: 'Up to date',
    partial: 'Needs review',
    blocked: 'Blocked',
    idle: 'Waiting for first check',
    paused: 'Paused',
  }[health.state];
}

function nextPollAt(lastAttemptAt: string | undefined, pollIntervalMs: number): string | undefined {
  if (!lastAttemptAt || !Number.isFinite(pollIntervalMs) || pollIntervalMs < 1) { return undefined; }
  const attempt = Date.parse(lastAttemptAt);
  if (!Number.isFinite(attempt)) { return undefined; }
  const next = attempt + Math.floor(pollIntervalMs);
  if (!Number.isFinite(next) || next > 8_640_000_000_000_000) { return undefined; }
  return new Date(next).toISOString();
}

function newest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function oldest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort()[0];
}

function assign<K extends keyof ProviderMonitoringHealth>(
  target: ProviderMonitoringHealth,
  key: K,
  value: ProviderMonitoringHealth[K] | undefined,
): void {
  if (value !== undefined) { target[key] = value; }
}
