const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-core-behavior-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

class Disposable {
  constructor(callback = () => {}) { this.callback = callback; }
  dispose() {
    const callback = this.callback;
    this.callback = () => {};
    callback();
  }
}

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = listener => {
      this.listeners.add(listener);
      return new Disposable(() => this.listeners.delete(listener));
    };
  }
  fire(value) {
    for (const listener of [...this.listeners]) { listener(value); }
  }
  dispose() { this.listeners.clear(); }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}

class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}

const vscode = {
  Disposable,
  EventEmitter,
  ThemeIcon,
  TreeItem,
  TreeItemCollapsibleState: { None: 0 },
};

let jiraSearchWorkList = async () => jiraSnapshot();
let watcherCallback;
let watchFailure;
const terminalFirstJiraModule = {
  jiraRestClient: {
    searchWorkList: options => jiraSearchWorkList(options),
  },
  resolveJiraRestConfig: () => ({ baseUrl: 'https://jira.example' }),
};

const originalLoad = Module._load;
Module._load = function loadWithCoreMocks(request, parent, isMain) {
  if (request === 'vscode') { return vscode; }
  if (request === 'fs' && /TerminalFirstState\.js$/.test(parent?.filename || '')) {
    return {
      ...fs,
      watch(_filePath, callback) {
        if (watchFailure) { throw watchFailure; }
        watcherCallback = callback;
        return { close() {} };
      },
    };
  }
  if (request === '../services/jiraRestClient' && /TerminalFirstState\.js$/.test(parent?.filename || '')) {
    return terminalFirstJiraModule;
  }
  return originalLoad.call(this, request, parent, isMain);
};

let TerminalFirstState;
let WorkTicketTreeItem;
let WorkTreeProvider;
try {
  ({ TerminalFirstState } = require('../out/state/TerminalFirstState.js'));
  ({ WorkTicketTreeItem, WorkTreeProvider } = require('../out/views/WorkTreeProvider.js'));
} finally {
  Module._load = originalLoad;
}

const stateStore = require('../out/services/stateStore.js');
const jiraContext = require('../out/services/jiraTicketContext.js');
const jiraContextStore = require('../out/services/jiraContextStore.js');
const jiraValuePruning = require('../out/services/jiraValuePruning.js');

test('TerminalFirstState reports complete and partial Jira refreshes without losing prior provider evidence', async () => {
  stateStore.writeStateFile(stateStore.emptyWorkCatalog());
  const source = new TerminalFirstState();
  const phases = [];
  const subscription = source.onDidChange(() => phases.push(source.jiraRefreshStatus.phase));
  try {
    jiraSearchWorkList = async () => jiraSnapshot({
      issues: [jiraIssue('APP-1', 'First ticket')],
      fetchedAt: '2026-07-16T10:00:00.000Z',
    });
    const complete = await source.refreshTickets();
    assert.deepEqual(complete, {
      ticketCount: 1,
      complete: true,
      retainedFromPrevious: 0,
      pageCount: 1,
      responseBytes: 512,
      warnings: [],
    });
    assert.equal(source.state.tickets['APP-1'].summary, 'First ticket');
    source.projectTicketProviderState('APP-1', {
      mr: {
        iid: 77,
        title: 'Retained MR',
        state: 'opened',
        review_status: 'pending_review',
        url: 'https://gitlab.example/group/application/-/merge_requests/77',
      },
      build: { number: 41, status: 'SUCCESS', url: 'https://jenkins.example/job/application/41/' },
    });

    jiraSearchWorkList = async () => jiraSnapshot({
      complete: false,
      issues: [jiraIssue('APP-2', 'Partial ticket')],
      fetchedAt: '2026-07-16T10:05:00.000Z',
      warnings: ['Jira pagination stopped at the configured page limit.'],
    });
    const partial = await source.refreshTickets();
    assert.equal(partial.complete, false);
    assert.equal(partial.retainedFromPrevious, 1);
    assert.equal(source.jiraRefreshStatus.phase, 'partial');
    assert.equal(source.state.tickets['APP-1'].mr.iid, 77);
    assert.equal(source.state.tickets['APP-1'].build.number, 41);
    assert.equal(source.state.tickets['APP-2'].summary, 'Partial ticket');
    assert.deepEqual(phases, ['loading', 'complete', 'complete', 'loading', 'partial']);
  } finally {
    subscription.dispose();
    source.dispose();
  }
});

test('TerminalFirstState keeps the newest explicit refresh and exposes a bounded error state', async () => {
  stateStore.writeStateFile(stateStore.emptyWorkCatalog());
  const source = new TerminalFirstState();
  try {
    const pending = [];
    jiraSearchWorkList = () => new Promise((resolve, reject) => pending.push({ resolve, reject }));
    const stale = source.refreshTickets();
    const current = source.refreshTickets();
    assert.equal(pending.length, 2);

    pending[1].resolve(jiraSnapshot({
      issues: [jiraIssue('APP-2', 'Newest ticket')],
      fetchedAt: '2026-07-16T11:00:00.000Z',
    }));
    assert.equal((await current).ticketCount, 1);
    pending[0].resolve(jiraSnapshot({
      issues: [jiraIssue('APP-1', 'Stale ticket')],
      fetchedAt: '2026-07-16T10:59:00.000Z',
    }));
    await assert.rejects(stale, /superseded by a newer operator request/i);
    assert.deepEqual(Object.keys(source.state.tickets), ['APP-2']);
    assert.equal(source.jiraRefreshStatus.phase, 'complete');

    const secret = ['glpat-', 'corebehaviorfixture'].join('');
    jiraSearchWorkList = async () => {
      throw Object.assign(new Error(`Authorization: Bearer ${secret}`), { code: 'ECONNREFUSED' });
    };
    await assert.rejects(source.refreshTickets(), /Authorization/);
    assert.equal(source.jiraRefreshStatus.phase, 'error');
    assert.equal(source.jiraRefreshStatus.detail.includes(secret), false);
    assert.match(source.jiraRefreshStatus.detail, /REDACTED/);
    assert.deepEqual(Object.keys(source.state.tickets), ['APP-2']);
  } finally {
    source.dispose();
  }
});

