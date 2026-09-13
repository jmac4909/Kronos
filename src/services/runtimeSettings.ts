const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f\u2028\u2029]/g;

export function runtimeIntervalMilliseconds(value: unknown, fallbackSeconds: number): number {
  const seconds = typeof value === 'number' && Number.isFinite(value)
    ? Math.max(15, Math.floor(value))
    : fallbackSeconds;
  return seconds * 1000;
}

export function normalizeRuntimeStringArray(value: unknown, limit: number, maxLength: number): string[] {
  if (!Array.isArray(value)) { return []; }
  return [...new Set(value
    .map(item => typeof item === 'string'
      ? item.replace(CONTROL_CHARACTERS, ' ').trim().slice(0, maxLength)
      : '')
    .filter(Boolean))]
    .slice(0, limit);
}

export function boundedRuntimeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, Math.floor(value)))
    : fallback;
}

export function uniqueRuntimePaths(
  values: readonly unknown[],
  limit: number,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = typeof value === 'string'
      ? value.replace(CONTROL_CHARACTERS, '').trim().slice(0, 4_000)
      : '';
    const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
    if (!candidate || seen.has(key)) { continue; }
    seen.add(key);
    paths.push(candidate);
    if (paths.length >= limit) { break; }
  }
  return paths;
}
