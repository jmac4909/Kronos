import { KronosState, Ticket } from '../state/types';
import { evidenceChecks, evidenceString } from './evidenceData';
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

export function isDeployMonitorRunMatch(run: DeployMonitorRunLike, match: DeployMonitorRunMatch): boolean {
  if (run.skill !== 'deploy-monitor' || run.ticket !== match.ticketKey) { return false; }
  if (run.project !== match.projectName && run.projectPath !== match.projectPath) { return false; }
  const runMrIid = promptMetadataMergeRequestIid(run.promptMetadata);
  return runMrIid === undefined || match.mrIid === undefined || runMrIid === match.mrIid;
}

export function isHandledDeployMonitorRun(run: DeployMonitorRunLike): boolean {
  return isFreshActiveRun(run) || (typeof run.status === 'string' && HANDLED_DEPLOY_MONITOR_STATUSES.has(run.status));
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

export function hasDeployMonitorHandoffIssue(ticket: Ticket, summary: string): boolean {
  const expectedName = deployMonitorHandoffCheckName(ticket);
  return evidenceChecks(ticket).some(check =>
    evidenceString(check, 'name') === expectedName &&
    evidenceString(check, 'result') === 'fail' &&
    evidenceString(check, 'summary') === summary
  );
}
