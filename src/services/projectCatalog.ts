import * as fs from 'fs';
import * as path from 'path';
import type { BuildStatus, KronosState, MergeRequest, Project, ProjectConfig, Ticket } from '../state/types';
import { normalizeJenkinsJobUrl } from './jenkinsRestClient';
import { readBoundedPrivateUtf8File } from './stateStore';

const MAX_GIT_POINTER_BYTES = 4 * 1024;
const MAX_LOCAL_PROJECTS = 200;

export interface LocalProjectSummary {
  name: string;
  path: string;
  branch?: string;
  detached: boolean;
  available: boolean;
}

export interface LocalProjectIntegrationInput {
  name: string;
  gitlabProject?: string;
  jenkinsUrl?: string;
  sonarProjectKey?: string;
  defaultBranch?: string;
}

export interface TicketProviderStateInput {
  mr?: MergeRequest;
  build?: BuildStatus;
}

export function setLocalProjectSonarTarget(
  state: KronosState,
  projectNameValue: string,
  projectKeyValue: string,
  branchValue?: string,
): KronosState {
  const projectName = requiredSingleLine(projectNameValue, 'project name', 200);
  const project = state.projects[projectName];
  if (!project) { return state; }
  const projectKey = safeSingleLine(projectKeyValue, 400);
  if (!projectKey || !/^[A-Za-z0-9_.:-]+$/.test(projectKey)) {
    throw new Error(`${projectName} discovered an invalid SonarQube project key.`);
  }
  const branch = safeSingleLine(branchValue, 500);
  if (project.config.sonar_project_key === projectKey
    && (!branch || project.config.sonar_branch === branch)) {
    return state;
  }
  return {
    ...state,
    projects: {
      ...state.projects,
      [projectName]: {
        ...project,
        config: {
          ...project.config,
          sonar_project_key: projectKey,
          ...(branch ? { sonar_branch: branch } : {}),
        },
      },
    },
  };
}

export function projectTicketProviderState(
  state: KronosState,
  ticketKeyValue: string,
  input: TicketProviderStateInput,
): KronosState {
  const ticketKey = normalizeTicketKey(ticketKeyValue);
  const ticket = state.tickets[ticketKey];
  if (!ticket) { return state; }
  const mr = input.mr ? { ...input.mr } : ticket.mr;
  const build = input.build ? { ...input.build } : ticket.build;
  if (JSON.stringify(mr) === JSON.stringify(ticket.mr)
    && JSON.stringify(build) === JSON.stringify(ticket.build)) {
    return state;
  }
  return {
    ...state,
    tickets: {
      ...state.tickets,
      [ticketKey]: { ...ticket, projects: [], mr, build },
    },
  };
}

export function registerLocalProject(
  state: KronosState,
  projectNameValue: string,
  projectPathValue: string,
): KronosState {
  const projectName = requiredSingleLine(projectNameValue, 'project name', 200);
  const projectPath = requiredProjectDirectory(projectPathValue);
  const existing = state.projects[projectName];
  const project: Project = {
    path: projectPath,
    config: { ...(existing?.config || {}) },
  };
  if (!project.config.repo_name) { project.config.repo_name = projectName; }
  return {
    ...state,
    projects: { ...state.projects, [projectName]: project },
  };
}

/**
 * Makes the checked project paths the complete local-registration set.
 * Provider-only project metadata is retained, while removed launch bindings
 * are cleared so tickets cannot point at an unregistered directory.
 */
export function replaceRegisteredLocalProjects(
  state: KronosState,
  registrations: readonly { name: string; path: string }[],
): KronosState {
  const selectedPaths = new Set(registrations.map(item => pathKey(item.path)));
  const removedNames = new Set<string>();
  const projects: Record<string, Project> = {};
  for (const [name, project] of Object.entries(state.projects)) {
    if (!project.path) {
      if (shouldRetainProviderProject(name, project)) {
        projects[name] = { ...project, config: { ...project.config } };
      }
      continue;
    }
    if (selectedPaths.has(pathKey(project.path))) {
      projects[name] = { ...project, config: { ...project.config } };
      continue;
    }
    removedNames.add(name);
    if (shouldRetainProviderProject(name, project)) {
      projects[name] = { config: { ...project.config } };
    }
  }

  let next: KronosState = {
    ...state,
    projects,
    tickets: Object.fromEntries(Object.entries(state.tickets).map(([key, ticket]) => {
      if (!ticket.launch_project || !removedNames.has(ticket.launch_project)) {
        return [key, { ...ticket, projects: [] }];
      }
      const unlinked: Ticket = { ...ticket, projects: [] };
      delete unlinked.launch_project;
      return [key, unlinked];
    })),
  };

  const existingPaths = new Set(Object.values(projects)
    .map(project => project.path)
    .filter((value): value is string => Boolean(value))
    .map(pathKey));
  for (const registration of registrations.slice(0, MAX_LOCAL_PROJECTS)) {
    const key = pathKey(registration.path);
    if (existingPaths.has(key)) { continue; }
    next = registerLocalProject(next, registration.name, registration.path);
    existingPaths.add(key);
  }
  return next;
}

