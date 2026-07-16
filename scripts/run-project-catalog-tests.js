const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-project-catalog-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const stateStore = require('../out/services/stateStore.js');
const projectCatalog = require('../out/services/projectCatalog.js');
const projectDiscovery = require('../out/services/projectDiscovery.js');
const projectGitPresentation = require('../out/services/projectGitPresentation.js');
const projectInventoryPresentation = require('../out/services/projectInventoryPresentation.js');
const jiraWorkCatalog = require('../out/services/jiraWorkCatalog.js');
const providerBindingReconciliation = require('../out/services/providerBindingReconciliation.js');
const workSessions = require('../out/services/workSessionStore.js');
const { buildProjectIntegrationPanelHtml } = require('../out/services/projectIntegrationView.js');

test('explicit local project links preserve unrelated provider records and report branch without running Git', () => {
  const projectRoot = path.join(tempRoot, 'project-catalog-fixture');
  const alternateRoot = path.join(tempRoot, 'project-catalog-alternate');
  fs.mkdirSync(path.join(projectRoot, '.git'), { recursive: true });
  fs.mkdirSync(path.join(alternateRoot, '.git'), { recursive: true });
  fs.writeFileSync(path.join(projectRoot, '.git', 'HEAD'), 'ref: refs/heads/feature/ticket-context\n');
  fs.writeFileSync(path.join(alternateRoot, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.Provider = { config: { gitlab_project_id: 77 } };
  initial.tickets['JIRA-123'] = fixtureTicket();

  const registered = projectCatalog.registerLocalProject(initial, 'Application', projectRoot);
  const withAlternate = projectCatalog.registerLocalProject(registered, 'Alternate', alternateRoot);
  const linked = projectCatalog.setTicketLocalProject(withAlternate, 'JIRA-123', 'Application');
  assert.equal(linked.tickets['JIRA-123'].linked_local_project, 'Application');
  assert.equal(linked.projects.Provider.config.gitlab_project_id, 77);
  assert.deepEqual(projectCatalog.readProjectGitBranch(projectRoot), {
    branch: 'feature/ticket-context',
    detached: false,
  });
  assert.deepEqual(projectCatalog.readProjectGitBranch(alternateRoot), {
    branch: 'detached@0123456',
    detached: true,
  });
  assert.deepEqual(projectCatalog.ticketLocalProject(linked, linked.tickets['JIRA-123']), {
    name: 'Application',
    displayName: 'Application',
    path: projectRoot,
    branch: 'feature/ticket-context',
    detached: false,
    available: true,
  });

  const switched = projectCatalog.setTicketLocalProject(linked, 'JIRA-123', 'Alternate');
  assert.equal(switched.tickets['JIRA-123'].linked_local_project, 'Alternate');
  const unlinked = projectCatalog.setTicketLocalProject(switched, 'JIRA-123');
  assert.equal(unlinked.tickets['JIRA-123'].linked_local_project, undefined);
});

test('project nickname sets and clears while registration identity stays canonical by path', () => {
  const projectRoot = path.join(tempRoot, 'canonical-project-identity');
  fs.mkdirSync(projectRoot, { recursive: true });
  const aliasPath = path.join(projectRoot, '..', path.basename(projectRoot));
  const initial = stateStore.emptyWorkCatalog();
  initial.tickets['JIRA-123'] = fixtureTicket();

  const registered = projectCatalog.registerLocalProject(initial, 'Application', aliasPath);
  const linked = projectCatalog.setTicketLocalProject(registered, 'JIRA-123', 'Application');
  const duplicateAttempt = projectCatalog.registerLocalProject(linked, 'Duplicate label', projectRoot);
  assert.deepEqual(Object.keys(duplicateAttempt.projects), ['Application']);
  assert.equal(duplicateAttempt.projects.Application.path, fs.realpathSync.native(projectRoot));

  const renamed = projectCatalog.renameLocalProjectDisplayName(duplicateAttempt, 'Application', 'Customer API');
  assert.equal(renamed.projects.Application.display_name, 'Customer API');
  assert.equal(renamed.tickets['JIRA-123'].linked_local_project, 'Application', 'display rename never rewrites ticket identity');
  assert.deepEqual(projectCatalog.listLocalProjects(renamed).map(project => ({
    name: project.name,
    displayName: project.displayName,
    path: project.path,
  })), [{
    name: 'Application',
    displayName: 'Customer API',
    path: fs.realpathSync.native(projectRoot),
  }]);
  assert.equal(renamed.projects.Application.config.repo_name, 'Application');

  const clearedNickname = projectCatalog.renameLocalProjectDisplayName(renamed, 'Application', '   ');
  assert.equal(clearedNickname.projects.Application.display_name, undefined);
  assert.equal(projectCatalog.listLocalProjects(clearedNickname)[0].displayName, 'Application');
  assert.equal(clearedNickname.tickets['JIRA-123'].linked_local_project, 'Application', 'clearing a nickname keeps ticket identity');

  const persisted = stateStore.normalizeWorkCatalog({
    schemaVersion: 2,
    projects: {
      Application: renamed.projects.Application,
      Duplicate: { path: aliasPath, display_name: 'Must be omitted', config: {} },
    },
    tickets: renamed.tickets,
  }, '/fixture/duplicate-project-path.json');
  assert.deepEqual(Object.keys(persisted.state.projects), ['Application']);
  assert.equal(persisted.state.projects.Application.display_name, 'Customer API');
  assert.equal(persisted.issues.some(issue => /duplicate local project path/i.test(issue.detail)), true);
});

test('duplicate discovered names receive stable unique identities and duplicate real paths collapse', () => {
  const firstRoot = path.join(tempRoot, 'same-name-one', 'service');
  const secondRoot = path.join(tempRoot, 'same-name-two', 'service');
  fs.mkdirSync(firstRoot, { recursive: true });
  fs.mkdirSync(secondRoot, { recursive: true });
  const firstAlias = path.join(firstRoot, '..', 'service');
  const initial = stateStore.emptyWorkCatalog();

  const planned = projectCatalog.planLocalProjectRegistrations(initial, [
    { name: 'service', path: firstAlias },
    { name: 'service', path: secondRoot },
    { name: 'duplicate alias', path: firstRoot },
  ]);
  assert.deepEqual(planned, [
    { name: 'service', path: fs.realpathSync.native(firstRoot) },
    { name: 'service (2)', path: fs.realpathSync.native(secondRoot) },
  ]);

  const registered = projectCatalog.replaceRegisteredLocalProjects(initial, planned);
  const replanned = projectCatalog.planLocalProjectRegistrations(registered, [
    { name: 'renamed discovery label', path: firstRoot },
    { name: 'service', path: secondRoot },
  ]);
  assert.deepEqual(replanned.map(project => project.name), ['service', 'service (2)']);
});

test('missing registered folders remain visible until an authoritative uncheck removes them', () => {
  const missingPath = path.join(tempRoot, 'temporarily-missing-project');
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.Application = {
    path: missingPath,
    display_name: 'Application API',
    config: { repo_name: 'Application' },
  };
  initial.tickets['JIRA-123'] = fixtureTicket({ linked_local_project: 'Application' });

  assert.deepEqual(projectCatalog.listLocalProjects(initial), [{
    name: 'Application',
    displayName: 'Application API',
    path: missingPath,
    detached: false,
    available: false,
  }]);
  const retainedPlan = projectCatalog.planLocalProjectRegistrations(initial, [{
    name: 'Application API',
    path: missingPath,
  }]);
  assert.deepEqual(retainedPlan, [{ name: 'Application', path: missingPath }]);
  const retained = projectCatalog.replaceRegisteredLocalProjects(initial, retainedPlan);
  assert.equal(retained.projects.Application.path, missingPath);
  assert.equal(retained.tickets['JIRA-123'].linked_local_project, 'Application');

  const removed = projectCatalog.replaceRegisteredLocalProjects(retained, []);
  assert.equal(Object.hasOwn(removed.projects, 'Application'), false);
  assert.equal(removed.tickets['JIRA-123'].linked_local_project, undefined);
});

test('Jira project keys never auto-link a repository; only an explicit ticket link does', () => {
  const current = stateStore.emptyWorkCatalog();
  const names = ['Api', 'Web', 'Worker', 'Database'];
  for (const name of names) {
    const projectPath = path.join(tempRoot, `abc-${name.toLowerCase()}`);
    fs.mkdirSync(projectPath, { recursive: true });
    current.projects[name] = {
      path: projectPath,
      config: { repo_name: name, gitlab_project_path: `team/${name.toLowerCase()}` },
    };
  }
  const snapshot = {
    issues: [
      jiraIssueForProject('ABC-123', 'Choose the API explicitly', 'ABC'),
      jiraIssueForProject('ABC-124', 'Choose the Web explicitly', 'ABC'),
    ],
    fetchedAt: '2026-07-14T12:00:00.000Z',
    complete: true,
  };
  const result = jiraWorkCatalog.catalogFromJiraWorkList(snapshot, current, 'https://jira.example');
  assert.deepEqual(Object.keys(result.state.projects), names);
  assert.equal(Object.hasOwn(result.state.projects, 'ABC'), false, 'Jira refresh must not invent a local project named after the Jira key');
  for (const ticketKey of ['ABC-123', 'ABC-124']) {
    assert.equal(result.state.tickets[ticketKey].jira_project_key, 'ABC');
    assert.equal(result.state.tickets[ticketKey].linked_local_project, undefined);
    assert.deepEqual(projectCatalog.projectConfigurationForTicket(result.state, result.state.tickets[ticketKey]), {});
  }
  const linkedFirst = projectCatalog.setTicketLocalProject(result.state, 'ABC-123', 'Api');
  const linked = projectCatalog.setTicketLocalProject(linkedFirst, 'ABC-124', 'Web');
  assert.equal(linked.tickets['ABC-123'].linked_local_project, 'Api');
  assert.equal(linked.tickets['ABC-124'].linked_local_project, 'Web');
  assert.equal(projectCatalog.projectConfigurationForTicket(linked, linked.tickets['ABC-123']).gitlab_project_path, 'team/api');
  assert.equal(projectCatalog.projectConfigurationForTicket(linked, linked.tickets['ABC-124']).gitlab_project_path, 'team/web');
  const refreshed = jiraWorkCatalog.catalogFromJiraWorkList(snapshot, linked, 'https://jira.example').state;
  assert.equal(refreshed.tickets['ABC-123'].linked_local_project, 'Api', 'an explicit operator link survives Jira refresh');
  assert.equal(refreshed.tickets['ABC-124'].linked_local_project, 'Web', 'a second ticket in the same Jira namespace keeps its own link');
});

test('unlinked tickets stay unlinked across refresh, registration, reload, polling selection, and standalone sessions', () => {
  const projectRoot = path.join(tempRoot, 'unlinked-identity-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const initial = stateStore.emptyWorkCatalog();
  initial.tickets['ABC-200'] = fixtureTicket({ jira_project_key: 'ABC' });
  const registered = projectCatalog.registerLocalProject(initial, 'Application', projectRoot);
  assert.equal(registered.tickets['ABC-200'].linked_local_project, undefined);

  const refreshed = jiraWorkCatalog.catalogFromJiraWorkList({
    issues: [jiraIssueForProject('ABC-200', 'Remain explicitly unlinked', 'ABC')],
    fetchedAt: '2026-07-14T12:00:00.000Z',
    complete: true,
  }, registered, 'https://jira.example').state;
  assert.equal(refreshed.tickets['ABC-200'].linked_local_project, undefined);
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(refreshed, refreshed.tickets['ABC-200']), {});

  const reloaded = stateStore.normalizeWorkCatalog(refreshed, '/fixture/unlinked-reload.json').state;
  assert.equal(reloaded.tickets['ABC-200'].linked_local_project, undefined);
  const ticketSession = { ticketKey: 'ABC-200', ticketKeys: ['ABC-200'], providerBindings: [] };
  assert.equal(providerBindingReconciliation.configuredGitLabPollingTarget(reloaded, ticketSession), null);
  assert.deepEqual(providerBindingReconciliation.configuredCiPollingTargets(reloaded, ticketSession), {});
  assert.equal(providerBindingReconciliation.configuredSonarBranch(reloaded, 'ABC-200'), null);

  const sessionOptions = { kronosDir: path.join(tempRoot, 'unlinked-standalone-session') };
  const standalone = workSessions.createStandaloneWorkSession({
    title: 'Standalone Application work',
    projectName: 'Application',
    projectPath: projectRoot,
  }, sessionOptions);
  assert.deepEqual(standalone.ticketKeys, []);
  assert.equal(Object.hasOwn(standalone, 'ticketKey'), false);
  assert.equal(reloaded.tickets['ABC-200'].linked_local_project, undefined);
});

test('checked projects replace local registrations and safely unlink removed explicit project links', () => {
  const localRoot = path.join(tempRoot, 'replace-local-project');
  const providerRoot = path.join(tempRoot, 'replace-provider-project');
  const newRoot = path.join(tempRoot, 'replace-new-project');
  fs.mkdirSync(localRoot, { recursive: true });
  fs.mkdirSync(providerRoot, { recursive: true });
  fs.mkdirSync(newRoot, { recursive: true });
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.Local = { path: localRoot, config: { repo_name: 'Local' } };
  initial.projects.Provider = {
    path: providerRoot,
    config: { repo_name: 'Provider', gitlab_project_id: 77 },
  };
  initial.tickets['JIRA-1'] = fixtureTicket({ linked_local_project: 'Local' });
  initial.tickets['JIRA-2'] = fixtureTicket({ linked_local_project: 'Provider' });

  const replaced = projectCatalog.replaceRegisteredLocalProjects(initial, [
    { name: 'New Project', path: newRoot },
  ]);
  assert.equal(Object.hasOwn(replaced.projects, 'Local'), false, 'a local-only unchecked project must be removed');
  assert.equal(replaced.projects.Provider.path, undefined, 'an unchecked provider project must lose only its local path');
  assert.equal(replaced.projects.Provider.config.gitlab_project_id, 77, 'provider configuration must be retained');
  assert.equal(replaced.projects['New Project'].path, newRoot);
  assert.equal(replaced.tickets['JIRA-1'].linked_local_project, undefined);
  assert.equal(replaced.tickets['JIRA-2'].linked_local_project, undefined);
});

test('project integration setup validates provider identifiers and explicit project config drives polling', () => {
  const projectRoot = path.join(tempRoot, 'integrated-local-project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.LegacyDefault = { config: { default_branch: 'provider-default' } };
  initial.projects.Application = { path: projectRoot, config: { repo_name: 'Application' } };
  initial.tickets['JIRA-123'] = fixtureTicket({ linked_local_project: 'Application' });

  const configured = projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application',
    nickname: 'Customer API',
    gitlabProject: 'group/application',
    jenkinsUrl: 'https://jenkins.example/job/team/job/application/#fragment',
    sonarProjectKey: 'team:application',
    defaultBranch: 'feature/local-branch',
  }]);
  assert.equal(configured.projects.Application.config.gitlab_project_path, 'group/application');
  assert.equal(configured.projects.Application.display_name, 'Customer API');
  assert.equal(configured.projects.Application.config.jenkins_url, 'https://jenkins.example/job/team/job/application');
  assert.equal(configured.projects.Application.config.sonar_project_key, 'team:application');
  assert.equal(configured.projects.Application.config.default_branch, 'feature/local-branch');
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(configured, configured.tickets['JIRA-123']), {
    default_branch: 'feature/local-branch',
    repo_name: 'Application',
    gitlab_project_path: 'group/application',
    jenkins_url: 'https://jenkins.example/job/team/job/application',
    sonar_project_key: 'team:application',
  });
  assert.deepEqual(providerBindingReconciliation.configuredSonarBranch(configured, 'JIRA-123'), {
    projectKey: 'team:application',
    branch: 'feature/local-branch',
  });
  configured.tickets['JIRA-123'].mr = {
    iid: 88,
    state: 'opened',
    review_status: 'pending_review',
    url: 'https://gitlab.example/group/application/-/merge_requests/88',
  };
  const existingSession = {
    ticketKey: 'JIRA-123',
    providerBindings: [
      { provider: 'gitlab', resource: 'merge-request', subjectId: '77', projectId: 'old/project', url: 'https://gitlab.example/old/project/-/merge_requests/77' },
      { provider: 'jenkins', resource: 'build', subjectId: 'latest', url: 'https://jenkins.example/job/old' },
      { provider: 'sonar', resource: 'quality-gate', subjectId: 'old:key:old-branch', projectId: 'old:key' },
    ],
  };
  assert.deepEqual(providerBindingReconciliation.configuredGitLabPollingTarget(configured, existingSession), {
    iid: 77,
    projectIdOrPath: 'old/project',
    providerUrl: 'https://gitlab.example/old/project/-/merge_requests/77',
  });
  assert.deepEqual(providerBindingReconciliation.configuredCiPollingTargets(configured, existingSession), {
    jenkinsUrl: 'https://jenkins.example/job/team/job/application',
    sonar: { projectKey: 'team:application', branch: 'feature/local-branch' },
  });
  const savedBindingOnlyState = stateStore.emptyWorkCatalog();
  savedBindingOnlyState.tickets['JIRA-123'] = fixtureTicket();
  assert.deepEqual(providerBindingReconciliation.configuredCiPollingTargets(savedBindingOnlyState, existingSession), {
    jenkinsUrl: 'https://jenkins.example/job/old',
    sonar: { projectKey: 'old:key', branch: 'old-branch' },
  });
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application',
    jenkinsUrl: `https://${['synthetic-user', 'synthetic-password'].join(':')}@jenkins.example/job/application/`,
  }]), /without embedded credentials/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application',
    gitlabProject: 'not a project path',
  }]), /numeric ID or group\/project/i);
});

