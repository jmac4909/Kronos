import * as crypto from 'crypto';
import type { GitLabMergeRequestMonitorSnapshot } from './gitlabRestClient';
import {
  arrayFromUnknown,
  isRecord,
  optionalFiniteNumberFromUnknown,
  optionalTrimmedStringFromUnknown,
} from './records';

export type GitLabMergeRequestTransitionKind =
  | 'merge_request_merged'
  | 'merge_request_closed'
  | 'merge_request_reopened'
  | 'merge_request_state_changed'
  | 'changes_requested'
  | 'changes_request_cleared'
  | 'approval_satisfied'
  | 'approval_required'
  | 'approval_state_changed'
  | 'reviewers_changed'
  | 'unresolved_discussions_observed'
  | 'unresolved_discussions_increased'
  | 'unresolved_discussions_decreased'
  | 'unresolved_discussions_changed'
  | 'review_activity_added'
  | 'review_activity_changed';

export interface GitLabMergeRequestApprovalDigest {
  available: boolean;
  approved: boolean | null;
  approvalsRequired: number | null;
  approvalsLeft: number | null;
  approvedByCount: number;
  approvedByFingerprint: string;
}

export interface GitLabMergeRequestCountDigest {
  count: number;
  fingerprint: string;
}

export interface GitLabMergeRequestDigest {
  schemaVersion: 1;
  iid: number;
  state: string;
  detailedMergeStatus: string;
  changesRequested: boolean | null;
  blockingDiscussionsResolved: boolean | null;
  reviewers: GitLabMergeRequestCountDigest;
  approval: GitLabMergeRequestApprovalDigest;
  approvalsComplete: boolean;
  unresolvedDiscussions: GitLabMergeRequestCountDigest;
  discussionsComplete: boolean;
  reviewActivity: GitLabMergeRequestCountDigest;
  reviewActivityComplete: boolean;
  updatedAt: string;
  fetchedAt: string;
  fingerprint: string;
  url?: string;
  sha?: string;
  title?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

export interface GitLabMergeRequestTransition {
  kind: GitLabMergeRequestTransitionKind;
  key: string;
  previous: GitLabMergeRequestDigest;
  current: GitLabMergeRequestDigest;
}

interface GitLabMergeRequestDigestMaterial {
  schemaVersion: 1;
  iid: number;
  state: string;
  detailedMergeStatus: string;
  changesRequested: boolean | null;
  blockingDiscussionsResolved: boolean | null;
  reviewers: GitLabMergeRequestCountDigest;
  approval: GitLabMergeRequestApprovalDigest;
  approvalsComplete: boolean;
  unresolvedDiscussions: GitLabMergeRequestCountDigest;
  discussionsComplete: boolean;
  reviewActivity: GitLabMergeRequestCountDigest;
  reviewActivityComplete: boolean;
  updatedAt: string;
  url?: string;
  sha?: string;
  title?: string;
  sourceBranch?: string;
  targetBranch?: string;
}

const MAX_SOURCE_NOTES = 2_000;
const MAX_SOURCE_DISCUSSIONS = 2_000;
const MAX_NOTES_PER_DISCUSSION = 1_000;
const MAX_ID_CHARS = 256;
const MAX_STATE_CHARS = 128;
const MAX_URL_CHARS = 8_192;
const MAX_SHA_CHARS = 128;
const MAX_TITLE_CHARS = 2_000;
const MAX_BRANCH_CHARS = 1_024;
const MAX_FETCHED_AT_CHARS = 128;
const MAX_COUNT = 1_000_000_000;

export function normalizeGitLabMergeRequestDigest(
  snapshot: GitLabMergeRequestMonitorSnapshot | unknown,
): GitLabMergeRequestDigest | null {
  const root = isRecord(snapshot) ? snapshot : {};
  const mr = isRecord(root['mr']) ? root['mr'] : undefined;
  if (!mr) { return null; }
  const iid = positiveInteger(mr['iid']);
  if (iid === undefined) { return null; }

  const completeness = isRecord(root['completeness']) ? root['completeness'] : {};
  const sourceNotes = arrayFromUnknown(root['notes']);
  const sourceDiscussions = arrayFromUnknown(root['discussions']);
  const notes = sourceNotes.slice(0, MAX_SOURCE_NOTES);
  const discussions = sourceDiscussions.slice(0, MAX_SOURCE_DISCUSSIONS);
  const discussionsComplete = completeness['discussionsComplete'] === true
    && sourceDiscussions.length <= MAX_SOURCE_DISCUSSIONS;
  const notesComplete = completeness['notesComplete'] === true
    && sourceNotes.length <= MAX_SOURCE_NOTES;
  const approvalRecord = isRecord(root['approvals']) ? root['approvals'] : undefined;
  const approvalsComplete = completeness['approvalsComplete'] === true && Boolean(approvalRecord);
  const detailedMergeStatus = normalizedString(
    firstDefined(mr['detailed_merge_status'], mr['merge_status']),
    MAX_STATE_CHARS,
    'unknown',
  );

  const material: GitLabMergeRequestDigestMaterial = {
    schemaVersion: 1,
    iid,
    state: normalizedString(mr['state'], MAX_STATE_CHARS, 'unknown'),
    detailedMergeStatus,
    changesRequested: changesRequestedState(detailedMergeStatus),
    blockingDiscussionsResolved: optionalBoolean(mr['blocking_discussions_resolved']),
    reviewers: identityDigest(arrayFromUnknown(mr['reviewers']).map(userIdentity).filter(isString)),
    approval: approvalDigest(approvalRecord),
    approvalsComplete,
    unresolvedDiscussions: unresolvedDiscussionDigest(discussions),
    discussionsComplete,
    reviewActivity: reviewActivityDigest(notes, discussions),
    reviewActivityComplete: notesComplete && discussionsComplete,
    updatedAt: boundedString(mr['updated_at'], MAX_FETCHED_AT_CHARS),
  };
  assignString(material, 'url', safeProviderUrl(mr['web_url']));
  assignString(material, 'sha', boundedString(mr['sha'], MAX_SHA_CHARS));
  assignString(material, 'title', boundedString(mr['title'], MAX_TITLE_CHARS));
  assignString(material, 'sourceBranch', boundedString(mr['source_branch'], MAX_BRANCH_CHARS));
  assignString(material, 'targetBranch', boundedString(mr['target_branch'], MAX_BRANCH_CHARS));
  return buildDigest(material, boundedString(root['fetchedAt'], MAX_FETCHED_AT_CHARS));
}

export function normalizeStoredGitLabMergeRequestDigest(value: unknown): GitLabMergeRequestDigest | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) { return null; }
  const iid = positiveInteger(value['iid']);
  if (iid === undefined) { return null; }
  const material: GitLabMergeRequestDigestMaterial = {
    schemaVersion: 1,
    iid,
    state: normalizedString(value['state'], MAX_STATE_CHARS, 'unknown'),
    detailedMergeStatus: normalizedString(value['detailedMergeStatus'], MAX_STATE_CHARS, 'unknown'),
    changesRequested: optionalBoolean(value['changesRequested']),
    blockingDiscussionsResolved: optionalBoolean(value['blockingDiscussionsResolved']),
    reviewers: normalizeCountDigest(value['reviewers']),
    approval: normalizeApprovalDigest(value['approval']),
    approvalsComplete: value['approvalsComplete'] === true,
    unresolvedDiscussions: normalizeCountDigest(value['unresolvedDiscussions']),
    discussionsComplete: value['discussionsComplete'] === true,
    reviewActivity: normalizeCountDigest(value['reviewActivity']),
    reviewActivityComplete: value['reviewActivityComplete'] === true,
    updatedAt: boundedString(value['updatedAt'], MAX_FETCHED_AT_CHARS),
  };
  assignString(material, 'url', safeProviderUrl(value['url']));
  assignString(material, 'sha', boundedString(value['sha'], MAX_SHA_CHARS));
  assignString(material, 'title', boundedString(value['title'], MAX_TITLE_CHARS));
  assignString(material, 'sourceBranch', boundedString(value['sourceBranch'], MAX_BRANCH_CHARS));
  assignString(material, 'targetBranch', boundedString(value['targetBranch'], MAX_BRANCH_CHARS));
  return buildDigest(material, boundedString(value['fetchedAt'], MAX_FETCHED_AT_CHARS));
}

