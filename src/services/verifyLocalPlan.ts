import type { Ticket } from '../state/types';
import { sanitizeBranch } from './profileManager';
import { recordFromUnknown, recordString } from './records';
import { ticketStringArray } from './ticketFields';

export type VerifyLocalBranchCheckout = 'current' | 'ref' | 'remote';
export type VerifyLocalEnvironmentKind = 'local' | 'DEV' | 'TEST' | 'custom';
export type VerifyLocalMode = 'confirm-defect-exists' | 'confirm-fix-works';

export interface VerifyLocalBranchTarget {
  label: string;
  description: string;
  branch: string;
  ref: string;
  checkout: VerifyLocalBranchCheckout;
}

export interface VerifyLocalEnvironmentTarget {
  kind: VerifyLocalEnvironmentKind;
  label: string;
  promptValue: string;
  url?: string | undefined;
}

export interface VerifyLocalModeTarget {
  mode: VerifyLocalMode;
  label: string;
  description: string;
  promptValue: string;
  detail: string;
}

export interface VerifyLocalPromptTarget {
  ticketKey: string;
  projectName: string;
  branch: VerifyLocalBranchTarget;
  environment: VerifyLocalEnvironmentTarget;
  mode: VerifyLocalModeTarget;
  ticket: Ticket | undefined;
}

export const VERIFY_LOCAL_MODE_TARGETS: VerifyLocalModeTarget[] = [
  {
    mode: 'confirm-defect-exists',
    label: 'Confirm defect exists',
    description: 'Before fix: reproduce the reported bug.',
    promptValue: 'confirm defect exists',
    detail: 'Before-fix verification. Prove the reported defect reproduces before implementation work continues.',
  },
  {
    mode: 'confirm-fix-works',
    label: 'Confirm fix works',
    description: 'After fix: prove the same request now behaves correctly.',
    promptValue: 'confirm fix works',
    detail: 'After-fix verification. Replay the same request and prove the defect no longer reproduces.',
  },
];

export function buildVerifyLocalBranchTargets(input: {
  ticketKey: string;
  ticket?: Ticket | undefined;
  defaultBranch: string;
  currentBranch?: string | undefined;
}): VerifyLocalBranchTarget[] {
  const targets: VerifyLocalBranchTarget[] = [];
  const current = sanitizeBranch(input.currentBranch || '');
  if (current) {
    targets.push({
      label: `Current (${current})`,
      description: 'Use the current worktree state.',
      branch: current,
      ref: current,
      checkout: 'current',
    });
  }
  addBranchTarget(targets, input.defaultBranch, 'Project default branch');
  for (const branch of mergeRequestBranchCandidates(input.ticket)) {
    addBranchTarget(targets, branch, 'Linked MR source branch');
  }
  addBranchTarget(targets, `feature/${input.ticketKey}`, 'Feature branch candidate');
  addBranchTarget(targets, `bugfix/${input.ticketKey}`, 'Bugfix branch candidate');
  return dedupeBranchTargets(targets);
}

export function buildCustomVerifyLocalBranchTarget(branch: string): VerifyLocalBranchTarget | undefined {
  const sanitized = sanitizeBranch(branch);
  if (!sanitized) { return undefined; }
  return {
    label: sanitized,
    description: 'Custom branch',
    branch: sanitized,
    ref: `origin/${sanitized}`,
    checkout: 'ref',
  };
}

export function buildVerifyRemoteDeploymentTarget(environment: VerifyLocalEnvironmentTarget): VerifyLocalBranchTarget {
  const environmentLabel = environment.kind === 'custom' ? 'remote custom URL' : `${environment.kind} deployment`;
  return {
    label: environmentLabel,
    description: 'Remote environment deployed version',
    branch: environmentLabel,
    ref: environment.url || environment.promptValue,
    checkout: 'remote',
  };
}

export function buildVerifyLocalEnvironmentTarget(
  kind: VerifyLocalEnvironmentKind,
  input: { customUrl?: string | undefined; projectName?: string | undefined; env?: NodeJS.ProcessEnv } = {},
): VerifyLocalEnvironmentTarget {
  if (kind === 'custom') {
    const url = normalizeHttpUrl(input.customUrl);
    return {
      kind,
      label: url ? `Custom URL (${url})` : 'Custom URL',
      promptValue: 'custom URL',
      url,
    };
  }
  if (kind === 'local') {
    return {
      kind,
      label: 'local (mock)',
      promptValue: 'local (mock)',
    };
  }
  const url = knownEnvironmentUrl(kind, input.projectName, input.env || process.env);
  const target: VerifyLocalEnvironmentTarget = {
    kind,
    label: url ? `${kind} (${url})` : kind,
    promptValue: kind,
  };
  if (url) { target.url = url; }
  return target;
}

