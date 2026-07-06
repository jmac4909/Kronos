import type { KronosState as KronosStateSnapshot, QueueState } from '../state/types';
import { actionDisplayLabel as actionToLabel } from './actionCatalog';
import { type AgingThresholds, analyzeAging } from './agingAnalyzer';
import { computeAgentQualityScore } from './agentQualityScore';
import { type DashboardWorklistItem, type DashboardWorklistLane, buildDashboardWorklist } from './dashboardWorklist';
import { evaluateEvidenceGates } from './evidenceGate';
import { buildHumanReviewInbox } from './humanReviewInbox';
import { buildNextActionContext } from './nextActionContext';
import { actionButton, actionRow, kronosActionPanelScript } from './operatorPanel';
import type { PlannedAction } from './queuePlanner';
import { arrayFromUnknown, recordString } from './records';
import { isRunLikeRecord } from './runRecords';
import { isFailedOrCancelledRunStatus, isFreshActiveRun } from './runStatus';
import { computeTrendMetrics } from './trendMetrics';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export interface DashboardPanelInput {
  state: KronosStateSnapshot | null;
  queue: QueueState | null;
  runs: unknown[];
  plans: PlannedAction[];
  brief: unknown;
  trendWindowDays: number;
  agingThresholds: Partial<AgingThresholds>;
  nonce?: string | undefined;
  loadWarning?: string | undefined;
  actionScriptUri?: string | undefined;
}

interface DashboardOperatorBrief {
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral';
  headline: string;
  detail: string;
  now: string;
  next: string;
  blockers: string;
  evidence: string;
}

function dashboardBriefRecord(brief: unknown): Record<string, unknown> {
  return Boolean(brief) && typeof brief === 'object' && !Array.isArray(brief) ? brief as Record<string, unknown> : {};
}

function dashboardBriefItems(brief: Record<string, unknown>, key: string): unknown[] {
  return arrayFromUnknown(brief[key]);
}

