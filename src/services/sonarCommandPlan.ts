import type { SonarIssue } from './sonarReportView';
import { recordFromUnknown } from './records';

export function normalizeSonarIssueCommandList(value: unknown): SonarIssue[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .map(normalizeSonarIssueCommandValue)
    .filter((issue): issue is SonarIssue => Boolean(issue));
}

export function formatSonarIssuePromptLine(issue: SonarIssue): string {
  const file = String(issue.component || '').replace(/^[^:]+:/, '') || '?';
  const rule = String(issue.rule || '').replace(/^[^:]+:/, '') || '-';
  const line = issue.line === undefined || issue.line === null || issue.line === '' ? '?' : String(issue.line);
  return `- [${issue.severity || '-'}] ${rule}: ${file}:${line} — ${issue.message || ''}`;
}

export function buildKnownSonarIssuesBlock(value: unknown): string {
  const issuesData = normalizeSonarIssueCommandList(value);
  if (issuesData.length === 0) { return ''; }
  const lines = issuesData.map(formatSonarIssuePromptLine);
  return `KNOWN ISSUES (already fetched — do NOT re-query SonarQube for the issue list):\n${lines.join('\n')}`;
}

export function buildSonarFixBranchStrategy(projectName: string, sourceBranch: string): string {
  const baseBranch = sourceBranch || 'develop';
  const isProtected = !sourceBranch || sourceBranch === 'develop' || sourceBranch === 'main' || sourceBranch === 'master';
  return isProtected
    ? `You are fixing issues from the ${baseBranch} branch. Create a NEW branch: bugfix/sonar-${projectName.toLowerCase()} from ${baseBranch}. After fixing and pushing, create a GitLab MR from your branch into ${baseBranch} using: python ~/.claude/scripts/gitlab_api.py --create-mr`
    : `You are fixing issues on branch ${sourceBranch}. Stay on this branch — push directly, it already has an open MR.`;
}

export function buildSonarFixInstructionBlock(input: {
  customInstructions: string;
  branchStrategy: string;
  issuesData: unknown;
}): string {
  return [
    input.customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${input.customInstructions}` : '',
    `BRANCH STRATEGY:\n${input.branchStrategy}`,
    buildKnownSonarIssuesBlock(input.issuesData),
  ].filter(Boolean).join('\n\n');
}

function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null {
  const record = recordFromUnknown(value);
  const issue: SonarIssue = {};
  if (typeof record['severity'] === 'string') { issue.severity = record['severity']; }
  if (typeof record['rule'] === 'string') { issue.rule = record['rule']; }
  if (typeof record['component'] === 'string') { issue.component = record['component']; }
  if (record['line'] !== undefined) { issue.line = record['line']; }
  if (typeof record['message'] === 'string') { issue.message = record['message']; }
  return issue.severity || issue.rule || issue.component || issue.message || issue.line !== undefined ? issue : null;
}
