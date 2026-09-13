import type * as vscode from 'vscode';
import { isRecord } from './records';

export const KRONOS_MANAGED_CLAUDE_ENV = 'KRONOS_MANAGED_CLAUDE';
export const KRONOS_WORK_SESSION_ID_ENV = 'KRONOS_WORK_SESSION_ID';
export const KRONOS_TERMINAL_BINDING_ID_ENV = 'KRONOS_TERMINAL_BINDING_ID';
export const KRONOS_CLAUDE_SESSION_ID_ENV = 'KRONOS_CLAUDE_SESSION_ID';
export const KRONOS_EDITOR_SESSION_ID_ENV = 'KRONOS_EDITOR_SESSION_ID';

const MANAGED_CLAUDE_VERSION = '1';
const SAFE_ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,179}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f\u2028\u2029]/;
const MAX_EDITOR_SESSION_ID_LENGTH = 200;

export interface ManagedClaudeTerminalIdentity {
  workSessionId: string;
  terminalBindingId: string;
  claudeSessionId: string;
  editorSessionId: string;
}

/**
 * Produces non-secret terminal environment markers. They identify a candidate
 * terminal only; runtime code must still match them against the private Session
 * record before reconnecting or resuming anything.
 */
export function managedClaudeTerminalEnvironment(
  value: ManagedClaudeTerminalIdentity,
): Record<string, string> {
  const identity = normalizeManagedClaudeTerminalIdentity(value);
  return {
    [KRONOS_MANAGED_CLAUDE_ENV]: MANAGED_CLAUDE_VERSION,
    [KRONOS_WORK_SESSION_ID_ENV]: identity.workSessionId,
    [KRONOS_TERMINAL_BINDING_ID_ENV]: identity.terminalBindingId,
    [KRONOS_CLAUDE_SESSION_ID_ENV]: identity.claudeSessionId,
    [KRONOS_EDITOR_SESSION_ID_ENV]: identity.editorSessionId,
  };
}

/** Reads only terminal creation metadata; terminal input, output, and scrollback remain untouched. */
export function managedClaudeTerminalIdentity(
  terminal: Pick<vscode.Terminal, 'creationOptions'>,
): ManagedClaudeTerminalIdentity | undefined {
  const creationOptions: unknown = terminal.creationOptions;
  if (!isRecord(creationOptions)) { return undefined; }
  const environment = creationOptions['env'];
  if (!isRecord(environment) || environment[KRONOS_MANAGED_CLAUDE_ENV] !== MANAGED_CLAUDE_VERSION) {
    return undefined;
  }
  try {
    return normalizeManagedClaudeTerminalIdentity({
      workSessionId: environment[KRONOS_WORK_SESSION_ID_ENV],
      terminalBindingId: environment[KRONOS_TERMINAL_BINDING_ID_ENV],
      claudeSessionId: environment[KRONOS_CLAUDE_SESSION_ID_ENV],
      editorSessionId: environment[KRONOS_EDITOR_SESSION_ID_ENV],
    });
  } catch {
    return undefined;
  }
}

export function normalizeManagedClaudeTerminalIdentity(
  value: unknown,
): ManagedClaudeTerminalIdentity {
  if (!isRecord(value)) { throw new Error('Managed Claude terminal identity must be an object.'); }
  return {
    workSessionId: normalizeManagedClaudeEntityId(value['workSessionId'], 'work session id'),
    terminalBindingId: normalizeManagedClaudeEntityId(value['terminalBindingId'], 'terminal binding id'),
    claudeSessionId: normalizeClaudeSessionId(value['claudeSessionId']),
    editorSessionId: normalizeEditorSessionId(value['editorSessionId']),
  };
}

export function normalizeClaudeSessionId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new Error('Claude session id must be a valid UUID.');
  }
  return value.trim().toLowerCase();
}

export function normalizeEditorSessionId(value: unknown): string {
  if (typeof value !== 'string') { throw new Error('VS Code editor session id must be a string.'); }
  const normalized = value.trim();
  if (!normalized
    || normalized.length > MAX_EDITOR_SESSION_ID_LENGTH
    || CONTROL_PATTERN.test(value)) {
    throw new Error('VS Code editor session id is missing, too long, or contains control characters.');
  }
  return normalized;
}

function normalizeManagedClaudeEntityId(value: unknown, label: string): string {
  if (typeof value !== 'string') { throw new Error(`${label} must be a string.`); }
  const normalized = value.trim();
  if (!SAFE_ENTITY_ID_PATTERN.test(normalized)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return normalized;
}
