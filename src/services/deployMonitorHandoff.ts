import { KronosState, Ticket } from '../state/types';
import { evidenceChecks, evidenceString } from './evidenceData';
import { runAttentionLine } from './runAttention';
import { isFreshActiveRun } from './runStatus';

export const DEPLOY_MONITOR_HANDOFF_CHECK_PREFIX = 'Deploy monitor handoff';

export interface DeployMonitorProjectResolution {
  kind: 'ok' | 'blocked';
  projectName?: string;
  projectPath?: string;
  reason?: string;
}

export interface DeployMonitorRunLike {
  skill?: unknown;
  ticket?: unknown;
  project?: unknown;
  projectPath?: unknown;
  status?: unknown;
  promptMetadata?: unknown;
  endedAt?: unknown;
  exitCode?: unknown;
  events?: unknown;
}

export interface DeployMonitorRunMatch {
  projectName: string;
  projectPath: string;
  ticketKey: string;
  mrIid?: number | undefined;
}

const HANDLED_DEPLOY_MONITOR_STATUSES = new Set(['completed', 'waiting_for_review']);
const ATTENTION_DEPLOY_MONITOR_STATUSES = new Set(['failed', 'needs_human', 'cancelled']);

export function resolveDeployMonitorProject(
  state: Pick<KronosState, 'projects'> | null | undefined,
  ticketKey: string,
  ticket: Ticket,
): DeployMonitorProjectResolution {
  const linkedProjects = [...new Set((ticket.projects || []).filter(project => typeof project === 'string' && project.trim()).map(project => project.trim()))];
  if (linkedProjects.length === 0) {
    return { kind: 'blocked', reason: `${ticketKey} MR merged, but no linked project was found for deploy monitoring.` };
  }
  if (linkedProjects.length > 1) {
    return {
      kind: 'blocked',
      reason: `${ticketKey} MR merged, but it is linked to multiple projects (${linkedProjects.join(', ')}). Pick the deploy project before starting deploy monitoring.`,
    };
  }
  const projectName = linkedProjects[0];
  if (!projectName) {
    return { kind: 'blocked', reason: `${ticketKey} MR merged, but no linked project was found for deploy monitoring.` };
  }
  const projectPath = state?.projects?.[projectName]?.path;
  if (!projectPath) {
    return { kind: 'blocked', reason: `${ticketKey} MR merged, but ${projectName} has no registered path for deploy monitoring.` };
  }
  return { kind: 'ok', projectName, projectPath };
}

export function hasHandledDeployMonitorRun(runs: DeployMonitorRunLike[], match: DeployMonitorRunMatch): boolean {
  return runs.some(run => isDeployMonitorRunMatch(run, match) && isHandledDeployMonitorRun(run));
}

export function deployMonitorAttentionIssue(runs: DeployMonitorRunLike[], match: DeployMonitorRunMatch): string | undefined {
  const run = runs.find(candidate => isDeployMonitorRunMatch(candidate, match) && isAttentionDeployMonitorRun(candidate));
  if (!run) { return undefined; }
  const status = runStatusLabel(run.status);
  const detail = runAttentionLine(run, 180);
  return `${match.ticketKey} merged, but a prior deploy monitor ${status}${detail ? `: ${detail}` : ''}. Resolve it in Run Center before dispatching another deploy monitor.`;
}

export function isDeployMonitorRunMatch(run: DeployMonitorRunLike, match: DeployMonitorRunMatch): boolean {
  if (run.skill !== 'deploy-monitor' || run.ticket !== match.ticketKey) { return false; }
  if (run.project !== match.projectName && run.projectPath !== match.projectPath) { return false; }
  const runMrIid = promptMetadataMergeRequestIid(run.promptMetadata);
  if (match.mrIid === undefined) { return true; }
  if (runMrIid === undefined) { return false; }
  return runMrIid === match.mrIid;
}

export function isHandledDeployMonitorRun(run: DeployMonitorRunLike): boolean {
  return isFreshActiveRun(run) || (typeof run.status === 'string' && HANDLED_DEPLOY_MONITOR_STATUSES.has(run.status));
}

function isAttentionDeployMonitorRun(run: DeployMonitorRunLike): boolean {
  return typeof run.status === 'string' && ATTENTION_DEPLOY_MONITOR_STATUSES.has(run.status);
}

function runStatusLabel(status: unknown): string {
  if (status === 'failed') { return 'failed'; }
  if (status === 'needs_human') { return 'needs human review'; }
  if (status === 'cancelled') { return 'was cancelled'; }
  return 'needs attention';
}

export function promptMetadataMergeRequestIid(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { return undefined; }
  const raw = (value as Record<string, unknown>)['mergeRequestIid'];
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function deployMonitorHandoffCheckName(ticket: Ticket): string {
  return `${DEPLOY_MONITOR_HANDOFF_CHECK_PREFIX}${ticket.mr?.iid ? ` MR !${ticket.mr.iid}` : ''}`;
}

export function deployMonitorHandoffIssueSummary(ticket: Ticket): string | undefined {
  const expectedName = deployMonitorHandoffCheckName(ticket);
  const check = evidenceChecks(ticket).find(candidate =>
    evidenceString(candidate, 'name') === expectedName &&
    evidenceString(candidate, 'result') === 'fail'
  );
  if (!check) { return undefined; }
  return evidenceString(check, 'summary') || expectedName;
}

export function hasDeployMonitorHandoffIssue(ticket: Ticket, summary: string): boolean {
  return deployMonitorHandoffIssueSummary(ticket) === summary;
}
