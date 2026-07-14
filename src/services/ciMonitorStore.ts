import * as fs from 'fs';
import * as path from 'path';
import { CiMonitorDigest, normalizeCiMonitorDigest } from './ciTransitions';
import { readPrivateTextFileIfPresent, writePrivateTextFileAtomically } from './privateFilePrimitives';
import { WorkSessionStoreOptions, workSessionDirectory } from './workSessionStore';

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;

export function ciMonitorSnapshotPath(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): string {
  return path.join(workSessionDirectory(normalizeSessionId(sessionId), options), 'ci-monitor.json');
}

export function readCiMonitorSnapshot(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): CiMonitorDigest | null {
  const filePath = ciMonitorSnapshotPath(sessionId, options);
  const directoryPath = path.dirname(filePath);
  const directoryStat = lstatIfPresent(directoryPath);
  if (!directoryStat) { return null; }
  assertSafeDirectory(directoryPath, directoryStat);
  assertPrivateMode(directoryPath, directoryStat, DIRECTORY_MODE, 'directory');

  let parsed: unknown;
  try {
    const serialized = readPrivateTextFileIfPresent(filePath, {
      label: 'CI monitor snapshot',
      maxBytes: MAX_SNAPSHOT_BYTES,
      expectedMode: FILE_MODE,
    });
    if (serialized === null) { return null; }
    parsed = JSON.parse(serialized) as unknown;
  } catch (error: unknown) {
    if (error instanceof SyntaxError) {
      throw new Error('CI monitor snapshot contains invalid JSON; provider content is not displayed.');
    }
    throw error;
  }
  const normalized = normalizeCiMonitorDigest(parsed);
  if (!normalized) {
    throw new Error('CI monitor snapshot has an invalid or unsupported structure; provider content is not displayed.');
  }
  return normalized;
}

export function writeCiMonitorSnapshot(
  sessionId: string,
  digest: CiMonitorDigest | unknown,
  options: WorkSessionStoreOptions = {},
): string {
  const normalized = normalizeCiMonitorDigest(digest);
  if (!normalized) { throw new Error('CI monitor snapshot is invalid and was not written.'); }

  const filePath = ciMonitorSnapshotPath(sessionId, options);
  const directoryPath = path.dirname(filePath);
  const directoryStat = lstatIfPresent(directoryPath);
  if (!directoryStat) {
    throw new Error(`CI monitor work session directory does not exist: ${directoryPath}`);
  }
  assertSafeDirectory(directoryPath, directoryStat);
  setPrivateDirectoryMode(directoryPath);

  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  return writePrivateTextFileAtomically(filePath, serialized, {
    label: 'CI monitor snapshot',
    maxBytes: MAX_SNAPSHOT_BYTES,
    expectedMode: FILE_MODE,
    temporaryPrefix: 'ci-monitor',
    fileMode: FILE_MODE,
  });
}

function normalizeSessionId(value: string): string {
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error('Work session id is missing or invalid.'); }
  return normalized;
}

function lstatIfPresent(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') { return null; }
    throw error;
  }
}

function assertSafeDirectory(directoryPath: string, stat: fs.Stats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`CI monitor directory is not a safe directory: ${directoryPath}`);
  }
  if (fs.realpathSync(directoryPath) !== path.resolve(directoryPath)) {
    throw new Error(`CI monitor directory path contains a symbolic link: ${directoryPath}`);
  }
}

function assertPrivateMode(filePath: string, stat: fs.Stats, expectedMode: number, label: string): void {
  if (process.platform !== 'win32' && (stat.mode & 0o777) !== expectedMode) {
    throw new Error(`CI monitor ${label} does not have private permissions: ${filePath}`);
  }
}

function setPrivateDirectoryMode(directoryPath: string): void {
  if (process.platform !== 'win32') { fs.chmodSync(directoryPath, DIRECTORY_MODE); }
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') { return undefined; }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}
