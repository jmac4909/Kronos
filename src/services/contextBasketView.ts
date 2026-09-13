import type { ContextBasketItem } from './contextBasketStore';
import { formatWebviewDateTime } from './webviewFormat';
import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const CONTEXT_BASKET_SCRIPT = 'kronos-context-basket.js';

export interface ContextBasketViewInput {
  items: readonly ContextBasketItem[];
  conflictIds: ReadonlySet<string>;
  nonce: string;
  scriptUri: string;
  focus?: string;
}

export function buildContextBasketHtml(input: ContextBasketViewInput): string {
  const totalBytes = input.items.reduce((total, item) => total + item.sizeBytes, 0);
  const partial = input.items.filter(item => !item.complete).length;
  const conflicts = input.items.filter(item => input.conflictIds.has(item.id)).length;
  const rows = input.items.map(item => `<article class="basket-item${input.conflictIds.has(item.id) ? ' conflict' : ''}">
    <div class="basket-item-heading"><div><span class="kronos-pill info">${escapeHtml(contextKindLabel(item.kind))}</span><h2>${escapeHtml(item.label)}</h2></div><span class="kronos-pill ${item.complete ? 'pass' : 'warn'}">${item.complete ? 'Complete' : 'Partial'}</span></div>
    <div class="basket-provenance">${escapeHtml(item.provenance)}</div>
    <div class="basket-facts"><span>Saved ${escapeHtml(formatWebviewDateTime(item.fetchedAt, 'Unknown'))}</span><span>${escapeHtml(formatBytes(item.sizeBytes))}</span></div>
    <details class="basket-source-details"><summary>Source details</summary><div>SHA-256: <code>${escapeHtml(item.contentSha256 || 'unavailable')}</code></div></details>
    ${input.conflictIds.has(item.id) ? '<div class="message warn">Conflict: another basket item has different content from this source.</div>' : ''}
    ${item.warnings.slice(0, 2).map(warning => `<div class="message warn">${escapeHtml(warning)}</div>`).join('')}
    <div class="kronos-action-row"><button class="kronos-button" type="button" data-action="refresh" data-entry-id="${escapeAttr(item.id)}">Refresh source</button><button class="kronos-button" type="button" data-action="remove" data-entry-id="${escapeAttr(item.id)}">Remove</button></div>
  </article>`).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-context-basket-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="context-basket" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
${kronosWebviewBaseCss()}
.basket-shell { max-width: 1280px; }
.basket-summary { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.basket-summary-item { display: flex; align-items: baseline; gap: 6px; min-width: 110px; padding: 7px 10px; border: 1px solid var(--k-border); border-radius: 999px; background: var(--k-surface-soft); }
.basket-summary-value { font-weight: 700; }
.basket-summary-label { color: var(--k-muted); font-size: 10px; text-transform: uppercase; }
.basket-editor { padding: 14px; margin-bottom: 14px; }
.basket-editor textarea { width: 100%; min-height: 110px; resize: vertical; }
.basket-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; align-items: start; }
.basket-item { padding: 13px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-info); border-radius: var(--k-radius); background: var(--k-surface); }
.basket-item.conflict { border-left-color: var(--k-warn); }
.basket-item-heading { display: flex; justify-content: space-between; gap: 10px; }
.basket-item-heading > div { min-width: 0; }
.basket-item h2 { display: inline; margin: 0 0 0 8px; font-size: 13px; }
.basket-provenance { margin: 7px 0; color: var(--k-muted); overflow-wrap: anywhere; }
.basket-facts { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 9px; color: var(--k-muted); font-size: 10px; }
.basket-source-details { margin: 0 0 9px; color: var(--k-muted); font-size: 10px; }
.basket-source-details summary { cursor: pointer; }
.basket-source-details div { margin-top: 5px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .basket-list { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .basket-item-heading { display: block; } }
</style></head><body><main class="kronos-shell basket-shell">
<header class="kronos-header"><div><h1 class="kronos-title">Context basket</h1><div class="kronos-subtitle">Combine saved Jira, merge request, build, quality, and Git context before adding one reference to a terminal.</div></div></header>
<section class="basket-summary" aria-label="Basket totals">
  ${stat('Items', String(input.items.length))}${stat('Total size', formatBytes(totalBytes))}${stat('Partial', String(partial))}${stat('Conflicts', String(conflicts))}
</section>
<section class="kronos-panel basket-editor">
  <label class="kronos-section-title" for="basket-focus">What Claude should focus on</label>
  <textarea id="basket-focus" class="kronos-input" maxlength="4000" autofocus>${escapeHtml(input.focus || 'Review the selected Jira, merge request, local Git, build, and quality evidence together before making changes.')}</textarea>
  <div class="kronos-action-row" style="margin-top:10px"><button class="kronos-button primary" type="button" data-action="insert">Add to terminal</button><button class="kronos-button" type="button" data-action="close">Close</button><button class="kronos-button" type="button" data-action="clear"${input.items.length === 0 ? ' disabled' : ''}>Clear basket</button></div>
  <div class="kronos-subtitle">Actions run only when selected. Refresh source opens a new review, and terminal placement never submits.</div>
</section>
<section id="basket-items" class="basket-list" aria-label="Selected context evidence">${rows || '<div class="kronos-empty">The basket is empty. Review Jira, merge request, build, quality, or project changes and choose Add to basket.</div>'}</section>
</main>${script}</body></html>`;
}

function stat(label: string, value: string): string {
  return `<div class="basket-summary-item"><span class="basket-summary-value">${escapeHtml(value)}</span><span class="basket-summary-label">${escapeHtml(label)}</span></div>`;
}

function contextKindLabel(kind: ContextBasketItem['kind']): string {
  switch (kind) {
    case 'jira': return 'Jira';
    case 'gitlab': return 'Merge request';
    case 'ci': return 'Build & quality';
    case 'git': return 'Project changes';
  }
}

function formatBytes(value: number): string {
  if (value < 1024) { return `${value} B`; }
  if (value < 1024 * 1024) { return `${(value / 1024).toFixed(1)} KiB`; }
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}
