import { ScriptRunOptions, runGitlabJson, runPipelineJson } from './scriptClient';
import { MergeRequestChangedFile } from '../state/types';
import { normalizeChangedFiles } from './changedFiles';

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
  } catch (e: any) {
    throw new Error(`Invalid JSON from ${label}: ${e?.message || 'parse failed'}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
