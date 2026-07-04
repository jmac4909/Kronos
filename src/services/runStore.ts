import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorCode, unknownErrorMessage } from './errorUtils';
import { effectiveRunStatus, isActiveRunStatus, isStaleActiveRun } from './runStatus';
import { readJsonFile } from './jsonFiles';

export const RUNS_DIR = path.join(KRONOS_DIR, 'runs');
export const ARCHIVED_RUNS_DIR = path.join(RUNS_DIR, 'archive');
const PROCESS_BACKED_ACTIVE_STATUSES = new Set(['preflight', 'running']);

export interface RunRecord {
  id: string;
  status?: string;
  logPath?: string;
  promptPath?: string;
  archivedAt?: string;
  endedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  failureReason?: string;
  failureKind?: string;
  recoveryActions?: Array<{ at: string; action: string; reason: string }>;
  events?: Array<{ type?: string; label?: string; detail?: string; timestamp?: string }>;
  archiveWarnings?: string[];
  [key: string]: unknown;
}

interface ArchivedRun {
  run: RunRecord;
  runPath: string;
  logPath?: string;
  promptPath?: string;
  warnings?: string[];
}

export interface RunStoreIssue {
  kind: 'invalid_run_record';
  scope: 'active' | 'archived';
  filePath: string;
  detail: string;
}

interface RunStoreRepairResult {
  repaired: number;
  runs: RunRecord[];
}

interface RunRecoveryMutation {
  status: string;
  defaultReason: string;
  action: string;
  label: string;
  setFailureReason?: boolean;
  failureKind?: string;
  fallbackFailureKind?: string;
  endedAt?: boolean;
  timestampField?: 'pausedAt' | 'resumedAt';
}

export function runRecordPath(runId: string): string {
  return path.join(RUNS_DIR, `${safeRunId(runId)}.json`);
}

export function archivedRunRecordPath(runId: string): string {
  return path.join(ARCHIVED_RUNS_DIR, `${safeRunId(runId)}.json`);
}

export function readRuns(limit = 100): RunRecord[] {
  return listRunRecordFiles(RUNS_DIR, limit)
    .map(filePath => readRunFile(filePath, 'active'))
    .filter((r): r is RunRecord => Boolean(r));
}

export function readArchivedRuns(limit = 100): RunRecord[] {
  return listRunRecordFiles(ARCHIVED_RUNS_DIR, limit)
    .map(filePath => readRunFile(filePath, 'archived'))
    .filter((r): r is RunRecord => Boolean(r));
}

export function listRunStoreIssues(limit = 100): RunStoreIssue[] {
  return [
    ...listRunRecordFiles(RUNS_DIR, limit).map(filePath => readRunFileIssue(filePath, 'active')).filter((i): i is RunStoreIssue => Boolean(i)),
    ...listRunRecordFiles(ARCHIVED_RUNS_DIR, limit).map(filePath => readRunFileIssue(filePath, 'archived')).filter((i): i is RunStoreIssue => Boolean(i)),
  ];
}

export function readRunRecord(runId: string): RunRecord | null {
  return readRunFile(runRecordPath(runId), 'active');
}

export function repairActiveRunRecords(limit = 100): RunStoreRepairResult {
  let repaired = 0;
  const runs: RunRecord[] = [];
  for (const filePath of listRunRecordFiles(RUNS_DIR, limit)) {
    const run = readRunFileResult(filePath, 'active').run;
    if (!run) { continue; }
    const normalized = normalizeTerminalActiveRun(run);
    runs.push(normalized);
    if (normalized !== run) {
      writeJsonAtomic(filePath, normalized);
      repaired += 1;
    }
  }
  return { repaired, runs };
}

export function writeRunRecord(run: RunRecord): void {
  writeJsonAtomic(runRecordPath(run.id), run);
}

export function markRunNeedsHuman(runId: string, reason: string, now = new Date()): RunRecord {
  return markRunRecovery(runId, reason, now, {
    status: 'needs_human',
    defaultReason: 'Marked needs-human by operator.',
    action: 'mark-needs-human',
    label: 'Marked needs human',
    setFailureReason: true,
    fallbackFailureKind: 'unknown',
    endedAt: true,
  });
}

export function markRunCancelled(runId: string, reason: string, now = new Date()): RunRecord {
  return markRunRecovery(runId, reason, now, {
    status: 'cancelled',
    defaultReason: 'Cancelled by operator.',
    action: 'cancel-run',
    label: 'Run cancelled',
    setFailureReason: true,
    failureKind: 'cancelled',
    endedAt: true,
  });
}

