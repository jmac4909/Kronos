const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JIRA_WORK_BOARD_ACTIONS,
  buildJiraWorkBoardHtml,
  isCompletedJiraStatus,
} = require('../out/services/jiraWorkBoardView.js');
const boardRuntime = require('../media/kronos-jira-work-board.js');

function ticket(status, overrides = {}) {
  return {
    summary: 'Terminal-first story',
    type: 'Story',
    priority: 'High',
    jira_status: status,
    source: 'jira',
    projects: ['Kronos'],
    labels: ['terminal-first'],
    mr: null,
    build: null,
    ...overrides,
  };
}

function state(tickets) {
  return {
    schemaVersion: 1,
    refreshedAt: '2026-07-14T02:00:00.000Z',
    projects: { Kronos: { config: { jira_project_key: 'KRONOS' } } },
    tickets,
  };
}

test('board builder exposes useful Jira filters and only ticket-scoped terminal-first actions', () => {
  const html = buildJiraWorkBoardHtml({
    state: state({
      'KRONOS-1': ticket('In Progress', {
        summary: '<script>must escape</script>',
        mr: { iid: 4, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/4' },
      }),
      'KRONOS-2': ticket('Shipped', { jira_status_category: 'done' }),
      'KRONOS-3': ticket('Done', { jira_status_category: 'indeterminate' }),
      'not a jira key': ticket('Open'),
    }),
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });

  for (const id of ['jira-board-search', 'jira-board-status', 'jira-board-project', 'jira-board-label']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="jira-board-hide-done" type="checkbox" checked/);
  assert.match(html, /data-completed-column="true" hidden/);
  assert.match(html, /data-ticket="KRONOS-3"[^>]+data-completed="false"/);
  assert.doesNotMatch(html, /<script>must escape<\/script>/);
  assert.match(html, /&lt;script&gt;must escape&lt;\/script&gt;/);
  assert.doesNotMatch(html, /not a jira key/i);
  assert.match(html, /kronos-webview-runtime\.js/);
  assert.match(html, /kronos-jira-work-board\.js/);

  for (const action of JIRA_WORK_BOARD_ACTIONS) {
    assert.match(html, new RegExp(`data-action="${action}"`));
  }
  for (const forbidden of ['addToQueue', 'removeFromQueue', 'dispatch', 'runCenter', 'linkProject', 'triggerBuild']) {
    assert.doesNotMatch(html, new RegExp(forbidden, 'i'));
  }
});

test('completed status detection supports common names and explicit team statuses', () => {
  assert.equal(isCompletedJiraStatus('Done'), true);
  assert.equal(isCompletedJiraStatus('QA Done'), false);
  assert.equal(isCompletedJiraStatus('In Progress'), false);
  assert.equal(isCompletedJiraStatus('Shipped to Customer', new Set(['shipped to customer'])), true);
});

test('board runtime posts only normalized command and Jira ticket key', () => {
  const messages = [];
  const vscodeApi = { postMessage(message) { messages.push(message); } };
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'insertJiraContext', ' kronos-42 '), true);
  assert.deepEqual(messages, [{ command: 'insertJiraContext', ticket: 'KRONOS-42' }]);
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'removeFromQueue', 'KRONOS-42'), false);
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'openTicketWorkspace', 'not-a-ticket'), false);
  assert.equal(messages.length, 1);
  assert.deepEqual(boardRuntime.allowedActions, JIRA_WORK_BOARD_ACTIONS);
});