export function normalizeHttpUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function buildVerifyLocalPromptVars(target: VerifyLocalPromptTarget): Record<string, string> {
  return {
    TICKET_KEY: target.ticketKey,
    VERIFY_PROJECT_NAME: target.projectName,
    VERIFY_BRANCH: target.branch.branch,
    VERIFY_BRANCH_REF: target.branch.ref,
    VERIFY_BRANCH_CHECKOUT: verifyBranchCheckoutInstruction(target.branch),
    VERIFY_ENVIRONMENT: target.environment.promptValue,
    VERIFY_ENVIRONMENT_URL: target.environment.url || 'not provided',
    VERIFY_MODE: target.mode.promptValue,
    VERIFY_MODE_DETAIL: target.mode.detail,
    VERIFY_COMPLETION_POLICY: buildVerifyLocalCompletionPolicy(target),
    VERIFY_TRACKING_HINTS: buildVerifyLocalTrackingHints(target.ticket),
    VERIFY_TICKET_CONTEXT: buildVerifyLocalTicketContext(target.ticketKey, target.ticket),
    VERIFY_REPLAY_STEPS: buildVerifyLocalReplaySteps(target),
  };
}

export function buildVerifyLocalPromptText(basePrompt: string, vars: Record<string, string>): string {
  const targetingBlock = [
    '## Kronos verify-local targeting',
    '',
    `Ticket: ${vars.TICKET_KEY}`,
    `Project: ${vars.VERIFY_PROJECT_NAME}`,
    `Branch: ${vars.VERIFY_BRANCH}`,
    `Checkout: ${vars.VERIFY_BRANCH_CHECKOUT}`,
    `Environment: ${vars.VERIFY_ENVIRONMENT}`,
    `Environment URL: ${vars.VERIFY_ENVIRONMENT_URL}`,
    `Mode: ${vars.VERIFY_MODE}`,
    vars.VERIFY_MODE_DETAIL,
    '',
    'Completion policy:',
    vars.VERIFY_COMPLETION_POLICY,
    '',
    'Ticket context:',
    vars.VERIFY_TICKET_CONTEXT,
    '',
    'Tracking/request hints:',
    vars.VERIFY_TRACKING_HINTS,
    '',
    'Required verification workflow:',
    vars.VERIFY_REPLAY_STEPS,
  ].join('\n');
  return [basePrompt.trim(), targetingBlock].filter(Boolean).join('\n\n');
}

export function verifyLocalTargetSummary(target: VerifyLocalPromptTarget): string {
  const url = target.environment.url ? ` ${target.environment.url}` : '';
  return `${target.ticketKey} on ${target.branch.label} against ${target.environment.promptValue}${url} to ${target.mode.promptValue}.`;
}

function addBranchTarget(targets: VerifyLocalBranchTarget[], branch: string | undefined, description: string): void {
  const sanitized = sanitizeBranch(branch || '');
  if (!sanitized) { return; }
  targets.push({
    label: sanitized,
    description,
    branch: sanitized,
    ref: `origin/${sanitized}`,
    checkout: 'ref',
  });
}

function verifyBranchCheckoutInstruction(branch: VerifyLocalBranchTarget): string {
  if (branch.checkout === 'remote') {
    return 'Remote verification only: do not choose, checkout, or infer a source branch. Hit the selected remote environment exactly as deployed.';
  }
  return branch.checkout === 'current'
    ? 'Use the current worktree exactly as-is; do not switch branches unless the operator explicitly asks.'
    : `Use the managed verification worktree checked out at ${branch.ref}.`;
}

