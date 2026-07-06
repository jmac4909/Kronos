import {
  KronosState,
  MergeRequest,
  MergeRequestComment,
  Ticket,
  TicketAcceptanceCriterion,
  TicketEvidence,
  TicketEvidenceCheck,
  TicketEvidenceNote,
  TicketEnvironmentResult,
} from '../state/types';
import { STATE_FILE, readStateFile, validateStateFileShape, writeJsonFileAtomic } from './stateStore';
import { isReviewReadyAction } from './actionSemantics';
import { setAcceptanceCriteriaChecked } from './acceptanceCriteria';
import { decideEvidenceHandoff } from './evidenceGatePolicy';
import { mergeRequestCommentsFromRecord, sortMergeRequestCommentsByCreated } from './mergeRequestComments';
import { isRecord, optionalTrimmedStringFromUnknown } from './records';
import { ticketStringArray } from './ticketFields';

type EvidenceNoteKind = TicketEvidenceNote['kind'];
type EvidenceResult = TicketEvidenceCheck['result'];
type EvidenceConfidence = NonNullable<TicketEvidenceCheck['confidence']>;

interface TicketEvidenceNoteInput {
  kind: EvidenceNoteKind;
  text: string;
  now?: Date;
}

export interface TicketEvidenceCheckInput {
  name: string;
  result: EvidenceResult;
  environment?: string;
  command?: string;
  summary?: string;
  artifactPath?: string;
  confidence: EvidenceConfidence;
  now?: Date;
}

interface TicketEnvironmentResultInput {
  environment: string;
  status: TicketEnvironmentResult['status'];
  detail: string;
  artifactPath?: string;
  now?: Date;
}

interface TicketRunCompletionEvidenceInput {
  note: TicketEvidenceNoteInput;
  check: TicketEvidenceCheckInput;
}

interface LinkMergeRequestInput {
  orphanKey: string;
  targetTicketKey: string;
  jiraBaseUrl?: string;
  allowReviewHandoffWithWarnings?: boolean;
}

interface LinkMergeRequestPreview {
  orphanKey: string;
  targetTicketKey: string;
  ticket: Ticket;
  removesOrphan: boolean;
  reviewReady: boolean;
}

interface MergeRequestStatusInput {
  ticketKey: string;
  status: Partial<MergeRequest>;
  now?: Date;
}

export interface MergeRequestStatusUpdate {
  state: KronosState;
  ticket: Ticket;
  changed: boolean;
  mergedNow: boolean;
  closedNow: boolean;
  previousMr: MergeRequest | null;
}

interface TerminalMergeRequestReconciliation {
  ticketKey: string;
  ticket: Ticket;
  action: 'deploy_monitor' | 'blocked';
  changed: boolean;
  message: string;
}

export function addTicketEvidenceNote(ticketKey: string, input: TicketEvidenceNoteInput): KronosState {
  return mutateState('add-ticket-evidence', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    appendEvidenceNote(evidence, input);
  });
}

export function addTicketEvidenceCheck(ticketKey: string, input: TicketEvidenceCheckInput): KronosState {
  return mutateState('add-evidence-check', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    appendEvidenceCheck(evidence, input);
  });
}

export function addTicketRunCompletionEvidence(ticketKey: string, input: TicketRunCompletionEvidenceInput): KronosState {
  return mutateState('add-run-completion-evidence', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    const fallbackNow = input.note.now || input.check.now || new Date();
    appendEvidenceNote(evidence, input.note, fallbackNow);
    appendEvidenceCheck(evidence, input.check, fallbackNow);
  });
}

export function recordTicketEnvironmentResult(ticketKey: string, input: TicketEnvironmentResultInput): KronosState {
  return mutateState('record-environment-result', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    const at = isoNow(input.now);
    if (!isRecord(evidence.environment_results)) {
      evidence.environment_results = {};
    }
    const result: TicketEnvironmentResult = {
      environment: input.environment,
      status: input.status,
      checked_at: at,
      detail: input.detail.trim(),
    };
    const artifactPath = optionalTrimmedStringFromUnknown(input.artifactPath);
    if (artifactPath) { result.artifact_path = artifactPath; }
    evidence.environment_results[input.environment] = result;
    evidence.updated_at = at;
  });
}

export function replaceTicketAcceptanceCriteria(
  ticketKey: string,
  criteria: TicketAcceptanceCriterion[],
  now = new Date(),
): KronosState {
  return mutateState('extract-acceptance-criteria', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    evidence.acceptance_criteria = criteria;
    evidence.updated_at = isoNow(now);
  });
}

