import type { ProviderReadiness } from './providerReadiness';
import type { ProviderReadDiagnostic } from './providerReadDiagnostics';

export type OperationsReadinessStatus = 'pass' | 'warn' | 'fail';
export type OperationsReadinessSurface = 'setup' | 'doctor';
export type OperationsReadinessAction =
  | 'refreshPanel'
  | 'openSettings'
  | 'openClaudeSettings'
  | 'openProviderEnvironment'
  | 'chooseProjectDiscoveryFolders'
  | 'manageLocalProjects'
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
  surfaces: readonly OperationsReadinessSurface[];
}

export interface OperationsReadinessInput {
  claude: { status: OperationsReadinessStatus; detail: string };
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
      title: 'Claude launch settings',
      detail: input.claude.detail,
      status: input.claude.status,
      action: 'openClaudeSettings',
      actionLabel: 'Claude Settings',
      surfaces: both,
    },
    {
      id: 'provider-environment',
      title: 'Private provider configuration',
      detail: providerEnvironmentDetail(input.providerEnvironment),
      status: providerEnvironmentStatus,
      action: 'openProviderEnvironment',
      actionLabel: 'Open Private Config',
      surfaces: both,
    },
    {
      id: 'project-discovery',
      title: 'Project discovery folders',
      detail: `${input.discovery.roots} selected parent folder${input.discovery.roots === 1 ? '' : 's'}; scan depth ${input.discovery.depth}; result limit ${input.discovery.limit}. Open workspace folders are included automatically.`,
      status: input.discovery.roots > 0 || input.discovery.hasWorkspaceFolders ? 'pass' : 'warn',
      action: 'chooseProjectDiscoveryFolders',
      actionLabel: 'Choose Folders',
      surfaces: both,
    },
    {
      id: 'local-projects',
      title: 'Registered local projects',
      detail: input.projects.detail,
      status: projectStatus,
      action: 'manageLocalProjects',
      actionLabel: 'Manage Projects',
      surfaces: both,
    },
    {
      id: 'work-catalog',
      title: 'Jira Work catalog',
      detail: `${input.workCatalog.tickets} Jira ticket${input.workCatalog.tickets === 1 ? '' : 's'}; ${input.workCatalog.issues} local issue${input.workCatalog.issues === 1 ? '' : 's'}${input.workCatalog.firstIssue ? ` — ${input.workCatalog.firstIssue}` : ''}.`,
      status: workCatalogStatus,
      action: 'openJiraBoard',
      actionLabel: 'Open Jira Board',
      surfaces: both,
    },
    {
      id: 'jira-visibility',
      title: 'Jira visibility settings',
      detail: `${input.jiraVisibility.hideCompleted ? 'Completed work hidden by default' : 'Completed work shown by default'}; ${input.jiraVisibility.additionalCompletedStatuses} additional completed status name${input.jiraVisibility.additionalCompletedStatuses === 1 ? '' : 's'}.`,
      status: 'pass',
      action: 'openSettings',
      actionLabel: 'Visibility Settings',
      surfaces: ['doctor'],
    },
    ...input.providers.map(provider => providerItem(
      provider,
      input.providerDiagnostics?.find(diagnostic => diagnostic.provider === provider.id),
    )),
    {
      id: 'project-integrations',
      title: 'Project polling targets',
      detail: input.projects.count === 0
        ? 'Register a local project before adding provider identifiers.'
        : `${input.projects.configuredIntegrations}/${input.projects.count} registered project${input.projects.count === 1 ? '' : 's'} have at least one optional polling target; GitLab ${input.projects.gitlabTargets}, Jenkins ${input.projects.jenkinsTargets}, SonarQube ${input.projects.sonarTargets}.`,
      status: integrationStatus,
      action: 'configureProjectIntegrations',
      actionLabel: 'Configure Integrations',
      surfaces: both,
    },
    {
      id: 'automatic-polling',
      title: 'Automatic provider polling',
      detail: input.polling.detail,
      status: input.polling.activeTargets > 0 ? 'pass' : 'warn',
      action: 'pollProvidersNow',
      actionLabel: 'Poll Now',
      surfaces: both,
    },
    {
      id: 'session-state',
      title: 'Private work-session state',
      detail: `${input.sessions.count} session${input.sessions.count === 1 ? '' : 's'}; ${input.sessions.issues} invalid record${input.sessions.issues === 1 ? '' : 's'}${input.sessions.firstIssue ? ` — ${input.sessions.firstIssue}` : ''}.`,
      status: sessionStatus,
      action: 'refreshPanel',
      actionLabel: 'Recheck State',
      surfaces: both,
    },
  ];
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
      ? `${provider.detail} Current live result: ${currentDiagnostic.detail}${currentDiagnostic.observedAt ? ` Observed ${currentDiagnostic.observedAt}.` : ''}`
      : `${provider.detail} Next: ${provider.nextAction}`,
    status: currentDiagnostic?.status
      || (provider.state === 'ready' ? 'pass' : provider.state === 'missing' ? 'warn' : 'fail'),
    action: currentDiagnostic?.action || 'openProviderEnvironment',
    actionLabel: currentDiagnostic?.actionLabel
      || (provider.state === 'ready' ? 'Review Private Config' : 'Repair Private Config'),
    surfaces: ['setup', 'doctor'],
  };
}

function providerEnvironmentDetail(input: OperationsReadinessInput['providerEnvironment']): string {
  if (input.error) { return `${input.path}: ${input.error}`; }
  if (!input.present) {
    if (input.configuredProviders > 0) {
      return `${input.path} is absent; ${input.configuredProviders} provider configuration${input.configuredProviders === 1 ? ' is' : 's are'} supplied by the extension-host environment. Credential values are never rendered.`;
    }
    return `${input.path} does not exist yet. Opening it creates a private comment-only template; credential values are never rendered by Kronos.`;
  }
  if (input.invalid > 0) {
    return `${input.path} is present with ${input.invalid} ignored or invalid entr${input.invalid === 1 ? 'y' : 'ies'}. Credential values are never rendered.`;
  }
  return `${input.path} is present and readable. Credential values are never rendered.`;
}
