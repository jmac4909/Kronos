import { Ticket } from '../state/types';
import { isHandoffAction } from './actionSemantics';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';
import { evidenceChecks, evidenceNotes, evidenceString } from './evidenceData';
import { runProgressSummary } from './runProgress';
import { terminalRunOutcome } from './runStatus';

type PostRunReadinessStatus = 'ready' | 'needs_human' | 'blocked' | 'not_ready' | 'unknown';
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

export interface RunCompletionEvidenceCheck {
  name: string;
  result: 'pass' | 'warn';
  environment: string;
  command?: string;
  summary: string;
  confidence: 'medium' | 'high';
}

export interface PostRunTicketResolution {
  ticketKey?: string;
  ticket?: Ticket;
}

const SUCCESS_RUN_STATUSES = new Set(['completed', 'waiting_for_review']);

export function resolvePostRunTicket(input: {
  tickets?: Record<string, Ticket>;
  ticketKey?: string;
  projectName?: string;
  run?: unknown;
}): PostRunTicketResolution {
  const ticketKey = trimmedString(input.ticketKey);
  const tickets = input.tickets;
  if (!tickets) {
    return postRunTicketResolution(ticketKey);
  }
  if (ticketKey) {
    const direct = tickets[ticketKey];
    if (direct) {
      return { ticketKey, ticket: direct };
    }
    const matchedEntry = Object.entries(tickets).find(([key]) => key.toLowerCase() === ticketKey.toLowerCase());
    if (matchedEntry) {
      return { ticketKey: matchedEntry[0], ticket: matchedEntry[1] };
    }
  }

  const runResolved = resolveTicketFromRunRecord(tickets, input.run);
  if (runResolved) {
    return runResolved;
  }

  const projectName = trimmedString(input.projectName) || runString(runRecord(input.run)['project']);
  if (!projectName) {
    return postRunTicketResolution(ticketKey);
  }
  const matchedProjectTickets = Object.entries(tickets).filter(([, ticket]) => (
    ticket.next_action !== 'done' && ticketLinkedToProject(ticket, projectName)
  ));
  const matchedProjectTicket = matchedProjectTickets.length === 1 ? matchedProjectTickets[0] : undefined;
  return matchedProjectTicket
    ? { ticketKey: matchedProjectTicket[0], ticket: matchedProjectTicket[1] }
    : postRunTicketResolution(ticketKey);
}

function postRunTicketResolution(ticketKey: string | undefined): PostRunTicketResolution {
  return ticketKey ? { ticketKey } : {};
}

export function shouldRecordRunCompletionEvidence(input: { run: unknown; ticket?: Ticket }): boolean {
  if (!input.ticket) { return false; }
  const record = runRecord(input.run);
  const runId = completionEvidenceRunId(record);
  return runCompletedForEvidence(record)
    && runString(record['skill']) === 'implement'
    && input.ticket.next_action === 'await_review'
    && !hasRunCompletionEvidence(input.ticket, runId);
}

export function buildRunCompletionEvidenceText(run: unknown, ticket?: Ticket): string {
  const record = runRecord(run);
  const runId = runString(record['id']) || 'unknown run';
  const status = runString(record['status']) || 'unknown';
  const exitCode = Number.isFinite(Number(record['exitCode'])) ? `, exit ${Number(record['exitCode'])}` : '';
  const progress = runProgressSummary(run);
  const mr = ticket?.mr || undefined;
  const build = ticket?.build || undefined;
  const mrChangedFiles = mergeRequestChangedFileCount(ticket);
  const sonarStatus = ticketSonarStatus(ticket);
  const testCount = firstNumberField(record, ['testCount', 'tests', 'testsPassed', 'passedTests']);
  const lines = [
    `Kronos implement run ${runId} completed.`,
    `Run result: ${status}${exitCode}.`,
    `Progress: ${progress.label}.`,
    `Files changed: ${progress.filesChanged} from run events; ${mrChangedFiles === undefined ? 'MR file list not captured' : `${mrChangedFiles} in MR`}.`,
    `Test count: ${testCount === undefined ? 'not captured in run metadata' : testCount}.`,
    `SonarQube: ${sonarStatus || 'not captured in ticket state'}.`,
    mr ? `MR: !${mr.iid} ${mr.state}/${mr.review_status}${mr.url ? ` - ${mr.url}` : ''}.` : 'MR: not linked at completion time.',
    build ? `Build: ${build.status} #${build.number}${build.url ? ` - ${build.url}` : ''}.` : 'Build: not captured in ticket state.',
  ];
  return lines.join('\n');
}

