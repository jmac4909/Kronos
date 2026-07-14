import * as path from 'path';
import { normalizeJiraIssueKey } from './jiraRestClient';

export interface TerminalContextInsertionTarget {
  sendText(text: string, shouldExecute?: boolean): void;
}

const REFERENCE_SUFFIX = ' before answering.';
const MAX_REFERENCE_LENGTH = 8192;
const MAX_OPERATOR_FOCUS_LENGTH = 2000;
const SAFE_PROMPT_PATH_PATTERN = /^[\p{L}\p{N} /\\:._@+-]+$/u;
const PROMPT_ARTIFACT_NAME_PATTERN = /^prompt(?:-[a-f0-9]{24})?\.md$/i;

export function buildJiraContextReference(ticketKey: string, promptPath: string): string {
  const key = normalizeJiraIssueKey(ticketKey);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${key}] Read Jira context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildGitLabMergeRequestContextReference(iid: number, promptPath: string): string {
  const safeIid = normalizeMergeRequestIid(iid);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[MR-${safeIid}] Read GitLab merge request and pipeline context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildCiContextReference(ticketKey: string, promptPath: string): string {
  const key = normalizeJiraIssueKey(ticketKey);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[CI-${key}] Read Jenkins and SonarQube context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function insertTerminalContextReference(
  terminal: TerminalContextInsertionTarget,
  reference: string,
): void {
  assertSafeTerminalContextReference(reference);
  sendNonSubmittingReference(terminal, reference);
}

/**
 * Adds operator-authored focus text to a validated provider reference while
 * keeping the resulting line shell-inert and non-submitting.
 */
export function buildEditableTerminalContextReference(reference: string, focusValue: unknown): string {
  assertSafeTerminalContextReference(reference);
  const focus = normalizeOperatorFocus(focusValue);
  if (!focus) { return reference; }
  const editableReference = `${reference} Operator focus: ${shellQuotedLiteral(focus)}`;
  if (editableReference.length > MAX_REFERENCE_LENGTH) {
    throw new Error(`Edited context reference exceeds the ${MAX_REFERENCE_LENGTH}-character safety limit.`);
  }
  return editableReference;
}

export function insertEditableTerminalContextReference(
  terminal: TerminalContextInsertionTarget,
  reference: string,
  focusValue: unknown,
): string {
  const editableReference = buildEditableTerminalContextReference(reference, focusValue);
  sendNonSubmittingReference(terminal, editableReference);
  return editableReference;
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

function parseTerminalContextReference(reference: string):
  | { kind: 'jira'; key: string; promptPath: string }
  | { kind: 'gitlab'; iid: number; promptPath: string }
  | { kind: 'ci'; key: string; promptPath: string } {
  if (!reference || reference.length > MAX_REFERENCE_LENGTH || reference !== reference.trim()) {
    throw new Error('Terminal context reference is missing or invalid.');
  }
  if (/[\u0000-\u001f\u007f\u2028\u2029]/.test(reference)) {
    throw new Error('Terminal context reference must be a single safe line.');
  }

  const gitLabPrefix = /^\[MR-([1-9][0-9]*)\] Read GitLab merge request and pipeline context file /.exec(reference);
  if (gitLabPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const iid = normalizeMergeRequestIid(Number(gitLabPrefix[1]));
    const promptPath = parsePromptPathLiteral(reference, gitLabPrefix[0].length);
    if (path.basename(path.dirname(promptPath)).toUpperCase() !== `MR-${iid}`) {
      throw new Error('GitLab terminal context reference does not point to the expected prompt artifact.');
    }
    return { kind: 'gitlab', iid, promptPath };
  }

  const ciPrefix = /^\[CI-([A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*)\] Read Jenkins and SonarQube context file /.exec(reference);
  if (ciPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const keyValue = ciPrefix[1];
    if (!keyValue) { throw new Error('CI terminal context reference has no ticket key.'); }
    const key = normalizeJiraIssueKey(keyValue);
    const promptPath = parsePromptPathLiteral(reference, ciPrefix[0].length);
    if (path.basename(path.dirname(promptPath)).toUpperCase() !== key) {
      throw new Error('CI terminal context reference does not point to the expected prompt artifact.');
    }
    return { kind: 'ci', key, promptPath };
  }

  const prefixMatch = /^\[([A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*)\] Read Jira context file /.exec(reference);
  if (!prefixMatch || !reference.endsWith(REFERENCE_SUFFIX)) {
    throw new Error('Terminal context reference has an invalid format.');
  }
  const keyValue = prefixMatch[1];
  if (!keyValue) {
    throw new Error('Jira terminal context reference has no ticket key.');
  }
  const key = normalizeJiraIssueKey(keyValue);
  const promptPath = parsePromptPathLiteral(reference, prefixMatch[0].length);
  if (path.basename(path.dirname(promptPath)).toUpperCase() !== key) {
    throw new Error('Jira terminal context reference does not point to the expected prompt artifact.');
  }
  return { kind: 'jira', key, promptPath };
}

function parsePromptPathLiteral(reference: string, prefixLength: number): string {
  const pathLiteral = reference.slice(prefixLength, -REFERENCE_SUFFIX.length);
  let promptPath: unknown;
  try {
    promptPath = JSON.parse(pathLiteral) as unknown;
  } catch {
    throw new Error('Terminal context reference has an invalid artifact path.');
  }
  if (typeof promptPath !== 'string'
    || !path.isAbsolute(promptPath)
    || !PROMPT_ARTIFACT_NAME_PATTERN.test(path.basename(promptPath))) {
    throw new Error('Terminal context reference does not point to a prompt artifact.');
  }
  assertShellInertPromptPath(promptPath);
  return promptPath;
}

function normalizeMergeRequestIid(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('GitLab merge request IID is missing or invalid.');
  }
  return value;
}

function assertShellInertPromptPath(promptPath: string): void {
  if (!SAFE_PROMPT_PATH_PATTERN.test(promptPath)) {
    throw new Error('Context artifact path contains shell-active characters and cannot be inserted safely.');
  }
}

function normalizeOperatorFocus(value: unknown): string {
  if (value === undefined || value === null) { return ''; }
  if (typeof value !== 'string') { throw new Error('Context focus must be text.'); }
  const focus = value
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (focus.length > MAX_OPERATOR_FOCUS_LENGTH) {
    throw new Error(`Context focus must be ${MAX_OPERATOR_FOCUS_LENGTH} characters or fewer.`);
  }
  return focus;
}

function shellQuotedLiteral(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function sendNonSubmittingReference(terminal: TerminalContextInsertionTarget, reference: string): void {
  terminal.sendText(reference, false);
}
