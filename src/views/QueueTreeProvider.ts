import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { QueueItem } from '../state/types';
import { KronosRun, listRuns } from '../runners/sessionDispatcher';
import { actionDisplayLabel as actionToLabel } from '../services/actionCatalog';
import { activeRunForQueueItem } from '../services/queueActiveRun';
import { formatRunProgress } from '../services/runProgress';
import { isFreshActiveRun } from '../services/runStatus';
import { queueActionIcon, themeIcon } from './actionIcons';

export class QueueTreeProvider implements vscode.TreeDataProvider<QueueTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueueTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;
  private hadActiveRuns = false;
  private readonly stateSubscription: vscode.Disposable;

  constructor(private kronosState: KronosState) {
    this.stateSubscription = kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: QueueTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): QueueTreeItem[] {
    const queue = this.kronosState.queue;
    if (!queue || queue.items.length === 0) {
      const empty = new QueueTreeItem({
        id: '', projects: [], project_path: '', ticket: null,
        action: '', priority_score: 0, reason: '',
      }, 0);
      empty.label = 'Queue empty — click refresh';
      empty.iconPath = new vscode.ThemeIcon('info');
      empty.command = { command: 'kronos.refresh', title: 'Refresh' };
      return [empty];
    }

    const activeRuns = listRuns().filter(run => isFreshActiveRun(run));
    this.hadActiveRuns = activeRuns.length > 0;
    return queue.items.map((item, idx) => new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns)));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000;
    this._timer = setInterval(() => {
      const activeNow = listRuns().some(run => isFreshActiveRun(run));
      if (activeNow || this.hadActiveRuns) {
        this._onDidChangeTreeData.fire(undefined);
      }
      this.hadActiveRuns = activeNow;
    }, safeIntervalMs);
  }

  stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
    this.stateSubscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

class QueueTreeItem extends vscode.TreeItem {
  public readonly item: QueueItem;
  public readonly index: number;

  constructor(item: QueueItem, index: number, activeRun?: KronosRun) {
    const ticketPart = item.ticket || 'refresh';
    const summaryPart = item.ticket_summary ? ` — ${item.ticket_summary}` : '';
    super(item.action ? `${ticketPart}${summaryPart}` : '', vscode.TreeItemCollapsibleState.None);

    this.item = item;
    this.index = index;

    if (!item.action) { return; }

    this.contextValue = 'queue_item';
    const actionLabel = actionToLabel(item.action);
    const projs = (item.projects || []).join(', ') || 'unlinked';
    const progress = activeRun ? formatRunProgress(activeRun) : '';
    this.description = activeRun
      ? `$(sync~spin) ${projs} · [${actionLabel}] ${item.priority_score} · ${progress}`
      : `${projs} · [${actionLabel}] ${item.priority_score}`;

    this.tooltip = new vscode.MarkdownString(
      `**${(item.projects || []).join(', ')} / ${item.ticket || 'refresh'}**${summaryPart}\n\n` +
      `Action: ${actionLabel}\n\n` +
      `Score: ${item.priority_score}\n\n` +
      (activeRun ? `Active run: ${activeRun.id}\n\nProgress: ${progress}\n\n` : '') +
      `${item.reason}\n\n` +
      `_Click to start · Right-click to reorder_`
    );

    this.command = {
      command: 'kronos.startQueueItem',
      title: 'Start',
      arguments: [item],
    };

    this.iconPath = activeRun
      ? new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'))
      : themeIcon(queueActionIcon(item.action));
  }
}
