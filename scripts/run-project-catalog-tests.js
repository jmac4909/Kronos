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

test('project registration identity is deterministic when the host locale has special casing rules', () => {
  const existingRoot = path.join(tempRoot, 'locale-existing');
  const candidateRoot = path.join(tempRoot, 'locale-candidate');
  fs.mkdirSync(existingRoot, { recursive: true });
  fs.mkdirSync(candidateRoot, { recursive: true });
  const state = stateStore.emptyWorkCatalog();
  state.projects.Invoice = { path: existingRoot, config: {} };

  const originalLocaleLowerCase = String.prototype.toLocaleLowerCase;
  String.prototype.toLocaleLowerCase = function localeSensitiveLowerCaseFixture() {
    return String(this).replaceAll('I', 'ı').toLowerCase();
  };
  try {
    assert.deepEqual(projectCatalog.planLocalProjectRegistrations(state, [{
      name: 'invoice',
      path: candidateRoot,
    }]).map(project => project.name), ['invoice (2)']);
  } finally {
    String.prototype.toLocaleLowerCase = originalLocaleLowerCase;
  }
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

test('Jira Work catalog normalizes rich text, attachments, fallbacks, malformed rows, and complete-page retention', () => {
  const current = stateStore.emptyWorkCatalog();
  const projectPath = path.join(tempRoot, 'catalog-matrix-project');
  fs.mkdirSync(projectPath, { recursive: true });
  current.projects.Application = { path: projectPath, config: {} };
  current.tickets['CAT-1'] = {
    ...fixtureTicket({
      summary: 'Previous catalog ticket',
      type: 'Story',
      priority: 'High',
      jira_status: 'Open',
      jira_status_category: 'To Do',
      jira_project_key: 'CAT',
      linked_local_project: 'Application',
      description: 'Previous description',
      attachments: [{ filename: 'previous.txt', size: 4, mimeType: 'text/plain' }],
      mr: { iid: 7, state: 'opened', review_status: 'pending_review' },
      build: { number: 8, status: 'SUCCESS' },
    }),
  };
  current.tickets['CAT-9'] = fixtureTicket({ summary: 'Retained rejected row' });
  const richDescription = {
    type: 'doc',
    content: [
      { type: 'heading', content: [{ type: 'text', text: 'Heading' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph' }, { type: 'hardBreak' }, 'tail'] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'text', text: 'Item' }] }] },
      { type: 'orderedList', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'code' }] }] },
      7,
    ],
  };
  const snapshot = {
    issues: [
      null,
      {},
      { key: 'BAD', fields: { summary: 'Invalid key' } },
      { key: 'CAT-9', fields: { summary: null } },
      {
        key: ' cat-1 ',
        fields: {
          summary: '  Rich\u0000 catalog   ticket ',
          issuetype: null,
          priority: {},
          status: { name: '', statusCategory: { key: '', name: 'In Progress' } },
          project: null,
          updated: ' 2026-07-20T12:00:00.000Z ',
          labels: [' one ', '', 7, 'one', 'two'],
          description: richDescription,
          attachment: [
            null,
            { filename: '' },
            { filename: ' report.xml ', size: 12.9, mimeType: ' text/xml ' },
            { filename: 'negative.bin', size: -1 },
            { filename: 'infinite.bin', size: Number.POSITIVE_INFINITY, mimeType: '' },
          ],
        },
      },
      {
        key: 'CAT-2',
        fields: {
          summary: 'String description',
          description: ' first\r\n second\n\n\nthird ',
          attachment: [],
          labels: 'not-an-array',
        },
      },
      {
        key: 'CAT-3',
        fields: { summary: 'Missing optional fields' },
      },
    ],
    fetchedAt: '2026-07-20T12:30:00.000Z',
    complete: true,
  };
  const result = jiraWorkCatalog.catalogFromJiraWorkList(snapshot, current, 'https://jira.example///');
  const ticket = result.state.tickets['CAT-1'];
  assert.equal(ticket.summary, 'Rich catalog ticket');
  assert.equal(ticket.type, 'Story');
  assert.equal(ticket.priority, 'High');
  assert.equal(ticket.jira_status, 'Open');
  assert.equal(ticket.jira_status_category, 'In Progress');
  assert.equal(ticket.jira_project_key, 'CAT');
  assert.equal(ticket.linked_local_project, 'Application');
  assert.equal(ticket.jira_url, 'https://jira.example/browse/CAT-1');
  assert.deepEqual(ticket.labels, ['one', 'two']);
  assert.match(ticket.description, /Heading\nParagraph\ntail/);
  assert.match(ticket.description, /Item/);
  assert.deepEqual(ticket.attachments, [
    { filename: 'report.xml', size: 12, mimeType: 'text/xml' },
    { filename: 'negative.bin', size: 0, mimeType: 'application/octet-stream' },
    { filename: 'infinite.bin', size: 0, mimeType: 'application/octet-stream' },
  ]);
  assert.equal(result.state.tickets['CAT-1'].mr.iid, 7);
  assert.equal(result.state.tickets['CAT-1'].build.number, 8);
  assert.equal(result.state.tickets['CAT-2'].description, 'first\nsecond\n\nthird');
  assert.equal(result.state.tickets['CAT-2'].attachments, undefined);
  assert.equal(result.state.tickets['CAT-3'].type, 'Issue');
  assert.equal(result.state.tickets['CAT-3'].priority, 'Unknown');
  assert.equal(result.state.tickets['CAT-3'].jira_status, 'Unknown');
  assert.equal(result.retainedFromPrevious, 1, 'a rejected row retains the prior ticket even on a nominally complete page');
  assert.equal(result.state.tickets['CAT-9'].summary, 'Retained rejected row');

  const missingFields = jiraWorkCatalog.catalogFromJiraWorkList({
    issues: [{ key: 'CAT-1', fields: { summary: 'Retain omitted fields' } }],
    fetchedAt: snapshot.fetchedAt,
    complete: false,
  }, current, 'https://jira.example').state.tickets['CAT-1'];
  assert.equal(missingFields.description, 'Previous description');
  assert.deepEqual(missingFields.attachments, current.tickets['CAT-1'].attachments);
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
  assert.match(html, /Display name \(optional\)/);
  assert.match(html, /value="Customer API"/);
  assert.match(html, /Project ID: Application/);
  assert.match(html, /value="https:\/\/jenkins\.example\/job\/application"/);
  assert.match(html, /value="team:application"/);
  assert.match(html, /value="feature\/observed-branch"/);
  assert.match(html, /Leaving a field blank removes that optional setting/);
  assert.match(html, /Save changes/);
  assert.match(html, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(html, /<details class="branch-routing">/);
  assert.match(html, /Branch routing <span>Optional Jenkins and SonarQube overrides<\/span>/);
  assert.doesNotMatch(html, /<details class="branch-routing" open>/);
  assert.doesNotMatch(html, /Connect registered folders/);

  const minimalHtml = buildProjectIntegrationPanelHtml({
    projects: [{ name: 'Minimal', path: '/workspace/minimal' }],
    providerReadiness: [{ name: 'GitLab', ready: false, detail: 'Configuration needed.' }],
    nonce: 'minimal-project-integration-nonce',
    scriptUri: 'vscode-webview://fixture/kronos-project-integration.js',
  });
  assert.match(minimalHtml, /<h2>Minimal<\/h2>/);
  assert.doesNotMatch(minimalHtml, /Project ID: Minimal/);
  assert.match(minimalHtml, /branch unavailable/);
  assert.match(minimalHtml, /data-field="defaultBranch" value=""/);
  assert.match(minimalHtml, /provider-readiness warn/);

  const emptyHtml = buildProjectIntegrationPanelHtml({
    projects: [],
    providerReadiness: [],
    nonce: 'empty-project-integration-nonce',
    scriptUri: 'vscode-webview://fixture/kronos-project-integration.js',
  });
  assert.match(emptyHtml, /No registered local projects are available to configure/);
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

  const conflictStatuses = [
    'added by us', 'added by them', 'deleted by us', 'deleted by them',
    'both added', 'both deleted', 'both modified',
  ];
  const conflictMatrix = projectGitPresentation.projectGitStatusPresentation(evidence({
    changeCount: conflictStatuses.length,
    changes: conflictStatuses.map((status, index) => ({ path: `conflict-${index}`, status, staged: false })),
  }));
  assert.equal(conflictMatrix.conflictCount, conflictStatuses.length);
  assert.equal(conflictMatrix.modifiedCount, 0);

  const singular = projectGitPresentation.projectGitStatusPresentation(evidence({
    changeCount: 1,
    changes: [{ path: 'only.ts', status: 'modified', staged: false }],
  }));
  assert.equal(singular.label, '1 change');
  assert.equal(singular.conflictCount, 0);
  assert.equal(singular.stagedCount, 0);
});

test('project Git state panel makes branches and dirty state scannable without exposing a checkout action', () => {
  const html = projectGitPresentation.buildProjectGitStatePanelHtml({
    projectName: 'Application<script>',
    displayName: 'Customer <API>',
    evidence: {
      projectPath: '/fixture/customer-api',
      branch: 'feature/panel',
      detached: false,
      upstream: 'origin/feature/panel',
      ahead: 3,
      behind: 1,
      branches: [
        { name: 'feature/panel', kind: 'local', current: true },
        { name: 'main', kind: 'local', current: false },
        { name: 'origin/main', kind: 'remote', current: false },
        { name: 'origin/<unsafe>', kind: 'remote', current: false },
      ],
      branchCount: 4,
      branchesTruncated: false,
      changes: [
        { path: 'src/panel.ts', status: 'modified', staged: false },
        { path: 'src/staged.ts', status: 'index modified', staged: true },
      ],
      changeCount: 2,
      diff: '+safe\n</pre><script>unsafe()</script>',
      diffTruncated: false,
      available: true,
      warning: 'Read warning <unsafe>',
    },
    nonce: 'git-state-nonce',
    actionScriptUri: 'vscode-webview://fixture/kronos-action-panel.js',
  });
  assert.deepEqual([...projectGitPresentation.PROJECT_GIT_STATE_ACTIONS], [
    'refresh',
    'openSourceControl',
    'close',
  ]);
  assert.match(html, /Customer &lt;API&gt; Git state/);
  assert.match(html, /feature\/panel/);
  assert.match(html, /origin\/feature\/panel/);
  assert.match(html, /3 ahead · 1 behind/);
  assert.match(html, /origin\/&lt;unsafe&gt;/);
  assert.match(html, /src\/staged\.ts/);
  assert.match(html, /data-action="openSourceControl"/);
  assert.match(html, /Open Source Control to switch/);
  assert.match(html, /Kronos keeps Git read-only/);
  assert.match(html, /&lt;\/pre&gt;&lt;script&gt;unsafe\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /data-action="checkout"|git\.checkout|<script>unsafe\(\)<\/script>/);

  const defaultSyncHtml = projectGitPresentation.buildProjectGitStatePanelHtml({
    projectName: 'Default sync project',
    evidence: {
      projectPath: '/fixture/default-sync',
      branch: 'feature/default-sync',
      detached: false,
      upstream: 'origin/feature/default-sync',
      branches: [],
      branchCount: 0,
      branchesTruncated: false,
      changes: [{ path: 'src/default.ts', status: 'modified', staged: false }],
      changeCount: 1,
      diff: '+default',
      diffTruncated: true,
      available: true,
    },
    nonce: 'default-sync-nonce',
    actionScriptUri: 'vscode-webview://fixture/kronos-action-panel.js',
  });
  assert.match(defaultSyncHtml, /0 ahead · 0 behind/);
  assert.match(defaultSyncHtml, /Diff against HEAD · truncated/);

  const cleanHtml = projectGitPresentation.buildProjectGitStatePanelHtml({
    projectName: 'Clean project',
    evidence: {
      projectPath: '/fixture/clean',
      branch: 'main',
      detached: false,
      branches: [{ name: 'main', kind: 'local', current: true }],
      branchCount: 1,
      branchesTruncated: true,
      changes: [],
      changeCount: 0,
      diff: '',
      diffTruncated: false,
      available: true,
    },
    nonce: 'clean-git-state-nonce',
    actionScriptUri: 'vscode-webview://fixture/kronos-action-panel.js',
  });
  assert.match(cleanHtml, /Clean project Git state/);
  assert.match(cleanHtml, /Clean working tree/);
  assert.match(cleanHtml, /No upstream/);
  assert.match(cleanHtml, /Branches · list truncated/);
  assert.match(cleanHtml, /None reported by VS Code/);
  assert.doesNotMatch(cleanHtml, /Diff against HEAD/);

  const unavailableHtml = projectGitPresentation.buildProjectGitStatePanelHtml({
    projectName: 'Detached project',
    evidence: {
      projectPath: '/fixture/detached',
      detached: true,
      branches: [],
      branchCount: 0,
      branchesTruncated: false,
      changes: [],
      changeCount: 0,
      diff: '',
      diffTruncated: false,
      available: false,
    },
    nonce: 'unavailable-git-state-nonce',
    actionScriptUri: 'vscode-webview://fixture/kronos-action-panel.js',
  });
  assert.match(unavailableHtml, /Detached HEAD/);
  assert.match(unavailableHtml, /Git status is not available yet/);
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

  const unreadable = path.join(tempRoot, 'temporarily-unreadable-discovery-root');
  fs.mkdirSync(unreadable);
  const originalReadDirectory = fs.readdirSync;
  fs.readdirSync = (directory, ...args) => {
    if (path.resolve(String(directory)) === unreadable) {
      throw new Error('fixture directory unavailable\nwith control text');
    }
    return originalReadDirectory(directory, ...args);
  };
  let unavailable;
  try {
    unavailable = projectDiscovery.discoverLocalProjects({ roots: [unreadable], depth: 1, limit: 100 });
  } finally {
    fs.readdirSync = originalReadDirectory;
  }
  assert.equal(unavailable.projects.length, 0);
  assert.match(unavailable.warnings.join(' '), /fixture directory unavailable with control text/);
});

test('project discovery finds and independently registers a Git repository nested inside another repository', () => {
  const outerRepository = path.join(tempRoot, 'nested-repository', 'outer-project');
  const innerRepository = path.join(outerRepository, 'inner-project');
  for (const [directory, branch] of [[outerRepository, 'feature/outer'], [innerRepository, 'feature/inner']]) {
    fs.mkdirSync(path.join(directory, '.git'), { recursive: true });
    fs.writeFileSync(path.join(directory, '.git', 'HEAD'), `ref: refs/heads/${branch}\n`);
  }

  const fromWorkspace = projectDiscovery.discoverLocalProjects({
    workspaceFolders: [{ name: 'Outer Workspace', path: outerRepository }],
    roots: [],
    depth: 1,
    limit: 100,
  });
  assert.deepEqual(fromWorkspace.projects.map(project => ({
    name: project.name,
    path: project.path,
    branch: project.branch,
  })), [{
    name: 'inner-project',
    path: fs.realpathSync.native(innerRepository),
    branch: 'feature/inner',
  }, {
    name: 'Outer Workspace',
    path: fs.realpathSync.native(outerRepository),
    branch: 'feature/outer',
  }]);

  const fromConfiguredRoot = projectDiscovery.discoverLocalProjects({
    roots: [outerRepository],
    depth: 1,
    limit: 100,
  });
  assert.deepEqual(
    new Set(fromConfiguredRoot.projects.map(project => project.path)),
    new Set([fs.realpathSync.native(outerRepository), fs.realpathSync.native(innerRepository)]),
  );

  const plan = projectCatalog.planLocalProjectRegistrations(stateStore.emptyWorkCatalog(), fromWorkspace.projects);
  const registered = projectCatalog.replaceRegisteredLocalProjects(stateStore.emptyWorkCatalog(), plan);
  assert.deepEqual(
    new Set(projectCatalog.listLocalProjects(registered).map(project => project.path)),
    new Set([fs.realpathSync.native(outerRepository), fs.realpathSync.native(innerRepository)]),
    'the outer and inner repositories remain separate registration identities',
  );
});

test('project discovery canonicalizes linked roots, accepts linked repositories, and does not traverse linked trees', t => {
  const discoveryRoot = path.join(tempRoot, 'canonical-discovery-root');
  const repository = path.join(discoveryRoot, 'service');
  const externalRepository = path.join(tempRoot, 'external-repository');
  const externalContainer = path.join(tempRoot, 'external-container');
  const nestedExternalRepository = path.join(externalContainer, 'nested-service');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  fs.mkdirSync(path.join(externalRepository, '.git'), { recursive: true });
  fs.mkdirSync(path.join(nestedExternalRepository, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repository, '.git', 'HEAD'), 'ref: refs/heads/feature/canonical\n');
  fs.writeFileSync(path.join(externalRepository, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(nestedExternalRepository, '.git', 'HEAD'), 'ref: refs/heads/feature/nested-link\n');
  const rootAlias = path.join(tempRoot, 'canonical-discovery-alias');
  const directoryLinkType = process.platform === 'win32' ? 'junction' : 'dir';
  if (!createSymlinkOrSkip(t, discoveryRoot, rootAlias, directoryLinkType)) { return; }
  if (!createSymlinkOrSkip(t, externalRepository, path.join(discoveryRoot, 'linked-external'), directoryLinkType)) { return; }
  if (!createSymlinkOrSkip(t, externalContainer, path.join(discoveryRoot, 'linked-container'), directoryLinkType)) { return; }

  const discovered = projectDiscovery.discoverLocalProjects({
    workspaceFolders: [{ name: 'Workspace Alias', path: path.join(rootAlias, 'service') }],
    roots: [discoveryRoot, rootAlias],
    depth: 3,
    limit: 100,
  });
  assert.deepEqual(discovered.projects.find(project => project.source === 'workspace'), {
    name: 'Workspace Alias',
    path: fs.realpathSync.native(repository),
    source: 'workspace',
    branch: 'feature/canonical',
  });
  assert.deepEqual(discovered.projects.find(project => project.path === fs.realpathSync.native(externalRepository)), {
    name: 'external-repository',
    path: fs.realpathSync.native(externalRepository),
    source: 'configured-root',
    branch: 'main',
  });
  assert.equal(
    discovered.projects.some(project => project.path === fs.realpathSync.native(nestedExternalRepository)),
    false,
    'a linked non-repository container must not expand the discovery boundary',
  );
  assert.equal(discovered.projects.length, 2);
});

test('project discovery recognizes real Git worktrees and rejects malformed Git marker files', () => {
  const discoveryRoot = path.join(tempRoot, 'worktree-discovery-root');
  const worktree = path.join(discoveryRoot, 'valid-worktree');
  const gitDirectory = path.join(tempRoot, 'worktree-discovery-git-data');
  const malformed = path.join(discoveryRoot, 'malformed-marker');
  const oversized = path.join(discoveryRoot, 'oversized-marker');
  for (const directory of [worktree, gitDirectory, malformed, oversized]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitDirectory}\n`);
  fs.writeFileSync(path.join(gitDirectory, 'HEAD'), 'ref: refs/heads/feature/discovered-worktree\n');
  fs.writeFileSync(path.join(malformed, '.git'), 'not a gitdir pointer\n');
  fs.writeFileSync(path.join(oversized, '.git'), 'x'.repeat(4_097));

  const discovered = projectDiscovery.discoverLocalProjects({
    roots: [discoveryRoot],
    depth: 1,
    limit: 100,
  });
  assert.deepEqual(discovered.projects, [{
    name: 'valid-worktree',
    path: fs.realpathSync.native(worktree),
    source: 'configured-root',
    branch: 'feature/discovered-worktree',
  }]);
});

test('project discovery edge inputs remain bounded across invalid roots, aliases, home expansion, and wide folders', () => {
  const rootPath = path.join(tempRoot, 'discovery-edge-root');
  const repository = path.join(rootPath, 'repository');
  fs.mkdirSync(path.join(repository, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repository, '.git', 'HEAD'), 'ref: refs/heads/edge\n');
  const regularFile = path.join(rootPath, 'regular-file');
  fs.writeFileSync(regularFile, 'not a directory');

  const invalid = projectDiscovery.discoverLocalProjects({
    workspaceFolders: [
      { name: 7, path: repository },
      { name: 'duplicate', path: repository },
      { name: 'missing', path: '' },
      { name: 'file', path: regularFile },
      { name: 'relative', path: 'relative/path' },
    ],
    roots: [7, '', regularFile, 'relative/path', '~/kronos-definitely-missing-discovery-root'],
    depth: 0,
    limit: 10,
  });
  assert.equal(invalid.projects.length, 1);
  assert.equal(invalid.projects[0].name, 'duplicate');
  assert.equal(invalid.warnings.length, 8);
  assert.deepEqual(projectDiscovery.discoverLocalProjects({}), {
    projects: [], warnings: [], visitedDirectories: 0, truncated: false,
  });

  const originalReadDirectory = fs.readdirSync;
  fs.readdirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(rootPath)) { throw 'fixture unavailable directory'; }
    return originalReadDirectory(target, options);
  };
  let nonErrorFailure;
  try {
    nonErrorFailure = projectDiscovery.discoverLocalProjects({ roots: [rootPath], depth: 1, limit: 10 });
  } finally {
    fs.readdirSync = originalReadDirectory;
  }
  assert.match(nonErrorFailure.warnings.join(' '), /unavailable directory/i);

  const wideRoot = path.join(tempRoot, 'discovery-wide-root');
  fs.mkdirSync(wideRoot);
  for (let index = 0; index < 2001; index += 1) {
    fs.writeFileSync(path.join(wideRoot, `entry-${String(index).padStart(4, '0')}`), 'x');
  }
  const wide = projectDiscovery.discoverLocalProjects({ roots: [wideRoot], depth: 1, limit: 10 });
  assert.equal(wide.truncated, true);
  assert.match(wide.warnings.join(' '), /first 2000/i);

  const home = projectDiscovery.discoverLocalProjects({
    roots: ['~', '~\\kronos-definitely-missing-discovery-root'], depth: 0, limit: 1,
  });
  assert.ok(home.visitedDirectories <= 1);
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
    'GitLab: credentials needed',
    'Jenkins: credentials needed',
    'SonarQube: credentials needed',
  ]);
  const active = projectInventoryPresentation.projectIntegrationStatusLines(config, {
    gitlab: true,
    jenkins: true,
    sonar: true,
  });
  assert.deepEqual(active, [
    'GitLab: ready',
    'Jenkins: ready',
    'SonarQube: ready',
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
  assert.equal(
    projectCatalog.setLocalProjectSonarTarget(setupState, 'Missing', 'team:application'),
    setupState,
    'provider discovery ignores a project removed before its result arrives',
  );
  assert.throws(
    () => projectCatalog.setLocalProjectSonarTarget(setupState, 'Valid', 'unsupported key'),
    /invalid SonarQube project key/i,
  );
  const discoveredSonar = projectCatalog.setLocalProjectSonarTarget(
    setupState,
    'Valid',
    'team:application',
    'feature/sonar',
  );
  assert.equal(discoveredSonar.projects.Valid.config.sonar_project_key, 'team:application');
  assert.equal(discoveredSonar.projects.Valid.config.sonar_branch, 'feature/sonar');
  assert.equal(
    projectCatalog.setLocalProjectSonarTarget(discoveredSonar, 'Valid', 'team:application', 'feature/sonar'),
    discoveredSonar,
    'an unchanged discovered SonarQube target preserves state identity',
  );
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(setupState, [{
    name: 'Valid',
    defaultBranch: 'bad..branch',
  }]), /default branch contains unsupported Git branch characters/i);
  assert.throws(
    () => projectCatalog.setLocalProjectSonarTarget(setupState, 'Valid', 'team:application', '../unsafe'),
    /SonarQube branch contains unsupported Git branch characters/i,
  );
});

test('project catalog edge matrix validates identity, integration, profile, and Git pointer boundaries', t => {
  const projectRoot = path.join(tempRoot, 'project-edge-root');
  const nestedRoot = path.join(projectRoot, 'nested');
  fs.mkdirSync(nestedRoot, { recursive: true });
  const initial = stateStore.emptyWorkCatalog();
  initial.projects.Application = {
    path: projectRoot,
    display_name: 'Customer API',
    config: { repo_name: 'Application' },
  };
  initial.projects.Nested = { path: nestedRoot, config: {} };
  initial.projects.ProviderOnly = { config: { gitlab_project_id: 7 } };
  initial.tickets['EDGE-1'] = fixtureTicket({ linked_local_project: 'Application' });

  assert.equal(projectCatalog.matchesLocalProject({}, { name: 'Application', path: projectRoot }), false);
  assert.equal(projectCatalog.matchesLocalProject({ projectPath: projectRoot }, { name: 'Other', path: projectRoot }), true);
  assert.equal(projectCatalog.localProjectReferenceKey({ projectPath: projectRoot }), `path:${projectRoot}`);
  assert.equal(projectCatalog.localProjectReferenceKey({ projectName: 'Application' }), 'name:Application');
  assert.equal(projectCatalog.localProjectReferenceKey({}), undefined);
  assert.equal(projectCatalog.registeredLocalProjectForDirectory(initial, path.join(nestedRoot, 'src')).name, 'Nested');

  const registeredAgain = projectCatalog.registerLocalProject(initial, 'Renamed', projectRoot);
  assert.equal(registeredAgain.projects.Application.display_name, 'Customer API');
  assert.equal(registeredAgain.projects.Application.config.repo_name, 'Application');
  assert.equal(projectCatalog.renameLocalProjectDisplayName(initial, 'Application', 'Customer API'), initial);
  assert.throws(() => projectCatalog.renameLocalProjectDisplayName(initial, 'Missing', 'Name'), /not registered/i);
  assert.throws(() => projectCatalog.registerLocalProject(initial, '', projectRoot), /project name is required/i);
  assert.throws(() => projectCatalog.registerLocalProject(initial, 'Bad', 'relative/path'), /must be absolute/i);
  const regularFile = path.join(tempRoot, 'not-a-project-directory');
  fs.writeFileSync(regularFile, 'file');
  assert.throws(() => projectCatalog.registerLocalProject(initial, 'Bad', regularFile), /not a directory/i);

  assert.equal(projectCatalog.projectTicketProviderState(initial, 'EDGE-9', {}), initial);
  assert.equal(projectCatalog.projectTicketProviderState(initial, 'EDGE-1', {}), initial);
  const providerState = projectCatalog.projectTicketProviderState(initial, 'EDGE-1', {
    mr: { iid: 1, state: 'opened', review_status: 'pending_review' },
    build: { number: 2, status: 'FAILURE' },
  });
  assert.equal(providerState.tickets['EDGE-1'].mr.iid, 1);
  assert.equal(providerState.tickets['EDGE-1'].build.number, 2);
  assert.throws(() => projectCatalog.projectTicketProviderState(initial, 'bad', {}), /Invalid Jira ticket key/i);
  assert.throws(() => projectCatalog.setTicketLocalProject(initial, 'EDGE-9'), /not loaded/i);
  assert.throws(() => projectCatalog.setTicketLocalProject(initial, 'EDGE-1', 'ProviderOnly'), /not registered/i);
  assert.throws(() => projectCatalog.setTicketLocalProject(initial, 'EDGE-1', ''), /project name is required/i);

  const planned = projectCatalog.planLocalProjectRegistrations(initial, [
    { name: 'first', path: projectRoot },
    { name: 'duplicate', path: projectRoot },
    { name: 7, path: nestedRoot },
    { name: 'missing', path: path.join(tempRoot, 'missing-project') },
  ]);
  assert.deepEqual(planned.map(item => item.name), ['Application', 'Nested']);
  const emptyState = stateStore.emptyWorkCatalog();
  assert.equal(projectCatalog.planLocalProjectRegistrations(emptyState, [{ name: 7, path: projectRoot }])[0].name, 'Project');

  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{ name: 'Missing' }]), /not registered/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{ name: 7 }]), /project name is required/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application', gitlabProject: '9'.repeat(400),
  }]), /project ID is too large/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application', gitlabProject: 'invalid path',
  }]), /numeric ID or group\/project path/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application', jenkinsUrl: 'http://remote.example/job/app',
  }]), /must be an HTTPS URL/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application', sonarProjectKey: 'invalid key',
  }]), /unsupported characters/i);
  assert.throws(() => projectCatalog.setLocalProjectIntegrations(initial, [{
    name: 'Application', branchProfiles: 'main | https://jenkins.example/job/app', activeBranchProfile: 'release',
  }]), /must match one configured branch profile/i);
  const cleared = projectCatalog.setLocalProjectIntegrations(initial, [{ name: 'Application', nickname: 'Application' }]);
  assert.equal(cleared.projects.Application.display_name, undefined);

  for (const [value, expected] of [
    [7, /20,?000-character limit/i],
    ['x'.repeat(20_001), /20,?000-character limit/i],
    ['main', /must use/i],
    [' | https://jenkins.example/job/app', /unsupported Git branch/i],
    ['main | | invalid key', /unsupported characters/i],
    ['main | | ', /must configure/i],
    ['main | https://jenkins.example/job/app\nmain | https://jenkins.example/job/other', /duplicated/i],
    [Array.from({ length: 21 }, (_, index) => `branch-${index} | https://jenkins.example/job/${index}`).join('\n'), /20-profile limit/i],
  ]) {
    assert.throws(() => projectCatalog.parseProjectBranchProfiles(value), expected);
  }
  const sonarOnly = projectCatalog.parseProjectBranchProfiles('main | | team:app');
  assert.deepEqual(sonarOnly, [{ branch: 'main', sonar_project_key: 'team:app', sonar_branch: 'main' }]);
  assert.equal(projectCatalog.formatProjectBranchProfiles(undefined), '');
  assert.equal(projectCatalog.formatProjectBranchProfiles([{ branch: 'main' }]), 'main |  |  | ');
  assert.deepEqual(projectCatalog.selectProjectBranchProfile({
    branch_profiles: sonarOnly,
    active_branch_profile: 'main',
  }, [null, ' ', 'missing']), sonarOnly[0]);
  assert.equal(projectCatalog.selectProjectBranchProfile({
    branch_profiles: sonarOnly,
    active_branch_profile: 'missing',
  }), undefined);
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(initial, initial.tickets['EDGE-1']), { repo_name: 'Application' });
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(initial, { ...initial.tickets['EDGE-1'], linked_local_project: 'Missing' }), {});
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(null, initial.tickets['EDGE-1']), {});
  assert.deepEqual(projectCatalog.listLocalProjects(null), []);
  assert.equal(projectCatalog.ticketLocalProject(initial, null), undefined);
  assert.equal(projectCatalog.ticketLocalProject(initial, { ...initial.tickets['EDGE-1'], linked_local_project: 'Missing' }), undefined);
  assert.equal(projectCatalog.ticketLocalProject(initial, { ...initial.tickets['EDGE-1'], linked_local_project: 'ProviderOnly' }), undefined);

  const relativeState = stateStore.emptyWorkCatalog();
  relativeState.projects.Relative = { path: 'relative/path', config: {} };
  assert.equal(projectCatalog.listLocalProjects(relativeState)[0].path, 'relative/path');
  assert.equal(projectCatalog.listLocalProjects(relativeState)[0].available, false);

  const gitCases = path.join(tempRoot, 'project-git-edge');
  fs.mkdirSync(gitCases);
  fs.writeFileSync(path.join(gitCases, '.git'), 'not a git pointer\n');
  assert.equal(projectCatalog.readProjectGitBranch(gitCases), undefined);
  fs.writeFileSync(path.join(gitCases, '.git'), 'gitdir: missing\n');
  assert.equal(projectCatalog.readProjectGitBranch(gitCases), undefined);
  const externalGit = path.join(tempRoot, 'external-git-dir');
  fs.mkdirSync(externalGit);
  fs.writeFileSync(path.join(externalGit, 'HEAD'), 'not-a-ref-or-sha\n');
  fs.writeFileSync(path.join(gitCases, '.git'), `gitdir: ${externalGit}\n`);
  assert.equal(projectCatalog.readProjectGitBranch(gitCases), undefined);
  fs.writeFileSync(path.join(externalGit, 'HEAD'), `ref: refs/heads/${String.fromCharCode(0)}\n`);
  assert.equal(projectCatalog.readProjectGitBranch(gitCases), undefined);
  fs.writeFileSync(path.join(externalGit, 'HEAD'), 'ABCDEF0123456789\n');
  assert.deepEqual(projectCatalog.readProjectGitBranch(gitCases), { branch: 'detached@abcdef0', detached: true });

  const symlinkProject = path.join(tempRoot, 'project-git-symlink');
  fs.mkdirSync(symlinkProject);
  if (createSymlinkOrSkip(t, externalGit, path.join(symlinkProject, '.git'), 'dir')) {
    assert.equal(projectCatalog.readProjectGitBranch(symlinkProject), undefined);
  }
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
