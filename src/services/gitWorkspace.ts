import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { safeFileStem } from './fileNames';
import { unknownErrorMessage } from './errorUtils';

export interface GitCommandOptions {
  cwd: string;
  timeoutMs?: number;
  maxBuffer?: number;
}

export type GitCommandRunner = (args: string[], options: GitCommandOptions) => string;

export interface RunWorkspaceRef {
  id?: string;
  worktreePath?: string;
  cwd?: string;
  projectPath?: string;
}

export interface WorkspaceDiffArtifact {
  cwd: string;
  filePath: string;
  status: string;
  unstagedDiff: string;
  stagedDiff: string;
}

export interface TrackedWorktreeEntry {
  projectPath: string;
  worktreePath: string;
  ticket: string;
  createdAt: string;
}

export interface WorktreeInspectionResult {
  entry: TrackedWorktreeEntry;
  status: 'removable' | 'blocked' | 'missing' | 'removed' | 'error';
  reason: string;
}

export interface WorktreeRemovalOptions {
  onRemoved?: () => void;
  runner?: GitCommandRunner;
  exists?: (filePath: string) => boolean;
}

export interface ManagedWorktreeInput {
  projectPath: string;
  worktreePath: string;
  targetRef: string;
  featureBranch: boolean;
  runner?: GitCommandRunner;
}

export interface ManagedWorktreeResult {
  checkoutRef: string;
}

export function runGit(args: string[], options: GitCommandOptions): string {
  return execFileSync('git', args, {
    cwd: options.cwd,
    encoding: 'utf-8',
    timeout: options.timeoutMs || 10000,
    windowsHide: true,
    maxBuffer: options.maxBuffer || 1024 * 1024,
  });
}

export function originProjectPath(cwd: string, runner: GitCommandRunner = runGit): string {
  const remoteRaw = runner(['remote', 'get-url', 'origin'], { cwd, timeoutMs: 5000 }).trim();
  const scpLike = remoteRaw.match(/^[^/@]+@[^:/]+:(.+)$/);
  if (scpLike) {
    return stripGitRemotePath(scpLike[1]);
  }
  try {
    const parsed = new URL(remoteRaw);
    return stripGitRemotePath(parsed.pathname);
  } catch {
    return stripGitRemotePath(remoteRaw);
  }
}

export function firstRemoteBranchMatching(cwd: string, pattern: string, runner: GitCommandRunner = runGit): string | undefined {
  const branches = runner(['branch', '-r', '--list', pattern], { cwd, timeoutMs: 5000 }).trim();
  return branches.split('\n').map(branch => branch.trim()).filter(Boolean)[0];
}

