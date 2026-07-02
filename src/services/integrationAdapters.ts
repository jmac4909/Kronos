import { ScriptRunOptions, runGitlabJson, runPipelineJson } from './scriptClient';
import { MergeRequest, MergeRequestChangedFile } from '../state/types';
import { normalizeChangedFiles } from './changedFiles';
import { unknownErrorMessage } from './errorUtils';

export interface KronosScriptRunner {
  runScript(args: string[], options?: ScriptRunOptions): Promise<string>;
}

export interface MergeRequestDiffResult {
  mr: {
    title?: string;
    iid?: number;
    source_branch?: string;
    target_branch?: string;
    author?: string;
    [key: string]: unknown;
  };
  files: MergeRequestChangedFile[];
  [key: string]: unknown;
}

export interface MergeRequestComment {
  id?: string;
  author?: string;
  created?: string;
  body: string;
}

export interface MergeRequestStatusResult {
  state?: MergeRequest['state'];
  review_status?: MergeRequest['review_status'];
  url?: string;
  title?: string;
  author?: string;
  source_branch?: string;
  target_branch?: string;
  sourceBranch?: string;
  targetBranch?: string;
  branch?: string;
  head_branch?: string;
  comment_count?: number;
  last_comment_at?: string;
  comments: MergeRequestComment[];
  [key: string]: unknown;
}

export interface SonarBranch {
  name: string;
  isMain: boolean;
  status?: {
    qualityGateStatus?: string;
  };
}

export interface SonarBranchSummary {
  branches: SonarBranch[];
}

export interface JiraComment {
  author?: string;
  authorName?: string;
  created?: string;
  body: string;
}

export const jiraAdapter = {
  async ticketComments(runner: KronosScriptRunner, ticketKey: string): Promise<JiraComment[]> {
    const parsed = parseJson(await runner.runScript(['--ticket-comments', ticketKey]), `Jira comments for ${ticketKey}`);
    return normalizeJiraComments(parsed);
  },
};

export const gitlabAdapter = {
  async mergeRequestDiff(runner: KronosScriptRunner, ticketKey: string, options: ScriptRunOptions = {}): Promise<MergeRequestDiffResult> {
    const parsed = parseJson(await runner.runScript(['--mr-diff', ticketKey], options), `MR diff for ${ticketKey}`);
    const data = isRecord(parsed) ? parsed : {};
    if (data.error) {
      throw new Error(String(data.error));
    }
    return {
      ...data,
      mr: isRecord(data.mr) ? data.mr : {},
      files: normalizeChangedFiles(data.files),
    };
  },

  async mergeRequestBranch(runner: KronosScriptRunner, ticketKey: string): Promise<string> {
    const parsed = parseJson(await runner.runScript(['--mr-branch', ticketKey]), `MR branch for ${ticketKey}`);
    const data = isRecord(parsed) ? parsed : {};
    return typeof data.branch === 'string' && data.branch.trim() ? data.branch.trim() : ticketKey;
  },

  async mergeRequestStatus(runner: KronosScriptRunner, ticketKey: string, options: ScriptRunOptions = {}): Promise<MergeRequestStatusResult> {
    const parsed = parseJson(await runner.runScript(['--mr-diff', ticketKey], options), `MR status for ${ticketKey}`);
    const data = isRecord(parsed) ? parsed : {};
    if (data.error) {
      throw new Error(String(data.error));
    }
    return normalizeMergeRequestStatus(data);
  },

  async projectId(gitlabPath: string): Promise<number | null> {
    const parsed = await runGitlabJson<unknown>(['--project-id', gitlabPath], { timeout: 15000 });
    const data = isRecord(parsed) ? parsed : {};
    return typeof data.id === 'number' ? data.id : null;
  },
};

export const sonarAdapter = {
  async projectKey(projectName: string): Promise<string | null> {
    const parsed = await runPipelineJson<unknown>(['--find-sonar-key', projectName], { timeout: 15000 });
    const data = isRecord(parsed) ? parsed : {};
    return typeof data.sonar_project_key === 'string' && data.sonar_project_key.trim() ? data.sonar_project_key.trim() : null;
  },

  async branches(sonarKey: string): Promise<SonarBranchSummary> {
    const parsed = await runPipelineJson<unknown>(['--sonar-branches', sonarKey], { timeout: 15000 });
    const data = isRecord(parsed) ? parsed : {};
    return { branches: normalizeSonarBranches(data.branches) };
  },

  gate(sonarKey: string, branch: string): Promise<unknown> {
    return runPipelineJson<unknown>(['--sonar-gate', sonarKey, '--branch', branch]);
  },

  measures(sonarKey: string, branch: string): Promise<unknown> {
    return runPipelineJson<unknown>(['--sonar-measures', sonarKey, '--branch', branch]);
  },

  issues(sonarKey: string, branch: string): Promise<unknown> {
    return runPipelineJson<unknown>(['--sonar-issues', sonarKey, '--branch', branch]);
  },
};

export function normalizeSonarBranches(value: unknown): SonarBranch[] {
  if (!Array.isArray(value)) { return []; }
  const normalized: SonarBranch[] = [];
  for (const item of value) {
    const branch = normalizeSonarBranch(item);
    if (branch) {
      normalized.push(branch);
    }
  }
  return normalized;
}

export function normalizeJiraComments(value: unknown): JiraComment[] {
  const rawComments = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.comments)
      ? value.comments
      : [];
  return rawComments.slice(0, 100).map(normalizeJiraComment);
}

