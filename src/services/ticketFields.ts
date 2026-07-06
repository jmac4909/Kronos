import { arrayFromUnknown } from './records';

export function ticketStringField(record: object | null | undefined, key: string, fallback = ''): string {
  const value = record ? Reflect.get(record, key) : undefined;
  return value === undefined || value === null ? fallback : String(value);
}

export function ticketStringArray(value: unknown): string[] {
  return arrayFromUnknown(value).map(ticketArrayString).filter(Boolean);
}

function ticketArrayString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}
