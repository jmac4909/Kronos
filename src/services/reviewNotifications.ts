import { arrayFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export const REVIEW_SEEN_KEYS_STORAGE_KEY = 'kronos.review.seenKeys.v1';

export interface ReviewNotificationItem {
  ticketKey: string;
  activityKey?: string;
  mrIid?: number;
  activity?: string;
}

export interface NewReviewNotificationPlan {
  nextNotifiedKeys: string[];
  message?: string;
}

export function normalizeReviewSeenKeys(value: unknown): string[] | undefined {
  if (value === undefined) { return undefined; }
  const keys = new Set<string>();
  for (const item of arrayFromUnknown(value)) {
    const key = optionalTrimmedStringFromUnknown(item);
    if (key) { keys.add(key); }
  }
  return [...keys].sort();
}

export function planNewReviewNotification(
  items: readonly ReviewNotificationItem[],
  notifiedKeys: ReadonlySet<string>,
): NewReviewNotificationPlan {
  const currentKeys = new Set(items.map(reviewNotificationItemKey));
  const nextNotifiedKeys = new Set([...notifiedKeys].filter(key => currentKeys.has(key)));
  const freshItems = items.filter(item => !nextNotifiedKeys.has(reviewNotificationItemKey(item)));
  for (const item of freshItems) {
    nextNotifiedKeys.add(reviewNotificationItemKey(item));
  }

  const plan: NewReviewNotificationPlan = {
    nextNotifiedKeys: [...nextNotifiedKeys].sort(),
  };
  const message = newReviewNotificationMessage(freshItems);
  if (message) { plan.message = message; }
  return plan;
}

function newReviewNotificationMessage(freshItems: readonly ReviewNotificationItem[]): string | undefined {
  const primary = freshItems[0];
  if (!primary) { return undefined; }
  const mr = primary.mrIid !== undefined ? `MR !${primary.mrIid}` : 'MR';
  const activity = primary.activity ? ` - ${primary.activity}` : '';
  const suffix = freshItems.length > 1 ? ` (+${freshItems.length - 1} more)` : '';
  return `${primary.ticketKey}: ${mr} needs review${activity}${suffix}`;
}

function reviewNotificationItemKey(item: ReviewNotificationItem): string {
  return item.activityKey || item.ticketKey;
}