test('TerminalFirstState project mutations preserve explicit identities and watcher refreshes', async () => {
  const initial = stateStore.emptyWorkCatalog();
  initial.tickets['APP-7'] = ticket('Mutable project ticket');
  stateStore.writeStateFile(initial);
  const projectRoot = createGitProject('mutable-project', 'feature/core-behavior');
  const secondRoot = createGitProject('second-project', 'main');
  const source = new TerminalFirstState();
  let changeCount = 0;
  const subscription = source.onDidChange(() => { changeCount += 1; });
  try {
    source.registerLocalProject('application', projectRoot);
    source.registerLocalProjects([{ name: 'second', path: secondRoot }]);
    source.renameLocalProjectDisplayName('application', 'Customer API');
    source.setLocalProjectIntegrations([{
      name: 'application',
      nickname: 'Customer API',
      gitlabProject: 'group/application',
      jenkinsUrl: 'https://jenkins.example/job/application/',
      sonarProjectKey: 'application:key',
      defaultBranch: 'feature/core-behavior',
    }]);
    source.setTicketLocalProject('APP-7', 'application');
    source.projectTicketProviderState('APP-7', {
      mr: {
        iid: 81,
        title: 'Project MR',
        state: 'opened',
        review_status: 'pending_review',
        url: 'https://gitlab.example/group/application/-/merge_requests/81',
      },
    });
    source.setLocalProjectSonarTarget('application', 'application:key', 'feature/core-behavior');
    const beforeNoOps = changeCount;
    source.renameLocalProjectDisplayName('application', 'Customer API');
    source.projectTicketProviderState('MISSING-7', { build: { number: 1, status: 'FAILURE' } });
    source.setLocalProjectSonarTarget('missing', 'application:key', 'main');
    assert.equal(changeCount, beforeNoOps, 'no-op mutations must not rewrite or notify');

    source.replaceRegisteredLocalProjects([{ name: 'application', path: projectRoot }]);
    assert.equal(source.state.projects.application.display_name, 'Customer API');
    assert.equal(source.state.projects.application.config.gitlab_project_path, 'group/application');
    assert.equal(source.state.projects.application.config.sonar_branch, 'feature/core-behavior');
    assert.equal(source.state.tickets['APP-7'].linked_local_project, 'application');
    assert.equal(source.state.tickets['APP-7'].mr.iid, 81);
    assert.equal(source.state.projects.second, undefined);

    source.setTicketLocalProject('APP-7');
    assert.equal(source.state.tickets['APP-7'].linked_local_project, undefined);

    assert.equal(typeof watcherCallback, 'function');
    watcherCallback();
    watcherCallback();
    await new Promise(resolve => setTimeout(resolve, 180));
    assert.equal(source.jiraRefreshStatus.phase, 'idle');

    watchFailure = Object.assign(new Error('watch path is unavailable'), { code: 'EACCES' });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = value => warnings.push(String(value));
    try {
      source.reloadAndNotify();
    } finally {
      console.warn = originalWarn;
      watchFailure = undefined;
    }
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /local state.*private-state permissions/i);
  } finally {
    subscription.dispose();
    source.dispose();
  }
});

test('TerminalFirstState isolates malformed load issues and cancels pending watcher work on dispose', async () => {
  fs.mkdirSync(path.dirname(stateStore.STATE_FILE), { recursive: true, mode: 0o700 });
  fs.writeFileSync(stateStore.STATE_FILE, 'not-json', { mode: 0o600 });
  const malformed = new TerminalFirstState();
  try {
    assert.equal(malformed.state.schemaVersion, 2);
    const issues = malformed.loadIssues;
    assert.equal(issues.length, 1);
    assert.equal(issues[0].filePath, stateStore.STATE_FILE);
    assert.match(issues[0].detail, /could not read|not valid JSON|invalid JSON/i);
    issues[0].detail = 'caller mutation';
    assert.notEqual(malformed.loadIssues[0].detail, 'caller mutation', 'load issues are returned as isolated values');
  } finally {
    malformed.dispose();
  }

  fs.rmSync(stateStore.STATE_FILE, { force: true });
  watcherCallback = undefined;
  const missing = new TerminalFirstState();
  try {
    assert.deepEqual(missing.loadIssues, []);
    assert.equal(watcherCallback, undefined, 'a missing catalog does not install a watcher');
  } finally {
    missing.dispose();
  }

  stateStore.writeStateFile(stateStore.emptyWorkCatalog());
  const pending = new TerminalFirstState();
  assert.equal(typeof watcherCallback, 'function');
  watcherCallback();
  pending.dispose();
  await new Promise(resolve => setTimeout(resolve, 180));
  assert.equal(pending.jiraRefreshStatus.phase, 'idle', 'disposed watcher work cannot publish a late refresh');
});

test('TerminalFirstState bounds unexpected load failures and aborted refreshes without publishing false errors', async () => {
  stateStore.writeStateFile(stateStore.emptyWorkCatalog());
  const source = new TerminalFirstState();
  const originalRead = stateStore.readStateFileWithIssues;
  try {
    stateStore.readStateFileWithIssues = () => {
      throw new Error(`unexpected ${['glpat-', 'state-load-secret'].join('')}`);
    };
    source.load();
    assert.equal(source.state, null);
    assert.equal(source.loadIssues.length, 1);
    assert.equal(source.loadIssues[0].filePath, stateStore.STATE_FILE);
    assert.match(source.loadIssues[0].detail, /unexpected.*REDACTED/i);
    assert.doesNotMatch(source.loadIssues[0].detail, /state-load-secret/);
  } finally {
    stateStore.readStateFileWithIssues = originalRead;
  }

  source.load();
  const controller = new AbortController();
  jiraSearchWorkList = async () => {
    controller.abort();
    return jiraSnapshot({ issues: [jiraIssue('APP-ABORT', 'Must not publish')] });
  };
  await assert.rejects(source.refreshTickets({ signal: controller.signal }), /superseded/i);
  assert.equal(source.jiraRefreshStatus.phase, 'loading', 'operator cancellation does not masquerade as a provider failure');
  assert.equal(source.state.tickets['APP-ABORT'], undefined);
  source.dispose();
  source.dispose();
});

