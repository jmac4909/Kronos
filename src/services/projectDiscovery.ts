import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readProjectGitBranch } from './projectCatalog';

const MAX_ROOTS = 50;
const MAX_DEPTH = 5;
const MAX_RESULTS = 500;
const MAX_ENTRIES_PER_DIRECTORY = 2_000;
const MAX_VISITED_DIRECTORIES = 5_000;
const IGNORED_DIRECTORY_NAMES = new Set(['.git', 'node_modules']);

export interface ProjectDiscoveryOptions {
  workspaceFolders?: readonly { name: string; path: string }[];
  roots?: readonly string[];
  depth?: number;
  limit?: number;
}

export interface DiscoveredProject {
  name: string;
  path: string;
  source: 'workspace' | 'configured-root';
  branch?: string;
}

export interface ProjectDiscoveryResult {
  projects: DiscoveredProject[];
  warnings: string[];
  visitedDirectories: number;
  truncated: boolean;
}

/** Bounded, read-only local project discovery. No project process is launched. */
export function discoverLocalProjects(options: ProjectDiscoveryOptions): ProjectDiscoveryResult {
  const depth = boundedInteger(options.depth, 2, 0, MAX_DEPTH);
  const limit = boundedInteger(options.limit, 100, 1, MAX_RESULTS);
  const warnings: string[] = [];
  const projects = new Map<string, DiscoveredProject>();
  const workspacePaths = new Set<string>();
  for (const folder of (options.workspaceFolders || []).slice(0, MAX_ROOTS)) {
    const candidate = normalizeDirectory(folder.path);
    if (!candidate) {
      warnings.push(`Workspace folder is unavailable: ${safeSingleLine(folder.path, 1_000) || '(empty path)'}`);
      continue;
    }
    workspacePaths.add(pathKey(candidate));
    retainProject(projects, {
      name: safeSingleLine(folder.name, 200) || path.basename(candidate),
      path: candidate,
      source: 'workspace',
    }, limit);
  }

  const queue: Array<{ directory: string; level: number }> = [];
  const queued = new Set<string>();
  for (const rootValue of (options.roots || []).slice(0, MAX_ROOTS)) {
    const expanded = expandHome(rootValue);
    const root = normalizeDirectory(expanded);
    if (!root) {
      warnings.push(`Configured discovery root is unavailable: ${safeSingleLine(rootValue, 1_000) || '(empty path)'}`);
      continue;
    }
    const key = pathKey(root);
    if (!queued.has(key)) {
      queue.push({ directory: root, level: 0 });
      queued.add(key);
    }
  }

  let visitedDirectories = 0;
  let truncated = false;
  while (queue.length > 0 && projects.size < limit && visitedDirectories < MAX_VISITED_DIRECTORIES) {
    const current = queue.shift();
    if (!current) { break; }
    visitedDirectories += 1;
    if (hasGitMetadata(current.directory)) {
      if (!workspacePaths.has(pathKey(current.directory))) {
        retainProject(projects, {
          name: path.basename(current.directory) || current.directory,
          path: current.directory,
          source: 'configured-root',
        }, limit);
      }
      continue;
    }
    if (current.level >= depth) { continue; }
    try {
      const entries = fs.readdirSync(current.directory, { withFileTypes: true });
      if (entries.length > MAX_ENTRIES_PER_DIRECTORY) {
        warnings.push(`Skipped excess entries under ${current.directory}; inspected the first ${MAX_ENTRIES_PER_DIRECTORY}.`);
        truncated = true;
      }
      for (const entry of entries.slice(0, MAX_ENTRIES_PER_DIRECTORY)) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORY_NAMES.has(entry.name)) { continue; }
        const child = path.join(current.directory, entry.name);
        const key = pathKey(child);
        if (queued.has(key)) { continue; }
        queue.push({ directory: child, level: current.level + 1 });
        queued.add(key);
      }
    } catch (error: unknown) {
      warnings.push(`Could not inspect ${current.directory}: ${errorMessage(error)}`);
    }
  }
  if (queue.length > 0 || visitedDirectories >= MAX_VISITED_DIRECTORIES) {
    truncated = true;
  }
  const values = [...projects.values()]
    .slice(0, limit)
    .map(project => {
      const git = readProjectGitBranch(project.path);
      return git ? { ...project, branch: git.branch } : project;
    })
    .sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  return { projects: values, warnings: warnings.slice(0, 100), visitedDirectories, truncated };
}

function retainProject(target: Map<string, DiscoveredProject>, project: DiscoveredProject, limit: number): void {
  if (target.size >= limit) { return; }
  const key = pathKey(project.path);
  const previous = target.get(key);
  if (!previous || project.source === 'workspace') { target.set(key, project); }
}

function hasGitMetadata(directory: string): boolean {
  try {
    const stat = fs.lstatSync(path.join(directory, '.git'));
    return !stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.size <= 4 * 1024));
  } catch {
    return false;
  }
}

function normalizeDirectory(value: string): string | undefined {
  if (typeof value !== 'string' || !path.isAbsolute(value)) { return undefined; }
  try {
    const normalized = path.normalize(value);
    return fs.statSync(normalized).isDirectory() ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function expandHome(value: string): string {
  const normalized = safePathSetting(value, 4_000);
  if (normalized === '~') { return os.homedir(); }
  return normalized.length > 2 && normalized[0] === '~' && (normalized[1] === '/' || normalized[1] === '\\')
    ? path.join(os.homedir(), normalized.slice(2).replace(/[\\/]/g, path.sep))
    : normalized;
}

function safePathSetting(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, maxLength)
    : '';
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

function pathKey(value: string): string {
  return process.platform === 'win32' ? value.toLocaleLowerCase() : value;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? safeSingleLine(error.message, 500) : 'unavailable directory';
}
