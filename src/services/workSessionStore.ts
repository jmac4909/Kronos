import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { unknownErrorMessage } from './errorUtils';
import { isRecord } from './records';
import { KRONOS_DIR } from './stateStore';

export type WorkSessionStatus = 'active' | 'closed';
export type WorkSessionKind = 'ticket' | 'standalone';
export type WorkSessionTerminalStatus = 'attached' | 'detached' | 'closed';
export type WorkSessionMonitoringState = 'healthy' | 'partial' | 'blocked' | 'idle';
export type WorkSessionProvider = 'jira' | 'gitlab' | 'jenkins' | 'sonar';
export type WorkSessionProviderResource =
  | 'ticket'
  | 'merge-request'
  | 'pipeline'
  | 'job'
  | 'build'
  | 'branch'
  | 'quality-gate';

export interface WorkSessionTerminalBinding {
  id: string;
  name: string;
  status: WorkSessionTerminalStatus;
  attachedAt: string;
  cwd?: string;
  processId?: number;
  shell?: string;
  detachedAt?: string;
  detachReason?: string;
}

export interface WorkSessionProviderBinding {
  id: string;
  provider: WorkSessionProvider;
  resource: WorkSessionProviderResource;
  subjectId: string;
  attachedAt: string;
  projectId?: string;
  url?: string;
}

export interface WorkSessionContextArtifact {
  id: string;
  kind: string;
  label: string;
  promptPath: string;
  fetchedAt: string;
  recordedAt: string;
  complete: boolean;
  warnings: string[];
  contentSha256?: string;
}

interface WorkSessionRecordBase {
  schemaVersion: 1;
  id: string;
  kind: WorkSessionKind;
  title: string;
  status: WorkSessionStatus;
  createdAt: string;
  updatedAt: string;
  terminals: WorkSessionTerminalBinding[];
  providerBindings: WorkSessionProviderBinding[];
  artifacts: WorkSessionContextArtifact[];
  monitoring: {
    enabled: boolean;
    lastPolledAt?: string;
    lastAttemptAt?: string;
    lastState?: WorkSessionMonitoringState;
    lastSummary?: string;
    lastFailureCount?: number;
    lastSkippedCount?: number;
  };
  projectName?: string;
  projectPath?: string;
  closedAt?: string;
}

export interface TicketWorkSessionRecord extends WorkSessionRecordBase {
  kind: 'ticket';
  ticketKey: string;
}

export interface StandaloneWorkSessionRecord extends WorkSessionRecordBase {
  kind: 'standalone';
  ticketKey?: never;
}

export type WorkSessionRecord = TicketWorkSessionRecord | StandaloneWorkSessionRecord;

export interface CreateTicketWorkSessionInput {
  ticketKey: string;
  title?: string;
  projectName?: string;
  projectPath?: string;
  monitoringEnabled?: boolean;
}

/** @deprecated Prefer CreateTicketWorkSessionInput for ticket-linked sessions. */
export type CreateWorkSessionInput = CreateTicketWorkSessionInput;

export interface CreateStandaloneWorkSessionInput {
  title: string;
  projectName?: string;
  projectPath?: string;
  monitoringEnabled?: boolean;
}

export interface SetWorkSessionProjectInput {
  projectName?: string;
  projectPath?: string;
}

export interface WorkSessionEventContext {
  sessionId: string;
  sessionTitle: string;
  label: string;
  ticketKey?: string;
}

export interface AttachWorkSessionTerminalInput {
  bindingId?: string;
  name: string;
  cwd?: string;
  processId?: number;
  shell?: string;
}

export interface AddWorkSessionProviderBindingInput {
  id?: string;
  provider: WorkSessionProvider;
  resource: WorkSessionProviderResource;
  subjectId: string;
  projectId?: string;
  url?: string;
}

export interface RecordWorkSessionContextArtifactInput {
  id?: string;
  kind: string;
  label: string;
  promptPath: string;
  fetchedAt?: string;
  complete: boolean;
  warnings?: readonly string[];
  contentSha256?: string;
}

export interface WorkSessionStoreOptions {
  kronosDir?: string;
  now?: Date;
  limit?: number;
}

export interface ListWorkSessionOptions extends WorkSessionStoreOptions {
  kind?: WorkSessionKind;
  status?: WorkSessionStatus;
  monitoringEnabled?: boolean;
}

export interface RecordWorkSessionMonitoringResultInput {
  polled: number;
  failures: number;
  skipped: number;
  attemptedAt?: string;
  summary?: string;
}