test('TerminalFirstState mutation APIs recover from a temporarily unavailable catalog', () => {
  const projectRoot = createGitProject('unavailable-catalog-project', 'main');
  const originalRead = stateStore.readStateFileWithIssues;
  stateStore.readStateFileWithIssues = () => { throw new Error('catalog temporarily unavailable'); };
  const source = new TerminalFirstState();
  try {
    assert.equal(source.state, null);
    source.registerLocalProject('application', projectRoot);
    source.registerLocalProjects([{ name: 'application', path: projectRoot }]);
    source.replaceRegisteredLocalProjects([{ name: 'application', path: projectRoot }]);
    assert.throws(() => source.renameLocalProjectDisplayName('missing', 'Customer API'), /not registered/);
    source.setLocalProjectIntegrations([]);
    assert.throws(() => source.setTicketLocalProject('MISSING-1', 'application'), /not loaded/);
    source.projectTicketProviderState('MISSING-1', { build: { number: 1, status: 'SUCCESS' } });
    source.setLocalProjectSonarTarget('missing', 'team:application', 'main');
    assert.equal(source.state, null);
    assert.ok(source.loadIssues.length > 0);
  } finally {
    source.dispose();
    stateStore.readStateFileWithIssues = originalRead;
    stateStore.writeStateFile(stateStore.emptyWorkCatalog());
  }
});

