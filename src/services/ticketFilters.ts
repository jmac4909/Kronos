import { Ticket } from '../state/types';

export type TicketGroupBy = 'none' | 'action' | 'project' | 'priority';

export interface TicketFilter {
  query?: string;
  project?: string;
  action?: string;
  priority?: string;
  label?: string;
  mrState?: string;
  buildStatus?: string;
  staleDays?: number;
  linked?: 'linked' | 'unlinked';
}

interface TicketViewState {
  filter: TicketFilter;
  groupBy: TicketGroupBy;
}

interface TicketFilterPreset {
  id: string;
  label: string;
  view: TicketViewState;
}

export const TICKET_FILTER_PRESETS: TicketFilterPreset[] = [
  { id: 'active', label: 'Active Work', view: { filter: { action: 'in_progress' }, groupBy: 'project' } },
  { id: 'build_failed', label: 'Build Failed', view: { filter: { action: 'fix_build' }, groupBy: 'project' } },
  { id: 'review_pending', label: 'Review Pending', view: { filter: { action: 'await_review', mrState: 'pending_review' }, groupBy: 'project' } },
  { id: 'stale_week', label: 'Stale 7+ Days', view: { filter: { staleDays: 7 }, groupBy: 'action' } },
  { id: 'unlinked', label: 'Unlinked Tickets', view: { filter: { linked: 'unlinked' }, groupBy: 'action' } },
];

export function filterTickets(entries: Array<[string, Ticket]>, filter: TicketFilter, now = new Date()): Array<[string, Ticket]> {
  return entries.filter(([key, ticket]) => ticketMatchesFilter(key, ticket, filter, now));
}

export function ticketMatchesFilter(key: string, ticket: Ticket, filter: TicketFilter = {}, now = new Date()): boolean {
  if (!hasTicketFilter(filter)) { return true; }
  if (filter.query && !searchText(key, ticket).includes(normalize(filter.query))) { return false; }
  if (filter.project && !(ticket.projects || []).some(project => normalize(project) === normalize(filter.project))) { return false; }
  if (filter.action && normalize(ticket.next_action) !== normalize(filter.action)) { return false; }
  if (filter.priority && normalize(ticket.priority) !== normalize(filter.priority)) { return false; }
  if (filter.label && !(ticket.labels || []).some(label => normalize(label) === normalize(filter.label))) { return false; }
  if (filter.linked === 'linked' && (ticket.projects || []).length === 0) { return false; }
  if (filter.linked === 'unlinked' && (ticket.projects || []).length > 0) { return false; }
  if (filter.mrState && !matchesMrState(ticket, filter.mrState)) { return false; }
  if (filter.buildStatus && !matchesBuildStatus(ticket, filter.buildStatus)) { return false; }
  if (filter.staleDays && !isStale(ticket.updated, filter.staleDays, now)) { return false; }
  return true;
}

export function hasTicketFilter(filter: TicketFilter = {}): boolean {
  return Boolean(
    filter.query ||
    filter.project ||
    filter.action ||
    filter.priority ||
    filter.label ||
    filter.mrState ||
    filter.buildStatus ||
    filter.staleDays ||
    filter.linked
  );
}

export function describeTicketFilter(filter: TicketFilter = {}): string {
  const parts: string[] = [];
  if (filter.query) { parts.push(`search "${filter.query}"`); }
  if (filter.project) { parts.push(`project ${filter.project}`); }
  if (filter.action) { parts.push(`action ${filter.action}`); }
  if (filter.priority) { parts.push(`priority ${filter.priority}`); }
  if (filter.label) { parts.push(`label ${filter.label}`); }
  if (filter.mrState) { parts.push(`MR ${filter.mrState}`); }
  if (filter.buildStatus) { parts.push(`build ${filter.buildStatus}`); }
  if (filter.staleDays) { parts.push(`stale ${filter.staleDays}+ days`); }
  if (filter.linked) { parts.push(filter.linked); }
  return parts.length > 0 ? parts.join(', ') : 'all tickets';
}

export function groupTicketEntries(entries: Array<[string, Ticket]>, groupBy: TicketGroupBy): Array<[string, Array<[string, Ticket]>]> {
  if (groupBy === 'none') {
    return [['Tickets', entries]];
  }
  const groups = new Map<string, Array<[string, Ticket]>>();
  for (const entry of entries) {
    const group = ticketGroupLabel(entry[1], groupBy);
    const items = groups.get(group) || [];
    items.push(entry);
    groups.set(group, items);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function ticketGroupLabel(ticket: Ticket, groupBy: TicketGroupBy): string {
  if (groupBy === 'action') { return ticket.next_action || 'No action'; }
  if (groupBy === 'priority') { return ticket.priority || 'No priority'; }
  if (groupBy === 'project') { return ticket.projects?.[0] || 'Unlinked'; }
  return 'Tickets';
}

function matchesMrState(ticket: Ticket, state: string): boolean {
  const expected = normalize(state);
  if (expected === 'none') { return !ticket.mr; }
  return normalize(ticket.mr?.state) === expected || normalize(ticket.mr?.review_status) === expected;
}

function matchesBuildStatus(ticket: Ticket, status: string): boolean {
  const expected = normalize(status);
  if (expected === 'none') { return !ticket.build; }
  return normalize(ticket.build?.status) === expected;
}

function isStale(updated: string | undefined, staleDays: number, now: Date): boolean {
  if (!updated) { return false; }
  const parsed = new Date(updated);
  if (!Number.isFinite(parsed.getTime())) { return false; }
  return now.getTime() - parsed.getTime() >= staleDays * 24 * 60 * 60 * 1000;
}

function searchText(key: string, ticket: Ticket): string {
  return [
    key,
    ticket.summary,
    ticket.description,
    ticket.type,
    ticket.priority,
    ticket.jira_status,
    ticket.next_action,
    ...(ticket.labels || []),
    ...(ticket.projects || []),
  ].map(value => normalize(value)).join(' ');
}

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}
