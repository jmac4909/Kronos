const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-terminal-lifecycle-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const claudeTerminalLauncher = require('../out/services/claudeTerminalLauncher.js');
const managedClaudeIdentity = require('../out/services/managedClaudeTerminalIdentity.js');
const { createOperatorTerminalRegistry } = require('../out/services/operatorTerminalRegistry.js');
const terminalContextInsertion = require('../out/services/terminalContextInsertion.js');
const workSessionLifecycle = require('../out/services/workSessionLifecycle.js');
const sessionInventory = require('../out/services/sessionInventoryPresentation.js');
const workSessions = require('../out/services/workSessionStore.js');
const monitorEvents = require('../out/services/monitorEventStore.js');

test('duplicate terminal names remain exact object identities across sessions and ambiguous bindings', () => {
  const registry = createOperatorTerminalRegistry();
  const first = { name: 'Claude @ main' };
  const second = { name: 'Claude @ main' };
  const third = { name: 'Claude @ main' };

  registry.attach(first, { sessionId: 'session-one', bindingId: 'binding-one' });
  registry.attach(second, { sessionId: 'session-two', bindingId: 'binding-two' });
  registry.attach(third, { sessionId: 'session-one', bindingId: 'binding-three' });

  assert.equal(registry.resolve('session-one', 'binding-one').terminal, first);
  assert.equal(registry.resolve('session-two', 'binding-two').terminal, second);
  assert.equal(registry.resolve('session-one', 'binding-three').terminal, third);
  assert.deepEqual(registry.resolve('session-one'), {
    kind: 'ambiguous',
    bindingIds: ['binding-one', 'binding-three'],
  });
  assert.deepEqual(registry.detachBinding('session-one', 'binding-one'), {
    sessionId: 'session-one',
    bindingId: 'binding-one',
  });
  assert.equal(registry.resolve('session-one').terminal, third);
  assert.equal(registry.resolve('session-two').terminal, second);
});

test('one lifecycle projection distinguishes none, attached, paused, detached, closed, and stopped', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'lifecycle-state'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  const standalone = workSessions.createStandaloneWorkSession({ title: 'No ticket yet' }, options);
  assert.deepEqual(workSessionLifecycle.workSessionLifecycle(standalone, 0), {
    management: 'active',
    terminal: 'none',
    monitoring: 'ineligible',
    canInsertContext: false,
    canPollProviders: false,
    canReconnect: true,
  });

  let session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'JIRA-201',
    title: 'Lifecycle fixture',
  }, options);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-one',
    name: 'Duplicate-safe terminal',
  }, options);
  assert.equal(workSessionLifecycle.workSessionLifecycle(session, 0).terminal, 'detached');
  assert.deepEqual(workSessionLifecycle.workSessionLifecycle(session, 1), {
    management: 'active',
    terminal: 'attached',
    monitoring: 'running',
    canInsertContext: true,
    canPollProviders: true,
    canReconnect: false,
  });

  session = workSessions.setWorkSessionMonitoring(session.id, false, undefined, options);
  assert.equal(workSessionLifecycle.workSessionLifecycle(session, 1).monitoring, 'paused');
  session = workSessions.detachWorkSessionTerminal(session.id, 'terminal-one', 'operator detached', options);
  assert.equal(workSessionLifecycle.workSessionLifecycle(session, 0).terminal, 'detached');
  session = workSessions.markWorkSessionTerminalClosed(session.id, 'terminal-one', 'terminal closed', options);
  assert.equal(workSessionLifecycle.workSessionLifecycle(session, 0).terminal, 'closed');
  session = workSessions.closeWorkSession(session.id, options);
  assert.deepEqual(workSessionLifecycle.workSessionLifecycle(session, 0), {
    management: 'stopped',
    terminal: 'closed',
    monitoring: 'stopped',
    canInsertContext: false,
    canPollProviders: false,
    canReconnect: true,
  });
});