function dedupeBranchTargets(targets: VerifyLocalBranchTarget[]): VerifyLocalBranchTarget[] {
  const seen = new Set<string>();
  const deduped: VerifyLocalBranchTarget[] = [];
  for (const target of targets) {
    const key = `${target.checkout}:${target.branch}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    deduped.push(target);
  }
  return deduped;
}

function mergeRequestBranchCandidates(ticket: Ticket | undefined): string[] {
  const mr = ticket?.mr;
  if (!mr) { return []; }
  const record = recordFromUnknown(mr);
  return [
    mr.source_branch,
    mr.sourceBranch,
    mr.branch,
    mr.head_branch,
    recordString(record, 'sourceBranch'),
    recordString(record, 'source_branch'),
    recordString(record, 'branch'),
    recordString(record, 'head_branch'),
  ].map(value => sanitizeBranch(value || '')).filter((value): value is string => Boolean(value));
}

function knownEnvironmentUrl(kind: 'DEV' | 'TEST', projectName: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const projectPrefix = projectName ? projectName.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : '';
  const candidates = [
    projectPrefix ? `${projectPrefix}_${kind}_URL` : '',
    `${kind}_BASE_URL`,
    `${kind}_URL`,
  ].filter(Boolean);
  for (const key of candidates) {
    const url = normalizeHttpUrl(env[key]);
    if (url) { return url; }
  }
  return undefined;
}

function buildVerifyLocalTrackingHints(ticket: Ticket | undefined): string {
  const text = [
    ticket?.summary,
    ticket?.description,
    ticket?.jira_url,
    ...ticketStringArray(ticket?.labels),
  ].filter(Boolean).join('\n');
  const matches = [...text.matchAll(/\b(?:request|trace|correlation|tracking|payload|message|case|incident|jira|ticket)?[-_ ]?(?:id|key|number|no)?[:=# ]+([A-Z0-9][A-Z0-9._:-]{3,})\b/gi)]
    .map(match => match[1])
    .filter((value): value is string => Boolean(value));
  const ticketLike = [...text.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map(match => match[0]);
  const unique = [...new Set([...matches, ...ticketLike])].slice(0, 12);
  return unique.length > 0
    ? unique.map(value => `- ${value}`).join('\n')
    : '- No explicit request/tracking IDs were extracted. Inspect the Jira description, attachments, linked MR/build logs, app logs, and payload logs before replay.';
}

function buildVerifyLocalTicketContext(ticketKey: string, ticket: Ticket | undefined): string {
  if (!ticket) { return `- Ticket ${ticketKey} was not found in loaded state.`; }
  const rows = [
    `- Summary: ${ticket.summary || '(missing)'}`,
    `- Jira status: ${ticket.jira_status || '(unknown)'}`,
    `- Priority: ${ticket.priority || '(unknown)'}`,
    `- Type: ${ticket.type || '(unknown)'}`,
    ticket.jira_url ? `- Jira URL: ${ticket.jira_url}` : '',
    ticket.description ? `- Description excerpt: ${compactText(ticket.description, 1200)}` : '',
    ticket.mr?.url ? `- Merge request: ${ticket.mr.url}` : '',
    ticket.build?.url ? `- Build: ${ticket.build.status} ${ticket.build.url}` : '',
  ].filter(Boolean);
  return rows.join('\n');
}

function buildVerifyLocalReplaySteps(target: VerifyLocalPromptTarget): string {
  const environment = target.environment.url
    ? `${target.environment.promptValue} at ${target.environment.url}`
    : target.environment.promptValue;
  const remoteFixConfirmation = target.branch.checkout === 'remote' && target.mode.mode === 'confirm-fix-works';
  const fixVerdictInstruction = 'For fix verification, report two separate sections with before/after evidence: (1) code review of the fix - whether the selected branch/MR addresses the root cause, and (2) TEST/DEV environment status - whether that fix is deployed in the selected environment. If the code fix is present but TEST still runs old behavior or is not deployed, use the verdict "FIX VERIFIED IN CODE, AWAITING DEPLOYMENT" and do not call the fix failed or label the overall result "DEFECT REPRODUCED."';
  return [
    '1. Find the original request, tracking ID, payload, or reproduction path from the Jira ticket, linked artifacts, or payload/application logs. If it cannot be found, stop and report exactly what is missing.',
    `2. Checkout/use the operator-selected branch target: ${target.branch.branch}.`,
    `3. Replay the original request against ${environment}. Use local mocks only when the selected environment is local (mock).`,
    remoteFixConfirmation
      ? '4. Confirm whether the fix works in the selected remote environment. If the defect no longer reproduces, capture the remote TEST/DEV evidence, report fixed, and stop without building or starting the app locally.'
      : target.mode.mode === 'confirm-defect-exists'
      ? '4. Confirm whether the reported defect reproduces. Compare actual behavior with the expected behavior from the ticket and capture commands, payloads, responses, logs, and artifacts.'
      : '4. Confirm whether the fix works. Replay the same request, compare behavior against the defect evidence/baseline, and prove the reported failure no longer occurs.',
    target.mode.mode === 'confirm-fix-works'
      ? `5. ${fixVerdictInstruction}`
      : '5. Report a clear verdict: reproduced, not reproduced, fixed, not fixed, or blocked. Include before/after evidence and any unresolved risks.',
  ].join('\n');
}

function buildVerifyLocalCompletionPolicy(target: VerifyLocalPromptTarget): string {
  if (target.branch.checkout === 'remote' && target.mode.mode === 'confirm-fix-works') {
    return 'Remote fix confirmation is authoritative for this run. If the selected TEST/DEV/custom environment proves the defect no longer reproduces, report success and stop. If TEST/DEV still shows old behavior, distinguish code verdict from deployment verdict: use "FIX VERIFIED IN CODE, AWAITING DEPLOYMENT" when the selected branch/MR fixes the root cause but the remote environment is not updated. Do not build, start, or test the app locally after remote success. Local testing is allowed only if the remote replay fails, is inconclusive, or the operator explicitly chose local-only verification.';
  }
  if (target.branch.checkout === 'remote') {
    return 'Remote verification is authoritative for this run. Do not build, start, or test the app locally unless the remote replay fails, is inconclusive, or the operator explicitly starts a local-only follow-up.';
  }
  return target.mode.mode === 'confirm-fix-works'
    ? 'Run only the operator-selected verification path. Separate the code verdict from the environment/deployment verdict. If the selected branch/MR fixes the root cause but TEST still runs old behavior, report "FIX VERIFIED IN CODE, AWAITING DEPLOYMENT" instead of "DEFECT REPRODUCED." Do not add extra local or remote workflows beyond what is needed for the selected branch, environment, and mode.'
    : 'Run only the operator-selected local verification path. Do not add remote or extra local workflows beyond what is needed for the selected branch, environment, and mode.';
}

function compactText(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}
