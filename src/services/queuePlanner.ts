import { KronosState as KronosStateType, QueueDecision, QueueItem, QueueState, Ticket } from '../state/types';
import { actionToLabel } from './actionLabels';
import { evidenceChecks, evidenceEnvironmentResults, evidenceNotes } from './evidenceData';

export { actionToLabel } from './actionLabels';

export interface PlannerInput {
  state: KronosStateType | null;
  queue: QueueState | null;
  resolveProjectPath?: (projectName: string) => string | undefined;
  now?: Date;
}

export interface PlannedAction {
  planId: string;
  ticketKey: string | null;
  action: string;
  projects: string[];
  releaseKeys?: string[];
  score: number;
  scoreBreakdown: ScoreBreakdownItem[];
  reason: string;
  source: 'queue' | 'ticket';
  ticketSummary?: string;
  queueItem?: QueueItem;
}

export interface ScoreBreakdownItem {
  label: string;
  value: number;
  detail: string;
}

export type BacklogTriageKind =
  | 'unlinked'
  | 'blocked'
  | 'build_failed'
  | 'review_ready'
  | 'evidence_gap'
  | 'stale'
  | 'ready_to_plan';

export interface BacklogTriageItem {
  ticketKey: string;
  summary: string;
  kind: BacklogTriageKind;
  severity: 'critical' | 'warning' | 'info';
  action: string;
  projects: string[];
  detail: string;
  ageDays?: number;
}

export interface BacklogTriageReport {
  generatedAt: string;
  items: BacklogTriageItem[];
  summary: Record<BacklogTriageKind, number>;
}

export interface ProjectBatchPlan {
  project: string;
  plans: PlannedAction[];
  totalScore: number;
  estimatedMinutes: number;
  actionCounts: Record<string, number>;
}

export interface ReleaseBatchPlan {
  release: string;
  plans: PlannedAction[];
  totalScore: number;
  estimatedMinutes: number;
  actionCounts: Record<string, number>;
}

export function planNextActions(input: PlannerInput): PlannedAction[] {
  const plans: PlannedAction[] = [];
  const queuedTickets = new Set<string>();
  const queueItems = input.queue?.items || [];
  const now = input.now || new Date();
  const decisions = input.queue?.decisions || {};

  queueItems.forEach((item, idx) => {
    if (item.ticket) { queuedTickets.add(item.ticket); }
    const ticket = item.ticket ? input.state?.tickets?.[item.ticket] : undefined;
    const positionScore = 1000 - idx;
    const priorityScore = Math.round(Number(item.priority_score || 0));
    const scoreBreakdown = [
      { label: 'Queue position', value: positionScore, detail: `Queue item #${idx + 1}` },
      { label: 'Queue priority', value: priorityScore, detail: `Stored priority score ${item.priority_score || 0}` },
    ];
    const score = sumBreakdown(scoreBreakdown);
    const plan: PlannedAction = {
      planId: planIdFor(item.ticket, item.action || 'implement'),
      ticketKey: item.ticket,
      action: item.action || 'implement',
      projects: item.projects || [],
      releaseKeys: releaseKeysForPlan(ticket, item),
      score,
      scoreBreakdown,
      reason: item.reason || `Queue position ${idx + 1}`,
      source: 'queue',
      queueItem: item,
    };
    if (item.ticket_summary) { plan.ticketSummary = item.ticket_summary; }
    plans.push(plan);
  });

  const tickets = input.state?.tickets || {};
  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    if (queuedTickets.has(ticketKey) || ticket.next_action === 'done') { continue; }
    const planId = planIdFor(ticketKey, ticket.next_action || 'implement');
    if (isPlanSuppressed(decisions[planId], now)) { continue; }

    const actionScore = scoreAction(ticket.next_action);
    const priorityScore = scorePriority(ticket.priority);
    const buildScore = ticket.build?.status === 'FAILURE' ? 25 : ticket.build?.status === 'SUCCESS' ? 5 : 0;
    const mrScore = ticket.mr?.review_status === 'changes_requested' ? 20 : ticket.mr?.review_status === 'approved' ? 10 : 0;
    const linkScore = (ticket.projects || []).length > 0 ? 10 : -30;
    const evidenceCount = evidenceItemCount(ticket);
    const evidenceScore = evidenceCount === 0 && ['verify', 'await_review', 'deploy_monitor'].includes(ticket.next_action) ? 5 : 0;
    const scoreBreakdown = [
      { label: 'Action', value: actionScore, detail: actionToLabel(ticket.next_action) },
      { label: 'Priority', value: priorityScore, detail: ticket.priority || 'unknown' },
      { label: 'Build', value: buildScore, detail: ticket.build?.status || 'no build' },
      { label: 'MR', value: mrScore, detail: ticket.mr?.review_status?.replace(/_/g, ' ') || 'no MR' },
      { label: 'Project link', value: linkScore, detail: (ticket.projects || []).length > 0 ? ticket.projects.join(', ') : 'not linked' },
      { label: 'Evidence', value: evidenceScore, detail: evidenceCount === 0 ? 'no evidence records yet' : `${evidenceCount} evidence record${evidenceCount === 1 ? '' : 's'}` },
    ];
    const score = sumBreakdown(scoreBreakdown);
    if (score <= 0) { continue; }

    const reasons = [
      `${actionToLabel(ticket.next_action)} action`,
      `${ticket.priority || 'unknown'} priority`,
    ];
    if (ticket.build?.status) { reasons.push(`build ${ticket.build.status}`); }
    if (ticket.mr?.review_status) { reasons.push(`MR ${ticket.mr.review_status.replace(/_/g, ' ')}`); }
    if ((ticket.projects || []).length === 0) { reasons.push('not linked to a project'); }
    if (evidenceCount === 0) { reasons.push('no evidence records yet'); }

    plans.push({
      planId,
      ticketKey,
      action: ticket.next_action || 'implement',
      projects: ticket.projects || [],
      releaseKeys: releaseKeysForPlan(ticket),
      score,
      scoreBreakdown,
      reason: reasons.join('; '),
      source: 'ticket',
      ticketSummary: ticket.summary,
    });
  }

  return plans.sort((a, b) => b.score - a.score);
}

