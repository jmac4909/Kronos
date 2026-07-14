import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { KRONOS_DIR } from './stateStore';

export interface ManagedMonitorLeaseOptions {
  kronosDir?: string;
  ttlMs?: number;
  now?: Date;
}

export interface ManagedMonitorLeaseRenewOptions {
  ttlMs?: number;
  now?: Date;
}

export interface ManagedMonitorLeaseRecord {
  schema: 'kronos.managed-monitor-lease';
  schemaVersion: 1;
  ownerId: string;
  pid: number;
  acquiredAt: string;
  expiresAt: string;
}

export type ManagedMonitorLeaseUnavailableReason =
  | 'active'
  | 'contended'
  | 'unsafe';

export interface ManagedMonitorLeaseHandle {
  acquired: boolean;
  leasePath: string;
  reason?: ManagedMonitorLeaseUnavailableReason;
  lease?: Readonly<ManagedMonitorLeaseRecord>;
  renew(options?: ManagedMonitorLeaseRenewOptions): boolean;
  release(): boolean;
}

const LEASE_SCHEMA = 'kronos.managed-monitor-lease';
const LEASE_SCHEMA_VERSION = 1;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MIN_TTL_MS = 1000;
const MAX_TTL_MS = 30 * 60 * 1000;
const MAX_LEASE_BYTES = 4096;
const OWNER_ID_BYTES = 24;
const UNLINK_PIN_ID_BYTES = 16;
const OWNER_ID_PATTERN = /^[a-f0-9]{48}$/;
const LEASE_FILE_NAME = 'managed-monitor-poll.lease';
const LEASE_DIRECTORY_NAME = 'leases';

interface FileIdentity {
  dev: number;
  ino: number;
}

type LeaseInspection =
  | { kind: 'missing' }
  | { kind: 'unsafe' }
  | {
    kind: 'valid';
    lease: ManagedMonitorLeaseRecord;
    identity: FileIdentity;
    crashPinPath?: string;
  };

type CreateLeaseResult =
  | { kind: 'acquired'; identity: FileIdentity }
  | { kind: 'exists' }
  | { kind: 'unsafe' };

export function managedMonitorLeasePath(options: Pick<ManagedMonitorLeaseOptions, 'kronosDir'> = {}): string {
  return path.join(
    path.resolve(options.kronosDir || KRONOS_DIR),
    LEASE_DIRECTORY_NAME,
    LEASE_FILE_NAME,
  );
}

export function tryAcquireManagedMonitorLease(
  options: ManagedMonitorLeaseOptions = {},
): ManagedMonitorLeaseHandle {
  const leasePath = managedMonitorLeasePath(options);
  const unavailable = (reason: ManagedMonitorLeaseUnavailableReason): ManagedMonitorLeaseHandle => ({
    acquired: false,
    leasePath,
    reason,
    renew: () => false,
    release: () => false,
  });

  let now: Date;
  try {
    now = normalizedNow(options.now);
    const kronosDirectory = path.resolve(options.kronosDir || KRONOS_DIR);
    const leaseDirectory = path.dirname(leasePath);
    assertContainedPath(kronosDirectory, leaseDirectory);
    ensurePrivateDirectoryTree(leaseDirectory, kronosDirectory);
  } catch {
    return unavailable('unsafe');
  }

  let lease: ManagedMonitorLeaseRecord;
  try {
    const ttlMs = boundedTtl(options.ttlMs);
    lease = {
      schema: LEASE_SCHEMA,
      schemaVersion: LEASE_SCHEMA_VERSION,
      ownerId: crypto.randomBytes(OWNER_ID_BYTES).toString('hex'),
      pid: process.pid,
      acquiredAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    };
  } catch {
    return unavailable('unsafe');
  }

  let createResult = tryCreateLeaseFile(leasePath, lease);
  if (createResult.kind === 'acquired') {
    return acquiredHandle(leasePath, lease, createResult.identity);
  }
  if (createResult.kind === 'unsafe') {
    return unavailable('unsafe');
  }

  const inspection = inspectLeaseFile(leasePath, true);
  if (inspection.kind === 'unsafe') {
    return unavailable('unsafe');
  }
  if (inspection.kind === 'valid') {
    const expiresAt = Date.parse(inspection.lease.expiresAt);
    if (expiresAt > now.getTime()) {
      return unavailable('active');
    }
    const removed = inspection.crashPinPath
      ? unlinkExpiredCrashPinnedLease(
        leasePath,
        inspection.crashPinPath,
        inspection.lease.ownerId,
        inspection.identity,
        now,
      )
      : unlinkMatchingLease(leasePath, inspection.lease.ownerId, inspection.identity);
    if (!removed) {
      return unavailable('contended');
    }
  }

  createResult = tryCreateLeaseFile(leasePath, lease);
  if (createResult.kind === 'acquired') {
    return acquiredHandle(leasePath, lease, createResult.identity);
  }
  return unavailable(createResult.kind === 'exists' ? 'contended' : 'unsafe');
}