export function buildRunCompletionEvidenceCheck(run: unknown, ticket?: Ticket): RunCompletionEvidenceCheck {
  const record = runRecord(run);
  const runId = runString(record['id']) || 'unknown run';
  const status = runString(record['status']) || 'unknown';
  const exitCode = Number.isFinite(Number(record['exitCode'])) ? Number(record['exitCode']) : undefined;
  const progress = runProgressSummary(run);
  const testCount = firstNumberField(record, ['testCount', 'tests', 'testsPassed', 'passedTests']);
  const sonarStatus = ticketSonarStatus(ticket);
  const mr = ticket?.mr || undefined;
  const build = ticket?.build || undefined;
  const strongSignal = positiveTestCount(testCount) || isPassingBuild(build) || isPassingSonar(sonarStatus);
  const cleanRun = runCompletedForEvidence(record) && (exitCode === undefined || exitCode === 0);
  const summaryParts = [
    `run ${runId} ${status}${exitCode === undefined ? '' : ` exit ${exitCode}`}`,
    `${progress.filesChanged} changed file${progress.filesChanged === 1 ? '' : 's'} from run events`,
    testCount === undefined ? 'test count not captured' : `${testCount} test${testCount === 1 ? '' : 's'}`,
    sonarStatus ? `SonarQube ${sonarStatus}` : 'SonarQube not captured',
    mr ? `MR !${mr.iid} ${mr.state}/${mr.review_status}` : 'MR not linked',
    build ? `build ${build.status} #${build.number}` : 'build not captured',
  ];
  return {
    name: 'Kronos implement completion',
    result: cleanRun && strongSignal ? 'pass' : 'warn',
    environment: 'kronos',
    command: runCompletionEvidenceCommand(runId),
    confidence: strongSignal ? 'high' : 'medium',
    summary: summaryParts.join('; '),
  };
}

