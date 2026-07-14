import * as path from 'path';
import * as vscode from 'vscode';
import { readProjectGitBranch } from './projectCatalog';

export interface ProjectGitChange {
  path: string;
  status: string;
  staged: boolean;
}

export interface ProjectGitEvidence {
  projectPath: string;
  branch?: string;
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

interface GitRepositoryLike {
  rootUri: vscode.Uri;
  state: {
    HEAD?: { name?: string };
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

/** Reads only VS Code's built-in Git model. No Git command or mutation is issued by Kronos. */
export async function readProjectGitEvidence(
  projectPathValue: string,
  options: { includeDiff?: boolean; openRepositoryIfNeeded?: boolean } = {},
): Promise<ProjectGitEvidence> {
  const projectPath = path.resolve(projectPathValue);
  const fallbackBranch = readProjectGitBranch(projectPath)?.branch;
  const base: ProjectGitEvidence = {
    projectPath,
    ...(fallbackBranch ? { branch: fallbackBranch } : {}),
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
    let warning: string | undefined;
    if (options.includeDiff !== false) {
      try { diff = await repository.diffWithHEAD(); }
      catch (error: unknown) {
        warning = error instanceof Error
          ? `Git status is available, but the diff could not be read: ${singleLine(error.message, 500)}`
          : 'Git status is available, but the diff could not be read.';
      }
    }
    let diffTruncated = false;
    if (diff.length > MAX_DIFF_CHARS) {
      diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[Diff truncated by Kronos at ${MAX_DIFF_CHARS} characters.]\n`;
      diffTruncated = true;
    }
    const branch = repository.state.HEAD?.name || fallbackBranch;
    return {
      projectPath,
      ...(branch ? { branch } : {}),
      changes,
      changeCount: allChanges.length,
      diff,
      diffTruncated,
      available: true,
      ...((warning || allChanges.length > MAX_CHANGES) ? {
        warning: [
          warning,
          ...(allChanges.length > MAX_CHANGES ? [`Only the first ${MAX_CHANGES} changed paths are shown.`] : []),
        ].filter(Boolean).join(' '),
      } : {}),
    };
  } catch (error: unknown) {
    return { ...base, warning: error instanceof Error ? error.message : 'VS Code Git status could not be read.' };
  }
}

export function renderProjectGitEvidence(projectName: string, evidence: ProjectGitEvidence): string {
  const lines = [
    `# Git working tree — ${singleLine(projectName, 200) || 'Project'}`,
    '',
    `- Path: ${evidence.projectPath}`,
    `- Branch: ${evidence.branch || 'unavailable'}`,
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

function relativeChangePath(projectPath: string, filePath: string): string {
  const relative = path.relative(projectPath, filePath);
  return relative && !relative.startsWith('..') ? relative : path.basename(filePath);
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => process.platform === 'win32'
    ? path.resolve(value).toLocaleLowerCase()
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
