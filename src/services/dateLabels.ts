import { toValidDate } from './dateValues';

export function formatDateTimeLabel(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}
