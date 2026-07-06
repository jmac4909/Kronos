import type { QueueItem } from '../state/types';
import { skillForAction } from './nextActionContext';
import { projectPathKey } from './pathUtils';
import { recordString } from './records';
import { isFreshActiveRun } from './runStatus';
import { ticketStringArray } from './ticketFields';

interface QueueActiveRunLike {
  [key: string]: unknown;
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

function runMatchesQueueItem(run: QueueActiveRunLike, item: QueueItem): boolean {
  if (item.ticket) {
    return runMatchesQueueTicket(run, item)
      && runMatchesQueueAction(run, item)
      && runMatchesQueueProjectScope(run, item);
  }
  return runMatchesQueueProject(run, item) && runMatchesQueueAction(run, item);
}

function runMatchesQueueTicket(run: QueueActiveRunLike, item: QueueItem): boolean {
  return Boolean(item.ticket && recordString(run, 'ticket') === item.ticket);
}

function runMatchesQueueProject(run: QueueActiveRunLike, item: QueueItem): boolean {
  const projects = ticketStringArray(item.projects);
  const runProject = recordString(run, 'project');
  const runProjectPath = projectPathKey(recordString(run, 'projectPath'));
  const itemProjectPath = projectPathKey(item.project_path);
  return Boolean((runProject && projects.includes(runProject)) || (runProjectPath && itemProjectPath && runProjectPath === itemProjectPath));
}

function runMatchesQueueProjectScope(run: QueueActiveRunLike, item: QueueItem): boolean {
  if (ticketStringArray(item.projects).length === 0 && !item.project_path) {
    return true;
  }
  return runMatchesQueueProject(run, item);
}

function runMatchesQueueAction(run: QueueActiveRunLike, item: QueueItem): boolean {
  return !item.action || recordString(run, 'skill') === skillForAction(item.action);
}
