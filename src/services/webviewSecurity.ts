import { randomBytes } from 'crypto';
import { escapeAttr } from './webviewHtml';

interface WebviewCspOptions {
  nonce?: string;
  allowScripts?: boolean;
  cspSource?: string;
  imgSrc?: string[];
}

interface WebviewActionPostField {
  messageKey: string;
  dataAttribute: string;
}

interface WebviewActionScriptTagOptions {
  readyCommand?: string | undefined;
  scriptUri: string;
}

export const WEBVIEW_READY_COMMAND = '__kronosWebviewReady';
export const WEBVIEW_RUNTIME_SCRIPT = 'kronos-webview-runtime.js';
export const WEBVIEW_ACTION_PANEL_SCRIPT = 'kronos-action-panel.js';
export const WEBVIEW_JIRA_BOARD_SCRIPT = 'kronos-jira-board.js';

export function createWebviewNonce(): string {
  return randomBytes(16).toString('hex');
}

export function webviewScriptCspOptions(cspSource: string, nonce: string): WebviewCspOptions {
  return { allowScripts: true, nonce, cspSource };
}

export function webviewVsCodeApiScript(webviewName = 'Kronos webview'): string {
  const nameLiteral = JSON.stringify(webviewName) || '"Kronos webview"';
  return [
    'function kronosVsCodeApi() {',
    "  const cacheKey = Symbol.for('kronos.vscodeApi');",
    '  const root = typeof globalThis === \'object\' ? globalThis : window;',
    "  const cached = root[cacheKey];",
    "  if (cached && typeof cached.postMessage === 'function' && !cached.__kronosFallbackVsCodeApi) { return cached; }",
    '  function kronosFallbackVsCodeApi() {',
    "    return { __kronosFallbackVsCodeApi: true, postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };",
    '  }',
    "  if (typeof acquireVsCodeApi !== 'function') {",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '  try {',
    '    root[cacheKey] = acquireVsCodeApi();',
    '    return root[cacheKey];',
    '  } catch (error) {',
    "    console.error('Failed to acquire VS Code API for Kronos webview action', error);",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '}',
    '(function() {',
    `  const webviewName = ${nameLiteral};`,
    '  function kronosErrorText(value) {',
    '    if (value && typeof value === \'object\' && \'message\' in value) { return String(value.message || value); }',
    '    return String(value || \'unknown error\');',
    '  }',
    '  try {',
    "    document.documentElement.setAttribute('data-kronos-script-ready', 'true');",
    "    document.documentElement.setAttribute('data-kronos-webview', webviewName);",
    '  } catch (error) {',
    "    console.warn('Kronos webview could not mark script readiness', error);",
    '  }',
    "  console.info('Kronos webview script ready', webviewName, navigator.userAgent);",
    "  window.addEventListener('error', function(event) {",
    "    console.error('Kronos webview script error', webviewName, event.message, event.filename, event.lineno, event.colno);",
    '  });',
    "  window.addEventListener('unhandledrejection', function(event) {",
    "    console.error('Kronos webview unhandled rejection', webviewName, kronosErrorText(event.reason));",
    '  });',
    '}());',
  ].join('\n');
}

export function webviewActionScriptTag(
  nonce: string,
  webviewName: string,
  fields: WebviewActionPostField[],
  options: WebviewActionScriptTagOptions,
): string {
  const readyAttr = options.readyCommand
    ? ` data-kronos-ready-command="${escapeAttr(options.readyCommand)}"`
    : '';
  return [
    webviewRuntimeScriptTag(nonce, webviewRuntimeScriptUri(options.scriptUri)),
    `<script nonce="${escapeAttr(nonce)}"`,
    'id="kronos-action-panel-script"',
    `src="${escapeAttr(options.scriptUri)}"`,
    'data-kronos-script-kind="action-panel"',
    `data-kronos-webview-name="${escapeAttr(webviewName)}"`,
    `data-kronos-action-fields="${escapeAttr(JSON.stringify(fields))}"${readyAttr}></script>`,
  ].join('\n');
}

export function webviewRuntimeScriptTag(nonce: string, runtimeScriptUri: string): string {
  return [
    `<script nonce="${escapeAttr(nonce)}"`,
    'id="kronos-webview-runtime-script"',
    `src="${escapeAttr(runtimeScriptUri)}"`,
    'data-kronos-script-kind="runtime"></script>',
  ].join('\n');
}

export function webviewRuntimeScriptUri(scriptUri: string): string {
  const scriptFilePattern = /\/[^/?#]+(?=([?#]|$))/;
  if (scriptFilePattern.test(scriptUri)) {
    return scriptUri.replace(scriptFilePattern, `/${WEBVIEW_RUNTIME_SCRIPT}`);
  }
  return WEBVIEW_RUNTIME_SCRIPT;
}

function webviewCspMeta(options: WebviewCspOptions = {}): string {
  const cspSource = options.cspSource?.trim();
  const scriptSources = [
    cspSource,
    options.nonce ? `'nonce-${options.nonce}'` : undefined,
  ].filter((source): source is string => Boolean(source));
  const scriptSrc = options.allowScripts && scriptSources.length > 0
    ? scriptSources.join(' ')
    : "'none'";
  const styleSrc = [
    cspSource,
    "'unsafe-inline'",
  ].filter((source): source is string => Boolean(source)).join(' ');
  const imgSrc = options.imgSrc?.length ? ` img-src ${options.imgSrc.join(' ')};` : '';
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${styleSrc}; style-src-elem ${styleSrc}; style-src-attr 'unsafe-inline'; script-src ${scriptSrc}; script-src-elem ${scriptSrc}; script-src-attr 'none'; base-uri 'none'; form-action 'none';${imgSrc}">`;
}

function webviewScriptDiagnosticBanner(): string {
  return '<div class="kronos-script-required" data-kronos-script-required role="status">Kronos webview JavaScript has not started. Check VS Code Webview Developer Tools and the Extension Host DevTools console for CSP or sandbox errors.</div>';
}

export function withWebviewCsp(html: string, options: WebviewCspOptions = {}): string {
  const injectDiagnostic = options.allowScripts === true;
  const withDiagnostic = (value: string): string => injectDiagnostic
    ? injectWebviewScriptDiagnostic(value)
    : value;
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    return withDiagnostic(html);
  }
  const meta = webviewCspMeta(options);
  if (/<head[^>]*>/i.test(html)) {
    return withDiagnostic(html.replace(/<head[^>]*>/i, match => `${match}\n${meta}`));
  }
  if (/<html[^>]*>/i.test(html)) {
    return withDiagnostic(html.replace(/<html[^>]*>/i, match => `${match}<head>\n${meta}\n</head>`));
  }
  return withDiagnostic(wrapWebviewHtmlWithCsp(html, meta));
}

function injectWebviewScriptDiagnostic(html: string): string {
  if (/data-kronos-script-required/i.test(html)) {
    return html;
  }
  const banner = webviewScriptDiagnosticBanner();
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, match => `${match}\n${banner}`);
  }
  return `${banner}${html}`;
}

function wrapWebviewHtmlWithCsp(html: string, meta: string): string {
  const body = html.replace(/^\s*<!doctype[^>]*>\s*/i, '');
  if (/<body[^>]*>/i.test(body)) {
    return `<!DOCTYPE html><html><head>\n${meta}\n</head>${body}</html>`;
  }
  return `<!DOCTYPE html><html><head>\n${meta}\n</head><body>${body}</body></html>`;
}
