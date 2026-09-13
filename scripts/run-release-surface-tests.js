const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const release = require('./release-surface.js');
const { normalizeRepositoryText } = require('./repository-text.js');
const { runtimeImportPolicyFailure } = require('./runtime-import-policy.js');
const { publishedStateFailures } = require('./verify-published-branch.js');

test('actual VSIX release surface is exact and runtime-dependency-free', () => {
  assert.deepEqual(release.vsceListInvocation('win32', 'C:\\Windows\\System32\\cmd.exe'), {
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', 'npx.cmd --yes @vscode/vsce@3.9.2 ls --no-dependencies'],
  });
  const files = release.collectVsceReleaseFiles(root);
  assert.deepEqual(release.releaseSurfaceFailures(files, { root }), []);
  assert.deepEqual([...files].sort(), release.expectedReleaseFiles(root));
});

test('release surface validator fails closed on sensitive and development-only package files', () => {
  const files = release.expectedReleaseFiles(root);
  const failures = release.releaseSurfaceFailures([
    ...files,
    '.env.production',
    '.kronos/work.json',
    'out/extension.js.map',
    'scripts/dev-only.js',
    'kronos-0.1.0.vsix',
  ], { root });
  for (const file of ['.env.production', '.kronos/work.json', 'out/extension.js.map', 'scripts/dev-only.js', 'kronos-0.1.0.vsix']) {
    assert.ok(failures.some(failure => failure.includes(file)), `missing fail-closed result for ${file}`);
  }
  const manifest = { ...require('../package.json'), dependencies: { 'runtime-surprise': '1.0.0' } };
  assert.ok(release.releaseSurfaceFailures(files, { root, manifest })
    .some(failure => /runtime dependencies must remain empty/i.test(failure)));
});

test('runtime source imports are limited to local modules, Node built-ins, and VS Code', () => {
  for (const specifier of ['./local-module', '../shared-module', 'fs', 'node:path', 'vscode']) {
    assert.equal(runtimeImportPolicyFailure(specifier), undefined, `${specifier} should be allowed`);
  }
  for (const specifier of ['typescript', 'axios', '@scope/provider-sdk', '/absolute/module']) {
    assert.match(runtimeImportPolicyFailure(specifier), /third-party runtime import/i);
  }
  assert.match(runtimeImportPolicyFailure(''), /non-empty module specifier/i);
});

test('release documents and package metadata remain linked to current evidence', () => {
  assert.deepEqual(release.releaseDocumentationFailures(root), []);
  assert.equal(
    normalizeRepositoryText('Goal statement\r\n- Windows evidence\r\n'),
    normalizeRepositoryText('Goal statement\n- Windows evidence\n'),
  );
});

test('public surface scan precedes both tests and release packaging', () => {
  const manifest = require('../package.json');
  const workspaceTasks = require('../.vscode/tasks.json');
  assert.match(manifest.scripts.test, /^npm run public:check &&/);
  assert.match(manifest.scripts['release:preflight'], /^npm run public:check &&/);
  assert.match(manifest.scripts.package, /^npm run release:preflight &&/);
  assert.match(manifest.scripts['release:preflight'], /npm run compile && npm run release:surface$/);
  assert.deepEqual(
    workspaceTasks.tasks.find(task => task.label === 'Kronos: Run Full Test Suite'),
    {
      type: 'npm',
      script: 'test',
      group: { kind: 'test', isDefault: true },
      windows: {
        options: {
          env: { PATH: '${env:KRONOS_NODE_HOME};${env:PATH}' },
        },
      },
      problemMatcher: [],
      label: 'Kronos: Run Full Test Suite',
    },
  );

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-public-surface-'));
  const marker = 'fictional-private-marker';
  const scanner = 'scripts/check-public-surface.js';
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.copyFileSync(path.join(root, scanner), path.join(fixture, scanner));
    execFileSync('git', ['-c', 'init.templateDir=', 'init', '--quiet'], { cwd: fixture });
    const run = (denyTerms = marker) => spawnSync(process.execPath, [scanner], {
      cwd: fixture,
      encoding: 'utf8',
      env: { ...process.env, KRONOS_PUBLICATION_DENY_TERMS: denyTerms },
    });
    const rejectPrivately = () => {
      const result = run();
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /private publication marker/);
      assert.ok(!`${result.stdout}${result.stderr}`.toLowerCase().includes(marker));
    };
    assert.equal(run().status, 0);
    const note = path.join(fixture, 'note.md');
    fs.writeFileSync(note, marker.toUpperCase());
    rejectPrivately();
    for (const format of ['x', 'u']) {
      for (const slashes of [1, 2]) {
        const escaped = [...marker].map(char => '\\'.repeat(slashes) + format
          + char.charCodeAt(0).toString(16).padStart(format === 'x' ? 2 : 4, '0')).join('');
        fs.writeFileSync(note, escaped);
        rejectPrivately();
      }
    }
    fs.unlinkSync(note);
    const privateFile = path.join(fixture, `${marker}.png`);
    fs.writeFileSync(privateFile, Buffer.from([0, 1, 2]));
    rejectPrivately();
    fs.unlinkSync(privateFile);
    fs.appendFileSync(path.join(fixture, scanner), `\n// ${marker}\n`);
    rejectPrivately();
    fs.copyFileSync(path.join(root, scanner), path.join(fixture, scanner));
    assert.equal(run('').status, 0);
    const invalid = run('xy');
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr, /at least 3 characters/);
    assert.ok(!invalid.stderr.includes('xy'));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('publish verifier requires a clean named branch and exact remote head', () => {
  const head = 'a'.repeat(40);
  assert.deepEqual(publishedStateFailures({ status: '', branch: 'feature/release', localHead: head, remoteHead: head }), []);
  const failures = publishedStateFailures({
    status: ' M README.md\n',
    branch: 'HEAD',
    localHead: head,
    remoteHead: 'b'.repeat(40),
  });
  assert.ok(failures.some(failure => /not clean/i.test(failure)));
  assert.ok(failures.some(failure => /named branch/i.test(failure)));
  assert.ok(failures.some(failure => /do not match/i.test(failure)));
});
