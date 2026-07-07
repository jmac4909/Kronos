import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { Ticket } from '../state/types';
import { actionDisplayLabel as actionToLabel } from '../services/actionCatalog';
import { buildStatusKind } from '../services/buildStatus';
import { evidenceAcceptanceCriteria, evidenceAcceptanceCriteriaStatus, evidenceRecordCount } from '../services/evidenceData';
import { mergeRequestReviewStatusLabel } from '../services/mergeRequestLabels';
import { ticketStringArray } from '../services/ticketFields';
import { TicketFilter, TicketGroupBy, describeTicketFilter, filterTickets, groupTicketEntries, hasTicketFilter } from '../services/ticketFilters';
import { ticketActionIcon } from './actionIcons';

type TicketElement = TicketGroupItem | TicketItem | TicketDetailItem | EmptyTicketItem;

export class TicketTreeProvider implements vscode.TreeDataProvider<TicketElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TicketElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private filter: TicketFilter = {};
  private groupBy: TicketGroupBy = 'none';
  private readonly stateSubscription: vscode.Disposable;

  constructor(private kronosState: KronosState) {
    this.stateSubscription = kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: TicketElement): vscode.TreeItem { return element; }

  setView(filter: TicketFilter, groupBy: TicketGroupBy = this.groupBy): void {
    this.filter = filter;
    this.groupBy = groupBy;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearView(): void {
    this.filter = {};
    this.groupBy = 'none';
    this._onDidChangeTreeData.fire(undefined);
  }

  getFilter(): TicketFilter { return { ...this.filter }; }
  getGroupBy(): TicketGroupBy { return this.groupBy; }
  getFilterDescription(): string { return describeTicketFilter(this.filter); }

  getChildren(element?: TicketElement): TicketElement[] {
    const state = this.kronosState.state;
    if (!state) { return []; }

    if (!element) {
      const tickets = state.tickets;
      if (Object.keys(tickets).length === 0) {
        return [new EmptyTicketItem('No tickets — run Refresh', 'info')];
      }

      const sorted = filterTickets(Object.entries(tickets), this.filter).sort((a, b) => {
        const order: Record<string, number> = { fix_build: 0, verify: 1, deploy_monitor: 2, in_progress: 3, implement: 4, await_review: 5, blocked: 6, done: 7 };
        return (order[a[1].next_action] ?? 9) - (order[b[1].next_action] ?? 9);
      });

      if (sorted.length === 0 && hasTicketFilter(this.filter)) {
        return [new EmptyTicketItem(`No tickets match ${describeTicketFilter(this.filter)}`, 'filter')];
      }

      if (this.groupBy !== 'none') {
        return groupTicketEntries(sorted, this.groupBy).map(([label, entries]) => new TicketGroupItem(formatGroupLabel(label, this.groupBy), entries));
      }

      return sorted.map(([key, ticket]) => new TicketItem(key, ticket));
    }

    if (element instanceof TicketGroupItem) {
      return element.entries.map(([key, ticket]) => new TicketItem(key, ticket));
    }

    if (element instanceof TicketItem) {
      const items: TicketDetailItem[] = [];
      const t = element.ticket;
      const projs = ticketStringArray(t.projects);

      if (projs.length > 0) {
        for (const p of projs) {
          items.push(new TicketDetailItem(p, '', 'linked_project', element.ticketKey, p));
        }
      } else {
        const unlinked = new TicketDetailItem('Not linked — click to assign', '', 'unlinked', element.ticketKey);
        unlinked.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
        items.push(unlinked);
      }
      items.push(new TicketDetailItem('Link to project...', '', 'link_action', element.ticketKey));

      const evidenceCount = evidenceRecordCount(t);
      if (evidenceCount > 0) {
        const evidenceItem = new TicketDetailItem(`${evidenceCount} evidence item${evidenceCount === 1 ? '' : 's'}`, '', 'evidence_info', element.ticketKey);
        evidenceItem.iconPath = new vscode.ThemeIcon('notebook', new vscode.ThemeColor('charts.blue'));
        items.push(evidenceItem);
      }
      const criteriaCount = evidenceAcceptanceCriteria(t).length;
      if (criteriaCount > 0) {
        const criteriaItem = new TicketDetailItem(`${criteriaCount} acceptance criterion item${criteriaCount === 1 ? '' : 's'}`, '', 'evidence_info', element.ticketKey);
        criteriaItem.iconPath = new vscode.ThemeIcon('checklist', new vscode.ThemeColor('testing.iconPassed'));
        items.push(criteriaItem);
      }

      if (t.mr) {
        const isMerged = t.mr.state === 'merged';
        const mrLabel = isMerged ? 'merged' : mergeRequestReviewStatusLabel(t.mr.review_status);
        const mrIcon = isMerged ? 'git-merge' : t.mr.review_status === 'approved' ? 'pass' : t.mr.review_status === 'changes_requested' ? 'warning' : 'git-pull-request';
        const mrColor = isMerged ? 'testing.iconPassed' : t.mr.review_status === 'approved' ? 'testing.iconPassed' : t.mr.review_status === 'changes_requested' ? 'testing.iconFailed' : 'charts.yellow';
        const mrItem = new TicketDetailItem(`MR !${t.mr.iid} — ${mrLabel}`, t.mr.url);
        mrItem.iconPath = new vscode.ThemeIcon(mrIcon, new vscode.ThemeColor(mrColor));
        items.push(mrItem);
      }

      if (t.build) {
        const buildKind = buildStatusKind(t.build.status);
        const buildIcon = buildKind === 'pass' ? 'pass' : buildKind === 'fail' ? 'error' : 'watch';
        const buildColor = buildKind === 'pass' ? 'testing.iconPassed' : buildKind === 'fail' ? 'testing.iconFailed' : 'charts.yellow';
        const buildItem = new TicketDetailItem(`Build #${t.build.number} — ${t.build.status}`, t.build.url);
        buildItem.iconPath = new vscode.ThemeIcon(buildIcon, new vscode.ThemeColor(buildColor));
        items.push(buildItem);
      }

      if (t.jira_url) {
        const jiraItem = new TicketDetailItem('Open in Jira', t.jira_url);
        jiraItem.iconPath = new vscode.ThemeIcon('link-external');
        items.push(jiraItem);
      }

      return items;
    }

    return [];
  }

  dispose(): void {
    this.stateSubscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

class TicketGroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly entries: Array<[string, Ticket]>
  ) {
    super(`${label} (${entries.length})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'ticket_group';
    this.iconPath = new vscode.ThemeIcon('folder');
  }
}

class EmptyTicketItem extends vscode.TreeItem {
  constructor(label: string, icon: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(icon);
  }
}

class TicketItem extends vscode.TreeItem {
  constructor(
    public readonly ticketKey: string,
    public readonly ticket: Ticket
  ) {
    const action = ticket.next_action;
    const projs = ticketStringArray(ticket.projects);
    const linked = projs.length > 0;
    const projTag = linked ? projs.join(', ') : '';

    super(linked ? `${ticketKey} → ${projTag}` : ticketKey, vscode.TreeItemCollapsibleState.Collapsed);

    if (action === 'implement' || action === 'in_progress' || action === 'fix_build') {
      this.contextValue = 'ticket_implement';
    } else if (action === 'verify') {
      this.contextValue = 'ticket_verify';
    } else if (action === 'await_review') {
      this.contextValue = 'ticket_review';
    } else {
      this.contextValue = 'ticket';
    }

    const statusLabel = actionToLabel(action);
    const noAcceptanceCriteria = ticketNeedsAcceptanceCriteriaHint(ticket);
    this.description = `[${statusLabel}] ${ticket.summary}${noAcceptanceCriteria ? ' - no AC found' : ''}`;

    this.tooltip = new vscode.MarkdownString(
      `**${ticketKey}**: ${ticket.summary}\n\n` +
      `Type: ${ticket.type} | Priority: ${ticket.priority}\n\n` +
      `Status: ${ticket.jira_status} (${statusLabel})\n\n` +
      `Projects: ${projTag}` +
      (noAcceptanceCriteria ? '\n\nAcceptance criteria: parser found no extractable criteria.' : '') +
      (ticket.description ? `\n\n${ticket.description.substring(0, 200)}` : '')
    );

    this.command = { command: 'kronos.viewTicket', title: 'View Ticket', arguments: [this] };

    if (!linked) {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
    } else {
      this.iconPath = ticketActionIcon(action);
    }
  }
}

const ACCEPTANCE_CRITERIA_HINT_ACTIONS = new Set(['implement', 'in_progress', 'fix_build', 'verify', 'await_review', 'deploy_monitor', 'done']);

function ticketNeedsAcceptanceCriteriaHint(ticket: Ticket): boolean {
  return ACCEPTANCE_CRITERIA_HINT_ACTIONS.has(ticket.next_action)
    && evidenceAcceptanceCriteriaStatus(ticket) === 'none';
}

function formatGroupLabel(label: string, groupBy: TicketGroupBy): string {
  if (groupBy === 'action') { return actionToLabel(label); }
  return label;
}

class TicketDetailItem extends vscode.TreeItem {
  public readonly ticketKey: string;
  public readonly linkedProject: string;

  constructor(label: string, url: string, contextValue?: string, ticketKey?: string, linkedProject?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.ticketKey = ticketKey || '';
    this.linkedProject = linkedProject || '';
    if (contextValue) { this.contextValue = contextValue; }
    if (contextValue === 'unlinked') {
      this.command = { command: 'kronos.linkTicket', title: 'Link', arguments: [ticketKey] };
    } else if (contextValue === 'link_action') {
      this.command = { command: 'kronos.linkTicket', title: 'Link', arguments: [ticketKey] };
      this.iconPath = new vscode.ThemeIcon('add');
    } else if (contextValue === 'linked_project') {
      this.iconPath = new vscode.ThemeIcon('repo', new vscode.ThemeColor('charts.blue'));
    } else if (url) {
      this.tooltip = url;
      this.command = { command: 'kronos.openExternalUrl', title: 'Open', arguments: [url] };
    }
  }
}
