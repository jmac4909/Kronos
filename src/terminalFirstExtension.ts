import * as vscode from 'vscode';
import * as os from 'os';
import type { ProjectConfig, Ticket } from './state/types';
import { TerminalFirstState } from './state/TerminalFirstState';
import { WorkTreeProvider } from './views/WorkTreeProvider';
import { ManagedSessionTreeProvider } from './views/ManagedSessionTreeProvider';
import { AttentionTreeProvider } from './views/AttentionTreeProvider';
import { defaultProviderEnvPath, loadProviderEnv } from './services/providerEnv';
import { unknownErrorMessage } from './services/errorUtils';
import { buildFallbackJiraTicketContext, normalizeJiraTicketContext, type JiraTicketContext } from './services/jiraTicketContext';
import { isJiraRestConfigured, jiraRestClient, type JiraAttachmentContentSnapshot } from './services/jiraRestClient';
import { writeJiraContextArtifacts } from './services/jiraContextStore';
import {
  configuredGitLabProjectPathFromMergeRequestUrl,
  gitlabRestClient,
  isGitLabRestConfigured,
} from './services/gitlabRestClient';
import { normalizeGitLabMergeRequestContext, type GitLabMergeRequestContext } from './services/gitlabMergeRequestContext';
import { writeGitLabContextArtifacts } from './services/gitlabContextStore';
import { isJenkinsRestConfigured, jenkinsRestClient, type JenkinsBuildContext } from './services/jenkinsRestClient';
import { isSonarRestConfigured, sonarRestClient, type SonarBranchContext } from './services/sonarRestClient';
import { buildCiContext, writeCiContextArtifacts } from './services/ciContextStore';
import {
  buildCiContextReference,
  buildGitLabMergeRequestContextReference,
  buildJiraContextReference,
  insertEditableTerminalContextReference,
  insertTerminalContextReference,
} from './services/terminalContextInsertion';
import {
  createOperatorTerminalRegistry,
  type OperatorTerminalBinding,
  type OperatorTerminalRegistry,
} from './services/operatorTerminalRegistry';
import {
  addWorkSessionProviderBinding,
  attachWorkSessionTerminal,
  closeWorkSession,
  createOrGetWorkSessionByTicket,
  createStandaloneWorkSession,
  detachWorkSessionTerminal,
  getWorkSessionByTicket,
  listWorkSessionStoreIssues,
  listWorkSessions,
  readWorkSession,
  recordWorkSessionContextArtifact,
  reopenWorkSession,
  setWorkSessionMonitoring,
  setWorkSessionProject,
  type TicketWorkSessionRecord,
  type WorkSessionRecord,
  workSessionEventContext,
  workSessionTicketMetadata,
} from './services/workSessionStore';
import {
  acknowledgeMonitorEvent,
  appendMonitorEvent,
  listMonitorEvents,
} from './services/monitorEventStore';
import { buildWorkSessionAuditMarkdown } from './services/workSessionAuditView';
import {
  ManagedProviderMonitor,
  configuredSonarBranch,
  type ManagedProviderNotice,
  type ManagedProviderPollResult,
} from './services/managedProviderMonitor';
import { buildTicketWorkspaceHtml } from './services/ticketWorkspaceView';
import {
  JIRA_WORK_BOARD_ACTIONS,
  JIRA_WORK_BOARD_SCRIPT,
  buildJiraWorkBoardHtml,
} from './services/jiraWorkBoardView';
import {
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CLAUDE_TERMINAL_NAME,
  launchClaudeTerminal,
  normalizeClaudeTerminalLaunch,
  probeClaudeExecutableAvailability,
} from './services/claudeTerminalLauncher';
import {
  WEBVIEW_ACTION_PANEL_SCRIPT,
  WEBVIEW_READY_COMMAND,
  createWebviewNonce,
  webviewScriptCspOptions,
  withWebviewCsp,
} from './services/webviewSecurity';
import {
  normalizeActionPanelMessage,
  normalizeContextComposerMessage,
  normalizeOperationsActionMessage,
  normalizeProjectIntegrationMessage,
} from './services/webviewMessages';
import { isRecord } from './services/records';
import {
  listLocalProjects,
  projectConfigurationForTicket,
  readProjectGitBranch,
  ticketLocalProject,
  type LocalProjectSummary,
} from './services/projectCatalog';
import { discoverLocalProjects, type DiscoveredProject } from './services/projectDiscovery';
import {
  buildDoctorPanelHtml,
  buildSetupPanelHtml,
  type DoctorCheck,
  type OperationsStatus,
  type SetupStep,
} from './services/operationsPanelView';
import {
  CONTEXT_COMPOSER_SCRIPT,
  buildContextComposerHtml,
  type ContextComposerEvidenceItem,
} from './services/contextComposerView';
import {
  PROJECT_INTEGRATION_SCRIPT,
  buildProjectIntegrationPanelHtml,
  type ProjectIntegrationFormProject,
} from './services/projectIntegrationView';

const TICKET_WORKSPACE_ACTIONS = new Set([
  'startClaudeForTicket',
  'manageActiveTerminal',
  'chooseTicketProject',
  'insertJiraContext',
  'insertGitLabContext',
  'insertCiContext',
]);
const JIRA_BOARD_ACTIONS = new Set<string>(JIRA_WORK_BOARD_ACTIONS);
const OPERATIONS_PANEL_ACTIONS = new Set([
  'refreshPanel',
  'openSetup',
  'openDoctor',
  'openSettings',
  'openClaudeSettings',
  'chooseProjectDiscoveryFolders',
  'manageLocalProjects',
  'configureProjectIntegrations',
  'openJiraBoard',
]);
const CLAUDE_LAUNCH_COOLDOWN_MS = 1_000;

interface TicketPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
}

interface JiraBoardPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
}

interface OperationsPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
}

interface ContextComposerPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  selection: TerminalSelection;
  reference: string;
  promptPath: string;
  onInserted: () => void | Promise<void>;
  inserting: boolean;
}

interface ContextComposerRequest {
  key: string;
  panelTitle: string;
  title: string;
  subtitle: string;
  sourceLabel: string;
  reference: string;
  promptPath: string;
  suggestedFocus: string;
  evidence: ContextComposerEvidenceItem[];
  warnings: string[];
  selection: TerminalSelection;
  onInserted: () => void | Promise<void>;
}

interface ProjectIntegrationPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  projectNames: Set<string>;
}

interface TerminalSelection {
  terminal: vscode.Terminal;
  workSession?: WorkSessionRecord;
  binding?: OperatorTerminalBinding;
}

interface GitLabInsertionTarget {
  iid: number;
  projectIdOrPath: string;
  url?: string;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(new TerminalFirstRuntime(context));
}

export function deactivate(): void {}

class TerminalFirstRuntime implements vscode.Disposable {
  private readonly state = new TerminalFirstState();
  private readonly operatorTerminals: OperatorTerminalRegistry<vscode.Terminal> = createOperatorTerminalRegistry();
  private readonly closedTerminals = new WeakSet<vscode.Terminal>();
  private readonly workTree = new WorkTreeProvider(this.state, {
    hideCompletedByDefault: () => this.hideCompletedJiraWork(),
    doneStatusNames: () => this.completedJiraStatuses(),
  });
  private readonly sessionTree = new ManagedSessionTreeProvider(this.operatorTerminals);
  private readonly attentionTree = new AttentionTreeProvider();
  private readonly output = vscode.window.createOutputChannel('Kronos Terminal Work Companion');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ticketPanels = new Map<string, TicketPanelRecord>();
  private readonly ticketPanelActionsInFlight = new Set<string>();
  private readonly operationsPanelActionsInFlight = new Set<string>();
  private readonly contextComposerPanels = new Map<string, ContextComposerPanelRecord>();
  private readonly claudeLaunchesInFlight = new Set<string>();
  private readonly claudeLaunchCooldownUntil = new Map<string, number>();
  private jiraBoardPanel: JiraBoardPanelRecord | undefined;
  private setupPanel: OperationsPanelRecord | undefined;
  private doctorPanel: OperationsPanelRecord | undefined;
  private projectIntegrationPanel: ProjectIntegrationPanelRecord | undefined;
  private readonly monitor: ManagedProviderMonitor;
  private refreshTimer: NodeJS.Timeout | undefined;
  private providerTimer: NodeJS.Timeout | undefined;
  private ticketRefreshRunning = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadProviderEnvironment();
    this.monitor = new ManagedProviderMonitor({
      state: () => this.state.state,
      log: (message, detail) => this.log(message, detail),
      notify: notice => this.showProviderNotice(notice),
      refresh: () => this.refreshTerminalFirstViews(),
    });

