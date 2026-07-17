export type TerminalFirstCommandHandler = (...args: unknown[]) => unknown;

export interface TerminalFirstCommandHandlers {
  work: {
    refreshTickets: TerminalFirstCommandHandler;
    openJiraBoard: TerminalFirstCommandHandler;
    filterWork: TerminalFirstCommandHandler;
    clearWorkFilter: TerminalFirstCommandHandler;
    openTicketWorkspace: TerminalFirstCommandHandler;
    chooseTicketProject: TerminalFirstCommandHandler;
  };
  terminals: {
    newClaudeSession: TerminalFirstCommandHandler;
    startClaudeForTicket: TerminalFirstCommandHandler;
    manageActiveTerminal: TerminalFirstCommandHandler;
  };
  context: {
    insertJiraContext: TerminalFirstCommandHandler;
    insertOtherTicket: TerminalFirstCommandHandler;
    insertGitLabContext: TerminalFirstCommandHandler;
    insertCiContext: TerminalFirstCommandHandler;
    openContextBasket: TerminalFirstCommandHandler;
    openPromptLibrary: TerminalFirstCommandHandler;
    searchLocalEvidence: TerminalFirstCommandHandler;
    createLocalHandoff: TerminalFirstCommandHandler;
  };
  sessions: {
    pollManagedWorkSessions: TerminalFirstCommandHandler;
    openWorkSessionAudit: TerminalFirstCommandHandler;
    focusWorkSessionTerminal: TerminalFirstCommandHandler;
    reattachWorkSessionTerminal: TerminalFirstCommandHandler;
    detachWorkSessionTerminal: TerminalFirstCommandHandler;
    closeWorkSession: TerminalFirstCommandHandler;
    removeWorkSession: TerminalFirstCommandHandler;
    pauseWorkSessionMonitoring: TerminalFirstCommandHandler;
    resumeWorkSessionMonitoring: TerminalFirstCommandHandler;
  };
  projects: {
    configureProjectDiscoveryFolders: TerminalFirstCommandHandler;
    registerWorkspaceProject: TerminalFirstCommandHandler;
    refreshProjects: TerminalFirstCommandHandler;
    renameLocalProject: TerminalFirstCommandHandler;
    openProjectGitStatus: TerminalFirstCommandHandler;
    insertProjectGitContext: TerminalFirstCommandHandler;
    openProjectMergeRequest: TerminalFirstCommandHandler;
    insertProjectGitLabContext: TerminalFirstCommandHandler;
    insertProjectCiContext: TerminalFirstCommandHandler;
    configureProjectIntegrations: TerminalFirstCommandHandler;
  };
  attention: {
    insertAttentionEventContext: TerminalFirstCommandHandler;
    acknowledgeAttention: TerminalFirstCommandHandler;
    openProvider: TerminalFirstCommandHandler;
  };
  operations: {
    setup: TerminalFirstCommandHandler;
    doctor: TerminalFirstCommandHandler;
    settings: TerminalFirstCommandHandler;
  };
}

export interface TerminalFirstCommandRoute {
  id: `kronos.${string}`;
  area: keyof TerminalFirstCommandHandlers;
  action: string;
}

export interface TerminalFirstCommandDisposable {
  dispose(): unknown;
}

export type TerminalFirstCommandRegistrar = (
  id: string,
  handler: TerminalFirstCommandHandler,
) => TerminalFirstCommandDisposable;

