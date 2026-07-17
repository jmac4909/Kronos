import * as path from 'path';
import { normalizeJiraIssueKey } from './jiraRestClient';
import { ciProjectContextDirectory } from './ciContextStore';

export interface TerminalContextInsertionTarget {
  sendText(text: string, shouldExecute?: boolean): void;
}

export type TerminalContextPlacementPhase = 'ready' | 'placing' | 'placed';

export interface TerminalContextAttachment<Terminal extends TerminalContextInsertionTarget> {
  terminal: Terminal;
  sessionId: string;
  bindingId: string;
}

export interface TerminalContextPlacement<Terminal extends TerminalContextInsertionTarget>
  extends TerminalContextAttachment<Terminal> {
  phase: TerminalContextPlacementPhase;
}

export type TerminalContextPlacementResult =
  | { kind: 'placed'; text: string }
  | { kind: 'busy' }
  | { kind: 'already-placed' }
  | { kind: 'target-changed' };

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

export function buildProjectCiContextReference(projectName: string, promptPath: string): string {
  const ownerDirectory = ciProjectContextDirectory(projectName);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[CI-${ownerDirectory}] Read Jenkins and SonarQube context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildProjectGitContextReference(contextIdValue: string, promptPath: string): string {
  const contextId = normalizeGitContextId(contextIdValue);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${contextId}] Read local Git working-tree status and diff context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildAttentionEventContextReference(contextIdValue: string, promptPath: string): string {
  const contextId = normalizeAttentionEventContextId(contextIdValue);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${contextId}] Read exact Attention event context file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildContextBasketTerminalReference(basketIdValue: string, promptPath: string): string {
  const basketId = normalizeBasketContextId(basketIdValue);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${basketId}] Read private context basket file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
  assertSafeTerminalContextReference(reference);
  return reference;
}

