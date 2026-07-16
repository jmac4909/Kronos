const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kronosDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-handoff-profiles-')));
process.env.KRONOS_DIR = kronosDir;

const {
  buildHandoffCandidates,
  writeLocalHandoffBundle,
} = require('../out/services/handoffBundleStore.js');
const projectCatalog = require('../out/services/projectCatalog.js');
const { configuredCiPollingTargets, configuredSonarBranch } = require('../out/services/providerBindingReconciliation.js');
const { normalizeWorkCatalog } = require('../out/services/stateStore.js');

test.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

test('handoff candidates cap context and audit metadata without accepting terminal content', () => {
  const fixture = session({
    artifacts: Array.from({ length: 120 }, (_, index) => artifact(`artifact-${index}`)),
    terminals: [{ name: 'TERMINAL-NAME-MUST-NOT-EXPORT', transcript: 'SECRET-SCROLLBACK' }],
  });
  const events = Array.from({ length: 600 }, (_, index) => event(`event-${index}`));
  const candidates = buildHandoffCandidates(fixture, events);
  assert.equal(candidates.filter(candidate => candidate.selection.kind === 'context').length, 100);
  assert.equal(candidates.filter(candidate => candidate.selection.kind === 'audit').length, 500);
  assert.ok(candidates.filter(candidate => candidate.selection.kind === 'context').every(candidate => candidate.picked));
  assert.doesNotMatch(JSON.stringify(candidates), /TERMINAL-NAME-MUST-NOT-EXPORT|SECRET-SCROLLBACK/);
});