function acquiredHandle(
  leasePath: string,
  lease: ManagedMonitorLeaseRecord,
  identity: FileIdentity,
): ManagedMonitorLeaseHandle {
  let released = false;
  let currentLease: Readonly<ManagedMonitorLeaseRecord> = Object.freeze({ ...lease });
  return {
    acquired: true,
    leasePath,
    get lease() { return currentLease; },
    renew: (options: ManagedMonitorLeaseRenewOptions = {}) => {
      if (released) { return false; }
      const renewed = renewMatchingLease(
        leasePath,
        currentLease.ownerId,
        identity,
        options,
      );
      if (!renewed) { return false; }
      currentLease = Object.freeze({ ...renewed });
      return true;
    },
    release: () => {
      if (released) { return false; }
      const removed = unlinkMatchingLease(leasePath, currentLease.ownerId, identity);
      if (removed) { released = true; }
      return removed;
    },
  };
}

function tryCreateLeaseFile(filePath: string, lease: ManagedMonitorLeaseRecord): CreateLeaseResult {
  const content = Buffer.from(`${JSON.stringify(lease)}\n`, 'utf8');
  if (content.length > MAX_LEASE_BYTES) { return { kind: 'unsafe' }; }
  try {
    assertNoSymbolicLinkComponents(path.dirname(filePath));
  } catch {
    return { kind: 'unsafe' };
  }

  let descriptor: number | undefined;
  let identity: FileIdentity | undefined;
  try {
    descriptor = fs.openSync(filePath, exclusiveCreateFlags(), FILE_MODE);
    const initialStat = fs.fstatSync(descriptor);
    if (!initialStat.isFile()) {
      throw new Error('Managed monitor lease is not a regular file.');
    }
    identity = fileIdentity(initialStat);
    setPrivateDescriptorMode(descriptor, FILE_MODE);
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    const finalStat = fs.fstatSync(descriptor);
    if (!safeLeaseFileStat(finalStat)
      || !sameIdentity(identity, fileIdentity(finalStat))
      || finalStat.size !== content.length) {
      throw new Error('Managed monitor lease changed while it was being created.');
    }
    fs.closeSync(descriptor);
    descriptor = undefined;
    syncDirectory(path.dirname(filePath));
    return { kind: 'acquired', identity };
  } catch (error: unknown) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
    if (identity) {
      unlinkMatchingIdentity(filePath, identity);
    }
    return errorCode(error) === 'EEXIST' ? { kind: 'exists' } : { kind: 'unsafe' };
  }
}

