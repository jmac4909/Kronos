import type { EvidenceGateResult } from './evidenceGate';
import type { EvidenceHandoffPlan } from './evidenceHandoff';
import type { EvidencePublishDestination, EvidencePublishResult } from './evidencePublisher';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeClass, escapeHtml, safeHttpHref } from './webviewHtml';

export function buildEvidenceHandoffHtml(plan: EvidenceHandoffPlan, nonce?: string, actionScriptUri?: string): string {
  const destinations = plan.destinations.map(destination => {
    const href = safeHttpHref(destination.url);
    return `<tr class="${destination.available ? 'available' : 'missing'}">
      <td><span class="pill ${destination.available ? 'pass' : 'warn'}">${destination.available ? 'AVAILABLE' : 'MISSING'}</span></td>
      <td>${escapeHtml(destination.label)}</td>
      <td>${escapeHtml(destination.detail)}</td>
      <td>${href ? `<a href="${href}">Open</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const steps = plan.manualSteps.map(step => `<li>${escapeHtml(step)}</li>`).join('');
  const comment = escapeHtml(plan.comment);
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: plan.ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: plan.ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: plan.ticketKey }),
    actionButton('publishEvidence', 'Publish', { ticket: plan.ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Handoff: ${escapeHtml(plan.ticketKey)}</h1><div class="kronos-subtitle">Manual posting packet with destinations, steps, and copied comment payload</div></div></div>
  ${actions}
  <div class="subtitle">${escapeHtml(plan.summary)}<br>Comment text has been copied to the clipboard. Kronos did not call a posting API.</div>
  <div class="operator-section"><h2>Destinations</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Open</th></tr>${destinations}</table></div></div>
  <div class="operator-section"><h2>Manual Steps</h2>
  <ol>${steps}</ol>
  </div>
  <div class="operator-section"><h2>Comment Payload</h2>
  <pre>${comment}</pre></div>
  <p>Markdown artifact: ${escapeHtml(plan.exportPath)}</p>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Evidence Handoff', true, actionScriptUri) : ''}</body></html>`;
}

export function buildEvidencePublishHtml(results: Array<EvidencePublishResult | EvidencePublishDestination>, ticketKey: string, nonce?: string, actionScriptUri?: string): string {
  const rows = results.map(result => {
    const href = safeHttpHref(result.endpoint);
    const httpStatus = 'httpStatus' in result && result.httpStatus ? `HTTP ${result.httpStatus}` : '';
    return `<tr class="${escapeClass(result.status)}">
      <td><span class="pill ${publishPillClass(result.status)}">${escapeHtml(result.status)}</span></td>
      <td>${escapeHtml(result.label)}</td>
      <td>${escapeHtml(result.detail)}${httpStatus ? `<div class="muted">${escapeHtml(httpStatus)}</div>` : ''}</td>
      <td>${href ? `<a href="${href}">Endpoint</a>` : '-'}</td>
    </tr>`;
  }).join('');
  const empty = results.length === 0 ? '<div class="empty">No publish destinations were evaluated.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('viewTicket', 'View Ticket', { ticket: ticketKey }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: ticketKey }),
    actionButton('exportEvidence', 'Export', { ticket: ticketKey }),
    actionButton('evidenceHandoff', 'Handoff', { ticket: ticketKey }),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Evidence Publish: ${escapeHtml(ticketKey)}</h1><div class="kronos-subtitle">External publish results and endpoint safety status</div></div></div>
  ${actions}
  <div class="subtitle">External publishing is safety-gated and credential values are never displayed.</div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Destination</th><th>Detail</th><th>Endpoint</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Evidence Publish', true, actionScriptUri) : ''}</body></html>`;
}

export function buildEvidenceGateHtml(gates: EvidenceGateResult[], title: string, nonce: string, actionScriptUri?: string): string {
  const summary = {
    fail: gates.filter(g => g.status === 'fail').length,
    warn: gates.filter(g => g.status === 'warn').length,
    pass: gates.filter(g => g.status === 'pass').length,
  };
  const rows = gates.flatMap(gate => gate.checks.map(check => `<tr class="${check.status}">
    <td><span class="pill ${check.status}">${escapeHtml(check.status.toUpperCase())}</span></td>
    <td>${escapeHtml(gate.ticketKey)}</td>
    <td>${escapeHtml(check.kind)}</td>
    <td>${escapeHtml(check.title)}</td>
    <td class="detail">${escapeHtml(check.detail)}</td>
    <td class="action-cell">${evidenceGateActionButtons(gate, check)}</td>
  </tr>`)).join('');
  const empty = gates.length === 0 ? '<div class="empty">No evidence gate items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">${escapeHtml(title)}</h1><div class="kronos-subtitle">Evidence readiness by ticket and check</div></div></div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${summary.fail}</div><div class="lbl">Failing</div></div>
    <div class="summary-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${summary.pass}</div><div class="lbl">Passing</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Ticket</th><th>Check</th><th>Item</th><th>Detail</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(nonce, 'Kronos Evidence Gate', true, actionScriptUri)}</body></html>`;
}

function publishPillClass(status: string): string {
  if (status === 'posted' || status === 'ready') { return 'pass'; }
  if (status === 'failed') { return 'fail'; }
  return 'warn';
}

function evidenceGateActionButtons(gate: EvidenceGateResult, check: EvidenceGateResult['checks'][number]): string {
  if (check.status === 'pass') {
    return actionRow([actionButton('viewTicket', 'View Ticket', { ticket: gate.ticketKey })]);
  }

  const buttons: string[] = [];
  if (check.kind === 'notes' || check.kind === 'risk') {
    buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'test') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidence', 'Add Note', { ticket: gate.ticketKey }));
  } else if (check.kind === 'acceptance') {
    const isMissingExtraction = /not extracted/i.test(check.title);
    buttons.push(actionButton(isMissingExtraction ? 'extractAcceptanceCriteria' : 'updateAcceptanceCriteria', isMissingExtraction ? 'Extract AC' : 'Check AC', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'environment') {
    buttons.push(actionButton('recordEnvironmentResult', 'Record Env', { ticket: gate.ticketKey, primary: true }));
    buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: gate.ticketKey }));
  } else if (check.kind === 'build') {
    buttons.push(actionButton('addEvidenceCheck', 'Add Build Check', { ticket: gate.ticketKey, primary: true }));
  } else if (check.kind === 'project' || check.kind === 'mr') {
    buttons.push(actionButton('viewTicket', 'Fix', { ticket: gate.ticketKey, primary: true }));
  }

  if (gate.ready) {
    buttons.push(actionButton('evidenceHandoff', 'Handoff', { ticket: gate.ticketKey }));
    buttons.push(actionButton('publishEvidence', 'Publish', { ticket: gate.ticketKey }));
  }
  return actionRow(buttons);
}