test('Work tree directly covers project-rich rows, sorting, filters, empty states, and refresh errors', () => {
  const projectRoot = createGitProject('work-tree-project', 'feature/work-tree');
  const emitter = new EventEmitter();
  const stateSource = {
    state: {
      schemaVersion: 2,
      refreshedAt: '2026-07-16T09:00:00.000Z',
      projects: {
        application: { path: projectRoot, display_name: 'Customer API', config: {} },
      },
      tickets: {
        'APP-2': {
          ...ticket('Older completed ticket'),
          jira_status: 'Released',
          jira_status_category: 'done',
          updated: 'not-a-date',
        },
        'APP-1': {
          ...ticket('Newest defect ticket'),
          type: 'Defect',
          priority: 'High',
          jira_project_key: 'APP',
          linked_local_project: 'application',
          description: 'A multi-line\noperator-visible description.',
          updated: '2026-07-16T10:00:00.000Z',
          mr: {
            iid: 77,
            title: 'Visible MR',
            state: 'opened',
            review_status: 'changes_requested',
            url: 'https://gitlab.example/group/application/-/merge_requests/77',
          },
          build: { number: 41, status: 'FAILURE', url: 'https://jenkins.example/job/application/41/' },
        },
      },
    },
    loadIssues: [],
    jiraRefreshStatus: { phase: 'complete' },
    onDidChange: emitter.event,
  };
  const preferences = {
    hideCompletedByDefault: () => true,
    doneStatusNames: () => ['Released'],
    staleAfterMs: () => Number.POSITIVE_INFINITY,
  };
  const provider = new WorkTreeProvider(stateSource, preferences, (_key, value) => ({ ...value }));
  const changes = [];
  const subscription = provider.onDidChangeTreeData(value => changes.push(value));
  try {
    const active = provider.getChildren();
    assert.equal(active.length, 1);
    assert.equal(active[0].ticketKey, 'APP-1');
    assert.equal(provider.getTreeItem(active[0]), active[0]);
    assert.equal(active[0].iconPath.id, 'bug');
    assert.equal(active[0].description, 'In Progress • Customer API');
    assert.match(active[0].tooltip, /Launch directory:.*work-tree-project/);
    assert.match(active[0].tooltip, /Merge request !77: opened \/ changes_requested/);
    assert.match(active[0].tooltip, /Build #41: FAILURE/);
    assert.match(active[0].tooltip, /A multi-line operator-visible description/);
    assert.match(active[0].tooltip, /Select to open the ticket workspace\. Right-click for ticket actions\./);

    provider.setFilter({ completion: 'all' });
    assert.deepEqual(provider.getChildren().map(item => item.ticketKey), ['APP-1', 'APP-2']);
    provider.setSearchQuery('no-such-ticket');
    const noMatches = provider.getChildren().at(-1);
    assert.equal(noMatches.label, 'No matching tickets');
    assert.equal(noMatches.description, 'Change the current filters');
    assert.equal(noMatches.command.command, 'kronos.filterWork');
    assert.equal(noMatches.command.title, 'Filter Work');
    provider.clearFilter();
    assert.equal(provider.defaultCompletion(), 'active');
    assert.deepEqual(provider.getFilter(), {});
    assert.deepEqual(provider.getFilterOptions(), {
      jiraProjects: ['APP'],
      localProjects: ['application'],
      labels: [],
      jiraStatuses: ['In Progress', 'Released'],
    });

    stateSource.state = {
      ...stateSource.state,
      tickets: { 'APP-2': stateSource.state.tickets['APP-2'] },
    };
    const noActive = provider.getChildren().at(-1);
    assert.equal(noActive.label, 'No active tickets');
    assert.equal(noActive.description, 'Use Filter to show completed work');
    assert.equal(noActive.command.command, 'kronos.filterWork');
    assert.equal(noActive.command.title, 'Filter Work');

    stateSource.state = null;
    stateSource.loadIssues = [new Error('fixture')];
    stateSource.jiraRefreshStatus = {
      phase: 'error',
      detail: 'Jira refresh failed safely.',
      warningCount: 0,
      retainedFromPrevious: 0,
    };
    const unavailable = provider.getChildren()[0];
    assert.equal(unavailable.command.command, 'kronos.doctor');
    assert.equal(unavailable.iconPath.id, 'error');
    assert.match(unavailable.tooltip, /Jira refresh failed safely/);

    provider.refresh();
    emitter.fire();
    assert.equal(changes.length >= 5, true);
    assert.ok(changes.every(value => value === undefined));
  } finally {
    subscription.dispose();
    provider.dispose();
  }

  stateSource.state = {
    schemaVersion: 2,
    refreshedAt: '2026-07-16T10:00:00.000Z',
    projects: {},
    tickets: { 'APP-DEFAULT': ticket('Default preference fixture') },
  };
  stateSource.loadIssues = [];
  stateSource.jiraRefreshStatus = { phase: 'complete' };
  const defaultedProvider = new WorkTreeProvider(stateSource);
  assert.equal(defaultedProvider.getChildren()[0].ticketKey, 'APP-DEFAULT');
  defaultedProvider.dispose();

  const open = new WorkTicketTreeItem('APP-3', ticket('Open ticket'));
  const closed = new WorkTicketTreeItem('APP-4', { ...ticket('Closed ticket'), jira_status_category: 'done' });
  const sparse = new WorkTicketTreeItem('', {
    ...ticket(''),
    summary: '',
    type: 'Defect',
    priority: '',
    jira_status: '',
    jira_project_key: '',
  });
  const namedProject = new WorkTicketTreeItem('APP-5', ticket('Named project'), {
    name: 'application',
    displayName: '',
    path: '/workspace/application',
    branch: undefined,
    detached: false,
    available: true,
  });
  const unsafeProjectMetadata = new WorkTicketTreeItem('APP-6', ticket('Unsafe project metadata'), {
    name: 'application',
    displayName: 'Application',
    path: '/workspace/\napplication',
    branch: 'feature/\tdanger',
    detached: false,
    available: true,
  });
  assert.equal(open.iconPath.id, 'issue-opened');
  assert.equal(open.description, 'In Progress • Medium');
  assert.equal(closed.iconPath.id, 'issue-closed');
  assert.equal(sparse.label, 'Ticket — Untitled ticket');
  assert.equal(sparse.description, '');
  assert.equal(sparse.iconPath.id, 'bug');
  assert.match(sparse.tooltip, /Jira status: Unknown[^]*Jira project: Unknown[^]*Priority: Unknown[^]*Local project: Not linked/);
  assert.equal(namedProject.description, 'In Progress • application');
  assert.match(namedProject.tooltip, /Git branch: unavailable/);
  assert.match(unsafeProjectMetadata.tooltip, /Launch directory: \/workspace\/ application/);
  assert.match(unsafeProjectMetadata.tooltip, /Git branch: feature\/ danger/);
  assert.doesNotMatch(unsafeProjectMetadata.tooltip, /Launch directory: \/workspace\/\napplication/);
});

test('Jira rich text and recursive values preserve visible evidence while redacting unsafe content', () => {
  const adf = {
    type: 'doc',
    version: 1,
    content: [
      { type: 'heading', content: [{
        type: 'text',
        text: 'Release evidence',
        marks: [{ type: 'link', attrs: { href: 'https://jira.example/page?token=secret&view=full#fragment' } }],
      }] },
      { type: 'paragraph', content: [
        { type: 'mention', attrs: { text: '@Operator' } },
        { type: 'hardBreak' },
        { type: 'emoji', attrs: { shortName: ':white_check_mark:' } },
        { type: 'date', attrs: { timestamp: '2026-07-16' } },
        { type: 'status', attrs: { text: 'READY' } },
      ] },
      { type: 'rule' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'text', text: 'bullet' }] }] },
      { type: 'orderedList', attrs: { order: 3 }, content: [{ type: 'listItem', content: [{ type: 'text', text: 'third' }] }] },
      { type: 'table', content: [{ type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'text', text: 'State' }] },
        { type: 'tableCell', content: [{ type: 'text', text: 'green' }] },
      ] }] },
      { type: 'inlineCard', attrs: { url: 'https://jira.example/card' } },
      { type: 'mediaSingle', content: [{ type: 'media', attrs: { filename: 'evidence.msg' } }] },
    ],
  };
  const text = jiraContext.adfToText(adf);
  for (const expected of ['Release evidence', '@Operator', ':white_check_mark:', 'READY', '- bullet', '3. third', 'State | green', 'evidence.msg']) {
    assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(text, /token=\[REDACTED\]&view=full/);
  assert.doesNotMatch(text, /token=secret|#fragment/);

  const circular = { label: 'retained' };
  circular.child = circular;
  assert.deepEqual(jiraContext.normalizeContextValue(circular), {
    label: 'retained',
    child: '[Circular value]',
  });
  const deep = {};
  let cursor = deep;
  for (let index = 0; index < 45; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.match(JSON.stringify(jiraContext.normalizeContextValue(deep)), /Maximum depth reached/);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: [{ type: 'paragraph', content: [] }] }), true);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: [{ type: 'rule' }] }), false);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: [{ type: 'mention', attrs: { id: 'account-7' } }] }), false);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'paragraph', content: [] }), false);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: [null, undefined, '', Symbol('empty')] }), true);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: ['visible'] }), false);
  assert.equal(jiraValuePruning.isEmptyJiraRichText({ type: 'doc', content: [0] }), false);
  const circularRichText = { type: 'doc', content: [] };
  circularRichText.content.push(circularRichText.content);
  assert.equal(jiraValuePruning.isEmptyJiraRichText(circularRichText), true);
  let deeplyEmpty = { type: 'doc', content: [] };
  const deeplyEmptyDocument = deeplyEmpty;
  for (let index = 0; index < 45; index += 1) {
    const child = { content: [] };
    deeplyEmpty.content.push(child);
    deeplyEmpty = child;
  }
  assert.equal(jiraValuePruning.isEmptyJiraRichText(deeplyEmptyDocument), true);
  assert.deepEqual(jiraValuePruning.pruneEmptyJiraValue([
    'None', ' N/A ', 'undefined', '', null, false, 0, { empty: {}, visible: 'value' },
  ]), [false, 0, { visible: 'value' }]);
});

