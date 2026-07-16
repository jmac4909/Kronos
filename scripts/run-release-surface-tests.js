const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const release = require('./release-surface.js');
const { normalizeRepositoryText } = require('./repository-text.js');
const { publishedStateFailures } = require('./verify-published-branch.js');

test('actual VSIX release surface is exact and runtime-dependency-free', () => {
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

test('release documents and package metadata remain linked to current evidence', () => {
  assert.deepEqual(release.releaseDocumentationFailures(root), []);
  assert.equal(
    normalizeRepositoryText('Goal statement\r\n- Windows evidence\r\n'),
    normalizeRepositoryText('Goal statement\n- Windows evidence\n'),
  );
});

test('public surface scan precedes both tests and release packaging', () => {
  const manifest = require('../package.json');
  assert.match(manifest.scripts.test, /^npm run public:check &&/);
  assert.match(manifest.scripts['release:preflight'], /^npm run public:check &&/);
  assert.match(manifest.scripts.package, /^npm run release:preflight &&/);
  assert.match(manifest.scripts['release:preflight'], /npm run compile && npm run release:surface$/);
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
