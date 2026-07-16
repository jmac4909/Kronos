const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectCatalog = require('../out/services/projectCatalog.js');
const workSessions = require('../out/services/workSessionStore.js');
const { workSessionLifecycle } = require('../out/services/workSessionLifecycle.js');
const { sessionInventoryPresentation } = require('../out/services/sessionInventoryPresentation.js');
const {
  attentionProjectGroupIdentity,
  groupAttentionEntriesByProject,
} = require('../out/services/attentionPresentation.js');
const {
  normalizeClaudeTerminalLaunch,
  launchClaudeTerminal,
  claudePermissionModeLabel,
  CLAUDE_PERMISSION_MODES,
} = require('../out/services/claudeTerminalLauncher.js');
const {
  collectWorkTicketFilterOptions,
  workTicketMatchesFilter,
} = require('../out/services/workTicketFilters.js');
const { buildJiraWorkBoardHtml } = require('../out/services/jiraWorkBoardView.js');
const boardRuntime = require('../media/kronos-jira-work-board.js');

function ticket(overrides = {}) {
  return {
    summary: 'Payment reconciliation fails safely',
    type: 'Story',
    priority: 'High',
    jira_status: 'In Progress',
    jira_status_category: 'indeterminate',
    jira_project_key: 'ABC',
    source: 'jira',
    labels: ['payments', 'terminal-first'],
    mr: null,
    build: null,
    ...overrides,
  };
}

function workState(overrides = {}) {
  return {
    schemaVersion: 2,
    refreshedAt: '2026-07-15T12:00:00.000Z',
    projects: {},
    tickets: { 'ABC-123': ticket() },
    ...overrides,
  };
}

function createGitProject(t, branch = 'feature/payment-reconciliation') {
  const projectPath = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-feature-journey-project-')));
  fs.mkdirSync(path.join(projectPath, '.git'));
  fs.writeFileSync(path.join(projectPath, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  return projectPath;
}

test('explicit project journey keeps one stable identity across Work, Projects, Sessions, and Attention', t => {
  const projectPath = createGitProject(t);
  const kronosDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-feature-journey-state-')));
  t.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

  let state = projectCatalog.registerLocalProject(workState(), 'payments-api', projectPath);
  state = projectCatalog.setLocalProjectIntegrations(state, [{
    name: 'payments-api',
    nickname: 'Payments API',
    gitlabProject: 'group/payments-api',
    jenkinsUrl: 'https://jenkins.example/job/payments-api/',
    sonarProjectKey: 'payments-api',
    defaultBranch: 'main',
  }]);
  state = projectCatalog.setTicketLocalProject(state, 'ABC-123', 'payments-api');

  const projects = projectCatalog.listLocalProjects(state);
  assert.deepEqual(projects.map(project => ({
    name: project.name,
    displayName: project.displayName,
    path: project.path,
    branch: project.branch,
  })), [{
    name: 'payments-api',
    displayName: 'Payments API',
    path: fs.realpathSync.native(projectPath),
    branch: 'feature/payment-reconciliation',
  }]);
  assert.equal(state.tickets['ABC-123'].linked_local_project, 'payments-api');
  assert.equal(projectCatalog.projectConfigurationForTicket(state, state.tickets['ABC-123']).gitlab_project_path, 'group/payments-api');
  assert.equal(workTicketMatchesFilter('ABC-123', state.tickets['ABC-123'], {
    jiraProject: 'abc',
    localProject: 'PAYMENTS-API',
    label: 'payments',
    completion: 'active',
  }), true);

  const board = buildJiraWorkBoardHtml({
    state,
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });
  assert.match(board, /Project: Payments API/);
  assert.match(board, /<option value="payments-api">Payments API<\/option>/);
  assert.match(board, /feature\/payment-reconciliation/);

  let session = workSessions.createStandaloneWorkSession({
    title: 'Investigate payment reconciliation',
    projectName: 'payments-api',
    projectPath,
  }, { kronosDir, now: new Date('2026-07-15T12:01:00.000Z') });
  session = workSessions.addWorkSessionTicketContext(session.id, 'ABC-123', {
    kronosDir,
    now: new Date('2026-07-15T12:02:00.000Z'),
  });
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-payments',
    name: 'Claude @ feature/payment-reconciliation',
    cwd: projectPath,
  }, { kronosDir, now: new Date('2026-07-15T12:03:00.000Z') });
  const presentation = sessionInventoryPresentation(
    session,
    1,
    300_000,
    'feature/payment-reconciliation',
    'Payments API',
  );
  assert.equal(presentation.label, 'Payments API: Investigate payment reconciliation');
  assert.match(presentation.description, /Payments API @ feature\/payment-reconciliation/);
  assert.match(presentation.description, /1 Jira context/);
  assert.match(presentation.description, /1 terminal attached/);

  const groups = groupAttentionEntriesByProject([
    { id: 'gitlab-mr-72', session, ticketKey: 'ABC-123' },
    { id: 'jenkins-build-901', session, ticketKey: 'ABC-123' },
  ]);
  assert.deepEqual(groups.map(group => ({ key: group.identity.key, ids: group.entries.map(entry => entry.id) })), [{
    key: 'project:payments-api',
    ids: ['gitlab-mr-72', 'jenkins-build-901'],
  }]);
  assert.equal(attentionProjectGroupIdentity(session.projectName).projectName, 'payments-api');
});

