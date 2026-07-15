const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];
const matrixPath = path.join(root, 'docs', 'verification-matrix.json');
const checklistPath = path.join(root, 'HUMAN_FEEDBACK_CHECKLIST.md');
const readmePath = path.join(root, 'README.md');
const packagePath = path.join(root, 'package.json');
const ownershipPath = path.join(root, 'docs', 'state-ownership.md');
const providerContractPath = path.join(root, 'docs', 'provider-contract-matrix.md');
const scaleAccessibilityPath = path.join(root, 'docs', 'scale-accessibility-budget.md');

const matrix = readJson(matrixPath, 'verification matrix');
const manifest = readJson(packagePath, 'package manifest');
const checklist = readText(checklistPath, 'human feedback checklist');
const readme = readText(readmePath, 'README');
const ownership = readText(ownershipPath, 'state ownership document');
const providerContract = readText(providerContractPath, 'provider contract matrix');
const scaleAccessibility = readText(scaleAccessibilityPath, 'scale and accessibility budget');

checkVerificationMatrix(matrix, checklist);
checkReadmeMetrics(manifest, readme);
checkArchitectureEvidence(ownership, providerContract, scaleAccessibility);

if (failures.length > 0) {
  console.error(`Kronos quality evidence failed (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) { console.error(`- ${failure}`); }
  process.exitCode = 1;
} else {
  const evidenceCount = matrix.featureGroups.reduce((total, group) => total + group.automated.length, 0);
  console.log(
    `Kronos quality evidence OK (${matrix.featureGroups.length} feature groups, ${evidenceCount} checked automated references, ${matrix.humanGates.length} explicit human gates).`,
  );
  console.log(`Human gates still required: ${matrix.humanGates.map(gate => gate.id).join(', ')}.`);
}

function checkVerificationMatrix(value, checklistSource) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.featureGroups) || !Array.isArray(value.humanGates)) {
    fail('docs/verification-matrix.json must use schemaVersion 1 with featureGroups and humanGates arrays.');
    return;
  }
  const humanGateIds = uniqueIds(value.humanGates, 'human gate');
  const requiredHumanGates = ['operator-terminal', 'real-vscode', 'windows-native', 'multi-window', 'live-providers'];
  for (const id of requiredHumanGates) {
    if (!humanGateIds.has(id)) { fail(`verification matrix is missing required human gate ${id}.`); }
  }
  for (const gate of value.humanGates) {
    if (gate.status !== 'required') { fail(`human gate ${gate.id || '<missing>'} must remain explicitly required until recorded evidence exists.`); }
    if (typeof gate.checklistMarker !== 'string' || !checklistSource.includes(gate.checklistMarker)) {
      fail(`human gate ${gate.id || '<missing>'} points to a missing HUMAN_FEEDBACK_CHECKLIST.md marker.`);
    }
  }

  const groupIds = uniqueIds(value.featureGroups, 'feature group');
  if (groupIds.size < 8) { fail('verification matrix must retain at least eight bounded feature groups.'); }
  for (const group of value.featureGroups) {
    if (!Array.isArray(group.goals) || group.goals.length === 0
      || group.goals.some(goal => typeof goal !== 'string' || !/^G(?:0[1-9]|1[0-9]|2[0-2])$/.test(goal))) {
      fail(`feature group ${group.id || '<missing>'} has an invalid roadmap goal list.`);
    }
    if (!Array.isArray(group.automated) || group.automated.length === 0) {
      fail(`feature group ${group.id || '<missing>'} must reference automated evidence.`);
    } else {
      for (const evidence of group.automated) { checkAutomatedEvidence(group.id, evidence); }
    }
    if (!Array.isArray(group.humanGates)) {
      fail(`feature group ${group.id || '<missing>'} must declare a humanGates array.`);
    } else {
      for (const gateId of group.humanGates) {
        if (!humanGateIds.has(gateId)) { fail(`feature group ${group.id || '<missing>'} references unknown human gate ${gateId}.`); }
      }
    }
  }
}

function checkAutomatedEvidence(groupId, evidence) {
  const relativeFile = typeof evidence?.file === 'string' ? evidence.file : '';
  const testName = typeof evidence?.test === 'string' ? evidence.test : '';
  if (!/^scripts\/[a-z0-9-]+\.js$/.test(relativeFile) || !testName || testName.length > 300) {
    fail(`feature group ${groupId} has an invalid automated evidence reference.`);
    return;
  }
  const source = readText(path.join(root, relativeFile), relativeFile);
  if (!source.includes(`test('${testName}'`) && !source.includes(`test(\"${testName}\"`)) {
    fail(`feature group ${groupId} references missing test "${testName}" in ${relativeFile}.`);
  }
}

function checkReadmeMetrics(packageJson, readmeSource) {
  const testFiles = [
    'scripts/run-unit-tests.js',
    'scripts/run-webview-dom-tests.js',
    'scripts/run-jira-work-board-tests.js',
    'scripts/run-provider-contract-tests.js',
    'scripts/run-scale-accessibility-tests.js',
    'scripts/run-work-orchestration-tests.js',
  ];
  const actual = new Map([
    ['Enterprise provider integrations', 4],
    ['Focused VS Code views', Array.isArray(packageJson.contributes?.views?.kronos) ? packageJson.contributes.views.kronos.length : 0],
    ['Audited terminal-write paths', 2],
    ['Manifest-covered commands', Array.isArray(packageJson.contributes?.commands) ? packageJson.contributes.commands.length : 0],
    ['Manifest-covered settings', Object.keys(packageJson.contributes?.configuration?.properties || {}).length],
    ['Reachable runtime modules checked for cycles/dead exports', listFiles(path.join(root, 'src'), '.ts').length],
    ['Third-party runtime dependencies', Object.keys(packageJson.dependencies || {}).length],
    ['Automated Node/DOM/board tests', testFiles.reduce((total, file) => total + countNodeTests(readText(path.join(root, file), file)), 0)],
  ]);
  for (const [label, count] of actual) {
    const expression = new RegExp(`\\| ${escapeRegex(label)} \\| ([0-9]+) \\|`);
    const match = expression.exec(readmeSource);
    if (!match) { fail(`README engineering proof is missing metric ${label}.`); }
    else if (Number(match[1]) !== count) { fail(`README metric ${label} says ${match[1]} but the checked value is ${count}.`); }
  }
}

function checkArchitectureEvidence(ownershipSource, providerContractSource, scaleAccessibilitySource) {
  for (const marker of [
    '| Work catalog |',
    '| Live terminal object attachment |',
    '| Monitoring lease |',
    '| Jira, GitLab, CI, and Git context artifacts |',
    '## Canonical value rules',
    '## Mutation boundaries',
  ]) {
    if (!ownershipSource.includes(marker)) { fail(`docs/state-ownership.md is missing ${marker}.`); }
  }
  for (const provider of ['| Jira |', '| GitLab |', '| Jenkins |', '| SonarQube |']) {
    if (!providerContractSource.includes(provider)) { fail(`docs/provider-contract-matrix.md is missing ${provider}.`); }
  }
  for (const concept of ['Requests and enterprise variants', 'Collection and response bounds', 'Normalization and retained evidence', 'Completeness and optional evidence', 'Error behavior']) {
    if (!providerContractSource.includes(concept)) { fail(`docs/provider-contract-matrix.md is missing ${concept}.`); }
  }
  for (const marker of [
    '| Jira Work |',
    '| Registered projects |',
    '| Work sessions |',
    '| Attention ledger |',
    '| Provider polling |',
    '## Responsiveness budgets',
    '## Accessibility contract',
  ]) {
    if (!scaleAccessibilitySource.includes(marker)) { fail(`docs/scale-accessibility-budget.md is missing ${marker}.`); }
  }
}

function countNodeTests(source) {
  return (source.match(/(?:^|\n)test\s*\(/g) || []).length;
}

function listFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) { return listFiles(filePath, extension); }
    return entry.isFile() && entry.name.endsWith(extension) ? [filePath] : [];
  });
}

function uniqueIds(values, label) {
  const ids = new Set();
  for (const value of values) {
    const id = typeof value?.id === 'string' && /^[a-z][a-z0-9-]{1,80}$/.test(value.id) ? value.id : '';
    if (!id) { fail(`${label} has a missing or invalid id.`); continue; }
    if (ids.has(id)) { fail(`${label} id ${id} is duplicated.`); }
    ids.add(id);
  }
  return ids;
}

function readJson(filePath, label) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(`Could not read ${label}: ${error.message}`); return {}; }
}

function readText(filePath, label) {
  try { return fs.readFileSync(filePath, 'utf8'); }
  catch (error) { fail(`Could not read ${label}: ${error.message}`); return ''; }
}

function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function fail(message) { failures.push(message); }
