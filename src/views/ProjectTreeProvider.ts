import * as vscode from 'vscode';
import { formatRelativeTime } from '../services/relativeTime';
import { KronosState } from '../state/KronosState';
import { Project, DiscoveredProject } from '../state/types';

type TreeElement = ProjectItem | DetailItem | DiscoveredItem | WelcomeItem | FolderItem;

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private kronosState: KronosState) {
    kronosState.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  getTreeItem(element: TreeElement): vscode.TreeItem { return element; }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!this.kronosState.state) {
      return [
        new WelcomeItem('Welcome to Kronos', 'Click Discover to scan your repos', 'kronos.discover'),
      ];
    }

    if (!element) {
      const items: TreeElement[] = [];
      const projects = this.kronosState.state.projects;
      const tickets = this.kronosState.state.tickets || {};

      if (Object.keys(projects).length === 0) {
        items.push(new WelcomeItem('No projects registered', 'Use Discover or Register', 'kronos.discover'));
      } else {
        for (const [name, proj] of Object.entries(projects)) {
          const linkedCount = Object.values(tickets).filter(t => t.projects?.includes(name)).length;
          items.push(new ProjectItem(name, proj, linkedCount));
        }
      }

      const discovered = (this.kronosState.state.discovered_projects || [])
        .filter(d => !projects[d.repo_name]);
      if (discovered.length > 0) {
        const byFolder: Record<string, typeof discovered> = {};
        for (const d of discovered) {
          const parts = d.path.replace(/\\/g, '/').split('/');
          const parent = parts.length >= 2 ? parts[parts.length - 2] : 'Other';
          if (!byFolder[parent]) { byFolder[parent] = []; }
          byFolder[parent].push(d);
        }
        for (const [folder, repos] of Object.entries(byFolder).sort((a, b) => b[1].length - a[1].length)) {
          items.push(new FolderItem(folder, repos));
        }
      }
      return items;
    }

    if (element instanceof FolderItem) {
      return element.repos.map(d => new DiscoveredItem(d));
    }

    if (element instanceof ProjectItem) {
      const items: TreeElement[] = [];
      const proj = element.project;
      if (proj.open_mr_count > 0) {
        items.push(new DetailItem(`${proj.open_mr_count} open MR(s)`, ''));
      }
      if (proj.last_polled) {
        items.push(new DetailItem(`Refreshed ${formatRelativeTime(proj.last_polled)}`, ''));
      }
      items.push(new DetailItem(`Path: ${proj.path}`, ''));
      return items;
    }

    return [];
  }
}

class WelcomeItem extends vscode.TreeItem {
  constructor(label: string, detail: string, command?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = detail;
    this.description = detail;
    if (command) { this.command = { command, title: label }; }
  }
}

class ProjectItem extends vscode.TreeItem {
  constructor(
    public readonly projectName: string,
    public readonly project: Project,
    linkedCount: number
  ) {
    super(projectName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'project';
    this.description = `${linkedCount} tickets · ${project.summary}`;
    const jiraKey = project.config.jira_project_key || '';
    this.tooltip = new vscode.MarkdownString(
      `**${projectName}**${jiraKey ? ` (${jiraKey})` : ''}\n\n` +
      `Health: ${project.health} | ${linkedCount} linked tickets\n\n` +
      `${project.summary}\n\n` +
      `Path: \`${project.path}\``
    );
    this.iconPath = new vscode.ThemeIcon('circle-filled', healthToIcon(project.health));
  }
}

class FolderItem extends vscode.TreeItem {
  constructor(public readonly folderName: string, public readonly repos: DiscoveredProject[]) {
    super(folderName, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${repos.length} repos`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'discovered_folder';
  }
}

class DiscoveredItem extends vscode.TreeItem {
  public readonly projectPath: string;
  constructor(discovered: DiscoveredProject) {
    super(discovered.repo_name, vscode.TreeItemCollapsibleState.None);
    this.projectPath = discovered.path;
    this.contextValue = 'discovered_project';
    const jiraTag = discovered.suggested_jira_key ? `Jira: ${discovered.suggested_jira_key}` : 'no Jira key';
    const configTag = discovered.has_project_json ? 'has config' : '';
    this.description = [jiraTag, configTag].filter(Boolean).join(' | ');
    this.tooltip = `Click to register\nPath: ${discovered.path}`;
    this.iconPath = new vscode.ThemeIcon('add', new vscode.ThemeColor('disabledForeground'));
    this.command = { command: 'kronos.registerDiscovered', title: 'Register', arguments: [discovered.path] };
  }
}

class DetailItem extends vscode.TreeItem {
  constructor(label: string, url: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'detail';
    if (url) {
      this.tooltip = url;
      this.command = { command: 'kronos.openExternalUrl', title: 'Open', arguments: [url] };
    }
  }
}

function healthToIcon(health: string): vscode.ThemeColor | undefined {
  switch (health) {
    case 'green': return new vscode.ThemeColor('testing.iconPassed');
    case 'yellow': return new vscode.ThemeColor('testing.iconQueued');
    case 'red': return new vscode.ThemeColor('testing.iconFailed');
    default: return new vscode.ThemeColor('disabledForeground');
  }
}
