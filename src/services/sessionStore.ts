import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';

const SESSIONS_DIR = path.join(KRONOS_DIR, 'sessions');
const STATS_FILE = path.join(KRONOS_DIR, 'stats.json');

export interface SessionStats {
  toolCalls: number;
  toolErrors: number;
  thinkingCount: number;
  filesRead: number;
  filesEdited: number;
  durationSec: number;
  verdict: string;
}

export interface SavedSessionEvent {
  type: string;
  label: string;
  detail: string;
  timestamp: string;
}

export interface SavedSession {
  id: string;
  project: string;
  skill: string;
  ticket: string;
  startedAt: string;
  events: SavedSessionEvent[];
  stats?: SessionStats;
}

export interface AggregateSessionStats extends SessionStats {
  id: string;
  project: string;
  skill: string;
  ticket: string;
  startedAt: string;
}

export interface AggregateStats {
  sessions: AggregateSessionStats[];
  lastUpdated?: string;
  [key: string]: unknown;
}

export interface SessionStoreIssue {
  kind: 'invalid_saved_session' | 'invalid_session_stats';
  filePath: string;
  detail: string;
}

export function safeSessionId(sessionId: string): string {
  return safeFileStem(sessionId, { fallback: `session-${Date.now().toString(36)}`, maxLength: 180 });
}

export function writeSavedSession(session: SavedSession): void {
  ensureDir(SESSIONS_DIR);
  writeJsonAtomic(path.join(SESSIONS_DIR, `${safeSessionId(session.id)}.json`), session);
  saveAggregateStats(session);
  pruneSavedSessions(20);
}

export function listSavedSessions(): SavedSession[] {
  if (!fs.existsSync(SESSIONS_DIR)) { return []; }
  return listSessionJsonFiles('desc')
    .map(filePath => readSavedSessionFile(filePath))
    .filter((session): session is SavedSession => Boolean(session))
    .sort(compareSessionsNewestFirst);
}

export function listSessionStoreIssues(limit = 100): SessionStoreIssue[] {
  const issues: SessionStoreIssue[] = [];
  if (fs.existsSync(SESSIONS_DIR)) {
    const files = listSessionJsonFiles('desc').slice(0, limit);
    for (const filePath of files) {
      const issue = readSavedSessionFileIssue(filePath);
      if (issue) { issues.push(issue); }
    }
  }
  const statsIssue = readAggregateStatsIssue();
  if (statsIssue) { issues.push(statsIssue); }
  return issues;
}

export function getAggregateStats(): AggregateStats {
  return readAggregateStatsFile() || { sessions: [] };
}

function pruneSavedSessions(limit: number): void {
  const files = listSessionJsonFiles('asc');
  while (files.length > limit) {
    fs.unlinkSync(files.shift()!);
  }
}

function saveAggregateStats(session: SavedSession): void {
  const stats = readAggregateStatsFile() || { sessions: [] };
  const aggregateSession = normalizeAggregateSession({
    id: session.id,
    project: session.project,
    skill: session.skill,
    ticket: session.ticket,
    startedAt: session.startedAt,
    ...session.stats,
  });
  if (aggregateSession) {
    stats.sessions.push(aggregateSession);
  }
  if (stats.sessions.length > 100) { stats.sessions = stats.sessions.slice(-100); }
  stats.lastUpdated = new Date().toISOString();
  writeJsonAtomic(STATS_FILE, stats);
}

function readSavedSessionFile(filePath: string): SavedSession | null {
  return readSavedSessionFileResult(filePath).session || null;
}

function readSavedSessionFileIssue(filePath: string): SessionStoreIssue | null {
  return readSavedSessionFileResult(filePath).issue || null;
}

function readSavedSessionFileResult(filePath: string): { session?: SavedSession; issue?: SessionStoreIssue } {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { issue: invalidSessionIssue('invalid_saved_session', filePath, 'Saved session must be a JSON object.') };
    }
    for (const key of ['id', 'project', 'skill', 'ticket', 'startedAt']) {
      if (typeof parsed[key] !== 'string') {
        return { issue: invalidSessionIssue('invalid_saved_session', filePath, `Saved session ${key} must be a string.`) };
      }
    }
    if (!Array.isArray(parsed.events)) {
      return { issue: invalidSessionIssue('invalid_saved_session', filePath, 'Saved session events must be an array.') };
    }
    return {
      session: {
        ...parsed,
        id: stringOrDefault(parsed.id, 'unknown'),
        project: stringOrDefault(parsed.project, 'unknown'),
        skill: stringOrDefault(parsed.skill, 'unknown'),
        ticket: stringOrDefault(parsed.ticket, ''),
        startedAt: stringOrDefault(parsed.startedAt, ''),
        events: normalizeSavedSessionEvents(parsed.events),
      } as SavedSession,
    };
  } catch (e: unknown) {
    return { issue: invalidSessionIssue('invalid_saved_session', filePath, unknownErrorMessage(e, 'Unable to parse saved session JSON.')) };
  }
}

