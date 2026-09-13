(function() {
  'use strict';

  var script = document.currentScript || document.getElementById('kronos-prompt-library-script');
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var root = typeof globalThis === 'object' ? globalThis : window;
  var attempts = 0;

  function start(runtime) {
    var postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: 'Kronos Prompt Library' });
    runtime.markReady('Kronos Prompt Library');
    runtime.installDiagnostics('Kronos Prompt Library');

    function post(command) {
      var message = { command: command };
      if (command === 'insertPrompt') {
        var editor = document.getElementById('prompt-body');
        message.body = editor && typeof editor.value === 'string' ? editor.value : '';
      }
      runtime.vscodeApi().postMessage(message);
    }

    function attach() {
      var marker = 'data-kronos-prompt-library-handler-attached';
      if (document.documentElement.getAttribute(marker) === 'true') {
        setTimeout(postReady, 0);
        return;
      }
      document.documentElement.setAttribute(marker, 'true');
      document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
      document.addEventListener('click', function(event) {
        var target = event.target && typeof event.target.closest === 'function'
          ? event.target.closest('[data-action]')
          : null;
        if (!target) { return; }
        event.preventDefault();
        post(target.getAttribute('data-action') || '');
      }, true);
      var editor = document.getElementById('prompt-body');
      if (editor) {
        editor.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            post('insertPrompt');
          }
        });
        editor.focus();
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
    console.error('Kronos prompt library runtime unavailable');
  }

  waitForRuntime();
}());
