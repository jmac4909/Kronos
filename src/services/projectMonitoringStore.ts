import * as crypto from 'crypto';
import * as path from 'path';
import {
  ensurePrivateDirectoryPath,
  readPrivateTextFileIfPresent,
  writePrivateTextFileAtomically,
} from './privateFilePrimitives';
import { KRONOS_DIR } from './stateStore';
import {
  nextWorkSessionMonitoring,
  nextWorkSessionProviderBindings,
  normalizeWorkSessionRecord,
  workSessionDirectory,
  type AddWorkSessionProviderBindingInput,
  type RecordWorkSessionMonitoringResultInput,
  type StandaloneWorkSessionRecord,
  type WorkSessionProviderBinding,
  type WorkSessionStoreOptions,
} from './workSessionStore';

export interface RegisteredProjectMonitoringInput {
  name: string;
  path: string;
  displayName?: string;
  seedBindings?: readonly WorkSessionProviderBinding[];
}

const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const MAX_RECORD_BYTES = 512 * 1024;
const PROJECT_MONITOR_PREFIX = 'project-monitor-';

/** Stable private owner for provider state that never appears as a terminal Session. */
export function projectMonitoringRecordId(projectName: string): string {
  const normalized = projectName.trim();
  if (!normalized) { throw new Error('Project monitoring requires a project name.'); }
  const digest = crypto.createHash('sha256').update(normalized).digest('hex');
  return `${PROJECT_MONITOR_PREFIX}${digest.slice(0, 48)}`;
}

export function projectMonitoringRecordPath(
  projectNameOrId: string,
  options: WorkSessionStoreOptions = {},
): string {
  const id = projectNameOrId.startsWith(PROJECT_MONITOR_PREFIX)
    ? projectNameOrId
    : projectMonitoringRecordId(projectNameOrId);
  return path.join(workSessionDirectory(id, options), 'project-monitor.json');
}

