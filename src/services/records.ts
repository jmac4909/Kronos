export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function recordFromUnknown(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function definedValues<T>(values: Array<T | null | undefined>): T[] {
  return values.filter((value): value is T => value !== undefined && value !== null);
}

export function recordsFromUnknown(value: unknown): Record<string, unknown>[] {
  return arrayFromUnknown(value).filter(isRecord);
}

export function recordEntriesFromUnknown<T>(value: Record<string, T> | null | undefined): Array<[string, T]>;
export function recordEntriesFromUnknown(value: unknown): Array<[string, unknown]>;
export function recordEntriesFromUnknown(value: unknown): Array<[string, unknown]> {
  return isRecord(value) ? Object.entries(value) : [];
}

export function recordKeysFromUnknown(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value) : [];
}

export function recordValuesFromUnknown(value: unknown): Record<string, unknown>[] {
  return isRecord(value) ? Object.values(value).filter(isRecord) : [];
}

export function recordString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' ? value.trim() : '';
}
