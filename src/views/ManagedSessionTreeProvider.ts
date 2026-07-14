import * as vscode from 'vscode';
import type { KronosState, ProjectConfig } from '../state/types';
import { OperatorTerminalRegistry } from '../services/operatorTerminalRegistry';
import { WorkSessionRecord, listWorkSessions } from '../services/workSessionStore';
import { listLocalProjects, readProjectGitBranch } from '../services/projectCatalog';
import { readProjectGitEvidence } from '../services/vscodeGitReadService';
import { isGitLabRestConfigured } from '../services/gitlabRestClient';
import { isJenkinsRestConfigured } from '../services/jenkinsRestClient';
import { isSonarRestConfigured } from '../services/sonarRestClient';

export interface ManagedSessionCommandTarget {
  workSessionId: string;
  ticketKey?: string;
  liveTerminalBindingIds: readonly string[];
}

export interface RegisteredProjectCommandTarget {
  projectName: string;
  projectPath: string;
}

type WorkSessionLoader = () => WorkSessionRecord[];
type StateLoader = () => KronosState | null;
type SessionTreeElement = SessionSectionTreeItem | ManagedSessionTreeItem | ManagedSessionMessageTreeItem
  | RegisteredProjectTreeItem | ProjectActionTreeItem;

/** Sessions and registered projects share one product view, while terminals remain operator-owned. */
export class ManagedSessionTreeProvider implements vscode.TreeDataProvider<SessionTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<SessionTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal>,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly loadState: StateLoader = () => null,
  ) {}

  getTreeItem(element: SessionTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: SessionTreeElement): Promise<SessionTreeElement[]> {
    if (!element) {
      return [new SessionSectionTreeItem('sessions'), new SessionSectionTreeItem('projects')];
    }
    if (element instanceof SessionSectionTreeItem && element.section === 'sessions') {
      const sessions = this.safeLoadWorkSessions().sort((left, right) => sessionSortOrder(left, right));
      return sessions.length > 0
        ? sessions.map(session => new ManagedSessionTreeItem(
          session,
          this.operatorTerminals.listBindings(session.id).map(binding => binding.bindingId),
        ))
        : [new ManagedSessionMessageTreeItem('session')];
    }
    if (element instanceof SessionSectionTreeItem && element.section === 'projects') {
      const state = this.safeLoadState();
      const projects = listLocalProjects(state);
      if (projects.length === 0) { return [new ManagedSessionMessageTreeItem('project')]; }
      return Promise.all(projects.map(async project => {
        const evidence = await readProjectGitEvidence(project.path, { includeDiff: false });
        const config = state?.projects[project.name]?.config || {};
        const linkedSessionCount = this.safeLoadWorkSessions().filter(session =>
          session.projectName === project.name && session.kind === 'ticket' && session.status === 'active' && session.monitoring.enabled
        ).length;
        return new RegisteredProjectTreeItem(
          { projectName: project.name, projectPath: project.path },
          evidence.branch || project.branch,
          evidence.available ? evidence.changeCount : undefined,
          config,
          linkedSessionCount,
          evidence.warning,
        );
      }));
    }
    if (element instanceof RegisteredProjectTreeItem) {
      return projectActions(element.target);
    }
    return [];
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      console.warn(`Kronos managed-session refresh failed: ${errorMessage(error)}`);
      return [];
    }
  }

  private safeLoadState(): KronosState | null {
    try { return this.loadState(); }
    catch (error: unknown) {
      console.warn(`Kronos project refresh failed: ${errorMessage(error)}`);
      return null;
    }
  }
}

class SessionSectionTreeItem extends vscode.TreeItem {
  constructor(readonly section: 'sessions' | 'projects') {
    super(section === 'sessions' ? 'Sessions' : 'Projects', vscode.TreeItemCollapsibleState.Expanded);
    this.id = `kronos-section:${section}`;
    this.contextValue = `kronos_${section}_section`;
    this.iconPath = new vscode.ThemeIcon(section === 'sessions' ? 'terminal' : 'folder-library');
    this.description = section === 'sessions' ? 'interactive terminals' : 'registered local work';
  }
}

export class ManagedSessionTreeItem extends vscode.TreeItem implements ManagedSessionCommandTarget {
  readonly workSessionId: string;
  readonly ticketKey?: string;
  readonly liveTerminalBindingIds: readonly string[];

