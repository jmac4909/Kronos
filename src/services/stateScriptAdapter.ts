import { ScriptRunOptions, runKronosStateScript } from './scriptClient';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, finiteNumberFromUnknown, isRecord as isPlainObject, optionalTrimmedStringFromUnknown } from './records';
import { DiscoveredProject } from '../state/types';

type StateScriptRunner = (args: string[], options?: ScriptRunOptions) => string;

interface StateScriptAdapterOptions {
  runner?: StateScriptRunner;
  scriptOptions?: ScriptRunOptions;
}

export interface DiscoverProjectsResult {
  candidates: DiscoveredProject[];
  [key: string]: unknown;
}

export interface MorningBriefResult {
  completed?: unknown[];
  needs_attention?: unknown[];
  ready_to_go?: unknown[];
  overnight_actions?: number;
  vpn_drops?: number;
  [key: string]: unknown;
}

export function runStateScript(args: string[], options: StateScriptAdapterOptions = {}): string {
  return (options.runner || runKronosStateScript)(args, options.scriptOptions || {});
}

export function refreshKronosState(project?: string, options: StateScriptAdapterOptions = {}): string {
  return runStateScript(project ? ['--refresh', project] : ['--refresh-all'], options);
}

function discoverProjects(options: StateScriptAdapterOptions = {}): string {
  return runStateScript(['--discover'], options);
}

export function discoverProjectsJson(options: StateScriptAdapterOptions = {}): DiscoverProjectsResult {
  const parsed = parseJsonWithLabel(discoverProjects(options), 'kronos_state.py --discover', { includePreview: true });
  const data = isPlainObject(parsed) ? parsed : {};
  return {
    ...data,
    candidates: normalizeDiscoveredProjects(data['candidates']),
  };
}

function normalizeDiscoveredProjects(value: unknown): DiscoveredProject[] {
  const normalized: DiscoveredProject[] = [];
  const seenPaths = new Set<string>();
  for (const item of arrayFromUnknown(value)) {
    const candidate = normalizeDiscoveredProject(item);
    if (!candidate || seenPaths.has(candidate.path)) { continue; }
    seenPaths.add(candidate.path);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeDiscoveredProject(value: unknown): DiscoveredProject | null {
  if (!isPlainObject(value)) { return null; }
  const path = optionalTrimmedStringFromUnknown(value['path']) ?? null;
  if (!path) { return null; }
  const repoName = optionalTrimmedStringFromUnknown(value['repo_name']) || path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
  return {
    path,
    repo_name: repoName,
    has_project_json: value['has_project_json'] === true,
    git_remote: optionalTrimmedStringFromUnknown(value['git_remote']) ?? null,
    pom_artifact_id: optionalTrimmedStringFromUnknown(value['pom_artifact_id']) ?? null,
    suggested_jira_key: optionalTrimmedStringFromUnknown(value['suggested_jira_key']) ?? null,
  };
}

export function registerProject(projectPath: string, options: StateScriptAdapterOptions = {}): string {
  return runStateScript(['--register', projectPath], options);
}

export function addAdhocTask(title: string, description?: string, options: StateScriptAdapterOptions = {}): string {
  const args = ['--adhoc-add', title];
  if (description) {
    args.push(description);
  }
  return runStateScript(args, options);
}

export function completeAdhocTask(taskId: string, options: StateScriptAdapterOptions = {}): string {
  return runStateScript(['--adhoc-done', taskId], options);
}

function readMorningBrief(options: StateScriptAdapterOptions = {}): string {
  return runStateScript(['--morning-brief'], options);
}

export function readMorningBriefJson(options: StateScriptAdapterOptions = {}): MorningBriefResult {
  const parsed = parseJsonWithLabel(readMorningBrief(options), 'kronos_state.py --morning-brief', { includePreview: true });
  if (!isPlainObject(parsed)) { return {}; }
  return {
    ...parsed,
    completed: arrayFromUnknown(parsed['completed']),
    needs_attention: arrayFromUnknown(parsed['needs_attention']),
    ready_to_go: arrayFromUnknown(parsed['ready_to_go']),
    overnight_actions: finiteNumberFromUnknown(parsed['overnight_actions']),
    vpn_drops: finiteNumberFromUnknown(parsed['vpn_drops']),
  };
}
