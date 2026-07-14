import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { BuildStatus, KronosState, MergeRequest, Project, ProjectConfig, Ticket } from '../state/types';
import { unknownErrorMessage } from './errorUtils';
import { isRecord } from './records';

const explicitKronosDir = process.env['KRONOS_DIR']?.trim();
export const KRONOS_DIR = explicitKronosDir || path.join(os.homedir(), '.kronos');
export const STATE_FILE = path.join(KRONOS_DIR, 'work.json');
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const READ_CHUNK_BYTES = 64 * 1024;
const NO_FOLLOW_VALUE = Reflect.get(fs.constants, 'O_NOFOLLOW');
const NO_FOLLOW_FLAG = typeof NO_FOLLOW_VALUE === 'number' ? NO_FOLLOW_VALUE : 0;
export const MAX_WORK_CATALOG_BYTES = 32 * 1024 * 1024;

export interface StateFileLoadIssue {
  filePath: string;
  detail: string;
}

export interface StateFileReadResult {
  state: KronosState | null;
  issues: StateFileLoadIssue[];
}

export function emptyWorkCatalog(): KronosState {
  return { schemaVersion: 1, refreshedAt: null, projects: {}, tickets: {} };
}

export function readStateFileWithIssues(): StateFileReadResult {
  const filePath = STATE_FILE;
  try {
    const raw = JSON.parse(readBoundedPrivateUtf8File(
      filePath,
      MAX_WORK_CATALOG_BYTES,
      'Kronos Work catalog',
    )) as unknown;
    return normalizeWorkCatalog(raw, filePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { state: emptyWorkCatalog(), issues: [] };
    }
    return {
      state: emptyWorkCatalog(),
      issues: [{ filePath, detail: unknownErrorMessage(error, 'Could not read the local Work catalog.') }],
    };
  }
}

export function writeStateFile(state: KronosState): void {
  ensurePrivateDirectory(KRONOS_DIR);
  rejectUnsafeExistingFile(STATE_FILE);
  const temporaryPath = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(temporaryPath, 'wx', FILE_MODE);
    fs.writeFileSync(descriptor, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, STATE_FILE);
    if (process.platform !== 'win32') { fs.chmodSync(STATE_FILE, FILE_MODE); }
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    try { fs.unlinkSync(temporaryPath); } catch { /* already renamed or absent */ }
  }
}

export function normalizeWorkCatalog(raw: unknown, filePath = STATE_FILE): StateFileReadResult {
  if (!isRecord(raw)) {
    return { state: emptyWorkCatalog(), issues: [{ filePath, detail: 'Work catalog root must be an object.' }] };
  }
  const issues: StateFileLoadIssue[] = [];
  const state = emptyWorkCatalog();
  state.refreshedAt = safeString(raw['refreshedAt']) || safeString(raw['last_updated']) || null;

  const rawProjects = isRecord(raw['projects']) ? raw['projects'] : {};
  for (const [name, value] of Object.entries(rawProjects)) {
    const project = normalizeProject(value);
    if (project) { state.projects[safeKey(name)] = project; }
    else { issues.push({ filePath, detail: `Ignored invalid project ${safeKey(name)}.` }); }
  }

  const rawTickets = isRecord(raw['tickets']) ? raw['tickets'] : {};
  for (const [rawKey, value] of Object.entries(rawTickets)) {
    const key = normalizeTicketKey(rawKey);
    const ticket = normalizeTicket(value);
    if (key && ticket) { state.tickets[key] = ticket; }
    else { issues.push({ filePath, detail: `Ignored invalid Jira ticket ${safeKey(rawKey)}.` }); }
  }
  return { state, issues };
}

