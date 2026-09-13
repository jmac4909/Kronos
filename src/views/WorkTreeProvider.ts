import * as vscode from 'vscode';
import type { KronosState as KronosStateSnapshot, Ticket } from '../state/types';
import {
  collectWorkTicketFilterOptions,
  isCompletedWorkTicket,
  normalizeWorkTicketFilter,
  workTicketMatchesFilter,
  type WorkTicketFilter,
  type WorkTicketFilterOptions,
  type WorkTicketCompletionPreferences,
} from '../services/workTicketFilters';
import { ticketLocalProject, type LocalProjectSummary } from '../services/projectCatalog';
import {
  workDataPresentation,
  type JiraWorkRefreshStatus,
  type WorkDataPresentation,
} from '../services/workRefreshStatus';

export type { WorkCompletionFilter, WorkTicketFilter, WorkTicketFilterOptions } from '../services/workTicketFilters';
export { isCompletedWorkTicket, normalizeWorkTicketFilter, workTicketMatchesFilter } from '../services/workTicketFilters';

export interface WorkTreeStateSource {
  readonly state: KronosStateSnapshot | null;
  readonly loadIssues?: readonly unknown[];
  readonly jiraRefreshStatus?: JiraWorkRefreshStatus;
  readonly onDidChange: vscode.Event<void>;
}

type WorkTreeItem = WorkTicketTreeItem | WorkTreeMessageItem;

export interface WorkTreePreferencesSource {
  hideCompletedByDefault(): boolean;
  doneStatusNames(): readonly string[];
  staleAfterMs(): number;
}

export type WorkTicketProjector = (ticketKey: string, ticket: Ticket) => Ticket;

const DEFAULT_PREFERENCES: WorkTreePreferencesSource = {
  hideCompletedByDefault: () => true,
  doneStatusNames: () => [],
  staleAfterMs: () => Number.POSITIVE_INFINITY,
};

export class WorkTreeProvider implements vscode.TreeDataProvider<WorkTreeItem>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<WorkTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private readonly stateSubscription: vscode.Disposable;
  private filter: WorkTicketFilter = {};

  constructor(
    private readonly stateSource: WorkTreeStateSource,
    private readonly preferences: WorkTreePreferencesSource = DEFAULT_PREFERENCES,
    private readonly projectTicket: WorkTicketProjector = (_ticketKey, ticket) => ticket,
  ) {
    this.stateSubscription = stateSource.onDidChange(() => this.changeEmitter.fire(undefined));
  }

  getTreeItem(element: WorkTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): WorkTreeItem[] {
    const state = this.stateSource.state;
    const presentation = this.dataPresentation(state);
    if (!state) {
      return [workDataStatusItem(presentation)];
    }

    const allTickets = Object.entries(state.tickets)
      .map(([ticketKey, ticket]): [string, Ticket] => [ticketKey, this.projectTicket(ticketKey, ticket)]);
    if (allTickets.length === 0) {
      return [workDataStatusItem(presentation)];
    }

    const statusItems = presentation.mode === 'ready' ? [] : [workDataStatusItem(presentation)];

    const completionPreferences = this.completionPreferences();
    const visibleTickets = allTickets
      .filter(([ticketKey, ticket]) => workTicketMatchesFilter(ticketKey, ticket, this.filter, completionPreferences))
      .sort(compareWorkTickets);
    if (visibleTickets.length === 0) {
      const normalized = normalizeWorkTicketFilter(this.filter);
      if (!normalized.query && !normalized.jiraProject && !normalized.localProject
        && !normalized.label && !normalized.jiraStatus
        && (normalized.completion === 'active'
          || (normalized.completion === undefined && completionPreferences.hideCompletedByDefault !== false))
        && allTickets.every(([, ticket]) => isCompletedWorkTicket(ticket, completionPreferences.additionalDoneStatuses))) {
        return [...statusItems, new WorkTreeMessageItem(
          'No active tickets',
          'filter',
          'kronos.filterWork',
          'Use Filter to show completed work',
        )];
      }
      return [...statusItems, new WorkTreeMessageItem(
        'No matching tickets',
        'search',
        'kronos.filterWork',
        'Change the current filters',
      )];
    }
    return [...statusItems, ...visibleTickets.map(([ticketKey, ticket]) => new WorkTicketTreeItem(
      ticketKey,
      ticket,
      ticketLocalProject(state, ticket),
      isCompletedWorkTicket(ticket, completionPreferences.additionalDoneStatuses),
    ))];
  }

  setSearchQuery(query: string): void {
    this.setFilter({ ...this.filter, query });
  }

  setFilter(filter: string | WorkTicketFilter): void {
    this.filter = normalizeWorkTicketFilter(typeof filter === 'string' ? { query: filter } : filter);
    this.changeEmitter.fire(undefined);
  }

  clearFilter(): void {
    this.filter = {};
    this.changeEmitter.fire(undefined);
  }

  getFilter(): WorkTicketFilter {
    return { ...this.filter };
  }

  defaultCompletion(): 'active' | 'all' {
    return this.preferences.hideCompletedByDefault() ? 'active' : 'all';
  }

  getFilterOptions(): WorkTicketFilterOptions {
    const tickets = Object.fromEntries(Object.entries(this.stateSource.state?.tickets || {})
      .map(([ticketKey, ticket]) => [ticketKey, this.projectTicket(ticketKey, ticket)]));
    return collectWorkTicketFilterOptions(tickets);
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  dispose(): void {
    this.stateSubscription.dispose();
    this.changeEmitter.dispose();
  }

  private completionPreferences(): WorkTicketCompletionPreferences {
    return {
      hideCompletedByDefault: this.preferences.hideCompletedByDefault(),
      additionalDoneStatuses: new Set(this.preferences.doneStatusNames().map(comparableStatus).filter(Boolean)),
    };
  }

  private dataPresentation(state: KronosStateSnapshot | null): WorkDataPresentation {
    return workDataPresentation({
      ticketCount: Object.keys(state?.tickets || {}).length,
      loadIssueCount: this.stateSource.loadIssues?.length || 0,
      stateAvailable: state !== null,
      staleAfterMs: this.preferences.staleAfterMs(),
      ...(state?.refreshedAt !== undefined ? { refreshedAt: state.refreshedAt } : {}),
      ...(this.stateSource.jiraRefreshStatus ? { refreshStatus: this.stateSource.jiraRefreshStatus } : {}),
    });
  }
}

