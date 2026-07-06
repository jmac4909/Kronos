export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function nonZeroCountLabel(count: unknown, singular: string, plural = `${singular}s`): string {
  const safeCount = typeof count === 'number' && Number.isFinite(count) && count > 0
    ? Math.floor(count)
    : 0;
  return safeCount === 0 ? '' : countLabel(safeCount, singular, plural);
}
