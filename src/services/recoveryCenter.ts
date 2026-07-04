import type { RunStoreIssue } from './runStore';
import { runAttentionDetail } from './runAttention';

type RecoverySeverity = 'critical' | 'warning' | 'info';
type RecoveryKind = 'run' | 'worktree' | 'backup' | 'integration' | 'merge_request';
type RecoveryAction =
  | 'openRunCenter'
  | 'resumeRun'
  | 'retryRun'
  | 'archiveRun'
  | 'openRunLog'
  | 'openRunPrompt'
  | 'linkMrToTicket'
  | 'cleanupWorktrees'
  | 'restoreBackup'
  | 'openDoctor';

interface RecoveryRun {
  id: string;
  project?: string;
  skill?: string;
  ticket?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  failureReason?: string;
  promptPath?: string;
  logPath?: string;
  events?: Array<{ label?: string; detail?: string; timestamp?: string }>;
}

interface RecoveryBackup {
  filePath: string;
  targetName: string;
  createdAt: string;
  size: number;
}

interface RecoveryWorktreeResult {
  entry: {
    projectPath: string;
    worktreePath: string;
    ticket: string;
    createdAt: string;
  };
  status: 'missing' | 'removable' | 'removed' | 'blocked' | 'error';
  reason: string;
}

export interface RecoveryWorktreeReport {
  results: RecoveryWorktreeResult[];
  removable: number;
  removed: number;
  blocked: number;
  registryPath?: string;
  registryIssue?: string;
}

export interface RecoveryCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

export interface RecoveryTicket {
  summary?: string;
  source?: string;
  jira_url?: string;
  projects?: string[];
  next_action?: string;
  mr?: {
    iid?: number;
    state?: string;
    review_status?: string;
    url?: string;
  } | null;
}

export interface RecoveryInventoryInput {
  runs?: RecoveryRun[];
  tickets?: Record<string, RecoveryTicket>;
  backups?: RecoveryBackup[];
  runStoreIssues?: RunStoreIssue[];
  worktreeReport?: RecoveryWorktreeReport;
  doctorChecks?: RecoveryCheck[];
  now?: Date;
  staleRunMs?: number;
}

export interface RecoveryItem {
  id: string;
  kind: RecoveryKind;
  severity: RecoverySeverity;
  title: string;
  detail: string;
  action?: RecoveryAction;
  secondaryActions?: Array<{ action: RecoveryAction; label?: string }>;
  actionLabel?: string;
  runId?: string;
  ticketKey?: string;
  backupPath?: string;
  worktreePath?: string;
  mrUrl?: string;
}

export interface RecoveryInventory {
  generatedAt: string;
  summary: Record<RecoverySeverity, number> & { total: number };
  items: RecoveryItem[];
}

const DEFAULT_STALE_RUN_MS = 2 * 60 * 60 * 1000;

