import { isRecord, recordsFromUnknown } from './records';
import { toValidDate } from './dateValues';

const ACTIVE_RUN_STATUSES = new Set(['preflight', 'running', 'paused']);
const STALEABLE_ACTIVE_RUN_STATUSES = new Set(['preflight', 'running']);
const SUCCESSFUL_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);
const FAILED_OR_CANCELLED_RUN_STATUSES = new Set(['failed', 'cancelled']);
const FAILED_TERMINAL_RUN_STATUSES = new Set(['failed', 'cancelled', 'needs_human']);
const FINISHED_RUN_STATUSES = new Set([...SUCCESSFUL_RUN_STATUSES, ...FAILED_TERMINAL_RUN_STATUSES]);
const DEFAULT_STALE_ACTIVE_RUN_MS = 12 * 60 * 60 * 1000;

interface RunStatusLike {
  status?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
  processPid?: unknown;
}

export function runStatus(value: RunStatusLike | unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return ''; }
  const status = Reflect.get(value, 'status');
  return typeof status === 'string' ? status : '';
}

export function isActiveRunStatus(status: unknown): boolean {
  return typeof status === 'string' && ACTIVE_RUN_STATUSES.has(status);
}

export function isSuccessfulRunStatus(status: unknown): boolean {
  return typeof status === 'string' && SUCCESSFUL_RUN_STATUSES.has(status);
}

export function isFailedOrCancelledRunStatus(status: unknown): boolean {
  return typeof status === 'string' && FAILED_OR_CANCELLED_RUN_STATUSES.has(status);
}

export function isFailedTerminalRunStatus(status: unknown): boolean {
  return typeof status === 'string' && FAILED_TERMINAL_RUN_STATUSES.has(status);
}

export function isFinishedRunStatus(status: unknown): boolean {
  return typeof status === 'string' && FINISHED_RUN_STATUSES.has(status);
}

export function isActiveRun(run: RunStatusLike | unknown): boolean {
  return isActiveRunStatus(runStatus(run)) && !hasTerminalRunSignal(run);
}

export function isStaleActiveRun(run: RunStatusLike | unknown, now = new Date(), staleMs = DEFAULT_STALE_ACTIVE_RUN_MS): boolean {
  if (!isActiveRun(run)) { return false; }
  const status = runStatus(run);
  if (!STALEABLE_ACTIVE_RUN_STATUSES.has(status)) { return false; }
  if (staleMs <= 0 || !isRecord(run)) { return false; }
  if (hasLiveProcess(run['processPid'])) { return false; }
  const startedAt = toValidDate(run['startedAt']);
  if (!startedAt) { return false; }
  return now.getTime() - startedAt.getTime() >= staleMs;
}

export function isFreshActiveRun(run: RunStatusLike | unknown, now = new Date(), staleMs = DEFAULT_STALE_ACTIVE_RUN_MS): boolean {
  return isActiveRun(run) && !isStaleActiveRun(run, now, staleMs);
}

export function effectiveRunStatus(run: RunStatusLike | unknown): string {
  const status = runStatus(run);
  if (!isActiveRunStatus(status) || isActiveRun(run)) {
    return status;
  }
  return terminalRunOutcome(run) || status;
}

export function activeRunSummary(runs: Array<RunStatusLike | unknown>, now = new Date()): string {
  const counts = new Map<string, number>();
  for (const run of runs) {
    const status = runStatus(run);
    if (!isFreshActiveRun(run, now)) { continue; }
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  return ['running', 'preflight', 'paused']
    .filter(status => counts.has(status))
    .map(status => `${counts.get(status)} ${status}`)
    .join(', ');
}

function hasTerminalRunSignal(run: RunStatusLike | unknown): boolean {
  return Boolean(terminalRunOutcome(run));
}

export function terminalRunOutcome(run: RunStatusLike | unknown): string | undefined {
  if (!isRecord(run)) { return undefined; }

  const events = recordsFromUnknown(run['events']);
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

function hasLiveProcess(value: unknown): boolean {
  const pid = numericPid(value);
  if (pid === undefined) { return false; }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function numericPid(value: unknown): number | undefined {
  const parsed = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function hasDateLikeValue(value: unknown): boolean {
  if (typeof value !== 'string' && typeof value !== 'number') { return false; }
  return Boolean(toValidDate(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