export function markRunPaused(runId: string, reason: string, now = new Date()): RunRecord {
  return markRunRecovery(runId, reason, now, {
    status: 'paused',
    defaultReason: 'Paused by operator.',
    action: 'pause-run',
    label: 'Run paused',
    timestampField: 'pausedAt',
  });
}

export function markRunContinued(runId: string, reason: string, now = new Date()): RunRecord {
  return markRunRecovery(runId, reason, now, {
    status: 'running',
    defaultReason: 'Continued by operator.',
    action: 'continue-run',
    label: 'Run continued',
    timestampField: 'resumedAt',
  });
}

function markRunRecovery(runId: string, reason: string, now: Date, mutation: RunRecoveryMutation): RunRecord {
  const run = readRequiredRunRecord(runId);
  const at = now.toISOString();
  const detail = reason.trim() || mutation.defaultReason;
  run.status = mutation.status;
  if (mutation.setFailureReason) {
    run.failureReason = detail;
  }
  if (mutation.failureKind) {
    run.failureKind = mutation.failureKind;
  } else if (mutation.fallbackFailureKind) {
    run.failureKind = run.failureKind || mutation.fallbackFailureKind;
  }
  if (mutation.endedAt) {
    run.endedAt = run.endedAt || at;
  }
  if (mutation.timestampField) {
    run[mutation.timestampField] = at;
  }
  run.recoveryActions = Array.isArray(run.recoveryActions) ? run.recoveryActions : [];
  run.recoveryActions.push({ at, action: mutation.action, reason: detail });
  run.events = Array.isArray(run.events) ? run.events : [];
  run.events.push({ type: 'recovery', label: mutation.label, detail, timestamp: at });
  writeRunRecord(run);
  return run;
}

export function writeRunPrompt(runId: string, prompt: string): string {
  ensureDir(RUNS_DIR);
  const promptPath = path.join(RUNS_DIR, `${safeRunId(runId)}.prompt.txt`);
  writeTextAtomic(promptPath, prompt);
  return promptPath;
}

export function appendRunLog(logPath: string, chunk: string): void {
  if (!isPathInside(logPath, RUNS_DIR) || isPathInside(logPath, ARCHIVED_RUNS_DIR)) {
    throw new Error(`Refusing to append run log outside active runs directory: ${logPath}`);
  }
  ensureDir(path.dirname(logPath));
  fs.appendFileSync(logPath, chunk);
}

export function archiveRun(runId: string): ArchivedRun {
  const currentPath = runRecordPath(runId);
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  ensureDir(ARCHIVED_RUNS_DIR);
  const run = readRequiredRunRecord(runId);
  run.archivedAt = new Date().toISOString();
  const warnings: string[] = [];

  const archivedPath = nextAvailablePath(archivedRunRecordPath(runId), warnings, 'run record');
  const logPath = moveRunArtifactIfExists(run.logPath, ARCHIVED_RUNS_DIR, warnings, 'logPath');
  const promptPath = moveRunArtifactIfExists(run.promptPath, ARCHIVED_RUNS_DIR, warnings, 'promptPath');
  if (logPath) { run.logPath = logPath; }
  if (promptPath) { run.promptPath = promptPath; }
  if (warnings.length > 0) { run.archiveWarnings = warnings; }
  writeJsonAtomic(archivedPath, run);
  fs.unlinkSync(currentPath);
  const archived: ArchivedRun = { run, runPath: archivedPath, warnings };
  if (logPath) { archived.logPath = logPath; }
  if (promptPath) { archived.promptPath = promptPath; }
  return archived;
}

function readRequiredRunRecord(runId: string): RunRecord {
  const currentPath = runRecordPath(runId);
  if (!fs.existsSync(currentPath)) {
    throw new Error(`Run not found: ${runId}`);
  }
  const result = readRunFileResult(currentPath, 'active');
  if (result.issue) {
    throw new Error(`Invalid run record ${currentPath}: ${result.issue.detail}`);
  }
  return normalizeRunView(result.run!);
}

function readRunFile(filePath: string, scope: RunStoreIssue['scope']): RunRecord | null {
  const run = readRunFileResult(filePath, scope).run;
  return run ? normalizeRunView(run) : null;
}

function readRunFileIssue(filePath: string, scope: RunStoreIssue['scope']): RunStoreIssue | null {
  return readRunFileResult(filePath, scope).issue || null;
}