  constructor(readonly session: WorkSessionRecord, liveTerminalBindingIds: readonly string[]) {
    super(sessionLabel(session), vscode.TreeItemCollapsibleState.None);
    this.workSessionId = session.id;
    if (session.kind === 'ticket') { this.ticketKey = session.ticketKey; }
    this.liveTerminalBindingIds = [...liveTerminalBindingIds].sort();
    const liveCount = this.liveTerminalBindingIds.length;
    const attached = session.status === 'active' && liveCount > 0;
    const commandTarget: ManagedSessionCommandTarget = {
      workSessionId: this.workSessionId,
      liveTerminalBindingIds: this.liveTerminalBindingIds,
    };
    if (this.ticketKey) { commandTarget.ticketKey = this.ticketKey; }
    this.id = `work-session:${session.id}`;
    this.contextValue = session.kind === 'standalone'
      ? session.status === 'closed' ? 'standalone_session_closed' : attached ? 'standalone_session_attached' : 'standalone_session_detached'
      : session.status === 'closed' ? 'work_session_closed'
        : !session.monitoring.enabled ? attached ? 'work_session_attached_paused' : 'work_session_detached_paused'
          : attached ? 'work_session_attached' : 'work_session_detached';
    this.description = sessionDescription(session, liveCount);
    this.tooltip = sessionTooltip(session, liveCount);
    this.iconPath = sessionIcon(session, attached);
    this.command = { command: 'kronos.focusWorkSessionTerminal', title: 'Open Session Terminal', arguments: [commandTarget] };
  }
}