export interface WorkSessionStoreIssue {
  filePath: string;
  detail: string;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const SCHEMA_VERSION = 1;
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 1000;
const MAX_TERMINALS = 64;
const MAX_PROVIDER_BINDINGS = 64;
const MAX_ARTIFACTS = 200;
const MAX_WARNINGS = 32;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const TICKET_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
const NO_FOLLOW_VALUE = Reflect.get(fs.constants, 'O_NOFOLLOW');
const NO_FOLLOW_FLAG = typeof NO_FOLLOW_VALUE === 'number' ? NO_FOLLOW_VALUE : 0;

export function workSessionsDirectory(options: WorkSessionStoreOptions = {}): string {
  return path.resolve(options.kronosDir || KRONOS_DIR, 'work-sessions');
}

export function workSessionDirectory(sessionId: string, options: WorkSessionStoreOptions = {}): string {
  return path.join(workSessionsDirectory(options), normalizeEntityId(sessionId, 'work session id'));
}

export function workSessionRecordPath(sessionId: string, options: WorkSessionStoreOptions = {}): string {
  return path.join(workSessionDirectory(sessionId, options), 'session.json');
}

export function createOrGetWorkSessionByTicket(
  input: CreateWorkSessionInput,
  options: WorkSessionStoreOptions = {},
): TicketWorkSessionRecord {
  const ticketKey = normalizeTicketKey(input.ticketKey);
  const existing = getWorkSessionByTicket(ticketKey, options);
  if (existing) { return existing; }

  const at = nowIso(options.now);
  const id = workSessionIdForTicket(ticketKey);
  const record: WorkSessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    id,
    kind: 'ticket',
    ticketKey,
    title: optionalSingleLine(input.title, 'work session title', 300) || ticketKey,
    status: 'active',
    createdAt: at,
    updatedAt: at,
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: input.monitoringEnabled !== false },
  };
  const projectName = optionalSingleLine(input.projectName, 'project name', 200);
  const projectPath = optionalAbsolutePath(input.projectPath, 'project path');
  if (projectName) { record.projectName = projectName; }
  if (projectPath) { record.projectPath = projectPath; }
  writeWorkSessionRecord(record, options);
  return cloneWorkSession(record);
}

export function createStandaloneWorkSession(
  input: CreateStandaloneWorkSessionInput,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord {
  const title = requiredSingleLine(input.title, 'work session title', 300);
  const at = nowIso(options.now);
  const record: StandaloneWorkSessionRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: standaloneWorkSessionId(title),
    kind: 'standalone',
    title,
    status: 'active',
    createdAt: at,
    updatedAt: at,
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: input.monitoringEnabled === true },
  };
  const projectName = optionalSingleLine(input.projectName, 'project name', 200);
  const projectPath = optionalAbsolutePath(input.projectPath, 'project path');
  if (projectName) { record.projectName = projectName; }
  if (projectPath) { record.projectPath = projectPath; }
  writeWorkSessionRecord(record, options);
  return cloneWorkSession(record);
}

export function workSessionEventContext(record: WorkSessionRecord): WorkSessionEventContext {
  const context: WorkSessionEventContext = {
    sessionId: record.id,
    sessionTitle: record.title,
    label: record.kind === 'ticket' ? `${record.ticketKey}: ${record.title}` : record.title,
  };
  if (record.kind === 'ticket') { context.ticketKey = record.ticketKey; }
  return context;
}

export function workSessionTicketMetadata(record: WorkSessionRecord): { ticketKey?: string } {
  return record.kind === 'ticket' ? { ticketKey: record.ticketKey } : {};
}

export function getWorkSessionByTicket(
  ticketKey: string,
  options: WorkSessionStoreOptions = {},
): TicketWorkSessionRecord | null {
  const normalizedTicketKey = normalizeTicketKey(ticketKey);
  const id = workSessionIdForTicket(normalizedTicketKey);
  const record = readWorkSession(id, options);
  if (!record) { return null; }
  if (record.kind !== 'ticket' || record.ticketKey !== normalizedTicketKey) {
    throw new Error(`Work session ${id} is not linked to ${normalizedTicketKey}.`);
  }
  return record;
}

export function readWorkSession(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord | null {
  const filePath = workSessionRecordPath(sessionId, options);
  if (!assertSafeRegularFileIfPresent(filePath, 'work session record')) { return null; }
  const parsed = JSON.parse(readSafeRegularFile(filePath, 'work session record')) as unknown;
  const record = normalizeWorkSessionRecord(parsed);
  if (record.id !== normalizeEntityId(sessionId, 'work session id')) {
    throw new Error(`Work session record id does not match ${path.basename(path.dirname(filePath))}.`);
  }
  return record;
}

export function listWorkSessions(options: ListWorkSessionOptions = {}): WorkSessionRecord[] {
  const directory = workSessionsDirectory(options);
  if (!assertSafeDirectoryIfPresent(directory, 'work sessions directory')) { return []; }
  const limit = boundedInteger(options.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const records: WorkSessionRecord[] = [];
  assertSafeDirectory(directory, 'work sessions directory');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID_PATTERN.test(entry.name)) { continue; }
    try {
      const record = readWorkSession(entry.name, options);
      if (record) { records.push(record); }
    } catch {
      // Invalid records are exposed by listWorkSessionStoreIssues and never trusted here.
    }
  }
  return records
    .filter(record => options.kind === undefined || record.kind === options.kind)
    .filter(record => options.status === undefined || record.status === options.status)
    .filter(record => options.monitoringEnabled === undefined
      || record.monitoring.enabled === options.monitoringEnabled)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function listWorkSessionStoreIssues(options: WorkSessionStoreOptions = {}): WorkSessionStoreIssue[] {
  const directory = workSessionsDirectory(options);
  if (!assertSafeDirectoryIfPresent(directory, 'work sessions directory')) { return []; }
  const limit = boundedInteger(options.limit, DEFAULT_LIST_LIMIT, 1, MAX_LIST_LIMIT);
  const issues: WorkSessionStoreIssue[] = [];
  assertSafeDirectory(directory, 'work sessions directory');
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).slice(0, limit)) {
    const filePath = path.join(directory, entry.name, 'session.json');
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_ID_PATTERN.test(entry.name)) {
      issues.push({ filePath, detail: 'Unsafe or invalid work session directory entry.' });
      continue;
    }
    try {
      readWorkSession(entry.name, options);
    } catch (error: unknown) {
      issues.push({ filePath, detail: unknownErrorMessage(error, 'Invalid work session record.') });
    }
  }
  return issues;
}