function inspectLeaseFile(filePath: string, allowCrashPin = false): LeaseInspection {
  let pathStat: fs.Stats;
  let crashPinPath: string | undefined;
  try {
    const existing = lstatIfPresent(filePath);
    if (!existing) { return { kind: 'missing' }; }
    pathStat = existing;
    if (!safeLeaseFileStat(pathStat)) {
      if (!allowCrashPin || !safePinnedFileStat(pathStat, true)) {
        return { kind: 'unsafe' };
      }
      crashPinPath = findUniqueCrashPin(filePath, fileIdentity(pathStat));
      if (!crashPinPath) { return { kind: 'unsafe' }; }
    }
  } catch {
    return { kind: 'unsafe' };
  }

  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(filePath, safeReadFlags());
    const openedStat = fs.fstatSync(descriptor);
    const identity = fileIdentity(openedStat);
    const safeOpenedStat = crashPinPath
      ? safePinnedFileStat(openedStat, true)
      : safeLeaseFileStat(openedStat);
    if (!safeOpenedStat
      || !sameIdentity(identity, fileIdentity(pathStat))
      || openedStat.size <= 0
      || openedStat.size > MAX_LEASE_BYTES) {
      return { kind: 'unsafe' };
    }
    const content = fs.readFileSync(descriptor);
    const finalStat = fs.fstatSync(descriptor);
    const safeFinalStat = crashPinPath
      ? safePinnedFileStat(finalStat, true)
      : safeLeaseFileStat(finalStat);
    if (!safeFinalStat
      || !sameIdentity(identity, fileIdentity(finalStat))
      || finalStat.size !== openedStat.size
      || content.length !== openedStat.size) {
      return { kind: 'unsafe' };
    }
    if (crashPinPath && !isMatchingCrashPin(filePath, crashPinPath, identity)) {
      return { kind: 'unsafe' };
    }
    const lease = normalizeLeaseRecord(JSON.parse(content.toString('utf8')) as unknown);
    return crashPinPath
      ? { kind: 'valid', lease, identity, crashPinPath }
      : { kind: 'valid', lease, identity };
  } catch {
    return { kind: 'unsafe' };
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort */ }
    }
  }
}

function findUniqueCrashPin(filePath: string, identity: FileIdentity): string | undefined {
  const leaseDirectory = path.resolve(path.dirname(filePath));
  try {
    assertNoSymbolicLinkComponents(leaseDirectory);
    const candidates = fs.readdirSync(leaseDirectory)
      .filter(candidate => isLeaseUnlinkPinName(filePath, candidate));
    if (candidates.length !== 1 || !candidates[0]) { return undefined; }
    const pinPath = path.resolve(leaseDirectory, candidates[0]);
    assertContainedPath(leaseDirectory, pinPath);
    return isMatchingCrashPin(filePath, pinPath, identity) ? pinPath : undefined;
  } catch {
    return undefined;
  }
}

function isMatchingCrashPin(
  filePath: string,
  pinPath: string,
  identity: FileIdentity,
): boolean {
  const leaseDirectory = path.resolve(path.dirname(filePath));
  const resolvedPinPath = path.resolve(pinPath);
  try {
    assertContainedPath(leaseDirectory, resolvedPinPath);
    if (path.dirname(resolvedPinPath) !== leaseDirectory
      || !isLeaseUnlinkPinName(filePath, path.basename(resolvedPinPath))) {
      return false;
    }
    const sourceStat = fs.lstatSync(filePath);
    const pinStat = fs.lstatSync(resolvedPinPath);
    return safePinnedFileStat(sourceStat, true)
      && safePinnedFileStat(pinStat, true)
      && sameIdentity(fileIdentity(sourceStat), identity)
      && sameIdentity(fileIdentity(pinStat), identity);
  } catch {
    return false;
  }
}

function isLeaseUnlinkPinName(filePath: string, candidate: string): boolean {
  const prefix = `.${path.basename(filePath)}.`;
  const suffix = '.unlink-pin';
  if (path.basename(candidate) !== candidate
    || !candidate.startsWith(prefix)
    || !candidate.endsWith(suffix)) {
    return false;
  }
  const pinId = candidate.slice(prefix.length, candidate.length - suffix.length);
  return pinId.length === UNLINK_PIN_ID_BYTES * 2 && /^[a-f0-9]+$/.test(pinId);
}

