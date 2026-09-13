import * as fs from 'fs';
import * as crypto from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { isRecord } from './records';
import {
  assertSafeDirectoryPath,
  ensurePrivateDirectoryPath,
  readPrivateTextFileIfPresent,
  writePrivateTextFileAtomically,
} from './privateFilePrimitives';
import { KRONOS_DIR } from './stateStore';
import { normalizeClaudeSessionId } from './managedClaudeTerminalIdentity';

export const CLAUDE_SESSION_TRACKING_MARKER = '--kronos-session-tracking-v1';
export const CLAUDE_SESSION_TRACKING_INTERVAL_MS = 2_000;

const SETTINGS_MAX_BYTES = 512 * 1024;
const EVENT_MAX_BYTES = 16 * 1024;
const HELPER_MAX_BYTES = 32 * 1024;
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
const SESSION_START_MATCHER = 'resume|clear';
const SESSION_START_SOURCES = new Set(['resume', 'clear']);
const HELPER_FILE_NAME = 'claude-session-tracker.cjs';
const TRACKING_DIRECTORY_NAME = 'claude-session-tracking';
const EVENT_DIRECTORY_NAME = 'events';

export type ClaudeSessionTrackingState = 'ready' | 'missing' | 'repair' | 'blocked';

export interface ClaudeSessionTrackingStatus {
  state: ClaudeSessionTrackingState;
  detail: string;
  actionLabel: string;
}

export interface ClaudeSessionTrackingEvent {
  schemaVersion: 1;
  workSessionId: string;
  terminalBindingId: string;
  launchClaudeSessionId: string;
  claudeSessionId: string;
  cwd: string;
  source: string;
  observedAt: string;
}

export interface ClaudeSessionTrackingInstallResult {
  status: ClaudeSessionTrackingStatus;
  settingsPath: string;
  helperPath: string;
  backupPath?: string;
}

export interface ClaudeSessionTrackingOptions {
  kronosDir?: string;
  claudeSettingsPath?: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  nodeExecutable?: string;
  now?: Date;
}

interface TrackingPaths {
  settingsPath: string;
  trackingDirectory: string;
  eventDirectory: string;
  helperPath: string;
}

/** Read-only setup check. It never creates files or changes Claude settings. */
export function claudeSessionTrackingStatus(
  options: ClaudeSessionTrackingOptions = {},
): ClaudeSessionTrackingStatus {
  let nodeExecutable: string;
  try {
    nodeExecutable = resolveNodeExecutable(options);
  } catch {
    return {
      state: 'blocked',
      detail: 'Automatic Claude Session tracking needs a Node.js executable on the extension host PATH.',
      actionLabel: 'Review Tracking',
    };
  }

  const paths = trackingPaths(options);
  let settingsText: string | null;
  try {
    settingsText = readPrivateTextFileIfPresent(paths.settingsPath, {
      label: 'Claude settings',
      maxBytes: SETTINGS_MAX_BYTES,
    });
  } catch {
    return {
      state: 'blocked',
      detail: 'Claude settings could not be checked safely. Kronos will not replace or follow an unsafe settings file.',
      actionLabel: 'Review Tracking',
    };
  }
  if (settingsText === null) {
    return {
      state: 'missing',
      detail: 'Optional tracking is not enabled. Enable it to keep the saved Claude conversation and resume folder current after /resume, /clear, or a manual claude --resume.',
      actionLabel: 'Enable Tracking',
    };
  }

  let settings: unknown;
  try {
    settings = JSON.parse(settingsText) as unknown;
  } catch {
    return {
      state: 'blocked',
      detail: 'Claude settings are not valid JSON. Kronos will not overwrite them; repair the file before enabling Session tracking.',
      actionLabel: 'Review Tracking',
    };
  }
  if (!isRecord(settings)) {
    return {
      state: 'blocked',
      detail: 'Claude settings must contain one JSON object before Kronos can add Session tracking.',
      actionLabel: 'Review Tracking',
    };
  }

  let expectedCommand: string;
  try {
    expectedCommand = trackingHookCommand(nodeExecutable, paths.helperPath, options.platform);
  } catch {
    return {
      state: 'blocked',
      detail: 'The local Node.js or Kronos data path cannot be represented safely in a Claude command hook.',
      actionLabel: 'Review Tracking',
    };
  }
  const hookState = inspectTrackingHook(settings, expectedCommand);
  if (hookState === 'invalid') {
    return {
      state: 'blocked',
      detail: 'Claude SessionStart hooks have an unsupported shape. Kronos will not rewrite that configuration automatically.',
      actionLabel: 'Review Tracking',
    };
  }
  if (hookState === 'missing') {
    return {
      state: 'missing',
      detail: 'Optional tracking is not enabled. Enable it to keep the saved Claude conversation and resume folder current after /resume, /clear, or a manual claude --resume.',
      actionLabel: 'Enable Tracking',
    };
  }
  if (hookState === 'repair') {
    return {
      state: 'repair',
      detail: 'The Kronos Claude SessionStart hook is present but no longer matches the current local helper or Node.js path.',
      actionLabel: 'Repair Tracking',
    };
  }

  try {
    const helper = readPrivateTextFileIfPresent(paths.helperPath, {
      label: 'Kronos Claude Session tracking helper',
      maxBytes: HELPER_MAX_BYTES,
      expectedMode: 0o600,
    });
    if (helper !== trackingHelperSource()) {
      return {
        state: 'repair',
        detail: 'The Kronos Claude Session tracking helper is missing or outdated.',
        actionLabel: 'Repair Tracking',
      };
    }
  } catch {
    return {
      state: 'repair',
      detail: 'The Kronos Claude Session tracking helper could not be verified safely.',
      actionLabel: 'Repair Tracking',
    };
  }

  return {
    state: 'ready',
    detail: 'Claude lifecycle tracking is enabled. Kronos updates only the Session conversation UUID and saved resume folder; terminal content is never read.',
    actionLabel: 'Tracking Enabled',
  };
}

