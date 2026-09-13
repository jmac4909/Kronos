(function() {
  'use strict';

  function findKronosActionScript() {
    var current = document.currentScript;
    if (current && typeof current.getAttribute === 'function') { return current; }
    if (typeof document.getElementById === 'function') {
      var byId = document.getElementById('kronos-action-panel-script');
      if (byId && typeof byId.getAttribute === 'function') { return byId; }
    }
    if (typeof document.querySelector === 'function') { return document.querySelector('script[data-kronos-script-kind="action-panel"]'); }
    return null;
  }

  var script = findKronosActionScript();
  var webviewName = script && script.getAttribute('data-kronos-webview-name') || 'Kronos action panel';
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var root = typeof globalThis === 'object' ? globalThis : window;
  var runtime = null;
  var runtimeAttempts = 0;
  var maxRuntimeAttempts = 20;
  var postReady = function() {};
  var fields = [];

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

  function claimKronosActionHandler() {
    var actionHandlerKey = '__kronosActionHandlerAttached';
    if (document[actionHandlerKey]) {
      try {
        document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
      } catch (error) {
        console.warn('Kronos webview could not mark action readiness', error);
      }
      return false;
    }
    document[actionHandlerKey] = true;
    try {
      document.documentElement.setAttribute('data-kronos-action-handler-attached', 'true');
    } catch (error) {
      console.warn('Kronos webview could not mark action handler attachment', error);
    }
    return true;
  }

  function closestKronosActionTarget(target) {
    if (!target) { return null; }
    if (typeof target.closest === 'function') {
      return target.closest('[data-action]');
    }
    var current = target.parentElement && typeof target.parentElement === 'object' ? target.parentElement : null;
    while (current) {
      if (typeof current.getAttribute === 'function' && current.getAttribute('data-action')) { return current; }
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
    runtime.vscodeApi().postMessage(message);
  }

  function attachKronosActionHandler() {
    document.addEventListener('click', postKronosAction, true);
    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
    setTimeout(postReady, 0);
  }

  parseFields();

  function startKronosActionPanel(runtimeApi) {
    runtime = runtimeApi;
    postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: webviewName });
    runtime.markReady(webviewName);
    if (!claimKronosActionHandler()) {
      setTimeout(postReady, 0);
      return;
    }
    runtime.installDiagnostics(webviewName);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attachKronosActionHandler, { once: true });
    } else {
      attachKronosActionHandler();
    }
  }

  function waitForKronosActionRuntime() {
    var runtimeApi = root.KronosWebviewRuntime;
    if (runtimeApi) {
      startKronosActionPanel(runtimeApi);
      return;
    }
    runtimeAttempts += 1;
    if (runtimeAttempts < maxRuntimeAttempts) {
      setTimeout(waitForKronosActionRuntime, 50);
      return;
    }
    console.error('Kronos webview runtime unavailable', webviewName);
  }

  waitForKronosActionRuntime();
}());