function normalizeLeaseRecord(value: unknown): ManagedMonitorLeaseRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Managed monitor lease record must be an object.');
  }
  const record = value as Record<string, unknown>;
  const expectedKeys = ['acquiredAt', 'expiresAt', 'ownerId', 'pid', 'schema', 'schemaVersion'];
  const actualKeys = Object.keys(record).sort();
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error('Managed monitor lease record has unexpected fields.');
  }
  if (record['schema'] !== LEASE_SCHEMA || record['schemaVersion'] !== LEASE_SCHEMA_VERSION) {
    throw new Error('Managed monitor lease schema is unsupported.');
  }
  const ownerId = record['ownerId'];
  const pid = record['pid'];
  const acquiredAt = normalizedTimestamp(record['acquiredAt'], 'acquiredAt');
  const expiresAt = normalizedTimestamp(record['expiresAt'], 'expiresAt');
  if (typeof ownerId !== 'string' || !OWNER_ID_PATTERN.test(ownerId)) {
    throw new Error('Managed monitor lease owner id is invalid.');
  }
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Managed monitor lease pid is invalid.');
  }
  const duration = Date.parse(expiresAt) - Date.parse(acquiredAt);
  if (!Number.isFinite(duration) || duration < MIN_TTL_MS || duration > MAX_TTL_MS) {
    throw new Error('Managed monitor lease duration is outside safety bounds.');
  }
  return {
    schema: LEASE_SCHEMA,
    schemaVersion: LEASE_SCHEMA_VERSION,
    ownerId,
    pid,
    acquiredAt,
    expiresAt,
  };
}

function renewMatchingLease(
  filePath: string,
  ownerId: string,
  identity: FileIdentity,
  options: ManagedMonitorLeaseRenewOptions,
): ManagedMonitorLeaseRecord | undefined {
  let renewalTime: Date;
  let ttlMs: number;
  let pinPath: string;
  try {
    renewalTime = normalizedNow(options.now);
    ttlMs = boundedTtl(options.ttlMs);
    pinPath = newLeasePinPath(filePath);
    assertNoSymbolicLinkComponents(path.dirname(filePath));
  } catch {
    return undefined;
  }

  const inspection = inspectLeaseFile(filePath);
  if (inspection.kind !== 'valid'
    || inspection.lease.ownerId !== ownerId
    || !sameIdentity(inspection.identity, identity)) {
    return undefined;
  }

  let descriptor: number | undefined;
  let pinned = false;
  let pinIdentity: FileIdentity | undefined;
  let pinRemoved = false;
  let renewed: ManagedMonitorLeaseRecord | undefined;
  try {
    fs.linkSync(filePath, pinPath);
    pinned = true;
    const pinStat = fs.lstatSync(pinPath);
    pinIdentity = fileIdentity(pinStat);
    const sourceStat = fs.lstatSync(filePath);
    if (!safePinnedFileStat(sourceStat, true)
      || !safePinnedFileStat(pinStat, true)
      || !sameIdentity(fileIdentity(sourceStat), identity)
      || !sameIdentity(fileIdentity(pinStat), identity)) {
      return undefined;
    }

    descriptor = fs.openSync(filePath, safeWriteFlags());
    const openedStat = fs.fstatSync(descriptor);
    if (!safePinnedFileStat(openedStat, true)
      || !sameIdentity(fileIdentity(openedStat), identity)
      || openedStat.size <= 0
      || openedStat.size > MAX_LEASE_BYTES) {
      return undefined;
    }
    const currentContent = readDescriptorFully(descriptor, openedStat.size);
    const readStat = fs.fstatSync(descriptor);
    if (!safePinnedFileStat(readStat, true)
      || !sameIdentity(fileIdentity(readStat), identity)
      || readStat.size !== openedStat.size) {
      return undefined;
    }
    const current = normalizeLeaseRecord(JSON.parse(currentContent.toString('utf8')) as unknown);
    if (current.ownerId !== ownerId) { return undefined; }

    renewed = {
      schema: LEASE_SCHEMA,
      schemaVersion: LEASE_SCHEMA_VERSION,
      ownerId: current.ownerId,
      pid: current.pid,
      acquiredAt: renewalTime.toISOString(),
      expiresAt: new Date(renewalTime.getTime() + ttlMs).toISOString(),
    };
    const renewedContent = Buffer.from(`${JSON.stringify(renewed)}\n`, 'utf8');
    if (renewedContent.length <= 0 || renewedContent.length > MAX_LEASE_BYTES) {
      return undefined;
    }

    fs.ftruncateSync(descriptor, 0);
    writeDescriptorFully(descriptor, renewedContent);
    fs.fsyncSync(descriptor);

    const finalDescriptorStat = fs.fstatSync(descriptor);
    const finalSourceStat = fs.lstatSync(filePath);
    const finalPinStat = fs.lstatSync(pinPath);
    if (!safePinnedFileStatAtLeast(finalDescriptorStat, true)
      || !safePinnedFileStatAtLeast(finalSourceStat, true)
      || !safePinnedFileStatAtLeast(finalPinStat, true)
      || !sameIdentity(fileIdentity(finalDescriptorStat), identity)
      || !sameIdentity(fileIdentity(finalSourceStat), identity)
      || !sameIdentity(fileIdentity(finalPinStat), identity)
      || finalDescriptorStat.size !== renewedContent.length
      || !readDescriptorFully(descriptor, renewedContent.length).equals(renewedContent)) {
      renewed = undefined;
    }
  } catch {
    renewed = undefined;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { renewed = undefined; }
    }
    if (pinned) { pinRemoved = unlinkPinIfMatching(pinPath, pinIdentity || identity); }
  }

  if (!renewed || !pinRemoved) { return undefined; }
  try {
    syncDirectory(path.dirname(filePath));
    return renewed;
  } catch {
    return undefined;
  }
}

