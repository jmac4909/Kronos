const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-terminal-lifecycle-'));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

const claudeTerminalLauncher = require('../out/services/claudeTerminalLauncher.js');
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
  );
  assert.equal(presentation.label, 'Application: Interactive investigation');
  assert.equal(
    presentation.description,
    'Application @ feature/session-inventory • no Jira context • 1 terminal attached',
  );

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
    'Application @ feature/session-inventory • 2 Jira contexts • 1 terminal attached • poll partial',
  );
  assert.match(presentation.tooltip, /Ticket contexts: JIRA-301, JIRA-302/);
  assert.match(presentation.tooltip, /Monitoring lifecycle: running/);
  assert.match(presentation.tooltip, /Monitoring result: GitLab succeeded; Jenkins needs operator review\./);
  assert.match(presentation.tooltip, /Primary action: Open Terminal\./);
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
    /1 terminal attached • poll paused$/,
  );

  session = workSessions.detachWorkSessionTerminal(
    session.id,
    'terminal-lifecycle-presentation',
    'operator detached',
    options,
  );
  assert.match(
    sessionInventory.sessionInventoryPresentation(session, 0, 300_000, 'main').description,
    /terminal detached • poll paused$/,
  );
  session = workSessions.markWorkSessionTerminalClosed(
    session.id,
    'terminal-lifecycle-presentation',
    'terminal closed',
    options,
  );
  session = workSessions.setWorkSessionProject(session.id, {}, options);
  session = workSessions.closeWorkSession(session.id, options);
  const stopped = sessionInventory.sessionInventoryPresentation(session, 0, 300_000);
  assert.equal(stopped.label, 'JIRA-303: Lifecycle presentation');
  assert.equal(stopped.description, '1 Jira context • terminal closed • management stopped');

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
    reconnect: 'Kronos: Reconnect Focused Terminal to Session',
    detach: 'Kronos: Detach Terminal',
    pause: 'Kronos: Pause Work Session Monitoring',
    resume: 'Kronos: Resume Work Session Monitoring',
    poll: 'Kronos: Poll Managed Providers',
    audit: 'Kronos: Open Work Session Audit',
    stop: 'Kronos: Stop Managing Work Session',
    remove: 'Kronos: Remove Session from Kronos',
  });
  assert.equal(new Set(Object.values(titles).filter(title => title.includes('Session') || title.includes('Monitoring'))).size > 1, true);
  const viewSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'ManagedSessionTreeProvider.ts'), 'utf8');
  assert.match(viewSource, /this\.command = \{ command: 'kronos\.focusWorkSessionTerminal', title: 'Open Session Terminal'/);
  const runtimeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'terminalFirstExtension.ts'), 'utf8');
  assert.match(runtimeSource, /local session record and monitoring snapshots will be deleted/);
  assert.match(runtimeSource, /terminal.*remain open and untouched/);
  assert.match(runtimeSource, /Shared audit history and saved context files are retained locally/);
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
