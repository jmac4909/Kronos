import type { MrAutopilotCandidate, MrAutopilotPlan } from './mrAutopilot';
import { actionButton, actionRow, kronosActionPanelScript } from './operatorPanel';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export function buildMrAutopilotHtml(plan: MrAutopilotPlan, nonce?: string, actionScriptUri?: string): string {
  const candidateRows = plan.candidates.map(candidateRow).join('');
  const passRows = plan.recommendedPass.map(step => `<tr class="${escapeClass(step.status)}">
    <td><span class="kronos-pill ${stepStatusPillClass(step.status)}">${escapeHtml(step.status)}</span></td>
    <td><strong>${escapeHtml(step.label)}</strong></td>
    <td>${escapeHtml(String(step.count))}</td>
    <td>${escapeHtml(step.detail)}</td>
  </tr>`).join('');
  const safePass = plan.safePass.map(item => `<li>${escapeHtml(item)}</li>`).join('');
  const actions = actionRow([
    actionButton('runAutopilotPass', 'Run Safe Pass', { primary: true }),
    actionButton('pollReviewMergeRequests', 'Poll MRs'),
    actionButton('humanReviewInbox', 'Human Review'),
    actionButton('queuePlanner', 'Queue Planner'),
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html>
<head>
<style>
${kronosWebviewBaseCss()}
.autopilot-shell { max-width: 1180px; }
.autopilot-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: start; border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius); padding: 14px 16px; background: var(--k-surface); margin: 12px 0 16px; }
.autopilot-hero.attention,
.autopilot-hero.blocked { border-left-color: var(--k-danger); }
.autopilot-hero.ready { border-left-color: var(--k-ok); }
.autopilot-hero h2 { margin: 4px 0 6px; font-size: 18px; line-height: 1.25; }
.autopilot-hero p { margin: 0; color: var(--k-muted); line-height: 1.45; }
.autopilot-safe-pass { margin: 0; padding-left: 18px; color: var(--k-muted); font-size: 12px; line-height: 1.45; }
.autopilot-row-title { font-weight: 650; }
.autopilot-row-detail { margin-top: 3px; color: var(--k-muted); font-size: 12px; line-height: 1.35; }
.autopilot-list { margin: 6px 0 0; padding-left: 16px; color: var(--k-muted); font-size: 11px; line-height: 1.4; }
.autopilot-list.blockers { color: var(--k-danger); }
.autopilot-signals { color: var(--k-muted); font-size: 11px; line-height: 1.45; }
.autopilot-actions { min-width: 210px; }
@media (max-width: 820px) {
  .autopilot-hero { grid-template-columns: 1fr; }
}
</style>
</head>
<body>
<div class="kronos-shell autopilot-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos MR Autopilot</h1>
      <div class="kronos-subtitle">A guarded loop for polling review state, finding blockers, and choosing the next explicit operator action</div>
    </div>
  </div>
  ${actions}
  <div class="autopilot-hero ${escapeClass(plan.status)}">
    <div>
      <div class="kronos-section-title">Safe Pass</div>
      <h2>${escapeHtml(plan.summary)}</h2>
      <p>${escapeHtml(plan.nextStep)}</p>
      <p>Autopilot may poll and classify MR state. It does not start repository mutation without a targeted operator action.</p>
    </div>
    <ul class="autopilot-safe-pass">${safePass}</ul>
  </div>
  <div class="kronos-section">
    <h2 class="kronos-section-title">Autopilot Pass Plan</h2>
    <div class="kronos-table-wrap"><table class="kronos-table"><thead><tr><th>Status</th><th>Step</th><th>Count</th><th>Detail</th></tr></thead><tbody>${passRows}</tbody></table></div>
  </div>
  <div class="kronos-section">
    <h2 class="kronos-section-title">Candidates</h2>
    ${candidateRows ? `<div class="kronos-table-wrap"><table class="kronos-table"><thead><tr><th>Status</th><th>Ticket</th><th>Signals</th><th>Action</th></tr></thead><tbody>${candidateRows}</tbody></table></div>` : '<div class="kronos-empty">No linked merge requests found.</div>'}
  </div>
</div>
${nonce ? kronosActionPanelScript(nonce, 'Kronos MR Autopilot', actionScriptUri) : ''}
</body>
</html>`;
}

function candidateRow(candidate: MrAutopilotCandidate): string {
  return `<tr class="${escapeClass(candidate.status)}">
    <td><span class="kronos-pill ${candidatePillClass(candidate.status)}">${escapeHtml(candidateStatusLabel(candidate.status))}</span></td>
    <td>
      <div class="autopilot-row-title">${escapeHtml(candidate.title)}</div>
      <div class="autopilot-row-detail">${escapeHtml(candidate.detail)}</div>
      ${candidateList('Blockers', candidate.blockers, 'blockers')}
      ${candidateList('Preflight', candidate.preflight, '')}
    </td>
    <td>
      <div class="autopilot-signals">${escapeHtml([
        candidate.mrIid ? `!${candidate.mrIid}` : '',
        candidate.reviewStatus ? `review ${candidate.reviewStatus}` : '',
        candidate.buildStatus ? `build ${candidate.buildStatus}` : '',
        candidate.evidenceStatus ? `evidence ${candidate.evidenceStatus}` : '',
        candidate.pollEligible ? 'poll eligible' : 'poll blocked',
        candidate.lastSignalAt ? `last signal ${candidate.lastSignalAt}` : '',
        candidate.projectNames.length ? `projects ${candidate.projectNames.join(', ')}` : '',
      ].filter(Boolean).join(' | ') || 'No signals')}</div>
    </td>
    <td class="autopilot-actions">${actionRow(candidateActions(candidate))}</td>
  </tr>`;
}

function candidateList(label: string, values: string[], className: string): string {
  if (values.length === 0) { return ''; }
  const items = values.map(value => `<li>${escapeHtml(value)}</li>`).join('');
  return `<div class="autopilot-row-detail"><strong>${escapeHtml(label)}</strong></div><ul class="autopilot-list ${escapeClass(className)}">${items}</ul>`;
}

function candidateActions(candidate: MrAutopilotCandidate): string[] {
  const ticket = candidate.ticketKey;
  if (candidate.recommendedAction === 'runCenter' && candidate.runId) {
    return [
      actionButton('runCenter', 'Run Center', { runId: candidate.runId, primary: true }),
      actionButton('insertGitLabContext', 'Insert MR Context', { ticket }),
      actionButton('insertCiContext', 'Insert CI Context', { ticket }),
      actionButton('viewTicket', 'Ticket', { ticket }),
    ];
  }
  if (candidate.recommendedAction === 'evidenceGate') {
    return [
      actionButton('evidenceGate', 'Evidence Gate', { ticket, primary: true }),
      actionButton('insertGitLabContext', 'Insert MR Context', { ticket }),
      actionButton('insertCiContext', 'Insert CI Context', { ticket }),
      actionButton('viewTicket', 'Ticket', { ticket }),
    ];
  }
  if (candidate.recommendedAction === 'startTicket') {
    return [
      actionButton('startTicket', 'Start Fix', { ticket, primary: true }),
      actionButton('insertGitLabContext', 'Insert MR Context', { ticket }),
      actionButton('insertCiContext', 'Insert CI Context', { ticket }),
      actionButton('viewTicket', 'Ticket', { ticket }),
    ];
  }
  if (candidate.recommendedAction === 'humanReview') {
    return [
      actionButton('humanReviewInbox', 'Human Review', { primary: true }),
      actionButton('insertGitLabContext', 'Insert MR Context', { ticket }),
      actionButton('insertCiContext', 'Insert CI Context', { ticket }),
      actionButton('viewTicket', 'Ticket', { ticket }),
    ];
  }
  return [
    actionButton('pollReviewMergeRequests', 'Poll MRs', { primary: candidate.status === 'ready' }),
    actionButton('insertGitLabContext', 'Insert MR Context', { ticket }),
    actionButton('insertCiContext', 'Insert CI Context', { ticket }),
    actionButton('viewTicket', 'Ticket', { ticket }),
  ];
}

function candidateStatusLabel(status: MrAutopilotCandidate['status']): string {
  if (status === 'attention') { return 'Attention'; }
  if (status === 'blocked') { return 'Blocked'; }
  if (status === 'watching') { return 'Watching'; }
  if (status === 'done') { return 'Done'; }
  return 'Ready';
}

function candidatePillClass(status: MrAutopilotCandidate['status']): string {
  if (status === 'attention' || status === 'blocked') { return 'fail'; }
  if (status === 'watching') { return 'warn'; }
  if (status === 'done') { return 'pass'; }
  return 'pass';
}

function stepStatusPillClass(status: MrAutopilotPlan['recommendedPass'][number]['status']): string {
  if (status === 'blocked') { return 'fail'; }
  if (status === 'watching') { return 'warn'; }
  return 'pass';
}
