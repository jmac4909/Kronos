const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const actionPanelSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-action-panel.js'), 'utf8');
const contextBasketSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-context-basket.js'), 'utf8');
const contextComposerSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-context-composer.js'), 'utf8');
const projectIntegrationSource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-project-integration.js'), 'utf8');
const promptLibrarySource = fs.readFileSync(path.join(__dirname, '..', 'media', 'kronos-prompt-library.js'), 'utf8');

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
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name) || null,
    },
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
  let ordinaryEnterPrevented = false;
  focusListeners.get('keydown')({
    key: 'Enter',
    ctrlKey: false,
    metaKey: false,
    preventDefault() { ordinaryEnterPrevented = true; },
  });
  assert.equal(ordinaryEnterPrevented, false, 'ordinary Enter remains available for editing');
  assert.equal(harness.messages.length, 1, 'ordinary Enter never requests context placement');
  harness.click('insertDraft');
  assert.deepEqual(harness.messages.at(-1), { command: 'insertDraft', focus: 'Review latest comments' });
  focus.value = 'Focus on unresolved discussion';
  let prevented = false;
  focusListeners.get('keydown')({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insertDraft', focus: 'Focus on unresolved discussion' });
  harness.click('addToBasket');
  assert.deepEqual(harness.messages.at(-1), { command: 'addToBasket' });
});

test('context composer initialization is idempotent and one Insert click posts once', () => {
  const focusListeners = [];
  const focus = {
    value: 'Review the immutable evidence',
    addEventListener(name, listener) {
      if (name === 'keydown') { focusListeners.push(listener); }
    },
    focus() {},
  };
  const harness = createFormHarness({
    scriptId: 'kronos-context-composer-script',
    elements: new Map([['context-focus', focus]]),
  });
  vm.runInContext(contextComposerSource, harness.context, { filename: 'kronos-context-composer.js' });
  vm.runInContext(contextComposerSource, harness.context, { filename: 'kronos-context-composer.js' });

  assert.equal(harness.attributes.get('data-kronos-context-composer-handler-attached'), 'true');
  assert.equal(harness.listeners.get('click').length, 1);
  assert.equal(focusListeners.length, 1);
  harness.click('insertDraft');
  assert.equal(harness.messages.filter(message => message.command === 'insertDraft').length, 1);
});

test('context basket preserves focus across explicit refresh and non-submitting insert actions', () => {
  const focusListeners = new Map();
  const focus = {
    value: 'Compare Jira and MR evidence',
    addEventListener(name, listener) { focusListeners.set(name, listener); },
    focus() {},
  };
  const harness = createFormHarness({
    scriptId: 'kronos-context-basket-script',
    elements: new Map([['basket-focus', focus]]),
  });
  vm.runInContext(contextBasketSource, harness.context, { filename: 'kronos-context-basket.js' });
  harness.click('refresh', { 'data-entry-id': 'basket-abc123' });
  assert.deepEqual(harness.messages.at(-1), {
    command: 'refresh',
    entryId: 'basket-abc123',
    focus: 'Compare Jira and MR evidence',
  });
  focus.value = 'Place the combined evidence';
  let prevented = false;
  focusListeners.get('keydown')({ key: 'Enter', ctrlKey: true, metaKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insert', focus: 'Place the combined evidence' });
});

test('prompt library posts the complete edited prompt only after Place or Ctrl+Enter', () => {
  const editorListeners = new Map();
  const editor = {
    value: 'Review the selected project and current branch.',
    addEventListener(name, listener) { editorListeners.set(name, listener); },
    focus() {},
  };
  const harness = createFormHarness({
    scriptId: 'kronos-prompt-library-script',
    elements: new Map([['prompt-body', editor]]),
  });
  vm.runInContext(promptLibrarySource, harness.context, { filename: 'kronos-prompt-library.js' });
  assert.equal(harness.messages.length, 1, 'only readiness is posted before an explicit action');
  let ordinaryEnterPrevented = false;
  editorListeners.get('keydown')({
    key: 'Enter', ctrlKey: false, metaKey: false,
    preventDefault() { ordinaryEnterPrevented = true; },
  });
  assert.equal(ordinaryEnterPrevented, false);
  assert.equal(harness.messages.length, 1);
  harness.click('insertPrompt');
  assert.deepEqual(harness.messages.at(-1), {
    command: 'insertPrompt',
    body: 'Review the selected project and current branch.',
  });
  editor.value = 'Use the edited team instruction.';
  let prevented = false;
  editorListeners.get('keydown')({
    key: 'Enter', ctrlKey: true, metaKey: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.deepEqual(harness.messages.at(-1), { command: 'insertPrompt', body: 'Use the edited team instruction.' });
  harness.click('openSettings');
  assert.deepEqual(harness.messages.at(-1), { command: 'openSettings' });
});

test('project integration form collects only bounded project setup fields', () => {
  const values = {
    nickname: 'Customer API',
    gitlabProject: 'group/app',
    jenkinsUrl: 'https://jenkins.example/job/app/',
    sonarProjectKey: 'app:key',
    defaultBranch: 'main',
    branchProfiles: 'main | https://jenkins.example/job/app/job/main | app:key | main',
    activeBranchProfile: 'main',
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
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name) || null,
    },
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
    attributes,
    listeners,
    messages,
    click(action, extraAttributes = {}) {
      const target = {
        getAttribute(name) { return name === 'data-action' ? action : extraAttributes[name] || null; },
      };
      const event = {
        target: { closest: selector => selector === '[data-action]' ? target : null },
        preventDefault() {},
      };
      for (const listener of listeners.get('click') || []) { listener(event); }
    },
  };
}
