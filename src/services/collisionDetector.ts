import { MergeRequestChangedFile, QueueState, Ticket } from '../state/types';
import { isCodeAction } from './actionSemantics';
import { changedFilePaths } from './changedFiles';
import { isActiveRun, isStaleActiveRun } from './runStatus';

export type CollisionSeverity = 'high' | 'medium' | 'low';
export type CollisionKind = 'active_run' | 'queued_ticket' | 'queued_project' | 'open_mr' | 'recent_file' | 'ticket_area' | 'mr_file';

export interface CollisionRun {
  id: string;
  project?: string;
  ticket?: string;
  skill?: string;
  status?: string;
  startedAt?: string;
  endedAt?: string;
  events?: Array<{ label?: string; detail?: string; timestamp?: string }>;
}

export interface DispatchCollisionInput {
  ticketKey?: string | null;
  projects: string[];
  action: string;
  queue?: QueueState | null;
  runs?: CollisionRun[];
  tickets?: Record<string, Ticket>;
  mrFiles?: Record<string, MergeRequestChangedFile[]>;
  excludeQueueItemId?: string;
  now?: Date;
  recentRunHours?: number;
  staleActiveRunHours?: number;
}

export interface DispatchCollision {
  id: string;
  kind: CollisionKind;
  severity: CollisionSeverity;
  title: string;
  detail: string;
}