function readRunFileResult(filePath: string, scope: RunStoreIssue['scope']): { run?: RunRecord; issue?: RunStoreIssue } {
  try {
    const parsed = readJsonFile(filePath);
    if (!isRecord(parsed)) {
      return { issue: invalidRunRecordIssue(scope, filePath, 'Run record must be a JSON object.') };
    }
    if (typeof parsed['id'] !== 'string' || parsed['id'].trim().length === 0) {
      return { issue: invalidRunRecordIssue(scope, filePath, 'Run record id must be a non-empty string.') };
    }
    const expectedFileName = `${safeRunId(parsed['id'])}.json`;
    if (scope === 'active' && path.basename(filePath) !== expectedFileName) {
      return { issue: invalidRunRecordIssue(scope, filePath, `Run record id ${parsed['id']} does not match file name ${path.basename(filePath)}.`) };
    }
    return { run: parsed as RunRecord };
  } catch (e: unknown) {
    return { issue: invalidRunRecordIssue(scope, filePath, unknownErrorMessage(e, 'Unable to parse JSON.')) };
  }
}

function normalizeTerminalActiveRun(run: RunRecord): RunRecord {
  const status = typeof run.status === 'string' ? run.status : '';
  const effectiveStatus = effectiveRunStatus(run);
  const activeStatusNeedsRepair = effectiveStatus === status && isActiveRunStatus(status);
  const logStatus = activeStatusNeedsRepair ? terminalRunOutcomeFromActiveLog(run) : undefined;
  const deadProcessStatus = activeStatusNeedsRepair && !logStatus
    ? terminalRunOutcomeFromDeadProcess(run, status)
    : undefined;
  const staleProcesslessStatus = activeStatusNeedsRepair && !logStatus
    ? terminalRunOutcomeFromStaleProcesslessRun(run, status)
    : undefined;
  const repairedStatus = logStatus || deadProcessStatus || staleProcesslessStatus;
  const nextStatus = repairedStatus || effectiveStatus;
  if (!status || !isActiveRunStatus(status) || !nextStatus || nextStatus === status) {
    return run;
  }
  const normalized: RunRecord = { ...run, status: nextStatus };
  if ((deadProcessStatus || staleProcesslessStatus) && !normalized.endedAt) {
    normalized.endedAt = new Date().toISOString();
  }
  if (staleProcesslessStatus && !normalized.failureReason) {
    normalized.failureReason = `Run record stayed ${status} past the stale active-run threshold without process metadata; inspect the run before retrying.`;
  } else if (nextStatus === 'needs_human' && !normalized.failureReason) {
    normalized.failureReason = `Run record had terminal metadata while persisted status was ${status}; inspect the run before retrying.`;
  }
  if (repairedStatus && !normalized.endedAt) {
    const endedAt = logModifiedAt(run.logPath);
    if (endedAt) { normalized.endedAt = endedAt; }
  }
  if (deadProcessStatus && !normalized.failureReason) {
    normalized.failureReason = `Run process ${run.processPid} is no longer running while persisted status was ${status}.`;
  } else if (repairedStatus === 'failed' && !normalized.failureReason) {
    normalized.failureReason = `Run log indicates the session exited unsuccessfully while persisted status was ${status}.`;
  } else if (repairedStatus === 'cancelled' && !normalized.failureReason) {
    normalized.failureReason = `Run log indicates the session was cancelled while persisted status was ${status}.`;
  }
  if ((nextStatus === 'failed' || nextStatus === 'cancelled') && !normalized.failureKind) {
    normalized.failureKind = nextStatus === 'cancelled' ? 'cancelled' : 'unknown';
  }
  if (deadProcessStatus) {
    const timestamp = normalized.endedAt || new Date().toISOString();
    normalized.events = Array.isArray(normalized.events) ? [...normalized.events] : [];
    normalized.events.push({
      type: 'error',
      label: 'Run process no longer exists',
      detail: `PID ${run.processPid} disappeared before Kronos recorded a terminal event.`,
      timestamp,
    });
  } else if (staleProcesslessStatus) {
    const timestamp = normalized.endedAt || new Date().toISOString();
    normalized.events = Array.isArray(normalized.events) ? [...normalized.events] : [];
    normalized.events.push({
      type: 'error',
      label: 'Stale active run needs human review',
      detail: 'No process metadata or terminal event was available before the stale active-run threshold.',
      timestamp,
    });
  }
  return normalized;
}

function terminalRunOutcomeFromDeadProcess(run: RunRecord, status: string): string | undefined {
  if (!PROCESS_BACKED_ACTIVE_STATUSES.has(status)) { return undefined; }
  const pid = numericPid(run.processPid);
  if (pid === undefined) { return undefined; }
  return processIsGone(pid) ? 'failed' : undefined;
}

function terminalRunOutcomeFromStaleProcesslessRun(run: RunRecord, status: string): string | undefined {
  if (!PROCESS_BACKED_ACTIVE_STATUSES.has(status)) { return undefined; }
  if (numericPid(run.processPid) !== undefined) { return undefined; }
  return isStaleActiveRun(run) ? 'needs_human' : undefined;
}

