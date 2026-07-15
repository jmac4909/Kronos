import * as vscode from 'vscode';
import type { KronosState, ProjectConfig } from '../state/types';
import { boundedOperationFailure } from '../services/errorUtils';
import { listLocalProjects } from '../services/projectCatalog';
import { projectGitStatusPresentation } from '../services/projectGitPresentation';
import { providerReadiness } from '../services/providerReadiness';
import {
  readProjectGitEvidence,
  type ProjectGitEvidence,
} from '../services/vscodeGitReadService';
import { listWorkSessions, type WorkSessionRecord } from '../services/workSessionStore';
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

  constructor(
    private readonly loadState: StateLoader = () => null,
    private readonly loadWorkSessions: WorkSessionLoader = () => listWorkSessions(),
    private readonly pollIntervalMs: () => number = () => 300_000,
  ) {}

  getTreeItem(element: ProjectTreeElement): vscode.TreeItem { return element; }

  async getChildren(element?: ProjectTreeElement): Promise<ProjectTreeElement[]> {
    if (element instanceof RegisteredProjectTreeItem) { return projectActions(element.target); }
    if (element) { return []; }

    const state = this.safeLoadState();
    const projects = listLocalProjects(state);
    if (projects.length === 0) { return [new ProjectMessageTreeItem()]; }
    const sessions = this.safeLoadWorkSessions();
    return Promise.all(projects.map(async project => {
      const evidence = await readProjectGitEvidence(project.path, {
        includeDiff: false,
        openRepositoryIfNeeded: true,
      });
      const config = state?.projects[project.name]?.config || {};
      const linkedSessions = sessions.filter(session =>
        session.projectName === project.name
          && session.ticketKeys.length > 0
          && session.status === 'active'
          && session.monitoring.enabled
      );
      return new RegisteredProjectTreeItem(
        { projectName: project.name, projectPath: project.path, displayName: project.displayName },
        evidence,
        config,
        linkedSessions.length,
        projectProviderMonitoringHealth(linkedSessions, this.pollIntervalMs()),
      );
    }));
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadState(): KronosState | null {
    try { return this.loadState(); }
    catch (error: unknown) {
      console.warn(`Kronos project refresh failed: ${boundedOperationFailure(error, 'Project state could not be read.').display}`);
      return null;
    }
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      console.warn(`Kronos project session refresh failed: ${boundedOperationFailure(error, 'Project session state could not be read.').display}`);
      return [];
    }
  }
}

class RegisteredProjectTreeItem extends vscode.TreeItem {
  constructor(
    readonly target: RegisteredProjectCommandTarget,
    evidence: ProjectGitEvidence,
    config: ProjectConfig,
    linkedSessionCount: number,
    monitoringHealth: ProviderMonitoringHealth,
  ) {
    super(target.displayName || target.projectName, vscode.TreeItemCollapsibleState.Collapsed);
    const gitStatus = projectGitStatusPresentation(evidence);
    this.id = `registered-project:${target.projectName}`;
    this.contextValue = 'registered_project';
    this.iconPath = projectIcon(evidence);
    this.description = `${evidence.branch || 'branch unavailable'} • ${gitStatus.label} • ${providerMonitoringHealthSummary(monitoringHealth)}`;
    const readiness = providerReadiness();
    const providers = [
      providerStatus('GitLab', Boolean(config.gitlab_project_id || config.gitlab_project_path), readiness.gitlab.configured, linkedSessionCount),
      providerStatus('Jenkins', Boolean(config.jenkins_url), readiness.jenkins.configured, linkedSessionCount),
      providerStatus('SonarQube', Boolean(config.sonar_project_key), readiness.sonar.configured, linkedSessionCount),
    ];
    this.tooltip = [
      `Project: ${target.displayName || target.projectName}`,
      `Stable identity: ${target.projectName}`,
      `Path: ${target.projectPath}`,
      `Git branch: ${evidence.branch || 'unavailable'}`,
      `Git status: ${gitStatus.tooltip}`,
      'Git source: VS Code built-in Git model plus bounded local HEAD fallback',
      `Active monitored ticket sessions: ${linkedSessionCount}`,
      `Last monitoring attempt: ${monitoringHealth.lastAttemptAt || 'never'}`,
      `Last successful poll: ${monitoringHealth.lastSuccessfulAt || 'never'}`,
      `Last meaningful provider change: ${monitoringHealth.lastMeaningfulChangeAt || 'never'}`,
      `Next scheduled poll: ${monitoringHealth.nextScheduledAt || 'not scheduled'}`,
      `Current normalized error: ${monitoringHealth.currentError || 'none'}`,
      `Suppressed unchanged polls since last change: ${monitoringHealth.suppressedUnchangedCount}`,
      ...providers,
      ...(evidence.warning ? [`Git read note: ${evidence.warning}`] : []),
      'Select to open the full read-only status and diff; expand for project actions.',
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

class ProjectMessageTreeItem extends vscode.TreeItem {
  constructor() {
    super('Discover and register projects', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'registered_project_empty';
    this.description = 'choose local parent folders';
    this.iconPath = new vscode.ThemeIcon('folder-opened');
    this.command = {
      command: 'kronos.registerWorkspaceProject',
      title: 'Discover and Manage Local Projects',
    };
  }
}

function projectActions(target: RegisteredProjectCommandTarget): ProjectActionTreeItem[] {
  return [
    new ProjectActionTreeItem('View Git status and diff', 'diff', 'kronos.openProjectGitStatus', target, 'read-only'),
    new ProjectActionTreeItem('Insert working diff in context', 'symbol-keyword', 'kronos.insertProjectGitContext', target, 'non-submitting'),
    new ProjectActionTreeItem('Open merge request page', 'git-merge', 'kronos.openProjectMergeRequest', target),
    new ProjectActionTreeItem('Insert MR evidence', 'git-merge', 'kronos.insertProjectGitLabContext', target),
    new ProjectActionTreeItem('Insert Jenkins / Sonar evidence', 'beaker', 'kronos.insertProjectCiContext', target),
    new ProjectActionTreeItem('Configure provider polling', 'settings-gear', 'kronos.configureProjectIntegrations', target),
    new ProjectActionTreeItem('Rename display label', 'edit', 'kronos.renameLocalProject', target, 'identity and links stay unchanged'),
  ];
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

function providerStatus(name: string, targetConfigured: boolean, credentialsReady: boolean, activeSessions: number): string {
  if (!targetConfigured) { return `${name}: project setup needed`; }
  if (!credentialsReady) { return `${name}: target saved, credentials need Doctor`; }
  return activeSessions > 0
    ? `${name}: automatic polling active for ${activeSessions} ticket session${activeSessions === 1 ? '' : 's'}`
    : `${name}: ready; automatic polling starts with a ticket session`;
}
