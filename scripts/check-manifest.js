const fs = require('fs');
const path = require('path');

const EXPECTED_COMMANDS = [
  'kronos.refreshTickets',
  'kronos.openJiraBoard',
  'kronos.filterWork',
  'kronos.clearWorkFilter',
  'kronos.openTicketWorkspace',
  'kronos.newClaudeSession',
  'kronos.startClaudeForTicket',
  'kronos.manageActiveTerminal',
  'kronos.insertJiraContext',
  'kronos.insertGitLabContext',
  'kronos.insertCiContext',
  'kronos.pollManagedWorkSessions',
  'kronos.openWorkSessionAudit',
  'kronos.focusWorkSessionTerminal',
  'kronos.reattachWorkSessionTerminal',
  'kronos.detachWorkSessionTerminal',
  'kronos.closeWorkSession',
  'kronos.pauseWorkSessionMonitoring',
  'kronos.resumeWorkSessionMonitoring',
  'kronos.acknowledgeAttention',
  'kronos.openProvider',
  'kronos.setup',
  'kronos.doctor',
  'kronos.settings',
];

const EXPECTED_VIEWS = [
  { id: 'kronosWork', name: 'Work' },
  { id: 'kronosSessions', name: 'Sessions' },
  { id: 'kronosAttention', name: 'Attention' },
];

const EXPECTED_SETTINGS = [
  'kronos.refreshIntervalSec',
  'kronos.managedProviderPollIntervalSec',
  'kronos.claudeCommand',
  'kronos.claudeTerminalName',
  'kronos.claudeLaunchCwd',
];

const EXPECTED_MENU_LOCATIONS = [
  'view/title',
  'view/item/context',
];

const ALLOWED_CODICONS = new Set([
  'add',
  'beaker',
  'check',
  'clear-all',
  'close',
  'debug-disconnect',
  'debug-pause',
  'debug-start',
  'filter',
  'git-merge',
  'history',
  'layout',
  'link',
  'link-external',
  'open-preview',
  'pulse',
  'refresh',
  'settings-gear',
  'symbol-keyword',
  'sync',
  'terminal',
  'tools',
]);

const failures = [];
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const reachableSources = collectReachableSources('src/extension.ts');

checkIdentity();
checkCommands();
checkViews();
checkSettings();
checkMenus();
checkWorkspaceTrustBoundary();
checkRuntimeRegistrations();

if (failures.length > 0) {
  console.error(`Kronos terminal-first manifest contract failed (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Kronos terminal-first manifest OK (${EXPECTED_VIEWS.length} views, ${EXPECTED_COMMANDS.length} commands, ${EXPECTED_SETTINGS.length} settings).`);
}

function checkIdentity() {
  if (manifest.displayName !== 'Kronos — Terminal Work Companion') {
    fail('displayName must be exactly "Kronos — Terminal Work Companion".');
  }
  const description = String(manifest.description || '');
  for (const term of ['terminal-first', 'reads', 'inserts', 'monitors', 'audits']) {
    if (!description.toLowerCase().includes(term)) {
      fail(`description must identify the product as terminal-first and say that it ${term}.`);
    }
  }
}

function checkCommands() {
  const entries = manifest.contributes?.commands;
  if (!Array.isArray(entries)) {
    fail('contributes.commands must be an array.');
    return;
  }
  const commandIds = entries.map(entry => entry?.command);
  checkExactOrderedValues('contributed commands', commandIds, EXPECTED_COMMANDS);
  reportDuplicates('contributed commands', commandIds);

  for (const entry of entries) {
    const id = String(entry?.command || '<missing command>');
    if (typeof entry?.title !== 'string' || !entry.title.trim()) {
      fail(`${id} must have a non-empty title.`);
    }
    const iconMatch = /^\$\(([a-z0-9-]+)\)$/.exec(String(entry?.icon || ''));
    if (!iconMatch) {
      fail(`${id} must use a $(codicon-name) icon.`);
    } else if (!ALLOWED_CODICONS.has(iconMatch[1])) {
      fail(`${id} uses codicon ${iconMatch[1]}, which is outside the terminal-first command surface.`);
    }
  }
}

