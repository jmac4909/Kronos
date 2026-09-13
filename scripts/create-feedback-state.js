const fs = require('node:fs');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const defaultDir = path.join(root, '.kronos', 'feedback-state');

function fail(message) {
  console.error(`Feedback state failed: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { targetDir: defaultDir, force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--dir') {
      const value = argv[index + 1];
      if (!value) { fail('--dir requires a path'); }
      options.targetDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/create-feedback-state.js [--dir <path>] [--force]');
      process.exit(0);
    }
    fail(`unknown argument: ${argument}`);
  }
  return options;
}

function assertSafeTarget(targetDir) {
  const resolved = path.resolve(targetDir);
  const homeKronos = path.join(os.homedir(), '.kronos');
  if (resolved === homeKronos || !resolved.startsWith(`${path.resolve(root)}${path.sep}`)) {
    fail('the feedback fixture must stay in this repository and cannot replace ~/.kronos');
  }
  return resolved;
}

function writePrivate(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  if (process.platform !== 'win32') { fs.chmodSync(filePath, 0o600); }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fingerprint(value) {
  return sha256(JSON.stringify(value));
}

function projectMonitorFixtures(now, targetDir) {
  const projectName = 'fixture-service';
  const projectPath = path.join(targetDir, 'fixture-repo');
  const id = `project-monitor-${sha256(projectName).slice(0, 48)}`;
  const bindings = [
    {
      id: 'feedback-project-gitlab-mr-78',
      provider: 'gitlab',
      resource: 'merge-request',
      subjectId: '78',
      projectId: '1001',
      url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/78',
      attachedAt: now,
    },
    {
      id: 'feedback-project-jenkins-job',
      provider: 'jenkins',
      resource: 'job',
      subjectId: 'fixture-service',
      url: 'https://jenkins.example.invalid/job/fixture-service',
      attachedAt: now,
    },
    {
      id: 'feedback-project-sonar-gate',
      provider: 'sonar',
      resource: 'quality-gate',
      subjectId: 'fixture-service:feature/jira-456',
      projectId: 'fixture-service',
      url: 'https://sonar.example.invalid/dashboard?id=fixture-service&branch=feature%2Fjira-456',
      attachedAt: now,
    },
  ];
  const monitor = {
    schemaVersion: 1,
    id,
    kind: 'standalone',
    title: 'fixture-service provider monitoring',
    ticketKeys: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    terminals: [],
    providerBindings: bindings,
    artifacts: [],
    monitoring: {
      enabled: true,
      lastPolledAt: now,
      lastAttemptAt: now,
      lastSuccessfulAt: now,
      lastMeaningfulChangeAt: now,
      lastState: 'healthy',
      lastSummary: 'Synthetic current provider snapshots are ready for offline Attention review.',
      lastFailureCount: 0,
      lastSkippedCount: 0,
      suppressedUnchangedCount: 0,
    },
    projectName,
    projectPath,
  };

  const emptyIdentityFingerprint = sha256('');
  const mrMaterial = {
    schemaVersion: 1,
    iid: 78,
    state: 'opened',
    detailedMergeStatus: 'requested_changes',
    changesRequested: true,
    blockingDiscussionsResolved: false,
    reviewers: { count: 1, fingerprint: emptyIdentityFingerprint },
    approval: {
      available: true,
      approved: false,
      approvalsRequired: 1,
      approvalsLeft: 1,
      approvedByCount: 0,
      approvedByFingerprint: emptyIdentityFingerprint,
    },
    approvalsComplete: true,
    unresolvedDiscussions: { count: 2, fingerprint: emptyIdentityFingerprint },
    discussionsComplete: true,
    reviewActivity: { count: 1, fingerprint: emptyIdentityFingerprint },
    reviewActivityComplete: true,
    updatedAt: now,
    url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/78',
    title: 'Terminal-first fixture MR',
    sourceBranch: 'fix/jira-456',
    targetBranch: 'main',
  };
  const mergeRequest = {
    ...mrMaterial,
    fetchedAt: now,
    fingerprint: fingerprint(mrMaterial),
  };

  const pipelineMaterial = {
    schemaVersion: 1,
    id: 2143,
    status: 'failed',
    failedJobs: [{
      id: 901,
      name: 'verify',
      status: 'failed',
      stage: 'test',
      url: 'https://gitlab.example.invalid/group/fixture-service/-/jobs/901',
    }],
    failedJobsTruncated: false,
    jobsComplete: true,
    tests: { available: true, total: 20, failed: 2, error: 0, skipped: 0 },
    testsComplete: true,
    projectIdOrPath: '1001',
    url: 'https://gitlab.example.invalid/group/fixture-service/-/pipelines/2143',
    ref: 'fix/jira-456',
  };
  const pipeline = {
    ...pipelineMaterial,
    fetchedAt: now,
    fingerprint: fingerprint(pipelineMaterial),
  };

  const jenkinsMaterial = {
    schemaVersion: 1,
    provider: 'jenkins',
    jobOrBuildUrl: 'https://jenkins.example.invalid/job/fixture-service',
    buildUrl: 'https://jenkins.example.invalid/job/fixture-service/143',
    buildNumber: 143,
    status: 'FAILURE',
    building: false,
    testsAvailable: true,
    failedTestCount: 2,
    stagesAvailable: true,
    failedStageNames: ['verify'],
    failedStageNamesTruncated: false,
  };
  const jenkins = { ...jenkinsMaterial, fingerprint: fingerprint(jenkinsMaterial) };
  const sonarMaterial = {
    schemaVersion: 1,
    provider: 'sonarqube',
    projectKey: 'fixture-service',
    branch: 'feature/jira-456',
    dashboardUrl: 'https://sonar.example.invalid/dashboard?id=fixture-service&branch=feature%2Fjira-456',
    gateAvailable: true,
    gateStatus: 'ERROR',
    issueCountAvailable: true,
    unresolvedIssueCount: 4,
    metricsAvailable: true,
    metrics: [],
  };
  const sonar = { ...sonarMaterial, fingerprint: fingerprint(sonarMaterial) };
  const ciMaterial = {
    schemaVersion: 1,
    jenkins: jenkins.fingerprint,
    sonar: sonar.fingerprint,
  };
  const ci = {
    schemaVersion: 1,
    fingerprint: fingerprint(ciMaterial),
    jenkins,
    sonar,
  };
  return { id, monitor, mergeRequest, pipeline, ci };
}

function fixture(now, targetDir) {
  const projectPath = path.join(targetDir, 'fixture-repo');
  return {
    schemaVersion: 2,
    refreshedAt: now,
    projects: {
      'fixture-service': {
        path: projectPath,
        config: {
          repo_name: 'fixture-service',
          gitlab_project_id: 1001,
          jenkins_url: 'https://jenkins.example.invalid/job/fixture-service',
          sonar_project_key: 'fixture-service',
          default_branch: 'main',
        },
      },
    },
    tickets: {
      'JIRA-123': {
        summary: 'Terminal-owned session with linked MR and build',
        type: 'Story',
        priority: 'High',
        jira_status: 'In Review',
        jira_project_key: 'JIRA',
        source: 'jira',
        updated: now,
        description: 'Use this ticket to evaluate Manage Focused Terminal and explicit context insertion.',
        labels: ['terminal-first', 'safe-fixture'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-123',
        linked_local_project: 'fixture-service',
        mr: {
          iid: 77,
          state: 'opened',
          review_status: 'pending_review',
          url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/77',
          title: 'Terminal-first fixture MR',
          source_branch: 'feature/jira-123',
          target_branch: 'main',
          unresolved_discussion_count: 1,
        },
        build: {
          number: 142,
          status: 'SUCCESS',
          url: 'https://jenkins.example.invalid/job/fixture-service/142',
        },
      },
      'JIRA-456': {
        summary: 'Attention-state fixture with requested changes',
        type: 'Bug',
        priority: 'Critical',
        jira_status: 'In Progress',
        jira_project_key: 'JIRA',
        source: 'jira',
        updated: now,
        description: 'Provider URLs intentionally use .invalid and must never be mutated.',
        labels: ['terminal-first', 'needs-attention'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-456',
        linked_local_project: 'fixture-service',
        mr: {
          iid: 78,
          state: 'opened',
          review_status: 'changes_requested',
          url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/78',
          source_branch: 'fix/jira-456',
          target_branch: 'main',
          unresolved_discussion_count: 2,
        },
        build: {
          number: 143,
          status: 'FAILURE',
          url: 'https://jenkins.example.invalid/job/fixture-service/143',
        },
      },
      'JIRA-789': {
        summary: 'Completed unlinked Jira work item',
        type: 'Task',
        priority: 'Medium',
        jira_status: 'Done',
        jira_status_category: 'done',
        jira_project_key: 'JIRA',
        source: 'jira',
        updated: now,
        description: 'Use this row to verify completed filtering and graceful unavailable-provider states.',
        labels: ['terminal-first', 'unlinked', 'completed-fixture'],
        jira_url: 'https://jira.example.invalid/browse/JIRA-789',
        mr: null,
        build: null,
      },
    },
  };
}

function sessionFixtures(now, targetDir) {
  const projectPath = path.join(targetDir, 'fixture-repo');
  const createdAt = new Date(Date.parse(now) - 10_000).toISOString();
  const ticketSession = {
    schemaVersion: 1,
    id: 'jira-jira-456',
    kind: 'ticket',
    ticketKey: 'JIRA-456',
    title: 'Attention-state fixture with requested changes',
    status: 'active',
    createdAt,
    updatedAt: now,
    terminals: [],
    providerBindings: [
      {
        id: 'gitlab-merge-request-78',
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: '78',
        projectId: 'group/fixture-service',
        url: 'https://gitlab.example.invalid/group/fixture-service/-/merge_requests/78',
        attachedAt: new Date(Date.parse(now) - 8_000).toISOString(),
      },
      {
        id: 'jenkins-build-142',
        provider: 'jenkins',
        resource: 'build',
        subjectId: '142',
        url: 'https://jenkins.example.invalid/job/fixture-service/142',
        attachedAt: new Date(Date.parse(now) - 7_000).toISOString(),
      },
      {
        id: 'jenkins-build-143',
        provider: 'jenkins',
        resource: 'build',
        subjectId: '143',
        url: 'https://jenkins.example.invalid/job/fixture-service/143',
        attachedAt: new Date(Date.parse(now) - 6_000).toISOString(),
      },
      {
        id: 'sonar-quality-gate-feature',
        provider: 'sonar',
        resource: 'quality-gate',
        subjectId: 'fixture-service:feature/jira-456',
        projectId: 'fixture-service',
        url: 'https://sonar.example.invalid/dashboard?id=fixture-service&branch=feature%2Fjira-456',
        attachedAt: new Date(Date.parse(now) - 5_000).toISOString(),
      },
      {
        id: 'sonar-quality-gate-main',
        provider: 'sonar',
        resource: 'quality-gate',
        subjectId: 'fixture-service:main',
        projectId: 'fixture-service',
        url: 'https://sonar.example.invalid/dashboard?id=fixture-service&branch=main',
        attachedAt: new Date(Date.parse(now) - 4_000).toISOString(),
      },
    ],
    artifacts: [],
    monitoring: {
      enabled: false,
      lastAttemptAt: new Date(Date.parse(now) - 1_000).toISOString(),
      lastState: 'partial',
      lastSummary: 'Synthetic feedback evidence loaded with reserved unreachable provider hosts.',
      lastFailureCount: 1,
      lastSkippedCount: 0,
    },
    projectName: 'fixture-service',
    projectPath,
  };
  const standaloneSession = {
    schemaVersion: 1,
    id: 'session-feedback-standalone',
    kind: 'standalone',
    title: 'Standalone feedback session',
    status: 'active',
    createdAt,
    updatedAt: new Date(Date.parse(now) - 9_000).toISOString(),
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: false },
    projectName: 'fixture-service',
    projectPath,
  };
  return [ticketSession, standaloneSession];
}

function monitorFixtures(now) {
  const at = offset => new Date(Date.parse(now) + offset).toISOString();
  const sessionId = 'jira-jira-456';
  return [
    {
      schemaVersion: 1,
      id: 'feedback-session-created',
      at: at(-9_000),
      sessionId,
      type: 'session.created',
      source: 'operator',
      summary: 'JIRA-456 synthetic feedback session recorded without opening a terminal.',
      subject: { kind: 'work-session', id: sessionId, ticketKey: 'JIRA-456' },
    },
    {
      schemaVersion: 1,
      id: 'feedback-initial-mr-observed',
      at: at(-4_000),
      sessionId,
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'JIRA-456 MR !78 first observed (opened/mergeable).',
      subject: { kind: 'merge-request', id: '78', ticketKey: 'JIRA-456' },
      after: { state: 'opened/mergeable', fingerprint: 'feedback-mr-78-mergeable' },
      metadata: { transitionKind: 'initial_mr_observed', mergeRequestIid: 78 },
    },
    {
      schemaVersion: 1,
      id: 'feedback-jenkins-failed',
      at: at(-3_000),
      sessionId,
      type: 'provider.transition',
      source: 'jenkins',
      summary: 'JIRA-456 Jenkins build #143 failed in the synthetic feedback evidence.',
      subject: { kind: 'build', id: '143', ticketKey: 'JIRA-456' },
      after: { state: 'FAILURE', fingerprint: 'feedback-jenkins-143-failed' },
      metadata: { transitionKind: 'initial_unhealthy', buildNumber: 143 },
    },
    {
      schemaVersion: 1,
      id: 'feedback-sonar-failed',
      at: at(-2_000),
      sessionId,
      type: 'provider.transition',
      source: 'sonar',
      summary: 'JIRA-456 SonarQube quality gate failed for feature/jira-456.',
      subject: { kind: 'quality-gate', id: 'fixture-service:feature/jira-456', ticketKey: 'JIRA-456' },
      after: { state: 'ERROR', fingerprint: 'feedback-sonar-feature-jira-456-error' },
      metadata: { transitionKind: 'sonar_gate_failed', projectKey: 'fixture-service', branch: 'feature/jira-456' },
    },
    {
      schemaVersion: 1,
      id: 'feedback-provider-failure-first',
      at: at(-1_000),
      sessionId,
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'JIRA-456 GitLab provider read failed (request timed out).',
      subject: { kind: 'provider-read', id: 'gitlab', ticketKey: 'JIRA-456' },
      after: { state: 'monitoring/failed', fingerprint: 'feedback-timeout-generation-1' },
      metadata: {
        transitionKind: 'provider_read_failed',
        readState: 'failed',
        readReason: 'timeout',
        readComponents: 'none',
        readGeneration: 1,
      },
    },
    {
      schemaVersion: 1,
      id: 'feedback-provider-failure-repeat',
      at: at(0),
      sessionId,
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'JIRA-456 GitLab provider read failed (request timed out).',
      subject: { kind: 'provider-read', id: 'gitlab', ticketKey: 'JIRA-456' },
      after: { state: 'monitoring/failed', fingerprint: 'feedback-timeout-generation-2' },
      metadata: {
        transitionKind: 'provider_read_failed',
        readState: 'failed',
        readReason: 'timeout',
        readComponents: 'none',
        readGeneration: 2,
      },
    },
  ];
}

const options = parseArgs(process.argv.slice(2));
const targetDir = assertSafeTarget(options.targetDir);
if (fs.existsSync(targetDir)) {
  if (!options.force) { fail(`${targetDir} already exists; pass --force to replace this fixture only`); }
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });
const now = new Date().toISOString();
const state = fixture(now, targetDir);
writePrivate(path.join(targetDir, 'work.json'), `${JSON.stringify(state, null, 2)}\n`);
for (const session of sessionFixtures(now, targetDir)) {
  writePrivate(path.join(targetDir, 'work-sessions', session.id, 'session.json'), `${JSON.stringify(session, null, 2)}\n`);
}
const projectMonitor = projectMonitorFixtures(now, targetDir);
const projectMonitorDirectory = path.join(targetDir, 'work-sessions', projectMonitor.id);
writePrivate(path.join(projectMonitorDirectory, 'project-monitor.json'), `${JSON.stringify(projectMonitor.monitor, null, 2)}\n`);
writePrivate(path.join(projectMonitorDirectory, 'gitlab-merge-request.json'), `${JSON.stringify(projectMonitor.mergeRequest, null, 2)}\n`);
writePrivate(path.join(projectMonitorDirectory, 'gitlab-pipeline.json'), `${JSON.stringify(projectMonitor.pipeline, null, 2)}\n`);
writePrivate(path.join(projectMonitorDirectory, 'ci-monitor.json'), `${JSON.stringify(projectMonitor.ci, null, 2)}\n`);
writePrivate(
  path.join(targetDir, 'monitor-events.jsonl'),
  `${monitorFixtures(now).map(event => JSON.stringify(event)).join('\n')}\n`,
);
writePrivate(path.join(targetDir, 'fixture-repo', 'README.md'), '# Kronos terminal-first feedback fixture\n\nNo provider or project command should run here.\n');
writePrivate(path.join(targetDir, 'fixture-repo', '.git', 'HEAD'), 'ref: refs/heads/feature/kronos-feedback\n');
writePrivate(path.join(targetDir, '.env.example'), [
  '# Copy only to a private test location and provide non-production values.',
  'JIRA_BASE_URL=https://jira.example.invalid',
  'JIRA_EMAIL=',
  'JIRA_API_TOKEN=',
  'JIRA_JQL=project = JIRA ORDER BY updated DESC',
  '',
].join('\n'));

console.log('Kronos terminal-first feedback state created.');
console.log(`KRONOS_DIR=${targetDir}`);
console.log(`Work catalog: ${path.join(targetDir, 'work.json')}`);
console.log('Synthetic detached Sessions and current project-owned Attention snapshots are included; every provider URL uses a reserved .invalid host.');
