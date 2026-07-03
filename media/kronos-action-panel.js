(function() {
  'use strict';

  var script = document.currentScript;
  var webviewName = script && script.getAttribute('data-kronos-webview-name') || 'Kronos action panel';
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var fields = [];

  function kronosFallbackVsCodeApi() {
    return { postMessage: function(message) { console.warn('VS Code API unavailable for Kronos webview action', message); } };
  }

  function kronosVsCodeApi() {
    var cacheKey = Symbol.for('kronos.vscodeApi');
    var root = typeof globalThis === 'object' ? globalThis : window;
    var cached = root[cacheKey];
    if (cached && typeof cached.postMessage === 'function') { return cached; }
    if (typeof acquireVsCodeApi !== 'function') {
      root[cacheKey] = kronosFallbackVsCodeApi();
      return root[cacheKey];
    }
    try {
      root[cacheKey] = acquireVsCodeApi();
      return root[cacheKey];
    } catch (error) {
      console.error('Failed to acquire VS Code API for Kronos webview action', error);
      root[cacheKey] = kronosFallbackVsCodeApi();
      return root[cacheKey];
    }
  }

  function kronosErrorText(value) {
    if (value && typeof value === 'object' && 'message' in value) { return String(value.message || value); }
    return String(value || 'unknown error');
  }

  function parseFields() {
    var raw = script && script.getAttribute('data-kronos-action-fields') || '[]';
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        fields = parsed.filter(function(field) {
          return field && typeof field.messageKey === 'string' && typeof field.dataAttribute === 'string';
        });
      }
    } catch (error) {
      console.warn('Kronos webview could not parse action fields', error);
    }
  }

  function markReady() {
    try {
      document.documentElement.setAttribute('data-kronos-script-ready', 'true');
      document.documentElement.setAttribute('data-kronos-webview', webviewName);
    } catch (error) {
      console.warn('Kronos webview could not mark script readiness', error);
    }
    console.info('Kronos webview script ready', webviewName, navigator.userAgent);
  }

  function postReady() {
    if (!readyCommand) { return; }
    try {
      kronosVsCodeApi().postMessage({
        command: readyCommand,
        webviewName: webviewName,
        userAgent: navigator.userAgent,
        readyState: document.readyState
      });
    } catch (error) {
      console.warn('Kronos webview could not post script readiness', error);
    }
  }

  function closestKronosActionTarget(target) {
    if (!target) { return null; }
    if (typeof target.closest === 'function') {
      return target.closest('[data-action]');
    }
    var current = target.parentElement && typeof target.parentElement === 'object' ? target.parentElement : null;
    while (current) {
      if (typeof current.getAttribute === 'function' && current.getAttribute('data-action')) { return current; }
      if (typeof current.closest === 'function') {
        return current.closest('[data-action]');
      }
      current = current.parentElement && typeof current.parentElement === 'object' ? current.parentElement : null;
    }
    return null;
  }

  function postKronosAction(event) {
    var target = closestKronosActionTarget(event && event.target);
    if (!target) { return; }
    event.preventDefault();
    var message = { command: target.getAttribute('data-action') || '' };
    fields.forEach(function(field) {
      message[field.messageKey] = target.getAttribute(field.dataAttribute) || '';
    });
    kronosVsCodeApi().postMessage(message);
  }

  function attachKronosActionHandler() {
    document.addEventListener('click', postKronosAction, true);
    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
    setTimeout(postReady, 0);
  }

  parseFields();
  markReady();
  window.addEventListener('error', function(event) {
    console.error('Kronos webview script error', webviewName, event.message, event.filename, event.lineno, event.colno);
  });
  window.addEventListener('unhandledrejection', function(event) {
    console.error('Kronos webview unhandled rejection', webviewName, kronosErrorText(event.reason));
  });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachKronosActionHandler, { once: true });
  } else {
    attachKronosActionHandler();
  }
}());
