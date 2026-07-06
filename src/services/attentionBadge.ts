import { KronosState, QueueState, Ticket } from '../state/types';
import { AgingThresholds, analyzeAging } from './agingAnalyzer';
import { evaluateEvidenceGates } from './evidenceGate';
import { buildHumanReviewInbox } from './humanReviewInbox';
import { runLikeRecordsFromUnknown } from './runRecords';
import { isActiveRun, runStatus } from './runStatus';
import { nonZeroCountLabel } from './countLabels';

interface AttentionBadgeInput {
  state?: KronosState | null;
  queue?: QueueState | null;
  runs?: unknown;
  newReviewItems?: number;
  now?: Date;
  agingThresholds?: Partial<AgingThresholds>;
}

interface AttentionBadgeSummary {
  count: number;
  tooltip: string;
  humanReviewItems: number;
  evidenceGateFailures: number;
  evidenceGateWarnings: number;
  staleCritical: number;
  staleWarning: number;
  newReviewItems: number;
  pausedRuns: number;
}

export function computeAttentionBadge(input: AttentionBadgeInput): AttentionBadgeSummary {
  const state = input.state || null;
  const tickets = state?.tickets || {};
  const runs = runLikeRecordsFromUnknown(input.runs);
  const inboxInput = { state, runs };
  if (input.queue !== undefined) { Object.assign(inboxInput, { queue: input.queue }); }
  const humanReviewInbox = buildHumanReviewInbox(inboxInput);
  const evidenceGates = evaluateEvidenceGates(tickets);
  const agingInput: { tickets: Record<string, Ticket>; now?: Date; thresholds?: Partial<AgingThresholds> } = { tickets };
  if (input.now) { agingInput.now = input.now; }
  if (input.agingThresholds) { agingInput.thresholds = input.agingThresholds; }
  const agingReport = analyzeAging(agingInput);
  const summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'> = {
    humanReviewItems: humanReviewInbox.summary.critical + humanReviewInbox.summary.warning,
    evidenceGateFailures: evidenceGates.filter(gate => gate.status === 'fail').length,
    evidenceGateWarnings: evidenceGates.filter(gate => gate.status === 'warn').length,
    staleCritical: agingReport.summary.critical,
    staleWarning: agingReport.summary.warning,
    newReviewItems: nonNegativeInteger(input.newReviewItems),
    pausedRuns: runs.filter(run => runStatus(run) === 'paused' && isActiveRun(run)).length,
  };
  const count = attentionBadgeCount(summary);
  return {
    ...summary,
    count,
    tooltip: formatAttentionBadgeTooltip(summary, count),
  };
}

function attentionBadgeCount(summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'>): number {
  return Object.values(summary).reduce((total, value) => total + nonNegativeInteger(value), 0);
}

function formatAttentionBadgeTooltip(summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'>, count: number): string {
  if (count === 0) {
    return 'Kronos: no items need attention';
  }
  return [
    `Kronos: ${nonZeroCountLabel(count, 'item')} ${count === 1 ? 'needs' : 'need'} attention`,
    nonZeroCountLabel(summary.newReviewItems, 'new review item'),
    nonZeroCountLabel(summary.humanReviewItems, 'human review item'),
    nonZeroCountLabel(summary.evidenceGateFailures, 'evidence gate failure'),
    nonZeroCountLabel(summary.evidenceGateWarnings, 'evidence gate warning'),
    nonZeroCountLabel(summary.staleCritical, 'critical stale item'),
    nonZeroCountLabel(summary.staleWarning, 'stale warning'),
    nonZeroCountLabel(summary.pausedRuns, 'paused run'),
  ].filter(Boolean).join('\n');
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
