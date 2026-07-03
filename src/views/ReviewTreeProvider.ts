import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { Ticket } from '../state/types';
import { TicketFilter, describeTicketFilter, hasTicketFilter, ticketMatchesFilter } from '../services/ticketFilters';

const NEW_REVIEW_SPIN_MS = 6000;

export interface NewReviewItemSummary {
  ticketKey: string;
  summary: string;
  projectNames: string[];
  mrIid?: number;
}

export class ReviewTreeProvider implements vscode.TreeDataProvider<ReviewItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ReviewItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _onDidChangeNewReviewCount = new vscode.EventEmitter<number>();
  readonly onDidChangeNewReviewCount = this._onDidChangeNewReviewCount.event;
  private filter: TicketFilter = {};
  private currentReviewKeys = new Set<string>();
  private seenReviewKeys = new Set<string>();
  private newReviewKeys = new Set<string>();
  private spinningReviewKeys = new Map<string, number>();
  private spinTimer: NodeJS.Timeout | undefined;
  private readonly stateSubscription: vscode.Disposable;

  constructor(private kronosState: KronosState) {
    this.seedInitialReviewKeys();
    this.stateSubscription = kronosState.onDidChange(() => this.refresh());
  }

  getTreeItem(element: ReviewItem): vscode.TreeItem { return element; }

  setFilter(filter: TicketFilter): void {
    this.filter = filter;
    this._onDidChangeTreeData.fire(undefined);
  }

  clearFilter(): void {
    this.filter = {};
    this._onDidChangeTreeData.fire(undefined);
  }

  getFilter(): TicketFilter { return { ...this.filter }; }
  getFilterDescription(): string { return describeTicketFilter(this.filter); }
  getNewReviewCount(): number { return this.newReviewKeys.size; }
  getNewReviewItems(): NewReviewItemSummary[] {
    return this.reviewEntries()
      .filter(([key]) => this.newReviewKeys.has(key))
      .map(([ticketKey, ticket]) => {
        const summary: NewReviewItemSummary = {
          ticketKey,
          summary: ticket.summary,
          projectNames: ticket.projects || [],
        };
        if (ticket.mr?.iid !== undefined) { summary.mrIid = ticket.mr.iid; }
        return summary;
      });
  }

  markVisibleReviewItemsSeen(): void {
    if (this.currentReviewKeys.size === 0 && this.newReviewKeys.size === 0) { return; }
    const previousCount = this.newReviewKeys.size;
    for (const key of this.currentReviewKeys) {
      this.seenReviewKeys.add(key);
    }
    this.newReviewKeys.clear();
    this.spinningReviewKeys.clear();
    this.clearSpinTimer();
    if (previousCount > 0) {
      this._onDidChangeNewReviewCount.fire(0);
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getChildren(): ReviewItem[] {
    const state = this.kronosState.state;
    if (!state) { return []; }

    const items: ReviewItem[] = [];
    for (const [key, ticket] of this.reviewEntries()) {
      if (ticketMatchesFilter(key, ticket, this.filter)) {
        const isNew = this.newReviewKeys.has(key);
        items.push(new ReviewItem(key, ticket, isNew, isNew && this.isReviewItemSpinning(key)));
      }
    }

    if (items.length === 0) {
      const empty = new ReviewItem('', { summary: '', type: '', priority: '', jira_status: '', source: 'jira', projects: [], mr: null, build: null, next_action: '', last_action: null, last_action_at: null });
      empty.label = hasTicketFilter(this.filter) ? `No MRs match ${describeTicketFilter(this.filter)}` : 'No MRs waiting for review';
      empty.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
      return [empty];
    }
    return items;
  }

  private refresh(): void {
    this.refreshReviewKeys();
    this._onDidChangeTreeData.fire(undefined);
  }

  private seedInitialReviewKeys(): void {
    const initialKeys = new Set(this.reviewEntries().map(([key]) => key));
    this.currentReviewKeys = initialKeys;
    this.seenReviewKeys = new Set(initialKeys);
    this.newReviewKeys.clear();
    this.spinningReviewKeys.clear();
    this.clearSpinTimer();
  }

  private refreshReviewKeys(): void {
    const previousCount = this.newReviewKeys.size;
    const nextKeys = new Set(this.reviewEntries().map(([key]) => key));
    for (const key of this.seenReviewKeys) {
      if (!nextKeys.has(key)) {
        this.seenReviewKeys.delete(key);
      }
    }
    for (const key of nextKeys) {
      if (!this.currentReviewKeys.has(key) && !this.seenReviewKeys.has(key)) {
        this.newReviewKeys.add(key);
        this.spinningReviewKeys.set(key, Date.now() + NEW_REVIEW_SPIN_MS);
      }
    }
    for (const key of this.newReviewKeys) {
      if (!nextKeys.has(key)) {
        this.newReviewKeys.delete(key);
        this.spinningReviewKeys.delete(key);
      }
    }
    this.pruneExpiredSpins();
    this.currentReviewKeys = nextKeys;
    if (previousCount !== this.newReviewKeys.size) {
      this._onDidChangeNewReviewCount.fire(this.newReviewKeys.size);
    }
    this.scheduleSpinRefresh();
  }

  private reviewEntries(): Array<[string, Ticket]> {
    const state = this.kronosState.state;
    if (!state) { return []; }
    return Object.entries(state.tickets || {})
      .filter((entry): entry is [string, Ticket] => isReviewTicket(entry[1]));
  }

  private isReviewItemSpinning(ticketKey: string): boolean {
    return (this.spinningReviewKeys.get(ticketKey) || 0) > Date.now();
  }

  private pruneExpiredSpins(now = Date.now()): void {
    for (const [key, until] of this.spinningReviewKeys) {
      if (until <= now || !this.newReviewKeys.has(key)) {
        this.spinningReviewKeys.delete(key);
      }
    }
  }

  private scheduleSpinRefresh(): void {
    this.clearSpinTimer();
    const now = Date.now();
    const next = Math.min(...[...this.spinningReviewKeys.values()].filter(until => until > now));
    if (!Number.isFinite(next)) { return; }
    this.spinTimer = setTimeout(() => {
      this.spinTimer = undefined;
      this.pruneExpiredSpins();
      this._onDidChangeTreeData.fire(undefined);
      this.scheduleSpinRefresh();
    }, Math.max(50, next - now));
  }

  private clearSpinTimer(): void {
    if (this.spinTimer) {
      clearTimeout(this.spinTimer);
      this.spinTimer = undefined;
    }
  }

  dispose(): void {
    this.clearSpinTimer();
    this.stateSubscription.dispose();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeNewReviewCount.dispose();
  }
}

class ReviewItem extends vscode.TreeItem {
  public readonly ticketKey: string;
  public readonly ticket: Ticket;
  public readonly projectName: string;

  constructor(ticketKey: string, ticket: Ticket, isNew = false, isSpinning = false) {
    super(ticketKey || '', vscode.TreeItemCollapsibleState.None);
    this.ticketKey = ticketKey;
    this.ticket = ticket;
    this.projectName = ticket.projects?.[0] || '';

    if (!ticketKey) { return; }

    this.contextValue = 'review_item';
    const mr = ticket.mr!;
    const reviewStatus = mr.review_status.replace(/_/g, ' ');
    const projs = ticket.projects?.join(', ') || 'unlinked';
    const latestComment = latestMergeRequestCommentSummary(ticket);
    const commentSuffix = mr.comment_count !== undefined ? ` · ${mr.comment_count} comment${mr.comment_count === 1 ? '' : 's'}` : '';
    const unresolvedSuffix = mr.unresolved_discussion_count !== undefined && mr.unresolved_discussion_count > 0
      ? ` · ${mr.unresolved_discussion_count} unresolved`
      : '';

    this.description = `${isNew ? 'NEW · ' : ''}${projs} · MR !${mr.iid} · ${reviewStatus}${commentSuffix}${unresolvedSuffix}`;
    this.label = `${ticketKey} — ${ticket.summary}`;
    this.tooltip = new vscode.MarkdownString(
      `**${ticketKey}**: ${ticket.summary}\n\n` +
      (isNew ? `New since you last opened the Review view.\n\n` : '') +
      `Projects: ${projs}\n\nMR: !${mr.iid} — ${reviewStatus}\n\n` +
      (mr.unresolved_discussion_count !== undefined ? `Unresolved discussions: ${mr.unresolved_discussion_count}\n\n` : '') +
      (latestComment ? `Latest MR comment: ${latestComment}\n\n` : '') +
      `_Click to view diff_`
    );
    this.command = { command: 'kronos.openMrDiff', title: 'View Diff', arguments: [this] };

    const color = mr.review_status === 'approved' ? new vscode.ThemeColor('testing.iconPassed')
      : mr.review_status === 'changes_requested' ? new vscode.ThemeColor('testing.iconFailed')
      : new vscode.ThemeColor('charts.yellow');
    this.iconPath = isSpinning
      ? new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.yellow'))
      : isNew
      ? new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.yellow'))
      : new vscode.ThemeIcon('git-pull-request', color);
  }
}

function isReviewTicket(ticket: Ticket): boolean {
  return Boolean(ticket.mr && ticket.next_action === 'await_review' && ticket.mr.state === 'opened');
}

function latestMergeRequestCommentSummary(ticket: Ticket): string {
  const comments = ticket.mr?.comments || [];
  const latest = comments.at(-1);
  if (!latest) { return ''; }
  const author = latest.author ? `${latest.author}: ` : '';
  const body = latest.body.replace(/\s+/g, ' ').trim();
  const summary = body.length > 180 ? `${body.slice(0, 177)}...` : body;
  return `${author}${summary}`;
}
