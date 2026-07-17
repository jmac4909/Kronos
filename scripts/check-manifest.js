const fs = require('fs');
const path = require('path');

const EXPECTED_COMMANDS = [
  'kronos.refreshTickets',
  'kronos.openJiraBoard',
  'kronos.filterWork',
  'kronos.clearWorkFilter',
  'kronos.openTicketWorkspace',
  'kronos.configureProjectDiscoveryFolders',
  'kronos.registerWorkspaceProject',
  'kronos.chooseTicketProject',
  'kronos.newClaudeSession',
  'kronos.startClaudeForTicket',
  'kronos.manageActiveTerminal',
  'kronos.insertJiraContext',
  'kronos.insertOtherTicket',
  'kronos.insertGitLabContext',
  'kronos.insertCiContext',
  'kronos.openContextBasket',
  'kronos.openPromptLibrary',
  'kronos.searchLocalEvidence',
  'kronos.createLocalHandoff',
  'kronos.pollManagedWorkSessions',
  'kronos.openWorkSessionAudit',
  'kronos.focusWorkSessionTerminal',
  'kronos.reattachWorkSessionTerminal',
  'kronos.detachWorkSessionTerminal',
  'kronos.closeWorkSession',
  'kronos.removeWorkSession',
  'kronos.refreshProjects',
  'kronos.renameLocalProject',
  'kronos.openProjectGitStatus',
  'kronos.insertProjectGitContext',
  'kronos.openProjectMergeRequest',
  'kronos.insertProjectGitLabContext',
  'kronos.insertProjectCiContext',
  'kronos.configureProjectIntegrations',
  'kronos.pauseWorkSessionMonitoring',
  'kronos.resumeWorkSessionMonitoring',
  'kronos.insertAttentionEventContext',
  'kronos.acknowledgeAttention',
  'kronos.openProvider',
  'kronos.setup',
  'kronos.doctor',
  'kronos.settings',
];

const EXPECTED_VIEWS = [
  { id: 'kronosWork', name: 'Work' },
  { id: 'kronosSessions', name: 'Sessions' },
  { id: 'kronosProjects', name: 'Projects' },
  { id: 'kronosAttention', name: 'Attention' },
];

const EXPECTED_SETTINGS = [
  'kronos.refreshIntervalSec',
  'kronos.managedProviderPollIntervalSec',
  'kronos.projectDiscoveryRoots',
  'kronos.projectDiscoveryDepth',
  'kronos.projectDiscoveryLimit',
  'kronos.hideCompletedJiraWork',
  'kronos.completedJiraStatuses',
  'kronos.promptLibraryLocalPaths',
  'kronos.promptLibraryRemoteManifestUrls',
  'kronos.claudeCommand',
  'kronos.claudePermissionMode',
  'kronos.claudeTerminalName',
  'kronos.claudeLaunchCwd',
];

const EXPECTED_MENU_LOCATIONS = [
  'view/title',
  'view/item/context',
];

const EXPECTED_VIEW_TITLE_ITEMS = [
  'kronos.refreshTickets|view == kronosWork|navigation@1',
  'kronos.openJiraBoard|view == kronosWork|navigation@2',
  'kronos.filterWork|view == kronosWork|navigation@3',
  'kronos.clearWorkFilter|view == kronosWork|work@1',
  'kronos.newClaudeSession|view == kronosSessions|navigation@1',
  'kronos.manageActiveTerminal|view == kronosSessions|navigation@2',
  'kronos.refreshProjects|view == kronosProjects|navigation@1',
  'kronos.registerWorkspaceProject|view == kronosProjects|navigation@2',
  'kronos.pollManagedWorkSessions|view == kronosAttention|navigation@1',
  'kronos.pollManagedWorkSessions|view == kronosSessions|sessions@1',
  'kronos.pollManagedWorkSessions|view == kronosProjects|projects@1',
  'kronos.openContextBasket|view == kronosWork|work@2',
  'kronos.openContextBasket|view == kronosSessions|sessions@2',
  'kronos.openContextBasket|view == kronosProjects|projects@2',
  'kronos.searchLocalEvidence|view == kronosWork|work@3',
  'kronos.searchLocalEvidence|view == kronosSessions|sessions@3',
  'kronos.searchLocalEvidence|view == kronosProjects|projects@3',
  'kronos.searchLocalEvidence|view == kronosAttention|attention@1',
  'kronos.openPromptLibrary|view == kronosWork|work@4',
  'kronos.openPromptLibrary|view == kronosSessions|sessions@4',
  'kronos.openPromptLibrary|view == kronosProjects|projects@4',
  'kronos.createLocalHandoff|view == kronosSessions|sessions@5',
  'kronos.createLocalHandoff|view == kronosProjects|projects@5',
  'kronos.setup|view == kronosWork|work@5',
];