/** Selects or clears the ticket's sole explicit local-project association. */
export function setTicketLocalProject(
  state: KronosState,
  ticketKeyValue: string,
  projectNameValue?: string,
): KronosState {
  const ticketKey = normalizeTicketKey(ticketKeyValue);
  const ticket = state.tickets[ticketKey];
  if (!ticket) { throw new Error(`Jira ticket is not loaded: ${ticketKey}`); }
  let projectName: string | undefined;
  if (projectNameValue !== undefined) {
    projectName = requiredSingleLine(projectNameValue, 'project name', 200);
    const project = state.projects[projectName];
    if (!project?.path) { throw new Error(`Local project is not registered: ${projectName}`); }
    requiredProjectDirectory(project.path);
  }
  const nextTicket: Ticket = { ...ticket, projects: [] };
  if (projectName) { nextTicket.launch_project = projectName; }
  else { delete nextTicket.launch_project; }
  return {
    ...state,
    tickets: {
      ...state.tickets,
      [ticketKey]: nextTicket,
    },
  };
}

export function setLocalProjectIntegrations(
  state: KronosState,
  values: readonly LocalProjectIntegrationInput[],
): KronosState {
  const projects = Object.fromEntries(Object.entries(state.projects).map(([name, project]) => [
    name,
    { ...project, config: { ...project.config } },
  ]));
  for (const value of values.slice(0, MAX_LOCAL_PROJECTS)) {
    const name = requiredSingleLine(value.name, 'project name', 200);
    const project = projects[name];
    if (!project?.path) { throw new Error(`Local project is not registered: ${name}`); }
    const config = project.config;
    delete config.gitlab_project_id;
    delete config.gitlab_project_path;
    delete config.jenkins_url;
    delete config.sonar_project_key;
    delete config.default_branch;
    delete config.base_branch;

    const gitLabProject = safeSingleLine(value.gitlabProject, 512);
    if (gitLabProject) {
      if (/^[1-9][0-9]*$/.test(gitLabProject)) {
        const projectId = Number(gitLabProject);
        if (!Number.isSafeInteger(projectId)) { throw new Error(`${name} GitLab project ID is too large.`); }
        config.gitlab_project_id = projectId;
      } else if (/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(gitLabProject)) {
        config.gitlab_project_path = gitLabProject;
      } else {
        throw new Error(`${name} GitLab project must be a numeric ID or group/project path.`);
      }
    }
    const jenkinsUrl = normalizeOptionalHttpUrl(value.jenkinsUrl, `${name} Jenkins job URL`);
    if (jenkinsUrl) { config.jenkins_url = jenkinsUrl; }
    const sonarProjectKey = safeSingleLine(value.sonarProjectKey, 400);
    if (sonarProjectKey) {
      if (!/^[A-Za-z0-9_.:-]+$/.test(sonarProjectKey)) {
        throw new Error(`${name} SonarQube project key contains unsupported characters.`);
      }
      config.sonar_project_key = sonarProjectKey;
    }
    const defaultBranch = safeSingleLine(value.defaultBranch, 500);
    if (defaultBranch) { config.default_branch = defaultBranch; }
  }
  return {
    ...state,
    projects,
    tickets: Object.fromEntries(Object.entries(state.tickets).map(([key, ticket]) => [
      key,
      { ...ticket, projects: [] },
    ])),
  };
}

/** Only the operator's explicit ticket-to-project link supplies provider configuration. */
export function projectConfigurationForTicket(
  state: KronosState | null | undefined,
  ticket: Ticket | null | undefined,
): ProjectConfig {
  if (!state || !ticket?.launch_project) { return {}; }
  return { ...(state.projects[ticket.launch_project]?.config || {}) };
}

