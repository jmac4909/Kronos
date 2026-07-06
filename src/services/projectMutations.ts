import * as fs from 'fs';
import * as path from 'path';
import { DiscoveredProject, KronosState, ProjectConfig } from '../state/types';
import { arrayFromUnknown, recordEntriesFromUnknown, trimmedStringFromUnknown } from './records';
import { STATE_FILE, readStateFile, validateStateFileShape, writeJsonFileAtomic } from './stateStore';
import { ticketStringArray } from './ticketFields';

interface ProjectConfigUpdateResult {
  projectName: string;
  key: keyof ProjectConfig;
  value: ProjectConfig[keyof ProjectConfig];
}

interface RemovedProjectResult {
  projectName: string;
  path: string;
  ticketsUnlinked: string[];
}

interface ScanDirsResult {
  scanDirs: string[];
}

interface ProjectSetupConfigInput {
  projectPath: string;
  projectName: string;
  gitlabProjectId: number | null;
  sonarProjectKey: string | null;
  defaultBranch: string;
}

interface ProjectSetupConfigResult {
  path: string;
  config: {
    project_name: string;
    gitlab_project_id: number | null;
    sonar_project_key: string | null;
    default_branch: string;
  };
}

interface ProjectIntegrationConfigInput {
  gitlabProjectId?: number | null;
  sonarProjectKey?: string | null;
  defaultBranch?: string | null;
}

type ProjectConfigRawValue = string | number | boolean | string[];

export function setProjectConfigValue(projectName: string, key: keyof ProjectConfig, rawValue: ProjectConfigRawValue): ProjectConfigUpdateResult {
  const state = requireState();
  const project = state.projects[projectName];
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const value = normalizeProjectConfigValue(key, rawValue);
  project.config = {
    ...(project.config || {}),
    [key]: value,
  };
  state.last_updated = new Date().toISOString();
  persistState(state, 'project-config-update');
  return { projectName, key, value };
}

export function setProjectIntegrationConfig(projectName: string, input: ProjectIntegrationConfigInput): ProjectConfigUpdateResult[] {
  const state = requireState();
  const project = state.projects[projectName];
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }

  const updates: ProjectConfigUpdateResult[] = [];
  const nextConfig: ProjectConfig = { ...(project.config || {}) };
  if (input.gitlabProjectId !== undefined && input.gitlabProjectId !== null) {
    const value = normalizeProjectConfigValue('gitlab_project_id', input.gitlabProjectId);
    nextConfig.gitlab_project_id = value as number;
    updates.push({ projectName, key: 'gitlab_project_id', value });
  }
  if (input.sonarProjectKey !== undefined && input.sonarProjectKey !== null) {
    const value = normalizeProjectConfigValue('sonar_project_key', input.sonarProjectKey);
    nextConfig.sonar_project_key = value as string;
    updates.push({ projectName, key: 'sonar_project_key', value });
  }
  if (input.defaultBranch !== undefined && input.defaultBranch !== null) {
    const value = normalizeProjectConfigValue('default_branch', input.defaultBranch);
    nextConfig.default_branch = value as string;
    updates.push({ projectName, key: 'default_branch', value });
  }
  if (updates.length === 0) {
    return [];
  }

  project.config = nextConfig;
  state.last_updated = new Date().toISOString();
  persistState(state, 'project-integration-config-update');
  return updates;
}

export function writeProjectSetupConfig(input: ProjectSetupConfigInput): ProjectSetupConfigResult {
  const dotClaudeDir = path.join(input.projectPath, '.claude');
  const projectJsonPath = path.join(dotClaudeDir, 'project.json');
  if (!fs.existsSync(dotClaudeDir)) {
    fs.mkdirSync(dotClaudeDir, { recursive: true });
  }
  const config = {
    project_name: input.projectName,
    gitlab_project_id: input.gitlabProjectId,
    sonar_project_key: input.sonarProjectKey,
    default_branch: input.defaultBranch,
  };
  writeJsonFileAtomic(projectJsonPath, config, 'project-setup-config');
  return { path: projectJsonPath, config };
}

export function removeProject(projectName: string): RemovedProjectResult {
  const state = requireState();
  const project = state.projects[projectName];
  if (!project) {
    throw new Error(`Project not found: ${projectName}`);
  }
  const ticketsUnlinked: string[] = [];
  for (const [ticketKey, ticket] of recordEntriesFromUnknown(state.tickets)) {
    const projects = ticketStringArray(ticket.projects);
    if (!projects.includes(projectName)) { continue; }
    ticket.projects = projects.filter(project => project !== projectName);
    ticketsUnlinked.push(ticketKey);
  }
  delete state.projects[projectName];
  state.discovered_projects = upsertDiscoveredProject(state.discovered_projects || [], {
    path: project.path,
    repo_name: project.config?.repo_name || projectName,
    has_project_json: fs.existsSync(path.join(project.path, '.claude', 'project.json')),
    git_remote: null,
    pom_artifact_id: null,
    suggested_jira_key: project.config?.jira_project_key || null,
  });
  state.last_updated = new Date().toISOString();
  persistState(state, 'project-remove');
  return { projectName, path: project.path, ticketsUnlinked };
}

export function setScanDirs(scanDirs: string[]): ScanDirsResult {
  const state = requireState();
  const unique = Array.from(new Set(scanDirs.map(dir => dir.trim()).filter(Boolean)));
  state.settings = {
    ...state.settings,
    scan_dirs: unique,
  };
  state.last_updated = new Date().toISOString();
  persistState(state, 'settings-scan-dirs');
  return { scanDirs: unique };
}

function requireState(): KronosState {
  const state = readStateFile();
  if (!state) {
    throw new Error('Kronos state is not initialized.');
  }
  return state;
}

function persistState(state: KronosState, action: string): void {
  validateStateFileShape(state);
  writeJsonFileAtomic(STATE_FILE, state, action);
}

function normalizeProjectConfigValue(key: keyof ProjectConfig, rawValue: ProjectConfigRawValue): ProjectConfig[keyof ProjectConfig] {
  if (key === 'gitlab_project_id') {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      throw new Error('gitlab_project_id must be a positive number.');
    }
    return numeric;
  }
  if (key === 'extra_dirs') {
    const rawDirs = arrayFromUnknown(rawValue);
    const dirs = rawDirs.length > 0 ? rawDirs : String(rawValue).split(',');
    return dirs.map(value => trimmedStringFromUnknown(value)).filter(Boolean);
  }
  if (key === 'deploy_approvers') {
    throw new Error('deploy_approvers must be edited through a structured config editor.');
  }
  return String(rawValue).trim();
}

function upsertDiscoveredProject(discovered: DiscoveredProject[], project: DiscoveredProject): DiscoveredProject[] {
  const withoutExisting = discovered.filter(candidate => candidate.path !== project.path && candidate.repo_name !== project.repo_name);
  return [...withoutExisting, project].sort((a, b) => a.repo_name.localeCompare(b.repo_name));
}
