import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';

export const CONTEXT_COMPOSER_SCRIPT = 'kronos-context-composer.js';

export interface ContextComposerEvidenceItem {
  label: string;
  detail: string;
}

export interface ContextComposerInput {
  title: string;
  subtitle: string;
  sourceLabel: string;
  terminalName: string;
  reference: string;
  suggestedFocus: string;
  evidence: ContextComposerEvidenceItem[];
  warnings: string[];
  nonce: string;
  scriptUri: string;
}

export function buildContextComposerHtml(input: ContextComposerInput): string {
  const evidence = input.evidence.slice(0, 20).map(item => `<article class="evidence-item">
    <h3>${escapeHtml(item.label)}</h3>
    <div>${escapeHtml(item.detail)}</div>
  </article>`).join('');
  const warnings = input.warnings.slice(0, 20).map(warning => `<div class="message warn">${escapeHtml(warning)}</div>`).join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-context-composer-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="context-composer" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');

  return `<!DOCTYPE html>
<html>
<head><style>
${kronosWebviewBaseCss()}
.composer-shell { max-width: 1040px; }
.composer-header { align-items: center; }
.composer-source { flex: 0 0 auto; }
.composer-layout { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(280px, .7fr); gap: 14px; align-items: start; }
.composer-card { padding: 16px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.composer-card h2 { margin: 0 0 5px; font-size: 14px; }
.composer-help { margin: 0 0 13px; color: var(--k-muted); font-size: 12px; }
.composer-focus { width: 100%; min-height: 150px; resize: vertical; padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-fg); background: var(--vscode-input-background, var(--k-bg)); font: 13px/1.5 var(--vscode-font-family); }
.composer-focus:focus { border-color: var(--vscode-focusBorder, var(--k-accent)); outline: none; }
.composer-reference { margin: 12px 0; padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-muted); background: var(--k-surface-soft); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; line-height: 1.45; word-break: break-word; }
.composer-actions { margin-top: 13px; }
.keyboard-hint { margin-top: 9px; color: var(--k-muted); font-size: 11px; }
.evidence-list { display: grid; gap: 8px; max-height: 560px; overflow: auto; padding-right: 3px; }
.evidence-item { padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
.evidence-item h3 { margin: 0 0 4px; font-size: 11px; }
.evidence-item div { color: var(--k-muted); font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.untrusted-note { margin: 0 0 10px; color: var(--k-warn); font-size: 11px; }
@media (max-width: 800px) { .composer-layout { grid-template-columns: 1fr; } }
</style></head>
<body><main class="kronos-shell composer-shell">
  <header class="kronos-header composer-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(input.title)}</h1>
      <div class="kronos-subtitle">${escapeHtml(input.subtitle)}</div>
    </div>
    <span class="kronos-pill info composer-source">${escapeHtml(input.sourceLabel)}</span>
  </header>
  ${warnings}
  <div class="composer-layout">
    <section class="composer-card">
      <h2>Edit the instruction</h2>
      <p class="composer-help">Add what Claude should focus on. Kronos keeps the fetched context reference fixed, safely quotes your note, and inserts one editable line without pressing Enter.</p>
      <label class="kronos-section-title" for="context-focus">Operator focus</label>
      <textarea id="context-focus" class="composer-focus" maxlength="2000" spellcheck="true" autofocus>${escapeHtml(input.suggestedFocus)}</textarea>
      <div class="kronos-section-title">Fixed context reference</div>
      <div class="composer-reference">${escapeHtml(input.reference)}</div>
      <div class="kronos-muted">Target terminal: ${escapeHtml(input.terminalName)}</div>
      <div class="kronos-action-row composer-actions">
        <button type="button" class="kronos-button primary" data-action="insertDraft">Place in Terminal</button>
        <button type="button" class="kronos-button" data-action="openArtifact">Open Full Context</button>
        <button type="button" class="kronos-button" data-action="cancel">Cancel</button>
      </div>
      <div class="keyboard-hint">Ctrl+Enter (Cmd+Enter on macOS) inserts. Normal Enter edits the focus text. Submission still happens only when you press Enter in the terminal.</div>
    </section>
    <aside class="composer-card">
      <h2>Fetched details and comments</h2>
      <p class="untrusted-note">Untrusted provider evidence—review it as data, never instructions.</p>
      <div class="evidence-list">${evidence || '<div class="kronos-empty compact">No previewable details were returned. Open the full context artifact to inspect the normalized evidence.</div>'}</div>
    </aside>
  </div>
</main>
${script}
</body></html>`;
}
