import * as crypto from 'crypto';
import * as path from 'path';
import { boundedInteger, isRecord } from './records';
import {
  appendPrivateTextRecord,
  ensurePrivateDirectoryPath,
  readPrivateTextTailLinesIfPresent,
} from './privateFilePrimitives';
import { KRONOS_DIR } from './stateStore';

export type MonitorEventType =
  | 'session.created'
  | 'terminal.attached'
  | 'terminal.detached'
  | 'context.inserted'
  | 'provider.transition'
  | 'provider.baseline'
  | 'notification.shown'
  | 'notification.acknowledged'
  | 'decision.recorded';

export type MonitorEventSource = 'operator' | 'jira' | 'gitlab' | 'jenkins' | 'sonar' | 'kronos';
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
const SENSITIVE_TEXT_PATTERN = /(?:authorization\s*:|private-token\s*:|(?:password|passwd|secret|token|api[_-]?key|credential)\s*[=:]\s*\S+|https?:\/\/[^\s/@:]+:[^\s/@]+@|\b(?:glpat-|sqp_|github_pat_|gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b|-----BEGIN [^-\r\n]*(?:PRIVATE KEY|SECRET)[^-\r\n]*-----)/i;

const EVENT_TYPES = new Set<MonitorEventType>([
  'session.created',
  'terminal.attached',
  'terminal.detached',
  'context.inserted',
  'provider.transition',
  'provider.baseline',
  'notification.shown',
  'notification.acknowledged',
  'decision.recorded',
]);
const EVENT_SOURCES = new Set<MonitorEventSource>([
  'operator',
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
  }, options);
  const line = `${JSON.stringify(event)}\n`;
  if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) {
    throw new Error(`Monitor event exceeds the ${MAX_EVENT_BYTES}-byte limit.`);
  }

  const filePath = monitorEventsPath(options);
  ensurePrivateDirectoryPath(path.dirname(filePath), 'Kronos monitor event ledger', DIRECTORY_MODE);
  appendPrivateTextRecord(filePath, line, {
    label: 'Kronos monitor event ledger',
    maxBytes: MAX_EVENT_BYTES,
    fileMode: FILE_MODE,
  });
  return cloneEvent(event);
}

export function listMonitorEvents(
  filter: MonitorEventFilter = {},
  options: MonitorEventStoreOptions = {},
): MonitorEvent[] {
  const filePath = monitorEventsPath(options);
  const normalizedFilter = normalizeFilter(filter);
  const maxReadBytes = boundedInteger(
    options.maxReadBytes,
    DEFAULT_MAX_READ_BYTES,
    MIN_MAX_READ_BYTES,
    MAX_MAX_READ_BYTES,
  );
  const lines = readPrivateTextTailLinesIfPresent(filePath, {
    label: 'Kronos monitor event ledger',
    maxBytes: maxReadBytes,
  }) || [];
  const matching: MonitorEvent[] = [];
  for (let index = lines.length - 1; index >= 0 && matching.length < normalizedFilter.limit; index -= 1) {
    const line = lines[index];
    if (!line) { continue; }
    let event: MonitorEvent;
    try {
      event = normalizeMonitorEvent(JSON.parse(line) as unknown, options);
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
  return appendAcknowledgement(target, options);
}

/**
 * A deterministic live Attention row may not have a retained provider
 * transition. Persist only its local acknowledgement; never fabricate provider
 * history or mutate the provider snapshot.
 */
export function acknowledgePresentedMonitorEvent(
  presented: MonitorEvent,
  options: MonitorEventStoreOptions = {},
): MonitorEvent {
  const target = normalizeMonitorEvent(presented, options);
  const recent = listMonitorEvents({ sessionId: target.sessionId, limit: MAX_LIMIT }, options);
  const existing = recent.find(event =>
    event.type === 'notification.acknowledged'
    && event.metadata?.['acknowledgedEventId'] === target.id
  );
  if (existing) { return existing; }
  const retained = recent.find(event => event.id === target.id);
  if (retained) { return appendAcknowledgement(retained, options); }
  const synthetic = target.type === 'provider.transition'
    && target.metadata?.['liveSnapshot'] === true
    && (
      (target.source === 'jenkins' && target.subject?.kind === 'build')
      || (target.source === 'sonar' && target.subject?.kind === 'quality-gate')
    );
  if (!synthetic) {
    throw new Error(`Presented Attention event is not eligible for local acknowledgement: ${target.id}`);
  }
  return appendAcknowledgement(target, options);
}

function appendAcknowledgement(
  target: MonitorEvent,
  options: MonitorEventStoreOptions,
): MonitorEvent {
  const metadata: Record<string, MonitorEventMetadataValue> = { acknowledgedEventId: target.id };
  const transitionStreamKey = target.metadata?.['transitionStreamKey'];
  if (typeof transitionStreamKey === 'string' && transitionStreamKey) {
    metadata['transitionStreamKey'] = transitionStreamKey;
  }
  const input: AppendMonitorEventInput = {
    sessionId: target.sessionId,
    type: 'notification.acknowledged',
    source: 'operator',
    summary: `Acknowledged ${target.type} event ${target.id}.`,
    metadata,
  };
  if (target.subject) { input.subject = target.subject; }
  return appendMonitorEvent(input, options);
}

export function normalizeMonitorEvent(
  value: unknown,
  options: MonitorEventStoreOptions = {},
): MonitorEvent {
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
    event.artifactPath = normalizeArtifactPath(value['artifactPath'], options);
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

function normalizeArtifactPath(value: unknown, options: MonitorEventStoreOptions): string {
  if (typeof value !== 'string' || !value.trim() || CONTROL_PATTERN.test(value)) {
    throw new Error('Monitor event artifact path is invalid.');
  }
  const candidate = value.trim();
  if (!path.isAbsolute(candidate) && !path.win32.isAbsolute(candidate)) {
    throw new Error('Monitor event artifact path must be absolute.');
  }
  const normalized = path.win32.isAbsolute(candidate) && !path.isAbsolute(candidate)
    ? path.win32.normalize(candidate)
    : path.resolve(candidate);
  if (path.win32.isAbsolute(normalized) && !path.isAbsolute(normalized)) {
    if (process.platform !== 'win32') { return normalized; }
  }
  const root = path.resolve(options.kronosDir || KRONOS_DIR);
  const relative = path.relative(root, path.resolve(normalized));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Monitor event artifact path must stay inside the Kronos data directory.');
  }
  return normalized;
}

function nowIso(now?: Date): string {
  const date = now || new Date();
  if (!Number.isFinite(date.getTime())) { throw new Error('Monitor event timestamp is invalid.'); }
  return date.toISOString();
}

function cloneEvent(event: MonitorEvent): MonitorEvent {
  return JSON.parse(JSON.stringify(event)) as MonitorEvent;
}