test('project session stays ticket-free until context is explicit, then becomes monitoring eligible without changing kind', t => {
  const projectPath = createGitProject(t, 'feature/session-lifecycle');
  const kronosDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-session-journey-state-')));
  t.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));
  const options = { kronosDir, now: new Date('2026-07-15T13:00:00.000Z') };

  let session = workSessions.createStandaloneWorkSession({
    title: 'Project-only Claude',
    projectName: 'payments-api',
    projectPath,
  }, options);
  assert.equal(session.kind, 'standalone');
  assert.equal(Object.hasOwn(session, 'ticketKey'), false);
  assert.deepEqual(session.ticketKeys, []);
  assert.deepEqual(workSessions.workSessionTicketMetadata(session), {});
  assert.deepEqual(workSessionLifecycle(session, 0), {
    management: 'active',
    terminal: 'none',
    monitoring: 'ineligible',
    canInsertContext: false,
    canPollProviders: false,
    canReconnect: true,
  });

  session = workSessions.addWorkSessionTicketContext(session.id, 'ABC-123', options);
  session = workSessions.addWorkSessionTicketContext(session.id, 'ABC-123', options);
  assert.equal(session.kind, 'standalone');
  assert.equal(Object.hasOwn(session, 'ticketKey'), false);
  assert.deepEqual(session.ticketKeys, ['ABC-123']);
  assert.equal(session.monitoring.enabled, true);
  assert.equal(workSessions.getWorkSessionForTicketContext('ABC-123', options).id, session.id);

  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-project-only',
    name: 'Project-only terminal',
    cwd: projectPath,
  }, options);
  assert.deepEqual(workSessionLifecycle(session, 1), {
    management: 'active',
    terminal: 'attached',
    monitoring: 'running',
    canInsertContext: true,
    canPollProviders: true,
    canReconnect: false,
  });
  session = workSessions.detachWorkSessionTerminal(session.id, 'terminal-project-only', 'operator detach', options);
  assert.equal(workSessionLifecycle(session, 0).terminal, 'detached');
  assert.equal(workSessionLifecycle(session, 0).canPollProviders, true);
  session = workSessions.closeWorkSession(session.id, options);
  assert.equal(workSessionLifecycle(session, 0).management, 'stopped');
  assert.equal(workSessionLifecycle(session, 0).canPollProviders, false);
});

test('manifest Claude modes and validated launcher commands cannot drift apart', t => {
  const projectPath = createGitProject(t, 'feature/launch-policy');
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const permissionSetting = manifest.contributes.configuration.properties['kronos.claudePermissionMode'];
  assert.deepEqual(permissionSetting.enum, [...CLAUDE_PERMISSION_MODES]);
  assert.equal(permissionSetting.enumDescriptions.length, CLAUDE_PERMISSION_MODES.length);
  assert.deepEqual(
    manifest.contributes.configuration.properties['kronos.claudeLaunchCwd'].enum,
    ['ticketProject', 'workspace', 'home'],
  );

  const commands = [];
  const factory = {
    createTerminal(options) {
      return {
        options,
        show(preserveFocus) { commands.push(['show', preserveFocus]); },
        sendText(command, shouldExecute) { commands.push(['sendText', command, shouldExecute]); },
      };
    },
  };
  for (const mode of CLAUDE_PERMISSION_MODES) {
    const launchInput = {
      command: 'claude --model opus --effort high',
      name: 'Kronos Claude',
      cwd: projectPath,
      permissionMode: mode,
    };
    const normalized = normalizeClaudeTerminalLaunch(launchInput);
    assert.equal(normalized.permissionMode, mode);
    assert.ok(claudePermissionModeLabel(mode));
    const result = launchClaudeTerminal(factory, launchInput);
    assert.equal(result.configuration.permissionMode, mode);
    const submitted = commands.at(-1);
    assert.equal(submitted[0], 'sendText');
    assert.equal(submitted[2], true);
    if (mode === 'default') { assert.doesNotMatch(submitted[1], /permission|dangerously/); }
    else if (mode === 'bypassPermissions') { assert.match(submitted[1], /--dangerously-skip-permissions$/); }
    else { assert.match(submitted[1], new RegExp(`--permission-mode ${mode}$`)); }
  }

  const commandCount = commands.length;
  assert.throws(
    () => launchClaudeTerminal(factory, { command: 'claude --dangerously-skip-permissions', cwd: projectPath }),
    /approved interactive|permission mode/i,
  );
  assert.equal(commands.length, commandCount, 'raw permission flags must fail before terminal creation');
});

