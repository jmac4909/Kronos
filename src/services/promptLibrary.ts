import * as crypto from 'crypto';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import { boundedOperationFailure } from './errorUtils';
import {
  assertSafeDirectoryPath,
  ensurePrivateDirectoryPath,
  readPrivateTextFileIfPresent,
  writePrivateTextFileAtomically,
} from './privateFilePrimitives';
import { isRecord } from './records';
import { redactSensitiveTokens } from './sensitiveText';
import { KRONOS_DIR } from './stateStore';

export type PromptLibrarySourceKind = 'local' | 'remote' | 'cache';
export type PromptLibrarySuggestedContext =
  | 'jira'
  | 'git'
  | 'merge-request'
  | 'pipeline'
  | 'jenkins'
  | 'sonarqube'
  | 'context-basket';

export interface PromptLibraryPrompt {
  key: string;
  id: string;
  title: string;
  description: string;
  body: string;
  tags: string[];
  suggestedContext: PromptLibrarySuggestedContext[];
  libraryName: string;
  sourceKind: PromptLibrarySourceKind;
  sourceLocation: string;
  revisionSha256: string;
  warnings: string[];
}

export interface PromptLibrarySourceStatus {
  kind: PromptLibrarySourceKind;
  location: string;
  libraryName?: string;
  promptCount: number;
  warning?: string;
}

export interface PromptLibraryLoadResult {
  prompts: PromptLibraryPrompt[];
  sources: PromptLibrarySourceStatus[];
  warnings: string[];
}

export interface PromptTemplateContext {
  sessionTitle: string;
  projectName?: string;
  projectPath?: string;
  projectBranch?: string;
  jiraKeys: readonly string[];
}

export interface RenderedPromptTemplate {
  body: string;
  appliedVariables: string[];
  warnings: string[];
}

export interface PromptLibraryRemoteRequest {
  url: string;
  timeoutMs: number;
  maxResponseBytes: number;
  headers: Record<string, string>;
}

export interface PromptLibraryRemoteResponse {
  statusCode: number;
  body: string;
}

export type PromptLibraryRemoteTransport = (
  request: PromptLibraryRemoteRequest,
) => Promise<PromptLibraryRemoteResponse>;

export interface LoadPromptLibrariesOptions {
  localPaths?: readonly string[];
  remoteUrls?: readonly string[];
  kronosDir?: string;
  env?: NodeJS.ProcessEnv;
  allowCredentialedRemote?: boolean;
  transport?: PromptLibraryRemoteTransport;
  timeoutMs?: number;
}

interface ParsedPromptLibraryManifest {
  name: string;
  prompts: PromptLibraryPrompt[];
  warnings: string[];
}

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_LOCAL_PATHS = 20;
const MAX_REMOTE_URLS = 10;
const MAX_DIRECTORY_MANIFESTS = 20;
const MAX_PROMPTS_PER_LIBRARY = 100;
const MAX_PROMPTS_TOTAL = 500;
const MAX_PROMPT_BODY_LENGTH = 20_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const FILE_MODE = 0o600;
const MANIFEST_FILE_PATTERN = /^(?:kronos-prompts|.+\.kronos-prompts)\.json$/i;
const PROMPT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const SENSITIVE_QUERY_NAME = /(?:token|auth|key|secret|password|passwd|credential|signature)/i;
const SUGGESTED_CONTEXT = new Set<PromptLibrarySuggestedContext>([
  'jira',
  'git',
  'merge-request',
  'pipeline',
  'jenkins',
  'sonarqube',
  'context-basket',
]);

