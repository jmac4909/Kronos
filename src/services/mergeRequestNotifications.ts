import type { MergeRequest } from '../state/types';
import type { MergeRequestStatusUpdate } from './ticketMutations';

export interface MergeRequestStatusNotification {
  severity: 'info' | 'warning';
  message: string;
}

export function describeMergeRequestStatusChange(
  ticketKey: string,
  update: MergeRequestStatusUpdate,
): MergeRequestStatusNotification | null {
  if (update.mergedNow || update.closedNow || !update.previousMr || !update.ticket.mr) {
    return null;
  }

  const previous = update.previousMr;
  const current = update.ticket.mr;
  const details: string[] = [];
  let severity: MergeRequestStatusNotification['severity'] = 'info';

  if (previous.review_status !== current.review_status) {
    details.push(reviewStatusDetail(current.review_status));
    if (current.review_status === 'changes_requested') {
      severity = 'warning';
    }
  }

  const commentDetail = newCommentDetail(previous, current);
  if (commentDetail) {
    details.push(commentDetail);
  }

  if (details.length === 0) {
    return null;
  }

  return {
    severity,
    message: `${ticketKey}: MR !${current.iid} ${details.join('; ')}.`,
  };
}

function reviewStatusDetail(status: MergeRequest['review_status']): string {
  if (status === 'approved') { return 'approved'; }
  if (status === 'changes_requested') { return 'changes requested'; }
  return 'returned to pending review';
}

function newCommentDetail(previous: MergeRequest, current: MergeRequest): string | null {
  const previousCount = finiteCommentCount(previous.comment_count);
  const currentCount = finiteCommentCount(current.comment_count);
  if (previousCount !== undefined && currentCount !== undefined && currentCount > previousCount) {
    const added = currentCount - previousCount;
    return `${added} new MR comment${added === 1 ? '' : 's'}`;
  }
  if (previousCount === undefined && previous.last_comment_at && laterIsoTimestamp(current.last_comment_at, previous.last_comment_at)) {
    return 'new MR comment';
  }
  return null;
}

function finiteCommentCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}

function laterIsoTimestamp(next: string | undefined, previous: string): boolean {
  if (!next) { return false; }
  const nextTime = Date.parse(next);
  const previousTime = Date.parse(previous);
  return Number.isFinite(nextTime) && Number.isFinite(previousTime) && nextTime > previousTime;
}
