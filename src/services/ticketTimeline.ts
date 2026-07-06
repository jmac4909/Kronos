import { QueueState, Ticket } from '../state/types';
import { buildStatusKind } from './buildStatus';
import { evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './evidenceData';
import { mergeRequestReviewStatusLabel } from './mergeRequestLabels';
import { isAttentionRunStatus, runAttentionDetail } from './runAttention';
import { recordString } from './records';
import { toValidDate } from './dateValues';
import { isSuccessfulRunStatus } from './runStatus';
import { runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords';
import { runProgressSummary } from './runProgress';

type TimelineSource = 'jira' | 'queue' | 'run' | 'evidence' | 'mr' | 'build' | 'ticket';
type TimelineSeverity = 'info' | 'success' | 'warning' | 'failure';

interface TimelineRun {
  id: string;
  ticket?: string;
  project?: string;
  skill?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  model?: string;
  promptHash?: string;
  worktreePath?: string;
  logPath?: string;
}

export interface TimelineEvent {
  id: string;
  at?: string;
  source: TimelineSource;
  severity: TimelineSeverity;
  title: string;
  detail: string;
  url?: string;
  artifactPath?: string;
}

interface TicketTimelineInput {
  ticketKey: string;
  ticket: Ticket;
  queue?: QueueState | null;
  runs?: TimelineRun[];
}

export function buildTicketTimeline(input: TicketTimelineInput): TimelineEvent[] {
  const { ticketKey, ticket } = input;
  const events: TimelineEvent[] = [];
  const runs = runLikeRecordsFromUnknown(input.runs);

  if (ticket.updated) {
    events.push(timelineEvent({
      id: `${ticketKey}:jira-updated`,
      source: 'jira',
      severity: 'info',
      title: `Jira status: ${ticket.jira_status}`,
      detail: ticket.summary,
    }, { at: ticket.updated, url: ticket.jira_url }));
  }

  if (ticket.last_action_at || ticket.last_action) {
    events.push(timelineEvent({
      id: `${ticketKey}:last-action`,
      source: 'ticket',
      severity: severityForAction(ticket.next_action),
      title: `Kronos action: ${ticket.last_action || ticket.next_action}`,
      detail: `Next action is ${ticket.next_action}`,
    }, { at: ticket.last_action_at || undefined }));
  }

  const queuedItems = (input.queue?.items || []).filter(item => item.ticket === ticketKey);
  for (const item of queuedItems) {
    events.push(timelineEvent({
      id: `${ticketKey}:queue:${item.id}`,
      source: 'queue',
      severity: 'info',
      title: `Queued: ${item.action}`,
      detail: `${item.reason || 'No reason recorded'} (score ${item.priority_score})`,
    }, { at: input.queue?.last_computed || undefined }));
  }

  const notes = evidenceNotes(ticket);
  for (const [idx, note] of notes.entries()) {
    const kind = evidenceString(note, 'kind', 'note');
    events.push(timelineEvent({
      id: `${ticketKey}:evidence:${idx}`,
      source: 'evidence',
      severity: kind === 'risk' ? 'warning' : kind === 'test' ? 'success' : 'info',
      title: `${kind} evidence`,
      detail: evidenceString(note, 'text'),
    }, { at: evidenceString(note, 'at') || undefined }));
  }

  const checks = evidenceChecks(ticket);
  for (const [idx, check] of checks.entries()) {
    const result = evidenceString(check, 'result', 'unknown');
    const environment = evidenceString(check, 'environment');
    const summary = evidenceString(check, 'summary');
    const command = evidenceString(check, 'command');
    events.push(timelineEvent({
      id: `${ticketKey}:evidence-check:${evidenceString(check, 'id') || idx}`,
      source: 'evidence',
      severity: result === 'fail' ? 'failure' : result === 'pass' ? 'success' : 'warning',
      title: `Evidence check: ${evidenceString(check, 'name', 'Unnamed check')}`,
      detail: [
        `Result: ${result}`,
        environment ? `Environment: ${environment}` : '',
        summary,
        command ? `Command: ${command}` : '',
      ].filter(Boolean).join('\n'),
    }, {
      at: evidenceString(check, 'at') || undefined,
      url: evidenceString(check, 'artifact_path') || undefined,
    }));
  }

  const environmentResults = evidenceEnvironmentResults(ticket);
  for (const result of environmentResults) {
    const environment = evidenceString(result, 'environment', 'environment');
    const status = evidenceString(result, 'status', 'unknown');
    events.push(timelineEvent({
      id: `${ticketKey}:environment:${environment}`,
      source: 'evidence',
      severity: status === 'fail' ? 'failure' : status === 'pass' ? 'success' : 'warning',
      title: `Environment ${environment}: ${status}`,
      detail: evidenceString(result, 'detail'),
    }, {
      at: evidenceString(result, 'checked_at') || undefined,
      url: evidenceString(result, 'artifact_path') || undefined,
    }));
  }

  if (ticket.mr) {
    events.push(timelineEvent({
      id: `${ticketKey}:mr:${ticket.mr.iid}`,
      source: 'mr',
      severity: ticket.mr.review_status === 'changes_requested' ? 'failure' : ticket.mr.review_status === 'approved' ? 'success' : 'warning',
      title: `MR !${ticket.mr.iid}: ${ticket.mr.state}`,
      detail: mergeRequestReviewStatusLabel(ticket.mr.review_status),
    }, { at: ticket.updated || ticket.last_action_at || undefined, url: ticket.mr.url }));
  }

  if (ticket.build) {
    events.push(timelineEvent({
      id: `${ticketKey}:build:${ticket.build.number}`,
      source: 'build',
      severity: severityForBuild(ticket.build.status),
      title: `Build #${ticket.build.number}: ${ticket.build.status}`,
      detail: ticket.build.url || '',
    }, { at: ticket.updated || ticket.last_action_at || undefined, url: ticket.build.url }));
  }

  for (const run of runs.filter(r => recordString(r, 'ticket') === ticketKey)) {
    const status = recordString(run, 'status') || 'unknown';
    events.push(timelineEvent({
      id: `${ticketKey}:run:${runId(run)}`,
      source: 'run',
      severity: severityForRun(status),
      title: `Run ${status}: ${recordString(run, 'skill') || 'session'}`,
      detail: runDetail(run),
    }, {
      at: recordString(run, 'endedAt') || recordString(run, 'startedAt') || undefined,
      artifactPath: recordString(run, 'logPath') || undefined,
    }));
  }

  return events.sort(compareTimelineEvents);
}

function timelineEvent(
  core: Omit<TimelineEvent, 'at' | 'url' | 'artifactPath'>,
  refs: { at?: string | undefined; url?: string | undefined; artifactPath?: string | undefined } = {},
): TimelineEvent {
  const event: TimelineEvent = { ...core };
  if (refs.at) { event.at = refs.at; }
  if (refs.url) { event.url = refs.url; }
  if (refs.artifactPath) { event.artifactPath = refs.artifactPath; }
  return event;
}

function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  const atA = timestampValue(a.at);
  const atB = timestampValue(b.at);
  if (atA !== atB) { return atB - atA; }
  return a.id.localeCompare(b.id);
}

function timestampValue(value: string | undefined): number {
  return toValidDate(value)?.getTime() || 0;
}

function severityForAction(action: string): TimelineSeverity {
  if (action === 'blocked' || action === 'fix_build') { return 'failure'; }
  if (action === 'await_review' || action === 'verify' || action === 'deploy_monitor') { return 'warning'; }
  if (action === 'done') { return 'success'; }
  return 'info';
}

function severityForBuild(status: string): TimelineSeverity {
  const kind = buildStatusKind(status);
  if (kind === 'pass') { return 'success'; }
  if (kind === 'fail') { return 'failure'; }
  return 'warning';
}

function severityForRun(status: string | undefined): TimelineSeverity {
  if (isSuccessfulRunStatus(status)) { return 'success'; }
  if (status === 'failed' || status === 'needs_human') { return 'failure'; }
  if (status === 'cancelled' || status === 'running' || status === 'preflight') { return 'warning'; }
  return 'info';
}

function runDetail(run: RunLikeRecord): string {
  const status = recordString(run, 'status');
  const attentionDetail = isAttentionRunStatus(status) ? runAttentionDetail(run) : '';
  const progress = runProgressSummary(run);
  const parts = [
    attentionDetail || recordString(run, 'failureReason'),
    progress.label,
    progress.detail,
  ].filter(Boolean);
  return parts.join(' | ');
}

function runId(run: RunLikeRecord): string {
  return recordString(run, 'id') || 'run';
}