export function planByProject(plans: PlannedAction[], limitPerProject = 5): ProjectBatchPlan[] {
  const grouped = new Map<string, PlannedAction[]>();
  for (const plan of plans) {
    const projects = plan.projects.length > 0 ? plan.projects : ['unlinked'];
    for (const project of projects) {
      if (!grouped.has(project)) {
        grouped.set(project, []);
      }
      grouped.get(project)!.push(plan);
    }
  }

  return Array.from(grouped.entries())
    .map(([project, projectPlans]) => {
      const selected = [...projectPlans].sort((a, b) => b.score - a.score || String(a.ticketKey || '').localeCompare(String(b.ticketKey || ''))).slice(0, limitPerProject);
      return {
        project,
        plans: selected,
        totalScore: selected.reduce((sum, plan) => sum + plan.score, 0),
        estimatedMinutes: selected.reduce((sum, plan) => sum + estimatePlanMinutes(plan), 0),
        actionCounts: summarizePlanActions(selected),
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.project.localeCompare(b.project));
}

export function planByRelease(plans: PlannedAction[], limitPerRelease = 8): ReleaseBatchPlan[] {
  const grouped = new Map<string, PlannedAction[]>();
  for (const plan of plans) {
    const releases = plan.releaseKeys && plan.releaseKeys.length > 0 ? plan.releaseKeys : ['unassigned'];
    for (const release of releases) {
      if (!grouped.has(release)) {
        grouped.set(release, []);
      }
      grouped.get(release)!.push(plan);
    }
  }

  return Array.from(grouped.entries())
    .map(([release, releasePlans]) => {
      const selected = [...releasePlans].sort((a, b) => b.score - a.score || String(a.ticketKey || '').localeCompare(String(b.ticketKey || ''))).slice(0, limitPerRelease);
      return {
        release,
        plans: selected,
        totalScore: selected.reduce((sum, plan) => sum + plan.score, 0),
        estimatedMinutes: selected.reduce((sum, plan) => sum + estimatePlanMinutes(plan), 0),
        actionCounts: summarizePlanActions(selected),
      };
    })
    .sort((a, b) => b.totalScore - a.totalScore || a.release.localeCompare(b.release));
}

export function buildBacklogTriageReport(input: PlannerInput): BacklogTriageReport {
  const now = input.now || new Date();
  const items: BacklogTriageItem[] = [];
  const tickets = input.state?.tickets || {};
  const queuedTickets = new Set((input.queue?.items || []).map(item => item.ticket).filter(Boolean));

  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    if (ticket.next_action === 'done') { continue; }
    const projects = ticket.projects || [];
    const evidenceCount = evidenceItemCount(ticket);
    const ageDays = ticketAgeDays(ticket, now);
    const issueCountBeforeTicket = items.length;

    if (projects.length === 0) {
      items.push(triageItem(ticketKey, ticket, 'unlinked', 'critical', 'Link to Project', 'Ticket has no linked project, so Kronos cannot safely dispatch work.', ageDays));
    }
    if (ticket.next_action === 'blocked') {
      items.push(triageItem(ticketKey, ticket, 'blocked', 'critical', 'Resolve Blocker', 'Ticket is marked blocked and needs a human decision before automation.', ageDays));
    }
    if (ticket.build?.status === 'FAILURE' || ticket.next_action === 'fix_build') {
      items.push(triageItem(ticketKey, ticket, 'build_failed', 'critical', 'Fix Build', ticket.build ? `Build #${ticket.build.number} is ${ticket.build.status}.` : 'Ticket is marked fix_build without a build record.', ageDays));
    }
    if (ticket.next_action === 'await_review' || ticket.mr?.review_status === 'approved' || ticket.mr?.review_status === 'changes_requested') {
      items.push(triageItem(ticketKey, ticket, 'review_ready', ticket.mr?.review_status === 'changes_requested' ? 'critical' : 'info', 'Review MR', ticket.mr ? `MR !${ticket.mr.iid} is ${ticket.mr.review_status}.` : 'Ticket is waiting for review without an MR record.', ageDays));
    }
    if (['verify', 'await_review', 'deploy_monitor'].includes(ticket.next_action) && evidenceCount === 0) {
      items.push(triageItem(ticketKey, ticket, 'evidence_gap', 'warning', 'Add Evidence', 'Ticket is in a proof-sensitive state with no evidence ledger entries.', ageDays));
    }
    if (ageDays !== undefined && ageDays >= 7) {
      items.push(triageItem(ticketKey, ticket, 'stale', ageDays >= 14 ? 'critical' : 'warning', 'Re-triage', `Ticket has not changed for ${ageDays} day(s).`, ageDays));
    }
    if (items.length === issueCountBeforeTicket && !queuedTickets.has(ticketKey) && projects.length > 0 && ticket.next_action !== 'blocked' && scoreAction(ticket.next_action) >= 60) {
      items.push(triageItem(ticketKey, ticket, 'ready_to_plan', 'info', actionToLabel(ticket.next_action), 'Linked ticket is ready for queue planning.', ageDays));
    }
  }

  items.sort(compareTriageItems);
  return {
    generatedAt: now.toISOString(),
    items,
    summary: summarizeTriage(items),
  };
}

function sumBreakdown(items: ScoreBreakdownItem[]): number {
  return items.reduce((sum, item) => sum + item.value, 0);
}

export function planToQueueItem(input: PlannerInput, plan: PlannedAction): QueueItem {
  if (plan.queueItem) { return plan.queueItem; }
  const firstProject = plan.projects[0];
  const item: QueueItem = {
    id: `planned-${plan.ticketKey || plan.action}`,
    ticket: plan.ticketKey,
    projects: plan.projects,
    project_path: firstProject && input.resolveProjectPath ? input.resolveProjectPath(firstProject) || '' : '',
    action: plan.action,
    priority_score: plan.score,
    reason: plan.reason,
  };
  if (plan.ticketSummary) { item.ticket_summary = plan.ticketSummary; }
  return item;
}

function evidenceItemCount(ticket: Ticket): number {
  return evidenceNotes(ticket).length + evidenceChecks(ticket).length + evidenceEnvironmentResults(ticket).length;
}

function ticketAgeDays(ticket: Ticket, now: Date): number | undefined {
  const candidates = [ticket.updated, ticket.last_action_at, ticket.evidence?.updated_at];
  for (const raw of candidates) {
    if (typeof raw !== 'string') { continue; }
    const parsed = new Date(raw);
    if (Number.isFinite(parsed.getTime())) {
      return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000)));
    }
  }
  return undefined;
}