/** Installs or repairs the one identifiable Kronos SessionStart hook after operator confirmation. */
export function installClaudeSessionTracking(
  options: ClaudeSessionTrackingOptions = {},
): ClaudeSessionTrackingInstallResult {
  const nodeExecutable = resolveNodeExecutable(options);
  const paths = trackingPaths(options);
  const settingsDirectory = path.dirname(paths.settingsPath);
  ensureDirectoryForPrivateFile(settingsDirectory, 'Claude settings');

  const settingsText = readPrivateTextFileIfPresent(paths.settingsPath, {
    label: 'Claude settings',
    maxBytes: SETTINGS_MAX_BYTES,
  });
  const settings = settingsText === null ? {} : parseSettingsObject(settingsText);
  const expectedCommand = trackingHookCommand(nodeExecutable, paths.helperPath, options.platform);
  const merged = mergeTrackingHook(settings, expectedCommand);

  ensurePrivateDirectoryPath(paths.trackingDirectory, 'Kronos Claude Session tracking');
  ensurePrivateDirectoryPath(paths.eventDirectory, 'Kronos Claude Session tracking events');
  writePrivateTextFileAtomically(paths.helperPath, trackingHelperSource(), {
    label: 'Kronos Claude Session tracking helper',
    maxBytes: HELPER_MAX_BYTES,
    temporaryPrefix: 'claude-session-tracker',
    fileMode: 0o600,
  });

  let backupPath: string | undefined;
  if (settingsText !== null) {
    const timestamp = installTimestamp(options.now).replace(/[:.]/g, '-');
    backupPath = `${paths.settingsPath}.kronos-backup-${timestamp}-${crypto.randomUUID()}`;
    writePrivateTextFileAtomically(backupPath, settingsText, {
      label: 'Claude settings backup',
      maxBytes: SETTINGS_MAX_BYTES,
      temporaryPrefix: 'claude-settings-backup',
      fileMode: 0o600,
    });
  }
  writePrivateTextFileAtomically(paths.settingsPath, `${JSON.stringify(merged, null, 2)}\n`, {
    label: 'Claude settings',
    maxBytes: SETTINGS_MAX_BYTES,
    temporaryPrefix: 'claude-settings',
    fileMode: 0o600,
  });

  const status = claudeSessionTrackingStatus({ ...options, nodeExecutable });
  if (status.state !== 'ready') {
    throw new Error('Claude Session tracking could not be verified after installation.');
  }
  return {
    status,
    settingsPath: paths.settingsPath,
    helperPath: paths.helperPath,
    ...(backupPath ? { backupPath } : {}),
  };
}

export function readClaudeSessionTrackingEvent(
  workSessionIdValue: unknown,
  terminalBindingIdValue: unknown,
  options: ClaudeSessionTrackingOptions = {},
): ClaudeSessionTrackingEvent | null {
  const workSessionId = normalizeEntityId(workSessionIdValue, 'work session id');
  const terminalBindingId = normalizeEntityId(terminalBindingIdValue, 'terminal binding id');
  const filePath = path.join(
    trackingPaths(options).eventDirectory,
    trackingEventFileName(workSessionId, terminalBindingId),
  );
  const text = readPrivateTextFileIfPresent(filePath, {
    label: 'Kronos Claude Session tracking event',
    maxBytes: EVENT_MAX_BYTES,
    expectedMode: 0o600,
  });
  if (text === null) { return null; }
  const event = normalizeTrackingEvent(JSON.parse(text) as unknown);
  if (event.workSessionId !== workSessionId || event.terminalBindingId !== terminalBindingId) {
    throw new Error('Claude Session tracking event identity does not match its file name.');
  }
  return event;
}

