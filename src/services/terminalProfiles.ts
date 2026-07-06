import * as fs from 'fs';

import { firstEnvValue } from './envValues';
import { uniqueCaseInsensitiveStrings } from './stringLists';

interface KronosTerminalOptions {
  name: string;
  cwd?: string;
  shellPath?: string;
  shellArgs?: string[] | string;
}

interface TerminalProfileDeps {
  platform?: string;
  env?: NodeJS.ProcessEnv;
  existsSync?: (filePath: string) => boolean;
}

interface TerminalProfileInput {
  name: string;
  cwd?: string;
}

function joinWindowsPath(base: string, suffix: string): string {
  return `${base.replace(/[\\/]+$/, '')}\\${suffix}`;
}

function gitBashCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const programFiles = firstEnvValue(env, ['ProgramFiles', 'PROGRAMFILES']) || 'C:\\Program Files';
  const programFilesX86 = firstEnvValue(env, ['ProgramFiles(x86)', 'PROGRAMFILES(X86)']) || 'C:\\Program Files (x86)';
  const localAppData = firstEnvValue(env, ['LocalAppData', 'LOCALAPPDATA']);

  return uniqueCaseInsensitiveStrings([
    firstEnvValue(env, ['GIT_BASH_PATH']),
    firstEnvValue(env, ['BASH_PATH']),
    joinWindowsPath(programFiles, 'Git\\bin\\bash.exe'),
    joinWindowsPath(programFiles, 'Git\\usr\\bin\\bash.exe'),
    joinWindowsPath(programFilesX86, 'Git\\bin\\bash.exe'),
    joinWindowsPath(programFilesX86, 'Git\\usr\\bin\\bash.exe'),
    localAppData ? joinWindowsPath(localAppData, 'Programs\\Git\\bin\\bash.exe') : undefined,
  ]);
}

function findGitBashPath(deps: TerminalProfileDeps = {}): string | undefined {
  const env = deps.env || process.env;
  const existsSync = deps.existsSync || fs.existsSync;
  return gitBashCandidatePaths(env).find((candidate) => existsSync(candidate));
}

function isGitBashShell(shellPath?: string): boolean {
  if (!shellPath) {
    return false;
  }
  return /(?:^|[\\/])Git[\\/](?:bin|usr[\\/]bin)[\\/]bash\.exe$/i.test(shellPath);
}

export function kronosTerminalOptions(input: TerminalProfileInput, deps: TerminalProfileDeps = {}): KronosTerminalOptions {
  const platform = deps.platform || process.platform;
  const options: KronosTerminalOptions = { name: input.name };
  if (input.cwd) {
    options.cwd = input.cwd;
  }

  if (platform === 'win32') {
    const gitBash = findGitBashPath(deps);
    if (gitBash) {
      return { ...options, shellPath: gitBash, shellArgs: ['--login'] };
    }
  }

  return options;
}

export function kronosLoginShellTerminalOptions(input: TerminalProfileInput, deps: TerminalProfileDeps = {}): KronosTerminalOptions {
  const platform = deps.platform || process.platform;
  const options = kronosTerminalOptions(input, deps);
  if (options.shellPath) {
    return options;
  }

  if (platform === 'win32') {
    const bashPath = firstEnvValue(deps.env || process.env, ['BASH_PATH']);
    return { ...options, shellPath: bashPath || 'bash', shellArgs: ['--login'] };
  }

  return {
    ...options,
    shellPath: firstEnvValue(deps.env || process.env, ['BASH_PATH']) || '/bin/bash',
    shellArgs: ['--login'],
  };
}

export function gcloudApplicationDefaultLoginCommand(shellPath?: string, deps: TerminalProfileDeps = {}): string {
  const platform = deps.platform || process.platform;
  if (platform === 'win32' && !isGitBashShell(shellPath)) {
    return 'gcloud.cmd auth application-default login';
  }
  return 'gcloud auth application-default login';
}