function triageItem(
  ticketKey: string,
  ticket: Ticket,
  kind: BacklogTriageKind,
  severity: BacklogTriageItem['severity'],
  action: string,
  detail: string,
  ageDays?: number,
): BacklogTriageItem {
  const item: BacklogTriageItem = {
    ticketKey,
    summary: ticket.summary || '',
    kind,
    severity,
    action,
    projects: ticket.projects || [],
    detail,
  };
  if (ageDays !== undefined) { item.ageDays = ageDays; }
  return item;
}

function compareTriageItems(a: BacklogTriageItem, b: BacklogTriageItem): number {
  const severityDiff = severityRank(b.severity) - severityRank(a.severity);
  if (severityDiff !== 0) { return severityDiff; }
  const ageDiff = (b.ageDays || 0) - (a.ageDays || 0);
  if (ageDiff !== 0) { return ageDiff; }
  return a.ticketKey.localeCompare(b.ticketKey);
}

function severityRank(severity: BacklogTriageItem['severity']): number {
  if (severity === 'critical') { return 3; }
  if (severity === 'warning') { return 2; }
  return 1;
}

function summarizeTriage(items: BacklogTriageItem[]): Record<BacklogTriageKind, number> {
  const summary: Record<BacklogTriageKind, number> = {
    unlinked: 0,
    blocked: 0,
    build_failed: 0,
    review_ready: 0,
    evidence_gap: 0,
    stale: 0,
    ready_to_plan: 0,
  };
  for (const item of items) {
    summary[item.kind] += 1;
  }
  return summary;
}

