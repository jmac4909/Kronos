const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-persistence-recovery-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const managedMonitorLease = require('../out/services/managedMonitorLease.js');
const privateFiles = require('../out/services/privateFilePrimitives.js');
const stateStore = require('../out/services/stateStore.js');
const workSessions = require('../out/services/workSessionStore.js');
const projectMonitoringStore = require('../out/services/projectMonitoringStore.js');
const gitLabMonitorStore = require('../out/services/gitlabMergeRequestMonitorStore.js');
const gitLabRestModule = require('../out/services/gitlabRestClient.js');
const ciMonitorStore = require('../out/services/ciMonitorStore.js');
const ciTransitions = require('../out/services/ciTransitions.js');
const { buildWorkSessionAuditMarkdown } = require('../out/services/workSessionAuditView.js');
const { ManagedProviderMonitor } = require('../out/services/managedProviderMonitor.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('one private open-flag layer omits unsupported Windows flags and fails closed on POSIX', () => {
  const windows = privateFiles.privateFileOpenFlags('exclusive-write', 'win32', {
    noFollow: undefined,
    nonBlocking: undefined,
    directory: undefined,
  });
  assert.equal(windows & fs.constants.O_WRONLY, fs.constants.O_WRONLY);
  assert.equal(windows & fs.constants.O_CREAT, fs.constants.O_CREAT);
  assert.equal(windows & fs.constants.O_EXCL, fs.constants.O_EXCL);
  assert.throws(
    () => privateFiles.privateFileOpenFlags('read', 'linux', { noFollow: undefined }),
    /require O_NOFOLLOW support/,
  );

  const leaseSource = fs.readFileSync(path.join(root, 'src/services/managedMonitorLease.ts'), 'utf8');
  assert.match(leaseSource, /privateFileOpenFlags\('exclusive-write'\)/);
  assert.match(leaseSource, /privateFileOpenFlags\('read-nonblocking'\)/);
  assert.doesNotMatch(leaseSource, /fs\.constants\.O_(?:RDONLY|WRONLY|CREAT|EXCL|NONBLOCK|NOFOLLOW)/);
});

test('expired monitor lease is reclaimed while a current owner remains exclusive', () => {
  const kronosDir = path.join(tempRoot, 'expired-lease');
  const first = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.equal(first.acquired, true);
  const active = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:00.500Z'),
  });
  assert.equal(active.acquired, false);
  assert.equal(active.reason, 'active');

  const recovered = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 1_000,
    now: new Date('2026-07-15T12:00:02.000Z'),
  });
  assert.equal(recovered.acquired, true);
  assert.notEqual(recovered.lease.ownerId, first.lease.ownerId);
  assert.equal(first.renew({ now: new Date('2026-07-15T12:00:02.100Z') }), false);
  assert.equal(first.release(), false);
  assert.equal(recovered.release(), true);
});

test('distinct processes sharing one Kronos directory enforce one polling owner and clean handoff', async () => {
  const kronosDir = path.join(tempRoot, 'cross-process-lease');
  const owner = startLeaseWorker();
  const contender = startLeaseWorker();
  try {
    const first = await leaseWorkerRequest(owner, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(first.acquired, true);
    assert.equal(first.pid, owner.pid);
    assert.match(first.ownerId, /^[a-f0-9]{48}$/);

    const blocked = await leaseWorkerRequest(contender, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(blocked.acquired, false);
    assert.equal(blocked.reason, 'active');
    assert.equal(blocked.pid, contender.pid);

    const ownerRelease = await leaseWorkerRequest(owner, { command: 'release' });
    assert.equal(ownerRelease.released, true);
    assert.equal(ownerRelease.pid, owner.pid);
    const handedOff = await leaseWorkerRequest(contender, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(handedOff.acquired, true);
    assert.notEqual(handedOff.ownerId, first.ownerId);

    const reverseBlocked = await leaseWorkerRequest(owner, { command: 'acquire', kronosDir, ttlMs: 30_000 });
    assert.equal(reverseBlocked.acquired, false);
    assert.equal(reverseBlocked.reason, 'active');
    const contenderRelease = await leaseWorkerRequest(contender, { command: 'release' });
    assert.equal(contenderRelease.released, true);
    assert.equal(contenderRelease.pid, contender.pid);
  } finally {
    await Promise.all([stopLeaseWorker(owner), stopLeaseWorker(contender)]);
  }
});

test('lease renewal and release refuse an identity replacement without deleting its owner', () => {
  const kronosDir = path.join(tempRoot, 'lease-identity-replacement');
  const first = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    ttlMs: 5_000,
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  assert.equal(first.acquired, true);
  const replacement = {
    ...first.lease,
    ownerId: 'b'.repeat(48),
    acquiredAt: '2026-07-15T12:00:01.000Z',
    expiresAt: '2026-07-15T12:00:06.000Z',
  };
  const replacementPath = `${first.leasePath}.replacement`;
  fs.writeFileSync(replacementPath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });
  fs.rmSync(first.leasePath);
  fs.renameSync(replacementPath, first.leasePath);

  assert.equal(first.renew({ now: new Date('2026-07-15T12:00:02.000Z') }), false);
  assert.equal(first.release(), false);
  assert.equal(JSON.parse(fs.readFileSync(first.leasePath, 'utf8')).ownerId, replacement.ownerId);
  const competing = managedMonitorLease.tryAcquireManagedMonitorLease({
    kronosDir,
    now: new Date('2026-07-15T12:00:02.000Z'),
  });
  assert.equal(competing.acquired, false);
  assert.equal(competing.reason, 'active');
});

test('malformed, partial, oversized, future, and symbolic lease state fails closed', t => {
  const cases = [
    ['partial', '{"schema":'],
    ['malformed', 'not-json\n'],
    ['future', `${JSON.stringify({
      schema: 'kronos.managed-monitor-lease',
      schemaVersion: 99,
      ownerId: 'a'.repeat(48),
      pid: 1,
      acquiredAt: '2026-07-15T12:00:00.000Z',
      expiresAt: '2026-07-15T12:00:05.000Z',
    })}\n`],
    ['oversized', 'x'.repeat(4_097)],
  ];
  for (const [name, content] of cases) {
    const kronosDir = path.join(tempRoot, `unsafe-lease-${name}`);
    const leasePath = writeLeaseFixture(kronosDir, content);
    const before = fs.readFileSync(leasePath);
    const result = managedMonitorLease.tryAcquireManagedMonitorLease({ kronosDir });
    assert.equal(result.acquired, false, name);
    assert.equal(result.reason, 'unsafe', name);
    assert.deepEqual(fs.readFileSync(leasePath), before, `${name} state must not be replaced`);
  }

  const outside = path.join(tempRoot, 'unsafe-lease-outside');
  fs.writeFileSync(outside, 'outside\n', { mode: 0o600 });
  const linkedRoot = path.join(tempRoot, 'unsafe-lease-symbolic');
  const linkedPath = managedMonitorLease.managedMonitorLeasePath({ kronosDir: linkedRoot });
  fs.mkdirSync(path.dirname(linkedPath), { recursive: true, mode: 0o700 });
  try {
    fs.symlinkSync(outside, linkedPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`Symbolic links are unavailable on this host: ${error.code}`);
      return;
    }
    throw error;
  }
  const symbolic = managedMonitorLease.tryAcquireManagedMonitorLease({ kronosDir: linkedRoot });
  assert.equal(symbolic.acquired, false);
  assert.equal(symbolic.reason, 'unsafe');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'outside\n');
});

