import { KronosState, QueueState } from '../state/types';
import { AgingThresholds, analyzeAging } from './agingAnalyzer';
import { evaluateEvidenceGates } from './evidenceGate';
import { buildHumanReviewInbox } from './humanReviewInbox';
import { RunRecord } from './runStore';
import { runStatus } from './runStatus';

export interface AttentionBadgeInput {
  state?: KronosState | null;
  queue?: QueueState | null;
  runs?: RunRecord[];
  newReviewItems?: number;
  now?: Date;
  agingThresholds?: Partial<AgingThresholds>;
}

export interface AttentionBadgeSummary {
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
  const runs = Array.isArray(input.runs) ? input.runs : [];
  const humanReviewInbox = buildHumanReviewInbox({ state, queue: input.queue, runs });
  const evidenceGates = evaluateEvidenceGates(tickets);
  const agingReport = analyzeAging({ tickets, now: input.now, thresholds: input.agingThresholds });
  const summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'> = {
    humanReviewItems: humanReviewInbox.summary.critical + humanReviewInbox.summary.warning,
    evidenceGateFailures: evidenceGates.filter(gate => gate.status === 'fail').length,
    evidenceGateWarnings: evidenceGates.filter(gate => gate.status === 'warn').length,
    staleCritical: agingReport.summary.critical,
    staleWarning: agingReport.summary.warning,
    newReviewItems: nonNegativeInteger(input.newReviewItems),
    pausedRuns: runs.filter(run => runStatus(run) === 'paused').length,
  };
  const count = attentionBadgeCount(summary);
  return {
    ...summary,
    count,
    tooltip: formatAttentionBadgeTooltip(summary, count),
  };
}

export function attentionBadgeCount(summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'>): number {
  return Object.values(summary).reduce((total, value) => total + nonNegativeInteger(value), 0);
}

function formatAttentionBadgeTooltip(summary: Omit<AttentionBadgeSummary, 'count' | 'tooltip'>, count: number): string {
  if (count === 0) {
    return 'Kronos: no items need attention';
  }
  return [
    `Kronos: ${countLabel(count, 'item')} ${count === 1 ? 'needs' : 'need'} attention`,
    countLabel(summary.newReviewItems, 'new review item'),
    countLabel(summary.humanReviewItems, 'human review item'),
    countLabel(summary.evidenceGateFailures, 'evidence gate failure'),
    countLabel(summary.evidenceGateWarnings, 'evidence gate warning'),
    countLabel(summary.staleCritical, 'critical stale item'),
    countLabel(summary.staleWarning, 'stale warning'),
    countLabel(summary.pausedRuns, 'paused run'),
  ].filter(Boolean).join('\n');
}

function countLabel(count: number, singular: string): string {
  const safeCount = nonNegativeInteger(count);
  if (safeCount === 0) { return ''; }
  return `${safeCount} ${singular}${safeCount === 1 ? '' : 's'}`;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