function unlinkExpiredCrashPinnedLease(
  filePath: string,
  pinPath: string,
  ownerId: string,
  identity: FileIdentity,
  now: Date,
): boolean {
  const leaseDirectory = path.resolve(path.dirname(filePath));
  const resolvedPinPath = path.resolve(pinPath);
  try {
    assertNoSymbolicLinkComponents(leaseDirectory);
    assertContainedPath(leaseDirectory, resolvedPinPath);
    if (path.dirname(resolvedPinPath) !== leaseDirectory
      || !isLeaseUnlinkPinName(filePath, path.basename(resolvedPinPath))) {
      return false;
    }

    const inspection = inspectLeaseFile(filePath, true);
    if (inspection.kind !== 'valid'
      || inspection.crashPinPath !== resolvedPinPath
      || inspection.lease.ownerId !== ownerId
      || !sameIdentity(inspection.identity, identity)
      || Date.parse(inspection.lease.expiresAt) > now.getTime()
      || !isMatchingCrashPin(filePath, resolvedPinPath, identity)) {
      return false;
    }

    fs.unlinkSync(filePath);
    const remainingPinStat = fs.lstatSync(resolvedPinPath);
    if (!safeOwnedFileStat(remainingPinStat, 1, true)
      || !sameIdentity(fileIdentity(remainingPinStat), identity)) {
      return false;
    }
    fs.unlinkSync(resolvedPinPath);
    syncDirectory(leaseDirectory);
    return true;
  } catch {
    return false;
  }
}

function unlinkMatchingLease(filePath: string, ownerId: string, identity: FileIdentity): boolean {
  const inspection = inspectLeaseFile(filePath);
  if (inspection.kind !== 'valid'
    || inspection.lease.ownerId !== ownerId
    || !sameIdentity(inspection.identity, identity)) {
    return false;
  }
  return unlinkPinnedIdentity(filePath, identity, true);
}

function unlinkMatchingIdentity(filePath: string, identity: FileIdentity): boolean {
  return unlinkPinnedIdentity(filePath, identity, false);
}

function unlinkPinnedIdentity(
  filePath: string,
  identity: FileIdentity,
  requirePrivateMode: boolean,
): boolean {
  let pinPath: string;
  try {
    pinPath = newLeasePinPath(filePath);
    assertNoSymbolicLinkComponents(path.dirname(filePath));
  } catch {
    return false;
  }

  let pinned = false;
  let pinIdentity: FileIdentity | undefined;
  let removed = false;
  try {
    fs.linkSync(filePath, pinPath);
    pinned = true;
    const pinStat = fs.lstatSync(pinPath);
    pinIdentity = fileIdentity(pinStat);
    const sourceStat = fs.lstatSync(filePath);
    if (!safePinnedFileStat(sourceStat, requirePrivateMode)
      || !safePinnedFileStat(pinStat, requirePrivateMode)
      || !sameIdentity(fileIdentity(sourceStat), identity)
      || !sameIdentity(fileIdentity(pinStat), identity)) {
      return false;
    }
    fs.unlinkSync(filePath);
    removed = true;
  } catch {
    return false;
  } finally {
    if (pinned) { unlinkPinIfMatching(pinPath, pinIdentity || identity); }
  }

  try {
    syncDirectory(path.dirname(filePath));
    return removed;
  } catch {
    return false;
  }
}