test('Sessions present project, branch, Jira contexts, attachment, monitoring, and latest result at a glance', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'session-inventory'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  let session = workSessions.createStandaloneWorkSession({
    title: 'Interactive investigation',
    projectName: 'Application',
    projectPath: tempRoot,
  }, options);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-inventory',
    name: 'Operator terminal metadata only',
  }, options);
  let presentation = sessionInventory.sessionInventoryPresentation(
    session,
    1,
    300_000,
    'feature/session-inventory',
    'Customer API',
  );
  assert.equal(presentation.label, 'Customer API: Interactive investigation');
  assert.equal(
    presentation.description,
    'Connected',
  );
  assert.match(presentation.tooltip, /Project: Customer API/);
  assert.match(presentation.tooltip, /Branch: feature\/session-inventory/);
  assert.match(presentation.tooltip, /Jira tickets: None/);
  assert.doesNotMatch(presentation.tooltip, /Stable project identity|^Work session:|^(?:Management|Terminal|Monitoring) lifecycle:/im);

  session = workSessions.addWorkSessionTicketContext(session.id, 'JIRA-301', options);
  session = workSessions.addWorkSessionTicketContext(session.id, 'JIRA-302', options);
  session = workSessions.recordWorkSessionMonitoringResult(session.id, {
    polled: 2,
    failures: 1,
    skipped: 0,
    transitions: 1,
    summary: 'GitLab succeeded; Jenkins needs operator review.',
  }, options);
  presentation = sessionInventory.sessionInventoryPresentation(
    session,
    1,
    300_000,
    'feature/session-inventory',
  );
  assert.equal(
    presentation.description,
    'Connected • Needs review',
  );
  assert.match(presentation.tooltip, /Jira tickets: JIRA-301, JIRA-302/);
  assert.match(presentation.tooltip, /Provider updates: Needs review/);
  assert.match(presentation.tooltip, /Last result: GitLab succeeded; Jenkins needs operator review\./);
  assert.match(presentation.tooltip, /Select to open the terminal\./);
  assert.match(presentation.tooltip, /Right-click for context, history, and connection actions\./);
  assert.doesNotMatch(presentation.tooltip, /Operator terminal metadata only/);
});

test('Sessions never present detached, closed, stopped, paused, or removed-project records as active', () => {
  const options = {
    kronosDir: path.join(tempRoot, 'session-inventory-lifecycle'),
    now: new Date('2026-07-15T12:00:00.000Z'),
  };
  let session = workSessions.createOrGetWorkSessionByTicket({
    ticketKey: 'JIRA-303',
    title: 'Lifecycle presentation',
    projectName: 'Removed Project',
    projectPath: tempRoot,
  }, options);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-lifecycle-presentation',
    name: 'Operator terminal',
  }, options);
  session = workSessions.setWorkSessionMonitoring(session.id, false, undefined, options);
  assert.match(
    sessionInventory.sessionInventoryPresentation(session, 1, 300_000, 'main').description,
    /^Connected • Checks paused$/,
  );

  session = workSessions.detachWorkSessionTerminal(
    session.id,
    'terminal-lifecycle-presentation',
    'operator detached',
    options,
  );
  const detached = sessionInventory.sessionInventoryPresentation(session, 0, 300_000, 'main');
  assert.match(detached.description, /^Reconnect needed • Checks paused$/);
  assert.match(detached.tooltip, /Right-click for history and tracking actions\./);
  session = workSessions.markWorkSessionTerminalClosed(
    session.id,
    'terminal-lifecycle-presentation',
    'terminal closed',
    options,
  );
  const alreadyClosed = workSessions.detachWorkSessionTerminal(
    session.id,
    'terminal-lifecycle-presentation',
    'late detach is a no-op',
    options,
  );
  assert.equal(alreadyClosed.terminals.at(-1).status, 'closed');
  session = workSessions.setWorkSessionProject(session.id, {}, options);
  session = workSessions.closeWorkSession(session.id, options);
  const stopped = sessionInventory.sessionInventoryPresentation(session, 0, 300_000);
  assert.equal(stopped.label, 'JIRA-303: Lifecycle presentation');
  assert.equal(stopped.description, 'Tracking stopped');
  assert.match(stopped.tooltip, /Terminal: Closed/);
  assert.match(stopped.tooltip, /Tracking: Stopped/);
  assert.match(stopped.tooltip, /Select to reconnect the terminal and resume tracking/);
  assert.match(stopped.tooltip, /Right-click to view history or remove the Session from Kronos\./);

  const newerActive = workSessions.createStandaloneWorkSession({ title: 'New active session' }, {
    ...options,
    now: new Date('2026-07-15T12:01:00.000Z'),
  });
  assert.deepEqual(
    [session, newerActive].sort(sessionInventory.sessionInventorySortOrder).map(item => item.id),
    [newerActive.id, session.id],
  );
});

