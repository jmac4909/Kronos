import type { QueueItem } from '../state/types';
import { skillForAction } from './nextActionContext';
import { isFreshActiveRun } from './runStatus';

export interface QueueActiveRunLike {
  project?: unknown;
  projectPath?: unknown;
  ticket?: unknown;
  skill?: unknown;
  status?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
}

export function activeRunForQueueItem<T extends QueueActiveRunLike>(
  item: QueueItem,
  runs: T[],
  now = new Date()
): T | undefined {
  return runs.find(run => isFreshActiveRun(run, now) && runMatchesQueueItem(run, item));
}

export function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean {
  if (item.ticket) {
    return runMatchesQueueTicket(run, item)
      && runMatchesQueueAction(run, item)
      && runMatchesQueueProjectScope(run, item);
  }
  return runMatchesQueueProject(run, item) && runMatchesQueueAction(run, item);
}

function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean {
  return Boolean(item.ticket && runString(run.ticket) === item.ticket);
}

function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean {
  const projects = item.projects || [];
  const runProject = runString(run.project);
  const runProjectPath = runString(run.projectPath);
  return Boolean((runProject && projects.includes(runProject)) || (runProjectPath && runProjectPath === item.project_path));
}

function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean {
  if ((item.projects || []).length === 0 && !item.project_path) {
    return true;
  }
  return runMatchesQueueProject(run, item);
}

function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean {
  return !item.action || runString(run.skill) === skillForAction(item.action);
}

function runString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