test('Jira context normalization reconciles comments, attachment outcomes, metadata, and completeness', () => {
  const validHash = 'a'.repeat(64);
  const snapshot = {
    issue: {
      self: 'https://user:password@jira.example/rest/api/3/issue/APP-9?token=secret#fragment',
      fields: {
        summary: 'Context normalization',
        description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Visible description' }] }] },
        project: { key: 'APP' },
        issuetype: { name: 'Story' },
        status: { name: 'In Progress' },
        priority: { name: 'High' },
        assignee: { displayName: 'Owner' },
        labels: ['core', 'core', 'None'],
        components: [{ name: 'API' }, 'Web'],
        fixVersions: { name: '2026.7' },
        comment: {
          total: 1,
          comments: [{
            id: 'comment-1',
            body: 'Retained comment',
            author: { displayName: 'Reviewer', accountId: 'account-1', token: 'hidden' },
            created: '2026-07-16T09:00:00.000Z',
            self: 'https://jira.example/comment/1?token=secret',
          }],
        },
        attachment: [
          { id: '1', filename: 'captured.msg', size: 12, mimeType: 'application/vnd.ms-outlook', content: 'https://jira.example/raw?token=secret' },
          { id: '2', filename: 'invalid-hash.bin', size: 8 },
          { id: '3', filename: 'mismatch.bin', size: 4 },
          { id: '4', filename: 'bounded.bin', size: 99 },
        ],
        customfield_secret: 'must not survive',
        customfield_missing_schema: { disabled: false, estimate: 0 },
      },
      names: {
        summary: 'Summary', description: 'Description', project: 'Project', issuetype: 'Issue type', status: 'Status',
        priority: 'Priority', assignee: 'Assignee', labels: 'Labels', components: 'Components', fixVersions: 'Fix versions',
        comment: 'Comment', attachment: 'Attachment', customfield_secret: 'Client secret',
        customfield_missing_schema: 'Delivery controls',
      },
      schema: {
        summary: { type: 'string' }, description: { type: 'doc' }, project: { type: 'project' }, issuetype: { type: 'issueType' },
        status: { type: 'status' }, priority: { type: 'priority' }, assignee: { type: 'user' }, labels: { type: 'array' },
        components: { type: 'array' }, fixVersions: { type: 'array' }, comment: { type: 'comments-page' },
        attachment: { type: 'array' }, customfield_secret: { type: 'string', custom: true },
      },
    },
    attachmentContents: [
      { index: 0, id: '1', status: 'captured', responseBytes: 12, sourceSha256: validHash, responseMimeType: 'application/vnd.ms-outlook' },
      { index: 1, id: '2', status: 'captured', responseBytes: 8, sourceSha256: 'invalid' },
      { index: 2, id: 'different', status: 'captured', responseBytes: 4, sourceSha256: validHash },
      { index: 3, id: '4', status: 'skipped', reason: 'total-byte-limit', declaredMimeType: 'application/octet-stream' },
    ],
    fetchedAt: '2026-07-16T10:00:00.000Z',
    commentPageCount: 1,
    commentResponseBytes: 256,
    attachmentFetchCount: 4,
    attachmentResponseBytes: 24,
    warnings: ['Bounded attachment capture retained metadata.'],
  };
  const context = jiraContext.normalizeJiraTicketContext('app-9', snapshot);
  assert.equal(context.key, 'APP-9');
  assert.equal(context.url, 'https://jira.example/rest/api/3/issue/APP-9');
  assert.equal(context.description, 'Visible description');
  assert.deepEqual(context.labels, ['core']);
  assert.deepEqual(context.components, ['API', 'Web']);
  assert.deepEqual(context.fixVersions, ['2026.7']);
  assert.equal(context.comments[0].author, 'Reviewer');
  assert.equal(context.comments[0].authorAccountId, 'account-1');
  assert.equal(context.comments[0].metadata.author.token, '[REDACTED]');
  assert.equal(Object.hasOwn(context.comments[0].metadata, 'self'), false);
  assert.deepEqual(context.attachments.map(item => [item.contentStatus, item.contentReason]), [
    ['captured', undefined],
    ['failed', 'invalid-content-hash'],
    ['failed', 'attachment-id-mismatch'],
    ['skipped', 'total-byte-limit'],
  ]);
  assert.equal(context.attachments[0].contentSha256, validHash);
  assert.equal(Object.hasOwn(context.attachments[0].metadata, 'content'), false);
  assert.equal(context.customFields.find(field => field.id === 'customfield_secret').value, '[REDACTED]');
  assert.deepEqual(context.customFields.find(field => field.id === 'customfield_missing_schema').value, { disabled: false, estimate: 0 });
  assert.deepEqual(context.completeness.missingFieldSchemaIds, ['customfield_missing_schema']);
  assert.equal(context.completeness.attachmentBodiesCaptured, 1);
  assert.equal(context.completeness.attachmentBodiesFailed, 2);
  assert.equal(context.completeness.attachmentBodiesSkipped, 1);
  assert.equal(context.completeness.commentsComplete, true);
  assert.equal(context.completeness.complete, false);
  assert.match(context.completeness.warnings.join(' '), /schema metadata was missing.*customfield_missing_schema/i);
  assert.match(context.completeness.warnings.join(' '), /attachment downloads were partial/i);
});