class RegisteredProjectTreeItem extends vscode.TreeItem {
  constructor(
    readonly target: RegisteredProjectCommandTarget,
    branch: string | undefined,
    changeCount: number | undefined,
    config: ProjectConfig,
    linkedSessionCount: number,
    warning?: string,
  ) {
    super(target.projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `registered-project:${target.projectName}`;
    this.contextValue = 'registered_project';
    this.iconPath = new vscode.ThemeIcon('repo');
    const status = changeCount === undefined ? 'status unavailable' : `${changeCount} change${changeCount === 1 ? '' : 's'}`;
    this.description = `${branch || 'branch unavailable'} • ${status}`;
    const providers = [
      providerStatus('GitLab', Boolean(config.gitlab_project_id || config.gitlab_project_path), isGitLabRestConfigured(), linkedSessionCount),
      providerStatus('Jenkins', Boolean(config.jenkins_url), isJenkinsRestConfigured(), linkedSessionCount),
      providerStatus('SonarQube', Boolean(config.sonar_project_key), isSonarRestConfigured(), linkedSessionCount),
    ];
    this.tooltip = [
      `Project: ${target.projectName}`,
      `Path: ${target.projectPath}`,
      `Branch: ${branch || 'unavailable'}`,
      `Git status: ${status}`,
      `Active monitored ticket sessions: ${linkedSessionCount}`,
      ...providers,
      ...(warning ? [`Git read note: ${warning}`] : []),
      'Expand for status, diff, MR, CI, and context actions.',
    ].join('\n');
    this.command = { command: 'kronos.openProjectGitStatus', title: 'Open Project Git Status', arguments: [target] };
  }
}

class ProjectActionTreeItem extends vscode.TreeItem {
  constructor(label: string, icon: string, command: string, target: RegisteredProjectCommandTarget, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'registered_project_action';
    this.iconPath = new vscode.ThemeIcon(icon);
    if (description) { this.description = description; }
    this.command = { command, title: label, arguments: [target] };
  }
}

class ManagedSessionMessageTreeItem extends vscode.TreeItem {
  constructor(kind: 'session' | 'project') {
    super(kind === 'session' ? 'New Claude session' : 'Discover and register projects', vscode.TreeItemCollapsibleState.None);
    this.contextValue = kind === 'session' ? 'managed_session_empty' : 'registered_project_empty';
    this.description = kind === 'session' ? 'no Jira ticket required' : 'choose parent folders in Settings';
    this.iconPath = new vscode.ThemeIcon(kind === 'session' ? 'add' : 'folder-opened');
    this.command = {
      command: kind === 'session' ? 'kronos.newClaudeSession' : 'kronos.registerWorkspaceProject',
      title: kind === 'session' ? 'New Claude Session' : 'Discover and Manage Local Projects',
    };
  }
}

function projectActions(target: RegisteredProjectCommandTarget): ProjectActionTreeItem[] {
  return [
    new ProjectActionTreeItem('View Git status and diff', 'diff', 'kronos.openProjectGitStatus', target),
    new ProjectActionTreeItem('Insert working diff in context', 'symbol-keyword', 'kronos.insertProjectGitContext', target, 'non-submitting'),
    new ProjectActionTreeItem('Open or create merge request', 'git-merge', 'kronos.openProjectMergeRequest', target),
    new ProjectActionTreeItem('Insert MR evidence', 'git-merge', 'kronos.insertProjectGitLabContext', target),
    new ProjectActionTreeItem('Insert Jenkins / Sonar evidence', 'beaker', 'kronos.insertProjectCiContext', target),
    new ProjectActionTreeItem('Configure provider polling', 'settings-gear', 'kronos.configureProjectIntegrations', target),
  ];
}

function providerStatus(name: string, targetConfigured: boolean, credentialsReady: boolean, activeSessions: number): string {
  if (!targetConfigured) { return `${name}: project setup needed`; }
  if (!credentialsReady) { return `${name}: target saved, credentials need Doctor`; }
  return activeSessions > 0
    ? `${name}: automatic polling active for ${activeSessions} ticket session${activeSessions === 1 ? '' : 's'}`
    : `${name}: ready; automatic polling starts with a ticket session`;
}

function sessionSortOrder(left: WorkSessionRecord, right: WorkSessionRecord): number {
  if (left.status !== right.status) { return left.status === 'active' ? -1 : 1; }
  return right.updatedAt.localeCompare(left.updatedAt) || sessionLabel(left).localeCompare(sessionLabel(right)) || left.id.localeCompare(right.id);
}

function sessionDescription(session: WorkSessionRecord, liveCount: number): string {
  const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
  const project = branch ? `${session.projectName || 'project'} @ ${branch} • ` : '';
  if (session.status === 'closed') { return `${project}management closed`; }
  if (session.kind === 'standalone') {
    return liveCount === 0 ? `${project}standalone • terminal detached` : `${project}standalone • ${liveCount} terminal${liveCount === 1 ? '' : 's'} attached`;
  }
  const monitoring = session.monitoring.enabled ? `auto-poll ${session.monitoring.lastState || 'waiting'}` : 'auto-poll paused';
  return liveCount === 0 ? `${project}terminal detached • ${monitoring}` : `${project}${liveCount} terminal${liveCount === 1 ? '' : 's'} attached • ${monitoring}`;
}

function sessionTooltip(session: WorkSessionRecord, liveCount: number): string {
  const terminalCounts = { attached: 0, detached: 0, closed: 0 };
  for (const terminal of session.terminals) { terminalCounts[terminal.status] += 1; }
  const providerBindings = session.providerBindings.length > 0
    ? session.providerBindings.map(binding => `${binding.provider} ${binding.resource} ${binding.subjectId}`).join(', ')
    : 'none yet; configured providers are discovered automatically';
  const completeArtifacts = session.artifacts.filter(artifact => artifact.complete).length;
  const lines = [
    `Work session: ${session.id}`,
    ...(session.kind === 'ticket' ? [`Ticket: ${session.ticketKey}`] : ['Ticket: none (standalone session)']),
    `Title: ${session.title}`,
    `Status: ${session.status}`,
    'Select this session to open its attached terminal. If detached, choose an open terminal to reconnect.',
    'Terminal ownership: operator',
    `Live terminal bindings: ${liveCount}`,
    `Durable terminal history: ${terminalCounts.attached} attached, ${terminalCounts.detached} detached, ${terminalCounts.closed} closed`,
    `Provider bindings: ${providerBindings}`,
    `Context artifacts: ${completeArtifacts} complete, ${session.artifacts.length - completeArtifacts} partial`,
    `Automatic provider polling: ${session.monitoring.enabled ? 'enabled' : 'paused'}`,
    `Monitoring state: ${session.monitoring.lastState || 'not yet polled'}`,
    `Monitoring result: ${session.monitoring.lastSummary || 'none'}`,
    `Monitoring failures: ${session.monitoring.lastFailureCount ?? 0}`,
    `Monitoring skipped: ${session.monitoring.lastSkippedCount ?? 0}`,
    `Last monitoring attempt: ${session.monitoring.lastAttemptAt || 'never'}`,
    `Last successful poll: ${session.monitoring.lastPolledAt || 'never'}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
  ];
  if (session.projectName) { lines.splice(4, 0, `Project: ${session.projectName}`); }
  if (session.projectPath) { lines.splice(5, 0, `Project path: ${session.projectPath}`); }
  const branch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
  if (branch) { lines.splice(6, 0, `Git branch: ${branch}`); }
  if (session.closedAt) { lines.push(`Closed: ${session.closedAt}`); }
  return lines.join('\n');
}

function sessionLabel(session: WorkSessionRecord): string { return session.kind === 'ticket' ? `${session.ticketKey}: ${session.title}` : session.title; }

function sessionIcon(session: WorkSessionRecord, attached: boolean): vscode.ThemeIcon {
  if (session.status === 'closed') { return new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('disabledForeground')); }
  return attached
    ? new vscode.ThemeIcon('terminal', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('debug-disconnect', new vscode.ThemeColor('charts.yellow'));
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error || 'Unknown error.'); }
