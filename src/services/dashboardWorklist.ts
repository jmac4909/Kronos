import { AgingReport } from './agingAnalyzer';
import { EvidenceGateResult } from './evidenceGate';
import { HumanReviewInbox } from './humanReviewInbox';
import { RunRecord } from './runStore';
import { isFreshActiveRun } from './runStatus';

export type DashboardWorklistKind = 'needs_human' | 'active_runs' | 'failing_gates' | 'recent_completed' | 'stale_items';
export type DashboardWorklistSeverity = 'critical' | 'warning' | 'info' | 'ok';

export interface DashboardWorklistItem {
  id: string;
  title: string;
  detail: string;
  severity: DashboardWorklistSeverity;
  ticketKey?: string;
  runId?: string;
  timestamp?: string;
}

export interface DashboardWorklistLane {
  kind: DashboardWorklistKind;
  title: string;
  emptyText: string;
  items: DashboardWorklistItem[];
}

export interface DashboardWorklistInput {
  runs: RunRecord[];
  humanReviewInbox: HumanReviewInbox;
  evidenceGates: EvidenceGateResult[];
  agingReport: AgingReport;
}

const COMPLETED_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);
type DashboardRunRecord = RunRecord & Record<string, unknown>;

export function buildDashboardWorklist(input: DashboardWorklistInput, limit = 5): DashboardWorklistLane[] {
  const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord);
  return [
    {
      kind: 'needs_human',
      title: 'Needs Human',
      emptyText: 'No human decisions queued.',
      items: input.humanReviewInbox.items.slice(0, limit).map(item => dashboardWorklistItem({
        id: item.id,
        title: item.title,
        detail: item.detail,
        severity: item.severity === 'critical' ? 'critical' : item.severity === 'warning' ? 'warning' : 'info',
      }, { ticketKey: item.ticketKey, runId: item.runId })),
    },
    {
      kind: 'active_runs',
      title: 'Active Runs',
      emptyText: 'No active agent runs.',
      items: sortRuns(runs.filter(isDashboardActiveRun), 'startedAt')
        .slice(0, limit)
        .map(run => {
          const status = runString(run, 'status') || 'unknown';
          const ticketKey = runString(run, 'ticket');
          return dashboardWorklistItem({
            id: `run:${runId(run)}`,
            title: `${runString(run, 'project') || 'Project'} ${runString(run, 'skill') || 'run'}`,
            detail: `${status}${ticketKey ? ` for ${ticketKey}` : ''}`,
            severity: status === 'paused' ? 'warning' : 'info',
          }, { ticketKey, runId: runId(run), timestamp: runString(run, 'startedAt') });
        }),
    },
    {
      kind: 'failing_gates',
      title: 'Failing Gates',
      emptyText: 'No failing evidence gates.',
      items: input.evidenceGates
        .filter(gate => gate.status === 'fail')
        .sort((a, b) => a.ticketKey.localeCompare(b.ticketKey))
        .slice(0, limit)
        .map(gate => ({
          id: `gate:${gate.ticketKey}`,
          title: `${gate.ticketKey} evidence gate failed`,
          detail: gate.summary,
          severity: 'critical',
          ticketKey: gate.ticketKey,
        })),
    },
    {
      kind: 'recent_completed',
      title: 'Recently Completed',
      emptyText: 'No completed runs recorded.',
      items: sortRuns(runs.filter(run => COMPLETED_RUN_STATUSES.has(runString(run, 'status'))), 'endedAt')
        .slice(0, limit)
        .map(run => {
          const status = runString(run, 'status') || 'completed';
          const ticketKey = runString(run, 'ticket');
          return dashboardWorklistItem({
            id: `completed:${runId(run)}`,
            title: `${runString(run, 'project') || 'Project'} ${runString(run, 'skill') || 'run'}`,
            detail: `${status}${ticketKey ? ` for ${ticketKey}` : ''}${evidenceStatusForRun(input.evidenceGates, ticketKey)}`,
            severity: status === 'waiting_for_review' ? 'info' : 'ok',
          }, { ticketKey, runId: runId(run), timestamp: runString(run, 'endedAt') });
        }),
    },
    {
      kind: 'stale_items',
      title: 'Stale Items',
      emptyText: 'No stale tickets or MRs.',
      items: input.agingReport.items.slice(0, limit).map(item => ({
        id: item.id,
        title: item.title,
        detail: `${item.ageDays}d old. ${item.detail}`,
        severity: item.severity === 'critical' ? 'critical' : item.severity === 'warning' ? 'warning' : 'info',
        ticketKey: item.ticketKey,
      })),
    },
  ];
}

function dashboardWorklistItem(
  base: Omit<DashboardWorklistItem, 'ticketKey' | 'runId' | 'timestamp'>,
  refs: { ticketKey?: string | undefined; runId?: string | undefined; timestamp?: string | undefined } = {},
): DashboardWorklistItem {
  const item: DashboardWorklistItem = { ...base };
  if (refs.ticketKey) { item.ticketKey = refs.ticketKey; }
  if (refs.runId) { item.runId = refs.runId; }
  if (refs.timestamp) { item.timestamp = refs.timestamp; }
  return item;
}

function sortRuns(runs: DashboardRunRecord[], timestampField: 'startedAt' | 'endedAt'): DashboardRunRecord[] {
  return [...runs].sort((a, b) => timestampValue(runString(b, timestampField)) - timestampValue(runString(a, timestampField)) || runId(a).localeCompare(runId(b)));
}

function isDashboardActiveRun(run: DashboardRunRecord): boolean {
  return isFreshActiveRun(run);
}

function timestampValue(value: unknown): number {
  if (!value) { return 0; }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.getTime() : 0;
}

function evidenceStatusForRun(gates: EvidenceGateResult[], ticketKey: unknown): string {
  if (!ticketKey) { return ''; }
  const gate = gates.find(candidate => candidate.ticketKey === ticketKey);
  return gate ? `; evidence gate ${gate.status}` : '';
}

function runId(run: DashboardRunRecord): string {
  return runString(run, 'id') || 'run';
}

function runString(run: DashboardRunRecord, key: string): string {
  const value = run[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isRunRecord(value: unknown): value is DashboardRunRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
