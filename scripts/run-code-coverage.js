const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { testSuiteFiles } = require('./test-suite-files.js');

const root = path.resolve(__dirname, '..');
const COVERAGE_THRESHOLDS = Object.freeze({ lines: 80.5, branches: 71.75, functions: 86.5 });
const CRITICAL_FILE_THRESHOLDS = Object.freeze({
  'dateValues.js': Object.freeze({ lines: 100, branches: 100, functions: 100 }),
  'gitlabPipelineMonitorStore.js': Object.freeze({ lines: 92, branches: 69, functions: 76 }),
  'ManagedSessionTreeProvider.js': Object.freeze({ lines: 95, branches: 87, functions: 76 }),
  'ProjectTreeProvider.js': Object.freeze({ lines: 96, branches: 78, functions: 82 }),
});
const MINIMUM_NODE_VERSION = Object.freeze({ major: 22, minor: 5 });

function main() {
  assertSupportedNodeVersion(process.versions.node);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const testFiles = testSuiteFiles(manifest);
  if (testFiles.length === 0) { throw new Error('No test runners were discovered from npm test.'); }
  for (const relativeFile of testFiles) {
    if (!fs.statSync(path.join(root, relativeFile)).isFile()) {
      throw new Error(`Discovered test runner is missing: ${relativeFile}`);
    }
  }

  const result = spawnSync(process.execPath, [
    '--test',
    '--test-concurrency=1',
    '--test-reporter=tap',
    '--experimental-test-coverage',
    '--test-coverage-include=out/**/*.js',
    ...testFiles,
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) { throw result.error; }
  if (result.status !== 0) {
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    process.exitCode = result.status || 1;
    return;
  }

  const report = parseCoverageReport(result.stdout);
  const failures = coverageFailures(report, COVERAGE_THRESHOLDS, CRITICAL_FILE_THRESHOLDS);
  if (failures.length > 0) {
    console.error(`Kronos runtime coverage failed (${failures.length} regression${failures.length === 1 ? '' : 's'}):`);
    for (const failure of failures) { console.error(`- ${failure}`); }
    process.exitCode = 1;
    return;
  }

  const testCount = [...result.stdout.matchAll(/^# tests ([0-9]+)$/gm)].at(-1)?.[1] || 'unknown';
  const overall = report.get('all files');
  console.log(
    `Kronos runtime coverage OK (${testFiles.length} test runners; ${testCount} tests; `
      + `${overall.lines.toFixed(2)}% lines, ${overall.branches.toFixed(2)}% branches, `
      + `${overall.functions.toFixed(2)}% functions).`,
  );
  for (const fileName of Object.keys(CRITICAL_FILE_THRESHOLDS)) {
    const coverage = report.get(fileName);
    console.log(
      `- ${fileName}: ${coverage.lines.toFixed(2)}% lines, ${coverage.branches.toFixed(2)}% branches, `
        + `${coverage.functions.toFixed(2)}% functions.`,
    );
  }
}

function assertSupportedNodeVersion(version) {
  const [major, minor] = String(version).split('.').map(Number);
  const supported = Number.isInteger(major)
    && Number.isInteger(minor)
    && (major > MINIMUM_NODE_VERSION.major
      || (major === MINIMUM_NODE_VERSION.major && minor >= MINIMUM_NODE_VERSION.minor));
  if (!supported) {
    throw new Error(
      `Runtime coverage requires Node ${MINIMUM_NODE_VERSION.major}.${MINIMUM_NODE_VERSION.minor} or newer; `
        + `received ${version || 'an unknown version'}.`,
    );
  }
}

function parseCoverageReport(output) {
  const rows = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith('#') || !line.includes('|')) { continue; }
    const parts = line.split('|').map(part => part.trim());
    const name = parts[0].replace(/^#\s*/, '');
    if (!(name === 'all files' || name.endsWith('.js'))) { continue; }
    const [lines, branches, functions] = parts.slice(1, 4).map(Number);
    if (![lines, branches, functions].every(Number.isFinite)) { continue; }
    rows.set(name, { lines, branches, functions });
  }
  return rows;
}

function coverageFailures(report, overallThresholds, criticalThresholds) {
  const failures = [];
  checkThresholds('all files', report.get('all files'), overallThresholds, failures);
  for (const [fileName, thresholds] of Object.entries(criticalThresholds)) {
    checkThresholds(fileName, report.get(fileName), thresholds, failures);
  }
  return failures;
}

function checkThresholds(name, actual, thresholds, failures) {
  if (!actual) {
    failures.push(`${name} is missing from the built-in coverage report.`);
    return;
  }
  for (const metric of ['lines', 'branches', 'functions']) {
    if (actual[metric] < thresholds[metric]) {
      failures.push(`${name} ${metric} coverage ${actual[metric].toFixed(2)}% is below ${thresholds[metric].toFixed(2)}%.`);
    }
  }
}

if (require.main === module) { main(); }

module.exports = {
  COVERAGE_THRESHOLDS,
  CRITICAL_FILE_THRESHOLDS,
  MINIMUM_NODE_VERSION,
  assertSupportedNodeVersion,
  coverageFailures,
  parseCoverageReport,
};
