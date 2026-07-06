import { Ticket } from '../state/types';
import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus';
import { evidenceChecks, evidenceEnvironmentResults, evidenceString } from './evidenceData';
import { toValidDate } from './dateValues';
import { isFailedTerminalRunStatus, isFinishedRunStatus, isSuccessfulRunStatus } from './runStatus';
import { hasRetryMetadata, runLikeRecordsFromUnknown, type RunLikeRecord } from './runRecords';
import { countLabel } from './countLabels';
import { definedValues, recordEntriesFromUnknown, recordString } from './records';

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

export function computeTrendMetrics(input: TrendMetricsInput): TrendMetricsReport {
  const now = input.now || new Date();
  const windowDays = input.windowDays || 14;
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);
  const runs = runLikeRecordsFromUnknown(input.runs)
    .filter(run => isInWindow(recordString(run, 'endedAt') || recordString(run, 'startedAt'), windowStart, now));
  const tickets = recordEntriesFromUnknown(input.tickets)
    .filter(([_, ticket]) => ticketInWindow(ticket, windowStart, now));

  const finishedRuns = runs.filter(run => isFinishedRunStatus(recordString(run, 'status')));
  const completedRuns = finishedRuns.filter(run => isSuccessfulRunStatus(recordString(run, 'status'))).length;
  const failedRuns = finishedRuns.filter(run => isFailedTerminalRunStatus(recordString(run, 'status'))).length;
  const retryRuns = runs.filter(hasRetryMetadata).length;
  const verificationRuns = finishedRuns.filter(run => recordString(run, 'skill').includes('verify'));
  const passedVerificationRuns = verificationRuns.filter(run => isSuccessfulRunStatus(recordString(run, 'status'))).length;

  const builds = definedValues(tickets.map(([_, ticket]) => ticket.build));
  const passedBuilds = builds.filter(build => isPassingBuildStatus(build.status)).length;
  const failedBuilds = builds.filter(build => isFailingBuildStatus(build.status)).length;

  const mrs = definedValues(tickets.map(([_, ticket]) => ticket.mr));
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
      detail: `${completedRuns}/${finishedRuns.length} completed successfully from ${countLabel(finishedRuns.length, 'finished run')}.`,
      status: statusForHighIsGood(runCompletionRate, finishedRuns.length),
    },
    {
      label: 'Rework rate',
      value: formatPercent(reworkRate),
      detail: `${countLabel(retryRuns, 'retry run')}, ${countLabel(failedRuns, 'failed/cancelled/needs-human run')}, ${countLabel(changesRequestedMrs, 'change-requested MR')}.`,
      status: statusForLowIsGood(reworkRate, runs.length + mrs.length),
    },
    {
      label: 'Build pass rate',
      value: formatPercent(buildPassRate),
      detail: `${countLabel(passedBuilds, 'passing build')}, ${countLabel(failedBuilds, 'failing build')}.`,
      status: statusForHighIsGood(buildPassRate, passedBuilds + failedBuilds),
    },
    {
      label: 'Verification pass rate',
      value: formatPercent(verificationPassRate),
      detail: `${countLabel(passedVerificationRuns, 'completed verification run')}, ${countLabel(passedEvidenceChecks, 'passing check')}, ${countLabel(passedEnvironmentResults, 'passing environment result')}.`,
      status: statusForHighIsGood(verificationPassRate, verificationRuns.length + structuredEvidenceChecks.length + environmentResults.length),
    },
    {
      label: 'Average cycle time',
      value: cycleHours.length > 0 ? `${formatHours(avgCycleHours)}` : 'n/a',
      detail: cycleHours.length > 0 ? `${countLabel(cycleHours.length, 'ticket')} with enough timestamp history.` : 'No ticket/run pairs have enough timestamp history yet.',
      status: cycleHours.length === 0 ? 'neutral' : avgCycleHours <= 48 ? 'good' : avgCycleHours <= 120 ? 'warn' : 'bad',
    },
    {
      label: 'Review health',
      value: `${approvedMrs}/${mrs.length}`,
      detail: `${countLabel(approvedMrs, 'approved MR')}, ${countLabel(changesRequestedMrs, 'change-requested MR')}.`,
      status: changesRequestedMrs > 0 ? 'warn' : mrs.length > 0 ? 'good' : 'neutral',
    },
  ];

  return {
    generatedAt: now.toISOString(),
    windowDays,
    runsConsidered: runs.length,
    ticketsConsidered: tickets.length,
    summary: `${countLabel(runs.length, 'run')}, ${countLabel(tickets.length, 'active ticket')}, ${formatPercent(reworkRate)} rework, ${formatPercent(buildPassRate)} build pass rate over ${windowDays} days.`,
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
  const parsed = toValidDate(value);
  return Boolean(parsed && parsed >= start && parsed <= end);
}

function cycleTimesHours(tickets: Record<string, Ticket>, runs: RunLikeRecord[]): number[] {
  const groupedRuns = new Map<string, RunLikeRecord[]>();
  for (const run of runs) {
    const ticketKey = recordString(run, 'ticket');
    if (!ticketKey) { continue; }
    const list = groupedRuns.get(ticketKey) || [];
    list.push(run);
    groupedRuns.set(ticketKey, list);
  }

  const hours: number[] = [];
  for (const [ticketKey, ticket] of recordEntriesFromUnknown(tickets)) {
    const ticketRuns = groupedRuns.get(ticketKey) || [];
    const runDates = ticketRuns
      .flatMap(run => [toValidDate(recordString(run, 'startedAt')), toValidDate(recordString(run, 'endedAt'))])
      .filter((date): date is Date => Boolean(date));
    const candidateStart = earliestDate([
      toValidDate(ticket.updated),
      ...runDates,
    ]);
    const candidateEnd = latestDate([
      toValidDate(ticket.evidence?.updated_at),
      toValidDate(ticket.last_action_at),
      ...runDates,
    ]);
    if (candidateStart && candidateEnd && candidateEnd >= candidateStart) {
      hours.push((candidateEnd.getTime() - candidateStart.getTime()) / (60 * 60 * 1000));
    }
  }
  return hours;
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