test('Sessions action language keeps Open Terminal, reconnect, detach, monitoring, audit, stop, and remove distinct', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const titles = Object.fromEntries(manifest.contributes.commands.map(command => [command.command, command.title]));
  assert.deepEqual({
    open: titles['kronos.focusWorkSessionTerminal'],
    size: titles['kronos.toggleWorkSessionTerminalSize'],
    reconnect: titles['kronos.reattachWorkSessionTerminal'],
    detach: titles['kronos.detachWorkSessionTerminal'],
    pause: titles['kronos.pauseWorkSessionMonitoring'],
    resume: titles['kronos.resumeWorkSessionMonitoring'],
    poll: titles['kronos.pollManagedWorkSessions'],
    audit: titles['kronos.openWorkSessionAudit'],
    stop: titles['kronos.closeWorkSession'],
    remove: titles['kronos.removeWorkSession'],
  }, {
    open: 'Kronos: Open Session Terminal',
    size: 'Kronos: Toggle Full-Size Session Terminal',
    reconnect: 'Kronos: Connect Focused Terminal to Session',
    detach: 'Kronos: Disconnect Terminal',
    pause: 'Kronos: Pause Provider Updates',
    resume: 'Kronos: Resume Provider Updates',
    poll: 'Kronos: Check Provider Updates',
    audit: 'Kronos: View Session History',
    stop: 'Kronos: Stop Tracking Session',
    remove: 'Kronos: Remove Session from Kronos',
  });
  assert.equal(new Set(Object.values(titles).filter(title => title.includes('Session') || title.includes('Monitoring'))).size > 1, true);
  const viewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'ManagedSessionTreeProvider.ts'), 'utf8');
  assert.match(viewSource, /this\.command = \{ command: 'kronos\.focusWorkSessionTerminal', title: 'Open Session Terminal'/);
  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'terminalFirstExtension.ts'), 'utf8');
  assert.match(runtimeSource, /Session entry and saved provider status will be deleted/);
  assert.match(runtimeSource, /terminal.*remain open and untouched/);
  assert.match(runtimeSource, /Session history and saved context will remain on this device/);
});

