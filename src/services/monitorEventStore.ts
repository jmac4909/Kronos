import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { isRecord } from './records';
import { KRONOS_DIR } from './stateStore';

export type MonitorEventType =
  | 'session.created'
  | 'terminal.attached'
  | 'terminal.detached'
  | 'terminal.command.completed'
  | 'context.inserted'
  | 'provider.transition'
  | 'notification.shown'
  | 'notification.acknowledged'
  | 'git.observed'
  | 'decision.recorded'
  | 'approval.recorded';

export type MonitorEventSource = 'operator' | 'terminal' | 'jira' | 'gitlab' | 'jenkins' | 'sonar' | 'kronos';
export type MonitorEventMetadataValue = string | number | boolean | null;

export interface MonitorEventSubject {
  kind: string;
  id: string;
  project?: string;
  ticketKey?: string;
}

export interface MonitorEventState {
  state?: string;
  fingerprint?: string;
}

export interface MonitorEvent {
  schemaVersion: 1;
  id: string;
  at: string;
  sessionId: string;
  type: MonitorEventType;
  source: MonitorEventSource;
  summary: string;
  subject?: MonitorEventSubject;
  before?: MonitorEventState;
  after?: MonitorEventState;
  artifactPath?: string;
  metadata?: Record<string, MonitorEventMetadataValue>;
}

export interface AppendMonitorEventInput {
  sessionId: string;
  type: MonitorEventType;
  source: MonitorEventSource;
  summary: string;
  id?: string;
  at?: string;
  subject?: MonitorEventSubject;
  before?: MonitorEventState;
  after?: MonitorEventState;
  artifactPath?: string;
  metadata?: Record<string, MonitorEventMetadataValue>;
}

export interface MonitorEventFilter {
  sessionId?: string;
  ticketKey?: string;
  source?: MonitorEventSource;
  types?: readonly MonitorEventType[];
  since?: string;
  limit?: number;
}

export interface MonitorEventStoreOptions {
  kronosDir?: string;
  now?: Date;
  maxReadBytes?: number;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SCHEMA_VERSION = 1;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
const DEFAULT_MAX_READ_BYTES = 5 * 1024 * 1024;
const MIN_MAX_READ_BYTES = 4096;
const MAX_MAX_READ_BYTES = 50 * 1024 * 1024;
const MAX_EVENT_BYTES = 16 * 1024;
const MAX_METADATA_ENTRIES = 32;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/;
const SENSITIVE_KEY_PATTERN = /(?:authorization|cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key|raw|body|trace|log)/i;
const SENSITIVE_TEXT_PATTERN = /(?:authorization\s*:|private-token\s*:|(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+|https?:\/\/[^\s/@:]+:[^\s/@]+@)/i;
const NO_FOLLOW_VALUE = Reflect.get(fs.constants, 'O_NOFOLLOW');
const NO_FOLLOW_FLAG = typeof NO_FOLLOW_VALUE === 'number' ? NO_FOLLOW_VALUE : 0;

const EVENT_TYPES = new Set<MonitorEventType>([
  'session.created',
  'terminal.attached',
  'terminal.detached',
  'terminal.command.completed',
  'context.inserted',
  'provider.transition',
  'notification.shown',
  'notification.acknowledged',
  'git.observed',
  'decision.recorded',
  'approval.recorded',
]);
const EVENT_SOURCES = new Set<MonitorEventSource>([
  'operator',
  'terminal',
  'jira',
  'gitlab',
  'jenkins',
  'sonar',
  'kronos',
]);

export function monitorEventsPath(options: MonitorEventStoreOptions = {}): string {
  return path.resolve(options.kronosDir || KRONOS_DIR, 'monitor-events.jsonl');
}

export function appendMonitorEvent(
  input: AppendMonitorEventInput,
  options: MonitorEventStoreOptions = {},
): MonitorEvent {
  const event = normalizeMonitorEvent({
    ...input,
    schemaVersion: SCHEMA_VERSION,
    id: input.id || `event-${crypto.randomUUID()}`,
    at: input.at || nowIso(options.now),
  });
  const line = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
    throw new Error(`Monitor event exceeds the ${MAX_EVENT_BYTES}-byte limit.`);
  }

  const filePath = monitorEventsPath(options);
  ensurePrivateDirectory(path.dirname(filePath));
  assertSafeRegularFileIfPresent(filePath);
  let descriptor: number | undefined;
  try {
    assertSafeDirectory(path.dirname(filePath));
    assertSafeRegularFileIfPresent(filePath);
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | NO_FOLLOW_FLAG,
      FILE_MODE,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`Monitor event path is not a safe regular file: ${filePath}`);
    }
    if (process.platform !== 'win32') { fs.fchmodSync(descriptor, FILE_MODE); }
    fs.writeFileSync(descriptor, line, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    setPrivateMode(filePath, FILE_MODE);
  } finally {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
  }
  return cloneEvent(event);
}