const COMMAND_ROUTES = Object.freeze([
  route('kronos.refreshTickets', 'work', 'refreshTickets'),
  route('kronos.openJiraBoard', 'work', 'openJiraBoard'),
  route('kronos.filterWork', 'work', 'filterWork'),
  route('kronos.clearWorkFilter', 'work', 'clearWorkFilter'),
  route('kronos.openTicketWorkspace', 'work', 'openTicketWorkspace'),
  route('kronos.configureProjectDiscoveryFolders', 'projects', 'configureProjectDiscoveryFolders'),
  route('kronos.registerWorkspaceProject', 'projects', 'registerWorkspaceProject'),
  route('kronos.chooseTicketProject', 'work', 'chooseTicketProject'),
  route('kronos.newClaudeSession', 'terminals', 'newClaudeSession'),
  route('kronos.startClaudeForTicket', 'terminals', 'startClaudeForTicket'),
  route('kronos.manageActiveTerminal', 'terminals', 'manageActiveTerminal'),
  route('kronos.insertJiraContext', 'context', 'insertJiraContext'),
  route('kronos.insertOtherTicket', 'context', 'insertOtherTicket'),
  route('kronos.insertGitLabContext', 'context', 'insertGitLabContext'),
  route('kronos.insertCiContext', 'context', 'insertCiContext'),
  route('kronos.openContextBasket', 'context', 'openContextBasket'),
  route('kronos.openPromptLibrary', 'context', 'openPromptLibrary'),
  route('kronos.searchLocalEvidence', 'context', 'searchLocalEvidence'),
  route('kronos.createLocalHandoff', 'context', 'createLocalHandoff'),
  route('kronos.pollManagedWorkSessions', 'sessions', 'pollManagedWorkSessions'),
  route('kronos.openWorkSessionAudit', 'sessions', 'openWorkSessionAudit'),
  route('kronos.focusWorkSessionTerminal', 'sessions', 'focusWorkSessionTerminal'),
  route('kronos.reattachWorkSessionTerminal', 'sessions', 'reattachWorkSessionTerminal'),
  route('kronos.detachWorkSessionTerminal', 'sessions', 'detachWorkSessionTerminal'),
  route('kronos.closeWorkSession', 'sessions', 'closeWorkSession'),
  route('kronos.removeWorkSession', 'sessions', 'removeWorkSession'),
  route('kronos.refreshProjects', 'projects', 'refreshProjects'),
  route('kronos.renameLocalProject', 'projects', 'renameLocalProject'),
  route('kronos.openProjectGitStatus', 'projects', 'openProjectGitStatus'),
  route('kronos.insertProjectGitContext', 'projects', 'insertProjectGitContext'),
  route('kronos.openProjectMergeRequest', 'projects', 'openProjectMergeRequest'),
  route('kronos.insertProjectGitLabContext', 'projects', 'insertProjectGitLabContext'),
  route('kronos.insertProjectCiContext', 'projects', 'insertProjectCiContext'),
  route('kronos.configureProjectIntegrations', 'projects', 'configureProjectIntegrations'),
  route('kronos.pauseWorkSessionMonitoring', 'sessions', 'pauseWorkSessionMonitoring'),
  route('kronos.resumeWorkSessionMonitoring', 'sessions', 'resumeWorkSessionMonitoring'),
  route('kronos.insertAttentionEventContext', 'attention', 'insertAttentionEventContext'),
  route('kronos.acknowledgeAttention', 'attention', 'acknowledgeAttention'),
  route('kronos.openProvider', 'attention', 'openProvider'),
  route('kronos.setup', 'operations', 'setup'),
  route('kronos.doctor', 'operations', 'doctor'),
  route('kronos.settings', 'operations', 'settings'),
] satisfies readonly TerminalFirstCommandRoute[]);

/** Registers the exact public command surface through one audited responsibility map. */
export function registerTerminalFirstCommands(
  handlers: TerminalFirstCommandHandlers,
  registrar: TerminalFirstCommandRegistrar,
): TerminalFirstCommandDisposable[] {
  return COMMAND_ROUTES.map(item => {
    const area = handlers[item.area] as unknown as Record<string, TerminalFirstCommandHandler>;
    const handler = area[item.action];
    if (typeof handler !== 'function') {
      throw new Error(`Kronos command route ${item.id} has no ${item.area}.${item.action} handler.`);
    }
    return registrar(item.id, handler);
  });
}

export function terminalFirstCommandRouteInventory(): readonly TerminalFirstCommandRoute[] {
  return COMMAND_ROUTES;
}

function route<Area extends keyof TerminalFirstCommandHandlers>(
  id: `kronos.${string}`,
  area: Area,
  action: keyof TerminalFirstCommandHandlers[Area] & string,
): TerminalFirstCommandRoute {
  return { id, area, action };
}