export function readBoundedPrivateUtf8File(filePath: string, maxBytes: number, label: string): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`${label} byte limit must be a positive safe integer.`);
  }

  const resolvedPath = path.resolve(filePath);
  const expectedStat = inspectNoFollowPath(resolvedPath, label);
  assertSafeReadableFile(expectedStat, resolvedPath, maxBytes, label);

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
    const openedStat = fs.fstatSync(descriptor);
    assertSafeReadableFile(openedStat, resolvedPath, maxBytes, label);
    if (!sameFileIdentity(expectedStat, openedStat)) {
      throw new Error(`${label} changed before it could be read safely.`);
    }

    const content = readDescriptorBounded(descriptor, maxBytes, label);
    const finalDescriptorStat = fs.fstatSync(descriptor);
    if (!sameStableFile(openedStat, finalDescriptorStat) || content.length !== finalDescriptorStat.size) {
      throw new Error(`${label} changed while it was being read.`);
    }

    const finalPathStat = inspectNoFollowPath(resolvedPath, label);
    if (!sameFileIdentity(finalDescriptorStat, finalPathStat)) {
      throw new Error(`${label} path changed while it was being read.`);
    }
    return content.toString('utf8');
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
  }
}

function normalizeProject(value: unknown): Project | undefined {
  if (!isRecord(value)) { return undefined; }
  const project: Project = { config: normalizeProjectConfig(value['config']) };
  const projectPath = safeString(value['path']);
  if (projectPath) { project.path = projectPath; }
  return project;
}

function normalizeProjectConfig(value: unknown): ProjectConfig {
  const raw = isRecord(value) ? value : {};
  const config: ProjectConfig = {};
  copyString(raw, config, 'repo_name');
  copyString(raw, config, 'jira_project_key');
  copyString(raw, config, 'jira_ticket_filter');
  copyString(raw, config, 'jenkins_url');
  copyString(raw, config, 'sonar_project_key');
  copyString(raw, config, 'base_branch');
  copyString(raw, config, 'default_branch');
  const gitlabProjectId = safePositiveInteger(raw['gitlab_project_id']);
  if (gitlabProjectId !== undefined) { config.gitlab_project_id = gitlabProjectId; }
  const extraDirs = safeStringArray(raw['extra_dirs']);
  if (extraDirs.length > 0) { config.extra_dirs = extraDirs; }
  return config;
}

function normalizeTicket(value: unknown): Ticket | undefined {
  if (!isRecord(value) || value['source'] === 'adhoc') { return undefined; }
  const summary = safeString(value['summary']);
  if (!summary) { return undefined; }
  const ticket: Ticket = {
    summary,
    type: safeString(value['type']) || 'Issue',
    priority: safeString(value['priority']) || 'Unknown',
    jira_status: safeString(value['jira_status']) || safeString(value['status']) || 'Unknown',
    source: 'jira',
    projects: safeStringArray(value['projects']),
    mr: normalizeMergeRequest(value['mr']),
    build: normalizeBuild(value['build']),
  };
  const updated = safeString(value['updated']);
  const jiraStatusCategory = safeString(value['jira_status_category']);
  const description = safeMultilineString(value['description']);
  const jiraUrl = safeHttpUrl(value['jira_url']);
  const labels = safeStringArray(value['labels']);
  const attachments = normalizeAttachments(value['attachments']);
  if (updated) { ticket.updated = updated; }
  if (jiraStatusCategory) { ticket.jira_status_category = jiraStatusCategory; }
  if (description) { ticket.description = description; }
  if (jiraUrl) { ticket.jira_url = jiraUrl; }
  if (labels.length > 0) { ticket.labels = labels; }
  if (attachments.length > 0) { ticket.attachments = attachments; }
  return ticket;
}

