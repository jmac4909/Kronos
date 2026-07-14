import * as path from 'path';
import { unknownErrorMessage } from './errorUtils';
import { KRONOS_DIR, readBoundedPrivateUtf8File } from './stateStore';

export interface ProviderEnvLoadResult {
  path: string;
  present: boolean;
  parsed: number;
  loaded: number;
  skippedExisting: number;
  invalid: number;
  error?: string;
}

interface ProviderEnvLoadOptions {
  filePath?: string;
  env?: NodeJS.ProcessEnv;
  overrideExisting?: boolean;
  readFile?: (filePath: string) => string;
  exists?: (filePath: string) => boolean;
}

interface ParsedDotEnv {
  values: Record<string, string>;
  invalid: number;
}

export const MAX_PROVIDER_ENV_BYTES = 256 * 1024;

const SUPPORTED_PROVIDER_ENV_KEYS = new Set([
  'JIRA_BASE_URL',
  'JIRA_EMAIL',
  'JIRA_API_TOKEN',
  'JIRA_JQL',
  'GITLAB_API_BASE_URL',
  'GITLAB_BASE_URL',
  'GITLAB_URL',
  'GITLAB_HOST',
  'GITLAB_TOKEN',
  'JENKINS_URL',
  'JENKINS_USER',
  'JENKINS_USERNAME',
  'JENKINS_API_TOKEN',
  'JENKINS_TOKEN',
  'SONAR_HOST_URL',
  'SONAR_URL',
  'SONAR_TOKEN',
]);

export function defaultProviderEnvPath(): string {
  return process.env['KRONOS_ENV_FILE']?.trim() || path.join(KRONOS_DIR, '.env');
}

export function loadProviderEnv(options: ProviderEnvLoadOptions = {}): ProviderEnvLoadResult {
  const filePath = options.filePath || defaultProviderEnvPath();
  const env = options.env || process.env;
  if (options.exists && !options.exists(filePath)) {
    return { path: filePath, present: false, parsed: 0, loaded: 0, skippedExisting: 0, invalid: 0 };
  }
  try {
    const text = options.readFile
      ? options.readFile(filePath)
      : readBoundedPrivateUtf8File(filePath, MAX_PROVIDER_ENV_BYTES, 'Kronos provider environment file');
    if (Buffer.byteLength(text, 'utf8') > MAX_PROVIDER_ENV_BYTES) {
      throw new Error(`Kronos provider environment file exceeds the ${MAX_PROVIDER_ENV_BYTES}-byte read limit.`);
    }
    const parsed = parseProviderDotEnv(text);
    const supportedValues = Object.entries(parsed.values)
      .filter(([key]) => SUPPORTED_PROVIDER_ENV_KEYS.has(key));
    const unsupported = Object.keys(parsed.values).length - supportedValues.length;
    let loaded = 0;
    let skippedExisting = 0;
    for (const [key, value] of supportedValues) {
      if (!options.overrideExisting && env[key] !== undefined) {
        skippedExisting += 1;
        continue;
      }
      env[key] = value;
      loaded += 1;
    }
    return {
      path: filePath,
      present: true,
      parsed: supportedValues.length,
      loaded,
      skippedExisting,
      invalid: parsed.invalid + unsupported,
    };
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { path: filePath, present: false, parsed: 0, loaded: 0, skippedExisting: 0, invalid: 0 };
    }
    return {
      path: filePath,
      present: true,
      parsed: 0,
      loaded: 0,
      skippedExisting: 0,
      invalid: 0,
      error: unknownErrorMessage(error, 'Could not load the Kronos provider environment file.'),
    };
  }
}

export function parseProviderDotEnv(text: string): ParsedDotEnv {
  const values: Record<string, string> = {};
  let invalid = 0;
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) { continue; }
    const assignment = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
    const equals = assignment.indexOf('=');
    if (equals <= 0) {
      invalid += 1;
      continue;
    }
    const key = assignment.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      invalid += 1;
      continue;
    }
    values[key] = parseDotEnvValue(assignment.slice(equals + 1));
  }
  return { values, invalid };
}

function parseDotEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code);
}
