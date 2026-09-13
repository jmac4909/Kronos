import * as vscode from 'vscode';
import type { KronosState, ProjectConfig } from '../state/types';
import { boundedOperationFailure } from '../services/errorUtils';
import { formatDateTimeLabel } from '../services/dateLabels';
import { listLocalProjects, matchesLocalProject } from '../services/projectCatalog';
import { projectGitStatusPresentation } from '../services/projectGitPresentation';
import { providerReadiness } from '../services/providerReadiness';
import {
  projectIntegrationStatusLines,
  registeredProjectActionInventory,
} from '../services/projectInventoryPresentation';
import {
  readProjectGitEvidence,
  type ProjectGitEvidence,
} from '../services/vscodeGitReadService';
import { listWorkSessions, type WorkSessionRecord } from '../services/workSessionStore';
import { readProjectMonitoringRecord } from '../services/projectMonitoringStore';
import {
  projectProviderMonitoringHealth,
  providerMonitoringHealthSummary,
  type ProviderMonitoringHealth,
} from '../services/providerMonitoringHealth';

export interface RegisteredProjectCommandTarget {
  projectName: string;
  projectPath: string;
  displayName?: string;
}

type StateLoader = () => KronosState | null;
type WorkSessionLoader = () => WorkSessionRecord[];
type ProjectTreeElement = RegisteredProjectTreeItem | ProjectActionTreeItem | ProjectMessageTreeItem;

/** Registered local work belongs in its own view, separate from operator-owned terminal sessions. */
export class ProjectTreeProvider implements vscode.TreeDataProvider<ProjectTreeElement>, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<ProjectTreeElement | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private stateLoadWarning = false;
  private sessionLoadWarning = false;

  constructor(
    private readonly loadState: StateLoader = () => null,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly pollIntervalMs: () => number = () => 300_000,
  ) {}

  getTreeItem(element: ProjectTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: ProjectTreeElement): Promise<ProjectTreeElement[]> {
    if (element instanceof RegisteredProjectTreeItem) { return projectActions(element.target); }
    if (element) { return []; }

    this.stateLoadWarning = false;
    this.sessionLoadWarning = false;
    const state = this.safeLoadState();
    if (this.stateLoadWarning) { return [new ProjectMessageTreeItem('warning', 'Projects may be incomplete')]; }
    const projects = listLocalProjects(state);
    if (projects.length === 0) { return [new ProjectMessageTreeItem('empty')]; }
    const sessions = this.safeLoadWorkSessions();
    const projectItems = await Promise.all(projects.map(async project => {
      const evidence = await readProjectGitEvidence(project.path, {
        includeDiff: false,
        openRepositoryIfNeeded: true,
      });
      const config = state?.projects[project.name]?.config || {};
      const linkedSessions = sessions.filter(session => activeProjectMonitoringSession(session, project.name, project.path));
      const projectMonitor = safeReadProjectMonitoringRecord(project.name);
      const monitoringOwners = projectMonitor ? [projectMonitor] : linkedSessions;
      return new RegisteredProjectTreeItem(
        { projectName: project.name, projectPath: project.path, displayName: project.displayName },
        evidence,
        config,
        Boolean(projectMonitor),
        projectProviderMonitoringHealth(monitoringOwners, this.pollIntervalMs()),
      );
    }));
    return this.sessionLoadWarning
      ? [new ProjectMessageTreeItem('warning', 'Project status may be incomplete'), ...projectItems]
      : projectItems;
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadState(): KronosState | null {
    try { return this.loadState(); }
    catch (error: unknown) {
      this.stateLoadWarning = true;
      console.warn(`Kronos project refresh failed: ${boundedOperationFailure(error, 'Project state could not be read.').display}`);
      return null;
    }
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      this.sessionLoadWarning = true;
      console.warn(`Kronos project session refresh failed: ${boundedOperationFailure(error, 'Project session state could not be read.').display}`);
      return [];
    }
  }
}

function safeReadProjectMonitoringRecord(projectName: string): WorkSessionRecord | null {
  try { return readProjectMonitoringRecord(projectName); }
  catch (error: unknown) {
    console.warn(`Kronos project monitoring refresh failed: ${boundedOperationFailure(error, 'Project monitoring state could not be read.').display}`);
    return null;
  }
}

