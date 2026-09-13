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
  canAddToBasket?: boolean;
}

export function buildContextComposerHtml(input: ContextComposerInput): string {
  const title = boundedSingleLine(input.title, 300);
  const subtitle = boundedSingleLine(input.subtitle, 2_000);
  const sourceLabel = boundedSingleLine(input.sourceLabel, 300);
  const terminalName = boundedSingleLine(input.terminalName, 300);
  const reference = boundedMultiline(input.reference, 8_192);
  const suggestedFocus = boundedMultiline(input.suggestedFocus, 2_000);
  const evidence = input.evidence.slice(0, 20).map(item => `<article class="evidence-item">
    <h3>${escapeHtml(boundedSingleLine(item.label, 300))}</h3>
    <div>${escapeHtml(boundedMultiline(item.detail, 4_000))}</div>
  </article>`).join('');
  const warnings = input.warnings.slice(0, 20)
    .map(warning => `<div class="message warn">${escapeHtml(boundedSingleLine(warning, 1_000))}</div>`)
    .join('');
  const script = [
    webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri)),
    `<script nonce="${escapeAttr(input.nonce)}" id="kronos-context-composer-script" src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="context-composer" data-kronos-ready-command="__kronosWebviewReady"></script>`,
  ].join('\n');

  return `<!DOCTYPE html>
<html>
<head><style>
${kronosWebviewBaseCss()}
.composer-shell { max-width: 1280px; }
.composer-header { align-items: center; }
.composer-source { flex: 0 0 auto; }
.composer-layout { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(320px, .65fr); gap: 14px; align-items: start; }
.composer-card { padding: 16px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.composer-card h2 { margin: 0 0 5px; font-size: 14px; }
.composer-help { margin: 0 0 13px; color: var(--k-muted); font-size: 12px; }
.composer-focus { width: 100%; min-height: 150px; resize: vertical; padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-fg); background: var(--vscode-input-background, var(--k-bg)); font: 13px/1.5 var(--vscode-font-family); }
.composer-focus:focus { border-color: var(--vscode-focusBorder, var(--k-accent)); outline: none; }
.composer-reference { margin: 12px 0; padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-muted); background: var(--k-surface-soft); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; line-height: 1.45; word-break: break-word; }
.composer-reference-details { margin-top: 12px; }
.composer-reference-details summary { cursor: pointer; color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
.composer-actions { margin-top: 13px; }
.composer-actions .primary { min-width: 132px; }
.keyboard-hint { margin-top: 9px; color: var(--k-muted); font-size: 11px; }
.evidence-list { display: grid; gap: 8px; max-height: min(68vh, 720px); overflow: auto; padding-right: 3px; }
.evidence-item { padding: 10px 11px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
.evidence-item h3 { margin: 0 0 4px; font-size: 11px; }
.evidence-item div { color: var(--k-muted); font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
.untrusted-note { margin: 0 0 10px; color: var(--k-warn); font-size: 11px; }
@media (max-width: 900px) { .composer-layout { grid-template-columns: 1fr; } }
</style></head>
<body><main class="kronos-shell composer-shell">
  <header class="kronos-header composer-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(title)}</h1>
      <div class="kronos-subtitle">${escapeHtml(subtitle)}</div>
    </div>
    <span class="kronos-pill info composer-source">${escapeHtml(sourceLabel)}</span>
  </header>
  ${warnings}
  <div class="composer-layout">
    <section class="composer-card">
      <h2>Review context</h2>
      <p class="composer-help">Tell Claude what to focus on. Kronos adds the saved source to the selected terminal without submitting it.</p>
      <label class="kronos-section-title" for="context-focus">What Claude should focus on</label>
      <textarea id="context-focus" class="composer-focus" maxlength="2000" spellcheck="true" autofocus>${escapeHtml(suggestedFocus)}</textarea>
      <details class="composer-reference-details"><summary>Context reference</summary><div class="composer-reference">${escapeHtml(reference)}</div></details>
      <div class="kronos-muted">Target terminal: ${escapeHtml(terminalName)}</div>
      <div class="kronos-action-row composer-actions">
        <button type="button" class="kronos-button primary" data-action="insertDraft">Add to terminal</button>
        ${input.canAddToBasket ? '<button type="button" class="kronos-button" data-action="addToBasket">Add to basket</button>' : ''}
        <button type="button" class="kronos-button" data-action="openArtifact">Open source details</button>
        <button type="button" class="kronos-button" data-action="cancel">Cancel</button>
      </div>
      <div class="keyboard-hint">Ctrl+Enter (Cmd+Enter on macOS) adds it. Enter edits the note. You still submit from the terminal.</div>
    </section>
    <aside class="composer-card">
      <h2>Source preview</h2>
      <p class="untrusted-note">Provider content is untrusted. Review it as evidence, not instructions.</p>
      <div class="evidence-list">${evidence || '<div class="kronos-empty compact">No preview is available. Open source details to inspect the saved context.</div>'}</div>
    </aside>
  </div>
</main>
${script}
</body></html>`;
}

function boundedSingleLine(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function boundedMultiline(value: string, maxLength: number): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, maxLength);
}