test('terminal titles capture ticket and observed branch once at launch within the VS Code name bound', () => {
  assert.equal(
    claudeTerminalLauncher.buildClaudeTerminalTitle('Claude', undefined, 'feature/standalone'),
    'Claude @ feature/standalone',
  );
  assert.equal(
    claudeTerminalLauncher.buildClaudeTerminalTitle('Claude', 'JIRA-304', 'feature/ticket'),
    'Claude · JIRA-304 @ feature/ticket',
  );
  const bounded = claudeTerminalLauncher.buildClaudeTerminalTitle(
    'Claude terminal with an intentionally long configured presentation label',
    'JIRA-305',
    `feature/${'x'.repeat(200)}`,
  );
  assert.ok(bounded.length <= 80);
  assert.match(bounded, /JIRA-305 @ feature\//);
  assert.match(bounded, /…$/);
  assert.equal(
    claudeTerminalLauncher.buildClaudeTerminalTitle('Claude', 'JIRA-306', 'feature\nobserved'),
    'Claude · JIRA-306 @ feature observed',
  );
});

test('session removal deletes only colocated state and registry detachment never controls the terminal', () => {
  const options = { kronosDir: path.join(tempRoot, 'removal-isolation') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Disposable session' }, options);
  const sessionDirectory = workSessions.workSessionDirectory(session.id, options);
  fs.writeFileSync(path.join(sessionDirectory, 'monitor-snapshot.json'), '{}\n', { mode: 0o600 });
  const retainedArtifact = path.join(options.kronosDir, 'contexts', 'retained.md');
  fs.mkdirSync(path.dirname(retainedArtifact), { recursive: true });
  fs.writeFileSync(retainedArtifact, 'retained\n');
  monitorEvents.appendMonitorEvent({
    id: 'retained-shared-audit',
    at: '2026-07-15T12:00:00.000Z',
    sessionId: session.id,
    type: 'decision.recorded',
    source: 'operator',
    summary: 'Shared audit must outlive the removed session record.',
  }, options);

  const controlCalls = [];
  const terminal = {
    name: 'Still operator owned',
    dispose() { controlCalls.push('dispose'); },
    sendText() { controlCalls.push('sendText'); },
  };
  const registry = createOperatorTerminalRegistry();
  registry.attach(terminal, { sessionId: session.id, bindingId: 'terminal-one' });

  const removed = workSessions.removeWorkSession(session.id, options);
  registry.detachSession(session.id);
  assert.equal(removed.id, session.id);
  assert.equal(fs.existsSync(sessionDirectory), false);
  assert.equal(fs.readFileSync(retainedArtifact, 'utf8'), 'retained\n');
  assert.equal(monitorEvents.listMonitorEvents({ sessionId: session.id }, options)[0].id, 'retained-shared-audit');
  assert.equal(workSessions.readWorkSession(session.id, options), null);
  assert.deepEqual(controlCalls, []);
  assert.equal(terminal.name, 'Still operator owned');
});

test('explicit Claude launch creates and focuses exactly one terminal with or without a cwd', () => {
  const creations = [];
  const factory = {
    createTerminal(options) {
      const actions = [];
      const terminal = {
        show(preserveFocus) { actions.push(['show', preserveFocus]); },
        sendText(text, shouldExecute) { actions.push(['sendText', text, shouldExecute]); },
      };
      creations.push({ options, terminal, actions });
      return terminal;
    },
  };

  const withWorkspace = claudeTerminalLauncher.launchClaudeTerminal(factory, {
    command: 'claude --model opus',
    name: 'Claude @ feature/workspace',
    cwd: tempRoot,
  }, {
    location: 2,
  });
  const withoutWorkspace = claudeTerminalLauncher.launchClaudeTerminal(factory, {
    command: 'claude',
    name: 'Claude',
  });

  assert.equal(creations.length, 2);
  assert.equal(withWorkspace.terminal, creations[0].terminal);
  assert.deepEqual(creations[0].options, {
    name: 'Claude @ feature/workspace',
    cwd: path.resolve(tempRoot),
    location: 2,
  });
  assert.deepEqual(creations[0].actions, [
    ['show', false],
    ['sendText', 'claude --model opus', true],
  ]);
  assert.equal(withoutWorkspace.terminal, creations[1].terminal);
  assert.deepEqual(creations[1].options, { name: 'Claude' });
  assert.deepEqual(creations[1].actions, [
    ['show', false],
    ['sendText', 'claude', true],
  ]);
});

test('managed Claude identity supports exact resume, explicit legacy migration, and strict persistence', () => {
  const options = { kronosDir: path.join(tempRoot, 'managed-claude-resume') };
  const claudeSessionId = '123e4567-e89b-42d3-a456-426614174000';
  const identity = {
    workSessionId: 'session-resume',
    terminalBindingId: 'terminal-resume',
    claudeSessionId,
    editorSessionId: 'editor-before-reboot',
  };
  const creations = [];
  const factory = {
    createTerminal(terminalOptions) {
      const actions = [];
      const terminal = {
        creationOptions: terminalOptions,
        show(preserveFocus) { actions.push(['show', preserveFocus]); },
        sendText(text, shouldExecute) { actions.push(['sendText', text, shouldExecute]); },
      };
      creations.push({ terminalOptions, terminal, actions });
      return terminal;
    },
  };

  const launched = claudeTerminalLauncher.launchClaudeTerminal(factory, {
    cwd: tempRoot,
    claudeSessionId,
  }, { identity, location: 2 });
  assert.equal(launched.configuration.command, `claude --session-id ${claudeSessionId}`);
  assert.deepEqual(
    managedClaudeIdentity.managedClaudeTerminalIdentity(launched.terminal),
    identity,
  );
  assert.equal(creations[0].terminalOptions.env.KRONOS_MANAGED_CLAUDE, '1');
  assert.equal(managedClaudeIdentity.managedClaudeTerminalIdentity({ creationOptions: null }), undefined);
  assert.equal(managedClaudeIdentity.managedClaudeTerminalIdentity({ creationOptions: {} }), undefined);
  assert.equal(managedClaudeIdentity.managedClaudeTerminalIdentity({
    creationOptions: { env: null },
  }), undefined);
  assert.equal(managedClaudeIdentity.managedClaudeTerminalIdentity({
    creationOptions: { env: { KRONOS_MANAGED_CLAUDE: '0' } },
  }), undefined);
  assert.equal(managedClaudeIdentity.managedClaudeTerminalIdentity({
    creationOptions: { env: { KRONOS_MANAGED_CLAUDE: '1' } },
  }), undefined);
  assert.deepEqual(
    managedClaudeIdentity.normalizeManagedClaudeTerminalIdentity({
      ...identity,
      claudeSessionId: `  ${claudeSessionId.toUpperCase()}  `,
      editorSessionId: '  editor-before-reboot  ',
    }),
    identity,
  );
  assert.throws(
    () => managedClaudeIdentity.normalizeManagedClaudeTerminalIdentity(null),
    /must be an object/i,
  );
  for (const invalidClaudeSessionId of [null, 'not-a-uuid']) {
    assert.throws(
      () => managedClaudeIdentity.normalizeClaudeSessionId(invalidClaudeSessionId),
      /valid UUID/i,
    );
  }
  for (const invalidEditorSessionId of [null, '', 'x'.repeat(201), 'editor\nunsafe']) {
    assert.throws(
      () => managedClaudeIdentity.normalizeEditorSessionId(invalidEditorSessionId),
      /editor session id/i,
    );
  }
  for (const invalidIdentity of [
    { ...identity, workSessionId: null },
    { ...identity, workSessionId: 'bad/session' },
    { ...identity, terminalBindingId: 'bad binding' },
  ]) {
    assert.throws(
      () => managedClaudeIdentity.normalizeManagedClaudeTerminalIdentity(invalidIdentity),
      /must be a string|missing or invalid/i,
    );
  }

  const restoredActions = [];
  const restoredTerminal = {
    creationOptions: creations[0].terminalOptions,
    show(preserveFocus) { restoredActions.push(['show', preserveFocus]); },
    sendText(text, shouldExecute) { restoredActions.push(['sendText', text, shouldExecute]); },
  };
  const resumed = claudeTerminalLauncher.resumeClaudeTerminal(factory, {
    cwd: tempRoot,
    permissionMode: 'plan',
    claudeSessionId,
  }, { existingTerminal: restoredTerminal, identity });
  assert.equal(resumed.terminal, restoredTerminal);
  assert.deepEqual(restoredActions, [
    ['show', false],
    ['sendText', `claude --permission-mode plan --resume ${claudeSessionId}`, true],
  ]);
  assert.equal(creations.length, 1, 'reusing a revived terminal must not create another terminal');

  const legacy = claudeTerminalLauncher.resumeClaudeTerminal(factory, {
    cwd: tempRoot,
    selectSession: true,
  });
  assert.equal(legacy.configuration.command, 'claude --resume');
  assert.deepEqual(creations[1].actions, [
    ['show', false],
    ['sendText', 'claude --resume', true],
  ]);
  assert.deepEqual(
    claudeTerminalLauncher.normalizeClaudeTerminalResume({ claudeSessionId }),
    {
      command: `claude --resume ${claudeSessionId}`,
      name: 'Claude',
      permissionMode: 'default',
      selectSession: false,
      claudeSessionId,
    },
    'an exact resume without a saved folder remains valid and does not invent a cwd',
  );
  assert.deepEqual(
    claudeTerminalLauncher.normalizeClaudeTerminalResume({ cwd: '', selectSession: true }),
    {
      command: 'claude --resume',
      name: 'Claude',
      permissionMode: 'default',
      selectSession: true,
    },
  );

  let session = workSessions.createStandaloneWorkSession({ title: 'Durable resume fixture' }, options);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-resume',
    name: 'Claude resume fixture',
    cwd: tempRoot,
    claudeSessionId,
    editorSessionId: 'editor-before-reboot',
    claudePermissionMode: 'plan',
  }, options);
  assert.equal(workSessions.resumableWorkSessionTerminalBindings(session).length, 1);
  session = workSessions.attachWorkSessionTerminal(session.id, {
    bindingId: 'terminal-resume',
    name: 'Claude resume fixture',
  }, options);
  assert.equal(
    workSessions.resumableWorkSessionTerminalBindings(session)[0].claudeSessionId,
    claudeSessionId,
    'reattaching the same durable binding preserves its managed identity',
  );
  const presentation = sessionInventory.sessionInventoryPresentation(session, 0, 300_000);
  assert.equal(presentation.description, 'Resume available');
  assert.match(presentation.tooltip, /resume the exact Claude conversation/i);

  for (const invalid of [
    { claudeSessionId: 'not-a-uuid' },
    { editorSessionId: 'bad\neditor' },
    { claudePermissionMode: 'unsafe-mode' },
  ]) {
    assert.throws(
      () => workSessions.attachWorkSessionTerminal(session.id, {
        bindingId: 'terminal-invalid',
        name: 'Invalid managed identity',
        ...invalid,
      }, options),
      /Claude session id|editor session id|permission mode/i,
    );
  }
  assert.throws(
    () => claudeTerminalLauncher.normalizeClaudeTerminalResume({}),
    /requires an exact session id or the explicit session picker/i,
  );
  assert.throws(
    () => claudeTerminalLauncher.normalizeClaudeTerminalResume({
      claudeSessionId,
      selectSession: true,
    }),
    /either an exact session id or the explicit session picker/i,
  );
  assert.throws(
    () => claudeTerminalLauncher.normalizeClaudeTerminalResume({ selectSession: false }),
    /must be explicitly enabled/i,
  );
  assert.throws(
    () => claudeTerminalLauncher.launchClaudeTerminal(factory, {
      claudeSessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    }, { identity }),
    /does not match the managed terminal identity/i,
  );
  assert.throws(
    () => claudeTerminalLauncher.launchClaudeTerminal(factory, {}, { identity }),
    /does not match the managed terminal identity/i,
  );
  assert.throws(
    () => workSessions.attachWorkSessionTerminal(session.id, {
      bindingId: 'terminal-incomplete',
      name: 'Incomplete managed identity',
      claudeSessionId,
    }, options),
    /must include session id, editor session id, and permission mode together/i,
  );
});

