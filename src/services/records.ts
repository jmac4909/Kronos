export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function trimmedStringFromUnknown(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

export function optionalTrimmedStringFromUnknown(value: unknown): string | undefined {
  const trimmed = trimmedStringFromUnknown(value);
  return trimmed || undefined;
}

export function optionalFiniteNumberFromUnknown(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function nonNegativeIntegerFromUnknown(value: unknown): number | undefined {
  const number = optionalFiniteNumberFromUnknown(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

export function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export function firstNonEmptyString(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

export function recordEntriesFromUnknown<T>(value: Record<string, T> | null | undefined): Array<[string, T]>;
export function recordEntriesFromUnknown(value: unknown): Array<[string, unknown]>;
export function recordEntriesFromUnknown(value: unknown): Array<[string, unknown]> {
  return isRecord(value) ? Object.entries(value) : [];
}

export function recordString(record: Record<string, unknown>, key: string): string {
  return trimmedStringFromUnknown(record[key]);
}
