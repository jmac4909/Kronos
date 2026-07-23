import * as path from 'path';
import * as vscode from 'vscode';
import { boundedOperationFailure } from './errorUtils';
import { readProjectGitBranch } from './projectCatalog';

export interface ProjectGitChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface ProjectGitBranchRef {
  name: string;
  kind: 'local' | 'remote';
  current: boolean;
}

export interface ProjectGitEvidence {
  projectPath: string;
  branch?: string;
  detached: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
  branches: ProjectGitBranchRef[];
  branchCount: number;
  branchesTruncated: boolean;
  changes: ProjectGitChange[];
  changeCount: number;
  diff: string;
  diffTruncated: boolean;
  available: boolean;
  warning?: string;
}

interface GitChangeLike {
  uri: vscode.Uri;
  status: number;
}

interface GitRefLike {
  type?: number;
  name?: string;
  remote?: string;
}

interface GitHeadLike {
  name?: string;
  commit?: string;
  upstream?: { name?: string; remote?: string };
  ahead?: number;
  behind?: number;
}

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  state: {
    HEAD?: GitHeadLike;
    refs?: GitRefLike[];
    mergeChanges: GitChangeLike[];
    indexChanges: GitChangeLike[];
    workingTreeChanges: GitChangeLike[];
    untrackedChanges?: GitChangeLike[];
  };
  diffWithHEAD(): Promise<string>;
}

interface GitApiLike {
  repositories: GitRepositoryLike[];
  getRepository(uri: vscode.Uri): GitRepositoryLike | null;
  openRepository(root: vscode.Uri): Promise<void>;
}

interface GitExtensionLike {
  enabled: boolean;
  getAPI(version: 1): GitApiLike;
}

const MAX_CHANGES = 500;
const MAX_DIFF_CHARS = 512 * 1024;
const MAX_BRANCHES = 200;

/** Reads only VS Code's built-in Git model. No Git command or mutation is issued by Kronos. */
export async function readProjectGitEvidence(
  projectPathValue: string,
  options: { includeDiff?: boolean; openRepositoryIfNeeded?: boolean } = {},
): Promise<ProjectGitEvidence> {
  const projectPath = path.resolve(projectPathValue);
  const fallback = readProjectGitBranch(projectPath);
  const fallbackBranch = fallback?.branch;
  const fallbackBranches: ProjectGitBranchRef[] = fallbackBranch && !fallback?.detached
    ? [{ name: fallbackBranch, kind: 'local', current: true }]
    : [];
  const base: ProjectGitEvidence = {
    projectPath,
    ...(fallbackBranch ? { branch: fallbackBranch } : {}),
    detached: Boolean(fallback?.detached),
    branches: fallbackBranches,
    branchCount: fallbackBranches.length,
    branchesTruncated: false,
    changes: [],
    changeCount: 0,
    diff: '',
    diffTruncated: false,
    available: false,
  };
  try {
    const extension = vscode.extensions.getExtension<GitExtensionLike>('vscode.git');
    if (!extension) { return { ...base, warning: 'VS Code built-in Git extension is unavailable.' }; }
    const gitExtension = extension.isActive ? extension.exports : await extension.activate();
    if (!gitExtension?.enabled) { return { ...base, warning: 'VS Code built-in Git extension is disabled.' }; }
    const api = gitExtension.getAPI(1);
    const uri = vscode.Uri.file(projectPath);
    let repository = api.getRepository(uri) || api.repositories.find(candidate => samePath(candidate.rootUri.fsPath, projectPath));
    if (!repository && options.openRepositoryIfNeeded) {
      await api.openRepository(uri);
      repository = api.getRepository(uri) || api.repositories.find(candidate => samePath(candidate.rootUri.fsPath, projectPath));
    }
    if (!repository) { return { ...base, warning: 'This project is not open in VS Code’s Git model yet.' }; }

    const changeGroups: Array<{ staged: boolean; changes: GitChangeLike[] }> = [
      { staged: true, changes: repository.state.indexChanges || [] },
      { staged: false, changes: repository.state.workingTreeChanges || [] },
      { staged: false, changes: repository.state.untrackedChanges || [] },
      { staged: false, changes: repository.state.mergeChanges || [] },
    ];
    const allChanges = changeGroups.flatMap(group => group.changes.map(change => ({ group, change })));
    const changes = allChanges.slice(0, MAX_CHANGES).map(({ group, change }) => ({
      path: relativeChangePath(projectPath, change.uri.fsPath),
      status: gitStatusLabel(change.status),
      staged: group.staged,
    }));
    let diff = '';
    const warnings: string[] = [];
    if (options.includeDiff !== false) {
      try { diff = await repository.diffWithHEAD(); }
      catch (error: unknown) {
        warnings.push(boundedOperationFailure(
          error,
          'Git status is available, but the diff could not be read.',
        ).display);
      }
    }
    let diffTruncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated by Kronos at ${MAX_DIFF_CHARS} characters.]\n`;
      diffTruncated = true;
    }
    const head = repository.state.HEAD;
    const branch = head?.name || fallbackBranch;
    const allBranches = projectGitBranches(repository.state.refs, branch);
    const branchesTruncated = allBranches.length > MAX_BRANCHES;
    if (allChanges.length > MAX_CHANGES) {
      warnings.push(`Only the first ${MAX_CHANGES} changed paths are shown.`);
    }
    if (branchesTruncated) {
      warnings.push(`Only the first ${MAX_BRANCHES} branches are shown.`);
    }
    const upstream = projectGitUpstream(head?.upstream);
    const ahead = boundedNonNegativeInteger(head?.ahead);
    const behind = boundedNonNegativeInteger(head?.behind);
    return {
      projectPath,
      ...(branch ? { branch } : {}),
      detached: Boolean(head && !head.name) || (!head && Boolean(fallback?.detached)),
      ...(upstream ? { upstream } : {}),
      ...(ahead !== undefined ? { ahead } : {}),
      ...(behind !== undefined ? { behind } : {}),
      branches: allBranches.slice(0, MAX_BRANCHES),
      branchCount: allBranches.length,
      branchesTruncated,
      changes,
      changeCount: allChanges.length,
      diff,
      diffTruncated,
      available: true,
      ...(warnings.length > 0 ? { warning: warnings.join(' ') } : {}),
    };
  } catch (error: unknown) {
    return {
      ...base,
      warning: boundedOperationFailure(error, 'VS Code Git status could not be read.').display,
    };
  }
}

export function renderProjectGitEvidence(projectName: string, evidence: ProjectGitEvidence): string {
  const lines = [
    `# Git working tree — ${singleLine(projectName, 200) || 'Project'}`,
    '',
    `- Path: ${evidence.projectPath}`,
    `- Branch: ${evidence.branch || 'unavailable'}`,
    `- Upstream: ${evidence.upstream || 'unavailable'}`,
    `- Branches: ${evidence.branchCount}${evidence.branchesTruncated ? ' (list truncated)' : ''}`,
    `- Sync: ${evidence.ahead ?? 0} ahead / ${evidence.behind ?? 0} behind`,
    `- Changes: ${evidence.changeCount}`,
    `- Source: ${evidence.available ? 'VS Code built-in Git model (read-only)' : 'Git status unavailable'}`,
    ...(evidence.warning ? [`- Warning: ${evidence.warning}`] : []),
    '',
    '## Status',
    '',
    ...(evidence.changes.length > 0
      ? evidence.changes.map(change => `- ${change.staged ? 'staged' : 'working'} ${change.status}: ${change.path}`)
      : ['Clean working tree or no readable changes.']),
    '',
    '## Diff against HEAD',
    '',
    evidence.diff ? '```diff' : '',
    evidence.diff || 'No textual diff was returned. Untracked/binary files may appear only in Status.',
    evidence.diff ? '```' : '',
    '',
  ];
  return lines.join('\n');
}

