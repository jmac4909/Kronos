import { KronosState, QueueDecision, QueueItem, QueueState } from '../state/types';
import { QUEUE_FILE, STATE_FILE, readQueueFile, readStateFile, validateQueueState, validateStateFileShape, writeJsonFileAtomic } from './stateStore';
import { PlannedAction, clearQueueDecision, planNextActions, planToQueueItem, recordQueueDecision } from './queuePlanner';

export interface AddTicketToQueueResult {
  added: boolean;
  alreadyInQueue: boolean;
  item?: QueueItem;
}

export interface RemoveTicketFromQueueResult {
  removed: number;
}

export interface TicketProjectLinkResult {
  changed: boolean;
  projects: string[];
}

export interface NextQueueItemResult {
  empty: boolean;
  item?: QueueItem;
}

export interface AddPlanToQueueOptions {
  pinTop?: boolean;
}

export interface AddPlanToQueueResult {
  added: boolean;
  alreadyQueued: boolean;
  pinned: boolean;
  item: QueueItem;
}

export interface RecordPlanQueueDecisionOptions {
  snoozeMinutes?: number;
  reason?: string;
  now?: Date;
}

export interface RecordPlanQueueDecisionResult {
  decision: QueueDecision;
}

export type QueueReorderDirection = 'up' | 'down' | 'top';

export interface QueueReorderResult {
  changed: boolean;
  item?: QueueItem;
  items: QueueItem[];
}

export function selectNextQueueItem(): NextQueueItemResult {
  const queue = ensureQueue(readQueueFile());
  if (queue.items.length === 0) {
    return { empty: true };
  }
  return { empty: false, item: normalizeQueueItem(queue.items[0]) };
}

export function addPlanToQueue(plan: PlannedAction, options: AddPlanToQueueOptions = {}): AddPlanToQueueResult {
  const state = requireState();
  const pinTop = Boolean(options.pinTop);
  let queue = clearQueueDecision(ensureQueue(readQueueFile()), plan);
  const existingIdx = queue.items.findIndex(item =>
    (plan.queueItem && item.id === plan.queueItem.id) ||
    (!!plan.ticketKey && item.ticket === plan.ticketKey && item.action === plan.action)
  );

  if (existingIdx >= 0) {
    const [existing] = queue.items.splice(existingIdx, 1);
    const item = normalizeQueueItem(existing);
    if (!pinTop) {
      return { added: false, alreadyQueued: true, pinned: false, item };
    }
    queue.items.unshift(item);
    queue.last_computed = new Date().toISOString();
    persistQueue(queue, 'queue-pin-plan');
    return { added: false, alreadyQueued: true, pinned: true, item };
  }

  const item = normalizeQueueItem(planToQueueItem({
    state,
    queue,
    resolveProjectPath: project => state.projects[project]?.path,
  }, plan));
  queue = {
    ...queue,
    items: pinTop ? [item, ...queue.items] : [...queue.items, item],
    last_computed: new Date().toISOString(),
  };
  persistQueue(queue, pinTop ? 'queue-pin-plan' : 'queue-add-plan');
  return { added: true, alreadyQueued: false, pinned: pinTop, item };
}

export function recordPlanQueueDecision(
  plan: PlannedAction,
  decision: 'rejected' | 'snoozed',
  options: RecordPlanQueueDecisionOptions = {}
): RecordPlanQueueDecisionResult {
  const queue = recordQueueDecision(ensureQueue(readQueueFile()), plan, decision, options);
  persistQueue(queue, decision === 'snoozed' ? 'queue-plan-snoozed' : 'queue-plan-rejected');
  const planId = plan.planId || `${plan.ticketKey || 'refresh'}:${plan.action || 'implement'}`;
  return { decision: queue.decisions![planId] };
}

export function reorderQueueItem(index: number, direction: QueueReorderDirection): QueueReorderResult {
  const queue = ensureQueue(readQueueFile());
  const items = queue.items.map(normalizeQueueItem);
  if (!Number.isInteger(index) || index < 0 || index >= items.length) {
    return { changed: false, items };
  }
  if (direction === 'up' && index === 0) {
    return { changed: false, item: items[index], items };
  }
  if (direction === 'down' && index >= items.length - 1) {
    return { changed: false, item: items[index], items };
  }
  if (direction === 'top' && index === 0) {
    return { changed: false, item: items[index], items };
  }

  let targetIndex = index;
  if (direction === 'up') {
    targetIndex = index - 1;
    [items[targetIndex], items[index]] = [items[index], items[targetIndex]];
  } else if (direction === 'down') {
    targetIndex = index + 1;
    [items[index], items[targetIndex]] = [items[targetIndex], items[index]];
  } else {
    const [item] = items.splice(index, 1);
    items.unshift(item);
    targetIndex = 0;
  }

  const next = {
    ...queue,
    items,
    last_computed: new Date().toISOString(),
  };
  persistQueue(next, 'queue-reorder');
  return { changed: true, item: items[targetIndex], items };
}