function normalizeMergeRequest(value: unknown): MergeRequest | null {
  if (!isRecord(value)) { return null; }
  const iid = safePositiveInteger(value['iid']);
  const url = safeHttpUrl(value['url']);
  if (iid === undefined || !url) { return null; }
  const stateValue = safeString(value['state']);
  const reviewValue = safeString(value['review_status']);
  const mr: MergeRequest = {
    iid,
    url,
    state: stateValue === 'merged' || stateValue === 'closed' ? stateValue : 'opened',
    review_status: reviewValue === 'approved' || reviewValue === 'changes_requested' ? reviewValue : 'pending_review',
  };
  for (const key of ['title', 'author', 'last_comment_at', 'last_discussion_at', 'source_branch', 'target_branch', 'sourceBranch', 'targetBranch', 'branch', 'head_branch'] as const) {
    const item = safeString(value[key]);
    if (item) { mr[key] = item; }
  }
  for (const key of ['comment_count', 'discussion_count', 'unresolved_discussion_count', 'resolved_discussion_count'] as const) {
    const item = safeNonNegativeInteger(value[key]);
    if (item !== undefined) { mr[key] = item; }
  }
  if (typeof value['discussions_resolved'] === 'boolean') { mr.discussions_resolved = value['discussions_resolved']; }
  return mr;
}

function normalizeBuild(value: unknown): BuildStatus | null {
  if (!isRecord(value)) { return null; }
  const number = safePositiveInteger(value['number']);
  const status = safeString(value['status']);
  const url = safeHttpUrl(value['url']);
  return number !== undefined && status && url ? { number, status, url } : null;
}

function normalizeAttachments(value: unknown): Array<{ filename: string; size: number; mimeType: string }> {
  if (!Array.isArray(value)) { return []; }
  const normalized: Array<{ filename: string; size: number; mimeType: string }> = [];
  for (const item of value.slice(0, 250)) {
    if (!isRecord(item)) { continue; }
    const filename = safeString(item['filename']);
    if (!filename) { continue; }
    normalized.push({
      filename,
      size: safeNonNegativeInteger(item['size']) || 0,
      mimeType: safeString(item['mimeType']) || 'application/octet-stream',
    });
  }
  return normalized;
}

function copyString<K extends keyof ProjectConfig>(raw: Record<string, unknown>, target: ProjectConfig, key: K): void {
  const value = safeString(raw[key]);
  if (value) { (target as Record<string, unknown>)[key] = value; }
}

function normalizeTicketKey(value: string): string | undefined {
  const key = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d{1,12}$/.test(key) ? key : undefined;
}

function safeKey(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || '(unnamed)';
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function safeMultilineString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();
  return normalized ? normalized.slice(0, 128_000) : undefined;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(safeString).filter((item): item is string => Boolean(item)))].slice(0, 500)
    : [];
}

function safePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate) { return undefined; }
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function inspectNoFollowPath(targetPath: string, label: string): fs.Stats {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = fs.lstatSync(current);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} has an unsafe filesystem root: ${current}`);
  }

  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} path contains a non-directory parent: ${current}`);
    }
  }
  return stat;
}

function assertSafeReadableFile(stat: fs.Stats, filePath: string, maxBytes: number, label: string): void {
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filePath}`);
  }
  if (stat.size > maxBytes) {
    throw new Error(`${label} exceeds the ${maxBytes}-byte read limit.`);
  }
}

function readDescriptorBounded(descriptor: number, maxBytes: number, label: string): Buffer {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
  while (true) {
    const remaining = maxBytes + 1 - totalBytes;
    if (remaining <= 0) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte read limit.`);
    }
    const bytesRead = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, remaining), null);
    if (bytesRead === 0) { break; }
    chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
    totalBytes += bytesRead;
    if (totalBytes > maxBytes) {
      throw new Error(`${label} exceeds the ${maxBytes}-byte read limit.`);
    }
  }
  return Buffer.concat(chunks, totalBytes);
}

function sameFileIdentity(left: fs.Stats, right: fs.Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: fs.Stats, right: fs.Stats): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code);
}

function ensurePrivateDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true, mode: DIRECTORY_MODE });
  const stat = fs.lstatSync(directoryPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) { throw new Error('Kronos data path must be a real directory.'); }
  if (process.platform !== 'win32') { fs.chmodSync(directoryPath, DIRECTORY_MODE); }
}

function rejectUnsafeExistingFile(filePath: string): void {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) { throw new Error('Kronos Work catalog path must be a regular file.'); }
  } catch (error: unknown) {
    if (isRecord(error) && error['code'] === 'ENOENT') { return; }
    throw error;
  }
}