export function updateTicketAcceptanceCriteria(
  ticketKey: string,
  checkedIds: string[],
  now = new Date(),
): KronosState {
  return mutateState('update-acceptance-criteria', state => {
    const ticket = requireTicket(state, ticketKey);
    const evidence = ensureEvidence(ticket);
    if (!Array.isArray(evidence.acceptance_criteria)) {
      throw new Error(`${ticketKey} has no acceptance criteria.`);
    }
    evidence.acceptance_criteria = setAcceptanceCriteriaChecked(evidence.acceptance_criteria, checkedIds);
    evidence.updated_at = isoNow(now);
  });
}

export function linkMergeRequestToTicket(input: LinkMergeRequestInput): KronosState {
  return mutateState('link-mr-to-ticket', state => {
    const preview = previewLinkMergeRequestToTicket(state, input);
    if (preview.reviewReady) {
      const handoffDecision = decideEvidenceHandoff(input.targetTicketKey, preview.ticket);
      if (!handoffDecision.allowed) {
        throw new Error(handoffDecision.message);
      }
      if (handoffDecision.requiresConfirmation && !input.allowReviewHandoffWithWarnings) {
        throw new Error(`${handoffDecision.message}. Pass allowReviewHandoffWithWarnings after explicit operator confirmation.`);
      }
    }
    state.tickets[input.targetTicketKey] = preview.ticket;

    if (input.orphanKey !== input.targetTicketKey) {
      delete state.tickets[input.orphanKey];
    }
  });
}

export function updateTicketMergeRequestStatus(input: MergeRequestStatusInput): MergeRequestStatusUpdate {
  const state = readStateFile();
  if (!state) {
    throw new Error('No readable Kronos state found.');
  }
  validateStateFileShape(state);
  const ticket = requireTicket(state, input.ticketKey);
  if (!ticket.mr) {
    throw new Error(`${input.ticketKey} has no merge request to update.`);
  }

  const previousMr = cloneMergeRequest(ticket.mr);
  let changed = mergeRequestStatus(ticket.mr, input.status);
  const mergedNow = previousMr.state !== 'merged' && ticket.mr.state === 'merged';
  const closedNow = previousMr.state !== 'closed' && ticket.mr.state === 'closed';
  if (mergedNow && ticket.next_action === 'await_review') {
    ticket.next_action = 'deploy_monitor';
    ticket.last_action = `MR !${ticket.mr.iid} merged; deploy monitor is next.`;
    ticket.last_action_at = isoNow(input.now);
    changed = true;
  } else if (closedNow && ticket.next_action === 'await_review') {
    ticket.next_action = 'blocked';
    ticket.last_action = `MR !${ticket.mr.iid} closed; human review is needed.`;
    ticket.last_action_at = isoNow(input.now);
    changed = true;
  }

  validateStateFileShape(state);
  if (changed) {
    writeJsonFileAtomic(STATE_FILE, state, 'update-ticket-mr-status');
  }
  return {
    state,
    ticket: cloneTicket(ticket),
    changed,
    mergedNow,
    closedNow,
    previousMr,
  };
}

export function reconcileTerminalMergeRequestState(input: { now?: Date } = {}): TerminalMergeRequestReconciliation[] {
  const state = readStateFile();
  if (!state) {
    throw new Error('No readable Kronos state found.');
  }
  validateStateFileShape(state);

  const reconciled: TerminalMergeRequestReconciliation[] = [];
  let changed = false;
  const now = isoNow(input.now);
  for (const [ticketKey, ticket] of Object.entries(state.tickets)) {
    if (!ticket.mr) { continue; }
    if (ticket.mr.state === 'merged' && (ticket.next_action === 'await_review' || ticket.next_action === 'deploy_monitor')) {
      const wasAwaitingReview = ticket.next_action === 'await_review';
      if (wasAwaitingReview) {
        ticket.next_action = 'deploy_monitor';
        ticket.last_action = `MR !${ticket.mr.iid} merged; deploy monitor is next.`;
        ticket.last_action_at = now;
        changed = true;
      }
      reconciled.push({
        ticketKey,
        ticket: cloneTicket(ticket),
        action: 'deploy_monitor',
        changed: wasAwaitingReview,
        message: wasAwaitingReview
          ? `MR !${ticket.mr.iid} merged; deploy monitor is next.`
          : `MR !${ticket.mr.iid} already merged; deploy monitor is pending.`,
      });
    } else if (ticket.mr.state === 'closed' && ticket.next_action === 'await_review') {
      ticket.next_action = 'blocked';
      ticket.last_action = `MR !${ticket.mr.iid} closed; human review is needed.`;
      ticket.last_action_at = now;
      changed = true;
      reconciled.push({
        ticketKey,
        ticket: cloneTicket(ticket),
        action: 'blocked',
        changed: true,
        message: `MR !${ticket.mr.iid} closed; human review is needed.`,
      });
    }
  }

  if (changed) {
    validateStateFileShape(state);
    writeJsonFileAtomic(STATE_FILE, state, 'reconcile-terminal-mr-state');
  }
  return reconciled;
}

