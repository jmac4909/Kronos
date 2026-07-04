import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KronosState, QueueDecision, QueueItem, QueueState, Ticket, TicketEvidence } from '../state/types';
import { unknownErrorCode, unknownErrorMessage } from './errorUtils';
import { readJsonFile } from './jsonFiles';
import { QUEUE_ACTIONS, TICKET_ACTIONS } from './actionCatalog';

export const KRONOS_DIR = process.env['KRONOS_DIR'] || path.join(os.homedir(), '.claude', 'kronos');
export const STATE_FILE = path.join(KRONOS_DIR, 'state.json');
export const QUEUE_FILE = path.join(KRONOS_DIR, 'queue.json');
export const STATE_WRITE_LOCK_FILE = path.join(KRONOS_DIR, 'state.write.lock');
export const STATE_AUDIT_FILE = path.join(KRONOS_DIR, 'audit.jsonl');

const BACKUP_DIR = path.join(KRONOS_DIR, 'backups');
const WRITE_LOCK_STALE_MS = 5 * 60 * 1000;

interface StateBackup {
  filePath: string;
  targetPath: string;
  targetName: 'state.json' | 'queue.json';
  createdAt: string;
  size: number;
}

export interface StateFileLoadIssue {
  target: 'state.json' | 'queue.json';
  filePath: string;
  detail: string;
}

interface StateFileReadResult {
  state: KronosState | null;
  issues: StateFileLoadIssue[];
}

export interface StateAuditEvent {
  at: string;
  action: string;
  target?: string;
  backup?: string | null;
  [key: string]: unknown;
}

interface StateWriteLock {
  pid?: string | number;
  action?: string;
}

type MutableStateRecord = Record<string, unknown>;

const DEFAULT_OVERNIGHT = {
  enabled: false,
  max_concurrent: 1,
  max_open_mrs_per_project: 1,
  nightly_implement_cap: 1,
  vpn_check_host: '',
  vpn_check_port: 0,
  vpn_check_interval_sec: 60,
};

export const VALID_TICKET_ACTIONS = TICKET_ACTIONS;

export const VALID_QUEUE_ACTIONS = QUEUE_ACTIONS;

const VALID_TICKET_ACTION_SET = new Set<string>(VALID_TICKET_ACTIONS);
const VALID_QUEUE_ACTION_SET = new Set<string>(VALID_QUEUE_ACTIONS);

export function readStateFile(): KronosState | null {
  if (!fs.existsSync(STATE_FILE)) { return null; }
  const raw = readJsonFile(STATE_FILE);
  const migrated = migrateStateFileShape(raw);
  validateStateFileShape(migrated);
  return migrated;
}

export function readStateFileWithIssues(): StateFileReadResult {
  if (!fs.existsSync(STATE_FILE)) { return { state: null, issues: [] }; }
  try {
    const raw = readJsonFile(STATE_FILE);
    const migrated = migrateStateFileShape(raw);
    const issues = repairStateForUi(migrated);
    try {
      validateStateFileShape(migrated);
    } catch (e: unknown) {
      issues.push({
        target: 'state.json',
        filePath: STATE_FILE,
        detail: `State loaded with remaining validation warning: ${unknownErrorMessage(e, 'unknown validation error')}`,
      });
    }
    return { state: migrated, issues };
  } catch (e: unknown) {
    return {
      state: null,
      issues: [{
        target: 'state.json',
        filePath: STATE_FILE,
        detail: unknownErrorMessage(e, 'Failed to load state.json'),
      }],
    };
  }
}

export function readQueueFile(): QueueState | null {
  if (!fs.existsSync(QUEUE_FILE)) { return null; }
  const raw = readJsonFile(QUEUE_FILE);
  const migrated = migrateQueueFileShape(raw);
  validateQueueState(migrated);
  return migrated;
}

