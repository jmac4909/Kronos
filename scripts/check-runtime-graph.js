const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src');
const entry = path.join(sourceRoot, 'extension.ts');
const sourceFiles = listFiles(sourceRoot, '.ts');
const sourceSet = new Set(sourceFiles);
const failures = [];
const graph = new Map(sourceFiles.map(filePath => [filePath, sourceDependencies(filePath)]));

const reachable = collectReachable(entry, graph);
for (const filePath of sourceFiles) {
  if (!reachable.has(filePath)) { fail(`Source module is not reachable from src/extension.ts: ${relative(filePath)}`); }
}
for (const cycle of dependencyCycles(graph)) {
  fail(`Source dependency cycle: ${cycle.map(relative).join(' -> ')}`);
}
checkDeadExports();

if (failures.length > 0) {
  console.error(`Kronos source graph failed (${failures.length} problem${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) { console.error(`- ${failure}`); }
  process.exitCode = 1;
} else {
  console.log(`Kronos source graph OK (${sourceFiles.length} reachable modules, no cycles or dead runtime exports).`);
}

function listFiles(directory, extension) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap(entryValue => {
      const filePath = path.join(directory, entryValue.name);
      if (entryValue.isDirectory()) { return listFiles(filePath, extension); }
      return entryValue.isFile() && entryValue.name.endsWith(extension) ? [filePath] : [];
    })
    .sort();
}

function sourceDependencies(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const references = ts.preProcessFile(source, true, true).importedFiles;
  const dependencies = [];
  for (const reference of references) {
    if (!reference.fileName.startsWith('.')) { continue; }
    const base = path.resolve(path.dirname(filePath), reference.fileName);
    const resolved = [base, `${base}.ts`, path.join(base, 'index.ts')].find(candidate => sourceSet.has(candidate));
    if (!resolved) {
      fail(`Unresolved relative source import in ${relative(filePath)}: ${reference.fileName}`);
      continue;
    }
    dependencies.push(resolved);
  }
  return [...new Set(dependencies)].sort();
}

function collectReachable(start, dependencyGraph) {
  const visited = new Set();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) { continue; }
    visited.add(current);
    pending.push(...(dependencyGraph.get(current) || []));
  }
  return visited;
}

function dependencyCycles(dependencyGraph) {
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  const cycles = [];
  const cycleKeys = new Set();
  const visit = filePath => {
    if (visited.has(filePath)) { return; }
    if (visiting.has(filePath)) {
      const startIndex = stack.indexOf(filePath);
      const cycle = [...stack.slice(startIndex), filePath];
      const key = [...new Set(cycle)].sort().join('|');
      if (!cycleKeys.has(key)) { cycleKeys.add(key); cycles.push(cycle); }
      return;
    }
    visiting.add(filePath);
    stack.push(filePath);
    for (const dependency of dependencyGraph.get(filePath) || []) { visit(dependency); }
    stack.pop();
    visiting.delete(filePath);
    visited.add(filePath);
  };
  for (const filePath of dependencyGraph.keys()) { visit(filePath); }
  return cycles;
}

function checkDeadExports() {
  const configPath = path.join(root, 'tsconfig.json');
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  if (configFile.error) {
    fail(`Could not read tsconfig.json: ${formatDiagnostic(configFile.error)}`);
    return;
  }
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const checker = program.getTypeChecker();
  const referenceCounts = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceSet.has(path.resolve(sourceFile.fileName))) { continue; }
    walk(sourceFile, node => {
      if (!ts.isIdentifier(node)) { return; }
      const symbol = canonicalSymbol(checker.getSymbolAtLocation(node), checker);
      if (symbol) { referenceCounts.set(symbol, (referenceCounts.get(symbol) || 0) + 1); }
    });
  }
  const scriptIdentifiers = externalScriptIdentifiers();
  const allowedDynamicExports = new Set([
    `${path.normalize('src/extension.ts')}:activate`,
    `${path.normalize('src/extension.ts')}:deactivate`,
    `${path.normalize('src/terminalFirstExtension.ts')}:activate`,
    `${path.normalize('src/terminalFirstExtension.ts')}:deactivate`,
  ]);
  for (const sourceFile of program.getSourceFiles()) {
    const absolutePath = path.resolve(sourceFile.fileName);
    if (!sourceSet.has(absolutePath)) { continue; }
    for (const declaration of runtimeExportDeclarations(sourceFile)) {
      const symbol = canonicalSymbol(checker.getSymbolAtLocation(declaration.name), checker);
      if (!symbol || (referenceCounts.get(symbol) || 0) > 1 || scriptIdentifiers.has(declaration.name.text)) { continue; }
      const key = `${relative(absolutePath)}:${declaration.name.text}`;
      if (!allowedDynamicExports.has(key)) {
        const line = sourceFile.getLineAndCharacterOfPosition(declaration.name.getStart()).line + 1;
        fail(`Exported runtime value has no caller: ${key}:${line}`);
      }
    }
  }
}

function runtimeExportDeclarations(sourceFile) {
  const declarations = [];
  for (const statement of sourceFile.statements) {
    if (!statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) { continue; }
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) {
      declarations.push(statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) { declarations.push(declaration); }
      }
    }
  }
  return declarations;
}

function externalScriptIdentifiers() {
  const identifiers = new Set();
  for (const filePath of listFiles(path.join(root, 'scripts'), '.js')) {
    if (path.basename(filePath) === 'check-runtime-graph.js') { continue; }
    const sourceFile = ts.createSourceFile(filePath, fs.readFileSync(filePath, 'utf8'), ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    walk(sourceFile, node => { if (ts.isIdentifier(node)) { identifiers.add(node.text); } });
  }
  return identifiers;
}

function canonicalSymbol(symbol, checker) {
  return symbol && (symbol.flags & ts.SymbolFlags.Alias) ? checker.getAliasedSymbol(symbol) : symbol;
}

function walk(node, visitor) {
  visitor(node);
  ts.forEachChild(node, child => walk(child, visitor));
}

function formatDiagnostic(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
}

function relative(filePath) {
  return path.normalize(path.relative(root, filePath));
}

function fail(message) { failures.push(message); }
