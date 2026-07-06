import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { Ticket } from '../state/types';
import { mergeRequestReviewStatusLabel } from '../services/mergeRequestLabels';
import { compactSingleLineText } from '../services/textFormat';
import { TicketFilter, describeTicketFilter, hasTicketFilter, ticketMatchesFilter } from '../services/ticketFilters';
import { openReviewTicketEntries } from '../services/reviewWork';

const NEW_REVIEW_SPIN_MS = 6000;

type TicketWithOpenMergeRequest = ReturnType<typeof openReviewTicketEntries>[number][1];

interface NewReviewItemSummary {
  ticketKey: string;
  summary: string;
  projectNames: string[];
  activityKey: string;
  mrIid?: number;
  activity?: string;
}

export interface ReviewSeenKeysStore {
  get(): readonly string[] | undefined;
  update(keys: readonly string[]): Thenable<void> | void;
}

interface ReviewEntrySnapshot {
  ticketKey: string;
  ticket: TicketWithOpenMergeRequest;
  activityKey: string;
  activity: string;
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

  constructor(private kronosState: KronosState, private readonly seenKeysStore?: ReviewSeenKeysStore) {
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
  getNewReviewCount(): number { return this.getNewReviewItems().length; }
  getNewReviewItems(): NewReviewItemSummary[] {
    return this.reviewEntrySnapshots()
      .filter(snapshot => this.newReviewKeys.has(snapshot.activityKey))
      .map(({ ticketKey, ticket, activityKey, activity }) => {
        const summary: NewReviewItemSummary = {
          ticketKey,
          summary: ticket.summary,
          projectNames: ticket.projects || [],
          activityKey,
        };
        if (ticket.mr?.iid !== undefined) { summary.mrIid = ticket.mr.iid; }
        if (activity) { summary.activity = activity; }
        return summary;
      });
  }

  markVisibleReviewItemsSeen(): void {
    if (this.currentReviewKeys.size === 0 && this.newReviewKeys.size === 0) { return; }
    const previousCount = this.newReviewKeys.size;
    const visibleKeys = this.visibleReviewKeys();
    let seenKeysChanged = false;
    for (const key of visibleKeys) {
      if (!this.seenReviewKeys.has(key)) {
        seenKeysChanged = true;
      }
      this.seenReviewKeys.add(key);
      this.newReviewKeys.delete(key);
      this.spinningReviewKeys.delete(key);
    }
    if (this.spinningReviewKeys.size === 0) {
      this.clearSpinTimer();
    } else {
      this.scheduleSpinRefresh();
    }
    if (seenKeysChanged) {
      this.persistSeenReviewKeys();
    }
    if (previousCount !== this.newReviewKeys.size) {
      this._onDidChangeNewReviewCount.fire(this.getNewReviewCount());
      this._onDidChangeTreeData.fire(undefined);
    }
  }

  getChildren(): ReviewItem[] {
    const state = this.kronosState.state;
    if (!state) { return []; }

    const items: ReviewItem[] = [];
    for (const snapshot of this.reviewEntrySnapshots()) {
      if (ticketMatchesFilter(snapshot.ticketKey, snapshot.ticket, this.filter)) {
        const isNew = this.newReviewKeys.has(snapshot.activityKey);
        items.push(new ReviewItem(
          snapshot.ticketKey,
          snapshot.ticket,
          isNew,
          isNew && this.isReviewItemSpinning(snapshot.activityKey),
        ));
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
    const initialSnapshots = this.reviewEntrySnapshots();
    const initialKeys = new Set(initialSnapshots.map(snapshot => snapshot.activityKey));
    this.currentReviewKeys = initialKeys;
    this.newReviewKeys.clear();
    this.spinningReviewKeys.clear();
    this.clearSpinTimer();
    const storedSeenKeys = this.seenKeysStore?.get();
    if (storedSeenKeys === undefined) {
      this.seenReviewKeys = new Set(initialKeys);
      this.persistSeenReviewKeys();
      return;
    }
    const storedSeen = new Set(storedSeenKeys);
    this.seenReviewKeys = new Set(initialSnapshots
      .filter(snapshot => storedSeen.has(snapshot.activityKey) || storedSeen.has(snapshot.ticketKey))
      .map(snapshot => snapshot.activityKey));
    for (const snapshot of initialSnapshots) {
      if (!this.seenReviewKeys.has(snapshot.activityKey)) {
        this.newReviewKeys.add(snapshot.activityKey);
        this.spinningReviewKeys.set(snapshot.activityKey, Date.now() + NEW_REVIEW_SPIN_MS);
      }
    }
    const retainedStoredSeenKeys = new Set([...storedSeen].filter(key => initialKeys.has(key)));
    if (!stringSetsEqual(this.seenReviewKeys, retainedStoredSeenKeys) || retainedStoredSeenKeys.size !== storedSeen.size) {
      this.persistSeenReviewKeys();
    }
    this.scheduleSpinRefresh();
  }

  private refreshReviewKeys(): void {
    const previousNewReviewKeys = new Set(this.newReviewKeys);
    const nextSnapshots = this.reviewEntrySnapshots();
    const nextKeys = new Set(nextSnapshots.map(snapshot => snapshot.activityKey));
    let seenKeysChanged = false;
    for (const key of this.seenReviewKeys) {
      if (!nextKeys.has(key)) {
        this.seenReviewKeys.delete(key);
        seenKeysChanged = true;
      }
    }
    for (const snapshot of nextSnapshots) {
      if (!this.currentReviewKeys.has(snapshot.activityKey) && !this.seenReviewKeys.has(snapshot.activityKey)) {
        this.newReviewKeys.add(snapshot.activityKey);
        this.spinningReviewKeys.set(snapshot.activityKey, Date.now() + NEW_REVIEW_SPIN_MS);
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
    if (!stringSetsEqual(previousNewReviewKeys, this.newReviewKeys)) {
      this._onDidChangeNewReviewCount.fire(this.getNewReviewCount());
    }
    if (seenKeysChanged) {
      this.persistSeenReviewKeys();
    }
    this.scheduleSpinRefresh();
  }

  private persistSeenReviewKeys(): void {
    if (!this.seenKeysStore) { return; }
    try {
      const result = this.seenKeysStore.update([...this.seenReviewKeys].sort());
      if (result && typeof result.then === 'function') {
        void result.then(undefined, (e: unknown) => {
          console.warn('Kronos review seen-key persistence failed.', e);
        });
      }
    } catch (e: unknown) {
      console.warn('Kronos review seen-key persistence failed.', e);
    }
  }

  private reviewEntries(): Array<[string, TicketWithOpenMergeRequest]> {
    const state = this.kronosState.state;
    if (!state) { return []; }
    return openReviewTicketEntries(state.tickets);
  }

  private reviewEntrySnapshots(): ReviewEntrySnapshot[] {
    return this.reviewEntries().map(([ticketKey, ticket]) => ({
      ticketKey,
      ticket,
      activityKey: reviewActivityKey(ticketKey, ticket),
      activity: reviewActivitySummary(ticket),
    }));
  }

  private visibleReviewKeys(): Set<string> {
    return new Set(this.reviewEntrySnapshots()
      .filter(snapshot => ticketMatchesFilter(snapshot.ticketKey, snapshot.ticket, this.filter))
      .map(snapshot => snapshot.activityKey));
  }

  private isReviewItemSpinning(activityKey: string): boolean {
    return (this.spinningReviewKeys.get(activityKey) || 0) > Date.now();
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

function stringSetsEqual(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
  if (first.size !== second.size) { return false; }
  for (const value of first) {
    if (!second.has(value)) { return false; }
  }
  return true;
}

function reviewActivityKey(ticketKey: string, ticket: TicketWithOpenMergeRequest): string {
  const mr = ticket.mr;
  return [
    ticketKey,
    `mr:${mr.iid}`,
    mr.state,
    mr.review_status,
    numberKeyPart(mr.comment_count),
    stringKeyPart(mr.last_comment_at),
    latestMergeRequestCommentMarker(ticket),
    numberKeyPart(mr.unresolved_discussion_count),
    numberKeyPart(mr.resolved_discussion_count),
    stringKeyPart(mr.last_discussion_at),
    mr.discussions_resolved === undefined ? '' : String(mr.discussions_resolved),
  ].join('|');
}

function reviewActivitySummary(ticket: TicketWithOpenMergeRequest): string {
  const mr = ticket.mr;
  const parts = [mergeRequestReviewStatusLabel(mr.review_status)];
  if (mr.comment_count !== undefined) {
    parts.push(`${mr.comment_count} comment${mr.comment_count === 1 ? '' : 's'}`);
  }
  if (mr.unresolved_discussion_count !== undefined && mr.unresolved_discussion_count > 0) {
    parts.push(`${mr.unresolved_discussion_count} unresolved`);
  } else if (mr.discussions_resolved === true) {
    parts.push('discussions resolved');
  }
  return parts.join(' · ');
}

function numberKeyPart(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.floor(value)) : '';
}

function stringKeyPart(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[|\r\n]/g, ' ').trim() : '';
}

function latestMergeRequestCommentMarker(ticket: TicketWithOpenMergeRequest): string {
  const latest = ticket.mr.comments?.at(-1);
  if (!latest) { return ''; }
  return [latest.id, latest.created].map(stringKeyPart).filter(Boolean).join('@');
}

class ReviewItem extends vscode.TreeItem {
  public readonly ticketKey: string;
  public readonly ticket: Ticket;

  constructor(ticketKey: string, ticket: Ticket, isNew = false, isSpinning = false) {
    super(ticketKey || '', vscode.TreeItemCollapsibleState.None);
    this.ticketKey = ticketKey;
    this.ticket = ticket;

    if (!ticketKey) { return; }

    this.contextValue = 'review_item';
    const mr = ticket.mr!;
    const reviewStatus = mergeRequestReviewStatusLabel(mr.review_status);
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

function latestMergeRequestCommentSummary(ticket: Ticket): string {
  const comments = ticket.mr?.comments || [];
  const latest = comments.at(-1);
  if (!latest) { return ''; }
  const author = latest.author ? `${latest.author}: ` : '';
  const summary = compactSingleLineText(latest.body, 180);
  return `${author}${summary}`;
}