/**
 * Carries forward the last complete review facets when a bounded provider read
 * is partial. This permits new failures to be observed on the next complete
 * read without treating missing pages as a recovery.
 */
export function mergeGitLabMergeRequestDigest(
  previousValue: unknown,
  currentValue: unknown,
): GitLabMergeRequestDigest | null {
  const previous = normalizeStoredGitLabMergeRequestDigest(previousValue);
  const current = normalizeStoredGitLabMergeRequestDigest(currentValue);
  if (!current) { return null; }
  if (!previous || previous.iid !== current.iid) { return current; }

  const material = materialFromDigest(current);
  if (current.changesRequested === null && previous.changesRequested !== null) {
    material.changesRequested = previous.changesRequested;
  }
  if (!current.approvalsComplete && previous.approvalsComplete) {
    material.approval = previous.approval;
    material.approvalsComplete = true;
  }
  if (!current.discussionsComplete && previous.discussionsComplete) {
    material.unresolvedDiscussions = previous.unresolvedDiscussions;
    material.discussionsComplete = true;
  }
  if (!current.reviewActivityComplete && previous.reviewActivityComplete) {
    material.reviewActivity = previous.reviewActivity;
    material.reviewActivityComplete = true;
  }
  return buildDigest(material, current.fetchedAt);
}

