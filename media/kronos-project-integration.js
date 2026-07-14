(function() {
  'use strict';

  var script = document.currentScript || document.getElementById('kronos-project-integration-script');
  var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
  var root = typeof globalThis === 'object' ? globalThis : window;
  var attempts = 0;

  function start(runtime) {
    var postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: 'Kronos Project Integration Setup' });
    runtime.markReady('Kronos Project Integration Setup');
    runtime.installDiagnostics('Kronos Project Integration Setup');

    function projects() {
      return Array.prototype.map.call(document.querySelectorAll('[data-project-card]'), function(card) {
        function value(field) {
          var input = card.querySelector('[data-field="' + field + '"]');
          return input && typeof input.value === 'string' ? input.value : '';
        }
        return {
          name: card.getAttribute('data-project-name') || '',
          gitlabProject: value('gitlabProject'),
          jenkinsUrl: value('jenkinsUrl'),
          sonarProjectKey: value('sonarProjectKey'),
          defaultBranch: value('defaultBranch')
        };
      });
    }

    function post(command) {
      var message = { command: command };
      if (command === 'save') { message.projects = projects(); }
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
      document.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          post('save');
        }
      });
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
    console.error('Kronos project integration runtime unavailable');
  }

  waitForRuntime();
}());
