const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const {
  attentionProjectGroupIdentity,
  attentionProviderIconId,
  attentionSeverityColorId,
  groupAttentionEntriesByProject,
} = require('../out/services/attentionPresentation.js');
const {
  registeredProjectActionInventory,
} = require('../out/services/projectInventoryPresentation.js');
const {
  JIRA_WORK_BOARD_ACTIONS,
  buildJiraWorkBoardHtml,
} = require('../out/services/jiraWorkBoardView.js');
const {
  workTicketMatchesFilter,
} = require('../out/services/workTicketFilters.js');
const {
  buildTicketWorkspaceHtml,
} = require('../out/services/ticketWorkspaceView.js');
const {
  buildDoctorPanelHtml,
  buildSetupPanelHtml,
} = require('../out/services/operationsPanelView.js');

test('primary button hierarchy keeps Work, Sessions, Projects, and Attention focused', () => {
  assert.deepEqual(manifest.contributes.views.kronos, [
    { id: 'kronosWork', name: 'Work' },
    { id: 'kronosSessions', name: 'Sessions' },
    { id: 'kronosProjects', name: 'Projects' },
    { id: 'kronosAttention', name: 'Attention' },
  ]);
  const expected = {
    kronosWork: ['kronos.refreshTickets', 'kronos.openJiraBoard', 'kronos.filterWork'],
    kronosSessions: ['kronos.newClaudeSession', 'kronos.manageActiveTerminal'],
    kronosProjects: ['kronos.refreshProjects', 'kronos.registerWorkspaceProject'],
    kronosAttention: ['kronos.pollManagedWorkSessions'],
  };
  for (const [view, commands] of Object.entries(expected)) {
    const primary = manifest.contributes.menus['view/title']
      .filter(item => item.when === `view == ${view}` && item.group.startsWith('navigation@'))
      .sort((left, right) => left.group.localeCompare(right.group))
      .map(item => item.command);
    assert.deepEqual(primary, commands);
    assert.ok(primary.length <= 3, `${view} exceeded the three-action primary hierarchy`);
  }
});

test('discovery, setup, and project management each retain one canonical UI home', () => {
  const titleMenus = manifest.contributes.menus['view/title'];
  assert.deepEqual(titleMenus.filter(item => item.command === 'kronos.discoverProjectFolders'), []);
  assert.deepEqual(titleMenus.filter(item => item.command === 'kronos.registerWorkspaceProject'), [{
    command: 'kronos.registerWorkspaceProject',
    when: 'view == kronosProjects',
    group: 'navigation@2',
  }]);
  assert.deepEqual(titleMenus.filter(item => item.command === 'kronos.setup'), [{
    command: 'kronos.setup',
    when: 'view == kronosWork',
    group: 'work@5',
  }]);
  assert.deepEqual(titleMenus.filter(item => item.command === 'kronos.doctor'), []);
  const commandIds = new Set(manifest.contributes.commands.map(command => command.command));
  assert.equal(commandIds.has('kronos.discoverProjectFolders'), false, 'folder discovery belongs inside guided Setup');
  for (const command of ['kronos.registerWorkspaceProject', 'kronos.setup', 'kronos.doctor']) {
    assert.equal(commandIds.has(command), true, `${command} must remain available from its canonical flow or command palette`);
  }
});

test('registered project actions start ticket-free Claude before read-only and provider actions', () => {
  assert.deepEqual(registeredProjectActionInventory(), [
    { label: 'Start Claude', icon: 'terminal', command: 'kronos.newClaudeSession', description: 'in this project' },
    { label: 'Git state & branches', icon: 'git-branch', command: 'kronos.openProjectGitStatus', description: 'inspect and switch in Source Control' },
    { label: 'Review local changes', icon: 'symbol-keyword', command: 'kronos.insertProjectGitContext', description: 'for terminal context' },
    { label: 'Open merge request', icon: 'git-merge', command: 'kronos.openProjectMergeRequest', description: 'in GitLab' },
    { label: 'Review merge request', icon: 'git-merge', command: 'kronos.insertProjectGitLabContext', description: 'for terminal context' },
    { label: 'Review build & quality', icon: 'beaker', command: 'kronos.insertProjectCiContext', description: 'for terminal context' },
    { label: 'Configure integrations', icon: 'settings-gear', command: 'kronos.configureProjectIntegrations', description: 'GitLab, Jenkins, SonarQube' },
    { label: 'Rename project', icon: 'edit', command: 'kronos.renameLocalProject' },
  ]);
  const commands = registeredProjectActionInventory().map(action => action.command);
  assert.equal(commands.includes('kronos.startClaudeForTicket'), false);
  assert.equal(new Set(commands).size, commands.length);
  assert.ok(Object.isFrozen(registeredProjectActionInventory()));
  assert.ok(registeredProjectActionInventory().every(action => Object.isFrozen(action)));
  const projectInline = manifest.contributes.menus['view/item/context']
    .filter(item => item.when === 'viewItem == registered_project' && item.group.startsWith('inline@'))
    .sort((left, right) => left.group.localeCompare(right.group))
    .map(item => item.command);
  assert.deepEqual(projectInline, ['kronos.newClaudeSession']);
});