/** Loads configured local manifests first, then bounded remote manifests with private latest-good fallback. */
export async function loadPromptLibraries(options: LoadPromptLibrariesOptions = {}): Promise<PromptLibraryLoadResult> {
  const root = path.resolve(options.kronosDir || KRONOS_DIR);
  const localPaths = uniqueStrings(options.localPaths, MAX_LOCAL_PATHS);
  const remoteUrls = uniqueStrings(options.remoteUrls, MAX_REMOTE_URLS);
  const prompts: PromptLibraryPrompt[] = [];
  const sources: PromptLibrarySourceStatus[] = [];
  const warnings: string[] = [];

  for (const configuredPath of localPaths) {
    const locations = localManifestLocations(configuredPath);
    if (locations.error) {
      warnings.push(locations.error);
      sources.push({ kind: 'local', location: safeSourceLocation(configuredPath), promptCount: 0, warning: locations.error });
      continue;
    }
    for (const location of locations.files) {
      try {
        const manifest = readAndParseLocalManifest(location);
        prompts.push(...manifest.prompts);
        warnings.push(...manifest.warnings);
        sources.push({
          kind: 'local',
          location,
          libraryName: manifest.name,
          promptCount: manifest.prompts.length,
          ...(manifest.warnings[0] ? { warning: manifest.warnings[0] } : {}),
        });
      } catch (error: unknown) {
        const warning = boundedOperationFailure(error, 'Local prompt library could not be read.').display;
        warnings.push(warning);
        sources.push({ kind: 'local', location, promptCount: 0, warning });
      }
    }
  }

  const remoteResults = await Promise.all(remoteUrls.map(url => loadRemotePromptLibrary(url, {
    root,
    env: options.env || process.env,
    allowCredentialedRemote: options.allowCredentialedRemote === true,
    transport: options.transport || defaultPromptLibraryTransport,
    timeoutMs: boundedTimeout(options.timeoutMs),
  })));
  for (const result of remoteResults) {
    prompts.push(...result.prompts);
    sources.push(result.source);
    warnings.push(...result.warnings);
  }

  if (prompts.length > MAX_PROMPTS_TOTAL) {
    warnings.push(`Prompt libraries supplied more than ${MAX_PROMPTS_TOTAL} prompts; later entries were omitted.`);
  }
  return {
    prompts: prompts.slice(0, MAX_PROMPTS_TOTAL),
    sources,
    warnings: uniqueStrings(warnings, 100),
  };
}

export function parsePromptLibraryManifest(
  text: string,
  source: { kind: PromptLibrarySourceKind; location: string },
): ParsedPromptLibraryManifest {
  if (Buffer.byteLength(text, 'utf8') > MAX_MANIFEST_BYTES) {
    throw new Error(`Prompt library manifest exceeds the ${MAX_MANIFEST_BYTES}-byte limit.`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(text) as unknown; }
  catch { throw new Error('Prompt library manifest is not valid JSON.'); }
  if (!isRecord(parsed) || parsed['schemaVersion'] !== 1 || !Array.isArray(parsed['prompts'])) {
    throw new Error('Prompt library manifest must use schemaVersion 1 and contain a prompts array.');
  }
  const warnings: string[] = [];
  const name = redactedSingleLine(parsed['name'], 200, 'Prompt library name', warnings);
  const prompts: PromptLibraryPrompt[] = [];
  const seen = new Set<string>();
  for (const raw of parsed['prompts'].slice(0, MAX_PROMPTS_PER_LIBRARY)) {
    if (!isRecord(raw)) {
      warnings.push(`${name} ignored a prompt entry that was not an object.`);
      continue;
    }
    const idValue = typeof raw['id'] === 'string' ? raw['id'].trim() : '';
    if (!PROMPT_ID_PATTERN.test(idValue) || seen.has(idValue)) {
      warnings.push(`${name} ignored a prompt with a missing, unsafe, or duplicate id.`);
      continue;
    }
    try {
      const promptWarnings: string[] = [];
      const title = redactedSingleLine(raw['title'], 200, `Prompt ${idValue} title`, promptWarnings);
      const description = optionalRedactedSingleLine(raw['description'], 500, promptWarnings);
      const body = redactedMultiline(raw['body'], MAX_PROMPT_BODY_LENGTH, `Prompt ${idValue} body`, promptWarnings);
      const tags = normalizedStringArray(raw['tags'], 20, 50, promptWarnings, 'tag');
      const suggestedContext = normalizedSuggestedContext(raw['suggestedContext'], promptWarnings);
      const revisionSha256 = sha256(JSON.stringify({ id: idValue, title, description, body, tags, suggestedContext }));
      prompts.push({
        key: `${source.kind}:${sha256(source.location).slice(0, 16)}:${idValue}`,
        id: idValue,
        title,
        description,
        body,
        tags,
        suggestedContext,
        libraryName: name,
        sourceKind: source.kind,
        sourceLocation: source.location,
        revisionSha256,
        warnings: promptWarnings,
      });
      warnings.push(...promptWarnings.map(warning => `${name} / ${title}: ${warning}`));
      seen.add(idValue);
    } catch (error: unknown) {
      warnings.push(boundedOperationFailure(error, `${name} ignored invalid prompt ${idValue}.`).display);
    }
  }
  if (parsed['prompts'].length > MAX_PROMPTS_PER_LIBRARY) {
    warnings.push(`${name} supplied more than ${MAX_PROMPTS_PER_LIBRARY} prompts; later entries were omitted.`);
  }
  return { name, prompts, warnings: uniqueStrings(warnings, 100) };
}

export function renderPromptTemplate(
  prompt: PromptLibraryPrompt,
  context: PromptTemplateContext,
): RenderedPromptTemplate {
  const values = new Map<string, string>([
    ['session.title', safeTemplateValue(context.sessionTitle, 'Unnamed session')],
    ['project.name', safeTemplateValue(context.projectName, 'No linked project')],
    ['project.path', safeTemplateValue(context.projectPath, 'No linked project path')],
    ['project.branch', safeTemplateValue(context.projectBranch, 'Branch unavailable')],
    ['jira.key', safeTemplateValue(context.jiraKeys[0], 'No Jira context')],
    ['jira.keys', context.jiraKeys.length > 0
      ? context.jiraKeys.slice(0, 50).map(value => safeTemplateValue(value, '')).filter(Boolean).join(', ')
      : 'No Jira context'],
  ]);
  const appliedVariables = new Set<string>();
  const unresolved = new Set<string>();
  const body = prompt.body.replace(/\{\{\s*([A-Za-z][A-Za-z0-9_.-]{0,79})\s*\}\}/g, (match, key: string) => {
    const value = values.get(key);
    if (value === undefined) {
      unresolved.add(key);
      return match;
    }
    appliedVariables.add(key);
    return value;
  });
  return {
    body: redactSensitiveTokens(body),
    appliedVariables: [...appliedVariables].sort(),
    warnings: [
      ...prompt.warnings,
      ...([...unresolved].sort().map(key => `Unknown template variable {{${key}}} was left for operator review.`)),
    ],
  };
}

export function normalizePromptLibraryRemoteUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4_000) { return undefined; }
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.hash) { return undefined; }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return undefined;
    }
    for (const key of url.searchParams.keys()) {
      if (SENSITIVE_QUERY_NAME.test(key)) { return undefined; }
    }
    const normalized = url.toString();
    if (redactSensitiveTokens(normalized) !== normalized) { return undefined; }
    return normalized;
  } catch {
    return undefined;
  }
}

