import { compactSingleLineText } from './textFormat';

export function runSignalText(value: unknown, maxLength = 96): string {
  const compact = compactSingleLineText(value, maxLength);
  return isLowValueRunSignal(compact) ? '' : compact;
}

export function isLowValueRunSignal(value: string): boolean {
  const compact = compactSingleLineText(value, 180);
  if (!compact) { return true; }
  if (/^Session complete/i.test(compact) || /^Complete\b/i.test(compact)) { return true; }
  if (/^Reviewer summary\b/i.test(compact)) { return true; }
  if (/^checked\s+\d/i.test(compact)) { return true; }
  if (/tmux currently shows no attached client/i.test(compact)) { return true; }
  if (/\.allowedTools\b/.test(compact)) { return true; }
  if (/^Run \/review on my current changes\.?$/i.test(compact)) { return true; }
  if (/^Summarize recent commits\.?$/i.test(compact)) { return true; }
  return false;
}