function terminalRunOutcomeFromActiveLog(run: RunRecord): string | undefined {
  const logPath = typeof run.logPath === 'string' ? run.logPath : '';
  if (!isReadableActiveRunLog(logPath)) { return undefined; }
  const tail = readLogTail(logPath);
  for (const line of tail.split(/\r?\n/).reverse()) {
    const trimmed = line.trim();
    const explicitOutcome = explicitLogTerminalLineOutcome(trimmed);
    if (explicitOutcome) { return explicitOutcome; }
    if (!trimmed.startsWith('{')) { continue; }
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed) && parsed['type'] === 'result') {
        const subtype = stringField(parsed['subtype']).toLowerCase();
        return parsed['is_error'] === true || subtype.includes('error') || subtype.includes('fail')
          ? 'failed'
          : 'completed';
      }
    } catch {
      // Ignore non-JSON log lines and keep scanning for the last terminal stream event.
    }
  }
  return undefined;
}

function explicitLogTerminalLineOutcome(line: string): string | undefined {
  if (/Session cancelled/i.test(line)) { return 'cancelled'; }
  const exited = /Session exited with code\s+(\d+)/i.exec(line);
  if (exited) {
    return Number(exited[1]) === 0 ? 'completed' : 'failed';
  }
  return /Session complete/i.test(line) ? 'completed' : undefined;
}

function isReadableActiveRunLog(logPath: string): boolean {
  if (!logPath || !isPathInside(logPath, RUNS_DIR) || isPathInside(logPath, ARCHIVED_RUNS_DIR)) {
    return false;
  }
  try {
    return fs.statSync(logPath).isFile();
  } catch {
    return false;
  }
}

function readLogTail(logPath: string, maxBytes = 64 * 1024): string {
  const stat = fs.statSync(logPath);
  const start = Math.max(0, stat.size - maxBytes);
  const fd = fs.openSync(logPath, 'r');
  try {
    const buffer = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return buffer.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function logModifiedAt(logPath: unknown): string | undefined {
  if (typeof logPath !== 'string' || !isReadableActiveRunLog(logPath)) { return undefined; }
  return fs.statSync(logPath).mtime.toISOString();
}

function numericPid(value: unknown): number | undefined {
  const pid = typeof value === 'string' || typeof value === 'number' ? Number(value) : Number.NaN;
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function processIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (e: unknown) {
    return unknownErrorCode(e) === 'ESRCH';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function normalizeRunView(run: RunRecord): RunRecord {
  return normalizeTerminalActiveRun(run);
}

function invalidRunRecordIssue(scope: RunStoreIssue['scope'], filePath: string, detail: string): RunStoreIssue {
  return { kind: 'invalid_run_record', scope, filePath, detail };
}

function listRunRecordFiles(dir: string, limit: number): string[] {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(fileName => {
      const filePath = path.join(dir, fileName);
      return { fileName, filePath, modifiedMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((a, b) => b.modifiedMs - a.modifiedMs || b.fileName.localeCompare(a.fileName))
    .slice(0, limit)
    .map(file => file.filePath);
}

function moveRunArtifactIfExists(filePath: string | undefined, destDir: string, warnings: string[], label: string): string | undefined {
  if (!filePath || !fs.existsSync(filePath)) { return undefined; }
  if (!isPathInside(filePath, RUNS_DIR) || isPathInside(filePath, ARCHIVED_RUNS_DIR)) {
    warnings.push(`Skipped ${label} outside active runs directory: ${filePath}`);
    return undefined;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    warnings.push(`Skipped ${label} because it is not a file: ${filePath}`);
    return undefined;
  }
  ensureDir(destDir);
  const target = nextAvailablePath(path.join(destDir, path.basename(filePath)), warnings, label);
  fs.renameSync(filePath, target);
  return target;
}

function nextAvailablePath(filePath: string, warnings: string[], label: string): string {
  if (!fs.existsSync(filePath)) {
    return filePath;
  }
  const parsed = path.parse(filePath);
  for (let index = 1; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) {
      warnings.push(`Archived ${label} as ${candidate} because ${filePath} already exists.`);
      return candidate;
    }
  }
  const fallback = path.join(parsed.dir, `${parsed.name}-${Date.now()}-${process.pid}${parsed.ext}`);
  warnings.push(`Archived ${label} as ${fallback} because ${filePath} already exists.`);
  return fallback;
}

function isPathInside(filePath: string, parentDir: string): boolean {
  const resolvedFile = path.resolve(filePath);
  const resolvedParent = path.resolve(parentDir);
  const relative = path.relative(resolvedParent, resolvedFile);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

function writeTextAtomic(filePath: string, text: string): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function safeRunId(runId: string): string {
  return safeFileStem(runId, { fallback: 'run' });
}
