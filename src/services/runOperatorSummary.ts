import { toValidDate } from './dateValues';
import { recordsFromUnknown, recordFromUnknown, recordString } from './records';
import { runAttentionDetail } from './runAttention';
import { runStatusDisplayLabel } from './runLabels';
import { runProgressSummary } from './runProgress';
import { runSignalText } from './runSignals';
import { effectiveRunStatus, isActiveRunStatus, isFailedTerminalRunStatus, isSuccessfulRunStatus } from './runStatus';

export type RunOperatorTone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export interface RunOperatorSummary {
  tone: RunOperatorTone;
  headline: string;
  detail: string;
  nextStep: string;
  latestSignal: string;
  progressLabel: string;
  progressDetail: string;
  changedFiles: string[];
  readFiles: string[];
  facts: Array<{ label: string; value: string; tone?: RunOperatorTone }>;
}

export function buildRunOperatorSummary(run: unknown, now = new Date()): RunOperatorSummary {
  const record = recordFromUnknown(run);
  const status = effectiveRunStatus(record) || recordString(record, 'status') || 'unknown';
  const events = runEvents(record);
  const progress = runProgressSummary(record, now);
  const changedFiles = eventFiles(events, /^(Editing |Writing )/);
  const readFiles = eventFiles(events, /^Reading /);
  const latestSignal = latestMeaningfulSignal(events);
  const readiness = recordFromUnknown(record['readiness']);
  const readinessStatus = recordString(readiness, 'status') || 'unknown';
  const readinessSummary = recordString(readiness, 'summary');
  const attention = attentionSummary(record, status);
  const headline = runHeadline(record, status, attention, readinessStatus, readinessSummary, latestSignal);
  const detail = runDetail(status, progress.label, latestSignal, changedFiles.length, readFiles.length);
  const nextStep = runNextStep(status, readinessStatus, attention);
  return {
    tone: runTone(status, readinessStatus),
    headline,
    detail,
    nextStep,
    latestSignal,
    progressLabel: progress.label,
    progressDetail: progress.detail,
    changedFiles,
    readFiles,
    facts: runFacts(record, status, progress.label, readinessStatus, readinessSummary),
  };
}

function runHeadline(
  record: Record<string, unknown>,
  status: string,
  attention: string,
  readinessStatus: string,
  readinessSummary: string,
  latestSignal: string,
): string {
  if (attention) { return attention; }
  const ticket = recordString(record, 'ticket');
  const skill = recordString(record, 'skill') || 'run';
  const target = ticket ? `${ticket} ${skill}` : skill;
  if (status === 'waiting_for_review') { return `${target} is ready for review`; }
  if (status === 'completed') {
    if (readinessStatus === 'ready') { return `${target} completed and passed readiness`; }
    if (readinessSummary) { return `${target} completed; ${readinessSummary}`; }
    return `${target} completed; readiness needs review`;
  }
  if (isActiveRunStatus(status)) {
    return latestSignal ? `${target} is running: ${latestSignal}` : `${target} is running`;
  }
  return latestSignal ? `${target}: ${latestSignal}` : `${target} status is ${runStatusDisplayLabel(status)}`;
}

function runDetail(status: string, progressLabel: string, latestSignal: string, changedCount: number, readCount: number): string {
  const parts = [progressLabel];
  if (changedCount > 0) { parts.push(`${changedCount} changed file${changedCount === 1 ? '' : 's'}`); }
  if (readCount > 0) { parts.push(`${readCount} file${readCount === 1 ? '' : 's'} inspected`); }
  if (latestSignal && !isActiveRunStatus(status)) { parts.push(`latest: ${latestSignal}`); }
  return parts.join(' · ');
}

function runNextStep(status: string, readinessStatus: string, attention: string): string {
  if (attention) { return 'Inspect the log and diff, fix the blocker, then resume or retry from Run Center.'; }
  if (isActiveRunStatus(status)) { return 'Watch for file changes, tool errors, and readiness output; no manual action unless it stalls.'; }
  if (status === 'waiting_for_review' || readinessStatus === 'ready') { return 'Open the review item, verify evidence, then archive the run when accepted.'; }
  if (status === 'completed') { return 'Confirm readiness and evidence before removing queue work or archiving the run.'; }
  return 'Open the run record and decide whether to retry, resume, mark needs-human, or archive.';
}

function runFacts(
  record: Record<string, unknown>,
  status: string,
  progressLabel: string,
  readinessStatus: string,
  readinessSummary: string,
): Array<{ label: string; value: string; tone?: RunOperatorTone }> {
  const facts: Array<{ label: string; value: string; tone?: RunOperatorTone }> = [
    { label: 'Status', value: runStatusDisplayLabel(status), tone: runTone(status, readinessStatus) },
    { label: 'Progress', value: progressLabel },
  ];
  const startedAt = shortDateTime(record['startedAt']);
  const endedAt = shortDateTime(record['endedAt']);
  if (startedAt) { facts.push({ label: endedAt ? 'Started' : 'Running since', value: startedAt }); }
  if (endedAt) { facts.push({ label: 'Ended', value: endedAt }); }
  if (readinessStatus !== 'unknown' || readinessSummary) {
    facts.push({
      label: 'Readiness',
      value: readinessSummary ? `${readinessStatus}: ${readinessSummary}` : readinessStatus,
      tone: readinessStatus === 'ready' ? 'good' : readinessStatus === 'blocked' ? 'bad' : 'warn',
    });
  }
  return facts;
}

function runTone(status: string, readinessStatus: string): RunOperatorTone {
  if (isFailedTerminalRunStatus(status) || readinessStatus === 'blocked') { return 'bad'; }
  if (status === 'running') { return 'info'; }
  if (['paused', 'preflight'].includes(status) || ['not_ready', 'unknown'].includes(readinessStatus)) { return 'warn'; }
  if (isSuccessfulRunStatus(status) || readinessStatus === 'ready') { return 'good'; }
  return 'neutral';
}

function attentionSummary(record: Record<string, unknown>, status: string): string {
  if (!isFailedTerminalRunStatus(status)) { return ''; }
  return runAttentionDetail(record);
}

function runEvents(record: Record<string, unknown>): Array<Record<string, unknown>> {
  return recordsFromUnknown(record['events']);
}

function eventFiles(events: Array<Record<string, unknown>>, pattern: RegExp): string[] {
  const files = new Set<string>();
  for (const event of events) {
    const label = recordString(event, 'label');
    if (pattern.test(label)) {
      files.add(label.replace(pattern, ''));
    }
  }
  return Array.from(files);
}

function latestMeaningfulSignal(events: Array<Record<string, unknown>>): string {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event) { continue; }
    const detail = runSignalText(recordString(event, 'detail'));
    if (detail) { return detail; }
    const label = runSignalText(recordString(event, 'label'));
    if (label) { return label; }
  }
  return '';
}

function shortDateTime(value: unknown): string {
  const date = toValidDate(value);
  if (!date) { return ''; }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
