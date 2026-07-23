import * as fs from 'fs';
import * as os from 'os';
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
import { boundedOperationFailure } from './errorUtils';
import {
  ensurePrivateDirectoryPath,
  readPrivateTextFileIfPresent,
  writePrivateTextFileAtomically,
} from './privateFilePrimitives';
import { isRecord } from './records';
import { migrateLegacyKronosState } from './legacyStateMigration';
import {
  normalizeProjectBranch,
  normalizeProjectGitLabPath,
  normalizeProjectJenkinsUrl,
  normalizeProjectSonarKey,
} from './projectConfigNormalization';

const explicitKronosDir = process.env['KRONOS_DIR']?.trim();
const defaultKronosDir = path.join(os.homedir(), '.kronos');
if (!explicitKronosDir) {
  migrateLegacyKronosState(defaultKronosDir, path.join(os.homedir(), '.claude', 'kronos'));
}
export const KRONOS_DIR = explicitKronosDir || defaultKronosDir;
export const STATE_FILE = path.join(KRONOS_DIR, 'work.json');
const FILE_MODE = 0o600;
export const MAX_WORK_CATALOG_BYTES = 32 * 1024 * 1024;
export const WORK_CATALOG_SCHEMA_VERSION = 2;

export interface StateFileLoadIssue {
  filePath: string;
  detail: string;
}

export interface StateFileReadResult {
  state: KronosState | null;
  issues: StateFileLoadIssue[];
}

export function emptyWorkCatalog(): KronosState {
  return { schemaVersion: WORK_CATALOG_SCHEMA_VERSION, refreshedAt: null, projects: {}, tickets: {} };
}

export function readStateFileWithIssues(): StateFileReadResult {
  const filePath = STATE_FILE;
  try {
    const raw = JSON.parse(readBoundedPrivateUtf8File(
      filePath,
      MAX_WORK_CATALOG_BYTES,
      'Kronos Work catalog',
    )) as unknown;
    return normalizeWorkCatalog(raw, filePath);
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return { state: emptyWorkCatalog(), issues: [] };
    }
    return {
      state: emptyWorkCatalog(),
      issues: [{ filePath, detail: boundedOperationFailure(error, 'Could not read the local Work catalog.').display }],
    };
  }
}

export function writeStateFile(state: KronosState): void {
  const canonicalState = normalizeWorkCatalog({ ...state, schemaVersion: WORK_CATALOG_SCHEMA_VERSION }, STATE_FILE).state
    || emptyWorkCatalog();
  ensurePrivateDirectoryPath(KRONOS_DIR, 'Kronos Work catalog');
  writePrivateTextFileAtomically(STATE_FILE, `${JSON.stringify(canonicalState, null, 2)}\n`, {
    label: 'Kronos Work catalog',
    maxBytes: MAX_WORK_CATALOG_BYTES,
    temporaryPrefix: 'work-catalog',
    fileMode: FILE_MODE,
  });
}

