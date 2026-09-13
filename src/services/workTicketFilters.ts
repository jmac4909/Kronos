import type { Ticket } from '../state/types';

export type WorkCompletionFilter = 'active' | 'completed' | 'all';

export interface WorkTicketFilter {
  query?: string;
  jiraProject?: string;
  localProject?: string;
  label?: string;
  source?: Ticket['source'];
  jiraStatus?: string;
  completion?: WorkCompletionFilter;
}

export interface WorkTicketFilterOptions {
  jiraProjects: string[];
  localProjects: string[];
  labels: string[];
  jiraStatuses: string[];
}

export interface WorkTicketCompletionPreferences {
  hideCompletedByDefault?: boolean;
  additionalDoneStatuses?: ReadonlySet<string>;
}

export function normalizeWorkTicketFilter(filter: WorkTicketFilter): WorkTicketFilter {
  const normalized: WorkTicketFilter = {};
  const query = safeSingleLine(filter.query, 500);
  const jiraProject = safeSingleLine(filter.jiraProject, 200);
  const localProject = safeSingleLine(filter.localProject, 200);
  const label = safeSingleLine(filter.label, 200);
  const jiraStatus = safeSingleLine(filter.jiraStatus, 200);
  if (query) { normalized.query = query; }
  if (jiraProject) { normalized.jiraProject = jiraProject; }
  if (localProject) { normalized.localProject = localProject; }
  if (label) { normalized.label = label; }
  if (filter.source === 'jira') { normalized.source = filter.source; }
  if (jiraStatus) { normalized.jiraStatus = jiraStatus; }
  if (filter.completion === 'completed' || filter.completion === 'all') {
    normalized.completion = filter.completion;
  } else if (filter.completion === 'active') {
    normalized.completion = 'active';
  }
  return normalized;
}

export function workTicketMatchesFilter(
  ticketKey: string,
  ticket: Ticket,
  filter: WorkTicketFilter,
  preferences: WorkTicketCompletionPreferences = {},
): boolean {
  const normalized = normalizeWorkTicketFilter(filter);
  if (normalized.source && ticket.source !== normalized.source) { return false; }
  if (normalized.jiraProject
    && comparable(ticket.jira_project_key || '') !== comparable(normalized.jiraProject)) {
    return false;
  }
  if (normalized.localProject
    && comparable(ticket.linked_local_project || '') !== comparable(normalized.localProject)) {
    return false;
  }
  if (normalized.label && !(ticket.labels || []).some(label => comparable(label) === comparable(normalized.label || ''))) {
    return false;
  }
  if (normalized.jiraStatus) {
    if (comparable(ticket.jira_status) !== comparable(normalized.jiraStatus)) { return false; }
  }
  const completion = normalized.completion || (normalized.jiraStatus
    ? 'all'
    : preferences.hideCompletedByDefault === false ? 'all' : 'active');
  const completed = isCompletedWorkTicket(ticket, preferences.additionalDoneStatuses);
  if (completion === 'active' && completed) { return false; }
  if (completion === 'completed' && !completed) { return false; }

  if (!normalized.query) { return true; }
  const query = comparable(normalized.query);
  const searchable = [
    ticketKey,
    ticket.summary,
    ticket.description,
    ticket.type,
    ticket.priority,
    ticket.jira_status,
    ticket.jira_status_category,
    ticket.source,
    ticket.jira_project_key,
    ticket.linked_local_project,
    ticket.updated,
    ...(ticket.labels || []),
    ...(ticket.attachments || []).flatMap(attachment => [attachment.filename, attachment.mimeType]),
    ticket.mr?.iid,
    ticket.mr?.title,
    ticket.mr?.state,
    ticket.mr?.review_status,
    ticket.mr?.author,
    ticket.mr?.source_branch,
    ticket.mr?.target_branch,
    ticket.build?.status,
    ticket.build?.number,
  ].filter(value => value !== undefined && value !== null).map(value => comparable(String(value)));
  return searchable.some(value => value.includes(query));
}

export function isCompletedWorkTicket(
  ticket: Pick<Ticket, 'jira_status' | 'jira_status_category'>,
  additionalDoneStatuses: ReadonlySet<string> = new Set(),
): boolean {
  if (additionalDoneStatuses.has(comparable(ticket.jira_status))) { return true; }
  const category = comparable(ticket.jira_status_category || '');
  if (category) { return category === 'done'; }
  return ['done', 'closed', 'resolved'].includes(comparable(ticket.jira_status));
}

export function collectWorkTicketFilterOptions(
  tickets: Readonly<Record<string, Ticket>>,
): WorkTicketFilterOptions {
  const jiraProjects = new Map<string, string>();
  const localProjects = new Map<string, string>();
  const labels = new Map<string, string>();
  const statuses = new Map<string, string>();
  for (const ticket of Object.values(tickets)) {
    if (ticket.jira_project_key) { retainDisplayValue(jiraProjects, ticket.jira_project_key); }
    if (ticket.linked_local_project) { retainDisplayValue(localProjects, ticket.linked_local_project); }
    for (const label of ticket.labels || []) { retainDisplayValue(labels, label); }
    retainDisplayValue(statuses, ticket.jira_status);
  }
  const byDisplayName = (left: string, right: string): number => left.localeCompare(right, undefined, { sensitivity: 'base' });
  return {
    jiraProjects: [...jiraProjects.values()].sort(byDisplayName),
    localProjects: [...localProjects.values()].sort(byDisplayName),
    labels: [...labels.values()].sort(byDisplayName),
    jiraStatuses: [...statuses.values()].sort(byDisplayName),
  };
}

function retainDisplayValue(target: Map<string, string>, value: string): void {
  const display = safeSingleLine(value, 200);
  if (display && !target.has(comparable(display))) { target.set(comparable(display), display); }
}

function comparable(value: string): string {
  return value.trim().toLowerCase();
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}