test('Claude layout validation and terminal placement stay presentation-only', () => {
  assert.equal(claudeTerminalLauncher.normalizeClaudeTerminalLayout(undefined), 'editorSplit');
  assert.equal(claudeTerminalLauncher.normalizeClaudeTerminalLayout('editorTabs'), 'editorTabs');
  assert.equal(claudeTerminalLauncher.normalizeClaudeTerminalLayout('panel'), 'panel');
  assert.throws(
    () => claudeTerminalLauncher.normalizeClaudeTerminalLayout('floating'),
    /editorSplit, editorTabs, panel/,
  );
  assert.throws(
    () => claudeTerminalLauncher.normalizeClaudeTerminalLayout(null),
    /editorSplit, editorTabs, panel/,
  );
  const editor = { creationOptions: { name: 'Editor Claude', location: 2 } };
  const splitEditor = { creationOptions: { name: 'Split Claude', location: { parentTerminal: editor } } };
  const panel = { creationOptions: { name: 'Panel Claude', location: 1 } };
  const editorColumn = { creationOptions: { name: 'Column Claude', location: { viewColumn: 2 } } };
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement(editor), 'editor');
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement(splitEditor), 'editor');
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement(panel), 'panel');
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement(editorColumn), 'editor');
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement({ creationOptions: {} }), 'unknown');
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement({ creationOptions: { location: {} } }), 'unknown');
  const cyclic = { creationOptions: {} };
  cyclic.creationOptions.location = { parentTerminal: cyclic };
  assert.equal(claudeTerminalLauncher.claudeTerminalPlacement(cyclic), 'unknown');

  const exitedEditor = { creationOptions: { location: 2 }, exitStatus: { code: 0 } };
  editor.exitStatus = undefined;
  panel.exitStatus = undefined;
  assert.equal(
    claudeTerminalLauncher.hasLiveClaudeEditorTerminal(new Set([panel, exitedEditor])),
    false,
    'panel and closed terminals do not count as a live editor column',
  );
  assert.equal(
    claudeTerminalLauncher.hasLiveClaudeEditorTerminal(new Set([editor, panel, exitedEditor])),
    true,
    'a live Kronos-launched editor terminal enables a separate beside column',
  );
  assert.equal(
    claudeTerminalLauncher.hasLiveClaudeEditorTerminal(new Set()),
    false,
    'the first editor launch does not create an unnecessary beside group',
  );
});