export function buildRecoveryInventory(input: RecoveryInventoryInput): RecoveryInventory {
  const now = input.now || new Date();
  const staleRunMs = input.staleRunMs ?? DEFAULT_STALE_RUN_MS;
  const items: RecoveryItem[] = [];

  for (const run of input.runs || []) {
    const item = recoveryItemForRun(run, now, staleRunMs);
    if (item) { items.push(item); }
  }

  for (const issue of input.runStoreIssues || []) {
    items.push(recoveryItemForRunStoreIssue(issue));
  }

  if (input.worktreeReport?.registryIssue) {
    items.push(recoveryItemForWorktreeRegistryIssue(input.worktreeReport.registryIssue, input.worktreeReport.registryPath));
  }

  for (const result of input.worktreeReport?.results || []) {
    const item = recoveryItemForWorktree(result);
    if (item) { items.push(item); }
  }

  for (const [ticketKey, ticket] of Object.entries(input.tickets || {})) {
    const item = recoveryItemForOrphanMergeRequest(ticketKey, ticket);
    if (item) { items.push(item); }
  }

  for (const check of input.doctorChecks || []) {
    if (check.status === 'pass') { continue; }
    items.push({
      id: `integration:${check.name}`,
      kind: 'integration',
      severity: check.status === 'fail' ? 'critical' : 'warning',
      title: `${check.name} needs attention`,
      detail: check.detail,
      action: 'openDoctor',
      actionLabel: 'Open Doctor',
    });
  }

  const backups = [...(input.backups || [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const latest = backups[0];
  if (latest) {
    items.push({
      id: 'backup:latest',
      kind: 'backup',
      severity: 'info',
      title: `${backups.length} state backup${backups.length === 1 ? '' : 's'} available`,
      detail: `Latest ${latest.targetName} backup from ${latest.createdAt}`,
      action: 'restoreBackup',
      actionLabel: 'Restore Backup',
      backupPath: latest.filePath,
    });
  }

  items.sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || a.kind.localeCompare(b.kind));

  return {
    generatedAt: now.toISOString(),
    summary: {
      critical: items.filter(i => i.severity === 'critical').length,
      warning: items.filter(i => i.severity === 'warning').length,
      info: items.filter(i => i.severity === 'info').length,
      total: items.length,
    },
    items,
  };
}

function recoveryItemForOrphanMergeRequest(ticketKey: string, ticket: RecoveryTicket): RecoveryItem | null {
  if (ticket.source !== 'adhoc' || ticket.mr?.state !== 'opened') { return null; }
  const iid = ticket.mr.iid ? `!${ticket.mr.iid}` : 'unknown MR';
  const status = ticket.mr.review_status ? ticket.mr.review_status.replace(/_/g, ' ') : 'unknown review status';
  const item: RecoveryItem = {
    id: `mr:${ticketKey}:${ticket.mr.iid || 'unknown'}`,
    kind: 'merge_request',
    severity: 'warning',
    title: `Orphan MR ${iid} needs a ticket link`,
    detail: `${ticket.summary || ticketKey}\n${iid} is ${status}. Link this ad-hoc MR record to the owning Jira ticket.`,
    action: 'linkMrToTicket',
    actionLabel: 'Link MR to Ticket',
    ticketKey,
  };
  if (ticket.mr.url) { item.mrUrl = ticket.mr.url; }
  return item;
}

function recoveryItemForRun(run: RecoveryRun, now: Date, staleRunMs: number): RecoveryItem | null {
  const label = `${run.project || 'project'} ${run.skill || 'run'}${run.ticket ? ` ${run.ticket}` : ''}`.trim();
  const detail = runAttentionDetail(run);
  const action = run.promptPath ? 'resumeRun' : 'openRunCenter';
  const actionLabel = run.promptPath ? 'Resume Run' : 'Open Run Center';
  const terminalSecondaryActions = terminalRunSecondaryActions(run);
  const activeSecondaryActions = activeRunSecondaryActions(run);

  if (run.status === 'failed' || run.status === 'needs_human') {
    return {
      id: `run:${run.id}`,
      kind: 'run',
      severity: 'critical',
      title: `${label} is ${run.status.replace('_', ' ')}`,
      detail,
      action,
      actionLabel,
      ...(terminalSecondaryActions ? { secondaryActions: terminalSecondaryActions } : {}),
      runId: run.id,
    };
  }

  if (run.status === 'cancelled') {
    return {
      id: `run:${run.id}`,
      kind: 'run',
      severity: 'warning',
      title: `${label} was cancelled`,
      detail,
      action,
      actionLabel,
      ...(terminalSecondaryActions ? { secondaryActions: terminalSecondaryActions } : {}),
      runId: run.id,
    };
  }

  if ((run.status === 'running' || run.status === 'preflight') && isStaleRun(run.startedAt, now, staleRunMs)) {
    return {
      id: `run:${run.id}`,
      kind: 'run',
      severity: 'warning',
      title: `${label} may be abandoned`,
      detail: `Started at ${run.startedAt || 'unknown time'} and is still ${run.status}`,
      action: 'openRunCenter',
      actionLabel: 'Open Run Center',
      ...(activeSecondaryActions ? { secondaryActions: activeSecondaryActions } : {}),
      runId: run.id,
    };
  }

  return null;
}

function terminalRunSecondaryActions(run: RecoveryRun): Array<{ action: RecoveryAction; label?: string }> | undefined {
  const actions: Array<{ action: RecoveryAction; label?: string }> = [];
  if (run.logPath) { actions.push({ action: 'openRunLog', label: 'Log' }); }
  if (run.promptPath) {
    actions.push({ action: 'openRunPrompt', label: 'Prompt' });
    actions.push({ action: 'retryRun', label: 'Retry' });
  }
  actions.push({ action: 'archiveRun', label: 'Archive' });
  return actions.length > 0 ? actions : undefined;
}

function activeRunSecondaryActions(run: RecoveryRun): Array<{ action: RecoveryAction; label?: string }> | undefined {
  const actions: Array<{ action: RecoveryAction; label?: string }> = [];
  if (run.logPath) { actions.push({ action: 'openRunLog', label: 'Log' }); }
  if (run.promptPath) { actions.push({ action: 'openRunPrompt', label: 'Prompt' }); }
  return actions.length > 0 ? actions : undefined;
}

function recoveryItemForRunStoreIssue(issue: RunStoreIssue): RecoveryItem {
  const scopeLabel = issue.scope === 'active' ? 'active' : 'archived';
  return {
    id: `run-store:${issue.scope}:${issue.filePath}`,
    kind: 'run',
    severity: issue.scope === 'active' ? 'critical' : 'warning',
    title: `Invalid ${scopeLabel} run record`,
    detail: `${issue.filePath}\n${issue.detail}`,
    action: 'openRunCenter',
    actionLabel: 'Open Run Center',
  };
}

function recoveryItemForWorktreeRegistryIssue(issue: string, registryPath?: string): RecoveryItem {
  return {
    id: `worktree-registry:${registryPath || 'active-worktrees.json'}`,
    kind: 'worktree',
    severity: 'critical',
    title: 'Active worktree registry needs manual review',
    detail: `${registryPath || 'active-worktrees.json'}\n${issue}`,
    action: 'cleanupWorktrees',
    actionLabel: 'Review Worktrees',
  };
}

function recoveryItemForWorktree(result: RecoveryWorktreeResult): RecoveryItem | null {
  const label = result.entry.ticket || result.entry.worktreePath;
  if (result.status === 'blocked' || result.status === 'error') {
    return {
      id: `worktree:${result.entry.worktreePath}`,
      kind: 'worktree',
      severity: result.status === 'error' ? 'critical' : 'warning',
      title: `${label} worktree needs manual review`,
      detail: result.reason,
      action: 'cleanupWorktrees',
      actionLabel: 'Review Worktrees',
      worktreePath: result.entry.worktreePath,
    };
  }
  if (result.status === 'removable' || result.status === 'missing') {
    return {
      id: `worktree:${result.entry.worktreePath}`,
      kind: 'worktree',
      severity: 'info',
      title: `${label} worktree is safe to clean`,
      detail: result.reason,
      action: 'cleanupWorktrees',
      actionLabel: 'Clean Worktrees',
      worktreePath: result.entry.worktreePath,
    };
  }
  return null;
}

function isStaleRun(startedAt: string | undefined, now: Date, staleRunMs: number): boolean {
  if (!startedAt) { return false; }
  const started = new Date(startedAt).getTime();
  if (!Number.isFinite(started)) { return false; }
  return now.getTime() - started >= staleRunMs;
}

function severityWeight(severity: RecoverySeverity): number {
  if (severity === 'critical') { return 3; }
  if (severity === 'warning') { return 2; }
  return 1;
}
