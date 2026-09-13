const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const tracking = require('../out/services/claudeSessionTracking.js');
const workSessions = require('../out/services/workSessionStore.js');

function fixture(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-claude-tracking-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const claudeDirectory = path.join(root, 'claude');
  fs.mkdirSync(claudeDirectory, { mode: 0o700 });
  return {
    root,
    kronosDir: path.join(root, 'kronos'),
    claudeSettingsPath: path.join(claudeDirectory, 'settings.json'),
    nodeExecutable: process.execPath,
  };
}

function hookInput(overrides = {}) {
  return {
    session_id: crypto.randomUUID(),
    cwd: process.cwd(),
    hook_event_name: 'SessionStart',
    source: 'resume',
    transcript_path: path.join(os.tmpdir(), 'must-not-be-read.jsonl'),
    ...overrides,
  };
}

function managedEnvironment(options, workSessionId, terminalBindingId, launchClaudeSessionId) {
  return {
    ...process.env,
    KRONOS_DIR: options.kronosDir,
    KRONOS_MANAGED_CLAUDE: '1',
    KRONOS_WORK_SESSION_ID: workSessionId,
    KRONOS_TERMINAL_BINDING_ID: terminalBindingId,
    KRONOS_CLAUDE_SESSION_ID: launchClaudeSessionId,
  };
}

function installedHookGroup(settings) {
  return settings.hooks.SessionStart.find(group => group.hooks
    .some(hook => String(hook.command || '').includes(tracking.CLAUDE_SESSION_TRACKING_MARKER)));
}

function installedHook(settings) {
  return installedHookGroup(settings)?.hooks
    .find(hook => String(hook.command || '').includes(tracking.CLAUDE_SESSION_TRACKING_MARKER));
}

