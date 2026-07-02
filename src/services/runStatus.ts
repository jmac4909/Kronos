export const ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused']);

export interface RunStatusLike {
  status?: unknown;
}

export function runStatus(value: RunStatusLike | unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return ''; }
  const status = Reflect.get(value, 'status');
  return typeof status === 'string' ? status : '';
}

export function isActiveRunStatus(status: unknown): boolean {
  return typeof status === 'string' && ACTIVE_RUN_STATUSES.has(status);
}

export function isActiveRun(run: RunStatusLike | unknown): boolean {
  return isActiveRunStatus(runStatus(run));
}

export function activeRunSummary(runs: Array<RunStatusLike | unknown>): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = runStatus(run);
    if (!isActiveRunStatus(status)) { continue; }
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return ['running', 'preflight', 'paused']
    .filter(status => counts.has(status))
    .map(status => `${counts.get(status)} ${status}`)
    .join(', ');
}
