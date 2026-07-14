import * as crypto from 'crypto';
import * as path from 'path';
import {
  GitLabMergeRequestDigest,
  normalizeStoredGitLabMergeRequestDigest,
} from './gitlabMergeRequestTransitions';
import { readPrivateTextFileIfPresent, writePrivateTextFileAtomically } from './privateFilePrimitives';
import { WorkSessionStoreOptions, workSessionDirectory } from './workSessionStore';

const FILE_MODE = 0o600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
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
  const serialized = readPrivateTextFileIfPresent(filePath, {
    label: 'GitLab merge-request monitor snapshot',
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
  });
  if (serialized === null) { return null; }
  const parsed = JSON.parse(serialized) as unknown;
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
  const serialized = readPrivateTextFileIfPresent(filePath, {
    label: 'GitLab merge-request read status',
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
  });
  if (serialized === null) { return null; }
  const parsed = JSON.parse(serialized) as unknown;
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
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  return writePrivateTextFileAtomically(filePath, serialized, {
    label,
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
    temporaryPrefix: 'gitlab-merge-request',
    fileMode: FILE_MODE,
  });
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
