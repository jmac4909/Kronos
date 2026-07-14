const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.kronos', 'feedback-state');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) { throw result.error; }
  if (result.status !== 0) { throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`); }
}

run(process.execPath, ['scripts/create-feedback-state.js', '--force']);
run('npm', ['test']);

const work = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'work.json'), 'utf8'));
assert.equal(work.schemaVersion, 1);
assert.deepEqual(Object.keys(work.tickets).sort(), ['JIRA-123', 'JIRA-456', 'JIRA-789']);
assert.equal(fs.existsSync(path.join(fixtureDir, 'queue.json')), false);
assert.equal(fs.existsSync(path.join(fixtureDir, 'runs')), false);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(packageJson.contributes.views.kronos.map(view => view.id), [
  'kronosWork',
  'kronosSessions',
  'kronosAttention',
]);
assert.equal(packageJson.contributes.commands.length, 35);
assert.equal(Object.keys(packageJson.contributes.configuration.properties).length, 10);
assert.equal(work.tickets['JIRA-123'].launch_project, 'fixture-service');
assert.equal(
  fs.readFileSync(path.join(fixtureDir, 'fixture-repo', '.git', 'HEAD'), 'utf8').trim(),
  'ref: refs/heads/feature/kronos-feedback',
);
const workSessionStore = require('../out/services/workSessionStore.js');
const monitorEventStore = require('../out/services/monitorEventStore.js');
assert.deepEqual(workSessionStore.listWorkSessionStoreIssues({ kronosDir: fixtureDir }), []);
const sessions = workSessionStore.listWorkSessions({ kronosDir: fixtureDir });
assert.deepEqual(sessions.map(session => session.kind).sort(), ['standalone', 'ticket']);
assert.ok(sessions.every(session => session.terminals.length === 0));
const ticketSession = sessions.find(session => session.kind === 'ticket');
assert.equal(ticketSession.ticketKey, 'JIRA-456');
assert.equal(ticketSession.monitoring.enabled, false);
assert.equal(ticketSession.providerBindings.filter(binding => binding.provider === 'jenkins').length, 2);
assert.equal(ticketSession.providerBindings.filter(binding => binding.provider === 'sonar').length, 2);
const monitorEvents = monitorEventStore.listMonitorEvents({ limit: 100 }, { kronosDir: fixtureDir });
assert.equal(monitorEvents.length, 6);
assert.equal(monitorEvents.filter(event => event.metadata?.transitionKind === 'provider_read_failed').length, 2);
assert.ok(monitorEvents.some(event => event.metadata?.transitionKind === 'initial_mr_observed'));
if (process.platform !== 'win32') {
  assert.equal(fs.statSync(path.join(fixtureDir, 'monitor-events.jsonl')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(fixtureDir, 'work-sessions')).mode & 0o777, 0o700);
}

console.log('Kronos terminal-first feedback smoke: PASS');
console.log(`Fixture: ${fixtureDir}`);
console.log('Synthetic detached Sessions and Attention evidence validated.');
console.log('No provider endpoint, project command, terminal process, or live Git repository was touched.');