test('catalog, session, and monitor readers reject incomplete or unsupported private JSON', () => {
  fs.mkdirSync(stateStore.KRONOS_DIR, { recursive: true, mode: 0o700 });
  for (const content of [
    '{"schemaVersion":2,',
    '[]\n',
    '{"schemaVersion":99,"projects":{},"tickets":{}}\n',
  ]) {
    fs.writeFileSync(stateStore.STATE_FILE, content, { mode: 0o600 });
    const result = stateStore.readStateFileWithIssues();
    assert.deepEqual(result.state, stateStore.emptyWorkCatalog());
    assert.ok(result.issues.length > 0);
  }
  fs.writeFileSync(stateStore.STATE_FILE, '', { mode: 0o600 });
  fs.truncateSync(stateStore.STATE_FILE, stateStore.MAX_WORK_CATALOG_BYTES + 1);
  const oversizedCatalog = stateStore.readStateFileWithIssues();
  assert.deepEqual(oversizedCatalog.state, stateStore.emptyWorkCatalog());
  assert.ok(oversizedCatalog.issues.length > 0);

  const sessionOptions = { kronosDir: path.join(tempRoot, 'invalid-session-state') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Invalid state fixture' }, sessionOptions);
  const sessionPath = path.join(workSessions.workSessionDirectory(session.id, sessionOptions), 'session.json');
  for (const content of ['{"schemaVersion":1,', '{"schemaVersion":99}\n']) {
    fs.writeFileSync(sessionPath, content, { mode: 0o600 });
    assert.deepEqual(workSessions.listWorkSessions(sessionOptions), []);
    assert.equal(workSessions.listWorkSessionStoreIssues(sessionOptions).length, 1);
  }
  fs.writeFileSync(sessionPath, '', { mode: 0o600 });
  fs.truncateSync(sessionPath, workSessions.MAX_WORK_SESSION_RECORD_BYTES + 1);
  assert.deepEqual(workSessions.listWorkSessions(sessionOptions), []);
  assert.equal(workSessions.listWorkSessionStoreIssues(sessionOptions).length, 1);

  const snapshotOptions = { kronosDir: path.join(tempRoot, 'invalid-monitor-state') };
  const monitorSession = workSessions.createStandaloneWorkSession({ title: 'Monitor state fixture' }, snapshotOptions);
  const snapshotPath = gitLabMonitorStore.gitLabMergeRequestMonitorSnapshotPath(monitorSession.id, snapshotOptions);
  fs.writeFileSync(snapshotPath, '{"iid":', { mode: 0o600 });
  assert.throws(
    () => gitLabMonitorStore.readGitLabMergeRequestMonitorSnapshot(monitorSession.id, snapshotOptions),
    SyntaxError,
  );
  const readStatusPath = gitLabMonitorStore.gitLabMergeRequestReadStatusPath(monitorSession.id, snapshotOptions);
  fs.writeFileSync(readStatusPath, '{"schemaVersion":99}\n', { mode: 0o600 });
  assert.equal(gitLabMonitorStore.readGitLabMergeRequestReadStatus(monitorSession.id, snapshotOptions), null);
});

test('CI monitor snapshots round-trip one normalized provider state and fail closed on unsafe storage', t => {
  const options = { kronosDir: path.join(tempRoot, 'ci-monitor-snapshots') };
  const missingSessionId = 'missing-ci-session';
  assert.equal(ciMonitorStore.readCiMonitorSnapshot(missingSessionId, options), null);
  assert.throws(
    () => ciMonitorStore.writeCiMonitorSnapshot(missingSessionId, {}, options),
    /snapshot is invalid/i,
  );

  const session = workSessions.createStandaloneWorkSession({ title: 'CI monitor fixture' }, options);
  const digest = ciTransitions.buildCiMonitorDigest({
    jenkins: {
      provider: 'jenkins',
      jobOrBuildUrl: 'https://jenkins.example/job/application/',
      build: {
        number: 42,
        status: 'SUCCESS',
        building: false,
        url: 'https://jenkins.example/job/application/42/',
      },
      tests: { complete: true, failCount: 0 },
      stages: [{ name: 'verify', status: 'SUCCESS' }],
      completeness: { testReport: 'complete', stages: 'complete' },
    },
  });
  assert.ok(digest);
  assert.throws(
    () => ciMonitorStore.writeCiMonitorSnapshot(missingSessionId, digest, options),
    /work session directory does not exist/i,
  );
  assert.equal(ciMonitorStore.readCiMonitorSnapshot(session.id, options), null);
  const snapshotPath = ciMonitorStore.writeCiMonitorSnapshot(session.id, digest, options);
  assert.equal(snapshotPath, ciMonitorStore.ciMonitorSnapshotPath(session.id, options));
  assert.deepEqual(ciMonitorStore.readCiMonitorSnapshot(session.id, options), digest);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(snapshotPath).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(snapshotPath)).mode & 0o777, 0o700);
    fs.chmodSync(path.dirname(snapshotPath), 0o755);
    assert.throws(
      () => ciMonitorStore.readCiMonitorSnapshot(session.id, options),
      /directory does not have private permissions/i,
    );
    ciMonitorStore.writeCiMonitorSnapshot(session.id, digest, options);
    assert.equal(fs.statSync(path.dirname(snapshotPath)).mode & 0o777, 0o700);
  }

  assert.throws(
    () => ciMonitorStore.writeCiMonitorSnapshot(session.id, { ...digest, jenkins: { provider: 'jenkins' } }, options),
    /snapshot is invalid/i,
  );
  assert.deepEqual(
    ciMonitorStore.readCiMonitorSnapshot(session.id, options),
    digest,
    'a rejected digest must not replace the last known-good monitor state',
  );
  for (const invalidId of ['', 'unsafe/session', `x${'y'.repeat(180)}`]) {
    assert.throws(() => ciMonitorStore.ciMonitorSnapshotPath(invalidId, options), /session id is missing or invalid/i);
  }

  fs.writeFileSync(snapshotPath, '{"schemaVersion":', { mode: 0o600 });
  assert.throws(
    () => ciMonitorStore.readCiMonitorSnapshot(session.id, options),
    /contains invalid JSON/i,
  );
  fs.writeFileSync(snapshotPath, '{"schemaVersion":99}\n', { mode: 0o600 });
  assert.throws(
    () => ciMonitorStore.readCiMonitorSnapshot(session.id, options),
    /invalid or unsupported structure/i,
  );

  const outside = path.join(tempRoot, 'ci-monitor-outside');
  const linkedOptions = { kronosDir: path.join(tempRoot, 'ci-monitor-linked') };
  const linkedDirectory = path.dirname(ciMonitorStore.ciMonitorSnapshotPath('linked-session', linkedOptions));
  fs.mkdirSync(path.dirname(linkedDirectory), { recursive: true, mode: 0o700 });
  fs.mkdirSync(outside, { mode: 0o700 });
  try {
    fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`Symbolic links are unavailable on this host: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(
    () => ciMonitorStore.readCiMonitorSnapshot('linked-session', linkedOptions),
    /not a safe directory|contains a symbolic link/i,
  );
  assert.throws(
    () => ciMonitorStore.writeCiMonitorSnapshot('linked-session', digest, linkedOptions),
    /not a safe directory|contains a symbolic link/i,
  );
  assert.equal(fs.existsSync(path.join(outside, 'ci-monitor.json')), false);
});

test('work-session mutations preserve one identity across replacement, close, and reopen decisions', () => {
  const root = path.join(tempRoot, 'work-session-mutations');
  const at = value => ({ kronosDir: root, now: new Date(value) });
  let ticket = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'FLOW-1',
    title: 'Original title',
    projectName: 'Application',
    projectPath: tempRoot,
    monitoringEnabled: false,
  }, at('2026-07-15T10:00:00.000Z'));
  const duplicate = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'flow-1',
    title: 'A duplicate create must not replace persisted state',
  }, at('2026-07-15T10:01:00.000Z'));
  assert.equal(duplicate.id, ticket.id);
  assert.equal(duplicate.title, 'Original title');
  assert.equal(duplicate.createdAt, '2026-07-15T10:00:00.000Z');

  ticket = workSessions.attachWorkSessionTerminal(ticket.id, {
    name: 'Original terminal',
    cwd: tempRoot,
    processId: 4100,
    shell: 'bash',
  }, at('2026-07-15T10:02:00.000Z'));
  const bindingId = ticket.terminals[0].id;
  assert.match(bindingId, /^terminal-/);
  assert.deepEqual({
    cwd: ticket.terminals[0].cwd,
    processId: ticket.terminals[0].processId,
    shell: ticket.terminals[0].shell,
  }, { cwd: tempRoot, processId: 4100, shell: 'bash' });

  ticket = workSessions.attachWorkSessionTerminal(ticket.id, {
    bindingId,
    name: 'Replacement terminal metadata',
  }, at('2026-07-15T10:03:00.000Z'));
  assert.equal(ticket.terminals.length, 1);
  assert.equal(ticket.terminals[0].name, 'Replacement terminal metadata');
  assert.equal(ticket.terminals[0].cwd, undefined);
  assert.equal(ticket.terminals[0].processId, undefined);
  assert.equal(ticket.terminals[0].shell, undefined);

  ticket = workSessions.setWorkSessionProject(ticket.id, {}, at('2026-07-15T10:04:00.000Z'));
  assert.equal(ticket.projectName, undefined);
  assert.equal(ticket.projectPath, undefined);
  ticket = workSessions.setWorkSessionMonitoring(
    ticket.id,
    true,
    '2026-07-15T10:04:30.000Z',
    at('2026-07-15T10:05:00.000Z'),
  );
  assert.equal(ticket.monitoring.enabled, true);
  assert.equal(ticket.monitoring.lastPolledAt, '2026-07-15T10:04:30.000Z');

  ticket = workSessions.closeWorkSession(ticket.id, at('2026-07-15T10:06:00.000Z'));
  assert.equal(ticket.closedAt, '2026-07-15T10:06:00.000Z');
  assert.equal(ticket.terminals[0].status, 'detached');
  assert.equal(ticket.terminals[0].detachReason, 'Work session management stopped; terminal remains operator-owned.');
  const closedAgain = workSessions.closeWorkSession(ticket.id, at('2026-07-15T10:07:00.000Z'));
  assert.equal(closedAgain.closedAt, ticket.closedAt, 'closing an already-closed session must retain its original close time');
  assert.throws(
    () => workSessions.addWorkSessionProviderBinding(ticket.id, {
      provider: 'gitlab', resource: 'merge-request', subjectId: '1',
    }, at('2026-07-15T10:08:00.000Z')),
    /is closed/i,
  );

  ticket = workSessions.reopenWorkSession(ticket.id, at('2026-07-15T10:09:00.000Z'));
  assert.equal(ticket.status, 'active');
  assert.equal(ticket.closedAt, undefined);
  assert.equal(ticket.monitoring.enabled, true, 'ticket sessions resume monitoring when management resumes');
  assert.equal(
    workSessions.reopenWorkSession(ticket.id, at('2026-07-15T10:10:00.000Z')).status,
    'active',
  );

  let standalone = workSessions.createStandaloneWorkSession({
    title: 'Project console without Jira',
    projectName: 'Application',
    projectPath: tempRoot,
  }, at('2026-07-15T10:11:00.000Z'));
  standalone = workSessions.closeWorkSession(standalone.id, at('2026-07-15T10:12:00.000Z'));
  standalone = workSessions.reopenWorkSession(standalone.id, at('2026-07-15T10:13:00.000Z'));
  assert.equal(standalone.monitoring.enabled, false, 'ticket-free terminals do not become legacy polling owners');
});

test('Session display names are presentation-only and reset without identity drift', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'work-session-display-name'),
    now: new Date('2026-07-15T10:20:00.000Z'),
  };
  const original = workSessions.createStandaloneWorkSession({
    title: 'Generated project terminal',
    projectName: 'Application',
    projectPath: tempRoot,
  }, options);
  const renamed = workSessions.setWorkSessionDisplayName(
    original.id,
    '  Release readiness  ',
    { ...options, now: new Date('2026-07-15T10:21:00.000Z') },
  );
  assert.equal(renamed.displayName, 'Release readiness');
  assert.equal(workSessions.workSessionDisplayName(renamed), 'Release readiness');
  assert.deepEqual({
    id: renamed.id,
    title: renamed.title,
    projectName: renamed.projectName,
    projectPath: renamed.projectPath,
    ticketKeys: renamed.ticketKeys,
    terminals: renamed.terminals,
    providerBindings: renamed.providerBindings,
  }, {
    id: original.id,
    title: original.title,
    projectName: original.projectName,
    projectPath: original.projectPath,
    ticketKeys: original.ticketKeys,
    terminals: original.terminals,
    providerBindings: original.providerBindings,
  });
  const reset = workSessions.setWorkSessionDisplayName(
    original.id,
    '',
    { ...options, now: new Date('2026-07-15T10:22:00.000Z') },
  );
  assert.equal(reset.displayName, undefined);
  assert.equal(workSessions.workSessionDisplayName(reset), original.title);
  assert.throws(
    () => workSessions.setWorkSessionDisplayName(original.id, 'x'.repeat(301), options),
    /300 characters or fewer/,
  );
});

test('ticket-session context limits retain the primary identity and newest explicit Jira work', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'work-session-ticket-context-limit'),
    now: new Date('2026-07-15T10:30:00.000Z'),
  };
  let ticket = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'PRIMARY-1',
    title: 'Long-lived ticket Session',
  }, options);
  for (let index = 1; index <= 100; index += 1) {
    ticket = workSessions.addWorkSessionTicketContext(ticket.id, `RELATED-${index}`, options);
  }
  assert.equal(ticket.ticketKeys.length, 100);
  assert.equal(ticket.ticketKeys[0], 'PRIMARY-1', 'the initiating ticket remains the canonical first context');
  assert.equal(ticket.ticketKeys.includes('RELATED-1'), false, 'the oldest secondary context is evicted at the bound');
  assert.equal(ticket.ticketKeys.includes('RELATED-100'), true, 'the newest explicit context is retained');
  assert.equal(workSessions.getWorkSessionForTicketContext('PRIMARY-1', options).id, ticket.id);
  assert.equal(workSessions.getWorkSessionForTicketContext('RELATED-100', options).id, ticket.id);
  assert.deepEqual(workSessions.workSessionTicketMetadata(ticket), { ticketKey: 'PRIMARY-1' });
  assert.match(workSessions.workSessionEventContext(ticket).label, /^PRIMARY-1:/);

  let standalone = workSessions.createStandaloneWorkSession({
    title: 'Project Session with explicit Jira context',
    projectName: 'Application',
    projectPath: tempRoot,
  }, options);
  standalone = workSessions.addWorkSessionTicketContext(standalone.id, 'RELATED-200', options);
  assert.equal(standalone.monitoring.enabled, true, 'an explicit Jira context makes a project Session eligible for legacy fallback monitoring');
  assert.equal(workSessions.getWorkSessionForTicketContext('RELATED-200', options).id, standalone.id);
  assert.deepEqual(workSessions.workSessionTicketMetadata(standalone), {});
  assert.match(workSessions.workSessionEventContext(standalone).label, /^Application:/);

  ticket = workSessions.closeWorkSession(ticket.id, options);
  assert.deepEqual(workSessions.listWorkSessions({ ...options, kind: 'ticket' }).map(session => session.id), [ticket.id]);
  assert.deepEqual(workSessions.listWorkSessions({ ...options, status: 'closed' }).map(session => session.id), [ticket.id]);
  assert.deepEqual(
    workSessions.listWorkSessions({ ...options, monitoringEnabled: true }).map(session => session.id),
    [standalone.id],
  );
  assert.equal(workSessions.listWorkSessions({ ...options, limit: 1 }).length, 1);
});

test('work-session storage rejects mismatched identities and unsafe removal entries', () => {
  const options = { kronosDir: path.join(tempRoot, 'work-session-identity') };
  const ticket = workSessions.createOrGetWorkSessionByTicket({ ticketKey: 'SAFE-2', title: 'Identity fixture' }, options);
  const recordPath = workSessions.workSessionRecordPath(ticket.id, options);
  const raw = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  raw.kind = 'standalone';
  delete raw.ticketKey;
  raw.ticketKeys = [];
  fs.writeFileSync(recordPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => workSessions.getWorkSessionByTicket('SAFE-2', options),
    /is not linked to SAFE-2/i,
  );

  raw.id = 'session-different-owner';
  fs.writeFileSync(recordPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => workSessions.readWorkSession(ticket.id, options),
    /record id does not match/i,
  );

  const root = workSessions.workSessionsDirectory(options);
  fs.writeFileSync(path.join(root, 'not-a-session-directory'), 'unsafe entry\n', { mode: 0o600 });
  const issues = workSessions.listWorkSessionStoreIssues(options);
  assert.ok(issues.some(issue => /unsafe or invalid work session directory entry/i.test(issue.detail)));
  assert.ok(issues.some(issue => /record id does not match/i.test(issue.detail)));

  const removable = workSessions.createStandaloneWorkSession({ title: 'Unsafe removal fixture' }, options);
  const removableDirectory = workSessions.workSessionDirectory(removable.id, options);
  const nested = path.join(removableDirectory, 'unexpected-directory');
  fs.mkdirSync(nested);
  assert.throws(
    () => workSessions.removeWorkSession(removable.id, options),
    /refused an unsafe directory entry/i,
  );
  assert.equal(fs.existsSync(removableDirectory), true, 'failed removal must retain the complete session directory');
  fs.rmdirSync(nested);
  assert.equal(workSessions.removeWorkSession(removable.id, options).id, removable.id);
  assert.throws(() => workSessions.removeWorkSession(removable.id, options), /not found/i);
});

test('work-session provider, artifact, and monitoring projections cover every operator-visible state', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'work-session-projections'),
    now: new Date('2026-07-15T11:00:00.000Z'),
  };
  let session = workSessions.createStandaloneWorkSession({ title: 'Projection fixture' }, options);
  const initial = workSessions.nextWorkSessionProviderBindings([], {
    id: 'gitlab-mr-7',
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '7',
    projectId: 'team/application',
    url: 'https://gitlab.example/team/application/-/merge_requests/7',
  }, '2026-07-15T10:55:00.000Z');
  const withBuild = workSessions.nextWorkSessionProviderBindings(initial, {
    provider: 'jenkins',
    resource: 'build',
    subjectId: '41',
    url: 'https://jenkins.example/job/application/41/',
  }, '2026-07-15T10:56:00.000Z');
  const replaced = workSessions.nextWorkSessionProviderBindings(withBuild, {
    id: 'gitlab-mr-7-current',
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '7',
    projectId: 'team/application',
  }, '2026-07-15T10:57:00.000Z');
  assert.deepEqual(replaced.map(binding => binding.provider), ['jenkins', 'gitlab']);
  assert.equal(
    workSessions.newestWorkSessionProviderBinding(replaced, binding => binding.provider === 'gitlab').id,
    'gitlab-mr-7-current',
  );
  assert.equal(workSessions.newestWorkSessionProviderBinding(replaced, binding => binding.provider === 'sonar'), undefined);

  const states = [
    [{ polled: 0, failures: 0, skipped: 0 }, 'idle', undefined],
    [{ polled: 0, failures: 1, skipped: 0 }, 'blocked', 'provider_read_failed'],
    [{ polled: 1, failures: 1, skipped: 0 }, 'partial', 'provider_read_failed'],
    [{ polled: 0, failures: 0, skipped: 1 }, 'blocked', 'provider_target_unavailable'],
    [{ polled: 1, failures: 0, skipped: 1 }, 'partial', 'provider_evidence_partial'],
    [{ polled: 1, failures: 0, skipped: 0 }, 'healthy', undefined],
  ];
  for (const [input, expectedState, expectedError] of states) {
    const monitoring = workSessions.nextWorkSessionMonitoring(
      { enabled: true, currentError: 'provider_read_failed' },
      input,
      '2026-07-15T10:58:00.000Z',
    );
    assert.equal(monitoring.lastState, expectedState);
    assert.equal(monitoring.currentError, expectedError);
  }
  const changed = workSessions.nextWorkSessionMonitoring(
    { enabled: true, suppressedUnchangedCount: 9 },
    { polled: 1, transitions: 1, failures: 0, skipped: 0, summary: 'One meaningful transition.' },
    '2026-07-15T10:59:00.000Z',
  );
  assert.equal(changed.lastMeaningfulChangeAt, '2026-07-15T10:59:00.000Z');
  assert.equal(changed.suppressedUnchangedCount, 0);
  assert.equal(changed.lastSummary, 'One meaningful transition.');

  const promptPath = path.join(options.kronosDir, 'contexts', 'projection.md');
  session = workSessions.recordWorkSessionContextArtifact(session.id, {
    id: 'artifact-projection',
    kind: 'jira',
    label: 'Initial context',
    promptPath,
    fetchedAt: '2026-07-15T10:50:00.000Z',
    complete: false,
    warnings: ['Partial comments', 'Partial comments'],
  }, options);
  assert.deepEqual(session.artifacts[0].warnings, ['Partial comments']);
  assert.equal(session.artifacts[0].contentSha256, undefined);
  session = workSessions.recordWorkSessionContextArtifact(session.id, {
    id: 'artifact-projection',
    kind: 'jira',
    label: 'Updated context',
    promptPath,
    complete: true,
    contentSha256: 'c'.repeat(64),
  }, { ...options, now: new Date('2026-07-15T11:01:00.000Z') });
  assert.equal(session.artifacts.length, 1);
  assert.equal(session.artifacts[0].label, 'Updated context');
  assert.equal(session.artifacts[0].fetchedAt, '2026-07-15T11:01:00.000Z');
  assert.equal(session.artifacts[0].contentSha256, 'c'.repeat(64));
  assert.throws(
    () => workSessions.detachWorkSessionTerminal(session.id, 'missing-terminal', undefined, options),
    /Terminal binding not found/i,
  );
  assert.throws(
    () => workSessions.markWorkSessionTerminalClosed(session.id, 'missing-terminal', undefined, options),
    /Terminal binding not found/i,
  );
});

test('work-session audit renders complete local evidence and sorts supplied events newest first', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'work-session-audit'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  let session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'AUDIT-7',
    title: 'Review *unsafe* [formatting]',
    projectName: 'Customer #API',
  }, options);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-audit',
    name: 'Audit terminal',
  }, options);
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '91',
  }, options);
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab',
    resource: 'pipeline',
    subjectId: '904',
  }, options);
  session = workSessions.recordWorkSessionContextArtifact(session.id, {
    id: 'artifact-audit',
    kind: 'jira',
    label: 'Jira [context]',
    promptPath: path.join(options.kronosDir, 'contexts', 'audit`context.md'),
    fetchedAt: '2026-07-15T11:55:00.000Z',
    complete: false,
    contentSha256: 'a'.repeat(64),
    warnings: ['Comments *partial*'],
  }, options);
  const events = [
    {
      schemaVersion: 1,
      id: 'event-older',
      at: '2026-07-15T11:58:00.000Z',
      sessionId: session.id,
      type: 'provider.transition',
      source: 'gitlab',
      summary: 'Older *summary*',
      before: { state: 'running' },
      after: { state: 'failed' },
    },
    {
      schemaVersion: 1,
      id: 'event-newer',
      at: '2026-07-15T11:59:00.000Z',
      sessionId: session.id,
      type: 'context.inserted',
      source: 'jira',
      summary: 'Newest [summary]\ncontinued',
      subject: { kind: 'ticket', id: 'AUDIT-7' },
      artifactPath: path.join(options.kronosDir, 'audit', 'event`new.json'),
    },
  ];
  const markdown = buildWorkSessionAuditMarkdown(session, events);
  assert.match(markdown, /^# Customer \\#API Session history/m);
  assert.match(markdown, /Review \\\*unsafe\\\* \\\[formatting\\\]/);
  assert.ok(markdown.includes('- Type: Jira\-linked (AUDIT\\-7)'));
  assert.match(markdown, /Connected terminals: 1/);
  assert.match(markdown, /Providers: GitLab/);
  assert.ok(markdown.includes('- Jira \\[context\\] (Needs review, saved 2026\\-07\\-15T11:55:00\\.000Z)'));
  assert.match(markdown, /Content SHA-256: `a{64}`/);
  assert.match(markdown, /Warning: Comments \\\*partial\\\*/);
  assert.ok(markdown.indexOf('Newest \\[summary\\] continued') < markdown.indexOf('Older \\*summary\\*'));
  assert.match(markdown, /Ticket `AUDIT-7`/);
  assert.match(markdown, /Status: Running → Failed/);
  assert.match(markdown, /eventˋnew\.json`/);
  assert.deepEqual(events.map(event => event.id), ['event-older', 'event-newer']);

  const labelEvents = [
    ['session.created', 'kronos', 'Session created'],
    ['terminal.attached', 'operator', 'Terminal connected'],
    ['terminal.detached', 'operator', 'Terminal disconnected'],
    ['provider.baseline', 'jenkins', 'Provider baseline'],
    ['notification.shown', 'sonar', 'Notification shown'],
    ['notification.acknowledged', 'operator', 'Notification cleared'],
    ['decision.recorded', 'jira', 'Decision recorded'],
  ].map(([type, source, expectedLabel], index) => ({
    schemaVersion: 1,
    id: `event-label-${index}`,
    at: `2026-07-15T11:5${index}:30.000Z`,
    sessionId: session.id,
    type,
    source,
    summary: `${expectedLabel} summary`,
    ...(index === 3 ? {
      subject: { kind: 'project_branch', id: 'main' },
      before: { state: 'waiting_for_build' },
    } : {}),
    ...(index === 4 ? { after: { state: 'quality_gate_failed' } } : {}),
  }));
  const labelsMarkdown = buildWorkSessionAuditMarkdown(session, labelEvents);
  for (const expected of [
    'Kronos · Session created',
    'You · Terminal connected',
    'You · Terminal disconnected',
    'Jenkins · Provider baseline',
    'SonarQube · Notification shown',
    'You · Notification cleared',
    'Jira · Decision recorded',
    'Project branch `main`',
    'Status: Waiting for build → Unknown',
    'Status: Unknown → Quality gate failed',
  ]) {
    assert.ok(labelsMarkdown.includes(expected), expected);
  }

  const empty = workSessions.createStandaloneWorkSession({ title: 'Empty audit' }, {
    kronosDir: path.join(tempRoot, 'empty-work-session-audit'),
  });
  const emptyMarkdown = buildWorkSessionAuditMarkdown(empty, []);
  assert.match(emptyMarkdown, /^# Empty audit history/m);
  assert.match(emptyMarkdown, /Type: Standalone/);
  assert.match(emptyMarkdown, /Jira tickets: None/);
  assert.match(emptyMarkdown, /Providers: None/);
  assert.match(emptyMarkdown, /No history yet/);
  assert.doesNotMatch(emptyMarkdown, /## Saved context/);

  const completeArtifactSession = {
    ...session,
    projectName: undefined,
    providerBindings: [
      ...session.providerBindings,
      { ...session.providerBindings[0], id: 'provider-unknown', provider: 'custom' },
    ],
    artifacts: [{
      ...session.artifacts[0],
      complete: true,
      contentSha256: undefined,
      warnings: [],
    }],
  };
  const fallbackMarkdown = buildWorkSessionAuditMarkdown(completeArtifactSession, [{
    schemaVersion: 1,
    id: 'event-fallback-labels',
    at: '2026-07-15T12:00:00.000Z',
    sessionId: session.id,
    type: 'decision.recorded',
    source: 'custom',
    summary: 'Fallback labels remain readable.',
    subject: { kind: '', id: 'fallback`id' },
  }]);
  assert.match(fallbackMarkdown, /^# AUDIT\\-7 Session history/m);
  assert.match(fallbackMarkdown, /\(Complete, saved/);
  assert.match(fallbackMarkdown, /Providers: GitLab, Custom/);
  assert.match(fallbackMarkdown, /Unknown `fallbackˋid`/);
  assert.doesNotMatch(fallbackMarkdown, /Content SHA-256/);
});