export function detectDispatchCollisions(input: DispatchCollisionInput): DispatchCollision[] {
  const targetProjects = new Set((input.projects || []).filter(Boolean));
  const ticketKey = input.ticketKey || '';
  const codeAction = isCodeAction(input.action);
  const now = input.now || new Date();
  const recentRunHours = input.recentRunHours || 48;
  const staleActiveRunHours = input.staleActiveRunHours ?? 12;
  const targetTicket = ticketKey ? input.tickets?.[ticketKey] : undefined;
  const targetArea = targetTicket ? ticketAreaTokens(targetTicket) : new Set<string>();
  const targetMrFiles = ticketKey ? changedFilesForTicket(ticketKey, targetTicket, input.mrFiles) : [];
  const collisions: DispatchCollision[] = [];

  for (const run of input.runs || []) {
    const isActive = isCollisionActiveRun(run, now, staleActiveRunHours);
    if (isActive && ticketKey && run.ticket === ticketKey) {
      collisions.push({
        id: `run-ticket:${run.id}`,
        kind: 'active_run',
        severity: 'high',
        title: `Active run already working ${ticketKey}`,
        detail: runDetail(run),
      });
      continue;
    }
    if (isActive && run.project && targetProjects.has(run.project) && codeAction) {
      collisions.push({
        id: `run-project:${run.id}`,
        kind: 'active_run',
        severity: 'medium',
        title: `Active run already in ${run.project}`,
        detail: runDetail(run),
      });
    }
    const editedFiles = editedFilesForRun(run);
    if (
      codeAction &&
      run.project &&
      targetProjects.has(run.project) &&
      run.ticket !== ticketKey &&
      editedFiles.length > 0 &&
      (isActive || isRecentRun(run, now, recentRunHours))
    ) {
      collisions.push({
        id: `run-files:${run.id}`,
        kind: 'recent_file',
        severity: isActive ? 'medium' : 'low',
        title: `${run.ticket || run.skill || 'Recent run'} changed files in ${run.project}`,
        detail: `${editedFiles.slice(0, 6).join(', ')}${editedFiles.length > 6 ? ` and ${editedFiles.length - 6} more` : ''}`,
      });
    }
  }

  for (const item of input.queue?.items || []) {
    if (input.excludeQueueItemId && item.id === input.excludeQueueItemId) { continue; }
    if (ticketKey && item.ticket === ticketKey) {
      collisions.push({
        id: `queue-ticket:${item.id}`,
        kind: 'queued_ticket',
        severity: 'high',
        title: `${ticketKey} is already queued`,
        detail: `${item.action}: ${item.reason || 'No reason recorded'}`,
      });
      continue;
    }
    if (codeAction && item.projects?.some(project => targetProjects.has(project)) && isCodeAction(item.action)) {
      collisions.push({
        id: `queue-project:${item.id}`,
        kind: 'queued_project',
        severity: 'low',
        title: `Queued code work already targets ${item.projects.filter(project => targetProjects.has(project)).join(', ')}`,
        detail: `${item.ticket || 'unticketed'} ${item.action}: ${item.reason || 'No reason recorded'}`,
      });
    }
    const queuedTicket = item.ticket ? input.tickets?.[item.ticket] : undefined;
    if (codeAction && item.ticket && item.ticket !== ticketKey && queuedTicket) {
      const overlap = sharedAreaTokens(targetArea, ticketAreaTokens(queuedTicket));
      if (overlap.length > 0 && item.projects?.some(project => targetProjects.has(project))) {
        collisions.push({
          id: `queue-area:${item.id}`,
          kind: 'ticket_area',
          severity: 'low',
          title: `Queued ${item.ticket} appears to share ticket area`,
          detail: `Shared area: ${overlap.slice(0, 5).join(', ')}`,
        });
      }
    }
  }

  if (codeAction) {
    for (const [otherKey, ticket] of Object.entries(input.tickets || {})) {
      if (otherKey === ticketKey || !ticket.mr || ticket.mr.state !== 'opened') { continue; }
      if (!ticket.projects?.some(project => targetProjects.has(project))) { continue; }
      collisions.push({
        id: `mr:${otherKey}:${ticket.mr.iid}`,
        kind: 'open_mr',
        severity: 'low',
        title: `Open MR for ${otherKey} shares ${ticket.projects.filter(project => targetProjects.has(project)).join(', ')}`,
        detail: `MR !${ticket.mr.iid} is ${ticket.mr.review_status.replace(/_/g, ' ')}`,
      });
      const mrFiles = changedFilesForTicket(otherKey, ticket, input.mrFiles);
      const directOverlap = sharedFilePaths(targetMrFiles, mrFiles);
      if (directOverlap.length > 0) {
        collisions.push({
          id: `mr-file:${otherKey}:${ticket.mr.iid}:direct`,
          kind: 'mr_file',
          severity: 'high',
          title: `Open MR for ${otherKey} edits the same files`,
          detail: `${directOverlap.slice(0, 6).join(', ')}${directOverlap.length > 6 ? ` and ${directOverlap.length - 6} more` : ''}`,
        });
      } else {
        const matchedFiles = filesMatchingArea(targetArea, mrFiles);
        if (matchedFiles.length > 0) {
          collisions.push({
            id: `mr-file:${otherKey}:${ticket.mr.iid}:area`,
            kind: 'mr_file',
            severity: ticket.mr.review_status === 'changes_requested' ? 'medium' : 'low',
            title: `Open MR for ${otherKey} edits likely related files`,
            detail: `${matchedFiles.slice(0, 6).join(', ')}${matchedFiles.length > 6 ? ` and ${matchedFiles.length - 6} more` : ''}`,
          });
        }
      }
      const overlap = sharedAreaTokens(targetArea, ticketAreaTokens(ticket));
      if (overlap.length > 0) {
        collisions.push({
          id: `mr-area:${otherKey}:${ticket.mr.iid}`,
          kind: 'ticket_area',
          severity: ticket.mr.review_status === 'changes_requested' ? 'medium' : 'low',
          title: `Open MR for ${otherKey} appears to share ticket area`,
          detail: `Shared area: ${overlap.slice(0, 5).join(', ')}`,
        });
      }
    }
  }

  return dedupeCollisions(collisions).sort(compareCollisions);
}

function editedFilesForRun(run: CollisionRun): string[] {
  const files = new Set<string>();
  const events = Array.isArray(run.events) ? run.events : [];
  for (const event of events) {
    const label = String(event.label || '');
    const match = label.match(/^(?:Editing|Writing)\s+(.+)$/);
    if (match?.[1]) {
      files.add(match[1]);
    }
  }
  return Array.from(files).sort();
}

