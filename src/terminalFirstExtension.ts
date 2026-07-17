import * as vscode from 'vscode';
import * as os from 'os';
import type { KronosState, ProjectConfig, Ticket } from './state/types';
import { TerminalFirstState, type TerminalFirstRefreshResult } from './state/TerminalFirstState';
import { WorkTreeProvider } from './views/WorkTreeProvider';
import { ManagedSessionTreeProvider } from './views/ManagedSessionTreeProvider';
import { ProjectTreeProvider, type RegisteredProjectCommandTarget } from './views/ProjectTreeProvider';
import { AttentionTreeProvider } from './views/AttentionTreeProvider';
import {
  defaultProviderEnvPath,
  ensureProviderEnvTemplate,
  loadProviderEnv,
  type ProviderEnvLoadResult,
} from './services/providerEnv';
import { boundedOperationFailure } from './services/errorUtils';
import { registerTerminalFirstCommands } from './services/terminalFirstCommandRouter';
import { KRONOS_DIR } from './services/stateStore';
import {
  failedOperationStageOutcome,
  finalizeInsertedContext,
  isOperationStageOutcomeError,
  OperationStageOutcomeError,
  type OperationStageInput,
  type OperationStageOutcome,
} from './services/operationStageOutcome';
import { buildFallbackJiraTicketContext, normalizeJiraTicketContext, type JiraTicketContext } from './services/jiraTicketContext';
import { isJiraRestConfigured, jiraRestClient, type JiraAttachmentContentSnapshot } from './services/jiraRestClient';
import { writeJiraContextArtifacts } from './services/jiraContextStore';
import {
  gitlabRestClient,
  isGitLabRestConfigured,
  normalizeGitLabApiBaseUrl,
} from './services/gitlabRestClient';
import {
  normalizeGitLabMergeRequestContext,
  normalizeGitLabProjectMergeRequestContext,
  type GitLabProviderContext,
} from './services/gitlabMergeRequestContext';
import { writeGitLabContextArtifacts } from './services/gitlabContextStore';
import { isJenkinsRestConfigured, jenkinsRestClient, type JenkinsBuildContext } from './services/jenkinsRestClient';
import { isSonarRestConfigured, sonarDashboardUrl, sonarRestClient, type SonarBranchContext } from './services/sonarRestClient';
import {
  buildCiContext,
  buildProjectCiContext,
  writeCiContextArtifacts,
  type KronosCiProviderContext,
} from './services/ciContextStore';
import {
  buildAttentionEventContextReference,
  buildCiContextReference,
  buildGitLabMergeRequestContextReference,
  buildJiraContextReference,
  buildProjectCiContextReference,
  buildProjectGitContextReference,
  buildPromptLibraryTerminalReference,
  captureTerminalContextPlacement,
  isTerminalContextPlacementCurrent,
  placeEditableTerminalContextReference,
  type TerminalContextAttachment,
  type TerminalContextPlacement,
} from './services/terminalContextInsertion';
import {
  buildAttentionEventPromptContext,
  writeAttentionEventContextArtifacts,
  type AttentionEventPromptContext,
} from './services/attentionEventContextStore';
import { readProjectGitEvidence, renderProjectGitEvidence } from './services/vscodeGitReadService';
import {
  PROJECT_GIT_STATE_ACTIONS,
  buildProjectGitStatePanelHtml,
} from './services/projectGitPresentation';
import { writeProjectGitContextArtifact } from './services/projectGitContextStore';
import {
  createOperatorTerminalRegistry,
  type OperatorTerminalBinding,
  type OperatorTerminalRegistry,
} from './services/operatorTerminalRegistry';
import {
  addWorkSessionProviderBinding,
  addWorkSessionTicketContext,
  attachWorkSessionTerminal,
  closeWorkSession,
  createOrGetWorkSessionByTicket,
  createStandaloneWorkSession,
  detachWorkSessionTerminal,
  getWorkSessionByTicket,
  getWorkSessionForTicketContext,
  listWorkSessionStoreIssues,
  listWorkSessions,
  markWorkSessionTerminalClosed,
  readWorkSession,
  recordWorkSessionContextArtifact,
  removeWorkSession,
  reopenWorkSession,
  setWorkSessionMonitoring,
  setWorkSessionProject,
  type TicketWorkSessionRecord,
  type WorkSessionRecord,
  workSessionEventContext,
  workSessionTicketMetadata,
} from './services/workSessionStore';
import { workSessionLifecycle } from './services/workSessionLifecycle';
import {
  addProjectMonitoringProviderBinding,
  ensureProjectMonitoringRecord,
  readProjectMonitoringRecord,
  readProjectMonitoringRecordById,
} from './services/projectMonitoringStore';
import {
  acknowledgeMonitorEvent,
  appendMonitorEvent,
  listMonitorEvents,
  readMonitorEvent,
} from './services/monitorEventStore';
import { buildWorkSessionAuditMarkdown } from './services/workSessionAuditView';
import {
  ManagedProviderMonitor,
  managedProviderPollNotice,
  type ManagedProviderNotice,
  type ManagedProviderPollResult,
} from './services/managedProviderMonitor';
import { buildTicketWorkspaceHtml, type ProviderPollingViewStatus } from './services/ticketWorkspaceView';
import {
  JIRA_WORK_BOARD_ACTIONS,
  JIRA_WORK_BOARD_SCRIPT,
  buildJiraWorkBoardHtml,
} from './services/jiraWorkBoardView';
import {
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CLAUDE_PERMISSION_MODE,
  DEFAULT_CLAUDE_TERMINAL_NAME,
  buildClaudeTerminalTitle,
  claudePermissionModeLabel,
  launchClaudeTerminal,
  normalizeClaudeTerminalLaunch,
  probeClaudeExecutableAvailability,
  type ClaudePermissionMode,
  type ClaudeTerminalLaunchInput,
  type NormalizedClaudeTerminalLaunch,
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
  normalizeContextBasketMessage,
  normalizeContextComposerMessage,
  normalizeOperationsActionMessage,
  normalizePromptLibraryComposerMessage,
  normalizeProjectIntegrationMessage,
} from './services/webviewMessages';
import {
  addContextBasketItem,
  buildContextBasketReference,
  clearContextBasket,
  contextBasketConflictIds,
  listContextBasketItems,
  removeContextBasketItem,
  writeContextBasketBundle,
  type AddContextBasketItemInput,
  type ContextBasketItem,
} from './services/contextBasketStore';
import { CONTEXT_BASKET_SCRIPT, buildContextBasketHtml } from './services/contextBasketView';
import {
  buildLocalEvidenceSearchIndex,
  type LocalEvidenceSearchEntry,
} from './services/localEvidenceSearch';
import {
  buildHandoffCandidates,
  writeLocalHandoffBundle,
} from './services/handoffBundleStore';
import { isRecord } from './services/records';
import {
  formatProjectBranchProfiles,
  listLocalProjects,
  localProjectPathKey,
  localProjectReferenceKey,
  matchesLocalProject,
  planLocalProjectRegistrations,
  projectConfigurationForTicket,
  readProjectGitBranch,
  registeredLocalProjectForDirectory,
  ticketLocalProject,
  type LocalProjectSummary,
} from './services/projectCatalog';
import { discoverLocalProjects, type DiscoveredProject } from './services/projectDiscovery';
import {
  buildDoctorPanelHtml,
  buildSetupPanelHtml,
  type DoctorCheck,
  type OperationsRuntimeGuide,
  type SetupStep,
} from './services/operationsPanelView';
import {
  buildOperationsReadiness,
  type OperationsReadinessItem,
} from './services/operationsReadiness';
import { providerReadiness } from './services/providerReadiness';
import { currentProviderReadDiagnostics } from './services/providerReadDiagnostics';
import {
  attentionEventCanUsePromptContext,
  attentionEventHeadline,
} from './services/attentionPresentation';
import { WorkRefreshCoordinator } from './services/workRefreshCoordinator';
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
import { readGitLabMergeRequestMonitorSnapshot } from './services/gitlabMergeRequestMonitorStore';
import {
  loadPromptLibraries,
  renderPromptTemplate,
  type PromptLibraryPrompt,
  type PromptLibrarySourceKind,
  type PromptTemplateContext,
} from './services/promptLibrary';
import { writePromptLibraryArtifact } from './services/promptLibraryArtifactStore';
import {
  PROMPT_LIBRARY_SCRIPT,
  buildPromptLibraryComposerHtml,
} from './services/promptLibraryView';
import {
  catalogGitLabBindingCandidate,
  configuredCiPollingTargets,
  configuredGitLabPollingTarget,
  configuredGitLabProjectIdentity,
  configuredSonarBranch,
  configuredSonarBranchName,
  mergeRequestDiscoverySourceBranch,
  reconcileKnownGitLabMergeRequestTarget,
  withEffectiveTicketMergeRequest,
} from './services/providerBindingReconciliation';

const TICKET_WORKSPACE_ACTIONS = new Set([
  'startClaudeForTicket',
  'manageActiveTerminal',
  'focusWorkSessionTerminal',
  'chooseTicketProject',
  'insertJiraContext',
  'insertGitLabContext',
  'insertCiContext',
  'openPromptLibrary',
]);
const JIRA_BOARD_ACTIONS = new Set<string>(JIRA_WORK_BOARD_ACTIONS);
const OPERATIONS_PANEL_ACTIONS = new Set([
  'refreshPanel',
  'openSetup',
  'openDoctor',
  'openSettings',
  'openClaudeSettings',
  'openProviderEnvironment',
  'openPromptLibrarySettings',
  'chooseProjectDiscoveryFolders',
  'openProjectsView',
  'openSessionsView',
  'configureProjectIntegrations',
  'openJiraBoard',
  'pollProvidersNow',
]);
const CLAUDE_LAUNCH_COOLDOWN_MS = 1_000;
const CLAUDE_BYPASS_CONFIRM_ACTION = 'Launch Without Permission Prompts';
const CLAUDE_SETTINGS_ACTION = 'Open Claude Settings';
const PROMPT_LIBRARY_SOURCE_KIND_LABELS: Readonly<Record<PromptLibrarySourceKind, string>> = Object.freeze({
  local: 'Local file',
  remote: 'Remote',
  cache: 'Cached copy',
});

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

interface ClaudeLaunchPlan {
  request: ClaudeTerminalLaunchInput;
  validated: NormalizedClaudeTerminalLaunch;
}

interface ContextComposerPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  placement: TerminalContextPlacement<vscode.Terminal>;
  reference: string;
  promptPath: string;
  onInserted: () => void | OperationStageOutcome | Promise<void | OperationStageOutcome>;
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
  onInserted: () => void | OperationStageOutcome | Promise<void | OperationStageOutcome>;
  basketItem?: AddContextBasketItemInput;
}

interface ContextBasketPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  focus: string;
}

interface PromptLibraryPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  placement: TerminalContextPlacement<vscode.Terminal>;
  selection: TerminalSelection;
  prompt: PromptLibraryPrompt;
  templateContext: PromptTemplateContext;
  warnings: string[];
}

interface ProjectIntegrationPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  projectNames: Set<string>;
}

interface ProjectGitPanelRecord {
  panel: vscode.WebviewPanel;
  nonce: string;
  project: RegisteredProjectCommandTarget;
}

interface TerminalSelection {
  terminal: vscode.Terminal;
  binding: OperatorTerminalBinding;
  workSession?: WorkSessionRecord;
}

interface GitLabInsertionTarget {
  iid: number;
  projectIdOrPath: string;
  url?: string;
}

