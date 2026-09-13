const { builtinModules } = require('node:module');

const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.flatMap(specifier => (
    specifier.startsWith('node:')
      ? [specifier, specifier.slice('node:'.length)]
      : [specifier, `node:${specifier}`]
  )),
);

/**
 * Returns a failure message when a source import falls outside Kronos's
 * runtime boundary: relative modules, Node built-ins, and the VS Code API.
 */
function runtimeImportPolicyFailure(specifier) {
  if (typeof specifier !== 'string' || !specifier.trim()) {
    return 'runtime import must have a non-empty module specifier';
  }
  if (specifier.startsWith('.')) { return undefined; }
  if (specifier === 'vscode' || NODE_BUILTIN_SPECIFIERS.has(specifier)) { return undefined; }
  return `third-party runtime import ${JSON.stringify(specifier)} is not allowed`;
}

module.exports = { runtimeImportPolicyFailure };