function dashboardBriefCount(brief: Record<string, unknown>, key: string): number {
  const value = brief[key];
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function buildDashboardHtml(input: DashboardPanelInput): string {
  const safeBrief = dashboardBriefRecord(input.brief);
  const projects = input.state?.projects || {};
  const allTickets = input.state?.tickets || {};
  const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunLikeRecord);
  const activeRuns = runs.filter(run => isFreshActiveRun(run)).length;
  const failedRuns = runs.filter(run => isFailedOrCancelledRunStatus(recordString(run, 'status'))).length;
  const needsHumanRuns = runs.filter(run => recordString(run, 'status') === 'needs_human').length;
  const waitingForReviewRuns = runs.filter(run => recordString(run, 'status') === 'waiting_for_review').length;
  const evidenceGates = evaluateEvidenceGates(allTickets);
  const evidenceGateFailures = evidenceGates.filter(gate => gate.status === 'fail').length;
  const evidenceGateWarnings = evidenceGates.filter(gate => gate.status === 'warn').length;
  const qualityScore = computeAgentQualityScore({ runs, tickets: allTickets });
  const agingReport = analyzeAging({ tickets: allTickets, thresholds: input.agingThresholds });
  const humanReviewInbox = buildHumanReviewInbox({ state: input.state, queue: input.queue, runs });
  const worklistLanes = buildDashboardWorklist({ runs, humanReviewInbox, evidenceGates, agingReport });
  const trendReport = computeTrendMetrics({ runs, tickets: allTickets, windowDays: input.trendWindowDays });
  const trendMetric = (label: string) => trendReport.metrics.find(metric => metric.label === label);
  const reworkMetric = trendMetric('Rework rate');
  const buildPassMetric = trendMetric('Build pass rate');
  const cycleMetric = trendMetric('Average cycle time');
  const nextPlan = input.plans[0];
  const nextContext = nextPlan ? buildNextActionContext(nextPlan, { state: input.state, queue: input.queue }) : undefined;
  const operatorBrief = buildDashboardOperatorBrief({
    projectsCount: Object.keys(projects).length,
    ticketsCount: Object.keys(allTickets).length,
    activeRuns,
    failedRuns,
    needsHumanRuns,
    waitingForReviewRuns,
    evidenceGateFailures,
    evidenceGateWarnings,
    staleCritical: agingReport.summary.critical,
    staleWarnings: agingReport.summary.warning,
    nextPlan,
    worklistLanes,
  });
  const dashboardActions = actionRow([
    actionButton('nextBestAction', 'Next Best Action', { primary: true }),
    actionButton('refreshPanel', 'Refresh'),
    actionButton('queuePlanner', 'Queue Planner'),
    actionButton('runCenter', 'Run Center'),
    actionButton('humanReviewInbox', 'Human Review'),
    actionButton('evidenceGate', 'Evidence Gate'),
    actionButton('recoveryCenter', 'Recovery'),
  ]);
  const cockpitHtml = `<div class="cockpit">
    <div class="metric"><div class="num">${qualityScore.score}</div><div class="lbl">Agent Quality</div></div>
    <div class="metric ${escapeClass(reworkMetric?.status || 'neutral')}"><div class="num">${escapeHtml(reworkMetric?.value || 'n/a')}</div><div class="lbl">Rework Rate</div></div>
    <div class="metric ${escapeClass(buildPassMetric?.status || 'neutral')}"><div class="num">${escapeHtml(buildPassMetric?.value || 'n/a')}</div><div class="lbl">Build Pass</div></div>
    <div class="metric ${escapeClass(cycleMetric?.status || 'neutral')}"><div class="num">${escapeHtml(cycleMetric?.value || 'n/a')}</div><div class="lbl">Avg Cycle</div></div>
    <div class="metric"><div class="num">${activeRuns}</div><div class="lbl">Active Runs</div></div>
    <div class="metric ok"><div class="num">${waitingForReviewRuns}</div><div class="lbl">Waiting Review</div></div>
    <div class="metric warn"><div class="num">${needsHumanRuns}</div><div class="lbl">Needs Human</div></div>
    <div class="metric fail"><div class="num">${failedRuns}</div><div class="lbl">Failed/Cancelled</div></div>
    <div class="metric fail"><div class="num">${evidenceGateFailures}</div><div class="lbl">Gate Fails</div></div>
    <div class="metric warn"><div class="num">${evidenceGateWarnings}</div><div class="lbl">Gate Warnings</div></div>
    <div class="metric fail"><div class="num">${agingReport.summary.critical}</div><div class="lbl">Stale Critical</div></div>
    <div class="metric warn"><div class="num">${agingReport.summary.warning}</div><div class="lbl">Stale Warnings</div></div>
    <div class="next-action">
      <div class="lbl">Next Best Action</div>
      <strong>${nextPlan ? `${escapeHtml(nextPlan.ticketKey || 'Refresh')} - ${escapeHtml(actionToLabel(nextPlan.action))}` : 'No actionable work'}</strong>
      ${nextPlan ? `<div>${escapeHtml(nextPlan.reason)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Command:</strong> ${escapeHtml(nextContext.commandLabel)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Risk:</strong> ${escapeHtml(nextContext.risks.join(', '))}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>${nextContext.blockers.length ? 'Blocked' : 'Preflight'}:</strong> ${escapeHtml((nextContext.blockers.length ? nextContext.blockers : nextContext.preflight).join('; '))}</div>` : ''}
      <div class="next-action-controls">${dashboardActions}</div>
    </div>
  </div>`;
  const operatorBriefHtml = `<div class="dashboard-operator-brief ${escapeClass(operatorBrief.tone)} kronos-panel kronos-soft">
    <div class="dashboard-operator-copy">
      <div class="kronos-section-title">Operator Brief</div>
      <h2>${escapeHtml(operatorBrief.headline)}</h2>
      <p>${escapeHtml(operatorBrief.detail)}</p>
    </div>
    <div class="dashboard-brief-grid">
      ${dashboardBriefFact('Now', operatorBrief.now)}
      ${dashboardBriefFact('Next', operatorBrief.next)}
      ${dashboardBriefFact('Blockers', operatorBrief.blockers)}
      ${dashboardBriefFact('Evidence', operatorBrief.evidence)}
    </div>
  </div>`;
  const projectCards = Object.entries(projects).map(([name, proj]) => {
    const healthColor = proj.health === 'green' ? '#4caf50' : proj.health === 'yellow' ? '#ff9800' : proj.health === 'red' ? '#f44336' : '#666';
    const linkedCount = Object.values(allTickets).filter(t => t.projects?.includes(name)).length;
    return `<div class="project-card kronos-panel pad">
      <div class="card-header"><span class="health-dot" style="background:${healthColor}"></span> ${escapeHtml(name)}</div>
      <div class="card-body">${escapeHtml(proj.summary)}<br><small>${linkedCount} tickets | ${proj.open_mr_count} open MRs</small></div>
    </div>`;
  }).join('');

  const completedBrief = dashboardBriefItems(safeBrief, 'completed').map((r: unknown) => escapeHtml(String(r))).join(', ');
  const overnightActions = dashboardBriefCount(safeBrief, 'overnight_actions');
  const vpnDrops = dashboardBriefCount(safeBrief, 'vpn_drops');
  const briefHtml = overnightActions > 0
    ? `<div class="brief">
        <h3>Overnight Summary</h3>
        <p>${escapeHtml(String(overnightActions))} actions, ${escapeHtml(String(vpnDrops))} VPN drops</p>
        ${completedBrief ? `<p><strong>Completed:</strong> ${completedBrief}</p>` : ''}
      </div>`
    : '';

  const worklistHtml = buildDashboardWorklistHtml(worklistLanes);
  const warningHtml = input.loadWarning
    ? `<div class="dashboard-warning kronos-panel pad"><strong>Morning brief unavailable</strong><div>${escapeHtml(input.loadWarning)}</div></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<style>
  ${kronosWebviewBaseCss()}
  .dashboard-shell { max-width: 1320px; }
  .dashboard-operator-brief { display: grid; grid-template-columns: minmax(280px, 0.9fr) minmax(0, 1.1fr); gap: 16px; padding: 16px; margin: 12px 0 16px; border-left: 4px solid var(--k-accent); }
  .dashboard-operator-brief.good { border-left-color: var(--k-ok); }
  .dashboard-operator-brief.warn { border-left-color: var(--k-warn); }
  .dashboard-operator-brief.bad { border-left-color: var(--k-danger); }
  .dashboard-operator-brief.info { border-left-color: #2196f3; }
  .dashboard-operator-copy h2 { margin: 4px 0 6px; font-size: 19px; line-height: 1.25; }
  .dashboard-operator-copy p { margin: 0; color: var(--k-muted); line-height: 1.45; }
  .dashboard-brief-grid { display: grid; grid-template-columns: repeat(2, minmax(160px, 1fr)); gap: 8px; }
  .dashboard-brief-fact { min-height: 74px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 9px 10px; background: var(--k-surface); }
  .dashboard-brief-fact .fact-label { color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .dashboard-brief-fact .fact-value { margin-top: 4px; font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0; }
  .cockpit { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 10px; margin: 12px 0 18px; }
  .metric, .next-action { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 12px; background: var(--k-surface-soft); }
  .metric { min-height: 72px; }
  .metric .num { font-size: 24px; line-height: 1.1; font-weight: 700; }
  .metric.good .num { color: #4caf50; }
  .metric.warn .num { color: #ff9800; }
  .metric.fail .num, .metric.bad .num { color: #f44336; }
  .lbl { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .next-action { grid-column: span 2; min-height: 0; font-size: 12px; border-color: color-mix(in srgb, var(--k-accent) 42%, var(--k-border)); }
  .next-action strong { display: block; margin: 4px 0; font-size: 14px; line-height: 1.35; }
  .next-meta { margin-top: 6px; color: var(--k-muted); line-height: 1.4; }
  .next-meta strong { display: inline; color: var(--k-fg); font-size: 12px; margin: 0; }
  .next-action-controls { margin-top: 10px; }
  .project-card { transition: border-color 0.15s, background-color 0.15s; }
  .project-card:hover { border-color: var(--k-accent); background: var(--k-surface-soft); }
  .card-header { font-weight: 650; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .card-body { color: var(--k-muted); font-size: 13px; }
  .health-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .brief { border-left: 3px solid var(--k-accent); padding: 12px; margin: 16px 0; border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .brief h3,
  .section h3 { margin: 0 0 8px; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .brief p { margin: 6px 0 0; }
  .section { margin: 20px 0; }
  .worklists { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
  .lane { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px 12px; background: var(--k-surface); }
  .lane h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 650; }
  .lane ul { list-style: none; padding: 0; margin: 0; }
  .work-item { border-top: 1px solid var(--k-border); padding: 8px 0; }
  .work-item:first-child { border-top: none; }
  .work-item strong { display: block; font-size: 12px; }
  .work-item div { color: var(--k-muted); font-size: 11px; margin-top: 2px; }
  .work-item .inline-actions { margin-top: 7px; }
  .work-item.critical strong { color: #f44336; }
  .work-item.warning strong { color: #ff9800; }
  .work-item.ok strong { color: #4caf50; }
  .lane-empty { color: var(--k-muted); font-size: 12px; }
  .dashboard-warning { margin: 12px 0; border-color: color-mix(in srgb, #ff9800 42%, var(--k-border)); color: var(--k-fg); }
  .dashboard-warning strong { display: block; margin-bottom: 4px; color: #ff9800; }
  .dashboard-warning div { color: var(--k-muted); font-size: 12px; line-height: 1.45; }
  @media (max-width: 820px) {
    .dashboard-operator-brief { grid-template-columns: 1fr; }
    .dashboard-brief-grid { grid-template-columns: 1fr; }
    .next-action { grid-column: 1; }
  }
</style>
</head>
<body><div class="kronos-shell dashboard-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Dashboard</h1>
      <div class="kronos-subtitle">${Object.keys(projects).length} project${Object.keys(projects).length === 1 ? '' : 's'} tracked, ${Object.keys(allTickets).length} ticket${Object.keys(allTickets).length === 1 ? '' : 's'} in state</div>
    </div>
  </div>
  ${warningHtml}
  ${operatorBriefHtml}
  ${cockpitHtml}
  ${briefHtml}
  ${worklistHtml}

  <div class="section">
    <h3 class="kronos-section-title">Projects</h3>
    <div class="grid">${projectCards || '<div class="kronos-empty">No projects registered.</div>'}</div>
  </div>
</div>${input.nonce ? kronosActionPanelScript(input.nonce, 'Kronos Dashboard', input.actionScriptUri) : ''}</body>
</html>`;
}

function dashboardBriefFact(label: string, value: string): string {
  return `<div class="dashboard-brief-fact">
    <div class="fact-label">${escapeHtml(label)}</div>
    <div class="fact-value">${escapeHtml(value)}</div>
  </div>`;
}

function buildDashboardOperatorBrief(input: {
  projectsCount: number;
  ticketsCount: number;
  activeRuns: number;
  failedRuns: number;
  needsHumanRuns: number;
  waitingForReviewRuns: number;
  evidenceGateFailures: number;
  evidenceGateWarnings: number;
  staleCritical: number;
  staleWarnings: number;
  nextPlan?: PlannedAction | undefined;
  worklistLanes: DashboardWorklistLane[];
}): DashboardOperatorBrief {
  const needsHumanLane = dashboardLane(input.worklistLanes, 'needs_human');
  const activeLane = dashboardLane(input.worklistLanes, 'active_runs');
  const gateLane = dashboardLane(input.worklistLanes, 'failing_gates');
  const staleLane = dashboardLane(input.worklistLanes, 'stale_items');
  const recentLane = dashboardLane(input.worklistLanes, 'recent_completed');
  const primaryAttention = [
    needsHumanLane?.items[0],
    gateLane?.items[0],
    staleLane?.items[0],
    activeLane?.items[0],
    recentLane?.items[0],
  ].find(Boolean);
  const nextLabel = input.nextPlan
    ? `${input.nextPlan.ticketKey || 'Refresh'} - ${actionToLabel(input.nextPlan.action)}`
    : 'No planned queue action';
  if (input.needsHumanRuns > 0 || (needsHumanLane?.items.length || 0) > 0) {
    return {
      tone: 'bad',
      headline: `${input.needsHumanRuns || needsHumanLane?.items.length || 1} item${(input.needsHumanRuns || needsHumanLane?.items.length || 1) === 1 ? '' : 's'} need human attention`,
      detail: primaryAttention ? `${primaryAttention.title}: ${primaryAttention.detail}` : 'Open Human Review or Run Center before starting more work.',
      now: activeRunSummary(input.activeRuns),
      next: nextLabel,
      blockers: dashboardBlockerSummary(input),
      evidence: dashboardEvidenceSummary(input),
    };
  }
  if (input.evidenceGateFailures > 0) {
    return {
      tone: 'bad',
      headline: `${input.evidenceGateFailures} evidence gate${input.evidenceGateFailures === 1 ? '' : 's'} blocking review`,
      detail: primaryAttention ? `${primaryAttention.title}: ${primaryAttention.detail}` : 'Evidence must be added before queue removal or review handoff.',
      now: activeRunSummary(input.activeRuns),
      next: nextLabel,
      blockers: dashboardBlockerSummary(input),
      evidence: dashboardEvidenceSummary(input),
    };
  }
  if (input.activeRuns > 0) {
    return {
      tone: 'info',
      headline: `${input.activeRuns} run${input.activeRuns === 1 ? '' : 's'} active right now`,
      detail: primaryAttention ? `${primaryAttention.title}: ${primaryAttention.detail}` : 'Watch active runs for file changes, tool errors, and readiness output.',
      now: activeRunSummary(input.activeRuns),
      next: nextLabel,
      blockers: dashboardBlockerSummary(input),
      evidence: dashboardEvidenceSummary(input),
    };
  }
  if (input.waitingForReviewRuns > 0) {
    return {
      tone: 'good',
      headline: `${input.waitingForReviewRuns} run${input.waitingForReviewRuns === 1 ? '' : 's'} ready for review`,
      detail: primaryAttention ? `${primaryAttention.title}: ${primaryAttention.detail}` : 'Open review items and confirm evidence before archiving completed work.',
      now: 'No active runs',
      next: nextLabel,
      blockers: dashboardBlockerSummary(input),
      evidence: dashboardEvidenceSummary(input),
    };
  }
  return {
    tone: input.staleCritical > 0 || input.staleWarnings > 0 ? 'warn' : 'neutral',
    headline: input.nextPlan ? `Next planned action is ${nextLabel}` : 'No urgent operator action detected',
    detail: primaryAttention ? `${primaryAttention.title}: ${primaryAttention.detail}` : `${input.projectsCount} projects and ${input.ticketsCount} tickets are tracked.`,
    now: activeRunSummary(input.activeRuns),
    next: nextLabel,
    blockers: dashboardBlockerSummary(input),
    evidence: dashboardEvidenceSummary(input),
  };
}

function dashboardLane(lanes: DashboardWorklistLane[], kind: DashboardWorklistLane['kind']): DashboardWorklistLane | undefined {
  return lanes.find(lane => lane.kind === kind);
}

function activeRunSummary(count: number): string {
  return count > 0 ? `${count} active run${count === 1 ? '' : 's'}` : 'No active runs';
}

function dashboardBlockerSummary(input: {
  failedRuns: number;
  needsHumanRuns: number;
  staleCritical: number;
  staleWarnings: number;
}): string {
  const parts = [
    input.needsHumanRuns > 0 ? `${input.needsHumanRuns} needs human` : '',
    input.failedRuns > 0 ? `${input.failedRuns} failed or cancelled` : '',
    input.staleCritical > 0 ? `${input.staleCritical} stale critical` : '',
    input.staleWarnings > 0 ? `${input.staleWarnings} stale warning${input.staleWarnings === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'No blockers detected';
}

function dashboardEvidenceSummary(input: {
  evidenceGateFailures: number;
  evidenceGateWarnings: number;
}): string {
  if (input.evidenceGateFailures > 0) {
    return `${input.evidenceGateFailures} failing gate${input.evidenceGateFailures === 1 ? '' : 's'}`;
  }
  if (input.evidenceGateWarnings > 0) {
    return `${input.evidenceGateWarnings} gate warning${input.evidenceGateWarnings === 1 ? '' : 's'}`;
  }
  return 'Evidence gates clear';
}

export function buildDashboardWorklistHtml(lanes: DashboardWorklistLane[]): string {
  const laneHtml = lanes.map(lane => {
    const items = lane.items.map(item => {
      const actions = dashboardWorkItemActions(lane.kind, item);
      return `<li class="work-item ${escapeClass(item.severity)}">
      <strong>${escapeHtml(item.title)}</strong>
      <div>${escapeHtml(item.detail)}</div>
      ${item.ticketKey || item.runId ? `<div>${escapeHtml([item.ticketKey, item.runId].filter(Boolean).join(' | '))}</div>` : ''}
      ${actions.length ? actionRow(actions) : ''}
    </li>`;
    }).join('');
    return `<div class="lane ${escapeClass(lane.kind)}">
      <h3>${escapeHtml(lane.title)}</h3>
      ${items ? `<ul>${items}</ul>` : `<div class="lane-empty">${escapeHtml(lane.emptyText)}</div>`}
    </div>`;
  }).join('');

  return `<div class="section">
    <h3 class="kronos-section-title">Command Center</h3>
    <div class="worklists">${laneHtml}</div>
  </div>`;
}

function dashboardWorkItemActions(kind: DashboardWorklistLane['kind'], item: DashboardWorklistItem): string[] {
  const ticket = item.ticketKey;
  const runId = item.runId;
  if (kind === 'needs_human') {
    return [
      ticket ? actionButton('viewTicket', 'View', { ticket, primary: true }) : '',
      ticket ? actionButton('startTicket', 'Start', { ticket }) : '',
      runId ? actionButton('runCenter', 'Run Center', { runId }) : '',
      runId ? actionButton('recoveryCenter', 'Recovery', { runId }) : '',
    ].filter(Boolean);
  }
  if (kind === 'active_runs') {
    return [
      runId ? actionButton('runCenter', 'Run Center', { runId }) : actionButton('runCenter', 'Run Center'),
      ticket ? actionButton('viewTicket', 'Ticket', { ticket }) : '',
    ].filter(Boolean);
  }
  if (kind === 'failing_gates') {
    return ticket ? [
      actionButton('evidenceGate', 'Gate', { ticket, primary: true }),
      actionButton('addEvidenceCheck', 'Add Check', { ticket }),
      actionButton('addEvidence', 'Add Evidence', { ticket }),
    ] : [];
  }
  if (kind === 'recent_completed') {
    return [
      ticket ? actionButton('viewTicket', 'Review', { ticket, primary: true }) : '',
      ticket ? actionButton('evidenceGate', 'Gate', { ticket }) : '',
      runId ? actionButton('runCenter', 'Run Center', { runId }) : '',
    ].filter(Boolean);
  }
  if (kind === 'stale_items') {
    return ticket ? [
      actionButton('viewTicket', 'View', { ticket, primary: true }),
      actionButton('startTicket', 'Start', { ticket }),
    ] : [];
  }
  return [];
}
