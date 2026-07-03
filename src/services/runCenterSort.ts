import { isFreshActiveRun } from './runStatus';

export interface RunCenterSortableRun {
  id?: unknown;
  status?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
  [key: string]: unknown;
}

export function sortedRunCenterRuns<T extends RunCenterSortableRun>(runs: T[]): T[] {
  return [...runs].sort(compareRunCenterRuns);
}

export function compareRunCenterRuns(a: RunCenterSortableRun, b: RunCenterSortableRun): number {
  return runCenterStatusPriority(a) - runCenterStatusPriority(b)
    || runCenterSortTimestamp(b) - runCenterSortTimestamp(a)
    || stringOrDefault(a.id, '').localeCompare(stringOrDefault(b.id, ''));
}

export function runCenterStatusPriority(run: RunCenterSortableRun): number {
  if (isFreshActiveRun(run)) { return 0; }
  const status = stringOrDefault(run.status, 'unknown');
  if (status === 'waiting_for_review') { return 1; }
  if (status === 'needs_human') { return 2; }
  if (status === 'completed') { return 3; }
  if (status === 'failed' || status === 'cancelled') { return 5; }
  return 4;
}

export function runCenterSortTimestamp(run: RunCenterSortableRun): number {
  const status = stringOrDefault(run.status, 'unknown');
  const preferred = isFreshActiveRun(run) ? run.startedAt : run.endedAt || run.startedAt;
  const fallback = status === 'completed' || status === 'failed' || status === 'cancelled' ? run.startedAt : run.endedAt;
  return toValidDate(preferred)?.getTime() || toValidDate(fallback)?.getTime() || 0;
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function toValidDate(value: unknown): Date | null {
  const date = value instanceof Date || typeof value === 'string' || typeof value === 'number'
    ? new Date(value)
    : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}
