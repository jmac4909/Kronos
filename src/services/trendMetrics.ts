import { Ticket } from '../state/types';
import { evidenceChecks, evidenceEnvironmentResults, evidenceString } from './evidenceData';
import { isRecord, recordString } from './records';

interface TrendMetricsInput {
  runs: unknown[];
  tickets: Record<string, Ticket>;
  now?: Date;
  windowDays?: number;
}

interface TrendMetric {
  label: string;
  value: string;
  detail: string;
  status: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface TrendMetricsReport {
  generatedAt: string;
  windowDays: number;
  runsConsidered: number;
  ticketsConsidered: number;
  summary: string;
  metrics: TrendMetric[];
}

const SUCCESS_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);
const FINISHED_RUN_STATUSES = new Set(['completed', 'waiting_for_review', 'failed', 'cancelled', 'needs_human']);
type RunMetricRecord = Record<string, unknown>;

export function computeTrendMetrics(input: TrendMetricsInput): TrendMetricsReport {
  const now = input.now || new Date();
  const windowDays = input.windowDays || 14;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const rawRuns = Array.isArray(input.runs) ? input.runs : [];
  const runs = rawRuns
    .filter(isRecord)
    .filter(run => isInWindow(recordString(run, 'endedAt') || recordString(run, 'startedAt'), windowStart, now));
  const tickets = Object.entries(input.tickets || {})
    .filter(([_, ticket]) => ticketInWindow(ticket, windowStart, now));

  const finishedRuns = runs.filter(run => FINISHED_RUN_STATUSES.has(recordString(run, 'status')));
  const completedRuns = finishedRuns.filter(run => SUCCESS_RUN_STATUSES.has(recordString(run, 'status'))).length;
  const failedRuns = finishedRuns.filter(run => isFailedRunStatus(recordString(run, 'status'))).length;
  const retryRuns = runs.filter(hasRetryMetadata).length;
  const verificationRuns = finishedRuns.filter(run => recordString(run, 'skill').includes('verify'));
  const passedVerificationRuns = verificationRuns.filter(run => SUCCESS_RUN_STATUSES.has(recordString(run, 'status'))).length;

  const builds = tickets.map(([_, ticket]) => ticket.build).filter(Boolean) as NonNullable<Ticket['build']>[];
  const passedBuilds = builds.filter(build => isPassingBuild(build.status)).length;
  const failedBuilds = builds.filter(build => isFailingBuild(build.status)).length;

  const mrs = tickets.map(([_, ticket]) => ticket.mr).filter(Boolean) as NonNullable<Ticket['mr']>[];
  const changesRequestedMrs = mrs.filter(mr => mr.review_status === 'changes_requested').length;
  const approvedMrs = mrs.filter(mr => mr.review_status === 'approved').length;

  const structuredEvidenceChecks = tickets.flatMap(([_, ticket]) => evidenceChecks(ticket));
  const passedEvidenceChecks = structuredEvidenceChecks.filter(check => evidenceString(check, 'result') === 'pass').length;
  const failedEvidenceChecks = structuredEvidenceChecks.filter(check => evidenceString(check, 'result') === 'fail').length;
  const environmentResults = tickets.flatMap(([_, ticket]) => evidenceEnvironmentResults(ticket));
  const passedEnvironmentResults = environmentResults.filter(result => evidenceString(result, 'status') === 'pass').length;
  const failedEnvironmentResults = environmentResults.filter(result => evidenceString(result, 'status') === 'fail').length;

  const cycleHours = cycleTimesHours(input.tickets || {}, runs);
  const avgCycleHours = cycleHours.length > 0
    ? cycleHours.reduce((sum, hours) => sum + hours, 0) / cycleHours.length
    : 0;

  const runCompletionRate = percent(completedRuns, finishedRuns.length);
  const buildPassRate = percent(passedBuilds, passedBuilds + failedBuilds);
  const verificationPassRate = percent(passedVerificationRuns + passedEvidenceChecks + passedEnvironmentResults, verificationRuns.length + passedEvidenceChecks + failedEvidenceChecks + passedEnvironmentResults + failedEnvironmentResults);
  const reworkRate = percent(retryRuns + failedRuns + changesRequestedMrs, runs.length + mrs.length);

  const metrics: TrendMetric[] = [
    {
      label: 'Run completion rate',
      value: formatPercent(runCompletionRate),
      detail: `${completedRuns}/${finishedRuns.length} finished run(s) completed successfully.`,
      status: statusForHighIsGood(runCompletionRate, finishedRuns.length),
    },
    {
      label: 'Rework rate',
      value: formatPercent(reworkRate),
      detail: `${retryRuns} retry run(s), ${failedRuns} failed/cancelled/needs-human run(s), ${changesRequestedMrs} change-requested MR(s).`,
      status: statusForLowIsGood(reworkRate, runs.length + mrs.length),
    },
    {
      label: 'Build pass rate',
      value: formatPercent(buildPassRate),
      detail: `${passedBuilds} passing build(s), ${failedBuilds} failing build(s).`,
      status: statusForHighIsGood(buildPassRate, passedBuilds + failedBuilds),
    },
    {
      label: 'Verification pass rate',
      value: formatPercent(verificationPassRate),
      detail: `${passedVerificationRuns} completed verification run(s), ${passedEvidenceChecks} passing check(s), ${passedEnvironmentResults} passing environment result(s).`,
      status: statusForHighIsGood(verificationPassRate, verificationRuns.length + structuredEvidenceChecks.length + environmentResults.length),
    },
    {
      label: 'Average cycle time',
      value: cycleHours.length > 0 ? `${formatHours(avgCycleHours)}` : 'n/a',
      detail: cycleHours.length > 0 ? `${cycleHours.length} ticket(s) with enough timestamp history.` : 'No ticket/run pairs have enough timestamp history yet.',
      status: cycleHours.length === 0 ? 'neutral' : avgCycleHours <= 48 ? 'good' : avgCycleHours <= 120 ? 'warn' : 'bad',
    },
    {
      label: 'Review health',
      value: `${approvedMrs}/${mrs.length}`,
      detail: `${approvedMrs} approved MR(s), ${changesRequestedMrs} change-requested MR(s).`,
      status: changesRequestedMrs > 0 ? 'warn' : mrs.length > 0 ? 'good' : 'neutral',
    },
  ];

  return {
    generatedAt: now.toISOString(),
    windowDays,
    runsConsidered: runs.length,
    ticketsConsidered: tickets.length,
    summary: `${runs.length} run(s), ${tickets.length} active ticket(s), ${formatPercent(reworkRate)} rework, ${formatPercent(buildPassRate)} build pass rate over ${windowDays} days.`,
    metrics,
  };
}