test('row context menus contain only actions scoped to the selected row', () => {
  const itemMenus = manifest.contributes.menus['view/item/context'];
  const inlineMenusByContext = new Map();
  for (const menu of itemMenus.filter(item => item.group.startsWith('inline@'))) {
    inlineMenusByContext.set(menu.when, [...(inlineMenusByContext.get(menu.when) || []), menu]);
  }
  for (const [context, inlineMenus] of inlineMenusByContext) {
    assert.equal(inlineMenus.length, 1, `${context} exposes more than one inline row action`);
  }
  const ticketCommands = itemMenus
    .filter(item => item.when === 'viewItem == work_ticket')
    .map(item => item.command);
  assert.deepEqual(ticketCommands, [
    'kronos.openTicketWorkspace',
    'kronos.startClaudeForTicket',
    'kronos.chooseTicketProject',
    'kronos.insertJiraContext',
    'kronos.insertGitLabContext',
    'kronos.insertCiContext',
  ]);
  assert.equal(ticketCommands.includes('kronos.manageActiveTerminal'), false);
  assert.equal(ticketCommands.includes('kronos.openPromptLibrary'), false);
  const ticketInline = itemMenus
    .filter(item => item.when === 'viewItem == work_ticket' && item.group.startsWith('inline@'));
  assert.deepEqual(ticketInline.map(item => item.command), ['kronos.startClaudeForTicket']);
  assert.equal(itemMenus.find(item => item.command === 'kronos.openTicketWorkspace' && item.when === 'viewItem == work_ticket').group, 'navigation@1');

  const projectCommands = itemMenus
    .filter(item => item.when === 'viewItem == registered_project')
    .map(item => item.command);
  assert.equal(projectCommands.includes('kronos.openPromptLibrary'), false);
  assert.deepEqual(
    projectCommands,
    registeredProjectActionInventory().map(action => action.command),
  );
  const commandsById = new Map(manifest.contributes.commands.map(command => [command.command, command]));
  for (const menu of itemMenus) {
    const shortTitle = commandsById.get(menu.command)?.shortTitle;
    assert.equal(typeof shortTitle, 'string', `${menu.command} needs a concise menu label`);
    assert.doesNotMatch(shortTitle, /^Kronos:/, `${menu.command} repeats the product name in a row menu`);
    assert.ok(shortTitle.length <= 28, `${menu.command} has an overly long row-menu label`);
  }
  assert.equal(commandsById.get('kronos.reattachWorkSessionTerminal').shortTitle, 'Connect Focused Terminal');
  assert.equal(commandsById.get('kronos.detachWorkSessionTerminal').shortTitle, 'Disconnect Terminal');
  assert.equal(commandsById.get('kronos.acknowledgeAttention').shortTitle, 'Clear from Attention');
  assert.equal(commandsById.get('kronos.insertAttentionEventContext').shortTitle, 'Use Event in Prompt');
  assert.equal(commandsById.get('kronos.insertJiraContext').shortTitle, 'Review Jira Ticket');
  assert.equal(commandsById.get('kronos.insertGitLabContext').shortTitle, 'Review Merge Request');
  assert.equal(commandsById.get('kronos.insertCiContext').shortTitle, 'Review Build & Quality');
  assert.equal(commandsById.get('kronos.openProjectGitStatus').shortTitle, 'Git State & Branches');
  assert.equal(commandsById.get('kronos.insertProjectGitContext').shortTitle, 'Review Local Changes');
  assert.equal(commandsById.get('kronos.searchLocalEvidence').shortTitle, 'Search');
  assert.equal(commandsById.get('kronos.pollManagedWorkSessions').shortTitle, 'Check Updates');
  assert.equal(commandsById.get('kronos.pauseWorkSessionMonitoring').shortTitle, 'Pause Updates');
  assert.equal(commandsById.get('kronos.resumeWorkSessionMonitoring').shortTitle, 'Resume Updates');
  assert.equal(commandsById.get('kronos.closeWorkSession').shortTitle, 'Stop Tracking');
  assert.equal(commandsById.get('kronos.removeWorkSession').shortTitle, 'Remove from Kronos');
  const removeSessionMenu = itemMenus.find(item => item.command === 'kronos.removeWorkSession');
  assert.equal(removeSessionMenu.when, 'viewItem == work_session_closed || viewItem == standalone_session_closed');
  assert.doesNotMatch(
    [...commandsById.values()].map(command => command.shortTitle || '').join('\n'),
    /\bMR Context\b|Working Changes|Build Context/,
  );
  assert.doesNotMatch(
    [...commandsById.values()].map(command => command.title).join('\n'),
    /Poll Managed|Local Sessions and Evidence|Private Local Handoff|Guided Settings|Audit Retained|Working Changes/,
  );

  const attentionInline = itemMenus
    .filter(item => item.group.startsWith('inline@') && String(item.when).includes('attention_'))
    .sort((left, right) => left.group.localeCompare(right.group));
  assert.deepEqual(attentionInline.map(item => item.command), ['kronos.openProvider']);
  assert.equal(attentionInline[0].group, 'inline@1');
  const eventContextMenu = itemMenus.find(item => item.command === 'kronos.insertAttentionEventContext');
  assert.equal(eventContextMenu.when, 'viewItem =~ /^attention_(provider|repair).*_event$/');
  assert.equal(eventContextMenu.group, 'context@1');
  assert.equal(itemMenus.find(item => item.command === 'kronos.acknowledgeAttention').group, 'management@1');
});

