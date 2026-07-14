import { isRecord } from './records';

export function unknownErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  const message = unknownErrorField(error, 'message');
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export function unknownErrorCode(error: unknown): string {
  const code = unknownErrorField(error, 'code');
  if (typeof code === 'string' && code.trim()) {
    return code;
  }
  return typeof code === 'number' ? String(code) : '';
}

export function unknownErrorField(error: unknown, key: string): unknown {
  return isRecord(error) ? Reflect.get(error, key) : undefined;
}