export function currentGitRef(cwd: string, runner: GitCommandRunner = runGit): string | undefined {
  try {
    return runner(['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeoutMs: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function currentGitCommit(cwd: string, runner: GitCommandRunner = runGit): string | undefined {
  try {
    return runner(['rev-parse', 'HEAD'], { cwd, timeoutMs: 5000 }).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function prepareManagedWorktree(input: ManagedWorktreeInput): ManagedWorktreeResult {
  const runner = input.runner || runGit;
  runner(['fetch', 'origin'], { cwd: input.projectPath, timeoutMs: 15000 });
  const checkoutRef = input.featureBranch ? input.targetRef.replace(/^origin\//, '') : input.targetRef;
  runner(['worktree', 'add', input.worktreePath, checkoutRef], { cwd: input.projectPath, timeoutMs: 15000 });
  try {
    runner(['pull', '--ff-only'], { cwd: input.worktreePath, timeoutMs: 10000 });
  } catch {}
  return { checkoutRef };
}

export function removeWorktreeSafely(
  projectPath: string,
  worktreePath: string,
  options: WorktreeRemovalOptions = {},
): string | null {
  const runner = options.runner || runGit;
  const entry: TrackedWorktreeEntry = { projectPath, worktreePath, ticket: '', createdAt: '' };
  const inspected = inspectTrackedWorktree(entry, options);
  if (inspected.status === 'missing') {
    options.onRemoved?.();
    return null;
  }
  if (inspected.status !== 'removable') {
    return inspected.reason;
  }
  try {
    removeIgnorableWorktreeArtifacts(worktreePath);
    runner(['worktree', 'remove', worktreePath], { cwd: projectPath, timeoutMs: 10000 });
    options.onRemoved?.();
    return null;
  } catch (e: unknown) {
    return unknownErrorMessage(e, 'Could not remove worktree safely');
  }
}

export function inspectTrackedWorktree(
  entry: TrackedWorktreeEntry,
  options: Pick<WorktreeRemovalOptions, 'runner' | 'exists'> = {},
): WorktreeInspectionResult {
  const exists = options.exists || fs.existsSync;
  const runner = options.runner || runGit;
  if (!exists(entry.worktreePath)) {
    return { entry, status: 'missing', reason: 'Tracked path no longer exists; safe to untrack.' };
  }
  try {
    const status = runner(['status', '--porcelain'], { cwd: entry.worktreePath, timeoutMs: 5000 }).trim();
    const blockingStatus = blockingWorktreeStatus(status);
    if (blockingStatus.length > 0) {
      return { entry, status: 'blocked', reason: `Dirty worktree:\n${blockingStatus.substring(0, 200)}` };
    }
    const branch = runner(['branch', '--show-current'], { cwd: entry.worktreePath, timeoutMs: 5000 }).trim();
    if (branch) {
      try {
        const remote = runner(['rev-parse', `origin/${branch}`], { cwd: entry.worktreePath, timeoutMs: 5000 }).trim();
        const local = runner(['rev-parse', 'HEAD'], { cwd: entry.worktreePath, timeoutMs: 5000 }).trim();
        if (remote !== local) {
          return { entry, status: 'blocked', reason: `Branch ${branch} has unpushed commits.` };
        }
      } catch {
        return { entry, status: 'blocked', reason: `Branch ${branch} has no matching origin branch; inspect before cleanup.` };
      }
    }
    return { entry, status: 'removable', reason: 'Clean worktree with no unpushed branch state detected.' };
  } catch (e: unknown) {
    return { entry, status: 'error', reason: unknownErrorMessage(e, 'Could not inspect worktree.') };
  }
}

function blockingWorktreeStatus(status: string): string {
  return status
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0 && !isIgnorableWorktreeStatusLine(line))
    .join('\n');
}

function isIgnorableWorktreeStatusLine(line: string): boolean {
  if (!line.startsWith('?? ')) {
    return false;
  }
  const statusPath = line.slice(3).trim();
  return statusPath === '.claude' || statusPath === '.claude/' || statusPath.startsWith('.claude/');
}

function removeIgnorableWorktreeArtifacts(worktreePath: string): void {
  const dotClaudePath = path.join(worktreePath, '.claude');
  if (fs.existsSync(dotClaudePath)) {
    fs.rmSync(dotClaudePath, { recursive: true, force: true });
  }
}

export function createWorkspaceDiffArtifact(
  run: RunWorkspaceRef,
  outputDir: string,
  runner: GitCommandRunner = runGit,
): WorkspaceDiffArtifact {
  const cwd = resolveWorkspacePath(run);
  if (!cwd || !fs.existsSync(cwd)) {
    throw new Error('Run workspace no longer exists.');
  }

  const status = runner(['status', '--short'], { cwd, timeoutMs: 10000, maxBuffer: 1024 * 1024 });
  const unstagedDiff = runner(['diff', '--'], { cwd, timeoutMs: 15000, maxBuffer: 10 * 1024 * 1024 });
  const stagedDiff = runner(['diff', '--cached', '--'], { cwd, timeoutMs: 15000, maxBuffer: 10 * 1024 * 1024 });
  const runId = safeFileStem(String(run.id || 'run'), { fallback: 'run' });
  const filePath = path.join(outputDir, `${runId}.workspace.diff.txt`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, [
    `Kronos run diff: ${run.id || ''}`,
    `Workspace: ${cwd}`,
    '',
    '## git status --short',
    formatGitOutput(status, '(clean)'),
    '',
    '## git diff --',
    formatGitOutput(unstagedDiff, '(no unstaged diff)'),
    '',
    '## git diff --cached --',
    formatGitOutput(stagedDiff, '(no staged diff)'),
    '',
  ].join('\n'));

  return {
    cwd,
    filePath,
    status,
    unstagedDiff,
    stagedDiff,
  };
}

function resolveWorkspacePath(run: RunWorkspaceRef): string | undefined {
  return [run.worktreePath, run.cwd, run.projectPath].find(candidate => Boolean(candidate?.trim()));
}

function formatGitOutput(output: string, fallback: string): string {
  const trimmedRight = output.replace(/\s+$/, '');
  return trimmedRight.trim().length > 0 ? trimmedRight : fallback;
}

function stripGitRemotePath(value: string): string {
  return value.replace(/^\/+/, '').replace(/\.git$/, '');
}
