const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-provider-readiness-'));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const providerEnv = require('../out/services/providerEnv.js');
const providerReadiness = require('../out/services/providerReadiness.js');
const operationsReadiness = require('../out/services/operationsReadiness.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('provider environment parsing preserves values and rejects malformed keys', () => {
  const parsed = providerEnv.parseProviderDotEnv(`
    # provider credentials
    JIRA_BASE_URL=https://jira.example
    export GITLAB_TOKEN="abc\\n123"
    BAD KEY=value
    JENKINS_USER='operator'
  `);
  assert.equal(parsed.values.JIRA_BASE_URL, 'https://jira.example');
  assert.equal(parsed.values.GITLAB_TOKEN, 'abc\n123');
  assert.equal(parsed.values.JENKINS_USER, 'operator');
  assert.equal(parsed.invalid, 1);

  const env = { JIRA_BASE_URL: 'https://already.example' };
  const result = providerEnv.loadProviderEnv({
    filePath: '/virtual/.env',
    env,
    exists: () => true,
    readFile: () => 'JIRA_BASE_URL=https://new.example\nJIRA_EMAIL=user@example.test\nNODE_OPTIONS=--inspect\n',
  });
  assert.equal(env.JIRA_BASE_URL, 'https://already.example');
  assert.equal(env.JIRA_EMAIL, 'user@example.test');
  assert.equal(result.loaded, 1);
  assert.equal(result.skippedExisting, 1);
  assert.equal(result.invalid, 1);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test('provider readiness is shared, secret-free, and distinguishes missing from invalid configuration', () => {
  const missing = providerReadiness.providerReadiness({});
  assert.equal(missing.jira.state, 'missing');
  assert.equal(missing.gitlab.credentialPresence, 'missing');
  assert.equal(missing.jenkins.state, 'missing');
  assert.equal(missing.sonar.configured, false);

  const secret = 'never-render-this-token';
  const ready = providerReadiness.providerReadiness({
    JIRA_BASE_URL: 'https://jira.example.test',
    JIRA_EMAIL: 'operator@example.test',
    JIRA_API_TOKEN: secret,
    GITLAB_API_BASE_URL: 'https://gitlab.example.test/api/v4',
    GITLAB_TOKEN: secret,
    JENKINS_URL: 'https://jenkins.example.test',
    JENKINS_USER: 'operator',
    JENKINS_API_TOKEN: secret,
    SONAR_HOST_URL: 'https://sonar.example.test',
    SONAR_TOKEN: secret,
  });
  assert.deepEqual(Object.values(ready).map(item => item.state), ['ready', 'ready', 'ready', 'ready']);
  assert.doesNotMatch(JSON.stringify(ready), new RegExp(secret));
  assert.match(ready.jira.detail, /Credential presence: present/);

  const invalid = providerReadiness.providerReadiness({
    JIRA_BASE_URL: 'ftp://jira.invalid',
    JIRA_EMAIL: 'operator@example.test',
    JIRA_API_TOKEN: secret,
    JENKINS_URL: 'https://jenkins.example.test',
    JENKINS_USER: 'operator',
  });
  assert.equal(invalid.jira.state, 'invalid-needs-test');
  assert.equal(invalid.jira.credentialPresence, 'invalid-needs-test');
  assert.equal(invalid.jenkins.state, 'invalid-needs-test');
  assert.doesNotMatch(JSON.stringify(invalid), new RegExp(secret));
});

test('one readiness snapshot feeds Setup and Doctor and gives every non-ready row an action', () => {
  const providers = Object.values(providerReadiness.providerReadiness({}));
  const snapshot = operationsReadiness.buildOperationsReadiness({
    claude: { status: 'pass', detail: 'Claude is ready.' },
    providerEnvironment: { present: false, invalid: 0, configuredProviders: 0, path: '/private/.env' },
    discovery: { roots: 0, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: {
      count: 0,
      unavailable: 0,
      detail: 'No projects.',
      configuredIntegrations: 0,
      gitlabTargets: 0,
      jenkinsTargets: 0,
      sonarTargets: 0,
    },
    workCatalog: { available: true, tickets: 0, issues: 0 },
    jiraVisibility: { hideCompleted: true, additionalCompletedStatuses: 0 },
    providers,
    providerDiagnostics: [{
      provider: 'gitlab',
      status: 'fail',
      detail: 'The latest live read was refused because read permission is unavailable.',
      action: 'openProviderEnvironment',
      actionLabel: 'Repair Private Config',
      problemCount: 1,
      observedAt: '2026-07-14T12:00:00.000Z',
    }],
    polling: { activeTargets: 0, detail: 'No active polling.' },
    sessions: { count: 0, issues: 0 },
  });
  const setupIds = snapshot.filter(item => item.surfaces.includes('setup')).map(item => item.id);
  const doctorIds = snapshot.filter(item => item.surfaces.includes('doctor')).map(item => item.id);
  assert.deepEqual(setupIds, doctorIds.filter(id => id !== 'jira-visibility'));
  assert.ok(snapshot.filter(item => item.status !== 'pass').every(item => item.action && item.actionLabel));
  assert.equal(snapshot.find(item => item.id === 'provider-jira').status, 'warn');
  assert.equal(
    snapshot.find(item => item.id === 'provider-gitlab').status,
    'warn',
    'missing static configuration remains authoritative over a stale live diagnostic',
  );
  assert.equal(snapshot.find(item => item.id === 'automatic-polling').action, 'pollProvidersNow');

  const configuredProviders = Object.values(providerReadiness.providerReadiness({
    JIRA_BASE_URL: 'https://jira.example.test',
    JIRA_EMAIL: 'operator@example.test',
    JIRA_API_TOKEN: 'fixture-token-value',
    GITLAB_URL: 'https://gitlab.example.test',
    GITLAB_TOKEN: 'fixture-token-value',
    JENKINS_URL: 'https://jenkins.example.test',
    SONAR_HOST_URL: 'https://sonar.example.test',
    SONAR_TOKEN: 'fixture-token-value',
  }));
  const liveFailureSnapshot = operationsReadiness.buildOperationsReadiness({
    claude: { status: 'pass', detail: 'Claude is ready.' },
    providerEnvironment: { present: true, invalid: 0, configuredProviders: 4, path: '/private/.env' },
    discovery: { roots: 1, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: {
      count: 1,
      unavailable: 0,
      detail: 'One project.',
      configuredIntegrations: 1,
      gitlabTargets: 1,
      jenkinsTargets: 1,
      sonarTargets: 1,
    },
    workCatalog: { available: true, tickets: 1, issues: 0 },
    jiraVisibility: { hideCompleted: true, additionalCompletedStatuses: 0 },
    providers: configuredProviders,
    providerDiagnostics: [{
      provider: 'gitlab',
      status: 'fail',
      detail: 'The latest live read was refused because read permission is unavailable.',
      action: 'openProviderEnvironment',
      actionLabel: 'Repair Private Config',
      problemCount: 1,
      observedAt: '2026-07-14T12:00:00.000Z',
    }],
    polling: { activeTargets: 3, detail: 'Three active polling targets.' },
    sessions: { count: 1, issues: 0 },
  });
  const gitlab = liveFailureSnapshot.find(item => item.id === 'provider-gitlab');
  assert.equal(gitlab.status, 'fail');
  assert.equal(gitlab.action, 'openProviderEnvironment');
  assert.match(gitlab.detail, /Current live result:.*read permission is unavailable/);
});

test('guided readiness distinguishes first-run, partial, fully ready, and live permission states', () => {
  const firstRun = operationsReadiness.buildOperationsReadiness(operationsInput({
    providers: Object.values(providerReadiness.providerReadiness({})),
  }));
  for (const id of ['provider-environment', 'project-discovery', 'local-projects', 'work-catalog',
    'provider-jira', 'provider-gitlab', 'provider-jenkins', 'provider-sonar', 'project-integrations', 'automatic-polling']) {
    assert.notEqual(firstRun.find(item => item.id === id).status, 'pass', `${id} must explain first-run setup`);
  }
  assert.ok(firstRun.filter(item => item.status !== 'pass').every(item => item.action && item.actionLabel));

  const readyProviders = Object.values(providerReadiness.providerReadiness({
    JIRA_BASE_URL: 'https://jira.example.test',
    JIRA_EMAIL: 'operator@example.test',
    JIRA_API_TOKEN: 'fixture-token-value',
    GITLAB_URL: 'https://gitlab.example.test',
    GITLAB_TOKEN: 'fixture-token-value',
    JENKINS_URL: 'https://jenkins.example.test',
    SONAR_HOST_URL: 'https://sonar.example.test',
    SONAR_TOKEN: 'fixture-token-value',
  }));
  const partial = operationsReadiness.buildOperationsReadiness(operationsInput({
    providerEnvironment: { present: true, invalid: 0, configuredProviders: 1, path: '/private/.env' },
    discovery: { roots: 1, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: {
      count: 1, unavailable: 0, detail: 'One project.', configuredIntegrations: 0,
      gitlabTargets: 0, jenkinsTargets: 0, sonarTargets: 0,
    },
    workCatalog: { available: true, tickets: 1, issues: 0 },
    providers: [readyProviders[0], ...Object.values(providerReadiness.providerReadiness({})).slice(1)],
  }));
  assert.ok(partial.some(item => item.status === 'pass'));
  assert.ok(partial.some(item => item.status !== 'pass'));

  const fullyReady = operationsReadiness.buildOperationsReadiness(operationsInput({
    providerEnvironment: { present: true, invalid: 0, configuredProviders: 4, path: '/private/.env' },
    discovery: { roots: 1, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: {
      count: 1, unavailable: 0, detail: 'One project.', configuredIntegrations: 1,
      gitlabTargets: 1, jenkinsTargets: 1, sonarTargets: 1,
    },
    workCatalog: { available: true, tickets: 1, issues: 0 },
    providers: readyProviders,
    polling: { activeTargets: 3, detail: 'Three active targets.' },
  }));
  assert.ok(fullyReady.every(item => item.status === 'pass'));

  const permissionFailure = operationsReadiness.buildOperationsReadiness(operationsInput({
    providerEnvironment: { present: true, invalid: 0, configuredProviders: 4, path: '/private/.env' },
    providers: readyProviders,
    providerDiagnostics: [{
      provider: 'gitlab',
      status: 'fail',
      detail: 'Permission unavailable for the configured read endpoint.',
      action: 'openProviderEnvironment',
      actionLabel: 'Repair Private Config',
      problemCount: 1,
    }],
  }));
  const gitlab = permissionFailure.find(item => item.id === 'provider-gitlab');
  assert.equal(gitlab.status, 'fail');
  assert.match(gitlab.detail, /Permission unavailable/);
  assert.equal(gitlab.action, 'openProviderEnvironment');
});

test('opening provider configuration creates one private comment-only template without replacing existing content', () => {
  const filePath = path.join(tempRoot, 'provider-env-template', '.env');
  const created = providerEnv.ensureProviderEnvTemplate(filePath);
  assert.deepEqual(created, { path: filePath, created: true });
  const template = fs.readFileSync(filePath, 'utf8');
  assert.match(template, /# JIRA_BASE_URL=/);
  assert.match(template, /# GITLAB_TOKEN=/);
  assert.doesNotMatch(template, /^GITLAB_TOKEN=/m);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  }
  fs.writeFileSync(filePath, 'KEEP_ME=true\n', { mode: 0o600 });
  assert.deepEqual(providerEnv.ensureProviderEnvTemplate(filePath), { path: filePath, created: false });
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'KEEP_ME=true\n');
});

function operationsInput(overrides = {}) {
  return {
    claude: { status: 'pass', detail: 'Claude is ready.' },
    providerEnvironment: { present: false, invalid: 0, configuredProviders: 0, path: '/private/.env' },
    discovery: { roots: 0, depth: 2, limit: 100, hasWorkspaceFolders: false },
    projects: {
      count: 0, unavailable: 0, detail: 'No projects.', configuredIntegrations: 0,
      gitlabTargets: 0, jenkinsTargets: 0, sonarTargets: 0,
    },
    workCatalog: { available: true, tickets: 0, issues: 0 },
    jiraVisibility: { hideCompleted: true, additionalCompletedStatuses: 0 },
    providers: Object.values(providerReadiness.providerReadiness({})),
    polling: { activeTargets: 0, detail: 'No active polling.' },
    sessions: { count: 0, issues: 0 },
    ...overrides,
  };
}

test('provider environment reads are bounded and retain the exact allowlist', () => {
  const fixtureRoot = path.join(tempRoot, 'provider-env-safety');
  const realParent = path.join(fixtureRoot, 'real-parent');
  fs.mkdirSync(realParent, { recursive: true });
  const regularPath = path.join(realParent, '.env');
  fs.writeFileSync(regularPath, 'JIRA_BASE_URL=https://jira.safe.example\nNODE_OPTIONS=--inspect\n');

  const env = {};
  const regular = providerEnv.loadProviderEnv({ filePath: regularPath, env });
  assert.equal(regular.error, undefined);
  assert.equal(regular.loaded, 1);
  assert.equal(regular.invalid, 1);
  assert.equal(env.JIRA_BASE_URL, 'https://jira.safe.example');
  assert.equal(env.NODE_OPTIONS, undefined);

  const missing = providerEnv.loadProviderEnv({ filePath: path.join(fixtureRoot, 'missing.env'), env: {} });
  assert.equal(missing.present, false);
  assert.equal(missing.error, undefined);

  const credential = ['github_pat_', 'providerenvfailurefixture'].join('');
  const failed = providerEnv.loadProviderEnv({
    filePath: path.join(fixtureRoot, 'failure.env'),
    env: {},
    exists: () => true,
    readFile: () => { throw new Error(`Could not read token=${credential}`); },
  });
  assert.equal(failed.error.includes(credential), false);
  assert.match(failed.error, /REDACTED/);
  assert.match(failed.error, /\[unavailable\]/);

  const oversizedPath = path.join(fixtureRoot, 'oversized.env');
  fs.writeFileSync(oversizedPath, '');
  fs.truncateSync(oversizedPath, providerEnv.MAX_PROVIDER_ENV_BYTES + 1);
  const oversized = providerEnv.loadProviderEnv({ filePath: oversizedPath, env: {} });
  assert.match(oversized.error || '', /exceeds the .*byte limit/i);
  assert.equal(oversized.loaded, 0);
});

test('provider environment reads reject target and parent symbolic links', t => {
  const fixtureRoot = path.join(tempRoot, 'provider-env-link-safety');
  const realParent = path.join(fixtureRoot, 'real-parent');
  fs.mkdirSync(realParent, { recursive: true });
  const regularPath = path.join(realParent, '.env');
  fs.writeFileSync(regularPath, 'JIRA_BASE_URL=https://jira.safe.example\n');

  const targetLink = path.join(fixtureRoot, 'linked.env');
  if (!createSymlinkOrSkip(t, regularPath, targetLink)) { return; }
  const targetEnv = {};
  const linkedTarget = providerEnv.loadProviderEnv({ filePath: targetLink, env: targetEnv });
  assert.match(linkedTarget.error || '', /symbolic link/i);
  assert.deepEqual(targetEnv, {});

  const parentLink = path.join(fixtureRoot, 'linked-parent');
  if (!createSymlinkOrSkip(t, realParent, parentLink, process.platform === 'win32' ? 'junction' : 'dir')) { return; }
  const parentEnv = {};
  const linkedParent = providerEnv.loadProviderEnv({ filePath: path.join(parentLink, '.env'), env: parentEnv });
  assert.match(linkedParent.error || '', /symbolic link/i);
  assert.deepEqual(parentEnv, {});
  assert.throws(
    () => providerEnv.ensureProviderEnvTemplate(path.join(parentLink, 'must-not-create.env')),
    /symbolic link/i,
  );
  assert.equal(fs.existsSync(path.join(realParent, 'must-not-create.env')), false);
});

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