export function normalizeMergeRequestStatus(value: unknown): MergeRequestStatusResult {
  const data = isRecord(value) ? value : {};
  const mr = isRecord(data.mr) ? data.mr : data;
  const commentsSource = firstDefined(data.comments, data.notes, data.discussions, mr.comments, mr.notes, mr.discussions);
  const comments = commentsSource === undefined ? [] : normalizeMergeRequestComments(commentsSource);
  const latestComment = latestCommentAt(comments);
  const status: MergeRequestStatusResult = {
    comments,
  };

  const state = normalizeMergeRequestState(firstDefined(mr.state, data.state));
  if (state) { status.state = state; }
  const reviewStatus = normalizeReviewStatus(firstDefined(
    mr.review_status,
    mr.reviewStatus,
    data.review_status,
    data.reviewStatus,
    mr.approved,
    data.approved,
    isRecord(mr.approvals) ? mr.approvals.approved : undefined,
  ));
  if (reviewStatus) { status.review_status = reviewStatus; }
  copyString(status, 'url', firstDefined(mr.url, data.url, mr.web_url, data.web_url));
  copyString(status, 'title', firstDefined(mr.title, data.title));
  copyString(status, 'author', firstDefined(
    isRecord(mr.author) ? firstDefined(mr.author.name, mr.author.username) : undefined,
    isRecord(data.author) ? firstDefined(data.author.name, data.author.username) : undefined,
    mr.author,
    data.author,
  ));
  copyString(status, 'source_branch', firstDefined(mr.source_branch, data.source_branch));
  copyString(status, 'target_branch', firstDefined(mr.target_branch, data.target_branch));
  copyString(status, 'sourceBranch', firstDefined(mr.sourceBranch, data.sourceBranch));
  copyString(status, 'targetBranch', firstDefined(mr.targetBranch, data.targetBranch));
  copyString(status, 'branch', firstDefined(mr.branch, data.branch));
  copyString(status, 'head_branch', firstDefined(mr.head_branch, data.head_branch));
  if (commentsSource !== undefined) {
    status.comment_count = comments.length;
    if (latestComment) { status.last_comment_at = latestComment; }
  }
  return status;
}

export function normalizeMergeRequestComments(value: unknown): MergeRequestComment[] {
  if (!Array.isArray(value)) { return []; }
  const flattened = value.flatMap(item => isRecord(item) && Array.isArray(item.notes) ? item.notes : [item]);
  return flattened.slice(0, 100).map(normalizeMergeRequestComment);
}

function normalizeJiraComment(value: unknown): JiraComment {
  if (!isRecord(value)) {
    return { body: String(value ?? '') };
  }
  const author = stringField(value.author)
    || (isRecord(value.author) ? stringField(value.author.displayName) || stringField(value.author.name) : undefined);
  const authorName = stringField(value.authorName);
  const created = stringField(value.created);
  const body = stringField(value.body) || stringField(value.renderedBody) || '';
  return {
    ...(author ? { author } : {}),
    ...(authorName ? { authorName } : {}),
    ...(created ? { created } : {}),
    body,
  };
}

function normalizeMergeRequestComment(value: unknown): MergeRequestComment {
  if (!isRecord(value)) {
    return { body: String(value ?? '') };
  }
  const author = stringField(value.author)
    || (isRecord(value.author) ? stringField(value.author.name) || stringField(value.author.username) : undefined);
  const idValue = value.id;
  const id = typeof idValue === 'string' || typeof idValue === 'number' ? String(idValue).trim() : '';
  const created = stringField(value.created_at) || stringField(value.created);
  const body = stringField(value.body) || stringField(value.note) || '';
  return {
    ...(id ? { id } : {}),
    ...(author ? { author } : {}),
    ...(created ? { created } : {}),
    body,
  };
}

function normalizeSonarBranch(value: unknown): SonarBranch | null {
  if (typeof value === 'string') {
    const name = value.trim();
    return name ? { name, isMain: false } : null;
  }
  if (!isRecord(value)) { return null; }
  const rawName = value.name;
  if (typeof rawName !== 'string' || !rawName.trim()) { return null; }
  const status = isRecord(value.status) ? normalizeSonarBranchStatus(value.status) : undefined;
  return {
    name: rawName.trim(),
    isMain: value.isMain === true,
    ...(status ? { status } : {}),
  };
}

function normalizeSonarBranchStatus(value: Record<string, unknown>): SonarBranch['status'] | undefined {
  const rawGate = value.qualityGateStatus;
  if (typeof rawGate !== 'string' || !rawGate.trim()) { return undefined; }
  return { qualityGateStatus: rawGate.trim() };
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e: unknown) {
    throw new Error(`Invalid JSON from ${label}: ${unknownErrorMessage(e, 'parse failed')}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function copyString(target: Record<string, unknown>, key: string, value: unknown): void {
  const str = stringField(value);
  if (str) { target[key] = str; }
}

function normalizeMergeRequestState(value: unknown): MergeRequest['state'] | undefined {
  const normalized = stringField(value)?.toLowerCase();
  if (normalized === 'open') { return 'opened'; }
  if (normalized === 'opened' || normalized === 'merged' || normalized === 'closed') {
    return normalized;
  }
  return undefined;
}

function normalizeReviewStatus(value: unknown): MergeRequest['review_status'] | undefined {
  if (value === true) { return 'approved'; }
  const normalized = stringField(value)?.toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'approved' || normalized === 'changes_requested' || normalized === 'pending_review') {
    return normalized;
  }
  if (normalized === 'changes_requested_by_reviewer') { return 'changes_requested'; }
  return undefined;
}

function latestCommentAt(comments: MergeRequestComment[]): string | undefined {
  return comments
    .map(comment => comment.created)
    .filter((created): created is string => Boolean(created))
    .sort()
    .at(-1);
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