function readAggregateStatsFile(): AggregateStats | null {
  return readAggregateStatsResult().stats || null;
}

function readAggregateStatsIssue(): SessionStoreIssue | null {
  return readAggregateStatsResult().issue || null;
}

function readAggregateStatsResult(): { stats?: AggregateStats; issue?: SessionStoreIssue } {
  if (!fs.existsSync(STATS_FILE)) { return { stats: { sessions: [] } }; }
  try {
    const stats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      return { issue: invalidSessionIssue('invalid_session_stats', STATS_FILE, 'stats.json must be a JSON object.') };
    }
    if (stats.sessions !== undefined && !Array.isArray(stats.sessions)) {
      return { issue: invalidSessionIssue('invalid_session_stats', STATS_FILE, 'stats.sessions must be an array.') };
    }
    const { sessions, lastUpdated, ...rest } = stats;
    return {
      stats: {
        ...rest,
        sessions: normalizeAggregateSessions(sessions),
        ...(typeof lastUpdated === 'string' ? { lastUpdated } : {}),
      },
    };
  } catch (e: unknown) {
    return { issue: invalidSessionIssue('invalid_session_stats', STATS_FILE, unknownErrorMessage(e, 'Unable to parse stats.json.')) };
  }
}

export function normalizeAggregateSessions(value: unknown): AggregateSessionStats[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .map(normalizeAggregateSession)
    .filter((session): session is AggregateSessionStats => Boolean(session));
}

export function normalizeSavedSessionEvents(value: unknown): SavedSessionEvent[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .map(normalizeSavedSessionEvent)
    .filter((event): event is SavedSessionEvent => Boolean(event));
}

function normalizeSavedSessionEvent(value: unknown): SavedSessionEvent | null {
  if (!isRecord(value)) { return null; }
  return {
    type: stringOrDefault(value.type, 'unknown'),
    label: stringOrDefault(value.label, ''),
    detail: stringOrDefault(value.detail, ''),
    timestamp: stringOrDefault(value.timestamp, ''),
  };
}

function normalizeAggregateSession(value: unknown): AggregateSessionStats | null {
  if (!isRecord(value)) { return null; }
  return {
    id: stringOrDefault(value.id, 'unknown'),
    project: stringOrDefault(value.project, 'unknown'),
    skill: stringOrDefault(value.skill, 'unknown'),
    ticket: stringOrDefault(value.ticket, ''),
    startedAt: stringOrDefault(value.startedAt, ''),
    toolCalls: finiteNumber(value.toolCalls),
    toolErrors: finiteNumber(value.toolErrors),
    thinkingCount: finiteNumber(value.thinkingCount),
    filesRead: finiteNumber(value.filesRead),
    filesEdited: finiteNumber(value.filesEdited),
    durationSec: finiteNumber(value.durationSec),
    verdict: stringOrDefault(value.verdict, 'unknown'),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringOrDefault(value: unknown, fallback: string): string {
  if (typeof value !== 'string') { return fallback; }
  const trimmed = value.trim();
  return trimmed || fallback;
}

function finiteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function invalidSessionIssue(kind: SessionStoreIssue['kind'], filePath: string, detail: string): SessionStoreIssue {
  return { kind, filePath, detail };
}

function listSessionJsonFiles(order: 'asc' | 'desc'): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) { return []; }
  return fs.readdirSync(SESSIONS_DIR)
    .filter(file => file.endsWith('.json'))
    .map(file => path.join(SESSIONS_DIR, file))
    .map(filePath => {
      try {
        const stat = fs.statSync(filePath);
        return stat.isFile() ? { filePath, mtimeMs: stat.mtimeMs } : null;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is { filePath: string; mtimeMs: number } => Boolean(entry))
    .sort((a, b) => order === 'asc'
      ? a.mtimeMs - b.mtimeMs || a.filePath.localeCompare(b.filePath)
      : b.mtimeMs - a.mtimeMs || b.filePath.localeCompare(a.filePath))
    .map(entry => entry.filePath);
}

function compareSessionsNewestFirst(a: SavedSession, b: SavedSession): number {
  const aTime = Date.parse(a.startedAt);
  const bTime = Date.parse(b.startedAt);
  const aSafe = Number.isFinite(aTime) ? aTime : 0;
  const bSafe = Number.isFinite(bTime) ? bTime : 0;
  return bSafe - aSafe || b.id.localeCompare(a.id);
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
