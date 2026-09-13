(function() {
  'use strict';
  var script = document.currentScript || document.getElementById('kronos-context-basket-script');
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var root = typeof globalThis === 'object' ? globalThis : window;
  var attempts = 0;

  function start(runtime) {
    var api = runtime.vscodeApi();
    var postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: 'Kronos Context Basket' });
    runtime.markReady('Kronos Context Basket');
    runtime.installDiagnostics('Kronos Context Basket');
    document.addEventListener('click', function(event) {
      var target = event.target && typeof event.target.closest === 'function' ? event.target.closest('[data-action]') : null;
      if (!target) { return; }
      event.preventDefault();
      var command = target.getAttribute('data-action') || '';
      var message = { command: command };
      var entryId = target.getAttribute('data-entry-id') || '';
      if (entryId) { message.entryId = entryId; }
      var focus = document.getElementById('basket-focus');
      if (focus && typeof focus.value === 'string') { message.focus = focus.value; }
      api.postMessage(message);
    }, true);
    var focus = document.getElementById('basket-focus');
    if (focus) {
      focus.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          api.postMessage({ command: 'insert', focus: focus.value || '' });
        }
      });
      focus.focus();
    }
    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
    setTimeout(postReady, 0);
  }

  function wait() {
    if (root.KronosWebviewRuntime) { start(root.KronosWebviewRuntime); return; }
    attempts += 1;
    if (attempts < 20) { setTimeout(wait, 50); return; }
    console.error('Kronos context basket runtime unavailable');
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', wait, { once: true }); }
  else { wait(); }
}());