export class WorkTicketTreeItem extends vscode.TreeItem {
  override readonly contextValue = 'work_ticket';

  constructor(
    public readonly ticketKey: string,
    public readonly ticket: Ticket,
    localProject?: LocalProjectSummary,
    completed = isCompletedWorkTicket(ticket),
  ) {
    const key = safeSingleLine(ticketKey, 160) || 'Ticket';
    const summary = safeSingleLine(ticket.summary, 400) || 'Untitled ticket';
    super(`${key} — ${summary}`, vscode.TreeItemCollapsibleState.None);

    const localProjectName = safeSingleLine(localProject?.displayName || localProject?.name || ticket.linked_local_project, 120);
    const priority = safeSingleLine(ticket.priority, 80);
    const facts = [
      safeSingleLine(ticket.jira_status, 120),
      localProjectName || priority,
    ].filter(Boolean);
    this.description = facts.join(' • ');
    this.tooltip = buildWorkTicketTooltip(key, summary, ticket, localProject);
    this.iconPath = new vscode.ThemeIcon(
      ticket.type.toLowerCase().includes('bug') || ticket.type.toLowerCase().includes('defect')
        ? 'bug'
        : completed ? 'issue-closed' : 'issue-opened',
    );
    this.command = {
      command: 'kronos.openTicketWorkspace',
      title: 'Open Ticket',
      arguments: [this],
    };
  }
}

function compareWorkTickets(
  left: [string, Ticket],
  right: [string, Ticket],
): number {
  const leftUpdated = timestamp(left[1].updated);
  const rightUpdated = timestamp(right[1].updated);
  return rightUpdated - leftUpdated || left[0].localeCompare(right[0]);
}

function buildWorkTicketTooltip(
  key: string,
  summary: string,
  ticket: Ticket,
  localProject?: LocalProjectSummary,
): string {
  const lines = [
    `${key}: ${summary}`,
    `Jira status: ${safeSingleLine(ticket.jira_status, 160) || 'Unknown'}`,
    `Jira project: ${safeSingleLine(ticket.jira_project_key, 120) || 'Unknown'}`,
    `Type: ${safeSingleLine(ticket.type, 120) || 'Unknown'}`,
    `Priority: ${safeSingleLine(ticket.priority, 120) || 'Unknown'}`,
    `Local project: ${safeSingleLine(localProject?.displayName || localProject?.name || ticket.linked_local_project, 200) || 'Not linked'}`,
  ];
  if (localProject) {
    lines.push(`Launch directory: ${safeSingleLine(localProject.path, 500) || 'unavailable'}`);
    lines.push(`Git branch: ${safeSingleLine(localProject.branch, 300) || 'unavailable'}`);
  }
  if (ticket.mr) {
    lines.push(`Merge request !${ticket.mr.iid}: ${safeSingleLine(ticket.mr.state, 80)} / ${safeSingleLine(ticket.mr.review_status, 120)}`);
  }
  if (ticket.build) {
    lines.push(`Build #${ticket.build.number}: ${safeSingleLine(ticket.build.status, 120)}`);
  }
  const description = safeSingleLine(ticket.description, 300);
  if (description) { lines.push(description); }
  lines.push('Select to open the ticket workspace. Right-click for ticket actions.');
  return lines.join('\n');
}

function timestamp(value: string | undefined): number {
  if (!value) { return 0; }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function comparableStatus(value: string): string {
  return safeSingleLine(value, 200).toLowerCase();
}

class WorkTreeMessageItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command?: string, description?: string, tooltip?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.contextValue = 'work_message';
    if (description) { this.description = description; }
    if (tooltip) { this.tooltip = tooltip; }
    if (command) { this.command = { command, title: workMessageCommandTitle(command) }; }
  }
}

function workMessageCommandTitle(command: string): string {
  if (command === 'kronos.doctor') { return 'Check Setup'; }
  if (command === 'kronos.filterWork') { return 'Filter Work'; }
  return 'Refresh Jira';
}

function workDataStatusItem(presentation: WorkDataPresentation): WorkTreeMessageItem {
  const icon = presentation.mode === 'loading' ? 'loading~spin'
    : presentation.mode === 'error' ? 'error'
      : presentation.mode === 'partial' || presentation.mode === 'stale' ? 'warning'
        : presentation.mode === 'empty' ? 'issues' : 'check';
  const command = presentation.mode === 'loading' || presentation.mode === 'ready'
    ? undefined
    : presentation.mode === 'error' ? 'kronos.doctor' : 'kronos.refreshTickets';
  const refreshed = presentation.refreshedAt ? `\nLast Jira result: ${presentation.refreshedAt}` : '';
  return new WorkTreeMessageItem(
    presentation.title,
    icon,
    command,
    presentation.detail,
    `${presentation.detail}${refreshed}`,
  );
}