type RegisteredProjectGitLabDiscovery =
  | { kind: 'matched'; target: GitLabInsertionTarget; sourceBranch?: string }
  | { kind: 'not-found'; sourceBranch?: string }
  | { kind: 'ambiguous'; candidateCount: number; sourceBranch?: string }
  | { kind: 'unconfigured' }
  | { kind: 'failed'; detail: string; sourceBranch?: string };

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
    staleAfterMs: () => this.jiraWorkStaleAfterMs(),
  }, (ticketKey, ticket) => this.effectiveTicket(ticketKey, ticket));
  private readonly sessionTree = new ManagedSessionTreeProvider(
    this.operatorTerminals,
    () => listWorkSessions(),
    () => this.configurationIntervalMs('managedProviderPollIntervalSec', 300),
    projectName => this.state.state?.projects[projectName]?.display_name,
  );
  private readonly projectTree = new ProjectTreeProvider(
    () => this.state.state,
    () => listWorkSessions(),
    () => this.configurationIntervalMs('managedProviderPollIntervalSec', 300),
  );
  private readonly attentionTree = new AttentionTreeProvider({
    loadWorkSessions: () => [
      ...listWorkSessions(),
      ...listLocalProjects(this.state.state)
        .map(project => this.readProjectMonitor(project.name))
        .filter((record): record is NonNullable<typeof record> => Boolean(record)),
    ],
    loadRegisteredProjects: () => listLocalProjects(this.state.state)
      .map(project => ({ name: project.name, path: project.path })),
    loadProjectDisplayName: projectName => this.state.state?.projects[projectName]?.display_name,
  });
  private readonly workRefresh = new WorkRefreshCoordinator<TerminalFirstRefreshResult>(signal => vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Kronos: Reading Jira work metadata...' },
    async () => this.state.refreshTickets({ signal }),
  ));
  private readonly output = vscode.window.createOutputChannel('Kronos Terminal Work Companion');
  private readonly disposables: vscode.Disposable[] = [];
  private readonly ticketPanels = new Map<string, TicketPanelRecord>();
  private readonly ticketPanelActionsInFlight = new Set<string>();
  private readonly operationsPanelActionsInFlight = new Set<string>();
  private readonly contextComposerPanels = new Map<string, ContextComposerPanelRecord>();
  private contextBasketPanel: ContextBasketPanelRecord | undefined;
  private promptLibraryPanel: PromptLibraryPanelRecord | undefined;
  private contextBasketInsertionInFlight = false;
  private readonly claudeLaunchesInFlight = new Set<string>();
  private readonly claudeLaunchCooldownUntil = new Map<string, number>();
  private jiraBoardPanel: JiraBoardPanelRecord | undefined;
  private setupPanel: OperationsPanelRecord | undefined;
  private doctorPanel: OperationsPanelRecord | undefined;
  private projectIntegrationPanel: ProjectIntegrationPanelRecord | undefined;
  private projectGitPanel: ProjectGitPanelRecord | undefined;
  private readonly monitor: ManagedProviderMonitor;
  private refreshTimer: NodeJS.Timeout | undefined;
  private providerTimer: NodeJS.Timeout | undefined;
  private providerEnvironmentLoad: ProviderEnvLoadResult | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.loadProviderEnvironment();
    this.monitor = new ManagedProviderMonitor({
      state: () => this.state.state,
      log: (message, detail) => this.log(message, detail),
      notify: notice => this.showProviderNotice(notice),
      refresh: () => this.refreshTerminalFirstViews(),
      projectTicketProviderState: (ticketKey, input) => this.state.projectTicketProviderState(ticketKey, input),
      updateProjectSonarTarget: (projectName, projectKey, branch) =>
        this.state.setLocalProjectSonarTarget(projectName, projectKey, branch),
    });

    this.disposables.push(
      vscode.window.registerTreeDataProvider('kronosWork', this.workTree),
      vscode.window.registerTreeDataProvider('kronosSessions', this.sessionTree),
      vscode.window.registerTreeDataProvider('kronosProjects', this.projectTree),
      vscode.window.registerTreeDataProvider('kronosAttention', this.attentionTree),
      this.state.onDidChange(() => {
        this.workTree.refresh();
        this.projectTree.refresh();
        this.refreshTicketPanels();
        this.renderJiraBoardPanel();
        this.renderOperationsPanels();
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
          this.renderOperationsPanels();
        }
      }),
    );
    this.registerCommands();
    this.startTimers();
    void this.pollProviders(false);
    this.log('Kronos terminal-first runtime activated.', 'No agent, terminal, project command, or Git mutation was started automatically.');
  }

  dispose(): void {
    if (this.refreshTimer) { clearInterval(this.refreshTimer); }
    if (this.providerTimer) { clearInterval(this.providerTimer); }
    this.monitor.dispose();
    this.workRefresh.dispose();
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
    this.contextBasketPanel?.panel.dispose();
    this.contextBasketPanel = undefined;
    this.promptLibraryPanel?.panel.dispose();
    this.promptLibraryPanel = undefined;
    this.projectIntegrationPanel?.panel.dispose();
    this.projectIntegrationPanel = undefined;
    this.projectGitPanel?.panel.dispose();
    this.projectGitPanel = undefined;
    for (const disposable of this.disposables.splice(0)) { disposable.dispose(); }
    this.operatorTerminals.clear();
    this.workTree.dispose();
    this.sessionTree.dispose();
    this.projectTree.dispose();
    this.attentionTree.dispose();
    this.state.dispose();
    this.output.dispose();
  }

  private registerCommands(): void {
    this.disposables.push(...registerTerminalFirstCommands({
      work: {
        refreshTickets: async () => this.refreshTickets(true),
        openJiraBoard: async () => this.openJiraBoard(),
        filterWork: async () => this.configureWorkFilter(),
        clearWorkFilter: () => this.workTree.clearFilter(),
        openTicketWorkspace: async argument => this.openTicketWorkspace(argument),
        chooseTicketProject: async argument => this.chooseTicketProject(argument),
      },
      terminals: {
        newClaudeSession: async argument => this.newClaudeSession(argument),
        startClaudeForTicket: async argument => this.startClaudeForTicket(argument),
        manageActiveTerminal: async argument => this.manageFocusedTerminal(argument),
      },
      context: {
        insertJiraContext: async argument => this.insertJiraContext(argument),
        insertOtherTicket: async argument => this.insertOtherTicket(argument),
        insertGitLabContext: async argument => this.insertGitLabContext(argument),
        insertCiContext: async argument => this.insertCiContext(argument),
        openContextBasket: async () => this.openContextBasket(),
        openPromptLibrary: async argument => this.openPromptLibrary(argument),
        searchLocalEvidence: async () => this.searchLocalEvidence(),
        createLocalHandoff: async argument => this.createLocalHandoff(argument),
      },
      sessions: {
        pollManagedWorkSessions: async () => this.pollProviders(true),
        openWorkSessionAudit: async argument => this.openWorkSessionAudit(argument),
        focusWorkSessionTerminal: async argument => this.focusWorkSessionTerminal(argument),
        reattachWorkSessionTerminal: async argument => this.reattachFocusedTerminal(argument),
        detachWorkSessionTerminal: async argument => this.detachManagedTerminal(argument),
        closeWorkSession: async argument => this.stopManagingSession(argument),
        removeWorkSession: async argument => this.removeManagedSession(argument),
        pauseWorkSessionMonitoring: async argument => this.setMonitoring(argument, false),
        resumeWorkSessionMonitoring: async argument => this.setMonitoring(argument, true),
      },
      projects: {
        configureProjectDiscoveryFolders: async () => this.configureProjectDiscoveryFolders(),
        registerWorkspaceProject: async () => this.registerWorkspaceProject(),
        refreshProjects: () => this.projectTree.refresh(),
        renameLocalProject: async argument => this.renameLocalProject(argument),
        openProjectGitStatus: async argument => this.openProjectGitStatus(argument),
        insertProjectGitContext: async argument => this.insertProjectGitContext(argument),
        openProjectMergeRequest: async argument => this.openProjectMergeRequest(argument),
        insertProjectGitLabContext: async argument => this.insertProjectProviderContext(argument, 'gitlab'),
        insertProjectCiContext: async argument => this.insertProjectProviderContext(argument, 'ci'),
        configureProjectIntegrations: async argument => this.configureProjectIntegrations(argument),
      },
      attention: {
        insertAttentionEventContext: async argument => this.insertAttentionEventContext(argument),
        acknowledgeAttention: async argument => this.acknowledgeAttention(argument),
        openProvider: async argument => this.openProvider(argument),
      },
      operations: {
        setup: async () => this.openSetup(),
        doctor: async () => this.openDoctor(),
        settings: async () => this.openSetup(),
      },
    }, (id, handler) => vscode.commands.registerCommand(id, handler)));
  }

  private loadProviderEnvironment(): void {
    const result = loadProviderEnv();
    this.providerEnvironmentLoad = result;
    if (result.error) {
      this.log('Could not load the local provider environment.', result.error);
      void vscode.window.showWarningMessage('Kronos could not load its provider environment file. Provider reads may be unavailable; run Kronos: Check Setup.');
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

  private jiraWorkStaleAfterMs(): number {
    return Math.max(5 * 60_000, this.configurationIntervalMs('refreshIntervalSec', 300) * 2);
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

  private promptLibrarySettings(): { localPaths: string[]; remoteUrls: string[] } {
    return {
      localPaths: this.configurationStringArray('promptLibraryLocalPaths', 20, 4_000),
      remoteUrls: this.configurationStringArray('promptLibraryRemoteManifestUrls', 10, 4_000),
    };
  }

  private async configureWorkFilter(): Promise<void> {
    const current = this.workTree.getFilter();
    const options = this.workTree.getFilterOptions();
    const workState = current.jiraStatus
      ? `Status: ${current.jiraStatus}`
      : workCompletionLabel(current.completion || this.workTree.defaultCompletion());
    const selection = await vscode.window.showQuickPick([
      { label: '$(search) Search', description: current.query || 'Any text', id: 'query' },
      { label: '$(issue-opened) Work state', description: workState, id: 'completion' },
      { label: '$(list-filter) Jira status', description: current.jiraStatus || 'Any active status', id: 'status' },
      { label: '$(issues) Jira project', description: current.jiraProject || 'All Jira projects', id: 'jiraProject' },
      { label: '$(repo) Local project', description: current.localProject || 'All local projects', id: 'localProject' },
      { label: '$(tag) Label', description: current.label || 'All labels', id: 'label' },
      { label: '$(clear-all) Clear all filters', description: 'Show the default Work view', id: 'clear' },
    ], { title: 'Filter Work', placeHolder: 'Choose what to filter' });
    if (!selection) { return; }
    if (selection.id === 'clear') {
      this.workTree.clearFilter();
      return;
    }
    if (selection.id === 'query') {
      const query = await vscode.window.showInputBox({
        title: 'Search Work',
        prompt: 'Match ticket keys, summaries, statuses, labels, projects, merge requests, and builds',
        value: current.query || '',
      });
      if (query !== undefined) { this.workTree.setFilter({ ...current, query }); }
      return;
    }
    if (selection.id === 'completion') {
      const completion = await vscode.window.showQuickPick([
        { label: 'Active', description: 'Hide completed tickets', value: 'active' as const },
        { label: 'Completed', description: 'Show only completed tickets', value: 'completed' as const },
        { label: 'All', description: 'Show active and completed tickets', value: 'all' as const },
      ], { title: 'Choose Work State' });
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
      : selection.id === 'jiraProject'
        ? await vscode.window.showQuickPick([
          { label: 'All Jira projects', value: '' },
          ...options.jiraProjects.map(value => ({ label: value, value })),
        ], { title: 'Filter by Jira project' })
        : await vscode.window.showQuickPick([
          { label: 'All local projects', value: '' },
          ...options.localProjects.map(value => ({ label: value, value })),
        ], { title: 'Filter by local project' });
    if (facet) {
      const next = { ...current };
      if (selection.id === 'label') {
        if (facet.value) { next.label = facet.value; }
        else { delete next.label; }
      } else if (selection.id === 'jiraProject') {
        if (facet.value) { next.jiraProject = facet.value; }
        else { delete next.jiraProject; }
      } else if (facet.value) { next.localProject = facet.value; }
      else { delete next.localProject; }
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
        name: registered.displayName,
        path: registered.path,
        source: 'configured-root',
        ...(registered.branch ? { branch: registered.branch } : {}),
      };
      return {
        label: registered.displayName,
        description: `Registered • ${registered.branch || (registered.available ? 'Branch unavailable' : 'Folder unavailable')}`,
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
        description: `Available • ${project.branch || 'Branch unavailable'} • ${project.source === 'workspace' ? 'Open workspace' : 'Project folder'}`,
        detail: project.path,
        picked: false,
        registered: false,
        project,
      }));
    const choices = [...registeredChoices, ...discoveredChoices];
    const selected = await vscode.window.showQuickPick(choices, {
      title: 'Manage Projects',
      placeHolder: discovery.truncated
        ? 'Project limit reached. Select projects to keep; clear a checked project to remove it'
        : 'Select projects to keep; clear a checked project to remove it',
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (selected === undefined) { return; }
    const selectedPathKeys = new Set(selected.map(item => localProjectPathKey(item.project.path)));
    const removedProjects = registeredProjects.filter(project => !selectedPathKeys.has(localProjectPathKey(project.path)));
    const removedNames = new Set(removedProjects.map(project => project.name));
    const linkedTicketKeys = Object.entries(this.state.state?.tickets || {})
      .filter(([, ticket]) => Boolean(ticket.linked_local_project && removedNames.has(ticket.linked_local_project)))
      .map(([ticketKey]) => ticketKey);
    if (linkedTicketKeys.length > 0) {
      const action = await vscode.window.showWarningMessage(
        `Unregistering ${removedProjects.map(project => project.displayName).join(', ')} will unlink ${linkedTicketKeys.length} ticket${linkedTicketKeys.length === 1 ? '' : 's'} (${linkedTicketKeys.slice(0, 5).join(', ')}${linkedTicketKeys.length > 5 ? ', …' : ''}).`,
        { modal: true },
        'Unregister and Unlink',
      );
      if (action !== 'Unregister and Unlink') { return; }
    }
    const registrations = this.projectRegistrations(selected.map(item => item.project));
    const newlyRegistered = registrations.filter(project => !registeredPathKeys.has(localProjectPathKey(project.path)));
    this.state.replaceRegisteredLocalProjects(registrations);
    for (const ticketKey of linkedTicketKeys) {
      const session = getWorkSessionForTicketContext(ticketKey);
      if (session) { setWorkSessionProject(session.id, {}); }
    }
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(
      `${registrations.length} local project${registrations.length === 1 ? ' is' : 's are'} registered; ${removedProjects.length} unregistered${linkedTicketKeys.length > 0 ? ` and unlinked from ${linkedTicketKeys.length} ticket${linkedTicketKeys.length === 1 ? '' : 's'}` : ''}${discovery.truncated ? ' from the current results' : ''}.`,
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
      title: 'Choose Project Folders',
      openLabel: 'Add Folders',
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
      const detail = boundedOperationFailure(error, 'Kronos could not save the selected discovery folders.').display;
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
    return planLocalProjectRegistrations(
      this.state.state || { schemaVersion: 2, refreshedAt: null, projects: {}, tickets: {} },
      projects,
    );
  }

  private openProjectIntegrationSetup(projectNames?: readonly string[]): void {
    const localProjects = listLocalProjects(this.state.state);
    const requested = projectNames ? new Set(projectNames) : undefined;
    const selectedProjects = requested
      ? localProjects.filter(project => requested.has(project.name))
      : localProjects;
    if (selectedProjects.length === 0) {
      void vscode.window.showWarningMessage('Register at least one project before configuring integrations.');
      return;
    }
    this.projectIntegrationPanel?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      'kronosProjectIntegrationSetup',
      'Kronos — Project integrations',
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
        void this.pollProviders(false);
        panel.dispose();
        void vscode.window.showInformationMessage(
          `Saved the name and integrations for ${message.projects.length} project${message.projects.length === 1 ? '' : 's'}. Check setup to verify provider access.`,
        );
      } catch (error: unknown) {
        const detail = boundedOperationFailure(error, 'Project integration setup could not be saved.').display;
        this.log('Project integration setup could not be saved.', detail);
        void vscode.window.showErrorMessage(detail);
      }
    });
    const projects: ProjectIntegrationFormProject[] = selectedProjects.map(project => {
      const storedProject = this.state.state?.projects[project.name];
      const config = storedProject?.config || {};
      const suggestedSonarKey = config.sonar_project_key || sonarProjectKeySuggestion(config.repo_name, project.name);
      return {
        name: project.name,
        displayName: project.displayName,
        ...((storedProject?.display_name && storedProject.display_name !== project.name)
          ? { nickname: storedProject.display_name }
          : {}),
        path: project.path,
        ...(project.branch ? { branch: project.branch } : {}),
        ...((config.gitlab_project_id || config.gitlab_project_path)
          ? { gitlabProject: String(config.gitlab_project_id || config.gitlab_project_path) }
          : {}),
        ...(config.jenkins_url ? { jenkinsUrl: config.jenkins_url } : {}),
        ...(suggestedSonarKey ? { sonarProjectKey: suggestedSonarKey } : {}),
        ...((config.default_branch || config.base_branch)
          ? { defaultBranch: config.default_branch || config.base_branch }
          : {}),
        ...(config.branch_profiles ? { branchProfiles: formatProjectBranchProfiles(config.branch_profiles) } : {}),
        ...(config.active_branch_profile ? { activeBranchProfile: config.active_branch_profile } : {}),
      };
    });
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', PROJECT_INTEGRATION_SCRIPT),
    ).toString();
    const readiness = providerReadiness();
    panel.webview.html = withWebviewCsp(buildProjectIntegrationPanelHtml({
      projects,
      providerReadiness: [
        {
          name: 'GitLab credentials',
          ready: readiness.gitlab.configured,
          detail: readiness.gitlab.detail,
        },
        {
          name: 'Jenkins access',
          ready: readiness.jenkins.configured,
          detail: readiness.jenkins.detail,
        },
        {
          name: 'SonarQube credentials',
          ready: readiness.sonar.configured,
          detail: readiness.sonar.detail,
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
        'No local project is registered. Use the Projects view to discover, register, or remove local repositories.',
        'Open Projects',
      );
      if (action === 'Open Projects') { await vscode.commands.executeCommand('kronosProjects.focus'); }
      return;
    }
    const current = ticketLocalProject(this.state.state, ticket);
    const projectChoices: Array<vscode.QuickPickItem & { project?: LocalProjectSummary; unlink?: true }> = projects
      .sort((left, right) => Number(current?.name === right.name) - Number(current?.name === left.name)
        || left.displayName.localeCompare(right.displayName))
      .map(project => ({
      label: `${project.displayName}${current?.name === project.name ? ' $(check)' : ''}`,
      description: project.branch || (project.available ? 'Git branch unavailable' : 'folder unavailable'),
      detail: project.path,
      project,
    }));
    const choices: Array<vscode.QuickPickItem & { project?: LocalProjectSummary; unlink?: true }> = current
      ? [projectChoices[0], {
        label: '$(close) Unlink local project',
        description: 'Future ticket launches fall back to the open workspace',
        unlink: true,
      }, ...projectChoices.slice(1)].filter((item): item is vscode.QuickPickItem & { project?: LocalProjectSummary; unlink?: true } => Boolean(item))
      : projectChoices;
    const choice = await vscode.window.showQuickPick(choices, {
      title: `${ticketKey}: ${current ? 'Change project' : 'Choose project'}`,
      placeHolder: 'New Claude sessions start here. Existing terminals do not move.',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!choice) { return; }
    this.state.setTicketLocalProject(ticketKey, choice.unlink ? undefined : choice.project?.name);
    const selected = choice.unlink ? undefined : choice.project;
    const existingSession = getWorkSessionForTicketContext(ticketKey);
    if (existingSession) {
      let updated = setWorkSessionProject(existingSession.id, selected
        ? { projectName: selected.name, projectPath: selected.path }
        : {});
      if (updated.kind === 'ticket') { updated = this.ensureProviderBindings(updated, ticket); }
    }
    this.refreshTerminalFirstViews();
    void this.pollProviders(false);
    void vscode.window.showInformationMessage(selected
      ? `${ticketKey} will launch Claude in ${selected.path}${selected.branch ? ` on ${selected.branch}` : ''}. Existing terminals were not changed.`
      : `${ticketKey} local project unlinked. Existing terminals were not changed.`);
  }

  private async refreshTickets(showResult: boolean): Promise<void> {
    try {
      const refresh = await this.workRefresh.run(showResult);
      if (refresh.kind !== 'complete') { return; }
      const result = refresh.value;
      if (result.warnings.length > 0) {
        this.log('Jira Work refresh completed with bounded-read warnings.', result.warnings.join(' '));
      }
      if (showResult) {
        const retained = result.retainedFromPrevious > 0
          ? ` ${result.retainedFromPrevious} earlier ticket${result.retainedFromPrevious === 1 ? ' remains' : 's remain'} visible because the refresh was incomplete.`
          : '';
        const message = `Kronos refreshed ${result.ticketCount} Jira ticket${result.ticketCount === 1 ? '' : 's'} across ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}.${retained}`;
        if (result.complete && result.warnings.length === 0) { void vscode.window.showInformationMessage(message); }
        else { void vscode.window.showWarningMessage(`${message} Check setup for details.`); }
      }
      void this.pollProviders(false);
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Jira ticket refresh failed.').display;
      this.log('Jira ticket refresh failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(detail); }
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
      if (message?.command === 'refreshTickets') {
        await this.refreshTickets(true);
        this.renderJiraBoardPanel();
        return;
      }
      if (message?.command === 'openDoctor') {
        await this.openDoctor();
        return;
      }
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
        state: this.effectiveState(),
        refreshStatus: this.state.jiraRefreshStatus,
        loadIssueCount: this.state.loadIssues.length,
        staleAfterMs: this.jiraWorkStaleAfterMs(),
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
      `${ticketKey} — Ticket`,
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
      const detail = boundedOperationFailure(error, `${ticketKey} action failed.`).display;
      this.log(`${ticketKey} ${action} failed.`, detail);
      void vscode.window.showErrorMessage(detail);
    } finally {
      this.ticketPanelActionsInFlight.delete(requestKey);
    }
  }

  private renderTicketPanel(ticketKey: string, record: TicketPanelRecord): void {
    const storedTicket = this.state.state?.tickets[ticketKey];
    const ticket = storedTicket ? this.effectiveTicket(ticketKey, storedTicket) : undefined;
    if (!ticket) {
      record.panel.webview.html = '<!DOCTYPE html><html><body><p>This ticket is no longer present in the local Work state.</p></body></html>';
      return;
    }
    const session = getWorkSessionForTicketContext(ticketKey);
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
      providerPolling: this.providerPollingViewStatus(ticketKey, ticket, session),
    });
    record.panel.webview.html = withWebviewCsp(
      html,
      webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce),
    );
  }

  private refreshTicketPanels(): void {
    for (const [ticketKey, record] of this.ticketPanels) { this.renderTicketPanel(ticketKey, record); }
  }

  private effectiveState(): KronosState | null {
    const state = this.state.state;
    if (!state) { return null; }
    const tickets = Object.fromEntries(Object.entries(state.tickets)
      .map(([ticketKey, ticket]) => [ticketKey, this.effectiveTicket(ticketKey, ticket)]));
    return { ...state, tickets };
  }

  private effectiveTicket(ticketKey: string, ticket: Ticket): Ticket {
    const session = getWorkSessionForTicketContext(ticketKey);
    if (!session) { return ticket; }
    try {
      return withEffectiveTicketMergeRequest(
        ticket,
        session,
        readGitLabMergeRequestMonitorSnapshot(session.id),
      );
    } catch (error: unknown) {
      this.log(
        `Could not project the locally monitored merge request for ${ticketKey}.`,
        boundedOperationFailure(error, 'The local merge-request snapshot is invalid.').display,
      );
      return withEffectiveTicketMergeRequest(ticket, session, null);
    }
  }

  private providerPollingViewStatus(
    ticketKey: string,
    ticket: Ticket,
    session: WorkSessionRecord | null,
  ): ProviderPollingViewStatus[] {
    const config = this.projectConfig(ticket) || {};
    const monitoringSession = session?.ticketKeys.includes(ticketKey)
      ? { ...session, ticketKey }
      : null;
    const projectMonitor = ticket.linked_local_project
      ? this.readProjectMonitor(ticket.linked_local_project)
      : null;
    const monitoringOwner = projectMonitor || monitoringSession;
    const polling = projectMonitor
      ? projectMonitor.status === 'active' && projectMonitor.monitoring.enabled
      : monitoringSession
        ? workSessionLifecycle(
        monitoringSession,
        this.operatorTerminals.listBindings(monitoringSession.id).length,
      ).canPollProviders
      : false;
    const gitLabTarget = monitoringOwner ? configuredGitLabPollingTarget(this.state.state, monitoringOwner) : null;
    const gitLabConfigured = Boolean(gitLabTarget || config.gitlab_project_id || config.gitlab_project_path);
    const gitLab: ProviderPollingViewStatus = !gitLabConfigured
      ? { provider: 'GitLab', state: 'setup', detail: 'Add the project ID or group/project path.' }
      : !isGitLabRestConfigured()
        ? { provider: 'GitLab', state: 'setup', detail: 'Project linked; check setup for credentials.' }
        : !polling
          ? { provider: 'GitLab', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' }
          : gitLabTarget
            ? { provider: 'GitLab', state: 'active', detail: `Checking merge request !${gitLabTarget.iid}, reviews, pipeline, jobs, and tests.` }
            : { provider: 'GitLab', state: 'discovering', detail: 'Provider checks are active and looking for an open merge request by branch or ticket key.' };

    const ciTargets = monitoringOwner ? configuredCiPollingTargets(this.state.state, monitoringOwner) : {};
    const jenkinsConfigured = Boolean(ciTargets.jenkinsUrl || ticket.build?.url || config.jenkins_url);
    const jenkins: ProviderPollingViewStatus = !jenkinsConfigured
      ? { provider: 'Jenkins', state: 'setup', detail: 'Add the project Jenkins job URL.' }
      : !isJenkinsRestConfigured()
        ? { provider: 'Jenkins', state: 'setup', detail: 'Job linked; check setup for credentials.' }
        : polling
          ? { provider: 'Jenkins', state: 'active', detail: 'Checking the configured job, stages, and tests.' }
          : { provider: 'Jenkins', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' };

    const sonarTarget = ciTargets.sonar || configuredSonarBranch(this.state.state, ticketKey);
    const sonarConfigured = Boolean(sonarTarget || config.sonar_project_key);
    const sonar: ProviderPollingViewStatus = !sonarConfigured
      ? { provider: 'SonarQube', state: 'setup', detail: 'Add the SonarQube project key.' }
      : !sonarTarget
        ? { provider: 'SonarQube', state: 'setup', detail: 'Add or discover the branch used for SonarQube checks.' }
        : !isSonarRestConfigured()
          ? { provider: 'SonarQube', state: 'setup', detail: 'Project linked; check setup for credentials.' }
          : polling
            ? { provider: 'SonarQube', state: 'active', detail: `Checking ${sonarTarget.projectKey} on ${sonarTarget.branch}.` }
            : { provider: 'SonarQube', state: 'paused', detail: 'Automatic checks start as soon as the registered project setup is saved.' };
    return [gitLab, jenkins, sonar];
  }

  private readProjectMonitor(projectName: string): WorkSessionRecord | null {
    try { return readProjectMonitoringRecord(projectName); }
    catch (error: unknown) {
      this.log(
        `Could not read provider monitoring state for ${projectName}.`,
        boundedOperationFailure(error, 'Project monitoring state is unavailable.').display,
      );
      return null;
    }
  }

  private readProjectMonitorById(recordId: string): WorkSessionRecord | null {
    try { return readProjectMonitoringRecordById(recordId); }
    catch (error: unknown) {
      this.log(
        'Could not read the selected project monitoring state.',
        boundedOperationFailure(error, 'Project monitoring state is unavailable.').display,
      );
      return null;
    }
  }

  private async manageFocusedTerminal(argument: unknown): Promise<void> {
    const terminal = vscode.window.activeTerminal;
    if (!terminal) {
      void vscode.window.showWarningMessage('Focus the terminal you want to connect, then try again.');
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
          void vscode.window.showInformationMessage(`${terminal.name} is already connected to ${workSessionEventContext(session).label}.`);
          return;
        }
      }
      const title = await vscode.window.showInputBox({
        title: 'Connect Focused Terminal',
        prompt: 'Name this session. No Jira ticket will be attached.',
        value: terminal.name || 'Terminal session',
        validateInput: value => value.trim() ? undefined : 'Enter a session name.',
      });
      if (!title?.trim()) { return; }
      const project = this.standaloneProjectDetails(this.terminalWorkingDirectory(terminal));
      const session = createStandaloneWorkSession({ title: title.trim(), ...project });
      await this.attachTerminal(session, terminal);
      this.refreshTerminalFirstViews();
      void vscode.window.showInformationMessage(
        `${terminal.name} is now connected as ${title.trim()}. No Jira ticket was added and terminal contents were not read.`,
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
      `${terminal.name} is now connected to ${ticketKey}. Kronos did not start, read, or control the terminal.`,
    );
  }

  private async newClaudeSession(argument?: unknown): Promise<void> {
    if (!this.canLaunchClaude()) { return; }
    const requestedProject = projectTargetStringProperty(argument, 'projectName')
      || projectTargetStringProperty(argument, 'projectPath');
    const project = requestedProject ? this.resolveRegisteredProject(argument) : undefined;
    if (requestedProject && !project) { return; }
    const workspaceName = vscode.workspace.name?.trim();
    const launchedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const projectLabel = project?.displayName || project?.projectName;
    const title = projectLabel
      ? `${projectLabel} Claude · ${launchedAt}`
      : workspaceName
        ? `${workspaceName} Claude · ${launchedAt}`
        : `Claude session · ${launchedAt}`;
    await this.launchClaudeSession(project ? { title, project } : { title });
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

  private async launchClaudeSession(input: {
    title: string;
    ticketKey?: string;
    ticket?: Ticket;
    project?: RegisteredProjectCommandTarget;
  }): Promise<void> {
    const launchKey = input.ticketKey
      ? `ticket:${input.ticketKey}`
      : input.project ? `project:${input.project.projectName}:${input.project.projectPath}` : 'standalone';
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
    let applyLaunchCooldown = false;
    let session: WorkSessionRecord | undefined;
    try {
      const launch = this.claudeLaunchPlan(input.ticketKey, input.ticket, input.project);
      if (!await this.confirmClaudePermissionMode(launch.validated.permissionMode)) { return; }
      applyLaunchCooldown = true;
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
        const projectDetails = input.project
          ? { projectName: input.project.projectName, projectPath: input.project.projectPath }
          : this.standaloneProjectDetails(launch.validated.cwd);
        session = createStandaloneWorkSession({ title: input.title, ...projectDetails });
        closeSessionIfNotSubmitted = true;
      }
      const launched = launchClaudeTerminal(vscode.window, launch.request);
      commandSubmitted = true;
      session = await this.attachTerminal(session, launched.terminal);
      const eventContext = workSessionEventContext(session);
      const permissionMode = launched.configuration.permissionMode;
      const permissionSummary = ` with ${claudePermissionModeLabel(permissionMode)} permission mode`;
      appendMonitorEvent({
        sessionId: session.id,
        type: 'decision.recorded',
        source: 'operator',
        summary: `${eventContext.label} Claude command submitted${permissionSummary} in a focused terminal by explicit operator action.`,
        subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
        metadata: {
          explicitLaunch: true,
          commandSubmitted: true,
          terminalName: launched.configuration.name,
          claudePermissionMode: permissionMode,
          experimentalPermissionBypass: permissionMode === 'bypassPermissions',
        },
      });
      this.refreshTerminalFirstViews();
      const submittedPrefix = permissionMode === 'bypassPermissions'
        ? 'Submitted Claude with experimental permission bypass'
        : 'Submitted Claude';
      void vscode.window.showInformationMessage(
        input.ticketKey
          ? `${submittedPrefix} for ${input.ticketKey}. When Claude is ready, choose Review Jira Ticket.`
          : input.project
            ? `${submittedPrefix} in ${input.project.displayName || input.project.projectName}. No Jira ticket was attached.`
            : `${submittedPrefix} as a standalone command in a focused terminal. No Jira ticket was attached.`,
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
          this.log('Could not close the failed pre-submission work session.', boundedOperationFailure(compensationError, 'Session compensation failed.').display);
        }
      }
      const detail = boundedOperationFailure(error, commandSubmitted
        ? 'The Claude command was submitted, but Kronos could not attach its session.'
        : 'Claude terminal launch failed.').display;
      this.log(commandSubmitted ? 'Claude command submitted but session attachment failed.' : 'Claude terminal launch failed.', detail);
      void vscode.window.showErrorMessage(
        commandSubmitted
          ? `The Claude command was submitted, but Kronos could not finish attaching the session: ${detail}`
          : `${detail} Run Kronos: Setup or Kronos: Check Setup to review launch settings.`,
      );
    } finally {
      this.claudeLaunchesInFlight.delete(launchKey);
      if (applyLaunchCooldown) {
        this.claudeLaunchCooldownUntil.set(launchKey, Date.now() + CLAUDE_LAUNCH_COOLDOWN_MS);
      } else {
        this.claudeLaunchCooldownUntil.delete(launchKey);
      }
    }
  }

  private async confirmClaudePermissionMode(mode: ClaudePermissionMode): Promise<boolean> {
    if (mode !== 'bypassPermissions') { return true; }
    const choice = await vscode.window.showWarningMessage(
      'Kronos is configured to start Claude with experimental permission bypass.',
      {
        modal: true,
        detail: 'Claude will skip its normal permission prompts and may edit files or run commands without asking. Use this only in an isolated environment you control. Kronos cannot inspect or stop the resulting terminal session.',
      },
      CLAUDE_BYPASS_CONFIRM_ACTION,
      CLAUDE_SETTINGS_ACTION,
    );
    if (choice === CLAUDE_SETTINGS_ACTION) {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos claude');
      return false;
    }
    return choice === CLAUDE_BYPASS_CONFIRM_ACTION;
  }

  private claudeLaunchPlan(
    ticketKey?: string,
    ticket?: Ticket,
    project?: RegisteredProjectCommandTarget,
  ): ClaudeLaunchPlan {
    const configuration = vscode.workspace.getConfiguration('kronos');
    const command = configuration.get<string>('claudeCommand', DEFAULT_CLAUDE_COMMAND);
    const permissionMode = configuration.get<string>('claudePermissionMode', DEFAULT_CLAUDE_PERMISSION_MODE);
    const configuredName = configuration.get<string>('claudeTerminalName', DEFAULT_CLAUDE_TERMINAL_NAME);
    const mode = configuration.get<string>('claudeLaunchCwd', 'ticketProject');
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const ticketProjectPath = ticketLocalProject(this.state.state, ticket)?.path;
    const cwd = project?.projectPath || (mode === 'home'
      ? os.homedir()
      : mode === 'workspace'
        ? workspacePath || os.homedir()
        : ticketProjectPath || workspacePath || os.homedir());
    const branch = readProjectGitBranch(cwd)?.branch;
    const name = buildClaudeTerminalTitle(configuredName, ticketKey, branch);
    const request: ClaudeTerminalLaunchInput = { command, name, cwd, permissionMode };
    return { request, validated: normalizeClaudeTerminalLaunch(request) };
  }

  private standaloneProjectDetails(cwd?: string): { projectName?: string; projectPath?: string } {
    const workspace = vscode.workspace.workspaceFolders?.[0];
    const details: { projectName?: string; projectPath?: string } = {};
    const workspacePath = workspace?.uri.fsPath;
    const projectPath = cwd || workspacePath;
    const registeredProject = projectPath
      ? registeredLocalProjectForDirectory(this.state.state, projectPath)
      : undefined;
    if (registeredProject) {
      return { projectName: registeredProject.name, projectPath: registeredProject.path };
    }
    if (workspace?.name && (!cwd || localProjectPathKey(cwd) === localProjectPathKey(workspacePath || ''))) {
      details.projectName = workspace.name;
    }
    if (projectPath) { details.projectPath = projectPath; }
    return details;
  }

  private terminalWorkingDirectory(terminal: vscode.Terminal): string | undefined {
    // shellIntegration was added after the declared VS Code 1.85 minimum.
    // Read it opportunistically on newer editors without making it a required API.
    return (terminal as vscode.Terminal & {
      readonly shellIntegration?: { readonly cwd?: vscode.Uri };
    }).shellIntegration?.cwd?.fsPath;
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
    const cwd = this.terminalWorkingDirectory(terminal);
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
    if (updated.monitoring.enabled && updated.ticketKeys.length > 0) { void this.pollProviders(false); }
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
    const catalogMergeRequest = catalogGitLabBindingCandidate(ticket, updated, config);
    if (catalogMergeRequest) {
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, catalogMergeRequest));
    }
    if (config?.jenkins_url) {
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, {
        id: 'jenkins-job',
        provider: 'jenkins',
        resource: 'job',
        subjectId: 'configured',
        url: config.jenkins_url,
      }));
    }
    if (ticket.build?.url) {
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, {
        provider: 'jenkins',
        resource: 'build',
        subjectId: String(ticket.build.number),
        url: ticket.build.url,
      }));
    }
    const sonarTarget = configuredSonarBranch(this.state.state, session.ticketKey);
    if (sonarTarget) {
      const dashboardUrl = sonarDashboardUrl(sonarTarget.projectKey, sonarTarget.branch);
      updated = this.requireTicketSession(addWorkSessionProviderBinding(updated.id, {
        provider: 'sonar',
        resource: 'quality-gate',
        subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
        projectId: sonarTarget.projectKey,
        ...(dashboardUrl ? { url: dashboardUrl } : {}),
      }));
    }
    return updated;
  }

  private requireTicketSession(session: WorkSessionRecord): TicketWorkSessionRecord {
    if (session.kind !== 'ticket') { throw new Error('Expected a ticket-linked work session.'); }
    return session;
  }

  private openContextComposer(request: ContextComposerRequest): void {
    const placement = captureTerminalContextPlacement({
      terminal: request.selection.terminal,
      sessionId: request.selection.binding.sessionId,
      bindingId: request.selection.binding.bindingId,
    });
    if (!isTerminalContextPlacementCurrent(placement, this.currentTerminalContextAttachment(placement))) {
      void vscode.window.showWarningMessage(
        'The connected terminal changed while context was loading. Reopen the action from the intended ticket or Session.',
      );
      return;
    }
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
      placement,
      reference: request.reference,
      promptPath: request.promptPath,
      onInserted: request.onInserted,
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
      if (message.command === 'addToBasket') {
        if (!request.basketItem) {
          void vscode.window.showWarningMessage('This context source cannot be added to the basket.');
          return;
        }
        try {
          const item = addContextBasketItem(request.basketItem);
          this.renderContextBasketPanel();
          const choice = await vscode.window.showInformationMessage(
            `${item.label} was added to the Context Basket. The saved source remains private and unchanged.`,
            'Open Basket',
          );
          if (choice === 'Open Basket') { this.openContextBasket(); }
        } catch (error: unknown) {
          const detail = boundedOperationFailure(error, 'Kronos could not add this source to the Context Basket.').display;
          this.log('Context Basket add failed.', detail);
          void vscode.window.showErrorMessage(detail);
        }
        return;
      }
      if (message.command !== 'insertDraft') { return; }
      let result;
      try {
        result = placeEditableTerminalContextReference(
          record.placement,
          this.currentTerminalContextAttachment(record.placement),
          record.reference,
          message.focus,
        );
      } catch (error: unknown) {
        const detail = boundedOperationFailure(error, 'Context insertion failed.').display;
        this.log('Context composer insertion failed.', detail);
        void vscode.window.showErrorMessage(detail);
        return;
      }
      if (result.kind === 'busy' || result.kind === 'already-placed') { return; }
      if (result.kind === 'target-changed') {
        void vscode.window.showWarningMessage('The connected terminal changed while this context was open. Reopen it from the intended ticket or Session.');
        return;
      }
      try {
        const outcome = await record.onInserted();
        if (outcome?.failed) { throw new OperationStageOutcomeError(outcome); }
        panel.dispose();
      } catch (error: unknown) {
        const detail = isOperationStageOutcomeError(error)
          ? error.outcome.display
          : boundedOperationFailure(error, 'Post-insertion local evidence update failed.').display;
        this.log('Context was inserted, but one or more later local evidence steps failed.', detail);
        void vscode.window.showErrorMessage(
          `The context was inserted without submission. Review the exact retained and failed steps: ${detail}`,
        );
        panel.dispose();
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
      canAddToBasket: Boolean(request.basketItem),
      nonce: record.nonce,
      scriptUri,
    }), webviewScriptCspOptions(panel.webview.cspSource, record.nonce));
  }

  private async openPromptLibrary(argument: unknown): Promise<void> {
    const settings = this.promptLibrarySettings();
    if (settings.localPaths.length === 0 && settings.remoteUrls.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No Kronos prompt library is configured. Add a local manifest path, a raw HTTPS Git manifest URL, or both in extension settings.',
        'Open Prompt Library Settings',
      );
      if (choice === 'Open Prompt Library Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos prompt library');
      }
      return;
    }
    const selection = await this.choosePromptLibraryTerminal(argument);
    if (!selection) { return; }
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Kronos: Refreshing prompt libraries...' },
      () => loadPromptLibraries({
        localPaths: settings.localPaths,
        remoteUrls: settings.remoteUrls,
        allowCredentialedRemote: vscode.workspace.isTrusted,
      }),
    );
    if (result.warnings.length > 0) {
      this.log('Prompt library refresh completed with warnings.', result.warnings.join('\n'));
      void vscode.window.showWarningMessage(
        `Kronos loaded ${result.prompts.length} prompt${result.prompts.length === 1 ? '' : 's'} with ${result.warnings.length} bounded library warning${result.warnings.length === 1 ? '' : 's'}. Details are in the Kronos output channel.`,
      );
    }
    if (result.prompts.length === 0) {
      const choice = await vscode.window.showWarningMessage(
        'No valid prompts were found in the configured libraries. Review the manifest paths and URLs in extension settings.',
        'Open Prompt Library Settings',
      );
      if (choice === 'Open Prompt Library Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos prompt library');
      }
      return;
    }
    const picked = await vscode.window.showQuickPick(result.prompts.map(prompt => ({
      label: `$(library) ${prompt.title}`,
      description: `${prompt.libraryName} • ${promptLibrarySourceKindLabel(prompt.sourceKind)}`,
      detail: [
        prompt.description,
        prompt.tags.length > 0 ? `Tags: ${prompt.tags.join(', ')}` : '',
        prompt.suggestedContext.length > 0 ? `Suggested context: ${prompt.suggestedContext.join(', ')}` : '',
      ].filter(Boolean).join(' • '),
      prompt,
    })), {
      title: 'Choose a team prompt',
      placeHolder: 'Search by title, library, description, tag, or suggested context',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!picked) { return; }
    const session = selection.workSession || readWorkSession(selection.binding.sessionId);
    if (!session || session.status !== 'active') {
      void vscode.window.showWarningMessage('The selected Session is no longer active. Reopen the prompt library from the intended Session or Project.');
      return;
    }
    const templateContext = this.promptTemplateContext(session);
    const rendered = renderPromptTemplate(picked.prompt, templateContext);
    const sourceWarning = result.sources.find(source => source.location === picked.prompt.sourceLocation
      && source.kind === picked.prompt.sourceKind)?.warning;
    this.openPromptLibraryComposer({
      selection: { ...selection, workSession: session },
      prompt: picked.prompt,
      templateContext,
      body: rendered.body,
      appliedVariables: rendered.appliedVariables,
      warnings: [...new Set([...rendered.warnings, ...(sourceWarning ? [sourceWarning] : [])])],
    });
  }

  private openPromptLibraryComposer(input: {
    selection: TerminalSelection;
    prompt: PromptLibraryPrompt;
    templateContext: PromptTemplateContext;
    body: string;
    appliedVariables: string[];
    warnings: string[];
  }): void {
    const placement = captureTerminalContextPlacement({
      terminal: input.selection.terminal,
      sessionId: input.selection.binding.sessionId,
      bindingId: input.selection.binding.bindingId,
    });
    if (!isTerminalContextPlacementCurrent(placement, this.currentTerminalContextAttachment(placement))) {
      void vscode.window.showWarningMessage('The connected terminal changed while the prompt library was loading. Reopen it from the intended Session or Project.');
      return;
    }
    this.promptLibraryPanel?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      'kronosPromptLibrary',
      `Kronos Prompt — ${input.prompt.title}`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    const record: PromptLibraryPanelRecord = {
      panel,
      nonce: createWebviewNonce(),
      placement,
      selection: input.selection,
      prompt: input.prompt,
      templateContext: input.templateContext,
      warnings: input.warnings,
    };
    this.promptLibraryPanel = record;
    panel.onDidDispose(() => {
      if (this.promptLibraryPanel?.panel === panel) { this.promptLibraryPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizePromptLibraryComposerMessage(raw);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid prompt-library request.');
        return;
      }
      if (message.command === 'cancel') { panel.dispose(); return; }
      if (message.command === 'openSettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos prompt library');
        return;
      }
      if (message.command !== 'insertPrompt') { return; }
      await this.placePromptLibraryArtifact(record, message.body);
    });
    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', PROMPT_LIBRARY_SCRIPT),
    ).toString();
    panel.webview.html = withWebviewCsp(buildPromptLibraryComposerHtml({
      title: input.prompt.title,
      description: input.prompt.description,
      libraryName: input.prompt.libraryName,
      sourceLabel: `${promptLibrarySourceKindLabel(input.prompt.sourceKind)} • ${input.prompt.sourceLocation}`,
      terminalName: input.selection.terminal.name,
      body: input.body,
      tags: input.prompt.tags,
      suggestedContext: input.prompt.suggestedContext,
      appliedVariables: input.appliedVariables,
      warnings: input.warnings,
      nonce: record.nonce,
      scriptUri,
    }), webviewScriptCspOptions(panel.webview.cspSource, record.nonce));
  }

  private async placePromptLibraryArtifact(record: PromptLibraryPanelRecord, editedBody: string): Promise<void> {
    if (record.placement.phase !== 'ready') { return; }
    if (!isTerminalContextPlacementCurrent(record.placement, this.currentTerminalContextAttachment(record.placement))) {
      void vscode.window.showWarningMessage('The connected terminal changed while this prompt was open. Reopen the library from the intended Session or Project.');
      return;
    }
    let artifact: ReturnType<typeof writePromptLibraryArtifact>;
    try {
      artifact = writePromptLibraryArtifact({
        prompt: record.prompt,
        editedBody,
        context: record.templateContext,
        warnings: record.warnings,
      });
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Kronos could not write the private prompt snapshot.').display;
      this.log('Prompt library snapshot write failed.', detail);
      void vscode.window.showErrorMessage(detail);
      return;
    }
    const reference = buildPromptLibraryTerminalReference(artifact.id, artifact.promptPath);
    let placementResult;
    try {
      placementResult = placeEditableTerminalContextReference(
        record.placement,
        this.currentTerminalContextAttachment(record.placement),
        reference,
        '',
      );
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Prompt library insertion failed.').display;
      this.log('Prompt library insertion failed.', detail);
      void vscode.window.showErrorMessage(detail);
      return;
    }
    if (placementResult.kind === 'busy' || placementResult.kind === 'already-placed') { return; }
    if (placementResult.kind === 'target-changed') {
      void vscode.window.showWarningMessage('The connected terminal changed before the prompt was added. The private copy was saved, but nothing was inserted.');
      return;
    }
    const session = record.selection.workSession || readWorkSession(record.selection.binding.sessionId);
    if (!session) {
      void vscode.window.showErrorMessage('The prompt reference was inserted without submission, but the Session disappeared before local history could be updated.');
      record.panel.dispose();
      return;
    }
    const outcome = finalizeInsertedContext({
      operation: `${artifact.id} prompt library placement`,
      providerRead: {
        state: 'succeeded',
        detail: `The ${record.prompt.sourceKind} prompt manifest was read and reviewed explicitly.`,
      },
      artifactWrite: { state: 'succeeded', detail: 'The edited prompt was saved as a private immutable snapshot.' },
      snapshot: contextSnapshotStep(true),
      sessionUpdate: () => {
        recordWorkSessionContextArtifact(session.id, {
          id: `prompt-library-${artifact.contentSha256.slice(0, 24)}`,
          kind: 'prompt-library',
          label: `[${artifact.id}] ${record.prompt.title}`,
          promptPath: artifact.promptPath,
          fetchedAt: artifact.createdAt,
          complete: true,
          warnings: artifact.warnings,
          contentSha256: artifact.contentSha256,
        });
        return session;
      },
      auditAppend: () => appendMonitorEvent({
        sessionId: session.id,
        type: 'context.inserted',
        source: 'operator',
        summary: `${workSessionEventContext(session).label} reviewed prompt ${record.prompt.title} inserted without submission.`,
        subject: { kind: 'prompt-library', id: record.prompt.id, ...workSessionTicketMetadata(session) },
        artifactPath: artifact.promptPath,
        metadata: {
          submitted: false,
          artifactSha256: artifact.contentSha256,
          revisionSha256: record.prompt.revisionSha256,
          sourceKind: record.prompt.sourceKind,
        },
      }),
    });
    this.refreshTerminalFirstViews();
    record.panel.dispose();
    if (outcome.failed) {
      this.log('Prompt was placed, but later local evidence steps failed.', outcome.display);
      void vscode.window.showErrorMessage(`The prompt reference was inserted without submission. Review retained and failed steps: ${outcome.display}`);
      return;
    }
    const redaction = artifact.bodyRedacted ? ' Credential-shaped text was redacted from the snapshot.' : '';
    void vscode.window.showInformationMessage(
      `Placed ${artifact.id} in ${record.selection.terminal.name} without submitting it. Review the line, then press Enter yourself.${redaction}`,
    );
  }

  private promptTemplateContext(session: WorkSessionRecord): PromptTemplateContext {
    const projectName = session.projectName
      ? this.state.state?.projects[session.projectName]?.display_name || session.projectName
      : undefined;
    const projectBranch = session.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined;
    return {
      sessionTitle: session.title,
      ...(projectName ? { projectName } : {}),
      ...(session.projectPath ? { projectPath: session.projectPath } : {}),
      ...(projectBranch ? { projectBranch } : {}),
      jiraKeys: session.ticketKeys,
    };
  }

  private async choosePromptLibraryTerminal(argument: unknown): Promise<TerminalSelection | undefined> {
    if (projectTargetStringProperty(argument, 'projectName') || projectTargetStringProperty(argument, 'projectPath')) {
      const project = this.resolveRegisteredProject(argument);
      return project ? this.chooseProjectInsertionTerminal(project, 'a team prompt') : undefined;
    }
    const ticketKey = normalizeTicketKey(stringProperty(argument, 'ticketKey'));
    if (ticketKey && this.state.state?.tickets[ticketKey]) {
      return this.chooseInsertionTerminal(ticketKey, stringProperty(argument, 'workSessionId'));
    }
    const directSession = await this.resolveWorkSession(argument, false);
    if (directSession) {
      if (directSession.status !== 'active') {
        void vscode.window.showWarningMessage('Choose an active Session before adding a team prompt.');
        return undefined;
      }
      const selected = await this.chooseLiveTerminal(directSession.id);
      if (!selected) {
        void vscode.window.showWarningMessage(`Focus or reconnect the terminal for ${workSessionEventContext(directSession).label} before opening the prompt library.`);
        return undefined;
      }
      selected.terminal.show(false);
      return { ...selected, workSession: directSession };
    }
    const active = vscode.window.activeTerminal;
    const activeBinding = active ? this.operatorTerminals.bindingForTerminal(active) : undefined;
    const activeSession = activeBinding ? readWorkSession(activeBinding.sessionId) : undefined;
    if (active && activeBinding && activeSession?.status === 'active') {
      return { terminal: active, binding: activeBinding, workSession: activeSession };
    }
    const candidates = listWorkSessions({ status: 'active' })
      .filter(session => this.operatorTerminals.listBindings(session.id).length > 0);
    if (candidates.length === 0) {
      void vscode.window.showWarningMessage('Start Claude or reconnect a Session before opening the prompt library. Kronos only adds prompts to a connected terminal.');
      return undefined;
    }
    const session = candidates.length === 1 ? candidates[0] : (await vscode.window.showQuickPick(candidates.map(candidate => ({
      label: workSessionEventContext(candidate).label,
      description: candidate.projectName || (candidate.kind === 'ticket' ? candidate.ticketKey : 'standalone'),
      detail: candidate.title,
      session: candidate,
    })), { title: 'Choose a Session for this prompt', matchOnDescription: true, matchOnDetail: true }))?.session;
    if (!session) { return undefined; }
    const selected = await this.chooseLiveTerminal(session.id);
    if (!selected) { return undefined; }
    selected.terminal.show(false);
    return { ...selected, workSession: session };
  }

  private openContextBasket(): void {
    if (this.contextBasketPanel) {
      this.contextBasketPanel.panel.reveal(vscode.ViewColumn.One, false);
      this.renderContextBasketPanel();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      'kronosContextBasket',
      'Kronos — Context Basket',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    const record: ContextBasketPanelRecord = { panel, nonce: createWebviewNonce(), focus: '' };
    this.contextBasketPanel = record;
    panel.onDidDispose(() => {
      if (this.contextBasketPanel?.panel === panel) { this.contextBasketPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeContextBasketMessage(raw);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid Context Basket request.');
        return;
      }
      if (message.command === 'close') {
        panel.dispose();
        return;
      }
      if (message.command === 'insert') {
        record.focus = message.focus;
        await this.insertContextBasket(message.focus);
        return;
      }
      if (message.command === 'clear') {
        record.focus = message.focus;
        const choice = await vscode.window.showWarningMessage(
          'Clear every Context Basket item? Saved sources will remain available.',
          { modal: true },
          'Clear Basket',
        );
        if (choice === 'Clear Basket') {
          try {
            const count = clearContextBasket();
            this.renderContextBasketPanel();
            void vscode.window.showInformationMessage(`Cleared ${count} Context Basket item${count === 1 ? '' : 's'}. Saved sources remain available.`);
          } catch (error: unknown) {
            this.showContextBasketError(error, 'Kronos could not clear the Context Basket.');
          }
        }
        return;
      }
      record.focus = message.focus;
      let items: ContextBasketItem[];
      try {
        items = listContextBasketItems();
      } catch (error: unknown) {
        this.showContextBasketError(error, 'Kronos could not read the Context Basket.');
        return;
      }
      const item = items.find(candidate => candidate.id === message.entryId);
      if (!item) {
        void vscode.window.showWarningMessage('That Context Basket item is no longer selected.');
        this.renderContextBasketPanel();
        return;
      }
      if (message.command === 'refresh') {
        await this.refreshContextBasketItem(item);
        return;
      }
      try {
        removeContextBasketItem(item.id);
        this.renderContextBasketPanel();
        void vscode.window.showInformationMessage(`Removed ${item.label} from the basket. Its saved source remains available.`);
      } catch (error: unknown) {
        this.showContextBasketError(error, 'Kronos could not remove the Context Basket item.');
      }
    });
    this.renderContextBasketPanel();
  }

  private renderContextBasketPanel(): void {
    const record = this.contextBasketPanel;
    if (!record) { return; }
    let items: ContextBasketItem[];
    try {
      items = listContextBasketItems();
    } catch (error: unknown) {
      this.showContextBasketError(error, 'Kronos could not read the private Context Basket.');
      return;
    }
    const scriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', CONTEXT_BASKET_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(buildContextBasketHtml({
      items,
      conflictIds: contextBasketConflictIds(items),
      nonce: record.nonce,
      scriptUri,
      focus: record.focus,
    }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
  }

  private async refreshContextBasketItem(item: ContextBasketItem): Promise<void> {
    if (item.refresh.kind === 'jira' && item.refresh.ticketKey) {
      await this.insertJiraContext({ ticketKey: item.refresh.ticketKey });
      return;
    }
    if (item.refresh.kind === 'gitlab' && item.refresh.ticketKey) {
      await this.insertGitLabContext({ ticketKey: item.refresh.ticketKey });
      return;
    }
    if (item.refresh.kind === 'gitlab' && item.refresh.projectName) {
      const project = listLocalProjects(this.state.state).find(candidate => candidate.name === item.refresh.projectName);
      if (project) {
        await this.insertGitLabContext({ projectName: project.name, projectPath: project.path });
        return;
      }
    }
    if (item.refresh.kind === 'ci' && item.refresh.ticketKey) {
      await this.insertCiContext({ ticketKey: item.refresh.ticketKey });
      return;
    }
    if (item.refresh.kind === 'ci' && item.refresh.projectName) {
      const project = listLocalProjects(this.state.state).find(candidate => candidate.name === item.refresh.projectName);
      if (project) {
        await this.insertCiContext({ projectName: project.name, projectPath: project.path });
        return;
      }
    }
    if (item.refresh.kind === 'git' && item.refresh.projectName) {
      const project = listLocalProjects(this.state.state).find(candidate => candidate.name === item.refresh.projectName);
      if (project) {
        await this.insertProjectGitContext({ projectName: project.name, projectPath: project.path });
        return;
      }
    }
    void vscode.window.showWarningMessage(`${item.label} no longer has a registered source target. Reopen it from Work or Projects.`);
  }

  private async insertContextBasket(focus: string): Promise<void> {
    if (this.contextBasketInsertionInFlight) {
      void vscode.window.showInformationMessage('Kronos is already preparing this Context Basket placement.');
      return;
    }
    this.contextBasketInsertionInFlight = true;
    try {
      const items = listContextBasketItems();
      if (items.length === 0) {
        void vscode.window.showWarningMessage('The Context Basket is empty. Add Jira, merge request, build, quality, or project changes first.');
        return;
      }
      const session = await this.resolveWorkSession(undefined, true);
      if (!session) { return; }
      if (session.status !== 'active') {
        void vscode.window.showWarningMessage('Choose an active Session for the Context Basket.');
        return;
      }
      const selected = await this.chooseLiveTerminal(session.id);
      if (!selected) {
        void vscode.window.showWarningMessage(`Focus or reconnect the terminal for ${workSessionEventContext(session).label} first.`);
        return;
      }
      selected.terminal.show(false);
      const placement = captureTerminalContextPlacement({
        terminal: selected.terminal,
        sessionId: selected.binding.sessionId,
        bindingId: selected.binding.bindingId,
      });
      let bundle: ReturnType<typeof writeContextBasketBundle>;
      try {
        bundle = writeContextBasketBundle(items, focus);
      } catch (error: unknown) {
        const selectedComplete = items.every(item => item.complete);
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          'Context Basket preparation',
          [
            {
              stage: 'provider-read',
              state: selectedComplete ? 'succeeded' : 'partial',
              detail: 'Selected sources remain saved and unchanged.',
            },
            { stage: 'snapshot', state: selectedComplete ? 'succeeded' : 'partial' },
          ],
          'artifact-write',
          error,
          'Private Context Basket bundle write failed.',
        ));
      }
      const reference = buildContextBasketReference(bundle);
      const result = placeEditableTerminalContextReference(
        placement,
        this.currentTerminalContextAttachment(placement),
        reference,
        '',
      );
      if (result.kind === 'target-changed') {
        void vscode.window.showWarningMessage('The connected terminal changed while the basket was being prepared. Choose the intended Session again.');
        return;
      }
      if (result.kind !== 'placed') { return; }
      const outcome = finalizeInsertedContext({
        operation: `${bundle.id} Context Basket placement`,
        providerRead: {
          state: bundle.complete ? 'succeeded' : 'partial',
          detail: bundle.complete
            ? 'Every selected source was current and complete.'
            : 'One or more selected sources include partial or older evidence warnings.',
        },
        artifactWrite: {
          state: 'succeeded',
          detail: 'A private immutable reference bundle was written.',
        },
        snapshot: contextSnapshotStep(bundle.complete),
        sessionUpdate: () => {
          recordWorkSessionContextArtifact(session.id, {
            id: `basket-${bundle.contentSha256.slice(0, 24)}`,
            kind: 'context-basket',
            label: `[${bundle.id}] ${bundle.itemCount} selected context${bundle.itemCount === 1 ? '' : 's'}`,
            promptPath: bundle.promptPath,
            complete: bundle.complete,
            warnings: bundle.warnings,
            contentSha256: bundle.contentSha256,
          });
          return session;
        },
        auditAppend: () => appendMonitorEvent({
          sessionId: session.id,
          type: 'context.inserted',
          source: 'kronos',
          summary: `${workSessionEventContext(session).label} Context Basket reference inserted without submission.`,
          subject: { kind: 'context-basket', id: bundle.id, ...workSessionTicketMetadata(session) },
          artifactPath: bundle.promptPath,
          metadata: { submitted: false, artifactSha256: bundle.contentSha256, itemCount: bundle.itemCount },
        }),
      });
      this.refreshTerminalFirstViews();
      if (outcome.failed) {
        this.log('Context Basket was placed, but one or more later local evidence steps failed.', outcome.display);
        void vscode.window.showErrorMessage(
          `The Context Basket was placed without submission. Review the exact retained and failed steps: ${outcome.display}`,
        );
        return;
      }
      const completionDetail = outcome.partial ? ` ${outcome.display}` : '';
      void vscode.window.showInformationMessage(
        `Placed ${bundle.id} in ${selected.terminal.name} without submitting it. Review the line, then press Enter yourself.${completionDetail}`,
      );
    } catch (error: unknown) {
      this.showContextBasketError(error, 'Kronos could not place the Context Basket.');
    } finally {
      this.contextBasketInsertionInFlight = false;
    }
  }

  private showContextBasketError(error: unknown, fallback: string): void {
    const detail = isOperationStageOutcomeError(error)
      ? error.outcome.display
      : boundedOperationFailure(error, fallback).display;
    this.log(fallback, detail);
    void vscode.window.showErrorMessage(detail);
  }

  private async searchLocalEvidence(): Promise<void> {
    let events: ReturnType<typeof listMonitorEvents> = [];
    try {
      events = listMonitorEvents({ limit: 500 });
    } catch (error: unknown) {
      this.log('Local evidence search could not read the audit tail.', boundedOperationFailure(error, 'Audit search unavailable.').display);
      void vscode.window.showWarningMessage('Recent history could not be included. Sessions, tickets, projects, providers, and saved context remain searchable.');
    }
    const entries = buildLocalEvidenceSearchIndex({
      sessions: listWorkSessions({ limit: 200 }),
      projects: listLocalProjects(this.state.state),
      events,
    });
    if (entries.length === 0) {
      void vscode.window.showInformationMessage('There are no Sessions or saved context to search yet.');
      return;
    }
    const pick = await vscode.window.showQuickPick(entries.map(entry => ({
      label: `$(${localEvidenceSearchIcon(entry.kind)}) ${entry.label}`,
      description: entry.description,
      detail: entry.detail,
      entry,
    })), {
      title: 'Search Kronos',
      placeHolder: 'Search Sessions, Jira tickets, projects, branches, providers, history, and saved context',
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (pick) { await this.openLocalEvidenceSearchResult(pick.entry); }
  }

  private async openLocalEvidenceSearchResult(entry: LocalEvidenceSearchEntry): Promise<void> {
    const action = entry.action;
    if (action.kind === 'session') {
      await this.focusWorkSessionTerminal({ sessionId: action.sessionId });
      return;
    }
    if (action.kind === 'ticket') {
      if (this.state.state?.tickets[action.ticketKey]) {
        await this.openTicketWorkspace({ ticketKey: action.ticketKey });
      } else {
        await this.openWorkSessionAudit({ sessionId: action.sessionId });
      }
      return;
    }
    if (action.kind === 'project') {
      await this.openProjectGitStatus({ projectName: action.projectName, projectPath: action.projectPath });
      return;
    }
    if (action.kind === 'artifact') {
      try {
        await this.openLocalArtifact(action.promptPath);
      } catch (error: unknown) {
        void vscode.window.showWarningMessage(boundedOperationFailure(error, 'The selected private context artifact is unavailable.').display);
      }
      return;
    }
    if (action.kind === 'provider' && action.url) {
      await this.openHttpUrl(action.url);
      return;
    }
    await this.openWorkSessionAudit({ sessionId: action.sessionId });
  }

  private async createLocalHandoff(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    let events: ReturnType<typeof listMonitorEvents> = [];
    try {
      events = listMonitorEvents({ sessionId: session.id, limit: 500 });
    } catch (error: unknown) {
      this.log('Local handoff could not read the audit tail.', boundedOperationFailure(error, 'Audit references unavailable.').display);
      void vscode.window.showWarningMessage('Kronos could not include audit events in this handoff. Saved context references remain selectable.');
    }
    const candidates = buildHandoffCandidates(session, events);
    if (candidates.length === 0) {
      void vscode.window.showInformationMessage('This Session has no saved context or history to hand off yet.');
      return;
    }
    const selected = await vscode.window.showQuickPick(candidates.map(candidate => ({
      label: `$(${candidate.selection.kind === 'context' ? 'file-text' : 'history'}) ${candidate.label}`,
      description: candidate.description,
      detail: candidate.detail,
      picked: candidate.picked,
      candidate,
    })), {
      title: `Create handoff — ${workSessionEventContext(session).label}`,
      placeHolder: 'Choose up to 100 saved context and history items',
      canPickMany: true,
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!selected || selected.length === 0) { return; }
    if (selected.length > 100) {
      void vscode.window.showWarningMessage('Choose at most 100 references for one local handoff.');
      return;
    }
    const title = await vscode.window.showInputBox({
      title: 'Handoff title',
      prompt: 'This title stays in the private local handoff.',
      value: `${session.title} handoff`,
      validateInput: value => value.trim() && value.length <= 200 ? null : 'Enter a title of 200 characters or fewer.',
      ignoreFocusOut: true,
    });
    if (!title) { return; }
    const note = await vscode.window.showInputBox({
      title: 'Handoff note (optional)',
      prompt: 'Add the next decision, open question, or review focus. Sensitive-looking values are removed before saving.',
      placeHolder: 'What should the next person know?',
      validateInput: value => value.length <= 4_000 ? null : 'Use 4,000 characters or fewer.',
      ignoreFocusOut: true,
    });
    if (note === undefined) { return; }
    try {
      const bundle = writeLocalHandoffBundle({
        session,
        selections: selected.map(value => value.candidate.selection),
        title,
        note,
      });
      appendMonitorEvent({
        sessionId: session.id,
        type: 'decision.recorded',
        source: 'operator',
        summary: `${workSessionEventContext(session).label} exported a private local handoff bundle.`,
        subject: { kind: 'local-handoff', id: bundle.id, ...workSessionTicketMetadata(session) },
        artifactPath: bundle.markdownPath,
        metadata: {
          selectionCount: bundle.selectionCount,
          artifactSha256: bundle.contentSha256,
          providerMutation: false,
        },
      });
      await this.openLocalArtifact(bundle.markdownPath);
      this.refreshTerminalFirstViews();
      void vscode.window.showInformationMessage(
        `Created ${bundle.id} with ${bundle.selectionCount} private local reference${bundle.selectionCount === 1 ? '' : 's'}. Nothing was posted to a provider.`,
      );
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Kronos could not create the local handoff bundle.').display;
      this.log('Local handoff creation failed.', detail);
      void vscode.window.showErrorMessage(detail);
    }
  }

  private async insertJiraContext(argument: unknown): Promise<void> {
    const ticketKey = await this.resolveTicketKey(argument, true);
    const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
    if (!ticketKey || !ticket) { return; }
    if (ticket.source !== 'jira') {
      void vscode.window.showWarningMessage(`${ticketKey} is not a Jira ticket.`);
      return;
    }
    const requestedSessionId = stringProperty(argument, 'workSessionId') || stringProperty(argument, 'sessionId');
    const selection = await this.chooseInsertionTerminal(ticketKey, requestedSessionId);
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
          warnings.push(`${boundedOperationFailure(error, 'Native Jira REST read failed.').display} Cached ticket data was inserted instead.`);
        }
      } else {
        warnings.push('Native Jira REST credentials are unavailable. Cached ticket data was inserted instead.');
      }
      if (!jiraContext) {
        jiraContext = buildFallbackJiraTicketContext(ticketKey, { ...ticket }, [], warnings);
      }
      progress.report({ message: 'Writing private content-addressed context and attachment files...' });
      let artifact: ReturnType<typeof writeJiraContextArtifacts>;
      try {
        artifact = writeJiraContextArtifacts(jiraContext, { attachmentContents });
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${ticketKey} Jira context preparation`,
          [
            { stage: 'provider-read', ...contextProviderReadStep(jiraContext.completeness.complete, 'Available Jira evidence was retained.') },
            { stage: 'snapshot', ...contextSnapshotStep(jiraContext.completeness.complete) },
          ],
          'artifact-write',
          error,
          'Private Jira context artifact write failed.',
        ));
      }
      const summary = `${jiraContext.completeness.fieldCount} fields (${jiraContext.completeness.customFieldCount} custom), ${jiraContext.comments.length} comments, ${jiraContext.completeness.attachmentBodiesCaptured}/${jiraContext.completeness.attachmentsTotal} attachment files downloaded`;
      this.openContextComposer({
        key: `jira:${ticketKey}`,
        panelTitle: `${ticketKey} — Compose Jira Context`,
        title: `${ticketKey}: ${jiraContext.summary || ticket.summary}`,
        subtitle: `${summary}. Review the details, adjust the focus, then add it to the terminal without pressing Enter.`,
        sourceLabel: jiraContext.completeness.complete ? 'Jira ready' : 'Jira partial',
        reference: buildJiraContextReference(ticketKey, artifact.promptPath),
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the ticket description, acceptance criteria, latest comments, and relevant attachments before making changes.',
        evidence: jiraComposerEvidence(jiraContext),
        warnings: jiraContext.completeness.warnings,
        selection,
        basketItem: {
          kind: 'jira',
          sourceKey: `jira:${ticketKey}`,
          label: `[${ticketKey}] Jira context`,
          provenance: `Jira ticket ${ticketKey}`,
          promptPath: artifact.promptPath,
          fetchedAt: jiraContext.fetchedAt,
          complete: jiraContext.completeness.complete,
          warnings: jiraContext.completeness.warnings,
          refresh: { kind: 'jira', ticketKey },
          contentSha256: artifact.promptSha256,
        },
        onInserted: () => {
          const managedSession = selection.workSession;
          const outcome = finalizeInsertedContext({
            operation: `${ticketKey} Jira context placement`,
            providerRead: contextProviderReadStep(
              jiraContext.completeness.complete,
              jiraContext.completeness.complete
                ? 'Ticket, comments, and bounded attachment reads completed.'
                : 'Cached or partial ticket, comment, or attachment evidence was retained with warnings.',
            ),
            snapshot: contextSnapshotStep(jiraContext.completeness.complete),
            sessionUpdate: managedSession ? () => {
              recordWorkSessionContextArtifact(managedSession.id, {
                id: `jira-${ticketKey}`,
                kind: 'jira-ticket',
                label: `[${ticketKey}] Jira context`,
                promptPath: artifact.promptPath,
                fetchedAt: jiraContext.fetchedAt,
                complete: jiraContext.completeness.complete,
                warnings: jiraContext.completeness.warnings,
                contentSha256: artifact.promptSha256,
              });
              return managedSession;
            } : undefined,
            auditAppend: managedSession ? updatedSession => {
              this.appendContextEvent(updatedSession || managedSession, 'jira', ticketKey, artifact.promptPath, artifact.promptSha256);
            } : undefined,
          });
          this.refreshTerminalFirstViews();
          if (outcome.failed) { return outcome; }
          const message = `Inserted edited [${ticketKey}] context into ${selection.terminal.name} without submitting it (${summary}).`;
          if (jiraContext.completeness.complete) {
            void vscode.window.showInformationMessage(`${message} Review the terminal line, then press Enter yourself.`);
          } else {
            void vscode.window.showWarningMessage(`${message} Cached or partial context was used; review the saved warnings. ${outcome.display}`);
          }
          return outcome;
        },
      });
    });
  }

  private async insertOtherTicket(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session || session.status !== 'active') { return; }
    const ticketKey = await this.resolveTicketKey(undefined, true);
    if (!ticketKey) { return; }
    await this.insertJiraContext({ ticketKey, workSessionId: session.id });
  }

  private async insertGitLabContext(argument: unknown): Promise<void> {
    const requestedProject = projectTargetStringProperty(argument, 'projectName');
    let project: RegisteredProjectCommandTarget | undefined;
    let ticketKey: string | undefined;
    let target: GitLabInsertionTarget | undefined;
    let selection: TerminalSelection | undefined;
    if (requestedProject) {
      project = this.resolveRegisteredProject(argument);
      if (!project) { return; }
      selection = await this.chooseProjectInsertionTerminal(project, 'merge request context');
      if (!selection) { return; }
      target = await this.resolveProjectGitLabInsertionTarget(project);
    } else {
      ticketKey = await this.resolveTicketKey(argument, true);
      const ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
      if (!ticketKey || !ticket) { return; }
      target = await this.resolveGitLabInsertionTarget(ticketKey, ticket);
      if (!target) { return; }
      selection = await this.chooseInsertionTerminal(ticketKey);
    }
    if (!target || !selection) { return; }
    const { iid, projectIdOrPath } = target;
    const ownerKey = ticketKey || `project:${project?.projectName}`;
    const ownerLabel = ticketKey || project?.displayName || project?.projectName || 'Project';

    await this.runProgress(`Kronos: Preparing merge request !${iid}...`, async progress => {
      progress.report({ message: 'Reading the merge request, discussions, changes, pipeline, jobs, and tests...' });
      let snapshot: Awaited<ReturnType<typeof gitlabRestClient.mergeRequestContext>>;
      try {
        snapshot = await gitlabRestClient.mergeRequestContext({ projectIdOrPath, iid });
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `MR-${iid} GitLab context preparation`,
          [],
          'provider-read',
          error,
          'GitLab merge-request context read failed.',
        ));
      }
      let context: GitLabProviderContext;
      try {
        context = project
          ? normalizeGitLabProjectMergeRequestContext(project.projectName, iid, snapshot)
          : normalizeGitLabMergeRequestContext(ticketKey || '', iid, snapshot);
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `MR-${iid} GitLab context preparation`,
          [{ stage: 'provider-read', state: 'succeeded' }],
          'snapshot',
          error,
          'GitLab context normalization failed.',
        ));
      }
      let artifact: ReturnType<typeof writeGitLabContextArtifacts>;
      try {
        artifact = writeGitLabContextArtifacts(context);
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `MR-${iid} GitLab context preparation`,
          [
            { stage: 'provider-read', ...contextProviderReadStep(context.completeness.complete, 'Available GitLab evidence was retained.') },
            { stage: 'snapshot', ...contextSnapshotStep(context.completeness.complete) },
          ],
          'artifact-write',
          error,
          'Private GitLab context artifact write failed.',
        ));
      }
      const failedTests = context.testReport?.failedCount ?? context.testReportSummary?.failedCount ?? 0;
      const summary = `${context.notes.length} notes, ${context.discussions.length} discussions, ${context.jobs.length} jobs, ${failedTests} failed tests`;
      this.openContextComposer({
        key: `gitlab:${ownerKey}:${iid}`,
        panelTitle: `Merge request !${iid} — Review context`,
        title: `Merge request !${iid}: ${context.mergeRequest.title}`,
        subtitle: `${summary}. Review the details, adjust the focus, then add it to the terminal without pressing Enter.`,
        sourceLabel: context.completeness.complete ? 'GitLab ready' : 'GitLab partial',
        reference: buildGitLabMergeRequestContextReference(iid, artifact.promptPath),
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the merge request description, unresolved discussions, latest comments, pipeline failures, and test evidence before responding.',
        evidence: gitLabComposerEvidence(context),
        warnings: context.completeness.warnings,
        selection,
        basketItem: {
          kind: 'gitlab',
          sourceKey: `gitlab:${ownerKey}:${iid}`,
          label: `[MR-${iid}] GitLab merge request and pipeline context`,
          provenance: `GitLab merge request !${iid} for ${ownerLabel}`,
          promptPath: artifact.promptPath,
          fetchedAt: context.fetchedAt,
          complete: context.completeness.complete,
          warnings: context.completeness.warnings,
          refresh: project
            ? { kind: 'gitlab', projectName: project.projectName }
            : { kind: 'gitlab', ticketKey: ticketKey || '' },
          contentSha256: artifact.promptSha256,
        },
        onInserted: () => {
          const managedSession = selection.workSession;
          const outcome = finalizeInsertedContext({
            operation: `MR-${iid} GitLab context placement`,
            providerRead: contextProviderReadStep(
              context.completeness.complete,
              context.completeness.complete
                ? 'Merge request, discussion, diff, pipeline, job, and test reads completed.'
                : 'Partial GitLab evidence was retained with its component warnings.',
            ),
            snapshot: contextSnapshotStep(context.completeness.complete),
            sessionUpdate: managedSession ? () => {
              const mergeRequestBinding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
                provider: 'gitlab',
                resource: 'merge-request',
                subjectId: String(iid),
                projectId: projectIdOrPath,
              };
              const mergeRequestUrl = target.url || context.mergeRequest.webUrl;
              if (mergeRequestUrl) { mergeRequestBinding.url = mergeRequestUrl; }
              let session = addWorkSessionProviderBinding(managedSession.id, mergeRequestBinding);
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
                label: `[MR-${iid}] GitLab merge request and pipeline context`,
                promptPath: artifact.promptPath,
                fetchedAt: context.fetchedAt,
                complete: context.completeness.complete,
                warnings: context.completeness.warnings,
                contentSha256: artifact.promptSha256,
              });
              return session;
            } : undefined,
            auditAppend: managedSession ? updatedSession => {
              this.appendContextEvent(updatedSession || managedSession, 'gitlab', String(iid), artifact.promptPath, artifact.promptSha256);
            } : undefined,
          });
          this.refreshTerminalFirstViews();
          if (outcome.failed) { return outcome; }
          const message = `Inserted edited [MR-${iid}] context into ${selection.terminal.name} without submitting it (${summary}).`;
          if (context.completeness.complete) {
            void vscode.window.showInformationMessage(`${message} Review the terminal line, then press Enter yourself.`);
          } else {
            void vscode.window.showWarningMessage(`${message} The saved merge request context is partial; review its warnings. ${outcome.display}`);
          }
          return outcome;
        },
      });
    });
  }

  private async insertCiContext(argument: unknown): Promise<void> {
    const requestedProject = projectTargetStringProperty(argument, 'projectName');
    let project: RegisteredProjectCommandTarget | undefined;
    let ticketKey: string | undefined;
    let ticket: Ticket | undefined;
    let selection: TerminalSelection | undefined;
    let monitoringOwner: WorkSessionRecord | undefined;
    if (requestedProject) {
      project = this.resolveRegisteredProject(argument);
      if (!project) { return; }
      selection = await this.chooseProjectInsertionTerminal(project, 'Jenkins / SonarQube evidence');
      if (!selection) { return; }
      const projectName = project.projectName;
      const projectPath = project.projectPath;
      const storedProject = this.state.state?.projects[projectName];
      monitoringOwner = ensureProjectMonitoringRecord({
        name: projectName,
        path: projectPath,
        ...(storedProject?.display_name ? { displayName: storedProject.display_name } : {}),
        seedBindings: listWorkSessions()
          .filter(session => matchesLocalProject(session, { name: projectName, path: projectPath }))
          .flatMap(session => session.providerBindings),
      });
    } else {
      ticketKey = await this.resolveTicketKey(argument, true);
      ticket = ticketKey ? this.state.state?.tickets[ticketKey] : undefined;
      if (!ticketKey || !ticket) { return; }
      selection = await this.chooseInsertionTerminal(ticketKey);
      if (!selection) { return; }
      monitoringOwner = selection.workSession
        ? { ...selection.workSession, ticketKey }
        : undefined;
    }
    if (!selection || !monitoringOwner) { return; }
    const savedTargets = configuredCiPollingTargets(this.state.state, monitoringOwner);
    const config = project
      ? this.state.state?.projects[project.projectName]?.config
      : ticket ? this.projectConfig(ticket) : undefined;
    const jenkinsUrl = savedTargets.jenkinsUrl || ticket?.build?.url || config?.jenkins_url;
    let sonarTarget = savedTargets.sonar
      || (ticketKey ? configuredSonarBranch(this.state.state, ticketKey) : undefined)
      || undefined;
    const ownerKey = ticketKey || `project:${project?.projectName}`;
    const ownerLabel = ticketKey || project?.displayName || project?.projectName || 'Project';
    if (!jenkinsUrl && !sonarTarget) {
      void vscode.window.showWarningMessage(`${ownerLabel} has no configured Jenkins URL or SonarQube project/branch.`);
      return;
    }

    await this.runProgress(`Kronos: Preparing ${ownerLabel} build & quality context...`, async progress => {
      const warnings: string[] = [];
      let jenkins: JenkinsBuildContext | undefined;
      let sonar: SonarBranchContext | undefined;
      if (jenkinsUrl) {
        progress.report({ message: 'Reading Jenkins build, stages, and tests...' });
        try {
          const jenkinsBranch = savedTargets.jenkinsBranch
            || (ticketKey ? configuredSonarBranchName(this.state.state, ticketKey) : undefined)
            || (project ? readProjectGitBranch(project.projectPath)?.branch : undefined)
            || undefined;
          jenkins = await jenkinsRestClient.buildContext(
            jenkinsUrl,
            jenkinsBranch ? { branch: jenkinsBranch } : {},
          );
        }
        catch (error: unknown) { warnings.push(boundedOperationFailure(error, 'Jenkins context was unavailable.').display); }
      }
      if (jenkins?.sonarProjectKey && (!sonarTarget || sonarTarget.projectKey !== jenkins.sonarProjectKey)) {
        const branch = jenkins.sonarBranch
          || (ticketKey ? configuredSonarBranchName(this.state.state, ticketKey) : undefined)
          || (project ? readProjectGitBranch(project.projectPath)?.branch : undefined);
        if (branch) {
          const providerUrl = sonarDashboardUrl(jenkins.sonarProjectKey, branch);
          sonarTarget = {
            projectKey: jenkins.sonarProjectKey,
            branch,
            ...(providerUrl ? { providerUrl } : {}),
          };
          const projectName = project?.projectName || selection.workSession?.projectName || ticket?.linked_local_project;
          if (projectName) {
            this.state.setLocalProjectSonarTarget(projectName, jenkins.sonarProjectKey, branch);
          }
        }
      }
      if (sonarTarget) {
        progress.report({ message: 'Reading SonarQube gate, measures, and issues...' });
        try { sonar = await sonarRestClient.branchContext(sonarTarget.projectKey, sonarTarget.branch); }
        catch (error: unknown) { warnings.push(boundedOperationFailure(error, 'SonarQube context was unavailable.').display); }
      }
      if (!jenkins && !sonar) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${ownerLabel} CI context preparation`,
          [],
          'provider-read',
          new Error(warnings.join(' ') || 'Neither Jenkins nor SonarQube context could be read.'),
          'Neither Jenkins nor SonarQube context could be read.',
        ));
      }
      const input: { jenkins?: JenkinsBuildContext; sonar?: SonarBranchContext; warnings: string[] } = { warnings };
      if (jenkins) { input.jenkins = jenkins; }
      if (sonar) { input.sonar = sonar; }
      let context: KronosCiProviderContext;
      try {
        context = project
          ? buildProjectCiContext(project.projectName, input)
          : buildCiContext(ticketKey || '', input);
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${ownerLabel} CI context preparation`,
          [{
            stage: 'provider-read',
            state: warnings.length > 0 ? 'partial' : 'succeeded',
            detail: warnings.length > 0
              ? 'At least one configured CI provider failed while another valid result was retained.'
              : 'Configured CI provider reads completed.',
          }],
          'snapshot',
          error,
          'CI context normalization failed.',
        ));
      }
      let artifact: ReturnType<typeof writeCiContextArtifacts>;
      try {
        artifact = writeCiContextArtifacts(context);
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${ownerLabel} CI context preparation`,
          [
            { stage: 'provider-read', ...contextProviderReadStep(context.completeness.complete, 'Available CI provider evidence was retained.') },
            { stage: 'snapshot', ...contextSnapshotStep(context.completeness.complete) },
          ],
          'artifact-write',
          error,
          'Private CI context artifact write failed.',
        ));
      }
      const providerSummary = [
        jenkins ? `Jenkins #${jenkins.build.number} ${jenkins.build.status}` : '',
        sonar ? `SonarQube ${sonar.qualityGate.status}` : '',
      ].filter(Boolean).join(' • ');
      const contextReference = project
        ? buildProjectCiContextReference(project.projectName, artifact.promptPath)
        : buildCiContextReference(ticketKey || '', artifact.promptPath);
      const contextLabel = ticketKey ? `CI-${ticketKey}` : `CI for ${ownerLabel}`;
      this.openContextComposer({
        key: `ci:${ownerKey}`,
        panelTitle: `${ownerLabel} — Review build & quality`,
        title: `${ownerLabel}: ${providerSummary || 'Build & quality evidence'}`,
        subtitle: 'Review the latest build and quality details, adjust the focus, then add it to the terminal without pressing Enter.',
        sourceLabel: context.completeness.complete ? 'Build & quality ready' : 'Build & quality partial',
        reference: contextReference,
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the Jenkins build, failed tests and stages, SonarQube quality gate, metrics, and unresolved issues before making changes.',
        evidence: ciComposerEvidence(jenkins, sonar),
        warnings: context.completeness.warnings,
        selection,
        basketItem: {
          kind: 'ci',
          sourceKey: `ci:${ownerKey}`,
          label: `[${contextLabel}] Jenkins and SonarQube context`,
          provenance: `Jenkins and SonarQube evidence for ${ownerLabel}`,
          promptPath: artifact.promptPath,
          fetchedAt: context.fetchedAt,
          complete: context.completeness.complete,
          warnings: context.completeness.warnings,
          refresh: project
            ? { kind: 'ci', projectName: project.projectName }
            : { kind: 'ci', ticketKey: ticketKey || '' },
          contentSha256: artifact.promptSha256,
        },
        onInserted: () => {
          const managedSession = selection.workSession;
          const outcome = finalizeInsertedContext({
            operation: `${ownerLabel} CI context placement`,
            providerRead: contextProviderReadStep(
              context.completeness.complete,
              context.completeness.complete
                ? 'Configured Jenkins and SonarQube evidence reads completed.'
                : 'Available provider evidence was retained while failed or optional components remain explicit.',
            ),
            snapshot: contextSnapshotStep(context.completeness.complete),
            sessionUpdate: managedSession ? () => {
              let session = managedSession;
              if (jenkins) {
                const binding: Parameters<typeof addWorkSessionProviderBinding>[1] = {
                  provider: 'jenkins',
                  resource: 'build',
                  subjectId: String(jenkins.build.number),
                };
                const buildUrl = jenkins.build.url || jenkinsUrl;
                if (buildUrl) { binding.url = buildUrl; }
                session = addWorkSessionProviderBinding(session.id, binding);
              }
              if (sonar && sonarTarget) {
                session = addWorkSessionProviderBinding(session.id, {
                  provider: 'sonar',
                  resource: 'quality-gate',
                  subjectId: `${sonarTarget.projectKey}:${sonarTarget.branch}`,
                  projectId: sonarTarget.projectKey,
                  url: sonar.dashboardUrl,
                });
              }
              recordWorkSessionContextArtifact(session.id, {
                id: `ci-${artifact.contentSha256.slice(0, 24)}`,
                kind: 'ci-evidence',
                label: `[${contextLabel}] Jenkins and SonarQube context`,
                promptPath: artifact.promptPath,
                fetchedAt: context.fetchedAt,
                complete: context.completeness.complete,
                warnings: context.completeness.warnings,
                contentSha256: artifact.promptSha256,
              });
              return session;
            } : undefined,
            auditAppend: managedSession ? updatedSession => {
              this.appendContextEvent(updatedSession || managedSession, 'kronos', ownerKey, artifact.promptPath, artifact.promptSha256);
            } : undefined,
          });
          this.refreshTerminalFirstViews();
          if (outcome.failed) { return outcome; }
          const message = `Inserted edited [${contextLabel}] context into ${selection.terminal.name} without submitting it.`;
          if (context.completeness.complete) {
            void vscode.window.showInformationMessage(`${message} Review the terminal line, then press Enter yourself.`);
          } else {
            void vscode.window.showWarningMessage(`${message} One or more provider components were partial; review the saved warnings. ${outcome.display}`);
          }
          return outcome;
        },
      });
    });
  }

  private async chooseInsertionTerminal(ticketKey: string, requestedSessionId?: string): Promise<TerminalSelection | undefined> {
    let session: WorkSessionRecord | null = null;
    if (requestedSessionId) {
      try { session = readWorkSession(requestedSessionId); } catch { session = null; }
      if (!session || session.status !== 'active') {
        void vscode.window.showWarningMessage('Choose an active Session before adding Jira context.');
        return undefined;
      }
    }
    const activeTerminal = vscode.window.activeTerminal;
    const activeBinding = activeTerminal ? this.operatorTerminals.bindingForTerminal(activeTerminal) : undefined;
    if (!session && activeBinding) {
      session = readWorkSession(activeBinding.sessionId);
    }
    if (!session) { session = getWorkSessionForTicketContext(ticketKey); }
    if (session?.status === 'active') {
      if (activeTerminal && activeBinding?.sessionId === session.id) {
        const updated = addWorkSessionTicketContext(session.id, ticketKey);
        if (updated.monitoring.enabled) { void this.pollProviders(false); }
        return { terminal: activeTerminal, workSession: updated, binding: activeBinding };
      }
      const selected = await this.chooseLiveTerminal(session.id);
      if (selected) {
        selected.terminal.show(false);
        const updated = addWorkSessionTicketContext(session.id, ticketKey);
        if (updated.monitoring.enabled) { void this.pollProviders(false); }
        return { terminal: selected.terminal, workSession: updated, binding: selected.binding };
      }
      void vscode.window.showWarningMessage(`Focus or reconnect the terminal for ${workSessionEventContext(session).label} before inserting context.`);
      return undefined;
    }
    void vscode.window.showWarningMessage(
      `Connect a terminal before adding ${ticketKey}. This keeps the context tied to the terminal you chose.`,
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
      })), { title: 'Choose a connected terminal' });
      selected = pick?.binding;
    }
    if (!selected) { return undefined; }
    const resolved = this.operatorTerminals.resolve(sessionId, selected.bindingId);
    return resolved.kind === 'resolved' ? { terminal: resolved.terminal, binding: resolved.binding } : undefined;
  }

  private currentTerminalContextAttachment(
    placement: TerminalContextPlacement<vscode.Terminal>,
  ): TerminalContextAttachment<vscode.Terminal> | undefined {
    const resolved = this.operatorTerminals.resolve(placement.sessionId, placement.bindingId);
    return resolved.kind === 'resolved'
      ? {
        terminal: resolved.terminal,
        sessionId: resolved.binding.sessionId,
        bindingId: resolved.binding.bindingId,
      }
      : undefined;
  }

  private async pollProviders(showResult: boolean): Promise<void> {
    let result: ManagedProviderPollResult;
    try {
      result = await this.monitor.poll();
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Managed provider poll failed.').display;
      this.log('Managed provider poll failed.', detail);
      if (showResult) { void vscode.window.showWarningMessage(detail); }
      return;
    }
    if (!showResult) { return; }
    const notice = managedProviderPollNotice(result);
    if (notice.warning) { void vscode.window.showWarningMessage(notice.message); }
    else { void vscode.window.showInformationMessage(notice.message); }
  }

  private showProviderNotice(notice: ManagedProviderNotice): void {
    const headline = attentionEventHeadline(notice.event);
    try {
      const notificationEvent: Parameters<typeof appendMonitorEvent>[0] = {
        sessionId: notice.session.id,
        type: 'notification.shown',
        source: 'kronos',
        summary: headline,
        metadata: { transitionEventId: notice.event.id },
      };
      if (notice.event.subject) { notificationEvent.subject = notice.event.subject; }
      appendMonitorEvent(notificationEvent);
    } catch (error: unknown) {
      this.log('Could not record provider notification display.', boundedOperationFailure(error, 'Notification audit failed.').display);
    }
    const actions = [
      ...(notice.providerUrl ? ['Open Provider'] : []),
      ...(notice.contextCommand && notice.contextArgument ? ['Insert Fresh Context'] : []),
      notice.event.source === 'gitlab' && notice.event.subject?.kind === 'merge-request'
        ? 'Clear Until Next Poll'
        : 'Clear from Attention',
    ];
    const prompt = notice.severity === 'warning'
      ? vscode.window.showWarningMessage(headline, ...actions)
      : vscode.window.showInformationMessage(headline, ...actions);
    void prompt.then(async action => {
      if (action === 'Open Provider' && notice.providerUrl) { await this.openHttpUrl(notice.providerUrl); }
      if (action === 'Insert Fresh Context' && notice.contextCommand && notice.contextArgument) {
        await vscode.commands.executeCommand(notice.contextCommand, notice.contextArgument);
      }
      if (action === 'Clear Until Next Poll' || action === 'Clear from Attention') {
        acknowledgeMonitorEvent(notice.event.id, notice.session.id);
        this.attentionTree.refresh();
      }
    }, error => this.log('Provider notification action failed.', boundedOperationFailure(error, 'Notification action failed.').display));
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
      void vscode.window.showWarningMessage('Focus the terminal you want to connect, then try again.');
      return;
    }
    if (session.status === 'closed') { session = reopenWorkSession(session.id); }
    if (session.kind === 'ticket') {
      const ticket = this.state.state?.tickets[session.ticketKey];
      if (ticket) { session = this.ensureProviderBindings(session, ticket); }
    }
    await this.attachTerminal(session, terminal);
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Connected ${terminal.name} to ${workSessionEventContext(session).label}. Terminal contents were not read.`);
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
    detachWorkSessionTerminal(session.id, selected.binding.bindingId, 'Disconnected explicitly by the operator.');
    this.appendTerminalDetachedEvent(selected.binding, 'operator-detached');
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Disconnected ${selected.terminal.name} from ${workSessionEventContext(session).label}. The terminal remains open.`);
  }

  private async stopManagingSession(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const context = workSessionEventContext(session);
    const confirmation = await vscode.window.showWarningMessage(
      `Stop tracking ${context.label} in Kronos? Provider updates will stop, but every terminal will remain open and untouched.`,
      { modal: true },
      'Stop Tracking',
    );
    if (confirmation !== 'Stop Tracking') { return; }
    this.operatorTerminals.detachSession(session.id);
    closeWorkSession(session.id);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${context.label} tracking stopped by the operator.`,
      subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
      metadata: { monitoringEnabled: false, terminalClosed: false },
    });
    this.refreshTerminalFirstViews();
  }

  private async removeManagedSession(argument: unknown): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const context = workSessionEventContext(session);
    if (session.status !== 'closed') {
      void vscode.window.showInformationMessage(`Stop tracking ${context.label} before removing it from Kronos.`);
      return;
    }
    const liveCount = this.operatorTerminals.listBindings(session.id).length;
    const confirmation = await vscode.window.showWarningMessage(
      `Remove ${context.label} from Kronos? Its Session entry and saved provider status will be deleted. ${liveCount > 0 ? `${liveCount} connected terminal${liveCount === 1 ? '' : 's'} will remain open and untouched. ` : ''}Session history and saved context will remain on this device.`,
      { modal: true },
      'Remove from Kronos',
    );
    if (confirmation !== 'Remove from Kronos') { return; }
    removeWorkSession(session.id);
    this.operatorTerminals.detachSession(session.id);
    try {
      appendMonitorEvent({
        sessionId: session.id,
        type: 'decision.recorded',
        source: 'operator',
        summary: `${context.label} session record removed from Kronos by the operator.`,
        subject: { kind: 'work-session', id: session.id, ...workSessionTicketMetadata(session) },
        metadata: { terminalClosed: false, sessionRecordRemoved: true },
      });
    } catch (error: unknown) {
      // The requested removal already succeeded. Do not report it as failed
      // merely because the retained append-only audit ledger was unavailable.
      this.log('Session was removed, but its final audit note could not be recorded.', boundedOperationFailure(error, 'Audit write failed.').display);
    }
    this.refreshTerminalFirstViews();
    void vscode.window.showInformationMessage(`Removed ${context.label} from Kronos. Its terminal remains open.`);
  }

  private async openProjectGitStatus(argument: unknown): Promise<void> {
    const project = this.resolveRegisteredProject(argument);
    if (!project) { return; }
    const existing = this.projectGitPanel;
    if (existing && existing.project.projectName === project.projectName
      && existing.project.projectPath === project.projectPath) {
      existing.panel.reveal(vscode.ViewColumn.One);
      await this.refreshProjectGitPanel(existing, false);
      return;
    }
    existing?.panel.dispose();
    const panel = vscode.window.createWebviewPanel(
      'kronosProjectGitState',
      `${project.displayName || project.projectName} — Git state`,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        enableCommandUris: false,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kronos-icon.svg');
    const record: ProjectGitPanelRecord = { panel, nonce: createWebviewNonce(), project };
    this.projectGitPanel = record;
    panel.onDidDispose(() => {
      if (this.projectGitPanel?.panel === panel) { this.projectGitPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeOperationsActionMessage(raw, PROJECT_GIT_STATE_ACTIONS);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid project Git-state request.');
        return;
      }
      if (message.command === 'close') {
        panel.dispose();
        return;
      }
      if (message.command === 'openSourceControl') {
        await vscode.commands.executeCommand('workbench.view.scm');
        return;
      }
      await this.refreshProjectGitPanel(record, true);
    });
    await this.refreshProjectGitPanel(record, true);
  }

  private async refreshProjectGitPanel(record: ProjectGitPanelRecord, notifyUnavailable: boolean): Promise<void> {
    await this.runProgress(`Kronos: Reading ${record.project.projectName} Git state...`, async progress => {
      progress.report({ message: 'Reading branches and working-tree state without changing the repository...' });
      const evidence = await readProjectGitEvidence(record.project.projectPath, { openRepositoryIfNeeded: true });
      if (this.projectGitPanel !== record) { return; }
      const actionScriptUri = record.panel.webview.asWebviewUri(
        vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
      ).toString();
      record.panel.webview.html = withWebviewCsp(buildProjectGitStatePanelHtml({
        projectName: record.project.projectName,
        ...(record.project.displayName ? { displayName: record.project.displayName } : {}),
        evidence,
        nonce: record.nonce,
        actionScriptUri,
      }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
      this.projectTree.refresh();
      if (notifyUnavailable && !evidence.available) {
        void vscode.window.showWarningMessage(evidence.warning || 'VS Code Git status is unavailable for this project.');
      }
    });
  }

  private async insertProjectGitContext(argument: unknown): Promise<void> {
    const project = this.resolveRegisteredProject(argument);
    if (!project) { return; }
    const selection = await this.chooseProjectInsertionTerminal(project);
    if (!selection) { return; }
    await this.runProgress(`Kronos: Preparing ${project.projectName} Git context...`, async progress => {
      progress.report({ message: 'Reading read-only status and diff from VS Code Git...' });
      let evidence: Awaited<ReturnType<typeof readProjectGitEvidence>>;
      try {
        evidence = await readProjectGitEvidence(project.projectPath, { openRepositoryIfNeeded: true });
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${project.projectName} local Git context preparation`,
          [{ stage: 'provider-read', state: 'skipped', detail: 'Local Git does not require a provider read.' }],
          'snapshot',
          error,
          'Read-only VS Code Git snapshot failed.',
        ));
      }
      if (!evidence.available) {
        void vscode.window.showWarningMessage(evidence.warning || 'VS Code Git status is unavailable for this project.');
        return;
      }
      const rendered = renderProjectGitEvidence(project.projectName, evidence);
      let artifact: ReturnType<typeof writeProjectGitContextArtifact>;
      try {
        artifact = writeProjectGitContextArtifact(project.projectName, rendered);
      } catch (error: unknown) {
        throw new OperationStageOutcomeError(failedOperationStageOutcome(
          `${project.projectName} local Git context preparation`,
          [
            { stage: 'provider-read', state: 'skipped', detail: 'Local Git does not require a provider read.' },
            { stage: 'snapshot', state: evidence.diffTruncated ? 'partial' : 'succeeded' },
          ],
          'artifact-write',
          error,
          'Private local Git context artifact write failed.',
        ));
      }
      const warnings = [
        ...(evidence.warning ? [evidence.warning] : []),
        ...(evidence.diffTruncated ? ['The working-tree diff was truncated at the bounded local context limit.'] : []),
        ...(artifact.redacted ? ['Potential credential material was redacted from the saved Git context.'] : []),
      ];
      this.openContextComposer({
        key: `git:${project.projectName}`,
        panelTitle: `${project.projectName} — Compose Git Context`,
        title: `${project.projectName}: ${evidence.branch || 'working tree'}`,
        subtitle: `${evidence.changeCount} changed path${evidence.changeCount === 1 ? '' : 's'}. Review the changes, adjust the focus, then add it to the terminal without pressing Enter.`,
        sourceLabel: 'Local Git read-only',
        reference: buildProjectGitContextReference(artifact.contextId, artifact.promptPath),
        promptPath: artifact.promptPath,
        suggestedFocus: 'Review the current working-tree changes for correctness, missing tests, security risks, and unintended edits before we make or publish a merge request.',
        evidence: [
          { label: 'Branch', detail: evidence.branch || 'unavailable' },
          { label: 'Changed paths', detail: evidence.changes.slice(0, 40).map(change => `${change.staged ? 'staged' : 'working'} ${change.status}: ${change.path}`).join('\n') || 'Clean working tree' },
          { label: 'Diff snapshot', detail: evidence.diff ? `${evidence.diff.length} characters${evidence.diffTruncated ? ' (truncated)' : ''}` : 'No textual diff returned' },
        ],
        warnings,
        selection,
        basketItem: {
          kind: 'git',
          sourceKey: `git:${project.projectName}`,
          label: `[${artifact.contextId}] local Git working tree`,
          provenance: `Local Git ${project.projectName} @ ${evidence.branch || 'unavailable'}`,
          promptPath: artifact.promptPath,
          fetchedAt: new Date().toISOString(),
          complete: evidence.available && !evidence.diffTruncated,
          warnings,
          refresh: { kind: 'git', projectName: project.projectName },
          contentSha256: artifact.contentSha256,
        },
        onInserted: () => {
          const managedSession = selection.workSession;
          const complete = evidence.available && !evidence.diffTruncated;
          const outcome = finalizeInsertedContext({
            operation: `${project.projectName} local Git context placement`,
            providerRead: {
              state: 'skipped',
              detail: 'This source is the read-only VS Code Git model, not a provider read.',
            },
            snapshot: contextSnapshotStep(complete),
            sessionUpdate: managedSession ? () => {
              recordWorkSessionContextArtifact(managedSession.id, {
                id: `git-${artifact.contentSha256.slice(0, 24)}`,
                kind: 'git-working-tree',
                label: `[${artifact.contextId}] local Git working tree`,
                promptPath: artifact.promptPath,
                complete,
                warnings,
                contentSha256: artifact.contentSha256,
              });
              return managedSession;
            } : undefined,
            auditAppend: managedSession ? updatedSession => {
              this.appendContextEvent(updatedSession || managedSession, 'kronos', project.projectName, artifact.promptPath, artifact.contentSha256);
            } : undefined,
          });
          this.refreshTerminalFirstViews();
          if (outcome.failed) { return outcome; }
          void vscode.window.showInformationMessage(
            `Inserted [${artifact.contextId}] into ${selection.terminal.name} without submitting it. Review the line, then press Enter yourself.`,
          );
          return outcome;
        },
      });
    });
  }

  private async insertProjectProviderContext(argument: unknown, provider: 'gitlab' | 'ci'): Promise<void> {
    const project = this.resolveRegisteredProject(argument);
    if (!project) { return; }
    if (provider === 'gitlab') { await this.insertGitLabContext(project); }
    else { await this.insertCiContext(project); }
  }

  private configureProjectIntegrations(argument: unknown): void {
    const project = this.resolveRegisteredProject(argument);
    if (project) { this.openProjectIntegrationSetup([project.projectName]); }
  }

  private async renameLocalProject(argument: unknown): Promise<void> {
    const project = this.resolveRegisteredProject(argument);
    if (!project) { return; }
    const storedNickname = this.state.state?.projects[project.projectName]?.display_name;
    const nickname = storedNickname && storedNickname !== project.projectName ? storedNickname : '';
    const value = await vscode.window.showInputBox({
      title: `Set Nickname for ${project.displayName || project.projectName}`,
      prompt: 'Optional display name. Leave blank to use the folder name. Links, Sessions, integrations, and the project folder stay unchanged.',
      value: nickname,
      placeHolder: project.projectName,
      validateInput: input => input.trim().length > 200 ? 'Project nickname must be 200 characters or fewer.' : undefined,
    });
    if (value === undefined) { return; }
    try {
      this.state.renameLocalProjectDisplayName(project.projectName, value);
      this.refreshTerminalFirstViews();
      const normalized = value.replace(/\s+/g, ' ').trim();
      void vscode.window.showInformationMessage(normalized
        ? `Project nickname changed to ${normalized}. Existing links were not changed.`
        : `Project nickname cleared. Kronos will display ${project.projectName}; existing links were not changed.`);
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Kronos could not update the project nickname.').display;
      this.log('Could not update project nickname.', detail);
      void vscode.window.showErrorMessage(detail);
    }
  }

  private async openProjectMergeRequest(argument: unknown): Promise<void> {
    const project = this.resolveRegisteredProject(argument);
    if (!project) { return; }
    const discovery = await this.discoverRegisteredProjectGitLabTarget(project);
    if (discovery.kind === 'matched') {
      if (discovery.target.url) {
        await this.openHttpUrl(discovery.target.url);
        return;
      }
      const projectPath = this.state.state?.projects[project.projectName]?.config?.gitlab_project_path;
      const apiUrl = normalizeGitLabApiBaseUrl(
        process.env['GITLAB_API_BASE_URL']
          || process.env['GITLAB_BASE_URL']
          || process.env['GITLAB_URL']
          || process.env['GITLAB_HOST'],
      );
      if (projectPath && apiUrl) {
        const webBase = apiUrl.replace(/\/api\/v4\/?$/, '');
        const encodedProjectPath = projectPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
        await this.openHttpUrl(`${webBase}/${encodedProjectPath}/-/merge_requests/${discovery.target.iid}`);
      } else {
        void vscode.window.showWarningMessage(
          `Merge request !${discovery.target.iid} was found, but GitLab did not return a browser URL and this project has no group/project path for a safe fallback.`,
        );
      }
      return;
    }
    if (discovery.kind === 'ambiguous') {
      void vscode.window.showWarningMessage(
        `${project.displayName || project.projectName} has ${discovery.candidateCount} possible open merge requests${discovery.sourceBranch ? ` while checking branch ${discovery.sourceBranch}` : ''}. Kronos will not guess or open an older saved merge request.`,
      );
      return;
    }
    if (discovery.kind === 'unconfigured') {
      void vscode.window.showWarningMessage(
        `${project.displayName || project.projectName} needs a GitLab project ID or group/project path before Kronos can find or create its merge request.`,
      );
      return;
    }
    if (discovery.kind === 'failed') {
      this.log(`Could not verify the current GitLab merge request for ${project.projectName}.`, discovery.detail);
      void vscode.window.showWarningMessage(`${discovery.detail} Kronos will open a prefilled new merge request page instead of using an older saved result.`);
    }

    const config = this.state.state?.projects[project.projectName]?.config || {};
    const projectPath = config.gitlab_project_path;
    const branch = readProjectGitBranch(project.projectPath)?.branch;
    if (!projectPath || !branch || branch.startsWith('detached@')) {
      void vscode.window.showWarningMessage(
        `${project.projectName} needs a GitLab group/project path and a current branch before Kronos can open a prefilled new merge request page.`,
      );
      return;
    }
    try {
      const apiUrl = normalizeGitLabApiBaseUrl(
        process.env['GITLAB_API_BASE_URL']
          || process.env['GITLAB_BASE_URL']
          || process.env['GITLAB_URL']
          || process.env['GITLAB_HOST'],
      );
      if (!apiUrl) { throw new Error('GitLab base URL is not configured.'); }
      const webBase = apiUrl.replace(/\/api\/v4\/?$/, '');
      const encodedProjectPath = projectPath.split('/').map(segment => encodeURIComponent(segment)).join('/');
      const url = new URL(`${webBase}/${encodedProjectPath}/-/merge_requests/new`);
      url.searchParams.set('merge_request[source_branch]', branch);
      url.searchParams.set('merge_request[target_branch]', config.default_branch || config.base_branch || 'main');
      await this.openHttpUrl(url.toString());
    } catch (error: unknown) {
      void vscode.window.showWarningMessage(boundedOperationFailure(error, 'Kronos could not open the GitLab new merge request page.').display);
    }
  }

  private resolveRegisteredProject(argument: unknown): RegisteredProjectCommandTarget | undefined {
    const projectName = projectTargetStringProperty(argument, 'projectName');
    const projectPath = projectTargetStringProperty(argument, 'projectPath');
    const projects = listLocalProjects(this.state.state);
    // The catalog name is the stable foreign key. Always re-read the current
    // canonical path instead of requiring a possibly stale tree-item path to
    // match byte-for-byte (notably after Windows casing or alias cleanup).
    const registered = (projectName ? projects.find(project => project.name === projectName) : undefined)
      || (projectPath ? projects.find(project =>
        localProjectPathKey(project.path) === localProjectPathKey(projectPath)
      ) : undefined);
    if (!registered) {
      void vscode.window.showWarningMessage(
        'That Project row is stale or no longer registered. Refresh Projects or choose Manage Projects to register it.',
      );
      return undefined;
    }
    return { projectName: registered.name, projectPath: registered.path, displayName: registered.displayName };
  }

  private async chooseProjectInsertionTerminal(
    project: RegisteredProjectCommandTarget,
    evidenceLabel = 'working diff',
  ): Promise<TerminalSelection | undefined> {
    const sessions = listWorkSessions({ status: 'active' })
      .filter(session => matchesLocalProject(session, { name: project.projectName, path: project.projectPath }));
    if (sessions.length === 0) {
      void vscode.window.showWarningMessage(
        `Start a Claude session in ${project.projectName}, or manage a focused terminal for it, before inserting ${evidenceLabel}. No Jira ticket is required.`,
      );
      return undefined;
    }
    const active = vscode.window.activeTerminal;
    const activeBinding = active ? this.operatorTerminals.bindingForTerminal(active) : undefined;
    let session = activeBinding ? sessions.find(candidate => candidate.id === activeBinding.sessionId) : undefined;
    if (!session && sessions.length === 1) { session = sessions[0]; }
    if (!session) {
      const pick = await vscode.window.showQuickPick(sessions.map(candidate => ({
        label: workSessionEventContext(candidate).label,
        description: candidate.kind === 'ticket' ? candidate.ticketKey : 'standalone',
        session: candidate,
      })), { title: `Choose a Session for ${project.displayName || project.projectName}` });
      session = pick?.session;
    }
    if (!session) { return undefined; }
    if (session.projectName !== project.projectName
      || !session.projectPath
      || localProjectPathKey(session.projectPath) !== localProjectPathKey(project.projectPath)) {
      session = setWorkSessionProject(session.id, {
        projectName: project.projectName,
        projectPath: project.projectPath,
      });
    }
    if (session.kind === 'ticket') { return this.chooseInsertionTerminal(session.ticketKey); }
    const selected = await this.chooseLiveTerminal(session.id);
    if (!selected) {
      void vscode.window.showWarningMessage(`Focus or reconnect the terminal for ${session.title} before adding context.`);
      return undefined;
    }
    return { terminal: selected.terminal, binding: selected.binding, workSession: session };
  }

  private async setMonitoring(argument: unknown, enabled: boolean): Promise<void> {
    const session = await this.resolveWorkSession(argument, true);
    if (!session) { return; }
    const projectConfig = session.projectName
      ? this.state.state?.projects[session.projectName]?.config
      : undefined;
    if (projectConfig && configuredProjectPollingEnabled(projectConfig)) {
      void vscode.window.showInformationMessage(
        `${session.projectName} checks providers automatically from Projects. Pausing this Session will not stop those updates.`,
      );
      return;
    }
    if (session.ticketKeys.length === 0) {
      void vscode.window.showInformationMessage(
        'Project provider updates run automatically and do not require a Jira ticket. Pause and resume here apply only to older ticket-linked Sessions.',
      );
      return;
    }
    if (workSessionLifecycle(session, this.operatorTerminals.listBindings(session.id).length).management !== 'active') {
      void vscode.window.showWarningMessage(`Connect a terminal to ${workSessionEventContext(session).label} before resuming provider updates.`);
      return;
    }
    setWorkSessionMonitoring(session.id, enabled);
    appendMonitorEvent({
      sessionId: session.id,
      type: 'decision.recorded',
      source: 'operator',
      summary: `${workSessionEventContext(session).label} provider updates ${enabled ? 'resumed' : 'paused'} by the operator.`,
      subject: { kind: 'work-session', id: session.id, ...(session.kind === 'ticket' ? { ticketKey: session.ticketKey } : {}) },
      metadata: { monitoringEnabled: enabled },
    });
    this.refreshTerminalFirstViews();
    if (enabled) { void this.pollProviders(false); }
  }

  private async insertAttentionEventContext(argument: unknown): Promise<void> {
    const eventId = stringProperty(argument, 'eventId');
    const expectedSessionId = stringProperty(argument, 'sessionId') || stringProperty(argument, 'workSessionId');
    if (!eventId || !expectedSessionId) {
      void vscode.window.showWarningMessage('Right-click a supported Attention item to use that exact event in a prompt.');
      return;
    }
    let event: ReturnType<typeof readMonitorEvent>;
    try { event = readMonitorEvent(eventId); }
    catch { event = null; }
    if (!event || event.sessionId !== expectedSessionId) {
      void vscode.window.showWarningMessage('That Attention event is no longer available. Refresh Attention and choose the current row.');
      return;
    }
    if (!attentionEventCanUsePromptContext(event)) {
      void vscode.window.showWarningMessage('Exact event context is available for GitLab merge requests, Jenkins, and SonarQube Attention rows.');
      return;
    }

    let selection: TerminalSelection | undefined;
    let project: RegisteredProjectCommandTarget | undefined;
    const requestedProject = projectTargetStringProperty(argument, 'projectName')
      || projectTargetStringProperty(argument, 'projectPath');
    if (requestedProject) {
      project = this.resolveRegisteredProject(argument);
      if (!project) { return; }
      selection = await this.chooseProjectInsertionTerminal(project, `${event.source} Attention event context`);
    } else {
      const ticketKey = stringProperty(argument, 'ticketKey') || event.subject?.ticketKey;
      if (ticketKey) {
        let eventSession: WorkSessionRecord | null = null;
        try { eventSession = readWorkSession(event.sessionId); } catch { eventSession = null; }
        selection = await this.chooseInsertionTerminal(
          ticketKey,
          eventSession?.status === 'active' ? eventSession.id : undefined,
        );
      } else {
        let eventSession: WorkSessionRecord | null = null;
        try { eventSession = readWorkSession(event.sessionId); } catch { eventSession = null; }
        if (eventSession?.status === 'active') {
          const live = await this.chooseLiveTerminal(eventSession.id);
          if (live) {
            selection = { terminal: live.terminal, binding: live.binding, workSession: eventSession };
          }
        }
      }
    }
    if (!selection) {
      void vscode.window.showWarningMessage('Connect a terminal for this Attention event before inserting its context.');
      return;
    }

    const contextProjectName = project?.projectName || selection.workSession?.projectName;
    const contextTicketKey = stringProperty(argument, 'ticketKey') || event.subject?.ticketKey;
    const context = buildAttentionEventPromptContext(event, {
      ...(contextProjectName ? { projectName: contextProjectName } : {}),
      ...(contextTicketKey ? { ticketKey: contextTicketKey } : {}),
    });
    let artifact: ReturnType<typeof writeAttentionEventContextArtifacts>;
    try {
      artifact = writeAttentionEventContextArtifacts(context);
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'Kronos could not save the private Attention event context.').display;
      this.log('Attention event context artifact write failed.', detail);
      void vscode.window.showErrorMessage(detail);
      return;
    }

    this.openContextComposer({
      key: `attention-event:${event.id}`,
      panelTitle: `${context.provider} — Review exact event`,
      title: context.headline,
      subtitle: 'This contains only the selected retained Attention transition. No broader provider context was fetched. Review it, adjust the focus, then add it without pressing Enter.',
      sourceLabel: `${context.provider} event • ${context.severity}`,
      reference: buildAttentionEventContextReference(artifact.contextId, artifact.promptPath),
      promptPath: artifact.promptPath,
      suggestedFocus: 'Use this exact Attention transition as context. Do not assume broader provider state that is not present in the saved event.',
      evidence: attentionEventComposerEvidence(context),
      warnings: [],
      selection,
      onInserted: () => {
        const managedSession = selection.workSession;
        const outcome = finalizeInsertedContext({
          operation: `${context.provider} Attention event placement`,
          providerRead: {
            state: 'skipped',
            detail: 'The selected retained Attention transition was used without refreshing its provider.',
          },
          sessionUpdate: managedSession ? () => recordWorkSessionContextArtifact(managedSession.id, {
            id: `attention-${artifact.contentSha256.slice(0, 24)}`,
            kind: 'attention-event',
            label: `[${artifact.contextId}] ${context.provider} Attention event`,
            promptPath: artifact.promptPath,
            fetchedAt: event.at,
            complete: true,
            warnings: [],
            contentSha256: artifact.promptSha256,
          }) : undefined,
          auditAppend: managedSession ? updatedSession => {
            const session = updatedSession || managedSession;
            appendMonitorEvent({
              sessionId: session.id,
              type: 'context.inserted',
              source: 'kronos',
              summary: `${workSessionEventContext(session).label} exact ${context.provider} Attention event reference inserted without submission.`,
              subject: { kind: 'attention-event', id: event.id, ...workSessionTicketMetadata(session) },
              artifactPath: artifact.promptPath,
              metadata: {
                submitted: false,
                transitionEventId: event.id,
                artifactSha256: artifact.promptSha256,
              },
            });
          } : undefined,
        });
        this.refreshTerminalFirstViews();
        if (outcome.failed) { return outcome; }
        void vscode.window.showInformationMessage(
          `Inserted [${artifact.contextId}] into ${selection.terminal.name} without submitting it. Review the terminal line, then press Enter yourself.`,
        );
        return outcome;
      },
    });
  }

  private async acknowledgeAttention(argument: unknown): Promise<void> {
    const eventId = stringProperty(argument, 'eventId');
    const sessionId = stringProperty(argument, 'sessionId') || stringProperty(argument, 'workSessionId');
    if (!eventId || !sessionId) {
      void vscode.window.showWarningMessage('Select an Attention item to clear. Its audit history will be retained.');
      return;
    }
    acknowledgeMonitorEvent(eventId, sessionId);
    this.attentionTree.refresh();
  }

  private async openProvider(argument: unknown): Promise<void> {
    const providerChoices = providerOpenChoices(argument);
    let providerUrl = stringProperty(argument, 'providerUrl') || stringProperty(argument, 'url') || providerChoices[0]?.url;
    if (providerChoices.length > 1) {
      const selected = await vscode.window.showQuickPick(providerChoices, {
        title: 'Choose a branch or build',
        placeHolder: 'Choose what to open',
      });
      if (!selected) { return; }
      providerUrl = selected.url;
    }
    if (!providerUrl) {
      const projectName = stringProperty(argument, 'projectName');
      const projectPath = stringProperty(argument, 'projectPath');
      if (projectName && projectPath) {
        this.configureProjectIntegrations({ projectName, projectPath });
      } else {
        await vscode.commands.executeCommand('kronos.doctor');
      }
      return;
    }
    if (stringProperty(argument, 'source') === 'sonar') {
      this.selectMonitoredSonarBranch(argument, providerUrl);
    }
    await this.openHttpUrl(providerUrl);
  }

  private selectMonitoredSonarBranch(argument: unknown, providerUrl: string): void {
    try {
      const url = new URL(providerUrl);
      const projectKey = url.searchParams.get('id')?.trim();
      const branch = url.searchParams.get('branch')?.trim();
      const sessionId = stringProperty(argument, 'workSessionId') || stringProperty(argument, 'sessionId');
      const session = sessionId
        ? readWorkSession(sessionId) || this.readProjectMonitorById(sessionId)
        : null;
      const projectName = session?.projectName;
      if (!projectName || !projectKey || !branch || !this.state.state?.projects[projectName]) { return; }
      const config = this.state.state.projects[projectName]?.config;
      if (config?.sonar_project_key === projectKey && config.sonar_branch === branch) { return; }
      this.state.setLocalProjectSonarTarget(projectName, projectKey, branch);
      appendMonitorEvent({
        sessionId: session.id,
        type: 'decision.recorded',
        source: 'operator',
        summary: `${projectName} SonarQube monitoring branch changed to ${branch}.`,
        subject: { kind: 'quality-gate', id: `${projectKey}:${branch}`, ...workSessionTicketMetadata(session) },
        metadata: { projectName, projectKey, branch, monitoringTargetChanged: true },
      });
      this.refreshTerminalFirstViews();
      void this.pollProviders(false);
      void vscode.window.showInformationMessage(`${projectName} will now monitor SonarQube branch ${branch}.`);
    } catch (error: unknown) {
      this.log('Could not save the selected SonarQube branch.', boundedOperationFailure(error, 'Invalid SonarQube branch target.').display);
    }
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
    const panel = this.createOperationsPanel('kronosDoctor', 'Kronos — Check Setup');
    const record: OperationsPanelRecord = { panel, nonce: createWebviewNonce() };
    this.doctorPanel = record;
    panel.onDidDispose(() => {
      if (this.doctorPanel?.panel === panel) { this.doctorPanel = undefined; }
    });
    panel.webview.onDidReceiveMessage(async raw => {
      if (isRecord(raw) && raw['command'] === WEBVIEW_READY_COMMAND) { return; }
      const message = normalizeOperationsActionMessage(raw, OPERATIONS_PANEL_ACTIONS);
      if (!message) {
        void vscode.window.showWarningMessage('Kronos ignored an invalid setup-check request.');
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
      } else if (action === 'openProviderEnvironment') {
        await this.openProviderEnvironment();
      } else if (action === 'openPromptLibrarySettings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:jmacke01.kronos prompt library');
      } else if (action === 'chooseProjectDiscoveryFolders') {
        await this.configureProjectDiscoveryFolders();
      } else if (action === 'openProjectsView') {
        await vscode.commands.executeCommand('kronosProjects.focus');
      } else if (action === 'openSessionsView') {
        await vscode.commands.executeCommand('kronosSessions.focus');
      } else if (action === 'configureProjectIntegrations') {
        this.openProjectIntegrationSetup();
      } else if (action === 'openJiraBoard') {
        await this.openJiraBoard();
      } else if (action === 'pollProvidersNow') {
        await this.pollProviders(true);
      }
      this.renderOperationsPanels();
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, `Kronos ${source} action failed.`).display;
      this.log(`Kronos ${source} action failed.`, detail);
      void vscode.window.showErrorMessage(detail);
    } finally {
      this.operationsPanelActionsInFlight.delete(requestKey);
    }
  }

  private async openProviderEnvironment(): Promise<void> {
    const result = ensureProviderEnvTemplate();
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.path));
    await vscode.window.showTextDocument(document, { preview: false });
    if (result.created) {
      void vscode.window.showWarningMessage(
        'Created the private Kronos environment template. After entering and saving provider values, reload the VS Code window so the extension host picks them up; then check setup again.',
      );
    }
  }

  private renderOperationsPanels(): void {
    const readiness = this.operationsReadiness();
    this.renderSetupPanel(readiness);
    this.renderDoctorPanel(readiness);
  }

  private renderSetupPanel(readiness = this.operationsReadiness()): void {
    const record = this.setupPanel;
    if (!record) { return; }
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(buildSetupPanelHtml({
      steps: this.setupSteps(readiness),
      runtime: this.operationsRuntimeGuide(),
      nonce: record.nonce,
      actionScriptUri,
    }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
  }

  private setupSteps(readiness: readonly OperationsReadinessItem[]): SetupStep[] {
    return readiness
      .filter(item => item.surfaces.includes('setup'))
      .map(item => ({
        title: item.title,
        detail: item.detail,
        status: item.status,
        ...((item.status !== 'pass' || item.actionWhenReady !== false)
          ? { action: item.action, actionLabel: item.actionLabel }
          : {}),
      }));
  }

  private renderDoctorPanel(readiness = this.operationsReadiness()): void {
    const record = this.doctorPanel;
    if (!record) { return; }
    const actionScriptUri = record.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', WEBVIEW_ACTION_PANEL_SCRIPT),
    ).toString();
    record.panel.webview.html = withWebviewCsp(buildDoctorPanelHtml({
      checks: this.doctorChecks(readiness),
      runtime: this.operationsRuntimeGuide(),
      nonce: record.nonce,
      actionScriptUri,
    }), webviewScriptCspOptions(record.panel.webview.cspSource, record.nonce));
  }

  private doctorChecks(readiness: readonly OperationsReadinessItem[]): DoctorCheck[] {
    return readiness
      .filter(item => item.surfaces.includes('doctor'))
      .map(item => {
        const setupOwnsDiscoveryFolders = item.action === 'chooseProjectDiscoveryFolders';
        return {
          name: item.title,
          status: item.status,
          detail: item.detail,
          action: setupOwnsDiscoveryFolders ? 'openSetup' : item.action,
          actionLabel: setupOwnsDiscoveryFolders ? 'Open Guided Setup' : item.actionLabel,
        };
      });
  }

  private operationsRuntimeGuide(): OperationsRuntimeGuide {
    const platformLabel = process.platform === 'win32'
      ? 'Windows'
      : process.platform === 'darwin' ? 'macOS' : process.platform === 'linux' ? 'Linux' : process.platform;
    return {
      platformLabel,
      privateStatePath: KRONOS_DIR,
      providerEnvPath: defaultProviderEnvPath(),
    };
  }

  private operationsReadiness(): OperationsReadinessItem[] {
    const projects = listLocalProjects(this.state.state);
    const unavailableProjects = projects.filter(project => !project.available);
    const discovery = this.projectDiscoverySettings();
    const promptLibrary = this.promptLibrarySettings();
    const claude = this.claudeReadinessCheck();
    const sessions = listWorkSessions();
    const sessionIssues = listWorkSessionStoreIssues();
    const integrationCounts = projects.reduce((counts, project) => {
      const config = this.state.state?.projects[project.name]?.config;
      const gitlab = Boolean(config?.gitlab_project_id || config?.gitlab_project_path);
      const jenkins = Boolean(config?.jenkins_url);
      const sonar = Boolean(config?.sonar_project_key);
      return {
        projects: counts.projects + (gitlab || jenkins || sonar ? 1 : 0),
        gitlab: counts.gitlab + (gitlab ? 1 : 0),
        jenkins: counts.jenkins + (jenkins ? 1 : 0),
        sonar: counts.sonar + (sonar ? 1 : 0),
      };
    }, { projects: 0, gitlab: 0, jenkins: 0, sonar: 0 });
    const activePolling = this.activeProviderPollingSummary();
    const environment = this.providerEnvironmentLoad || {
      path: defaultProviderEnvPath(),
      present: false,
      parsed: 0,
      loaded: 0,
      skippedExisting: 0,
      invalid: 0,
    };
    const ticketCount = Object.keys(this.state.state?.tickets || {}).length;
    const readiness = providerReadiness();
    return buildOperationsReadiness({
      claude: { status: claude.status, detail: claude.detail },
      providerEnvironment: {
        path: environment.path,
        present: environment.present,
        invalid: environment.invalid,
        configuredProviders: [readiness.jira, readiness.gitlab, readiness.jenkins, readiness.sonar]
          .filter(provider => provider.configured).length,
        ...(environment.error ? { error: environment.error } : {}),
      },
      discovery: {
        roots: discovery.roots.length,
        depth: discovery.depth,
        limit: discovery.limit,
        hasWorkspaceFolders: Boolean(vscode.workspace.workspaceFolders?.length),
      },
      projects: {
        count: projects.length,
        unavailable: unavailableProjects.length,
        detail: projects.length === 0
          ? 'No local project is registered yet.'
          : `${projects.length} registered; ${unavailableProjects.length} unavailable. ${projects.map(project => `${project.displayName}: ${project.branch || (project.available ? 'Git branch unavailable' : 'folder unavailable')}`).join('; ')}.`,
        configuredIntegrations: integrationCounts.projects,
        gitlabTargets: integrationCounts.gitlab,
        jenkinsTargets: integrationCounts.jenkins,
        sonarTargets: integrationCounts.sonar,
      },
      workCatalog: {
        available: this.state.state !== null,
        tickets: ticketCount,
        issues: this.state.loadIssues.length,
        ...(this.state.loadIssues[0]
          ? { firstIssue: `${this.state.loadIssues[0].filePath}: ${this.state.loadIssues[0].detail}` }
          : {}),
      },
      jiraVisibility: {
        hideCompleted: this.hideCompletedJiraWork(),
        additionalCompletedStatuses: this.completedJiraStatuses().length,
      },
      promptLibrary: {
        localPaths: promptLibrary.localPaths.length,
        remoteUrls: promptLibrary.remoteUrls.length,
      },
      providers: [readiness.jira, readiness.gitlab, readiness.jenkins, readiness.sonar],
      providerDiagnostics: currentProviderReadDiagnostics(
        listMonitorEvents({ types: ['provider.transition'], limit: 2000 }),
        this.state.jiraRefreshStatus,
      ),
      polling: {
        activeTargets: activePolling.gitlab + activePolling.jenkins + activePolling.sonar,
        detail: activePolling.detail,
      },
      sessions: {
        count: sessions.length,
        issues: sessionIssues.length,
        ...(sessionIssues[0] ? { firstIssue: `${sessionIssues[0].filePath}: ${sessionIssues[0].detail}` } : {}),
      },
    });
  }

  private claudeReadinessCheck(): DoctorCheck {
    try {
      const launch = this.claudeLaunchPlan();
      const normalized = launch.validated;
      const availability = probeClaudeExecutableAvailability(launch.request.command);
      const permissionLabel = claudePermissionModeLabel(normalized.permissionMode);
      if (!availability.available) {
        return {
          name: 'Claude settings',
          status: 'fail',
          detail: `${availability.executable} was not found on the VS Code extension-host PATH. Your interactive terminal PATH may differ. Configured permission mode: ${permissionLabel}.`,
        };
      }
      if (!vscode.workspace.isTrusted) {
        return {
          name: 'Claude settings',
          status: 'warn',
          detail: `${availability.executable} is available and launch settings are valid, but explicit launch is disabled until this workspace is trusted. Configured permission mode: ${permissionLabel}.`,
        };
      }
      const branch = normalized.cwd ? readProjectGitBranch(normalized.cwd)?.branch : undefined;
      if (normalized.permissionMode === 'bypassPermissions') {
        return {
          name: 'Claude settings',
          status: 'warn',
          detail: `${availability.executable} is available; syntax and starting directory are valid. ${permissionLabel} is enabled and every explicit launch will require a modal warning${branch ? `; terminal tabs will show branch ${branch}` : ''}.`,
        };
      }
      if (normalized.permissionMode === 'auto') {
        return {
          name: 'Claude settings',
          status: 'warn',
          detail: `${availability.executable} is available; syntax and starting directory are valid. Auto permission mode reduces routine prompts and requires a supported Claude CLI, model, and account${branch ? `; terminal tabs will show branch ${branch}` : ''}.`,
        };
      }
      return {
        name: 'Claude settings',
        status: 'pass',
        detail: `${availability.executable} is available; syntax and starting directory are valid; permission mode ${permissionLabel}${branch ? `; terminal tabs will show branch ${branch}` : ''}.`,
      };
    } catch (error: unknown) {
      return {
        name: 'Claude settings',
        status: 'fail',
        detail: boundedOperationFailure(error, 'Claude settings are invalid.').display,
      };
    }
  }

  private activeProviderPollingSummary(): {
    sessions: number;
    gitlab: number;
    jenkins: number;
    sonar: number;
    detail: string;
  } {
    const registeredProjects = listLocalProjects(this.state.state)
      .filter(project => project.available)
      .map(project => ({ project, config: this.state.state?.projects[project.name]?.config || {} }))
      .filter(({ config }) => configuredProjectPollingEnabled(config));
    const legacySessions = [...new Map(listWorkSessions({ status: 'active', monitoringEnabled: true })
      .filter(session => session.ticketKeys.length > 0)
      .filter(session => !registeredProjects.some(({ project }) => matchesLocalProject(session, project)))
      .map(session => [localProjectReferenceKey(session) || session.id, session])).values()];
    const counts = {
      sessions: registeredProjects.length + legacySessions.length,
      gitlab: 0,
      jenkins: 0,
      sonar: 0,
    };
    for (const { config } of registeredProjects) {
      if (config.gitlab_project_id || config.gitlab_project_path) { counts.gitlab += 1; }
      if (config.jenkins_url || config.branch_profiles?.some(profile => profile.jenkins_url)) { counts.jenkins += 1; }
      if (config.sonar_project_key || config.branch_profiles?.some(profile => profile.sonar_project_key)) { counts.sonar += 1; }
    }
    for (const session of legacySessions) {
      const ticketKey = session.kind === 'ticket' ? session.ticketKey : session.ticketKeys[0];
      if (!ticketKey) { continue; }
      const ticket = this.state.state?.tickets[ticketKey];
      if (!ticket) { continue; }
      for (const status of this.providerPollingViewStatus(ticketKey, ticket, session)) {
        if (status.provider === 'GitLab' && (status.state === 'active' || status.state === 'discovering')) { counts.gitlab += 1; }
        if (status.provider === 'Jenkins' && status.state === 'active') { counts.jenkins += 1; }
        if (status.provider === 'SonarQube' && status.state === 'active') { counts.sonar += 1; }
      }
    }
    return {
      ...counts,
      detail: counts.sessions === 0
        ? 'No project has provider updates configured. Configure a registered project to start automatic checks; no Jira link or terminal Session is required.'
        : `${registeredProjects.length} registered project${registeredProjects.length === 1 ? '' : 's'} checked automatically${legacySessions.length > 0 ? `; ${legacySessions.length} ticket-linked Session${legacySessions.length === 1 ? '' : 's'} also checked` : ''}. Sources: GitLab ${counts.gitlab}, Jenkins ${counts.jenkins}, SonarQube ${counts.sonar}.`,
    };
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
      void vscode.window.showWarningMessage('No Jira work is loaded. Refresh Work or run Kronos: Check Setup.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(entries.map(([ticketKey, ticket]) => ({
      label: ticketKey,
      description: ticket.summary,
      detail: `${ticket.jira_status} • Jira ${ticket.jira_project_key || 'unknown'} • local ${ticket.linked_local_project || 'unlinked'}`,
      ticketKey,
    })), { title: 'Choose a Jira ticket', matchOnDescription: true, matchOnDetail: true });
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
        this.log('Could not read selected work session.', boundedOperationFailure(error, 'Invalid work session.').display);
      }
    }
    const ticketKey = normalizeTicketKey(stringProperty(argument, 'ticketKey'));
    if (ticketKey) {
      const session = getWorkSessionForTicketContext(ticketKey);
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
    })), { title: 'Choose a Session' });
    return pick?.session;
  }

  private async resolveGitLabInsertionTarget(
    ticketKey: string,
    ticket: Ticket,
  ): Promise<GitLabInsertionTarget | undefined> {
    const session = getWorkSessionForTicketContext(ticketKey);
    const configuredProject = configuredGitLabProjectIdentity(this.projectConfig(ticket));
    const knownTarget = reconcileKnownGitLabMergeRequestTarget(ticket, session, configuredProject);
    if (knownTarget) {
      return {
        iid: knownTarget.iid,
        projectIdOrPath: knownTarget.projectIdOrPath,
        ...(knownTarget.url ? { url: knownTarget.url } : {}),
      };
    }

    if (!configuredProject) {
      void vscode.window.showWarningMessage(
        `${ticketKey} needs a GitLab project ID or group/project path. Configure the linked project and Kronos will find its open merge request.`,
      );
      return undefined;
    }

    const sourceBranch = mergeRequestDiscoverySourceBranch(
      ticket,
      session?.projectPath ? readProjectGitBranch(session.projectPath)?.branch : undefined,
    );
    let discovery;
    try {
      discovery = await gitlabRestClient.discoverOpenMergeRequest({
        projectIdOrPath: configuredProject,
        ticketKey,
        ...(sourceBranch ? { sourceBranch } : {}),
      });
    } catch (error: unknown) {
      const detail = boundedOperationFailure(error, 'GitLab merge-request discovery failed.').display;
      this.log(`Could not find a GitLab merge request for ${ticketKey}.`, detail);
      void vscode.window.showWarningMessage(detail);
      return undefined;
    }
    if (!discovery.match) {
      void vscode.window.showWarningMessage(discovery.ambiguous
        ? `${ticketKey} has ${discovery.candidateCount} possible open merge requests. Kronos will not guess; use a unique ticket key in the title or description, or work from its source branch.`
        : `No unique open merge request matches ${ticketKey}${sourceBranch ? ` or branch ${sourceBranch}` : ''} yet. GitLab polling will keep checking automatically.`);
      return undefined;
    }
    const target: GitLabInsertionTarget = {
      iid: discovery.match.iid,
      projectIdOrPath: configuredProject,
    };
    if (discovery.match.webUrl) { target.url = discovery.match.webUrl; }
    if (session?.status === 'active') {
      const bindingInput: Parameters<typeof addWorkSessionProviderBinding>[1] = {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(target.iid),
        projectId: configuredProject,
      };
      if (target.url) { bindingInput.url = target.url; }
      addWorkSessionProviderBinding(session.id, bindingInput);
      this.refreshTerminalFirstViews();
    }
    return target;
  }

  private async resolveProjectGitLabInsertionTarget(
    project: RegisteredProjectCommandTarget,
  ): Promise<GitLabInsertionTarget | undefined> {
    const discovery = await this.discoverRegisteredProjectGitLabTarget(project);
    if (discovery.kind === 'matched') { return discovery.target; }
    if (discovery.kind === 'unconfigured') {
      void vscode.window.showWarningMessage(
        `${project.displayName || project.projectName} needs a GitLab project ID or group/project path before Kronos can find its merge request.`,
      );
      return undefined;
    }
    if (discovery.kind === 'failed') {
      this.log(`Could not find a GitLab merge request for ${project.projectName}.`, discovery.detail);
      void vscode.window.showWarningMessage(discovery.detail);
      return undefined;
    }
    void vscode.window.showWarningMessage(discovery.kind === 'ambiguous'
      ? `${project.displayName || project.projectName} has ${discovery.candidateCount} open merge requests for ${discovery.sourceBranch || 'the current project'}. Kronos will not guess or use an older saved merge request.`
      : `No unique open merge request matches ${discovery.sourceBranch ? `branch ${discovery.sourceBranch}` : project.displayName || project.projectName} yet. Project polling will keep checking automatically.`);
    return undefined;
  }

  private async discoverRegisteredProjectGitLabTarget(
    project: RegisteredProjectCommandTarget,
  ): Promise<RegisteredProjectGitLabDiscovery> {
    const storedProject = this.state.state?.projects[project.projectName];
    const configuredProject = configuredGitLabProjectIdentity(storedProject?.config);
    if (!configuredProject) { return { kind: 'unconfigured' }; }
    const sourceBranch = mergeRequestDiscoverySourceBranch(
      undefined,
      readProjectGitBranch(project.projectPath)?.branch,
    );
    let discovery;
    try {
      discovery = await gitlabRestClient.discoverOpenMergeRequest({
        projectIdOrPath: configuredProject,
        ...(sourceBranch ? { sourceBranch } : {}),
      });
    } catch (error: unknown) {
      return {
        kind: 'failed',
        detail: boundedOperationFailure(error, 'GitLab merge-request discovery failed.').display,
        ...(sourceBranch ? { sourceBranch } : {}),
      };
    }
    if (!discovery.match) {
      return discovery.ambiguous
        ? { kind: 'ambiguous', candidateCount: discovery.candidateCount, ...(sourceBranch ? { sourceBranch } : {}) }
        : { kind: 'not-found', ...(sourceBranch ? { sourceBranch } : {}) };
    }
    const target: GitLabInsertionTarget = {
      iid: discovery.match.iid,
      projectIdOrPath: configuredProject,
      ...(discovery.match.webUrl ? { url: discovery.match.webUrl } : {}),
    };
    const monitor = ensureProjectMonitoringRecord({
      name: project.projectName,
      path: project.projectPath,
      ...(storedProject?.display_name ? { displayName: storedProject.display_name } : {}),
      seedBindings: listWorkSessions()
        .filter(session => matchesLocalProject(session, { name: project.projectName, path: project.projectPath }))
        .flatMap(session => session.providerBindings),
    });
    const knownTarget = reconcileKnownGitLabMergeRequestTarget(undefined, monitor, configuredProject);
    if (!knownTarget
      || knownTarget.iid !== target.iid
      || knownTarget.projectIdOrPath !== target.projectIdOrPath
      || (target.url && knownTarget.url !== target.url)) {
      addProjectMonitoringProviderBinding(monitor.id, {
        provider: 'gitlab',
        resource: 'merge-request',
        subjectId: String(target.iid),
        projectId: configuredProject,
        ...(target.url ? { url: target.url } : {}),
      });
      this.refreshTerminalFirstViews();
    }
    return { kind: 'matched', target, ...(sourceBranch ? { sourceBranch } : {}) };
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
      markWorkSessionTerminalClosed(binding.sessionId, binding.bindingId, 'Terminal closed by the operator.');
      this.appendTerminalDetachedEvent(binding, 'closed-by-operator');
    } catch (error: unknown) {
      this.log('Could not persist a closed terminal attachment.', boundedOperationFailure(error, 'Terminal detach failed.').display);
    }
    this.refreshTerminalFirstViews();
  }

  private refreshTerminalFirstViews(): void {
    this.workTree.refresh();
    this.sessionTree.refresh();
    this.projectTree.refresh();
    this.attentionTree.refresh();
    this.refreshTicketPanels();
    this.renderJiraBoardPanel();
    this.renderOperationsPanels();
  }

  private async runProgress(
    title: string,
    task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Promise<void>,
  ): Promise<void> {
    try {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, task);
    } catch (error: unknown) {
      const detail = isOperationStageOutcomeError(error)
        ? error.outcome.display
        : boundedOperationFailure(error, `${title} failed.`).display;
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
      void vscode.window.showWarningMessage(boundedOperationFailure(error, 'Kronos refused an invalid provider URL.').display);
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

function localEvidenceSearchIcon(kind: LocalEvidenceSearchEntry['kind']): string {
  if (kind === 'session') { return 'terminal'; }
  if (kind === 'ticket') { return 'issues'; }
  if (kind === 'project') { return 'repo'; }
  if (kind === 'provider') { return 'plug'; }
  if (kind === 'artifact') { return 'file-text'; }
  return 'history';
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) { return undefined; }
  const candidate = value[key];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function projectTargetStringProperty(value: unknown, key: 'projectName' | 'projectPath'): string | undefined {
  const direct = stringProperty(value, key);
  if (direct || !isRecord(value)) { return direct; }
  return stringProperty(value['target'], key);
}

function providerOpenChoices(value: unknown): Array<{ label: string; description?: string; url: string }> {
  if (!isRecord(value) || !Array.isArray(value['providerChoices'])) { return []; }
  const choices: Array<{ label: string; description?: string; url: string }> = [];
  for (const item of value['providerChoices'].slice(0, 100)) {
    if (!isRecord(item)) { continue; }
    const label = safeProjectName(item['label']);
    const description = safeProjectName(item['description']);
    const url = typeof item['url'] === 'string' && item['url'].length <= 8_192 ? item['url'].trim() : '';
    if (!label || !url) { continue; }
    choices.push({ label, ...(description ? { description } : {}), url });
  }
  return choices;
}

function safeProjectName(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    : '';
}

function configuredProjectPollingEnabled(config: ProjectConfig): boolean {
  return Boolean(
    config.gitlab_project_id
      || config.gitlab_project_path
      || config.jenkins_url
      || config.sonar_project_key
      || config.branch_profiles?.some(profile => profile.jenkins_url || profile.sonar_project_key),
  );
}

function sonarProjectKeySuggestion(...values: unknown[]): string | undefined {
  for (const value of values) {
    const candidate = safeProjectName(value);
    if (candidate && /^[A-Za-z0-9_.:-]{1,400}$/.test(candidate)) { return candidate; }
  }
  return undefined;
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

function workCompletionLabel(value: 'active' | 'completed' | 'all'): string {
  if (value === 'completed') { return 'Completed'; }
  if (value === 'all') { return 'All'; }
  return 'Active';
}

function promptLibrarySourceKindLabel(sourceKind: PromptLibrarySourceKind): string {
  return PROMPT_LIBRARY_SOURCE_KIND_LABELS[sourceKind];
}

function boundedIntegerSetting(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function contextProviderReadStep(complete: boolean, detail: string): OperationStageInput {
  return { state: complete ? 'succeeded' : 'partial', detail };
}

function contextSnapshotStep(complete: boolean): OperationStageInput {
  return {
    state: complete ? 'succeeded' : 'partial',
    detail: complete
      ? 'The normalized bounded evidence snapshot is complete.'
      : 'The normalized snapshot retains the last valid or available evidence plus explicit warnings.',
  };
}

function attentionEventComposerEvidence(context: AttentionEventPromptContext): ContextComposerEvidenceItem[] {
  const event = context.event;
  const evidence: ContextComposerEvidenceItem[] = [{
    label: 'Exact retained transition',
    detail: [
      `Provider: ${context.provider}`,
      `Severity: ${context.severity}`,
      `Observed: ${event.at}`,
      context.projectName ? `Project: ${context.projectName}` : '',
      context.ticketKey ? `Jira: ${context.ticketKey}` : '',
    ].filter(Boolean).join(' • '),
  }];
  if (event.subject) {
    evidence.push({
      label: 'Subject',
      detail: `${event.subject.kind}: ${event.subject.id}`,
    });
  }
  if (event.before || event.after) {
    evidence.push({
      label: 'State change',
      detail: `${event.before?.state || 'not recorded'} → ${event.after?.state || 'not recorded'}`,
    });
  }
  const metadata = Object.entries(event.metadata || {}).slice(0, 16);
  if (metadata.length > 0) {
    evidence.push({
      label: 'Event details',
      detail: metadata.map(([key, value]) => `${key}: ${String(value)}`).join('\n'),
    });
  }
  return evidence;
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

function gitLabComposerEvidence(context: GitLabProviderContext): ContextComposerEvidenceItem[] {
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

function ciComposerEvidence(
  jenkins: JenkinsBuildContext | undefined,
  sonar: SonarBranchContext | undefined,
): ContextComposerEvidenceItem[] {
  const evidence: ContextComposerEvidenceItem[] = [];
  if (jenkins) {
    const testSummary = jenkins.tests
      ? `${jenkins.tests.passCount} passed • ${jenkins.tests.failCount} failed • ${jenkins.tests.skipCount} skipped`
      : `test report ${jenkins.completeness.testReport}`;
    evidence.push({
      label: `Jenkins #${jenkins.build.number} • ${jenkins.build.status}`,
      detail: `${testSummary} • ${jenkins.stages?.length || 0} stages • fetched ${jenkins.fetchedAt}`,
    });
    for (const failedCase of jenkins.tests?.failedCases.slice(0, 8) || []) {
      evidence.push({
        label: `Failed test • ${failedCase.className ? `${failedCase.className}.` : ''}${failedCase.name}`,
        detail: contextComposerPreview(failedCase.errorDetails || failedCase.errorStackTrace || failedCase.status),
      });
    }
    for (const stage of (jenkins.stages || []).filter(stage => !['SUCCESS', 'NOT_BUILT'].includes(stage.status.toUpperCase())).slice(0, 8)) {
      evidence.push({ label: `Jenkins stage • ${stage.name}`, detail: stage.status });
    }
  }
  if (sonar) {
    evidence.push({
      label: `SonarQube • ${sonar.projectKey} • ${sonar.branch}`,
      detail: `Quality gate ${sonar.qualityGate.status} • ${sonar.issues.length} issues fetched • fetched ${sonar.fetchedAt}`,
    });
    if (sonar.measures.length > 0) {
      evidence.push({
        label: 'SonarQube measures',
        detail: sonar.measures.slice(0, 20).map(measure => `${measure.metric}: ${measure.value ?? measure.periodValue ?? 'unavailable'}`).join('\n'),
      });
    }
    for (const issue of sonar.issues.slice(0, 8)) {
      evidence.push({
        label: `SonarQube issue${issue.severity ? ` • ${issue.severity}` : ''}${issue.line ? ` • line ${issue.line}` : ''}`,
        detail: contextComposerPreview(issue.message),
      });
    }
  }
  return evidence.slice(0, 24);
}

function contextComposerPreview(value: string, maxLength = 4_000): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, ' ').trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
}
