import { WEBVIEW_READY_COMMAND, webviewActionPostScript } from './webviewSecurity';
import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export interface ActionButtonOptions {
  ticket?: string;
  runId?: string;
  planId?: string;
  itemId?: string;
  primary?: boolean;
}

export function actionButton(action: string, label: string, options: ActionButtonOptions = {}): string {
  const classes = `kronos-button${options.primary ? ' primary' : ''}`;
  const ticketAttr = options.ticket ? ` data-ticket="${escapeAttr(options.ticket)}"` : '';
  const runAttr = options.runId ? ` data-run-id="${escapeAttr(options.runId)}"` : '';
  const planAttr = options.planId ? ` data-plan-id="${escapeAttr(options.planId)}"` : '';
  const itemAttr = options.itemId ? ` data-item-id="${escapeAttr(options.itemId)}"` : '';
  return `<button type="button" class="${classes}" data-action="${escapeAttr(action)}"${ticketAttr}${runAttr}${planAttr}${itemAttr}>${escapeHtml(label)}</button>`;
}

export function actionRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row inline-actions">${buttons.join('')}</div>`
    : '<span class="muted">No action</span>';
}

export function operatorCommandRow(buttons: string[]): string {
  return buttons.length > 0
    ? `<div class="kronos-action-row operator-command-row">${buttons.join('')}</div>`
    : '';
}

export function kronosActionPanelScript(nonce: string, webviewName = 'Kronos action panel', readyDiagnostic = true): string {
  const readyOptions = readyDiagnostic ? { readyCommand: WEBVIEW_READY_COMMAND } : {};
  return `<script nonce="${escapeAttr(nonce)}">
${webviewActionPostScript(webviewName, [
  { messageKey: 'ticket', dataAttribute: 'data-ticket' },
  { messageKey: 'runId', dataAttribute: 'data-run-id' },
  { messageKey: 'planId', dataAttribute: 'data-plan-id' },
  { messageKey: 'itemId', dataAttribute: 'data-item-id' },
], readyOptions)}
</script>`;
}

export function kronosOperatorPanelCss(): string {
  return `${kronosWebviewBaseCss()}
  .operator-shell { max-width: 1280px; }
  .operator-summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 10px; margin: 12px 0 18px; }
  .summary-card { padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .summary-card .num { font-size: 24px; line-height: 1.1; font-weight: 700; }
  .summary-card .lbl { margin-top: 4px; color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .table-wrap { overflow: auto; position: relative; }
  .detail { white-space: pre-wrap; word-break: break-word; }
  .pill { display: inline-flex; align-items: center; min-height: 20px; border: 1px solid var(--k-border); border-radius: 999px; padding: 2px 8px; font-weight: 650; font-size: 10px; line-height: 1.2; text-transform: uppercase; }
  .pill.critical, .pill.fail, .pill.bad, .pill.error { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.warning, .pill.warn, .pill.medium, .pill.neutral { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.info, .pill.pass, .pill.good, .pill.ok, .pill.low { color: #4caf50; background: rgba(76,175,80,0.16); }
  .subtitle { color: var(--k-muted); margin-bottom: 16px; }
  .muted { color: var(--k-muted); margin-top: 3px; }
  .empty { color: var(--k-muted); }
  div.empty { border: 1px dashed var(--k-border); border-radius: var(--k-radius); padding: 18px; background: var(--k-surface-soft); }
  .operator-section { margin: 20px 0; }
  .operator-section h2,
  .operator-section h3 { margin: 0 0 10px; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .operator-card { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 12px; background: var(--k-surface); }
  .operator-card-header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .operator-card-title { font-size: 14px; font-weight: 650; line-height: 1.3; }
  .operator-card-meta { color: var(--k-muted); font-size: 11px; }
  .operator-card .subtitle { margin-bottom: 10px; }
  .operator-note { border-left: 3px solid var(--k-accent); padding: 10px 12px; border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .operator-hero { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius); padding: 14px 16px; background: var(--k-surface-soft); }
  .operator-hero .score { font-size: 34px; line-height: 1; font-weight: 750; }
  .operator-hero .grade { color: var(--k-muted); font-size: 18px; margin-left: 8px; }
  .action-cell { min-width: 150px; position: sticky; right: 0; z-index: 1; background: var(--k-surface); box-shadow: -1px 0 0 var(--k-border); }
  th.action-cell { z-index: 2; background: var(--k-surface-soft); }
  .inline-actions { gap: 6px; align-items: flex-start; }
  .inline-actions .kronos-button { min-height: 24px; padding: 3px 8px; font-size: 10px; }
  .operator-command-row { margin: 12px 0 18px; gap: 8px; align-items: flex-start; }
  .operator-command-row .kronos-button { min-height: 28px; }
  .plan-list { display: grid; gap: 10px; }
  .plan-card { display: grid; grid-template-columns: 34px 1fr; gap: 10px; }
  .rank { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 1px solid var(--k-border); border-radius: 999px; background: var(--k-surface-soft); font-weight: 700; }
  .score-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; margin-top: 8px; }
  .score-part { border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 7px 8px; font-size: 11px; background: var(--k-surface-soft); }
  .score-part span { display: block; color: var(--k-muted); font-weight: 650; text-transform: uppercase; }
  .score-part strong { display: inline-block; margin-right: 6px; font-size: 16px; }
  .score-part small { color: var(--k-muted); }
  .message { padding: 9px 10px; margin: 6px 0; border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); font-size: 12px; }
  .message.pass { border-left-color: #4caf50; }
  .message.warn { border-left-color: #ff9800; }
  .message.fail { border-left-color: #f44336; }
  .hash-detail { display: inline-block; margin-top: 3px; color: var(--k-muted); word-break: break-word; }
  .path { color: var(--k-muted); font-size: 12px; margin-bottom: 12px; word-break: break-all; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--k-surface-soft); border: 1px solid var(--k-border); padding: 12px; border-radius: var(--k-radius); font-size: 12px; }
  a { color: var(--k-accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  li { margin: 4px 0; }`;
}
