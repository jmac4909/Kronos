import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from './records';
import { GitLabPipelineDigest, normalizeGitLabPipelineDigest } from './pipelineTransitions';
import { WorkSessionStoreOptions, workSessionDirectory } from './workSessionStore';

const FILE_MODE = 0o600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const NO_FOLLOW_VALUE = Reflect.get(fs.constants, 'O_NOFOLLOW');
const NO_FOLLOW_FLAG = typeof NO_FOLLOW_VALUE === 'number' ? NO_FOLLOW_VALUE : 0;

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
  if (!assertSafeRegularFileIfPresent(filePath)) { return null; }
  const parsed = JSON.parse(readSafeRegularFile(filePath)) as unknown;
  const record = isRecord(parsed) ? parsed : {};
  const tests = isRecord(record['tests']) ? record['tests'] : {};
  const snapshot: Record<string, unknown> = {
    pipeline: record,
    jobs: record['failedJobs'],
    fetchedAt: record['fetchedAt'],
  };
  if (tests['available'] === true) {
    snapshot['testReportSummary'] = {
      total: {
        count: tests['total'],
        failed: tests['failed'],
        error: tests['error'],
        skipped: tests['skipped'],
      },
    };
  }
  return normalizeGitLabPipelineDigest(snapshot);
}

export function writeGitLabPipelineMonitorSnapshot(
  sessionId: string,
  digest: GitLabPipelineDigest,
  options: WorkSessionStoreOptions = {},
): string {
  const filePath = gitLabPipelineMonitorSnapshotPath(sessionId, options);
  const directoryPath = path.dirname(filePath);
  assertSafeDirectory(directoryPath);
  assertSafeRegularFileIfPresent(filePath);
  const serialized = `${JSON.stringify(digest, null, 2)}\n`;
  if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new Error(`GitLab pipeline monitor snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit.`);
  }
  const temporaryPath = path.join(
    directoryPath,
    `.gitlab-pipeline.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
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
      throw new Error(`GitLab pipeline monitor snapshot is not a safe regular file: ${temporaryPath}`);
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

function normalizeId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error('Work session id is missing or invalid.'); }
  return normalized;
}

function assertSafeRegularFileIfPresent(filePath: string): boolean {
  const stat = inspectSafePathComponents(filePath);
  if (!stat) { return false; }
  if (!stat.isFile()) {
    throw new Error(`GitLab pipeline monitor snapshot is not a safe regular file: ${filePath}`);
  }
  return true;
}

function assertSafeRegularFile(filePath: string): void {
  const stat = inspectSafePathComponents(filePath);
  if (!stat || !stat.isFile()) {
    throw new Error(`GitLab pipeline monitor snapshot is not a safe regular file: ${filePath}`);
  }
}

function assertSafeDirectory(directoryPath: string): void {
  const stat = inspectSafePathComponents(directoryPath);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`GitLab pipeline monitor directory is unsafe: ${directoryPath}`);
  }
}

function inspectSafePathComponents(targetPath: string): fs.Stats | null {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = lstatIfPresent(current);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`GitLab pipeline monitor path has an unsafe filesystem root: ${current}`);
  }

  const components = pathComponents(resolved);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = lstatIfPresent(current);
    if (!stat) { return null; }
    if (stat.isSymbolicLink()) {
      throw new Error(`GitLab pipeline monitor path has a symbolic-link component: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`GitLab pipeline monitor path has a non-directory parent component: ${current}`);
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
      throw new Error(`GitLab pipeline monitor snapshot is not a safe regular file: ${filePath}`);
    }
    if (stat.size > MAX_SNAPSHOT_BYTES) {
      throw new Error(`GitLab pipeline monitor snapshot exceeds the ${MAX_SNAPSHOT_BYTES}-byte limit.`);
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