export function normalizeWorkCatalog(raw: unknown, filePath = STATE_FILE): StateFileReadResult {
  if (!isRecord(raw)) {
    return { state: emptyWorkCatalog(), issues: [{ filePath, detail: 'Work catalog root must be an object.' }] };
  }
  const issues: StateFileLoadIssue[] = [];
  const sourceSchemaVersion = safeNonNegativeInteger(raw['schemaVersion']);
  if (sourceSchemaVersion !== undefined && sourceSchemaVersion > WORK_CATALOG_SCHEMA_VERSION) {
    return {
      state: emptyWorkCatalog(),
      issues: [{
        filePath,
        detail: `Work catalog schema ${sourceSchemaVersion} is newer than supported schema ${WORK_CATALOG_SCHEMA_VERSION}.`,
      }],
    };
  }
  const state = emptyWorkCatalog();
  const isLegacySchema = sourceSchemaVersion !== WORK_CATALOG_SCHEMA_VERSION;
  state.refreshedAt = safeTimestamp(raw['refreshedAt'])
    || (isLegacySchema ? safeTimestamp(raw['last_updated']) : undefined)
    || null;

  const rawProjects = isRecord(raw['projects']) ? raw['projects'] : {};
  const seenProjectPaths = new Set<string>();
  for (const [name, value] of Object.entries(rawProjects)) {
    const project = normalizeProject(value);
    const projectPathKey = project?.path ? persistedProjectPathKey(project.path) : undefined;
    if (project && (!projectPathKey || !seenProjectPaths.has(projectPathKey))) {
      state.projects[safeKey(name)] = project;
      if (projectPathKey) { seenProjectPaths.add(projectPathKey); }
    } else if (project && projectPathKey) {
      issues.push({ filePath, detail: `Ignored duplicate local project path for ${safeKey(name)}.` });
    } else {
      issues.push({ filePath, detail: `Ignored invalid project ${safeKey(name)}.` });
    }
  }

  const rawTickets = isRecord(raw['tickets']) ? raw['tickets'] : {};
  for (const [rawKey, value] of Object.entries(rawTickets)) {
    const key = normalizeTicketKey(rawKey);
    const ticket = normalizeTicket(value, isLegacySchema);
    if (key && ticket) { state.tickets[key] = ticket; }
    else { issues.push({ filePath, detail: `Ignored invalid Jira ticket ${safeKey(rawKey)}.` }); }
  }
  for (const [ticketKey, ticket] of Object.entries(state.tickets)) {
    const projectName = ticket.linked_local_project;
    if (!projectName || state.projects[projectName]?.path) { continue; }
    delete ticket.linked_local_project;
    issues.push({ filePath, detail: `Cleared unavailable local project link for ${ticketKey}.` });
  }
  return { state, issues };
}