export function listMonitorEvents(
  filter: MonitorEventFilter = {},
  options: MonitorEventStoreOptions = {},
): MonitorEvent[] {
  const filePath = monitorEventsPath(options);
  if (!assertSafeRegularFileIfPresent(filePath)) { return []; }
  const normalizedFilter = normalizeFilter(filter);
  const maxReadBytes = boundedInteger(
    options.maxReadBytes,
    DEFAULT_MAX_READ_BYTES,
    MIN_MAX_READ_BYTES,
    MAX_MAX_READ_BYTES,
  );
  const lines = readBoundedTailLines(filePath, maxReadBytes);
  const matching: MonitorEvent[] = [];
  for (let index = lines.length - 1; index >= 0 && matching.length < normalizedFilter.limit; index -= 1) {
    const line = lines[index];
    if (!line) { continue; }
    let event: MonitorEvent;
    try {
      event = normalizeMonitorEvent(JSON.parse(line) as unknown);
    } catch {
      continue;
    }
    if (monitorEventMatches(event, normalizedFilter)) { matching.push(event); }
  }
  return matching;
}

export function readMonitorEvent(
  eventId: string,
  options: MonitorEventStoreOptions = {},
): MonitorEvent | null {
  const safeId = normalizeEntityId(eventId, 'monitor event id');
  return listMonitorEvents({ limit: MAX_LIMIT }, options).find(event => event.id === safeId) || null;
}

export function acknowledgeMonitorEvent(
  eventId: string,
  sessionId: string,
  options: MonitorEventStoreOptions = {},
): MonitorEvent {
  const safeEventId = normalizeEntityId(eventId, 'monitor event id');
  const safeSessionId = normalizeEntityId(sessionId, 'work session id');
  const recent = listMonitorEvents({ sessionId: safeSessionId, limit: MAX_LIMIT }, options);
  const existing = recent.find(event =>
    event.type === 'notification.acknowledged'
    && event.metadata?.['acknowledgedEventId'] === safeEventId
  );
  if (existing) { return existing; }
  const target = recent.find(event => event.id === safeEventId);
  if (!target) { throw new Error(`Monitor event not found for work session: ${safeEventId}`); }
  const input: AppendMonitorEventInput = {
    sessionId: safeSessionId,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: `Acknowledged ${target.type} event ${safeEventId}.`,
    metadata: { acknowledgedEventId: safeEventId },
  };
  if (target.subject) { input.subject = target.subject; }
  return appendMonitorEvent(input, options);
}

export function normalizeMonitorEvent(value: unknown): MonitorEvent {
  if (!isRecord(value)) { throw new Error('Monitor event must be an object.'); }
  if (value['schemaVersion'] !== SCHEMA_VERSION) { throw new Error('Unsupported monitor event schema version.'); }
  const event: MonitorEvent = {
    schemaVersion: SCHEMA_VERSION,
    id: normalizeEntityId(value['id'], 'monitor event id'),
    at: normalizeTimestamp(value['at'], 'monitor event timestamp'),
    sessionId: normalizeEntityId(value['sessionId'], 'work session id'),
    type: normalizeEventType(value['type']),
    source: normalizeEventSource(value['source']),
    summary: safeSingleLine(value['summary'], 'monitor event summary', 1000),
  };
  if (value['subject'] !== undefined) { event.subject = normalizeSubject(value['subject']); }
  if (value['before'] !== undefined) { event.before = normalizeState(value['before'], 'before'); }
  if (value['after'] !== undefined) { event.after = normalizeState(value['after'], 'after'); }
  if (value['artifactPath'] !== undefined) {
    event.artifactPath = normalizeArtifactPath(value['artifactPath']);
  }
  if (value['metadata'] !== undefined) { event.metadata = normalizeMetadata(value['metadata']); }
  return event;
}

interface NormalizedMonitorEventFilter {
  sessionId?: string;
  ticketKey?: string;
  source?: MonitorEventSource;
  types?: ReadonlySet<MonitorEventType>;
  since?: string;
  limit: number;
}

