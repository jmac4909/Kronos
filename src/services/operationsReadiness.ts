import type { ProviderReadiness } from './providerReadiness';
import type { ProviderReadDiagnostic } from './providerReadDiagnostics';

export type OperationsReadinessStatus = 'pass' | 'warn' | 'fail';
export type OperationsReadinessSurface = 'setup' | 'doctor';
export type OperationsReadinessAction =
  | 'refreshPanel'
  | 'openSettings'
  | 'openClaudeSettings'
  | 'configureClaudeSessionTracking'
  | 'openProviderEnvironment'
  | 'openPromptLibrarySettings'
  | 'chooseProjectDiscoveryFolders'
  | 'openProjectsView'
  | 'openSessionsView'
  | 'configureProjectIntegrations'
  | 'openJiraBoard'
  | 'pollProvidersNow';

export interface OperationsReadinessItem {
  id: string;
  title: string;
  detail: string;
  status: OperationsReadinessStatus;
  action: OperationsReadinessAction;
  actionLabel: string;
  actionWhenReady?: boolean;
  surfaces: readonly OperationsReadinessSurface[];
}

export interface OperationsReadinessInput {
  claude: { status: OperationsReadinessStatus; detail: string };
  claudeSessionTracking: { status: OperationsReadinessStatus; detail: string; actionLabel: string };
  providerEnvironment: {
    present: boolean;
    invalid: number;
    configuredProviders: number;
    error?: string;
    path: string;
  };
  discovery: { roots: number; depth: number; limit: number; hasWorkspaceFolders: boolean };
  projects: {
    count: number;
    unavailable: number;
    detail: string;
    configuredIntegrations: number;
    gitlabTargets: number;
    jenkinsTargets: number;
    sonarTargets: number;
  };
  workCatalog: { available: boolean; tickets: number; issues: number; firstIssue?: string };
  jiraVisibility: { hideCompleted: boolean; additionalCompletedStatuses: number };
  promptLibrary: { localPaths: number; remoteUrls: number };
  providers: readonly ProviderReadiness[];
  providerDiagnostics?: readonly ProviderReadDiagnostic[];
  polling: { activeTargets: number; detail: string };
  sessions: { count: number; issues: number; firstIssue?: string };
}

/** One canonical snapshot feeds both Setup and Doctor. */
export function buildOperationsReadiness(input: OperationsReadinessInput): OperationsReadinessItem[] {
  const providerEnvironmentStatus: OperationsReadinessStatus = input.providerEnvironment.error
    ? 'fail'
    : input.providerEnvironment.invalid > 0
      ? 'warn'
      : input.providerEnvironment.present || input.providerEnvironment.configuredProviders > 0 ? 'pass' : 'warn';
  const projectStatus: OperationsReadinessStatus = input.projects.unavailable > 0
    ? 'fail'
    : input.projects.count > 0 ? 'pass' : 'warn';
  const workCatalogStatus: OperationsReadinessStatus = !input.workCatalog.available || input.workCatalog.issues > 0
    ? 'fail'
    : input.workCatalog.tickets > 0 ? 'pass' : 'warn';
  const integrationStatus: OperationsReadinessStatus = input.projects.count > 0
    && input.projects.configuredIntegrations === input.projects.count ? 'pass' : 'warn';
  const sessionStatus: OperationsReadinessStatus = input.sessions.issues > 0 ? 'fail' : 'pass';
  const both = ['setup', 'doctor'] as const;

  return [
    {
      id: 'claude-launch',
      title: 'Claude settings',
      detail: input.claude.detail,
      status: input.claude.status,
      action: 'openClaudeSettings',
      actionLabel: 'Claude Settings',
      surfaces: both,
    },
    {
      id: 'claude-session-tracking',
      title: 'Claude Session tracking',
      detail: input.claudeSessionTracking.detail,
      status: input.claudeSessionTracking.status,
      action: 'configureClaudeSessionTracking',
      actionLabel: input.claudeSessionTracking.actionLabel,
      actionWhenReady: false,
      surfaces: both,
    },
    {
      id: 'provider-environment',
      title: 'Provider access',
      detail: providerEnvironmentDetail(input.providerEnvironment),
      status: providerEnvironmentStatus,
      action: 'openProviderEnvironment',
      actionLabel: 'Open Provider Config',
      surfaces: both,
    },
    {
      id: 'project-discovery',
      title: 'Project folders',
      detail: `${input.discovery.roots} parent folder${input.discovery.roots === 1 ? '' : 's'} selected. Open workspace folders are included automatically.`,
      status: input.discovery.roots > 0 || input.discovery.hasWorkspaceFolders ? 'pass' : 'warn',
      action: 'chooseProjectDiscoveryFolders',
      actionLabel: 'Choose Folders',
      surfaces: both,
    },
    {
      id: 'local-projects',
      title: 'Projects',
      detail: input.projects.detail,
      status: projectStatus,
      action: 'openProjectsView',
      actionLabel: 'Open Projects',
      surfaces: both,
    },
    {
      id: 'work-catalog',
      title: 'Jira tickets',
      detail: `${input.workCatalog.tickets} Jira ticket${input.workCatalog.tickets === 1 ? '' : 's'} ready; ${input.workCatalog.issues} local record problem${input.workCatalog.issues === 1 ? '' : 's'}${input.workCatalog.firstIssue ? ` — ${input.workCatalog.firstIssue}` : ''}.`,
      status: workCatalogStatus,
      action: 'openJiraBoard',
      actionLabel: 'Open Jira Board',
      surfaces: both,
    },
    {
      id: 'jira-visibility',
      title: 'Jira visibility',
      detail: `${input.jiraVisibility.hideCompleted ? 'Completed work hidden by default' : 'Completed work shown by default'}; ${input.jiraVisibility.additionalCompletedStatuses} additional completed status name${input.jiraVisibility.additionalCompletedStatuses === 1 ? '' : 's'}.`,
      status: 'pass',
      action: 'openSettings',
      actionLabel: 'Visibility Settings',
      surfaces: ['doctor'],
    },
    {
      id: 'prompt-library',
      title: 'Team prompt library',
      detail: promptLibraryDetail(input.promptLibrary),
      status: input.promptLibrary.localPaths > 0 || input.promptLibrary.remoteUrls > 0 ? 'pass' : 'warn',
      action: 'openPromptLibrarySettings',
      actionLabel: 'Prompt Library Settings',
      surfaces: both,
    },
    ...input.providers.map(provider => providerItem(
      provider,
      input.providerDiagnostics?.find(diagnostic => diagnostic.provider === provider.id),
    )),
    {
      id: 'project-integrations',
      title: 'Project integrations',
      detail: input.projects.count === 0
        ? 'Register a project before connecting GitLab, Jenkins, or SonarQube.'
        : `${input.projects.configuredIntegrations}/${input.projects.count} project${input.projects.count === 1 ? '' : 's'} connected · GitLab ${input.projects.gitlabTargets} · Jenkins ${input.projects.jenkinsTargets} · SonarQube ${input.projects.sonarTargets}.`,
      status: integrationStatus,
      action: 'configureProjectIntegrations',
      actionLabel: 'Configure Integrations',
      surfaces: both,
    },
    {
      id: 'automatic-polling',
      title: 'Provider updates',
      detail: input.polling.detail,
      status: input.polling.activeTargets > 0 ? 'pass' : 'warn',
      action: 'pollProvidersNow',
      actionLabel: 'Check Now',
      surfaces: both,
    },
    {
      id: 'session-state',
      title: 'Sessions',
      detail: `${input.sessions.count} session${input.sessions.count === 1 ? '' : 's'}; ${input.sessions.issues} record problem${input.sessions.issues === 1 ? '' : 's'}${input.sessions.firstIssue ? ` — ${input.sessions.firstIssue}` : ''}.`,
      status: sessionStatus,
      action: 'openSessionsView',
      actionLabel: 'Open Sessions',
      surfaces: both,
    },
  ];
}

