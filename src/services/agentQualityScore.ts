import { Ticket } from '../state/types';
import { RunRecord } from './runStore';
import { evaluateEvidenceGates } from './evidenceGate';
import { isActiveRun } from './runStatus';

export interface QualityComponent {
  label: string;
  score: number;
  max: number;
  detail: string;
}

export interface QualityMetric {
  label: string;
  value: string;
}

export interface AgentQualityScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  summary: string;
  components: QualityComponent[];
  metrics: QualityMetric[];
}

const SUCCESS_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);
type RunQualityRecord = RunRecord & Record<string, unknown>;

export function computeAgentQualityScore(input: {
  runs: RunRecord[];
  tickets: Record<string, Ticket>;
}): AgentQualityScore {
  const runs = (Array.isArray(input.runs) ? input.runs : []).filter(isRunRecord);
  const tickets = input.tickets || {};
  const totalRuns = runs.length;
  const completedRuns = runs.filter(run => SUCCESS_RUN_STATUSES.has(runString(run, 'status'))).length;
  const failedRuns = runs.filter(run => runString(run, 'status') === 'failed' || runString(run, 'status') === 'cancelled').length;
  const needsHumanRuns = runs.filter(run => runString(run, 'status') === 'needs_human').length;
  const retryRuns = runs.filter(hasRetryMetadata).length;
  const activeRuns = runs.filter(isActiveRun).length;

  const gates = evaluateEvidenceGates(tickets);
  const reviewRelevantGates = gates.filter(gate => {
    const action = tickets[gate.ticketKey]?.next_action;
    return ['await_review', 'verify', 'deploy_monitor', 'done'].includes(action);
  });
  const gatePasses = reviewRelevantGates.filter(gate => gate.status === 'pass').length;
  const gateFailures = reviewRelevantGates.filter(gate => gate.status === 'fail').length;
  const gateWarnings = reviewRelevantGates.filter(gate => gate.status === 'warn').length;

  const ticketList = Object.values(tickets);
  const builds = ticketList.map(ticket => ticket.build).filter(Boolean) as NonNullable<Ticket['build']>[];
  const failedBuilds = builds.filter(build => ['FAILURE', 'FAILED', 'ERROR'].includes(String(build.status).toUpperCase())).length;
  const successfulBuilds = builds.filter(build => ['SUCCESS', 'PASSED', 'OK'].includes(String(build.status).toUpperCase())).length;
  const mrs = ticketList.map(ticket => ticket.mr).filter(Boolean) as NonNullable<Ticket['mr']>[];
  const approvedMrs = mrs.filter(mr => mr.review_status === 'approved').length;
  const changesRequestedMrs = mrs.filter(mr => mr.review_status === 'changes_requested').length;

  const components: QualityComponent[] = [
    {
      label: 'Run completion',
      max: 25,
      score: proportionalScore(completedRuns, totalRuns, 25),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${completedRuns}/${totalRuns} runs completed.`,
    },
    {
      label: 'Low run failure',
      max: 20,
      score: inverseProportionalScore(failedRuns, totalRuns, 20),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${failedRuns}/${totalRuns} runs failed or were cancelled.`,
    },
    {
      label: 'Low manual intervention',
      max: 15,
      score: inverseProportionalScore(needsHumanRuns, totalRuns, 15),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${needsHumanRuns}/${totalRuns} runs need human recovery.`,
    },
    {
      label: 'Evidence readiness',
      max: 20,
      score: evidenceReadinessScore(gatePasses, gateWarnings, gateFailures, reviewRelevantGates.length),
      detail: reviewRelevantGates.length === 0 ? 'No review-ready tickets yet.' : `${gatePasses} passing, ${gateWarnings} warning, ${gateFailures} failing evidence gates.`,
    },
    {
      label: 'Build and review health',
      max: 15,
      score: buildReviewScore(successfulBuilds, failedBuilds, approvedMrs, changesRequestedMrs),
      detail: `${successfulBuilds} successful build(s), ${failedBuilds} failed build(s), ${approvedMrs} approved MR(s), ${changesRequestedMrs} change-requested MR(s).`,
    },
    {
      label: 'Retry discipline',
      max: 5,
      score: inverseProportionalScore(retryRuns, totalRuns, 5),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${retryRuns}/${totalRuns} runs are retries.`,
    },
  ];

  const score = Math.max(0, Math.min(100, Math.round(components.reduce((sum, component) => sum + component.score, 0))));
  return {
    score,
    grade: gradeForScore(score),
    summary: `${score}/100 (${gradeForScore(score)}) - ${completedRuns}/${totalRuns} completed runs, ${gateFailures} failing evidence gate(s), ${needsHumanRuns} needs-human run(s).`,
    components,
    metrics: [
      { label: 'Runs', value: String(totalRuns) },
      { label: 'Active runs', value: String(activeRuns) },
      { label: 'Completed', value: String(completedRuns) },
      { label: 'Failed/cancelled', value: String(failedRuns) },
      { label: 'Needs human', value: String(needsHumanRuns) },
      { label: 'Retries', value: String(retryRuns) },
      { label: 'Evidence gate failures', value: String(gateFailures) },
      { label: 'Evidence gate warnings', value: String(gateWarnings) },
      { label: 'Failed builds', value: String(failedBuilds) },
      { label: 'Changes requested MRs', value: String(changesRequestedMrs) },
    ],
  };
}

function hasRetryMetadata(run: RunQualityRecord): boolean {
  return isRunRecord(run.promptMetadata) && runString(run.promptMetadata, 'retryOfRunId').length > 0;
}

function runString(run: RunQualityRecord, key: string): string {
  const value = run[key];
  return typeof value === 'string' ? value.trim() : '';
}

function isRunRecord(value: unknown): value is RunQualityRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function proportionalScore(value: number, total: number, max: number): number {
  if (total <= 0) { return Math.round(max * 0.6); }
  return Math.round((value / total) * max);
}

function inverseProportionalScore(value: number, total: number, max: number): number {
  if (total <= 0) { return Math.round(max * 0.6); }
  return Math.round(Math.max(0, 1 - value / total) * max);
}

function evidenceReadinessScore(passes: number, warnings: number, failures: number, total: number): number {
  if (total <= 0) { return 12; }
  const weighted = passes + warnings * 0.55 - failures * 0.75;
  return Math.max(0, Math.min(20, Math.round((weighted / total) * 20)));
}

function buildReviewScore(successfulBuilds: number, failedBuilds: number, approvedMrs: number, changesRequestedMrs: number): number {
  const totalSignals = successfulBuilds + failedBuilds + approvedMrs + changesRequestedMrs;
  if (totalSignals <= 0) { return 9; }
  const weighted = successfulBuilds + approvedMrs - failedBuilds - changesRequestedMrs;
  return Math.max(0, Math.min(15, Math.round((weighted / totalSignals) * 15)));
}

function gradeForScore(score: number): AgentQualityScore['grade'] {
  if (score >= 90) { return 'A'; }
  if (score >= 80) { return 'B'; }
  if (score >= 70) { return 'C'; }
  if (score >= 60) { return 'D'; }
  return 'F';
}