function summarizePlanActions(plans: PlannedAction[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const plan of plans) {
    counts[plan.action] = (counts[plan.action] || 0) + 1;
  }
  return counts;
}

function releaseKeysForPlan(ticket?: Ticket, queueItem?: unknown): string[] {
  const values: string[] = [];
  collectReleaseValues(values, releaseField(queueItem, 'release'));
  collectReleaseValues(values, releaseField(queueItem, 'fixVersion'));
  collectReleaseValues(values, releaseField(queueItem, 'fixVersions'));
  collectReleaseValues(values, releaseField(queueItem, 'milestone'));
  collectReleaseValues(values, releaseField(queueItem, 'sprint'));
  collectReleaseValues(values, ticket?.release);
  collectReleaseValues(values, ticket?.fixVersion);
  collectReleaseValues(values, ticket?.fixVersions);
  collectReleaseValues(values, ticket?.milestone);
  collectReleaseValues(values, ticket?.sprint);
  for (const label of [...unknownArray(releaseField(queueItem, 'labels')), ...(ticket?.labels || [])]) {
    const release = releaseFromLabel(label);
    if (release) { values.push(release); }
  }
  const normalized = values.map(normalizeReleaseKey).filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function releaseField(source: unknown, field: string): unknown {
  return isObjectRecord(source) ? Reflect.get(source, field) : undefined;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function isObjectRecord(value: unknown): value is object {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function collectReleaseValues(target: string[], value: unknown): void {
  if (value === undefined || value === null) { return; }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectReleaseValues(target, entry);
    }
    return;
  }
  if (isObjectRecord(value)) {
    collectReleaseValues(target, Reflect.get(value, 'name') || Reflect.get(value, 'value') || Reflect.get(value, 'title'));
    return;
  }
  target.push(String(value));
}

function releaseFromLabel(label: unknown): string | undefined {
  const text = String(label || '').trim();
  const match = /^(?:release|fixversion|fix-version|milestone|target-release)[:=/](.+)$/i.exec(text);
  return match ? match[1] : undefined;
}

function normalizeReleaseKey(value: string): string | undefined {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized === '-' || normalized.toLowerCase() === 'none') { return undefined; }
  return normalized;
}

