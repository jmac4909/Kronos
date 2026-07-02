import { Ticket } from '../state/types';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';
import { evidenceNotes } from './evidenceData';

export type PostRunReadinessStatus = 'ready' | 'needs_human' | 'blocked' | 'not_ready' | 'unknown';
export type RunFailureKind = 'none' | 'auth' | 'model' | 'script' | 'git' | 'build' | 'test' | 'sonar' | 'timeout' | 'cancelled' | 'unknown';

export interface PostRunReadiness {
  evaluatedAt: string;
  ticketKey?: string;
  status: PostRunReadinessStatus;
  summary: string;
  nextAction?: string;
  evidenceGate?: {
    status: EvidenceGateResult['status'];
    summary: string;
    failing: number;
    warnings: number;
  };
  failureKind: RunFailureKind;
}

const HANDOFF_ACTIONS = new Set(['await_review', 'verify', 'deploy_monitor', 'done']);
const SUCCESS_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);

export function shouldRecordRunCompletionEvidence(input: { run: unknown; ticket?: Ticket }): boolean {
  if (!input.ticket) { return false; }
  const record = runRecord(input.run);
  return runString(record.status) === 'completed'
    && runString(record.skill) === 'implement'
    && input.ticket.next_action === 'await_review'
    && evidenceNotes(input.ticket).length === 0;
}

export function buildRunCompletionEvidenceText(run: unknown): string {
  const record = runRecord(run);
  const runId = runString(record.id) || 'unknown run';
  return `Kronos implement run ${runId} completed; add detailed verification evidence during review.`;
}

export function evaluatePostRunReadiness(input: {
  run: unknown;
  ticketKey?: string;
  ticket?: Ticket;
  now?: Date;
}): PostRunReadiness {
  const now = input.now || new Date();
  const inputRun = runRecord(input.run);
  const runStatus = runString(inputRun.status);
  const failureKind = classifyRunFailure(input.run);
  if (!input.ticketKey || !input.ticket) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: SUCCESS_RUN_STATUSES.has(runStatus) ? 'unknown' : 'blocked',
      summary: SUCCESS_RUN_STATUSES.has(runStatus)
        ? 'Run completed, but no ticket state was available for readiness evaluation.'
        : `Run did not complete cleanly (${failureKind}).`,
      failureKind,
    };
  }

  const gate = evaluateEvidenceGate(input.ticketKey, input.ticket);
  const failing = gate.checks.filter(check => check.status === 'fail').length;
  const warnings = gate.checks.filter(check => check.status === 'warn').length;
  const gateSummary = {
    status: gate.status,
    summary: gate.summary,
    failing,
    warnings,
  };

  if (!SUCCESS_RUN_STATUSES.has(runStatus)) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'blocked',
      summary: `Run ended as ${runStatus || 'unknown'} (${failureKind}); ticket gate is ${gate.status}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!HANDOFF_ACTIONS.has(input.ticket.next_action)) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'not_ready',
      summary: `Run completed, but ticket next action is still ${input.ticket.next_action}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (gate.status === 'fail') {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'blocked',
      summary: `Run completed, but evidence gate is failing: ${gate.summary}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (gate.status === 'warn') {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'needs_human',
      summary: `Run completed and ticket is in handoff state, but evidence gate has warnings: ${gate.summary}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  return {
    evaluatedAt: now.toISOString(),
    ticketKey: input.ticketKey,
    status: 'ready',
    summary: `Run completed and evidence gate is passing for ${input.ticket.next_action}.`,
    nextAction: input.ticket.next_action,
    evidenceGate: gateSummary,
    failureKind,
  };
}

export function classifyRunFailure(run: unknown): RunFailureKind {
  const record = runRecord(run);
  const status = runString(record.status);
  if (!status && Object.keys(record).length === 0) { return 'unknown'; }
  if (SUCCESS_RUN_STATUSES.has(status)) { return 'none'; }
  if (status === 'cancelled') { return 'cancelled'; }
  const skill = runString(record.skill).toLowerCase();
  const exitCode = Number(record.exitCode);
  const text = [
    record.failureReason,
    record.error,
    ...runEventDetails(record.events),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n').toLowerCase();

  if (/cancelled|canceled|operator stopped|progress panel disposed/.test(text)) { return 'cancelled'; }
  if (/auth|credential|permission denied|unauthorized|forbidden|gcloud/.test(text)) { return 'auth'; }
  if (/model|quota|rate limit|context length/.test(text)) { return 'model'; }
  if (exitCode === 124 || /timeout|timed out|deadline/.test(text)) { return 'timeout'; }
  if (/script|invalid json|kronos script missing|python|claude cli|spawn|enoent|command not found/.test(text)) { return 'script'; }
  if (/\bgit\b|merge conflict|worktree|checkout|branch/.test(text)) { return 'git'; }
  if (/sonar|quality gate/.test(text)) { return 'sonar'; }
  if (/build|jenkins|maven|gradle|compile/.test(text)) { return 'build'; }
  if (/test|spec|assert|jest|pytest|junit/.test(text)) { return 'test'; }
  if (skill.includes('sonar')) { return 'sonar'; }
  if (skill.includes('build') || skill === 'fix_build') { return 'build'; }
  if (skill.includes('verify') || skill.includes('test')) { return 'test'; }
  return status === 'failed' || status === 'needs_human' ? 'unknown' : 'none';
}

function runRecord(value: unknown): Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : {};
}

function runString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function runText(value: unknown): string | undefined {
  if (value === undefined || value === null) { return undefined; }
  const text = String(value);
  return text ? text : undefined;
}

function runEventDetails(value: unknown): unknown[] {
  if (!Array.isArray(value)) { return []; }
  return value.flatMap(event => {
    const record = runRecord(event);
    return [record.label, record.detail];
  });
}
