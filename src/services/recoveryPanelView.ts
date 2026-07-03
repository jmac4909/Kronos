import type { StateAuditEvent } from './stateStore';
import type { RecoveryInventory, RecoveryItem } from './recoveryCenter';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { escapeAttr, escapeHtml } from './webviewHtml';

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

export function buildRecoveryHtml(inventory: RecoveryInventory, nonce?: string, focusRunId?: string): string {
  const focusedRunId = focusRunId?.trim() || '';
  const items = focusedRunId
    ? [...inventory.items].sort((a, b) => focusedRecoveryItemSort(a, b, focusedRunId))
    : inventory.items;
  const rows = items.map(item => {
    const focused = Boolean(focusedRunId && item.runId === focusedRunId);
    return `<tr class="${item.severity}${focused ? ' focused-recovery-item' : ''}"${item.runId ? ` data-run-id="${escapeAttr(item.runId)}"` : ''}${focused ? ' data-focused-run="true"' : ''}>
    <td><span class="pill ${item.severity}">${escapeHtml(item.severity.toUpperCase())}</span></td>
    <td>${escapeHtml(item.kind)}</td>
    <td>${escapeHtml(item.title)}</td>
    <td class="detail">${escapeHtml(item.detail)}</td>
    <td class="action-cell">${recoveryActionButtons(item)}</td>
  </tr>`;
  }).join('');
  const empty = inventory.items.length === 0 ? '<div class="empty">No active recovery items.</div>' : '';

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .focused-recovery-item { outline: 2px solid var(--k-accent); outline-offset: -2px; background: color-mix(in srgb, var(--k-accent) 12%, transparent); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header"><div><h1 class="kronos-title">Kronos Recovery Center</h1><div class="kronos-subtitle">Runs, worktrees, backups, integrations, and merge requests that need operator action${focusedRunId ? ` - focused on ${escapeHtml(focusedRunId)}` : ''}</div></div></div>
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${inventory.summary.critical}</div><div class="lbl">Critical</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.warning}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.info}</div><div class="lbl">Info</div></div>
    <div class="summary-card"><div class="num">${inventory.summary.total}</div><div class="lbl">Total</div></div>
  </div>
  ${empty || `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Severity</th><th>Kind</th><th>Item</th><th>Detail</th><th class="action-cell">Action</th></tr>${rows}</table></div>`}
</div>${nonce ? kronosActionPanelScript(nonce) : ''}</body></html>`;
}

function focusedRecoveryItemSort(a: RecoveryItem, b: RecoveryItem, focusRunId: string): number {
  const aFocused = a.runId === focusRunId;
  const bFocused = b.runId === focusRunId;
  return Number(bFocused) - Number(aFocused);
}

function recoveryActionButtons(item: RecoveryItem): string {
  const buttons: string[] = [];
  if (item.action) {
    buttons.push(actionButton('executeRecoveryItem', item.actionLabel || recoveryActionLabel(item.action), recoveryActionOptions(item, item.action, item.severity === 'critical')));
  }
  for (const action of item.secondaryActions || []) {
    buttons.push(actionButton('executeRecoveryItem', action.label || recoveryActionLabel(action.action), recoveryActionOptions(item, action.action, false)));
  }
  return actionRow(buttons);
}

function recoveryActionOptions(item: RecoveryItem, action: RecoveryItem['action'], primary: boolean): { itemId: string; ticket?: string; runId?: string; recoveryAction?: string; primary: boolean } {
  const options: { itemId: string; ticket?: string; runId?: string; recoveryAction?: string; primary: boolean } = {
    itemId: item.id,
    primary,
  };
  if (item.ticketKey) { options.ticket = item.ticketKey; }
  if (item.runId) { options.runId = item.runId; }
  if (action) { options.recoveryAction = action; }
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
