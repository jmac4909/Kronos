const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const WEBVIEW_READY_COMMAND = '__kronosWebviewReady';

function mediaSource(file) {
  return fs.readFileSync(path.join(ROOT, 'media', file), 'utf8');
}

const runtimeScript = mediaSource('kronos-webview-runtime.js');
const actionPanelScript = mediaSource('kronos-action-panel.js');
const jiraBoardScript = mediaSource('kronos-jira-board.js');

function htmlAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function createWebviewDom(body) {
  const messages = [];
  const warnings = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message || String(error)));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${body}</body></html>`, {
    pretendToBeVisual: true,
    runScripts: 'outside-only',
    url: 'https://kronos.test/',
    virtualConsole,
  });
  dom.window.acquireVsCodeApi = () => ({
    postMessage: message => messages.push(JSON.parse(JSON.stringify(message))),
  });
  dom.window.console = {
    info() {},
    warn(...args) { warnings.push(args.map(String).join(' ')); },
    error(...args) { errors.push(args.map(String).join(' ')); },
  };
  return { dom, messages, warnings, errors };
}

function runScript(dom, source, name) {
  dom.window.eval(`${source}\n//# sourceURL=${name}`);
}

async function flushWebview(dom) {
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
}

async function loadRuntimeAndScript(env, source, name) {
  runScript(env.dom, runtimeScript, 'kronos-webview-runtime.js');
  runScript(env.dom, source, name);
  env.dom.window.document.dispatchEvent(new env.dom.window.Event('DOMContentLoaded', { bubbles: true }));
  await flushWebview(env.dom);
}

function click(window, element) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