export function migrateStateFileShape(raw: unknown): KronosState {
  if (!isPlainObject(raw)) {
    throw new Error('state.json must be an object');
  }
  const settings = isPlainObject(raw['settings']) ? raw['settings'] : {};
  const overnight = isPlainObject(raw['overnight']) ? raw['overnight'] : undefined;
  const migrated: KronosState = {
    version: Number.isFinite(Number(raw['version'])) ? Number(raw['version']) : 1,
    last_updated: (raw['last_updated'] || null) as KronosState['last_updated'],
    settings: {
      ...settings,
      scan_dirs: Array.isArray(settings['scan_dirs']) ? (settings['scan_dirs'] as string[]) : [],
      overnight: { ...DEFAULT_OVERNIGHT, ...(isPlainObject(settings['overnight']) ? settings['overnight'] : {}) },
    },
    projects: {},
    tickets: {},
    adhoc_tasks: isPlainObject(raw['adhoc_tasks']) ? (raw['adhoc_tasks'] as KronosState['adhoc_tasks']) : {},
    overnight: overnight ? { enabled: Boolean(overnight['enabled']), last_run: (overnight['last_run'] || null) as KronosState['overnight']['last_run'] } : { enabled: false, last_run: null },
    discovered_projects: Array.isArray(raw['discovered_projects']) ? (raw['discovered_projects'] as KronosState['discovered_projects']) : [],
  };

  const rawProjects = isPlainObject(raw['projects']) ? raw['projects'] : {};
  for (const [name, project] of Object.entries(rawProjects)) {
    const p = isPlainObject(project) ? project : {};
    migrated.projects[name] = {
      path: String(p['path'] || ''),
      priority: Number.isFinite(Number(p['priority'])) ? Number(p['priority']) : 0,
      config: isPlainObject(p['config']) ? (p['config'] as KronosState['projects'][string]['config']) : {},
      health: typeof p['health'] === 'string' && ['green', 'yellow', 'red', 'gray'].includes(p['health']) ? (p['health'] as KronosState['projects'][string]['health']) : 'gray',
      summary: String(p['summary'] || ''),
      last_polled: (p['last_polled'] || null) as KronosState['projects'][string]['last_polled'],
      open_mr_count: Number.isFinite(Number(p['open_mr_count'])) ? Number(p['open_mr_count']) : 0,
    };
  }

  const rawTickets = isPlainObject(raw['tickets']) ? raw['tickets'] : {};
  for (const [key, ticket] of Object.entries(rawTickets)) {
    const t = isPlainObject(ticket) ? ticket : {};
    const migratedTicket: Ticket = {
      ...(t as Partial<Ticket>),
      summary: String(t['summary'] || ''),
      type: String(t['type'] || 'Story'),
      priority: String(t['priority'] || 'Medium'),
      jira_status: String(t['jira_status'] || 'Open'),
      source: t['source'] === 'adhoc' ? 'adhoc' : 'jira',
      projects: Array.isArray(t['projects']) ? (t['projects'] as string[]) : [],
      mr: (t['mr'] || null) as Ticket['mr'],
      build: (t['build'] || null) as Ticket['build'],
      next_action: String(t['next_action'] || 'implement'),
      last_action: (t['last_action'] || null) as Ticket['last_action'],
      last_action_at: (t['last_action_at'] || null) as Ticket['last_action_at'],
    };
    const evidence = migrateTicketEvidence(t['evidence']);
    if (evidence !== undefined) {
      migratedTicket.evidence = evidence;
    } else {
      delete migratedTicket.evidence;
    }
    migrated.tickets[key] = migratedTicket;
  }

  return migrated;
}

function migrateTicketEvidence(evidence: unknown): TicketEvidence | undefined {
  if (evidence === undefined || evidence === null) { return undefined; }
  if (!isPlainObject(evidence)) { return evidence as TicketEvidence; }
  const migrated: TicketEvidence = { ...(evidence as TicketEvidence) };
  if (evidence['notes'] === undefined) { delete migrated.notes; } else { migrated.notes = evidence['notes'] as NonNullable<TicketEvidence['notes']>; }
  if (evidence['acceptance_criteria'] === undefined) {
    delete migrated.acceptance_criteria;
  } else {
    migrated.acceptance_criteria = evidence['acceptance_criteria'] as NonNullable<TicketEvidence['acceptance_criteria']>;
  }
  if (evidence['checks'] === undefined) { delete migrated.checks; } else { migrated.checks = evidence['checks'] as NonNullable<TicketEvidence['checks']>; }
  if (evidence['environment_results'] === undefined) {
    delete migrated.environment_results;
  } else {
    migrated.environment_results = evidence['environment_results'] as NonNullable<TicketEvidence['environment_results']>;
  }
  if (evidence['risk_notes'] === undefined) { delete migrated.risk_notes; } else { migrated.risk_notes = evidence['risk_notes'] as NonNullable<TicketEvidence['risk_notes']>; }
  return migrated;
}

export function migrateQueueFileShape(raw: unknown): QueueState {
  if (!isPlainObject(raw)) {
    throw new Error('queue.json must be an object');
  }
  const items = Array.isArray(raw['items']) ? raw['items'].map(migrateQueueItemShape) : [];
  const queue: QueueState = {
    items,
    last_computed: typeof raw['last_computed'] === 'string' ? raw['last_computed'] : null,
  };
  if (raw['decisions'] !== undefined) {
    if (!isPlainObject(raw['decisions'])) {
      throw new Error('queue.decisions must be an object');
    }
    queue.decisions = Object.fromEntries(Object.entries(raw['decisions']).map(([key, decision]) => {
      if (!isPlainObject(decision)) {
        throw new Error(`queue decision ${key} must be an object`);
      }
      return [key, {
        ...decision,
        plan_id: String(decision['plan_id'] || key),
        ticket: typeof decision['ticket'] === 'string' ? decision['ticket'] : null,
        action: String(decision['action'] || 'implement'),
        decided_at: typeof decision['decided_at'] === 'string' ? decision['decided_at'] : new Date(0).toISOString(),
      } as QueueDecision];
    }));
  }
  return queue;
}

function migrateQueueItemShape(item: unknown, idx: number): QueueItem {
  if (!isPlainObject(item)) {
    throw new Error(`queue item ${idx} must be an object`);
  }
  const legacyProject = typeof item['project'] === 'string'
    ? item['project']
    : typeof item['projectName'] === 'string'
      ? item['projectName']
      : undefined;
  const projects = Array.isArray(item['projects'])
    ? item['projects']
    : typeof item['projects'] === 'string'
      ? [item['projects']]
      : legacyProject
        ? [legacyProject]
        : [];
  const ticket = typeof item['ticket'] === 'string' ? item['ticket'] : null;
  const action = String(item['action'] || item['next_action'] || 'implement');
  return {
    ...item,
    id: String(item['id'] || `queued-${ticket || action}-${idx}`),
    ticket,
    ticket_summary: typeof item['ticket_summary'] === 'string' ? item['ticket_summary'] : undefined,
    projects,
    project_path: String(item['project_path'] || item['path'] || item['cwd'] || ''),
    action,
    priority_score: Number.isFinite(Number(item['priority_score'])) ? Number(item['priority_score']) : 0,
    reason: String(item['reason'] || `Migrated queue item for ${ticket || action}`),
  } as QueueItem;
}

