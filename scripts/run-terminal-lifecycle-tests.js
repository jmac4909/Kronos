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
const workSessions = require('../out/services/workSessionStore.js');

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

test('session removal deletes only colocated state and registry detachment never controls the terminal', () => {
  const options = { kronosDir: path.join(tempRoot, 'removal-isolation') };
  const session = workSessions.createStandaloneWorkSession({ title: 'Disposable session' }, options);
  const sessionDirectory = workSessions.workSessionDirectory(session.id, options);
  fs.writeFileSync(path.join(sessionDirectory, 'monitor-snapshot.json'), '{}\n', { mode: 0o600 });
  const retainedArtifact = path.join(options.kronosDir, 'contexts', 'retained.md');
  fs.mkdirSync(path.dirname(retainedArtifact), { recursive: true });
  fs.writeFileSync(retainedArtifact, 'retained\n');

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