test('registered-project monitoring owners refresh identity, reject stale bindings, and isolate returned state', () => {
  const firstPath = path.join(tempRoot, 'registered-project-v1');
  const renamedPath = path.join(tempRoot, 'registered-project-v2');
  const options = {
    kronosDir: path.join(tempRoot, 'project-monitor-owner'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  const newestSeed = {
    id: 'gitlab-merge-request-82',
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '82',
    projectId: 'team/application',
    url: 'https://gitlab.example/team/application/-/merge_requests/82',
    attachedAt: '2026-07-15T11:59:00.000Z',
  };
  const created = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: firstPath,
    displayName: 'Customer API',
    seedBindings: [newestSeed],
  }, options);
  assert.match(created.id, /^project-monitor-[a-f0-9]{48}$/);
  assert.equal(created.title, 'Customer API provider monitoring');
  assert.deepEqual(created.ticketKeys, []);
  assert.deepEqual(created.terminals, []);
  assert.equal(created.providerBindings[0].subjectId, '82');
  assert.equal(projectMonitoringStore.isProjectMonitoringRecord(created), true);
  assert.equal(projectMonitoringStore.isProjectMonitoringRecord({ id: created.id }), false);

  created.ticketKeys.push('MUTATED-1');
  created.providerBindings[0].subjectId = 'mutated';
  created.monitoring.enabled = false;
  const isolated = projectMonitoringStore.readProjectMonitoringRecord('Application', options);
  assert.deepEqual(isolated.ticketKeys, []);
  assert.equal(isolated.providerBindings[0].subjectId, '82');
  assert.equal(isolated.monitoring.enabled, true);

  const recordPath = projectMonitoringStore.projectMonitoringRecordPath(created.id, options);
  const closed = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  closed.status = 'closed';
  closed.closedAt = '2026-07-15T12:01:00.000Z';
  closed.monitoring.enabled = false;
  fs.writeFileSync(recordPath, `${JSON.stringify(closed, null, 2)}\n`, { mode: 0o600 });

  const refreshed = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: renamedPath,
    displayName: 'Customer API v2',
    seedBindings: [{
      ...newestSeed,
      id: 'gitlab-merge-request-stale',
      url: 'https://gitlab.example/team/application/-/merge_requests/82?stale=1',
      attachedAt: '2026-07-15T11:58:00.000Z',
    }],
  }, { ...options, now: new Date('2026-07-15T12:02:00.000Z') });
  assert.equal(refreshed.status, 'active');
  assert.equal(refreshed.closedAt, undefined);
  assert.equal(refreshed.monitoring.enabled, true);
  assert.equal(refreshed.title, 'Customer API v2 provider monitoring');
  assert.equal(refreshed.projectPath, renamedPath);
  assert.equal(refreshed.providerBindings[0].id, newestSeed.id, 'an older legacy seed must not replace current project state');
  assert.equal(refreshed.updatedAt, '2026-07-15T12:02:00.000Z');

  const rebound = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Application',
    path: renamedPath,
    displayName: 'Customer API v2',
    seedBindings: [{
      ...newestSeed,
      id: 'gitlab-merge-request-82-newer',
      url: 'https://gitlab.example/team/application/-/merge_requests/82?current=1',
      attachedAt: '2026-07-15T12:03:00.000Z',
    }],
  }, { ...options, now: new Date('2026-07-15T12:03:00.000Z') });
  assert.equal(rebound.providerBindings[0].id, 'gitlab-merge-request-82-newer');
  assert.equal(rebound.providerBindings[0].attachedAt, '2026-07-15T12:03:00.000Z');

  const withJenkins = projectMonitoringStore.addProjectMonitoringProviderBinding(rebound.id, {
    provider: 'jenkins',
    resource: 'build',
    subjectId: '41',
    projectId: 'https://jenkins.example/job/application',
    url: 'https://jenkins.example/job/application/41/',
  }, { ...options, now: new Date('2026-07-15T12:04:00.000Z') });
  assert.deepEqual(withJenkins.providerBindings.map(binding => binding.provider), ['gitlab', 'jenkins']);
  const healthy = projectMonitoringStore.recordProjectMonitoringResult(rebound.id, {
    polled: 2,
    transitions: 1,
    failures: 0,
    skipped: 0,
    summary: 'GitLab and Jenkins are healthy.',
  }, { ...options, now: new Date('2026-07-15T12:05:00.000Z') });
  assert.equal(healthy.monitoring.lastState, 'healthy');
  assert.equal(healthy.monitoring.lastSuccessfulAt, '2026-07-15T12:05:00.000Z');
  assert.equal(healthy.monitoring.lastSummary, 'GitLab and Jenkins are healthy.');
});