export function evaluatePostRunReadiness(input: {
  run: unknown;
  ticketKey?: string;
  ticket?: Ticket;
  now?: Date;
}): PostRunReadiness {
  const now = input.now || new Date();
  const inputRun = runRecord(input.run);
  const runStatus = runString(inputRun['status']);
  const failureKind = classifyRunFailure(input.run);
  const failureReason = runFailureReason(inputRun);
  if (!input.ticketKey || !input.ticket) {
    const readiness: PostRunReadiness = {
      evaluatedAt: now.toISOString(),
      status: SUCCESS_RUN_STATUSES.has(runStatus) ? 'needs_human' : 'blocked',
      summary: SUCCESS_RUN_STATUSES.has(runStatus)
        ? 'Run completed, but Kronos could not resolve current ticket state for readiness evaluation.'
        : `Run did not complete cleanly (${failureSummaryDetail(failureKind, failureReason)}).`,
      failureKind,
    };
    if (input.ticketKey) { readiness.ticketKey = input.ticketKey; }
    return readiness;
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
      summary: `Run ended as ${runStatus || 'unknown'} (${failureSummaryDetail(failureKind, failureReason)}); ticket gate is ${gate.status}.`,
      nextAction: input.ticket.next_action,
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!isHandoffAction(input.ticket.next_action)) {
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
  const status = runString(record['status']);
  if (!status && Object.keys(record).length === 0) { return 'unknown'; }
  if (SUCCESS_RUN_STATUSES.has(status)) { return 'none'; }
  if (status === 'cancelled') { return 'cancelled'; }
  const skill = runString(record['skill']).toLowerCase();
  const exitCode = Number(record['exitCode']);
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
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

function runCompletedForEvidence(record: Record<string, unknown>): boolean {
  const status = runString(record['status']);
  return SUCCESS_RUN_STATUSES.has(status) || (status === 'needs_human' && terminalRunOutcome(record) === 'completed');
}

function completionEvidenceRunId(record: Record<string, unknown>): string {
  return runString(record['id']) || 'unknown run';
}

function hasRunCompletionEvidence(ticket: Ticket, runId: string): boolean {
  const command = runCompletionEvidenceCommand(runId);
  return evidenceChecks(ticket).some(check => evidenceCheckMatchesRunCompletion(check, runId, command))
    || evidenceNotes(ticket).some(note => evidenceNoteMatchesRunCompletion(note, runId));
}

function evidenceCheckMatchesRunCompletion(check: object, runId: string, command: string): boolean {
  if (evidenceString(check, 'name') !== 'Kronos implement completion') { return false; }
  if (runId === 'unknown run') { return true; }
  return evidenceString(check, 'command') === command
    || evidenceString(check, 'summary').includes(`run ${runId}`);
}

function evidenceNoteMatchesRunCompletion(note: object, runId: string): boolean {
  const text = evidenceString(note, 'text');
  return runId === 'unknown run'
    ? text.startsWith('Kronos implement run unknown run completed.')
    : text.startsWith(`Kronos implement run ${runId} completed.`);
}

function runCompletionEvidenceCommand(runId: string): string {
  return `kronos run ${runId}`;
}

function runString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function trimmedString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || undefined;
}

function runText(value: unknown): string | undefined {
  if (value === undefined || value === null) { return undefined; }
  const text = String(value).trim();
  return text ? text : undefined;
}

function runFailureReason(record: Record<string, unknown>): string {
  return [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
  ].map(runText).find((line): line is string => Boolean(line)) || '';
}

function failureSummaryDetail(kind: RunFailureKind, reason: string): string {
  return reason ? `${kind}: ${reason}` : kind;
}

function runEventDetails(value: unknown): unknown[] {
  if (!Array.isArray(value)) { return []; }
  return value.flatMap(event => {
    const record = runRecord(event);
    return [record['label'], record['detail']];
  });
}

function resolveTicketFromRunRecord(tickets: Record<string, Ticket>, run: unknown): PostRunTicketResolution | undefined {
  const searchValues = runSearchStrings(runRecord(run));
  if (searchValues.length === 0) { return undefined; }
  const matches = Object.entries(tickets).filter(([key]) => ticketKeyAppearsInStrings(key, searchValues));
  if (matches.length !== 1) { return undefined; }
  const matched = matches[0];
  return matched ? { ticketKey: matched[0], ticket: matched[1] } : undefined;
}

function runSearchStrings(record: Record<string, unknown>): string[] {
  const branch = runRecord(record['branch']);
  const promptMetadata = runRecord(record['promptMetadata']);
  return [
    record['ticket'],
    record['ticketKey'],
    record['issueKey'],
    record['jiraKey'],
    record['id'],
    record['promptPreview'],
    record['prompt'],
    record['worktreePath'],
    record['cwd'],
    branch['requestedWorktreeBranch'],
    branch['resolvedWorktreeRef'],
    branch['checkoutRef'],
    branch['currentRef'],
    promptMetadata['name'],
    promptMetadata['path'],
    ...runEventDetails(record['events']),
  ].map(runText).filter((line): line is string => Boolean(line));
}

function ticketKeyAppearsInStrings(ticketKey: string, values: string[]): boolean {
  const pattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(ticketKey)}($|[^A-Za-z0-9])`, 'i');
  return values.some(value => pattern.test(value));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean {
  const target = projectName.toLowerCase();
  return ticket.projects.some(project => project.toLowerCase() === target);
}

function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined {
  const files = ticket?.mr?.changed_files || ticket?.mr?.files;
  return Array.isArray(files) ? files.length : undefined;
}

function ticketSonarStatus(ticket?: Ticket): string | undefined {
  return firstStringField(runRecord(ticket), [
    'sonar_status',
    'sonarStatus',
    'sonar_quality_gate',
    'sonarQualityGate',
    'quality_gate',
    'qualityGate',
    'quality_gate_status',
    'qualityGateStatus',
  ]);
}

function isPassingBuild(build: Ticket['build'] | undefined): boolean {
  const status = String(build?.status || '').trim().toUpperCase();
  return ['SUCCESS', 'PASSED', 'OK'].includes(status);
}

function isPassingSonar(status: string | undefined): boolean {
  return ['OK', 'PASS', 'PASSED', 'SUCCESS'].includes(String(status || '').trim().toUpperCase());
}

function positiveTestCount(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function firstNumberField(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}
