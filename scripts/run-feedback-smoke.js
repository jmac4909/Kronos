const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const fixtureDir = path.join(root, '.kronos', 'feedback-state');

function run(command, args) {
  const useWindowsCmd = process.platform === 'win32' && command === 'npm';
  const executable = useWindowsCmd ? (process.env.ComSpec || 'cmd.exe') : command;
  const executionArgs = useWindowsCmd
    ? ['/d', '/s', '/c', ['npm.cmd', ...args].join(' ')]
    : args;
  const result = spawnSync(executable, executionArgs, { cwd: root, encoding: 'utf8', stdio: 'inherit' });
  if (result.error) { throw result.error; }
  if (result.status !== 0) { throw new Error(`${command} ${args.join(' ')} exited with ${result.status}`); }
}

run(process.execPath, ['scripts/create-feedback-state.js', '--force']);
run('npm', ['test']);

const work = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'work.json'), 'utf8'));
assert.equal(work.schemaVersion, 2);
assert.deepEqual(Object.keys(work.tickets).sort(), ['JIRA-123', 'JIRA-456', 'JIRA-789']);
assert.equal(fs.existsSync(path.join(fixtureDir, 'queue.json')), false);
assert.equal(fs.existsSync(path.join(fixtureDir, 'runs')), false);

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.deepEqual(packageJson.contributes.views.kronos.map(view => view.id), [
  'kronosWork',
  'kronosSessions',
  'kronosProjects',
  'kronosAttention',
]);
assert.equal(packageJson.contributes.commands.length, 45);
assert.equal(Object.keys(packageJson.contributes.configuration.properties).length, 14);
assert.equal(work.tickets['JIRA-123'].linked_local_project, 'fixture-service');
assert.equal(
  fs.readFileSync(path.join(fixtureDir, 'fixture-repo', '.git', 'HEAD'), 'utf8').trim(),
  'ref: refs/heads/feature/kronos-feedback',
);
const workSessionStore = require('../out/services/workSessionStore.js');
const projectMonitoringStore = require('../out/services/projectMonitoringStore.js');
const mergeRequestMonitorStore = require('../out/services/gitlabMergeRequestMonitorStore.js');
const pipelineMonitorStore = require('../out/services/gitlabPipelineMonitorStore.js');
const ciMonitorStore = require('../out/services/ciMonitorStore.js');
const activeAttentionMonitor = require('../out/services/activeAttentionMonitor.js');
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
const projectMonitor = projectMonitoringStore.readProjectMonitoringRecord('fixture-service', { kronosDir: fixtureDir });
assert.ok(projectMonitor);
const activeProject = activeAttentionMonitor.activeAttentionProject({
  projectName: 'fixture-service',
  projectPath: work.projects['fixture-service'].path,
  owner: projectMonitor,
  events: [],
  mergeRequest: mergeRequestMonitorStore.readGitLabMergeRequestMonitorSnapshot(projectMonitor.id, { kronosDir: fixtureDir }),
  pipeline: pipelineMonitorStore.readGitLabPipelineMonitorSnapshot(projectMonitor.id, { kronosDir: fixtureDir }),
  ci: ciMonitorStore.readCiMonitorSnapshot(projectMonitor.id, { kronosDir: fixtureDir }),
});
assert.equal(activeProject.state, 'needs-fixes');
assert.deepEqual(activeProject.rows.map(row => row.event.source).sort(), ['gitlab', 'gitlab', 'jenkins', 'sonar']);
assert.equal(activeProject.rows.every(row => row.event.metadata.liveSnapshot === true), true);
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
console.log('Synthetic detached Sessions and current project-owned Attention snapshots validated.');
console.log('No provider endpoint, project command, terminal process, or live Git repository was touched.');