function normalizeFilter(filter: MonitorEventFilter): NormalizedMonitorEventFilter {
  const normalized: NormalizedMonitorEventFilter = {
    limit: boundedInteger(filter.limit, DEFAULT_LIMIT, 1, MAX_LIMIT),
  };
  if (filter.sessionId !== undefined) { normalized.sessionId = normalizeEntityId(filter.sessionId, 'work session id'); }
  if (filter.ticketKey !== undefined) { normalized.ticketKey = normalizeTicketKey(filter.ticketKey); }
  if (filter.source !== undefined) { normalized.source = normalizeEventSource(filter.source); }
  if (filter.types !== undefined) {
    normalized.types = new Set(filter.types.map(normalizeEventType));
  }
  if (filter.since !== undefined) { normalized.since = normalizeTimestamp(filter.since, 'monitor event since timestamp'); }
  return normalized;
}

function monitorEventMatches(event: MonitorEvent, filter: NormalizedMonitorEventFilter): boolean {
  if (filter.sessionId && event.sessionId !== filter.sessionId) { return false; }
  if (filter.ticketKey && event.subject?.ticketKey !== filter.ticketKey) { return false; }
  if (filter.source && event.source !== filter.source) { return false; }
  if (filter.types && !filter.types.has(event.type)) { return false; }
  if (filter.since && event.at < filter.since) { return false; }
  return true;
}

function normalizeSubject(value: unknown): MonitorEventSubject {
  if (!isRecord(value)) { throw new Error('Monitor event subject must be an object.'); }
  const subject: MonitorEventSubject = {
    kind: safeSingleLine(value['kind'], 'monitor subject kind', 100),
    id: safeSingleLine(value['id'], 'monitor subject id', 500),
  };
  if (value['project'] !== undefined) {
    subject.project = safeSingleLine(value['project'], 'monitor subject project', 500);
  }
  if (value['ticketKey'] !== undefined) {
    subject.ticketKey = normalizeTicketKey(value['ticketKey']);
  }
  return subject;
}

function normalizeState(value: unknown, label: string): MonitorEventState {
  if (!isRecord(value)) { throw new Error(`Monitor event ${label} state must be an object.`); }
  const state: MonitorEventState = {};
  if (value['state'] !== undefined) {
    state.state = safeSingleLine(value['state'], `monitor event ${label} state`, 200);
  }
  if (value['fingerprint'] !== undefined) {
    state.fingerprint = safeSingleLine(value['fingerprint'], `monitor event ${label} fingerprint`, 256);
  }
  if (!state.state && !state.fingerprint) { throw new Error(`Monitor event ${label} state is empty.`); }
  return state;
}

function normalizeMetadata(value: unknown): Record<string, MonitorEventMetadataValue> {
  if (!isRecord(value)) { throw new Error('Monitor event metadata must be an object.'); }
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ENTRIES) {
    throw new Error(`Monitor event metadata exceeds the ${MAX_METADATA_ENTRIES}-entry limit.`);
  }
  const metadata: Record<string, MonitorEventMetadataValue> = {};
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) || SENSITIVE_KEY_PATTERN.test(key)) {
      throw new Error(`Monitor event metadata key is unsafe: ${key}`);
    }
    if (raw === null || typeof raw === 'boolean') {
      metadata[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      metadata[key] = raw;
    } else if (typeof raw === 'string') {
      metadata[key] = safeSingleLine(raw, `monitor event metadata ${key}`, 1000);
    } else {
      throw new Error(`Monitor event metadata ${key} must be a primitive value.`);
    }
  }
  return metadata;
}

function normalizeEventType(value: unknown): MonitorEventType {
  if (typeof value === 'string' && EVENT_TYPES.has(value as MonitorEventType)) {
    return value as MonitorEventType;
  }
  throw new Error('Monitor event type is invalid.');
}

function normalizeEventSource(value: unknown): MonitorEventSource {
  if (typeof value === 'string' && EVENT_SOURCES.has(value as MonitorEventSource)) {
    return value as MonitorEventSource;
  }
  throw new Error('Monitor event source is invalid.');
}

function normalizeEntityId(value: unknown, label: string): string {
  if (typeof value !== 'string') { throw new Error(`${label} must be a string.`); }
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error(`${label} is missing or invalid.`); }
  return normalized;
}

function normalizeTicketKey(value: unknown): string {
  if (typeof value !== 'string') { throw new Error('Ticket key must be a string.'); }
  const normalized = value.trim().toUpperCase();
  if (!TICKET_KEY_PATTERN.test(normalized)) { throw new Error('Ticket key is missing or invalid.'); }
  return normalized;
}