export function trackingEventFileName(workSessionId: string, terminalBindingId: string): string {
  return `${normalizeEntityId(workSessionId, 'work session id')}--${normalizeEntityId(terminalBindingId, 'terminal binding id')}.json`;
}

function trackingPaths(options: ClaudeSessionTrackingOptions): TrackingPaths {
  const kronosDir = path.resolve(options.kronosDir || KRONOS_DIR);
  const trackingDirectory = path.join(kronosDir, TRACKING_DIRECTORY_NAME);
  return {
    settingsPath: path.resolve(options.claudeSettingsPath || path.join(os.homedir(), '.claude', 'settings.json')),
    trackingDirectory,
    eventDirectory: path.join(trackingDirectory, EVENT_DIRECTORY_NAME),
    helperPath: path.join(trackingDirectory, HELPER_FILE_NAME),
  };
}

function ensureDirectoryForPrivateFile(directoryPath: string, label: string): void {
  try {
    assertSafeDirectoryPath(directoryPath, label);
  } catch {
    if (fs.existsSync(directoryPath)) { throw new Error(`${label} directory is unsafe.`); }
    ensurePrivateDirectoryPath(directoryPath, label);
  }
}

function parseSettingsObject(text: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Claude settings are not valid JSON; Kronos did not change them.');
  }
  if (!isRecord(parsed)) {
    throw new Error('Claude settings must contain one JSON object; Kronos did not change them.');
  }
  return parsed;
}

function inspectTrackingHook(
  settings: Record<string, unknown>,
  expectedCommand: string,
): 'ready' | 'missing' | 'repair' | 'invalid' {
  const hooks = settings['hooks'];
  if (hooks === undefined) { return 'missing'; }
  if (!isRecord(hooks)) { return 'invalid'; }
  const sessionStart = hooks['SessionStart'];
  if (sessionStart === undefined) { return 'missing'; }
  if (!Array.isArray(sessionStart)) { return 'invalid'; }
  let matches = 0;
  let exact = 0;
  for (const group of sessionStart) {
    if (!isRecord(group) || !Array.isArray(group['hooks'])) { return 'invalid'; }
    for (const hook of group['hooks']) {
      if (!isRecord(hook)) { return 'invalid'; }
      if (isKronosTrackingHook(hook)) {
        matches += 1;
        if (group['matcher'] === SESSION_START_MATCHER
          && hook['command'] === expectedCommand
          && hook['timeout'] === 5) {
          exact += 1;
        }
      }
    }
  }
  if (matches === 0) { return 'missing'; }
  return matches === 1 && exact === 1 ? 'ready' : 'repair';
}

function mergeTrackingHook(
  settings: Record<string, unknown>,
  command: string,
): Record<string, unknown> {
  const hooksValue = settings['hooks'];
  if (hooksValue !== undefined && !isRecord(hooksValue)) {
    throw new Error('Claude hooks settings have an unsupported shape; Kronos did not change them.');
  }
  const hooks = hooksValue ? { ...hooksValue } : {};
  const sessionStartValue = hooks['SessionStart'];
  if (sessionStartValue !== undefined && !Array.isArray(sessionStartValue)) {
    throw new Error('Claude SessionStart hooks have an unsupported shape; Kronos did not change them.');
  }

  const sessionStart: unknown[] = [];
  for (const value of sessionStartValue || []) {
    if (!isRecord(value) || !Array.isArray(value['hooks'])) {
      throw new Error('Claude SessionStart hooks have an unsupported shape; Kronos did not change them.');
    }
    const remaining = value['hooks'].filter(hook => {
      if (!isRecord(hook)) {
        throw new Error('Claude SessionStart hooks have an unsupported shape; Kronos did not change them.');
      }
      return !isKronosTrackingHook(hook);
    });
    if (remaining.length > 0) { sessionStart.push({ ...value, hooks: remaining }); }
  }
  sessionStart.push({
    matcher: SESSION_START_MATCHER,
    hooks: [{
      type: 'command',
      command,
      timeout: 5,
    }],
  });
  hooks['SessionStart'] = sessionStart;
  return { ...settings, hooks };
}

