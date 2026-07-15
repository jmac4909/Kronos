import * as vscode from 'vscode';
import { boundedOperationFailure } from '../services/errorUtils';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import { WorkSessionRecord, listWorkSessions } from '../services/workSessionStore';
import { readProjectGitBranch } from '../services/projectCatalog';
import { workSessionLifecycle } from '../services/workSessionLifecycle';
import {
  sessionInventoryPresentation,
  sessionInventorySortOrder,
} from '../services/sessionInventoryPresentation';

export interface ManagedSessionCommandTarget {
  workSessionId: string;
  ticketKey?: string;
  liveTerminalBindingIds: readonly string[];
}

type WorkSessionLoader = () => WorkSessionRecord[];
type SessionTreeElement = ManagedSessionTreeItem | ManagedSessionMessageTreeItem;

/** Operator-owned terminal sessions stay independent from registered project inventory. */
export class ManagedSessionTreeProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SessionTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly pollIntervalMs: () => number = () => 300_000,
  ) {}

  getTreeItem(element: SessionTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
    if (element) { return []; }
    const sessions = this.safeLoadWorkSessions().sort((left, right) => sessionInventorySortOrder(left, right));
    return sessions.length > 0
      ? sessions.map(session => new ManagedSessionTreeItem(
        session,
        this.operatorTerminals.listBindings(session.id).map(binding => binding.bindingId),
        this.pollIntervalMs(),
      ))
      : [new ManagedSessionMessageTreeItem()];
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      console.warn(`Kronos managed-session refresh failed: ${boundedOperationFailure(error, 'Managed session state could not be read.').display}`);
      return [];
    }
  }
}

export class ManagedSessionTreeItem extends vscode.TreeItem implements ManagedSessionCommandTarget {
  readonly workSessionId: string;
  readonly ticketKey?: string;
  readonly liveTerminalBindingIds: readonly string[];

  constructor(readonly session: WorkSessionRecord, liveTerminalBindingIds: readonly string[], pollIntervalMs: number) {
    const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
    const presentation = sessionInventoryPresentation(session, liveTerminalBindingIds.length, pollIntervalMs, branch);
    super(presentation.label, vscode.TreeItemCollapsibleState.None);
    this.workSessionId = session.id;
    if (session.kind === 'ticket') { this.ticketKey = session.ticketKey; }
    this.liveTerminalBindingIds = [...liveTerminalBindingIds].sort();
    const liveCount = this.liveTerminalBindingIds.length;
    const lifecycle = workSessionLifecycle(session, liveCount);
    const attached = lifecycle.terminal === 'attached';
    const commandTarget: ManagedSessionCommandTarget = {
      workSessionId: this.workSessionId,
      liveTerminalBindingIds: this.liveTerminalBindingIds,
    };
    if (this.ticketKey) { commandTarget.ticketKey = this.ticketKey; }
    this.id = `work-session:${session.id}`;
    const projectMonitoringSession = session.kind === 'standalone'
      && session.ticketKeys.length > 0
      && Boolean(session.projectName || session.projectPath);
    this.contextValue = session.kind === 'standalone' && !projectMonitoringSession
      ? session.status === 'closed' ? 'standalone_session_closed' : attached ? 'standalone_session_attached' : 'standalone_session_detached'
      : session.status === 'closed' ? 'work_session_closed'
        : !session.monitoring.enabled ? attached ? 'work_session_attached_paused' : 'work_session_detached_paused'
          : attached ? 'work_session_attached' : 'work_session_detached';
    this.description = presentation.description;
    this.tooltip = presentation.tooltip;
    this.iconPath = sessionIcon(session, attached);
    this.command = { command: 'kronos.focusWorkSessionTerminal', title: 'Open Session Terminal', arguments: [commandTarget] };
  }
}

class ManagedSessionMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('New Claude session', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'managed_session_empty';
    this.description = 'no Jira ticket required';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = {
      command: 'kronos.newClaudeSession',
      title: 'New Claude Session',
    };
  }
}

function sessionIcon(session: WorkSessionRecord, attached: boolean): vscode.ThemeIcon {
  if (session.status === 'closed') { return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground')); }
  return attached
    ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
}