test('Jira context publication validates attachments and completeness before writing any files', () => {
  const valid = capturedJiraContextFixture();
  const originalContext = structuredClone(valid.context);
  const validRoot = path.join(tempRoot, 'validated-jira-publication');
  const artifact = jiraContextStore.writeJiraContextArtifacts(valid.context, {
    kronosDir: validRoot,
    attachmentContents: valid.attachmentContents,
  });
  assert.equal(artifact.attachmentPaths.length, 1);
  assert.deepEqual(fs.readFileSync(artifact.attachmentPaths[0]), valid.bytes);
  assert.equal(fs.readFileSync(artifact.jsonPath, 'utf8').includes('TRANSIENT-RAW-BYTES'), false);
  assert.deepEqual(valid.context, originalContext, 'publication must not add artifact paths to the caller-owned context');
  assert.equal(JSON.parse(fs.readFileSync(artifact.jsonPath, 'utf8')).attachments[0].localPath, artifact.attachmentPaths[0]);

  const invalidEnvelope = capturedJiraContextFixture();
  invalidEnvelope.context.completeness.attachmentBodiesCaptured = 0;
  const invalidRoot = path.join(tempRoot, 'invalid-jira-publication');
  assert.throws(() => jiraContextStore.writeJiraContextArtifacts(invalidEnvelope.context, {
    kronosDir: invalidRoot,
    attachmentContents: invalidEnvelope.attachmentContents,
  }), /attachment completeness counts do not match/);
  assert.equal(fs.existsSync(invalidRoot), false, 'invalid normalized evidence must not publish directories or attachment bytes');

  for (const [label, mutateFixture, expected] of [
    ['missing bytes', fixture => { delete fixture.attachmentContents[0].bytes; }, /missing its transient raw bytes/],
    ['mismatched id', fixture => { fixture.attachmentContents[0].id = 'different'; }, /mismatched attachment id/],
    ['mismatched hash', fixture => { fixture.attachmentContents[0].sourceSha256 = '0'.repeat(64); }, /SHA-256 integrity check/],
    ['mismatched byte count', fixture => { fixture.context.attachments[0].contentBytes += 1; }, /byte-count integrity check/],
  ]) {
    const fixture = capturedJiraContextFixture();
    mutateFixture(fixture);
    const refusalRoot = path.join(tempRoot, `refused-jira-${label.replace(/\s+/g, '-')}`);
    assert.throws(() => jiraContextStore.writeJiraContextArtifacts(fixture.context, {
      kronosDir: refusalRoot,
      attachmentContents: fixture.attachmentContents,
    }), expected);
    assert.equal(fs.existsSync(refusalRoot), false, `${label} must not leave partial local state`);
  }
});

test('Jira context publication rejects corrupted core envelopes before mutating caller state or disk', () => {
  const cases = [
    ['unsupported schema', context => { context.schemaVersion = 2; }, /unsupported schema version/],
    ['invalid timestamp', context => { context.fetchedAt = 'not-a-date'; }, /fetchedAt timestamp is invalid/],
    ['invalid collection', context => { context.labels = null; }, /labels must be an array/],
    ['invalid attachment collection', context => { context.attachments = null; }, /attachments must be an array/],
    ['invalid attachment entry', context => { context.attachments = [null]; }, /attachment entry must be an object/],
    ['invalid attachment status', context => { context.attachments[0].contentStatus = 'pending'; }, /contentStatus is invalid/],
    ['invalid attachment bytes', context => {
      context.attachments[0].contentStatus = 'skipped';
      context.attachments[0].contentReason = 'bounded';
      context.attachments[0].contentBytes = -1;
    }, /contentBytes is invalid/],
    ['invalid skipped hash', context => {
      context.attachments[0].contentStatus = 'skipped';
      context.attachments[0].contentReason = 'bounded';
      context.attachments[0].contentSha256 = 'invalid';
    }, /contentSha256 is invalid/],
    ['captured failure reason', context => { context.attachments[0].contentReason = 'unexpected'; }, /must not include a failure reason/],
    ['invalid field record', context => { delete context.coreFields[0].text; }, /field entry is missing required/],
    ['duplicate field identity', context => {
      context.customFields.push({ ...context.coreFields[0], custom: true });
      context.completeness.fieldCount += 1;
      context.completeness.customFieldCount += 1;
    }, /duplicate field id/],
    ['missing completeness', context => { context.completeness = null; }, /completeness block is missing or invalid/],
    ['invalid completeness source', context => { context.completeness.source = 'cache'; }, /completeness source is invalid/],
    ['invalid completeness boolean', context => { context.completeness.complete = 'yes'; }, /complete must be boolean/],
    ['invalid completeness count', context => { context.completeness.commentsFetched = -1; }, /must be a non-negative integer/],
    ['invalid warnings', context => { context.completeness.warnings = [false]; }, /warnings must be an array/],
    ['duplicate field metadata', context => {
      const fieldId = context.coreFields[0].id;
      context.completeness.missingFieldNameIds = [fieldId, fieldId];
    }, /missingFieldNameIds must be a string array/],
    ['unknown field metadata', context => { context.completeness.missingFieldSchemaIds = ['unknown']; }, /contains an unknown field id/],
    ['comment count mismatch', context => { context.completeness.commentsFetched += 1; }, /commentsFetched does not match/],
    ['field count mismatch', context => { context.completeness.fieldCount += 1; }, /field completeness counts do not match/],
    ['attachment byte mismatch', context => { context.completeness.attachmentResponseBytes += 1; }, /attachmentResponseBytes does not match/],
    ['attachment fetch mismatch', context => { context.completeness.attachmentFetchCount = 0; }, /attachmentFetchCount is inconsistent/],
    ['attachment flag mismatch', context => { context.completeness.attachmentsComplete = false; }, /completeness flags do not match/],
    ['all-fields mismatch', context => { context.completeness.allFieldsFetched = false; }, /allFieldsFetched does not match/],
    ['complete flag mismatch', context => { context.completeness.complete = false; }, /complete flag does not match/],
  ];

  for (const [label, mutate, expected] of cases) {
    const fixture = capturedJiraContextFixture();
    mutate(fixture.context);
    const before = structuredClone(fixture.context);
    const refusalRoot = path.join(tempRoot, `corrupt-jira-${label.replace(/\s+/g, '-')}`);
    assert.throws(() => jiraContextStore.writeJiraContextArtifacts(fixture.context, {
      kronosDir: refusalRoot,
      attachmentContents: fixture.attachmentContents,
    }), expected, label);
    assert.deepEqual(fixture.context, before, `${label} must not mutate caller-owned evidence`);
    assert.equal(fs.existsSync(refusalRoot), false, `${label} must fail before local publication`);
  }

  const fallback = jiraContext.buildFallbackJiraTicketContext('APP-902', {
    summary: 'Fallback validation',
    description: 'Cached evidence',
  }, [], []);
  fallback.completeness.commentsComplete = true;
  const fallbackRoot = path.join(tempRoot, 'corrupt-jira-fallback');
  assert.throws(
    () => jiraContextStore.writeJiraContextArtifacts(fallback, { kronosDir: fallbackRoot }),
    /Fallback Jira context must remain explicitly partial/,
  );
  assert.equal(fs.existsSync(fallbackRoot), false);
});

