import type { DispatchCollision } from './collisionDetector';
import { actionDisplayLabel as actionToLabel } from './actionCatalog';
import type { BacklogTriageReport, PlannedAction, ProjectBatchPlan, ReleaseBatchPlan } from './queuePlanner';
import { estimatePlanMinutes } from './queuePlanner';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss } from './operatorPanel';
import { escapeClass, escapeHtml } from './webviewHtml';

export function buildQueuePlannerHtml(plans: PlannedAction[], nonce?: string): string {
  const rows = plans.map((plan, idx) => {
    const parts = plan.scoreBreakdown
      .map(part => `<div class="score-part"><span>${escapeHtml(part.label)}</span><strong>${escapeHtml(String(part.value))}</strong><small>${escapeHtml(part.detail)}</small></div>`)
      .join('');
    return `<div class="operator-card plan-card">
      <div class="rank">${idx + 1}</div>
      <div class="plan-main">
        <div class="operator-card-title">${escapeHtml(plan.ticketKey || 'Refresh')} - ${escapeHtml(actionToLabel(plan.action))}</div>
        <div class="operator-card-meta">${escapeHtml(plan.projects.join(', ') || 'unlinked')} | ${escapeHtml(plan.source)} | score ${escapeHtml(String(plan.score))}</div>
        <div class="detail">${escapeHtml(plan.reason)}</div>
        <div class="score-grid">${parts}</div>
        ${planActionRow(plan)}
      </div>
    </div>`;
  }).join('');
  const empty = plans.length === 0 ? '<div class="kronos-empty">No actionable queue recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Queue Planner</h1>
      <div class="kronos-subtitle">${plans.length} ranked recommendation${plans.length === 1 ? '' : 's'} from queue, Jira, and repository state</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildBacklogTriageHtml(report: BacklogTriageReport, nonce?: string): string {
  const cards = Object.entries(report.summary)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `<div class="summary-card"><div class="num">${escapeHtml(String(count))}</div><div class="lbl">${escapeHtml(triageKindLabel(kind))}</div></div>`)
    .join('');
  const rows = report.items.map(item => `<tr class="${escapeClass(item.severity)}">
    <td><span class="pill ${escapeClass(item.severity)}">${escapeHtml(item.severity)}</span></td>
    <td><strong>${escapeHtml(item.ticketKey)}</strong><div class="muted">${escapeHtml(item.summary)}</div></td>
    <td>${escapeHtml(triageKindLabel(item.kind))}</td>
    <td>${escapeHtml(item.action)}</td>
    <td>${escapeHtml(item.projects.join(', ') || 'unlinked')}</td>
    <td>${item.ageDays === undefined ? '-' : `${escapeHtml(String(item.ageDays))}d`}</td>
    <td>${escapeHtml(item.detail)}</td>
    <td class="action-cell">${triageActionButtons(item)}</td>
  </tr>`).join('');
  const empty = report.items.length === 0 ? '<div class="kronos-empty">No backlog triage items found.</div>' : '';
  const summaryCards = cards || '<div class="kronos-empty">No active backlog categories.</div>';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  tr.critical td { border-left: 3px solid #f44336; }
  tr.warning td { border-left: 3px solid #ff9800; }
  tr.info td { border-left: 3px solid #4caf50; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Backlog Triage</h1>
      <div class="kronos-subtitle">Generated ${escapeHtml(report.generatedAt)}. Critical items sort first, then oldest tickets.</div>
    </div>
  </div>
  <div class="operator-summary">${summaryCards}</div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Ticket</th><th>Category</th><th>Action</th><th>Projects</th><th>Age</th><th>Detail</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildProjectBatchPlanHtml(batches: ProjectBatchPlan[], nonce?: string): string {
  const rows = batches.map(batch => {
    const actions = Object.entries(batch.actionCounts)
      .map(([action, count]) => `${actionToLabel(action)}: ${count}`)
      .join(', ');
    const plans = batch.plans.map(plan => `<tr>
      <td>${escapeHtml(plan.ticketKey || 'Refresh')}</td>
      <td>${escapeHtml(actionToLabel(plan.action))}</td>
      <td>${escapeHtml(String(plan.score))}</td>
      <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
      <td>${escapeHtml(plan.reason)}</td>
      <td class="action-cell">${planActionRow(plan)}</td>
    </tr>`).join('');
    return `<section class="operator-card">
      <div class="operator-card-header"><div class="operator-card-title">${escapeHtml(batch.project)}</div><div class="operator-card-meta">${escapeHtml(String(batch.plans.length))} action(s)</div></div>
      <div class="subtitle">Score ${escapeHtml(String(batch.totalScore))} | estimated ${escapeHtml(String(batch.estimatedMinutes))}m | ${escapeHtml(actions || 'no actions')}</div>
      <div class="table-wrap"><table class="kronos-table"><tr><th>Ticket</th><th>Action</th><th>Score</th><th>Estimate</th><th>Reason</th><th class="action-cell">Actions</th></tr>${plans}</table></div>
    </section>`;
  }).join('');
  const empty = batches.length === 0 ? '<div class="kronos-empty">No project batch plan recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Project Batch Plan</h1>
      <div class="kronos-subtitle">Top grouped recommendations by project</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildReleaseBatchPlanHtml(batches: ReleaseBatchPlan[], nonce?: string): string {
  const rows = batches.map(batch => {
    const actions = Object.entries(batch.actionCounts)
      .map(([action, count]) => `${actionToLabel(action)}: ${count}`)
      .join(', ');
    const plans = batch.plans.map(plan => `<tr>
      <td>${escapeHtml(plan.ticketKey || 'Refresh')}</td>
      <td>${escapeHtml(actionToLabel(plan.action))}</td>
      <td>${escapeHtml(plan.projects.join(', ') || 'unlinked')}</td>
      <td>${escapeHtml(String(plan.score))}</td>
      <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
      <td>${escapeHtml(plan.reason)}</td>
      <td class="action-cell">${planActionRow(plan)}</td>
    </tr>`).join('');
    return `<section class="operator-card">
      <div class="operator-card-header"><div class="operator-card-title">${escapeHtml(batch.release)}</div><div class="operator-card-meta">${escapeHtml(String(batch.plans.length))} action(s)</div></div>
      <div class="subtitle">Score ${escapeHtml(String(batch.totalScore))} | estimated ${escapeHtml(String(batch.estimatedMinutes))}m | ${escapeHtml(actions || 'no actions')}</div>
      <div class="table-wrap"><table class="kronos-table"><tr><th>Ticket</th><th>Action</th><th>Projects</th><th>Score</th><th>Estimate</th><th>Reason</th><th class="action-cell">Actions</th></tr>${plans}</table></div>
    </section>`;
  }).join('');
  const empty = batches.length === 0 ? '<div class="kronos-empty">No release batch plan recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Release Batch Plan</h1>
      <div class="kronos-subtitle">Top grouped recommendations by release bucket</div>
    </div>
  </div>
  ${empty || `<div class="plan-list">${rows}</div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildCollisionReportHtml(reports: Array<{ plan: PlannedAction; collisions: DispatchCollision[] }>, nonce?: string): string {
  const rows = reports.flatMap(report => report.collisions.map(collision => `<tr class="${escapeClass(collision.severity)}">
    <td><span class="pill ${escapeClass(collision.severity)}">${escapeHtml(collision.severity)}</span></td>
    <td>${escapeHtml(report.plan.ticketKey || 'Refresh')}<br><span class="collision-plan-detail">${escapeHtml(actionToLabel(report.plan.action))}</span></td>
    <td>${escapeHtml(collision.kind)}</td>
    <td><strong>${escapeHtml(collision.title)}</strong><div>${escapeHtml(collision.detail)}</div></td>
    <td class="action-cell">${planActionRow(report.plan)}</td>
  </tr>`)).join('');
  const empty = reports.length === 0 ? '<div class="kronos-empty">No collisions found for the top planned actions.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .collision-plan-detail { color: var(--k-muted); }
  .pill.high { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.medium { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.low { color: #4caf50; background: rgba(76,175,80,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Collision Report</h1>
      <div class="kronos-subtitle">Active runs, duplicate queue work, and open merge requests that overlap top planned actions</div>
    </div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Plan</th><th>Kind</th><th>Detail</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildQueuePlanModeHtml(title: string, subtitle: string, plans: PlannedAction[], nonce?: string): string {
  const rows = plans.map((plan, idx) => `<tr>
    <td>${idx + 1}</td>
    <td><strong>${escapeHtml(plan.ticketKey || 'Refresh')}</strong><div class="muted">${escapeHtml(plan.ticketSummary || '')}</div></td>
    <td>${escapeHtml(actionToLabel(plan.action))}</td>
    <td>${escapeHtml(plan.projects.join(', ') || 'unlinked')}</td>
    <td>${escapeHtml(String(plan.score))}</td>
    <td>${escapeHtml(String(estimatePlanMinutes(plan)))}m</td>
    <td>${escapeHtml(plan.reason)}</td>
    <td class="action-cell">${planActionRow(plan)}</td>
  </tr>`).join('');
  const empty = plans.length === 0 ? '<div class="kronos-empty">No matching recommendations found.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(title)}</h1>
      <div class="kronos-subtitle">${escapeHtml(subtitle)}</div>
    </div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>#</th><th>Ticket</th><th>Action</th><th>Projects</th><th>Score</th><th>Estimate</th><th>Reason</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function planActionRow(plan: PlannedAction): string {
  const buttons: string[] = [
    actionButton('startPlan', 'Start', { planId: plan.planId, primary: true }),
  ];
  if (plan.ticketKey) {
    if (plan.source === 'queue') {
      buttons.push(actionButton('pinPlan', 'Pin', { planId: plan.planId, ticket: plan.ticketKey }));
    } else {
      buttons.push(actionButton('queuePlan', 'Queue', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('pinPlan', 'Pin', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('snoozePlan', 'Snooze', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('snoozePlanToday', 'Tomorrow', { planId: plan.planId, ticket: plan.ticketKey }));
      buttons.push(actionButton('rejectPlan', 'Reject', { planId: plan.planId, ticket: plan.ticketKey }));
    }
    buttons.push(actionButton('viewTicket', 'View', { planId: plan.planId, ticket: plan.ticketKey }));
    buttons.push(actionButton('addEvidence', 'Evidence', { planId: plan.planId, ticket: plan.ticketKey }));
  }
  return actionRow(buttons);
}

function triageKindLabel(kind: string): string {
  return kind.replace(/_/g, ' ');
}

function triageActionButtons(item: BacklogTriageReport['items'][number]): string {
  const buttons: string[] = [];
  if (item.kind === 'unlinked') {
    buttons.push(actionButton('linkTicket', 'Link', { ticket: item.ticketKey, primary: true }));
  }
  if (item.kind === 'evidence_gap') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: item.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidence', 'Add Note', { ticket: item.ticketKey }));
  }
  if (['build_failed', 'ready_to_plan', 'stale'].includes(item.kind) && item.projects.length > 0) {
    buttons.push(actionButton('startTicket', 'Start', { ticket: item.ticketKey, primary: item.kind === 'build_failed' }));
    buttons.push(actionButton('addToQueue', 'Queue', { ticket: item.ticketKey }));
  }
  buttons.push(actionButton('viewTicket', 'View', { ticket: item.ticketKey, primary: buttons.length === 0 }));
  return actionRow(buttons);
}
