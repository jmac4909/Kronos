import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

export const DEFAULT_CLAUDE_COMMAND = 'claude';
export const DEFAULT_CLAUDE_TERMINAL_NAME = 'Claude';

const MAX_COMMAND_LENGTH = 512;
const MAX_TERMINAL_NAME_LENGTH = 80;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
// Keep the executable PATH-resolved and shell-neutral. Paths are deliberately
// rejected because separators and cmd.exe %NAME% expansion are shell-specific.
const SAFE_EXECUTABLE_TOKEN_PATTERN = /^[A-Za-z0-9_.-]+$/;
// Backslashes are intentionally excluded: interactive shells can consume them
// as escapes and turn an apparently different token into a blocked flag.
const SAFE_ARGUMENT_TOKEN_PATTERN = /^[A-Za-z0-9_@+./:=,~-]+$/;
const CLAUDE_EXECUTABLE_BASENAME_PATTERN = /^claude(?:-[A-Za-z0-9_.-]+)?(?:\.(?:exe|cmd|bat))?$/i;
const APPROVED_INTERACTIVE_BOOLEAN_FLAGS = new Set([
  '--ax-screen-reader',
  '--disable-slash-commands',
  '--ide',
  '--no-chrome',
  '--safe-mode',
  '--verbose',
]);
const APPROVED_INTERACTIVE_VALUE_FLAGS = new Set(['--effort', '--model', '--permission-mode']);
const APPROVED_EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max', 'ultracode']);
const APPROVED_PERMISSION_MODES = new Set(['default', 'manual', 'plan']);
const MODEL_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export interface ClaudeTerminalLaunchInput {
  command?: unknown;
  name?: unknown;
  cwd?: unknown;
}

export interface NormalizedClaudeTerminalLaunch {
  command: string;
  name: string;
  cwd?: string;
}

export type ClaudeTerminalFactory = Pick<typeof vscode.window, 'createTerminal'>;

export interface ClaudeTerminalLaunchResult {
  terminal: vscode.Terminal;
  configuration: NormalizedClaudeTerminalLaunch;
}

export interface ClaudeExecutableAvailability {
  executable: string;
  available: boolean;
}

/**
 * Creates and focuses a VS Code terminal, then explicitly executes the validated
 * Claude command. Nothing happens until an operator command calls this function.
 */
export function launchClaudeTerminal(
  factory: ClaudeTerminalFactory,
  input: ClaudeTerminalLaunchInput = {},
): ClaudeTerminalLaunchResult {
  const configuration = normalizeClaudeTerminalLaunch(input);
  const terminalOptions: vscode.TerminalOptions = { name: configuration.name };
  if (configuration.cwd) { terminalOptions.cwd = configuration.cwd; }

  const terminal = factory.createTerminal(terminalOptions);
  terminal.show(false);
  terminal.sendText(configuration.command, true);
  return { terminal, configuration };
}

export function normalizeClaudeTerminalLaunch(
  input: ClaudeTerminalLaunchInput = {},
): NormalizedClaudeTerminalLaunch {
  const command = normalizeClaudeCommand(input.command);
  const name = normalizeTerminalName(input.name);
  const cwd = normalizeLaunchCwd(input.cwd);
  const normalized: NormalizedClaudeTerminalLaunch = { command, name };
  if (cwd) { normalized.cwd = cwd; }
  return normalized;
}

/** Captures ticket/project branch context once for the terminal created at launch. */
export function buildClaudeTerminalTitle(baseNameValue: unknown, ticketKey?: string, branchValue?: unknown): string {
  const baseName = normalizeTerminalName(baseNameValue);
  const branch = singleLine(branchValue, 500);
  const context = ticketKey
    ? `${ticketKey}${branch ? ` @ ${branch}` : ''}`
    : branch;
  if (!context) { return baseName; }
  const separator = ticketKey ? ' · ' : ' @ ';
  const maximumContextLength = Math.max(1, MAX_TERMINAL_NAME_LENGTH - separator.length - 1);
  const boundedContext = context.length > maximumContextLength
    ? `${context.slice(0, Math.max(1, maximumContextLength - 1))}…`
    : context;
  const maximumBaseLength = Math.max(1, MAX_TERMINAL_NAME_LENGTH - separator.length - boundedContext.length);
  return `${baseName.slice(0, maximumBaseLength)}${separator}${boundedContext}`;
}

/** Checks the extension-host PATH without executing the configured command. */
export function probeClaudeExecutableAvailability(
  command: unknown = DEFAULT_CLAUDE_COMMAND,
  environment: NodeJS.ProcessEnv = process.env,
): ClaudeExecutableAvailability {
  const normalizedCommand = normalizeClaudeCommand(command);
  const executable = normalizedCommand.split(' ', 1)[0] || DEFAULT_CLAUDE_COMMAND;
  const pathValue = environmentValue(environment, 'PATH');
  if (!pathValue) { return { executable, available: false }; }

  const names = executableCandidateNames(executable, environment);
  const accessMode = process.platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  for (const rawDirectory of pathValue.split(path.delimiter)) {
    const unquoted = rawDirectory.trim().replace(/^"(.*)"$/, '$1');
    const directory = unquoted || process.cwd();
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (!fs.statSync(candidate).isFile()) { continue; }
        fs.accessSync(candidate, accessMode);
        return { executable, available: true };
      } catch {
        // Keep searching the remaining PATH candidates.
      }
    }
  }
  return { executable, available: false };
}

