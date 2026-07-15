const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
    jira_project_key: 'KRONOS',
    source: 'jira',
    labels: ['terminal-first'],
    mr: null,
    build: null,
    ...overrides,
  };
}

function state(tickets) {
  return {
    schemaVersion: 2,
    refreshedAt: '2026-07-14T02:00:00.000Z',
    projects: { Kronos: { config: { repo_name: 'Kronos' } } },
    tickets,
  };
}

test('board builder exposes useful Jira filters and only bounded terminal-first actions', () => {
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

  for (const id of [
    'jira-board-search',
    'jira-board-status',
    'jira-board-jira-project',
    'jira-board-local-project',
    'jira-board-label',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /id="jira-board-hide-done" type="checkbox" data-default-checked="true" checked/);
  assert.match(html, /data-completed-column="true" hidden/);
  assert.match(html, /data-ticket="KRONOS-3"[^>]+data-completed="false"/);
  assert.doesNotMatch(html, /<script>must escape<\/script>/);
  assert.match(html, /&lt;script&gt;must escape&lt;\/script&gt;/);
  assert.doesNotMatch(html, /not a jira key/i);
  assert.match(html, /kronos-webview-runtime\.js/);
  assert.match(html, /kronos-jira-work-board\.js/);
  assert.match(html, /jira-ticket-heading-actions[^]*data-action="chooseTicketProject"[^]*\+ Add Project/);

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

test('board settings map custom completed statuses and the initial visibility default', () => {
  const html = buildJiraWorkBoardHtml({
    state: state({
      'KRONOS-1': ticket('Shipped to Customer', { jira_status_category: 'indeterminate' }),
    }),
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
    doneStatusNames: ['Shipped to Customer'],
    hideCompletedByDefault: false,
  });
  assert.match(html, /data-completed="true"/);
  assert.match(html, /data-default-checked="false"/);
  assert.doesNotMatch(html, /data-completed-column="true" hidden/);
  assert.match(html, />1 of 1 shown</);
  assert.doesNotMatch(html, /completed hidden/);
});

test('board renders distinct current, empty, loading, partial, stale, and error data states', () => {
  const build = overrides => buildJiraWorkBoardHtml({
    state: state({ 'KRONOS-1': ticket('In Progress') }),
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
    staleAfterMs: 10 * 60_000,
    nowMs: Date.parse('2026-07-14T02:05:00.000Z'),
    ...overrides,
  });

  assert.match(build({}), /data-work-data-state="ready"/);
  assert.match(build({ state: state({}) }), /data-work-data-state="empty"[^]*No Jira tickets returned/);
  assert.match(build({ refreshStatus: {
    phase: 'loading',
    retainedFromPrevious: 0,
    warningCount: 0,
  } }), /data-work-data-state="loading"[^]*Showing 1 last-known ticket/);
  assert.match(build({ refreshStatus: {
    phase: 'partial',
    retainedFromPrevious: 2,
    warningCount: 1,
  } }), /data-work-data-state="partial"[^]*2 prior tickets were retained/);
  assert.match(build({ nowMs: Date.parse('2026-07-14T02:20:01.000Z') }), /data-work-data-state="stale"/);
  const errorHtml = build({ refreshStatus: {
    phase: 'error',
    detail: 'Jira request failed safely.',
    retainedFromPrevious: 0,
    warningCount: 0,
  } });
  assert.match(errorHtml, /data-work-data-state="error"[^]*Jira request failed safely/);
  assert.match(errorHtml, /data-action="refreshTickets"/);
  assert.match(errorHtml, /data-action="openDoctor"/);
});

test('board lists registered local project paths and current Git branches', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-board-project-'));
  try {
    fs.mkdirSync(path.join(projectRoot, '.git'));
    fs.writeFileSync(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/feature/board-projects\n');
    const fixtureState = state({ 'KRONOS-1': ticket('In Progress', { linked_local_project: 'Kronos' }) });
    fixtureState.projects.Kronos.path = projectRoot;
    const html = buildJiraWorkBoardHtml({
      state: fixtureState,
      nonce: 'abcdef1234567890',
      scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
    });
    assert.match(html, /Local Projects/);
    assert.match(html, /feature\/board-projects/);
    assert.match(html, new RegExp(projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, /data-action="chooseTicketProject"/);
    assert.match(html, /Jira: KRONOS/);
    assert.match(html, /Project: Kronos/);
    assert.match(html, /Change \/ Unlink Project: Kronos/);
    assert.match(html, /data-ticket-card[^>]+tabindex="0"[^>]+aria-label="Open KRONOS-1/);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test('board runtime posts only normalized command and Jira ticket key', () => {
  const messages = [];
  const vscodeApi = { postMessage(message) { messages.push(message); } };
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'insertJiraContext', ' kronos-42 '), true);
  assert.deepEqual(messages, [{ command: 'insertJiraContext', ticket: 'KRONOS-42' }]);
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'removeFromQueue', 'KRONOS-42'), false);
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'openTicketWorkspace', 'not-a-ticket'), false);
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'refreshTickets', ''), true);
  assert.deepEqual(messages.at(-1), { command: 'refreshTickets' });
  assert.equal(boardRuntime.postTicketAction(vscodeApi, 'openDoctor', ''), true);
  assert.deepEqual(messages.at(-1), { command: 'openDoctor' });
  assert.equal(messages.length, 3);
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
    target: actionTarget('chooseTicketProject', 'KRONOS-2'),
    preventDefault() {},
    stopPropagation() {},
  });
  assert.deepEqual(messages.at(-1), { command: 'chooseTicketProject', ticket: 'KRONOS-2' });

  harness.board.dispatch('click', {
    target: cardTarget(harness.doneCard),
    preventDefault() {},
  });
  assert.deepEqual(messages.at(-1), { command: 'openTicketWorkspace', ticket: 'KRONOS-2' });

  harness.dataStatus.dispatch('click', {
    target: actionTarget('refreshTickets', ''),
    preventDefault() {},
  });
  assert.deepEqual(messages.at(-1), { command: 'refreshTickets' });
});