function safeSingleLine(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') { throw new Error(`${label} must be a string.`); }
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength || CONTROL_PATTERN.test(value) || SENSITIVE_TEXT_PATTERN.test(normalized)) {
    throw new Error(`${label} is missing, too long, contains control characters, or resembles sensitive data.`);
  }
  return normalized;
}

function normalizeTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) { throw new Error(`${label} must be a timestamp.`); }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) { throw new Error(`${label} is invalid.`); }
  return date.toISOString();
}

function normalizeArtifactPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || CONTROL_PATTERN.test(value)) {
    throw new Error('Monitor event artifact path is invalid.');
  }
  const candidate = value.trim();
  if (!path.isAbsolute(candidate) && !path.win32.isAbsolute(candidate)) {
    throw new Error('Monitor event artifact path must be absolute.');
  }
  return path.win32.isAbsolute(candidate) && !path.isAbsolute(candidate)
    ? path.win32.normalize(candidate)
    : path.resolve(candidate);
}

function nowIso(now?: Date): string {
  const date = now || new Date();
  if (!Number.isFinite(date.getTime())) { throw new Error('Monitor event timestamp is invalid.'); }
  return date.toISOString();
}

function readBoundedTailLines(filePath: string, maxBytes: number): string[] {
  assertSafeRegularFile(filePath);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`Monitor event path is not a safe regular file: ${filePath}`);
    }
    const bytesToRead = Math.min(stat.size, maxBytes);
    if (bytesToRead <= 0) { return []; }
    const start = stat.size - bytesToRead;
    const buffer = Buffer.alloc(bytesToRead);
    fs.readSync(descriptor, buffer, 0, bytesToRead, start);
    let text = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = text.indexOf('\n');
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
    }
    return text.split(/\r?\n/).filter(Boolean);
  } finally {
    fs.closeSync(descriptor);
  }
}

function ensurePrivateDirectory(directoryPath: string): void {
  const resolved = path.resolve(directoryPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  assertSafeDirectory(current);

  for (const component of pathComponents(resolved)) {
    const candidate = path.join(current, component);
    const existing = inspectSafePathComponents(candidate);
    if (!existing) {
      assertSafeDirectory(current);
      try {
        fs.mkdirSync(candidate, { mode: DIRECTORY_MODE });
      } catch (error: unknown) {
        if (!hasErrorCode(error, 'EEXIST')) { throw error; }
      }
      assertSafeDirectory(candidate);
      setPrivateMode(candidate, DIRECTORY_MODE);
    } else if (!existing.isDirectory()) {
      throw new Error(`Monitor event directory has a non-directory path component: ${candidate}`);
    }
    current = candidate;
  }

  assertSafeDirectory(resolved);
  setPrivateMode(resolved, DIRECTORY_MODE);
}

function assertSafeDirectory(directoryPath: string): void {
  const stat = inspectSafePathComponents(directoryPath);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`Monitor event directory is not a safe private directory: ${directoryPath}`);
  }
}

function assertSafeRegularFile(filePath: string): void {
  const stat = inspectSafePathComponents(filePath);
  if (!stat || !stat.isFile()) {
    throw new Error(`Monitor event path is not a safe regular file: ${filePath}`);
  }
}

function assertSafeRegularFileIfPresent(filePath: string): boolean {
  const stat = inspectSafePathComponents(filePath);
  if (!stat) { return false; }
  if (!stat.isFile()) {
    throw new Error(`Monitor event path is not a safe regular file: ${filePath}`);
  }
  return true;
}

function inspectSafePathComponents(targetPath: string): fs.Stats | null {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = lstatIfPresent(current);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Monitor event path has an unsafe filesystem root: ${current}`);
  }

  const components = pathComponents(resolved);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = lstatIfPresent(current);
    if (!stat) { return null; }
    if (stat.isSymbolicLink()) {
      throw new Error(`Monitor event path has a symbolic-link component: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`Monitor event path has a non-directory parent component: ${current}`);
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

function setPrivateMode(filePath: string, mode: number): void {
  if (process.platform !== 'win32') {
    const stat = inspectSafePathComponents(filePath);
    if (!stat || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Monitor event private path is unsafe: ${filePath}`);
    }
    fs.chmodSync(filePath, mode);
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function cloneEvent(event: MonitorEvent): MonitorEvent {
  return JSON.parse(JSON.stringify(event)) as MonitorEvent;
}
