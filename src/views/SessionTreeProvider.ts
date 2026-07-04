import * as vscode from 'vscode';
import * as path from 'path';
import { KronosState } from '../state/KronosState';
import { ClaudeSession } from '../state/types';
import { KronosRun, listRuns } from '../runners/sessionDispatcher';
import { isFreshActiveRun } from '../services/runStatus';
import { formatRunProgress } from '../services/runProgress';
import { isAttentionRunStatus, runAttentionLine } from '../services/runAttention';
import { unknownErrorMessage } from '../services/errorUtils';
import { toValidDate } from '../services/dateValues';

type SessionTreeEntry =
  | { kind: 'run'; run: KronosRun }
  | { kind: 'claude'; session: ClaudeSession }
  | { kind: 'empty' };

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;
  private _refreshing = false;
  private readonly sessionSubscription: vscode.Disposable;

  constructor(private kronosState: KronosState) {
    this.sessionSubscription = kronosState.onDidSessionChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000;
    this._timer = setInterval(() => {
      void this.refreshSessionsSafely();
    }, safeIntervalMs);
    void this.refreshSessionsSafely();
  }

  stopPolling(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = undefined;
    }
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): SessionTreeItem[] {
    const sessions = this.kronosState.sessions;
    const runs = listRuns();
    const activeRuns = runs.filter(run => isFreshActiveRun(run));
    const attentionRuns = runs.filter(run => isAttentionRunStatus(run.status)).slice(0, 5);
    if (sessions.length === 0 && activeRuns.length === 0 && attentionRuns.length === 0) {
      return [new SessionTreeItem('No active sessions', { kind: 'empty' })];
    }

    return [
      ...activeRuns.map(run => new SessionTreeItem(runTreeLabel(run), { kind: 'run', run })),
      ...attentionRuns.map(run => new SessionTreeItem(runTreeLabel(run), { kind: 'run', run })),
      ...sessions.map(session => new SessionTreeItem(`${path.basename(session.cwd)} (pid ${session.pid})`, { kind: 'claude', session })),
    ];
  }

  dispose(): void {
    this.stopPolling();
    this.sessionSubscription.dispose();
    this._onDidChangeTreeData.dispose();
  }

  private async refreshSessionsSafely(): Promise<void> {
    if (this._refreshing) { return; }
    this._refreshing = true;
    try {
      await this.kronosState.refreshSessions();
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, 'Kronos session refresh failed.'));
    } finally {
      this._refreshing = false;
    }
  }
}

class SessionTreeItem extends vscode.TreeItem {
  constructor(label: string, entry: SessionTreeEntry) {
    super(label, vscode.TreeItemCollapsibleState.None);
    if (entry.kind === 'empty') {
      return;
    }

    if (entry.kind === 'run') {
      const run = entry.run;
      const progress = formatRunProgress(run);
      const attention = isAttentionRunStatus(run.status) ? runAttentionLine(run, 90) : '';
      this.contextValue = 'run';
      this.id = run.id;
      this.description = attention ? `${run.status} - ${attention}` : `${run.status} - ${progress}`;
      this.tooltip = `Run: ${run.id}\nProject: ${run.project || 'unknown'}\nTicket: ${run.ticket || 'none'}\nSkill: ${run.skill || 'unknown'}\nStatus: ${run.status}${attention ? `\nReason: ${attention}` : ''}\nProgress: ${progress}\nStarted: ${run.startedAt || 'unknown'}`;
      this.iconPath = attention
        ? new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'))
        : new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
      this.command = { command: 'kronos.runCenter', title: 'Open Run Center', arguments: [{ runId: run.id }] };
      return;
    }

    const session = entry.session;
    this.contextValue = 'session';
    this.description = session.status;
    const started = toValidDate(session.startedAt)?.toLocaleTimeString() || 'unknown';
    this.tooltip = `PID: ${session.pid}\nDirectory: ${session.cwd}\nStatus: ${session.status}\nStarted: ${started}`;

    const icon = session.status === 'busy' ? 'play' : 'circle-outline';
    const color = session.status === 'busy'
      ? new vscode.ThemeColor('charts.blue')
      : new vscode.ThemeColor('testing.iconPassed');
    this.iconPath = new vscode.ThemeIcon(icon, color);
  }
}

function runTreeLabel(run: KronosRun): string {
  const project = run.project || path.basename(run.projectPath || run.cwd || '') || 'project';
  const target = run.ticket || run.skill || run.id;
  return `${project}: ${target}`;
}