export function compareGitLabMergeRequestDigests(
  previousValue: unknown,
  currentValue: unknown,
): GitLabMergeRequestTransition[] {
  const previous = normalizeStoredGitLabMergeRequestDigest(previousValue);
  const current = normalizeStoredGitLabMergeRequestDigest(currentValue);
  if (!previous || !current || previous.iid !== current.iid || previous.fingerprint === current.fingerprint) {
    return [];
  }

  const kinds: GitLabMergeRequestTransitionKind[] = [];
  if (previous.state !== current.state) {
    kinds.push(stateTransitionKind(previous.state, current.state));
  }
  if (current.changesRequested === true && previous.changesRequested !== true) {
    kinds.push('changes_requested');
  } else if (previous.changesRequested === true && current.changesRequested === false) {
    kinds.push('changes_request_cleared');
  }
  if (previous.approvalsComplete && current.approvalsComplete
    && approvalFingerprint(previous.approval) !== approvalFingerprint(current.approval)) {
    if (previous.approval.approved !== true && current.approval.approved === true) {
      kinds.push('approval_satisfied');
    } else if (previous.approval.approved === true && current.approval.approved === false) {
      kinds.push('approval_required');
    } else {
      kinds.push('approval_state_changed');
    }
  }
  if (previous.reviewers.fingerprint !== current.reviewers.fingerprint) {
    kinds.push('reviewers_changed');
  }
  if (current.discussionsComplete) {
    if (!previous.discussionsComplete && current.unresolvedDiscussions.count > 0) {
      kinds.push('unresolved_discussions_observed');
    } else if (previous.discussionsComplete
      && previous.unresolvedDiscussions.fingerprint !== current.unresolvedDiscussions.fingerprint) {
      if (current.unresolvedDiscussions.count > previous.unresolvedDiscussions.count) {
        kinds.push('unresolved_discussions_increased');
      } else if (current.unresolvedDiscussions.count < previous.unresolvedDiscussions.count) {
        kinds.push('unresolved_discussions_decreased');
      } else {
        kinds.push('unresolved_discussions_changed');
      }
    }
  }
  if (previous.reviewActivityComplete && current.reviewActivityComplete
    && previous.reviewActivity.fingerprint !== current.reviewActivity.fingerprint) {
    kinds.push(current.reviewActivity.count > previous.reviewActivity.count
      ? 'review_activity_added'
      : 'review_activity_changed');
  }

  return kinds.map(kind => ({
    kind,
    key: `${kind}:${current.updatedAt || current.fingerprint}:${transitionComponentFingerprint(kind, current)}`,
    previous,
    current,
  }));
}

export function gitLabMergeRequestNeedsAttention(digest: GitLabMergeRequestDigest): boolean {
  return digest.state === 'opened' && (
    digest.changesRequested === true
    || (digest.discussionsComplete && digest.unresolvedDiscussions.count > 0)
  );
}