export function attachWorkSessionTerminal(
  sessionId: string,
  input: AttachWorkSessionTerminalInput,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    requireActiveSession(record);
    const bindingId = input.bindingId
      ? normalizeEntityId(input.bindingId, 'terminal binding id')
      : normalizeEntityId(`terminal-${crypto.randomUUID()}`, 'terminal binding id');
    const candidate: WorkSessionTerminalBinding = {
      id: bindingId,
      name: requiredSingleLine(input.name, 'terminal name', 200),
      status: 'attached',
      attachedAt: at,
    };
    const cwd = optionalAbsolutePath(input.cwd, 'terminal cwd');
    const processId = optionalPositiveInteger(input.processId, 'terminal process id');
    const shell = optionalSingleLine(input.shell, 'terminal shell', 100);
    if (cwd) { candidate.cwd = cwd; }
    if (processId !== undefined) { candidate.processId = processId; }
    if (shell) { candidate.shell = shell; }

    const existingIndex = record.terminals.findIndex(binding => binding.id === bindingId);
    if (existingIndex >= 0) {
      record.terminals[existingIndex] = candidate;
    } else {
      record.terminals.push(candidate);
    }
    record.terminals = record.terminals.slice(-MAX_TERMINALS);
  });
}

export function setWorkSessionProject(
  sessionId: string,
  input: SetWorkSessionProjectInput,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, record => {
    delete record.projectName;
    delete record.projectPath;
    const projectName = optionalSingleLine(input.projectName, 'project name', 200);
    const projectPath = optionalAbsolutePath(input.projectPath, 'project path');
    if (projectName) { record.projectName = projectName; }
    if (projectPath) { record.projectPath = projectPath; }
  });
}

export function detachWorkSessionTerminal(
  sessionId: string,
  bindingId: string,
  reason?: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    const safeBindingId = normalizeEntityId(bindingId, 'terminal binding id');
    const binding = record.terminals.find(candidate => candidate.id === safeBindingId);
    if (!binding) { throw new Error(`Terminal binding not found: ${safeBindingId}`); }
    if (binding.status === 'closed') { return; }
    binding.status = 'detached';
    binding.detachedAt = at;
    const safeReason = optionalSingleLine(reason, 'terminal detach reason', 500);
    if (safeReason) { binding.detachReason = safeReason; }
  });
}

export function addWorkSessionProviderBinding(
  sessionId: string,
  input: AddWorkSessionProviderBindingInput,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    requireActiveSession(record);
    const provider = normalizeProvider(input.provider);
    const resource = normalizeProviderResource(input.resource);
    const subjectId = requiredSingleLine(input.subjectId, 'provider subject id', 500);
    const projectId = optionalSingleLine(input.projectId, 'provider project id', 500);
    const id = input.id
      ? normalizeEntityId(input.id, 'provider binding id')
      : providerBindingId(provider, resource, `${projectId || ''}-${subjectId}`);
    const binding: WorkSessionProviderBinding = { id, provider, resource, subjectId, attachedAt: at };
    const url = optionalPublicHttpUrl(input.url, 'provider URL');
    if (projectId) { binding.projectId = projectId; }
    if (url) { binding.url = url; }
    const existingIndex = record.providerBindings.findIndex(candidate => candidate.id === id);
    if (existingIndex >= 0) {
      record.providerBindings[existingIndex] = binding;
    } else {
      record.providerBindings.push(binding);
    }
    record.providerBindings = record.providerBindings.slice(-MAX_PROVIDER_BINDINGS);
  });
}

export function recordWorkSessionContextArtifact(
  sessionId: string,
  input: RecordWorkSessionContextArtifactInput,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    requireActiveSession(record);
    const promptPath = requiredAbsolutePath(input.promptPath, 'context artifact prompt path');
    assertArtifactInsideKronos(promptPath, options);
    const artifact: WorkSessionContextArtifact = {
      id: input.id
        ? normalizeEntityId(input.id, 'context artifact id')
        : normalizeEntityId(`artifact-${crypto.randomUUID()}`, 'context artifact id'),
      kind: requiredSingleLine(input.kind, 'context artifact kind', 100),
      label: requiredSingleLine(input.label, 'context artifact label', 300),
      promptPath,
      fetchedAt: input.fetchedAt ? normalizeTimestamp(input.fetchedAt, 'context artifact fetchedAt') : at,
      recordedAt: at,
      complete: input.complete === true,
      warnings: normalizeWarnings(input.warnings),
    };
    const contentSha256 = optionalContentSha256(input.contentSha256);
    if (contentSha256) { artifact.contentSha256 = contentSha256; }
    const existingIndex = record.artifacts.findIndex(candidate => candidate.id === artifact.id);
    if (existingIndex >= 0) {
      record.artifacts[existingIndex] = artifact;
    } else {
      record.artifacts.push(artifact);
    }
    record.artifacts = record.artifacts.slice(-MAX_ARTIFACTS);
  });
}