function input(window, element, value) {
  element.value = value;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function actionMessages(messages) {
  return messages.filter(message => message.command !== WEBVIEW_READY_COMMAND);
}

function buttonByText(document, text) {
  const button = [...document.querySelectorAll('button')].find(item => item.textContent === text);
  assert.ok(button, `expected button ${text}`);
  return button;
}

test('action panel posts normalized payloads from nested action clicks once', async () => {
  const fields = [
    { messageKey: 'ticket', dataAttribute: 'data-ticket' },
    { messageKey: 'runId', dataAttribute: 'data-run-id' },
    { messageKey: 'itemId', dataAttribute: 'data-item-id' },
  ];
  const env = createWebviewDom(`
    <button id="run-center" data-action="runCenter" data-ticket="KRONOS-FB-1" data-run-id="feedback-run-needs-human" data-item-id="queue-1">
      <span id="run-center-label">Run Center</span>
    </button>
    <script
      id="kronos-action-panel-script"
      data-kronos-script-kind="action-panel"
      data-kronos-webview-name="Kronos DOM Action Panel"
      data-kronos-ready-command="${WEBVIEW_READY_COMMAND}"
      data-kronos-action-fields="${htmlAttr(JSON.stringify(fields))}"></script>
  `);

  await loadRuntimeAndScript(env, actionPanelScript, 'kronos-action-panel.js');

  const { document } = env.dom.window;
  assert.equal(document.documentElement.getAttribute('data-kronos-script-ready'), 'true');
  assert.equal(document.documentElement.getAttribute('data-kronos-action-handler-attached'), 'true');
  assert.equal(document.documentElement.getAttribute('data-kronos-actions-ready'), 'true');
  assert.ok(env.messages.some(message => message.command === WEBVIEW_READY_COMMAND && message.webviewName === 'Kronos DOM Action Panel'));

  click(env.dom.window, document.getElementById('run-center-label'));
  assert.deepEqual(actionMessages(env.messages).at(-1), {
    command: 'runCenter',
    ticket: 'KRONOS-FB-1',
    runId: 'feedback-run-needs-human',
    itemId: 'queue-1',
  });

  const beforeDuplicateLoadActionCount = actionMessages(env.messages).length;
  runScript(env.dom, actionPanelScript, 'kronos-action-panel.js');
  await flushWebview(env.dom);
  click(env.dom.window, document.getElementById('run-center-label'));
  assert.equal(actionMessages(env.messages).length, beforeDuplicateLoadActionCount + 1);
  assert.deepEqual(actionMessages(env.messages).at(-1), {
    command: 'runCenter',
    ticket: 'KRONOS-FB-1',
    runId: 'feedback-run-needs-human',
    itemId: 'queue-1',
  });
  assert.deepEqual(env.errors, []);
});

test('jira board filters cards, opens ticket modal, renders comments, and posts actions', async () => {
  const ticketData = {
    'KRONOS-FB-1': {
      summary: 'Review-ready fixture ticket',
      type: 'Story',
      priority: 'High',
      status: 'In Review',
      description: 'Acceptance criteria are ready for human review.',
      projects: ['sandbox-project'],
      labels: ['kronos-feedback', 'safe-fixture'],
      attachments: [{ filename: 'evidence.md', size: 2048 }],
      mr: { iid: 41, status: 'pending_review' },
      build: { number: 142, status: 'SUCCESS' },
      evidenceCount: 3,
      hasJiraUrl: true,
      hasMrUrl: true,
      isQueued: true,
    },
    'KRONOS-FB-3': {
      summary: 'Unlinked backlog ticket',
      type: 'Task',
      priority: 'Low',
      status: 'To Do',
      description: 'Needs a project link before work can start.',
      projects: [],
      labels: [],
      attachments: [],
      mr: { status: 'opened' },
      build: null,
      evidenceCount: 0,
      hasJiraUrl: false,
      hasMrUrl: false,
      isQueued: false,
    },
  };
  const env = createWebviewDom(`
    <input id="board-filter" />
    <span id="board-filter-summary"></span>
    <main class="board">
      <section class="column" id="queued-column">
        <span data-count>0</span>
        <div data-empty></div>
        <article class="card" tabindex="0" data-ticket="KRONOS-FB-1" data-search="review-ready fixture ticket triage sandbox">
          <button id="remove-fb1" data-action="removeFromQueue" data-ticket="KRONOS-FB-1">Remove</button>
          <span class="card-title">Review-ready fixture ticket</span>
        </article>
      </section>
      <section class="column" id="todo-column">
        <span data-count>0</span>
        <div data-empty></div>
        <article class="card" tabindex="0" data-ticket="KRONOS-FB-3" data-search="unlinked backlog setup">
          <span class="card-title">Unlinked backlog ticket</span>
        </article>
      </section>
    </main>
    <div id="modal-overlay">
      <button id="modal-close">Close</button>
      <h1 id="modal-key"></h1>
      <h2 id="modal-summary"></h2>
      <p id="modal-meta"></p>
      <div id="modal-desc"></div>
      <div id="modal-projects"></div>
      <div id="modal-labels"></div>
      <div id="modal-evidence"></div>
      <div id="modal-mr"></div>
      <div id="modal-build"></div>
      <div id="modal-attachments"></div>
      <div id="modal-actions"></div>
      <div id="modal-comments"></div>
    </div>
    <textarea id="kronos-jira-ticket-data">${JSON.stringify(ticketData)}</textarea>
    <script
      id="kronos-jira-board-script"
      data-kronos-script-kind="jira-board"
      data-kronos-webview-name="Kronos DOM Jira Board"
      data-kronos-ready-command="${WEBVIEW_READY_COMMAND}"></script>
  `);

  await loadRuntimeAndScript(env, jiraBoardScript, 'kronos-jira-board.js');

  const { document } = env.dom.window;
  assert.equal(document.documentElement.getAttribute('data-kronos-jira-board-attached'), 'true');
  assert.equal(document.documentElement.getAttribute('data-kronos-actions-ready'), 'true');
  assert.equal(document.getElementById('board-filter-summary').textContent, '2 total');
  assert.equal(document.querySelector('#queued-column [data-count]').textContent, '1');
  assert.equal(document.querySelector('#todo-column [data-count]').textContent, '1');

  input(env.dom.window, document.getElementById('board-filter'), 'triage');
  assert.equal(document.getElementById('board-filter-summary').textContent, '1 of 2 visible');
  assert.equal(document.querySelector('[data-ticket="KRONOS-FB-1"]').hidden, false);
  assert.equal(document.querySelector('[data-ticket="KRONOS-FB-3"]').hidden, true);
  assert.equal(document.querySelector('#queued-column [data-count]').textContent, '1');
  assert.equal(document.querySelector('#todo-column [data-count]').textContent, '0');
  assert.equal(document.querySelector('#todo-column [data-empty]').textContent, 'No matching tickets.');
  assert.equal(document.getElementById('todo-column').classList.contains('filtered-empty'), true);

  click(env.dom.window, document.getElementById('remove-fb1'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'removeFromQueue', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-1"] .card-title'));
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), true);
  assert.equal(document.getElementById('modal-key').textContent, 'KRONOS-FB-1');
  assert.equal(document.getElementById('modal-summary').textContent, 'Review-ready fixture ticket');
  assert.equal(document.getElementById('modal-meta').textContent, 'Story - High - In Review');
  assert.equal(document.getElementById('modal-projects').textContent, 'sandbox-project');
  assert.equal(document.getElementById('modal-labels').textContent, 'kronos-feedback, safe-fixture');
  assert.equal(document.getElementById('modal-evidence').textContent, '3 items');
  assert.match(document.getElementById('modal-mr').textContent, /MR !41 - pending review/);
  assert.equal(document.getElementById('modal-build').textContent, 'Build #142 - SUCCESS');
  assert.equal(document.getElementById('modal-attachments').textContent, 'evidence.md (2KB)');
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Manage This Terminal'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Insert [KRONOS-FB-1]'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Insert [MR-41]'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Insert [CI-KRONOS-FB-1]'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Verify Local'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Verify Remote'));
  assert.ok(env.messages.some(message => message.command === 'getComments' && message.ticket === 'KRONOS-FB-1'));

  env.dom.window.dispatchEvent(new env.dom.window.MessageEvent('message', {
    data: {
      command: 'comments',
      ticket: 'KRONOS-FB-1',
      data: [{ author: 'Reviewer', created: '2026-07-06', body: 'Ready for manual pass.' }],
    },
  }));
  assert.match(document.getElementById('modal-comments').textContent, /Reviewer/);
  assert.match(document.getElementById('modal-comments').textContent, /Ready for manual pass\./);

  click(env.dom.window, buttonByText(document, 'Manage This Terminal'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'manageActiveTerminal', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-1"] .card-title'));
  click(env.dom.window, buttonByText(document, 'Insert [MR-41]'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'insertGitLabContext', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-1"] .card-title'));
  click(env.dom.window, buttonByText(document, 'Insert [CI-KRONOS-FB-1]'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'insertCiContext', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-1"] .card-title'));

  click(env.dom.window, buttonByText(document, 'Insert [KRONOS-FB-1]'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'insertJiraContext', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-1"] .card-title'));

  click(env.dom.window, buttonByText(document, 'Handoff'));
  assert.deepEqual(actionMessages(env.messages).at(-1), { command: 'evidenceHandoff', ticket: 'KRONOS-FB-1' });
  assert.equal(document.getElementById('modal-overlay').classList.contains('show'), false);

  input(env.dom.window, document.getElementById('board-filter'), '');
  click(env.dom.window, document.querySelector('[data-ticket="KRONOS-FB-3"] .card-title'));
  assert.equal(document.getElementById('modal-summary').textContent, 'Unlinked backlog ticket');
  assert.equal(document.getElementById('modal-projects').textContent, 'Not linked');
  assert.match(document.getElementById('modal-actions').textContent, /Link to a project first to start or queue\./);
  assert.equal([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Start Work'), false);
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Verify Local'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Verify Remote'));
  assert.ok([...document.querySelectorAll('#modal-actions button')].some(button => button.textContent === 'Add Evidence'));
  assert.equal([...document.querySelectorAll('#modal-actions button')].some(button => /^Insert \[MR-(?:\?|)\]$/.test(button.textContent)), false);
  assert.ok(env.messages.some(message => message.command === 'getComments' && message.ticket === 'KRONOS-FB-3'));
  assert.deepEqual(env.errors, []);
});
