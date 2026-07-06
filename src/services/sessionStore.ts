import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { KRONOS_DIR } from './stateStore';
import { unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';
import { finiteNumberFromUnknown, isRecord, optionalTrimmedStringFromUnknown, recordsFromUnknown } from './records';
import { toValidDate } from './dateValues';

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

interface SavedSessionEvent {
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

interface AggregateSessionStats extends SessionStats {
  id: string;
  project: string;
  skill: string;
  ticket: string;
  startedAt: string;
}

interface AggregateStats {
  sessions: AggregateSessionStats[];
  lastUpdated?: string;
  [key: string]: unknown;
}

interface SessionStoreIssue {
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
    stats.sessions = stats.sessions.filter(existing => existing.id !== aggregateSession.id);
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
    const parsed = readJsonFile(filePath);
    if (!isRecord(parsed)) {
      return { issue: invalidSessionIssue('invalid_saved_session', filePath, 'Saved session must be a JSON object.') };
    }
    for (const key of ['id', 'project', 'skill', 'ticket', 'startedAt']) {
      if (typeof parsed[key] !== 'string') {
        return { issue: invalidSessionIssue('invalid_saved_session', filePath, `Saved session ${key} must be a string.`) };
      }
    }
    if (!Array.isArray(parsed['events'])) {
      return { issue: invalidSessionIssue('invalid_saved_session', filePath, 'Saved session events must be an array.') };
    }
    return {
      session: {
        ...parsed,
        id: optionalTrimmedStringFromUnknown(parsed['id']) ?? 'unknown',
        project: optionalTrimmedStringFromUnknown(parsed['project']) ?? 'unknown',
        skill: optionalTrimmedStringFromUnknown(parsed['skill']) ?? 'unknown',
        ticket: optionalTrimmedStringFromUnknown(parsed['ticket']) ?? '',
        startedAt: optionalTrimmedStringFromUnknown(parsed['startedAt']) ?? '',
        events: normalizeSavedSessionEvents(parsed['events']),
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
    const stats = readJsonFile(STATS_FILE);
    if (!isRecord(stats)) {
      return { issue: invalidSessionIssue('invalid_session_stats', STATS_FILE, 'stats.json must be a JSON object.') };
    }
    if (stats['sessions'] !== undefined && !Array.isArray(stats['sessions'])) {
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

function normalizeAggregateSessions(value: unknown): AggregateSessionStats[] {
  return recordsFromUnknown(value)
    .map(normalizeAggregateSession)
    .filter((session): session is AggregateSessionStats => Boolean(session));
}

function normalizeSavedSessionEvents(value: unknown): SavedSessionEvent[] {
  return recordsFromUnknown(value)
    .map(normalizeSavedSessionEvent)
    .filter((event): event is SavedSessionEvent => Boolean(event));
}

function normalizeSavedSessionEvent(value: unknown): SavedSessionEvent | null {
  if (!isRecord(value)) { return null; }
  return {
    type: optionalTrimmedStringFromUnknown(value['type']) ?? 'unknown',
    label: optionalTrimmedStringFromUnknown(value['label']) ?? '',
    detail: optionalTrimmedStringFromUnknown(value['detail']) ?? '',
    timestamp: optionalTrimmedStringFromUnknown(value['timestamp']) ?? '',
  };
}

function normalizeAggregateSession(value: unknown): AggregateSessionStats | null {
  if (!isRecord(value)) { return null; }
  return {
    id: optionalTrimmedStringFromUnknown(value['id']) ?? 'unknown',
    project: optionalTrimmedStringFromUnknown(value['project']) ?? 'unknown',
    skill: optionalTrimmedStringFromUnknown(value['skill']) ?? 'unknown',
    ticket: optionalTrimmedStringFromUnknown(value['ticket']) ?? '',
    startedAt: optionalTrimmedStringFromUnknown(value['startedAt']) ?? '',
    toolCalls: finiteNumberFromUnknown(value['toolCalls']),
    toolErrors: finiteNumberFromUnknown(value['toolErrors']),
    thinkingCount: finiteNumberFromUnknown(value['thinkingCount']),
    filesRead: finiteNumberFromUnknown(value['filesRead']),
    filesEdited: finiteNumberFromUnknown(value['filesEdited']),
    durationSec: finiteNumberFromUnknown(value['durationSec']),
    verdict: optionalTrimmedStringFromUnknown(value['verdict']) ?? 'unknown',
  };
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
  const aSafe = toValidDate(a.startedAt)?.getTime() || 0;
  const bSafe = toValidDate(b.startedAt)?.getTime() || 0;
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