test('Attention group identity is local-project-only and collision-safe for unassigned work', () => {
  assert.deepEqual(attentionProjectGroupIdentity('  Kronos\nExtension  '), {
    key: 'project:Kronos Extension',
    id: 'attention-group:project:Kronos Extension',
    label: 'Kronos Extension',
    projectName: 'Kronos Extension',
  });
  const unassigned = {
    key: 'unassigned-project',
    id: 'attention-group:unassigned-project',
    label: 'Unassigned project',
    projectName: undefined,
  };
  assert.deepEqual(attentionProjectGroupIdentity(undefined), unassigned);
  assert.deepEqual(attentionProjectGroupIdentity(' \n '), unassigned);
  const projectNamedLikeFallback = attentionProjectGroupIdentity('unassigned-project');
  assert.equal(projectNamedLikeFallback.key, 'project:unassigned-project');
  assert.notEqual(projectNamedLikeFallback.key, unassigned.key);
  assert.notEqual(projectNamedLikeFallback.id, unassigned.id);
  const groups = groupAttentionEntriesByProject([
    { id: 'a', session: { projectName: 'Kronos' }, ticketKey: 'ABC-123' },
    { id: 'b', session: { projectName: 'Kronos' }, ticketKey: 'OTHER-9' },
    { id: 'c', session: { projectName: 'Payments' }, ticketKey: 'ABC-123' },
    { id: 'd', ticketKey: 'ABC-123' },
  ]);
  assert.deepEqual(groups.map(group => ({
    key: group.identity.key,
    ids: group.entries.map(entry => entry.id),
  })), [
    { key: 'project:Kronos', ids: ['a', 'b'] },
    { key: 'project:Payments', ids: ['c'] },
    { key: 'unassigned-project', ids: ['d'] },
  ]);
});

test('provider glyphs stay distinct while all Attention severities share green yellow red state colors', () => {
  assert.deepEqual({
    gitlab: attentionProviderIconId('gitlab'),
    jenkins: attentionProviderIconId('jenkins'),
    sonar: attentionProviderIconId('sonar'),
  }, {
    gitlab: 'git-pull-request',
    jenkins: 'server-process',
    sonar: 'shield',
  });
  for (const source of ['jira', 'kronos', 'operator']) {
    assert.equal(attentionProviderIconId(source), undefined);
  }
  assert.deepEqual(Object.fromEntries([
    'information',
    'warning',
    'failure',
    'recovery',
    'partial',
    'blocked',
  ].map(severity => [severity, attentionSeverityColorId(severity)])), {
    information: 'charts.green',
    warning: 'charts.yellow',
    failure: 'charts.red',
    recovery: 'charts.green',
    partial: 'charts.yellow',
    blocked: 'charts.red',
  });
});