test('confirmed setup preserves Claude settings, creates a backup, and remains repairable', t => {
  const options = fixture(t);
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'missing');
  const pathResolvedOptions = { ...options, environment: { PATH: path.dirname(process.execPath) } };
  delete pathResolvedOptions.nodeExecutable;
  assert.equal(tracking.claudeSessionTrackingStatus(pathResolvedOptions).state, 'missing');
  for (const pathKey of ['Path', 'path']) {
    assert.equal(tracking.claudeSessionTrackingStatus({
      ...pathResolvedOptions,
      environment: { [pathKey]: path.dirname(process.execPath) },
    }).state, 'missing');
  }
  const originalSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    permissions: { allow: ['Read'] },
    hooks: {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'existing-check' }] }],
      SessionStart: [{
        matcher: 'startup',
        hooks: [
          { type: 'command', command: 'existing-start' },
          { type: 'prompt', prompt: 'Preserve this unrelated prompt hook.' },
          { type: 'command', command: 7 },
        ],
      }],
    },
  };
  const originalText = `${JSON.stringify(originalSettings, null, 2)}\n`;
  fs.writeFileSync(options.claudeSettingsPath, originalText, { mode: 0o600 });

  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'missing');
  const installed = tracking.installClaudeSessionTracking({
    ...options,
    now: new Date('2026-07-31T10:00:00.000Z'),
  });
  assert.equal(installed.status.state, 'ready');
  assert.equal(fs.readFileSync(installed.backupPath, 'utf8'), originalText);
  assert.equal(fs.statSync(installed.helperPath).mode & 0o777, 0o600);
  const settings = JSON.parse(fs.readFileSync(installed.settingsPath, 'utf8'));
  assert.deepEqual(settings.permissions, originalSettings.permissions);
  assert.deepEqual(settings.hooks.PreToolUse, originalSettings.hooks.PreToolUse);
  assert.deepEqual(settings.hooks.SessionStart[0], originalSettings.hooks.SessionStart[0]);
  assert.equal(installedHookGroup(settings).matcher, 'resume|clear');
  assert.equal(installedHook(settings).timeout, 5);

  if (process.platform !== 'win32') {
    fs.chmodSync(installed.helperPath, 0o644);
    assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');
    fs.chmodSync(installed.helperPath, 0o600);
  }
  fs.writeFileSync(installed.helperPath, 'outdated helper', { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');
  const repaired = tracking.installClaudeSessionTracking({
    ...options,
    now: new Date('2026-07-31T10:00:01.000Z'),
  });
  assert.equal(repaired.status.state, 'ready');
  const repairedSettings = JSON.parse(fs.readFileSync(repaired.settingsPath, 'utf8'));
  assert.equal(repairedSettings.hooks.SessionStart.flatMap(group => group.hooks)
    .filter(hook => String(hook.command || '').includes(tracking.CLAUDE_SESSION_TRACKING_MARKER)).length, 1);

  const duplicateSettings = structuredClone(repairedSettings);
  duplicateSettings.hooks.SessionStart.push(structuredClone(installedHookGroup(repairedSettings)));
  fs.writeFileSync(options.claudeSettingsPath, `${JSON.stringify(duplicateSettings)}\n`, { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');
  const deduplicated = tracking.installClaudeSessionTracking({
    ...options,
    now: new Date('2026-07-31T10:00:02.000Z'),
  });
  const deduplicatedSettings = JSON.parse(fs.readFileSync(deduplicated.settingsPath, 'utf8'));
  assert.equal(deduplicatedSettings.hooks.SessionStart.flatMap(group => group.hooks)
    .filter(hook => String(hook.command || '').includes(tracking.CLAUDE_SESSION_TRACKING_MARKER)).length, 1);

  const staleMatcherSettings = structuredClone(deduplicatedSettings);
  installedHookGroup(staleMatcherSettings).matcher = 'startup';
  fs.writeFileSync(options.claudeSettingsPath, `${JSON.stringify(staleMatcherSettings)}\n`, { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');

  const staleTimeoutSettings = structuredClone(deduplicatedSettings);
  installedHook(staleTimeoutSettings).timeout = 4;
  fs.writeFileSync(options.claudeSettingsPath, `${JSON.stringify(staleTimeoutSettings)}\n`, { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');

  installedHook(deduplicatedSettings).command += ' --old-path';
  fs.writeFileSync(options.claudeSettingsPath, `${JSON.stringify(deduplicatedSettings)}\n`, { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'repair');
});

test('setup refuses invalid or unsafe Claude settings and explains missing prerequisites', t => {
  const options = fixture(t);
  assert.equal(tracking.claudeSessionTrackingStatus({ ...options, environment: { PATH: '' }, nodeExecutable: undefined }).state, 'blocked');
  assert.equal(tracking.claudeSessionTrackingStatus({
    ...options,
    environment: { PATH: path.join(options.root, 'missing-bin') },
    nodeExecutable: undefined,
  }).state, 'blocked');
  assert.equal(tracking.claudeSessionTrackingStatus({ ...options, nodeExecutable: options.root }).state, 'blocked');
  if (process.platform !== 'win32') {
    const nonFileBin = path.join(options.root, 'non-file-bin');
    fs.mkdirSync(path.join(nonFileBin, 'node'), { recursive: true });
    const searchedPath = [
      path.join(options.root, 'missing-bin'),
      nonFileBin,
      '',
      path.dirname(process.execPath),
    ].join(path.delimiter);
    assert.equal(tracking.claudeSessionTrackingStatus({
      ...options,
      environment: { PATH: searchedPath },
      nodeExecutable: undefined,
    }).state, 'missing');
  }

  const freshInstall = tracking.installClaudeSessionTracking({
    ...options,
    kronosDir: path.join(options.root, 'fresh-kronos'),
    claudeSettingsPath: path.join(options.root, 'fresh-claude', 'settings.json'),
  });
  assert.equal(freshInstall.status.state, 'ready');
  assert.equal(freshInstall.backupPath, undefined);
  fs.writeFileSync(options.claudeSettingsPath, '{}\n', { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus({
    ...options,
    kronosDir: path.join(options.root, 'control\npath'),
  }).state, 'blocked');
  assert.equal(tracking.claudeSessionTrackingStatus({
    ...options,
    kronosDir: path.join(options.root, 'unsafe&windows-hook'),
    platform: 'win32',
  }).state, 'blocked');

  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'missing');
  fs.writeFileSync(options.claudeSettingsPath, '{"hooks":{}}\n', { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'missing');

  fs.writeFileSync(options.claudeSettingsPath, '{not-json', { mode: 0o600 });
  assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'blocked');
  assert.throws(() => tracking.installClaudeSessionTracking(options), /not valid JSON/);
  assert.equal(fs.readFileSync(options.claudeSettingsPath, 'utf8'), '{not-json');

  for (const settings of [[], { hooks: [] }, { hooks: { SessionStart: {} } }, {
    hooks: { SessionStart: [{}] },
  }, {
    hooks: { SessionStart: [{ hooks: ['invalid'] }] },
  }]) {
    fs.writeFileSync(options.claudeSettingsPath, `${JSON.stringify(settings)}\n`, { mode: 0o600 });
    assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'blocked');
    assert.throws(() => tracking.installClaudeSessionTracking(options), /object|unsupported shape/);
  }

  fs.writeFileSync(options.claudeSettingsPath, '{}\n', { mode: 0o600 });
  assert.throws(
    () => tracking.installClaudeSessionTracking({ ...options, now: new Date(Number.NaN) }),
    /timestamp is invalid/,
  );

  if (process.platform !== 'win32') {
    const actual = path.join(options.root, 'actual-settings.json');
    fs.writeFileSync(actual, '{}\n', { mode: 0o600 });
    fs.rmSync(options.claudeSettingsPath, { force: true });
    fs.symlinkSync(actual, options.claudeSettingsPath);
    assert.equal(tracking.claudeSessionTrackingStatus(options).state, 'blocked');
    assert.throws(() => tracking.installClaudeSessionTracking(options), /symbolic link|unsafe/i);
    assert.equal(fs.readFileSync(actual, 'utf8'), '{}\n');

    const actualDirectory = path.join(options.root, 'actual-claude-directory');
    const linkedDirectory = path.join(options.root, 'linked-claude-directory');
    fs.mkdirSync(actualDirectory);
    fs.symlinkSync(actualDirectory, linkedDirectory);
    assert.throws(() => tracking.installClaudeSessionTracking({
      ...options,
      claudeSettingsPath: path.join(linkedDirectory, 'settings.json'),
    }), /directory is unsafe/i);
  }

  const tamperedOptions = {
    ...options,
    kronosDir: path.join(options.root, 'tampered-kronos'),
    claudeSettingsPath: path.join(options.root, 'tampered-claude', 'settings.json'),
  };
  const helperPath = path.join(tamperedOptions.kronosDir, 'claude-session-tracking', 'claude-session-tracker.cjs');
  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    originalRenameSync(source, destination);
    if (path.resolve(destination) === path.resolve(tamperedOptions.claudeSettingsPath)) {
      fs.writeFileSync(helperPath, 'concurrently changed helper', { mode: 0o600 });
    }
  };
  try {
    assert.throws(
      () => tracking.installClaudeSessionTracking(tamperedOptions),
      /could not be verified after installation/,
    );
  } finally {
    fs.renameSync = originalRenameSync;
  }
});

test('SessionStart helper ignores unrelated processes and writes one bounded correlated event', t => {
  const options = fixture(t);
  const installed = tracking.installClaudeSessionTracking(options);
  const workSessionId = 'session-tracking-test';
  const terminalBindingId = 'terminal-tracking-test';
  const launchClaudeSessionId = crypto.randomUUID();
  const input = hookInput();
  const helper = installed.helperPath;

  let result = spawnSync(process.execPath, [helper, tracking.CLAUDE_SESSION_TRACKING_MARKER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, KRONOS_DIR: options.kronosDir },
  });
  assert.equal(result.status, 0);
  assert.equal(tracking.readClaudeSessionTrackingEvent(workSessionId, terminalBindingId, options), null);

  result = spawnSync(process.execPath, [helper, tracking.CLAUDE_SESSION_TRACKING_MARKER], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: managedEnvironment(options, workSessionId, terminalBindingId, launchClaudeSessionId),
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const event = tracking.readClaudeSessionTrackingEvent(workSessionId, terminalBindingId, options);
  assert.equal(event.workSessionId, workSessionId);
  assert.equal(event.terminalBindingId, terminalBindingId);
  assert.equal(event.launchClaudeSessionId, launchClaudeSessionId);
  assert.equal(event.claudeSessionId, input.session_id);
  assert.equal(event.cwd, path.resolve(input.cwd));
  assert.equal(event.source, 'resume');
  assert.match(event.observedAt, /^\d{4}-\d{2}-\d{2}T/);

  for (const source of ['startup', 'compact']) {
    const ignoredBindingId = `terminal-ignored-${source}`;
    result = spawnSync(process.execPath, [helper, tracking.CLAUDE_SESSION_TRACKING_MARKER], {
      input: JSON.stringify(hookInput({ source })),
      encoding: 'utf8',
      env: managedEnvironment(options, workSessionId, ignoredBindingId, launchClaudeSessionId),
    });
    assert.equal(result.status, 0);
    assert.equal(tracking.readClaudeSessionTrackingEvent(workSessionId, ignoredBindingId, options), null);
  }

  const clearBindingId = 'terminal-clear-hook';
  result = spawnSync(process.execPath, [helper, tracking.CLAUDE_SESSION_TRACKING_MARKER], {
    input: JSON.stringify(hookInput({ source: 'clear' })),
    encoding: 'utf8',
    env: managedEnvironment(options, workSessionId, clearBindingId, launchClaudeSessionId),
  });
  assert.equal(result.status, 0);
  assert.equal(
    tracking.readClaudeSessionTrackingEvent(workSessionId, clearBindingId, options).source,
    'clear',
  );

  const invalidBindingId = 'terminal-invalid-hook';
  result = spawnSync(process.execPath, [helper, tracking.CLAUDE_SESSION_TRACKING_MARKER], {
    input: JSON.stringify(hookInput({ hook_event_name: 'PreToolUse' })),
    encoding: 'utf8',
    env: managedEnvironment(options, workSessionId, invalidBindingId, launchClaudeSessionId),
  });
  assert.equal(result.status, 0);
  assert.equal(tracking.readClaudeSessionTrackingEvent(workSessionId, invalidBindingId, options), null);
});

test('event reader rejects path tricks, mismatched identities, malformed records, and permissive files', t => {
  const options = fixture(t);
  tracking.installClaudeSessionTracking(options);
  assert.throws(() => tracking.trackingEventFileName('../escape', 'terminal-safe'), /invalid/);
  assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', '../escape', options), /invalid/);

  const events = path.join(options.kronosDir, 'claude-session-tracking', 'events');
  const file = path.join(events, tracking.trackingEventFileName('session-safe', 'terminal-safe'));
  fs.writeFileSync(file, `${JSON.stringify({
    schemaVersion: 1,
    workSessionId: 'session-other',
    terminalBindingId: 'terminal-safe',
    launchClaudeSessionId: crypto.randomUUID(),
    claudeSessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    source: 'resume',
    observedAt: '2026-07-31T10:00:00.000Z',
  })}\n`, { mode: 0o600 });
  assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options), /does not match/);

  fs.writeFileSync(file, '{}\n', { mode: 0o600 });
  assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options), /event is invalid/);
  const valid = {
    schemaVersion: 1,
    workSessionId: 'session-safe',
    terminalBindingId: 'terminal-safe',
    launchClaudeSessionId: crypto.randomUUID(),
    claudeSessionId: crypto.randomUUID(),
    cwd: process.cwd(),
    source: 'resume',
    observedAt: '2026-07-31T10:00:00.000Z',
  };
  for (const [replacement, expected] of [
    [{ cwd: '' }, /cwd is invalid/],
    [{ cwd: 'relative' }, /cwd is invalid/],
    [{ cwd: `${process.cwd()}\nunsafe` }, /cwd is invalid/],
    [{ cwd: `/${'x'.repeat(4097)}` }, /cwd is invalid/],
    [{ source: '' }, /source is invalid/],
    [{ source: 7 }, /source is invalid/],
    [{ source: 'x'.repeat(101) }, /source is invalid/],
    [{ source: 'resume\nunsafe' }, /source is invalid/],
    [{ source: 'startup' }, /source is invalid/],
    [{ source: 'compact' }, /source is invalid/],
    [{ observedAt: '' }, /timestamp is invalid/],
    [{ observedAt: 'not-a-time' }, /timestamp is invalid/],
    [{ workSessionId: '../unsafe' }, /work session id is invalid/],
  ]) {
    fs.writeFileSync(file, `${JSON.stringify({ ...valid, ...replacement })}\n`, { mode: 0o600 });
    assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options), expected);
  }
  fs.writeFileSync(file, `${JSON.stringify({ ...valid, cwd: 'C:\\repo\\subfolder' })}\n`, { mode: 0o600 });
  assert.equal(
    tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options).cwd,
    'C:\\repo\\subfolder',
  );
  fs.writeFileSync(file, 'x'.repeat(16 * 1024 + 1), { mode: 0o600 });
  assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options), /byte limit/);
  if (process.platform !== 'win32') {
    fs.writeFileSync(file, '{}\n', { mode: 0o644 });
    fs.chmodSync(file, 0o644);
    assert.throws(() => tracking.readClaudeSessionTrackingEvent('session-safe', 'terminal-safe', options), /private permissions/);
  }
});

