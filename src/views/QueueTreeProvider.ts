import * as vscode from 'vscode';
import { KronosState } from '../state/KronosState';
import { QueueItem } from '../state/types';
import { KronosRun, listRuns } from '../runners/sessionDispatcher';
import { actionToLabel } from '../services/actionLabels';
import { skillForAction } from '../services/nextActionContext';
import { formatRunProgress } from '../services/runProgress';
import { isActiveRun } from '../services/runStatus';
import { queueActionIcon, themeIcon } from './actionIcons';

export class QueueTreeProvider implements vscode.TreeDataProvider<QueueTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QueueTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;

  constructor(private kronosState: KronosState) {
    kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
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
      empty.contextValue = undefined;
      return [empty];
    }

    const activeRuns = listRuns().filter(isActiveRun);
    return queue.items.map((item, idx) => new QueueTreeItem(item, idx, activeRunForQueueItem(item, activeRuns)));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this._timer = setInterval(() => {
      if (listRuns().some(isActiveRun)) {
        this._onDidChangeTreeData.fire(undefined);
      }
    }, intervalMs);
  }

  stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  dispose(): void {
    this.stopPolling();
  }
}

export class QueueTreeItem extends vscode.TreeItem {
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

function activeRunForQueueItem(item: QueueItem, activeRuns: KronosRun[]): KronosRun | undefined {
  return activeRuns.find(run => runMatchesQueueItem(run, item));
}

function runMatchesQueueItem(run: KronosRun, item: QueueItem): boolean {
  if (item.ticket) {
    return runMatchesQueueTicket(run, item)
      && runMatchesQueueAction(run, item)
      && runMatchesQueueProjectScope(run, item);
  }
  return runMatchesQueueProject(run, item) && runMatchesQueueAction(run, item);
}

function runMatchesQueueTicket(run: KronosRun, item: QueueItem): boolean {
  return Boolean(item.ticket && run.ticket === item.ticket);
}

function runMatchesQueueProject(run: KronosRun, item: QueueItem): boolean {
  const projects = item.projects || [];
  return Boolean((run.project && projects.includes(run.project)) || (run.projectPath && run.projectPath === item.project_path));
}

function runMatchesQueueProjectScope(run: KronosRun, item: QueueItem): boolean {
  if ((item.projects || []).length === 0 && !item.project_path) {
    return true;
  }
  return runMatchesQueueProject(run, item);
}

function runMatchesQueueAction(run: KronosRun, item: QueueItem): boolean {
  return !item.action || run.skill === skillForAction(item.action);
}