function materialFromDigest(digest: GitLabMergeRequestDigest): GitLabMergeRequestDigestMaterial {
  const material: GitLabMergeRequestDigestMaterial = {
    schemaVersion: 1,
    iid: digest.iid,
    state: digest.state,
    detailedMergeStatus: digest.detailedMergeStatus,
    changesRequested: digest.changesRequested,
    blockingDiscussionsResolved: digest.blockingDiscussionsResolved,
    reviewers: { ...digest.reviewers },
    approval: { ...digest.approval },
    approvalsComplete: digest.approvalsComplete,
    unresolvedDiscussions: { ...digest.unresolvedDiscussions },
    discussionsComplete: digest.discussionsComplete,
    reviewActivity: { ...digest.reviewActivity },
    reviewActivityComplete: digest.reviewActivityComplete,
    updatedAt: digest.updatedAt,
  };
  assignString(material, 'url', digest.url);
  assignString(material, 'sha', digest.sha);
  assignString(material, 'title', digest.title);
  assignString(material, 'sourceBranch', digest.sourceBranch);
  assignString(material, 'targetBranch', digest.targetBranch);
  return material;
}

function buildDigest(material: GitLabMergeRequestDigestMaterial, fetchedAt: string): GitLabMergeRequestDigest {
  return {
    ...material,
    fetchedAt,
    fingerprint: stableFingerprint(material),
  };
}

function approvalDigest(value: Record<string, unknown> | undefined): GitLabMergeRequestApprovalDigest {
  if (!value) {
    return {
      available: false,
      approved: null,
      approvalsRequired: null,
      approvalsLeft: null,
      approvedByCount: 0,
      approvedByFingerprint: identityFingerprint([]),
    };
  }
  const approvedBy = arrayFromUnknown(value['approved_by'])
    .map(candidate => {
      if (!isRecord(candidate)) { return undefined; }
      const identity = userIdentity(candidate['user']);
      if (!identity) { return undefined; }
      const approvedAt = boundedString(candidate['approved_at'], MAX_FETCHED_AT_CHARS);
      return approvedAt ? `${identity}@${approvedAt}` : identity;
    })
    .filter(isString);
  const identities = uniqueSorted(approvedBy);
  return {
    available: true,
    approved: optionalBoolean(value['approved']),
    approvalsRequired: nonNegativeInteger(value['approvals_required']),
    approvalsLeft: nonNegativeInteger(value['approvals_left']),
    approvedByCount: identities.length,
    approvedByFingerprint: identityFingerprint(identities),
  };
}

function normalizeApprovalDigest(value: unknown): GitLabMergeRequestApprovalDigest {
  const record = isRecord(value) ? value : {};
  return {
    available: record['available'] === true,
    approved: optionalBoolean(record['approved']),
    approvalsRequired: nonNegativeInteger(record['approvalsRequired']),
    approvalsLeft: nonNegativeInteger(record['approvalsLeft']),
    approvedByCount: boundedCount(record['approvedByCount']),
    approvedByFingerprint: fingerprintString(record['approvedByFingerprint']),
  };
}

function normalizeCountDigest(value: unknown): GitLabMergeRequestCountDigest {
  const record = isRecord(value) ? value : {};
  return {
    count: boundedCount(record['count']),
    fingerprint: fingerprintString(record['fingerprint']),
  };
}

function identityDigest(values: string[]): GitLabMergeRequestCountDigest {
  const identities = uniqueSorted(values);
  return { count: identities.length, fingerprint: identityFingerprint(identities) };
}

function unresolvedDiscussionDigest(discussions: unknown[]): GitLabMergeRequestCountDigest {
  const identities: string[] = [];
  for (const value of discussions) {
    if (!isRecord(value)) { continue; }
    const notes = arrayFromUnknown(value['notes']).slice(0, MAX_NOTES_PER_DISCUSSION);
    const unresolved = notes.some(note => isRecord(note)
      && note['resolvable'] === true
      && note['resolved'] !== true);
    if (!unresolved) { continue; }
    const noteIds = notes.map(noteIdentity).filter(isString);
    const identity = boundedString(value['id'], MAX_ID_CHARS)
      || `notes-${identityFingerprint(noteIds)}`;
    identities.push(`${identity}:${identityFingerprint(noteIds)}`);
  }
  return identityDigest(identities);
}

function reviewActivityDigest(notes: unknown[], discussions: unknown[]): GitLabMergeRequestCountDigest {
  const identities = notes
    .filter(note => !isRecord(note) || note['system'] !== true)
    .map(noteIdentity)
    .filter(isString);
  for (const discussion of discussions) {
    if (!isRecord(discussion)) { continue; }
    identities.push(...arrayFromUnknown(discussion['notes'])
      .slice(0, MAX_NOTES_PER_DISCUSSION)
      .filter(note => !isRecord(note) || note['system'] !== true)
      .map(noteIdentity)
      .filter(isString));
  }
  return identityDigest(identities);
}

