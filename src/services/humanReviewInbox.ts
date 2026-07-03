import { KronosState, QueueState } from '../state/types';
import { RecoveryCheck, RecoveryWorktreeReport } from './recoveryCenter';
import { evaluateEvidenceGate } from './evidenceGate';
import { runAttentionDetail } from './runAttention';

export type HumanReviewSeverity = 'critical' | 'warning' | 'info';
export type HumanReviewKind = 'run' | 'ticket' | 'evidence' | 'integration' | 'worktree' | 'queue';

export interface HumanReviewRun {
  id: string;
  status?: string;
  project?: string;
  ticket?: string;
  skill?: string;
  failureReason?: string;
  startedAt?: string;
}

export interface HumanReviewItem {
  id: string;
  kind: HumanReviewKind;
  severity: HumanReviewSeverity;
  title: string;
  detail: string;
  ticketKey?: string;
  runId?: string;
}

export interface HumanReviewInboxInput {
  state?: KronosState | null;
  queue?: QueueState | null;
  runs?: HumanReviewRun[];
  worktreeReport?: RecoveryWorktreeReport;
  doctorChecks?: RecoveryCheck[];
}

export interface HumanReviewInbox {
  summary: Record<HumanReviewSeverity, number> & { total: number };
  items: HumanReviewItem[];
}

const REVIEW_READY_ACTIONS = new Set(['await_review', 'verify', 'deploy_monitor', 'done']);
type HumanReviewRunRecord = HumanReviewRun & Record<string, unknown>;

export function buildHumanReviewInbox(input: HumanReviewInboxInput): HumanReviewInbox {
  const items: HumanReviewItem[] = [];
  const tickets = input.state?.tickets || {};
  const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord);

  for (const run of runs) {
    const status = runString(run, 'status');
    if (status === 'needs_human' || status === 'failed' || status === 'cancelled') {
      const ticketKey = runString(run, 'ticket');
      items.push(humanReviewItem({
        id: `run:${runId(run)}`,
        kind: 'run',
        severity: status === 'needs_human' ? 'critical' : 'warning',
        title: `${runString(run, 'project') || 'Project'} ${runString(run, 'skill') || 'run'} needs review`,
        detail: runAttentionDetail(run),
      }, { ticketKey, runId: runId(run) }));
    }
  }

  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    if (!ticket.projects || ticket.projects.length === 0) {
      items.push(ticketItem(ticketKey, 'ticket', 'critical', `${ticketKey} is not linked to a project`, ticket.summary));
    }
    if (ticket.next_action === 'blocked') {
      items.push(ticketItem(ticketKey, 'ticket', 'critical', `${ticketKey} is blocked`, ticket.last_action || ticket.summary));
    }
    if (REVIEW_READY_ACTIONS.has(ticket.next_action)) {
      const gate = evaluateEvidenceGate(ticketKey, ticket);
      for (const check of gate.checks.filter(check => check.status !== 'pass')) {
        items.push(ticketItem(
          ticketKey,
          'evidence',
          check.status === 'fail' ? 'critical' : check.kind === 'acceptance' ? 'info' : 'warning',
          `${ticketKey}: ${check.title}`,
          check.detail,
        ));
      }
    }
  }

  for (const result of input.worktreeReport?.results || []) {
    if (result.status !== 'blocked' && result.status !== 'error') { continue; }
    items.push(humanReviewItem({
      id: `worktree:${result.entry.worktreePath}`,
      kind: 'worktree',
      severity: result.status === 'error' ? 'critical' : 'warning',
      title: `${result.entry.ticket || 'Worktree'} needs cleanup review`,
      detail: result.reason,
    }, { ticketKey: result.entry.ticket }));
  }

  for (const check of input.doctorChecks || []) {
    if (check.status === 'pass') { continue; }
    items.push({
      id: `integration:${check.name}`,
      kind: 'integration',
      severity: check.status === 'fail' ? 'critical' : 'warning',
      title: `${check.name} is ${check.status}`,
      detail: check.detail,
    });
  }

  for (const [ticketKey, count] of duplicateQueuedTickets(input.queue).entries()) {
    items.push({
      id: `queue:duplicate:${ticketKey}`,
      kind: 'queue',
      severity: 'warning',
      title: `${ticketKey} is queued ${count} times`,
      detail: 'Remove duplicate queue entries or confirm intentional parallel work.',
      ticketKey,
    });
  }

  const sorted = dedupeItems(items).sort(compareItems);
  return {
    summary: {
      critical: sorted.filter(i => i.severity === 'critical').length,
      warning: sorted.filter(i => i.severity === 'warning').length,
      info: sorted.filter(i => i.severity === 'info').length,
      total: sorted.length,
    },
    items: sorted,
  };
}

function ticketItem(ticketKey: string, kind: HumanReviewKind, severity: HumanReviewSeverity, title: string, detail: string): HumanReviewItem {
  return { id: `${kind}:${ticketKey}:${title}`, kind, severity, title, detail, ticketKey };
}

function humanReviewItem(
  base: Omit<HumanReviewItem, 'ticketKey' | 'runId'>,
  refs: { ticketKey?: string | undefined; runId?: string | undefined } = {},
): HumanReviewItem {
  const item: HumanReviewItem = { ...base };
  if (refs.ticketKey) { item.ticketKey = refs.ticketKey; }
  if (refs.runId) { item.runId = refs.runId; }
  return item;
}

function duplicateQueuedTickets(queue?: QueueState | null): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of queue?.items || []) {
    if (!item.ticket) { continue; }
    counts.set(item.ticket, (counts.get(item.ticket) || 0) + 1);
  }
  for (const [ticketKey, count] of [...counts.entries()]) {
    if (count < 2) { counts.delete(ticketKey); }
  }
  return counts;
}

function dedupeItems(items: HumanReviewItem[]): HumanReviewItem[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.id)) { return false; }
    seen.add(item.id);
    return true;
  });
}

function compareItems(a: HumanReviewItem, b: HumanReviewItem): number {
  return severityWeight(b.severity) - severityWeight(a.severity) || a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title);
}

function severityWeight(severity: HumanReviewSeverity): number {
  if (severity === 'critical') { return 3; }
  if (severity === 'warning') { return 2; }
  return 1;
}

function runId(run: HumanReviewRunRecord): string {
  return runString(run, 'id') || 'run';
}

function runString(run: HumanReviewRunRecord, key: string): string {
  const value = run[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isRunRecord(value: unknown): value is HumanReviewRunRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