test('Jira context publication rejects serialization-time envelope substitution and unsafe aggregate values', () => {
  const materializedMismatch = capturedJiraContextFixture();
  let keyReads = 0;
  Object.defineProperty(materializedMismatch.context, 'key', {
    enumerable: true,
    get() {
      keyReads += 1;
      return keyReads === 1 ? 'APP-901' : 'APP-902';
    },
  });
  assert.throws(() => jiraContextStore.writeJiraContextArtifacts(materializedMismatch.context, {
    kronosDir: path.join(tempRoot, 'jira-materialized-key-mismatch'),
    attachmentContents: materializedMismatch.attachmentContents,
  }), /Materialized Jira context key does not match/);

  const serializedCases = [
    ['different key', context => { context.key = 'APP-902'; }, /Serialized Jira context key does not match/],
    ['non-object root', () => 'not-an-object', /normalized context object/],
    ['non-string key', context => { context.key = 901; }, /key is missing or invalid/],
    ['non-normalized key', context => { context.key = 'app-901'; }, /key must already be normalized/],
    ['non-string required field', context => { context.title = null; }, /title is missing or invalid/],
    ['non-object attachment', context => { context.attachments = [null]; }, /attachment entry must be an object/],
    ['unsafe attachment byte total', context => {
      context.attachments = [
        { contentStatus: 'skipped', contentReason: 'bounded', contentBytes: Number.MAX_SAFE_INTEGER },
        { contentStatus: 'skipped', contentReason: 'bounded', contentBytes: 1 },
      ];
    }, /response byte total is invalid/],
    ['captured relative path', context => { context.attachments[0].localPath = 'relative.bin'; }, /file path or content hash is missing or invalid/],
    ['skipped without reason', context => {
      context.attachments[0].contentStatus = 'skipped';
      delete context.attachments[0].contentReason;
      delete context.attachments[0].localPath;
    }, /contentReason is missing/],
    ['non-object field', context => { context.customFields = [null]; }, /field entry must be an object/],
  ];
  for (const [label, mutate, expected] of serializedCases) {
    const fixture = capturedJiraContextFixture();
    fixture.context.toJSON = function toJSON() {
      const serialized = { ...this };
      delete serialized.toJSON;
      return mutate(serialized) ?? serialized;
    };
    assert.throws(() => jiraContextStore.writeJiraContextArtifacts(fixture.context, {
      kronosDir: path.join(tempRoot, `jira-serialized-${label.replace(/\s+/g, '-')}`),
      attachmentContents: fixture.attachmentContents,
    }), expected, label);
  }

  const undefinedSerialization = capturedJiraContextFixture();
  undefinedSerialization.context.toJSON = () => undefined;
  assert.throws(() => jiraContextStore.writeJiraContextArtifacts(undefinedSerialization.context, {
    kronosDir: path.join(tempRoot, 'jira-undefined-serialization'),
    attachmentContents: undefinedSerialization.attachmentContents,
  }), /could not be serialized safely/);
  const circularSerialization = capturedJiraContextFixture();
  circularSerialization.context.toJSON = function toJSON() {
    const serialized = { ...this };
    delete serialized.toJSON;
    serialized.circular = serialized;
    return serialized;
  };
  assert.throws(() => jiraContextStore.writeJiraContextArtifacts(circularSerialization.context, {
    kronosDir: path.join(tempRoot, 'jira-circular-serialization'),
    attachmentContents: circularSerialization.attachmentContents,
  }), /could not be serialized safely/);

  const oversized = capturedJiraContextFixture();
  oversized.context.description = 'x'.repeat(12 * 1024 * 1024);
  assert.throws(() => jiraContextStore.writeJiraContextArtifacts(oversized.context, {
    kronosDir: path.join(tempRoot, 'jira-oversized-serialization'),
    attachmentContents: oversized.attachmentContents,
  }), /Jira context JSON exceeds/);
});

