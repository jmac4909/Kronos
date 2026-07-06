import { classifyRunFailure, type RunFailureKind } from './postRunReadiness';
import { recordsFromUnknown, recordFromUnknown } from './records';
import { runStatusDisplayLabel } from './runLabels';
import { runSignalText } from './runSignals';
import { isFailedTerminalRunStatus } from './runStatus';
import { compactSingleLineText } from './textFormat';

type RunAttentionSource =
  | 'failureReason'
  | 'readiness'
  | 'error'
  | 'eventDetail'
  | 'eventLabel'
  | 'failureKind'
  | 'status';

interface RunAttentionSummary {
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
export function isAttentionRunStatus(status: unknown): boolean {
  return isFailedTerminalRunStatus(status);
}

function summarizeRunAttention(run: unknown): RunAttentionSummary {
  const record = recordFromUnknown(run);
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

  const detail = status === 'unknown' ? 'Run needs review' : `Run status is ${runStatusDisplayLabel(status)}`;
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
  return compactSingleLineText(runAttentionDetail(run), maxLength);
}

function runFailureKindLabel(kind: RunFailureKind, status = ''): string {
  const label = FAILURE_KIND_LABELS[kind];
  if (label) { return label; }
  if (status === 'needs_human') { return 'Needs human review'; }
  if (status === 'failed') { return 'Run failed'; }
  if (status === 'cancelled') { return 'Cancelled'; }
  if (status && status !== 'unknown') { return `Run ${runStatusDisplayLabel(status)}`; }
  return 'Run needs review';
}

function firstRunAttentionReason(record: Record<string, unknown>): { value: string; source: RunAttentionSource } | undefined {
  const readiness = recordFromUnknown(record['readiness']);
  const candidates: Array<{ value: unknown; source: RunAttentionSource }> = [
    { value: record['failureReason'], source: 'failureReason' },
    { value: readiness['summary'], source: 'readiness' },
    { value: record['error'], source: 'error' },
    { value: latestEventField(record['events'], 'detail'), source: 'eventDetail' },
    { value: latestEventField(record['events'], 'label'), source: 'eventLabel' },
  ];
  for (const candidate of candidates) {
    const value = candidate.source === 'eventDetail' || candidate.source === 'eventLabel'
      ? runSignalText(candidate.value, 140)
      : runText(candidate.value);
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
  const eventRecords = recordsFromUnknown(events);
  for (let i = eventRecords.length - 1; i >= 0; i -= 1) {
    const event = eventRecords[i];
    if (!event) { continue; }
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

function runText(value: unknown): string {
  if (value === undefined || value === null) { return ''; }
  return String(value).trim();
}