export function planIdFor(ticketKey: string | null, action: string): string {
  return `${ticketKey || 'refresh'}:${action || 'implement'}`;
}

export function recordQueueDecision(
  queue: QueueState | null,
  plan: PlannedAction,
  decision: 'rejected' | 'snoozed',
  options?: { now?: Date; snoozeMinutes?: number; reason?: string }
): QueueState {
  const now = options?.now || new Date();
  const planId = plan.planId || planIdFor(plan.ticketKey, plan.action);
  const next: QueueState = {
    items: [...(queue?.items || [])],
    last_computed: now.toISOString(),
    decisions: { ...(queue?.decisions || {}) },
  };
  const record: QueueDecision = {
    plan_id: planId,
    ticket: plan.ticketKey,
    action: plan.action,
    decision,
    decided_at: now.toISOString(),
  };
  if (options?.reason) { record.reason = options.reason; }
  if (decision === 'snoozed') {
    const minutes = Math.max(1, Math.round(options?.snoozeMinutes || 60));
    record.snoozed_until = new Date(now.getTime() + minutes * 60 * 1000).toISOString();
  }
  next.decisions![planId] = record;
  return next;
}

export function clearQueueDecision(queue: QueueState | null, plan: PlannedAction): QueueState {
  const planId = plan.planId || planIdFor(plan.ticketKey, plan.action);
  const decisions = { ...(queue?.decisions || {}) };
  delete decisions[planId];
  return {
    items: [...(queue?.items || [])],
    last_computed: queue?.last_computed || null,
    decisions,
  };
}

export function estimatePlanMinutes(plan: PlannedAction): number {
  switch (plan.action) {
    case 'implement':
    case 'in_progress':
    case 'fix_build':
      return 45;
    case 'verify':
    case 'verify-local':
      return 30;
    case 'await_review':
      return 20;
    case 'deploy_monitor':
      return 20;
    case 'blocked':
      return 15;
    case 'refresh':
      return 10;
    default:
      return 30;
  }
}

export function planForMinutes(plans: PlannedAction[], minutes: number): { plans: PlannedAction[]; estimatedMinutes: number } {
  const selected: PlannedAction[] = [];
  let total = 0;
  for (const plan of plans) {
    const estimate = estimatePlanMinutes(plan);
    if (selected.length > 0 && total + estimate > minutes) { break; }
    selected.push(plan);
    total += estimate;
    if (total >= minutes) { break; }
  }
  return { plans: selected, estimatedMinutes: total };
}

export function overnightCandidatePlans(plans: PlannedAction[], limit = 10): PlannedAction[] {
  const overnightActions = new Set(['implement', 'in_progress', 'fix_build']);
  return plans
    .filter(plan => plan.source === 'ticket')
    .filter(plan => overnightActions.has(plan.action))
    .filter(plan => plan.projects.length > 0)
    .slice(0, limit);
}

function isPlanSuppressed(decision: QueueDecision | undefined, now: Date): boolean {
  if (!decision) { return false; }
  if (decision.decision === 'rejected') { return true; }
  if (decision.decision === 'snoozed') {
    const until = decision.snoozed_until ? new Date(decision.snoozed_until) : null;
    return !!until && Number.isFinite(until.getTime()) && until > now;
  }
  return false;
}

export function scoreAction(action: string): number {
  switch (action) {
    case 'fix_build': return 95;
    case 'verify': return 85;
    case 'await_review': return 80;
    case 'deploy_monitor': return 70;
    case 'in_progress': return 65;
    case 'implement': return 60;
    case 'blocked': return 15;
    default: return 40;
  }
}

export function scorePriority(priority: string): number {
  const p = String(priority || '').toLowerCase();
  if (p.includes('blocker') || p.includes('critical') || p.includes('highest') || p === 'p0' || p === 'p1') { return 25; }
  if (p.includes('high') || p === 'p2') { return 15; }
  if (p.includes('medium') || p === 'p3') { return 8; }
  if (p.includes('low') || p === 'p4') { return 2; }
  return 5;
}
