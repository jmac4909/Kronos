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

interface PrivateFileAppendOptions extends PrivateFileReadOptions {
  fileMode?: number;
}

interface PrivateImmutableFileOptions extends PrivateFileWriteOptions {}

export interface ImmutablePrivateFileResult {
  path: string;
  created: boolean;
}

export interface ImmutablePrivateFilePairResult {
  first: ImmutablePrivateFileResult;
  second: ImmutablePrivateFileResult;
}

interface FileIdentity {
  dev: number;
  ino: number;
}

/** Creates one private directory path without following existing symbolic-link ancestors. */
export function ensurePrivateDirectoryPath(
  directoryPath: string,
  label: string,
  mode = 0o700,
): string {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new Error(`${label} directory mode is invalid.`);
  }
  const resolved = path.resolve(directoryPath);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root) {
    throw new Error(`${label} directory must not be the filesystem root.`);
  }

  let current = parsed.root;
  requireSafeDirectory(current, label);
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  for (const component of components) {
    const parentBefore = requireSafeDirectory(current, label);
    const candidate = path.join(current, component);
    let candidateStat = lstatIfPresent(candidate);
    if (!candidateStat) {
      try {
        fs.mkdirSync(candidate, { mode });
      } catch (error: unknown) {
        if (errorCode(error) !== 'EEXIST') { throw error; }
      }
      const parentAfter = requireSafeDirectory(current, label);
      if (!sameIdentity(fileIdentity(parentBefore), fileIdentity(parentAfter))) {
        throw new Error(`${label} directory parent changed while it was created.`);
      }
      candidateStat = lstatIfPresent(candidate);
    }
    if (candidateStat?.isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link.`);
    }
    if (!candidateStat || !candidateStat.isDirectory()) {
      throw new Error(`${label} path contains an unsafe directory component.`);
    }
    current = candidate;
  }

  const finalStat = requireSafeDirectory(resolved, label);
  if (process.platform !== 'win32') {
    enforceDirectoryMode(resolved, finalStat, label, mode);
  }
  return resolved;
}

/** Validates one existing directory path without changing its permissions. */
export function assertSafeDirectoryPath(directoryPath: string, label: string): string {
  const resolved = path.resolve(directoryPath);
  requireSafeDirectory(resolved, label);
  return resolved;
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

export type PrivateFileOpenIntent =
  | 'read'
  | 'exclusive-write'
  | 'append-write'
  | 'read-nonblocking'
  | 'read-write-nonblocking'
  | 'directory-read';

export interface PrivateFileOpenFlagValues {
  noFollow?: unknown;
  nonBlocking?: unknown;
  directory?: unknown;
}

/** Owns the only platform-specific open-flag policy used by private state and the monitor lease. */
export function privateFileOpenFlags(
  intent: PrivateFileOpenIntent,
  platform: NodeJS.Platform = process.platform,
  flagValues: PrivateFileOpenFlagValues = {
    noFollow: Reflect.get(fs.constants, 'O_NOFOLLOW'),
    nonBlocking: Reflect.get(fs.constants, 'O_NONBLOCK'),
    directory: Reflect.get(fs.constants, 'O_DIRECTORY'),
  },
): number {
  const noFollow = privateFileNoFollowFlag(platform, flagValues.noFollow);
  const nonBlocking = platform === 'win32'
    ? 0
    : typeof flagValues.nonBlocking === 'number' ? flagValues.nonBlocking : 0;
  const directory = typeof flagValues.directory === 'number' ? flagValues.directory : 0;
  if (intent === 'read') { return fs.constants.O_RDONLY | noFollow; }
  if (intent === 'exclusive-write') {
    return fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow;
  }
  if (intent === 'append-write') {
    return fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | noFollow;
  }
  if (intent === 'read-nonblocking') { return fs.constants.O_RDONLY | nonBlocking | noFollow; }
  if (intent === 'read-write-nonblocking') { return fs.constants.O_RDWR | nonBlocking | noFollow; }
  return fs.constants.O_RDONLY | directory | noFollow;
}

/** Applies private POSIX modes while remaining a no-op on Windows. */
export function securePrivateDescriptorMode(
  descriptor: number,
  mode: number,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== 'win32') { fs.fchmodSync(descriptor, mode); }
}

/** Reads one bounded regular file after path, descriptor, and identity checks. */
export function readPrivateBufferFileIfPresent(
  filePath: string,
  options: PrivateFileReadOptions,
): Buffer | null {
  const before = inspectSafePathComponents(filePath, options.label);
  if (!before) { return null; }
  assertRegularFile(filePath, before, options);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, privateFileOpenFlags('read'));
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
    return content;
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

export function readPrivateTextFileIfPresent(
  filePath: string,
  options: PrivateFileReadOptions,
): string | null {
  return readPrivateBufferFileIfPresent(filePath, options)?.toString('utf8') ?? null;
}

/** Writes one bounded private file through an exclusive same-directory temp. */
export function writePrivateTextFileAtomically(
  filePath: string,
  content: string,
  options: PrivateFileWriteOptions,
): string {
  const data = Buffer.from(content, 'utf8');
  assertBoundedSize(data.length, options);
  const directoryPath = path.dirname(filePath);
  const directoryBefore = requireSafeDirectory(directoryPath, options.label);
  const existing = inspectSafePathComponents(filePath, options.label);
  if (existing) { assertReplaceableRegularFile(filePath, existing, options.label); }

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
    descriptor = fs.openSync(temporaryPath, privateFileOpenFlags('exclusive-write'), fileMode);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.isSymbolicLink()) {
      throw new Error(`${options.label} temporary path is not a safe regular file.`);
    }
    temporaryIdentity = fileIdentity(opened);
    securePrivateDescriptorMode(descriptor, fileMode);
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
    if (targetAtCommit) { assertReplaceableRegularFile(filePath, targetAtCommit, options.label); }
    fs.renameSync(temporaryPath, filePath);
    const committed = fs.lstatSync(filePath);
    assertRegularFile(filePath, committed, { ...options, expectedMode: fileMode });
    if (!sameIdentity(temporaryIdentity, fileIdentity(committed)) || committed.size !== data.length) {
      throw new Error(`${options.label} changed during atomic commit.`);
    }
    syncPrivateDirectory(directoryPath);
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

/** Creates or verifies one bounded immutable content-addressed private artifact. */
export function ensureImmutablePrivateFile(
  filePath: string,
  content: string | Buffer,
  options: PrivateImmutableFileOptions,
): ImmutablePrivateFileResult {
  const data = Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf8');
  assertBoundedSize(data.length, options);
  const directoryPath = path.dirname(filePath);
  const directoryBefore = requireSafeDirectory(directoryPath, options.label);
  const fileMode = options.fileMode ?? 0o600;
  const existing = inspectSafePathComponents(filePath, options.label);
  if (existing) {
    verifyImmutablePrivateFile(filePath, data, options, fileMode);
    return { path: filePath, created: false };
  }

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
    descriptor = fs.openSync(temporaryPath, privateFileOpenFlags('exclusive-write'), fileMode);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.isSymbolicLink()) {
      throw new Error(`${options.label} temporary path is not a safe regular file.`);
    }
    temporaryIdentity = fileIdentity(opened);
    securePrivateDescriptorMode(descriptor, fileMode);
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
      throw new Error(`${options.label} temporary path changed before publication.`);
    }
    const directoryAtCommit = requireSafeDirectory(directoryPath, options.label);
    if (!sameIdentity(fileIdentity(directoryBefore), fileIdentity(directoryAtCommit))) {
      throw new Error(`${options.label} directory changed before publication.`);
    }
    const targetAtCommit = inspectSafePathComponents(filePath, options.label);
    if (targetAtCommit) {
      verifyImmutablePrivateFile(filePath, data, options, fileMode);
      return { path: filePath, created: false };
    }
    try {
      fs.linkSync(temporaryPath, filePath);
    } catch (error: unknown) {
      if (errorCode(error) !== 'EEXIST') { throw error; }
      verifyImmutablePrivateFile(filePath, data, options, fileMode);
      return { path: filePath, created: false };
    }
    const committed = fs.lstatSync(filePath);
    assertRegularFile(filePath, committed, { ...options, expectedMode: fileMode });
    if (!sameIdentity(temporaryIdentity, fileIdentity(committed)) || committed.size !== data.length) {
      throw new Error(`${options.label} changed during immutable publication.`);
    }
    fs.unlinkSync(temporaryPath);
    temporaryIdentity = undefined;
    syncPrivateDirectory(directoryPath);
    return { path: filePath, created: true };
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    removeMatchingFile(temporaryPath, temporaryIdentity);
  }
}

/** Publishes or verifies two immutable files without accepting a pre-existing partial pair. */
export function ensureImmutablePrivateFilePair(
  firstPath: string,
  firstContent: string | Buffer,
  firstOptions: PrivateImmutableFileOptions,
  secondPath: string,
  secondContent: string | Buffer,
  secondOptions: PrivateImmutableFileOptions,
): ImmutablePrivateFilePairResult {
  const firstData = immutableContentBuffer(firstContent);
  const secondData = immutableContentBuffer(secondContent);
  assertBoundedSize(firstData.length, firstOptions);
  assertBoundedSize(secondData.length, secondOptions);
  const firstExisting = inspectSafePathComponents(firstPath, firstOptions.label);
  const secondExisting = inspectSafePathComponents(secondPath, secondOptions.label);
  if (Boolean(firstExisting) !== Boolean(secondExisting)) {
    if (firstExisting) {
      verifyImmutablePrivateFile(firstPath, firstData, firstOptions, firstOptions.fileMode ?? 0o600);
    }
    if (secondExisting) {
      verifyImmutablePrivateFile(secondPath, secondData, secondOptions, secondOptions.fileMode ?? 0o600);
    }
    throw new Error('Immutable private artifact pair is incomplete; existing files were not changed.');
  }
  if (firstExisting && secondExisting) {
    verifyImmutablePrivateFile(firstPath, firstData, firstOptions, firstOptions.fileMode ?? 0o600);
    verifyImmutablePrivateFile(secondPath, secondData, secondOptions, secondOptions.fileMode ?? 0o600);
    return {
      first: { path: firstPath, created: false },
      second: { path: secondPath, created: false },
    };
  }

  const first = ensureImmutablePrivateFile(firstPath, firstData, firstOptions);
  try {
    const second = ensureImmutablePrivateFile(secondPath, secondData, secondOptions);
    return { first, second };
  } catch (error: unknown) {
    const firstAtFailure = inspectSafePathComponents(firstPath, firstOptions.label);
    const secondAtFailure = inspectSafePathComponents(secondPath, secondOptions.label);
    if (firstAtFailure && secondAtFailure) {
      verifyImmutablePrivateFile(firstPath, firstData, firstOptions, firstOptions.fileMode ?? 0o600);
      verifyImmutablePrivateFile(secondPath, secondData, secondOptions, secondOptions.fileMode ?? 0o600);
      return {
        first: { path: firstPath, created: first.created },
        second: { path: secondPath, created: false },
      };
    }
    if (first.created && !secondAtFailure) {
      removeImmutablePrivateFileIfMatches(firstPath, firstData, firstOptions);
    }
    throw error;
  }
}

/** Appends one bounded record with one O_APPEND write after path and identity checks. */
export function appendPrivateTextRecord(
  filePath: string,
  content: string,
  options: PrivateFileAppendOptions,
): string {
  const data = Buffer.from(content, 'utf8');
  assertBoundedSize(data.length, options);
  if (data.length === 0) { throw new Error(`${options.label} append record is empty.`); }
  const directoryPath = path.dirname(filePath);
  const directoryBefore = requireSafeDirectory(directoryPath, options.label);
  const existing = inspectSafePathComponents(filePath, options.label);
  if (existing) { assertReplaceableRegularFile(filePath, existing, options.label); }

  const fileMode = options.fileMode ?? 0o600;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, privateFileOpenFlags('append-write'), fileMode);
    const opened = fs.fstatSync(descriptor);
    assertReplaceableRegularFile(filePath, opened, options.label);
    if (existing && !sameIdentity(fileIdentity(existing), fileIdentity(opened))) {
      throw new Error(`${options.label} changed while it was being opened for append.`);
    }
    const pathAtOpen = fs.lstatSync(filePath);
    assertReplaceableRegularFile(filePath, pathAtOpen, options.label);
    if (!sameIdentity(fileIdentity(opened), fileIdentity(pathAtOpen))) {
      throw new Error(`${options.label} path changed while it was being opened for append.`);
    }
    const directoryAtOpen = requireSafeDirectory(directoryPath, options.label);
    if (!sameIdentity(fileIdentity(directoryBefore), fileIdentity(directoryAtOpen))) {
      throw new Error(`${options.label} directory changed while it was being opened for append.`);
    }
    securePrivateDescriptorMode(descriptor, fileMode);
    const bytesWritten = fs.writeSync(descriptor, data, 0, data.length, null);
    if (bytesWritten !== data.length) {
      throw new Error(`${options.label} record could not be appended atomically.`);
    }
    fs.fsyncSync(descriptor);
    const completed = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    assertReplaceableRegularFile(filePath, completed, options.label);
    assertReplaceableRegularFile(filePath, pathAfter, options.label);
    if (!sameIdentity(fileIdentity(opened), fileIdentity(completed))
      || !sameIdentity(fileIdentity(opened), fileIdentity(pathAfter))
      || completed.size < opened.size + data.length
      || (process.platform !== 'win32' && (completed.mode & 0o777) !== fileMode)) {
      throw new Error(`${options.label} changed while a record was appended.`);
    }
    return filePath;
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

/** Reads complete lines from one bounded tail window after path and identity checks. */
export function readPrivateTextTailLinesIfPresent(
  filePath: string,
  options: PrivateFileReadOptions,
): string[] | null {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1) {
    throw new Error(`${options.label} tail byte limit must be a positive safe integer.`);
  }
  const before = inspectSafePathComponents(filePath, options.label);
  if (!before) { return null; }
  assertReplaceableRegularFile(filePath, before, options.label);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, privateFileOpenFlags('read'));
    const opened = fs.fstatSync(descriptor);
    assertReplaceableRegularFile(filePath, opened, options.label);
    if (!sameIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw new Error(`${options.label} changed while it was being opened for a tail read.`);
    }
    if (!Number.isSafeInteger(opened.size) || opened.size < 0) {
      throw new Error(`${options.label} has an unsupported file size.`);
    }
    const bytesToRead = Math.min(opened.size, options.maxBytes);
    const start = opened.size - bytesToRead;
    const content = bytesToRead > 0
      ? readDescriptorRangeFully(descriptor, start, bytesToRead, options.label)
      : Buffer.alloc(0);
    const completed = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    assertReplaceableRegularFile(filePath, completed, options.label);
    assertReplaceableRegularFile(filePath, pathAfter, options.label);
    if (!sameIdentity(fileIdentity(opened), fileIdentity(completed))
      || !sameIdentity(fileIdentity(opened), fileIdentity(pathAfter))
      || completed.size < opened.size) {
      throw new Error(`${options.label} changed while its tail was being read.`);
    }
    let text = content.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split(/\r?\n/).filter(Boolean);
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
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

function assertReplaceableRegularFile(filePath: string, stat: fs.Stats, label: string): void {
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} is not a safe replaceable file: ${filePath}`);
  }
}

