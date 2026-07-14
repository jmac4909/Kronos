import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface PrivateFileReadOptions {
  label: string;
  maxBytes: number;
  expectedMode?: number;
}

interface PrivateFileWriteOptions extends PrivateFileReadOptions {
  temporaryPrefix: string;
  fileMode?: number;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

/**
 * Windows has no O_NOFOLLOW. Callers compensate with complete lstat/fstat
 * identity checks. POSIX keeps the kernel guard and fails closed without it.
 */
export function privateFileNoFollowFlag(platform: NodeJS.Platform, flagValue: unknown): number {
  if (platform === 'win32') { return 0; }
  if (typeof flagValue !== 'number' || flagValue === 0) {
    throw new Error('Private Kronos files require O_NOFOLLOW support on POSIX.');
  }
  return flagValue;
}

/** Reads one bounded regular file after path, descriptor, and identity checks. */
export function readPrivateTextFileIfPresent(
  filePath: string,
  options: PrivateFileReadOptions,
): string | null {
  const before = inspectSafePathComponents(filePath, options.label);
  if (!before) { return null; }
  assertRegularFile(filePath, before, options);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | privateFileNoFollowFlag(process.platform, Reflect.get(fs.constants, 'O_NOFOLLOW')),
    );
    const opened = fs.fstatSync(descriptor);
    assertRegularFile(filePath, opened, options);
    if (!sameIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw new Error(`${options.label} changed while it was being opened.`);
    }
    const content = readDescriptorFully(descriptor, opened.size, options);
    const after = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    assertRegularFile(filePath, after, options);
    assertRegularFile(filePath, pathAfter, options);
    if (!sameIdentity(fileIdentity(opened), fileIdentity(after))
      || !sameIdentity(fileIdentity(opened), fileIdentity(pathAfter))
      || after.size !== opened.size) {
      throw new Error(`${options.label} changed while it was being read.`);
    }
    return content.toString('utf8');
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

/** Writes one bounded private file through an exclusive same-directory temp. */
export function writePrivateTextFileAtomically(
  filePath: string,
  content: string,
  options: PrivateFileWriteOptions,
): string {
  const data = Buffer.from(content, 'utf8');
  assertBoundedSize(data.length, options);
  const inspectionOptions: PrivateFileReadOptions = {
    label: options.label,
    maxBytes: options.maxBytes,
  };
  const directoryPath = path.dirname(filePath);
  const directoryBefore = requireSafeDirectory(directoryPath, options.label);
  const existing = inspectSafePathComponents(filePath, options.label);
  if (existing) { assertRegularFile(filePath, existing, inspectionOptions); }

  const fileMode = options.fileMode ?? 0o600;
  const temporaryPath = path.join(
    directoryPath,
    `.${safeTemporaryPrefix(options.temporaryPrefix)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  let temporaryIdentity: FileIdentity | undefined;
  try {
    if (inspectSafePathComponents(temporaryPath, options.label)) {
      throw new Error(`${options.label} temporary path already exists.`);
    }
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | privateFileNoFollowFlag(process.platform, Reflect.get(fs.constants, 'O_NOFOLLOW')),
      fileMode,
    );
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.isSymbolicLink()) {
      throw new Error(`${options.label} temporary path is not a safe regular file.`);
    }
    temporaryIdentity = fileIdentity(opened);
    if (process.platform !== 'win32') { fs.fchmodSync(descriptor, fileMode); }
    writeDescriptorFully(descriptor, data, options);
    fs.fsyncSync(descriptor);
    const completed = fs.fstatSync(descriptor);
    if (!completed.isFile()
      || !sameIdentity(temporaryIdentity, fileIdentity(completed))
      || completed.size !== data.length) {
      throw new Error(`${options.label} temporary file changed while it was written.`);
    }
    fs.closeSync(descriptor);
    descriptor = undefined;

    const tempPathStat = fs.lstatSync(temporaryPath);
    if (!tempPathStat.isFile() || tempPathStat.isSymbolicLink()
      || !sameIdentity(temporaryIdentity, fileIdentity(tempPathStat))) {
      throw new Error(`${options.label} temporary path changed before commit.`);
    }
    const directoryAtCommit = requireSafeDirectory(directoryPath, options.label);
    if (!sameIdentity(fileIdentity(directoryBefore), fileIdentity(directoryAtCommit))) {
      throw new Error(`${options.label} directory changed before commit.`);
    }
    const targetAtCommit = inspectSafePathComponents(filePath, options.label);
    if (targetAtCommit) { assertRegularFile(filePath, targetAtCommit, inspectionOptions); }
    fs.renameSync(temporaryPath, filePath);
    const committed = fs.lstatSync(filePath);
    assertRegularFile(filePath, committed, { ...options, expectedMode: fileMode });
    if (!sameIdentity(temporaryIdentity, fileIdentity(committed)) || committed.size !== data.length) {
      throw new Error(`${options.label} changed during atomic commit.`);
    }
    syncDirectory(directoryPath);
    temporaryIdentity = undefined;
    return filePath;
  } catch (error: unknown) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    removeMatchingFile(temporaryPath, temporaryIdentity);
    throw error;
  }
}

function inspectSafePathComponents(targetPath: string, label: string): fs.Stats | null {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = lstatIfPresent(current);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} has an unsafe filesystem root.`);
  }
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = lstatIfPresent(current);
    if (!stat) { return null; }
    if (stat.isSymbolicLink()) { throw new Error(`${label} path contains a symbolic link.`); }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} path contains a non-directory parent.`);
    }
  }
  return stat;
}

function requireSafeDirectory(directoryPath: string, label: string): fs.Stats {
  const stat = inspectSafePathComponents(directoryPath, label);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} directory is unsafe or unavailable.`);
  }
  return stat;
}

