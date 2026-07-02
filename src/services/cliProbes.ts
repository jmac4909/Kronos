import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

export interface CliProbeCommandOptions {
  timeoutMs: number;
  maxBuffer?: number;
}

export type CliProbeCommandRunner = (command: string, args: string[], options: CliProbeCommandOptions) => string;

export interface CliProbeOptions {
  timeoutMs?: number;
  maxBuffer?: number;
  commandRunner?: CliProbeCommandRunner;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
  accessSync?: (filePath: string, mode?: number) => void;
}

export interface CliProbeResult {
  ok: boolean;
  output: string;
  error?: string;
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

function unique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

export function gcloudCandidateCommands(env: NodeJS.ProcessEnv = process.env): string[] {
  const cloudSdkRoot = envValue(env, ['CLOUDSDK_ROOT_DIR', 'GCLOUD_ROOT_DIR']);
  const localAppData = envValue(env, ['LocalAppData', 'LOCALAPPDATA']);
  const programFiles = envValue(env, ['ProgramFiles', 'PROGRAMFILES']) || 'C:\\Program Files';
  const programFilesX86 = envValue(env, ['ProgramFiles(x86)', 'PROGRAMFILES(X86)']) || 'C:\\Program Files (x86)';

  return unique([
    envValue(env, ['GCLOUD_PATH']),
    cloudSdkRoot ? path.win32.join(cloudSdkRoot, 'bin', 'gcloud.cmd') : undefined,
    localAppData ? path.win32.join(localAppData, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd') : undefined,
    path.win32.join(programFiles, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    path.win32.join(programFilesX86, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd'),
    'gcloud.cmd',
  ]);
}

export function resolveGcloudCommand(options: Pick<CliProbeOptions, 'platform' | 'env' | 'existsSync'> = {}): string {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  if (platform !== 'win32') {
    return envValue(env, ['GCLOUD_PATH']) || 'gcloud';
  }

  const existsSync = options.existsSync || fs.existsSync;
  const candidates = gcloudCandidateCommands(env);
  return candidates.find(candidate => /[\\/]/.test(candidate) && existsSync(candidate))
    || candidates.find(candidate => candidate.toLowerCase() === 'gcloud.cmd')
    || 'gcloud.cmd';
}

export function commandNeedsCmdWrapper(command: string, platform = process.platform): boolean {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(command);
}

export function quoteWindowsCmdToken(value: string): string {
  const escaped = String(value)
    .replace(/%/g, '%%')
    .replace(/(["^&|<>()])/g, '^$1');
  return `"${escaped}"`;
}

export function windowsCmdFileInvocation(command: string, args: string[], env: NodeJS.ProcessEnv = process.env): { command: string; args: string[] } {
  const cmd = env.ComSpec || env.COMSPEC || 'cmd.exe';
  const shellLine = `"${[command, ...args].map(quoteWindowsCmdToken).join(' ')}"`;
  return {
    command: cmd,
    args: ['/d', '/s', '/c', shellLine],
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
  const filePath = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!filePath) { return undefined; }
  const accessSync = options.accessSync || fs.accessSync;
  try {
    accessSync(filePath, fs.constants.R_OK);
    return filePath;
  } catch {
    return undefined;
  }
}

export function runCliProbe(command: string, args: string[], options: CliProbeOptions = {}): CliProbeResult {
  const commandRunner = options.commandRunner || defaultCliProbeCommandRunner;
  try {
    return {
      ok: true,
      output: commandRunner(command, args, {
        timeoutMs: options.timeoutMs || CLAUDE_AGENTS_TIMEOUT_MS,
        maxBuffer: options.maxBuffer,
      }),
    };
  } catch (e: any) {
    return {
      ok: false,
      output: '',
      error: e?.message || String(e),
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
  return runCliProbe(resolveGcloudCommand(options), ['auth', 'application-default', 'print-access-token'], {
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
