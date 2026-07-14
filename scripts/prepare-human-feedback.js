const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function fail(message) {
  console.error(`Human-feedback readiness failed: ${message}`);
  process.exit(1);
}

function run(command, args, capture = false) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    shell: process.platform === 'win32' && (command === 'npm' || command === 'npx'),
  });
  if (result.error) { fail(result.error.message); }
  if (result.status !== 0) {
    if (capture) { process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || ''); }
    fail(`${command} exited with ${result.status}`);
  }
  return result.stdout || '';
}

function requireMarkers(file, markers) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) { fail(`${file} is missing`); }
  const source = fs.readFileSync(filePath, 'utf8');
  for (const marker of markers) {
    if (!source.includes(marker)) { fail(`${file} is missing: ${marker}`); }
  }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (Object.keys(manifest.dependencies || {}).length !== 0) { fail('runtime dependencies must remain empty'); }
const allowedDevDependencies = new Set(['@types/node', '@types/vscode', 'typescript']);
for (const name of Object.keys(manifest.devDependencies || {})) {
  if (!allowedDevDependencies.has(name)) { fail(`unexpected development dependency: ${name}`); }
}
if (manifest.contributes.commands.length !== 36) { fail('expected exactly 36 terminal-first commands'); }
if (manifest.contributes.views.kronos.length !== 4) { fail('expected exactly Work, Sessions, Projects, and Attention'); }
if (Object.keys(manifest.contributes.configuration.properties || {}).length !== 10) { fail('expected exactly ten mapped terminal-first settings'); }

requireMarkers('README.md', ['zero third-party runtime dependencies', 'Work', 'Sessions', 'Projects', 'Attention']);
requireMarkers('docs/terminal-first-product-contract.md', ['Ownership Invariants', 'Context Insertion Contract', 'Monitoring Contract']);
requireMarkers('HUMAN_FEEDBACK_CHECKLIST.md', ['Non-Negotiable Boundary', 'Stop Conditions', 'Signoff Bar']);

for (const removed of [
  'src/runners/sessionDispatcher.ts',
  'src/views/QueueTreeProvider.ts',
  'src/services/queuePlanner.ts',
  'resources/spec-beanstalk/xlsx_to_markdown.py',
]) {
  if (fs.existsSync(path.join(root, removed))) { fail(`legacy file still exists: ${removed}`); }
}

run(process.execPath, ['scripts/create-feedback-state.js', '--force']);
run('npm', ['test']);
run('npm', ['run', 'package']);

const vsixName = `${manifest.name}-${manifest.version}.vsix`;
const vsixPath = path.join(root, vsixName);
if (!fs.existsSync(vsixPath) || fs.statSync(vsixPath).size < 10 * 1024) {
  fail(`${vsixName} is missing or unexpectedly small`);
}

// Use the flat file list for exact package assertions. The visual tree output
// prints child names without their parent prefix, which makes path checks
// dependent on presentation rather than actual VSIX contents.
const tree = run('npx', ['--yes', '@vscode/vsce@3.9.2', 'ls', '--no-dependencies'], true);
for (const expected of [
  'out/extension.js',
  'out/terminalFirstExtension.js',
  'out/views/WorkTreeProvider.js',
  'out/views/ManagedSessionTreeProvider.js',
  'out/views/ProjectTreeProvider.js',
  'out/views/AttentionTreeProvider.js',
  'out/services/claudeTerminalLauncher.js',
  'out/services/projectCatalog.js',
  'out/services/projectDiscovery.js',
  'out/services/projectGitContextStore.js',
  'out/services/vscodeGitReadService.js',
  'out/services/jiraWorkBoardView.js',
  'media/kronos-action-panel.js',
  'media/kronos-jira-work-board.js',
  'media/kronos-webview-runtime.js',
  'docs/terminal-first-product-contract.md',
  'HUMAN_FEEDBACK_CHECKLIST.md',
]) {
  if (!tree.includes(expected)) { fail(`VSIX tree is missing ${expected}`); }
}
for (const forbidden of [
  'src/',
  'scripts/',
  'test/',
  'node_modules/',
  '.kronos/',
  'sessionDispatcher',
  'QueueTreeProvider',
  'spec-beanstalk',
]) {
  if (tree.includes(forbidden)) { fail(`VSIX tree contains forbidden legacy/development content: ${forbidden}`); }
}

console.log('Kronos terminal-first human-feedback readiness: PASS');
console.log(`VSIX: ${vsixPath} (${Math.round(fs.statSync(vsixPath).size / 1024)} KiB)`);
console.log('Automated gates passed. The remaining gate is the operator-owned terminal review in HUMAN_FEEDBACK_CHECKLIST.md.');
