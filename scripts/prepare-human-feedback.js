const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const VSIX = path.join(ROOT, 'kronos-0.1.0.vsix');
const IS_WINDOWS = process.platform === 'win32';

function fail(message) {
  console.error(`\nFeedback readiness failed: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  const label = [command, ...args].join(' ');
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: shouldUseWindowsShell(command),
    stdio: options.capture ? 'pipe' : 'inherit',
  });

  if (result.error) {
    fail(`${label}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (options.capture) {
      process.stdout.write(result.stdout || '');
      process.stderr.write(result.stderr || '');
    }
    fail(`${label} exited with ${result.status}`);
  }
  return result.stdout || '';
}

function commandExists(command) {
  const result = IS_WINDOWS
    ? spawnSync('where.exe', [command], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })
    : spawnSync('sh', ['-lc', `command -v ${command}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      });
  if (result.error) { return ''; }
  return result.status === 0 ? firstOutputLine(result.stdout) : '';
}

function shouldUseWindowsShell(command) {
  return IS_WINDOWS && (command === 'npm' || command === 'npx');
}

function firstOutputLine(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean) || '';
}

function requireFile(file, includes = []) {
  const absolute = path.join(ROOT, file);
  if (!fs.existsSync(absolute)) {
    fail(`${file} is missing`);
  }
  const text = fs.readFileSync(absolute, 'utf8');
  for (const marker of includes) {
    if (!text.includes(marker)) {
      fail(`${file} is missing marker: ${marker}`);
    }
  }
  return text;
}

function assertTreeIncludes(tree, marker) {
  if (!tree.includes(marker)) {
    fail(`VSIX file list is missing ${marker}`);
  }
}

function assertTreeExcludes(tree, marker) {
  if (tree.includes(marker)) {
    fail(`VSIX file list unexpectedly includes ${marker}`);
  }
}

console.log('Preparing Kronos human-feedback build.');

const manifest = JSON.parse(requireFile('package.json'));
const commandCount = manifest.contributes?.commands?.length || 0;
if (commandCount < 80) {
  fail(`expected the contributed command surface to be populated, found ${commandCount}`);
}

requireFile('README.md', [
  'Current Readiness',
  'Main Surfaces To Review',
  'HUMAN_FEEDBACK_CHECKLIST.md',
]);
requireFile('HUMAN_FEEDBACK_CHECKLIST.md', [
  'Smoke Flow',
  'Feedback Questions',
  'Stop Conditions',
  'Signoff Bar',
]);
requireFile('WINDOWS_FEEDBACK_2026-07-02.md', [
  'VS Code 1.127.0',
  'gcloud.cmd',
  'Run records can remain `running`',
  'Webview buttons are dead',
  'latest CDP smoke',
  'ready=true',
]);
requireFile('LICENSE', ['All rights reserved']);
requireFile('.vscode/launch.json', ['Run Kronos Extension']);

run('npm', ['test']);
run('npm', ['run', 'package']);

if (!fs.existsSync(VSIX)) {
  fail('kronos-0.1.0.vsix was not created');
}
const stat = fs.statSync(VSIX);
if (stat.size < 200 * 1024) {
  fail(`kronos-0.1.0.vsix is unexpectedly small (${stat.size} bytes)`);
}

const tree = run('npx', ['--yes', '@vscode/vsce', 'ls', '--tree', '--no-dependencies'], { capture: true });
for (const marker of [
  'HUMAN_FEEDBACK_CHECKLIST.md',
  'LICENSE',
  'package.json',
  'README.md',
  'media/',
  'out/',
  'extension.js',
  'services/',
]) {
  assertTreeIncludes(tree, marker);
}
for (const marker of [
  'src/',
  'scripts/',
  'node_modules/',
  '.git/',
  '.claude/',
  'GOOD_TO_GREAT_REVIEW.md',
  'WINDOWS_FEEDBACK_2026-07-02.md',
  'push-master.sh',
  'cache-github-token.sh',
]) {
  assertTreeExcludes(tree, marker);
}

const codePath = commandExists('code');
const codiumPath = commandExists('codium');

console.log('\nHuman feedback readiness: PASS');
console.log(`- Commands contributed: ${commandCount}`);
console.log(`- VSIX: ${VSIX} (${Math.round(stat.size / 1024)} KB)`);
console.log(`- README/checklist/license/dev-host config: present`);
if (codePath || codiumPath) {
  console.log(`- VS Code CLI available: ${codePath || codiumPath}`);
} else {
  console.log('- VS Code CLI not found on this host; install/test the VSIX on a machine with VS Code.');
}
console.log('- Windows VS Code 1.127 webview smoke evidence is recorded in WINDOWS_FEEDBACK_2026-07-02.md.');
console.log('- Remaining manual gate: run HUMAN_FEEDBACK_CHECKLIST.md with a human operator and capture UX feedback.');
