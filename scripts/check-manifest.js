const fs = require('fs');

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const source = fs.readFileSync('src/extension.ts', 'utf8');

const allowedCodicons = new Set([
  'add',
  'archive',
  'arrow-down',
  'arrow-up',
  'beaker',
  'check',
  'check-all',
  'checklist',
  'clear-all',
  'clockface',
  'close',
  'cloud',
  'cloud-upload',
  'comment-discussion',
  'compass',
  'dashboard',
  'debug-continue',
  'debug-pause',
  'debug-rerun',
  'debug-reverse-continue',
  'debug-stop',
  'diff',
  'export',
  'eye',
  'filter',
  'gear',
  'go-to-file',
  'graph',
  'graph-line',
  'history',
  'inbox',
  'json',
  'layout',
  'link',
  'link-external',
  'list-selection',
  'list-tree',
  'list-unordered',
  'merge',
  'milestone',
  'notebook',
  'open-preview',
  'pin',
  'play',
  'play-circle',
  'project',
  'pulse',
  'refresh',
  'run-all',
  'save',
  'search',
  'server-environment',
  'server-process',
  'settings-gear',
  'shield',
  'symbol-keyword',
  'terminal',
  'tools',
  'trash',
  'verified',
  'warning',
  'watch',
]);

const contributed = (manifest.contributes.commands || [])
  .map((command) => command.command)
  .sort();
const duplicateContributed = duplicateValues(contributed);
if (duplicateContributed.length > 0) {
  console.error(`Duplicate contributed commands:\n${duplicateContributed.join('\n')}`);
  process.exit(1);
}

const registered = [...source.matchAll(/registerCommand\(['"]([^'"]+)['"]/g)]
  .map((match) => match[1])
  .sort();
const duplicateRegistered = duplicateValues(registered);
if (duplicateRegistered.length > 0) {
  console.error(`Duplicate command registrations:\n${duplicateRegistered.join('\n')}`);
  process.exit(1);
}

const missing = contributed.filter((command) => !registered.includes(command));
const extra = registered.filter((command) => !contributed.includes(command));

if (missing.length || extra.length) {
  console.error('Command manifest mismatch');
  if (missing.length) {
    console.error(`Missing registrations:\n${missing.join('\n')}`);
  }
  if (extra.length) {
    console.error(`Registered but not contributed:\n${extra.join('\n')}`);
  }
  process.exit(1);
}

const contributedSet = new Set(contributed);
const staleMenuCommands = menuCommandReferences(manifest)
  .filter((entry) => !contributedSet.has(entry.command));
if (staleMenuCommands.length > 0) {
  console.error(`Menu references missing commands:\n${staleMenuCommands.map((entry) => `${entry.menu}: ${entry.command}`).join('\n')}`);
  process.exit(1);
}

const contextOnlyCommands = [
  'kronos.openExternalUrl',
  'kronos.implement',
  'kronos.completeTask',
  'kronos.openProject',
  'kronos.openInClaude',
  'kronos.viewTicket',
  'kronos.insertJiraContext',
  'kronos.addEvidence',
  'kronos.addEvidenceCheck',
  'kronos.recordEnvironmentResult',
  'kronos.extractAcceptanceCriteria',
  'kronos.updateAcceptanceCriteria',
  'kronos.exportEvidence',
  'kronos.evidenceHandoff',
  'kronos.publishEvidence',
  'kronos.addToQueue',
  'kronos.removeFromQueue',
  'kronos.linkTicket',
  'kronos.unlinkTicket',
  'kronos.removeProject',
  'kronos.registerDiscovered',
  'kronos.startQueueItem',
  'kronos.queueMoveUp',
  'kronos.queueMoveDown',
  'kronos.queuePinTop',
  'kronos.openMrDiff',
  'kronos.openMrInGitlab',
  'kronos.rejectReview',
  'kronos.verifyLocal',
];
const hiddenPaletteCommands = new Set((manifest.contributes?.menus?.commandPalette || [])
  .filter((entry) => entry?.when === 'false')
  .map((entry) => entry.command));
const visibleContextOnlyCommands = contextOnlyCommands.filter((command) => !hiddenPaletteCommands.has(command));
if (visibleContextOnlyCommands.length > 0) {
  console.error(`Context-only commands must be hidden from the Command Palette:\n${visibleContextOnlyCommands.join('\n')}`);
  process.exit(1);
}

const untrustedWorkspaces = manifest.capabilities?.untrustedWorkspaces;
if (untrustedWorkspaces?.supported !== 'limited') {
  console.error('Kronos must declare limited untrusted workspace support so read-only operator panels remain available in Restricted Mode.');
  process.exit(1);
}
if (!String(untrustedWorkspaces.description || '').includes('Dispatching agents')) {
  console.error('Kronos untrusted workspace support must describe which actions require workspace trust.');
  process.exit(1);
}

const iconProblems = [];
for (const command of manifest.contributes.commands || []) {
  if (!command.icon) {
    iconProblems.push(`${command.command}: missing icon`);
    continue;
  }
  const match = String(command.icon).match(/^\$\(([a-z0-9-]+)\)$/);
  if (!match) {
    iconProblems.push(`${command.command}: icon must use $(codicon-name) syntax`);
    continue;
  }
  if (!allowedCodicons.has(match[1])) {
    iconProblems.push(`${command.command}: unknown codicon ${match[1]}`);
  }
}
if (iconProblems.length > 0) {
  console.error(`Command icon validation failed:\n${iconProblems.join('\n')}`);
  process.exit(1);
}

if (source.includes('kronos.computeQueue')) {
  console.error('Stale kronos.computeQueue reference found');
  process.exit(1);
}

console.log(`Command manifest OK (${contributed.length} commands).`);

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    } else {
      seen.add(value);
    }
  }
  return [...duplicates].sort();
}

function menuCommandReferences(manifest) {
  const menus = manifest.contributes?.menus || {};
  const references = [];
  for (const [menu, items] of Object.entries(menus)) {
    if (!Array.isArray(items)) { continue; }
    for (const item of items) {
      if (typeof item?.command === 'string' && item.command.trim()) {
        references.push({ menu, command: item.command });
      }
    }
  }
  return references;
}