function ticketInWindow(ticket: Ticket, start: Date, end: Date): boolean {
  return [
    ticket.updated,
    ticket.last_action_at,
    ticket.evidence?.updated_at,
    ticket.mr ? ticket.updated : undefined,
    ticket.build ? ticket.updated : undefined,
  ].some(value => isInWindow(value, start, end));
}

function isInWindow(value: string | null | undefined, start: Date, end: Date): boolean {
  if (!value) { return false; }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed >= start && parsed <= end;
}

function cycleTimesHours(tickets: Record<string, Ticket>, runs: RunMetricRecord[]): number[] {
  const groupedRuns = new Map<string, RunMetricRecord[]>();
  for (const run of runs) {
    const ticketKey = recordString(run, 'ticket');
    if (!ticketKey) { continue; }
    const list = groupedRuns.get(ticketKey) || [];
    list.push(run);
    groupedRuns.set(ticketKey, list);
  }

  const hours: number[] = [];
  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    const ticketRuns = groupedRuns.get(ticketKey) || [];
    const runDates = ticketRuns
      .flatMap(run => [parseDate(recordString(run, 'startedAt')), parseDate(recordString(run, 'endedAt'))])
      .filter((date): date is Date => Boolean(date));
    const candidateStart = earliestDate([
      parseDate(ticket.updated),
      ...runDates,
    ]);
    const candidateEnd = latestDate([
      parseDate(ticket.evidence?.updated_at),
      parseDate(ticket.last_action_at),
      ...runDates,
    ]);
    if (candidateStart && candidateEnd && candidateEnd >= candidateStart) {
      hours.push((candidateEnd.getTime() - candidateStart.getTime()) / (60 * 60 * 1000));
    }
  }
  return hours;
}

function isFailedRunStatus(status: string): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'needs_human';
}

function hasRetryMetadata(run: RunMetricRecord): boolean {
  return isRecord(run['promptMetadata']) && recordString(run['promptMetadata'], 'retryOfRunId').length > 0;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) { return null; }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function earliestDate(values: Array<Date | null>): Date | null {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) { return null; }
  return new Date(Math.min(...dates.map(date => date.getTime())));
}

function latestDate(values: Array<Date | null>): Date | null {
  const dates = values.filter((value): value is Date => Boolean(value));
  if (dates.length === 0) { return null; }
  return new Date(Math.max(...dates.map(date => date.getTime())));
}

function percent(value: number, total: number): number | null {
  if (total <= 0) { return null; }
  return value / total;
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${Math.round(value * 100)}%`;
}

function formatHours(hours: number): string {
  if (hours < 24) { return `${Math.round(hours)}h`; }
  return `${Math.round(hours / 24)}d`;
}

function statusForHighIsGood(value: number | null, total: number): TrendMetric['status'] {
  if (total <= 0 || value === null) { return 'neutral'; }
  if (value >= 0.8) { return 'good'; }
  if (value >= 0.6) { return 'warn'; }
  return 'bad';
}

function statusForLowIsGood(value: number | null, total: number): TrendMetric['status'] {
  if (total <= 0 || value === null) { return 'neutral'; }
  if (value <= 0.15) { return 'good'; }
  if (value <= 0.35) { return 'warn'; }
  return 'bad';
}

function isPassingBuild(status: string): boolean {
  return ['SUCCESS', 'PASSED', 'OK'].includes(String(status || '').toUpperCase());
}

function isFailingBuild(status: string): boolean {
  return ['FAILURE', 'FAILED', 'ERROR'].includes(String(status || '').toUpperCase());
}
