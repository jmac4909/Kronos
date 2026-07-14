import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  GitLabMergeRequestDigest,
  normalizeStoredGitLabMergeRequestDigest,
} from './gitlabMergeRequestTransitions';
import { WorkSessionStoreOptions, workSessionDirectory } from './workSessionStore';

const FILE_MODE = 0o600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const NO_FOLLOW_VALUE = Reflect.get(fs.constants, 'O_NOFOLLOW');
const NO_FOLLOW_FLAG = typeof NO_FOLLOW_VALUE === 'number' ? NO_FOLLOW_VALUE : 0;
const READ_STATES = new Set<GitLabMergeRequestReadState>(['complete', 'partial', 'failed']);
const READ_COMPONENTS = new Set([
  'merge-request',
  'pipelines',
  'jobs',
  'tests',
  'notes',
  'discussions',
  'approvals',
]);
const SAFE_REASON_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

export type GitLabMergeRequestReadState = 'complete' | 'partial' | 'failed';

export interface GitLabMergeRequestReadStatus {
  schemaVersion: 1;
  generation: number;
  state: GitLabMergeRequestReadState;
  components: string[];
  reason: string;
  updatedAt: string;
  fingerprint: string;
}

export interface GitLabMergeRequestReadStatusInput {
  state: GitLabMergeRequestReadState;
  components?: readonly string[];
  reason: string;
  updatedAt?: string;
}

export function gitLabMergeRequestMonitorSnapshotPath(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): string {
  return path.join(workSessionDirectory(normalizeId(sessionId), options), 'gitlab-merge-request.json');
}

export function gitLabMergeRequestReadStatusPath(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): string {
  return path.join(workSessionDirectory(normalizeId(sessionId), options), 'gitlab-merge-request-read.json');
}

export function readGitLabMergeRequestMonitorSnapshot(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): GitLabMergeRequestDigest | null {
  const filePath = gitLabMergeRequestMonitorSnapshotPath(sessionId, options);
  if (!assertSafeRegularFileIfPresent(filePath)) { return null; }
  const parsed = JSON.parse(readSafeRegularFile(filePath)) as unknown;
  return normalizeStoredGitLabMergeRequestDigest(parsed);
}

export function writeGitLabMergeRequestMonitorSnapshot(
  sessionId: string,
  digest: GitLabMergeRequestDigest,
  options: WorkSessionStoreOptions = {},
): string {
  const filePath = gitLabMergeRequestMonitorSnapshotPath(sessionId, options);
  return writePrivateSnapshot(filePath, digest, 'GitLab merge-request monitor snapshot');
}

export function readGitLabMergeRequestReadStatus(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): GitLabMergeRequestReadStatus | null {
  const filePath = gitLabMergeRequestReadStatusPath(sessionId, options);
  if (!assertSafeRegularFileIfPresent(filePath)) { return null; }
  const parsed = JSON.parse(readSafeRegularFile(filePath)) as unknown;
  return normalizeReadStatus(parsed);
}

export function advanceGitLabMergeRequestReadStatus(
  previous: GitLabMergeRequestReadStatus | null,
  input: GitLabMergeRequestReadStatusInput,
): { status: GitLabMergeRequestReadStatus; changed: boolean } {
  const state = READ_STATES.has(input.state) ? input.state : 'failed';
  const components = normalizeReadComponents(input.components || []);
  const reason = normalizeReason(input.reason);
  const fingerprint = readStatusFingerprint(state, components, reason);
  if (previous && previous.fingerprint === fingerprint) {
    return { status: previous, changed: false };
  }
  const generation = Math.min(Number.MAX_SAFE_INTEGER, (previous?.generation || 0) + 1);
  return {
    changed: true,
    status: {
      schemaVersion: 1,
      generation,
      state,
      components,
      reason,
      updatedAt: normalizeTimestamp(input.updatedAt || new Date().toISOString()),
      fingerprint,
    },
  };
}

export function writeGitLabMergeRequestReadStatus(
  sessionId: string,
  status: GitLabMergeRequestReadStatus,
  options: WorkSessionStoreOptions = {},
): string {
  const normalized = normalizeReadStatus(status);
  if (!normalized) { throw new Error('GitLab merge-request read status is invalid.'); }
  const filePath = gitLabMergeRequestReadStatusPath(sessionId, options);
  return writePrivateSnapshot(filePath, normalized, 'GitLab merge-request read status');
}

