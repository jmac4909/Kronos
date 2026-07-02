export function unknownErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  const message = unknownErrorField(error, 'message');
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export function unknownErrorField(error: unknown, key: string): unknown {
  return error && typeof error === 'object' ? Reflect.get(error, key) : undefined;
}