test('project integration values round-trip, clear, and default to the observed Git branch', () => {
  const projectRoot = path.join(tempRoot, 'reviewable-project-integration');
  fs.mkdirSync(projectRoot, { recursive: true });
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.Application = { path: projectRoot, config: { repo_name: 'Application' } };
  const configured = projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application',
    gitlabProject: 'group/application',
    jenkinsUrl: 'https://jenkins.example/job/application/',
    sonarProjectKey: 'team:application',
    defaultBranch: 'release/current',
  }]);
  assert.deepEqual(configured.projects.Application.config, {
    repo_name: 'Application',
    gitlab_project_path: 'group/application',
    jenkins_url: 'https://jenkins.example/job/application',
    sonar_project_key: 'team:application',
    default_branch: 'release/current',
  });

  const nicknamed = projectCatalog.setLocalProjectIntegrations(configured, [{
    name: 'Application',
    nickname: 'Release API',
    gitlabProject: 'group/application',
    jenkinsUrl: 'https://jenkins.example/job/application/',
    sonarProjectKey: 'team:application',
    defaultBranch: 'release/current',
  }]);
  assert.equal(nicknamed.projects.Application.display_name, 'Release API');
  assert.equal(nicknamed.projects.Application.path, projectRoot);
  assert.equal(nicknamed.projects.Application.config.gitlab_project_path, 'group/application');

  const cleared = projectCatalog.setLocalProjectIntegrations(nicknamed, [{ name: 'Application', nickname: '' }]);
  assert.deepEqual(cleared.projects.Application.config, { repo_name: 'Application' });
  assert.equal(cleared.projects.Application.display_name, undefined);

  const html = buildProjectIntegrationPanelHtml({
    projects: [{
      name: 'Application',
      displayName: 'Customer API',
      nickname: 'Customer API',
      path: projectRoot,
      branch: 'feature/observed-branch',
      gitlabProject: 'group/application',
      jenkinsUrl: 'https://jenkins.example/job/application',
      sonarProjectKey: 'team:application',
    }],
    providerReadiness: [],
    nonce: 'project-integration-nonce',
    scriptUri: 'vscode-webview://fixture/kronos-project-integration.js',
  });
  assert.match(html, /value="group\/application"/);
  assert.match(html, /Project nickname \(optional\)/);
  assert.match(html, /value="Customer API"/);
  assert.match(html, /Stable project: Application/);
  assert.match(html, /value="https:\/\/jenkins\.example\/job\/application"/);
  assert.match(html, /value="team:application"/);
  assert.match(html, /value="feature\/observed-branch"/);
  assert.match(html, /Blank fields clear that optional nickname or integration/);
  assert.doesNotMatch(html, /Connect registered folders/);
});

