import { describeMergeRequestStatusChange } from './mergeRequestNotifications';
import type { MergeRequestStatusUpdate } from './ticketMutations';

type ReviewMonitorDecisionKind = 'deploy_monitor' | 'blocked' | 'notify' | 'none';
export type ReviewTerminalMergeRequestAction = 'deploy_monitor' | 'blocked';
export type ReviewDeployMonitorResult = 'started' | 'handled' | 'blocked';

export interface ReviewMonitorDecision {
  kind: ReviewMonitorDecisionKind;
  message?: string;
  severity?: 'info' | 'warning';
  url?: string;
}

export function decideReviewMonitorAction(ticketKey: string, update: MergeRequestStatusUpdate): ReviewMonitorDecision {
  if (update.mergedNow) {
    return { kind: 'deploy_monitor' };
  }
  const url = update.ticket.mr?.url;
  if (update.closedNow) {
    const decision: ReviewMonitorDecision = {
      kind: 'blocked',
      severity: 'warning',
      message: `${ticketKey} MR closed - ticket moved to blocked.`,
    };
    if (url) { decision.url = url; }
    return decision;
  }
  const notification = describeMergeRequestStatusChange(ticketKey, update);
  if (!notification) {
    return { kind: 'none' };
  }
  const decision: ReviewMonitorDecision = {
    kind: 'notify',
    severity: notification.severity,
    message: notification.message,
  };
  if (url) { decision.url = url; }
  return decision;
}

export function reviewTerminalMergeRequestActionKey(
  ticketKey: string,
  mrIid: number | string | undefined,
  action: ReviewTerminalMergeRequestAction,
): string {
  const mrKey = normalizedMergeRequestKey(mrIid);
  return `${ticketKey}:${mrKey}:${action}`;
}

export function reviewMergeRequestNotificationKey(ticketKey: string, update: MergeRequestStatusUpdate): string {
  const mr = update.ticket.mr;
  if (!mr) { return `${ticketKey}:mr:notify`; }
  return [
    ticketKey,
    normalizedMergeRequestKey(mr.iid),
    'notify',
    mr.state,
    mr.review_status,
    notificationValueKey(mr.comment_count),
    mr.last_comment_at || '',
    notificationValueKey(mr.unresolved_discussion_count),
    mr.last_discussion_at || '',
  ].join(':');
}

export function reviewDeployMonitorActionHandled(result: ReviewDeployMonitorResult): boolean {
  return result === 'started' || result === 'handled' || result === 'blocked';
}

function normalizedMergeRequestKey(value: number | string | undefined): string {
  if (typeof value === 'number' && Number.isFinite(value)) { return String(Math.trunc(value)); }
  if (typeof value === 'string' && value.trim()) { return value.trim(); }
  return 'mr';
}

function notificationValueKey(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.floor(value)) : '';
}
