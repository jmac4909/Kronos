(function() {
  'use strict';

  var root = typeof globalThis === 'object' ? globalThis : window;
  var runtimeKey = 'KronosWebviewRuntime';
  var diagnosticWebviewName = 'Kronos webview runtime';
  var diagnosticsInstalled = false;

  if (root[runtimeKey] && root[runtimeKey].version === 1) { return; }

  function kronosFallbackVsCodeApi() {
    return { __kronosFallbackVsCodeApi: true, postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };
  }

  function vscodeApi() {
    var cacheKey = Symbol.for('kronos.vscodeApi');
    var cached = root[cacheKey];
    if (cached && typeof cached.postMessage === 'function' && !cached.__kronosFallbackVsCodeApi) { return cached; }
    if (typeof acquireVsCodeApi !== 'function') {
      return kronosFallbackVsCodeApi();
    }
    try {
      root[cacheKey] = acquireVsCodeApi();
      return root[cacheKey];
    } catch (error) {
      console.error('Failed to acquire VS Code API for Kronos webview action', error);
      return kronosFallbackVsCodeApi();
    }
  }

  function errorText(value) {
    if (value && typeof value === 'object' && 'message' in value) { return String(value.message || value); }
    return String(value || 'unknown error');
  }

  function markReady(webviewName) {
    try {
      document.documentElement.setAttribute('data-kronos-script-ready', 'true');
      document.documentElement.setAttribute('data-kronos-webview', webviewName);
    } catch (error) {
      console.warn('Kronos webview could not mark script readiness', error);
    }
    console.info('Kronos webview script ready', webviewName, navigator.userAgent);
  }

  function installDiagnostics(webviewName) {
    if (webviewName) { diagnosticWebviewName = webviewName; }
    if (diagnosticsInstalled) { return; }
    diagnosticsInstalled = true;
    window.addEventListener('error', function(event) {
      console.error('Kronos webview script error', diagnosticWebviewName, event.message, event.filename, event.lineno, event.colno);
    });
    window.addEventListener('unhandledrejection', function(event) {
      console.error('Kronos webview unhandled rejection', diagnosticWebviewName, errorText(event.reason));
    });
  }

  function createReadyPoster(input) {
    var readyCommand = input && input.readyCommand || '';
    var webviewName = input && input.webviewName || 'Kronos webview';
    var readyPosted = false;
    var readyAttempts = 0;
    var maxReadyAttempts = 20;

    return function postReady() {
      if (readyPosted || !readyCommand) { return; }
      try {
        var api = vscodeApi();
        if (api.__kronosFallbackVsCodeApi) {
          readyAttempts += 1;
          if (readyAttempts < maxReadyAttempts) { setTimeout(postReady, 50); }
          else { console.warn('Kronos webview could not acquire VS Code API after ready retries', webviewName); }
          return;
        }
        api.postMessage({
          command: readyCommand,
          webviewName: webviewName,
          userAgent: navigator.userAgent,
          readyState: document.readyState
        });
        readyPosted = true;
      } catch (error) {
        console.warn('Kronos webview could not post script readiness', error);
      }
    };
  }

  root[runtimeKey] = {
    version: 1,
    createReadyPoster: createReadyPoster,
    installDiagnostics: installDiagnostics,
    markReady: markReady,
    vscodeApi: vscodeApi
  };
  installDiagnostics(diagnosticWebviewName);
}());