test('board runtime filters cards and reveals a specifically selected completed status', () => {
  const harness = createDomHarness('complete');
  const messages = [];
  assert.equal(boardRuntime.initialize(harness.document, { postMessage(message) { messages.push(message); } }), true);
  assert.equal(harness.openCard.hidden, false);
  assert.equal(harness.doneCard.hidden, true);
  assert.equal(harness.summary.textContent, '1 of 2 shown · 1 completed hidden');

  harness.status.value = 'done';
  harness.status.dispatch('change');
  assert.equal(harness.hideDone.checked, false);
  assert.equal(harness.openCard.hidden, true);
  assert.equal(harness.doneCard.hidden, false);
  assert.equal(harness.doneColumn.hidden, false);

  harness.board.dispatch('click', {
    target: actionTarget('startClaudeForTicket', 'KRONOS-2'),
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(messages.at(-1), { command: 'startClaudeForTicket', ticket: 'KRONOS-2' });

  harness.board.dispatch('click', {
    target: cardTarget(harness.doneCard),
    preventDefault() {},
  });
  assert.deepEqual(messages.at(-1), { command: 'openTicketWorkspace', ticket: 'KRONOS-2' });
});

test('board filters survive a webview HTML rerender through VS Code webview state', () => {
  const first = createDomHarness('complete');
  let stateValue;
  const vscodeApi = {
    getState() { return stateValue; },
    setState(value) { stateValue = JSON.parse(JSON.stringify(value)); },
  };
  first.search.value = 'KRONOS-2';
  first.project.value = 'kronos';
  first.hideDone.checked = false;
  assert.equal(boardRuntime.persistFilters(first.document, vscodeApi), true);

  const rerendered = createDomHarness('complete');
  assert.equal(boardRuntime.restoreFilters(rerendered.document, vscodeApi), true);
  assert.equal(rerendered.search.value, 'kronos-2');
  assert.equal(rerendered.project.value, 'kronos');
  assert.equal(rerendered.hideDone.checked, false);
});

test('board boot waits for DOMContentLoaded before attaching handlers', () => {
  const harness = createDomHarness('loading');
  const readyMessages = [];
  harness.document.currentScript = element({
    'data-kronos-webview-name': 'Kronos Jira Work Board',
    'data-kronos-ready-command': '__kronosWebviewReady',
  });
  const root = {
    document: harness.document,
    console: { error() {} },
    setTimeout(callback) { callback(); return 1; },
    KronosWebviewRuntime: {
      markReady() {},
      installDiagnostics() {},
      createReadyPoster() { return () => readyMessages.push('ready'); },
      vscodeApi() { return { postMessage() {} }; },
    },
  };
  boardRuntime.boot(root);
  assert.equal(harness.board.listenerCount('click'), 0);
  harness.document.dispatch('DOMContentLoaded', {});
  assert.equal(harness.board.listenerCount('click'), 1);
  assert.deepEqual(readyMessages, ['ready']);
});

function createDomHarness(readyState) {
  const openCard = card({
    'data-ticket': 'KRONOS-1',
    'data-status': 'in progress',
    'data-projects': JSON.stringify(['kronos']),
    'data-labels': JSON.stringify(['terminal-first']),
    'data-search': 'kronos-1 open terminal first',
    'data-completed': 'false',
  });
  const doneCard = card({
    'data-ticket': 'KRONOS-2',
    'data-status': 'done',
    'data-projects': JSON.stringify(['kronos']),
    'data-labels': JSON.stringify(['terminal-first']),
    'data-search': 'kronos-2 done terminal first',
    'data-completed': 'true',
  });
  const openColumn = column([openCard]);
  const doneColumn = column([doneCard]);
  const board = element();
  const search = control('');
  const status = control('');
  const project = control('');
  const label = control('');
  const hideDone = control('');
  hideDone.checked = true;
  const reset = element();
  const summary = element();
  const noMatches = element();
  noMatches.hidden = true;
  const ids = new Map([
    ['jira-work-board', board],
    ['jira-board-search', search],
    ['jira-board-status', status],
    ['jira-board-project', project],
    ['jira-board-label', label],
    ['jira-board-hide-done', hideDone],
    ['jira-board-reset', reset],
    ['jira-board-filter-summary', summary],
    ['jira-board-no-matches', noMatches],
  ]);
  const document = eventTarget({
    readyState,
    documentElement: element(),
    currentScript: null,
    getElementById(id) { return ids.get(id) || null; },
    querySelectorAll(selector) {
      if (selector === '[data-ticket-card]') { return [openCard, doneCard]; }
      if (selector === '.jira-board-column') { return [openColumn, doneColumn]; }
      return [];
    },
    querySelector() { return null; },
  });
  return { board, document, doneCard, doneColumn, hideDone, label, openCard, openColumn, project, search, status, summary };
}

function column(cards) {
  const count = element();
  const value = element();
  value.querySelectorAll = selector => selector === '[data-ticket-card]' ? cards : [];
  value.querySelector = selector => selector === '[data-column-count]' ? count : null;
  value.count = count;
  return value;
}

function card(attributes) {
  const value = element(attributes);
  value.hidden = false;
  return value;
}

function control(value) {
  const result = element();
  result.value = value;
  result.checked = false;
  return result;
}

function actionTarget(action, ticket) {
  const target = element({ 'data-action': action, 'data-ticket': ticket });
  target.closest = selector => selector === '[data-action]' ? target : null;
  return target;
}

function cardTarget(value) {
  return { closest(selector) { return selector === '[data-ticket-card]' ? value : null; } };
}

function element(attributes = {}) {
  const values = new Map(Object.entries(attributes));
  return eventTarget({
    hidden: false,
    textContent: '',
    getAttribute(name) { return values.get(name) || null; },
    setAttribute(name, value) { values.set(name, String(value)); },
  });
}

function eventTarget(target) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(name, listener) {
      const values = listeners.get(name) || [];
      values.push(listener);
      listeners.set(name, values);
    },
    dispatch(name, event) {
      for (const listener of listeners.get(name) || []) { listener.call(this, event); }
    },
    listenerCount(name) { return (listeners.get(name) || []).length; },
  });
}
