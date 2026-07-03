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

  const discussionDetail = discussionResolutionDetail(previous, current);
  if (discussionDetail) {
    details.push(discussionDetail.message);
    if (discussionDetail.severity === 'warning') {
      severity = 'warning';
    }
  } else if (!commentDetail) {
    const discussionActivity = discussionActivityDetail(previous, current);
    if (discussionActivity) {
      details.push(discussionActivity);
    }
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
  if (previousCount === undefined && currentCount !== undefined && currentCount > 0) {
    return `${currentCount} MR comment${currentCount === 1 ? '' : 's'} now tracked`;
  }
  if (previous.last_comment_at && laterIsoTimestamp(current.last_comment_at, previous.last_comment_at)) {
    return 'new MR comment';
  }
  if (!previous.last_comment_at && current.last_comment_at) {
    return 'new MR comment';
  }
  return null;
}

function discussionResolutionDetail(previous: MergeRequest, current: MergeRequest): MergeRequestStatusNotification | null {
  const previousUnresolved = finiteCommentCount(previous.unresolved_discussion_count);
  const currentUnresolved = finiteCommentCount(current.unresolved_discussion_count);
  if (previousUnresolved === undefined || currentUnresolved === undefined || previousUnresolved === currentUnresolved) {
    return null;
  }
  if (currentUnresolved > previousUnresolved) {
    const added = currentUnresolved - previousUnresolved;
    return {
      severity: 'warning',
      message: `${added} new unresolved MR discussion${added === 1 ? '' : 's'}`,
    };
  }
  const resolved = previousUnresolved - currentUnresolved;
  return {
    severity: 'info',
    message: currentUnresolved === 0
      ? 'all MR discussions resolved'
      : `${resolved} MR discussion${resolved === 1 ? '' : 's'} resolved`,
  };
}

function discussionActivityDetail(previous: MergeRequest, current: MergeRequest): string | null {
  if (previous.last_discussion_at && laterIsoTimestamp(current.last_discussion_at, previous.last_discussion_at)) {
    return 'new MR discussion activity';
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