    this.disposables.push(
      vscode.window.registerTreeDataProvider('kronosWork', this.workTree),
      vscode.window.registerTreeDataProvider('kronosSessions', this.sessionTree),
      vscode.window.registerTreeDataProvider('kronosAttention', this.attentionTree),
      this.state.onDidChange(() => {
        this.workTree.refresh();
        this.refreshTicketPanels();
        this.renderJiraBoardPanel();
        this.renderSetupPanel();
        this.renderDoctorPanel();
      }),
      vscode.window.onDidCloseTerminal(terminal => this.handleClosedTerminal(terminal)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('kronos.refreshIntervalSec')
          || event.affectsConfiguration('kronos.managedProviderPollIntervalSec')) {
          this.startTimers();
        }
        if (event.affectsConfiguration('kronos.hideCompletedJiraWork')
          || event.affectsConfiguration('kronos.completedJiraStatuses')) {
          this.workTree.refresh();
          this.renderJiraBoardPanel();
        }
        if (event.affectsConfiguration('kronos')) {
          this.renderSetupPanel();
          this.renderDoctorPanel();
        }
      }),
    );
    this.registerCommands();
    this.startTimers();
    this.log('Kronos terminal-first runtime activated.', 'No agent, terminal, project command, or Git mutation was started automatically.');
  }

  dispose(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); }
    if (this.providerTimer) { clearInterval(this.providerTimer); }
    for (const panel of this.ticketPanels.values()) { panel.panel.dispose(); }
    this.ticketPanels.clear();
    this.claudeLaunchCooldownUntil.clear();
    this.jiraBoardPanel?.panel.dispose();
    this.jiraBoardPanel = undefined;
    this.setupPanel?.panel.dispose();
    this.setupPanel = undefined;
    this.doctorPanel?.panel.dispose();
    this.doctorPanel = undefined;
    for (const record of this.contextComposerPanels.values()) { record.panel.dispose(); }
    this.contextComposerPanels.clear();
    this.projectIntegrationPanel?.panel.dispose();
    this.projectIntegrationPanel = undefined;
    for (const disposable of this.disposables.splice(0)) { disposable.dispose(); }
    this.operatorTerminals.clear();
    this.workTree.dispose();
    this.sessionTree.dispose();
    this.attentionTree.dispose();
    this.state.dispose();
    this.output.dispose();
  }

  private registerCommands(): void {
    this.command('kronos.refreshTickets', async () => this.refreshTickets(true));
    this.command('kronos.openJiraBoard', async () => this.openJiraBoard());
    this.command('kronos.filterWork', async () => this.configureWorkFilter());
    this.command('kronos.clearWorkFilter', () => this.workTree.clearFilter());
    this.command('kronos.openTicketWorkspace', async argument => this.openTicketWorkspace(argument));
    this.command('kronos.configureProjectDiscoveryFolders', async () => this.configureProjectDiscoveryFolders());
    this.command('kronos.registerWorkspaceProject', async () => this.registerWorkspaceProject());
    this.command('kronos.chooseTicketProject', async argument => this.chooseTicketProject(argument));
    this.command('kronos.newClaudeSession', async () => this.newClaudeSession());
    this.command('kronos.startClaudeForTicket', async argument => this.startClaudeForTicket(argument));
    this.command('kronos.manageActiveTerminal', async argument => this.manageFocusedTerminal(argument));
    this.command('kronos.insertJiraContext', async argument => this.insertJiraContext(argument));
    this.command('kronos.insertGitLabContext', async argument => this.insertGitLabContext(argument));
    this.command('kronos.insertCiContext', async argument => this.insertCiContext(argument));
    this.command('kronos.pollManagedWorkSessions', async () => this.pollProviders(true));
    this.command('kronos.openWorkSessionAudit', async argument => this.openWorkSessionAudit(argument));
    this.command('kronos.focusWorkSessionTerminal', async argument => this.focusWorkSessionTerminal(argument));
    this.command('kronos.reattachWorkSessionTerminal', async argument => this.reattachFocusedTerminal(argument));
    this.command('kronos.detachWorkSessionTerminal', async argument => this.detachManagedTerminal(argument));
    this.command('kronos.closeWorkSession', async argument => this.stopManagingSession(argument));
    this.command('kronos.pauseWorkSessionMonitoring', async argument => this.setMonitoring(argument, false));
    this.command('kronos.resumeWorkSessionMonitoring', async argument => this.setMonitoring(argument, true));
    this.command('kronos.acknowledgeAttention', async argument => this.acknowledgeAttention(argument));
    this.command('kronos.openProvider', async argument => this.openProvider(argument));
    this.command('kronos.setup', async () => this.openSetup());
    this.command('kronos.doctor', async () => this.openDoctor());
    this.command('kronos.settings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'Kronos Terminal Work Companion');
    });
  }

  private command(id: string, handler: (...args: unknown[]) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(id, handler));
  }

  private loadProviderEnvironment(): void {
    const result = loadProviderEnv();
    if (result.error) {
      this.log('Could not load the local provider environment.', result.error);
      void vscode.window.showWarningMessage('Kronos could not load its provider environment file. Provider reads may be unavailable; run Kronos: Doctor.');
    } else if (result.present) {
      this.log('Loaded local provider environment.', `${result.loaded} value(s) loaded; ${result.skippedExisting} existing value(s) preserved.`);
    }
  }

  private startTimers(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); }
    if (this.providerTimer) { clearInterval(this.providerTimer); }
    const refreshMs = this.configurationIntervalMs('refreshIntervalSec', 300);
    const providerMs = this.configurationIntervalMs('managedProviderPollIntervalSec', 300);
    this.refreshTimer = setInterval(() => { void this.refreshTickets(false); }, refreshMs);
    this.providerTimer = setInterval(() => { void this.pollProviders(false); }, providerMs);
    this.refreshTimer.unref();
    this.providerTimer.unref();
  }

  private configurationIntervalMs(key: string, fallbackSeconds: number): number {
    const configured = vscode.workspace.getConfiguration('kronos').get<number>(key, fallbackSeconds);
    const seconds = typeof configured === 'number' && Number.isFinite(configured)
      ? Math.max(15, Math.floor(configured))
      : fallbackSeconds;
    return seconds * 1000;
  }

  private hideCompletedJiraWork(): boolean {
    return vscode.workspace.getConfiguration('kronos').get<boolean>('hideCompletedJiraWork', true);
  }

  private completedJiraStatuses(): string[] {
    return this.configurationStringArray('completedJiraStatuses', 100, 200)
      .map(item => item.toLocaleLowerCase());
  }

  private configurationStringArray(key: string, limit: number, maxLength: number): string[] {
    const value = vscode.workspace.getConfiguration('kronos').get<unknown>(key, []);
    if (!Array.isArray(value)) { return []; }
    return [...new Set(value
      .map(item => typeof item === 'string'
        ? item.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').trim().slice(0, maxLength)
        : '')
      .filter(Boolean))]
      .slice(0, limit);
  }

  private projectDiscoverySettings(): { roots: string[]; depth: number; limit: number } {
    const configuration = vscode.workspace.getConfiguration('kronos');
    return {
      roots: this.configurationStringArray('projectDiscoveryRoots', 50, 4_000),
      depth: boundedIntegerSetting(configuration.get<unknown>('projectDiscoveryDepth', 2), 2, 0, 5),
      limit: boundedIntegerSetting(configuration.get<unknown>('projectDiscoveryLimit', 100), 100, 1, 500),
    };
  }

  private async configureWorkFilter(): Promise<void> {
    const current = this.workTree.getFilter();
    const options = this.workTree.getFilterOptions();
    const selection = await vscode.window.showQuickPick([
      { label: '$(search) Search text', description: current.query || 'none', id: 'query' },
      { label: '$(issue-opened) Completion', description: current.jiraStatus ? `status: ${current.jiraStatus}` : current.completion || this.workTree.defaultCompletion(), id: 'completion' },
      { label: '$(list-filter) Jira status', description: current.jiraStatus || 'any active status', id: 'status' },
      { label: '$(project) Project', description: current.project || 'all projects', id: 'project' },
      { label: '$(tag) Label', description: current.label || 'all labels', id: 'label' },
      { label: '$(clear-all) Clear filters', description: 'return to the configured Jira visibility default', id: 'clear' },
    ], { title: 'Filter Kronos Work', placeHolder: 'Choose a filter to change' });
    if (!selection) { return; }
    if (selection.id === 'clear') {
      this.workTree.clearFilter();
      return;
    }
    if (selection.id === 'query') {
      const query = await vscode.window.showInputBox({
        title: 'Search Kronos Work',
        prompt: 'Match ticket key, summary, description, status, label, project, MR, or build',
        value: current.query || '',
      });
      if (query !== undefined) { this.workTree.setFilter({ ...current, query }); }
      return;
    }
    if (selection.id === 'completion') {
      const completion = await vscode.window.showQuickPick([
        { label: 'Active', description: 'Hide Jira work in the Done status category', value: 'active' as const },
        { label: 'Completed', description: 'Show only Jira work in the Done status category', value: 'completed' as const },
        { label: 'All', description: 'Show active and completed Jira work', value: 'all' as const },
      ], { title: 'Filter by completion' });
      if (completion) {
        const next = { ...current, completion: completion.value };
        delete next.jiraStatus;
        this.workTree.setFilter(next);
      }
      return;
    }
    if (selection.id === 'status') {
      const status = await vscode.window.showQuickPick([
        { label: 'Any active status', value: '' },
        ...options.jiraStatuses.map(value => ({ label: value, value })),
      ], { title: 'Filter by Jira status' });
      if (status) {
        const next = { ...current };
        if (status.value) { next.jiraStatus = status.value; next.completion = 'all'; }
        else { delete next.jiraStatus; next.completion = 'active'; }
        this.workTree.setFilter(next);
      }
      return;
    }
    const facet = selection.id === 'label'
      ? await vscode.window.showQuickPick([
        { label: 'All labels', value: '' },
        ...options.labels.map(value => ({ label: value, value })),
      ], { title: 'Filter by label' })
      : await vscode.window.showQuickPick([
        { label: 'All projects', value: '' },
        ...options.projects.map(value => ({ label: value, value })),
      ], { title: 'Filter by project' });
    if (facet) {
      const next = { ...current };
      if (selection.id === 'label') {
        if (facet.value) { next.label = facet.value; }
        else { delete next.label; }
      } else if (facet.value) { next.project = facet.value; }
      else { delete next.project; }
      this.workTree.setFilter(next);
    }
  }

  private async registerWorkspaceProject(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders || [];
    const settings = this.projectDiscoverySettings();
    const discovery = discoverLocalProjects({
      workspaceFolders: folders.map(folder => ({ name: folder.name, path: folder.uri.fsPath })),
      ...settings,
    });
    for (const warning of discovery.warnings) { this.log('Project discovery warning.', warning); }
    const registeredProjects = listLocalProjects(this.state.state);
    if (discovery.projects.length === 0 && registeredProjects.length === 0) {
      const action = await vscode.window.showWarningMessage(
        'No project folders were discovered. Open a workspace folder or configure Kronos project discovery roots.',
        'Choose Discovery Folders',
        'Open Discovery Settings',
      );
      if (action === 'Choose Discovery Folders') {
        await this.configureProjectDiscoveryFolders();
        return;
      }
      if (action === 'Open Discovery Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos project discovery');
      }
      return;
    }
    const discoveredByPath = new Map(discovery.projects.map(project => [localProjectPathKey(project.path), project]));
    const registeredPathKeys = new Set(registeredProjects.map(project => localProjectPathKey(project.path)));
    const registeredChoices = registeredProjects.map(registered => {
      const discovered = discoveredByPath.get(localProjectPathKey(registered.path));
      const project: DiscoveredProject = discovered || {
        name: registered.name,
        path: registered.path,
        source: 'configured-root',
        ...(registered.branch ? { branch: registered.branch } : {}),
      };
      return {
        label: registered.name,
        description: `registered · ${registered.branch || (registered.available ? 'branch unavailable' : 'folder unavailable')}`,
        detail: registered.path,
        picked: true,
        registered: true,
        project: { ...project, name: registered.name },
      };
    });
    const discoveredChoices = discovery.projects
      .filter(project => !registeredPathKeys.has(localProjectPathKey(project.path)))
      .map(project => ({
        label: project.name,
        description: `not registered · ${project.branch || 'branch unavailable'} · ${project.source === 'workspace' ? 'open workspace' : 'configured root'}`,
        detail: project.path,
        picked: false,
        registered: false,
        project,
      }));
    const choices = [...registeredChoices, ...discoveredChoices];
    const selected = await vscode.window.showQuickPick(choices, {
      title: 'Manage Registered Local Projects',
      placeHolder: discovery.truncated
        ? 'Bounded discovery limit reached; checked projects stay registered and unchecked projects are removed'
        : 'Check projects to register; uncheck registered projects to remove them',
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (selected === undefined) { return; }
    const selectedPathKeys = new Set(selected.map(item => localProjectPathKey(item.project.path)));
    const removedProjects = registeredProjects.filter(project => !selectedPathKeys.has(localProjectPathKey(project.path)));
    const removedNames = new Set(removedProjects.map(project => project.name));
    const linkedTicketKeys = Object.entries(this.state.state?.tickets || {})
      .filter(([, ticket]) => Boolean(ticket.launch_project && removedNames.has(ticket.launch_project)))
      .map(([ticketKey]) => ticketKey);
    if (linkedTicketKeys.length > 0) {
      const action = await vscode.window.showWarningMessage(
        `Unregistering ${removedProjects.map(project => project.name).join(', ')} will unlink ${linkedTicketKeys.length} ticket${linkedTicketKeys.length === 1 ? '' : 's'} (${linkedTicketKeys.slice(0, 5).join(', ')}${linkedTicketKeys.length > 5 ? ', …' : ''}).`,
        { modal: true },
        'Unregister and Unlink',
      );
      if (action !== 'Unregister and Unlink') { return; }
    }
    const registrations = this.projectRegistrations(selected.map(item => item.project));
    const newlyRegistered = registrations.filter(project => !registeredPathKeys.has(localProjectPathKey(project.path)));
    this.state.replaceRegisteredLocalProjects(registrations);
    for (const ticketKey of linkedTicketKeys) {
      const session = getWorkSessionByTicket(ticketKey);
      if (session) { setWorkSessionProject(session.id, {}); }
    }
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(
      `${registrations.length} local project${registrations.length === 1 ? ' is' : 's are'} registered; ${removedProjects.length} unregistered${linkedTicketKeys.length > 0 ? ` and unlinked from ${linkedTicketKeys.length} ticket${linkedTicketKeys.length === 1 ? '' : 's'}` : ''}${discovery.truncated ? ' from bounded discovery results' : ''}.`,
    );
    if (newlyRegistered.length > 0) {
      this.openProjectIntegrationSetup(newlyRegistered.map(project => project.name));
    }
  }

  private async configureProjectDiscoveryFolders(): Promise<void> {
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
    const selectedFolders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: true,
      title: 'Choose Kronos Project Discovery Folders',
      openLabel: 'Add Discovery Folders',
      ...(defaultUri ? { defaultUri } : {}),
    });
    if (!selectedFolders || selectedFolders.length === 0) { return; }

    const existingRoots = this.projectDiscoverySettings().roots;
    const roots = uniqueProjectDiscoveryRoots([
      ...existingRoots,
      ...selectedFolders.map(folder => folder.fsPath),
    ], 50);
    try {
      await vscode.workspace.getConfiguration('kronos').update(
        'projectDiscoveryRoots',
        roots,
        vscode.ConfigurationTarget.Global,
      );
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, 'Kronos could not save the selected discovery folders.');
      this.log('Could not save project discovery folders.', detail);
      void vscode.window.showErrorMessage(detail);
      return;
    }

    const addedCount = roots.length - existingRoots.length;
    void vscode.window.showInformationMessage(
      addedCount > 0
        ? `Added ${addedCount} project discovery folder${addedCount === 1 ? '' : 's'}. Choose the projects Kronos may link to tickets.`
        : 'Those project discovery folders were already configured. Choose the projects Kronos may link to tickets.',
    );
    await this.registerWorkspaceProject();
  }

  private projectRegistrations(projects: readonly Pick<DiscoveredProject, 'name' | 'path'>[]): Array<{ name: string; path: string }> {
    const existing = this.state.state?.projects || {};
    const names = new Map(Object.entries(existing).map(([name, project]) => [name.toLocaleLowerCase(), project.path || '']));
    return projects.map(project => {
      const existingName = Object.entries(existing).find(([, value]) => value.path === project.path)?.[0];
      if (existingName) { return { name: existingName, path: project.path }; }
      const base = safeProjectName(project.name) || 'Project';
      let name = base;
      let suffix = 2;
      while (names.has(name.toLocaleLowerCase()) && names.get(name.toLocaleLowerCase()) !== project.path) {
        const suffixText = ` (${suffix})`;
        name = `${base.slice(0, Math.max(1, 200 - suffixText.length))}${suffixText}`;
        suffix += 1;
      }
      names.set(name.toLocaleLowerCase(), project.path);
      return { name, path: project.path };
    });
  }

  private openProjectIntegrationSetup(projectNames?: readonly string[]): void {
    const localProjects = listLocalProjects(this.state.state);
    const requested = projectNames ? new Set(projectNames) : undefined;
    const selectedProjects = requested
      ? localProjects.filter(project => requested.has(project.name))
      : localProjects;
    if (selectedProjects.length === 0) {
      void vscode.window.showWarningMessage('Register at least one local project before configuring provider polling.');
      return;
    }
    this.projectIntegrationPanel?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      'kronosProjectIntegrationSetup',
      'Kronos — Project Integration Setup',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    const record: ProjectIntegrationPanelRecord = {
      panel,
      nonce: createWebviewNonce(),
      projectNames: new Set(selectedProjects.map(project => project.name)),
    };
    this.projectIntegrationPanel = record;
    panel.onDidDispose(() => {
      if (this.projectIntegrationPanel?.panel === panel) { this.projectIntegrationPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeProjectIntegrationMessage(raw);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid project-integration request.');
        return;
      }
      if (message.command === 'cancel') {
        panel.dispose();
        return;
      }
      const submittedNames = new Set(message.projects.map(project => project.name));
      if (message.projects.length !== submittedNames.size
        || submittedNames.size !== record.projectNames.size
        || [...record.projectNames].some(name => !submittedNames.has(name))) {
        void vscode.window.showWarningMessage('Kronos refused project integration values for an unexpected project set.');
        return;
      }
      try {
        this.state.setLocalProjectIntegrations(message.projects);
        this.refreshTerminalFirstViews();
        panel.dispose();
        void vscode.window.showInformationMessage(
          `Saved read-only provider polling setup for ${message.projects.length} project${message.projects.length === 1 ? '' : 's'}. Run Doctor to verify credentials and remaining prerequisites.`,
        );
      } catch (error: unknown) {
        const detail = unknownErrorMessage(error, 'Project integration setup could not be saved.');
        this.log('Project integration setup could not be saved.', detail);
        void vscode.window.showErrorMessage(detail);
      }
    });
    const projects: ProjectIntegrationFormProject[] = selectedProjects.map(project => {
      const config = this.state.state?.projects[project.name]?.config || {};
      return {
        name: project.name,
        path: project.path,
        ...(project.branch ? { branch: project.branch } : {}),
        ...((config.gitlab_project_id || config.gitlab_project_path)
          ? { gitlabProject: String(config.gitlab_project_id || config.gitlab_project_path) }
          : {}),
        ...(config.jenkins_url ? { jenkinsUrl: config.jenkins_url } : {}),
        ...(config.sonar_project_key ? { sonarProjectKey: config.sonar_project_key } : {}),
        ...((config.default_branch || config.base_branch)
          ? { defaultBranch: config.default_branch || config.base_branch }
          : {}),
      };
    });
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', PROJECT_INTEGRATION_SCRIPT),
    ).toString();
    const gitLabReady = isGitLabRestConfigured();
    const jenkinsReady = isJenkinsRestConfigured();
    const sonarReady = isSonarRestConfigured();
    panel.webview.html = withWebviewCsp(buildProjectIntegrationPanelHtml({
      projects,
      providerReadiness: [
        {
          name: 'GitLab credentials',
          ready: gitLabReady,
          detail: gitLabReady ? 'Read-only REST environment is ready.' : 'Add a GitLab URL and token in private Setup.',
        },
        {
          name: 'Jenkins access',
          ready: jenkinsReady,
          detail: jenkinsReady ? 'Jenkins base URL is available.' : 'Add JENKINS_URL in private Setup.',
        },
        {
          name: 'SonarQube credentials',
          ready: sonarReady,
          detail: sonarReady ? 'Read-only REST environment is ready.' : 'Add a SonarQube URL and token in private Setup.',
        },
      ],
      nonce: record.nonce,
      scriptUri,
    }), webviewScriptCspOptions(panel.webview.cspSource, record.nonce));
  }

  private async chooseTicketProject(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const projects = listLocalProjects(this.state.state).filter(project => project.available);
    if (projects.length === 0) {
      const action = await vscode.window.showWarningMessage(
        'No local project folder is registered. Choose parent folders to discover or scan the folders already configured.',
        'Choose Discovery Folders',
        'Discover Projects',
      );
      if (action === 'Choose Discovery Folders') { await this.configureProjectDiscoveryFolders(); }
      if (action === 'Discover Projects') { await this.registerWorkspaceProject(); }
      return;
    }
    const current = ticketLocalProject(this.state.state, ticket);
    const choices: Array<vscode.QuickPickItem & { project?: LocalProjectSummary; unlink?: true }> = projects.map(project => ({
      label: `${project.name}${current?.name === project.name ? ' $(check)' : ''}`,
      description: project.branch || (project.available ? 'Git branch unavailable' : 'folder unavailable'),
      detail: project.path,
      project,
    }));
    if (current) {
      choices.push({
        label: '$(close) Unlink local project',
        description: 'Future ticket launches fall back to the open workspace',
        unlink: true,
      });
    }
    const choice = await vscode.window.showQuickPick(choices, {
      title: `Choose ${ticketKey} Launch Project`,
      placeHolder: 'Claude will start in this folder; Kronos will not move existing terminals',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!choice) { return; }
    this.state.setTicketLocalProject(ticketKey, choice.unlink ? undefined : choice.project?.name);
    const selected = choice.unlink ? undefined : choice.project;
    const existingSession = getWorkSessionByTicket(ticketKey);
    if (existingSession) {
      setWorkSessionProject(existingSession.id, selected
        ? { projectName: selected.name, projectPath: selected.path }
        : {});
    }
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(selected
      ? `${ticketKey} will launch Claude in ${selected.path}${selected.branch ? ` on ${selected.branch}` : ''}. Existing terminals were not changed.`
      : `${ticketKey} local project unlinked. Existing terminals were not changed.`);
  }

  private async refreshTickets(showResult: boolean): Promise<void> {
    if (this.ticketRefreshRunning) {
      if (showResult) { void vscode.window.showInformationMessage('A Jira ticket refresh is already running.'); }
      return;
    }
    this.ticketRefreshRunning = true;
    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Reading Jira work metadata...' },
        async () => this.state.refreshTickets(),
      );
      if (result.warnings.length > 0) {
        this.log('Jira Work refresh completed with bounded-read warnings.', result.warnings.join(' '));
      }
      if (showResult) {
        const retained = result.retainedFromPrevious > 0
          ? ` ${result.retainedFromPrevious} prior ticket${result.retainedFromPrevious === 1 ? ' was' : 's were'} retained because the read was partial.`
          : '';
        const message = `Kronos refreshed ${result.ticketCount} Jira ticket${result.ticketCount === 1 ? '' : 's'} across ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}.${retained}`;
        if (result.complete && result.warnings.length === 0) { void vscode.window.showInformationMessage(message); }
        else { void vscode.window.showWarningMessage(`${message} Open Doctor for details.`); }
      }
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, 'Jira ticket refresh failed.');
      this.log('Jira ticket refresh failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(`${detail} Run Kronos: Doctor for configuration details.`); }
    } finally {
      this.ticketRefreshRunning = false;
    }
  }

  private async openJiraBoard(): Promise<void> {
    if (this.jiraBoardPanel) {
      this.jiraBoardPanel.panel.reveal(vscode.ViewColumn.One);
      this.renderJiraBoardPanel();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kronosJiraWorkBoard',
      'Kronos — Jira Work Board',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    const record: JiraBoardPanelRecord = { panel, nonce: createWebviewNonce() };
    this.jiraBoardPanel = record;
    panel.onDidDispose(() => {
      if (this.jiraBoardPanel?.panel === panel) { this.jiraBoardPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeActionPanelMessage(raw, JIRA_BOARD_ACTIONS);
      const ticketKey = normalizeTicketKey(message?.ticket);
      const tickets = this.state.state?.tickets;
      if (!message || !ticketKey || !tickets || !Object.prototype.hasOwnProperty.call(tickets, ticketKey)) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid Jira-board request.');
        return;
      }
      await this.executeTicketPanelAction(message.command, ticketKey);
    });
    this.renderJiraBoardPanel();
  }

  private renderJiraBoardPanel(): void {
    const record = this.jiraBoardPanel;
    if (!record) { return; }
    const scriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', JIRA_WORK_BOARD_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(
      buildJiraWorkBoardHtml({
        state: this.state.state,
        nonce: record.nonce,
        scriptUri,
        doneStatusNames: this.completedJiraStatuses(),
        hideCompletedByDefault: this.hideCompletedJiraWork(),
      }),
      webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce),
    );
  }

  private async openTicketWorkspace(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const existing = this.ticketPanels.get(ticketKey);
    if (existing) {
      existing.panel.reveal(vscode.ViewColumn.One);
      this.renderTicketPanel(ticketKey, existing);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'kronosTicketWorkspace',
      `${ticketKey} — Terminal Workspace`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    const record: TicketPanelRecord = { panel, nonce: createWebviewNonce() };
    this.ticketPanels.set(ticketKey, record);
    panel.onDidDispose(() => this.ticketPanels.delete(ticketKey));
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeActionPanelMessage(raw, TICKET_WORKSPACE_ACTIONS);
      if (!message || message.ticket !== ticketKey) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid ticket-workspace request.');
        return;
      }
      await this.executeTicketPanelAction(message.command, ticketKey);
      const current = this.ticketPanels.get(ticketKey);
      if (current) { this.renderTicketPanel(ticketKey, current); }
    });
    this.renderTicketPanel(ticketKey, record);
  }

  private async executeTicketPanelAction(action: string, ticketKey: string): Promise<void> {
    const requestKey = `${action}\u0000${ticketKey}`;
    if (this.ticketPanelActionsInFlight.has(requestKey)) {
      void vscode.window.showInformationMessage(`${ticketKey} ${action} is already in progress.`);
      return;
    }
    this.ticketPanelActionsInFlight.add(requestKey);
    try {
      await vscode.commands.executeCommand(`kronos.${action}`, { ticketKey });
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, `${ticketKey} action failed.`);
      this.log(`${ticketKey} ${action} failed.`, detail);
      void vscode.window.showErrorMessage(detail);
    } finally {
      this.ticketPanelActionsInFlight.delete(requestKey);
    }
  }

  private renderTicketPanel(ticketKey: string, record: TicketPanelRecord): void {
    const ticket = this.state.state?.tickets[ticketKey];
    if (!ticket) {
      record.panel.webview.html = '<!DOCTYPE html><html><body><p>This ticket is no longer present in the local Work state.</p></body></html>';
      return;
    }
    const session = getWorkSessionByTicket(ticketKey);
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    const html = buildTicketWorkspaceHtml({
      ticketKey,
      ticket,
      nonce: record.nonce,
      actionScriptUri,
      workSession: session,
      liveTerminalCount: session ? this.operatorTerminals.listBindings(session.id).length : 0,
      localProject: ticketLocalProject(this.state.state, ticket),
    });
    record.panel.webview.html = withWebviewCsp(
      html,
      webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce),
    );
  }

  private refreshTicketPanels(): void {
    for (const [ticketKey, record] of this.ticketPanels) { this.renderTicketPanel(ticketKey, record); }
  }

  private async manageFocusedTerminal(argument: unknown): Promise<void> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showWarningMessage('Focus the already-running interactive terminal you want Kronos to organize, then try again.');
      return;
    }
    const requestedTicketKey = normalizeTicketKey(
      typeof argument === 'string'
        ? argument
        : stringProperty(argument, 'ticketKey') || stringProperty(argument, 'ticket'),
    );
    const ticketKey = await this.resolveTicketKey(argument, false);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (requestedTicketKey && (!ticketKey || !ticket)) {
      void vscode.window.showWarningMessage(`${requestedTicketKey} is no longer present in loaded Jira Work. Refresh Jira and try again.`);
      return;
    }
    if (!ticketKey || !ticket) {
      const existing = this.operatorTerminals.bindingForTerminal(terminal);
      if (existing) {
        const session = readWorkSession(existing.sessionId);
        if (session) {
          void vscode.window.showInformationMessage(`${terminal.name} is already managed as ${workSessionEventContext(session).label}.`);
          return;
        }
      }
      const title = await vscode.window.showInputBox({
        title: 'Manage Focused Terminal as a Standalone Session',
        prompt: 'Name this session. No Jira ticket will be attached.',
        value: terminal.name || 'Terminal session',
        validateInput: value => value.trim() ? undefined : 'Enter a session name.',
      });
      if (!title?.trim()) { return; }
      const project = this.standaloneProjectDetails();
      const session = createStandaloneWorkSession({ title: title.trim(), ...project });
      await this.attachTerminal(session, terminal);
      this.refreshTerminalFirstViews();
      void vscode.window.showInformationMessage(
        `${terminal.name} is now organized as a standalone session. No ticket was attached and terminal contents were not read.`,
      );
      return;
    }
    const sessionInput: Parameters<typeof createOrGetWorkSessionByTicket>[0] = {
      ticketKey,
      title: ticket.summary,
    };
    const project = ticketLocalProject(this.state.state, ticket);
    if (project) { sessionInput.projectName = project.name; sessionInput.projectPath = project.path; }
    let session = createOrGetWorkSessionByTicket(sessionInput);
    session = this.requireTicketSession(setWorkSessionProject(session.id, project
      ? { projectName: project.name, projectPath: project.path }
      : {}));
    if (session.status === 'closed') { session = this.requireTicketSession(reopenWorkSession(session.id)); }
    session = this.ensureProviderBindings(session, ticket);
    await this.attachTerminal(session, terminal);
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(
      `${terminal.name} is now organized under ${ticketKey}. Kronos did not start, read, or control the terminal.`,
    );
  }

  private async newClaudeSession(): Promise<void> {
    if (!this.canLaunchClaude()) { return; }
    const workspaceName = vscode.workspace.name?.trim();
    const launchedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const title = workspaceName
      ? `${workspaceName} Claude · ${launchedAt}`
      : `Claude session · ${launchedAt}`;
    await this.launchClaudeSession({ title });
  }

  private async startClaudeForTicket(argument: unknown): Promise<void> {
    if (!this.canLaunchClaude()) { return; }
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    await this.launchClaudeSession({ title: ticket.summary, ticketKey, ticket });
  }

  private canLaunchClaude(): boolean {
    if (vscode.workspace.isTrusted) { return true; }
    void vscode.window.showWarningMessage(
      'Kronos does not launch Claude in an untrusted workspace. Trust the workspace, or open a trusted window and try again.',
    );
    return false;
  }

  private async launchClaudeSession(input: { title: string; ticketKey?: string; ticket?: Ticket }): Promise<void> {
    const launchKey = input.ticketKey ? `ticket:${input.ticketKey}` : 'standalone';
    const now = Date.now();
    for (const [key, expiresAt] of this.claudeLaunchCooldownUntil) {
      if (expiresAt <= now) { this.claudeLaunchCooldownUntil.delete(key); }
    }
    if (this.claudeLaunchesInFlight.has(launchKey)
      || (this.claudeLaunchCooldownUntil.get(launchKey) || 0) > now) {
      void vscode.window.showInformationMessage(
        input.ticketKey
          ? `Claude launch for ${input.ticketKey} is already in progress or was just submitted.`
          : 'A standalone Claude launch is already in progress or was just submitted.',
      );
      return;
    }
    this.claudeLaunchesInFlight.add(launchKey);
    let commandSubmitted = false;
    let closeSessionIfNotSubmitted = false;
    let session: WorkSessionRecord | undefined;
    try {
      const launch = this.claudeLaunchConfiguration(input.ticketKey, input.ticket);
      if (input.ticketKey && input.ticket) {
        const previousSession = getWorkSessionByTicket(input.ticketKey);
        const sessionInput: Parameters<typeof createOrGetWorkSessionByTicket>[0] = {
          ticketKey: input.ticketKey,
          title: input.title,
        };
        const project = ticketLocalProject(this.state.state, input.ticket);
        if (project) { sessionInput.projectName = project.name; sessionInput.projectPath = project.path; }
        let ticketSession = createOrGetWorkSessionByTicket(sessionInput);
        ticketSession = this.requireTicketSession(setWorkSessionProject(ticketSession.id, project
          ? { projectName: project.name, projectPath: project.path }
          : {}));
        closeSessionIfNotSubmitted = !previousSession || previousSession.status === 'closed';
        if (ticketSession.status === 'closed') {
          ticketSession = this.requireTicketSession(reopenWorkSession(ticketSession.id));
        }
        session = ticketSession;
        session = this.ensureProviderBindings(ticketSession, input.ticket);
      } else {
        session = createStandaloneWorkSession({ title: input.title, ...this.standaloneProjectDetails(launch.cwd) });
        closeSessionIfNotSubmitted = true;
      }
      const launched = launchClaudeTerminal(vscode.window, launch);
      commandSubmitted = true;
      session = await this.attachTerminal(session, launched.terminal);
      const eventContext = workSessionEventContext(session);
      appendMonitorEvent({
        sessionId: session.id,
        type: 'decision.recorded',
        source: 'operator',
        summary: `${eventContext.label} Claude command submitted in a focused terminal by explicit operator action.`,
        subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
        metadata: { explicitLaunch: true, commandSubmitted: true, terminalName: launched.configuration.name },
      });
      this.refreshTerminalFirstViews();
      void vscode.window.showInformationMessage(
        input.ticketKey
          ? `Submitted Claude for ${input.ticketKey}. When Claude is ready, use Insert [${input.ticketKey}] to add the fetched Jira context.`
          : 'Submitted a standalone Claude command in a focused terminal. No Jira ticket was attached.',
      );
    } catch (error: unknown) {
      if (!commandSubmitted && closeSessionIfNotSubmitted && session) {
        try {
          const closed = closeWorkSession(session.id);
          appendMonitorEvent({
            sessionId: closed.id,
            type: 'decision.recorded',
            source: 'operator',
            summary: `${workSessionEventContext(closed).label} Claude launch failed before command submission; the new session was closed.`,
            subject: { kind: 'work-session', id: closed.id, ...workSessionTicketMetadata(closed) },
            metadata: { explicitLaunch: true, commandSubmitted: false },
          });
        } catch (compensationError: unknown) {
          this.log('Could not close the failed pre-submission work session.', unknownErrorMessage(compensationError, 'Session compensation failed.'));
        }
      }
      const detail = unknownErrorMessage(error, commandSubmitted
        ? 'The Claude command was submitted, but Kronos could not attach its session.'
        : 'Claude terminal launch failed.');
      this.log(commandSubmitted ? 'Claude command submitted but session attachment failed.' : 'Claude terminal launch failed.', detail);
      void vscode.window.showErrorMessage(
        commandSubmitted
          ? `The Claude command was submitted, but Kronos could not finish attaching the session: ${detail}`
          : `${detail} Run Kronos: Setup or Kronos: Doctor to check launch settings.`,
      );
    } finally {
      this.claudeLaunchesInFlight.delete(launchKey);
      this.claudeLaunchCooldownUntil.set(launchKey, Date.now() + CLAUDE_LAUNCH_COOLDOWN_MS);
    }
  }

  private claudeLaunchConfiguration(ticketKey?: string, ticket?: Ticket): { command: string; name: string; cwd?: string } {
    const configuration = vscode.workspace.getConfiguration('kronos');
    const command = configuration.get<string>('claudeCommand', DEFAULT_CLAUDE_COMMAND);
    const configuredName = configuration.get<string>('claudeTerminalName', DEFAULT_CLAUDE_TERMINAL_NAME);
    const mode = configuration.get<string>('claudeLaunchCwd', 'ticketProject');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ticketProjectPath = ticketLocalProject(this.state.state, ticket)?.path;
    const cwd = mode === 'home'
      ? os.homedir()
      : mode === 'workspace'
        ? workspacePath || os.homedir()
        : ticketProjectPath || workspacePath || os.homedir();
    const branch = readProjectGitBranch(cwd)?.branch;
    const name = buildClaudeTerminalTitle(configuredName, ticketKey, branch);
    return normalizeClaudeTerminalLaunch({ command, name, cwd });
  }

  private standaloneProjectDetails(cwd?: string): { projectName?: string; projectPath?: string } {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const details: { projectName?: string; projectPath?: string } = {};
    const workspacePath = workspace?.uri.fsPath;
    if (workspace?.name && (!cwd || cwd === workspacePath)) { details.projectName = workspace.name; }
    const projectPath = cwd || workspacePath;
    if (projectPath) { details.projectPath = projectPath; }
    return details;
  }

  private async attachTerminal(session: WorkSessionRecord, terminal: vscode.Terminal): Promise<WorkSessionRecord> {
    let processId: number | undefined;
    try { processId = await terminal.processId; } catch { processId = undefined; }
    if (this.closedTerminals.has(terminal) || terminal.exitStatus !== undefined) {
      throw new Error('The terminal closed before Kronos could attach its session.');
    }
    // Re-read after the await so concurrent actions cannot both persist a new
    // binding for the same terminal from a stale pre-await registry snapshot.
    const previous = this.operatorTerminals.bindingForTerminal(terminal);
    if (previous && previous.sessionId !== session.id) {
      detachWorkSessionTerminal(previous.sessionId, previous.bindingId, 'Terminal reassigned by the operator.');
      this.appendTerminalDetachedEvent(previous, 'reassigned');
    }
    const input: Parameters<typeof attachWorkSessionTerminal>[1] = { name: terminal.name };
    if (previous?.sessionId === session.id) { input.bindingId = previous.bindingId; }
    if (processId !== undefined) { input.processId = processId; }
    const cwd = terminal.shellIntegration?.cwd?.fsPath;
    if (cwd) { input.cwd = cwd; }
    const updated = attachWorkSessionTerminal(session.id, input);
    const persisted = input.bindingId
      ? updated.terminals.find(binding => binding.id === input.bindingId)
      : updated.terminals[updated.terminals.length - 1];
    if (!persisted) { throw new Error('Kronos could not persist the terminal attachment.'); }
    this.operatorTerminals.attach(terminal, { sessionId: updated.id, bindingId: persisted.id });
    const context = workSessionEventContext(updated);
    appendMonitorEvent({
      sessionId: updated.id,
      type: 'terminal.attached',
      source: 'operator',
      summary: `${context.label} operator terminal attached.`,
      subject: { kind: 'work-session', id: updated.id, ...workSessionTicketMetadata(updated) },
      metadata: { terminalBindingId: persisted.id },
    });
    return updated;
  }

  private ensureProviderBindings(session: TicketWorkSessionRecord, ticket: Ticket): TicketWorkSessionRecord {
    let updated = session;
    const config = this.projectConfig(ticket);
    if (ticket.source === 'jira') {
      const binding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
        provider: 'jira',
        resource: 'ticket',
        subjectId: session.ticketKey,
      };
      if (ticket.jira_url) { binding.url = ticket.jira_url; }
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, binding));
    }
    if (ticket.mr?.iid) {
      const binding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(ticket.mr.iid),
      };
      const gitLabProject = config?.gitlab_project_id || config?.gitlab_project_path;
      if (gitLabProject) { binding.projectId = String(gitLabProject); }
      if (ticket.mr.url) { binding.url = ticket.mr.url; }
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, binding));
    }
    const jenkinsUrl = ticket.build?.url || config?.jenkins_url;
    if (jenkinsUrl) {
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, {
        id: 'jenkins-build',
        provider: 'jenkins',
        resource: 'build',
        subjectId: ticket.build ? String(ticket.build.number) : 'latest',
        url: jenkinsUrl,
      }));
    }
    const sonarTarget = configuredSonarBranch(this.state.state, session.ticketKey);
    if (sonarTarget) {
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, {
        id: 'sonar-quality-gate',
        provider: 'sonar',
        resource: 'quality-gate',
        subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
        projectId: sonarTarget.projectKey,
      }));
    }
    return updated;
  }

  private requireTicketSession(session: WorkSessionRecord): TicketWorkSessionRecord {
    if (session.kind !== 'ticket') { throw new Error('Expected a ticket-linked work session.'); }
    return session;
  }

  private openContextComposer(request: ContextComposerRequest): void {
    this.contextComposerPanels.get(request.key)?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      'kronosContextComposer',
      request.panelTitle,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    const record: ContextComposerPanelRecord = {
      panel,
      nonce: createWebviewNonce(),
      selection: request.selection,
      reference: request.reference,
      promptPath: request.promptPath,
      onInserted: request.onInserted,
      inserting: false,
    };
    this.contextComposerPanels.set(request.key, record);
    panel.onDidDispose(() => {
      if (this.contextComposerPanels.get(request.key)?.panel === panel) {
        this.contextComposerPanels.delete(request.key);
      }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeContextComposerMessage(raw);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid context-composer request.');
        return;
      }
      if (message.command === 'cancel') {
        panel.dispose();
        return;
      }
      if (message.command === 'openArtifact') {
        await this.openLocalArtifact(record.promptPath);
        return;
      }
      if (message.command !== 'insertDraft') { return; }
      if (record.inserting) { return; }
      if (!this.insertionTerminalUnchanged(record.selection)) {
        void vscode.window.showWarningMessage('The managed terminal attachment changed while this context was being edited. Reopen the composer from the intended ticket or session.');
        return;
      }
      record.inserting = true;
      let inserted = false;
      try {
        insertEditableTerminalContextReference(record.selection.terminal, record.reference, message.focus);
        inserted = true;
        await record.onInserted();
        panel.dispose();
      } catch (error: unknown) {
        const detail = unknownErrorMessage(error, 'Context insertion failed.');
        this.log(inserted ? 'Context was inserted but its local audit update failed.' : 'Context composer insertion failed.', detail);
        void vscode.window.showErrorMessage(inserted
          ? `The context was inserted without submission, but Kronos could not finish its local audit update: ${detail}`
          : detail);
        if (inserted) { panel.dispose(); }
      } finally {
        record.inserting = false;
      }
    });
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', CONTEXT_COMPOSER_SCRIPT),
    ).toString();
    panel.webview.html = withWebviewCsp(buildContextComposerHtml({
      title: request.title,
      subtitle: request.subtitle,
      sourceLabel: request.sourceLabel,
      terminalName: request.selection.terminal.name,
      reference: request.reference,
      suggestedFocus: request.suggestedFocus,
      evidence: request.evidence,
      warnings: request.warnings,
      nonce: record.nonce,
      scriptUri,
    }), webviewScriptCspOptions(panel.webview.cspSource, record.nonce));
  }

  private async insertJiraContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    if (ticket.source !== 'jira') {
      void vscode.window.showWarningMessage(`${ticketKey} is not a Jira ticket.`);
      return;
    }
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }

    await this.runProgress(`Kronos: Preparing ${ticketKey} Jira context...`, async progress => {
      let jiraContext: JiraTicketContext | undefined;
      let attachmentContents: JiraAttachmentContentSnapshot[] = [];
      const warnings: string[] = [];
      if (isJiraRestConfigured()) {
        progress.report({ message: 'Reading visible fields, comments, and bounded raw attachments...' });
        try {
          const snapshot = await jiraRestClient.ticketContext(ticketKey, ticket.jira_url);
          jiraContext = normalizeJiraTicketContext(ticketKey, snapshot, { ...ticket });
          attachmentContents = snapshot.attachmentContents;
        } catch (error: unknown) {
          warnings.push(`${unknownErrorMessage(error, 'Native Jira REST read failed.')} Cached ticket data was inserted instead.`);
        }
      } else {
        warnings.push('Native Jira REST credentials are unavailable. Cached ticket data was inserted instead.');
      }
      if (!jiraContext) {
        jiraContext = buildFallbackJiraTicketContext(ticketKey, { ...ticket }, [], warnings);
      }
      progress.report({ message: 'Writing private content-addressed context and attachment files...' });
      const artifact = writeJiraContextArtifacts(jiraContext, { attachmentContents });
      const summary = `${jiraContext.completeness.fieldCount} fields (${jiraContext.completeness.customFieldCount} custom), ${jiraContext.comments.length} comments, ${jiraContext.completeness.attachmentBodiesCaptured}/${jiraContext.completeness.attachmentsTotal} attachment files downloaded`;
      this.openContextComposer({
        key: `jira:${ticketKey}`,
        panelTitle: `${ticketKey} — Compose Jira Context`,
        title: `${ticketKey}: ${jiraContext.summary || ticket.summary}`,
        subtitle: `${summary}. Review fetched details, edit the focus instruction, then insert one non-submitting line.`,
        sourceLabel: jiraContext.completeness.complete ? 'Jira ready' : 'Jira partial',
        reference: buildJiraContextReference(ticketKey, artifact.promptPath),
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the ticket description, acceptance criteria, latest comments, and relevant attachments before making changes.',
        evidence: jiraComposerEvidence(jiraContext),
        warnings: jiraContext.completeness.warnings,
        selection,
        onInserted: () => {
          if (selection.workSession) {
            recordWorkSessionContextArtifact(selection.workSession.id, {
              id: `jira-${ticketKey}`,
              kind: 'jira-ticket',
              label: `[${ticketKey}] Jira context`,
              promptPath: artifact.promptPath,
              fetchedAt: jiraContext.fetchedAt,
              complete: jiraContext.completeness.complete,
              warnings: jiraContext.completeness.warnings,
              contentSha256: artifact.contentSha256,
            });
            this.appendContextEvent(selection.workSession, 'jira', ticketKey, artifact.promptPath, artifact.contentSha256);
          }
          this.refreshTerminalFirstViews();
          const message = `Inserted edited [${ticketKey}] context into ${selection.terminal.name} without submitting it (${summary}).`;
          if (jiraContext.completeness.complete) {
            void vscode.window.showInformationMessage(`${message} Review the terminal line, then press Enter yourself.`);
          } else {
            void vscode.window.showWarningMessage(`${message} Cached or partial context was used; review the saved warnings.`);
          }
        },
      });
    });
  }

  private async insertGitLabContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const target = await this.resolveGitLabInsertionTarget(ticketKey, ticket);
    if (!target) { return; }
    const { iid, projectIdOrPath } = target;
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }

    await this.runProgress(`Kronos: Preparing MR-${iid} context...`, async progress => {
      progress.report({ message: 'Reading MR, discussions, diffs, pipeline, jobs, and tests...' });
      const snapshot = await gitlabRestClient.mergeRequestContext({ projectIdOrPath, iid });
      const context = normalizeGitLabMergeRequestContext(ticketKey, iid, snapshot);
      const artifact = writeGitLabContextArtifacts(context);
      const failedTests = context.testReport?.failedCount ?? context.testReportSummary?.failedCount ?? 0;
      const summary = `${context.notes.length} notes, ${context.discussions.length} discussions, ${context.jobs.length} jobs, ${failedTests} failed tests`;
      this.openContextComposer({
        key: `gitlab:${ticketKey}:${iid}`,
        panelTitle: `MR-${iid} — Compose GitLab Context`,
        title: `MR-${iid}: ${context.mergeRequest.title}`,
        subtitle: `${summary}. Review fetched details, edit the focus instruction, then insert one non-submitting line.`,
        sourceLabel: context.completeness.complete ? 'GitLab ready' : 'GitLab partial',
        reference: buildGitLabMergeRequestContextReference(iid, artifact.promptPath),
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the merge request description, unresolved discussions, latest comments, pipeline failures, and test evidence before responding.',
        evidence: gitLabComposerEvidence(context),
        warnings: context.completeness.warnings,
        selection,
        onInserted: () => {
          if (selection.workSession) {
            const mergeRequestBinding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
              provider: 'gitlab',
              resource: 'merge-request',
              subjectId: String(iid),
              projectId: projectIdOrPath,
            };
            if (target.url) { mergeRequestBinding.url = target.url; }
            let session = addWorkSessionProviderBinding(selection.workSession.id, mergeRequestBinding);
            if (context.pipeline) {
              const pipelineBinding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
                provider: 'gitlab',
                resource: 'pipeline',
                subjectId: String(context.pipeline.id),
              };
              if (context.pipeline.projectId) { pipelineBinding.projectId = String(context.pipeline.projectId); }
              if (context.pipeline.webUrl) { pipelineBinding.url = context.pipeline.webUrl; }
              session = addWorkSessionProviderBinding(session.id, pipelineBinding);
            }
            recordWorkSessionContextArtifact(session.id, {
              id: `gitlab-mr-${iid}`,
              kind: 'gitlab-merge-request',
              label: `[MR-${iid}] GitLab MR and pipeline context`,
              promptPath: artifact.promptPath,
              fetchedAt: context.fetchedAt,
              complete: context.completeness.complete,
              warnings: context.completeness.warnings,
              contentSha256: artifact.contentSha256,
            });
            this.appendContextEvent(session, 'gitlab', String(iid), artifact.promptPath, artifact.contentSha256);
          }
          this.refreshTerminalFirstViews();
          const message = `Inserted edited [MR-${iid}] context into ${selection.terminal.name} without submitting it (${summary}).`;
          if (context.completeness.complete) {
            void vscode.window.showInformationMessage(`${message} Review the terminal line, then press Enter yourself.`);
          } else {
            void vscode.window.showWarningMessage(`${message} The saved MR context is partial; review its warnings.`);
          }
        },
      });
    });
  }

  private async insertCiContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    const selection = await this.chooseInsertionTerminal(ticketKey);
    if (!selection) { return; }
    const config = this.projectConfig(ticket);
    const jenkinsUrl = ticket.build?.url || config?.jenkins_url;
    const sonarTarget = configuredSonarBranch(this.state.state, ticketKey);
    if (!jenkinsUrl && !sonarTarget) {
      void vscode.window.showWarningMessage(`${ticketKey} has no linked Jenkins URL or SonarQube project/branch.`);
      return;
    }

    await this.runProgress(`Kronos: Preparing ${ticketKey} CI context...`, async progress => {
      const warnings: string[] = [];
      let jenkins: JenkinsBuildContext | undefined;
      let sonar: SonarBranchContext | undefined;
      if (jenkinsUrl) {
        progress.report({ message: 'Reading Jenkins build, stages, and tests...' });
        try { jenkins = await jenkinsRestClient.buildContext(jenkinsUrl); }
        catch (error: unknown) { warnings.push(unknownErrorMessage(error, 'Jenkins context was unavailable.')); }
      }
      if (sonarTarget) {
        progress.report({ message: 'Reading SonarQube gate, measures, and issues...' });
        try { sonar = await sonarRestClient.branchContext(sonarTarget.projectKey, sonarTarget.branch); }
        catch (error: unknown) { warnings.push(unknownErrorMessage(error, 'SonarQube context was unavailable.')); }
      }
      if (!jenkins && !sonar) { throw new Error('Neither Jenkins nor SonarQube context could be read. Run Kronos: Doctor.'); }
      const input: { jenkins?: JenkinsBuildContext; sonar?: SonarBranchContext; warnings: string[] } = { warnings };
      if (jenkins) { input.jenkins = jenkins; }
      if (sonar) { input.sonar = sonar; }
      const context = buildCiContext(ticketKey, input);
      const artifact = writeCiContextArtifacts(context);
      if (!this.insertionTerminalUnchanged(selection)) {
        void vscode.window.showWarningMessage(`${ticketKey} CI context was saved, but the terminal attachment changed. Reattach and insert again.`);
        return;
      }
      insertTerminalContextReference(selection.terminal, buildCiContextReference(ticketKey, artifact.promptPath));
      if (selection.workSession) {
        let session = selection.workSession;
        if (jenkins) {
          session = addWorkSessionProviderBinding(session.id, {
            id: 'jenkins-build',
            provider: 'jenkins',
            resource: 'build',
            subjectId: String(jenkins.build.number),
            url: jenkinsUrl || jenkins.build.url,
          });
        }
        if (sonar && sonarTarget) {
          session = addWorkSessionProviderBinding(session.id, {
            id: 'sonar-quality-gate',
            provider: 'sonar',
            resource: 'quality-gate',
            subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
            projectId: sonarTarget.projectKey,
            url: sonar.dashboardUrl,
          });
        }
        recordWorkSessionContextArtifact(session.id, {
          id: `ci-${ticketKey}`,
          kind: 'ci-evidence',
          label: `[CI-${ticketKey}] Jenkins and SonarQube context`,
          promptPath: artifact.promptPath,
          fetchedAt: context.fetchedAt,
          complete: context.completeness.complete,
          warnings: context.completeness.warnings,
          contentSha256: artifact.contentSha256,
        });
        this.appendContextEvent(session, 'kronos', ticketKey, artifact.promptPath, artifact.contentSha256);
      }
      this.refreshTerminalFirstViews();
      const message = `Inserted [CI-${ticketKey}] into ${selection.terminal.name} without submitting it.`;
      if (context.completeness.complete) {
        void vscode.window.showInformationMessage(`${message} Review it, then press Enter yourself.`);
      } else {
        void vscode.window.showWarningMessage(`${message} One or more provider components were partial; review the saved warnings.`);
      }
    });
  }

  private async chooseInsertionTerminal(ticketKey: string): Promise<TerminalSelection | undefined> {
    const session = getWorkSessionByTicket(ticketKey);
    if (session?.status === 'active') {
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        void vscode.window.showWarningMessage(`Focus the terminal managed for ${ticketKey} before inserting context.`);
        return undefined;
      }
      const binding = this.operatorTerminals.bindingForTerminal(terminal);
      if (binding?.sessionId !== session.id) {
        void vscode.window.showWarningMessage(
          `The focused terminal is not managed for ${ticketKey}. Focus its attached terminal or explicitly reattach this one before inserting context.`,
        );
        return undefined;
      }
      return { terminal, workSession: session, binding };
    }
    void vscode.window.showWarningMessage(
      `Manage the focused operator-owned terminal for ${ticketKey} before inserting context. This explicit association prevents insertion into the wrong terminal.`,
    );
    return undefined;
  }

  private async chooseLiveTerminal(sessionId: string): Promise<{ terminal: vscode.Terminal; binding: OperatorTerminalBinding } | undefined> {
    const active = vscode.window.activeTerminal;
    if (active) {
      const binding = this.operatorTerminals.bindingForTerminal(active);
      if (binding?.sessionId === sessionId) { return { terminal: active, binding }; }
    }
    const bindings = this.operatorTerminals.listBindings(sessionId);
    if (bindings.length === 0) { return undefined; }
    let selected = bindings[0];
    if (bindings.length > 1) {
      const session = readWorkSession(sessionId);
      const pick = await vscode.window.showQuickPick(bindings.map(binding => ({
        label: session?.terminals.find(candidate => candidate.id === binding.bindingId)?.name || binding.bindingId,
        description: binding.bindingId,
        binding,
      })), { title: 'Choose the operator-owned terminal for this action' });
      selected = pick?.binding;
    }
    if (!selected) { return undefined; }
    const resolved = this.operatorTerminals.resolve(sessionId, selected.bindingId);
    return resolved.kind === 'resolved' ? { terminal: resolved.terminal, binding: resolved.binding } : undefined;
  }

  private insertionTerminalUnchanged(selection: TerminalSelection): boolean {
    if (!selection.binding) { return vscode.window.activeTerminal === selection.terminal; }
    const resolved = this.operatorTerminals.resolve(selection.binding.sessionId, selection.binding.bindingId);
    return resolved.kind === 'resolved' && resolved.terminal === selection.terminal;
  }

  private async pollProviders(showResult: boolean): Promise<void> {
    let result: ManagedProviderPollResult;
    try {
      result = await this.monitor.poll();
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, 'Managed provider poll failed.');
      this.log('Managed provider poll failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(detail); }
      return;
    }
    if (!showResult) { return; }
    if (result.leaseUnavailable && result.polled === 0) {
      void vscode.window.showInformationMessage('Another Kronos window owns the provider-monitoring lease; no duplicate read was started.');
      return;
    }
    const message = `Read ${result.polled} provider context${result.polled === 1 ? '' : 's'}; recorded ${result.transitions} new attention item${result.transitions === 1 ? '' : 's'}; ${result.failures} failed; ${result.skipped} skipped.`;
    if (result.failures > 0 || result.leaseUnavailable) { void vscode.window.showWarningMessage(message); }
    else { void vscode.window.showInformationMessage(message); }
  }

  private showProviderNotice(notice: ManagedProviderNotice): void {
    try {
      const notificationEvent: Parameters<typeof appendMonitorEvent>[0] = {
        sessionId: notice.session.id,
        type: 'notification.shown',
        source: 'kronos',
        summary: notice.event.summary,
        metadata: { transitionEventId: notice.event.id },
      };
      if (notice.event.subject) { notificationEvent.subject = notice.event.subject; }
      appendMonitorEvent(notificationEvent);
    } catch (error: unknown) {
      this.log('Could not record provider notification display.', unknownErrorMessage(error, 'Notification audit failed.'));
    }
    const actions = [
      ...(notice.providerUrl ? ['Open Provider'] : []),
      ...(notice.contextCommand ? ['Insert Fresh Context'] : []),
      'Acknowledge',
    ];
    const prompt = notice.severity === 'warning'
      ? vscode.window.showWarningMessage(notice.event.summary, ...actions)
      : vscode.window.showInformationMessage(notice.event.summary, ...actions);
    void prompt.then(async action => {
      if (action === 'Open Provider' && notice.providerUrl) { await this.openHttpUrl(notice.providerUrl); }
      if (action === 'Insert Fresh Context' && notice.contextCommand) {
        await vscode.commands.executeCommand(notice.contextCommand, { ticketKey: notice.session.ticketKey });
      }
      if (action === 'Acknowledge') {
        acknowledgeMonitorEvent(notice.event.id, notice.session.id);
        this.attentionTree.refresh();
      }
    }, error => this.log('Provider notification action failed.', unknownErrorMessage(error, 'Notification action failed.')));
  }

  private async openWorkSessionAudit(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const events = listMonitorEvents({ sessionId: session.id, limit: 1000 });
    const document = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: buildWorkSessionAuditMarkdown(session, events),
    });
    await vscode.window.showTextDocument(document, { preview: true, viewColumn: vscode.ViewColumn.One });
  }

  private async focusWorkSessionTerminal(argument: unknown): Promise<void> {
    let session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    let selected = await this.chooseLiveTerminal(session.id);
    if (!selected) {
      const terminal = await this.chooseOpenTerminalForSession(session);
      if (!terminal) { return; }
      if (session.status === 'closed') { session = reopenWorkSession(session.id); }
      if (session.kind === 'ticket') {
        const ticket = this.state.state?.tickets[session.ticketKey];
        if (ticket) { session = this.ensureProviderBindings(session, ticket); }
      }
      await this.attachTerminal(session, terminal);
      selected = await this.chooseLiveTerminal(session.id);
      this.refreshTerminalFirstViews();
    }
    if (selected) { selected.terminal.show(false); }
  }

  private async chooseOpenTerminalForSession(session: WorkSessionRecord): Promise<vscode.Terminal | undefined> {
    const terminals = vscode.window.terminals.filter(terminal => {
      const binding = this.operatorTerminals.bindingForTerminal(terminal);
      return !binding || binding.sessionId === session.id;
    });
    if (terminals.length === 0) {
      void vscode.window.showWarningMessage(
        `${workSessionEventContext(session).label} has no attached terminal and there are no unclaimed open terminals to reconnect.`,
      );
      return undefined;
    }
    if (terminals.length === 1) { return terminals[0]; }
    const pick = await vscode.window.showQuickPick(terminals.map((terminal, index) => ({
      label: terminal.name,
      description: terminal === vscode.window.activeTerminal ? 'focused terminal' : `open terminal ${index + 1}`,
      terminal,
    })), {
      title: `Open ${workSessionEventContext(session).label}`,
      placeHolder: 'This session is detached; choose the open terminal that belongs to it',
    });
    return pick?.terminal;
  }

  private async reattachFocusedTerminal(argument: unknown): Promise<void> {
    let session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showWarningMessage('Focus the intended existing terminal before reattaching it.');
      return;
    }
    if (session.status === 'closed') { session = reopenWorkSession(session.id); }
    if (session.kind === 'ticket') {
      const ticket = this.state.state?.tickets[session.ticketKey];
      if (ticket) { session = this.ensureProviderBindings(session, ticket); }
    }
    await this.attachTerminal(session, terminal);
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Reattached ${terminal.name} to ${workSessionEventContext(session).label}. Terminal contents were not read.`);
  }

  private async detachManagedTerminal(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const selected = await this.chooseLiveTerminal(session.id);
    if (!selected) {
      void vscode.window.showInformationMessage(`${workSessionEventContext(session).label} has no live terminal attachment.`);
      return;
    }
    this.operatorTerminals.detachBinding(session.id, selected.binding.bindingId);
    detachWorkSessionTerminal(session.id, selected.binding.bindingId, 'Detached explicitly by the operator.');
    this.appendTerminalDetachedEvent(selected.binding, 'operator-detached');
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Detached ${selected.terminal.name} from ${workSessionEventContext(session).label}. The terminal remains open.`);
  }

  private async stopManagingSession(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const context = workSessionEventContext(session);
    const confirmation = await vscode.window.showWarningMessage(
      `Stop organizing ${context.label}? Monitoring will stop, but every terminal remains open and untouched.`,
      { modal: true },
      'Stop Managing',
    );
    if (confirmation !== 'Stop Managing') { return; }
    this.operatorTerminals.detachSession(session.id);
    closeWorkSession(session.id);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${context.label} work-session management stopped by the operator.`,
      subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
      metadata: { monitoringEnabled: false, terminalClosed: false },
    });
    this.refreshTerminalFirstViews();
  }

  private async setMonitoring(argument: unknown, enabled: boolean): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    if (session.kind !== 'ticket') {
      void vscode.window.showInformationMessage('Standalone sessions do not poll Jira, merge-request, or CI providers.');
      return;
    }
    if (session.status !== 'active') {
      void vscode.window.showWarningMessage(`Reattach ${session.ticketKey} before enabling monitoring.`);
      return;
    }
    setWorkSessionMonitoring(session.id, enabled);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${session.ticketKey} monitoring ${enabled ? 'resumed' : 'paused'} by the operator.`,
      subject: { kind: 'work-session', id: session.id, ticketKey: session.ticketKey },
      metadata: { monitoringEnabled: enabled },
    });
    this.refreshTerminalFirstViews();
  }

  private async acknowledgeAttention(argument: unknown): Promise<void> {
    const eventId = stringProperty(argument, 'eventId');
    const sessionId = stringProperty(argument, 'sessionId') || stringProperty(argument, 'workSessionId');
    if (!eventId || !sessionId) {
      void vscode.window.showWarningMessage('Select an Attention item to acknowledge.');
      return;
    }
    acknowledgeMonitorEvent(eventId, sessionId);
    this.attentionTree.refresh();
  }

  private async openProvider(argument: unknown): Promise<void> {
    const providerUrl = stringProperty(argument, 'providerUrl') || stringProperty(argument, 'url');
    if (!providerUrl) {
      void vscode.window.showWarningMessage('This Attention item has no validated provider URL.');
      return;
    }
    await this.openHttpUrl(providerUrl);
  }

  private async openSetup(): Promise<void> {
    if (this.setupPanel) {
      this.setupPanel.panel.reveal(vscode.ViewColumn.One);
      this.renderSetupPanel();
      return;
    }
    const panel = this.createOperationsPanel('kronosSetup', 'Kronos — Setup');
    const record: OperationsPanelRecord = { panel, nonce: createWebviewNonce() };
    this.setupPanel = record;
    panel.onDidDispose(() => {
      if (this.setupPanel?.panel === panel) { this.setupPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeOperationsActionMessage(raw, OPERATIONS_PANEL_ACTIONS);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid Setup request.');
        return;
      }
      await this.executeOperationsPanelAction('setup', message.command);
    });
    this.renderSetupPanel();
  }

  private async openDoctor(): Promise<void> {
    if (this.doctorPanel) {
      this.doctorPanel.panel.reveal(vscode.ViewColumn.One);
      this.renderDoctorPanel();
      return;
    }
    const panel = this.createOperationsPanel('kronosDoctor', 'Kronos — Doctor');
    const record: OperationsPanelRecord = { panel, nonce: createWebviewNonce() };
    this.doctorPanel = record;
    panel.onDidDispose(() => {
      if (this.doctorPanel?.panel === panel) { this.doctorPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeOperationsActionMessage(raw, OPERATIONS_PANEL_ACTIONS);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid Doctor request.');
        return;
      }
      await this.executeOperationsPanelAction('doctor', message.command);
    });
    this.renderDoctorPanel();
  }

  private createOperationsPanel(viewType: string, title: string): vscode.WebviewPanel {
    const panel = vscode.window.createWebviewPanel(viewType, title, vscode.ViewColumn.One, {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    });
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    return panel;
  }

  private async executeOperationsPanelAction(source: 'setup' | 'doctor', action: string): Promise<void> {
    const requestKey = `${source}:${action}`;
    if (this.operationsPanelActionsInFlight.has(requestKey)) { return; }
    this.operationsPanelActionsInFlight.add(requestKey);
    try {
      if (action === 'refreshPanel') {
        this.loadProviderEnvironment();
        this.state.reloadAndNotify();
      } else if (action === 'openSetup') {
        await this.openSetup();
      } else if (action === 'openDoctor') {
        await this.openDoctor();
      } else if (action === 'openSettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos');
      } else if (action === 'openClaudeSettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos claude');
      } else if (action === 'chooseProjectDiscoveryFolders') {
        await this.configureProjectDiscoveryFolders();
      } else if (action === 'manageLocalProjects') {
        await this.registerWorkspaceProject();
      } else if (action === 'configureProjectIntegrations') {
        this.openProjectIntegrationSetup();
      } else if (action === 'openJiraBoard') {
        await this.openJiraBoard();
      }
      this.renderSetupPanel();
      this.renderDoctorPanel();
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, `Kronos ${source} action failed.`);
      this.log(`Kronos ${source} action failed.`, detail);
      void vscode.window.showErrorMessage(detail);
    } finally {
      this.operationsPanelActionsInFlight.delete(requestKey);
    }
  }

  private renderSetupPanel(): void {
    const record = this.setupPanel;
    if (!record) { return; }
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(buildSetupPanelHtml({
      steps: this.setupSteps(),
      providerEnvPath: defaultProviderEnvPath(),
      nonce: record.nonce,
      actionScriptUri,
    }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
  }

  private setupSteps(): SetupStep[] {
    const projects = listLocalProjects(this.state.state);
    const unavailableProjects = projects.filter(project => !project.available);
    const discovery = this.projectDiscoverySettings();
    const claude = this.claudeReadinessCheck();
    const jiraConfigured = isJiraRestConfigured();
    const sessions = listWorkSessions();
    const sessionIssues = listWorkSessionStoreIssues();
    const integrationReadyCount = projects.filter(project => {
      const config = this.state.state?.projects[project.name]?.config;
      return Boolean(
        (config?.gitlab_project_id || config?.gitlab_project_path)
        && config?.jenkins_url
        && config?.sonar_project_key
        && (config?.default_branch || config?.base_branch),
      );
    }).length;
    const configuredMonitoringProviders = [
      isGitLabRestConfigured() ? 'GitLab' : '',
      isJenkinsRestConfigured() ? 'Jenkins' : '',
      isSonarRestConfigured() ? 'SonarQube' : '',
    ].filter(Boolean);
    const stateIssueCount = this.state.loadIssues.length + sessionIssues.length;
    const ticketCount = Object.keys(this.state.state?.tickets || {}).length;
    return [
      {
        title: 'Claude terminal launch',
        detail: claude.detail,
        status: claude.status,
        action: 'openClaudeSettings',
        actionLabel: 'Claude Settings',
      },
      {
        title: 'Project discovery folders',
        detail: `${discovery.roots.length} selected parent folder${discovery.roots.length === 1 ? '' : 's'}; scan depth ${discovery.depth}; result limit ${discovery.limit}. Open workspace folders are included automatically.`,
        status: discovery.roots.length > 0 || Boolean(vscode.workspace.workspaceFolders?.length) ? 'pass' : 'warn',
        action: 'chooseProjectDiscoveryFolders',
        actionLabel: 'Choose Folders',
      },
      {
        title: 'Registered local projects',
        detail: projects.length === 0
          ? 'No local project is registered yet.'
          : `${projects.length} registered; ${unavailableProjects.length} unavailable. Current branches are read directly from Git HEAD without running Git.`,
        status: unavailableProjects.length > 0 ? 'fail' : projects.length > 0 ? 'pass' : 'warn',
        action: 'manageLocalProjects',
        actionLabel: 'Manage Projects',
      },
      {
        title: 'Jira work board',
        detail: jiraConfigured
          ? `Jira read access is configured; ${ticketCount} ticket${ticketCount === 1 ? '' : 's'} currently loaded.`
          : 'Jira read access needs JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN in the private provider environment.',
        status: jiraConfigured ? 'pass' : 'warn',
        action: 'openJiraBoard',
        actionLabel: 'Open Jira Board',
      },
      {
        title: 'Project polling configuration',
        detail: projects.length === 0
          ? 'Register a local project before adding provider identifiers.'
          : `${integrationReadyCount}/${projects.length} registered project${projects.length === 1 ? '' : 's'} have GitLab, Jenkins, SonarQube, and branch identifiers filled in.`,
        status: projects.length > 0 && integrationReadyCount === projects.length ? 'pass' : 'warn',
        action: 'configureProjectIntegrations',
        actionLabel: 'Configure Integrations',
      },
      {
        title: 'MR and pipeline monitoring',
        detail: configuredMonitoringProviders.length > 0
          ? `${configuredMonitoringProviders.join(', ')} read-only monitoring configured.`
          : 'No optional GitLab, Jenkins, or SonarQube monitoring provider is fully configured yet.',
        status: configuredMonitoringProviders.length > 0 ? 'pass' : 'warn',
        action: 'openDoctor',
        actionLabel: 'Check Providers',
      },
      {
        title: 'Private local state',
        detail: stateIssueCount === 0
          ? `${sessions.length} managed session record${sessions.length === 1 ? '' : 's'}; local state is readable.`
          : `${stateIssueCount} local state issue${stateIssueCount === 1 ? '' : 's'} needs attention.`,
        status: stateIssueCount === 0 ? 'pass' : 'fail',
        action: 'openDoctor',
        actionLabel: 'Inspect with Doctor',
      },
    ];
  }

  private renderDoctorPanel(): void {
    const record = this.doctorPanel;
    if (!record) { return; }
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(buildDoctorPanelHtml({
      checks: this.doctorChecks(),
      nonce: record.nonce,
      actionScriptUri,
    }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
  }

  private doctorChecks(): DoctorCheck[] {
    const stateIssues = this.state.loadIssues;
    const sessionIssues = listWorkSessionStoreIssues();
    const discoverySettings = this.projectDiscoverySettings();
    const projects = listLocalProjects(this.state.state);
    const unavailableProjects = projects.filter(project => !project.available);
    const ticketCount = Object.keys(this.state.state?.tickets || {}).length;
    const completedStatuses = this.completedJiraStatuses();
    const sessions = listWorkSessions();
    const jiraConfigured = isJiraRestConfigured();
    const gitLabConfigured = isGitLabRestConfigured();
    const jenkinsConfigured = isJenkinsRestConfigured();
    const sonarConfigured = isSonarRestConfigured();
    const workCatalogStatus: OperationsStatus = this.state.state === null || stateIssues.length > 0
      ? 'fail'
      : ticketCount > 0 ? 'pass' : 'warn';
    return [
      {
        name: 'Work catalog',
        status: workCatalogStatus,
        detail: `${ticketCount} Jira ticket${ticketCount === 1 ? '' : 's'}; ${stateIssues.length} local issue${stateIssues.length === 1 ? '' : 's'}${stateIssues[0] ? ` — ${stateIssues[0].filePath}: ${stateIssues[0].detail}` : ''}`,
      },
      {
        name: 'Local projects and Git branches',
        status: unavailableProjects.length > 0 ? 'fail' : projects.length > 0 ? 'pass' : 'warn',
        detail: projects.map(project => `${project.name}: ${project.branch || (project.available ? 'Git branch unavailable' : 'folder unavailable')}`).join('; ') || 'No local projects registered.',
      },
      {
        name: 'Project discovery settings',
        status: discoverySettings.roots.length > 0 || Boolean(vscode.workspace.workspaceFolders?.length) ? 'pass' : 'warn',
        detail: `${discoverySettings.roots.length} configured root${discoverySettings.roots.length === 1 ? '' : 's'}; depth ${discoverySettings.depth}; limit ${discoverySettings.limit}.`,
      },
      {
        name: 'Jira visibility settings',
        status: 'pass',
        detail: `${this.hideCompletedJiraWork() ? 'Completed work hidden by default' : 'Completed work shown by default'}; ${completedStatuses.length} additional completed status name${completedStatuses.length === 1 ? '' : 's'}.`,
      },
      this.claudeReadinessCheck(),
      {
        name: 'Jira REST',
        status: jiraConfigured ? 'pass' : 'warn',
        detail: jiraConfigured ? 'Configured for bounded read-only Jira access.' : 'Requires JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.',
      },
      {
        name: 'GitLab REST',
        status: gitLabConfigured ? 'pass' : 'warn',
        detail: gitLabConfigured ? 'Configured for bounded read-only merge-request and pipeline access.' : 'Requires a GitLab URL and token; project identity comes from a binding or MR URL.',
      },
      {
        name: 'Jenkins REST',
        status: jenkinsConfigured ? 'pass' : 'warn',
        detail: jenkinsConfigured ? 'Configured for bounded read-only build and test access.' : 'Requires JENKINS_URL; credentials are optional when the server permits anonymous reads.',
      },
      {
        name: 'SonarQube REST',
        status: sonarConfigured ? 'pass' : 'warn',
        detail: sonarConfigured ? 'Configured for bounded read-only quality-gate access.' : 'Requires a SonarQube URL and token plus a project/branch binding.',
      },
      {
        name: 'Private work-session state',
        status: sessionIssues.length === 0 ? 'pass' : 'fail',
        detail: `${sessions.length} session${sessions.length === 1 ? '' : 's'}; ${sessionIssues.length} invalid record${sessionIssues.length === 1 ? '' : 's'}${sessionIssues[0] ? ` — ${sessionIssues[0].filePath}: ${sessionIssues[0].detail}` : ''}`,
      },
    ];
  }

  private claudeReadinessCheck(): DoctorCheck {
    try {
      const launch = this.claudeLaunchConfiguration();
      const availability = probeClaudeExecutableAvailability(launch.command);
      if (!availability.available) {
        return {
          name: 'Claude launch settings',
          status: 'fail',
          detail: `${availability.executable} was not found on the VS Code extension-host PATH. Your interactive terminal PATH may differ.`,
        };
      }
      if (!vscode.workspace.isTrusted) {
        return {
          name: 'Claude launch settings',
          status: 'warn',
          detail: `${availability.executable} is available and launch settings are valid, but explicit launch is disabled until this workspace is trusted.`,
        };
      }
      const branch = launch.cwd ? readProjectGitBranch(launch.cwd)?.branch : undefined;
      return {
        name: 'Claude launch settings',
        status: 'pass',
        detail: `${availability.executable} is available; syntax and starting directory are valid${branch ? `; terminal tabs will show branch ${branch}` : ''}.`,
      };
    } catch (error: unknown) {
      return {
        name: 'Claude launch settings',
        status: 'fail',
        detail: unknownErrorMessage(error, 'Claude launch settings are invalid.'),
      };
    }
  }

  private async resolveTicketKey(argument: unknown, allowPick: boolean): Promise<string | undefined> {
    const direct = normalizeTicketKey(
      typeof argument === 'string'
        ? argument
        : stringProperty(argument, 'ticketKey') || stringProperty(argument, 'ticket'),
    );
    if (direct && this.state.state?.tickets[direct]) { return direct; }
    if (!allowPick) { return undefined; }
    const entries = Object.entries(this.state.state?.tickets || {});
    if (entries.length === 0) {
      void vscode.window.showWarningMessage('No Jira work is loaded. Refresh Work or run Kronos: Doctor.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(entries.map(([ticketKey, ticket]) => ({
      label: ticketKey,
      description: ticket.summary,
      detail: `${ticket.jira_status} • ${ticket.projects.join(', ') || 'unlinked'}`,
      ticketKey,
    })), { title: 'Choose the Jira work item for this terminal action', matchOnDescription: true, matchOnDetail: true });
    return pick?.ticketKey;
  }

  private async resolveWorkSession(argument: unknown, allowPick: boolean): Promise<WorkSessionRecord | undefined> {
    const direct = typeof argument === 'string'
      ? argument
      : stringProperty(argument, 'workSessionId') || stringProperty(argument, 'sessionId');
    if (direct) {
      try {
        const session = readWorkSession(direct);
        if (session) { return session; }
      } catch (error: unknown) {
        this.log('Could not read selected work session.', unknownErrorMessage(error, 'Invalid work session.'));
      }
    }
    const ticketKey = normalizeTicketKey(stringProperty(argument, 'ticketKey'));
    if (ticketKey) {
      const session = getWorkSessionByTicket(ticketKey);
      if (session) { return session; }
    }
    if (!allowPick) { return undefined; }
    const sessions = listWorkSessions();
    const pick = await vscode.window.showQuickPick(sessions.map(session => ({
      label: workSessionEventContext(session).label,
      description: session.kind === 'ticket'
        ? `${session.status} • ${session.monitoring.enabled ? 'monitoring on' : 'monitoring off'}`
        : `${session.status} • standalone`,
      detail: session.title,
      session,
    })), { title: 'Choose a managed work session' });
    return pick?.session;
  }

  private gitLabProjectId(ticket: Ticket): string | undefined {
    const config = this.projectConfig(ticket);
    const configuredProject = config?.gitlab_project_id || config?.gitlab_project_path;
    if (configuredProject) { return String(configuredProject); }
    return configuredGitLabProjectPathFromMergeRequestUrl(ticket.mr?.url, process.env);
  }

  private async resolveGitLabInsertionTarget(
    ticketKey: string,
    ticket: Ticket,
  ): Promise<GitLabInsertionTarget | undefined> {
    const configuredProject = this.gitLabProjectId(ticket);
    if (ticket.mr?.iid && configuredProject) {
      return { iid: ticket.mr.iid, projectIdOrPath: configuredProject, url: ticket.mr.url };
    }

    const session = getWorkSessionByTicket(ticketKey);
    const savedBinding = [...(session?.providerBindings || [])]
      .reverse()
      .find(binding => binding.provider === 'gitlab' && binding.resource === 'merge-request');
    if (savedBinding && /^[1-9][0-9]*$/.test(savedBinding.subjectId)) {
      const iid = Number(savedBinding.subjectId);
      const projectIdOrPath = savedBinding.projectId
        || configuredGitLabProjectPathFromMergeRequestUrl(savedBinding.url, process.env);
      if (Number.isSafeInteger(iid) && projectIdOrPath) {
        const target: GitLabInsertionTarget = { iid, projectIdOrPath };
        if (savedBinding.url) { target.url = savedBinding.url; }
        return target;
      }
    }

    const value = await vscode.window.showInputBox({
      title: `Connect a GitLab merge request to ${ticketKey}`,
      prompt: configuredProject
        ? 'Paste the merge-request URL or enter its numeric IID. Kronos saves the binding only in the local work session.'
        : 'Paste the full merge-request URL. Its origin must match the configured GitLab API.',
      placeHolder: 'https://gitlab.example/group/project/-/merge_requests/77',
      ignoreFocusOut: true,
    });
    const candidate = value?.trim();
    if (!candidate) { return undefined; }
    if (/^[1-9][0-9]*$/.test(candidate)) {
      const iid = Number(candidate);
      if (Number.isSafeInteger(iid) && configuredProject) {
        return { iid, projectIdOrPath: configuredProject };
      }
      void vscode.window.showWarningMessage('A numeric MR IID also needs a configured GitLab project ID or an existing linked MR URL.');
      return undefined;
    }
    let iid: number | undefined;
    try {
      const parsed = new URL(candidate);
      const match = /\/-\/merge_requests\/([1-9][0-9]*)(?:\/|$)/.exec(parsed.pathname);
      const numeric = match?.[1] ? Number(match[1]) : Number.NaN;
      if (Number.isSafeInteger(numeric)) { iid = numeric; }
    } catch {
      iid = undefined;
    }
    const projectIdOrPath = configuredGitLabProjectPathFromMergeRequestUrl(candidate, process.env);
    if (!iid || !projectIdOrPath) {
      void vscode.window.showWarningMessage('That MR URL is invalid or outside the configured GitLab origin. Run Kronos: Doctor to check GitLab configuration.');
      return undefined;
    }
    return { iid, projectIdOrPath, url: candidate };
  }

  private projectConfig(ticket: Ticket): ProjectConfig | undefined {
    const config = projectConfigurationForTicket(this.state.state, ticket);
    return Object.keys(config).length > 0 ? config : undefined;
  }

  private appendContextEvent(
    session: WorkSessionRecord,
    source: 'jira' | 'gitlab' | 'kronos',
    subjectId: string,
    artifactPath: string,
    contentSha256: string,
  ): void {
    const context = workSessionEventContext(session);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'context.inserted',
      source,
      summary: `${context.label} ${source} context reference inserted without submission.`,
      subject: { kind: source === 'gitlab' ? 'merge-request' : source === 'jira' ? 'ticket' : 'ci-context', id: subjectId, ...workSessionTicketMetadata(session) },
      artifactPath,
      metadata: { submitted: false, artifactSha256: contentSha256 },
    });
  }

  private appendTerminalDetachedEvent(binding: OperatorTerminalBinding, reason: string): void {
    const session = readWorkSession(binding.sessionId);
    if (!session) { return; }
    const context = workSessionEventContext(session);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'terminal.detached',
      source: 'operator',
      summary: `${context.label} operator terminal detached.`,
      subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
      metadata: { reason },
    });
  }

  private handleClosedTerminal(terminal: vscode.Terminal): void {
    this.closedTerminals.add(terminal);
    const binding = this.operatorTerminals.detachTerminal(terminal);
    if (!binding) { return; }
    try {
      detachWorkSessionTerminal(binding.sessionId, binding.bindingId, 'Terminal closed by the operator.');
      this.appendTerminalDetachedEvent(binding, 'closed-by-operator');
    } catch (error: unknown) {
      this.log('Could not persist a closed terminal attachment.', unknownErrorMessage(error, 'Terminal detach failed.'));
    }
    this.refreshTerminalFirstViews();
  }

  private refreshTerminalFirstViews(): void {
    this.workTree.refresh();
    this.sessionTree.refresh();
    this.attentionTree.refresh();
    this.refreshTicketPanels();
    this.renderJiraBoardPanel();
    this.renderSetupPanel();
    this.renderDoctorPanel();
  }

  private async runProgress(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>,
  ): Promise<void> {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
    } catch (error: unknown) {
      const detail = unknownErrorMessage(error, `${title} failed.`);
      this.log(title, detail);
      void vscode.window.showErrorMessage(detail);
    }
  }

  private async openLocalArtifact(filePath: string): Promise<void> {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
    await vscode.window.showTextDocument(document, { preview: true });
  }

  private async openHttpUrl(value: string): Promise<void> {
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') { throw new Error('Only HTTP(S) provider URLs are allowed.'); }
      url.username = '';
      url.password = '';
      await vscode.env.openExternal(vscode.Uri.parse(url.toString()));
    } catch (error: unknown) {
      void vscode.window.showWarningMessage(unknownErrorMessage(error, 'Kronos refused an invalid provider URL.'));
    }
  }

  private log(message: string, detail?: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
    if (detail) { this.output.appendLine(detail); }
  }
}

