import { execFile, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { unknownErrorField, unknownErrorMessage } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { definedValues } from './records';

const SCRIPTS_DIR = process.env['KRONOS_SCRIPTS_DIR'] || path.join(os.homedir(), '.claude', 'scripts');
const PYTHON = findPython();

export type RequiredScriptName = 'kronos_state.py' | 'pipeline_monitor.py' | 'gitlab_api.py';

export interface ScriptRunOptions {
  timeout?: number;
  maxBuffer?: number;
}

export interface ScriptHealth {
  name: RequiredScriptName;
  path: string;
  present: boolean;
}

class KronosScriptMissingError extends Error {
  readonly scriptName: RequiredScriptName;
  readonly filePath: string;

  constructor(scriptName: RequiredScriptName, filePath: string) {
    super(`${MISSING_SCRIPT_MESSAGE_PREFIX}${scriptName}. Run Kronos: Doctor for setup details.`);
    Object.setPrototypeOf(this, KronosScriptMissingError.prototype);
    this.name = 'KronosScriptMissingError';
    this.scriptName = scriptName;
    this.filePath = filePath;
  }
}

export function isKronosScriptMissingError(error: unknown): boolean {
  if (error instanceof KronosScriptMissingError) { return true; }
  if (typeof error === 'string') { return isKronosScriptMissingMessage(error); }
  if (!error || typeof error !== 'object') { return false; }
  const record = error as Record<string, unknown>;
  const structurallyMissing = record['name'] === 'KronosScriptMissingError'
    && isRequiredScriptName(record['scriptName'])
    && typeof record['filePath'] === 'string';
  return structurallyMissing || isKronosScriptMissingMessage(record['message']);
}

const DEFAULT_TIMEOUT = 60000;
const DEFAULT_BUFFER = 10 * 1024 * 1024;
const REQUIRED_SCRIPT_NAMES = new Set<RequiredScriptName>(['kronos_state.py', 'pipeline_monitor.py', 'gitlab_api.py']);
const MISSING_SCRIPT_MESSAGE_PREFIX = 'Kronos integration script unavailable: ';
const MISSING_SCRIPT_MESSAGE_SUFFIX = '. Run Kronos: Doctor for setup details.';

export function requiredScripts(): ScriptHealth[] {
  return Array.from(REQUIRED_SCRIPT_NAMES)
    .map(name => {
      const filePath = scriptPath(name);
      return { name, path: filePath, present: fs.existsSync(filePath) };
    });
}

function isRequiredScriptName(value: unknown): value is RequiredScriptName {
  return typeof value === 'string' && REQUIRED_SCRIPT_NAMES.has(value as RequiredScriptName);
}

function isKronosScriptMissingMessage(value: unknown): boolean {
  if (typeof value !== 'string') { return false; }
  if (value.startsWith(MISSING_SCRIPT_MESSAGE_PREFIX)) {
    return Array.from(REQUIRED_SCRIPT_NAMES).some(name => value === `${MISSING_SCRIPT_MESSAGE_PREFIX}${name}${MISSING_SCRIPT_MESSAGE_SUFFIX}`);
  }
  if (value.startsWith('Kronos script missing: ')) {
    const normalized = value.replace(/\\/g, '/');
    return Array.from(REQUIRED_SCRIPT_NAMES).some(name => normalized.endsWith(`/${name}`) || normalized.endsWith(name));
  }
  return false;
}

function scriptPath(scriptName: RequiredScriptName): string {
  return path.join(SCRIPTS_DIR, scriptName);
}

function runPythonScriptSync(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): string {
  const filePath = assertScriptAvailable(scriptName);
  try {
    return execFileSync(PYTHON, [filePath, ...args], {
      encoding: 'utf-8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? DEFAULT_BUFFER,
    });
  } catch (e: unknown) {
    throw scriptError(scriptName, args, e);
  }
}

function runPythonScript(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): Promise<string> {
  const filePath = assertScriptAvailable(scriptName);
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [filePath, ...args], {
      encoding: 'utf-8',
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      windowsHide: true,
      maxBuffer: options.maxBuffer ?? DEFAULT_BUFFER,
    }, (err, stdout) => {
      if (err) {
        reject(scriptError(scriptName, args, err));
      } else {
        resolve(String(stdout));
      }
    });
  });
}

async function runJsonScript<T = unknown>(scriptName: RequiredScriptName, args: string[], options: ScriptRunOptions = {}): Promise<T> {
  const raw = await runPythonScript(scriptName, args, options);
  return parseScriptJson<T>(scriptName, args, raw);
}

export function runKronosStateScript(args: string[], options: ScriptRunOptions = {}): string {
  return runPythonScriptSync('kronos_state.py', args, options);
}

export function runGitlabJson<T = unknown>(args: string[], options: ScriptRunOptions = {}): Promise<T> {
  return runJsonScript<T>('gitlab_api.py', args, options);
}

export function runPipelineJson<T = unknown>(args: string[], options: ScriptRunOptions = {}): Promise<T> {
  return runJsonScript<T>('pipeline_monitor.py', args, options);
}

function assertScriptAvailable(scriptName: RequiredScriptName): string {
  const filePath = scriptPath(scriptName);
  if (!fs.existsSync(filePath)) {
    throw new KronosScriptMissingError(scriptName, filePath);
  }
  return filePath;
}

function findPython(): string {
  const candidates = definedValues([process.env['PYTHON'], 'python', 'python3'])
    .filter(candidate => candidate.length > 0);
  for (const candidate of candidates) {
    if (pythonCandidateAvailable(candidate)) {
      return candidate;
    }
  }
  return process.env['PYTHON'] || 'python';
}

function pythonCandidateAvailable(candidate: string): boolean {
  try {
    execFileSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 3000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function parseScriptJson<T = unknown>(scriptName: RequiredScriptName, args: string[], raw: string): T {
  return parseJsonWithLabel<T>(raw, `${scriptName} ${args.join(' ')}`, { includePreview: true });
}

function scriptError(scriptName: RequiredScriptName, args: string[], error: unknown): Error {
  const stderrValue = unknownErrorField(error, 'stderr');
  const stderr = stderrValue ? String(stderrValue).trim() : '';
  const message = stderr || unknownErrorMessage(error, 'script failed');
  return new Error(`${scriptName} ${args.join(' ')} failed: ${message}`);
}
