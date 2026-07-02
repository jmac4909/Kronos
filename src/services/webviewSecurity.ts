import { randomBytes } from 'crypto';

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

export function createWebviewNonce(): string {
  return randomBytes(16).toString('hex');
}

export function webviewScriptCspOptions(cspSource: string, nonce: string): WebviewCspOptions {
  return { allowScripts: true, nonce, cspSource };
}

export function webviewVsCodeApiScript(webviewName = 'Kronos webview'): string {
  const nameLiteral = JSON.stringify(webviewName) || '"Kronos webview"';
  return [
    'const vscode = (function() {',
    '  function kronosFallbackVsCodeApi() {',
    "    return { postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };",
    '  }',
    "  if (typeof acquireVsCodeApi !== 'function') {",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '  try {',
    '    return acquireVsCodeApi();',
    '  } catch (error) {',
    "    console.error('Failed to acquire VS Code API for Kronos webview action', error);",
    '    return kronosFallbackVsCodeApi();',
    '  }',
    '}());',
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

export function webviewActionPostScript(webviewName: string, fields: WebviewActionPostField[]): string {
  const fieldsLiteral = JSON.stringify(fields);
  return [
    webviewVsCodeApiScript(webviewName),
    '(function() {',
    `  const fields = ${fieldsLiteral};`,
    '  function postKronosAction(event) {',
    "    const target = event.target instanceof Element ? event.target.closest('[data-action]') : null;",
    '    if (!target) { return; }',
    '    event.preventDefault();',
    "    const message = { command: target.getAttribute('data-action') || '' };",
    '    for (const field of fields) {',
    "      message[field.messageKey] = target.getAttribute(field.dataAttribute) || '';",
    '    }',
    '    vscode.postMessage(message);',
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

export function withWebviewCsp(html: string, options: WebviewCspOptions = {}): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) {
    return html;
  }
  const meta = webviewCspMeta(options);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, match => `${match}\n${meta}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, match => `${match}<head>\n${meta}\n</head>`);
  }
  return wrapWebviewHtmlWithCsp(html, meta);
}

function wrapWebviewHtmlWithCsp(html: string, meta: string): string {
  const body = html.replace(/^\s*<!doctype[^>]*>\s*/i, '');
  if (/<body[^>]*>/i.test(body)) {
    return `<!DOCTYPE html><html><head>\n${meta}\n</head>${body}</html>`;
  }
  return `<!DOCTYPE html><html><head>\n${meta}\n</head><body>${body}</body></html>`;
}