function verifyImmutablePrivateFile(
  filePath: string,
  expected: Buffer,
  options: PrivateFileReadOptions,
  fileMode: number,
): void {
  const actual = readPrivateBufferFileIfPresent(filePath, options);
  if (!actual) { throw new Error(`${options.label} disappeared during immutable verification.`); }
  if (!actual.equals(expected)) {
    throw new Error(`${options.label} content does not match its immutable content address.`);
  }
  if (process.platform !== 'win32') {
    const before = inspectSafePathComponents(filePath, options.label);
    if (!before) { throw new Error(`${options.label} disappeared while its permissions were secured.`); }
    enforceRegularFileMode(filePath, before, options.label, fileMode);
  }
}

function immutableContentBuffer(content: string | Buffer): Buffer {
  return Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(content, 'utf8');
}

function removeImmutablePrivateFileIfMatches(
  filePath: string,
  expected: Buffer,
  options: PrivateFileReadOptions,
): void {
  const before = inspectSafePathComponents(filePath, options.label);
  if (!before) { return; }
  const actual = readPrivateBufferFileIfPresent(filePath, options);
  if (!actual?.equals(expected)) { return; }
  const after = inspectSafePathComponents(filePath, options.label);
  if (!after || !sameIdentity(fileIdentity(before), fileIdentity(after))) { return; }
  try {
    fs.unlinkSync(filePath);
  } catch (error: unknown) {
    if (errorCode(error) !== 'ENOENT') { throw error; }
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

function readDescriptorRangeFully(
  descriptor: number,
  start: number,
  size: number,
  label: string,
): Buffer {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const bytesRead = fs.readSync(descriptor, content, offset, size - offset, start + offset);
    if (bytesRead <= 0) { throw new Error(`${label} ended during a bounded tail read.`); }
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

function enforceDirectoryMode(
  directoryPath: string,
  before: fs.Stats,
  label: string,
  mode: number,
): void {
  const descriptor = fs.openSync(directoryPath, privateFileOpenFlags('directory-read'));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isDirectory() || !sameIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw new Error(`${label} directory changed while it was opened.`);
    }
    securePrivateDescriptorMode(descriptor, mode);
    const completed = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(directoryPath);
    if (!completed.isDirectory()
      || pathAfter.isSymbolicLink()
      || !pathAfter.isDirectory()
      || !sameIdentity(fileIdentity(opened), fileIdentity(completed))
      || !sameIdentity(fileIdentity(opened), fileIdentity(pathAfter))
      || (completed.mode & 0o777) !== mode) {
      throw new Error(`${label} directory changed while its permissions were secured.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function enforceRegularFileMode(
  filePath: string,
  before: fs.Stats,
  label: string,
  mode: number,
): void {
  const descriptor = fs.openSync(filePath, privateFileOpenFlags('read'));
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || !sameIdentity(fileIdentity(before), fileIdentity(opened))) {
      throw new Error(`${label} changed while its permissions were opened.`);
    }
    securePrivateDescriptorMode(descriptor, mode);
    const completed = fs.fstatSync(descriptor);
    const pathAfter = fs.lstatSync(filePath);
    if (!completed.isFile()
      || pathAfter.isSymbolicLink()
      || !pathAfter.isFile()
      || !sameIdentity(fileIdentity(opened), fileIdentity(completed))
      || !sameIdentity(fileIdentity(opened), fileIdentity(pathAfter))
      || (completed.mode & 0o777) !== mode) {
      throw new Error(`${label} changed while its permissions were secured.`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
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

export function syncPrivateDirectory(directoryPath: string): void {
  if (process.platform === 'win32') { return; }
  const descriptor = fs.openSync(directoryPath, privateFileOpenFlags('directory-read'));
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