test('local handoff writes a private immutable Markdown and JSON reference pair without copying source payloads', () => {
  const source = sourceArtifact('handoff-source', 'SOURCE-PAYLOAD-MUST-NOT-BE-COPIED');
  const fixture = session({ artifacts: [artifact('context-one', { promptPath: source, contentSha256: undefined })] });
  const candidates = buildHandoffCandidates(fixture, [event('event-one')]);
  const tokenLike = ['glpat-', 'redact-this-fixture-value'].join('');
  const bundle = writeLocalHandoffBundle({
    session: { ...fixture, title: `Handoff ${tokenLike}` },
    selections: candidates.map(candidate => candidate.selection),
    title: `Release handoff ${tokenLike}`,
    note: `Review the provider evidence. token=${tokenLike}`,
  }, { now: new Date('2026-07-15T15:00:00.000Z') });
  const markdown = fs.readFileSync(bundle.markdownPath, 'utf8');
  const json = fs.readFileSync(bundle.jsonPath, 'utf8');
  assert.match(markdown, /HANDOFF-[A-F0-9]{24}/);
  assert.match(markdown, /Context references/);
  assert.match(markdown, /Audit references/);
  assert.match(markdown, /SHA-256/);
  assert.match(markdown, /\[REDACTED/);
  assert.doesNotMatch(`${markdown}\n${json}`, /SOURCE-PAYLOAD-MUST-NOT-BE-COPIED|redact-this-fixture-value/);
  assert.equal(JSON.parse(json).selections.length, 2);
  assert.equal(fs.statSync(bundle.markdownPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(bundle.jsonPath).mode & 0o777, 0o600);
});

test('local handoff has no provider, Git, or terminal side effects', t => {
  const projectRoot = path.join(kronosDir, 'side-effect-project');
  const gitDirectory = path.join(projectRoot, '.git');
  fs.mkdirSync(gitDirectory, { recursive: true, mode: 0o700 });
  const headPath = path.join(gitDirectory, 'HEAD');
  fs.writeFileSync(headPath, 'ref: refs/heads/feature/handoff-safety\n', { mode: 0o600 });
  const terminal = {
    show() { throw new Error('Local handoff attempted to focus a terminal.'); },
    sendText() { throw new Error('Local handoff attempted to write to a terminal.'); },
    dispose() { throw new Error('Local handoff attempted to close a terminal.'); },
  };
  const source = sourceArtifact('side-effect-source', 'reference-only source');
  const fixture = session({
    projectPath: projectRoot,
    terminals: [terminal],
    artifacts: [artifact('side-effect-context', { promptPath: source })],
  });
  const selections = buildHandoffCandidates(fixture, [event('side-effect-event')])
    .map(candidate => candidate.selection);

  forbidCall(t, globalThis, 'fetch', 'network fetch');
  for (const [owner, methods] of [
    [http, ['get', 'request']],
    [https, ['get', 'request']],
    [childProcess, ['exec', 'execFile', 'execFileSync', 'spawn', 'spawnSync']],
  ]) {
    for (const method of methods) { forbidCall(t, owner, method, method); }
  }

  const bundle = writeLocalHandoffBundle({
    session: fixture,
    selections,
    title: 'Side-effect-free handoff',
  }, { now: new Date('2026-07-15T15:30:00.000Z') });
  const handoffRoot = `${path.join(kronosDir, 'handoffs')}${path.sep}`;
  assert.equal(bundle.markdownPath.startsWith(handoffRoot), true);
  assert.equal(bundle.jsonPath.startsWith(handoffRoot), true);
  assert.equal(fs.readFileSync(headPath, 'utf8'), 'ref: refs/heads/feature/handoff-safety\n');
  assert.deepEqual(fs.readdirSync(projectRoot).sort(), ['.git']);
});

test('local handoff refuses external artifact paths and oversized selections', () => {
  const fixture = session();
  const external = artifact('outside', { promptPath: path.join(os.tmpdir(), 'outside', 'prompt.md') });
  assert.throws(() => writeLocalHandoffBundle({
    session: fixture,
    selections: buildHandoffCandidates({ ...fixture, artifacts: [external] }, []).map(candidate => candidate.selection),
    title: 'Unsafe handoff',
  }), /inside the Kronos data directory/);
  const selection = buildHandoffCandidates(fixture, [event('bounded-event')])[0].selection;
  assert.throws(() => writeLocalHandoffBundle({
    session: fixture,
    selections: Array.from({ length: 101 }, () => selection),
    title: 'Oversized handoff',
  }), /at most 100/);
});

test('project integration parses, formats, and stores explicit Jenkins and SonarQube branch profiles', () => {
  const projectPath = path.join(kronosDir, 'project');
  fs.mkdirSync(projectPath, { mode: 0o700 });
  const text = [
    'main | https://jenkins.example/job/app/main | app:key | main',
    'release/2026.07 | https://jenkins.example/job/app/release | app:release | release-2026.07',
  ].join('\n');
  const parsed = projectCatalog.parseProjectBranchProfiles(text);
  assert.equal(parsed.length, 2);
  assert.equal(projectCatalog.formatProjectBranchProfiles(parsed), text);
  const configured = projectCatalog.setLocalProjectIntegrations({
    schemaVersion: 2,
    refreshedAt: null,
    projects: { Application: { path: projectPath, config: {} } },
    tickets: {},
  }, [{
    name: 'Application',
    branchProfiles: text,
    activeBranchProfile: 'main',
  }]);
  assert.deepEqual(configured.projects.Application.config.branch_profiles, parsed);
  assert.equal(configured.projects.Application.config.active_branch_profile, 'main');
  const reloaded = normalizeWorkCatalog(configured).state;
  assert.deepEqual(reloaded.projects.Application.config.branch_profiles, parsed);
  assert.equal(reloaded.projects.Application.config.active_branch_profile, 'main');

  const corrupted = structuredClone(configured);
  corrupted.projects.Application.config.branch_profiles.push({
    branch: 'bad..branch',
    jenkins_url: 'https://jenkins.example/job/unsafe',
  });
  corrupted.projects.Application.config.active_branch_profile = 'bad..branch';
  const sanitized = normalizeWorkCatalog(corrupted).state.projects.Application.config;
  assert.deepEqual(sanitized.branch_profiles, parsed);
  assert.equal(sanitized.active_branch_profile, undefined);
});

test('branch profile validation refuses duplicates, unsafe branches, credentials, and unknown active profiles', () => {
  assert.throws(() => projectCatalog.parseProjectBranchProfiles([
    'main | https://jenkins.example/job/app/main | |',
    'main | https://jenkins.example/job/app/other | |',
  ].join('\n')), /duplicated/);
  assert.throws(() => projectCatalog.parseProjectBranchProfiles('bad..branch | https://jenkins.example/job/app | |'), /unsupported Git branch/);
  assert.throws(() => projectCatalog.parseProjectBranchProfiles('main | https://user:pass@jenkins.example/job/app | |'), /without embedded credentials/);
  const projectPath = path.join(kronosDir, 'invalid-active-project');
  fs.mkdirSync(projectPath, { mode: 0o700 });
  assert.throws(() => projectCatalog.setLocalProjectIntegrations({
    schemaVersion: 2,
    refreshedAt: null,
    projects: { Application: { path: projectPath, config: {} } },
    tickets: {},
  }, [{
    name: 'Application',
    branchProfiles: 'main | https://jenkins.example/job/app | |',
    activeBranchProfile: 'release',
  }]), /must match one configured branch profile/);
});

test('CI target selection uses an exact MR profile then explicit fallback without creating a ticket project link', () => {
  const profiles = projectCatalog.parseProjectBranchProfiles([
    'main | https://jenkins.example/job/app/main | app:key | main',
    'release/2026.07 | https://jenkins.example/job/app/release | app:release | release-2026.07',
  ].join('\n'));
  const state = {
    schemaVersion: 2,
    refreshedAt: null,
    projects: { Application: { config: { branch_profiles: profiles, active_branch_profile: 'main' } } },
    tickets: {
      'PROFILE-1': {
        summary: 'Profile routing', type: 'Story', priority: 'High', jira_status: 'Open', source: 'jira',
        linked_local_project: 'Application',
        mr: { iid: 7, state: 'opened', review_status: 'pending_review', url: 'https://gitlab.example/mr/7', source_branch: 'release/2026.07' },
        build: null,
      },
    },
  };
  const monitored = session({ ticketKey: 'PROFILE-1', ticketKeys: ['PROFILE-1'], projectName: undefined, projectPath: undefined });
  assert.deepEqual(configuredCiPollingTargets(state, monitored), {
    jenkinsUrl: 'https://jenkins.example/job/app/release',
    jenkinsBranch: 'release/2026.07',
    sonar: {
      projectKey: 'app:release',
      branch: 'release-2026.07',
    },
  });
  assert.deepEqual(configuredSonarBranch(state, 'PROFILE-1'), {
    projectKey: 'app:release',
    branch: 'release-2026.07',
  });
  const unlinked = structuredClone(state);
  delete unlinked.tickets['PROFILE-1'].linked_local_project;
  assert.deepEqual(projectCatalog.projectConfigurationForTicket(unlinked, unlinked.tickets['PROFILE-1']), {});
  assert.deepEqual(configuredCiPollingTargets(unlinked, monitored), {});
  assert.equal(unlinked.tickets['PROFILE-1'].linked_local_project, undefined);
});

function sourceArtifact(stem, content) {
  const directory = path.join(kronosDir, 'contexts', stem);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const promptPath = path.join(directory, 'prompt.md');
  fs.writeFileSync(promptPath, content, { mode: 0o600 });
  return promptPath;
}

function artifact(id, overrides = {}) {
  const promptPath = overrides.promptPath || sourceArtifact(id, `artifact ${id}`);
  const contentSha256 = overrides.contentSha256 === undefined
    ? undefined
    : overrides.contentSha256;
  const value = {
    id,
    kind: 'jira-ticket',
    label: `[HANDOFF-1] ${id}`,
    promptPath,
    fetchedAt: '2026-07-15T12:00:00.000Z',
    recordedAt: '2026-07-15T12:00:00.000Z',
    complete: true,
    warnings: [],
  };
  if (contentSha256) { value.contentSha256 = contentSha256; }
  return { ...value, ...overrides };
}

function event(id) {
  return {
    schemaVersion: 1,
    id,
    at: '2026-07-15T12:05:00.000Z',
    sessionId: 'session-handoff',
    type: 'provider.transition',
    source: 'gitlab',
    summary: `Merge request transition ${id}`,
    subject: { kind: 'merge-request', id: '77', project: 'Application', ticketKey: 'HANDOFF-1' },
  };
}

function session(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'session-handoff',
    kind: 'ticket',
    ticketKey: 'HANDOFF-1',
    ticketKeys: ['HANDOFF-1'],
    title: 'Handoff session',
    status: 'active',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
    projectName: 'Application',
    projectPath: path.join(kronosDir, 'project'),
    ...overrides,
  };
}

function forbidCall(t, owner, key, label) {
  if (!owner || typeof owner[key] !== 'function') { return; }
  const original = owner[key];
  owner[key] = () => { throw new Error(`Local handoff attempted ${label}.`); };
  t.after(() => { owner[key] = original; });
}