test('unregistering a project clears launch authority but preserves Jira namespace and provider-only metadata', t => {
  const projectPath = createGitProject(t, 'feature/unregister');
  let state = projectCatalog.registerLocalProject(workState(), 'payments-api', projectPath);
  state = projectCatalog.setLocalProjectIntegrations(state, [{
    name: 'payments-api',
    nickname: 'Payments API',
    gitlabProject: 'group/payments-api',
    jenkinsUrl: 'https://jenkins.example/job/payments-api/',
  }]);
  state = projectCatalog.setTicketLocalProject(state, 'ABC-123', 'payments-api');

  const unregistered = projectCatalog.replaceRegisteredLocalProjects(state, []);
  assert.deepEqual(projectCatalog.listLocalProjects(unregistered), []);
  assert.equal(unregistered.projects['payments-api'].path, undefined);
  assert.equal(unregistered.projects['payments-api'].display_name, 'Payments API');
  assert.equal(unregistered.projects['payments-api'].config.gitlab_project_path, 'group/payments-api');
  assert.equal(unregistered.tickets['ABC-123'].linked_local_project, undefined);
  assert.equal(unregistered.tickets['ABC-123'].jira_project_key, 'ABC');
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(unregistered, unregistered.tickets['ABC-123']), {});
  assert.equal(workTicketMatchesFilter('ABC-123', unregistered.tickets['ABC-123'], {
    jiraProject: 'ABC',
    completion: 'all',
  }), true);
  assert.equal(workTicketMatchesFilter('ABC-123', unregistered.tickets['ABC-123'], {
    localProject: 'payments-api',
    completion: 'all',
  }), false);
  assert.deepEqual(collectWorkTicketFilterOptions(unregistered.tickets), {
    jiraProjects: ['ABC'],
    localProjects: [],
    labels: ['payments', 'terminal-first'],
    jiraStatuses: ['In Progress'],
  });
});

test('Work and Jira board free-text search index the same rich ticket evidence', () => {
  const richTicket = ticket({
    updated: '2026-07-15T15:45:00.000Z',
    description: 'Preserve the immutable provider audit.',
    attachments: [{ filename: 'payment-failure.msg', size: 1024, mimeType: 'application/vnd.ms-outlook' }],
    linked_local_project: 'payments-api',
    mr: {
      iid: 72,
      title: 'Fix payment reconciliation',
      author: 'Payment Maintainer',
      state: 'opened',
      review_status: 'changes_requested',
      source_branch: 'feature/payment-reconciliation',
      target_branch: 'main',
      url: 'https://gitlab.example/group/payments-api/-/merge_requests/72',
    },
    build: { number: 901, status: 'UNSTABLE', url: 'https://jenkins.example/job/payments-api/901/' },
  });
  const state = workState({
    projects: { 'payments-api': { path: '/workspace/payments-api', display_name: 'Payments API', config: {} } },
    tickets: { 'ABC-123': richTicket },
  });
  const board = buildJiraWorkBoardHtml({
    state,
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });
  const searchMatch = /data-ticket="ABC-123"[^>]*data-search="([^"]*)"/.exec(board);
  assert.ok(searchMatch);
  const card = {
    getAttribute(name) {
      return {
        'data-completed': 'false',
        'data-status': 'in progress',
        'data-jira-project': 'abc',
        'data-local-project': 'payments-api',
        'data-labels': JSON.stringify(['payments', 'terminal-first']),
        'data-search': searchMatch[1],
      }[name] || '';
    },
  };
  for (const query of [
    'ABC-123', 'immutable provider audit', '2026-07-15', 'payment-failure.msg',
    'vnd.ms-outlook', 'payments-api', '72', 'Payment Maintainer',
    'feature/payment-reconciliation', 'changes_requested', '901', 'unstable',
  ]) {
    assert.equal(workTicketMatchesFilter('ABC-123', richTicket, { query, completion: 'all' }), true, `Work query ${query}`);
    assert.equal(boardRuntime.cardMatchesFilters(card, {
      query: query.toLocaleLowerCase(),
      status: '',
      jiraProject: '',
      localProject: '',
      label: '',
      hideDone: false,
    }, false), true, `board query ${query}`);
  }
  assert.match(searchMatch[1], /payments api/, 'the visual board also indexes the project nickname');
});