export function promptLibraryRequestHeaders(
  urlValue: string,
  env: NodeJS.ProcessEnv,
  allowCredentialedRemote: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'kronos-prompt-library',
  };
  const token = env['GITLAB_TOKEN']?.trim();
  if (!allowCredentialedRemote || !token) { return headers; }
  const remoteOrigin = new URL(urlValue).origin;
  const configuredOrigins = [
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  ].map(value => configuredHttpOrigin(value)).filter((value): value is string => Boolean(value));
  if (configuredOrigins.includes(remoteOrigin)) { headers['PRIVATE-TOKEN'] = token; }
  return headers;
}

async function loadRemotePromptLibrary(
  configuredUrl: string,
  options: {
    root: string;
    env: NodeJS.ProcessEnv;
    allowCredentialedRemote: boolean;
    transport: PromptLibraryRemoteTransport;
    timeoutMs: number;
  },
): Promise<{ prompts: PromptLibraryPrompt[]; source: PromptLibrarySourceStatus; warnings: string[] }> {
  const url = normalizePromptLibraryRemoteUrl(configuredUrl);
  const displayLocation = url || safeSourceLocation(configuredUrl);
  if (!url) {
    const warning = 'Remote prompt library URL must be credential-free HTTPS, or HTTP on loopback, with no fragment or secret-shaped query field.';
    return { prompts: [], source: { kind: 'remote', location: displayLocation, promptCount: 0, warning }, warnings: [warning] };
  }
  const cachePath = remoteCachePath(options.root, url);
  try {
    const response = await options.transport({
      url,
      timeoutMs: options.timeoutMs,
      maxResponseBytes: MAX_MANIFEST_BYTES,
      headers: promptLibraryRequestHeaders(url, options.env, options.allowCredentialedRemote),
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(`Remote prompt library returned HTTP ${response.statusCode}; response content was not displayed.`);
    }
    const manifest = parsePromptLibraryManifest(response.body, { kind: 'remote', location: url });
    ensurePrivateDirectoryPath(path.dirname(cachePath), 'Kronos prompt library cache');
    writePrivateTextFileAtomically(cachePath, serializedCacheManifest(manifest), {
      label: 'Kronos prompt library cache',
      maxBytes: MAX_MANIFEST_BYTES,
      temporaryPrefix: 'prompt-library-cache',
      fileMode: FILE_MODE,
    });
    return {
      prompts: manifest.prompts,
      source: {
        kind: 'remote',
        location: url,
        libraryName: manifest.name,
        promptCount: manifest.prompts.length,
        ...(manifest.warnings[0] ? { warning: manifest.warnings[0] } : {}),
      },
      warnings: manifest.warnings,
    };
  } catch (error: unknown) {
    const failure = boundedOperationFailure(error, 'Remote prompt library refresh failed.').display;
    try {
      const cached = readPrivateTextFileIfPresent(cachePath, {
        label: 'Kronos prompt library cache',
        maxBytes: MAX_MANIFEST_BYTES,
        expectedMode: FILE_MODE,
      });
      if (cached === null) { throw new Error('No latest-good prompt library cache exists.'); }
      const manifest = parsePromptLibraryManifest(cached, { kind: 'cache', location: url });
      const warning = `${failure} Using the latest private cached copy.`;
      return {
        prompts: manifest.prompts,
        source: { kind: 'cache', location: url, libraryName: manifest.name, promptCount: manifest.prompts.length, warning },
        warnings: [warning, ...manifest.warnings],
      };
    } catch {
      return {
        prompts: [],
        source: { kind: 'remote', location: url, promptCount: 0, warning: failure },
        warnings: [failure],
      };
    }
  }
}

function localManifestLocations(configuredPath: string): { files: string[]; error?: string } {
  const resolved = expandHomePath(configuredPath);
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) { throw new Error('Configured prompt library path is a symbolic link.'); }
    if (stat.isFile()) { return { files: [resolved] }; }
    if (!stat.isDirectory()) { throw new Error('Configured prompt library path is not a file or directory.'); }
    assertSafeDirectoryPath(resolved, 'Kronos local prompt library');
    const files = fs.readdirSync(resolved, { withFileTypes: true })
      .filter(entry => entry.isFile() && MANIFEST_FILE_PATTERN.test(entry.name))
      .map(entry => path.join(resolved, entry.name))
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_DIRECTORY_MANIFESTS);
    if (files.length === 0) {
      return { files: [], error: `${resolved} contains no kronos-prompts.json or *.kronos-prompts.json manifest.` };
    }
    return { files };
  } catch (error: unknown) {
    return {
      files: [],
      error: boundedOperationFailure(error, `Local prompt library path is unavailable: ${safeSourceLocation(configuredPath)}.`).display,
    };
  }
}

