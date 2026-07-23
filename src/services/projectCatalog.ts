import * as fs from 'fs';
import * as path from 'path';
import type {
  BuildStatus,
  KronosState,
  MergeRequest,
  Project,
  ProjectBranchProfile,
  ProjectConfig,
  Ticket,
} from '../state/types';
import { readBoundedPrivateUtf8File } from './stateStore';
import {
  normalizeProjectBranch,
  normalizeProjectGitLabPath,
  normalizeProjectJenkinsUrl,
  normalizeProjectSonarKey,
} from './projectConfigNormalization';

const MAX_GIT_POINTER_BYTES = 4 * 1024;
const MAX_LOCAL_PROJECTS = 200;

export interface LocalProjectSummary {
  /** Stable catalog identity used by tickets, sessions, and provider configuration. */
  name: string;
  /** Editable presentation label; never used as a foreign key. */
  displayName: string;
  path: string;
  branch?: string;
  detached: boolean;
  available: boolean;
}

export interface LocalProjectIntegrationInput {
  name: string;
  /** Optional presentation-only nickname. Omit to preserve it; pass blank to clear it. */
  nickname?: string;
  gitlabProject?: string;
  jenkinsUrl?: string;
  sonarProjectKey?: string;
  defaultBranch?: string;
  branchProfiles?: string;
  activeBranchProfile?: string;
}

export interface TicketProviderStateInput {
  mr?: MergeRequest;
  build?: BuildStatus;
}

export interface LocalProjectRegistrationCandidate {
  name: string;
  path: string;
}

export interface LocalProjectIdentityReference {
  projectName?: string;
  projectPath?: string;
}

/**
 * Treats the stable catalog name as authoritative while accepting a canonical
 * folder match for Sessions created before that identity was known.
 */
export function matchesLocalProject(
  reference: LocalProjectIdentityReference,
  project: Pick<LocalProjectSummary, 'name' | 'path'>,
): boolean {
  return reference.projectName === project.name
    || Boolean(reference.projectPath && pathKey(reference.projectPath) === pathKey(project.path));
}

/** Canonical comparison key for a registered project folder. */
export function localProjectPathKey(value: string): string {
  return pathKey(value);
}

/** Stable grouping key for project-owned or legacy Session state. */
export function localProjectReferenceKey(reference: LocalProjectIdentityReference): string | undefined {
  if (reference.projectPath) { return `path:${pathKey(reference.projectPath)}`; }
  return reference.projectName ? `name:${reference.projectName}` : undefined;
}

/** Returns the most-specific registered project containing a terminal cwd. */
export function registeredLocalProjectForDirectory(
  state: KronosState | null | undefined,
  directoryValue: string,
): LocalProjectSummary | undefined {
  const directory = pathKey(directoryValue);
  return listLocalProjects(state)
    .filter(project => {
      const relative = path.relative(pathKey(project.path), directory);
      return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    })
    .sort((left, right) => pathKey(right.path).length - pathKey(left.path).length)[0];
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
  const projectKey = normalizeProjectSonarKey(projectKeyValue);
  if (!projectKey) {
    throw new Error(`${projectName} discovered an invalid SonarQube project key.`);
  }
  const branch = branchValue ? normalizeProfileBranch(branchValue, `${projectName} SonarQube branch`) : undefined;
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
      [ticketKey]: { ...ticket, mr, build },
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
  const existingEntry = Object.entries(state.projects).find(([, project]) =>
    Boolean(project.path && pathKey(project.path) === pathKey(projectPath))
  );
  const stableName = existingEntry?.[0] || projectName;
  const existing = existingEntry?.[1] || state.projects[stableName];
  const project: Project = {
    path: projectPath,
    config: { ...(existing?.config || {}) },
  };
  if (existing?.display_name) { project.display_name = existing.display_name; }
  if (!project.config.repo_name) { project.config.repo_name = projectName; }
  return {
    ...state,
    projects: { ...state.projects, [stableName]: project },
  };
}

/**
 * Gives discovered directories stable, unique catalog identities without
 * changing the identity of an already registered real path.
 */
