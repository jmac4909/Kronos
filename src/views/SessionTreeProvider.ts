import * as vscode from 'vscode';
import * as path from 'path';
import { KronosState } from '../state/KronosState';
import { ClaudeSession } from '../state/types';
import { KronosRun, listRuns } from '../runners/sessionDispatcher';
import { configIntervalMs } from '../services/intervalConfig';
import { isFreshActiveRun } from '../services/runStatus';
import { formatRunProgress } from '../services/runProgress';
import { isAttentionRunStatus, runAttentionLine } from '../services/runAttention';
import { unknownErrorMessage } from '../services/errorUtils';
import { formatTimeLabel } from '../services/dateLabels';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import { WorkSessionRecord, listWorkSessions } from '../services/workSessionStore';

type SessionTreeEntry =
  | { kind: 'work-session'; session: WorkSessionRecord; liveTerminalCount: number }
  | { kind: 'run'; run: KronosRun }
  | { kind: 'claude'; session: ClaudeSession }
  | { kind: 'empty' };

export class SessionTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private _timer: NodeJS.Timeout | undefined;
  private _refreshing = false;
  private readonly sessionSubscription: vscode.Disposable;

  constructor(
    private kronosState: KronosState,
    private operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
  ) {
    this.sessionSubscription = kronosState.onDidSessionChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  startPolling(intervalMs: number): void {
    this.stopPolling();
    const safeIntervalMs = configIntervalMs(intervalMs, 5000);
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
    const workSessions = safeListWorkSessions();
    const runs = listRuns();
    const activeRuns = runs.filter(run => isFreshActiveRun(run));
    const attentionRuns = runs.filter(run => isAttentionRunStatus(run.status)).slice(0, 5);
    if (workSessions.length === 0 && sessions.length === 0 && activeRuns.length === 0 && attentionRuns.length === 0) {
      return [new SessionTreeItem('No active sessions', { kind: 'empty' })];
    }

    return [
      ...workSessions.map(session => new SessionTreeItem(workSessionTreeLabel(session), {
        kind: 'work-session',
        session,
        liveTerminalCount: this.operatorTerminals.listBindings(session.id).length,
      })),
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

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
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

    if (entry.kind === 'work-session') {
      const session = entry.session;
      const attached = entry.liveTerminalCount > 0;
      const monitoringLabel = session.monitoring.enabled
        ? `monitoring ${session.monitoring.lastState || 'waiting'}`
        : 'monitoring off';
      this.contextValue = session.status === 'closed'
        ? 'work_session_closed'
        : attached ? 'work_session_attached' : 'work_session_detached';
      this.id = `work-session:${session.id}`;
      this.description = session.status === 'closed'
        ? 'management closed'
        : attached
          ? `terminal attached • ${monitoringLabel}`
          : `terminal detached • ${monitoringLabel}`;
      const providers = [...new Set(session.providerBindings.map(binding => binding.provider))].join(', ') || 'none';
      this.tooltip = [
        `Work session: ${session.id}`,
        `Ticket: ${session.ticketKey}`,
        `Terminal ownership: operator`,
        `Live terminal bindings: ${entry.liveTerminalCount}`,
        `Providers: ${providers}`,
        `Context artifacts: ${session.artifacts.length}`,
        `Monitoring: ${session.monitoring.enabled ? 'enabled' : 'disabled'}`,
        `Monitoring readiness: ${session.monitoring.lastState || 'not yet polled'}`,
        `Monitoring result: ${session.monitoring.lastSummary || 'none'}`,
        `Last monitoring attempt: ${session.monitoring.lastAttemptAt || 'never'}`,
        `Updated: ${session.updatedAt}`,
      ].join('\n');
      this.iconPath = session.status === 'closed'
        ? new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground'))
        : attached
          ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
          : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
      this.command = {
        command: attached ? 'kronos.focusWorkSessionTerminal' : 'kronos.reattachWorkSessionTerminal',
        title: attached ? 'Focus Managed Terminal' : 'Reattach Active Terminal',
        arguments: [{ workSessionId: session.id }],
      };
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
    const started = formatTimeLabel(session.startedAt, 'unknown');
    this.tooltip = `PID: ${session.pid}\nDirectory: ${session.cwd}\nStatus: ${session.status}\nStarted: ${started}`;

    const icon = session.status === 'busy' ? 'play' : 'circle-outline';
    const color = session.status === 'busy'
      ? new vscode.ThemeColor('charts.blue')
      : new vscode.ThemeColor('testing.iconPassed');
    this.iconPath = new vscode.ThemeIcon(icon, color);
  }
}

function safeListWorkSessions(): WorkSessionRecord[] {
  try {
    return listWorkSessions();
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, 'Kronos work session refresh failed.'));
    return [];
  }
}

function workSessionTreeLabel(session: WorkSessionRecord): string {
  return `${session.ticketKey}: ${session.title}`;
}

function runTreeLabel(run: KronosRun): string {
  const project = run.project || path.basename(run.projectPath || run.cwd || '') || 'project';
  const target = run.ticket || run.skill || run.id;
  return `${project}: ${target}`;
}
