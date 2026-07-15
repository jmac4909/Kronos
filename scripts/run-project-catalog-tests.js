const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-project-catalog-'));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const stateStore = require('../out/services/stateStore.js');
const projectCatalog = require('../out/services/projectCatalog.js');
const projectDiscovery = require('../out/services/projectDiscovery.js');
const projectGitPresentation = require('../out/services/projectGitPresentation.js');
const jiraWorkCatalog = require('../out/services/jiraWorkCatalog.js');
const managedProviderMonitor = require('../out/services/managedProviderMonitor.js');

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

test('project registration identity stays canonical by path while its display name remains editable', () => {
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
  const linked = projectCatalog.setTicketLocalProject(result.state, 'ABC-123', 'Api');
  assert.equal(linked.tickets['ABC-123'].linked_local_project, 'Api');
  assert.equal(linked.tickets['ABC-124'].linked_local_project, undefined);
  assert.equal(projectCatalog.projectConfigurationForTicket(linked, linked.tickets['ABC-123']).gitlab_project_path, 'team/api');
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(linked, linked.tickets['ABC-124']), {});
  const refreshed = jiraWorkCatalog.catalogFromJiraWorkList(snapshot, linked, 'https://jira.example').state;
  assert.equal(refreshed.tickets['ABC-123'].linked_local_project, 'Api', 'an explicit operator link survives Jira refresh');
  assert.equal(refreshed.tickets['ABC-124'].linked_local_project, undefined);
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
    gitlabProject: 'group/application',
    jenkinsUrl: 'https://jenkins.example/job/team/job/application/#fragment',
    sonarProjectKey: 'team:application',
    defaultBranch: 'feature/local-branch',
  }]);
  assert.equal(configured.projects.Application.config.gitlab_project_path, 'group/application');
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
  assert.deepEqual(managedProviderMonitor.configuredSonarBranch(configured, 'JIRA-123'), {
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
  assert.deepEqual(managedProviderMonitor.configuredGitLabPollingTarget(configured, existingSession), {
    iid: 77,
    projectIdOrPath: 'old/project',
    providerUrl: 'https://gitlab.example/old/project/-/merge_requests/77',
  });
  assert.deepEqual(managedProviderMonitor.configuredCiPollingTargets(configured, existingSession), {
    jenkinsUrl: 'https://jenkins.example/job/team/job/application',
    sonar: { projectKey: 'team:application', branch: 'feature/local-branch' },
  });
  const savedBindingOnlyState = stateStore.emptyWorkCatalog();
  savedBindingOnlyState.tickets['JIRA-123'] = fixtureTicket();
  assert.deepEqual(managedProviderMonitor.configuredCiPollingTargets(savedBindingOnlyState, existingSession), {
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
