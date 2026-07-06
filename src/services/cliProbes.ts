import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { unknownErrorMessage } from './errorUtils';
import { uniqueCaseInsensitiveStrings } from './stringLists';

interface CliProbeCommandOptions {
  timeoutMs: number;
  maxBuffer?: number;
}

type CliProbeCommandRunner = (command: string, args: string[], options: CliProbeCommandOptions) => string;

interface CliProbeOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  commandRunner?: CliProbeCommandRunner;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  accessSync?: (filePath: string, mode?: number) => void;
}

interface CliProbeResult {
  ok: boolean;
  output: string;
  error?: string;
}

interface CliCommandResolution {
  command: string;
  available: boolean;
}

const CLAUDE_AGENTS_TIMEOUT_MS = 5000;
const GCLOUD_AUTH_TIMEOUT_MS = 10000;
const CLAUDE_MODEL_TIMEOUT_MS = 15000;

function envValue(env: NodeJS.ProcessEnv, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function gcloudCandidateCommands(env: NodeJS.ProcessEnv = process.env): string[] {
  const cloudSdkRoot = envValue(env, ['CLOUDSDK_ROOT_DIR', 'GCLOUD_ROOT_DIR']);
  const localAppData = envValue(env, ['LocalAppData', 'LOCALAPPDATA']);
  const programFiles = envValue(env, ['ProgramFiles', 'PROGRAMFILES']) || 'C:\\Program Files';
  const programFilesX86 = envValue(env, ['ProgramFiles(x86)', 'PROGRAMFILES(X86)']) || 'C:\\Program Files (x86)';

  return uniqueCaseInsensitiveStrings([
    envValue(env, ['GCLOUD_PATH']),
    cloudSdkRoot ? path.win32.join(cloudSdkRoot, 'bin', 'gcloud.cmd') : undefined,
    localAppData ? path.win32.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd') : undefined,
    path.win32.join(programFiles, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    path.win32.join(programFilesX86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    'gcloud.cmd',
  ]);
}

function resolveCommandOnPath(command: string, env: NodeJS.ProcessEnv, existsSync: (filePath: string) => boolean, platform: string): string | undefined {
  const pathValue = envValue(env, ['Path', 'PATH']);
  if (!pathValue) { return undefined; }
  const delimiter = platform === 'win32' ? ';' : ':';
  const dirs = pathValue.split(delimiter).map(value => value.trim()).filter(Boolean);
  for (const dir of dirs) {
    const candidate = platform === 'win32' ? path.win32.join(dir, command) : path.join(dir, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export function resolveGcloudCommandStatus(options: Pick<CliProbeOptions, 'platform' | 'env' | 'existsSync'> = {}): CliCommandResolution {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== 'win32') {
    return { command: envValue(env, ['GCLOUD_PATH']) || 'gcloud', available: true };
  }

  const existsSync = options.existsSync || fs.existsSync;
  const candidates = gcloudCandidateCommands(env);
  const explicitPath = candidates.find(candidate => /[\\/]/.test(candidate) && existsSync(candidate));
  if (explicitPath) {
    return { command: explicitPath, available: true };
  }
  const pathCommand = resolveCommandOnPath('gcloud.cmd', env, existsSync, platform);
  if (pathCommand) {
    return { command: pathCommand, available: true };
  }
  return {
    command: candidates.find(candidate => candidate.toLowerCase() === 'gcloud.cmd') || 'gcloud.cmd',
    available: false,
  };
}

export function commandNeedsCmdWrapper(command: string, platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

function quoteWindowsCmdToken(value: string): string {
  const raw = String(value);
  const escaped = raw
    .replace(/%/g, '%%')
    .replace(/(["^&|<>()])/g, '^$1');
  return /[\s"%^&|<>()]/.test(raw) ? `"${escaped}"` : escaped;
}

export function windowsCmdFileInvocation(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } {
  const cmd = envValue(env, ['ComSpec', 'COMSPEC']) || 'cmd.exe';
  const shellLine = ['call', quoteWindowsCmdToken(command), ...args.map(quoteWindowsCmdToken)].join(' ');
  return {
    command: cmd,
    args: ['/d', '/c', shellLine],
  };
}

export function defaultCliProbeCommandRunner(command: string, args: string[], options: CliProbeCommandOptions): string {
  if (commandNeedsCmdWrapper(command)) {
    const invocation = windowsCmdFileInvocation(command, args);
    return execFileSync(invocation.command, invocation.args, {
      encoding: 'utf-8',
      timeout: options.timeoutMs,
      windowsHide: true,
      maxBuffer: options.maxBuffer,
    });
  }

  return execFileSync(command, args, {
    encoding: 'utf-8',
    timeout: options.timeoutMs,
    windowsHide: true,
    maxBuffer: options.maxBuffer,
  });
}

export function readableGoogleApplicationCredentials(options: Pick<CliProbeOptions, 'env' | 'accessSync'> = {}): string | undefined {
  const env = options.env || process.env;
  const filePath = envValue(env, ['GOOGLE_APPLICATION_CREDENTIALS']);
  if (!filePath) { return undefined; }
  const accessSync = options.accessSync || fs.accessSync;
  try {
    accessSync(filePath, fs.constants.R_OK);
    return filePath;
  } catch {
    return undefined;
  }
}

function runCliProbe(command: string, args: string[], options: CliProbeOptions = {}): CliProbeResult {
  const commandRunner = options.commandRunner || defaultCliProbeCommandRunner;
  try {
    const commandOptions: CliProbeCommandOptions = {
      timeoutMs: options.timeoutMs || CLAUDE_AGENTS_TIMEOUT_MS,
    };
    if (options.maxBuffer !== undefined) { commandOptions.maxBuffer = options.maxBuffer; }
    return {
      ok: true,
      output: commandRunner(command, args, commandOptions),
    };
  } catch (e: unknown) {
    return {
      ok: false,
      output: '',
      error: unknownErrorMessage(e, 'CLI probe failed'),
    };
  }
}

export function readClaudeAgents<T = unknown>(options: CliProbeOptions = {}): T[] {
  const result = runCliProbe('claude', ['agents', '--json'], {
    ...options,
    timeoutMs: options.timeoutMs || CLAUDE_AGENTS_TIMEOUT_MS,
  });
  if (!result.ok) {
    return [];
  }
  try {
    const parsed = JSON.parse(result.output);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function checkGcloudApplicationDefaultAuth(options: CliProbeOptions = {}): CliProbeResult {
  if (readableGoogleApplicationCredentials(options)) {
    return {
      ok: true,
      output: 'GOOGLE_APPLICATION_CREDENTIALS file is readable; skipped gcloud token command.\n',
    };
  }
  const resolution = resolveGcloudCommandStatus(options);
  if (!resolution.available) {
    return {
      ok: false,
      output: '',
      error: `${resolution.command} unavailable; install Google Cloud SDK or set GOOGLE_APPLICATION_CREDENTIALS.`,
    };
  }
  return runCliProbe(resolution.command, ['auth', 'application-default', 'print-access-token'], {
    ...options,
    timeoutMs: options.timeoutMs || GCLOUD_AUTH_TIMEOUT_MS,
  });
}

export function checkClaudeModelAccess(model: string, options: CliProbeOptions = {}): CliProbeResult {
  return runCliProbe('claude', ['-p', 'ok', '--model', model, '--permission-mode', 'auto'], {
    ...options,
    timeoutMs: options.timeoutMs || CLAUDE_MODEL_TIMEOUT_MS,
  });
}