function assertRegularFile(
  filePath: string,
  stat: fs.Stats,
  options: PrivateFileReadOptions,
): void {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${options.label} is not a safe regular file: ${filePath}`);
  }
  assertBoundedSize(stat.size, options);
  if (options.expectedMode !== undefined
    && process.platform !== 'win32'
    && (stat.mode & 0o777) !== options.expectedMode) {
    throw new Error(`${options.label} does not have private permissions.`);
  }
}

function readDescriptorFully(
  descriptor: number,
  size: number,
  options: PrivateFileReadOptions,
): Buffer {
  assertBoundedSize(size, options);
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = fs.readSync(descriptor, content, offset, size - offset, offset);
    if (bytesRead <= 0) { throw new Error(`${options.label} ended before its recorded size.`); }
    offset += bytesRead;
  }
  return content;
}

function writeDescriptorFully(
  descriptor: number,
  content: Buffer,
  options: PrivateFileWriteOptions,
): void {
  let offset = 0;
  while (offset < content.length) {
    const bytesWritten = fs.writeSync(descriptor, content, offset, content.length - offset, offset);
    if (bytesWritten <= 0) { throw new Error(`${options.label} could not be written completely.`); }
    offset += bytesWritten;
  }
}

function assertBoundedSize(size: number, options: PrivateFileReadOptions): void {
  if (!Number.isSafeInteger(size) || size < 0 || size > options.maxBytes) {
    throw new Error(`${options.label} exceeds the ${options.maxBytes}-byte limit.`);
  }
}

function safeTemporaryPrefix(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(normalized)) {
    throw new Error('Private file temporary prefix is invalid.');
  }
  return normalized;
}

function fileIdentity(stat: fs.Stats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function lstatIfPresent(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error: unknown) {
    if (errorCode(error) === 'ENOENT') { return null; }
    throw error;
  }
}

function removeMatchingFile(filePath: string, identity: FileIdentity | undefined): void {
  if (!identity) { return; }
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isFile() && !stat.isSymbolicLink() && sameIdentity(identity, fileIdentity(stat))) {
      fs.unlinkSync(filePath);
    }
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') { throw error; }
  }
}

function syncDirectory(directoryPath: string): void {
  if (process.platform === 'win32') { return; }
  const noFollow = privateFileNoFollowFlag(process.platform, Reflect.get(fs.constants, 'O_NOFOLLOW'));
  const directoryFlag = typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;
  const descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | directoryFlag | noFollow);
  try {
    if (!fs.fstatSync(descriptor).isDirectory()) { throw new Error('Private file parent is not a directory.'); }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && typeof Reflect.get(error, 'code') === 'string'
    ? Reflect.get(error, 'code') as string
    : undefined;
}