test('a closed or rebound terminal invalidates captured context placement without guessing', () => {
  const firstCalls = [];
  const secondCalls = [];
  const first = { sendText(...args) { firstCalls.push(args); } };
  const second = { sendText(...args) { secondCalls.push(args); } };
  const placement = terminalContextInsertion.captureTerminalContextPlacement({
    terminal: first,
    sessionId: 'session-context',
    bindingId: 'binding-context',
  });
  const promptPath = path.join(tempRoot, 'JIRA-202', `prompt-${'a'.repeat(24)}.md`);
  const reference = terminalContextInsertion.buildJiraContextReference('JIRA-202', promptPath);

  assert.deepEqual(
    terminalContextInsertion.placeEditableTerminalContextReference(placement, undefined, reference, ''),
    { kind: 'target-changed' },
  );
  assert.deepEqual(
    terminalContextInsertion.placeEditableTerminalContextReference(placement, {
      terminal: second,
      sessionId: 'session-context',
      bindingId: 'binding-context',
    }, reference, ''),
    { kind: 'target-changed' },
  );
  assert.deepEqual(firstCalls, []);
  assert.deepEqual(secondCalls, []);

  const placed = terminalContextInsertion.placeEditableTerminalContextReference(placement, {
    terminal: first,
    sessionId: 'session-context',
    bindingId: 'binding-context',
  }, reference, 'Review the retained target.');
  assert.equal(placed.kind, 'placed');
  assert.deepEqual(firstCalls, [[placed.text, false]]);
  assert.deepEqual(secondCalls, []);
});