function activeProjectMonitoringSession(session: WorkSessionRecord, projectName: string, projectPath: string): boolean {
  return matchesLocalProject(session, { name: projectName, path: projectPath })
    && session.ticketKeys.length > 0
    && session.status === 'active'
    && session.monitoring.enabled;
}

class RegisteredProjectTreeItem extends vscode.TreeItem implements RegisteredProjectCommandTarget {
  readonly projectName: string;
  readonly projectPath: string;
  readonly displayName?: string;

  constructor(
    readonly target: RegisteredProjectCommandTarget,
    evidence: ProjectGitEvidence,
    config: ProjectConfig,
    projectPollingActive: boolean,
    monitoringHealth: ProviderMonitoringHealth,
  ) {
    super(target.displayName || target.projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.projectName = target.projectName;
    this.projectPath = target.projectPath;
    if (target.displayName) { this.displayName = target.displayName; }
    const gitStatus = projectGitStatusPresentation(evidence);
    this.id = `registered-project:${target.projectName}`;
    this.contextValue = 'registered_project';
    this.iconPath = projectIcon(evidence);
    this.description = `${evidence.branch || 'branch unavailable'} • ${gitStatus.label}`;
    const readiness = providerReadiness();
    const providers = projectIntegrationStatusLines(config, {
      gitlab: readiness.gitlab.configured,
      jenkins: readiness.jenkins.configured,
      sonar: readiness.sonar.configured,
    });
    this.tooltip = [
      `Project: ${target.displayName || target.projectName}`,
      `Folder: ${target.projectPath}`,
      `Branch: ${evidence.branch || 'Unavailable'}`,
      `Changes: ${gitStatus.tooltip}`,
      ...providers,
      `Provider updates: ${projectPollingActive ? providerMonitoringHealthSummary(monitoringHealth) : 'Waiting for first check'}`,
      `Last checked: ${formatDateTimeLabel(monitoringHealth.lastAttemptAt, 'Never')}`,
      `Last successful check: ${formatDateTimeLabel(monitoringHealth.lastSuccessfulAt, 'Never')}`,
      `Last provider change: ${formatDateTimeLabel(monitoringHealth.lastMeaningfulChangeAt, 'Never')}`,
      `Next check: ${formatDateTimeLabel(monitoringHealth.nextScheduledAt, 'Not scheduled')}`,
      ...(monitoringHealth.currentError ? [`Current issue: ${humanState(monitoringHealth.currentError)}`] : []),
      ...(evidence.warning ? [`Changes note: ${evidence.warning}`] : []),
      'Select to inspect Git state and branches. Branch switching opens VS Code Source Control.',
    ].join('\n');
    this.command = { command: 'kronos.openProjectGitStatus', title: 'Git State & Branches', arguments: [target] };
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

class ProjectMessageTreeItem extends vscode.TreeItem {
  constructor(kind: 'empty' | 'warning', warningLabel = 'Projects may be incomplete') {
    super(kind === 'warning' ? warningLabel : 'Add projects', vscode.TreeItemCollapsibleState.None);
    if (kind === 'warning') {
      this.contextValue = 'registered_project_error';
      this.description = 'Open Check Setup, then refresh';
      this.tooltip = 'Kronos could not load all saved Project status. Select to open Check Setup.';
      this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      this.command = { command: 'kronos.doctor', title: 'Check Setup' };
      return;
    }
    this.contextValue = 'registered_project_empty';
    this.description = 'Choose local repositories';
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.command = { command: 'kronos.registerWorkspaceProject', title: 'Manage Projects' };
  }
}

function projectActions(target: RegisteredProjectCommandTarget): ProjectActionTreeItem[] {
  return registeredProjectActionInventory().map(action => new ProjectActionTreeItem(
    action.label,
    action.icon,
    action.command,
    target,
    action.description,
  ));
}

function projectIcon(evidence: ProjectGitEvidence): vscode.ThemeIcon {
  const state = projectGitStatusPresentation(evidence).state;
  if (state === 'unavailable') {
    return new vscode.ThemeIcon('repo', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  }
  return state === 'clean'
    ? new vscode.ThemeIcon('repo', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('repo', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
}

function humanState(value: string): string {
  const normalized = value.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}`;
}
