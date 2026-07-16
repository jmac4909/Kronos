const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const reconciliation = require('../out/services/providerBindingReconciliation.js');

test('one provider binding reconciliation owner feeds Work, Sessions, Projects, Attention, polling, and context insertion', () => {
  const consumers = [
    'src/terminalFirstExtension.ts',
    'src/services/managedProviderMonitor.ts',
    'src/services/ticketWorkspaceView.ts',
    'src/views/AttentionTreeProvider.ts',
  ];
  for (const relativeFile of consumers) {
    assert.match(
      fs.readFileSync(path.join(root, relativeFile), 'utf8'),
      /providerBindingReconciliation/,
      `${relativeFile} must consume the shared reconciliation owner`,
    );
  }
  assert.equal(fs.existsSync(path.join(root, 'src/services/ticketMergeRequestProjection.ts')), false);
  const owner = fs.readFileSync(path.join(root, 'src/services/providerBindingReconciliation.ts'), 'utf8');
  for (const exportedRule of [
    'effectiveTicketMergeRequest',
    'reconcileKnownGitLabMergeRequestTarget',
    'configuredCiPollingTargets',
    'providerBindingsForEvent',
  ]) {
    assert.match(owner, new RegExp(`export function ${exportedRule}\\b`));
  }
  const extension = fs.readFileSync(path.join(root, 'src/terminalFirstExtension.ts'), 'utf8');
  assert.doesNotMatch(extension, /currentMatchesTicket|mergeRequestNeedsEnrichment/);
  assert.match(extension, /discoverRegisteredProjectGitLabTarget\(project\)/);
  assert.match(extension, /gitlabRestClient\.discoverOpenMergeRequest\(\{/);
  assert.doesNotMatch(extension, /latestGitLabMergeRequestUrlAcrossSessions/);
});

test('bound MR identity wins stale catalog and only a matching monitor digest enriches it after reload', () => {
  const ticket = jiraTicket({
    mr: {
      iid: 77,
      state: 'merged',
      review_status: 'approved',
      url: 'https://gitlab.example/team/app/-/merge_requests/77',
      title: 'Stale catalog MR',
    },
  });
  const session = JSON.parse(JSON.stringify(workSession({
    providerBindings: [binding({
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '88',
      projectId: 'team/app',
      url: 'https://gitlab.example/team/app/-/merge_requests/88',
    })],
  })));
  const staleDigest = mergeRequestDigest(77, { state: 'merged', title: 'Stale monitor MR' });
  assert.deepEqual(reconciliation.effectiveTicketMergeRequest(ticket, session, staleDigest), {
    iid: 88,
    state: 'opened',
    review_status: 'pending_review',
    url: 'https://gitlab.example/team/app/-/merge_requests/88',
  });
  const matching = reconciliation.effectiveTicketMergeRequest(
    ticket,
    session,
    mergeRequestDigest(88, { title: 'Current bound MR', approved: true }),
  );
  assert.equal(matching.iid, 88);
  assert.equal(matching.title, 'Current bound MR');
  assert.equal(matching.review_status, 'approved');
});

test('catalog MR binding candidates enrich only the same identity and never overwrite a newer binding', () => {
  const ticket = jiraTicket({
    mr: {
      iid: 77,
      state: 'opened',
      review_status: 'pending_review',
      url: 'https://gitlab.example/team/app/-/merge_requests/77',
    },
  });
  const config = { gitlab_project_path: 'team/app' };
  assert.deepEqual(
    reconciliation.catalogGitLabBindingCandidate(ticket, workSession(), config),
    {
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '77',
      projectId: 'team/app',
      url: 'https://gitlab.example/team/app/-/merge_requests/77',
    },
  );
  const sameIdentity = workSession({
    providerBindings: [binding({ provider: 'gitlab', resource: 'merge-request', subjectId: '77' })],
  });
  assert.deepEqual(
    reconciliation.catalogGitLabBindingCandidate(ticket, sameIdentity, config),
    {
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '77',
      projectId: 'team/app',
      url: 'https://gitlab.example/team/app/-/merge_requests/77',
    },
  );
  const newerIdentity = workSession({
    providerBindings: [binding({ provider: 'gitlab', resource: 'merge-request', subjectId: '88' })],
  });
  assert.equal(reconciliation.catalogGitLabBindingCandidate(ticket, newerIdentity, config), undefined);
});

test('Jenkins job, build history, and SonarQube branch identities remain distinct under one resolver', () => {
  const state = {
    schemaVersion: 2,
    refreshedAt: null,
    projects: {
      Application: {
        config: {
          jenkins_url: 'https://jenkins.example/job/app',
          sonar_project_key: 'app:key',
          default_branch: 'main',
        },
      },
    },
    tickets: { 'JIRA-1': jiraTicket({ linked_local_project: 'Application' }) },
  };
  const session = workSession({
    providerBindings: [
      binding({ provider: 'jenkins', resource: 'job', subjectId: 'configured', url: 'https://jenkins.example/job/app' }),
      binding({ provider: 'jenkins', resource: 'build', subjectId: '31', url: 'https://jenkins.example/job/app/31/', attachedAt: '2026-07-15T12:01:00.000Z' }),
      binding({ provider: 'jenkins', resource: 'build', subjectId: '32', url: 'https://jenkins.example/job/app/32/', attachedAt: '2026-07-15T12:02:00.000Z' }),
      binding({ provider: 'sonar', resource: 'quality-gate', subjectId: 'app:key:main', projectId: 'app:key', url: 'https://sonar.example/dashboard?id=app%3Akey&branch=main' }),
      binding({ provider: 'sonar', resource: 'quality-gate', subjectId: 'app:key:feature', projectId: 'app:key', url: 'https://sonar.example/dashboard?id=app%3Akey&branch=feature', attachedAt: '2026-07-15T12:03:00.000Z' }),
    ],
  });
  assert.deepEqual(reconciliation.configuredCiPollingTargets(state, session), {
    jenkinsUrl: 'https://jenkins.example/job/app',
    sonar: { projectKey: 'app:key', branch: 'main' },
  });
  const buildEvent = providerEvent('jenkins', 'build', '32');
  assert.deepEqual(
    reconciliation.providerBindingsForEvent(buildEvent, session)
      .filter(item => item.provider === 'jenkins')
      .map(item => [item.resource, item.subjectId]),
    [['build', '32'], ['build', '31'], ['job', 'configured']],
  );
  const sonarEvent = providerEvent('sonar', 'quality-gate', 'app:key:feature');
  assert.equal(reconciliation.providerBindingsForEvent(sonarEvent, session)[0].subjectId, 'app:key:feature');
});

test('reconciled provider URLs are credential-free and rejected outside the configured origin', () => {
  const ticket = jiraTicket();
  const crossOrigin = workSession({
    providerBindings: [binding({
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '88',
      projectId: 'team/app',
      url: 'https://attacker.example/team/app/-/merge_requests/88?token=secret',
    })],
  });
  assert.deepEqual(reconciliation.reconcileKnownGitLabMergeRequestTarget(
    ticket,
    crossOrigin,
    'team/app',
    { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4' },
  ), {
    iid: 88,
    projectIdOrPath: 'team/app',
    source: 'binding',
  });
  const sameOrigin = workSession({
    providerBindings: [binding({
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '88',
      projectId: 'team/app',
      url: 'https://gitlab.example/team/app/-/merge_requests/88?token=secret#fragment',
    })],
  });
  assert.equal(reconciliation.reconcileKnownGitLabMergeRequestTarget(
    ticket,
    sameOrigin,
    'team/app',
    { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4' },
  ).url, 'https://gitlab.example/team/app/-/merge_requests/88');
  assert.equal(reconciliation.reconcileKnownGitLabMergeRequestTarget(
    ticket,
    sameOrigin,
    'team/app',
    { GITLAB_API_BASE_URL: 'not a valid provider origin/' },
  ).url, undefined, 'an invalid configured origin fails closed instead of disabling pinning');
});

test('multi-project reconciliation stays inside the explicitly linked project session set', () => {
  const applicationSession = workSession({
    id: 'session-application',
    projectName: 'Application',
    providerBindings: [binding({
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '88',
      projectId: 'team/application',
      url: 'https://gitlab.example/team/application/-/merge_requests/88',
      attachedAt: '2026-07-15T12:01:00.000Z',
    })],
  });
  const serviceSession = workSession({
    id: 'session-service',
    projectName: 'Service',
    providerBindings: [binding({
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '99',
      projectId: 'team/service',
      url: 'https://gitlab.example/team/service/-/merge_requests/99',
      attachedAt: '2026-07-15T12:02:00.000Z',
    })],
  });
  assert.equal(
    reconciliation.latestGitLabMergeRequestUrlAcrossSessions(
      [applicationSession],
      { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4' },
    ),
    'https://gitlab.example/team/application/-/merge_requests/88',
  );
  assert.equal(
    reconciliation.latestGitLabMergeRequestUrlAcrossSessions(
      [serviceSession],
      { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4' },
    ),
    'https://gitlab.example/team/service/-/merge_requests/99',
  );
  assert.equal(
    reconciliation.providerBindingsForEvent(
      { ...providerEvent('gitlab', 'merge-request', '88'), sessionId: applicationSession.id },
      applicationSession,
    )[0].subjectId,
    '88',
    'an event cannot pull a binding from an unrelated project session',
  );
  assert.match(
    fs.readFileSync(path.join(root, 'src/terminalFirstExtension.ts'), 'utf8'),
    /\.filter\(session => matchesLocalProject\(session, \{ name: project\.projectName, path: project\.projectPath \}\)\)/,
  );
});

function jiraTicket(overrides = {}) {
  return {
    summary: 'Fixture',
    type: 'Story',
    priority: 'High',
    jira_status: 'Open',
    source: 'jira',
    build: null,
    ...overrides,
  };
}

function workSession(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'session-provider-binding',
    kind: 'ticket',
    ticketKey: 'JIRA-1',
    ticketKeys: ['JIRA-1'],
    title: 'Provider binding fixture',
    projectName: 'Application',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
    ...overrides,
  };
}

let bindingIndex = 0;
function binding(overrides) {
  bindingIndex += 1;
  return {
    id: `binding-${bindingIndex}`,
    attachedAt: overrides.attachedAt || '2026-07-15T12:00:00.000Z',
    ...overrides,
  };
}

function mergeRequestDigest(iid, overrides = {}) {
  return {
    iid,
    state: overrides.state || 'opened',
    detailedMergeStatus: 'mergeable',
    changesRequested: false,
    blockingDiscussionsResolved: true,
    reviewers: { count: 0, fingerprint: 'reviewers' },
    approval: {
      available: true,
      approved: overrides.approved === true,
      approvalsRequired: 0,
      approvalsLeft: 0,
      approvedByCount: overrides.approved ? 1 : 0,
      approvedByFingerprint: 'approvals',
    },
    approvalsComplete: true,
    unresolvedDiscussions: { count: 0, fingerprint: 'discussions' },
    discussionsComplete: true,
    reviewActivity: { count: 0, fingerprint: 'activity' },
    reviewActivityComplete: true,
    updatedAt: '2026-07-15T12:00:00.000Z',
    fetchedAt: '2026-07-15T12:00:01.000Z',
    fingerprint: `mr-${iid}`,
    url: `https://gitlab.example/team/app/-/merge_requests/${iid}`,
    title: overrides.title,
  };
}

function providerEvent(source, kind, id) {
  return {
    schemaVersion: 1,
    id: `event-${source}-${id}`,
    at: '2026-07-15T13:00:00.000Z',
    sessionId: 'session-provider-binding',
    type: 'provider.transition',
    source,
    summary: 'Provider binding fixture',
    subject: { kind, id, ticketKey: 'JIRA-1' },
    metadata: { transitionKind: 'fixture_changed' },
  };
}
