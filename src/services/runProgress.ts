import { isActiveRunStatus } from './runStatus';
import { isRecord, recordFromUnknown } from './records';
import { toValidDate } from './dateValues';

interface RunProgressSummary {
  toolCalls: number;
  toolErrors: number;
  filesRead: number;
  filesChanged: number;
  elapsedSeconds: number;
  label: string;
  detail: string;
}

export function runProgressSummary(run: unknown, now = new Date()): RunProgressSummary {
  const record = recordFromUnknown(run);
  const events = runEvents(record);
  const toolCalls = events.filter(event => eventString(event, 'type') === 'tool').length;
  const toolErrors = events.filter(event => eventString(event, 'type') === 'error').length;
  const filesRead = fileCount(events, /^Reading /);
  const filesChanged = fileCount(events, /^(Editing |Writing )/);
  const elapsedSeconds = elapsedRunSeconds(record, events, now);
  const label = [
    countLabel(toolCalls, 'tool'),
    countLabel(filesChanged, 'changed', 'changed'),
    formatElapsed(elapsedSeconds),
  ].join(' | ');
  const detailParts = [
    countLabel(filesRead, 'read', 'read'),
    toolErrors > 0 ? countLabel(toolErrors, 'error') : '',
  ].filter(Boolean);
  return {
    toolCalls,
    toolErrors,
    filesRead,
    filesChanged,
    elapsedSeconds,
    label,
    detail: detailParts.join(' | '),
  };
}

export function formatRunProgress(run: unknown, now = new Date()): string {
  return runProgressSummary(run, now).label;
}

function elapsedRunSeconds(record: Record<string, unknown>, events: Array<Record<string, unknown>>, now: Date): number {
  const eventDates = events
    .map(event => toValidDate(event['timestamp']))
    .filter((date): date is Date => Boolean(date));
  const started = toValidDate(record['startedAt']) || eventDates[0];
  if (!started) { return 0; }
  const ended = toValidDate(record['endedAt'])
    || (isActiveRunStatus(record['status']) ? toValidDate(now) : eventDates[eventDates.length - 1])
    || started;
  return Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000));
}

function runEvents(record: Record<string, unknown>): Array<Record<string, unknown>> {
  return Array.isArray(record['events'])
    ? record['events'].filter(isRecord)
    : [];
}

function fileCount(events: Array<Record<string, unknown>>, pattern: RegExp): number {
  const files = new Set<string>();
  for (const event of events) {
    const label = eventString(event, 'label');
    if (pattern.test(label)) {
      files.add(label.replace(pattern, ''));
    }
  }
  return files.size;
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatElapsed(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

function eventString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