function checkViews() {
  const containers = manifest.contributes?.viewsContainers;
  checkExactUnorderedValues(
    'view-container locations',
    containers && typeof containers === 'object' ? Object.keys(containers) : [],
    ['activitybar'],
  );
  const activityContainers = containers?.activitybar;
  if (!Array.isArray(activityContainers)
    || activityContainers.length !== 1
    || activityContainers[0]?.id !== 'kronos'
    || activityContainers[0]?.title !== 'Kronos') {
    fail('viewsContainers.activitybar must contain exactly the Kronos container.');
  }

  const viewGroups = manifest.contributes?.views;
  checkExactUnorderedValues(
    'view contribution containers',
    viewGroups && typeof viewGroups === 'object' ? Object.keys(viewGroups) : [],
    ['kronos'],
  );
  const views = viewGroups?.kronos;
  if (!Array.isArray(views)) {
    fail('contributes.views.kronos must be an array.');
    return;
  }
  checkExactOrderedValues('contributed view ids', views.map(view => view?.id), EXPECTED_VIEWS.map(view => view.id));
  reportDuplicates('contributed view ids', views.map(view => view?.id));
  for (const expected of EXPECTED_VIEWS) {
    const actual = views.find(view => view?.id === expected.id);
    if (actual?.name !== expected.name) {
      fail(`${expected.id} must be named exactly "${expected.name}".`);
    }
  }
}

function checkSettings() {
  const configuration = manifest.contributes?.configuration;
  if (!configuration || Array.isArray(configuration) || typeof configuration !== 'object') {
    fail('contributes.configuration must be one configuration object.');
    return;
  }
  const properties = configuration.properties;
  const settingIds = properties && typeof properties === 'object' ? Object.keys(properties) : [];
  checkExactOrderedValues('configuration settings', settingIds, EXPECTED_SETTINGS);

  for (const id of EXPECTED_SETTINGS.slice(0, 2)) {
    const setting = properties?.[id];
    if (setting?.type !== 'number' || typeof setting.default !== 'number' || setting.minimum !== 15) {
      fail(`${id} must be a numeric interval with a numeric default and a 15-second minimum.`);
    }
  }
  if (properties?.['kronos.claudeCommand']?.type !== 'string'
    || properties?.['kronos.claudeCommand']?.default !== 'claude'
    || properties?.['kronos.claudeCommand']?.scope !== 'machine') {
    fail('kronos.claudeCommand must be machine-scoped and default to the validated claude command.');
  }
  if (properties?.['kronos.claudeTerminalName']?.type !== 'string'
    || properties?.['kronos.claudeTerminalName']?.default !== 'Claude') {
    fail('kronos.claudeTerminalName must default to Claude.');
  }
  const cwd = properties?.['kronos.claudeLaunchCwd'];
  if (cwd?.type !== 'string' || cwd?.default !== 'ticketProject'
    || JSON.stringify(cwd?.enum) !== JSON.stringify(['ticketProject', 'workspace', 'home'])) {
    fail('kronos.claudeLaunchCwd must expose only ticketProject, workspace, and home.');
  }
}

function checkMenus() {
  const menus = manifest.contributes?.menus;
  const locations = menus && typeof menus === 'object' ? Object.keys(menus) : [];
  checkExactUnorderedValues('menu locations', locations, EXPECTED_MENU_LOCATIONS);
  const allowed = new Set(EXPECTED_COMMANDS);
  const expectedViews = new Set(EXPECTED_VIEWS.map(view => view.id));

  for (const [location, items] of Object.entries(menus || {})) {
    if (!Array.isArray(items)) {
      fail(`${location} must be an array of menu items.`);
      continue;
    }
    for (const item of items) {
      if (!allowed.has(item?.command)) {
        fail(`${location} references command ${String(item?.command)}, which is outside the terminal-first command surface.`);
      }
      for (const match of String(item?.when || '').matchAll(/\bview\s*==\s*([A-Za-z0-9_.-]+)/g)) {
        if (!expectedViews.has(match[1])) {
          fail(`${location} references legacy or unknown view ${match[1]}.`);
        }
      }
    }
  }
}

function checkWorkspaceTrustBoundary() {
  const untrusted = manifest.capabilities?.untrustedWorkspaces;
  if (untrusted?.supported !== 'limited') {
    fail('capabilities.untrustedWorkspaces.supported must be "limited".');
  }
  const description = String(untrusted?.description || '');
  const requiredClaims = [
    [/reads provider context/i, 'reads provider context'],
    [/non-submitting references/i, 'inserts only non-submitting references'],
    [/Claude launch is disabled in untrusted workspaces/i, 'disables Claude launch in untrusted workspaces'],
    [/never .*executes workspace code|never .*runs project commands/i, 'never executes workspace or project commands'],
    [/never .*changes Git/i, 'never changes Git'],
  ];
  for (const [pattern, claim] of requiredClaims) {
    if (!pattern.test(description)) {
      fail(`untrusted workspace description must state that Kronos ${claim}.`);
    }
  }
}

