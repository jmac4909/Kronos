import type { ProjectConfig } from '../state/types';

export interface ProjectProviderCredentialReadiness {
  gitlab: boolean;
  jenkins: boolean;
  sonar: boolean;
}

export interface RegisteredProjectActionPresentation {
  label: string;
  icon: string;
  command: string;
  description?: string;
}

const REGISTERED_PROJECT_ACTIONS: readonly RegisteredProjectActionPresentation[] = Object.freeze([
  Object.freeze({
    label: 'Start Claude',
    icon: 'terminal',
    command: 'kronos.newClaudeSession',
    description: 'in this project',
  }),
  Object.freeze({
    label: 'Git state & branches',
    icon: 'git-branch',
    command: 'kronos.openProjectGitStatus',
    description: 'inspect and switch in Source Control',
  }),
  Object.freeze({
    label: 'Review local changes',
    icon: 'symbol-keyword',
    command: 'kronos.insertProjectGitContext',
    description: 'for terminal context',
  }),
  Object.freeze({ label: 'Open merge request', icon: 'git-merge', command: 'kronos.openProjectMergeRequest', description: 'in GitLab' }),
  Object.freeze({ label: 'Review merge request', icon: 'git-merge', command: 'kronos.insertProjectGitLabContext', description: 'for terminal context' }),
  Object.freeze({ label: 'Review build & quality', icon: 'beaker', command: 'kronos.insertProjectCiContext', description: 'for terminal context' }),
  Object.freeze({ label: 'Configure integrations', icon: 'settings-gear', command: 'kronos.configureProjectIntegrations', description: 'GitLab, Jenkins, SonarQube' }),
  Object.freeze({
    label: 'Rename project',
    icon: 'edit',
    command: 'kronos.renameLocalProject',
  }),
]);

/** One ordered action inventory keeps project launch, evidence, and setup controls intentional. */
export function registeredProjectActionInventory(): readonly RegisteredProjectActionPresentation[] {
  return REGISTERED_PROJECT_ACTIONS;
}

/**
 * Presents only readiness states. Provider identifiers and credential values
 * are deliberately absent from this view model.
 */
export function projectIntegrationStatusLines(
  config: ProjectConfig,
  credentials: ProjectProviderCredentialReadiness,
): string[] {
  return [
    providerStatus('GitLab', Boolean(config.gitlab_project_id || config.gitlab_project_path), credentials.gitlab),
    providerStatus('Jenkins', Boolean(config.jenkins_url), credentials.jenkins),
    providerStatus('SonarQube', Boolean(config.sonar_project_key), credentials.sonar),
  ];
}

function providerStatus(name: string, targetConfigured: boolean, credentialsReady: boolean): string {
  if (!targetConfigured) { return `${name}: add project`; }
  if (!credentialsReady) { return `${name}: credentials needed`; }
  return `${name}: ready`;
}