function changedFilesForTicket(ticketKey: string, ticket: Ticket | undefined, mrFiles?: Record<string, MergeRequestChangedFile[]>): string[] {
  const files = new Set<string>();
  for (const file of mrFiles?.[ticketKey] || []) {
    addChangedFilePaths(files, file);
  }
  for (const file of ticket?.mr?.files || []) {
    addChangedFilePaths(files, file);
  }
  for (const file of ticket?.mr?.changed_files || []) {
    addChangedFilePaths(files, file);
  }
  return Array.from(files).sort();
}

function addChangedFilePaths(files: Set<string>, file: MergeRequestChangedFile | string): void {
  for (const normalized of changedFilePaths(file)) {
    files.add(normalized);
  }
}

function sharedFilePaths(a: string[], b: string[]): string[] {
  if (a.length === 0 || b.length === 0) { return []; }
  const bSet = new Set(b);
  return a.filter(file => bSet.has(file)).sort();
}

function filesMatchingArea(area: Set<string>, files: string[]): string[] {
  if (area.size === 0 || files.length === 0) { return []; }
  return files.filter(file => {
    const tokens = pathTokens(file);
    return Array.from(area).some(token => tokens.has(token));
  }).sort();
}

function pathTokens(filePath: string): Set<string> {
  const tokens = new Set<string>();
  for (const part of filePath.split(/[^a-zA-Z0-9_/-]+|[\\/.-]+/)) {
    addToken(tokens, part);
  }
  return tokens;
}

function isRecentRun(run: CollisionRun, now: Date, recentRunHours: number): boolean {
  const value = run.endedAt || run.startedAt;
  if (!value) { return false; }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) { return false; }
  return now.getTime() - parsed.getTime() <= recentRunHours * 60 * 60 * 1000;
}

function isCollisionActiveRun(run: CollisionRun, now: Date, staleActiveRunHours: number): boolean {
  return isActiveRun(run) && !isStaleActiveRun(run, now, staleActiveRunHours * 60 * 60 * 1000);
}

function ticketAreaTokens(ticket: Ticket): Set<string> {
  const tokens = new Set<string>();
  for (const label of ticket.labels || []) {
    addToken(tokens, label);
  }
  for (const word of String(ticket.summary || '').split(/[^a-zA-Z0-9_/-]+/)) {
    addToken(tokens, word);
  }
  return tokens;
}

function addToken(tokens: Set<string>, value: string): void {
  const token = value.toLowerCase().replace(/[^a-z0-9_/-]/g, '').trim();
  if (!token || token.length < 4 || STOP_WORDS.has(token)) { return; }
  tokens.add(token);
}

function sharedAreaTokens(a: Set<string>, b: Set<string>): string[] {
  if (a.size === 0 || b.size === 0) { return []; }
  return Array.from(a).filter(token => b.has(token)).sort();
}

const STOP_WORDS = new Set([
  'ticket',
  'story',
  'defect',
  'bugfix',
  'update',
  'change',
  'changes',
  'handle',
  'support',
  'implement',
  'verify',
  'review',
  'service',
  'project',
]);

function runDetail(run: CollisionRun): string {
  const parts = [
    run.project ? `project ${run.project}` : '',
    run.ticket ? `ticket ${run.ticket}` : '',
    run.skill ? `skill ${run.skill}` : '',
    run.status ? `status ${run.status}` : '',
    run.startedAt ? `started ${run.startedAt}` : '',
  ].filter(Boolean);
  return parts.join(' | ') || run.id;
}

function dedupeCollisions(collisions: DispatchCollision[]): DispatchCollision[] {
  const seen = new Set<string>();
  return collisions.filter(collision => {
    if (seen.has(collision.id)) { return false; }
    seen.add(collision.id);
    return true;
  });
}

function compareCollisions(a: DispatchCollision, b: DispatchCollision): number {
  return severityWeight(b.severity) - severityWeight(a.severity) || a.title.localeCompare(b.title);
}

function severityWeight(severity: CollisionSeverity): number {
  if (severity === 'high') { return 3; }
  if (severity === 'medium') { return 2; }
  return 1;
}