export function previewLinkMergeRequestToTicket(state: KronosState, input: LinkMergeRequestInput): LinkMergeRequestPreview {
  const orphan = state.tickets[input.orphanKey];
  if (!orphan) {
    throw new Error(`${input.orphanKey} no longer exists in state.json.`);
  }
  if (!orphan.mr) {
    throw new Error(`${input.orphanKey} has no merge request to link.`);
  }

  const target = state.tickets[input.targetTicketKey];
  const ticket = target
    ? cloneTicket(target)
    : {
        ...cloneTicket(orphan),
        jira_url: `${(input.jiraBaseUrl || 'https://bcbsma.atlassian.net').replace(/\/+$/, '')}/browse/${input.targetTicketKey}`,
      };
  attachMergeRequest(ticket, cloneTicket(orphan), orphan.mr);

  return {
    orphanKey: input.orphanKey,
    targetTicketKey: input.targetTicketKey,
    ticket,
    removesOrphan: input.orphanKey !== input.targetTicketKey,
    reviewReady: isReviewReadyAction(ticket.next_action),
  };
}

function mutateState(action: string, mutate: (state: KronosState) => void): KronosState {
  const state = readStateFile();
  if (!state) {
    throw new Error('No readable Kronos state found.');
  }
  validateStateFileShape(state);
  mutate(state);
  validateStateFileShape(state);
  writeJsonFileAtomic(STATE_FILE, state, action);
  return state;
}

function cloneTicket(ticket: Ticket): Ticket {
  return JSON.parse(JSON.stringify(ticket));
}

function cloneMergeRequest(mr: MergeRequest): MergeRequest {
  return JSON.parse(JSON.stringify(mr));
}

function requireTicket(state: KronosState, ticketKey: string): Ticket {
  const ticket = state.tickets[ticketKey];
  if (!ticket) {
    throw new Error(`${ticketKey} no longer exists in state.json.`);
  }
  return ticket;
}

function ensureEvidence(ticket: Ticket): TicketEvidence {
  if (!isRecord(ticket.evidence)) {
    ticket.evidence = {};
  }
  return ticket.evidence;
}

function appendEvidenceNote(evidence: TicketEvidence, input: TicketEvidenceNoteInput, fallbackNow?: Date): void {
  const at = isoNow(input.now || fallbackNow);
  const text = input.text.trim();
  if (!Array.isArray(evidence.notes)) {
    evidence.notes = [];
  }
  evidence.notes.push({ at, kind: input.kind, text });
  if (input.kind === 'risk') {
    if (!Array.isArray(evidence.risk_notes)) {
      evidence.risk_notes = [];
    }
    evidence.risk_notes.push({ at, text, severity: 'medium' });
  }
  evidence.updated_at = at;
}

function appendEvidenceCheck(evidence: TicketEvidence, input: TicketEvidenceCheckInput, fallbackNow?: Date): void {
  const at = isoNow(input.now || fallbackNow);
  if (!Array.isArray(evidence.checks)) {
    evidence.checks = [];
  }
  const check: TicketEvidenceCheck = {
    id: `check-${at.replace(/[^0-9]/g, '')}`,
    at,
    name: input.name.trim(),
    result: input.result,
    confidence: input.confidence,
  };
  const environment = optionalTrimmedStringFromUnknown(input.environment);
  const command = optionalTrimmedStringFromUnknown(input.command);
  const summary = optionalTrimmedStringFromUnknown(input.summary);
  const artifactPath = optionalTrimmedStringFromUnknown(input.artifactPath);
  if (environment) { check.environment = environment; }
  if (command) { check.command = command; }
  if (summary) { check.summary = summary; }
  if (artifactPath) { check.artifact_path = artifactPath; }
  evidence.checks.push(check);
  evidence.updated_at = at;
}

