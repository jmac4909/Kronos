const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const commandRouter = require('../out/services/terminalFirstCommandRouter.js');

test('command router exactly matches the manifest and dispatches each responsibility once', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.match(manifest.scripts.test, /npm run command:routing/);
  const manifestIds = manifest.contributes.commands.map(command => command.command).sort();
  const inventory = commandRouter.terminalFirstCommandRouteInventory();
  const routeIds = inventory.map(route => route.id).sort();
  assert.deepEqual(routeIds, manifestIds);
  assert.equal(new Set(routeIds).size, routeIds.length);
  assert.deepEqual([...new Set(inventory.map(route => route.area))].sort(), [
    'attention',
    'context',
    'operations',
    'projects',
    'sessions',
    'terminals',
    'work',
  ]);

  const calls = [];
  const handlers = commandHandlers(inventory, calls);
  const registered = [];
  const disposables = commandRouter.registerTerminalFirstCommands(handlers, (id, handler) => {
    registered.push({ id, handler });
    return { dispose() {} };
  });
  assert.equal(disposables.length, manifestIds.length);
  assert.deepEqual(registered.map(item => item.id).sort(), manifestIds);

  const argument = Object.freeze({ fixture: true });
  for (const item of registered) { await item.handler(argument); }
  assert.deepEqual(calls, inventory.map(route => ({
    route: `${route.area}.${route.action}`,
    args: [argument],
  })));
});

test('command router fails closed when a responsibility handler is missing', () => {
  const inventory = commandRouter.terminalFirstCommandRouteInventory();
  const handlers = commandHandlers(inventory, []);
  delete handlers.projects.openProjectMergeRequest;
  assert.throws(
    () => commandRouter.registerTerminalFirstCommands(handlers, () => ({ dispose() {} })),
    /openProjectMergeRequest handler/,
  );
});

test('runtime dependency surface is Node and VS Code only', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dependencies || {}, {});
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  assert.deepEqual(lock.packages[''].dependencies || {}, {});
  const runtime = fs.readFileSync(path.join(root, 'src', 'terminalFirstExtension.ts'), 'utf8');
  const router = fs.readFileSync(path.join(root, 'src', 'services', 'terminalFirstCommandRouter.ts'), 'utf8');
  assert.doesNotMatch(runtime, /child_process|createTerminal|terminal\.dispose\s*\(/);
  assert.equal((runtime.match(/registerCommand\(/g) || []).length, 1, 'runtime delegates through one audited registrar');
  assert.equal((router.match(/route\('kronos\./g) || []).length, 42, 'router owns the exact command inventory');
  assert.equal(crypto.createHash('sha256').update(runtime).update(router).digest('hex').length, 64);
});

function commandHandlers(inventory, calls) {
  const handlers = {};
  for (const route of inventory) {
    handlers[route.area] ||= {};
    handlers[route.area][route.action] = (...args) => {
      calls.push({ route: `${route.area}.${route.action}`, args });
    };
  }
  return handlers;
}