test('project monitoring state fails closed for missing owners, invalid identity, and invalid timestamps', () => {
  const options = { kronosDir: path.join(tempRoot, 'project-monitor-invalid') };
  assert.throws(() => projectMonitoringStore.projectMonitoringRecordId('  '), /requires a project name/i);
  assert.equal(projectMonitoringStore.readProjectMonitoringRecordById('session-not-a-project-owner', options), null);
  assert.throws(
    () => projectMonitoringStore.ensureProjectMonitoringRecord({ name: 'Invalid Time', path: tempRoot }, {
      ...options,
      now: new Date('invalid'),
    }),
    /timestamp is invalid/i,
  );
  assert.throws(
    () => projectMonitoringStore.addProjectMonitoringProviderBinding(
      projectMonitoringStore.projectMonitoringRecordId('Missing'),
      { provider: 'gitlab', resource: 'merge-request', subjectId: '1' },
      options,
    ),
    /record not found/i,
  );

  const created = projectMonitoringStore.ensureProjectMonitoringRecord({
    name: 'Corrupt Identity',
    path: tempRoot,
  }, options);
  const recordPath = projectMonitoringStore.projectMonitoringRecordPath(created.id, options);
  const serialized = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  serialized.projectName = 'Different Project';
  fs.writeFileSync(recordPath, `${JSON.stringify(serialized, null, 2)}\n`, { mode: 0o600 });
  assert.throws(
    () => projectMonitoringStore.readProjectMonitoringRecord('Corrupt Identity', options),
    /invalid owner identity/i,
  );
});