test('lifecycle reconciliation changes only the correlated Claude resume identity and folder', t => {
  const options = fixture(t);
  const store = { kronosDir: options.kronosDir, now: new Date('2026-07-31T09:00:00.000Z') };
  const initialClaudeSessionId = crypto.randomUUID();
  const currentClaudeSessionId = crypto.randomUUID();
  let session = workSessions.createStandaloneWorkSession({
    title: 'Stable work identity',
    projectName: 'Application',
    projectPath: options.root,
  }, store);
  session = workSessions.setWorkSessionDisplayName(session.id, 'Release session', store);
  session = workSessions.addWorkSessionTicketContext(session.id, 'APP-42', store);
  session = workSessions.addWorkSessionProviderBinding(session.id, {
    provider: 'gitlab', resource: 'merge-request', subjectId: '7', projectId: 'application',
  }, store);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-managed',
    name: 'Claude',
    cwd: options.root,
    claudeSessionId: initialClaudeSessionId,
    claudeLaunchSessionId: initialClaudeSessionId,
    editorSessionId: 'editor-one',
    claudePermissionMode: 'default',
  }, store);
  const stable = {
    id: session.id,
    title: session.title,
    displayName: session.displayName,
    projectName: session.projectName,
    projectPath: session.projectPath,
    ticketKeys: session.ticketKeys,
    providerBindings: session.providerBindings,
  };

  session = workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-managed',
    launchClaudeSessionId: initialClaudeSessionId,
    claudeSessionId: currentClaudeSessionId,
    cwd: path.dirname(options.root),
    observedAt: '2026-07-31T09:01:00.000Z',
  }, { ...store, now: new Date('2026-07-31T09:01:01.000Z') });
  assert.deepEqual({
    id: session.id,
    title: session.title,
    displayName: session.displayName,
    projectName: session.projectName,
    projectPath: session.projectPath,
    ticketKeys: session.ticketKeys,
    providerBindings: session.providerBindings,
  }, stable);
  assert.equal(session.terminals[0].claudeSessionId, currentClaudeSessionId);
  assert.equal(session.terminals[0].claudeLaunchSessionId, initialClaudeSessionId);
  assert.equal(session.terminals[0].cwd, path.dirname(options.root));
  assert.equal(workSessions.managedClaudeBindingAcceptsLaunchSession(session.terminals[0], initialClaudeSessionId), true);
  assert.equal(workSessions.managedClaudeBindingAcceptsLaunchSession(session.terminals[0], currentClaudeSessionId), true);
  assert.equal(workSessions.managedClaudeBindingAcceptsLaunchSession(session.terminals[0], crypto.randomUUID()), false);
  assert.equal(workSessions.managedClaudeBindingAcceptsLaunchSession(session.terminals[0], 'invalid'), false);

  const observedAt = session.terminals[0].claudeIdentityObservedAt;
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-managed',
    name: 'Claude still attached',
    cwd: path.dirname(options.root),
    claudeSessionId: currentClaudeSessionId,
    editorSessionId: 'editor-one',
    claudePermissionMode: 'default',
  }, store);
  assert.equal(session.terminals[0].claudeLaunchSessionId, initialClaudeSessionId);
  assert.equal(session.terminals[0].claudeIdentityObservedAt, observedAt);

  const stale = workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-managed',
    launchClaudeSessionId: initialClaudeSessionId,
    claudeSessionId: crypto.randomUUID(),
    cwd: options.root,
    observedAt: '2026-07-31T09:00:30.000Z',
  }, { ...store, now: new Date('2026-07-31T09:02:00.000Z') });
  assert.equal(stale.terminals[0].claudeSessionId, currentClaudeSessionId);
  assert.throws(() => workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-managed',
    launchClaudeSessionId: crypto.randomUUID(),
    claudeSessionId: crypto.randomUUID(),
    cwd: options.root,
    observedAt: '2026-07-31T09:03:00.000Z',
  }, store), /does not match/);
  assert.throws(() => workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-missing',
    launchClaudeSessionId: initialClaudeSessionId,
    claudeSessionId: currentClaudeSessionId,
    cwd: options.root,
    observedAt: '2026-07-31T09:03:00.000Z',
  }, store), /binding not found/);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-unmanaged',
    name: 'Shell',
    cwd: options.root,
  }, store);
  assert.throws(() => workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-unmanaged',
    launchClaudeSessionId: initialClaudeSessionId,
    claudeSessionId: currentClaudeSessionId,
    cwd: options.root,
    observedAt: '2026-07-31T09:03:00.000Z',
  }, store), /not a managed Claude terminal/);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-inferred-launch',
    name: 'Claude inferred launch',
    cwd: options.root,
    claudeSessionId: currentClaudeSessionId,
    editorSessionId: 'editor-inferred',
    claudePermissionMode: 'plan',
  }, store);
  assert.equal(
    session.terminals.find(binding => binding.id === 'terminal-inferred-launch').claudeLaunchSessionId,
    currentClaudeSessionId,
  );
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-inferred-launch',
    name: 'Claude inferred launch retained',
  }, store);
  const inferred = session.terminals.find(binding => binding.id === 'terminal-inferred-launch');
  assert.equal(inferred.claudeSessionId, currentClaudeSessionId);
  assert.equal(inferred.claudeLaunchSessionId, currentClaudeSessionId);
  assert.equal(inferred.editorSessionId, 'editor-inferred');
  assert.equal(inferred.claudePermissionMode, 'plan');
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-managed',
    name: 'Claude resumed after restart',
    cwd: path.dirname(options.root),
    claudeSessionId: currentClaudeSessionId,
    claudeLaunchSessionId: currentClaudeSessionId,
    editorSessionId: 'editor-two',
    claudePermissionMode: 'default',
  }, { ...store, now: new Date('2026-07-31T09:03:30.000Z') });
  assert.equal(session.terminals[0].claudeLaunchSessionId, currentClaudeSessionId);
  assert.equal(session.terminals[0].claudeIdentityObservedAt, undefined);
  workSessions.closeWorkSession(session.id, store);
  assert.throws(() => workSessions.updateWorkSessionClaudeIdentity(session.id, {
    terminalBindingId: 'terminal-managed',
    launchClaudeSessionId: currentClaudeSessionId,
    claudeSessionId: currentClaudeSessionId,
    cwd: options.root,
    observedAt: '2026-07-31T09:04:00.000Z',
  }, store), /is closed/);
});
