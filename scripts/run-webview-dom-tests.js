const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const actionPanelSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-action-panel.js'), 'utf8');
const contextComposerSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-context-composer.js'), 'utf8');
const projectIntegrationSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-project-integration.js'), 'utf8');

function createHarness(options = {}) {
  const messages = [];
  const attributes = new Map();
  const listeners = new Map();
  const scriptAttributes = new Map([
    ['data-kronos-webview-name', options.webviewName || 'Kronos Ticket Workspace'],
    ['data-kronos-ready-command', '__kronosWebviewReady'],
    ['data-kronos-action-fields', JSON.stringify(options.fields || [
      { messageKey: 'ticket', dataAttribute: 'data-ticket' },
    ])],
  ]);
  const document = {
    currentScript: { getAttribute: name => scriptAttributes.get(name) || null },
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
    readyState: 'complete',
    addEventListener(name, listener) {
      const values = listeners.get(name) || [];
      values.push(listener);
      listeners.set(name, values);
    },
    getElementById() { return null; },
    querySelector() { return null; },
  };
  const runtime = {
    createReadyPoster({ readyCommand, webviewName }) {
      return () => messages.push({ command: readyCommand, webviewName });
    },
    markReady(name) { attributes.set('ready-name', name); },
    installDiagnostics(name) { attributes.set('diagnostics-name', name); },
    vscodeApi() { return { postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) }; },
  };
  const context = vm.createContext({
    document,
    KronosWebviewRuntime: runtime,
    console: { info() {}, warn() {}, error() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  context.globalThis = context;
  context.window = context;
  return { context, document, attributes, listeners, messages };
}

test('ticket workspace action panel posts one normalized, ticket-scoped message', () => {
  const harness = createHarness();
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });

  assert.equal(harness.attributes.get('data-kronos-action-handler-attached'), 'true');
  assert.equal(harness.attributes.get('data-kronos-actions-ready'), 'true');
  assert.equal(harness.listeners.get('click').length, 1);

  const buttonAttributes = new Map([
    ['data-action', 'insertJiraContext'],
    ['data-ticket', 'JIRA-123'],
  ]);
  const button = { getAttribute: name => buttonAttributes.get(name) || null };
  let prevented = false;
  harness.listeners.get('click')[0]({
    target: { closest: selector => selector === '[data-action]' ? button : null },
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insertJiraContext', ticket: 'JIRA-123' });
});

test('loading the action panel twice does not attach a duplicate click handler', () => {
  const harness = createHarness();
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });
  assert.equal(harness.listeners.get('click').length, 1);
});

test('Setup and Doctor actions post only their allowlisted operation command field', () => {
  const harness = createHarness({ webviewName: 'Kronos Setup', fields: [] });
  vm.runInContext(actionPanelSource, harness.context, { filename: 'kronos-action-panel.js' });
  const buttonAttributes = new Map([
    ['data-action', 'openDoctor'],
    ['data-ticket', 'JIRA-123'],
  ]);
  const button = { getAttribute: name => buttonAttributes.get(name) || null };
  harness.listeners.get('click')[0]({
    target: { closest: selector => selector === '[data-action]' ? button : null },
    preventDefault() {},
  });
  assert.deepEqual(harness.messages.at(-1), { command: 'openDoctor' });
});

test('context composer posts edited focus only after Insert or Ctrl+Enter', () => {
  const focusListeners = new Map();
  const focus = {
    value: 'Review latest comments',
    addEventListener(name, listener) { focusListeners.set(name, listener); },
    focus() {},
  };
  const harness = createFormHarness({
    scriptId: 'kronos-context-composer-script',
    elements: new Map([['context-focus', focus]]),
  });
  vm.runInContext(contextComposerSource, harness.context, { filename: 'kronos-context-composer.js' });
  assert.equal(harness.messages.length, 1, 'only the ready message is posted on load');
  harness.click('insertDraft');
  assert.deepEqual(harness.messages.at(-1), { command: 'insertDraft', focus: 'Review latest comments' });
  focus.value = 'Focus on unresolved discussion';
  let prevented = false;
  focusListeners.get('keydown')({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insertDraft', focus: 'Focus on unresolved discussion' });
});

test('project integration form collects only bounded project setup fields', () => {
  const values = {
    gitlabProject: 'group/app',
    jenkinsUrl: 'https://jenkins.example/job/app/',
    sonarProjectKey: 'app:key',
    defaultBranch: 'main',
  };
  const card = {
    getAttribute(name) { return name === 'data-project-name' ? 'Application' : null; },
    querySelector(selector) {
      const match = /^\[data-field="([A-Za-z]+)"\]$/.exec(selector);
      return match ? { value: values[match[1]] || '' } : null;
    },
  };
  const harness = createFormHarness({
    scriptId: 'kronos-project-integration-script',
    querySelectorAll: selector => selector === '[data-project-card]' ? [card] : [],
  });
  vm.runInContext(projectIntegrationSource, harness.context, { filename: 'kronos-project-integration.js' });
  harness.click('save');
  assert.deepEqual(harness.messages.at(-1), {
    command: 'save',
    projects: [{ name: 'Application', ...values }],
  });
});

function createFormHarness(options) {
  const messages = [];
  const attributes = new Map();
  const listeners = new Map();
  const script = {
    getAttribute(name) { return name === 'data-kronos-ready-command' ? '__kronosWebviewReady' : null; },
  };
  const document = {
    currentScript: script,
    documentElement: { setAttribute: (name, value) => attributes.set(name, value) },
    readyState: 'complete',
    addEventListener(name, listener) {
      const values = listeners.get(name) || [];
      values.push(listener);
      listeners.set(name, values);
    },
    getElementById(id) {
      if (id === options.scriptId) { return script; }
      return options.elements?.get(id) || null;
    },
    querySelectorAll(selector) { return options.querySelectorAll ? options.querySelectorAll(selector) : []; },
  };
  const runtime = {
    createReadyPoster({ readyCommand, webviewName }) {
      return () => messages.push({ command: readyCommand, webviewName });
    },
    markReady() {},
    installDiagnostics() {},
    vscodeApi() { return { postMessage: message => messages.push(JSON.parse(JSON.stringify(message))) }; },
  };
  const context = vm.createContext({
    document,
    KronosWebviewRuntime: runtime,
    console: { info() {}, warn() {}, error() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
  });
  context.globalThis = context;
  context.window = context;
  return {
    context,
    messages,
    click(action) {
      const target = {
        getAttribute(name) { return name === 'data-action' ? action : null; },
      };
      const event = {
        target: { closest: selector => selector === '[data-action]' ? target : null },
        preventDefault() {},
      };
      for (const listener of listeners.get('click') || []) { listener(event); }
    },
  };
}