export function planLocalProjectRegistrations(
  state: KronosState,
  candidates: readonly LocalProjectRegistrationCandidate[],
): LocalProjectRegistrationCandidate[] {
  const existingByPath = new Map(Object.entries(state.projects)
    .filter((entry): entry is [string, Project & { path: string }] => Boolean(entry[1].path))
    .map(([name, project]) => [pathKey(project.path), { name, path: project.path }]));
  const names = new Map(Object.entries(state.projects)
    .map(([name, project]) => [name.toLowerCase(), project.path ? pathKey(project.path) : '']));
  const planned: LocalProjectRegistrationCandidate[] = [];
  const plannedPaths = new Set<string>();
  for (const candidate of candidates.slice(0, MAX_LOCAL_PROJECTS)) {
    const existing = existingByPath.get(pathKey(candidate.path));
    if (existing) {
      const existingKey = pathKey(existing.path);
      if (plannedPaths.has(existingKey)) { continue; }
      plannedPaths.add(existingKey);
      // A registered folder can be temporarily unavailable. Keep its stable
      // identity while checked so only an authoritative uncheck removes it.
      planned.push({ name: existing.name, path: existing.path });
      continue;
    }
    let canonicalPath: string;
    try { canonicalPath = requiredProjectDirectory(candidate.path); }
    catch { continue; }
    const canonicalKey = pathKey(canonicalPath);
    if (plannedPaths.has(canonicalKey)) { continue; }
    plannedPaths.add(canonicalKey);
    const base = safeSingleLine(candidate.name, 200) || 'Project';
    let name = base;
    let suffix = 2;
    while (names.has(name.toLowerCase()) && names.get(name.toLowerCase()) !== canonicalKey) {
      const suffixText = ` (${suffix})`;
      name = `${base.slice(0, Math.max(1, 200 - suffixText.length))}${suffixText}`;
      suffix += 1;
    }
    names.set(name.toLowerCase(), canonicalKey);
    planned.push({ name, path: canonicalPath });
  }
  return planned;
}

/** Sets or clears presentation only; all project foreign keys remain stable. */
export function renameLocalProjectDisplayName(
  state: KronosState,
  projectNameValue: string,
  displayNameValue: string,
): KronosState {
  const projectName = requiredSingleLine(projectNameValue, 'project name', 200);
  const displayName = safeSingleLine(displayNameValue, 200);
  const project = state.projects[projectName];
  if (!project?.path) { throw new Error(`Local project is not registered: ${projectName}`); }
  const nickname = displayName && displayName !== projectName ? displayName : undefined;
  if (project.display_name === nickname) { return state; }
  const updated: Project = { ...project, config: { ...project.config } };
  if (nickname) { updated.display_name = nickname; }
  else { delete updated.display_name; }
  return {
    ...state,
    projects: {
      ...state.projects,
      [projectName]: updated,
    },
  };
}