function isKronosTrackingHook(value: Record<string, unknown>): boolean {
  return value['type'] === 'command'
    && typeof value['command'] === 'string'
    && value['command'].split(/\s+/).includes(CLAUDE_SESSION_TRACKING_MARKER);
}

function resolveNodeExecutable(options: ClaudeSessionTrackingOptions): string {
  const platform = options.platform || process.platform;
  const explicit = options.nodeExecutable?.trim();
  if (explicit) { return validateNodeExecutable(explicit, platform); }
  const environment = options.environment || process.env;
  const pathValue = environment['PATH'] || environment['Path'] || environment['path'];
  if (!pathValue) { throw new Error('Node.js is unavailable on PATH.'); }
  const names = platform === 'win32' ? ['node.exe', 'node.cmd', 'node.bat', 'node'] : ['node'];
  const accessMode = platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  for (const directoryValue of pathValue.split(path.delimiter)) {
    const directory = directoryValue.trim().replace(/^"(.*)"$/, '$1') || process.cwd();
    for (const name of names) {
      const candidate = path.resolve(directory, name);
      try {
        if (!fs.statSync(candidate).isFile()) { continue; }
        fs.accessSync(candidate, accessMode);
        return candidate;
      } catch {
        // Keep searching PATH without executing a candidate.
      }
    }
  }
  throw new Error('Node.js is unavailable on PATH.');
}

function validateNodeExecutable(value: string, platform: NodeJS.Platform): string {
  const candidate = path.resolve(value);
  const accessMode = platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK;
  if (!fs.statSync(candidate).isFile()) { throw new Error('Node.js executable is not a file.'); }
  fs.accessSync(candidate, accessMode);
  return candidate;
}

function trackingHookCommand(
  nodeExecutable: string,
  helperPath: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return `${shellArgument(nodeExecutable, platform)} ${shellArgument(helperPath, platform)} ${CLAUDE_SESSION_TRACKING_MARKER}`;
}

function shellArgument(value: string, platform: NodeJS.Platform): string {
  if (CONTROL_PATTERN.test(value)) { throw new Error('Claude tracking hook path contains control characters.'); }
  if (platform === 'win32') {
    if (/[&|<>^!]/.test(value)) {
      throw new Error('Claude tracking hook path contains unsupported Windows shell characters.');
    }
    return `"${value.replace(/%/g, '%%').replace(/"/g, '\\"')}"`;
  }
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function normalizeTrackingEvent(value: unknown): ClaudeSessionTrackingEvent {
  if (!isRecord(value) || value['schemaVersion'] !== 1) {
    throw new Error('Claude Session tracking event is invalid.');
  }
  const cwd = value['cwd'];
  if (typeof cwd !== 'string'
    || !cwd.trim()
    || cwd.length > 4_096
    || CONTROL_PATTERN.test(cwd)
    || (!path.isAbsolute(cwd) && !path.win32.isAbsolute(cwd))) {
    throw new Error('Claude Session tracking event cwd is invalid.');
  }
  const source = value['source'];
  if (typeof source !== 'string'
    || !source.trim()
    || source.length > 100
    || CONTROL_PATTERN.test(source)
    || !SESSION_START_SOURCES.has(source.trim())) {
    throw new Error('Claude Session tracking event source is invalid.');
  }
  const observedAt = normalizeTimestamp(value['observedAt']);
  return {
    schemaVersion: 1,
    workSessionId: normalizeEntityId(value['workSessionId'], 'work session id'),
    terminalBindingId: normalizeEntityId(value['terminalBindingId'], 'terminal binding id'),
    launchClaudeSessionId: normalizeClaudeSessionId(value['launchClaudeSessionId']),
    claudeSessionId: normalizeClaudeSessionId(value['claudeSessionId']),
    cwd: normalizePortablePath(cwd.trim()),
    source: source.trim(),
    observedAt,
  };
}

function normalizeEntityId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SAFE_ENTITY_ID_PATTERN.test(value.trim())) {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function normalizeTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Claude Session tracking event timestamp is invalid.');
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error('Claude Session tracking event timestamp is invalid.');
  }
  return parsed.toISOString();
}

function normalizePortablePath(value: string): string {
  return path.win32.isAbsolute(value) && !path.isAbsolute(value)
    ? path.win32.normalize(value)
    : path.resolve(value);
}

function installTimestamp(now?: Date): string {
  const candidate = now || new Date();
  if (!Number.isFinite(candidate.getTime())) { throw new Error('Install timestamp is invalid.'); }
  return candidate.toISOString();
}

