import * as vscode from 'vscode';
import type { KronosState, ProjectConfig } from '../state/types';
import { listLocalProjects } from '../services/projectCatalog';
import { providerReadiness } from '../services/providerReadiness';
import {
  readProjectGitEvidence,
  type ProjectGitEvidence,
} from '../services/vscodeGitReadService';
import { listWorkSessions, type WorkSessionRecord } from '../services/workSessionStore';

export interface RegisteredProjectCommandTarget {
  projectName: string;
  projectPath: string;
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
      const linkedSessionCount = sessions.filter(session =>
        session.projectName === project.name
          && session.ticketKeys.length > 0
          && session.status === 'active'
          && session.monitoring.enabled
      ).length;
      return new RegisteredProjectTreeItem(
        { projectName: project.name, projectPath: project.path },
        evidence,
        config,
        linkedSessionCount,
      );
    }));
  }

  refresh(): void { this.changeEmitter.fire(undefined); }
  dispose(): void { this.changeEmitter.dispose(); }

  private safeLoadState(): KronosState | null {
    try { return this.loadState(); }
    catch (error: unknown) {
      console.warn(`Kronos project refresh failed: ${errorMessage(error)}`);
      return null;
    }
  }

  private safeLoadWorkSessions(): WorkSessionRecord[] {
    try { return this.loadWorkSessions(); }
    catch (error: unknown) {
      console.warn(`Kronos project session refresh failed: ${errorMessage(error)}`);
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
  ) {
    super(target.projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `registered-project:${target.projectName}`;
    this.contextValue = 'registered_project';
    this.iconPath = projectIcon(evidence);
    this.description = `${evidence.branch || 'branch unavailable'} • ${projectStatusLabel(evidence)}`;
    const readiness = providerReadiness();
    const providers = [
      providerStatus('GitLab', Boolean(config.gitlab_project_id || config.gitlab_project_path), readiness.gitlab.configured, linkedSessionCount),
      providerStatus('Jenkins', Boolean(config.jenkins_url), readiness.jenkins.configured, linkedSessionCount),
      providerStatus('SonarQube', Boolean(config.sonar_project_key), readiness.sonar.configured, linkedSessionCount),
    ];
    this.tooltip = [
      `Project: ${target.projectName}`,
      `Path: ${target.projectPath}`,
      `Git branch: ${evidence.branch || 'unavailable'}`,
      `Git status: ${projectStatusTooltip(evidence)}`,
      'Git source: VS Code built-in Git model plus bounded local HEAD fallback',
      `Active monitored ticket sessions: ${linkedSessionCount}`,
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
  ];
}

function projectStatusLabel(evidence: ProjectGitEvidence): string {
  if (!evidence.available) { return 'status unavailable'; }
  if (evidence.changeCount === 0) { return 'clean'; }
  const staged = evidence.changes.filter(change => change.staged).length;
  const conflicts = evidence.changes.filter(change => isConflictStatus(change.status)).length;
  return [
    `${evidence.changeCount} change${evidence.changeCount === 1 ? '' : 's'}`,
    ...(staged > 0 ? [`${staged} staged`] : []),
    ...(conflicts > 0 ? [`${conflicts} conflict${conflicts === 1 ? '' : 's'}`] : []),
  ].join(' · ');
}

function projectStatusTooltip(evidence: ProjectGitEvidence): string {
  if (!evidence.available) { return 'unavailable'; }
  if (evidence.changeCount === 0) { return 'clean working tree'; }
  const staged = evidence.changes.filter(change => change.staged).length;
  const untracked = evidence.changes.filter(change => change.status === 'untracked').length;
  const conflicts = evidence.changes.filter(change => isConflictStatus(change.status)).length;
  const working = evidence.changes.filter(change =>
    !change.staged && change.status !== 'untracked' && !isConflictStatus(change.status)
  ).length;
  return [
    `${evidence.changeCount} total`,
    `${staged} staged`,
    `${working} modified`,
    `${untracked} untracked`,
    `${conflicts} conflicted`,
  ].join(', ');
}

function projectIcon(evidence: ProjectGitEvidence): vscode.ThemeIcon {
  if (!evidence.available) {
    return new vscode.ThemeIcon('repo', new vscode.ThemeColor('problemsWarningIcon.foreground'));
  }
  return evidence.changeCount === 0
    ? new vscode.ThemeIcon('repo', new vscode.ThemeColor('testing.iconPassed'))
    : new vscode.ThemeIcon('repo', new vscode.ThemeColor('gitDecoration.modifiedResourceForeground'));
}

function isConflictStatus(status: string): boolean {
  return status === 'added by us'
    || status === 'added by them'
    || status === 'deleted by us'
    || status === 'deleted by them'
    || status === 'both added'
    || status === 'both deleted'
    || status === 'both modified';
}

function providerStatus(name: string, targetConfigured: boolean, credentialsReady: boolean, activeSessions: number): string {
  if (!targetConfigured) { return `${name}: project setup needed`; }
  if (!credentialsReady) { return `${name}: target saved, credentials need Doctor`; }
  return activeSessions > 0
    ? `${name}: automatic polling active for ${activeSessions} ticket session${activeSessions === 1 ? '' : 's'}`
    : `${name}: ready; automatic polling starts with a ticket session`;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error || 'Unknown error.'); }
