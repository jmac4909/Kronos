export const ACTIVE_RUN_STATUSES = new Set(['queued', 'preflight', 'running', 'paused']);

export interface RunStatusLike {
  status?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
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
  return isActiveRunStatus(runStatus(run)) && !hasTerminalRunSignal(run);
}

export function effectiveRunStatus(run: RunStatusLike | unknown): string {
  const status = runStatus(run);
  if (!isActiveRunStatus(status) || isActiveRun(run)) {
    return status;
  }
  return terminalRunOutcome(run) || status;
}

export function activeRunSummary(runs: Array<RunStatusLike | unknown>): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = runStatus(run);
    if (!isActiveRun(run)) { continue; }
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return ['running', 'preflight', 'queued', 'paused']
    .filter(status => counts.has(status))
    .map(status => `${counts.get(status)} ${status}`)
    .join(', ');
}

export function hasTerminalRunSignal(run: RunStatusLike | unknown): boolean {
  return Boolean(terminalRunOutcome(run));
}

export function terminalRunOutcome(run: RunStatusLike | unknown): string | undefined {
  if (!isRecord(run)) { return undefined; }

  const events = Array.isArray(run['events'])
    ? run['events'].filter(isRecord)
    : [];
  const lastEvent = events[events.length - 1];
  if (isCancellationEvent(lastEvent)) { return 'cancelled'; }

  const exitCode = numericExitCode(run['exitCode']);
  if (exitCode !== undefined) {
    return exitCode === 0 ? 'completed' : 'failed';
  }
  const eventOutcome = terminalEventOutcome(lastEvent);
  if (eventOutcome) { return eventOutcome; }
  if (hasDateLikeValue(run['endedAt'])) {
    return 'needs_human';
  }
  return undefined;
}

function isCancellationEvent(event: Record<string, unknown> | undefined): boolean {
  return stringValue(event?.['label']) === 'Session cancelled';
}

function terminalEventOutcome(event: Record<string, unknown> | undefined): string | undefined {
  if (!event) { return undefined; }
  const eventType = stringValue(event['type']);
  const label = stringValue(event['label']);
  if (eventType === 'done' || label.startsWith('Session complete')) { return 'completed'; }
  if (label.startsWith('Session exited with code')) {
    const code = numericExitCode(label.replace(/^Session exited with code\s*/i, ''));
    return code === 0 ? 'completed' : 'failed';
  }
  return undefined;
}

function numericExitCode(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasDateLikeValue(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') { return false; }
  return Number.isFinite(new Date(value).getTime());
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