test('rich Jira filtering searches every useful field and composes independent namespaces', () => {
  const richTicket = ticket('In Progress', {
    summary: 'Refresh customer cache',
    description: 'Preserve immutable audit entries',
    type: 'Story',
    priority: 'Critical',
    jira_status_category: 'indeterminate',
    jira_project_key: 'ABC',
    linked_local_project: 'cache-service',
    updated: '2026-07-15T09:30:00.000Z',
    labels: ['terminal-first', 'customer-impact'],
    attachments: [{ filename: 'customer-cache-analysis.msg', size: 512, mimeType: 'application/vnd.ms-outlook' }],
    mr: {
      iid: 72,
      title: 'Bound provider cache refresh',
      state: 'opened',
      review_status: 'changes_requested',
      author: 'Cache Maintainer',
      source_branch: 'feature/cache-refresh',
      target_branch: 'release/2026-07',
    },
    build: { number: '901', status: 'UNSTABLE' },
  });
  for (const query of [
    'ABC-123', 'customer cache', 'immutable audit', 'story', 'critical', 'in progress',
    'indeterminate', 'jira', 'abc', 'cache-service', 'customer-impact', 'provider cache',
    '2026-07-15', 'customer-cache-analysis', 'vnd.ms-outlook', '72', 'cache maintainer',
    'opened', 'changes_requested', 'feature/cache', 'release/2026', 'unstable', '901',
  ]) {
    assert.equal(
      workTicketMatchesFilter('ABC-123', richTicket, { query, completion: 'all' }),
      true,
      `query ${query} should match its normalized Jira evidence field`,
    );
  }
  assert.equal(workTicketMatchesFilter('ABC-123', richTicket, {
    jiraProject: 'abc',
    localProject: 'CACHE-SERVICE',
    label: 'Customer-Impact',
    jiraStatus: 'in progress',
    completion: 'active',
  }), true);
  assert.equal(workTicketMatchesFilter('ABC-123', richTicket, { jiraProject: 'cache-service', completion: 'all' }), false);
  assert.equal(workTicketMatchesFilter('ABC-123', richTicket, { localProject: 'ABC', completion: 'all' }), false);
  assert.equal(workTicketMatchesFilter('ABC-123', richTicket, { query: 'not present', completion: 'all' }), false);
});

