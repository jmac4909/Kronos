import { classifyRunFailure, type RunFailureKind } from './postRunReadiness';

export type RunAttentionSource =
  | 'failureReason'
  | 'readiness'
  | 'error'
  | 'eventDetail'
  | 'eventLabel'
  | 'failureKind'
  | 'status';

export interface RunAttentionSummary {
  status: string;
  failureKind: RunFailureKind;
  label: string;
  reason: string;
  detail: string;
  source: RunAttentionSource;
}

const FAILURE_KIND_LABELS: Record<RunFailureKind, string> = {
  none: '',
  auth: 'Auth or credential issue',
  model: 'Model access issue',
  script: 'Script or CLI failure',
  git: 'Git/worktree issue',
  build: 'Build failed',
  test: 'Tests failed',
  sonar: 'SonarQube issue',
  timeout: 'Timed out',
  cancelled: 'Cancelled',
  unknown: '',
};
const ATTENTION_RUN_STATUSES = new Set(['failed', 'needs_human', 'cancelled']);

export function isAttentionRunStatus(status: unknown): boolean {
  return typeof status === 'string' && ATTENTION_RUN_STATUSES.has(status);
}

export function summarizeRunAttention(run: unknown): RunAttentionSummary {
  const record = runRecord(run);
  const status = runText(record['status']) || 'unknown';
  const failureKind = coerceRunFailureKind(runText(record['failureKind'])) || classifyRunFailure(run);
  const label = runFailureKindLabel(failureKind, status);
  const reason = firstRunAttentionReason(record);

  if (reason) {
    return {
      status,
      failureKind,
      label,
      reason: reason.value,
      detail: composeRunAttentionDetail(label, reason.value),
      source: reason.source,
    };
  }

  if (failureKind !== 'none' && failureKind !== 'unknown') {
    return {
      status,
      failureKind,
      label,
      reason: '',
      detail: label,
      source: 'failureKind',
    };
  }

  const detail = status === 'unknown' ? 'Run needs review' : `Run status is ${status.replace(/_/g, ' ')}`;
  return {
    status,
    failureKind,
    label,
    reason: '',
    detail,
    source: 'status',
  };
}

export function runAttentionDetail(run: unknown): string {
  return summarizeRunAttention(run).detail;
}

export function runAttentionLine(run: unknown, maxLength = 140): string {
  const text = runAttentionDetail(run).replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.substring(0, maxLength - 3)}...` : text;
}

function runFailureKindLabel(kind: RunFailureKind, status = ''): string {
  const label = FAILURE_KIND_LABELS[kind];
  if (label) { return label; }
  if (status === 'needs_human') { return 'Needs human review'; }
  if (status === 'failed') { return 'Run failed'; }
  if (status === 'cancelled') { return 'Cancelled'; }
  if (status && status !== 'unknown') { return `Run ${status.replace(/_/g, ' ')}`; }
  return 'Run needs review';
}

function firstRunAttentionReason(record: Record<string, unknown>): { value: string; source: RunAttentionSource } | undefined {
  const readiness = runRecord(record['readiness']);
  const candidates: Array<{ value: unknown; source: RunAttentionSource }> = [
    { value: record['failureReason'], source: 'failureReason' },
    { value: readiness['summary'], source: 'readiness' },
    { value: record['error'], source: 'error' },
    { value: latestEventField(record['events'], 'detail'), source: 'eventDetail' },
    { value: latestEventField(record['events'], 'label'), source: 'eventLabel' },
  ];
  for (const candidate of candidates) {
    const value = runText(candidate.value);
    if (value) { return { value, source: candidate.source }; }
  }
  return undefined;
}

function composeRunAttentionDetail(label: string, reason: string): string {
  if (!label) { return reason; }
  if (!reason) { return label; }
  const normalizedLabel = normalizeText(label);
  const normalizedReason = normalizeText(reason);
  if (normalizedLabel && (normalizedReason === normalizedLabel || normalizedReason.includes(normalizedLabel))) {
    return reason;
  }
  return `${label}: ${reason}`;
}

function latestEventField(events: unknown, field: 'detail' | 'label'): unknown {
  if (!Array.isArray(events)) { return undefined; }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = runRecord(events[i]);
    const value = runText(event[field]);
    if (value) { return value; }
  }
  return undefined;
}

function coerceRunFailureKind(value: string): RunFailureKind | undefined {
  return isRunFailureKind(value) ? value : undefined;
}

function isRunFailureKind(value: string): value is RunFailureKind {
  return Object.prototype.hasOwnProperty.call(FAILURE_KIND_LABELS, value);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function runRecord(value: unknown): Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function runText(value: unknown): string {
  if (value === undefined || value === null) { return ''; }
  return String(value).trim();
}
