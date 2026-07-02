import * as vscode from 'vscode';
import * as path from 'path';
import { KronosState } from '../state/KronosState';
import { ClaudeSession } from '../state/types';
import { KronosRun, listRuns } from '../runners/sessionDispatcher';
import { isActiveRun } from '../services/runStatus';

type SessionTreeEntry =
  | { kind: 'run'; run: KronosRun }
  | { kind: 'claude'; session: ClaudeSession }
  | { kind: 'empty' };

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;

  constructor(private kronosState: KronosState) {
    kronosState.onDidSessionChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    this._timer = setInterval(async () => {
      await this.kronosState.refreshSessions();
    }, intervalMs);
    this.kronosState.refreshSessions();
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
    const activeRuns = listRuns().filter(isActiveRun);
    if (sessions.length === 0 && activeRuns.length === 0) {
      return [new SessionTreeItem('No active sessions', { kind: 'empty' })];
    }

    return [
      ...activeRuns.map(run => new SessionTreeItem(runTreeLabel(run), { kind: 'run', run })),
      ...sessions.map(session => new SessionTreeItem(`${path.basename(session.cwd)} (pid ${session.pid})`, { kind: 'claude', session })),
    ];
  }

  dispose(): void {
    this.stopPolling();
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
      this.contextValue = 'run';
      this.description = run.status;
      this.tooltip = `Run: ${run.id}\nProject: ${run.project || 'unknown'}\nTicket: ${run.ticket || 'none'}\nSkill: ${run.skill || 'unknown'}\nStatus: ${run.status}\nStarted: ${run.startedAt || 'unknown'}`;
      this.iconPath = new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('charts.blue'));
      this.command = { command: 'kronos.runCenter', title: 'Open Run Center' };
      return;
    }

    const session = entry.session;
    this.contextValue = 'session';
    this.description = session.status;
    const started = new Date(session.startedAt);
    this.tooltip = `PID: ${session.pid}\nDirectory: ${session.cwd}\nStatus: ${session.status}\nStarted: ${started.toLocaleTimeString()}`;

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