test('disposing the monitor releases its lease and prevents late provider state writes', async () => {
  const state = stateStore.emptyWorkCatalog();
  state.projects.Application = {
    path: tempRoot,
    config: { gitlab_project_path: 'team/application' },
  };
  state.tickets['JIRA-601'] = {
    summary: 'Dispose monitor fixture',
    type: 'Story',
    priority: 'High',
    jira_status: 'Open',
    source: 'jira',
    linked_local_project: 'Application',
    build: null,
  };
  let session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'JIRA-601',
    title: 'Dispose monitor fixture',
    projectName: 'Application',
    projectPath: tempRoot,
  });
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: '601',
    projectId: 'team/application',
    url: 'https://gitlab.example/team/application/-/merge_requests/601',
  });

  const originalMonitor = gitLabRestModule.gitlabRestClient.mergeRequestMonitor;
  let rejectRead;
  let readStarted = false;
  gitLabRestModule.gitlabRestClient.mergeRequestMonitor = () => {
    readStarted = true;
    return new Promise((resolve, reject) => { rejectRead = reject; });
  };
  const monitor = new ManagedProviderMonitor({ state: () => state });
  try {
    const polling = monitor.poll();
    for (let index = 0; index < 20 && !readStarted; index += 1) { await Promise.resolve(); }
    assert.equal(readStarted, true);
    const leasePath = managedMonitorLease.managedMonitorLeasePath();
    assert.equal(fs.existsSync(leasePath), true);
    monitor.dispose();
    assert.equal(fs.existsSync(leasePath), false, 'runtime shutdown must release the lease immediately');
    rejectRead(new Error('Deferred read ended after disposal.'));
    const result = await polling;
    assert.equal(result.leaseUnavailable, true);
    assert.equal(result.leaseReason, 'renewal-failed');
    assert.equal(gitLabMonitorStore.readGitLabMergeRequestReadStatus(session.id), null);
    assert.deepEqual(await monitor.poll(), {
      polled: 0,
      transitions: 0,
      failures: 0,
      skipped: 0,
      unconfigured: 0,
      leaseUnavailable: false,
    });
  } finally {
    gitLabRestModule.gitlabRestClient.mergeRequestMonitor = originalMonitor;
    monitor.dispose();
  }

  const extensionSource = fs.readFileSync(path.join(root, 'src/terminalFirstExtension.ts'), 'utf8');
  assert.match(extensionSource, /dispose\(\): void \{[^]*this\.monitor\.dispose\(\);/);
});