export function addTicketToQueue(ticketKey: string): AddTicketToQueueResult {
  const state = requireState();
  const ticket = state.tickets[ticketKey];
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketKey}`);
  }
  const queue = ensureQueue(readQueueFile());
  if (queue.items.some(item => item.ticket === ticketKey)) {
    return { added: false, alreadyInQueue: true, item: queue.items.find(item => item.ticket === ticketKey) };
  }

  const plans = planNextActions({ state, queue, resolveProjectPath: project => state.projects[project]?.path });
  const plan = plans.find(candidate => candidate.ticketKey === ticketKey);
  const item = normalizeQueueItem(plan
    ? planToQueueItem({ state, queue, resolveProjectPath: project => state.projects[project]?.path }, plan)
    : fallbackQueueItem(state, ticketKey));
  const next: QueueState = {
    ...queue,
    items: [...queue.items, item],
    last_computed: new Date().toISOString(),
  };
  validateQueueState(next);
  writeJsonFileAtomic(QUEUE_FILE, next, 'queue-add-ticket');
  return { added: true, alreadyInQueue: false, item };
}

export function removeTicketFromQueue(ticketKey: string): RemoveTicketFromQueueResult {
  const queue = ensureQueue(readQueueFile());
  const nextItems = queue.items.filter(item => item.ticket !== ticketKey);
  const removed = queue.items.length - nextItems.length;
  if (removed === 0) {
    return { removed: 0 };
  }
  const next: QueueState = {
    ...queue,
    items: nextItems,
    last_computed: new Date().toISOString(),
  };
  validateQueueState(next);
  writeJsonFileAtomic(QUEUE_FILE, next, 'queue-remove-ticket');
  return { removed };
}

export function linkTicketToProject(ticketKey: string, projectName: string): TicketProjectLinkResult {
  return mutateTicketProjects(ticketKey, projectName, 'link');
}

export function unlinkTicketFromProject(ticketKey: string, projectName: string): TicketProjectLinkResult {
  return mutateTicketProjects(ticketKey, projectName, 'unlink');
}

function mutateTicketProjects(ticketKey: string, projectName: string, action: 'link' | 'unlink'): TicketProjectLinkResult {
  const state = requireState();
  const ticket = state.tickets[ticketKey];
  if (!ticket) {
    throw new Error(`Ticket not found: ${ticketKey}`);
  }
  if (!state.projects[projectName]) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const current = Array.isArray(ticket.projects) ? ticket.projects : [];
  const nextProjects = action === 'link'
    ? Array.from(new Set([...current, projectName])).sort()
    : current.filter(project => project !== projectName);
  const changed = nextProjects.join('\0') !== current.join('\0');
  if (!changed) {
    return { changed: false, projects: current };
  }
  ticket.projects = nextProjects;
  state.last_updated = new Date().toISOString();
  validateStateFileShape(state);
  writeJsonFileAtomic(STATE_FILE, state, action === 'link' ? 'ticket-link-project' : 'ticket-unlink-project');
  return { changed: true, projects: nextProjects };
}

function requireState(): KronosState {
  const state = readStateFile();
  if (!state) {
    throw new Error('Kronos state is not initialized.');
  }
  return state;
}

function ensureQueue(queue: QueueState | null): QueueState {
  return queue || { items: [], last_computed: null };
}

function persistQueue(queue: QueueState, action: string): void {
  validateQueueState(queue);
  writeJsonFileAtomic(QUEUE_FILE, queue, action);
}

function fallbackQueueItem(state: KronosState, ticketKey: string): QueueItem {
  const ticket = state.tickets[ticketKey];
  const projects = ticket.projects || [];
  const action = ticket.next_action || 'implement';
  return normalizeQueueItem({
    id: `planned-${ticketKey}`,
    ticket: ticketKey,
    ticket_summary: ticket.summary,
    projects,
    project_path: projects[0] ? state.projects[projects[0]]?.path || '' : '',
    action,
    priority_score: 0,
    reason: `Manual queue add for ${action}`,
  });
}

function normalizeQueueItem(item: unknown): QueueItem {
  const record = queueRecord(item);
  return {
    id: queueString(record.id) || `queued-${queueString(record.ticket) || Date.now()}`,
    ticket: queueNullableString(record.ticket),
    ticket_summary: queueNullableString(record.ticket_summary) || undefined,
    projects: queueStringArray(record.projects),
    project_path: queueString(record.project_path),
    action: queueString(record.action) || 'implement',
    priority_score: Number.isFinite(Number(record.priority_score)) ? Number(record.priority_score) : 0,
    reason: queueString(record.reason),
  };
}

function queueRecord(value: unknown): Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function queueString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function queueNullableString(value: unknown): string | null {
  const text = queueString(value);
  return text || null;
}

function queueStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(queueString).filter(Boolean) : [];
}