/**
 * Makes the checked project paths the complete local-registration set.
 * Provider-only project metadata is retained, while removed explicit links
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
      projects[name] = {
        config: { ...project.config },
        ...(project.display_name ? { display_name: project.display_name } : {}),
      };
    }
  }

  let next: KronosState = {
    ...state,
    projects,
    tickets: Object.fromEntries(Object.entries(state.tickets).map(([key, ticket]) => {
      if (!ticket.linked_local_project || !removedNames.has(ticket.linked_local_project)) {
        return [key, { ...ticket }];
      }
      const unlinked: Ticket = { ...ticket };
      delete unlinked.linked_local_project;
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
  const nextTicket: Ticket = { ...ticket };
  if (projectName) { nextTicket.linked_local_project = projectName; }
  else { delete nextTicket.linked_local_project; }
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
    if (Object.prototype.hasOwnProperty.call(value, 'nickname')) {
      const nickname = safeSingleLine(value.nickname, 200);
      if (nickname && nickname !== name) { project.display_name = nickname; }
      else { delete project.display_name; }
    }
    const config = project.config;
    delete config.gitlab_project_id;
    delete config.gitlab_project_path;
    delete config.jenkins_url;
    delete config.sonar_project_key;
    delete config.default_branch;
    delete config.base_branch;
    delete config.branch_profiles;
    delete config.active_branch_profile;

    const gitLabProject = safeSingleLine(value.gitlabProject, 512);
    if (gitLabProject) {
      if (/^[1-9][0-9]*$/.test(gitLabProject)) {
        const projectId = Number(gitLabProject);
        if (!Number.isSafeInteger(projectId)) { throw new Error(`${name} GitLab project ID is too large.`); }
        config.gitlab_project_id = projectId;
      } else {
        const projectPath = normalizeProjectGitLabPath(gitLabProject);
        if (!projectPath) {
          throw new Error(`${name} GitLab project must be a numeric ID or group/project path.`);
        }
        config.gitlab_project_path = projectPath;
      }
    }
    const jenkinsUrl = normalizeOptionalHttpUrl(value.jenkinsUrl, `${name} Jenkins job URL`);
    if (jenkinsUrl) { config.jenkins_url = jenkinsUrl; }
    const sonarProjectKey = normalizeProjectSonarKey(value.sonarProjectKey);
    if (sonarProjectKey) {
      config.sonar_project_key = sonarProjectKey;
    } else if (safeSingleLine(value.sonarProjectKey, 400)) {
      throw new Error(`${name} SonarQube project key contains unsupported characters.`);
    }
    const defaultBranch = value.defaultBranch
      ? normalizeProfileBranch(value.defaultBranch, `${name} default branch`)
      : undefined;
    if (defaultBranch) { config.default_branch = defaultBranch; }
    const branchProfiles = parseProjectBranchProfiles(value.branchProfiles || '');
    if (branchProfiles.length > 0) { config.branch_profiles = branchProfiles; }
    const activeBranchProfile = safeSingleLine(value.activeBranchProfile, 500);
    if (activeBranchProfile) {
      const branch = normalizeProfileBranch(activeBranchProfile, `${name} active provider profile`);
      if (!branchProfiles.some(profile => profile.branch === branch)) {
        throw new Error(`${name} active provider profile must match one configured branch profile.`);
      }
      config.active_branch_profile = branch;
    }
  }
  return {
    ...state,
    projects,
    tickets: Object.fromEntries(Object.entries(state.tickets).map(([key, ticket]) => [key, { ...ticket }])),
  };
}

export function parseProjectBranchProfiles(value: string): ProjectBranchProfile[] {
  if (typeof value !== 'string' || value.length > 20_000) {
    throw new Error('Project branch profiles exceed the 20,000-character limit.');
  }
  const profiles: ProjectBranchProfile[] = [];
  const seen = new Set<string>();
  for (const [index, rawLine] of value.replace(/\r\n?/g, '\n').split('\n').entries()) {
    const line = rawLine.trim();
    if (!line) { continue; }
    if (profiles.length >= 20) { throw new Error('Project branch profiles exceed the 20-profile limit.'); }
    const parts = line.split('|').map(part => part.trim());
    if (parts.length < 2 || parts.length > 4) {
      throw new Error(`Branch profile line ${index + 1} must use: branch | Jenkins URL | SonarQube key | SonarQube branch.`);
    }
    const branch = normalizeProfileBranch(parts[0] || '', `branch profile line ${index + 1}`);
    if (seen.has(branch)) { throw new Error(`Branch profile ${branch} is duplicated.`); }
    seen.add(branch);
    const jenkinsUrl = normalizeOptionalHttpUrl(parts[1], `${branch} Jenkins job URL`);
    const sonarProjectKey = normalizeProjectSonarKey(parts[2]);
    if (!sonarProjectKey && safeSingleLine(parts[2], 400)) {
      throw new Error(`${branch} SonarQube project key contains unsupported characters.`);
    }
    const sonarBranch = parts[3]
      ? normalizeProfileBranch(parts[3], `${branch} SonarQube branch`)
      : sonarProjectKey ? branch : undefined;
    if (!jenkinsUrl && !sonarProjectKey) {
      throw new Error(`Branch profile ${branch} must configure a Jenkins URL, a SonarQube key, or both.`);
    }
    const profile: ProjectBranchProfile = { branch };
    if (jenkinsUrl) { profile.jenkins_url = jenkinsUrl; }
    if (sonarProjectKey) { profile.sonar_project_key = sonarProjectKey; }
    if (sonarBranch) { profile.sonar_branch = sonarBranch; }
    profiles.push(profile);
  }
  return profiles;
}

export function formatProjectBranchProfiles(profiles: readonly ProjectBranchProfile[] | undefined): string {
  return (profiles || []).slice(0, 20).map(profile => [
    profile.branch,
    profile.jenkins_url || '',
    profile.sonar_project_key || '',
    profile.sonar_branch || '',
  ].join(' | ')).join('\n');
}

export function selectProjectBranchProfile(
  config: ProjectConfig | null | undefined,
  requestedBranches: readonly (string | null | undefined)[] = [],
): ProjectBranchProfile | undefined {
  const profiles = config?.branch_profiles || [];
  for (const requested of requestedBranches) {
    const branch = typeof requested === 'string' ? requested.trim() : '';
    const profile = branch ? profiles.find(candidate => candidate.branch === branch) : undefined;
    if (profile) { return { ...profile }; }
  }
  const active = config?.active_branch_profile;
  const profile = active ? profiles.find(candidate => candidate.branch === active) : undefined;
  return profile ? { ...profile } : undefined;
}

/** Only the operator's explicit ticket-to-project link supplies provider configuration. */
export function projectConfigurationForTicket(
  state: KronosState | null | undefined,
  ticket: Ticket | null | undefined,
): ProjectConfig {
  if (!state || !ticket?.linked_local_project) { return {}; }
  return { ...(state.projects[ticket.linked_local_project]?.config || {}) };
}