test('Git worktree pointers are bounded and symbolic Git metadata is ignored', t => {
  const worktree = path.join(tempRoot, 'worktree-project');
  const gitDirectory = path.join(tempRoot, 'worktree-git-data');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(gitDirectory, { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDirectory}\n`);
  fs.writeFileSync(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/review/worktree\n');
  assert.deepEqual(projectCatalog.readProjectGitBranch(worktree), {
    branch: 'review/worktree',
    detached: false,
  });

  const unsafe = path.join(tempRoot, 'unsafe-git-project');
  fs.mkdirSync(unsafe, { recursive: true });
  if (!createSymlinkOrSkip(t, gitDirectory, path.join(unsafe, '.git'), 'dir')) { return; }
  assert.equal(projectCatalog.readProjectGitBranch(unsafe), undefined);
});

test('project Git presentation distinguishes unavailable, clean, staged, untracked, conflicted, and bounded states', () => {
  const evidence = overrides => ({
    projectPath: '/fixture/project',
    changes: [],
    changeCount: 0,
    diff: '',
    diffTruncated: false,
    available: true,
    ...overrides,
  });
  assert.deepEqual(projectGitPresentation.projectGitStatusPresentation(evidence({ available: false })), {
    state: 'unavailable',
    label: 'status unavailable',
    tooltip: 'unavailable',
    stagedCount: 0,
    modifiedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
  });
  assert.equal(projectGitPresentation.projectGitStatusPresentation(evidence({})).label, 'clean');

  const changed = projectGitPresentation.projectGitStatusPresentation(evidence({
    changeCount: 504,
    changes: [
      { path: 'staged.ts', status: 'index modified', staged: true },
      { path: 'working.ts', status: 'modified', staged: false },
      { path: 'new.ts', status: 'untracked', staged: false },
      { path: 'conflict.ts', status: 'both modified', staged: false },
    ],
    diffTruncated: true,
  }));
  assert.deepEqual(changed, {
    state: 'changed',
    label: '504 changes · 1 staged · 1 conflict',
    tooltip: '504 total, 1 staged, 1 modified, 1 untracked, 1 conflicted',
    stagedCount: 1,
    modifiedCount: 1,
    untrackedCount: 1,
    conflictCount: 1,
  });
});

test('project discovery honors configured roots, depth, limits, and workspace folders', () => {
  const discoveryRoot = path.join(tempRoot, 'project-discovery');
  const direct = path.join(discoveryRoot, 'direct-project');
  const nested = path.join(discoveryRoot, 'group', 'nested-project');
  const ignored = path.join(discoveryRoot, 'node_modules', 'ignored-project');
  const workspace = path.join(tempRoot, 'open-workspace-without-git');
  for (const directory of [direct, nested, ignored, workspace]) { fs.mkdirSync(directory, { recursive: true }); }
  for (const [directory, branch] of [[direct, 'feature/direct'], [nested, 'feature/nested'], [ignored, 'ignored']]) {
    fs.mkdirSync(path.join(directory, '.git'));
    fs.writeFileSync(path.join(directory, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  }

  const shallow = projectDiscovery.discoverLocalProjects({
    workspaceFolders: [{ name: 'Open Workspace', path: workspace }],
    roots: [discoveryRoot, path.join(discoveryRoot, 'missing')],
    depth: 1,
    limit: 100,
  });
  assert.deepEqual(shallow.projects.map(project => project.name), ['direct-project', 'Open Workspace']);
  assert.match(shallow.warnings.join(' '), /unavailable/i);
  assert.equal(shallow.projects.find(project => project.name === 'direct-project').branch, 'feature/direct');

  const deep = projectDiscovery.discoverLocalProjects({ roots: [discoveryRoot], depth: 2, limit: 100 });
  assert.deepEqual(deep.projects.map(project => project.name), ['direct-project', 'nested-project']);
  assert.equal(deep.projects.some(project => project.name === 'ignored-project'), false);
  const limited = projectDiscovery.discoverLocalProjects({ roots: [discoveryRoot], depth: 2, limit: 1 });
  assert.equal(limited.projects.length, 1);
  assert.equal(limited.truncated, true);
});

test('project discovery canonicalizes root aliases and skips symbolic child repositories', t => {
  const discoveryRoot = path.join(tempRoot, 'canonical-discovery-root');
  const repository = path.join(discoveryRoot, 'service');
  const externalRepository = path.join(tempRoot, 'external-repository');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  fs.mkdirSync(path.join(externalRepository, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repository, '.git', 'HEAD'), 'ref: refs/heads/feature/canonical\n');
  fs.writeFileSync(path.join(externalRepository, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const rootAlias = path.join(tempRoot, 'canonical-discovery-alias');
  if (!createSymlinkOrSkip(t, discoveryRoot, rootAlias, 'dir')) { return; }
  if (!createSymlinkOrSkip(t, externalRepository, path.join(discoveryRoot, 'linked-external'), 'dir')) { return; }

  const discovered = projectDiscovery.discoverLocalProjects({
    workspaceFolders: [{ name: 'Workspace Alias', path: path.join(rootAlias, 'service') }],
    roots: [discoveryRoot, rootAlias],
    depth: 2,
    limit: 100,
  });
  assert.deepEqual(discovered.projects, [{
    name: 'Workspace Alias',
    path: fs.realpathSync.native(repository),
    source: 'workspace',
    branch: 'feature/canonical',
  }]);
});

test('project integration presentation exposes readiness without provider identifiers or credentials', () => {
  const config = {
    gitlab_project_path: 'group/private-application',
    jenkins_url: 'https://jenkins.example/job/private-application',
    sonar_project_key: 'private:application',
  };
  const needsCredentials = projectInventoryPresentation.projectIntegrationStatusLines(config, {
    gitlab: false,
    jenkins: false,
    sonar: false,
  });
  assert.deepEqual(needsCredentials, [
    'GitLab: target saved, credentials need Doctor',
    'Jenkins: target saved, credentials need Doctor',
    'SonarQube: target saved, credentials need Doctor',
  ]);
  const active = projectInventoryPresentation.projectIntegrationStatusLines(config, {
    gitlab: true,
    jenkins: true,
    sonar: true,
  });
  assert.deepEqual(active, [
    'GitLab: automatic project polling active',
    'Jenkins: automatic project polling active',
    'SonarQube: automatic project polling active',
  ]);
  const rendered = [...needsCredentials, ...active].join('\n');
  assert.doesNotMatch(rendered, /private-application|private:application|jenkins\.example/);
});

test('project configuration is canonical at setup and Work catalog ingress', () => {
  const normalized = stateStore.normalizeWorkCatalog({
    schemaVersion: 2,
    projects: {
      Valid: {
        path: '/tmp/valid-project',
        config: {
          repo_name: 'Valid',
          gitlab_project_path: 'group/application',
          jenkins_url: 'https://jenkins.example/job/team/job/application/?tree=result#build',
          sonar_project_key: 'team:application',
          sonar_branch: 'feature/sonar',
          base_branch: 'release/next',
          default_branch: 'main',
          branch_profiles: [{
            branch: 'feature/profile',
            jenkins_url: 'https://jenkins.example/job/profile/?tree=result#build',
            sonar_project_key: 'team:profile',
            sonar_branch: 'feature/profile',
          }],
          active_branch_profile: 'feature/profile',
          ignored_unknown_field: 'must not survive',
        },
      },
      Invalid: {
        path: '/tmp/invalid-project',
        config: {
          gitlab_project_id: 42,
          gitlab_project_path: 'ambiguous/path',
          jenkins_url: 'https://synthetic-user:synthetic-password@jenkins.example/job/application',
          sonar_project_key: 'unsupported key',
          sonar_branch: '../unsafe',
          base_branch: 'bad..branch',
          default_branch: 'bad.lock',
          branch_profiles: [
            { branch: '../unsafe', jenkins_url: 'https://jenkins.example/job/unsafe' },
            { branch: 'safe/profile', jenkins_url: 'http://jenkins.example/job/plain-http' },
          ],
          active_branch_profile: 'missing/profile',
        },
      },
    },
    tickets: {
      'JIRA-1': { ...fixtureTicket(), linked_local_project: 'Valid' },
      'JIRA-2': { ...fixtureTicket(), linked_local_project: 'Invalid' },
    },
  }, '/fixture/canonical-project-config.json').state;

  assert.deepEqual(normalized.projects.Valid.config, {
    repo_name: 'Valid',
    gitlab_project_path: 'group/application',
    jenkins_url: 'https://jenkins.example/job/team/job/application',
    sonar_project_key: 'team:application',
    sonar_branch: 'feature/sonar',
    base_branch: 'release/next',
    default_branch: 'main',
    branch_profiles: [{
      branch: 'feature/profile',
      jenkins_url: 'https://jenkins.example/job/profile',
      sonar_project_key: 'team:profile',
      sonar_branch: 'feature/profile',
    }],
    active_branch_profile: 'feature/profile',
  });
  assert.deepEqual(normalized.projects.Invalid.config, { gitlab_project_id: 42 });
  assert.deepEqual(
    projectCatalog.projectConfigurationForTicket(normalized, normalized.tickets['JIRA-1']),
    normalized.projects.Valid.config,
    'provider consumers receive only the canonical persisted project shape',
  );
  assert.deepEqual(
    projectCatalog.projectConfigurationForTicket(normalized, normalized.tickets['JIRA-2']),
    { gitlab_project_id: 42 },
  );

  const setupState = stateStore.emptyWorkCatalog();
  setupState.projects.Valid = { path: tempRoot, config: {} };
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(setupState, [{
    name: 'Valid',
    defaultBranch: 'bad..branch',
  }]), /default branch contains unsupported Git branch characters/i);
  assert.throws(
    () => projectCatalog.setLocalProjectSonarTarget(setupState, 'Valid', 'team:application', '../unsafe'),
    /SonarQube branch contains unsupported Git branch characters/i,
  );
});

function fixtureTicket(overrides = {}) {
  return {
    summary: 'Terminal-first fixture',
    type: 'Story',
    priority: 'High',
    jira_status: 'In Progress',
    jira_project_key: 'JIRA',
    source: 'jira',
    updated: '2026-07-13T12:00:00.000Z',
    description: 'Keep the operator in control.',
    labels: ['terminal-first'],
    jira_url: 'https://jira.example/browse/JIRA-123',
    mr: null,
    build: null,
    ...overrides,
  };
}

function jiraIssueForProject(key, summary, projectKey) {
  return {
    key,
    fields: {
      summary,
      issuetype: { name: 'Task' },
      priority: { name: 'Medium' },
      status: { name: 'Open' },
      updated: '2026-07-13T12:00:00.000Z',
      labels: ['owned'],
      project: { key: projectKey },
    },
  };
}

function createSymlinkOrSkip(t, target, linkPath, type = 'file') {
  try {
    fs.symlinkSync(target, linkPath, type);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`Symbolic links are unavailable on this host: ${error.code}`);
      return false;
    }
    throw error;
  }
}
