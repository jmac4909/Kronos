import type { ProjectConfig } from '../state/types';
import type { ClaudePermissionMode } from './claudeTerminalLauncher';
import type { DoctorCheck, OperationsRuntimeGuide, SetupStep } from './operationsPanelView';
import type { OperationsReadinessItem } from './operationsReadiness';
import type { ProviderPollingViewStatus } from './ticketWorkspaceView';

export function runtimeSetupSteps(readiness: readonly OperationsReadinessItem[]): SetupStep[] {
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

export function runtimeDoctorChecks(readiness: readonly OperationsReadinessItem[]): DoctorCheck[] {
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

export function runtimeOperationsGuide(
  platform: NodeJS.Platform,
  privateStatePath: string,
  providerEnvPath: string,
): OperationsRuntimeGuide {
  const platformLabel = platform === 'win32'
    ? 'Windows'
    : platform === 'darwin' ? 'macOS' : platform === 'linux' ? 'Linux' : platform;
  return { platformLabel, privateStatePath, providerEnvPath };
}

export interface RuntimeClaudeReadinessInput {
  available: boolean;
  executable: string;
  trusted: boolean;
  permissionMode: ClaudePermissionMode;
  permissionLabel: string;
  branch?: string;
}

export function runtimeClaudeReadinessCheck(input: RuntimeClaudeReadinessInput): DoctorCheck {
  const branchDetail = input.branch ? `; terminal tabs will show branch ${input.branch}` : '';
  if (!input.available) {
    return {
      name: 'Claude settings',
      status: 'fail',
      detail: `${input.executable} was not found on the VS Code extension-host PATH. Your interactive terminal PATH may differ. Configured permission mode: ${input.permissionLabel}.`,
    };
  }
  if (!input.trusted) {
    return {
      name: 'Claude settings',
      status: 'warn',
      detail: `${input.executable} is available and launch settings are valid, but explicit launch is disabled until this workspace is trusted. Configured permission mode: ${input.permissionLabel}.`,
    };
  }
  if (input.permissionMode === 'bypassPermissions') {
    return {
      name: 'Claude settings',
      status: 'warn',
      detail: `${input.executable} is available; syntax and starting directory are valid. ${input.permissionLabel} is enabled and every explicit launch will require a modal warning${branchDetail}.`,
    };
  }
  if (input.permissionMode === 'auto') {
    return {
      name: 'Claude settings',
      status: 'warn',
      detail: `${input.executable} is available; syntax and starting directory are valid. Auto permission mode reduces routine prompts and requires a supported Claude CLI, model, and account${branchDetail}.`,
    };
  }
  return {
    name: 'Claude settings',
    status: 'pass',
    detail: `${input.executable} is available; syntax and starting directory are valid; permission mode ${input.permissionLabel}${branchDetail}.`,
  };
}

export interface RuntimeRegisteredPollingProject {
  config: ProjectConfig;
}

export interface RuntimeLegacyPollingSession {
  statuses: readonly ProviderPollingViewStatus[];
}

export interface RuntimeProviderPollingSummary {
  sessions: number;
  gitlab: number;
  jenkins: number;
  sonar: number;
  detail: string;
}

export function runtimeProviderPollingSummary(
  registeredProjects: readonly RuntimeRegisteredPollingProject[],
  legacySessions: readonly RuntimeLegacyPollingSession[],
): RuntimeProviderPollingSummary {
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
    for (const status of session.statuses) {
      if (status.provider === 'GitLab' && (status.state === 'active' || status.state === 'discovering')) {
        counts.gitlab += 1;
      }
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