function mergeRequestStatus(target: MergeRequest, status: Partial<MergeRequest>): boolean {
  let changed = false;
  changed = setMergeRequestField(target, 'state', validMergeRequestState(status.state)) || changed;
  changed = setMergeRequestField(target, 'review_status', validReviewStatus(status.review_status)) || changed;
  changed = setMergeRequestString(target, 'url', status.url) || changed;
  changed = setMergeRequestString(target, 'title', status.title) || changed;
  changed = setMergeRequestString(target, 'author', status.author) || changed;
  changed = setMergeRequestString(target, 'source_branch', status.source_branch) || changed;
  changed = setMergeRequestString(target, 'target_branch', status.target_branch) || changed;
  changed = setMergeRequestString(target, 'sourceBranch', status.sourceBranch) || changed;
  changed = setMergeRequestString(target, 'targetBranch', status.targetBranch) || changed;
  changed = setMergeRequestString(target, 'branch', status.branch) || changed;
  changed = setMergeRequestString(target, 'head_branch', status.head_branch) || changed;
  changed = setMergeRequestNumber(target, 'comment_count', status.comment_count) || changed;
  changed = setMergeRequestString(target, 'last_comment_at', status.last_comment_at) || changed;
  changed = setMergeRequestComments(target, status.comments) || changed;
  changed = setMergeRequestNumber(target, 'discussion_count', status.discussion_count) || changed;
  changed = setMergeRequestNumber(target, 'unresolved_discussion_count', status.unresolved_discussion_count) || changed;
  changed = setMergeRequestNumber(target, 'resolved_discussion_count', status.resolved_discussion_count) || changed;
  changed = setMergeRequestString(target, 'last_discussion_at', status.last_discussion_at) || changed;
  changed = setMergeRequestBoolean(target, 'discussions_resolved', status.discussions_resolved) || changed;
  return changed;
}

function setMergeRequestField<K extends keyof MergeRequest>(target: MergeRequest, key: K, value: MergeRequest[K] | undefined): boolean {
  if (value === undefined || target[key] === value) { return false; }
  target[key] = value;
  return true;
}

function setMergeRequestString<K extends keyof MergeRequest>(target: MergeRequest, key: K, value: unknown): boolean {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  return setMergeRequestField(target, key, trimmed as MergeRequest[K] | undefined);
}

function setMergeRequestNumber<K extends keyof MergeRequest>(target: MergeRequest, key: K, value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) { return false; }
  return setMergeRequestField(target, key, Math.floor(value) as MergeRequest[K]);
}

function setMergeRequestBoolean<K extends keyof MergeRequest>(target: MergeRequest, key: K, value: unknown): boolean {
  if (typeof value !== 'boolean') { return false; }
  return setMergeRequestField(target, key, value as MergeRequest[K]);
}

function setMergeRequestComments(target: MergeRequest, value: unknown): boolean {
  if (value === undefined) { return false; }
  if (!Array.isArray(value)) { return false; }
  const comments = normalizeStoredMergeRequestComments(value);
  if (JSON.stringify(mergeRequestCommentsFromRecord(target)) === JSON.stringify(comments)) { return false; }
  target.comments = comments;
  return true;
}

function normalizeStoredMergeRequestComments(value: unknown[]): MergeRequestComment[] {
  return sortMergeRequestCommentsByCreated(value
    .map(normalizeStoredMergeRequestComment)
    .filter((comment): comment is MergeRequestComment => Boolean(comment)))
    .slice(-10);
}

function normalizeStoredMergeRequestComment(value: unknown): MergeRequestComment | null {
  if (!isRecord(value)) { return null; }
  const body = optionalTrimmedStringFromUnknown(value['body']);
  if (!body) { return null; }
  const idValue = value['id'];
  const id = typeof idValue === 'string' || typeof idValue === 'number' ? optionalTrimmedStringFromUnknown(String(idValue)) : undefined;
  const author = optionalTrimmedStringFromUnknown(value['author']);
  const created = optionalTrimmedStringFromUnknown(value['created']);
  const comment: MergeRequestComment = { body: body.length > 500 ? `${body.slice(0, 497)}...` : body };
  if (id) { comment.id = id; }
  if (author) { comment.author = author; }
  if (created) { comment.created = created; }
  return comment;
}

function validMergeRequestState(value: unknown): MergeRequest['state'] | undefined {
  return value === 'opened' || value === 'merged' || value === 'closed' ? value : undefined;
}

function validReviewStatus(value: unknown): MergeRequest['review_status'] | undefined {
  return value === 'pending_review' || value === 'approved' || value === 'changes_requested' ? value : undefined;
}

function attachMergeRequest(target: Ticket, orphan: Ticket, mr: MergeRequest): void {
  target.mr = mr;
  if (target.next_action === 'implement' || target.next_action === 'in_progress') {
    target.next_action = 'await_review';
  }
  for (const project of ticketStringArray(orphan.projects)) {
    if (!target.projects.includes(project)) {
      target.projects.push(project);
    }
  }
}

function isoNow(now: Date | undefined): string {
  return (now || new Date()).toISOString();
}
