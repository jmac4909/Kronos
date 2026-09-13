'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const VSCE_VERSION = '3.9.2';
const ROOT_FILES = [
  'package.json',
  'SUPPORT.md',
  'SECURITY.md',
  'README.md',
  'LICENSE',
  'HUMAN_FEEDBACK_CHECKLIST.md',
  'CHANGELOG.md',
];
const DOCUMENTATION_FILES = [
  'docs/verification-matrix.json',
  'docs/terminal-first-product-contract.md',
  'docs/terminal-first-completion-audit.md',
  'docs/state-ownership.md',
  'docs/scale-accessibility-budget.md',
  'docs/provider-contract-matrix.md',
  'docs/extension-improvement-goals.md',
  'docs/assets/kronos-work-board.png',
  'docs/assets/kronos-context-composer.png',
];
const MEDIA_FILES = [
  'media/kronos-webview-runtime.js',
  'media/kronos-project-integration.js',
  'media/kronos-marketplace-icon.png',
  'media/kronos-jira-work-board.js',
  'media/kronos-icon.svg',
  'media/kronos-context-composer.js',
  'media/kronos-context-basket.js',
  'media/kronos-prompt-library.js',
  'media/kronos-action-panel.js',
];
const REQUIRED_IGNORE_MARKERS = [
  '.git/**',
  'src/**',
  'scripts/**',
  'test-fixtures/**',
  'node_modules/**',
  '.vscode-test/**',
  '.claude/**',
  '.kronos/**',
  '*.vsix',
  '*.log',
  '.env*',
  'out/**/*.map',
  'docs/assets/*.svg',
  'package-lock.json',
];
const FORBIDDEN_PACKAGE_PATHS = [
  /(^|\/)\.(?:claude|kronos|git|vscode-test)(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)src(\/|$)/,
  /(^|\/)scripts(\/|$)/,
  /(^|\/)test(?:-fixtures)?(\/|$)/,
  /(^|\/)\.env(?:\.|$)/,
  /\.(?:vsix|zip|tgz|log|map)$/i,
  /(^|\/)docs\/assets\/.*\.svg$/i,
];

