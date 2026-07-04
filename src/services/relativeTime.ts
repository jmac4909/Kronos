import { toValidDate } from './dateValues';

export function formatRelativeTime(isoDate: string, now: Date | number = Date.now()): string {
  const date = toValidDate(isoDate);
  if (!date) {
    return isoDate;
  }
  const timestamp = date.getTime();

  const nowTimestamp = typeof now === 'number' ? now : now.getTime();
  if (!Number.isFinite(nowTimestamp)) {
    return isoDate;
  }

  const diffMs = nowTimestamp - timestamp;
  const absMins = Math.floor(Math.abs(diffMs) / 60000);
  if (absMins < 1) {
    return 'just now';
  }

  const past = diffMs >= 0;
  if (absMins < 60) {
    return relativeLabel(absMins, 'm', past);
  }

  const hours = Math.floor(absMins / 60);
  if (hours < 24) {
    return relativeLabel(hours, 'h', past);
  }

  return relativeLabel(Math.floor(hours / 24), 'd', past);
}

function relativeLabel(value: number, unit: 'm' | 'h' | 'd', past: boolean): string {
  return past ? `${value}${unit} ago` : `in ${value}${unit}`;
}
