export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

export function escapeClass(value: unknown): string {
  return String(value ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
}

export function safeHttpHref(url: string | undefined): string {
  if (!url) { return ''; }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return escapeAttr(parsed.toString());
  } catch {
    return '';
  }
}

export function kronosWebviewBaseCss(): string {
  return `
  :root {
    --k-bg: var(--vscode-editor-background);
    --k-fg: var(--vscode-foreground);
    --k-muted: var(--vscode-descriptionForeground);
    --k-border: var(--vscode-panel-border);
    --k-border-strong: color-mix(in srgb, var(--k-border) 78%, var(--k-fg));
    --k-surface: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
    --k-surface-soft: var(--vscode-textBlockQuote-background, var(--vscode-editorWidget-background, rgba(127,127,127,0.08)));
    --k-surface-raised: var(--vscode-editorWidget-background, var(--k-surface));
    --k-hover: var(--vscode-list-hoverBackground, rgba(127,127,127,0.12));
    --k-accent: var(--vscode-textLink-foreground);
    --k-accent-bg: color-mix(in srgb, var(--k-accent) 14%, transparent);
    --k-ok: #4caf50;
    --k-ok-bg: rgba(76,175,80,0.16);
    --k-warn: #ff9800;
    --k-warn-bg: rgba(255,152,0,0.16);
    --k-danger: #f44336;
    --k-danger-bg: rgba(244,67,54,0.16);
    --k-info: #2196f3;
    --k-info-bg: rgba(33,150,243,0.16);
    --k-radius: 8px;
    --k-radius-sm: 5px;
    --k-shadow: 0 8px 28px rgba(0,0,0,0.14);
  }
  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  :focus-visible {
    outline: 1px solid var(--vscode-focusBorder, var(--k-accent));
    outline-offset: 2px;
  }
  body {
    margin: 0;
    padding: 22px;
    color: var(--k-fg);
    background: var(--k-bg);
    font-family: var(--vscode-font-family);
    font-size: 13px;
    line-height: 1.5;
  }
  .kronos-shell {
    width: 100%;
    max-width: 1440px;
    margin: 0 auto;
  }
  .kronos-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    padding-bottom: 16px;
    margin-bottom: 18px;
    border-bottom: 1px solid var(--k-border);
  }
  .kronos-title {
    margin: 0;
    font-size: 21px;
    font-weight: 650;
    line-height: 1.2;
    letter-spacing: 0;
  }
  .kronos-subtitle {
    margin-top: 6px;
    color: var(--k-muted);
    font-size: 12px;
    line-height: 1.45;
  }
  .kronos-section,
  .section {
    margin: 20px 0;
  }
  .kronos-section-title {
    margin: 0 0 10px 0;
    color: var(--k-muted);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .section h2,
  .section h3 {
    margin: 0 0 10px;
    color: var(--k-muted);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .kronos-panel {
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius);
    background: var(--k-surface);
  }
  .kronos-panel.pad {
    padding: 12px;
  }
  .kronos-card {
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius);
    background: var(--k-surface);
    padding: 12px;
  }
  .kronos-panel:hover,
  .kronos-card:hover {
    border-color: var(--k-border-strong);
  }
  .kronos-soft {
    background: var(--k-surface-soft);
  }
  .kronos-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .kronos-stack {
    display: grid;
    gap: 12px;
  }
  .kronos-table-wrap,
  .table-wrap {
    overflow: auto;
    position: relative;
    border-radius: var(--k-radius);
    scrollbar-gutter: stable;
  }
  .kronos-stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin: 12px 0 18px;
  }
  .kronos-stat {
    min-height: 72px;
    padding: 12px;
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius);
    background: var(--k-surface-soft);
  }
  .summary-card {
    min-height: 72px;
    padding: 12px;
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius);
    background: var(--k-surface-soft);
  }
  .kronos-stat-value {
    font-size: 24px;
    line-height: 1.1;
    font-weight: 700;
  }
  .summary-card .num {
    font-size: 24px;
    line-height: 1.1;
    font-weight: 700;
  }
  .kronos-stat-label {
    margin-top: 4px;
    color: var(--k-muted);
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
  }
  .summary-card .lbl {
    margin-top: 4px;
    color: var(--k-muted);
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
  }
  .summary-card.good .num,
  .summary-card.pass .num,
  .summary-card.ok .num { color: var(--k-ok); }
  .summary-card.info .num { color: var(--k-info); }
  .summary-card.warn .num,
  .summary-card.warning .num,
  .summary-card.medium .num { color: var(--k-warn); }
  .summary-card.bad .num,
  .summary-card.fail .num,
  .summary-card.error .num,
  .summary-card.critical .num { color: var(--k-danger); }
  .kronos-detail {
    color: var(--k-muted);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .detail {
    white-space: pre-wrap;
    word-break: break-word;
  }
  .kronos-empty,
  div.empty {
    border: 1px dashed var(--k-border);
    border-radius: var(--k-radius);
    padding: 18px;
    color: var(--k-muted);
    background: var(--k-surface-soft);
  }
  .empty {
    color: var(--k-muted);
  }
  .kronos-empty.compact {
    padding: 10px 12px;
    font-size: 12px;
  }
  .kronos-script-required {
    margin: 0 0 14px;
    padding: 10px 12px;
    border: 1px solid rgba(255,152,0,0.42);
    border-left: 3px solid var(--k-warn);
    border-radius: var(--k-radius);
    color: var(--k-warn);
    background: rgba(255,152,0,0.12);
    font-size: 12px;
  }
  html[data-kronos-script-ready="true"] .kronos-script-required {
    display: none;
  }
  .kronos-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 12px;
  }
  .kronos-table th,
  .kronos-table td {
    padding: 10px 12px;
    text-align: left;
    vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, var(--k-border) 82%, transparent);
    word-break: break-word;
  }
  .kronos-table th {
    position: sticky;
    top: 0;
    z-index: 1;
    color: var(--k-muted);
    background: var(--k-surface-raised);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0;
    text-transform: uppercase;
  }
  .kronos-table tr:last-child td {
    border-bottom: none;
  }
  .kronos-table tr:hover td { background: var(--k-hover); }
  .kronos-pill,
  .pill {
    display: inline-flex;
    align-items: center;
    min-height: 20px;
    padding: 2px 8px;
    border: 1px solid var(--k-border);
    border-radius: 999px;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .kronos-pill.pass,
  .kronos-pill.good,
  .kronos-pill.ok,
  .kronos-pill.low,
  .pill.pass,
  .pill.good,
  .pill.ok,
  .pill.low {
    color: var(--k-ok);
    background: var(--k-ok-bg);
  }
  .kronos-pill.info,
  .pill.info {
    color: var(--k-info);
    background: var(--k-info-bg);
  }
  .kronos-pill.warn,
  .kronos-pill.warning,
  .kronos-pill.medium,
  .kronos-pill.neutral,
  .pill.warn,
  .pill.warning,
  .pill.medium,
  .pill.neutral,
  .pill.changed {
    color: var(--k-warn);
    background: var(--k-warn-bg);
  }
  .kronos-pill.fail,
  .kronos-pill.bad,
  .kronos-pill.error,
  .kronos-pill.critical,
  .kronos-pill.high,
  .kronos-pill.blocker,
  .pill.fail,
  .pill.bad,
  .pill.error,
  .pill.critical,
  .pill.high,
  .pill.blocker,
  .pill.removed {
    color: var(--k-danger);
    background: var(--k-danger-bg);
  }
  .pill.added {
    color: var(--k-ok);
    background: var(--k-ok-bg);
  }
  .pill.unchanged {
    color: var(--k-muted);
    background: rgba(128,128,128,0.16);
  }
  .kronos-button,
  button.kronos-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 28px;
    padding: 5px 10px;
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius-sm);
    color: var(--k-fg);
    background: transparent;
    font-family: var(--vscode-font-family);
    font-size: 11px;
    font-weight: 550;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
    cursor: pointer;
    text-decoration: none;
  }
  .kronos-button:disabled,
  button.kronos-button:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .kronos-button:hover,
  button.kronos-button:hover {
    background: var(--k-hover);
    border-color: var(--k-border-strong);
    text-decoration: none;
  }
  .kronos-button.primary,
  button.kronos-button.primary {
    border-color: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
  }
  .kronos-link {
    color: var(--k-accent);
    text-decoration: none;
  }
  .kronos-link:hover { text-decoration: underline; }
  .kronos-input {
    min-height: 30px;
    padding: 5px 9px;
    border: 1px solid var(--k-border);
    border-radius: var(--k-radius-sm);
    color: var(--k-fg);
    background: var(--vscode-input-background, var(--k-bg));
    font-family: var(--vscode-font-family);
    font-size: 12px;
    line-height: 1.3;
  }
  .kronos-input::placeholder {
    color: var(--vscode-input-placeholderForeground, var(--k-muted));
  }
  .kronos-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
    margin: 0 0 14px;
  }
  .kronos-action-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .kronos-muted {
    color: var(--k-muted);
  }
  .muted,
  .subtitle {
    color: var(--k-muted);
  }
  .subtitle {
    margin-bottom: 16px;
    line-height: 1.45;
  }
  .path {
    color: var(--k-muted);
    font-size: 12px;
    margin-bottom: 12px;
    word-break: break-all;
  }
  .message {
    padding: 9px 10px;
    margin: 6px 0;
    border: 1px solid var(--k-border);
    border-left: 3px solid var(--k-border);
    border-radius: var(--k-radius-sm);
    background: var(--k-surface-soft);
    font-size: 12px;
  }
  .message.pass { border-left-color: var(--k-ok); }
  .message.warn { border-left-color: var(--k-warn); }
  .message.fail { border-left-color: var(--k-danger); }
  .hash-detail {
    display: inline-block;
    margin-top: 3px;
    color: var(--k-muted);
    word-break: break-word;
  }
  code {
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--vscode-textCodeBlock-background);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: var(--k-surface-soft);
    border: 1px solid var(--k-border);
    padding: 12px;
    border-radius: var(--k-radius);
    font-size: 12px;
  }
  a {
    color: var(--k-accent);
    text-decoration: none;
  }
  a:hover { text-decoration: underline; }
  li { margin: 4px 0; }
  @media (max-width: 760px) {
    body { padding: 14px; }
    .kronos-header {
      display: block;
    }
    .kronos-toolbar {
      display: grid;
      align-items: stretch;
    }
    .kronos-grid {
      grid-template-columns: 1fr;
    }
    .kronos-table {
      min-width: 760px;
    }
    .kronos-button,
    button.kronos-button {
      min-height: 30px;
    }
  }`;
}