function projectGitBranches(refs: GitRefLike[] | undefined, currentBranch: string | undefined): ProjectGitBranchRef[] {
  const branches = new Map<string, ProjectGitBranchRef>();
  for (const ref of Array.isArray(refs) ? refs : []) {
    const name = singleLine(ref?.name || '', 500);
    if (!name || ref?.type === 2 || (ref?.type !== undefined && ref.type !== 0 && ref.type !== 1)) { continue; }
    const kind: ProjectGitBranchRef['kind'] = ref.type === 1 || Boolean(ref.remote) ? 'remote' : 'local';
    const key = `${kind}:${name}`;
    branches.set(key, { name, kind, current: kind === 'local' && name === currentBranch });
  }
  if (currentBranch && !currentBranch.startsWith('detached@')) {
    const key = `local:${currentBranch}`;
    branches.set(key, { name: currentBranch, kind: 'local', current: true });
  }
  return [...branches.values()].sort((left, right) => {
    if (left.current !== right.current) { return left.current ? -1 : 1; }
    if (left.kind !== right.kind) { return left.kind === 'local' ? -1 : 1; }
    return left.name.localeCompare(right.name);
  });
}

function projectGitUpstream(value: GitHeadLike['upstream']): string | undefined {
  const name = singleLine(value?.name || '', 500);
  const remote = singleLine(value?.remote || '', 200);
  if (!name) { return undefined; }
  return remote && !name.startsWith(`${remote}/`) ? `${remote}/${name}` : name;
}

function boundedNonNegativeInteger(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function relativeChangePath(projectPath: string, filePath: string): string {
  const relative = path.relative(projectPath, filePath);
  return relative && !relative.startsWith('..') ? relative : path.basename(filePath);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function singleLine(value: string, maxLength: number): string {
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function gitStatusLabel(status: number): string {
  return [
    'index modified', 'index added', 'index deleted', 'index renamed', 'index copied',
    'modified', 'deleted', 'untracked', 'ignored', 'intent to add', 'intent to rename',
    'type changed', 'added by us', 'added by them', 'deleted by us', 'deleted by them',
    'both added', 'both deleted', 'both modified',
  ][status] || `status ${status}`;
}