function collectVsceReleaseFiles(workspaceRoot = root) {
  const invocation = vsceListInvocation();
  const output = execFileSync(invocation.command, invocation.args, {
    cwd: workspaceRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  return output.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
}

function vsceListInvocation(platform = process.platform, commandInterpreter = process.env.ComSpec) {
  const args = [
    '--yes',
    `@vscode/vsce@${VSCE_VERSION}`,
    'ls',
    '--no-dependencies',
  ];
  if (platform !== 'win32') { return { command: 'npx', args }; }
  return {
    command: commandInterpreter || 'cmd.exe',
    args: ['/d', '/s', '/c', ['npx.cmd', ...args].join(' ')],
  };
}

function expectedReleaseFiles(workspaceRoot = root) {
  const runtime = listFiles(path.join(workspaceRoot, 'src'), '.ts')
    .map(file => path.relative(path.join(workspaceRoot, 'src'), file).replace(/\\/g, '/').replace(/\.ts$/, '.js'))
    .map(file => `out/${file}`);
  return [...ROOT_FILES, ...DOCUMENTATION_FILES, ...MEDIA_FILES, ...runtime].sort();
}

function releaseSurfaceFailures(files, options = {}) {
  const workspaceRoot = options.root || root;
  const manifest = options.manifest || readJson(path.join(workspaceRoot, 'package.json'));
  const normalized = files.map(value => String(value).replace(/\\/g, '/').replace(/^\.\//, ''));
  const failures = [];
  const actual = new Set();
  for (const file of normalized) {
    if (!file || path.posix.isAbsolute(file) || file.split('/').includes('..')) {
      failures.push(`unsafe package path: ${file || '<empty>'}`);
      continue;
    }
    if (actual.has(file)) { failures.push(`duplicate package path: ${file}`); }
    actual.add(file);
    if (FORBIDDEN_PACKAGE_PATHS.some(pattern => pattern.test(file))) {
      failures.push(`forbidden package path: ${file}`);
    }
  }
  const expected = new Set(expectedReleaseFiles(workspaceRoot));
  for (const file of expected) {
    if (!actual.has(file)) { failures.push(`missing intended package file: ${file}`); }
  }
  for (const file of actual) {
    if (!expected.has(file)) { failures.push(`unexpected package file: ${file}`); }
  }
  if (Object.keys(manifest.dependencies || {}).length !== 0) {
    failures.push('runtime dependencies must remain empty');
  }
  if (manifest.main !== './out/extension.js') { failures.push('package main must be ./out/extension.js'); }
  if (manifest.license !== 'SEE LICENSE IN LICENSE') { failures.push('package license metadata must point to LICENSE'); }
  if (manifest.icon !== 'media/kronos-marketplace-icon.png') { failures.push('package icon must use the audited Marketplace asset'); }
  const ignore = fs.readFileSync(path.join(workspaceRoot, '.vscodeignore'), 'utf8');
  if (ignore.split(/\r?\n/).some(line => line.trim().startsWith('!'))) {
    failures.push('.vscodeignore must not contain negated rules that can re-include a sensitive path');
  }
  for (const marker of REQUIRED_IGNORE_MARKERS) {
    if (!ignore.split(/\r?\n/).map(line => line.trim()).includes(marker)) {
      failures.push(`.vscodeignore is missing required exclusion: ${marker}`);
    }
  }
  return failures;
}

function releaseDocumentationFailures(workspaceRoot = root) {
  const failures = [];
  const manifest = readJson(path.join(workspaceRoot, 'package.json'));
  const readme = readText(workspaceRoot, 'README.md');
  const contract = readText(workspaceRoot, 'docs/terminal-first-product-contract.md');
  const audit = readText(workspaceRoot, 'docs/terminal-first-completion-audit.md');
  const changelog = readText(workspaceRoot, 'CHANGELOG.md');
  const checklist = readText(workspaceRoot, 'HUMAN_FEEDBACK_CHECKLIST.md');
  const matrix = readJson(path.join(workspaceRoot, 'docs/verification-matrix.json'));
  for (const link of [
    'docs/terminal-first-product-contract.md',
    'docs/terminal-first-completion-audit.md',
    'docs/verification-matrix.json',
    'docs/state-ownership.md',
    'docs/provider-contract-matrix.md',
    'docs/scale-accessibility-budget.md',
    'HUMAN_FEEDBACK_CHECKLIST.md',
    'CHANGELOG.md',
    'SECURITY.md',
    'SUPPORT.md',
  ]) {
    if (!readme.includes(`](${link})`)) { failures.push(`README is missing current evidence link: ${link}`); }
  }
  for (const image of ['docs/assets/kronos-work-board.png', 'docs/assets/kronos-context-composer.png']) {
    if (!readme.includes(`](${image})`)) { failures.push(`README is missing packaged screenshot: ${image}`); }
  }
  for (const link of ['state-ownership.md', 'provider-contract-matrix.md', 'scale-accessibility-budget.md']) {
    if (!contract.includes(`](${link})`)) { failures.push(`product contract is missing evidence link: ${link}`); }
  }
  for (const marker of ['docs/verification-matrix.json', 'HUMAN_FEEDBACK_CHECKLIST.md', '## Operator-Only Signoff Still Required']) {
    if (!audit.includes(marker)) { failures.push(`completion audit is missing current evidence marker: ${marker}`); }
  }
  if (!changelog.includes('## [Unreleased]')) { failures.push('CHANGELOG must retain an Unreleased section'); }
  for (const gate of matrix.humanGates || []) {
    if (typeof gate?.id !== 'string' || typeof gate?.checklistMarker !== 'string'
      || !checklist.includes(gate.checklistMarker)) {
      failures.push(`human checklist is missing gate marker: ${gate?.id || '<unknown>'}`);
    }
  }
  const repositoryUrl = typeof manifest.repository === 'object' ? manifest.repository?.url : manifest.repository;
  if (typeof repositoryUrl !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repositoryUrl)) {
    failures.push('package repository metadata must be one public HTTPS GitHub repository URL');
  }
  return failures;
}

function assertReleaseSurface(files, options = {}) {
  const failures = releaseSurfaceFailures(files, options);
  if (failures.length > 0) {
    throw new Error(`Kronos release surface failed:\n- ${failures.join('\n- ')}`);
  }
}

function listFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) { return listFiles(file, extension); }
    return entry.isFile() && entry.name.endsWith(extension) ? [file] : [];
  }).sort();
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readText(workspaceRoot, file) { return fs.readFileSync(path.join(workspaceRoot, file), 'utf8'); }

if (require.main === module) {
  try {
    const files = collectVsceReleaseFiles(root);
    assertReleaseSurface(files, { root });
    const documentationFailures = releaseDocumentationFailures(root);
    if (documentationFailures.length > 0) {
      throw new Error(`Kronos release documentation failed:\n- ${documentationFailures.join('\n- ')}`);
    }
    console.log(`Kronos VSIX release surface OK (${files.length} exact files; zero runtime dependencies; current evidence documents included).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  collectVsceReleaseFiles,
  expectedReleaseFiles,
  releaseDocumentationFailures,
  releaseSurfaceFailures,
  assertReleaseSurface,
  vsceListInvocation,
};