export function buildPromptLibraryTerminalReference(promptIdValue: string, promptPath: string): string {
  const promptId = normalizePromptLibraryContextId(promptIdValue);
  const absolutePromptPath = path.resolve(promptPath);
  assertShellInertPromptPath(absolutePromptPath);
  const reference = `[${promptId}] Read reviewed prompt library instruction file ${JSON.stringify(absolutePromptPath)}${REFERENCE_SUFFIX}`;
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

/** Captures the exact managed terminal attachment selected before evidence fetch. */
export function captureTerminalContextPlacement<Terminal extends TerminalContextInsertionTarget>(
  attachment: TerminalContextAttachment<Terminal>,
): TerminalContextPlacement<Terminal> {
  return {
    terminal: attachment.terminal,
    sessionId: boundedPlacementId(attachment.sessionId, 'session'),
    bindingId: boundedPlacementId(attachment.bindingId, 'terminal binding'),
    phase: 'ready',
  };
}

export function isTerminalContextPlacementCurrent<Terminal extends TerminalContextInsertionTarget>(
  placement: TerminalContextPlacement<Terminal>,
  current: TerminalContextAttachment<Terminal> | undefined,
): boolean {
  return Boolean(current
    && current.terminal === placement.terminal
    && current.sessionId === placement.sessionId
    && current.bindingId === placement.bindingId);
}

/**
 * Performs target verification and the only non-submitting send as one
 * exactly-once state transition. A failed send can be retried; a successful
 * send stays placed even when later local audit work fails.
 */
export function placeEditableTerminalContextReference<Terminal extends TerminalContextInsertionTarget>(
  placement: TerminalContextPlacement<Terminal>,
  current: TerminalContextAttachment<Terminal> | undefined,
  reference: string,
  focusValue: unknown,
): TerminalContextPlacementResult {
  if (placement.phase === 'placed') { return { kind: 'already-placed' }; }
  if (placement.phase === 'placing') { return { kind: 'busy' }; }
  if (!isTerminalContextPlacementCurrent(placement, current)) { return { kind: 'target-changed' }; }
  placement.phase = 'placing';
  try {
    const text = insertEditableTerminalContextReference(placement.terminal, reference, focusValue);
    placement.phase = 'placed';
    return { kind: 'placed', text };
  } catch (error: unknown) {
    placement.phase = 'ready';
    throw error;
  }
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
  | { kind: 'ci'; key: string; promptPath: string }
  | { kind: 'ci-project'; ownerDirectory: string; promptPath: string }
  | { kind: 'git'; contextId: string; promptPath: string }
  | { kind: 'attention-event'; contextId: string; promptPath: string }
  | { kind: 'basket'; basketId: string; promptPath: string }
  | { kind: 'prompt-library'; promptId: string; promptPath: string } {
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

  const projectCiPrefix = /^\[CI-(PROJECT-[A-F0-9]{24})\] Read Jenkins and SonarQube context file /.exec(reference);
  if (projectCiPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const ownerDirectory = projectCiPrefix[1];
    if (!ownerDirectory) { throw new Error('Project CI terminal context reference has no owner.'); }
    const promptPath = parsePromptPathLiteral(reference, projectCiPrefix[0].length);
    if (path.basename(path.dirname(promptPath)) !== ownerDirectory) {
      throw new Error('Project CI terminal context reference does not point to the expected prompt artifact.');
    }
    return { kind: 'ci-project', ownerDirectory, promptPath };
  }

  const gitPrefix = /^\[(GIT-[A-Za-z0-9_.-]{1,100})\] Read local Git working-tree status and diff context file /.exec(reference);
  if (gitPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const contextIdValue = gitPrefix[1];
    if (!contextIdValue) { throw new Error('Git terminal context reference has no context id.'); }
    const contextId = normalizeGitContextId(contextIdValue);
    const promptPath = parsePromptPathLiteral(reference, gitPrefix[0].length);
    if (path.basename(path.dirname(promptPath)) !== contextId) {
      throw new Error('Git terminal context reference does not point to the expected prompt artifact.');
    }
    return { kind: 'git', contextId, promptPath };
  }

  const attentionEventPrefix = /^\[(ATTENTION-(?:GITLAB|JENKINS|SONAR)-[A-F0-9]{24})\] Read exact Attention event context file /.exec(reference);
  if (attentionEventPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const contextIdValue = attentionEventPrefix[1];
    if (!contextIdValue) { throw new Error('Attention event terminal reference has no context id.'); }
    const contextId = normalizeAttentionEventContextId(contextIdValue);
    const promptPath = parsePromptPathLiteral(reference, attentionEventPrefix[0].length);
    if (path.basename(path.dirname(promptPath)) !== contextId) {
      throw new Error('Attention event terminal reference does not point to the expected prompt artifact.');
    }
    return { kind: 'attention-event', contextId, promptPath };
  }

  const basketPrefix = /^\[(BASKET-[A-F0-9]{24})\] Read private context basket file /.exec(reference);
  if (basketPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const basketIdValue = basketPrefix[1];
    if (!basketIdValue) { throw new Error('Context basket terminal reference has no basket id.'); }
    const basketId = normalizeBasketContextId(basketIdValue);
    const promptPath = parsePromptPathLiteral(reference, basketPrefix[0].length);
    if (path.basename(path.dirname(promptPath)) !== 'basket-context') {
      throw new Error('Context basket terminal reference does not point to the expected prompt artifact.');
    }
    return { kind: 'basket', basketId, promptPath };
  }

  const promptLibraryPrefix = /^\[(PROMPT-[A-F0-9]{24})\] Read reviewed prompt library instruction file /.exec(reference);
  if (promptLibraryPrefix && reference.endsWith(REFERENCE_SUFFIX)) {
    const promptIdValue = promptLibraryPrefix[1];
    if (!promptIdValue) { throw new Error('Prompt library terminal reference has no prompt id.'); }
    const promptId = normalizePromptLibraryContextId(promptIdValue);
    const promptPath = parsePromptPathLiteral(reference, promptLibraryPrefix[0].length);
    if (path.basename(path.dirname(promptPath)) !== promptId) {
      throw new Error('Prompt library terminal reference does not point to the expected prompt artifact.');
    }
    return { kind: 'prompt-library', promptId, promptPath };
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

function normalizeGitContextId(value: string): string {
  const normalized = value.trim();
  if (!/^GIT-[A-Za-z0-9_.-]{1,100}$/.test(normalized)) {
    throw new Error('Git context id is missing or invalid.');
  }
  return normalized;
}

function normalizeAttentionEventContextId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^ATTENTION-(?:GITLAB|JENKINS|SONAR)-[A-F0-9]{24}$/.test(normalized)) {
    throw new Error('Attention event context id is missing or invalid.');
  }
  return normalized;
}

function normalizeBasketContextId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^BASKET-[A-F0-9]{24}$/.test(normalized)) {
    throw new Error('Context basket id is missing or invalid.');
  }
  return normalized;
}

function normalizePromptLibraryContextId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^PROMPT-[A-F0-9]{24}$/.test(normalized)) {
    throw new Error('Prompt library context id is missing or invalid.');
  }
  return normalized;
}

function boundedPlacementId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\u0000-\u001f\u007f\u2028\u2029]/.test(normalized)) {
    throw new Error(`Context placement ${label} id is missing or invalid.`);
  }
  return normalized;
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