function readAndParseLocalManifest(filePath: string): ParsedPromptLibraryManifest {
  const content = readPrivateTextFileIfPresent(filePath, {
    label: 'Kronos local prompt library manifest',
    maxBytes: MAX_MANIFEST_BYTES,
  });
  if (content === null) { throw new Error(`Local prompt library manifest is unavailable: ${filePath}.`); }
  return parsePromptLibraryManifest(content, { kind: 'local', location: filePath });
}

function remoteCachePath(root: string, url: string): string {
  return path.join(root, 'prompt-library-cache', sha256(url).slice(0, 24), 'manifest.json');
}

function serializedCacheManifest(manifest: ParsedPromptLibraryManifest): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    name: manifest.name,
    prompts: manifest.prompts.map(prompt => ({
      id: prompt.id,
      title: prompt.title,
      ...(prompt.description ? { description: prompt.description } : {}),
      body: prompt.body,
      ...(prompt.tags.length > 0 ? { tags: prompt.tags } : {}),
      ...(prompt.suggestedContext.length > 0 ? { suggestedContext: prompt.suggestedContext } : {}),
    })),
  }, null, 2)}\n`;
}

function defaultPromptLibraryTransport(request: PromptLibraryRemoteRequest): Promise<PromptLibraryRemoteResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(request.url);
    const client = parsed.protocol === 'https:' ? https : http;
    const operation = client.request(parsed, { method: 'GET', headers: request.headers }, response => {
      const statusCode = response.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400) {
        response.resume();
        reject(new Error('Remote prompt library redirects are refused; configure the final manifest URL.'));
        return;
      }
      const declaredLength = Number(response.headers['content-length']);
      if (Number.isFinite(declaredLength) && declaredLength > request.maxResponseBytes) {
        response.resume();
        reject(new Error(`Remote prompt library exceeds the ${request.maxResponseBytes}-byte limit.`));
        return;
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on('data', (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > request.maxResponseBytes) {
          operation.destroy(new Error(`Remote prompt library exceeds the ${request.maxResponseBytes}-byte limit.`));
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => resolve({ statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    operation.setTimeout(request.timeoutMs, () => operation.destroy(new Error('Remote prompt library request timed out.')));
    operation.on('error', reject);
    operation.end();
  });
}

function redactedSingleLine(
  value: unknown,
  maxLength: number,
  label: string,
  warnings: string[] = [],
): string {
  if (typeof value !== 'string') { throw new Error(`${label} is missing.`); }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > maxLength) { throw new Error(`${label} must be 1-${maxLength} characters.`); }
  const redacted = redactSensitiveTokens(normalized);
  if (redacted !== normalized) { warnings.push('Credential-shaped text was redacted before display or persistence.'); }
  return redacted;
}

function optionalRedactedSingleLine(value: unknown, maxLength: number, warnings: string[]): string {
  if (value === undefined || value === null || value === '') { return ''; }
  return redactedSingleLine(value, maxLength, 'Prompt description', warnings);
}

function redactedMultiline(
  value: unknown,
  maxLength: number,
  label: string,
  warnings: string[],
): string {
  if (typeof value !== 'string') { throw new Error(`${label} is missing.`); }
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '')
    .trim();
  if (!normalized || normalized.length > maxLength) { throw new Error(`${label} must be 1-${maxLength} characters.`); }
  const redacted = redactSensitiveTokens(normalized);
  if (redacted !== normalized) { warnings.push('Credential-shaped text was redacted before display or persistence.'); }
  return redacted;
}

function normalizedStringArray(
  value: unknown,
  limit: number,
  maxLength: number,
  warnings: string[],
  label: string,
): string[] {
  if (value === undefined) { return []; }
  if (!Array.isArray(value)) { warnings.push(`Prompt ${label}s were ignored because they were not an array.`); return []; }
  return uniqueStrings(value.map(item => {
    if (typeof item !== 'string') { return ''; }
    const normalized = item.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized.length <= maxLength ? redactSensitiveTokens(normalized) : '';
  }), limit);
}

function normalizedSuggestedContext(value: unknown, warnings: string[]): PromptLibrarySuggestedContext[] {
  if (value === undefined) { return []; }
  if (!Array.isArray(value)) { warnings.push('Suggested context was ignored because it was not an array.'); return []; }
  const selected: PromptLibrarySuggestedContext[] = [];
  for (const item of value.slice(0, 20)) {
    if (typeof item === 'string' && SUGGESTED_CONTEXT.has(item as PromptLibrarySuggestedContext)) {
      if (!selected.includes(item as PromptLibrarySuggestedContext)) {
        selected.push(item as PromptLibrarySuggestedContext);
      }
    } else {
      warnings.push(`Unsupported suggested context ${JSON.stringify(item)} was ignored.`);
    }
  }
  return selected;
}

function uniqueStrings(values: readonly unknown[] | undefined, limit: number): string[] {
  if (!values) { return []; }
  return [...new Set(values
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter(Boolean))].slice(0, limit);
}

function expandHomePath(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '~') { return path.resolve(os.homedir()); }
  if (trimmed.startsWith(`~${path.sep}`) || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.resolve(os.homedir(), trimmed.slice(2));
  }
  return path.resolve(trimmed);
}

function safeSourceLocation(value: string): string {
  return redactSensitiveTokens(value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim()).slice(0, 4_000);
}

function safeTemplateValue(value: string | undefined, fallback: string): string {
  if (!value) { return fallback; }
  return redactSensitiveTokens(value)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 4_000) || fallback;
}

function configuredHttpOrigin(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.username || parsed.password) { return undefined; }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '::1' || normalized === '127.0.0.1'
    || normalized.startsWith('127.');
}

function boundedTimeout(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(60_000, Math.max(1_000, Math.floor(value)))
    : DEFAULT_TIMEOUT_MS;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
