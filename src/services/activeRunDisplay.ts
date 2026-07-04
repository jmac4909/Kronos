import { formatRunProgress } from './runProgress';
import { activeRunSummary, isFreshActiveRun, runStatus } from './runStatus';
import { recordString } from './records';

interface ActiveRunDisplaySummary {
  count: number;
  text: string;
  tooltip: string;
}

export function activeRunStatusBarSummary(runs: unknown[], now = new Date()): ActiveRunDisplaySummary | null {
  const activeRuns = runs.filter(run => isFreshActiveRun(run, now));
  if (activeRuns.length === 0) { return null; }

  const statusSummary = activeRunSummary(activeRuns, now) || `${activeRuns.length} active`;
  const text = activeRuns.length === 1
    ? `${statusSummary} - ${formatRunProgress(activeRuns[0], now)}`
    : statusSummary;
  return {
    count: activeRuns.length,
    text,
    tooltip: [
      `Kronos active runs: ${statusSummary}`,
      ...activeRuns.slice(0, 8).map(run => activeRunTooltipLine(run, now)),
      activeRuns.length > 8 ? `${activeRuns.length - 8} more active run${activeRuns.length === 9 ? '' : 's'} hidden` : '',
    ].filter(Boolean).join('\n'),
  };
}

function activeRunTooltipLine(run: unknown, now: Date): string {
  const record = runRecord(run);
  const project = recordString(record, 'project') || recordString(record, 'projectPath') || recordString(record, 'cwd') || 'Project';
  const target = [recordString(record, 'ticket'), recordString(record, 'skill') || 'run'].filter(Boolean).join(' ');
  const status = runStatus(run) || 'active';
  const progress = formatRunProgress(run, now);
  return `${project}${target ? ` ${target}` : ''}: ${status} - ${progress}`;
}

function runRecord(value: unknown): Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}