function writeLeaseFixture(kronosDir, content) {
  const leasePath = managedMonitorLease.managedMonitorLeasePath({ kronosDir });
  fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(leasePath, content, { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(kronosDir, 0o700);
    fs.chmodSync(path.dirname(leasePath), 0o700);
    fs.chmodSync(leasePath, 0o600);
  }
  return leasePath;
}

let leaseWorkerRequestId = 0;

function startLeaseWorker() {
  const worker = fork(path.join(__dirname, 'managed-monitor-lease-worker.js'), [], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let stderr = '';
  worker.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-2_000); });
  worker.kronosStderr = () => stderr;
  return worker;
}

function leaseWorkerRequest(worker, input, timeoutMs = 5_000) {
  const requestId = ++leaseWorkerRequestId;
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      worker.off('message', onMessage);
      worker.off('exit', onExit);
      worker.off('error', onError);
    };
    const onMessage = message => {
      if (!message || message.requestId !== requestId) { return; }
      cleanup();
      if (message.error) {
        reject(new Error(`Lease worker rejected ${input.command}: ${message.error}`));
        return;
      }
      resolve(message);
    };
    const onExit = (code, signal) => {
      cleanup();
      reject(new Error(
        `Lease worker exited before ${input.command} completed (code ${code}, signal ${signal || 'none'}). ${worker.kronosStderr()}`.trim(),
      ));
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Lease worker timed out during ${input.command}. ${worker.kronosStderr()}`.trim()));
    }, timeoutMs);
    worker.on('message', onMessage);
    worker.once('exit', onExit);
    worker.once('error', onError);
    worker.send({ requestId, ...input }, error => {
      if (!error) { return; }
      cleanup();
      reject(error);
    });
  });
}

async function stopLeaseWorker(worker) {
  if (worker.exitCode !== null || worker.signalCode !== null) { return; }
  try { await leaseWorkerRequest(worker, { command: 'shutdown' }, 1_000); } catch { /* cleanup below */ }
  if (worker.connected) { worker.disconnect(); }
  if (worker.exitCode !== null || worker.signalCode !== null) { return; }
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      worker.kill();
      resolve();
    }, 1_000);
    worker.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}