function normalizeTicketKey(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(normalized) ? normalized : undefined;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function safeProjectName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
}

function uniqueProjectDiscoveryRoots(values: readonly string[], limit: number): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const root = typeof value === 'string'
      ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, 4_000)
      : '';
    const key = process.platform === 'win32' ? root.toLocaleLowerCase() : root;
    if (!root || seen.has(key)) { continue; }
    seen.add(key);
    roots.push(root);
    if (roots.length >= limit) { break; }
  }
  return roots;
}

function localProjectPathKey(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase() : value;
}

function boundedIntegerSetting(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function buildClaudeTerminalTitle(baseName: string, ticketKey?: string, branch?: string): string {
  const branchLabel = safeProjectName(branch).slice(0, 500);
  const context = ticketKey
    ? `${ticketKey}${branchLabel ? ` @ ${branchLabel}` : ''}`
    : branchLabel;
  if (!context) { return baseName; }
  const separator = ticketKey ? ' · ' : ' @ ';
  const maximumContextLength = Math.max(1, 80 - separator.length - 1);
  const boundedContext = context.length > maximumContextLength
    ? `${context.slice(0, Math.max(1, maximumContextLength - 1))}…`
    : context;
  const maximumBaseLength = Math.max(1, 80 - separator.length - boundedContext.length);
  return `${baseName.slice(0, maximumBaseLength)}${separator}${boundedContext}`;
}

function jiraComposerEvidence(context: JiraTicketContext): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  const facts = [
    context.status ? `Status: ${context.status}` : '',
    context.priority ? `Priority: ${context.priority}` : '',
    context.assignee ? `Assignee: ${context.assignee}` : '',
    context.updated ? `Updated: ${context.updated}` : '',
  ].filter(Boolean).join(' • ');
  if (facts) { evidence.push({ label: 'Ticket facts', detail: facts }); }
  if (context.description) {
    evidence.push({ label: 'Description', detail: contextComposerPreview(context.description) });
  }
  for (const comment of context.comments.slice(-10).reverse()) {
    const label = [comment.author || 'Jira comment', comment.created || comment.updated || ''].filter(Boolean).join(' • ');
    evidence.push({ label, detail: contextComposerPreview(comment.body) });
  }
  return evidence;
}