function writePrivateSnapshot(filePath: string, value: unknown, label: string): string {
  const directoryPath = path.dirname(filePath);
  assertSafeDirectory(directoryPath);
  assertSafeRegularFileIfPresent(filePath);
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error(`${label} exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit.`);
  }
  const temporaryPath = path.join(
    directoryPath,
    `.gitlab-merge-request.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    assertSafeDirectory(directoryPath);
    assertSafeRegularFileIfPresent(temporaryPath);
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW_FLAG,
      FILE_MODE,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`${label} is not a safe regular file: ${temporaryPath}`);
    }
    if (process.platform !== 'win32') { fs.fchmodSync(descriptor, FILE_MODE); }
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertSafeRegularFile(temporaryPath);
    assertSafeDirectory(directoryPath);
    assertSafeRegularFileIfPresent(filePath);
    fs.renameSync(temporaryPath, filePath);
    assertSafeRegularFile(filePath);
    setPrivateMode(filePath);
  } catch (error: unknown) {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
    removeIfPresent(temporaryPath);
    throw error;
  }
  return filePath;
}

function normalizeReadStatus(value: unknown): GitLabMergeRequestReadStatus | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return null; }
  const record = value as Record<string, unknown>;
  if (record['schemaVersion'] !== 1) { return null; }
  const generation = typeof record['generation'] === 'number' && Number.isSafeInteger(record['generation'])
    && record['generation'] > 0
    ? record['generation']
    : undefined;
  const state = typeof record['state'] === 'string' && READ_STATES.has(record['state'] as GitLabMergeRequestReadState)
    ? record['state'] as GitLabMergeRequestReadState
    : undefined;
  if (!generation || !state) { return null; }
  const components = normalizeReadComponents(Array.isArray(record['components']) ? record['components'] : []);
  const reason = typeof record['reason'] === 'string' ? normalizeReason(record['reason']) : 'unavailable';
  const fingerprint = readStatusFingerprint(state, components, reason);
  if (record['fingerprint'] !== fingerprint) { return null; }
  return {
    schemaVersion: 1,
    generation,
    state,
    components,
    reason,
    updatedAt: normalizeTimestamp(record['updatedAt']),
    fingerprint,
  };
}

function normalizeReadComponents(values: readonly unknown[]): string[] {
  return [...new Set(values
    .filter((value): value is string => typeof value === 'string')
    .map(value => value.trim().toLowerCase())
    .filter(value => READ_COMPONENTS.has(value)))]
    .sort();
}

function normalizeReason(value: string): string {
  const normalized = value.trim().toLowerCase();
  return SAFE_REASON_PATTERN.test(normalized) ? normalized : 'unavailable';
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) { throw new Error('GitLab merge-request read status timestamp is invalid.'); }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) { throw new Error('GitLab merge-request read status timestamp is invalid.'); }
  return parsed.toISOString();
}

function readStatusFingerprint(state: GitLabMergeRequestReadState, components: string[], reason: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ state, components, reason })).digest('hex');
}

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error('Work session id is missing or invalid.'); }
  return normalized;
}

function assertSafeRegularFileIfPresent(filePath: string): boolean {
  const stat = inspectSafePathComponents(filePath);
  if (!stat) { return false; }
  if (!stat.isFile()) {
    throw new Error(`GitLab merge-request monitor snapshot is not a safe regular file: ${filePath}`);
  }
  return true;
}

function assertSafeRegularFile(filePath: string): void {
  const stat = inspectSafePathComponents(filePath);
  if (!stat || !stat.isFile()) {
    throw new Error(`GitLab merge-request monitor snapshot is not a safe regular file: ${filePath}`);
  }
}

function assertSafeDirectory(directoryPath: string): void {
  const stat = inspectSafePathComponents(directoryPath);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`GitLab merge-request monitor directory is unsafe: ${directoryPath}`);
  }
}

function inspectSafePathComponents(targetPath: string): fs.Stats | null {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = lstatIfPresent(current);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`GitLab merge-request monitor path has an unsafe filesystem root: ${current}`);
  }

  const components = pathComponents(resolved);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = lstatIfPresent(current);
    if (!stat) { return null; }
    if (stat.isSymbolicLink()) {
      throw new Error(`GitLab merge-request monitor path has a symbolic-link component: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`GitLab merge-request monitor path has a non-directory parent component: ${current}`);
    }
  }
  return stat;
}

function pathComponents(targetPath: string): string[] {
  const resolved = path.resolve(targetPath);
  const root = path.parse(resolved).root;
  return resolved.slice(root.length).split(path.sep).filter(Boolean);
}

function lstatIfPresent(targetPath: string): fs.Stats | null {
  try {
    return fs.lstatSync(targetPath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) { return null; }
    throw error;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code);
}

function readSafeRegularFile(filePath: string): string {
  assertSafeRegularFile(filePath);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`GitLab merge-request monitor snapshot is not a safe regular file: ${filePath}`);
    }
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      throw new Error(`GitLab merge-request monitor snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit.`);
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function setPrivateMode(filePath: string): void {
  if (process.platform !== 'win32') {
    assertSafeRegularFile(filePath);
    fs.chmodSync(filePath, FILE_MODE);
  }
}

function removeIfPresent(filePath: string): void {
  try {
    assertSafeDirectory(path.dirname(filePath));
    if (assertSafeRegularFileIfPresent(filePath)) { fs.unlinkSync(filePath); }
  } catch (error: unknown) {
    if (!hasErrorCode(error, 'ENOENT')) { throw error; }
  }
}
