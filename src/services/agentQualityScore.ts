import { Ticket } from '../state/types';
import { isReviewReadyAction } from './actionSemantics';
import { isFailingBuildStatus, isPassingBuildStatus } from './buildStatus';
import { evaluateEvidenceGates } from './evidenceGate';
import { isActiveRun, isFailedOrCancelledRunStatus, isSuccessfulRunStatus } from './runStatus';
import { definedValues, recordString } from './records';
import { hasRetryMetadata, runLikeRecordsFromUnknown } from './runRecords';
import { countLabel } from './countLabels';

interface QualityComponent {
  label: string;
  score: number;
  max: number;
  detail: string;
}

interface QualityMetric {
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

export function computeAgentQualityScore(input: {
  runs: unknown[];
  tickets: Record<string, Ticket>;
}): AgentQualityScore {
  const runs = runLikeRecordsFromUnknown(input.runs);
  const tickets = input.tickets || {};
  const totalRuns = runs.length;
  const completedRuns = runs.filter(run => isSuccessfulRunStatus(recordString(run, 'status'))).length;
  const failedRuns = runs.filter(run => isFailedOrCancelledRunStatus(recordString(run, 'status'))).length;
  const needsHumanRuns = runs.filter(run => recordString(run, 'status') === 'needs_human').length;
  const retryRuns = runs.filter(hasRetryMetadata).length;
  const activeRuns = runs.filter(isActiveRun).length;

  const gates = evaluateEvidenceGates(tickets);
  const reviewRelevantGates = gates.filter(gate => {
    const action = tickets[gate.ticketKey]?.next_action;
    return isReviewReadyAction(action);
  });
  const gatePasses = reviewRelevantGates.filter(gate => gate.status === 'pass').length;
  const gateFailures = reviewRelevantGates.filter(gate => gate.status === 'fail').length;
  const gateWarnings = reviewRelevantGates.filter(gate => gate.status === 'warn').length;

  const ticketList = Object.values(tickets);
  const builds = definedValues(ticketList.map(ticket => ticket.build));
  const failedBuilds = builds.filter(build => isFailingBuildStatus(build.status)).length;
  const successfulBuilds = builds.filter(build => isPassingBuildStatus(build.status)).length;
  const mrs = definedValues(ticketList.map(ticket => ticket.mr));
  const approvedMrs = mrs.filter(mr => mr.review_status === 'approved').length;
  const changesRequestedMrs = mrs.filter(mr => mr.review_status === 'changes_requested').length;

  const components: QualityComponent[] = [
    {
      label: 'Run completion',
      max: 25,
      score: proportionalScore(completedRuns, totalRuns, 25),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${completedRuns}/${countLabel(totalRuns, 'run')} completed.`,
    },
    {
      label: 'Low run failure',
      max: 20,
      score: inverseProportionalScore(failedRuns, totalRuns, 20),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${failedRuns}/${countLabel(totalRuns, 'run')} failed or were cancelled.`,
    },
    {
      label: 'Low manual intervention',
      max: 15,
      score: inverseProportionalScore(needsHumanRuns, totalRuns, 15),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${needsHumanRuns}/${countLabel(totalRuns, 'run')} need human recovery.`,
    },
    {
      label: 'Evidence readiness',
      max: 20,
      score: evidenceReadinessScore(gatePasses, gateWarnings, gateFailures, reviewRelevantGates.length),
      detail: reviewRelevantGates.length === 0 ? 'No review-ready tickets yet.' : `${countLabel(gatePasses, 'passing evidence gate')}, ${countLabel(gateWarnings, 'warning evidence gate')}, ${countLabel(gateFailures, 'failing evidence gate')}.`,
    },
    {
      label: 'Build and review health',
      max: 15,
      score: buildReviewScore(successfulBuilds, failedBuilds, approvedMrs, changesRequestedMrs),
      detail: `${countLabel(successfulBuilds, 'successful build')}, ${countLabel(failedBuilds, 'failed build')}, ${countLabel(approvedMrs, 'approved MR')}, ${countLabel(changesRequestedMrs, 'change-requested MR')}.`,
    },
    {
      label: 'Retry discipline',
      max: 5,
      score: inverseProportionalScore(retryRuns, totalRuns, 5),
      detail: totalRuns === 0 ? 'No persisted runs yet.' : `${retryRuns}/${countLabel(totalRuns, 'run')} are retries.`,
    },
  ];

  const score = Math.max(0, Math.min(100, Math.round(components.reduce((sum, component) => sum + component.score, 0))));
  return {
    score,
    grade: gradeForScore(score),
    summary: `${score}/100 (${gradeForScore(score)}) - ${completedRuns}/${countLabel(totalRuns, 'run')} completed, ${countLabel(gateFailures, 'failing evidence gate')}, ${countLabel(needsHumanRuns, 'needs-human run')}.`,
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