export function listLocalProjects(state: KronosState | null | undefined): LocalProjectSummary[] {
  if (!state) { return []; }
  return Object.entries(state.projects)
    .filter(([, project]) => Boolean(project.path))
    .slice(0, MAX_LOCAL_PROJECTS)
    .map(([name, project]) => localProjectSummary(name, project.path || ''))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function ticketLocalProject(
  state: KronosState | null | undefined,
  ticket: Ticket | null | undefined,
): LocalProjectSummary | undefined {
  if (!state || !ticket) { return undefined; }
  const name = ticket.launch_project;
  const projectPath = name ? state.projects[name]?.path : undefined;
  if (!name || !projectPath) { return undefined; }
  const summary = localProjectSummary(name, projectPath);
  return summary.available ? summary : undefined;
}

export function readProjectGitBranch(projectPathValue: string): { branch: string; detached: boolean } | undefined {
  try {
    const projectPath = fs.realpathSync(requiredProjectDirectory(projectPathValue));
    const dotGitPath = path.join(projectPath, '.git');
    const dotGitStat = fs.lstatSync(dotGitPath);
    if (dotGitStat.isSymbolicLink()) { return undefined; }
    let gitDirectory: string;
    if (dotGitStat.isDirectory()) {
      gitDirectory = dotGitPath;
    } else if (dotGitStat.isFile() && dotGitStat.size <= MAX_GIT_POINTER_BYTES) {
      const pointer = readBoundedPrivateUtf8File(dotGitPath, MAX_GIT_POINTER_BYTES, 'Git directory pointer');
      const match = /^gitdir:\s*([^\r\n]+)\s*$/i.exec(pointer.trim());
      if (!match?.[1]) { return undefined; }
      const gitDirectoryCandidate = path.resolve(projectPath, match[1]);
      const gitDirectoryStat = fs.lstatSync(gitDirectoryCandidate);
      if (gitDirectoryStat.isSymbolicLink() || !gitDirectoryStat.isDirectory()) { return undefined; }
      gitDirectory = fs.realpathSync(gitDirectoryCandidate);
    } else {
      return undefined;
    }
    const head = readBoundedPrivateUtf8File(
      path.join(gitDirectory, 'HEAD'),
      MAX_GIT_POINTER_BYTES,
      'Git HEAD',
    ).trim();
    const branchMatch = /^ref:\s+refs\/heads\/(.+)$/.exec(head);
    if (branchMatch?.[1]) {
      const branch = safeSingleLine(branchMatch[1], 500);
      return branch ? { branch, detached: false } : undefined;
    }
    return /^[0-9a-f]{7,64}$/i.test(head)
      ? { branch: `detached@${head.slice(0, 7).toLowerCase()}`, detached: true }
      : undefined;
  } catch {
    return undefined;
  }
}

function localProjectSummary(name: string, projectPath: string): LocalProjectSummary {
  const available = isProjectDirectory(projectPath);
  const git = available ? readProjectGitBranch(projectPath) : undefined;
  const summary: LocalProjectSummary = {
    name: safeSingleLine(name, 200) || 'Project',
    path: path.isAbsolute(projectPath) ? path.normalize(projectPath) : projectPath,
    detached: git?.detached === true,
    available,
  };
  if (git) { summary.branch = git.branch; }
  return summary;
}

function requiredProjectDirectory(value: string): string {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    throw new Error('Project path must be absolute.');
  }
  const normalized = path.normalize(value);
  const stat = fs.statSync(normalized);
  if (!stat.isDirectory()) { throw new Error(`Project path is not a directory: ${normalized}`); }
  return normalized;
}

function isProjectDirectory(value: string): boolean {
  try {
    requiredProjectDirectory(value);
    return true;
  } catch {
    return false;
  }
}

function shouldRetainProviderProject(name: string, project: Project): boolean {
  if (Object.keys(project.config).some(key => key !== 'repo_name')) { return true; }
  return Boolean(project.config.repo_name && project.config.repo_name !== name);
}

function pathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function normalizeTicketKey(value: string): string {
  const key = safeSingleLine(value, 160).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[0-9]{1,12}$/.test(key)) { throw new Error('Invalid Jira ticket key.'); }
  return key;
}

function requiredSingleLine(value: string, label: string, maxLength: number): string {
  const normalized = safeSingleLine(value, maxLength);
  if (!normalized) { throw new Error(`${label} is required.`); }
  return normalized;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function normalizeOptionalHttpUrl(value: unknown, label: string): string | undefined {
  const candidate = safeSingleLine(value, 4_000);
  if (!candidate) { return undefined; }
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
      throw new Error('unsupported URL');
    }
    const normalized = normalizeJenkinsJobUrl(url.toString());
    if (!normalized) { throw new Error('unsupported URL'); }
    return normalized;
  } catch {
    throw new Error(`${label} must be an HTTPS URL (or loopback HTTP URL) without embedded credentials.`);
  }
}