test('Jira board keeps filtering and launch controls while ticket workspace owns detailed context controls', () => {
  const fixtureTicket = ticket('In Progress', {
    jira_project_key: 'ABC',
    linked_local_project: 'kronos',
    labels: ['terminal-first'],
  });
  const board = buildJiraWorkBoardHtml({
    state: workState({ 'ABC-123': fixtureTicket }),
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });
  for (const id of [
    'jira-board-search', 'jira-board-status', 'jira-board-jira-project',
    'jira-board-local-project', 'jira-board-label', 'jira-board-hide-done', 'jira-board-reset',
  ]) {
    assert.match(board, new RegExp(`id="${id}"`));
  }
  assert.deepEqual(JIRA_WORK_BOARD_ACTIONS, [
    'refreshTickets', 'openDoctor', 'openTicketWorkspace', 'startClaudeForTicket', 'chooseTicketProject',
  ]);
  for (const action of ['manageActiveTerminal', 'focusWorkSessionTerminal', 'insertJiraContext', 'insertGitLabContext', 'insertCiContext']) {
    assert.doesNotMatch(board, new RegExp(`data-action="${action}"`));
  }
  assert.match(board, /\.jira-board-column \{[^}]*max-width: 520px/);

  const workspace = buildTicketWorkspaceHtml({
    ticketKey: 'ABC-123',
    ticket: fixtureTicket,
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
    localProject: {
      name: 'kronos',
      displayName: 'Kronos Extension',
      path: '/workspace/kronos',
      branch: 'feature/contracts',
      detached: false,
      available: true,
    },
  });
  assert.ok(workspace.indexOf('workspace-action-label">Terminal') < workspace.indexOf('workspace-action-label">Add context'));
  assert.deepEqual(extractActions(workspace), [
    'startClaudeForTicket', 'manageActiveTerminal', 'chooseTicketProject',
    'insertJiraContext', 'insertGitLabContext', 'insertCiContext', 'openPromptLibrary',
  ]);
  assert.match(workspace, />Start Claude<[^]*>Connect focused terminal<[^]*>Change project</);
  assert.match(workspace, />Review Jira ticket<[^]*>Review merge request<[^]*>Review build &amp; quality<[^]*>Add team prompt</);
  assert.doesNotMatch(workspace, /Terminal-first ticket workspace|Manage Focused Terminal|Insert \[|Provider Bindings|content-addressed artifact/);
  assert.match(workspace, /Kronos Extension/);
  assert.match(workspace, /feature\/contracts/);
  assert.doesNotMatch(workspace, /data-action="refreshTickets"/);

  const connectedWorkspace = buildTicketWorkspaceHtml({
    ticketKey: 'ABC-123',
    ticket: fixtureTicket,
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
    liveTerminalCount: 1,
    workSession: {
      schemaVersion: 1,
      id: 'session-abc-123',
      kind: 'ticket',
      ticketKey: 'ABC-123',
      title: 'Terminal-first story',
      status: 'active',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      terminals: [],
      providerBindings: [],
      artifacts: [],
      monitoring: { enabled: true },
    },
  });
  assert.deepEqual(extractActions(connectedWorkspace).slice(0, 3), [
    'focusWorkSessionTerminal', 'startClaudeForTicket', 'chooseTicketProject',
  ]);
  assert.match(connectedWorkspace, /class="kronos-button primary" data-action="focusWorkSessionTerminal"/);
  assert.match(connectedWorkspace, />Open terminal<[^]*>Start another Claude</);
  assert.doesNotMatch(connectedWorkspace, /data-action="manageActiveTerminal"/);

  const stoppedWorkspace = buildTicketWorkspaceHtml({
    ticketKey: 'ABC-123',
    ticket: fixtureTicket,
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
    liveTerminalCount: 0,
    workSession: {
      schemaVersion: 1,
      id: 'session-abc-123',
      kind: 'ticket',
      ticketKey: 'ABC-123',
      title: 'Terminal-first story',
      status: 'closed',
      createdAt: '2026-07-15T12:00:00.000Z',
      updatedAt: '2026-07-15T12:00:00.000Z',
      terminals: [],
      providerBindings: [],
      artifacts: [],
      monitoring: { enabled: false },
    },
  });
  assert.deepEqual(extractActions(stoppedWorkspace).slice(0, 3), [
    'manageActiveTerminal', 'startClaudeForTicket', 'chooseTicketProject',
  ]);
  assert.match(stoppedWorkspace, /class="kronos-button primary" data-action="manageActiveTerminal"/);
  assert.match(stoppedWorkspace, />Connect focused terminal<[^]*>Start another Claude/);
  assert.match(stoppedWorkspace, />Tracking stopped</);
  assert.doesNotMatch(stoppedWorkspace, /data-action="focusWorkSessionTerminal"/);
});

test('non-Jira ticket workspaces omit Jira insertion without weakening terminal ownership', () => {
  const workspace = buildTicketWorkspaceHtml({
    ticketKey: 'LOCAL-1',
    ticket: ticket('Open', { source: 'manual', jira_project_key: undefined }),
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
  });
  assert.deepEqual(extractActions(workspace), [
    'startClaudeForTicket', 'manageActiveTerminal', 'chooseTicketProject',
    'insertGitLabContext', 'insertCiContext', 'openPromptLibrary',
  ]);
  assert.match(workspace, /connect a terminal you already own/);
  assert.match(workspace, /Actions run only when selected/);
  assert.doesNotMatch(workspace, /data-action="insertJiraContext"/);
  assert.doesNotMatch(workspace, /No linked merge request|No linked build/);
  assert.doesNotMatch(workspace, /Provider updates|Saved context|Connected sources/);
  assert.match(workspace, /class="workspace-grid single kronos-section"/);
  assert.match(workspace, />Review merge request</);
  assert.match(workspace, />Review build &amp; quality</);
});

test('Setup and Doctor preserve guided navigation and hide repair controls from healthy checks', () => {
  const runtime = {
    platformLabel: 'test platform',
    privateStatePath: '/private/kronos',
    providerEnvPath: '/private/kronos/providers.env',
  };
  const setup = buildSetupPanelHtml({
    steps: [{
      title: 'Project folders',
      detail: 'Choose the roots that contain local repositories.',
      status: 'warn',
      action: 'chooseDiscoveryFolders',
      actionLabel: 'Choose Folders',
    }],
    runtime,
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
  });
  assert.deepEqual(extractActions(setup), ['openDoctor', 'refreshPanel', 'chooseDiscoveryFolders']);
  assert.match(setup, /Nothing starts automatically/);
  assert.match(setup, /1 item needs attention/);
  assert.doesNotMatch(setup, /operations-hero|Setup status/);

  const doctor = buildDoctorPanelHtml({
    checks: [
      { name: 'Healthy', detail: 'Ready.', status: 'pass', action: 'mustNotRender', actionLabel: 'Repair Healthy' },
      { name: 'Review', detail: 'Needs review.', status: 'warn', action: 'reviewSetup', actionLabel: 'Review Setup' },
      { name: 'Blocked', detail: 'Needs setup.', status: 'fail', action: 'repairSetup', actionLabel: 'Repair Setup' },
    ],
    runtime,
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
  });
  assert.deepEqual(extractActions(doctor), ['refreshPanel', 'openSetup', 'repairSetup', 'reviewSetup']);
  assert.ok(doctor.indexOf('<h2>Blocked</h2>') < doctor.indexOf('<h2>Review</h2>'));
  assert.ok(doctor.indexOf('<h2>Review</h2>') < doctor.indexOf('<h2>Healthy</h2>'));
  assert.doesNotMatch(doctor, /Repair Healthy|data-action="mustNotRender"/);
  assert.match(doctor, /\.doctor-summary \{[^}]*display: flex[^}]*flex-wrap: wrap/);
  assert.match(doctor, /\.doctor-list \{[^}]*grid-template-columns: repeat\(auto-fit, minmax\(320px, 1fr\)\)/);
  assert.match(doctor, /@media \(max-width: 720px\)/);
  assert.match(doctor, /never launches Claude, runs a repair, executes a project command, or displays credential values/);
});