export function setWorkSessionMonitoring(
  sessionId: string,
  enabled: boolean,
  lastPolledAt?: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, record => {
    record.monitoring.enabled = enabled === true;
    if (lastPolledAt !== undefined) {
      record.monitoring.lastPolledAt = normalizeTimestamp(lastPolledAt, 'monitoring lastPolledAt');
    }
  });
}

export function recordWorkSessionMonitoringResult(
  sessionId: string,
  input: RecordWorkSessionMonitoringResultInput,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    requireActiveSession(record);
    const polled = normalizeNonNegativeInteger(input.polled, 'monitoring polled count');
    const failures = normalizeNonNegativeInteger(input.failures, 'monitoring failure count');
    const skipped = normalizeNonNegativeInteger(input.skipped, 'monitoring skipped count');
    const attemptedAt = input.attemptedAt
      ? normalizeTimestamp(input.attemptedAt, 'monitoring lastAttemptAt')
      : at;
    record.monitoring.lastAttemptAt = attemptedAt;
    if (polled > 0) { record.monitoring.lastPolledAt = attemptedAt; }
    record.monitoring.lastFailureCount = failures;
    record.monitoring.lastSkippedCount = skipped;
    record.monitoring.lastState = failures > 0
      ? (polled > 0 ? 'partial' : 'blocked')
      : skipped > 0
        ? (polled > 0 ? 'partial' : 'blocked')
        : polled > 0 ? 'healthy' : 'idle';
    const summary = optionalSingleLine(input.summary, 'monitoring result summary', 500);
    record.monitoring.lastSummary = summary || `Polled ${polled}; ${failures} failed; ${skipped} skipped.`;
  });
}

export function closeWorkSession(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, (record, at) => {
    if (record.status === 'closed') { return; }
    record.status = 'closed';
    record.closedAt = at;
    record.monitoring.enabled = false;
    for (const terminal of record.terminals) {
      if (terminal.status === 'attached') {
        terminal.status = 'closed';
        terminal.detachedAt = at;
        terminal.detachReason = 'Work session closed.';
      }
    }
  });
}

/**
 * Permanently removes one local session record and its colocated monitoring
 * snapshots. Shared append-only audit events and context artifacts are not
 * rewritten, and no terminal object or process is touched.
 */