export function validateQueueState(queue: QueueState): void {
  if (!queue || !Array.isArray(queue.items)) {
    throw new Error('queue.json must contain an items array');
  }
  for (const [idx, item] of queue.items.entries()) {
    if (!isPlainObject(item)) {
      throw new Error(`queue item ${idx} must be an object`);
    }
    requireString(item.id, `queue item ${idx} id`);
    if (item.ticket !== null && item.ticket !== undefined) {
      requireString(item.ticket, `queue item ${idx} ticket`);
    }
    if (!Array.isArray(item.projects)) {
      throw new Error(`queue item ${idx} must contain a projects array`);
    }
    validateStringArray(item.projects, `queue item ${idx} projects`);
    requireString(item.project_path, `queue item ${idx} project_path`);
    validateActionValue(item.action, VALID_QUEUE_ACTION_SET, `queue item ${idx} action`);
    requireFiniteNumber(item.priority_score, `queue item ${idx} priority_score`);
    requireString(item.reason, `queue item ${idx} reason`);
  }
  if (queue.decisions !== undefined) {
    if (!isPlainObject(queue.decisions)) {
      throw new Error('queue.decisions must be an object');
    }
    for (const [key, decision] of Object.entries(queue.decisions)) {
      if (!isPlainObject(decision)) {
        throw new Error(`queue decision ${key} must be an object`);
      }
      requireString(decision.plan_id, `queue decision ${key} plan_id`);
      if (decision.ticket !== null && decision.ticket !== undefined) {
        requireString(decision.ticket, `queue decision ${key} ticket`);
      }
      if (decision.decision !== 'rejected' && decision.decision !== 'snoozed') {
        throw new Error(`queue decision ${key} has invalid decision`);
      }
      if (typeof decision.action !== 'string' || typeof decision.decided_at !== 'string') {
        throw new Error(`queue decision ${key} must contain action and decided_at`);
      }
      validateActionValue(decision.action, VALID_QUEUE_ACTION_SET, `queue decision ${key} action`);
      if (decision.snoozed_until !== undefined && typeof decision.snoozed_until !== 'string') {
        throw new Error(`queue decision ${key} snoozed_until must be a string`);
      }
    }
  }
}

function repairStateForUi(state: KronosState): StateFileLoadIssue[] {
  const issues: StateFileLoadIssue[] = [];

  if (!Array.isArray(state.settings.scan_dirs)) {
    state.settings.scan_dirs = [];
    addStateIssue(issues, 'state.settings.scan_dirs must be an array; using an empty list.');
  } else {
    filterStringArrayInPlace(state.settings.scan_dirs, 'state.settings.scan_dirs', issues);
  }

  for (const [name, project] of Object.entries({ ...state.projects })) {
    try {
      repairProjectRecord(name, project, issues);
      validateProjectRecord(name, project);
    } catch (e: unknown) {
      delete state.projects[name];
      addStateIssue(issues, `Skipped project ${name}: ${unknownErrorMessage(e, 'invalid project record')}`);
    }
  }

  for (const [key, ticket] of Object.entries({ ...state.tickets })) {
    try {
      repairTicketRecord(key, ticket, issues);
      validateTicketRecord(key, ticket);
    } catch (e: unknown) {
      delete state.tickets[key];
      addStateIssue(issues, `Skipped ticket ${key}: ${unknownErrorMessage(e, 'invalid ticket record')}`);
    }
  }

  return issues;
}

function repairProjectRecord(name: string, project: unknown, issues: StateFileLoadIssue[]): void {
  const record = requirePlainRecord(project, `project ${name} must be an object`);
  if (record['last_polled'] !== null && record['last_polled'] !== undefined && typeof record['last_polled'] !== 'string') {
    record['last_polled'] = String(record['last_polled']);
    addStateIssue(issues, `project ${name} last_polled was coerced to a string.`);
  }
  if (!isPlainObject(record['config'])) {
    record['config'] = {};
    addStateIssue(issues, `project ${name} config was invalid; using an empty config.`);
  }
  repairProjectConfig(record['config'], `project ${name} config`, issues);
}