function newLeasePinPath(filePath: string): string {
  const pinId = crypto.randomBytes(UNLINK_PIN_ID_BYTES).toString('hex');
  return path.join(path.dirname(filePath), `.${path.basename(filePath)}.${pinId}.unlink-pin`);
}

function unlinkPinIfMatching(pinPath: string, identity: FileIdentity): boolean {
  try {
    const stat = lstatIfPresent(pinPath);
    if (!stat) { return true; }
    if (stat.isSymbolicLink() || !stat.isFile() || !sameIdentity(fileIdentity(stat), identity)) {
      return false;
    }
    fs.unlinkSync(pinPath);
    return true;
  } catch {
    // Best effort: a leftover pin makes the original lease fail closed if it still exists.
    return false;
  }
}

function safeLeaseFileStat(stat: fs.Stats): boolean {
  return safeOwnedFileStat(stat, 1, true);
}

function safePinnedFileStat(stat: fs.Stats, requirePrivateMode: boolean): boolean {
  return safeOwnedFileStat(stat, 2, requirePrivateMode);
}

function safePinnedFileStatAtLeast(stat: fs.Stats, requirePrivateMode: boolean): boolean {
  return stat.nlink >= 2 && safeOwnedFileStat(stat, stat.nlink, requirePrivateMode);
}

function safeOwnedFileStat(
  stat: fs.Stats,
  expectedLinkCount: number,
  requirePrivateMode: boolean,
): boolean {
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== expectedLinkCount) { return false; }
  if (process.platform !== 'win32'
    && requirePrivateMode
    && (stat.mode & 0o777) !== FILE_MODE) {
    return false;
  }
  const getUid = Reflect.get(process, 'getuid');
  return typeof getUid !== 'function' || stat.uid === Reflect.apply(getUid, process, []);
}

function fileIdentity(stat: fs.Stats): FileIdentity {
  return { dev: stat.dev, ino: stat.ino };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function normalizedNow(value?: Date): Date {
  const date = value ? new Date(value.getTime()) : new Date();
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Managed monitor lease time is invalid.');
  }
  return date;
}

function normalizedTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Managed monitor lease ${label} is invalid.`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`Managed monitor lease ${label} is invalid.`);
  }
  return value;
}

function boundedTtl(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) { return DEFAULT_TTL_MS; }
  return Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.floor(value)));
}

function ensurePrivateDirectoryTree(targetPath: string, privateRootPath: string): void {
  const target = path.resolve(targetPath);
  const privateRoot = path.resolve(privateRootPath);
  assertContainedPath(privateRoot, target);
  const parsed = path.parse(target);
  const components = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    const next = path.join(current, component);
    let stat = lstatIfPresent(next);
    if (!stat) {
      try {
        fs.mkdirSync(next, { mode: DIRECTORY_MODE });
      } catch (error: unknown) {
        if (errorCode(error) !== 'EEXIST') { throw error; }
      }
      stat = fs.lstatSync(next);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Managed monitor lease directory is unsafe: ${next}`);
      }
      syncDirectory(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Managed monitor lease path component is unsafe: ${next}`);
    }
    if (isContainedPath(privateRoot, next)) {
      assertCurrentUserOwner(stat);
      setPrivateDirectoryMode(next, stat);
    }
    current = next;
  }
  assertNoSymbolicLinkComponents(target);
}

function assertNoSymbolicLinkComponents(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = lstatIfPresent(current);
    if (!stat) { continue; }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(`Managed monitor lease path component is unsafe: ${current}`);
    }
  }
}

function assertCurrentUserOwner(stat: fs.Stats): void {
  const getUid = Reflect.get(process, 'getuid');
  if (typeof getUid === 'function' && stat.uid !== Reflect.apply(getUid, process, [])) {
    throw new Error('Managed monitor lease directory is not owned by the current user.');
  }
}

function assertContainedPath(basePath: string, candidatePath: string): void {
  if (!isContainedPath(basePath, candidatePath)) {
    throw new Error('Managed monitor lease path escaped the Kronos directory.');
  }
}

function isContainedPath(basePath: string, candidatePath: string): boolean {
  const base = path.resolve(basePath);
  const candidate = path.resolve(candidatePath);
  return candidate === base || candidate.startsWith(`${base}${path.sep}`);
}

function exclusiveCreateFlags(): number {
  return fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | noFollowFlag();
}

function safeReadFlags(): number {
  return fs.constants.O_RDONLY | nonBlockingFlag() | noFollowFlag();
}

function safeWriteFlags(): number {
  return fs.constants.O_RDWR | nonBlockingFlag() | noFollowFlag();
}

function noFollowFlag(): number {
  return managedMonitorNoFollowFlag(process.platform, Reflect.get(fs.constants, 'O_NOFOLLOW'));
}

/**
 * Windows does not implement O_NOFOLLOW for fs.open. Lease operations there
 * use exclusive creation plus lstat/fstat identity checks before every read,
 * write, renew, and unlink. POSIX hosts keep the stronger kernel flag and fail
 * closed when it is genuinely unavailable.
 */
export function managedMonitorNoFollowFlag(platform: NodeJS.Platform, flagValue: unknown): number {
  if (platform === 'win32') { return 0; }
  const flag = flagValue;
  if (typeof flag !== 'number' || flag === 0) {
    throw new Error('Managed monitor leases require O_NOFOLLOW support.');
  }
  return flag;
}

function nonBlockingFlag(): number {
  if (process.platform === 'win32') { return 0; }
  return typeof fs.constants.O_NONBLOCK === 'number' ? fs.constants.O_NONBLOCK : 0;
}

function directoryFlag(): number {
  return typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;
}

function setPrivateDescriptorMode(descriptor: number, mode: number): void {
  if (process.platform !== 'win32') { fs.fchmodSync(descriptor, mode); }
}

function readDescriptorFully(descriptor: number, size: number): Buffer {
  const content = Buffer.alloc(size);
  let offset = 0;
  while (offset < content.length) {
    const bytesRead = fs.readSync(
      descriptor,
      content,
      offset,
      content.length - offset,
      offset,
    );
    if (bytesRead <= 0) {
      throw new Error('Managed monitor lease ended before the expected byte count.');
    }
    offset += bytesRead;
  }
  return content;
}

function writeDescriptorFully(descriptor: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const bytesWritten = fs.writeSync(
      descriptor,
      content,
      offset,
      content.length - offset,
      offset,
    );
    if (bytesWritten <= 0) {
      throw new Error('Managed monitor lease could not be completely renewed.');
    }
    offset += bytesWritten;
  }
}

function setPrivateDirectoryMode(
  directoryPath: string,
  expectedStat: fs.Stats,
): void {
  if (process.platform === 'win32') { return; }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      directoryPath,
      fs.constants.O_RDONLY | directoryFlag() | noFollowFlag(),
    );
    const openedStat = fs.fstatSync(descriptor);
    if (!openedStat.isDirectory()
      || !sameIdentity(fileIdentity(openedStat), fileIdentity(expectedStat))) {
      throw new Error('Managed monitor lease directory changed while it was opened.');
    }
    assertCurrentUserOwner(openedStat);
    fs.fchmodSync(descriptor, DIRECTORY_MODE);
    const finalStat = fs.fstatSync(descriptor);
    if (!finalStat.isDirectory()
      || !sameIdentity(fileIdentity(openedStat), fileIdentity(finalStat))
      || (finalStat.mode & 0o777) !== DIRECTORY_MODE) {
      throw new Error('Managed monitor lease directory could not be made private.');
    }
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

function syncDirectory(directoryPath: string): void {
  if (process.platform === 'win32' || !directoryPath) { return; }
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(directoryPath, fs.constants.O_RDONLY | directoryFlag() | noFollowFlag());
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
}

function lstatIfPresent(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
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
