import { ScriptRunOptions, runKronosStateScript } from './scriptClient';
import { unknownErrorMessage } from './errorUtils';
import { stripUtf8Bom } from './jsonFiles';
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
  const parsed = parseStateScriptJson(discoverProjects(options), 'kronos_state.py --discover');
  const data = isPlainObject(parsed) ? parsed : {};
  return {
    ...data,
    candidates: normalizeDiscoveredProjects(data['candidates']),
  };
}

function normalizeDiscoveredProjects(value: unknown): DiscoveredProject[] {
  if (!Array.isArray(value)) { return []; }
  const normalized: DiscoveredProject[] = [];
  const seenPaths = new Set<string>();
  for (const item of value) {
    const candidate = normalizeDiscoveredProject(item);
    if (!candidate || seenPaths.has(candidate.path)) { continue; }
    seenPaths.add(candidate.path);
    normalized.push(candidate);
  }
  return normalized;
}

function normalizeDiscoveredProject(value: unknown): DiscoveredProject | null {
  if (!isPlainObject(value)) { return null; }
  const path = stringOrNull(value['path']);
  if (!path) { return null; }
  const repoName = stringOrNull(value['repo_name']) || path.replace(/\\/g, '/').split('/').filter(Boolean).pop() || path;
  return {
    path,
    repo_name: repoName,
    has_project_json: value['has_project_json'] === true,
    git_remote: stringOrNull(value['git_remote']),
    pom_artifact_id: stringOrNull(value['pom_artifact_id']),
    suggested_jira_key: stringOrNull(value['suggested_jira_key']),
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
  const parsed = parseStateScriptJson(readMorningBrief(options), 'kronos_state.py --morning-brief');
  if (!isPlainObject(parsed)) { return {}; }
  return {
    ...parsed,
    completed: arrayOrEmpty(parsed['completed']),
    needs_attention: arrayOrEmpty(parsed['needs_attention']),
    ready_to_go: arrayOrEmpty(parsed['ready_to_go']),
    overnight_actions: finiteNumberOrZero(parsed['overnight_actions']),
    vpn_drops: finiteNumberOrZero(parsed['vpn_drops']),
  };
}

function parseStateScriptJson(raw: string, label: string): unknown {
  const content = stripUtf8Bom(raw);
  try {
    return JSON.parse(content);
  } catch (e: unknown) {
    const preview = content.trim().substring(0, 300);
    throw new Error(`Invalid JSON from ${label}: ${unknownErrorMessage(e, 'parse failed')}${preview ? `; output: ${preview}` : ''}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') { return null; }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function finiteNumberOrZero(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