test('Jira attachment artifact names and prompt boundaries remain deterministic at hostile limits', () => {
  for (const [label, filename, suffix] of [
    ['empty', '..', 'attachment-1'],
    ['long extension', `${'a'.repeat(220)}.fixture`, '.fixture'],
    ['long stem', 'a'.repeat(220), 'a'.repeat(180)],
  ]) {
    const fixture = capturedJiraContextFixture();
    fixture.context.attachments[0].filename = filename;
    const artifact = jiraContextStore.writeJiraContextArtifacts(fixture.context, {
      kronosDir: path.join(tempRoot, `jira-filename-${label.replace(/\s+/g, '-')}`),
      attachmentContents: fixture.attachmentContents,
    });
    assert.equal(path.basename(artifact.attachmentPaths[0]).endsWith(suffix), true, label);
    assert.equal(path.basename(artifact.attachmentPaths[0]).length <= 202, true, label);
  }

  const fixture = capturedJiraContextFixture();
  const defaultPrompt = jiraContextStore.buildJiraContextPrompt(fixture.context);
  assert.match(defaultPrompt, /BEGIN UNTRUSTED JIRA DATA/);
  const originalCreateHash = crypto.createHash;
  crypto.createHash = () => ({
    update() { return this; },
    digest() { return 'a'.repeat(64); },
  });
  try {
    const collision = `payload KRONOS_${'A'.repeat(24)} payload`;
    const prompt = jiraContextStore.buildJiraContextPrompt(fixture.context, collision);
    assert.match(prompt, new RegExp(`KRONOS_${'A'.repeat(24)}_X`));
  } finally {
    crypto.createHash = originalCreateHash;
  }
});

test('Jira fallback and global context budget stay useful, bounded, and explicit', () => {
  const fallback = jiraContext.buildFallbackJiraTicketContext('APP-10', {
    title: 'Cached ticket',
    description: 'Cached description',
    jira_url: 'https://operator:password@jira.example/browse/APP-10?token=secret',
    project: { key: 'APP' },
    type: 'Task',
    jira_status: 'Selected',
    priority: { name: 'Medium' },
    labels: ['cached'],
    fixVersion: { name: '2026.8' },
    attachments: [{ id: 'cached-1', filename: 'cached.msg', size: 20 }],
  }, [{ id: 'cached-comment', body: 'Cached comment', author_name: 'Operator' }], ['Provider read failed safely.']);
  assert.equal(fallback.url, 'https://jira.example/browse/APP-10');
  assert.equal(fallback.completeness.source, 'kronos-state-fallback');
  assert.equal(fallback.completeness.complete, false);
  assert.equal(fallback.completeness.attachmentsMetadataOnly, true);
  assert.equal(fallback.attachments[0].contentReason, 'not-fetched');
  assert.equal(fallback.comments[0].author, 'Operator');
  assert.match(fallback.completeness.warnings.join(' '), /cached Kronos ticket data/);
  assert.match(fallback.completeness.warnings.join(' '), /Provider read failed safely/);

  const largeFields = { summary: 'Bounded Jira context' };
  const names = { summary: 'Summary' };
  const schema = { summary: { type: 'string' } };
  for (let index = 0; index < 12; index += 1) {
    const id = `customfield_${20_000 + index}`;
    largeFields[id] = `${index}:` + 'x'.repeat(1_050_000);
    names[id] = `Large field ${index}`;
    schema[id] = { type: 'string', custom: true };
  }
  const bounded = jiraContext.normalizeJiraTicketContext('APP-11', {
    issue: { fields: largeFields, names, schema },
    comments: [],
    commentsComplete: true,
    attachmentContents: [],
    attachmentFetchCount: 0,
    attachmentResponseBytes: 0,
    warnings: [],
  });
  assert.equal(Buffer.byteLength(JSON.stringify(bounded, null, 2), 'utf8') <= 10 * 1024 * 1024, true);
  assert.equal(bounded.completeness.complete, false);
  assert.equal(bounded.completeness.truncatedFieldIds.length > 0, true);
  assert.match(bounded.completeness.warnings.join(' '), /global normalized artifact safety limit/i);
  assert.ok(bounded.customFields.some(field => field.value === '[Truncated by Kronos global context safety limit]'));
});

function jiraSnapshot(overrides = {}) {
  return {
    issues: [],
    fetchedAt: '2026-07-16T10:00:00.000Z',
    complete: true,
    warnings: [],
    pageCount: 1,
    responseBytes: 512,
    ...overrides,
  };
}

function capturedJiraContextFixture() {
  const bytes = Buffer.from('TRANSIENT-RAW-BYTES');
  const sourceSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const attachmentContents = [{
    index: 0,
    id: 'attachment-1',
    status: 'captured',
    responseBytes: bytes.length,
    sourceSha256,
    bytes,
  }];
  const context = jiraContext.normalizeJiraTicketContext('APP-901', {
    issue: {
      fields: {
        summary: 'Validated attachment publication',
        attachment: [{ id: 'attachment-1', filename: '../evidence.msg', size: bytes.length }],
      },
      names: { summary: 'Summary', attachment: 'Attachment' },
      schema: { summary: { type: 'string' }, attachment: { type: 'array', system: 'attachment' } },
    },
    comments: [],
    commentsComplete: true,
    commentPageCount: 1,
    commentResponseBytes: 2,
    attachmentContents,
    attachmentFetchCount: 1,
    attachmentResponseBytes: bytes.length,
    warnings: [],
    fetchedAt: '2026-07-16T12:00:00.000Z',
  });
  return { context, attachmentContents, bytes };
}

function jiraIssue(key, summary) {
  return {
    key,
    fields: {
      summary,
      issuetype: { name: 'Story' },
      priority: { name: 'Medium' },
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      project: { key: key.split('-')[0] },
      labels: [],
      attachment: [],
      updated: '2026-07-16T10:00:00.000Z',
    },
  };
}

function ticket(summary) {
  return {
    summary,
    type: 'Story',
    priority: 'Medium',
    jira_status: 'In Progress',
    source: 'jira',
    mr: null,
    build: null,
  };
}

function createGitProject(name, branch) {
  const projectRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(tempRoot, `${name}-`)));
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`, { mode: 0o600 });
  return projectRoot;
}
