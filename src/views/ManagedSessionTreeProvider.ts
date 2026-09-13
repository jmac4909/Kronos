import * as vscode from 'vscode';
import { boundedOperationFailure } from '../services/errorUtils';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import {
  WorkSessionRecord,
  listWorkSessions,
  resumableWorkSessionTerminalBindings,
} from '../services/workSessionStore';
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

export type ManagedSessionContextValue =
  | 'standalone_session_attached'
  | 'standalone_session_detached'
  | 'standalone_session_closed'
  | 'work_session_attached'
  | 'work_session_detached'
  | 'work_session_attached_paused'
  | 'work_session_detached_paused'
  | 'work_session_closed';

type WorkSessionLoader = () => WorkSessionRecord[];
type ProjectDisplayNameLoader = (projectName: string) => string | undefined;
type SessionTreeElement = ManagedSessionTreeItem | ManagedSessionTreeMessageItem;

/** Operator-owned terminal sessions stay independent from registered project inventory. */
export class ManagedSessionTreeProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SessionTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private loadWarning = false;

  constructor(
    private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly pollIntervalMs: () => number = () => 300_000,
    private readonly loadProjectDisplayName: ProjectDisplayNameLoader = () => undefined,
  ) {}

  getTreeItem(element: SessionTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
    if (element) { return []; }
    this.loadWarning = false;
    const sessions = this.safeLoadWorkSessions().sort((left, right) => sessionInventorySortOrder(left, right));
    if (this.loadWarning) { return [new ManagedSessionTreeMessageItem('warning')]; }
    return sessions.length > 0
      ? sessions.map(session => new ManagedSessionTreeItem(
        session,
        this.operatorTerminals.listBindings(session.id).map(binding => binding.bindingId),
        this.pollIntervalMs(),
        session.projectName ? this.loadProjectDisplayName(session.projectName) : undefined,
      ))
      : [new ManagedSessionTreeMessageItem('empty')];
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      this.loadWarning = true;
      console.warn(`Kronos managed-session refresh failed: ${boundedOperationFailure(error, 'Managed session state could not be read.').display}`);
      return [];
    }
  }
}

export class ManagedSessionTreeItem extends vscode.TreeItem implements ManagedSessionCommandTarget {
  readonly workSessionId: string;
  readonly ticketKey?: string;
  readonly liveTerminalBindingIds: readonly string[];

  constructor(
    readonly session: WorkSessionRecord,
    liveTerminalBindingIds: readonly string[],
    pollIntervalMs: number,
    projectDisplayName?: string,
  ) {
    const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
    const presentation = sessionInventoryPresentation(
      session,
      liveTerminalBindingIds.length,
      pollIntervalMs,
      branch,
      projectDisplayName,
    );
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
    this.contextValue = managedSessionContextValue(session, attached);
    this.description = presentation.description;
    this.tooltip = presentation.tooltip;
    this.iconPath = sessionIcon(
      session,
      attached,
      liveCount === 0 && resumableWorkSessionTerminalBindings(session).length > 0,
    );
    this.command = { command: 'kronos.focusWorkSessionTerminal', title: 'Open Session Terminal', arguments: [commandTarget] };
  }
}

/** Keeps the manifest's Session action contexts exhaustive and reviewable. */
export function managedSessionContextValue(
  session: WorkSessionRecord,
  attached: boolean,
): ManagedSessionContextValue {
  const projectMonitoringSession = session.kind === 'standalone'
    && session.ticketKeys.length > 0
    && Boolean(session.projectName || session.projectPath);
  if (session.kind === 'standalone' && !projectMonitoringSession) {
    if (session.status === 'closed') { return 'standalone_session_closed'; }
    return attached ? 'standalone_session_attached' : 'standalone_session_detached';
  }
  if (session.status === 'closed') { return 'work_session_closed'; }
  if (!session.monitoring.enabled) {
    return attached ? 'work_session_attached_paused' : 'work_session_detached_paused';
  }
  return attached ? 'work_session_attached' : 'work_session_detached';
}

class ManagedSessionTreeMessageItem extends vscode.TreeItem {
  constructor(kind: 'empty' | 'warning') {
    super(kind === 'warning' ? 'Sessions may be incomplete' : 'New Claude session', vscode.TreeItemCollapsibleState.None);
    if (kind === 'warning') {
      this.contextValue = 'managed_session_error';
      this.description = 'Open Check Setup, then refresh';
      this.tooltip = 'Kronos could not load saved Sessions. Select to open Check Setup.';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      this.command = { command: 'kronos.doctor', title: 'Check Setup' };
      return;
    }
    this.contextValue = 'managed_session_empty';
    this.description = 'No Jira ticket required';
    this.iconPath = new vscode.ThemeIcon('add');
    this.command = { command: 'kronos.newClaudeSession', title: 'New Claude Session' };
  }
}

function sessionIcon(
  session: WorkSessionRecord,
  attached: boolean,
  exactResumeAvailable: boolean,
): vscode.ThemeIcon {
  if (session.status === 'closed') { return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground')); }
  if (exactResumeAvailable) {
    return new vscode.ThemeIcon('debug-restart', new vscode.ThemeColor('charts.yellow'));
  }
  return attached
    ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
}
