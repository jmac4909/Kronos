import type { KronosState as KronosStateSnapshot } from '../state/types';
import { optionalTrimmedStringFromUnknown, recordFromUnknown } from './records';
import { ticketStringArray } from './ticketFields';

interface CommandPayloadState {
  state?: Pick<KronosStateSnapshot, 'tickets'> | null | undefined;
}

export interface QueueCommandPayload {
  id?: string;
  ticket?: string;
  projects: string[];
  projectPath?: string;
  action: string;
}

export function stringFromUnknown(value: unknown): string | undefined {
  return optionalTrimmedStringFromUnknown(value);
}

export function resolveProjectName(state: CommandPayloadState, item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const projectName = stringFromUnknown(record['projectName']);
  if (projectName) { return projectName; }
  const ticket = recordFromUnknown(record['ticket']);
  const firstTicketProject = ticketStringArray(ticket['projects'])[0];
  if (firstTicketProject) {
    return firstTicketProject;
  }
  const ticketKey = record['ticketKey'];
  if (typeof ticketKey === 'string' && state.state) {
    const t = state.state.tickets[ticketKey];
    if (t?.projects?.length) { return t.projects[0]; }
  }
  return undefined;
}

export function explicitProjectName(item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const projectName = stringFromUnknown(record['projectName']);
  if (projectName) { return projectName; }
  const nestedItem = recordFromUnknown(record['item']);
  return stringFromUnknown(nestedItem['projectName']);
}

export function ticketProjectNamesForCommand(state: CommandPayloadState, item: unknown, ticketKey: string | undefined): string[] {
  const record = recordFromUnknown(item);
  const nestedItem = recordFromUnknown(record['item']);
  const projectSources = [
    recordFromUnknown(record['ticket'])['projects'],
    recordFromUnknown(nestedItem['ticket'])['projects'],
    ticketKey && state.state ? state.state.tickets[ticketKey]?.projects : undefined,
  ];
  for (const source of projectSources) {
    const projects = uniqueProjectNames(source);
    if (projects.length > 0) { return projects; }
  }
  return [];
}

export function uniqueProjectNames(value: unknown): string[] {
  return [...new Set(ticketStringArray(value))];
}

export function resolveRunId(item: unknown): string | undefined {
  if (typeof item === 'string' && item.trim()) { return item.trim(); }
  const record = recordFromUnknown(item);
  const runId = record['runId'];
  if (typeof runId === 'string' && runId.trim()) { return runId.trim(); }
  const id = record['id'];
  if (typeof id === 'string' && id.trim()) { return id.trim(); }
  return undefined;
}

export function resolveItemId(item: unknown): string | undefined {
  const itemId = recordFromUnknown(item)['itemId'];
  return typeof itemId === 'string' && itemId.trim() ? itemId.trim() : undefined;
}

export function resolveWorktreePath(item: unknown): string | undefined {
  const worktreePath = recordFromUnknown(item)['worktreePath'];
  return typeof worktreePath === 'string' && worktreePath.trim() ? worktreePath.trim() : undefined;
}

export function resolveRecoveryFocusId(item: unknown): string | undefined {
  return resolveItemId(item) || resolveRunId(item) || resolveWorktreePath(item);
}

export function resolveTicketKey(item: unknown): string | undefined {
  if (typeof item === 'string') { return item; }
  const record = recordFromUnknown(item);
  if (typeof record['ticketKey'] === 'string') { return record['ticketKey']; }
  const nestedItem = recordFromUnknown(record['item']);
  if (typeof nestedItem['ticket'] === 'string') { return nestedItem['ticket']; }
  if (typeof record['ticket'] === 'string') { return record['ticket']; }
  return undefined;
}

export function resolveMergeRequestUrl(item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const ticket = recordFromUnknown(record['ticket']);
  const mr = recordFromUnknown(ticket['mr']);
  return stringFromUnknown(mr['url']);
}

export function resolveQueueCommandItem(item: unknown): QueueCommandPayload | undefined {
  const record = recordFromUnknown(item);
  return queueCommandPayloadFromRecord(record)
    || queueCommandPayloadFromRecord(recordFromUnknown(record['item']));
}

export function queueCommandPayloadFromRecord(record: Record<string, unknown>): QueueCommandPayload | undefined {
  const action = record['action'];
  if (typeof action !== 'string' || !action.trim()) { return undefined; }
  const projects = ticketStringArray(record['projects']);
  const ticket = stringFromUnknown(record['ticket']);
  const id = stringFromUnknown(record['id']);
  const projectPath = stringFromUnknown(record['project_path']) || stringFromUnknown(record['projectPath']);
  const payload: QueueCommandPayload = { projects, action: action.trim() };
  if (id) { payload.id = id; }
  if (ticket) { payload.ticket = ticket; }
  if (projectPath) { payload.projectPath = projectPath; }
  return payload;
}

export function resolveQueueIndex(item: unknown): number | undefined {
  const index = recordFromUnknown(item)['index'];
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : undefined;
}

export function resolveTaskId(item: unknown): string | undefined {
  const taskId = recordFromUnknown(item)['taskId'];
  return typeof taskId === 'string' && taskId.trim() ? taskId : undefined;
}