function promptLibraryDetail(input: OperationsReadinessInput['promptLibrary']): string {
  if (input.localPaths === 0 && input.remoteUrls === 0) {
    return 'No prompt sources configured. Add a local prompt file, a raw HTTPS Git URL, or both.';
  }
  return `${input.localPaths} local source${input.localPaths === 1 ? '' : 's'} and ${input.remoteUrls} remote source${input.remoteUrls === 1 ? '' : 's'} configured. Remote prompts refresh when the library opens; the last available copy stays available offline.`;
}

function providerItem(
  provider: ProviderReadiness,
  diagnostic: ProviderReadDiagnostic | undefined,
): OperationsReadinessItem {
  const currentDiagnostic = provider.state === 'ready' ? diagnostic : undefined;
  return {
    id: `provider-${provider.id}`,
    title: provider.name,
    detail: currentDiagnostic
      ? `${provider.detail} Latest check: ${currentDiagnostic.detail}${currentDiagnostic.observedAt ? ` Observed ${currentDiagnostic.observedAt}.` : ''}`
      : `${provider.detail} Next: ${provider.nextAction}`,
    status: currentDiagnostic?.status
      || (provider.state === 'ready' ? 'pass' : provider.state === 'missing' ? 'warn' : 'fail'),
    action: currentDiagnostic?.action || 'openProviderEnvironment',
    actionLabel: currentDiagnostic?.actionLabel
      || (provider.state === 'ready' ? 'Open Provider Config' : 'Fix Provider Config'),
    actionWhenReady: false,
    surfaces: ['setup', 'doctor'],
  };
}

function providerEnvironmentDetail(input: OperationsReadinessInput['providerEnvironment']): string {
  if (input.error) { return `${input.path}: ${input.error}`; }
  if (!input.present) {
    if (input.configuredProviders > 0) {
      return `${input.configuredProviders} provider${input.configuredProviders === 1 ? '' : 's'} available from your environment. Values are never shown. Config file: ${input.path}.`;
    }
    return `No provider config file yet. Open it to create a private template. Values are never shown. File: ${input.path}.`;
  }
  if (input.invalid > 0) {
    return `${input.invalid} config entr${input.invalid === 1 ? 'y needs' : 'ies need'} attention. Values are never shown. File: ${input.path}.`;
  }
  return `Provider config is ready. Values are never shown. File: ${input.path}.`;
}
