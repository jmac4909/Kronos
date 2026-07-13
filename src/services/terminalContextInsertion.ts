import * as path from 'path';
import { normalizeJiraIssueKey } from './jiraRestClient';

export interface TerminalContextInsertionTarget {
  show(preserveFocus?: boolean): void;
  sendText(text: string, shouldExecute?: boolean): void;
}

const REFERENCE_SUFFIX = ' before answering.';
const MAX_REFERENCE_LENGTH = 8192;
const SAFE_PROMPT_PATH_PATTERN = /^[\p{L}\p{N} /\\:._@+-]+$/u;

export function buildJiraContextReference(ticketKey: string, promptPath: string): string {
  const key = normalizeJiraIssueKey(ticketKey);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${key}] Read Jira context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function insertTerminalContextReference(
  terminal: TerminalContextInsertionTarget,
  reference: string,
): void {
  assertSafeTerminalContextReference(reference);
  terminal.show(false);
  terminal.sendText(reference, false);
}

export function isSafeTerminalContextReference(reference: string): boolean {
  try {
    parseTerminalContextReference(reference);
    return true;
  } catch {
    return false;
  }
}

export function assertSafeTerminalContextReference(reference: string): void {
  parseTerminalContextReference(reference);
}

function parseTerminalContextReference(reference: string): { key: string; promptPath: string } {
  if (!reference || reference.length > MAX_REFERENCE_LENGTH || reference !== reference.trim()) {
    throw new Error('Jira terminal context reference is missing or invalid.');
  }
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(reference)) {
    throw new Error('Jira terminal context reference must be a single safe line.');
  }
  const prefixMatch = /^\[([A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*)\] Read Jira context file /.exec(reference);
  if (!prefixMatch || !reference.endsWith(REFERENCE_SUFFIX)) {
    throw new Error('Jira terminal context reference has an invalid format.');
  }
  const keyValue = prefixMatch[1];
  if (!keyValue) {
    throw new Error('Jira terminal context reference has no ticket key.');
  }
  const key = normalizeJiraIssueKey(keyValue);
  const pathLiteral = reference.slice(prefixMatch[0].length, -REFERENCE_SUFFIX.length);
  let promptPath: unknown;
  try {
    promptPath = JSON.parse(pathLiteral) as unknown;
  } catch {
    throw new Error('Jira terminal context reference has an invalid artifact path.');
  }
  if (typeof promptPath !== 'string'
    || !path.isAbsolute(promptPath)
    || path.basename(promptPath) !== 'prompt.md'
    || path.basename(path.dirname(promptPath)).toUpperCase() !== key) {
    throw new Error('Jira terminal context reference does not point to the expected prompt artifact.');
  }
  assertShellInertPromptPath(promptPath);
  return { key, promptPath };
}

function assertShellInertPromptPath(promptPath: string): void {
  if (!SAFE_PROMPT_PATH_PATTERN.test(promptPath)) {
    throw new Error('Jira context artifact path contains shell-active characters and cannot be inserted safely.');
  }
}
