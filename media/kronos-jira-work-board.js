(function(root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
    return;
  }
  root.KronosJiraWorkBoard = api;
  api.boot(root);
}(typeof globalThis === 'object' ? globalThis : window, function() {
  'use strict';

  var ALLOWED_ACTIONS = Object.freeze({
    openTicketWorkspace: true,
    startClaudeForTicket: true,
    manageActiveTerminal: true,
    chooseTicketProject: true,
    insertJiraContext: true,
    insertGitLabContext: true,
    insertCiContext: true,
  });

  function normalizeTicketKey(value) {
    var key = typeof value === 'string' ? value.trim().toUpperCase() : '';
    return /^[A-Z][A-Z0-9_]*-[0-9]{1,12}$/.test(key) ? key : '';
  }

  function normalizeToken(value, maxLength) {
    return typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength || 2000).toLocaleLowerCase()
      : '';
  }

  function parseTokenList(value) {
    if (typeof value !== 'string' || value.length > 100000) { return []; }
    try {
      var parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) { return []; }
      return parsed.slice(0, 500).map(function(item) { return normalizeToken(item, 200); }).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function readFilters(document) {
    var search = document.getElementById('jira-board-search');
    var status = document.getElementById('jira-board-status');
    var project = document.getElementById('jira-board-project');
    var label = document.getElementById('jira-board-label');
    var hideDone = document.getElementById('jira-board-hide-done');
    return {
      query: normalizeToken(search && search.value || '', 500),
      status: normalizeToken(status && status.value || '', 200),
      project: normalizeToken(project && project.value || '', 200),
      label: normalizeToken(label && label.value || '', 200),
      hideDone: Boolean(hideDone && hideDone.checked),
    };
  }

  function restoreFilters(document, vscodeApi) {
    if (!vscodeApi || typeof vscodeApi.getState !== 'function') { return false; }
    try {
      var state = vscodeApi.getState();
      var saved = state && state.jiraWorkBoardFilters;
      if (!saved || typeof saved !== 'object') { return false; }
      setControlValue(document, 'jira-board-search', normalizeToken(saved.query || '', 500));
      setControlValue(document, 'jira-board-status', normalizeToken(saved.status || '', 200));
      setControlValue(document, 'jira-board-project', normalizeToken(saved.project || '', 200));
      setControlValue(document, 'jira-board-label', normalizeToken(saved.label || '', 200));
      var hideDone = document.getElementById('jira-board-hide-done');
      if (hideDone && typeof saved.hideDone === 'boolean') { hideDone.checked = saved.hideDone; }
      return true;
    } catch (error) {
      return false;
    }
  }

  function persistFilters(document, vscodeApi) {
    if (!vscodeApi || typeof vscodeApi.setState !== 'function') { return false; }
    try {
      var current = typeof vscodeApi.getState === 'function' ? vscodeApi.getState() : null;
      var next = current && typeof current === 'object' ? Object.assign({}, current) : {};
      next.jiraWorkBoardFilters = readFilters(document);
      vscodeApi.setState(next);
      return true;
    } catch (error) {
      return false;
    }
  }

  function cardMatchesFilters(card, filters, includeDone) {
    if (!card || typeof card.getAttribute !== 'function') { return false; }
    var completed = card.getAttribute('data-completed') === 'true';
    if (!includeDone && filters.hideDone && completed) { return false; }
    if (filters.status && normalizeToken(card.getAttribute('data-status') || '', 200) !== filters.status) { return false; }
    if (filters.project && parseTokenList(card.getAttribute('data-projects') || '[]').indexOf(filters.project) < 0) { return false; }
    if (filters.label && parseTokenList(card.getAttribute('data-labels') || '[]').indexOf(filters.label) < 0) { return false; }
    if (filters.query && normalizeToken(card.getAttribute('data-search') || '', 100000).indexOf(filters.query) < 0) { return false; }
    return true;
  }

  function applyFilters(document) {
    var filters = readFilters(document);
    var cards = toArray(document.querySelectorAll('[data-ticket-card]'));
    var columns = toArray(document.querySelectorAll('.jira-board-column'));
    var visibleCount = 0;
    var completedHidden = 0;

    cards.forEach(function(card) {
      var matchesWithoutDone = cardMatchesFilters(card, filters, true);
      var visible = matchesWithoutDone && cardMatchesFilters(card, filters, false);
      card.hidden = !visible;
      if (visible) { visibleCount += 1; }
      if (matchesWithoutDone && filters.hideDone && card.getAttribute('data-completed') === 'true') {
        completedHidden += 1;
      }
    });

    columns.forEach(function(column) {
      var visibleInColumn = toArray(column.querySelectorAll('[data-ticket-card]')).filter(function(card) {
        return !card.hidden;
      }).length;
      column.hidden = visibleInColumn === 0;
      var count = column.querySelector('[data-column-count]');
      if (count) { count.textContent = String(visibleInColumn); }
    });

    var summary = document.getElementById('jira-board-filter-summary');
    if (summary) {
      summary.textContent = visibleCount + ' of ' + cards.length + ' shown'
        + (completedHidden > 0 ? ' · ' + completedHidden + ' completed hidden' : '');
    }
    var noMatches = document.getElementById('jira-board-no-matches');
    if (noMatches) { noMatches.hidden = cards.length === 0 || visibleCount > 0; }
    return { visibleCount: visibleCount, totalCount: cards.length, completedHidden: completedHidden };
  }

  function postTicketAction(vscodeApi, command, ticketValue) {
    var ticket = normalizeTicketKey(ticketValue);
    if (!Object.prototype.hasOwnProperty.call(ALLOWED_ACTIONS, command)
      || !ticket || !vscodeApi || typeof vscodeApi.postMessage !== 'function') {
      return false;
    }
    vscodeApi.postMessage({ command: command, ticket: ticket });
    return true;
  }

  function closest(target, selector) {
    if (!target) { return null; }
    if (typeof target.closest === 'function') { return target.closest(selector); }
    var current = target;
    while (current) {
      if (typeof current.matches === 'function' && current.matches(selector)) { return current; }
      current = current.parentElement && typeof current.parentElement === 'object' ? current.parentElement : null;
    }
    return null;
  }

  function initialize(document, vscodeApi) {
    if (!document || !document.documentElement) { return false; }
    if (document.__kronosJiraWorkBoardAttached) {
      document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
      return false;
    }
    var board = document.getElementById('jira-work-board');
    if (!board) { return false; }
    restoreFilters(document, vscodeApi);
    document.__kronosJiraWorkBoardAttached = true;
    document.documentElement.setAttribute('data-kronos-jira-work-board-attached', 'true');

    board.addEventListener('click', function(event) {
      var action = closest(event && event.target, '[data-action]');
      if (action) {
        if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
        if (event && typeof event.stopPropagation === 'function') { event.stopPropagation(); }
        postTicketAction(
          vscodeApi,
          action.getAttribute('data-action') || '',
          action.getAttribute('data-ticket') || '',
        );
        return;
      }
      var card = closest(event && event.target, '[data-ticket-card]');
      if (card) {
        if (event && typeof event.preventDefault === 'function') { event.preventDefault(); }
        postTicketAction(vscodeApi, 'openTicketWorkspace', card.getAttribute('data-ticket') || '');
      }
    });

    board.addEventListener('keydown', function(event) {
      if (!event || (event.key !== 'Enter' && event.key !== ' ')) { return; }
      var card = closest(event.target, '[data-ticket-card]');
      if (!card || event.target !== card) { return; }
      if (typeof event.preventDefault === 'function') { event.preventDefault(); }
      postTicketAction(vscodeApi, 'openTicketWorkspace', card.getAttribute('data-ticket') || '');
    });

    ['jira-board-search', 'jira-board-status', 'jira-board-project', 'jira-board-label', 'jira-board-hide-done'].forEach(function(id) {
      var control = document.getElementById(id);
      if (!control) { return; }
      control.addEventListener(id === 'jira-board-search' ? 'input' : 'change', function() {
        if (id === 'jira-board-status') { revealSelectedCompletedStatus(document); }
        persistFilters(document, vscodeApi);
        applyFilters(document);
      });
    });

    var reset = document.getElementById('jira-board-reset');
    if (reset) {
      reset.addEventListener('click', function() {
        setControlValue(document, 'jira-board-search', '');
        setControlValue(document, 'jira-board-status', '');
        setControlValue(document, 'jira-board-project', '');
        setControlValue(document, 'jira-board-label', '');
        var hideDone = document.getElementById('jira-board-hide-done');
        if (hideDone) { hideDone.checked = hideDone.getAttribute('data-default-checked') !== 'false'; }
        persistFilters(document, vscodeApi);
        applyFilters(document);
      });
    }

    applyFilters(document);
    persistFilters(document, vscodeApi);
    document.documentElement.setAttribute('data-kronos-actions-ready', 'true');
    return true;
  }

  function revealSelectedCompletedStatus(document) {
    var status = document.getElementById('jira-board-status');
    var selected = normalizeToken(status && status.value || '', 200);
    if (!selected) { return; }
    var cards = toArray(document.querySelectorAll('[data-ticket-card]'));
    var selectedIsCompleted = cards.some(function(card) {
      return normalizeToken(card.getAttribute('data-status') || '', 200) === selected
        && card.getAttribute('data-completed') === 'true';
    });
    if (!selectedIsCompleted) { return; }
    var hideDone = document.getElementById('jira-board-hide-done');
    if (hideDone) { hideDone.checked = false; }
  }

  function setControlValue(document, id, value) {
    var control = document.getElementById(id);
    if (control) { control.value = value; }
  }

  function findScript(document) {
    var current = document.currentScript;
    if (current && typeof current.getAttribute === 'function') { return current; }
    var byId = document.getElementById('kronos-jira-work-board-script');
    if (byId && typeof byId.getAttribute === 'function') { return byId; }
    return typeof document.querySelector === 'function'
      ? document.querySelector('script[data-kronos-script-kind="jira-work-board"]')
      : null;
  }

  function boot(rootObject) {
    var document = rootObject && rootObject.document;
    if (!document) { return; }
    var script = findScript(document);
    var webviewName = script && script.getAttribute('data-kronos-webview-name') || 'Kronos Jira Work Board';
    var readyCommand = script && script.getAttribute('data-kronos-ready-command') || '';
    var attempts = 0;

    function waitForRuntime() {
      var runtime = rootObject.KronosWebviewRuntime;
      if (!runtime) {
        attempts += 1;
        if (attempts < 20) {
          rootObject.setTimeout(waitForRuntime, 50);
        } else if (rootObject.console && typeof rootObject.console.error === 'function') {
          rootObject.console.error('Kronos webview runtime unavailable', webviewName);
        }
        return;
      }
      runtime.markReady(webviewName);
      runtime.installDiagnostics(webviewName);
      var postReady = runtime.createReadyPoster({ readyCommand: readyCommand, webviewName: webviewName });
      var attach = function() {
        initialize(document, runtime.vscodeApi());
        rootObject.setTimeout(postReady, 0);
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach, { once: true });
      } else {
        attach();
      }
    }
    waitForRuntime();
  }

  function toArray(value) {
    return Array.prototype.slice.call(value || []);
  }

  return Object.freeze({
    allowedActions: Object.freeze(Object.keys(ALLOWED_ACTIONS)),
    applyFilters: applyFilters,
    boot: boot,
    cardMatchesFilters: cardMatchesFilters,
    initialize: initialize,
    normalizeTicketKey: normalizeTicketKey,
    postTicketAction: postTicketAction,
    persistFilters: persistFilters,
    readFilters: readFilters,
    restoreFilters: restoreFilters,
  });
}));
