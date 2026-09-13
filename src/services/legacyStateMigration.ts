import * as fs from 'fs';
import * as path from 'path';
import { assertSafeDirectoryPath } from './privateFilePrimitives';

export interface LegacyStateMigrationResult {
  migrated: boolean;
  method?: 'rename' | 'copy';
  reason?: 'target-exists' | 'legacy-missing' | 'unsafe' | 'failed';
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_ENTRIES = 20_000;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * Moves the pre-0.1 ~/.claude/kronos data home into ~/.kronos once. The
 * explicit KRONOS_DIR path never calls this migration. A cross-device move is
 * copied into a temporary sibling and made visible only after a complete,
 * no-symlink traversal; the legacy directory remains as a recovery copy.
 */
export function migrateLegacyKronosState(
  targetPathValue: string,
  legacyPathValue: string,
): LegacyStateMigrationResult {
  const targetPath = path.resolve(targetPathValue);
  const legacyPath = path.resolve(legacyPathValue);
  if (lstatIfPresent(targetPath)) { return { migrated: false, reason: 'target-exists' }; }
  let legacyStat: fs.Stats;
  try {
    legacyStat = fs.lstatSync(legacyPath);
  } catch (error: unknown) {
    return errorCode(error) === 'ENOENT'
      ? { migrated: false, reason: 'legacy-missing' }
      : { migrated: false, reason: 'failed' };
  }
  if (legacyStat.isSymbolicLink() || !legacyStat.isDirectory()) {
    return { migrated: false, reason: 'unsafe' };
  }
  try {
    assertSafeDirectoryPath(path.dirname(targetPath), 'Legacy Kronos migration target');
    assertSafeDirectoryPath(legacyPath, 'Legacy Kronos migration source');
  } catch {
    return { migrated: false, reason: 'unsafe' };
  }
  const temporaryPath = `${targetPath}.migration-${process.pid}-${Date.now()}`;
  try {
    if (lstatIfPresent(temporaryPath)) { return { migrated: false, reason: 'failed' }; }
  } catch {
    return { migrated: false, reason: 'failed' };
  }

  try {
    fs.renameSync(legacyPath, temporaryPath);
  } catch (error: unknown) {
    if (errorCode(error) === 'EXDEV') {
      return copyLegacyKronosState(legacyPath, temporaryPath, targetPath);
    }
    return { migrated: false, reason: 'failed' };
  }

  try {
    makePrivateTree(temporaryPath);
  } catch {
    restoreStagedLegacyDirectory(temporaryPath, legacyPath);
    return { migrated: false, reason: 'unsafe' };
  }
  try {
    if (lstatIfPresent(targetPath)) {
      restoreStagedLegacyDirectory(temporaryPath, legacyPath);
      return { migrated: false, reason: 'target-exists' };
    }
    fs.renameSync(temporaryPath, targetPath);
    return { migrated: true, method: 'rename' };
  } catch {
    restoreStagedLegacyDirectory(temporaryPath, legacyPath);
    return { migrated: false, reason: 'failed' };
  }
}

function copyLegacyKronosState(
  legacyPath: string,
  temporaryPath: string,
  targetPath: string,
): LegacyStateMigrationResult {
  try {
    copyLegacyDirectory(legacyPath, temporaryPath);
    makePrivateTree(temporaryPath);
    if (lstatIfPresent(targetPath)) {
      removeStagedLegacyDirectory(temporaryPath);
      return { migrated: false, reason: 'target-exists' };
    }
    fs.renameSync(temporaryPath, targetPath);
    return { migrated: true, method: 'copy' };
  } catch {
    removeStagedLegacyDirectory(temporaryPath);
    return { migrated: false, reason: 'failed' };
  }
}

function restoreStagedLegacyDirectory(temporaryPath: string, legacyPath: string): void {
  try {
    if (lstatIfPresent(legacyPath)) { return; }
    fs.renameSync(temporaryPath, legacyPath);
  } catch { /* the private staging path retains the complete recovery copy */ }
}

function removeStagedLegacyDirectory(temporaryPath: string): void {
  try { fs.rmSync(temporaryPath, { recursive: true, force: true }); } catch { /* best effort temporary cleanup */ }
}

function copyLegacyDirectory(sourceRoot: string, targetRoot: string): void {
  const work: Array<{ source: string; target: string }> = [{ source: sourceRoot, target: targetRoot }];
  let entries = 0;
  let totalBytes = 0;
  while (work.length > 0) {
    const current = work.pop()!;
    const stat = fs.lstatSync(current.source);
    if (stat.isSymbolicLink()) { throw new Error('Legacy Kronos state contains a symbolic link.'); }
    if (stat.isDirectory()) {
      fs.mkdirSync(current.target, { mode: DIRECTORY_MODE });
      for (const entry of fs.readdirSync(current.source, { withFileTypes: true })) {
        entries += 1;
        if (entries > MAX_ENTRIES || entry.isSymbolicLink()) {
          throw new Error('Legacy Kronos state exceeds migration safety limits.');
        }
        work.push({
          source: path.join(current.source, entry.name),
          target: path.join(current.target, entry.name),
        });
      }
      continue;
    }
    if (!stat.isFile()) { throw new Error('Legacy Kronos state contains an unsupported file type.'); }
    totalBytes += stat.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Legacy Kronos state exceeds migration byte limits.');
    }
    fs.copyFileSync(current.source, current.target, fs.constants.COPYFILE_EXCL);
    if (process.platform !== 'win32') { fs.chmodSync(current.target, FILE_MODE); }
  }
}

function makePrivateTree(targetPath: string): void {
  const work = [targetPath];
  let entries = 0;
  let totalBytes = 0;
  while (work.length > 0) {
    const current = work.pop()!;
    const stat = fs.lstatSync(current);
    entries += 1;
    if (entries > MAX_ENTRIES || stat.isSymbolicLink()) {
      throw new Error('Legacy Kronos state exceeds migration safety limits.');
    }
    if (stat.isDirectory()) {
      if (process.platform !== 'win32') { fs.chmodSync(current, DIRECTORY_MODE); }
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) { throw new Error('Legacy Kronos state contains a symbolic link.'); }
        work.push(path.join(current, entry.name));
      }
      continue;
    }
    if (!stat.isFile()) { throw new Error('Legacy Kronos state contains an unsupported file type.'); }
    totalBytes += stat.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Legacy Kronos state exceeds migration byte limits.');
    }
    if (process.platform !== 'win32') { fs.chmodSync(current, FILE_MODE); }
  }
}

function lstatIfPresent(targetPath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(targetPath);
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') { return undefined; }
    throw error;
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof Reflect.get(error, 'code') === 'string'
    ? Reflect.get(error, 'code') as string
    : undefined;
}
