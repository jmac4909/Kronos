export type JiraWorkRefreshPhase = 'idle' | 'loading' | 'complete' | 'partial' | 'error';

export interface JiraWorkRefreshStatus {
  phase: JiraWorkRefreshPhase;
  startedAt?: string;
  completedAt?: string;
  detail?: string;
  retainedFromPrevious: number;
  warningCount: number;
}

export type WorkDataMode = 'ready' | 'empty' | 'loading' | 'partial' | 'stale' | 'error';

export interface WorkDataPresentation {
  mode: WorkDataMode;
  title: string;
  detail: string;
  refreshedAt?: string;
  ticketCount: number;
}

export interface WorkDataPresentationInput {
  ticketCount: number;
  refreshedAt?: string | null;
  refreshStatus?: JiraWorkRefreshStatus;
  loadIssueCount?: number;
  stateAvailable?: boolean;
  staleAfterMs?: number;
  nowMs?: number;
}

export function idleJiraWorkRefreshStatus(): JiraWorkRefreshStatus {
  return {
    phase: 'idle',
    retainedFromPrevious: 0,
    warningCount: 0,
  };
}

/** Gives the Work tree and Jira board one truthful, deterministic data-state vocabulary. */
export function workDataPresentation(input: WorkDataPresentationInput): WorkDataPresentation {
  const ticketCount = boundedCount(input.ticketCount);
  const refreshedAt = normalizedTimestamp(input.refreshedAt);
  const status = input.refreshStatus || idleJiraWorkRefreshStatus();
  const loadIssueCount = boundedCount(input.loadIssueCount || 0);

  if (status.phase === 'error' || input.stateAvailable === false) {
    return {
      mode: 'error',
      title: 'Jira refresh failed',
      detail: retainedDetail(
        safeSingleLine(status.detail, 500) || 'Kronos could not read Jira work metadata.',
        ticketCount,
      ),
      ...(refreshedAt ? { refreshedAt } : {}),
      ticketCount,
    };
  }

  if (status.phase === 'loading') {
    return {
      mode: 'loading',
      title: 'Refreshing Jira work…',
      detail: ticketCount > 0
        ? `Showing ${ticketCount} last-known ticket${ticketCount === 1 ? '' : 's'} until the refresh finishes.`
        : 'Waiting for the first Jira result.',
      ...(refreshedAt ? { refreshedAt } : {}),
      ticketCount,
    };
  }

  if (status.phase === 'partial' || loadIssueCount > 0) {
    const retained = boundedCount(status.retainedFromPrevious);
    const warnings = Math.max(boundedCount(status.warningCount), loadIssueCount);
    const facts = [
      retained > 0
        ? `${retained} earlier ticket${retained === 1 ? ' remains' : 's remain'} visible.`
        : '',
      warnings > 0
        ? `${warnings} refresh warning${warnings === 1 ? '' : 's'} need review.`
        : '',
      ticketCount > 0 ? `Showing ${ticketCount} available ticket${ticketCount === 1 ? '' : 's'}.` : '',
    ].filter(Boolean);
    return {
      mode: ticketCount > 0 ? 'partial' : 'error',
      title: ticketCount > 0 ? 'Jira refresh incomplete' : 'Jira data unavailable',
      detail: facts.join(' ') || 'The Jira read did not return a complete result.',
      ...(refreshedAt ? { refreshedAt } : {}),
      ticketCount,
    };
  }

  if (isStale(refreshedAt, input.staleAfterMs, input.nowMs)) {
    return {
      mode: 'stale',
      title: 'Jira work may be stale',
      detail: `Showing ${ticketCount} ticket${ticketCount === 1 ? '' : 's'} from the last successful refresh. Refresh Jira before relying on current status.`,
      ...(refreshedAt ? { refreshedAt } : {}),
      ticketCount,
    };
  }

  if (ticketCount === 0) {
    return {
      mode: 'empty',
      title: refreshedAt ? 'No Jira tickets returned' : 'No Jira tickets loaded',
      detail: refreshedAt
        ? 'The last complete Jira refresh returned no matching work.'
        : 'Run a Jira refresh after completing Kronos Setup.',
      ...(refreshedAt ? { refreshedAt } : {}),
      ticketCount,
    };
  }

  return {
    mode: 'ready',
    title: 'Jira work is current',
    detail: `${ticketCount} ticket${ticketCount === 1 ? '' : 's'} available.`,
    ...(refreshedAt ? { refreshedAt } : {}),
    ticketCount,
  };
}

function retainedDetail(detail: string, ticketCount: number): string {
  return ticketCount > 0
    ? `${detail} Showing ${ticketCount} last-known ticket${ticketCount === 1 ? '' : 's'}.`
    : detail;
}

function isStale(refreshedAt: string | undefined, staleAfterMs: number | undefined, nowMs: number | undefined): boolean {
  if (!refreshedAt || typeof staleAfterMs !== 'number' || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    return false;
  }
  const refreshedMs = Date.parse(refreshedAt);
  const currentMs = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  return Number.isFinite(refreshedMs) && currentMs - refreshedMs > staleAfterMs;
}

function normalizedTimestamp(value: unknown): string | undefined {
  const text = safeSingleLine(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function boundedCount(value: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value))
    : 0;
}
