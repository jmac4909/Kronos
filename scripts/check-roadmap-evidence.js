const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRepositoryText } = require('./repository-text.js');

const root = path.resolve(__dirname, '..');
const matrixPath = path.join(root, 'docs', 'verification-matrix.json');
const roadmapPath = path.join(root, 'docs', 'extension-improvement-goals.md');
const checklistPath = path.join(root, 'HUMAN_FEEDBACK_CHECKLIST.md');
const packagePath = path.join(root, 'package.json');
const failures = [];

const matrix = readJson(matrixPath, 'verification matrix');
const roadmap = readText(roadmapPath, 'extension improvement roadmap');
const checklist = readText(checklistPath, 'human feedback checklist');
const manifest = readJson(packagePath, 'package manifest');

const requirements = parseRoadmapRequirements(roadmap);
const humanGateIds = checkHumanGates(matrix.humanGates, checklist);
const repositoryCheckIds = checkRepositoryChecks(matrix.repositoryChecks);
const coverage = checkRequirementEvidence(
  matrix.requirementEvidence,
  requirements,
  humanGateIds,
  repositoryCheckIds,
);
checkRequiredReleaseGates(manifest, roadmap);

if (matrix.schemaVersion !== 2) {
  fail('docs/verification-matrix.json must use schemaVersion 2 for case-level roadmap evidence.');
}
if (failures.length > 0) {
  console.error(`Kronos roadmap evidence failed (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) { console.error(`- ${failure}`); }
  process.exitCode = 1;
} else {
  const totals = summarize(requirements, coverage);
  console.log(
    `Kronos roadmap evidence OK (${requirements.size} fingerprinted requirements: ${formatSummary(totals)}).`,
  );
  for (const goal of goalIds()) {
    const goalRequirements = [...requirements.values()].filter(requirement => requirement.goal === goal);
    const summary = summarize(new Map(goalRequirements.map(requirement => [requirement.ref, requirement])), coverage);
    console.log(`- ${goal}: ${formatSummary(summary)}.`);
  }
  if (process.env.KRONOS_ROADMAP_EVIDENCE_DETAILS === '1') {
    for (const requirement of requirements.values()) {
      const evidence = coverage.get(requirement.ref);
      if (!evidence) {
        console.log(`  OPEN ${requirement.ref} ${requirement.text}`);
      } else if (evidence.humanGates.length > 0
        && evidence.automated.length === 0
        && evidence.checks.length === 0) {
        console.log(`  HUMAN-ONLY ${requirement.ref} [${evidence.humanGates.join(', ')}] ${requirement.text}`);
      }
    }
  }
}

function parseRoadmapRequirements(source) {
  const requirementsByRef = new Map();
  const seenGoals = new Set();
  const heading = /^### (G(?:0[1-9]|1[0-9]|2[0-2]))\b[^\n]*\n([\s\S]*?)(?=^### G|^## Feature)/gm;
  let match;
  while ((match = heading.exec(source))) {
    const [, goal, body] = match;
    if (seenGoals.has(goal)) { fail(`Roadmap goal ${goal} is duplicated.`); continue; }
    seenGoals.add(goal);
    const statement = (body.match(/\*\*Goal statement:\*\* ([^\n]+)/) || [])[1];
    if (!statement) { fail(`Roadmap goal ${goal} is missing its Goal statement.`); }
    else { addRequirement(requirementsByRef, goal, 'goal', 0, statement); }

    const caseBlock = (body.match(/Cases to cover:\n\n([\s\S]*?)(?=\nCompletion evidence:|\n##|$)/) || [])[1] || '';
    const cases = caseBlock.match(/^- .+$/gm) || [];
    const evidenceBlock = (body.match(/Completion evidence:\n\n([\s\S]*?)(?=\n##|$)/) || [])[1] || '';
    const evidence = evidenceBlock.match(/^- .+$/gm) || [];
    if (!['G14'].includes(goal) && cases.length === 0) {
      fail(`Roadmap goal ${goal} must declare explicit Cases to cover.`);
    }
    if (evidence.length === 0) {
      fail(`Roadmap goal ${goal} must declare explicit Completion evidence.`);
    }
    cases.forEach((line, index) => addRequirement(requirementsByRef, goal, 'case', index + 1, line.slice(2)));
    evidence.forEach((line, index) => addRequirement(requirementsByRef, goal, 'evidence', index + 1, line.slice(2)));
  }
  const expectedGoals = goalIds();
  if (seenGoals.size !== expectedGoals.length || expectedGoals.some(goal => !seenGoals.has(goal))) {
    fail('Roadmap requirement inventory must retain exactly G01 through G22.');
  }
  return requirementsByRef;
}

function addRequirement(target, goal, kind, ordinal, text) {
  const suffix = ordinal > 0 ? `-${String(ordinal).padStart(2, '0')}` : '';
  const fingerprint = crypto.createHash('sha256').update(text).digest('hex').slice(0, 8);
  const ref = `${goal}-${kind}${suffix}:${fingerprint}`;
  if (target.has(ref)) { fail(`Roadmap requirement reference ${ref} is duplicated.`); return; }
  target.set(ref, { ref, goal, kind, text });
}

function checkHumanGates(gates, checklistSource) {
  if (!Array.isArray(gates)) { fail('Verification matrix must declare humanGates.'); return new Set(); }
  const ids = new Set();
  for (const gate of gates) {
    const id = validId(gate?.id) ? gate.id : '';
    if (!id) { fail('Human gate has a missing or invalid id.'); continue; }
    if (ids.has(id)) { fail(`Human gate ${id} is duplicated.`); }
    ids.add(id);
    if (gate.status !== 'required') {
      fail(`Human gate ${id} must remain required until recorded evidence exists.`);
    }
    if (typeof gate.checklistMarker !== 'string' || !checklistSource.includes(gate.checklistMarker)) {
      fail(`Human gate ${id} points to a missing checklist marker.`);
    }
  }
  for (const required of ['operator-terminal', 'real-vscode', 'windows-native', 'multi-window', 'live-providers']) {
    if (!ids.has(required)) { fail(`Verification matrix is missing required human gate ${required}.`); }
  }
  return ids;
}

function checkRepositoryChecks(checks) {
  if (!Array.isArray(checks)) { fail('Verification matrix must declare repositoryChecks.'); return new Set(); }
  const ids = new Set();
  for (const check of checks) {
    const id = validId(check?.id) ? check.id : '';
    const relativeFile = typeof check?.file === 'string' ? check.file : '';
    const marker = typeof check?.marker === 'string' ? check.marker : '';
    if (!id || !/^(?:scripts|docs)\/[A-Za-z0-9._/-]+$/.test(relativeFile) || !marker || marker.length > 200) {
      fail(`Repository check ${id || '<missing>'} is invalid.`);
      continue;
    }
    if (ids.has(id)) { fail(`Repository check ${id} is duplicated.`); }
    ids.add(id);
    if (!readText(path.join(root, relativeFile), relativeFile).includes(marker)) {
      fail(`Repository check ${id} points to a missing marker in ${relativeFile}.`);
    }
  }
  return ids;
}

function checkRequirementEvidence(entries, requirements, humanGateIds, repositoryCheckIds) {
  if (!Array.isArray(entries)) { fail('Verification matrix must declare requirementEvidence.'); return new Map(); }
  const coverage = new Map();
  for (const entry of entries) {
    const refs = Array.isArray(entry?.requirements) ? entry.requirements : [];
    const automated = Array.isArray(entry?.automated) ? entry.automated : [];
    const humanGates = Array.isArray(entry?.humanGates) ? entry.humanGates : [];
    const checks = Array.isArray(entry?.checks) ? entry.checks : [];
    if (refs.length === 0 || (automated.length === 0 && humanGates.length === 0 && checks.length === 0)) {
      fail('Every requirement-evidence entry needs requirement refs and at least one automated test, repository check, or human gate.');
      continue;
    }
    for (const evidence of automated) { checkAutomatedEvidence(evidence); }
    for (const gate of humanGates) {
      if (!humanGateIds.has(gate)) { fail(`Requirement evidence references unknown human gate ${gate}.`); }
    }
    for (const check of checks) {
      if (!repositoryCheckIds.has(check)) { fail(`Requirement evidence references unknown repository check ${check}.`); }
    }
    for (const ref of refs) {
      if (!requirements.has(ref)) { fail(`Requirement evidence references stale or unknown roadmap requirement ${ref}.`); continue; }
      if (coverage.has(ref)) { fail(`Roadmap requirement ${ref} has duplicate evidence entries.`); continue; }
      coverage.set(ref, { automated, humanGates, checks });
    }
  }
  return coverage;
}

function checkAutomatedEvidence(evidence) {
  const relativeFile = typeof evidence?.file === 'string' ? evidence.file : '';
  const testName = typeof evidence?.test === 'string' ? evidence.test : '';
  if (!/^scripts\/[a-z0-9-]+\.js$/.test(relativeFile) || !testName || testName.length > 300) {
    fail('Requirement evidence has an invalid automated test reference.');
    return;
  }
  const source = readText(path.join(root, relativeFile), relativeFile);
  if (!source.includes(`test('${testName}'`) && !source.includes(`test(\"${testName}\"`)) {
    fail(`Requirement evidence references missing test "${testName}" in ${relativeFile}.`);
  }
}

function checkRequiredReleaseGates(packageJson, roadmapSource) {
  for (const script of ['test', 'feedback:smoke', 'feedback:ready']) {
    if (typeof packageJson.scripts?.[script] !== 'string' || !packageJson.scripts[script]) {
      fail(`package.json is missing required ${script} gate.`);
    }
  }
  for (const command of ['`npm test`', '`npm run feedback:smoke`', '`npm run feedback:ready`', '`git diff --check`']) {
    if (!roadmapSource.includes(command)) { fail(`Roadmap is missing required gate ${command}.`); }
  }
}

function summarize(requirements, coverage) {
  const totals = { automatedOnly: 0, automatedAndHuman: 0, humanOnly: 0, open: 0 };
  for (const ref of requirements.keys()) {
    const evidence = coverage.get(ref);
    if (!evidence) { totals.open += 1; }
    else {
      const hasAutomatedEvidence = evidence.automated.length > 0 || evidence.checks.length > 0;
      if (hasAutomatedEvidence && evidence.humanGates.length > 0) { totals.automatedAndHuman += 1; }
      else if (hasAutomatedEvidence) { totals.automatedOnly += 1; }
      else { totals.humanOnly += 1; }
    }
  }
  return totals;
}

function formatSummary(summary) {
  return `${summary.automatedOnly} automated-only, ${summary.automatedAndHuman} automated + human, ${summary.humanOnly} human-only, ${summary.open} open`;
}

function goalIds() {
  return Array.from({ length: 22 }, (_, index) => `G${String(index + 1).padStart(2, '0')}`);
}

function validId(value) { return typeof value === 'string' && /^[a-z][a-z0-9-]{1,80}$/.test(value); }

function readJson(filePath, label) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(`Could not read ${label}: ${error.message}`); return {}; }
}

function readText(filePath, label) {
  try { return normalizeRepositoryText(fs.readFileSync(filePath, 'utf8')); }
  catch (error) { fail(`Could not read ${label}: ${error.message}`); return ''; }
}

function fail(message) { failures.push(message); }
