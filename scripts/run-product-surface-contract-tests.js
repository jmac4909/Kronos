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
    group: 'work@4',
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
    { label: 'Start Claude in project', icon: 'terminal', command: 'kronos.newClaudeSession', description: 'no Jira ticket' },
    { label: 'View Git status and diff', icon: 'diff', command: 'kronos.openProjectGitStatus', description: 'read-only' },
    { label: 'Insert working diff in context', icon: 'symbol-keyword', command: 'kronos.insertProjectGitContext', description: 'non-submitting' },
    { label: 'Open merge request page', icon: 'git-merge', command: 'kronos.openProjectMergeRequest' },
    { label: 'Insert MR evidence', icon: 'git-merge', command: 'kronos.insertProjectGitLabContext' },
    { label: 'Insert Jenkins / Sonar evidence', icon: 'beaker', command: 'kronos.insertProjectCiContext' },
    { label: 'Configure provider polling', icon: 'settings-gear', command: 'kronos.configureProjectIntegrations' },
    { label: 'Set project nickname', icon: 'edit', command: 'kronos.renameLocalProject', description: 'optional; identity and links stay unchanged' },
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
  assert.deepEqual(projectInline, ['kronos.newClaudeSession', 'kronos.insertProjectGitContext']);
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
  for (const action of ['manageActiveTerminal', 'insertJiraContext', 'insertGitLabContext', 'insertCiContext']) {
    assert.doesNotMatch(board, new RegExp(`data-action="${action}"`));
  }

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
  assert.ok(workspace.indexOf('workspace-action-label">Terminal') < workspace.indexOf('workspace-action-label">Context'));
  assert.deepEqual(extractActions(workspace), [
    'chooseTicketProject', 'startClaudeForTicket', 'manageActiveTerminal',
    'insertJiraContext', 'insertGitLabContext', 'insertCiContext',
  ]);
  assert.match(workspace, /Kronos Extension/);
  assert.match(workspace, /feature\/contracts/);
  assert.doesNotMatch(workspace, /data-action="refreshTickets"/);
});

test('non-Jira ticket workspaces omit Jira insertion without weakening terminal ownership', () => {
  const workspace = buildTicketWorkspaceHtml({
    ticketKey: 'LOCAL-1',
    ticket: ticket('Open', { source: 'manual', jira_project_key: undefined }),
    nonce: 'abcdef1234567890',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
  });
  assert.deepEqual(extractActions(workspace), [
    'chooseTicketProject', 'startClaudeForTicket', 'manageActiveTerminal',
    'insertGitLabContext', 'insertCiContext',
  ]);
  assert.match(workspace, /attach one you already own/);
  assert.match(workspace, /never press Enter/);
  assert.doesNotMatch(workspace, /data-action="insertJiraContext"/);
});

test('Setup and Doctor preserve guided navigation and hide repair controls from healthy checks', () => {
  const runtime = {
    platformLabel: 'test platform',
    privateStatePath: '/private/kronos',
    providerEnvPath: '/private/kronos/providers.env',
  };
  const setup = buildSetupPanelHtml({
    steps: [{
      title: 'Project discovery folders',
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