export function readProjectMonitoringRecord(
  projectName: string,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord | null {
  return readProjectMonitoringRecordById(projectMonitoringRecordId(projectName), options);
}

export function readProjectMonitoringRecordById(
  recordId: string,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord | null {
  if (!recordId.startsWith(PROJECT_MONITOR_PREFIX)) { return null; }
  const serialized = readPrivateTextFileIfPresent(projectMonitoringRecordPath(recordId, options), {
    label: 'Project monitoring record',
    maxBytes: MAX_RECORD_BYTES,
    expectedMode: FILE_MODE,
  });
  if (serialized === null) { return null; }
  const record = normalizeWorkSessionRecord(JSON.parse(serialized) as unknown, options);
  if (record.kind !== 'standalone'
    || record.id !== recordId
    || !record.projectName
    || !record.projectPath
    || !isProjectMonitoringRecord(record)) {
    throw new Error('Project monitoring record has an invalid owner identity.');
  }
  return cloneProjectMonitoringRecord(record);
}

/** Creates or refreshes one registered project's always-on polling owner. */
export function ensureProjectMonitoringRecord(
  input: RegisteredProjectMonitoringInput,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord {
  const id = projectMonitoringRecordId(input.name);
  const at = nowIso(options.now);
  const existing = readProjectMonitoringRecordById(id, options);
  let record: StandaloneWorkSessionRecord = existing || {
    schemaVersion: 1,
    id,
    kind: 'standalone',
    title: `${input.displayName || input.name} provider monitoring`,
    ticketKeys: [],
    status: 'active',
    createdAt: at,
    updatedAt: at,
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
    projectName: input.name,
    projectPath: input.path,
  };
  let changed = !existing;
  const title = `${input.displayName || input.name} provider monitoring`;
  if (record.title !== title) { record.title = title; changed = true; }
  if (record.projectName !== input.name) { record.projectName = input.name; changed = true; }
  if (record.projectPath !== input.path) { record.projectPath = input.path; changed = true; }
  if (!record.monitoring.enabled || record.status !== 'active') {
    record.monitoring.enabled = true;
    record.status = 'active';
    delete record.closedAt;
    changed = true;
  }
  if (input.seedBindings) {
    for (const binding of input.seedBindings) {
      const current = record.providerBindings.find(candidate =>
        candidate.provider === binding.provider
          && candidate.resource === binding.resource
          && candidate.subjectId === binding.subjectId
      );
      if (current && current.attachedAt > binding.attachedAt) { continue; }
      const next = nextWorkSessionProviderBindings(record.providerBindings, binding, binding.attachedAt);
      if (JSON.stringify(next) !== JSON.stringify(record.providerBindings)) {
        record.providerBindings = next;
        changed = true;
      }
    }
  }
  if (changed) {
    record.updatedAt = at;
    writeProjectMonitoringRecord(record, options);
  }
  return cloneProjectMonitoringRecord(record);
}

export function addProjectMonitoringProviderBinding(
  recordId: string,
  input: AddWorkSessionProviderBindingInput,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord {
  return mutateProjectMonitoringRecord(recordId, options, (record, at) => {
    record.providerBindings = nextWorkSessionProviderBindings(record.providerBindings, input, at);
  });
}

export function recordProjectMonitoringResult(
  recordId: string,
  input: RecordWorkSessionMonitoringResultInput,
  options: WorkSessionStoreOptions = {},
): StandaloneWorkSessionRecord {
  return mutateProjectMonitoringRecord(recordId, options, (record, at) => {
    record.monitoring = nextWorkSessionMonitoring(record.monitoring, input, at);
  });
}

export function isProjectMonitoringRecord(record: { id: string; projectName?: string }): boolean {
  return record.id === (record.projectName ? projectMonitoringRecordId(record.projectName) : '');
}

function mutateProjectMonitoringRecord(
  recordId: string,
  options: WorkSessionStoreOptions,
  mutation: (record: StandaloneWorkSessionRecord, at: string) => void,
): StandaloneWorkSessionRecord {
  const record = readProjectMonitoringRecordById(recordId, options);
  if (!record) { throw new Error(`Project monitoring record not found: ${recordId}`); }
  const at = nowIso(options.now);
  mutation(record, at);
  record.updatedAt = at;
  writeProjectMonitoringRecord(record, options);
  return cloneProjectMonitoringRecord(record);
}

function writeProjectMonitoringRecord(
  record: StandaloneWorkSessionRecord,
  options: WorkSessionStoreOptions,
): void {
  const normalized = normalizeWorkSessionRecord(record, options);
  if (normalized.kind !== 'standalone' || !isProjectMonitoringRecord(normalized)) {
    throw new Error('Project monitoring record identity is invalid.');
  }
  const filePath = projectMonitoringRecordPath(normalized.id, options);
  ensurePrivateDirectoryPath(path.resolve(options.kronosDir || KRONOS_DIR), 'Kronos data directory', DIRECTORY_MODE);
  ensurePrivateDirectoryPath(path.dirname(filePath), 'Project monitoring directory', DIRECTORY_MODE);
  writePrivateTextFileAtomically(filePath, `${JSON.stringify(normalized, null, 2)}\n`, {
    label: 'Project monitoring record',
    maxBytes: MAX_RECORD_BYTES,
    expectedMode: FILE_MODE,
    temporaryPrefix: 'project-monitor',
    fileMode: FILE_MODE,
  });
}

function cloneProjectMonitoringRecord(record: StandaloneWorkSessionRecord): StandaloneWorkSessionRecord {
  return {
    ...record,
    ticketKeys: [...record.ticketKeys],
    terminals: record.terminals.map(binding => ({ ...binding })),
    providerBindings: record.providerBindings.map(binding => ({ ...binding })),
    artifacts: record.artifacts.map(artifact => ({
      ...artifact,
      warnings: [...artifact.warnings],
    })),
    monitoring: { ...record.monitoring },
  };
}

function nowIso(value: Date | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) { throw new Error('Project monitoring timestamp is invalid.'); }
  return date.toISOString();
}