function gitLabComposerEvidence(context: GitLabMergeRequestContext): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  const mergeRequest = context.mergeRequest;
  evidence.push({
    label: 'Merge request facts',
    detail: `${mergeRequest.state} • ${mergeRequest.sourceBranch} → ${mergeRequest.targetBranch}${mergeRequest.draft ? ' • draft' : ''}`,
  });
  if (mergeRequest.description) {
    evidence.push({ label: 'Description', detail: contextComposerPreview(mergeRequest.description) });
  }
  const discussionNotes = context.discussions
    .flatMap(discussion => discussion.notes.map(note => ({ note, resolved: discussion.resolved })))
    .slice(-6)
    .reverse();
  for (const { note, resolved } of discussionNotes) {
    const author = note.author?.name || note.author?.username || 'GitLab discussion';
    evidence.push({
      label: `${author}${resolved === false ? ' • unresolved' : resolved === true ? ' • resolved' : ''}${note.createdAt ? ` • ${note.createdAt}` : ''}`,
      detail: contextComposerPreview(note.body),
    });
  }
  for (const note of context.notes.slice(-6).reverse()) {
    const author = note.author?.name || note.author?.username || 'GitLab note';
    evidence.push({
      label: `${author}${note.createdAt ? ` • ${note.createdAt}` : ''}`,
      detail: contextComposerPreview(note.body),
    });
  }
  return evidence.slice(0, 20);
}

function contextComposerPreview(value: string, maxLength = 4_000): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}