export function readBoundedPrivateUtf8File(filePath: string, maxBytes: number, label: string): string {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`${label} byte limit must be a positive safe integer.`);
  }

  const content = readPrivateTextFileIfPresent(filePath, { label, maxBytes });
  if (content !== null) { return content; }
  const error = new Error(`${label} is unavailable: ${path.resolve(filePath)}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  throw error;
}

function normalizeProject(value: unknown): Project | undefined {
  if (!isRecord(value)) { return undefined; }
  const project: Project = { config: normalizeProjectConfig(value['config']) };
  const projectPath = normalizePersistedProjectPath(value['path']);
  const displayName = safeString(value['display_name'])?.slice(0, 200);
  if (projectPath) { project.path = projectPath; }
  if (displayName) { project.display_name = displayName; }
  return project;
}

function normalizePersistedProjectPath(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate || !path.isAbsolute(candidate)) { return undefined; }
  const normalized = path.normalize(candidate);
  try {
    return fs.realpathSync.native(normalized);
  } catch {
    return normalized;
  }
}

function persistedProjectPathKey(value: string): string {
  const normalized = path.normalize(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function normalizeProjectConfig(value: unknown): ProjectConfig {
  const raw = isRecord(value) ? value : {};
  const config: ProjectConfig = {};
  copyString(raw, config, 'repo_name');
  copyString(raw, config, 'jira_ticket_filter');
  const gitlabProjectId = safePositiveInteger(raw['gitlab_project_id']);
  const gitlabProjectPath = normalizeProjectGitLabPath(raw['gitlab_project_path']);
  if (gitlabProjectId !== undefined) { config.gitlab_project_id = gitlabProjectId; }
  else if (gitlabProjectPath) { config.gitlab_project_path = gitlabProjectPath; }
  const jenkinsUrl = normalizeProjectJenkinsUrl(raw['jenkins_url']);
  const sonarProjectKey = normalizeProjectSonarKey(raw['sonar_project_key']);
  const sonarBranch = normalizeProjectBranch(raw['sonar_branch']);
  const baseBranch = normalizeProjectBranch(raw['base_branch']);
  const defaultBranch = normalizeProjectBranch(raw['default_branch']);
  if (jenkinsUrl) { config.jenkins_url = jenkinsUrl; }
  if (sonarProjectKey) { config.sonar_project_key = sonarProjectKey; }
  if (sonarBranch) { config.sonar_branch = sonarBranch; }
  if (baseBranch) { config.base_branch = baseBranch; }
  if (defaultBranch) { config.default_branch = defaultBranch; }
  const extraDirs = safeStringArray(raw['extra_dirs']);
  if (extraDirs.length > 0) { config.extra_dirs = extraDirs; }
  const branchProfiles = normalizeBranchProfiles(raw['branch_profiles']);
  if (branchProfiles.length > 0) {
    config.branch_profiles = branchProfiles;
    const active = safeProfileBranch(raw['active_branch_profile']);
    if (active && branchProfiles.some(profile => profile.branch === active)) {
      config.active_branch_profile = active;
    }
  }
  return config;
}

function normalizeBranchProfiles(value: unknown): ProjectBranchProfile[] {
  if (!Array.isArray(value)) { return []; }
  const profiles: ProjectBranchProfile[] = [];
  const seen = new Set<string>();
  for (const raw of value.slice(0, 20)) {
    if (!isRecord(raw)) { continue; }
    const branch = safeProfileBranch(raw['branch']);
    if (!branch || seen.has(branch)) { continue; }
    const jenkinsUrl = normalizeProjectJenkinsUrl(raw['jenkins_url']);
    const sonarProjectKey = normalizeProjectSonarKey(raw['sonar_project_key']);
    const sonarBranch = normalizeProjectBranch(raw['sonar_branch']);
    if (!jenkinsUrl && !sonarProjectKey) { continue; }
    const profile: ProjectBranchProfile = { branch };
    if (jenkinsUrl) { profile.jenkins_url = jenkinsUrl; }
    if (sonarProjectKey) { profile.sonar_project_key = sonarProjectKey; }
    if (sonarBranch) { profile.sonar_branch = sonarBranch; }
    profiles.push(profile);
    seen.add(branch);
  }
  return profiles;
}

function safeProfileBranch(value: unknown): string | undefined {
  return normalizeProjectBranch(value);
}

function normalizeTicket(value: unknown, isLegacySchema: boolean): Ticket | undefined {
  if (!isRecord(value) || value['source'] === 'adhoc') { return undefined; }
  const summary = safeString(value['summary']);
  if (!summary) { return undefined; }
  const ticket: Ticket = {
    summary,
    type: safeString(value['type']) || 'Issue',
    priority: safeString(value['priority']) || 'Unknown',
    jira_status: safeString(value['jira_status'])
      || (isLegacySchema ? safeString(value['status']) : undefined)
      || 'Unknown',
    source: 'jira',
    mr: normalizeMergeRequest(value['mr'], isLegacySchema),
    build: normalizeBuild(value['build']),
  };
  const updated = safeTimestamp(value['updated']);
  const jiraStatusCategory = safeString(value['jira_status_category']);
  const jiraProjectKey = safeString(value['jira_project_key']);
  const description = safeMultilineString(value['description']);
  const jiraUrl = safeHttpUrl(value['jira_url']);
  const linkedLocalProject = safeString(value['linked_local_project'])
    || (isLegacySchema ? safeString(value['launch_project']) : undefined);
  const labels = safeStringArray(value['labels']);
  const attachments = normalizeAttachments(value['attachments']);
  if (updated) { ticket.updated = updated; }
  if (jiraStatusCategory) { ticket.jira_status_category = jiraStatusCategory; }
  if (jiraProjectKey) { ticket.jira_project_key = jiraProjectKey; }
  if (description) { ticket.description = description; }
  if (jiraUrl) { ticket.jira_url = jiraUrl; }
  if (linkedLocalProject) { ticket.linked_local_project = linkedLocalProject; }
  if (labels.length > 0) { ticket.labels = labels; }
  if (attachments.length > 0) { ticket.attachments = attachments; }
  return ticket;
}

function normalizeMergeRequest(value: unknown, isLegacySchema: boolean): MergeRequest | null {
  if (!isRecord(value)) { return null; }
  const iid = safePositiveInteger(value['iid']);
  const url = safeHttpUrl(value['url']);
  if (iid === undefined || !url) { return null; }
  const stateValue = safeString(value['state']);
  const reviewValue = safeString(value['review_status']);
  const mr: MergeRequest = {
    iid,
    url,
    state: stateValue === 'merged' || stateValue === 'closed' ? stateValue : 'opened',
    review_status: reviewValue === 'approved' || reviewValue === 'changes_requested' ? reviewValue : 'pending_review',
  };
  for (const key of ['title', 'author'] as const) {
    const item = safeString(value[key]);
    if (item) { mr[key] = item; }
  }
  const lastCommentAt = safeTimestamp(value['last_comment_at']);
  const lastDiscussionAt = safeTimestamp(value['last_discussion_at']);
  const sourceBranch = normalizeProjectBranch(value['source_branch']);
  const targetBranch = normalizeProjectBranch(value['target_branch']);
  if (lastCommentAt) { mr.last_comment_at = lastCommentAt; }
  if (lastDiscussionAt) { mr.last_discussion_at = lastDiscussionAt; }
  if (sourceBranch) { mr.source_branch = sourceBranch; }
  if (targetBranch) { mr.target_branch = targetBranch; }
  if (isLegacySchema && !mr.source_branch) {
    const legacySourceBranch = normalizeProjectBranch(value['sourceBranch'])
      || normalizeProjectBranch(value['branch'])
      || normalizeProjectBranch(value['head_branch']);
    if (legacySourceBranch) { mr.source_branch = legacySourceBranch; }
  }
  if (isLegacySchema && !mr.target_branch) {
    const legacyTargetBranch = normalizeProjectBranch(value['targetBranch']);
    if (legacyTargetBranch) { mr.target_branch = legacyTargetBranch; }
  }
  for (const key of ['comment_count', 'discussion_count', 'unresolved_discussion_count', 'resolved_discussion_count'] as const) {
    const item = safeNonNegativeInteger(value[key]);
    if (item !== undefined) { mr[key] = item; }
  }
  if (typeof value['discussions_resolved'] === 'boolean') { mr.discussions_resolved = value['discussions_resolved']; }
  return mr;
}

function normalizeBuild(value: unknown): BuildStatus | null {
  if (!isRecord(value)) { return null; }
  const number = safePositiveInteger(value['number']);
  const status = safeString(value['status']);
  const url = safeHttpUrl(value['url']);
  return number !== undefined && status && url ? { number, status, url } : null;
}

function normalizeAttachments(value: unknown): Array<{ filename: string; size: number; mimeType: string }> {
  if (!Array.isArray(value)) { return []; }
  const normalized: Array<{ filename: string; size: number; mimeType: string }> = [];
  for (const item of value.slice(0, 250)) {
    if (!isRecord(item)) { continue; }
    const filename = safeString(item['filename']);
    if (!filename) { continue; }
    normalized.push({
      filename,
      size: safeNonNegativeInteger(item['size']) || 0,
      mimeType: safeString(item['mimeType']) || 'application/octet-stream',
    });
  }
  return normalized;
}

function copyString<K extends keyof ProjectConfig>(raw: Record<string, unknown>, target: ProjectConfig, key: K): void {
  const value = safeString(raw[key]);
  if (value) { (target as Record<string, unknown>)[key] = value; }
}

function normalizeTicketKey(value: string): string | undefined {
  const key = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-\d{1,12}$/.test(key) ? key : undefined;
}

function safeKey(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160) || '(unnamed)';
}

function safeString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function safeMultilineString(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim();
  return normalized ? normalized.slice(0, 128_000) : undefined;
}

function safeTimestamp(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate) { return undefined; }
  const parsed = new Date(candidate);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
}

function safeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(safeString).filter((item): item is string => Boolean(item)))].slice(0, 500)
    : [];
}

function safePositiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function safeNonNegativeInteger(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function safeHttpUrl(value: unknown): string | undefined {
  const candidate = safeString(value);
  if (!candidate) { return undefined; }
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) {
      return undefined;
    }
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && Reflect.get(error, 'code') === code);
}
