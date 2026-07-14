import * as path from 'path';
import { GitLabPipelineDigest, normalizeStoredGitLabPipelineDigest } from './pipelineTransitions';
import { readPrivateTextFileIfPresent, writePrivateTextFileAtomically } from './privateFilePrimitives';
import { WorkSessionStoreOptions, workSessionDirectory } from './workSessionStore';

const FILE_MODE = 0o600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;

export function gitLabPipelineMonitorSnapshotPath(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): string {
  return path.join(workSessionDirectory(normalizeId(sessionId), options), 'gitlab-pipeline.json');
}

export function readGitLabPipelineMonitorSnapshot(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): GitLabPipelineDigest | null {
  const filePath = gitLabPipelineMonitorSnapshotPath(sessionId, options);
  const serialized = readPrivateTextFileIfPresent(filePath, {
    label: 'GitLab pipeline monitor snapshot',
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
  });
  if (serialized === null) { return null; }
  const parsed = JSON.parse(serialized) as unknown;
  return normalizeStoredGitLabPipelineDigest(parsed);
}

export function writeGitLabPipelineMonitorSnapshot(
  sessionId: string,
  digest: GitLabPipelineDigest,
  options: WorkSessionStoreOptions = {},
): string {
  const filePath = gitLabPipelineMonitorSnapshotPath(sessionId, options);
  const serialized = `${JSON.stringify(digest, null, 2)}\n`;
  return writePrivateTextFileAtomically(filePath, serialized, {
    label: 'GitLab pipeline monitor snapshot',
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
    temporaryPrefix: 'gitlab-pipeline',
    fileMode: FILE_MODE,
  });
}

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error('Work session id is missing or invalid.'); }
  return normalized;
}