function repairProjectConfig(config: unknown, label: string, issues: StateFileLoadIssue[]): void {
  const record = requirePlainRecord(config, `${label} must be an object`);
  for (const key of ['repo_name', 'jira_project_key', 'jira_ticket_filter', 'jenkins_url', 'sonar_project_key', 'github_repository', 'github_repo', 'github_api_url', 'base_branch', 'default_branch']) {
    if (record[key] !== undefined && typeof record[key] !== 'string') {
      record[key] = String(record[key]);
      addStateIssue(issues, `${label}.${key} was coerced to a string.`);
    }
  }
  if (record['gitlab_project_id'] !== undefined && typeof record['gitlab_project_id'] !== 'number') {
    const numeric = Number(record['gitlab_project_id']);
    if (Number.isFinite(numeric)) {
      record['gitlab_project_id'] = numeric;
      addStateIssue(issues, `${label}.gitlab_project_id was coerced to a number.`);
    } else {
      delete record['gitlab_project_id'];
      addStateIssue(issues, `${label}.gitlab_project_id was invalid and was ignored.`);
    }
  }
  if (record['extra_dirs'] !== undefined) {
    if (!Array.isArray(record['extra_dirs'])) {
      delete record['extra_dirs'];
      addStateIssue(issues, `${label}.extra_dirs was invalid and was ignored.`);
    } else {
      filterStringArrayInPlace(record['extra_dirs'], `${label}.extra_dirs`, issues);
    }
  }
  if (record['deploy_approvers'] !== undefined) {
    if (!Array.isArray(record['deploy_approvers'])) {
      delete record['deploy_approvers'];
      addStateIssue(issues, `${label}.deploy_approvers was invalid and was ignored.`);
    } else {
      record['deploy_approvers'] = record['deploy_approvers'].filter((approver, idx) => {
        if (!isPlainObject(approver)) {
          addStateIssue(issues, `${label}.deploy_approvers ${idx} was invalid and was ignored.`);
          return false;
        }
        for (const key of ['name', 'id', 'email']) {
          if (approver[key] !== undefined && typeof approver[key] !== 'string') {
            approver[key] = String(approver[key]);
            addStateIssue(issues, `${label}.deploy_approvers ${idx} ${key} was coerced to a string.`);
          }
        }
        return typeof approver['name'] === 'string' && typeof approver['id'] === 'string' && typeof approver['email'] === 'string';
      });
    }
  }
}

function repairTicketRecord(key: string, ticket: unknown, issues: StateFileLoadIssue[]): void {
  const record = requirePlainRecord(ticket, `ticket ${key} must be an object`);
  if (!Array.isArray(record['projects'])) {
    record['projects'] = [];
    addStateIssue(issues, `ticket ${key} projects was invalid; using an empty project list.`);
  } else {
    filterStringArrayInPlace(record['projects'], `ticket ${key} projects`, issues);
  }
  if (typeof record['next_action'] !== 'string' || !VALID_TICKET_ACTION_SET.has(record['next_action'])) {
    record['next_action'] = 'implement';
    addStateIssue(issues, `ticket ${key} next_action was invalid; using implement.`);
  }
  repairMergeRequest(record, key, issues);
  repairBuildStatus(record, key, issues);
  repairTicketEvidence(record, key, issues);
}