test('terminal context placement is reentrancy-safe and rejects ambiguous attachment identities', () => {
  const promptPath = path.join(tempRoot, 'JIRA-401', `prompt-${'d'.repeat(24)}.md`);
  const reference = terminalContextInsertion.buildJiraContextReference('JIRA-401', promptPath);
  let nestedResult;
  let placement;
  let current;
  const sends = [];
  const terminal = {
    sendText(text, shouldExecute) {
      sends.push([text, shouldExecute]);
      nestedResult = terminalContextInsertion.placeEditableTerminalContextReference(
        placement,
        current,
        reference,
        'A nested UI callback must not insert twice.',
      );
    },
  };
  placement = terminalContextInsertion.captureTerminalContextPlacement({
    terminal,
    sessionId: ' session-reentrant ',
    bindingId: ' binding-reentrant ',
  });
  current = {
    terminal,
    sessionId: 'session-reentrant',
    bindingId: 'binding-reentrant',
  };

  const result = terminalContextInsertion.placeEditableTerminalContextReference(
    placement,
    current,
    reference,
    "Review Bob's update.\nKeep the operator in control.",
  );
  assert.equal(result.kind, 'placed');
  assert.deepEqual(nestedResult, { kind: 'busy' });
  assert.deepEqual(sends, [[result.text, false]]);
  assert.equal(placement.phase, 'placed');
  assert.match(result.text, /Operator focus: 'Review Bob'\\''s update\. Keep the operator in control\.'/);

  for (const [field, value] of [
    ['sessionId', ''],
    ['sessionId', 'x'.repeat(201)],
    ['bindingId', 'binding\nchanged'],
  ]) {
    assert.throws(
      () => terminalContextInsertion.captureTerminalContextPlacement({
        terminal,
        sessionId: 'session-valid',
        bindingId: 'binding-valid',
        [field]: value,
      }),
      /placement .* id is missing or invalid/i,
    );
  }
  assert.equal(terminalContextInsertion.isTerminalContextPlacementCurrent(placement, {
    ...current,
    sessionId: 'session-other',
  }), false);
  assert.equal(terminalContextInsertion.isTerminalContextPlacementCurrent(placement, {
    ...current,
    bindingId: 'binding-other',
  }), false);
});

test('all terminal context reference classes enforce their own private artifact location', () => {
  const hash = 'e'.repeat(24);
  const cases = [
    terminalContextInsertion.buildGitLabMergeRequestContextReference(
      42,
      path.join(tempRoot, 'MR-42', `prompt-${hash}.md`),
    ),
    terminalContextInsertion.buildCiContextReference(
      'OPS-42',
      path.join(tempRoot, 'OPS-42', `prompt-${hash}.md`),
    ),
    terminalContextInsertion.buildProjectGitContextReference(
      'GIT-Kronos.main',
      path.join(tempRoot, 'GIT-Kronos.main', `prompt-${hash}.md`),
    ),
    terminalContextInsertion.buildAttentionEventContextReference(
      `ATTENTION-SONAR-${'C'.repeat(24)}`,
      path.join(tempRoot, `ATTENTION-SONAR-${'C'.repeat(24)}`, `prompt-${hash}.md`),
    ),
    terminalContextInsertion.buildContextBasketTerminalReference(
      `BASKET-${'A'.repeat(24)}`,
      path.join(tempRoot, 'basket-context', `prompt-${hash}.md`),
    ),
    terminalContextInsertion.buildPromptLibraryTerminalReference(
      `PROMPT-${'B'.repeat(24)}`,
      path.join(tempRoot, `PROMPT-${'B'.repeat(24)}`, `prompt-${hash}.md`),
    ),
  ];
  for (const reference of cases) {
    assert.doesNotThrow(() => terminalContextInsertion.assertSafeTerminalContextReference(reference), reference);
    assert.throws(
      () => terminalContextInsertion.assertSafeTerminalContextReference(
        reference.replace(`${path.sep}prompt-`, `${path.sep}outside${path.sep}prompt-`),
      ),
      undefined,
      'moving an artifact out of its expected owner directory must invalidate the reference',
    );
  }

  for (const reference of [
    '',
    ' [OPS-42] Read Jira context file "/tmp/OPS-42/prompt.md" before answering.',
    '[OPS-42] Read Jira context file not-json before answering.',
    '[OPS-42] Read Jira context file "relative/prompt.md" before answering.',
    '[OPS-42] Read Jira context file "/tmp/OPS-42/context.txt" before answering.',
    '[OPS-42] Read Jira context file "/tmp/OPS-42/prompt.md" before answering.\nnext',
  ]) {
    assert.throws(() => terminalContextInsertion.assertSafeTerminalContextReference(reference), undefined, reference);
  }
  assert.throws(
    () => terminalContextInsertion.buildGitLabMergeRequestContextReference(0, path.join(tempRoot, 'MR-0', 'prompt.md')),
    /IID is missing or invalid/i,
  );
  assert.throws(
    () => terminalContextInsertion.buildProjectGitContextReference('not-a-git-context', path.join(tempRoot, 'prompt.md')),
    /Git context id is missing or invalid/i,
  );
  assert.throws(
    () => terminalContextInsertion.buildAttentionEventContextReference('ATTENTION-GITHUB-bad', path.join(tempRoot, 'prompt.md')),
    /Attention event context id is missing or invalid/i,
  );
  assert.throws(
    () => terminalContextInsertion.buildContextBasketTerminalReference('BASKET-bad', path.join(tempRoot, 'prompt.md')),
    /Context basket id is missing or invalid/i,
  );
  assert.throws(
    () => terminalContextInsertion.buildPromptLibraryTerminalReference('PROMPT-bad', path.join(tempRoot, 'prompt.md')),
    /Prompt library context id is missing or invalid/i,
  );
  assert.equal(terminalContextInsertion.buildEditableTerminalContextReference(cases[0], undefined), cases[0]);
  assert.equal(terminalContextInsertion.buildEditableTerminalContextReference(cases[0], null), cases[0]);
  assert.throws(
    () => terminalContextInsertion.buildEditableTerminalContextReference(cases[0], { focus: 'not text' }),
    /focus must be text/i,
  );
  assert.throws(
    () => terminalContextInsertion.buildEditableTerminalContextReference(cases[0], 'x'.repeat(2001)),
    /2000 characters or fewer/i,
  );
});

test('Claude launch validation covers labels, filesystem failures, and PATH probe failures before creation', () => {
  assert.deepEqual(
    claudeTerminalLauncher.CLAUDE_PERMISSION_MODES.map(mode => claudeTerminalLauncher.claudePermissionModeLabel(mode)),
    [
      'Manual (default)',
      'Accept Edits',
      'Plan',
      'Auto',
      "Don't Ask",
      'Bypass Permissions (experimental)',
    ],
  );
  assert.deepEqual(claudeTerminalLauncher.normalizeClaudeTerminalLaunch({ cwd: null }), {
    command: 'claude',
    name: 'Claude',
    permissionMode: 'default',
  });
  assert.equal(
    claudeTerminalLauncher.normalizeClaudeTerminalLaunch({
      command: 'claude-team.cmd --model=claude-opus-4-1 --effort=xhigh --ide',
      name: '  Team   Claude  ',
    }).command,
    'claude-team.cmd --model=claude-opus-4-1 --effort=xhigh --ide',
  );

  for (const [command, pattern] of [
    ['', /non-empty string/i],
    [`claude${'x'.repeat(513)}`, /no longer than 512/i],
    ['claude\n--ide', /single line/i],
    ['./claude', /unsupported shell syntax/i],
    ['-claude', /unsupported shell syntax/i],
    ['node', /must resolve to claude/i],
    ['claude --model value$', /unsupported shell syntax/i],
    ['claude --resume', /approved interactive flags/i],
    ['claude --ide=true', /does not accept a value/i],
    ['claude --model', /requires an approved value/i],
    ['claude --model --ide', /requires an approved value/i],
    ['claude --model bad/value', /model must be a shell-inert alias/i],
    ['claude --effort turbo', /effort must be/i],
  ]) {
    assert.throws(() => claudeTerminalLauncher.normalizeClaudeTerminalLaunch({ command }), pattern);
  }
  for (const permissionMode of [null, 'unsafe-mode']) {
    assert.throws(
      () => claudeTerminalLauncher.normalizeClaudeTerminalLaunch({ permissionMode }),
      /permission mode must be one of/i,
    );
  }
  for (const name of [null, '', 'x'.repeat(81), 'Claude\nunsafe']) {
    assert.throws(
      () => claudeTerminalLauncher.normalizeClaudeTerminalLaunch({ name }),
      /terminal name must be/i,
    );
  }

  const fileCwd = path.join(tempRoot, 'not-a-directory.txt');
  fs.writeFileSync(fileCwd, 'fixture\n');
  for (const cwd of [42, 'relative/path', path.join(tempRoot, 'missing-directory'), fileCwd, `${tempRoot}\nunsafe`]) {
    assert.throws(
      () => claudeTerminalLauncher.normalizeClaudeTerminalLaunch({ cwd }),
      /working directory/i,
    );
  }

  assert.deepEqual(claudeTerminalLauncher.probeClaudeExecutableAvailability('claude', {}), {
    executable: 'claude',
    available: false,
  });
  const probeDirectory = path.join(tempRoot, 'probe-failures');
  fs.mkdirSync(path.join(probeDirectory, 'claude-directory'), { recursive: true });
  fs.writeFileSync(path.join(probeDirectory, 'claude-no-execute'), '#!/bin/sh\n', { mode: 0o600 });
  assert.deepEqual(
    claudeTerminalLauncher.probeClaudeExecutableAvailability('claude-directory', { Path: `"${probeDirectory}"` }),
    { executable: 'claude-directory', available: false },
  );
  assert.deepEqual(
    claudeTerminalLauncher.probeClaudeExecutableAvailability('claude-no-execute', { path: probeDirectory }),
    { executable: 'claude-no-execute', available: process.platform === 'win32' },
  );
});
