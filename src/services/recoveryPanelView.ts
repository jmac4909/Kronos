import type { StateAuditEvent } from './stateStore';
import type { RecoveryInventory, RecoveryItem } from './recoveryCenter';
import { actionButton, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeHtml } from './webviewHtml';

export function buildStateAuditLogHtml(events: StateAuditEvent[], stateAuditFile: string, nonce?: string): string {
  const rows = events.length === 0
    ? '<tr><td colspan="5" class="empty">No state audit events found.</td></tr>'
    : events.map(event => {
      const backup = typeof event.backup === 'string' && event.backup
        ? event.backup
        : event.backup === null
          ? 'none'
          : '';
      const detail = Object.entries(event)
        .filter(([key]) => !['at', 'action', 'target', 'backup'].includes(key))
        .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
        .join('\n');
      return `<tr>
        <td>${escapeHtml(String(event.at || ''))}</td>
        <td><code>${escapeHtml(event.action)}</code></td>
        <td>${escapeHtml(String(event.target || ''))}</td>
        <td>${escapeHtml(backup)}</td>
        <td><pre>${escapeHtml(detail || '-')}</pre></td>
      </tr>`;
    }).join('');
  const actions = operatorCommandRow([
    actionButton('recoveryCenter', 'Recovery Center'),
    actionButton('doctor', 'Doctor'),
    actionButton('stats', 'Session Stats'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  pre { margin: 0; padding: 0; border: 0; background: transparent; font-size: 11px; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos State Audit Log</h1>
      <div class="kronos-subtitle">${escapeHtml(stateAuditFile)} - newest first - ${events.length} event(s)</div>
    </div>
  </div>
  ${actions}
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Time</th><th>Action</th><th>Target</th><th>Backup</th><th>Detail</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

export function buildRecoveryHtml(inventory: RecoveryInventory, nonce?: string): string {
  const rows = inventory.items.map(item => `<tr class="${item.severity}">
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td class="action-cell">${actionButton('executeRecoveryItem', item.actionLabel || recoveryActionLabel(item.action), recoveryActionOptions(item))}</td>
  </tr>`).join('');
  const empty = inventory.items.length === 0 ? '<div class="empty">No active recovery items.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Recovery Center</h1><div class="kronos-subtitle">Runs, worktrees, backups, integrations, and merge requests that need operator action</div></div></div>
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inventory.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th class="action-cell">Action</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function recoveryActionOptions(item: RecoveryItem): { itemId: string; ticket?: string; runId?: string; primary: boolean } {
  const options: { itemId: string; ticket?: string; runId?: string; primary: boolean } = {
    itemId: item.id,
    primary: item.severity === 'critical',
  };
  if (item.ticketKey) { options.ticket = item.ticketKey; }
  if (item.runId) { options.runId = item.runId; }
  return options;
}

function recoveryActionLabel(action: RecoveryItem['action']): string {
  if (action === 'openRunCenter') { return 'Open Run Center'; }
  if (action === 'resumeRun') { return 'Resume Run'; }
  if (action === 'retryRun') { return 'Retry Saved Prompt'; }
  if (action === 'archiveRun') { return 'Archive Run'; }
  if (action === 'openRunLog') { return 'Open Log'; }
  if (action === 'openRunPrompt') { return 'Open Prompt'; }
  if (action === 'linkMrToTicket') { return 'Link MR to Ticket'; }
  if (action === 'cleanupWorktrees') { return 'Review Worktrees'; }
  if (action === 'restoreBackup') { return 'Restore Backup'; }
  if (action === 'openDoctor') { return 'Open Doctor'; }
  return '';
}