test('board filters survive a webview HTML rerender through VS Code webview state', () => {
  const first = createDomHarness('complete');
  let stateValue;
  const vscodeApi = {
    getState() { return stateValue; },
    setState(value) { stateValue = JSON.parse(JSON.stringify(value)); },
  };
  first.search.value = 'KRONOS-2';
  first.jiraProject.value = 'kronos';
  first.localProject.value = 'api';
  first.hideDone.checked = false;
  assert.equal(boardRuntime.persistFilters(first.document, vscodeApi), true);

  const rerendered = createDomHarness('complete');
  assert.equal(boardRuntime.restoreFilters(rerendered.document, vscodeApi), true);
  assert.equal(rerendered.search.value, 'kronos-2');
  assert.equal(rerendered.jiraProject.value, 'kronos');
  assert.equal(rerendered.localProject.value, 'api');
  assert.equal(rerendered.hideDone.checked, false);
});

test('board filters Jira namespaces independently from explicit local projects', () => {
  const harness = createDomHarness('complete');
  harness.hideDone.checked = false;
  harness.jiraProject.value = 'kronos';
  harness.localProject.value = 'api';
  assert.deepEqual(boardRuntime.applyFilters(harness.document), {
    visibleCount: 1,
    totalCount: 2,
    completedHidden: 0,
  });
  assert.equal(harness.openCard.hidden, false);
  assert.equal(harness.doneCard.hidden, true);

  harness.localProject.value = 'web';
  assert.equal(boardRuntime.applyFilters(harness.document).visibleCount, 1);
  assert.equal(harness.openCard.hidden, true);
  assert.equal(harness.doneCard.hidden, false);

  harness.jiraProject.value = 'other';
  assert.equal(boardRuntime.applyFilters(harness.document).visibleCount, 0);
});

test('board reset returns to the configured completed-work default', () => {
  const harness = createDomHarness('complete');
  harness.hideDone.setAttribute('data-default-checked', 'false');
  assert.equal(boardRuntime.initialize(harness.document, { postMessage() {} }), true);
  harness.hideDone.checked = true;
  harness.reset.dispatch('click', {});
  assert.equal(harness.hideDone.checked, false);
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
    'data-jira-project': 'kronos',
    'data-local-project': 'api',
    'data-labels': JSON.stringify(['terminal-first']),
    'data-search': 'kronos-1 open terminal first',
    'data-completed': 'false',
  });
  const doneCard = card({
    'data-ticket': 'KRONOS-2',
    'data-status': 'done',
    'data-jira-project': 'kronos',
    'data-local-project': 'web',
    'data-labels': JSON.stringify(['terminal-first']),
    'data-search': 'kronos-2 done terminal first',
    'data-completed': 'true',
  });
  const openColumn = column([openCard]);
  const doneColumn = column([doneCard]);
  const board = element();
  const search = control('');
  const status = control('');
  const jiraProject = control('');
  const localProject = control('');
  const label = control('');
  const hideDone = control('');
  hideDone.checked = true;
  const reset = element();
  const dataStatus = element();
  const summary = element();
  const noMatches = element();
  noMatches.hidden = true;
  const ids = new Map([
    ['jira-work-board', board],
    ['jira-board-data-status', dataStatus],
    ['jira-board-search', search],
    ['jira-board-status', status],
    ['jira-board-jira-project', jiraProject],
    ['jira-board-local-project', localProject],
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
  return {
    board,
    dataStatus,
    document,
    doneCard,
    doneColumn,
    hideDone,
    jiraProject,
    label,
    localProject,
    openCard,
    openColumn,
    reset,
    search,
    status,
    summary,
  };
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
