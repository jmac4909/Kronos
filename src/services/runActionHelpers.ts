import * as fs from 'fs';

import { RUNS_DIR } from './runStore';
import { isExistingRealPathInside } from './pathUtils';
import { unknownErrorMessage } from './errorUtils';
import { isFreshActiveRun } from './runStatus';
import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './runAttention';
import { toValidDate } from './dateValues';

export interface RunActionRecord {
  id?: string;
  project?: string;
  skill?: string;
  ticket?: string;
  status?: unknown;
  startedAt?: unknown;
  cwd?: string;
  projectPath?: string;
  worktreePath?: string;
  promptPath?: string;
  logPath?: string;
  processPid?: unknown;
  pid?: unknown;
  events?: unknown;
}

export interface RunActionQuickPickItem {
  label: string;
  runCommand: string;
}

export interface RunQuickPickItem<T extends RunActionRecord = RunActionRecord> {
  label: string;
  description: string;
  detail: string;
  run: T;
}

export const RUN_ACTION_QUICK_PICK_ITEMS: RunActionQuickPickItem[] = [
  { label: 'Open Log', runCommand: 'openRunLog' },
  { label: 'Open Prompt', runCommand: 'openRunPrompt' },
  { label: 'Open Run Record', runCommand: 'openRunRecord' },
  { label: 'Open Workspace Terminal', runCommand: 'openRunWorkspace' },
  { label: 'Open Workspace Diff', runCommand: 'openRunDiff' },
  { label: 'Mark Needs Human', runCommand: 'markNeedsHuman' },
  { label: 'Pause Run', runCommand: 'pauseRun' },
  { label: 'Continue Run', runCommand: 'continueRun' },
  { label: 'Cancel Run', runCommand: 'cancelRun' },
  { label: 'Resume Run', runCommand: 'resumeRun' },
  { label: 'Retry Saved Prompt', runCommand: 'retryRun' },
  { label: 'Archive Run', runCommand: 'archiveRun' },
];

export type RunArtifactPathResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: 'missing' | 'outside-runs-dir' };

export function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult {
  if (typeof filePath !== 'string' || !filePath.trim() || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing' };
  }
  try {
    if (!fs.statSync(filePath).isFile()) {
      return { ok: false, reason: 'missing' };
    }
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Could not inspect run artifact ${filePath}.`));
    return { ok: false, reason: 'missing' };
  }
  try {
    if (!isExistingRealPathInside(filePath, RUNS_DIR)) {
      return { ok: false, reason: 'outside-runs-dir' };
    }
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Could not resolve artifact path ${filePath}.`));
    return { ok: false, reason: 'outside-runs-dir' };
  }
  return { ok: true, filePath };
}

export function isRetryableRun(run: RunActionRecord): boolean {
  return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok;
}

export function isResumableRun(run: RunActionRecord): boolean {
  return !isFreshActiveRun(run) && (
    resolveRunArtifactFile(run.promptPath).ok
    || resolveRunArtifactFile(run.logPath).ok
  );
}

export function resolveRunWorkspace(run: RunActionRecord): string | null {
  for (const candidate of [run.worktreePath, run.cwd, run.projectPath]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch (e: unknown) {
        console.warn(unknownErrorMessage(e, `Could not inspect run workspace ${candidate}.`));
      }
    }
  }
  return null;
}

export function runLastEventLabel(run: RunActionRecord): string {
  const events = Array.isArray(run.events) ? run.events : [];
  const last = events[events.length - 1];
  return typeof last?.label === 'string' ? last.label : '';
}

export function runQuickPickDetail(run: RunActionRecord): string {
  const status = String(run.status || '');
  const detail = isAttentionRunStatus(status)
    ? runAttentionDetail(run)
    : runLastEventLabel(run);
  return `${formatRunDateTime(run.startedAt)} - ${detail || run.cwd || ''}`;
}

export function runQuickPickDescription(run: RunActionRecord): string {
  const status = String(run.status || 'unknown');
  if (!isAttentionRunStatus(status)) {
    return status;
  }
  const detail = runAttentionLine(run);
  return detail ? `${status} - ${detail}` : status;
}

export function buildRunQuickPickItems<T extends RunActionRecord>(runs: T[]): RunQuickPickItem<T>[] {
  return runs.map(run => ({
    label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
    description: runQuickPickDescription(run),
    detail: runQuickPickDetail(run),
    run,
  }));
}

export function runProcessPid(run: RunActionRecord): number | undefined {
  const pid = Number(run.processPid ?? Reflect.get(run, 'pid'));
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function formatRunDateTime(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}
