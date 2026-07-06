export function compactSingleLineText(value: unknown, maxLength: number): string {
  const compact = String(value ?? '').replace(/\s+/g, ' ').trim();
  return compact.length > maxLength ? `${compact.substring(0, maxLength - 3)}...` : compact;
}