function noteIdentity(value: unknown): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const id = optionalFiniteNumberFromUnknown(value['id']);
  const updatedAt = boundedString(firstDefined(value['updated_at'], value['created_at']), MAX_ID_CHARS);
  if (id !== undefined && id >= 0) {
    return `id:${Math.floor(id)}${updatedAt ? `@${updatedAt}` : ''}`;
  }
  const createdAt = boundedString(value['created_at'], MAX_ID_CHARS);
  const author = userIdentity(value['author']);
  return createdAt ? `at:${createdAt}:${author || 'unknown'}` : undefined;
}

function userIdentity(value: unknown): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const id = optionalFiniteNumberFromUnknown(value['id']);
  if (id !== undefined && id >= 0) { return `id:${Math.floor(id)}`; }
  const username = boundedString(value['username'], MAX_ID_CHARS).toLowerCase();
  return username ? `username:${username}` : undefined;
}

function approvalFingerprint(value: GitLabMergeRequestApprovalDigest): string {
  return stableFingerprint(value);
}

function stateTransitionKind(previous: string, current: string): GitLabMergeRequestTransitionKind {
  if (current === 'merged') { return 'merge_request_merged'; }
  if (current === 'closed') { return 'merge_request_closed'; }
  if (current === 'opened' && previous !== 'opened') { return 'merge_request_reopened'; }
  return 'merge_request_state_changed';
}

function transitionComponentFingerprint(
  kind: GitLabMergeRequestTransitionKind,
  digest: GitLabMergeRequestDigest,
): string {
  if (kind.startsWith('approval_')) { return approvalFingerprint(digest.approval); }
  if (kind === 'reviewers_changed') { return digest.reviewers.fingerprint; }
  if (kind.startsWith('unresolved_discussions_')) { return digest.unresolvedDiscussions.fingerprint; }
  if (kind.startsWith('review_activity_')) { return digest.reviewActivity.fingerprint; }
  return digest.fingerprint;
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function identityFingerprint(values: string[]): string {
  return crypto.createHash('sha256').update(uniqueSorted(values).join('\u0000')).digest('hex');
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function fingerprintString(value: unknown): string {
  const normalized = optionalTrimmedStringFromUnknown(value)?.toLowerCase();
  return normalized && /^[a-f0-9]{64}$/.test(normalized) ? normalized : identityFingerprint([]);
}

function positiveInteger(value: unknown): number | undefined {
  const number = optionalFiniteNumberFromUnknown(value);
  if (number === undefined || number <= 0) { return undefined; }
  return Math.floor(number);
}

function nonNegativeInteger(value: unknown): number | null {
  const number = optionalFiniteNumberFromUnknown(value);
  if (number === undefined || number < 0) { return null; }
  return Math.min(MAX_COUNT, Math.floor(number));
}

function boundedCount(value: unknown): number {
  const number = optionalFiniteNumberFromUnknown(value);
  if (number === undefined || number < 0) { return 0; }
  return Math.min(MAX_COUNT, Math.floor(number));
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function changesRequestedState(detailedMergeStatus: string): boolean | null {
  if (detailedMergeStatus === 'requested_changes') { return true; }
  if (detailedMergeStatus === 'unknown'
    || detailedMergeStatus === 'checking'
    || detailedMergeStatus === 'approvals_syncing'
    || detailedMergeStatus === 'preparing'
    || detailedMergeStatus === 'unchecked') {
    return null;
  }
  return false;
}

function normalizedString(value: unknown, maximum: number, fallback: string): string {
  return boundedString(value, maximum).toLowerCase().replace(/[^a-z0-9_.-]+/g, '_') || fallback;
}

function boundedString(value: unknown, maximum: number): string {
  const normalized = optionalTrimmedStringFromUnknown(value);
  return normalized ? normalized.slice(0, maximum) : '';
}

function safeProviderUrl(value: unknown): string | undefined {
  const normalized = boundedString(value, MAX_URL_CHARS);
  if (!normalized) { return undefined; }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') { return undefined; }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function assignString<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | undefined): void {
  if (value !== undefined && value !== '') { target[key] = value; }
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}