function normalizeClaudeCommand(value: unknown): string {
  const candidate = value === undefined ? DEFAULT_CLAUDE_COMMAND : value;
  if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Claude command must be a non-empty string no longer than ${MAX_COMMAND_LENGTH} characters.`);
  }
  if (CONTROL_PATTERN.test(candidate)) {
    throw new Error('Claude command must be a single line without control characters.');
  }

  const tokens = candidate.trim().split(/\s+/);
  const executable = tokens[0];
  if (!executable
    || !SAFE_EXECUTABLE_TOKEN_PATTERN.test(executable)
    || !/[A-Za-z0-9]/.test(executable)
    || executable.startsWith('-')) {
    throw new Error('Claude command executable contains unsupported shell syntax.');
  }
  if (!CLAUDE_EXECUTABLE_BASENAME_PATTERN.test(executable)) {
    throw new Error('Claude command executable must resolve to claude or a claude-* wrapper.');
  }
  const argumentsList = tokens.slice(1);
  if (argumentsList.some(token => !SAFE_ARGUMENT_TOKEN_PATTERN.test(token))) {
    throw new Error('Claude command arguments contain unsupported shell syntax.');
  }
  validateApprovedInteractiveArguments(argumentsList);
  return tokens.join(' ');
}

function validateApprovedInteractiveArguments(argumentsList: readonly string[]): void {
  for (let index = 0; index < argumentsList.length; index += 1) {
    const token = argumentsList[index] || '';
    const equalsIndex = token.indexOf('=');
    const flag = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
    const attachedValue = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : undefined;

    if (APPROVED_INTERACTIVE_BOOLEAN_FLAGS.has(flag)) {
      if (attachedValue !== undefined) {
        throw new Error(`Claude command flag ${flag} does not accept a value.`);
      }
      continue;
    }
    if (!APPROVED_INTERACTIVE_VALUE_FLAGS.has(flag)) {
      throw new Error('Claude command accepts only approved interactive flags and no positional prompts or subcommands.');
    }

    const value = attachedValue === undefined ? argumentsList[index + 1] : attachedValue;
    if (attachedValue === undefined) { index += 1; }
    if (!value || value.startsWith('-')) {
      throw new Error(`Claude command flag ${flag} requires an approved value.`);
    }
    if (flag === '--model' && !MODEL_VALUE_PATTERN.test(value)) {
      throw new Error('Claude model must be a shell-inert alias or full model identifier.');
    }
    if (flag === '--effort' && !APPROVED_EFFORT_VALUES.has(value)) {
      throw new Error('Claude effort must be low, medium, high, xhigh, max, or ultracode.');
    }
    if (flag === '--permission-mode' && !APPROVED_PERMISSION_MODES.has(value)) {
      throw new Error('Claude permission mode may only be default, manual, or plan.');
    }
  }
}

function normalizeTerminalName(value: unknown): string {
  const candidate = value === undefined ? DEFAULT_CLAUDE_TERMINAL_NAME : value;
  if (typeof candidate !== 'string' || CONTROL_PATTERN.test(candidate)) {
    throw new Error('Claude terminal name must be a single-line string.');
  }
  const normalized = candidate.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > MAX_TERMINAL_NAME_LENGTH) {
    throw new Error(`Claude terminal name must be between 1 and ${MAX_TERMINAL_NAME_LENGTH} characters.`);
  }
  return normalized;
}

function singleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeLaunchCwd(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  if (typeof value !== 'string' || CONTROL_PATTERN.test(value) || !value.trim()) {
    throw new Error('Claude terminal working directory must be a valid absolute path.');
  }
  const resolved = path.resolve(value.trim());
  if (!path.isAbsolute(value.trim())) {
    throw new Error('Claude terminal working directory must be absolute.');
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolved);
  } catch {
    throw new Error('Claude terminal working directory does not exist or cannot be read.');
  }
  if (!stat.isDirectory()) {
    throw new Error('Claude terminal working directory must be a directory.');
  }
  return resolved;
}

function executableCandidateNames(executable: string, environment: NodeJS.ProcessEnv): string[] {
  if (process.platform !== 'win32' || path.extname(executable)) { return [executable]; }
  const pathExtensions = environmentValue(environment, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD';
  const extensions = pathExtensions.split(';')
    .map(extension => extension.trim())
    .filter(extension => /^\.[A-Za-z0-9]+$/.test(extension));
  return [executable, ...extensions.map(extension => `${executable}${extension.toLocaleLowerCase()}`),
    ...extensions.map(extension => `${executable}${extension.toLocaleUpperCase()}`)];
}

function environmentValue(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  for (const [key, value] of Object.entries(environment)) {
    if (key.toLocaleUpperCase() === name && typeof value === 'string' && value) { return value; }
  }
  return undefined;
}
