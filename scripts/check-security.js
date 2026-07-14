const fs = require('fs');
const path = require('path');

const ENTRY_FILE = 'src/extension.ts';
const TERMINAL_FIRST_RUNTIME_FILE = 'src/terminalFirstExtension.ts';
const TERMINAL_INSERTION_FILE = 'src/services/terminalContextInsertion.ts';
const CLAUDE_LAUNCHER_FILE = 'src/services/claudeTerminalLauncher.ts';
const PACKAGED_WEBVIEW_FILES = [
  'media/kronos-action-panel.js',
  'media/kronos-jira-work-board.js',
  'media/kronos-webview-runtime.js',
];
const LAUNCH_MODULES = new Set([
  'child_process',
  'node:child_process',
  'cross-spawn',
  'execa',
  'shelljs',
]);
const GIT_AUTOMATION_MODULES = new Set([
  'isomorphic-git',
  'nodegit',
  'simple-git',
]);
const FORBIDDEN_RUNTIME_BRIDGES = new Map([
  ['src/runners/sessionDispatcher.ts', ['NO_LAUNCH', 'agent and terminal dispatcher']],
  ['src/services/cliProbes.ts', ['NO_LAUNCH', 'CLI process probe bridge']],
  ['src/services/processTree.ts', ['NO_LAUNCH', 'process-control bridge']],
  ['src/services/scriptClient.ts', ['NO_LAUNCH', 'external script process bridge']],
  ['src/services/stateScriptAdapter.ts', ['NO_LAUNCH', 'external state-script adapter']],
  ['src/services/gitWorkspace.ts', ['NO_GIT_MUTATION', 'Git workspace mutation bridge']],
  ['src/services/worktreeRegistry.ts', ['NO_GIT_MUTATION', 'Git worktree mutation bridge']],
  ['src/services/evidencePublisher.ts', ['NO_PROVIDER_MUTATION', 'provider evidence publisher']],
]);
const FORBIDDEN_LEGACY_WEBVIEW_PATTERNS = [
  {
    pattern: /\b(?:runId|planId|itemId|recoveryAction|runlessCommands)\b/g,
    message: 'contains a legacy run, plan, item, or recovery webview field.',
  },
  {
    pattern: /\b(?:BoardWebviewMessage|RunCenterActionRequest|normalizeBoardMessage|normalizeRunCenterMessage)\b/g,
    message: 'contains a legacy board or Run Center message surface.',
  },
  {
    pattern: /\b(?:operatorDecisionBrief|operatorCommandRow|kronosOperatorPanelCss)\b/g,
    message: 'contains a legacy operator scoring or command-panel helper.',
  },
  {
    pattern: /data-(?:run-id|plan-id|item-id|recovery-action)|score-grid|operator-hero\s+\.score/g,
    message: 'contains legacy run metadata or scoring markup.',
  },
];

const violations = [];
const seenViolations = new Set();
const runtimeFiles = collectReachableRuntime(ENTRY_FILE);

for (const [file, source] of runtimeFiles) {
  const code = maskComments(source);
  checkForbiddenBridge(file, source);
  checkLaunchBoundary(file, source, code);
  checkTerminalSubmissionBoundary(file, source, code);
  checkProviderMutationBoundary(file, source, code);
  checkGitMutationBoundary(file, source, code);
  checkTerminalOwnershipBoundary(file, source, code);
  checkCleanBreakBoundary(file, source, code);
}

checkTerminalInsertionContract();
checkClaudeLauncherContract();
checkFocusedInsertionContract();
checkPackagedWebviewAssets();

violations.sort((left, right) => left.file.localeCompare(right.file)
  || left.line - right.line
  || left.rule.localeCompare(right.rule));

if (violations.length > 0) {
  console.error(`Kronos terminal-first runtime boundary failed (${violations.length} violation${violations.length === 1 ? '' : 's'}):`);
  for (const violation of violations) {
    const location = violation.file === '<runtime>' ? violation.file : `${violation.file}:${violation.line}`;
    console.error(`- [${violation.rule}] ${location} — ${violation.message}`);
    if (violation.snippet) { console.error(`  ${violation.snippet}`); }
  }
  console.error('Allowed runtime behavior is limited to provider reads, inert context insertion, monitoring, local audit/context records, operator-selected terminal focus, and explicit validated Claude launch.');
  process.exitCode = 1;
} else {
  console.log(`Kronos terminal-first security boundary OK (${runtimeFiles.size} reachable runtime files checked).`);
}