function checkRuntimeRegistrations() {
  const registrations = [];
  const viewRegistrations = [];
  for (const { file, source } of reachableSources) {
    for (const match of source.matchAll(/\b(?:vscode\.)?commands\.registerCommand\(\s*['"]([^'"]+)['"]/g)) {
      registrations.push({ id: match[1], file });
    }
    for (const match of source.matchAll(/\bthis\.command\(\s*['"]([^'"]+)['"]/g)) {
      registrations.push({ id: match[1], file });
    }
    for (const match of source.matchAll(/\bregisterTreeDataProvider\(\s*['"]([^'"]+)['"]/g)) {
      viewRegistrations.push({ id: match[1], file });
    }
    for (const match of source.matchAll(/\bcreateTreeView(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g)) {
      viewRegistrations.push({ id: match[1], file });
    }
  }

  const commandIds = registrations.map(registration => registration.id);
  checkExactUnorderedValues('reachable runtime command registrations', commandIds, EXPECTED_COMMANDS);
  reportDuplicates(
    'reachable runtime command registrations',
    commandIds,
    id => registrations.filter(registration => registration.id === id).map(registration => registration.file).join(', '),
  );

  const viewIds = viewRegistrations.map(registration => registration.id);
  checkExactUnorderedValues('reachable runtime view registrations', viewIds, EXPECTED_VIEWS.map(view => view.id));
  reportDuplicates(
    'reachable runtime view registrations',
    viewIds,
    id => viewRegistrations.filter(registration => registration.id === id).map(registration => registration.file).join(', '),
  );
}

function collectReachableSources(entryFile) {
  const root = process.cwd();
  const pending = [path.resolve(root, entryFile)];
  const visited = new Set();
  const result = [];
  while (pending.length > 0) {
    const absoluteFile = pending.pop();
    if (!absoluteFile || visited.has(absoluteFile)) { continue; }
    visited.add(absoluteFile);
    if (!fs.existsSync(absoluteFile)) {
      fail(`runtime entry/import does not exist: ${path.relative(root, absoluteFile)}.`);
      continue;
    }
    const source = fs.readFileSync(absoluteFile, 'utf8').replace(/\r\n/g, '\n');
    result.push({ file: path.relative(root, absoluteFile).replace(/\\/g, '/'), source });
    for (const specifier of relativeModuleSpecifiers(source)) {
      const resolved = resolveRelativeModule(absoluteFile, specifier);
      if (resolved) { pending.push(resolved); }
    }
  }
  return result;
}

function relativeModuleSpecifiers(source) {
  const result = [];
  const staticPattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"](\.[^'"]+)['"]/gm;
  const dynamicPattern = /(?:require|import)\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticPattern)) {
    if (!match[1]) { result.push(match[2]); }
  }
  for (const match of source.matchAll(dynamicPattern)) { result.push(match[1]); }
  return result;
}

function resolveRelativeModule(importingFile, specifier) {
  const unresolved = path.resolve(path.dirname(importingFile), specifier);
  const withoutExtension = unresolved.replace(/\.(?:js|mjs|cjs|ts|tsx)$/, '');
  const candidates = [
    unresolved,
    `${withoutExtension}.ts`,
    `${withoutExtension}.tsx`,
    `${withoutExtension}.js`,
    path.join(withoutExtension, 'index.ts'),
    path.join(withoutExtension, 'index.js'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function checkExactOrderedValues(label, actual, expected) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail(`${label} must be exactly [${expected.join(', ')}]; found [${actual.join(', ')}].`);
  }
}

function checkExactUnorderedValues(label, actual, expected) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (actualSorted.length !== expectedSorted.length
    || actualSorted.some((value, index) => value !== expectedSorted[index])) {
    const missing = expectedSorted.filter(value => !actualSorted.includes(value));
    const extra = actualSorted.filter(value => !expectedSorted.includes(value));
    fail(`${label} mismatch${missing.length ? `; missing: ${missing.join(', ')}` : ''}${extra.length ? `; extra: ${extra.join(', ')}` : ''}.`);
  }
}

function reportDuplicates(label, values, detail = () => '') {
  for (const duplicate of duplicateValues(values)) {
    const suffix = detail(duplicate);
    fail(`${label} contains duplicate ${duplicate}${suffix ? ` (${suffix})` : ''}.`);
  }
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) { duplicates.add(value); }
    seen.add(value);
  }
  return [...duplicates].sort();
}

function fail(message) {
  failures.push(message);
}
