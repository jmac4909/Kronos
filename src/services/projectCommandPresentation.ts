import type { KronosState, Ticket } from '../state/types';
import {
  formatProjectBranchProfiles,
  localProjectPathKey,
  type LocalProjectSummary,
} from './projectCatalog';
import type { DiscoveredProject } from './projectDiscovery';
import type { ProjectIntegrationFormProject } from './projectIntegrationView';
import { sonarProjectKeySuggestion } from './runtimePresentation';

export interface ProjectManagementChoice {
  label: string;
  description: string;
  detail: string;
  picked: boolean;
  registered: boolean;
  project: DiscoveredProject;
}

export function buildProjectManagementChoices(
  discoveredProjects: readonly DiscoveredProject[],
  registeredProjects: readonly LocalProjectSummary[],
): { choices: ProjectManagementChoice[]; registeredPathKeys: Set<string> } {
  const discoveredByPath = new Map(discoveredProjects.map(project => [localProjectPathKey(project.path), project]));
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
  const discoveredChoices = discoveredProjects
    .filter(project => !registeredPathKeys.has(localProjectPathKey(project.path)))
    .map(project => ({
      label: project.name,
      description: `Available • ${project.branch || 'Branch unavailable'} • ${project.source === 'workspace' ? 'Open workspace' : 'Project folder'}`,
      detail: project.path,
      picked: false,
      registered: false,
      project,
    }));
  return { choices: [...registeredChoices, ...discoveredChoices], registeredPathKeys };
}

export function planProjectRemoval(
  selected: readonly ProjectManagementChoice[],
  registeredProjects: readonly LocalProjectSummary[],
  tickets: Readonly<Record<string, Ticket>>,
): { removedProjects: LocalProjectSummary[]; linkedTicketKeys: string[] } {
  const selectedPathKeys = new Set(selected.map(item => localProjectPathKey(item.project.path)));
  const removedProjects = registeredProjects.filter(project => !selectedPathKeys.has(localProjectPathKey(project.path)));
  const removedNames = new Set(removedProjects.map(project => project.name));
  const linkedTicketKeys = Object.entries(tickets)
    .filter(([, ticket]) => Boolean(ticket.linked_local_project && removedNames.has(ticket.linked_local_project)))
    .map(([ticketKey]) => ticketKey);
  return { removedProjects, linkedTicketKeys };
}

export function projectUnregisterWarning(
  removedProjects: readonly LocalProjectSummary[],
  linkedTicketKeys: readonly string[],
): string {
  return `Unregistering ${removedProjects.map(project => project.displayName).join(', ')} will unlink ${linkedTicketKeys.length} ticket${linkedTicketKeys.length === 1 ? '' : 's'} (${linkedTicketKeys.slice(0, 5).join(', ')}${linkedTicketKeys.length > 5 ? ', …' : ''}).`;
}

export function projectRegistrationResultMessage(input: {
  registrations: number;
  removed: number;
  linkedTickets: number;
  truncated: boolean;
}): string {
  return `${input.registrations} local project${input.registrations === 1 ? ' is' : 's are'} registered; ${input.removed} unregistered${input.linkedTickets > 0 ? ` and unlinked from ${input.linkedTickets} ticket${input.linkedTickets === 1 ? '' : 's'}` : ''}${input.truncated ? ' from the current results' : ''}.`;
}

export function buildProjectIntegrationFormProjects(
  selectedProjects: readonly LocalProjectSummary[],
  state: KronosState | null,
): ProjectIntegrationFormProject[] {
  return selectedProjects.map(project => {
    const storedProject = state?.projects[project.name];
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
}

export interface TicketProjectChoice {
  label: string;
  description: string;
  detail?: string;
  project?: LocalProjectSummary;
  unlink?: true;
}

export function buildTicketProjectChoices(
  projects: readonly LocalProjectSummary[],
  current: LocalProjectSummary | undefined,
): TicketProjectChoice[] {
  const projectChoices: TicketProjectChoice[] = [...projects]
    .sort((left, right) => Number(current?.name === right.name) - Number(current?.name === left.name)
      || left.displayName.localeCompare(right.displayName))
    .map(project => ({
      label: `${project.displayName}${current?.name === project.name ? ' $(check)' : ''}`,
      description: project.branch || (project.available ? 'Git branch unavailable' : 'folder unavailable'),
      detail: project.path,
      project,
    }));
  if (!current) { return projectChoices; }
  const currentChoice = projectChoices.find(choice => choice.project?.name === current.name);
  if (!currentChoice) { return projectChoices; }
  return [currentChoice, {
      label: '$(close) Unlink local project',
      description: 'Future ticket launches fall back to the open workspace',
      unlink: true,
    }, ...projectChoices.filter(choice => choice !== currentChoice)];
}
