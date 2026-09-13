import { formatDateTimeLabel } from './dateLabels';

export function formatWebviewDateTime(value: unknown, fallback = 'N/A'): string {
  return formatDateTimeLabel(value, fallback);
}
