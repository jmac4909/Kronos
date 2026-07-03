import type { Ticket } from '../state/types';
import type { HumanReviewInbox, HumanReviewItem } from './humanReviewInbox';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeHtml } from './webviewHtml';

export interface HumanReviewInboxHtmlOptions {
  tickets?: Record<string, Ticket>;
  nonce: string;
  actionScriptUri?: string | undefined;
}

export function buildHumanReviewInboxHtml(inbox: HumanReviewInbox, options: HumanReviewInboxHtmlOptions): string {
  const rows = inbox.items.map(item => `<tr class="${item.severity}">
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td>${escapeHtml(item.ticketKey || item.runId || '')}</td>
    <td class="action-cell">${humanReviewActionButtons(item, options.tickets || {})}</td>
  </tr>`).join('');
  const empty = inbox.items.length === 0 ? '<div class="empty">No human-review items found.</div>' : '';
  const actions = operatorCommandRow([
    actionButton('refreshPanel', 'Refresh'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Human Review Inbox</h1><div class="kronos-subtitle">Items where an operator decision is safer than automation</div></div></div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inbox.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inbox.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th>Ref</th><th class="action-cell">Actions</th></tr>${rows}</table></div>`}
</div>${kronosActionPanelScript(options.nonce, 'Kronos Human Review Inbox', true, options.actionScriptUri)}</body></html>`;
}

function humanReviewActionButtons(item: HumanReviewItem, tickets: Record<string, Ticket>): string {
  const ticket = item.ticketKey ? tickets[item.ticketKey] : undefined;
  const hasLinkedProject = Boolean(ticket?.projects?.length);
  const buttons: string[] = [];

  if (item.kind === 'evidence' && item.ticketKey) {
    if (/acceptance criteria not extracted/i.test(item.title)) {
      buttons.push(actionButton('extractAcceptanceCriteria', 'Extract AC', { ticket: item.ticketKey, primary: true }));
    } else if (/acceptance criterion item.*unchecked/i.test(item.title)) {
      buttons.push(actionButton('updateAcceptanceCriteria', 'Check AC', { ticket: item.ticketKey, primary: true }));
    } else if (/test evidence|evidence check|build/i.test(item.title)) {
      buttons.push(actionButton('addEvidenceCheck', 'Add Check', { ticket: item.ticketKey, primary: true }));
    } else {
      buttons.push(actionButton('addEvidence', 'Add Evidence', { ticket: item.ticketKey, primary: true }));
    }
    buttons.push(actionButton('evidenceGate', 'Gate', { ticket: item.ticketKey }));
  } else if (item.kind === 'ticket' && item.ticketKey) {
    if (hasLinkedProject && ticket?.next_action !== 'done') {
      buttons.push(actionButton('startTicket', 'Start', { ticket: item.ticketKey, primary: item.severity === 'critical' }));
      buttons.push(actionButton('addToQueue', 'Queue', { ticket: item.ticketKey }));
    }
    buttons.push(actionButton('viewTicket', item.title.includes('blocked') || !hasLinkedProject ? 'Fix' : 'View', { ticket: item.ticketKey, primary: !hasLinkedProject }));
  } else if (item.kind === 'run') {
    buttons.push(actionButton('runCenter', 'Open Run Center', { primary: item.severity === 'critical' }));
    buttons.push(actionButton('recoveryCenter', 'Recovery'));
  } else if (item.kind === 'integration') {
    buttons.push(actionButton('doctor', 'Open Doctor', { primary: item.severity === 'critical' }));
  } else if (item.kind === 'worktree') {
    buttons.push(actionButton('recoveryCenter', 'Review Worktree', { primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  } else if (item.kind === 'queue') {
    buttons.push(actionButton('queuePlanner', 'Open Queue', { primary: item.severity === 'critical' }));
    if (item.ticketKey) {
      buttons.push(actionButton('viewTicket', 'View Ticket', { ticket: item.ticketKey }));
    }
  }

  return actionRow(buttons);
}