function repairMergeRequest(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void {
  if (ticket['mr'] === null || ticket['mr'] === undefined) { return; }
  if (!isPlainObject(ticket['mr'])) {
    ticket['mr'] = null;
    addStateIssue(issues, `ticket ${key} mr was invalid and was ignored.`);
    return;
  }
  const mr = ticket['mr'];
  if (typeof mr['iid'] !== 'number') {
    const numeric = Number(mr['iid']);
    if (Number.isFinite(numeric)) {
      mr['iid'] = numeric;
      addStateIssue(issues, `ticket ${key} mr.iid was coerced to a number.`);
    }
  }
  if (typeof mr['state'] !== 'string' || !['opened', 'merged', 'closed'].includes(mr['state'])) {
    mr['state'] = 'opened';
    addStateIssue(issues, `ticket ${key} mr.state was invalid; using opened.`);
  }
  if (typeof mr['review_status'] !== 'string' || !['pending_review', 'approved', 'changes_requested'].includes(mr['review_status'])) {
    mr['review_status'] = 'pending_review';
    addStateIssue(issues, `ticket ${key} mr.review_status was invalid; using pending_review.`);
  }
  if (mr['url'] !== undefined && typeof mr['url'] !== 'string') {
    mr['url'] = String(mr['url']);
    addStateIssue(issues, `ticket ${key} mr.url was coerced to a string.`);
  }
  repairMergeRequestMetadata(mr, key, issues);
  repairMergeRequestComments(mr, key, issues);
}

function repairMergeRequestMetadata(mr: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void {
  for (const field of ['comment_count', 'discussion_count', 'unresolved_discussion_count', 'resolved_discussion_count']) {
    if (mr[field] === undefined) { continue; }
    if (typeof mr[field] === 'number' && Number.isFinite(mr[field]) && mr[field] >= 0) {
      mr[field] = Math.floor(mr[field]);
      continue;
    }
    const numeric = Number(mr[field]);
    if (Number.isFinite(numeric) && numeric >= 0) {
      mr[field] = Math.floor(numeric);
      addStateIssue(issues, `ticket ${key} mr.${field} was coerced to a number.`);
    } else {
      delete mr[field];
      addStateIssue(issues, `ticket ${key} mr.${field} was invalid and was ignored.`);
    }
  }
  for (const field of ['last_comment_at', 'last_discussion_at']) {
    if (mr[field] !== undefined && typeof mr[field] !== 'string') {
      mr[field] = String(mr[field]);
      addStateIssue(issues, `ticket ${key} mr.${field} was coerced to a string.`);
    }
  }
  if (mr['discussions_resolved'] !== undefined && typeof mr['discussions_resolved'] !== 'boolean') {
    if (mr['discussions_resolved'] === 'true') {
      mr['discussions_resolved'] = true;
      addStateIssue(issues, `ticket ${key} mr.discussions_resolved was coerced to a boolean.`);
    } else if (mr['discussions_resolved'] === 'false') {
      mr['discussions_resolved'] = false;
      addStateIssue(issues, `ticket ${key} mr.discussions_resolved was coerced to a boolean.`);
    } else {
      delete mr['discussions_resolved'];
      addStateIssue(issues, `ticket ${key} mr.discussions_resolved was invalid and was ignored.`);
    }
  }
}

function repairMergeRequestComments(mr: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void {
  if (mr['comments'] === undefined) { return; }
  if (!Array.isArray(mr['comments'])) {
    delete mr['comments'];
    addStateIssue(issues, `ticket ${key} mr.comments was invalid and was ignored.`);
    return;
  }
  const comments: MutableStateRecord[] = [];
  for (const [idx, comment] of mr['comments'].entries()) {
    if (!isPlainObject(comment)) {
      addStateIssue(issues, `ticket ${key} mr comment ${idx} was invalid and was ignored.`);
      continue;
    }
    const body = typeof comment['body'] === 'string' ? comment['body'].trim() : '';
    if (!body) {
      addStateIssue(issues, `ticket ${key} mr comment ${idx} had no body and was ignored.`);
      continue;
    }
    const repaired: MutableStateRecord = { body };
    for (const field of ['id', 'author', 'created']) {
      if (comment[field] !== undefined && comment[field] !== null) {
        repaired[field] = String(comment[field]);
      }
    }
    comments.push(repaired);
  }
  mr['comments'] = comments.slice(-10);
}

function repairBuildStatus(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void {
  if (ticket['build'] === null || ticket['build'] === undefined) { return; }
  if (!isPlainObject(ticket['build'])) {
    ticket['build'] = null;
    addStateIssue(issues, `ticket ${key} build was invalid and was ignored.`);
    return;
  }
  const build = ticket['build'];
  if (typeof build['number'] !== 'number') {
    const numeric = Number(build['number']);
    if (Number.isFinite(numeric)) {
      build['number'] = numeric;
      addStateIssue(issues, `ticket ${key} build.number was coerced to a number.`);
    }
  }
  if (build['status'] !== undefined && typeof build['status'] !== 'string') {
    build['status'] = String(build['status']);
    addStateIssue(issues, `ticket ${key} build.status was coerced to a string.`);
  }
  if (build['url'] !== undefined && typeof build['url'] !== 'string') {
    build['url'] = String(build['url']);
    addStateIssue(issues, `ticket ${key} build.url was coerced to a string.`);
  }
}

function repairTicketEvidence(ticket: MutableStateRecord, key: string, issues: StateFileLoadIssue[]): void {
  const evidence = ticket['evidence'];
  if (evidence === null || evidence === undefined) { return; }
  if (!isPlainObject(evidence)) {
    delete ticket['evidence'];
    addStateIssue(issues, `ticket ${key} evidence was invalid and was ignored.`);
    return;
  }
  for (const section of ['notes', 'acceptance_criteria', 'checks', 'risk_notes']) {
    if (evidence[section] !== undefined && !Array.isArray(evidence[section])) {
      delete evidence[section];
      addStateIssue(issues, `ticket ${key} evidence.${section} was invalid and was ignored.`);
    }
  }
  if (evidence['environment_results'] !== undefined && !isPlainObject(evidence['environment_results'])) {
    delete evidence['environment_results'];
    addStateIssue(issues, `ticket ${key} evidence.environment_results was invalid and was ignored.`);
  }
}

function filterStringArrayInPlace(value: unknown[], label: string, issues: StateFileLoadIssue[]): void {
  const originalLength = value.length;
  const filtered = value.filter((item): item is string => typeof item === 'string');
  if (filtered.length !== originalLength) {
    value.splice(0, value.length, ...filtered);
    addStateIssue(issues, `${label} contained non-string entries that were ignored.`);
  }
}

function addStateIssue(issues: StateFileLoadIssue[], detail: string): void {
  issues.push({ target: 'state.json', filePath: STATE_FILE, detail });
}

function requirePlainRecord(value: unknown, message: string): MutableStateRecord {
  if (!isPlainObject(value)) {
    throw new Error(message);
  }
  return value;
}

export function validateStateFileShape(raw: unknown): void {
  if (!isPlainObject(raw)) {
    throw new Error('state.json must be an object');
  }
  const settings = raw['settings'];
  if (!isPlainObject(settings)) {
    throw new Error('state.json must contain settings');
  }
  if (!Array.isArray(settings['scan_dirs'])) {
    throw new Error('state.settings.scan_dirs must be an array');
  }
  validateStringArray(settings['scan_dirs'], 'state.settings.scan_dirs');
  const projects = raw['projects'];
  if (!isPlainObject(projects)) {
    throw new Error('state.json must contain projects');
  }
  for (const [name, project] of Object.entries(projects)) {
    validateProjectRecord(name, project);
  }
  const tickets = raw['tickets'];
  if (!isPlainObject(tickets)) {
    throw new Error('state.json must contain tickets');
  }
  for (const [key, ticket] of Object.entries(tickets)) {
    validateTicketRecord(key, ticket);
  }
}

function validateTicketRecord(key: string, ticket: unknown): void {
  if (!isPlainObject(ticket)) {
    throw new Error(`ticket ${key} must be an object`);
  }
  const t = ticket;
  requireString(t['summary'], `ticket ${key} summary`);
  requireString(t['type'], `ticket ${key} type`);
  requireString(t['priority'], `ticket ${key} priority`);
  requireString(t['jira_status'], `ticket ${key} jira_status`);
  if (t['source'] !== 'jira' && t['source'] !== 'adhoc') {
    throw new Error(`ticket ${key} source must be jira or adhoc`);
  }
  if (!Array.isArray(t['projects'])) {
    throw new Error(`ticket ${key} must contain a projects array`);
  }
  validateStringArray(t['projects'], `ticket ${key} projects`);
  validateActionValue(t['next_action'], VALID_TICKET_ACTION_SET, `ticket ${key} next_action`);
  validateMergeRequest(t['mr'], `ticket ${key} mr`);
  validateBuildStatus(t['build'], `ticket ${key} build`);
  const evidenceValue = t['evidence'];
  if (evidenceValue !== null && evidenceValue !== undefined && !isPlainObject(evidenceValue)) {
    throw new Error(`ticket ${key} evidence must be an object`);
  }
  const evidence = isPlainObject(evidenceValue) ? evidenceValue : undefined;
  if (!evidence) { return; }

  const notes = evidence['notes'];
  if (notes !== undefined && !Array.isArray(notes)) {
    throw new Error(`ticket ${key} evidence.notes must be an array`);
  }
  for (const [idx, note] of (Array.isArray(notes) ? notes : []).entries()) {
    validateEvidenceNote(note, `ticket ${key} evidence note ${idx}`);
  }
  const acceptanceCriteria = evidence['acceptance_criteria'];
  if (acceptanceCriteria !== undefined) {
    if (!Array.isArray(acceptanceCriteria)) {
      throw new Error(`ticket ${key} evidence.acceptance_criteria must be an array`);
    }
    for (const [idx, criterion] of acceptanceCriteria.entries()) {
      if (!isPlainObject(criterion) || typeof criterion['text'] !== 'string') {
        throw new Error(`ticket ${key} acceptance criterion ${idx} must contain text`);
      }
      if (criterion['checked'] !== undefined && typeof criterion['checked'] !== 'boolean') {
        throw new Error(`ticket ${key} acceptance criterion ${idx} checked must be boolean`);
      }
    }
  }
  const checks = evidence['checks'];
  if (checks !== undefined) {
    if (!Array.isArray(checks)) {
      throw new Error(`ticket ${key} evidence.checks must be an array`);
    }
    for (const [idx, check] of checks.entries()) {
      if (!isPlainObject(check) || typeof check['name'] !== 'string') {
        throw new Error(`ticket ${key} evidence check ${idx} must contain name`);
      }
      if (typeof check['result'] !== 'string' || !['pass', 'fail', 'warn', 'unknown'].includes(check['result'])) {
        throw new Error(`ticket ${key} evidence check ${idx} has invalid result`);
      }
      if (check['confidence'] !== undefined && (typeof check['confidence'] !== 'string' || !['low', 'medium', 'high'].includes(check['confidence']))) {
        throw new Error(`ticket ${key} evidence check ${idx} has invalid confidence`);
      }
    }
  }
  const environmentResults = evidence['environment_results'];
  if (environmentResults !== undefined) {
    if (!isPlainObject(environmentResults)) {
      throw new Error(`ticket ${key} evidence.environment_results must be an object`);
    }
    for (const [env, result] of Object.entries(environmentResults)) {
      if (!isPlainObject(result) || typeof result['detail'] !== 'string') {
        throw new Error(`ticket ${key} environment result ${env} must contain detail`);
      }
      if (typeof result['status'] !== 'string' || !['pass', 'fail', 'warn', 'unknown'].includes(result['status'])) {
        throw new Error(`ticket ${key} environment result ${env} has invalid status`);
      }
      requireString(result['environment'], `ticket ${key} environment result ${env} environment`);
      requireString(result['checked_at'], `ticket ${key} environment result ${env} checked_at`);
    }
  }
  const riskNotes = evidence['risk_notes'];
  if (riskNotes !== undefined) {
    if (!Array.isArray(riskNotes)) {
      throw new Error(`ticket ${key} evidence.risk_notes must be an array`);
    }
    for (const [idx, risk] of riskNotes.entries()) {
      if (!isPlainObject(risk) || typeof risk['text'] !== 'string') {
        throw new Error(`ticket ${key} risk note ${idx} must contain text`);
      }
      if (risk['severity'] !== undefined && (typeof risk['severity'] !== 'string' || !['low', 'medium', 'high'].includes(risk['severity']))) {
        throw new Error(`ticket ${key} risk note ${idx} has invalid severity`);
      }
    }
  }
}

function validateProjectRecord(name: string, project: unknown): void {
  if (!isPlainObject(project)) {
    throw new Error(`project ${name} must be an object`);
  }
  const p = project;
  requireString(p['path'], `project ${name} path`);
  requireFiniteNumber(p['priority'], `project ${name} priority`);
  if (!isPlainObject(p['config'])) {
    throw new Error(`project ${name} config must be an object`);
  }
  validateProjectConfig(p['config'], `project ${name} config`);
  if (typeof p['health'] !== 'string' || !['green', 'yellow', 'red', 'gray'].includes(p['health'])) {
    throw new Error(`project ${name} health is invalid`);
  }
  requireString(p['summary'], `project ${name} summary`);
  if (p['last_polled'] !== null && p['last_polled'] !== undefined) {
    requireString(p['last_polled'], `project ${name} last_polled`);
  }
  requireFiniteNumber(p['open_mr_count'], `project ${name} open_mr_count`);
}

function validateProjectConfig(config: unknown, label: string): void {
  if (!isPlainObject(config)) {
    throw new Error(`${label} must be an object`);
  }
  for (const key of ['repo_name', 'jira_project_key', 'jira_ticket_filter', 'jenkins_url', 'sonar_project_key', 'github_repository', 'github_repo', 'github_api_url', 'base_branch', 'default_branch']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      throw new Error(`${label}.${key} must be a string`);
    }
  }
  if (config['gitlab_project_id'] !== undefined) {
    requireFiniteNumber(config['gitlab_project_id'], `${label}.gitlab_project_id`);
  }
  if (config['extra_dirs'] !== undefined) {
    if (!Array.isArray(config['extra_dirs'])) {
      throw new Error(`${label}.extra_dirs must be an array`);
    }
    validateStringArray(config['extra_dirs'], `${label}.extra_dirs`);
  }
  if (config['deploy_approvers'] !== undefined) {
    if (!Array.isArray(config['deploy_approvers'])) {
      throw new Error(`${label}.deploy_approvers must be an array`);
    }
    for (const [idx, approver] of config['deploy_approvers'].entries()) {
      if (!isPlainObject(approver)) {
        throw new Error(`${label}.deploy_approvers ${idx} must be an object`);
      }
      requireString(approver['name'], `${label}.deploy_approvers ${idx} name`);
      requireString(approver['id'], `${label}.deploy_approvers ${idx} id`);
      requireString(approver['email'], `${label}.deploy_approvers ${idx} email`);
    }
  }
}

function validateMergeRequest(mr: unknown, label: string): void {
  if (mr === null || mr === undefined) { return; }
  if (!isPlainObject(mr)) {
    throw new Error(`${label} must be an object or null`);
  }
  const value = mr;
  requireFiniteNumber(value['iid'], `${label}.iid`);
  if (typeof value['state'] !== 'string' || !['opened', 'merged', 'closed'].includes(value['state'])) {
    throw new Error(`${label}.state is invalid`);
  }
  if (typeof value['review_status'] !== 'string' || !['pending_review', 'approved', 'changes_requested'].includes(value['review_status'])) {
    throw new Error(`${label}.review_status is invalid`);
  }
  requireString(value['url'], `${label}.url`);
  for (const field of ['comment_count', 'discussion_count', 'unresolved_discussion_count', 'resolved_discussion_count']) {
    if (value[field] !== undefined) {
      requireFiniteNumber(value[field], `${label}.${field}`);
    }
  }
  for (const field of ['last_comment_at', 'last_discussion_at']) {
    if (value[field] !== undefined) {
      requireString(value[field], `${label}.${field}`);
    }
  }
  if (value['discussions_resolved'] !== undefined && typeof value['discussions_resolved'] !== 'boolean') {
    throw new Error(`${label}.discussions_resolved must be a boolean`);
  }
  if (value['comments'] !== undefined) {
    if (!Array.isArray(value['comments'])) {
      throw new Error(`${label}.comments must be an array`);
    }
    for (const [idx, comment] of value['comments'].entries()) {
      validateMergeRequestComment(comment, `${label} comment ${idx}`);
    }
  }
}

function validateMergeRequestComment(comment: unknown, label: string): void {
  if (!isPlainObject(comment)) {
    throw new Error(`${label} must be an object`);
  }
  const value = comment;
  requireString(value['body'], `${label}.body`);
  for (const field of ['id', 'author', 'created']) {
    if (value[field] !== undefined && typeof value[field] !== 'string') {
      throw new Error(`${label}.${field} must be a string`);
    }
  }
}

function validateBuildStatus(build: unknown, label: string): void {
  if (build === null || build === undefined) { return; }
  if (!isPlainObject(build)) {
    throw new Error(`${label} must be an object or null`);
  }
  const value = build;
  requireFiniteNumber(value['number'], `${label}.number`);
  requireString(value['status'], `${label}.status`);
  requireString(value['url'], `${label}.url`);
}

function validateEvidenceNote(note: unknown, label: string): void {
  if (!isPlainObject(note)) {
    throw new Error(`${label} must be an object`);
  }
  const value = note;
  requireString(value['at'], `${label}.at`);
  if (typeof value['kind'] !== 'string' || !['note', 'test', 'risk', 'decision'].includes(value['kind'])) {
    throw new Error(`${label}.kind is invalid`);
  }
  requireString(value['text'], `${label}.text`);
}

function validateActionValue(value: unknown, allowed: Set<string>, label: string): void {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${label} has unsupported action "${String(value)}"`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function requireString(value: unknown, label: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string`);
  }
}

function requireFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

function validateStringArray(value: unknown[], label: string): void {
  for (const [idx, item] of value.entries()) {
    if (typeof item !== 'string') {
      throw new Error(`${label} ${idx} must be a string`);
    }
  }
}

export function writeJsonFileAtomic(filePath: string, data: unknown, action: string): void {
  ensureDir(path.dirname(filePath));
  ensureDir(BACKUP_DIR);
  const releaseLock = acquireStateWriteLock(action, filePath);
  try {
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const backupPath = path.join(BACKUP_DIR, `${path.basename(filePath)}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);

    let backedUp = false;
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, backupPath);
      backedUp = true;
    }

    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
    fs.renameSync(tmpPath, filePath);
    auditEvent(action, {
      target: filePath,
      backup: backedUp ? backupPath : null,
    });
  } finally {
    releaseLock();
  }
}

export function listBackups(): StateBackup[] {
  if (!fs.existsSync(BACKUP_DIR)) { return []; }
  return fs.readdirSync(BACKUP_DIR)
    .filter(file => file.endsWith('.bak') && (file.startsWith('state.json.') || file.startsWith('queue.json.')))
    .map(file => {
      const filePath = path.join(BACKUP_DIR, file);
      const stat = fs.statSync(filePath);
      const targetName = file.startsWith('state.json.') ? 'state.json' : 'queue.json';
      return {
        filePath,
        targetPath: targetName === 'state.json' ? STATE_FILE : QUEUE_FILE,
        targetName,
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
      } as StateBackup;
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function restoreBackup(backupPath: string): StateBackup {
  const backup = listBackups().find(entry => entry.filePath === backupPath);
  if (!backup) {
    throw new Error(`Backup not found or not restorable: ${backupPath}`);
  }

  const raw = readJsonFile(backup.filePath);
  let restored: KronosState | QueueState;
  if (backup.targetName === 'state.json') {
    restored = migrateStateFileShape(raw);
    validateStateFileShape(restored);
  } else {
    restored = migrateQueueFileShape(raw);
    validateQueueState(restored);
  }
  writeJsonFileAtomic(backup.targetPath, restored, `restore-${backup.targetName}`);
  return backup;
}

export function listStateAuditEvents(limit = 100): StateAuditEvent[] {
  if (!fs.existsSync(STATE_AUDIT_FILE)) { return []; }
  const max = Math.max(1, Math.floor(limit));
  const lines = fs.readFileSync(STATE_AUDIT_FILE, 'utf-8').split(/\r?\n/).filter(Boolean);
  return lines.slice(-max).reverse().map((line): StateAuditEvent => {
    try {
      const event = JSON.parse(line);
      return {
        at: typeof event.at === 'string' ? event.at : '',
        action: typeof event.action === 'string' ? event.action : 'unknown',
        ...event,
      };
    } catch (e: unknown) {
      return {
        at: '',
        action: 'invalid-audit-entry',
        error: unknownErrorMessage(e, 'Invalid audit JSONL entry'),
        raw: line.slice(0, 500),
      };
    }
  });
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function auditEvent(action: string, detail: Record<string, unknown>): void {
  ensureDir(KRONOS_DIR);
  fs.appendFileSync(STATE_AUDIT_FILE, JSON.stringify({ at: new Date().toISOString(), action, ...detail }) + '\n');
}

function acquireStateWriteLock(action: string, target: string): () => void {
  ensureDir(KRONOS_DIR);
  clearStaleWriteLock();
  const payload = JSON.stringify({ pid: process.pid, action, target, createdAt: new Date().toISOString() }) + '\n';
  let fd: number | undefined;
  try {
    fd = fs.openSync(STATE_WRITE_LOCK_FILE, 'wx');
    fs.writeFileSync(fd, payload);
  } catch (e: unknown) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch (closeError: unknown) {
        console.warn(unknownErrorMessage(closeError, 'Could not close failed Kronos state write lock descriptor.'));
      }
    }
    const current = readCurrentWriteLock();
    if (current) {
      const lockDetail = ` by pid ${current.pid || 'unknown'} for ${current.action || 'unknown action'}`;
      throw new Error(`Kronos state write lock is held${lockDetail}. Retry after the current write finishes.`);
    }
    throw new Error(`Could not acquire Kronos state write lock: ${unknownErrorMessage(e, 'state lock unavailable')}`);
  }
  fs.closeSync(fd);
  let released = false;
  return () => {
    if (released) { return; }
    released = true;
    try {
      fs.unlinkSync(STATE_WRITE_LOCK_FILE);
    } catch (e: unknown) {
      if (unknownErrorCode(e) !== 'ENOENT') {
        console.warn(unknownErrorMessage(e, 'Could not release Kronos state write lock.'));
      }
    }
  };
}

function clearStaleWriteLock(): void {
  if (!fs.existsSync(STATE_WRITE_LOCK_FILE)) { return; }
  try {
    const stat = fs.statSync(STATE_WRITE_LOCK_FILE);
    if (Date.now() - stat.mtime.getTime() > WRITE_LOCK_STALE_MS) {
      fs.unlinkSync(STATE_WRITE_LOCK_FILE);
      auditEvent('clear-stale-state-write-lock', { lock: STATE_WRITE_LOCK_FILE });
    }
  } catch (e: unknown) {
    if (unknownErrorCode(e) !== 'ENOENT') {
      console.warn(unknownErrorMessage(e, 'Could not clear stale Kronos state write lock.'));
    }
  }
}

function readCurrentWriteLock(): StateWriteLock | null {
  try {
    const lock = readJsonFile(STATE_WRITE_LOCK_FILE);
    if (!isPlainObject(lock)) { return null; }
    const current: StateWriteLock = {};
    const pid = lock['pid'];
    const action = lock['action'];
    if (typeof pid === 'string' || typeof pid === 'number') { current.pid = pid; }
    if (typeof action === 'string') { current.action = action; }
    return current;
  } catch {
    return null;
  }
}
