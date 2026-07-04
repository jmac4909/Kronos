import { randomBytes } from 'crypto';
import { escapeAttr } from './webviewHtml';

export interface WebviewCspOptions {
  nonce?: string;
  allowScripts?: boolean;
  cspSource?: string;
  imgSrc?: string[];
}

export interface WebviewActionPostField {
  messageKey: string;
  dataAttribute: string;
}

export interface WebviewActionPostOptions {
  readyCommand?: string | undefined;
}

export interface WebviewActionScriptTagOptions extends WebviewActionPostOptions {
  scriptUri?: string | undefined;
}

export const WEBVIEW_READY_COMMAND = '__kronosWebviewReady';
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

export function webviewReadyPostScript(webviewName = 'Kronos webview', command = WEBVIEW_READY_COMMAND): string {
  const nameLiteral = JSON.stringify(webviewName) || '"Kronos webview"';
  const commandLiteral = JSON.stringify(command) || JSON.stringify(WEBVIEW_READY_COMMAND);
  return [
    '(function() {',
    `  const webviewName = ${nameLiteral};`,
    `  const readyCommand = ${commandLiteral};`,
    '  let posted = false;',
    '  function postReady() {',
    '    if (posted) { return; }',
    '    posted = true;',
    '    try {',
    "      kronosVsCodeApi().postMessage({ command: readyCommand, webviewName: webviewName, userAgent: navigator.userAgent, readyState: document.readyState });",
    '    } catch (error) {',
    "      console.warn('Kronos webview could not post script readiness', error);",
    '    }',
    '  }',
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', function() { setTimeout(postReady, 0); }, { once: true });",
    '  } else {',
    '    setTimeout(postReady, 0);',
    '  }',
    '}());',
  ].join('\n');
}

export function webviewActionPostScript(webviewName: string, fields: WebviewActionPostField[], options: WebviewActionPostOptions = {}): string {
  const fieldsLiteral = JSON.stringify(fields);
  return [
    webviewVsCodeApiScript(webviewName),
    options.readyCommand ? webviewReadyPostScript(webviewName, options.readyCommand) : '',
    '(function() {',
    "  const actionHandlerKey = '__kronosActionHandlerAttached';",
    '  if (document[actionHandlerKey]) {',
    '    try { document.documentElement.setAttribute(\'data-kronos-actions-ready\', \'true\'); } catch (error) {}',
    '    return;',
    '  }',
    '  document[actionHandlerKey] = true;',
    "  try { document.documentElement.setAttribute('data-kronos-action-handler-attached', 'true'); } catch (error) {}",
    `  const fields = ${fieldsLiteral};`,
    '  function closestKronosActionTarget(target) {',
    '    if (!target) { return null; }',
    "    if (typeof target.closest === 'function') {",
    "      return target.closest('[data-action]');",
    '    }',
    "    let current = target.parentElement && typeof target.parentElement === 'object' ? target.parentElement : null;",
    '    while (current) {',
    "      if (typeof current.getAttribute === 'function' && current.getAttribute('data-action')) { return current; }",
    "      if (typeof current.closest === 'function') {",
    "        return current.closest('[data-action]');",
    '      }',
    "      current = current.parentElement && typeof current.parentElement === 'object' ? current.parentElement : null;",
    '    }',
    '    return null;',
    '  }',
    '  function postKronosAction(event) {',
    '    const target = closestKronosActionTarget(event && event.target);',
    '    if (!target) { return; }',
    '    event.preventDefault();',
    "    const message = { command: target.getAttribute('data-action') || '' };",
    '    for (const field of fields) {',
    "      message[field.messageKey] = target.getAttribute(field.dataAttribute) || '';",
    '    }',
    '    kronosVsCodeApi().postMessage(message);',
    '  }',
    '  function attachKronosActionHandler() {',
    "    document.addEventListener('click', postKronosAction, true);",
    "    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');",
    '  }',
    "  if (document.readyState === 'loading') {",
    "    document.addEventListener('DOMContentLoaded', attachKronosActionHandler, { once: true });",
    '  } else {',
    '    attachKronosActionHandler();',
    '  }',
    '}());',
  ].filter(Boolean).join('\n');
}

export function webviewActionScriptTag(
  nonce: string,
  webviewName: string,
  fields: WebviewActionPostField[],
  options: WebviewActionScriptTagOptions = {},
): string {
  if (!options.scriptUri) {
    return `<script nonce="${escapeAttr(nonce)}">
${webviewActionPostScript(webviewName, fields, options)}
</script>`;
  }
  const readyAttr = options.readyCommand
    ? ` data-kronos-ready-command="${escapeAttr(options.readyCommand)}"`
    : '';
  return [
    `<script nonce="${escapeAttr(nonce)}"`,
    'id="kronos-action-panel-script"',
    `src="${escapeAttr(options.scriptUri)}"`,
    'data-kronos-script-kind="action-panel"',
    `data-kronos-webview-name="${escapeAttr(webviewName)}"`,
    `data-kronos-action-fields="${escapeAttr(JSON.stringify(fields))}"${readyAttr}></script>`,
  ].join('\n');
}

export function webviewCspMeta(options: WebviewCspOptions = {}): string {
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

export function webviewScriptDiagnosticBanner(): string {
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
