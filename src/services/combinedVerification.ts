import { MergeRequest } from '../state/types';

interface CombinedVerificationTicket {
  key: string;
  mr: MergeRequest;
}

interface CombinedVerificationPlan {
  ticketKey: string;
  mrIid?: number;
  branch: string;
  mergeCommand: string;
  branchTableRow: string;
}

interface CombinedVerificationPromptVars {
  ticketKeys: string;
  mergeCommands: string;
  branchTable: string;
}

function sanitizeGitBranchRef(value: string | undefined): string | null {
  const normalized = String(value || '')
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '');
  if (!normalized) { return null; }
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) { return null; }
  if (normalized.includes('..') || normalized.startsWith('/') || normalized.endsWith('/')) { return null; }
  return normalized;
}

function branchCandidates(ticket: CombinedVerificationTicket): Array<string | undefined> {
  const mr = ticket.mr;
  return [
    mr.source_branch,
    mr.sourceBranch,
    mr.branch,
    mr.head_branch,
    ticket.key,
  ];
}

function resolveReviewBranch(ticket: CombinedVerificationTicket): string {
  for (const candidate of branchCandidates(ticket)) {
    const branch = sanitizeGitBranchRef(candidate);
    if (branch) { return branch; }
  }
  return ticket.key.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown-branch';
}

function mergeRefsForBranch(branch: string): string[] {
  const refs = [`origin/${branch}`];
  if (!branch.startsWith('defect/')) {
    refs.push(`origin/defect/${branch}`);
  }
  return refs;
}

export function buildCombinedVerificationPlan(tickets: CombinedVerificationTicket[]): CombinedVerificationPlan[] {
  return tickets.map(ticket => {
    const branch = resolveReviewBranch(ticket);
    const attempts = mergeRefsForBranch(branch).map(ref => `git merge ${ref} --no-edit 2>/dev/null`);
    return {
      ticketKey: ticket.key,
      mrIid: ticket.mr.iid,
      branch,
      mergeCommand: `${attempts.join(' || ')} || echo "Could not merge ${branch}"`,
      branchTableRow: `| ${ticket.key} | ${branch} | ${ticket.mr.iid ? `!${ticket.mr.iid}` : '-'} |`,
    };
  });
}

export function buildCombinedVerificationPromptVars(plans: CombinedVerificationPlan[]): CombinedVerificationPromptVars {
  return {
    ticketKeys: plans.map(plan => plan.ticketKey).join(', '),
    mergeCommands: plans.map(plan => plan.mergeCommand).join('\n'),
    branchTable: plans.map(plan => plan.branchTableRow).join('\n'),
  };
}
