const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
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
  assert.match(extension, /discoverRuntimeRegisteredProjectGitLabTarget\(\{/);
  const resolutionFlow = fs.readFileSync(path.join(root, 'src/commands/runtimeResolutionFlows.ts'), 'utf8');
  assert.match(resolutionFlow, /await input\.discover\(\{/);
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

test('explicit SonarQube settings outrank an unrelated local branch and Jenkins-only routing', t => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-sonar-default-'));
  t.after(() => fs.rmSync(projectPath, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectPath, '.git'));
  fs.writeFileSync(
    path.join(projectPath, '.git', 'HEAD'),
    'ref: refs/heads/feature/not-analyzed\n',
  );
  const state = {
    schemaVersion: 2,
    refreshedAt: null,
    projects: {
      Application: {
        path: projectPath,
        config: {
          jenkins_url: 'https://jenkins.example/job/app',
          sonar_project_key: 'app:key',
          default_branch: 'analysis/main',
          branch_profiles: [{
            branch: 'feature/not-analyzed',
            jenkins_url: 'https://jenkins.example/job/app/job/feature%2Fnot-analyzed',
          }],
        },
      },
    },
    tickets: {},
  };
  const projectMonitor = workSession({
    kind: 'project',
    ticketKey: undefined,
    ticketKeys: [],
    projectPath,
  });

  assert.deepEqual(reconciliation.configuredCiPollingTargets(state, projectMonitor), {
    jenkinsUrl: 'https://jenkins.example/job/app/job/feature%2Fnot-analyzed',
    jenkinsBranch: 'feature/not-analyzed',
    sonar: { projectKey: 'app:key', branch: 'analysis/main' },
  });

  state.tickets['JIRA-1'] = jiraTicket({
    linked_local_project: 'Application',
    mr: {
      iid: 41,
      state: 'opened',
      review_status: 'pending_review',
      source_branch: 'analysis/merge-request',
      url: 'https://gitlab.example/team/app/-/merge_requests/41',
    },
  });
  const linkedTicketSession = workSession({ projectPath });
  assert.deepEqual(reconciliation.configuredCiPollingTargets(state, linkedTicketSession), {
    jenkinsUrl: 'https://jenkins.example/job/app/job/feature%2Fnot-analyzed',
    jenkinsBranch: 'feature/not-analyzed',
    sonar: { projectKey: 'app:key', branch: 'analysis/merge-request' },
  }, 'a linked MR source branch still overrides the project default');
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
    { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4', GITLAB_TOKEN: 'fixture-token' },
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
    { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4', GITLAB_TOKEN: 'fixture-token' },
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

test('reconciliation edge matrix preserves optional identity, routing profiles, and deterministic event ordering', () => {
  assert.equal(reconciliation.configuredGitLabProjectIdentity(undefined), undefined);
  assert.equal(reconciliation.configuredGitLabProjectIdentity({ gitlab_project_id: 42 }), '42');
  assert.equal(reconciliation.reconcileKnownGitLabMergeRequestTarget(
    jiraTicket({ mr: null }),
    workSession({ providerBindings: [binding({ provider: 'gitlab', resource: 'merge-request', subjectId: '8' })] }),
    undefined,
    {},
  ), undefined, 'a binding without any project identity cannot become a polling target');
  assert.deepEqual(reconciliation.reconcileKnownGitLabMergeRequestTarget(
    jiraTicket({ mr: { iid: 9, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/team/app/-/merge_requests/9' } }),
    workSession(),
    undefined,
    { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4', GITLAB_TOKEN: 'fixture-token' },
  ), {
    iid: 9,
    projectIdOrPath: 'team/app',
    source: 'catalog',
    url: 'https://gitlab.example/team/app/-/merge_requests/9',
  });

  const bareTicket = jiraTicket({ mr: { iid: 10, state: 'opened', review_status: 'pending_review', url: '' } });
  const bareCandidate = reconciliation.catalogGitLabBindingCandidate(bareTicket, workSession(), undefined, {});
  assert.deepEqual(bareCandidate, {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '10',
  });
  assert.equal(reconciliation.catalogGitLabBindingCandidate(
    bareTicket,
    workSession({ providerBindings: [binding({ provider: 'gitlab', resource: 'merge-request', subjectId: '10' })] }),
    undefined,
    {},
  ), undefined, 'a complete bare identity is not rewritten');

  const profileState = {
    schemaVersion: 2,
    refreshedAt: null,
    projects: {
      Application: {
        config: {
          branch_profiles: [{
            branch: 'feature/profile',
            jenkins_url: 'https://jenkins.example/job/profile',
            sonar_project_key: 'team:profile',
            sonar_branch: 'analysis/profile',
          }],
          active_branch_profile: 'feature/profile',
        },
      },
    },
    tickets: { 'JIRA-1': jiraTicket({ linked_local_project: 'Application', mr: null }) },
  };
  assert.deepEqual(reconciliation.configuredCiPollingTargets(
    profileState,
    workSession(),
    {
      JENKINS_URL: 'https://jenkins.example',
      SONAR_HOST_URL: 'https://sonar.example',
    },
  ), {
    jenkinsUrl: 'https://jenkins.example/job/profile',
    jenkinsBranch: 'feature/profile',
    sonar: {
      projectKey: 'team:profile',
      branch: 'analysis/profile',
      providerUrl: 'https://sonar.example/dashboard?id=team%3Aprofile&branch=analysis%2Fprofile',
    },
  });

  const tieSession = workSession({
    providerBindings: [
      binding({ id: 'binding-a', provider: 'gitlab', resource: 'merge-request', subjectId: '2', url: 'https://gitlab.example/a', attachedAt: '2026-07-15T12:00:00.000Z' }),
      binding({ id: 'binding-b', provider: 'gitlab', resource: 'merge-request', subjectId: '10', url: 'https://gitlab.example/b', attachedAt: '2026-07-15T12:00:00.000Z' }),
      binding({ id: 'binding-c', provider: 'gitlab', resource: 'pipeline', subjectId: '10', url: 'https://gitlab.example/c', attachedAt: '2026-07-15T12:00:00.000Z' }),
    ],
  });
  assert.deepEqual(
    reconciliation.providerBindingsForEvent(providerEvent('gitlab', 'pipeline', 'missing'), tieSession).map(item => item.id),
    ['binding-c', 'binding-b', 'binding-a'],
    'resource, numeric subject, and stable ID ties are deterministic',
  );
  assert.deepEqual(reconciliation.providerBindingsForEvent(providerEvent('local', 'build', '1'), tieSession), []);
  assert.deepEqual(reconciliation.providerBindingsForEvent(providerEvent('gitlab', undefined, '1'), undefined), []);

  const projected = reconciliation.effectiveTicketMergeRequest(
    jiraTicket({ mr: { iid: 11, state: 'closed', review_status: 'approved', url: '' } }),
    workSession(),
    mergeRequestDigest(11, {
      state: 'unknown-state',
      changesRequested: true,
      discussionsComplete: false,
      blockingDiscussionsResolved: false,
    }),
    {},
  );
  assert.equal(projected.state, 'closed');
  assert.equal(projected.review_status, 'changes_requested');
  assert.equal(projected.discussions_resolved, false);
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
    changesRequested: overrides.changesRequested ?? false,
    blockingDiscussionsResolved: overrides.blockingDiscussionsResolved ?? true,
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
    discussionsComplete: overrides.discussionsComplete ?? true,
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