function checkForbiddenBridge(file, source) {
  const forbidden = FORBIDDEN_RUNTIME_BRIDGES.get(file);
  if (!forbidden) { return; }
  addViolation(forbidden[0], file, source, 0, `reachable runtime imports the legacy ${forbidden[1]}.`);
}

function checkLaunchBoundary(file, source, code) {
  for (const entry of moduleSpecifiers(code)) {
    if (entry.typeOnly) { continue; }
    if (LAUNCH_MODULES.has(entry.specifier)) {
      addViolation('NO_LAUNCH', file, source, entry.index, `imports process-launch module ${entry.specifier}.`);
    }
    if (GIT_AUTOMATION_MODULES.has(entry.specifier)) {
      addViolation('NO_GIT_MUTATION', file, source, entry.index, `imports Git automation module ${entry.specifier}.`);
    }
  }

  for (const call of findMethodCalls(code, 'createTerminal')) {
    if (file !== CLAUDE_LAUNCHER_FILE) {
      addViolation('NO_LAUNCH', file, source, call.index,
        'creates a terminal outside the single explicit Claude-launch service.');
    }
  }
  scanPattern(file, source, code, /\bvscode\.tasks\.executeTask\s*\(/g, 'NO_LAUNCH',
    'executes a VS Code task.');
  scanPattern(file, source, code, /\bnew\s+vscode\.(?:ShellExecution|ProcessExecution)\s*\(/g, 'NO_LAUNCH',
    'constructs a workspace command execution.');
  scanPattern(file, source, code, /\b(?:Deno\.Command|Bun\.(?:spawn|spawnSync))\s*\(/g, 'NO_LAUNCH',
    'launches an external process.');
  scanPattern(
    file,
    source,
    code,
    /(?<![.\w$])(?:exec|execFile|execFileSync|execSync|spawn|spawnSync|fork)\s*\(/g,
    'NO_LAUNCH',
    'invokes a process-launch primitive.',
  );
  scanPattern(
    file,
    source,
    code,
    /['"]workbench\.action\.(?:terminal\.(?:new|sendSequence|runActiveFile|runSelectedText)|tasks\.runTask)['"]/g,
    'NO_LAUNCH',
    'invokes a VS Code terminal/task launch command.',
  );
  scanPattern(file, source, code, /\bterminal\.shellIntegration\.executeCommand\s*\(/g, 'NO_LAUNCH',
    'executes a shell integration command.');
}

function checkTerminalSubmissionBoundary(file, source, code) {
  for (const call of findMethodCalls(code, 'sendText')) {
    const args = splitTopLevelArguments(call.argumentsText);
    if (file === TERMINAL_INSERTION_FILE) {
      if (args.length !== 2 || args[1].trim() !== 'false') {
        addViolation('NO_SUBMIT', file, source, call.index,
          'terminal context insertion must pass false explicitly as sendText\'s shouldExecute argument.');
      }
      continue;
    }
    if (file === CLAUDE_LAUNCHER_FILE) {
      if (args.length !== 2 || args[0].trim() !== 'configuration.command' || args[1].trim() !== 'true') {
        addViolation('EXPLICIT_CLAUDE_LAUNCH', file, source, call.index,
          'Claude launch must submit only the validated configuration.command with shouldExecute true.');
      }
      continue;
    }
    {
      addViolation('NO_SUBMIT', file, source, call.index,
        'writes to a terminal outside the inert insertion and explicit Claude-launch services.');
    }
  }
  scanPattern(file, source, code, /\[['"]sendText['"]\]\s*\(/g, 'NO_SUBMIT',
    'uses bracket notation to bypass the audited terminal insertion call.');
  scanPattern(file, source, code, /['"]workbench\.action\.terminal\.sendSequence['"]/g, 'NO_SUBMIT',
    'submits terminal input through a VS Code command.');
}

function checkProviderMutationBoundary(file, source, code) {
  scanPattern(
    file,
    source,
    code,
    /(['"`])(?:POST|PUT|PATCH|DELETE)\1/gi,
    'NO_PROVIDER_MUTATION',
    match => `contains forbidden provider/HTTP mutation method ${match[0]}.`,
  );
  scanPattern(
    file,
    source,
    code,
    /\b(?:async\s+)?(?:triggerBuild|retryBuild|cancelBuild|retryPipeline|cancelPipeline|playJob|mergeMergeRequest|approveMergeRequest|addComment|createComment|updateIssue|transitionIssue|createIssue|deleteIssue|publishEvidence)\s*\(/gi,
    'NO_PROVIDER_MUTATION',
    match => `defines or invokes provider mutation operation ${match[0].trim()}.`,
  );
  scanPattern(
    file,
    source,
    code,
    /\b(?:axios|got|httpClient|restClient|apiClient|jiraClient|gitlabClient|jenkinsClient|sonarClient)\.(?:post|put|patch|delete)\s*\(/gi,
    'NO_PROVIDER_MUTATION',
    'invokes a mutating provider client method.',
  );
  scanPattern(file, source, code, /\bmutation\s+(?:[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?\s*)?\{/g, 'NO_PROVIDER_MUTATION',
    'contains a GraphQL mutation.');
  scanPattern(
    file,
    source,
    code,
    /\b(?:INSERT\s+INTO|UPDATE\s+[A-Za-z0-9_."`]+\s+SET|DELETE\s+FROM|MERGE\s+INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/gi,
    'NO_PROVIDER_MUTATION',
    'contains a database mutation statement.',
  );
}

function checkGitMutationBoundary(file, source, code) {
  scanPattern(
    file,
    source,
    code,
    /\bgit\s+(?:add|am|apply|bisect|branch|checkout|cherry-pick|clean|clone|commit|fetch|merge|mv|pull|push|rebase|reset|restore|revert|rm|stash|switch|tag|worktree)\b/gi,
    'NO_GIT_MUTATION',
    match => `contains forbidden Git-changing command ${JSON.stringify(match[0])}.`,
  );
  scanPattern(file, source, code, /getExtension\(\s*['"]vscode\.git['"]\s*\)/g, 'NO_GIT_MUTATION',
    'loads the mutable VS Code Git API.');
  scanPattern(
    file,
    source,
    code,
    /['"]git\.(?:stage|unstage|commit|push|pull|publish|sync|checkout|branch|merge|rebase|clean|clone|stash|tag|fetch|cherryPick|revert)[^'"]*['"]/gi,
    'NO_GIT_MUTATION',
    'invokes a Git-changing VS Code command.',
  );
  scanPattern(
    file,
    source,
    code,
    /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|unlink|unlinkSync|rm|rmSync)\s*\([^\n]{0,240}['"`][^'"`]*\.git(?:[/\\]|['"`])/gi,
    'NO_GIT_MUTATION',
    'writes directly inside .git.',
  );
}

function checkTerminalOwnershipBoundary(file, source, code) {
  scanPattern(
    file,
    source,
    code,
    /\b(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$]*terminal[A-Za-z_$]*\.dispose\s*\(/gi,
    'NO_TERMINAL_CLOSE',
    'disposes an operator terminal; stopping management must never close the terminal.',
  );
}

function checkCleanBreakBoundary(file, source, code) {
  for (const forbidden of FORBIDDEN_LEGACY_WEBVIEW_PATTERNS) {
    scanPattern(file, source, code, forbidden.pattern, 'CLEAN_BREAK', forbidden.message);
  }
}

function checkPackagedWebviewAssets() {
  for (const file of PACKAGED_WEBVIEW_FILES) {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      addGlobalViolation('CLEAN_BREAK', `required packaged webview asset is missing: ${file}.`);
      continue;
    }
    const source = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    checkCleanBreakBoundary(file, source, maskComments(source));
  }
}

function checkTerminalInsertionContract() {
  const source = runtimeFiles.get(TERMINAL_INSERTION_FILE);
  if (!source) {
    addGlobalViolation('NO_SUBMIT', `${TERMINAL_INSERTION_FILE} must be reachable from ${ENTRY_FILE}.`);
    return;
  }
  const code = maskComments(source);
  const calls = findMethodCalls(code, 'sendText');
  if (calls.length !== 1) {
    addGlobalViolation('NO_SUBMIT', `${TERMINAL_INSERTION_FILE} must contain exactly one audited sendText call; found ${calls.length}.`);
  }
  if (!/\bassertSafeTerminalContextReference\(\s*reference\s*\)/.test(code)) {
    addGlobalViolation('NO_SUBMIT', `${TERMINAL_INSERTION_FILE} must validate the inert reference before insertion.`);
  }
}

function checkClaudeLauncherContract() {
  const source = runtimeFiles.get(CLAUDE_LAUNCHER_FILE);
  if (!source) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', `${CLAUDE_LAUNCHER_FILE} must be reachable from ${ENTRY_FILE}.`);
    return;
  }
  const code = maskComments(source);
  const createCalls = findMethodCalls(code, 'createTerminal');
  const sendCalls = findMethodCalls(code, 'sendText');
  if (createCalls.length !== 1) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', `${CLAUDE_LAUNCHER_FILE} must contain exactly one audited createTerminal call; found ${createCalls.length}.`);
  }
  if (sendCalls.length !== 1) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', `${CLAUDE_LAUNCHER_FILE} must contain exactly one audited sendText call; found ${sendCalls.length}.`);
  }
  if (!/const\s+configuration\s*=\s*normalizeClaudeTerminalLaunch\(input\)[\s\S]{0,800}createTerminal\(terminalOptions\)/.test(code)) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', 'Claude terminal options must be validated before the terminal is created.');
  }
  if (!/CLAUDE_EXECUTABLE_BASENAME_PATTERN[\s\S]{0,2400}must resolve to claude or a claude-\* wrapper/.test(source)) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', 'Claude launch must reject arbitrary executable names.');
  }
  if (!/APPROVED_INTERACTIVE_BOOLEAN_FLAGS[\s\S]{0,1600}APPROVED_INTERACTIVE_VALUE_FLAGS/.test(source)
    || !/validateApprovedInteractiveArguments\(argumentsList\)/.test(source)
    || !/accepts only approved interactive flags and no positional prompts or subcommands/.test(source)
    || !/APPROVED_PERMISSION_MODES\s*=\s*new Set\(\['default', 'manual', 'plan'\]\)/.test(source)) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', 'Claude launch must use a narrow interactive flag allowlist and reject positional commands.');
  }

  const runtimeSource = runtimeFiles.get(TERMINAL_FIRST_RUNTIME_FILE) || '';
  const runtimeCode = maskComments(runtimeSource);
  for (const command of ['kronos.newClaudeSession', 'kronos.startClaudeForTicket']) {
    if (!runtimeCode.includes(`this.command('${command}'`)) {
      addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', `${command} must be an explicit registered operator command.`);
    }
  }
  const launchCalls = [...runtimeCode.matchAll(/\bthis\.launchClaudeSession\s*\(/g)];
  if (launchCalls.length !== 2) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', `Claude session launch must be reachable only from the two explicit launch handlers; found ${launchCalls.length} calls.`);
  }
  if (!/private\s+canLaunchClaude\(\)[\s\S]{0,700}workspace\.isTrusted/.test(runtimeCode)) {
    addGlobalViolation('EXPLICIT_CLAUDE_LAUNCH', 'Explicit Claude launch must be blocked in untrusted workspaces.');
  }
}

function checkFocusedInsertionContract() {
  const source = runtimeFiles.get(TERMINAL_FIRST_RUNTIME_FILE);
  if (!source) {
    addGlobalViolation('NO_SUBMIT', `${TERMINAL_FIRST_RUNTIME_FILE} must be reachable from ${ENTRY_FILE}.`);
    return;
  }
  const focusedBindingContract = /private async chooseInsertionTerminal[\s\S]{0,2400}vscode\.window\.activeTerminal[\s\S]{0,2400}bindingForTerminal\(terminal\)[\s\S]{0,1600}binding\?\.sessionId !== session\.id/;
  if (!focusedBindingContract.test(maskComments(source))) {
    addGlobalViolation(
      'NO_SUBMIT',
      'context insertion must require the active terminal to carry the selected work session binding.',
    );
  }
}

function collectReachableRuntime(entryFile) {
  const root = process.cwd();
  const entry = path.resolve(root, entryFile);
  const pending = [entry];
  const visited = new Set();
  const result = new Map();

  while (pending.length > 0) {
    const absoluteFile = pending.pop();
    if (!absoluteFile || visited.has(absoluteFile)) { continue; }
    visited.add(absoluteFile);
    if (!fs.existsSync(absoluteFile) || !fs.statSync(absoluteFile).isFile()) {
      addGlobalViolation('RUNTIME_GRAPH', `reachable runtime file is missing: ${path.relative(root, absoluteFile)}.`);
      continue;
    }
    const file = path.relative(root, absoluteFile).replace(/\\/g, '/');
    const source = fs.readFileSync(absoluteFile, 'utf8').replace(/\r\n/g, '\n');
    result.set(file, source);
    for (const entry of moduleSpecifiers(maskComments(source))) {
      if (entry.typeOnly || !entry.specifier.startsWith('.')) { continue; }
      const resolved = resolveRelativeModule(absoluteFile, entry.specifier);
      if (resolved) {
        pending.push(resolved);
      } else {
        addViolation('RUNTIME_GRAPH', file, source, entry.index,
          `cannot resolve relative runtime import ${entry.specifier}.`);
      }
    }
  }
  return result;
}

function moduleSpecifiers(source) {
  const entries = [];
  const staticPattern = /^\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  const dynamicPattern = /(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(staticPattern)) {
    entries.push({ specifier: match[2], index: match.index || 0, typeOnly: Boolean(match[1]) });
  }
  for (const match of source.matchAll(dynamicPattern)) {
    entries.push({ specifier: match[1], index: match.index || 0, typeOnly: false });
  }
  return entries;
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

function findMethodCalls(source, methodName) {
  const calls = [];
  const pattern = new RegExp(`\\.${escapeRegExp(methodName)}\\s*\\(`, 'g');
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const openParen = source.indexOf('(', match.index);
    const closeParen = findMatchingParen(source, openParen);
    if (closeParen < 0) {
      calls.push({ index: match.index, argumentsText: source.slice(openParen + 1) });
      break;
    }
    calls.push({ index: match.index, argumentsText: source.slice(openParen + 1, closeParen) });
    pattern.lastIndex = closeParen + 1;
  }
  return calls;
}

function findMatchingParen(source, openParen) {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openParen; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) { return index; }
    }
  }
  return -1;
}

function splitTopLevelArguments(value) {
  const parts = [];
  let start = 0;
  let round = 0;
  let square = 0;
  let curly = 0;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '\'' || char === '"' || char === '`') { quote = char; continue; }
    if (char === '(') { round += 1; continue; }
    if (char === ')') { round -= 1; continue; }
    if (char === '[') { square += 1; continue; }
    if (char === ']') { square -= 1; continue; }
    if (char === '{') { curly += 1; continue; }
    if (char === '}') { curly -= 1; continue; }
    if (char === ',' && round === 0 && square === 0 && curly === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  const last = value.slice(start);
  if (last.trim() || parts.length > 0) { parts.push(last); }
  return parts;
}

function maskComments(source) {
  const chars = [...source];
  let state = 'code';
  let escaped = false;
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index];
    const next = chars[index + 1];
    if (state === 'line-comment') {
      if (char === '\n') { state = 'code'; } else { chars[index] = ' '; }
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        chars[index] = ' ';
        chars[index + 1] = ' ';
        index += 1;
        state = 'code';
      } else if (char !== '\n') {
        chars[index] = ' ';
      }
      continue;
    }
    if (state !== 'code') {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if ((state === 'single' && char === '\'')
        || (state === 'double' && char === '"')
        || (state === 'template' && char === '`')) {
        state = 'code';
      }
      continue;
    }
    if (char === '/' && next === '/') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'line-comment';
    } else if (char === '/' && next === '*') {
      chars[index] = ' ';
      chars[index + 1] = ' ';
      index += 1;
      state = 'block-comment';
    } else if (char === '\'') {
      state = 'single';
    } else if (char === '"') {
      state = 'double';
    } else if (char === '`') {
      state = 'template';
    }
  }
  return chars.join('');
}

function scanPattern(file, source, code, pattern, rule, message) {
  pattern.lastIndex = 0;
  let match;
  while ((match = pattern.exec(code)) !== null) {
    addViolation(rule, file, source, match.index,
      typeof message === 'function' ? message(match) : message);
    if (match[0].length === 0) { pattern.lastIndex += 1; }
  }
}

function addViolation(rule, file, source, index, message) {
  const line = lineNumberAt(source, index);
  const key = `${rule}|${file}|${line}|${message}`;
  if (seenViolations.has(key)) { return; }
  seenViolations.add(key);
  violations.push({
    rule,
    file,
    line,
    message,
    snippet: lineTextAt(source, index),
  });
}

function addGlobalViolation(rule, message) {
  const key = `${rule}|<runtime>|${message}`;
  if (seenViolations.has(key)) { return; }
  seenViolations.add(key);
  violations.push({ rule, file: '<runtime>', line: 0, message, snippet: '' });
}

function lineNumberAt(source, index) {
  return source.slice(0, Math.max(0, index)).split('\n').length;
}

function lineTextAt(source, index) {
  const start = source.lastIndexOf('\n', Math.max(0, index) - 1) + 1;
  const endIndex = source.indexOf('\n', Math.max(0, index));
  const end = endIndex < 0 ? source.length : endIndex;
  const text = source.slice(start, end).trim().replace(/\s+/g, ' ');
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