export function removeWorkSession(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  const record = readWorkSession(sessionId, options);
  if (!record) { throw new Error(`Work session not found: ${normalizeEntityId(sessionId, 'work session id')}`); }
  const root = workSessionsDirectory(options);
  const directory = workSessionDirectory(record.id, options);
  assertSafeDirectory(root, 'work sessions directory');
  assertSafeDirectory(directory, 'work session directory');
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Work session removal refused an unsafe directory entry: ${filePath}`);
    }
    assertSafeRegularFile(filePath, 'work session removal file');
  }
  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    assertSafeRegularFile(filePath, 'work session removal file');
    fs.unlinkSync(filePath);
  }
  assertSafeDirectory(directory, 'work session directory');
  fs.rmdirSync(directory);
  assertSafeDirectory(root, 'work sessions directory');
  return cloneWorkSession(record);
}

export function reopenWorkSession(
  sessionId: string,
  options: WorkSessionStoreOptions = {},
): WorkSessionRecord {
  return mutateWorkSession(sessionId, options, record => {
    if (record.status === 'active') { return; }
    record.status = 'active';
    delete record.closedAt;
    record.monitoring.enabled = record.kind === 'ticket';
  });
}

export function normalizeWorkSessionRecord(value: unknown): WorkSessionRecord {
  if (!isRecord(value)) { throw new Error('Work session record must be an object.'); }
  if (value['schemaVersion'] !== SCHEMA_VERSION) { throw new Error('Unsupported work session schema version.'); }
  const kind = normalizeWorkSessionKind(value['kind'], value['ticketKey']);
  const base: Omit<WorkSessionRecordBase, 'kind'> = {
    schemaVersion: SCHEMA_VERSION,
    id: normalizeEntityId(value['id'], 'work session id'),
    title: requiredSingleLine(value['title'], 'work session title', 300),
    status: normalizeSessionStatus(value['status']),
    createdAt: normalizeTimestamp(value['createdAt'], 'work session createdAt'),
    updatedAt: normalizeTimestamp(value['updatedAt'], 'work session updatedAt'),
    terminals: normalizeTerminalBindings(value['terminals']),
    providerBindings: normalizeProviderBindings(value['providerBindings']),
    artifacts: normalizeArtifacts(value['artifacts']),
    monitoring: normalizeMonitoring(value['monitoring']),
  };
  const record: WorkSessionRecord = kind === 'ticket'
    ? { ...base, kind, ticketKey: normalizeTicketKeyValue(value['ticketKey']) }
    : { ...base, kind };
  if (kind === 'standalone' && value['ticketKey'] !== undefined && value['ticketKey'] !== null && value['ticketKey'] !== '') {
    throw new Error('Standalone work session must not include a ticket key.');
  }
  const projectName = optionalSingleLine(value['projectName'], 'project name', 200);
  const projectPath = optionalAbsolutePath(value['projectPath'], 'project path');
  const closedAt = optionalTimestamp(value['closedAt'], 'work session closedAt');
  if (projectName) { record.projectName = projectName; }
  if (projectPath) { record.projectPath = projectPath; }
  if (closedAt) { record.closedAt = closedAt; }
  if (record.status === 'closed' && !record.closedAt) {
    throw new Error('Closed work session must include closedAt.');
  }
  return record;
}

function mutateWorkSession(
  sessionId: string,
  options: WorkSessionStoreOptions,
  mutation: (record: WorkSessionRecord, at: string) => void,
): WorkSessionRecord {
  const record = readWorkSession(sessionId, options);
  if (!record) { throw new Error(`Work session not found: ${sessionId}`); }
  const at = nowIso(options.now);
  mutation(record, at);
  record.updatedAt = at;
  const normalized = normalizeWorkSessionRecord(record);
  writeWorkSessionRecord(normalized, options);
  return cloneWorkSession(normalized);
}

function writeWorkSessionRecord(record: WorkSessionRecord, options: WorkSessionStoreOptions): void {
  const normalized = normalizeWorkSessionRecord(record);
  const base = path.resolve(options.kronosDir || KRONOS_DIR);
  ensurePrivateDirectory(base, 'Kronos data directory');
  const root = workSessionsDirectory(options);
  ensurePrivateDirectory(root, 'work sessions directory');
  const directory = workSessionDirectory(normalized.id, options);
  ensurePrivateDirectory(directory, 'work session directory');
  const filePath = workSessionRecordPath(normalized.id, options);
  assertSafeRegularFileIfPresent(filePath, 'work session record');
  writePrivateFileAtomic(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
}

function normalizeTerminalBindings(value: unknown): WorkSessionTerminalBinding[] {
  if (!Array.isArray(value)) { throw new Error('Work session terminals must be an array.'); }
  if (value.length > MAX_TERMINALS) { throw new Error(`Work session terminals exceed the ${MAX_TERMINALS}-entry limit.`); }
  return value.map(normalizeTerminalBinding);
}

function normalizeTerminalBinding(value: unknown): WorkSessionTerminalBinding {
  if (!isRecord(value)) { throw new Error('Terminal binding must be an object.'); }
  const binding: WorkSessionTerminalBinding = {
    id: normalizeEntityId(value['id'], 'terminal binding id'),
    name: requiredSingleLine(value['name'], 'terminal name', 200),
    status: normalizeTerminalStatus(value['status']),
    attachedAt: normalizeTimestamp(value['attachedAt'], 'terminal attachedAt'),
  };
  const cwd = optionalAbsolutePath(value['cwd'], 'terminal cwd');
  const processId = optionalPositiveInteger(value['processId'], 'terminal process id');
  const shell = optionalSingleLine(value['shell'], 'terminal shell', 100);
  const detachedAt = optionalTimestamp(value['detachedAt'], 'terminal detachedAt');
  const detachReason = optionalSingleLine(value['detachReason'], 'terminal detach reason', 500);
  if (cwd) { binding.cwd = cwd; }
  if (processId !== undefined) { binding.processId = processId; }
  if (shell) { binding.shell = shell; }
  if (detachedAt) { binding.detachedAt = detachedAt; }
  if (detachReason) { binding.detachReason = detachReason; }
  return binding;
}

function normalizeProviderBindings(value: unknown): WorkSessionProviderBinding[] {
  if (!Array.isArray(value)) { throw new Error('Work session provider bindings must be an array.'); }
  if (value.length > MAX_PROVIDER_BINDINGS) { throw new Error(`Provider bindings exceed the ${MAX_PROVIDER_BINDINGS}-entry limit.`); }
  return value.map(normalizeProviderBinding);
}

function normalizeProviderBinding(value: unknown): WorkSessionProviderBinding {
  if (!isRecord(value)) { throw new Error('Provider binding must be an object.'); }
  const binding: WorkSessionProviderBinding = {
    id: normalizeEntityId(value['id'], 'provider binding id'),
    provider: normalizeProvider(value['provider']),
    resource: normalizeProviderResource(value['resource']),
    subjectId: requiredSingleLine(value['subjectId'], 'provider subject id', 500),
    attachedAt: normalizeTimestamp(value['attachedAt'], 'provider attachedAt'),
  };
  const projectId = optionalSingleLine(value['projectId'], 'provider project id', 500);
  const url = optionalPublicHttpUrl(value['url'], 'provider URL');
  if (projectId) { binding.projectId = projectId; }
  if (url) { binding.url = url; }
  return binding;
}

function normalizeArtifacts(value: unknown): WorkSessionContextArtifact[] {
  if (!Array.isArray(value)) { throw new Error('Work session artifacts must be an array.'); }
  if (value.length > MAX_ARTIFACTS) { throw new Error(`Work session artifacts exceed the ${MAX_ARTIFACTS}-entry limit.`); }
  return value.map(item => {
    if (!isRecord(item)) { throw new Error('Context artifact must be an object.'); }
    const artifact: WorkSessionContextArtifact = {
      id: normalizeEntityId(item['id'], 'context artifact id'),
      kind: requiredSingleLine(item['kind'], 'context artifact kind', 100),
      label: requiredSingleLine(item['label'], 'context artifact label', 300),
      promptPath: requiredAbsolutePath(item['promptPath'], 'context artifact prompt path'),
      fetchedAt: normalizeTimestamp(item['fetchedAt'], 'context artifact fetchedAt'),
      recordedAt: normalizeTimestamp(item['recordedAt'], 'context artifact recordedAt'),
      complete: normalizeBoolean(item['complete'], 'context artifact complete'),
      warnings: normalizeWarnings(item['warnings']),
    };
    const contentSha256 = optionalContentSha256(item['contentSha256']);
    if (contentSha256) { artifact.contentSha256 = contentSha256; }
    return artifact;
  });
}

function optionalContentSha256(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Context artifact content SHA-256 is invalid.');
  }
  return value;
}

function normalizeMonitoring(value: unknown): WorkSessionRecord['monitoring'] {
  if (!isRecord(value)) { throw new Error('Work session monitoring must be an object.'); }
  const monitoring: WorkSessionRecord['monitoring'] = {
    enabled: normalizeBoolean(value['enabled'], 'monitoring enabled'),
  };
  const lastPolledAt = optionalTimestamp(value['lastPolledAt'], 'monitoring lastPolledAt');
  if (lastPolledAt) { monitoring.lastPolledAt = lastPolledAt; }
  const lastAttemptAt = optionalTimestamp(value['lastAttemptAt'], 'monitoring lastAttemptAt');
  if (lastAttemptAt) { monitoring.lastAttemptAt = lastAttemptAt; }
  const lastState = normalizeOptionalMonitoringState(value['lastState']);
  if (lastState) { monitoring.lastState = lastState; }
  const lastSummary = optionalSingleLine(value['lastSummary'], 'monitoring result summary', 500);
  if (lastSummary) { monitoring.lastSummary = lastSummary; }
  if (value['lastFailureCount'] !== undefined) {
    monitoring.lastFailureCount = normalizeNonNegativeInteger(value['lastFailureCount'], 'monitoring failure count');
  }
  if (value['lastSkippedCount'] !== undefined) {
    monitoring.lastSkippedCount = normalizeNonNegativeInteger(value['lastSkippedCount'], 'monitoring skipped count');
  }
  return monitoring;
}

function normalizeOptionalMonitoringState(value: unknown): WorkSessionMonitoringState | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  if (value === 'healthy' || value === 'partial' || value === 'blocked' || value === 'idle') { return value; }
  throw new Error('Monitoring result state is invalid.');
}

function normalizeWarnings(value: unknown): string[] {
  if (value === undefined) { return []; }
  if (!Array.isArray(value)) { throw new Error('Context artifact warnings must be an array.'); }
  return [...new Set(value.slice(0, MAX_WARNINGS).map(item => requiredSingleLine(item, 'context warning', 500)))];
}

function workSessionIdForTicket(ticketKey: string): string {
  return normalizeEntityId(safeFileStem(`jira-${ticketKey.toLowerCase()}`, { maxLength: 180 }), 'work session id');
}

function standaloneWorkSessionId(title: string): string {
  const stem = safeFileStem(title.toLowerCase(), { maxLength: 96 }) || 'session';
  return normalizeEntityId(`session-${stem}-${crypto.randomUUID()}`, 'work session id');
}

function providerBindingId(provider: WorkSessionProvider, resource: WorkSessionProviderResource, subject: string): string {
  return normalizeEntityId(safeFileStem(`${provider}-${resource}-${subject}`, { maxLength: 180 }), 'provider binding id');
}

function normalizeTicketKey(value: string): string {
  return normalizeTicketKeyValue(value);
}

function normalizeTicketKeyValue(value: unknown): string {
  if (typeof value !== 'string') { throw new Error('Ticket key must be a string.'); }
  const normalized = value.trim().toUpperCase();
  if (!TICKET_KEY_PATTERN.test(normalized)) { throw new Error('Ticket key is missing or invalid.'); }
  return normalized;
}

function normalizeWorkSessionKind(value: unknown, ticketKey: unknown): WorkSessionKind {
  // Version-1 records created before standalone sessions did not persist a kind.
  if (value === undefined && typeof ticketKey === 'string' && ticketKey.trim()) { return 'ticket'; }
  if (value === 'ticket' || value === 'standalone') { return value; }
  throw new Error('Work session kind is missing or invalid.');
}

function normalizeEntityId(value: unknown, label: string): string {
  if (typeof value !== 'string') { throw new Error(`${label} must be a string.`); }
  const normalized = value.trim();
  if (!SAFE_ID_PATTERN.test(normalized)) { throw new Error(`${label} is missing or invalid.`); }
  return normalized;
}

function normalizeSessionStatus(value: unknown): WorkSessionStatus {
  if (value === 'active' || value === 'closed') { return value; }
  throw new Error('Work session status is invalid.');
}

function normalizeTerminalStatus(value: unknown): WorkSessionTerminalStatus {
  if (value === 'attached' || value === 'detached' || value === 'closed') { return value; }
  throw new Error('Terminal binding status is invalid.');
}

function normalizeProvider(value: unknown): WorkSessionProvider {
  if (value === 'jira' || value === 'gitlab' || value === 'jenkins' || value === 'sonar') { return value; }
  throw new Error('Provider binding provider is invalid.');
}

function normalizeProviderResource(value: unknown): WorkSessionProviderResource {
  if (value === 'ticket'
    || value === 'merge-request'
    || value === 'pipeline'
    || value === 'job'
    || value === 'build'
    || value === 'branch'
    || value === 'quality-gate') {
    return value;
  }
  throw new Error('Provider binding resource is invalid.');
}

function normalizeBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') { throw new Error(`${label} must be a boolean.`); }
  return value;
}

function requiredSingleLine(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') { throw new Error(`${label} must be a string.`); }
  const sanitized = redactSensitiveText(value);
  const normalized = sanitized.trim().replace(/\s+/g, ' ');
  if (!normalized || normalized.length > maxLength || CONTROL_PATTERN.test(value)) {
    throw new Error(`${label} is missing, too long, or contains control characters.`);
  }
  return normalized;
}

function redactSensitiveText(value: string): string {
  const sanitizedUrls = value.replace(/\bhttps?:\/\/[^\s<>"`]+/gi, raw => {
    let candidate = raw;
    let trailing = '';
    while (/[),.;!?]$/.test(candidate)) {
      trailing = `${candidate.slice(-1)}${trailing}`;
      candidate = candidate.slice(0, -1);
    }
    try {
      const url = new URL(candidate);
      url.username = '';
      url.password = '';
      url.search = '';
      url.hash = '';
      return `${url.toString()}${trailing}`;
    } catch {
      return `[REDACTED URL]${trailing}`;
    }
  });
  return sanitizedUrls
    .replace(/-----BEGIN [^-\r\n]*(?:PRIVATE KEY|SECRET)[^-\r\n]*-----[\s\S]*?-----END [^-\r\n]*(?:PRIVATE KEY|SECRET)[^-\r\n]*-----/gi, '[REDACTED PRIVATE MATERIAL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi, '[REDACTED AUTHORIZATION]')
    .replace(/\b(?:glpat-|sqp_|github_pat_|gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED PROVIDER TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS ACCESS KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED JWT]')
    .replace(/((?:authorization|token|private[-_ ]?token|access[-_ ]?token|api[-_ ]?key|client[-_ ]?secret|password|passwd|secret|credential)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function optionalSingleLine(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  return requiredSingleLine(value, label, maxLength);
}

function optionalPositiveInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) { return undefined; }
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) { throw new Error(`${label} must be a timestamp.`); }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) { throw new Error(`${label} is invalid.`); }
  return parsed.toISOString();
}