test('verification matrix keeps every shipped feature group under named automated evidence', () => {
  const matrix = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'verification-matrix.json'), 'utf8'));
  assert.deepEqual(matrix.featureGroups.map(group => group.id).sort(), [
    'context-basket',
    'context-placement',
    'handoff-and-branch-profiles',
    'identity-and-work',
    'local-evidence-search',
    'maintainability-and-orchestration',
    'monitoring-and-attention',
    'persistence-and-migration',
    'projects-and-git',
    'provider-health-visibility',
    'provider-variants',
    'scale-and-accessibility',
    'security-and-release',
    'setup-and-failures',
    'terminal-and-sessions',
  ]);
  const knownHumanGates = new Set(matrix.humanGates.map(gate => gate.id));
  for (const group of matrix.featureGroups) {
    assert.ok(group.goals.length > 0, `${group.id} needs roadmap goals`);
    assert.ok(group.automated.length > 0, `${group.id} needs named automated evidence`);
    assert.ok(group.automated.every(evidence => fs.existsSync(path.join(root, evidence.file))));
    assert.ok(group.humanGates.every(gate => knownHumanGates.has(gate)));
  }
  assert.deepEqual([...knownHumanGates].sort(), [
    'live-providers', 'multi-window', 'operator-terminal', 'real-vscode', 'windows-native',
  ]);
  assert.ok(matrix.humanGates.every(gate => gate.status === 'required'));
});

function ticket(status, overrides = {}) {
  return {
    summary: 'Terminal-first story',
    description: 'Use bounded provider evidence.',
    type: 'Story',
    priority: 'High',
    jira_status: status,
    jira_project_key: 'ABC',
    source: 'jira',
    labels: [],
    mr: null,
    build: null,
    ...overrides,
  };
}

function workState(tickets) {
  return {
    schemaVersion: 2,
    refreshedAt: '2026-07-15T12:00:00.000Z',
    projects: {
      kronos: {
        path: '/workspace/kronos',
        display_name: 'Kronos Extension',
        config: { repo_name: 'kronos' },
      },
    },
    tickets,
  };
}

function extractActions(html) {
  return [...html.matchAll(/data-action="([A-Za-z][A-Za-z0-9]*)"/g)].map(match => match[1]);
}