/** Standalone helper source. It receives only SessionStart JSON and never opens the transcript path. */
export function trackingHelperSource(): string {
  return String.raw`'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const marker = '--kronos-session-tracking-v1';
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const controlPattern = /[\u0000-\u001f\u007f\u2028\u2029]/;
const sourcePattern = /^(resume|clear)$/;
const maximumInputBytes = 65536;

function safeDirectory(directory) {
  const resolved = path.resolve(directory);
  const parsed = path.parse(resolved);
  let current = parsed.root;
  const root = fs.lstatSync(current);
  if (root.isSymbolicLink() || !root.isDirectory()) { throw new Error('unsafe root'); }
  for (const component of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (!error || error.code !== 'ENOENT') { throw error; }
      fs.mkdirSync(current, { mode: 0o700 });
      stat = fs.lstatSync(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) { throw new Error('unsafe directory'); }
  }
  if (process.platform !== 'win32') { fs.chmodSync(resolved, 0o700); }
  return resolved;
}

function atomicWrite(file, content) {
  const existing = (() => { try { return fs.lstatSync(file); } catch (error) {
    if (error && error.code === 'ENOENT') { return undefined; }
    throw error;
  } })();
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) { throw new Error('unsafe event file'); }
  const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp');
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    if (process.platform !== 'win32') { fs.fchmodSync(descriptor, 0o600); }
    fs.writeFileSync(descriptor, content, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const completed = fs.lstatSync(temporary);
    if (completed.isSymbolicLink() || !completed.isFile()) { throw new Error('unsafe temporary file'); }
    const atCommit = (() => { try { return fs.lstatSync(file); } catch (error) {
      if (error && error.code === 'ENOENT') { return undefined; }
      throw error;
    } })();
    if (atCommit && (atCommit.isSymbolicLink() || !atCommit.isFile())) { throw new Error('unsafe event target'); }
    fs.renameSync(temporary, file);
    if (process.platform !== 'win32') { fs.chmodSync(file, 0o600); }
  } finally {
    if (descriptor !== undefined) { try { fs.closeSync(descriptor); } catch {} }
    try { fs.unlinkSync(temporary); } catch (error) { if (!error || error.code !== 'ENOENT') {} }
  }
}

function processInput(text) {
  if (process.argv[2] !== marker || Buffer.byteLength(text, 'utf8') > maximumInputBytes) { return; }
  const workSessionId = String(process.env.KRONOS_WORK_SESSION_ID || '').trim();
  const terminalBindingId = String(process.env.KRONOS_TERMINAL_BINDING_ID || '').trim();
  const launchClaudeSessionId = String(process.env.KRONOS_CLAUDE_SESSION_ID || '').trim().toLowerCase();
  if (process.env.KRONOS_MANAGED_CLAUDE !== '1'
    || !idPattern.test(workSessionId)
    || !idPattern.test(terminalBindingId)
    || !uuidPattern.test(launchClaudeSessionId)) { return; }
  const input = JSON.parse(text);
  const claudeSessionId = typeof input.session_id === 'string' ? input.session_id.trim().toLowerCase() : '';
  const cwd = typeof input.cwd === 'string' ? input.cwd.trim() : '';
  const source = typeof input.source === 'string' ? input.source.trim() : 'unknown';
  if (input.hook_event_name !== 'SessionStart'
    || !uuidPattern.test(claudeSessionId)
    || !cwd
    || cwd.length > 4096
    || !path.isAbsolute(cwd)
    || controlPattern.test(cwd)
    || !sourcePattern.test(source)
    || controlPattern.test(source)) { return; }
  const kronosDirectory = path.resolve(process.env.KRONOS_DIR || path.join(os.homedir(), '.kronos'));
  const eventDirectory = safeDirectory(path.join(kronosDirectory, 'claude-session-tracking', 'events'));
  const event = {
    schemaVersion: 1,
    workSessionId,
    terminalBindingId,
    launchClaudeSessionId,
    claudeSessionId,
    cwd: path.resolve(cwd),
    source,
    observedAt: new Date().toISOString(),
  };
  atomicWrite(path.join(eventDirectory, workSessionId + '--' + terminalBindingId + '.json'), JSON.stringify(event) + '\n');
}

let bytes = 0;
const chunks = [];
process.stdin.on('data', chunk => {
  bytes += chunk.length;
  if (bytes <= maximumInputBytes) { chunks.push(chunk); }
});
process.stdin.on('end', () => {
  try { if (bytes <= maximumInputBytes) { processInput(Buffer.concat(chunks).toString('utf8')); } } catch {}
});
process.stdin.on('error', () => {});
`;
}
