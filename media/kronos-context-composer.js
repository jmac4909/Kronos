(function() {
  'use strict';

  var script = document.currentScript || document.getElementById('kronos-context-composer-script');
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var root = typeof globalThis === 'object' ? globalThis : window;
  var attempts = 0;

  function start(runtime) {
    var postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: 'Kronos Context Composer' });
    runtime.markReady('Kronos Context Composer');
    runtime.installDiagnostics('Kronos Context Composer');

    function post(command) {
      var message = { command: command };
      if (command === 'insertDraft') {
        var focus = document.getElementById('context-focus');
        message.focus = focus && typeof focus.value === 'string' ? focus.value : '';
      }
      runtime.vscodeApi().postMessage(message);
    }

    function attach() {
      document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
      document.addEventListener('click', function(event) {
        var target = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-action]')
          : null;
        if (!target) { return; }
        event.preventDefault();
        post(target.getAttribute('data-action') || '');
      }, true);
      var focus = document.getElementById('context-focus');
      if (focus) {
        focus.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            post('insertDraft');
          }
        });
        focus.focus();
      }
      setTimeout(postReady, 0);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', attach, { once: true });
    } else {
      attach();
    }
  }

  function waitForRuntime() {
    if (root.KronosWebviewRuntime) { start(root.KronosWebviewRuntime); return; }
    attempts += 1;
    if (attempts < 20) { setTimeout(waitForRuntime, 50); return; }
    console.error('Kronos context composer runtime unavailable');
  }

  waitForRuntime();
}());
