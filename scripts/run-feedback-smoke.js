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
assert.equal(packageJson.contributes.commands.length, 24);

console.log('Kronos terminal-first feedback smoke: PASS');
console.log(`Fixture: ${fixtureDir}`);
console.log('No provider endpoint, project command, terminal process, or Git repository was touched.');