function optionalTimestamp(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : normalizeTimestamp(value, label);
}

function nowIso(now?: Date): string {
  const candidate = now || new Date();
  if (!Number.isFinite(candidate.getTime())) { throw new Error('Work session timestamp is invalid.'); }
  return candidate.toISOString();
}

function requiredAbsolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || CONTROL_PATTERN.test(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  const trimmed = value.trim();
  if (!isPortableAbsolutePath(trimmed)) { throw new Error(`${label} must be absolute.`); }
  return normalizePortablePath(trimmed);
}

function optionalAbsolutePath(value: unknown, label: string): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : requiredAbsolutePath(value, label);
}

function isPortableAbsolutePath(value: string): boolean {
  return path.isAbsolute(value) || path.win32.isAbsolute(value);
}

function normalizePortablePath(value: string): string {
  return path.win32.isAbsolute(value) && !path.isAbsolute(value) ? path.win32.normalize(value) : path.resolve(value);
}

function optionalPublicHttpUrl(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') { return undefined; }
  if (typeof value !== 'string' || CONTROL_PATTERN.test(value)) { throw new Error(`${label} is invalid.`); }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { throw new Error('unsupported protocol'); }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    throw new Error(`${label} must be an HTTP(S) URL.`);
  }
}

function assertArtifactInsideKronos(artifactPath: string, options: WorkSessionStoreOptions): void {
  if (path.win32.isAbsolute(artifactPath) && !path.isAbsolute(artifactPath)) {
    if (process.platform !== 'win32') { return; }
  }
  const root = path.resolve(options.kronosDir || KRONOS_DIR);
  const relative = path.relative(root, path.resolve(artifactPath));
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Context artifact path must stay inside the Kronos data directory.');
  }
}