const ALLOWED_CODICONS = new Set([
  'add',
  'archive',
  'beaker',
  'check',
  'clear-all',
  'close',
  'debug-disconnect',
  'debug-pause',
  'debug-start',
  'edit',
  'filter',
  'folder-opened',
  'folder-library',
  'export',
  'git-branch',
  'git-merge',
  'history',
  'layout',
  'link',
  'link-external',
  'library',
  'open-preview',
  'pulse',
  'repo',
  'refresh',
  'search',
  'settings-gear',
  'symbol-keyword',
  'sync',
  'terminal',
  'trash',
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
  for (const term of ['Jira work', 'Claude terminals', 'project changes', 'merge requests', 'builds', 'quality checks']) {
    if (!description.toLowerCase().includes(term.toLowerCase())) {
      fail(`description must explain the ${term} product surface.`);
    }
  }
  if (!/never submit terminal input automatically/i.test(description)) {
    fail('description must explain that actions never submit terminal input automatically.');
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
  const settingsCopy = settingIds.flatMap(id => {
    const setting = properties?.[id];
    return [setting?.description, ...(Array.isArray(setting?.enumDescriptions) ? setting.enumDescriptions : [])]
      .filter(value => typeof value === 'string');
  }).join('\n');
  if (/\bbounded\b|schemaVersion|live polling|permission-policy|monitored work session|manifest files?/i.test(settingsCopy)) {
    fail('configuration descriptions must use concise product language instead of internal implementation terms.');
  }

  for (const id of EXPECTED_SETTINGS.slice(0, 2)) {
    const setting = properties?.[id];
    if (setting?.type !== 'number' || typeof setting.default !== 'number' || setting.minimum !== 15) {
      fail(`${id} must be a numeric interval with a numeric default and a 15-second minimum.`);
    }
  }
  const roots = properties?.['kronos.projectDiscoveryRoots'];
  if (roots?.type !== 'array' || roots?.items?.type !== 'string'
    || JSON.stringify(roots.default) !== '[]' || roots?.scope !== 'machine') {
    fail('kronos.projectDiscoveryRoots must be a machine-scoped string array with an empty default.');
  }
  const depth = properties?.['kronos.projectDiscoveryDepth'];
  if (depth?.type !== 'integer' || depth?.default !== 2 || depth?.minimum !== 0 || depth?.maximum !== 5) {
    fail('kronos.projectDiscoveryDepth must be an integer from 0 through 5 and default to 2.');
  }
  const limit = properties?.['kronos.projectDiscoveryLimit'];
  if (limit?.type !== 'integer' || limit?.default !== 100 || limit?.minimum !== 1 || limit?.maximum !== 500) {
    fail('kronos.projectDiscoveryLimit must be an integer from 1 through 500 and default to 100.');
  }
  if (properties?.['kronos.hideCompletedJiraWork']?.type !== 'boolean'
    || properties?.['kronos.hideCompletedJiraWork']?.default !== true) {
    fail('kronos.hideCompletedJiraWork must be boolean and default to true.');
  }
  const statuses = properties?.['kronos.completedJiraStatuses'];
  if (statuses?.type !== 'array' || statuses?.items?.type !== 'string'
    || JSON.stringify(statuses.default) !== '[]') {
    fail('kronos.completedJiraStatuses must be a string array with an empty default.');
  }
  const localPromptPaths = properties?.['kronos.promptLibraryLocalPaths'];
  if (localPromptPaths?.type !== 'array' || localPromptPaths?.items?.type !== 'string'
    || JSON.stringify(localPromptPaths.default) !== '[]' || localPromptPaths?.scope !== 'machine') {
    fail('kronos.promptLibraryLocalPaths must be a machine-scoped string array with an empty default.');
  }
  const remotePromptUrls = properties?.['kronos.promptLibraryRemoteManifestUrls'];
  if (remotePromptUrls?.type !== 'array' || remotePromptUrls?.items?.type !== 'string'
    || JSON.stringify(remotePromptUrls.default) !== '[]') {
    fail('kronos.promptLibraryRemoteManifestUrls must be a string array with an empty default.');
  }
  if (properties?.['kronos.claudeCommand']?.type !== 'string'
    || properties?.['kronos.claudeCommand']?.default !== 'claude'
    || properties?.['kronos.claudeCommand']?.scope !== 'machine') {
    fail('kronos.claudeCommand must be machine-scoped and default to the validated claude command.');
  }
  const permissionMode = properties?.['kronos.claudePermissionMode'];
  if (permissionMode?.type !== 'string' || permissionMode?.default !== 'default'
    || permissionMode?.scope !== 'machine'
    || JSON.stringify(permissionMode?.enum) !== JSON.stringify([
      'default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions',
    ])) {
    fail('kronos.claudePermissionMode must expose the six typed Claude launch modes and default to manual/default.');
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
  const viewTitleItems = Array.isArray(menus?.['view/title']) ? menus['view/title'] : [];
  checkExactOrderedValues(
    'view-title action hierarchy',
    viewTitleItems.map(item => `${item?.command}|${item?.when}|${item?.group}`),
    EXPECTED_VIEW_TITLE_ITEMS,
  );
  const primaryByView = new Map(EXPECTED_VIEWS.map(view => [view.id, []]));
  for (const item of viewTitleItems.filter(item => String(item?.group || '').startsWith('navigation@'))) {
    const match = /^view == ([A-Za-z0-9_.-]+)$/.exec(String(item?.when || ''));
    if (match && primaryByView.has(match[1])) { primaryByView.get(match[1]).push(item.command); }
  }
  for (const [view, commands] of primaryByView) {
    if (commands.length > 3) { fail(`${view} exposes ${commands.length} primary toolbar icons; the audited maximum is 3.`); }
  }
  if (viewTitleItems.some(item => item?.command === 'kronos.configureProjectDiscoveryFolders')) {
    fail('project discovery-folder selection belongs in Setup, not a repeated view toolbar button.');
  }

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
    [/read configured provider data/i, 'reads configured provider data'],
    [/save local context/i, 'saves local context'],
    [/requires an explicit action and never presses Enter/i, 'adds context only after an explicit action and never presses Enter'],
    [/(?:Claude launch is disabled in untrusted workspaces|In untrusted workspaces, Claude launch is disabled)/i, 'disables Claude launch in untrusted workspaces'],
    [/never .*runs project commands/i, 'never runs project commands'],
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
    for (const match of source.matchAll(/\broute\(\s*['"](kronos\.[^'"]+)['"]/g)) {
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