export function listLocalProjects(state: KronosState | null | undefined): LocalProjectSummary[] {
  if (!state) { return []; }
  return Object.entries(state.projects)
    .filter(([, project]) => Boolean(project.path))
    .slice(0, MAX_LOCAL_PROJECTS)
    .map(([name, project]) => localProjectSummary(name, project.path || '', project.display_name))
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.name.localeCompare(right.name));
}

export function ticketLocalProject(
  state: KronosState | null | undefined,
  ticket: Ticket | null | undefined,
): LocalProjectSummary | undefined {
  if (!state || !ticket) { return undefined; }
  const name = ticket.linked_local_project;
  const projectPath = name ? state.projects[name]?.path : undefined;
  if (!name || !projectPath) { return undefined; }
  const summary = localProjectSummary(name, projectPath, state.projects[name]?.display_name);
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

function localProjectSummary(name: string, projectPath: string, displayNameValue?: string): LocalProjectSummary {
  const available = isProjectDirectory(projectPath);
  const git = available ? readProjectGitBranch(projectPath) : undefined;
  const summary: LocalProjectSummary = {
    name: safeSingleLine(name, 200) || 'Project',
    displayName: safeSingleLine(displayNameValue, 200) || safeSingleLine(name, 200) || 'Project',
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
  return fs.realpathSync.native(normalized);
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
  let normalized = path.normalize(value);
  try { normalized = fs.realpathSync.native(normalized); }
  catch { /* Missing registered paths retain their last canonical spelling. */ }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeTicketKey(value: string): string {
  const key = safeSingleLine(value, 160).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]*-[0-9]{1,12}$/.test(key)) { throw new Error('Invalid Jira ticket key.'); }
  return key;
}

function normalizeProfileBranch(value: string, label: string): string {
  const branch = normalizeProjectBranch(value);
  if (!branch) {
    throw new Error(`${label} contains unsupported Git branch characters.`);
  }
  return branch;
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
  const normalized = normalizeProjectJenkinsUrl(candidate);
  if (!normalized) {
    throw new Error(`${label} must be an HTTPS URL (or loopback HTTP URL) without embedded credentials.`);
  }
  return normalized;
}