function requireActiveSession(record: WorkSessionRecord): void {
  if (record.status !== 'active') { throw new Error(`Work session ${record.id} is closed.`); }
}

function ensurePrivateDirectory(directoryPath: string, label: string): void {
  const resolved = path.resolve(directoryPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  assertSafeDirectory(current, `${label} root`);

  for (const component of pathComponents(resolved)) {
    const candidate = path.join(current, component);
    const existing = inspectSafePathComponents(candidate, label);
    if (!existing) {
      assertSafeDirectory(current, `${label} parent`);
      try {
        fs.mkdirSync(candidate, { mode: DIRECTORY_MODE });
      } catch (error: unknown) {
        if (!hasErrorCode(error, 'EEXIST')) { throw error; }
      }
      assertSafeDirectory(candidate, label);
      setPrivateMode(candidate, DIRECTORY_MODE);
    } else if (!existing.isDirectory()) {
      throw new Error(`${label} has a non-directory path component: ${candidate}`);
    }
    current = candidate;
  }

  assertSafeDirectory(resolved, label);
  setPrivateMode(resolved, DIRECTORY_MODE);
}

function assertSafeDirectory(directoryPath: string, label: string): void {
  const stat = inspectSafePathComponents(directoryPath, label);
  if (!stat || !stat.isDirectory()) {
    throw new Error(`${label} is not a safe private directory: ${directoryPath}`);
  }
}

function assertSafeDirectoryIfPresent(directoryPath: string, label: string): boolean {
  const stat = inspectSafePathComponents(directoryPath, label);
  if (!stat) { return false; }
  if (!stat.isDirectory()) {
    throw new Error(`${label} is not a safe private directory: ${directoryPath}`);
  }
  return true;
}

function assertSafeRegularFile(filePath: string, label: string): void {
  const stat = inspectSafePathComponents(filePath, label);
  if (!stat || !stat.isFile()) {
    throw new Error(`${label} is not a safe regular file: ${filePath}`);
  }
}

function assertSafeRegularFileIfPresent(filePath: string, label: string): boolean {
  const stat = inspectSafePathComponents(filePath, label);
  if (!stat) { return false; }
  if (!stat.isFile()) {
    throw new Error(`${label} is not a safe regular file: ${filePath}`);
  }
  return true;
}

function inspectSafePathComponents(targetPath: string, label: string): fs.Stats | null {
  const resolved = path.resolve(targetPath);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  let stat = lstatIfPresent(current);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} has an unsafe filesystem root: ${current}`);
  }

  const components = pathComponents(resolved);
  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (!component) { continue; }
    current = path.join(current, component);
    stat = lstatIfPresent(current);
    if (!stat) { return null; }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} has a symbolic-link path component: ${current}`);
    }
    if (index < components.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} has a non-directory parent component: ${current}`);
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

function readSafeRegularFile(filePath: string, label: string): string {
  assertSafeRegularFile(filePath, label);
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | NO_FOLLOW_FLAG);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) {
      throw new Error(`${label} is not a safe regular file: ${filePath}`);
    }
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

function writePrivateFileAtomic(filePath: string, content: string): void {
  const directoryPath = path.dirname(filePath);
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    assertSafeDirectory(directoryPath, 'work session record parent');
    assertSafeRegularFileIfPresent(temporaryPath, 'temporary work session record');
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | NO_FOLLOW_FLAG,
      FILE_MODE,
    );
    if (!fs.fstatSync(descriptor).isFile()) {
      throw new Error(`Temporary work session record is not a regular file: ${temporaryPath}`);
    }
    if (process.platform !== 'win32') { fs.fchmodSync(descriptor, FILE_MODE); }
    fs.writeFileSync(descriptor, content, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertSafeRegularFile(temporaryPath, 'temporary work session record');
    assertSafeDirectory(directoryPath, 'work session record parent');
    assertSafeRegularFileIfPresent(filePath, 'work session record');
    fs.renameSync(temporaryPath, filePath);
    assertSafeRegularFile(filePath, 'work session record');
    setPrivateMode(filePath, FILE_MODE);
  } catch (error: unknown) {
    if (descriptor !== undefined) { fs.closeSync(descriptor); }
    try {
      assertSafeDirectory(directoryPath, 'work session record parent');
      if (assertSafeRegularFileIfPresent(temporaryPath, 'temporary work session record')) {
        fs.unlinkSync(temporaryPath);
      }
    } catch { /* best effort */ }
    throw error;
  }
}

function setPrivateMode(filePath: string, mode: number): void {
  if (process.platform !== 'win32') {
    const stat = inspectSafePathComponents(filePath, 'private Kronos path');
    if (!stat || (!stat.isDirectory() && !stat.isFile())) {
      throw new Error(`Private Kronos path is unsafe: ${filePath}`);
    }
    fs.chmodSync(filePath, mode);
  }
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function cloneWorkSession<T extends WorkSessionRecord>(record: T): T {
  return JSON.parse(JSON.stringify(record)) as T;
}
