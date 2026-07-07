import * as fs from 'fs';
import * as path from 'path';

import { Ticket } from '../state/types';
import { isHandoffAction } from './actionSemantics';
import { isPassingBuildStatus } from './buildStatus';
import { normalizeChangedFiles } from './changedFiles';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';
import { evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './evidenceData';
import { isExistingRealPathInside } from './pathUtils';
import { runProgressSummary } from './runProgress';
import { RUNS_DIR } from './runStore';
import { isSuccessfulRunStatus, terminalRunOutcome } from './runStatus';
import { escapeRegExp } from './regexp';
import { arrayFromUnknown, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown, recordFromUnknown } from './records';

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

interface PostRunReadinessRunPatch {
  readiness: PostRunReadiness;
  failureKind: RunFailureKind;
  status?: 'waiting_for_review' | 'needs_human';
  failureReason?: string;
}

interface RunCompletionEvidenceCheck {
  name: string;
  result: 'pass' | 'fail' | 'warn' | 'unknown';
  environment: string;
  command?: string;
  summary: string;
  confidence: 'medium' | 'high';
}

interface RunCompletionEvidenceContext {
  record: Record<string, unknown>;
  runId: string;
  skill: string;
  status: string;
  exitCode: number | undefined;
  promptMetadata: Record<string, unknown>;
  progress: ReturnType<typeof runProgressSummary>;
  mr: Ticket['mr'] | undefined;
  build: Ticket['build'] | undefined;
  mrChangedFiles: number | undefined;
  sonarStatus: string | undefined;
  testCount: number | undefined;
  logText: string;
  sessionReport: string | undefined;
  replayRequests: ReplayRequestEvidence[];
  traceFlow: TraceFlowEntry[];
}

interface PostRunTicketResolution {
  ticketKey?: string;
  ticket?: Ticket;
}

interface ReplayRequestEvidence {
  command: string;
  bodyFile?: string;
  bodyText?: string;
  bodyOmittedReason?: string;
  bodyReference?: ReplayBodyReference;
}

interface ReplayBodyReference {
  fullMatch: string;
  option: string;
  fileReference: string;
}

interface TraceFlowEntry {
  component: string;
  direction: 'REQUEST' | 'RESPONSE';
  detail: string;
}

export function resolvePostRunTicket(input: {
  tickets?: Record<string, Ticket>;
  ticketKey?: string;
  projectName?: string;
  run?: unknown;
}): PostRunTicketResolution {
  const ticketKey = optionalTrimmedStringFromUnknown(input.ticketKey);
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

  const projectName = optionalTrimmedStringFromUnknown(input.projectName) || runString(recordFromUnknown(input.run)['project']);
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
  const record = recordFromUnknown(input.run);
  const runId = completionEvidenceRunId(record);
  const skill = runString(record['skill']);
  if (!runCompletedForEvidence(record) || hasRunCompletionEvidence(input.ticket, runId)) {
    return false;
  }
  if (skill === 'verify-local') {
    return true;
  }
  if (skill === 'implement') {
    return true;
  }
  return runCompletedForEvidence(record)
    && runString(record['skill']) === 'implement'
    && input.ticket.next_action === 'await_review';
}

export function buildRunCompletionEvidenceText(run: unknown, ticket?: Ticket): string {
  const context = runCompletionEvidenceContext(run, ticket);
  const exitCode = context.exitCode === undefined ? '' : `, exit ${context.exitCode}`;
  const workflow = runCompletionEvidenceWorkflow(context.skill);
  const lines = [
    `Kronos ${workflow} run ${context.runId} completed.`,
    `Run result: ${context.status}${exitCode}.`,
    ...(context.sessionReport ? ['Session report:', context.sessionReport] : []),
    '',
    `Progress: ${context.progress.label}.`,
    ...runCompletionEvidenceTargetLines(context),
    ...runCompletionEvidenceTrackingLines(context),
    ...runCompletionEvidenceReplayLines(context),
    ...runCompletionEvidenceTraceFlowLines(context),
    `Files changed: ${context.progress.filesChanged} from run events; ${context.mrChangedFiles === undefined ? 'MR file list not captured' : `${context.mrChangedFiles} in MR`}.`,
    `Test count: ${context.testCount === undefined ? 'not captured in run metadata' : context.testCount}.`,
    `SonarQube: ${context.sonarStatus || 'not captured in ticket state'}.`,
    context.mr ? `MR: !${context.mr.iid} ${context.mr.state}/${context.mr.review_status}${context.mr.url ? ` - ${context.mr.url}` : ''}.` : 'MR: not linked at completion time.',
    context.build ? `Build: ${context.build.status} #${context.build.number}${context.build.url ? ` - ${context.build.url}` : ''}.` : 'Build: not captured in ticket state.',
  ];
  return lines.join('\n');
}

export function buildRunCompletionEvidenceCheck(run: unknown, ticket?: Ticket): RunCompletionEvidenceCheck {
  const context = runCompletionEvidenceContext(run, ticket);
  const strongSignal = positiveTestCount(context.testCount) || isPassingBuildStatus(context.build?.status) || isPassingSonar(context.sonarStatus);
  const cleanRun = runCleanForEvidence(context.record, context.exitCode);
  const isVerifyLocal = context.skill === 'verify-local';
  const reportSummary = runCompletionEvidenceReportSummary(context.sessionReport);
  const summaryParts = [
    `run ${context.runId} ${context.status}${context.exitCode === undefined ? '' : ` exit ${context.exitCode}`}`,
    ...runCompletionEvidenceTargetSummaryParts(context),
    ...runCompletionEvidenceTrackingSummaryParts(context),
    ...(reportSummary ? [`report: ${reportSummary}`] : []),
    `${context.progress.filesChanged} changed file${context.progress.filesChanged === 1 ? '' : 's'} from run events`,
    context.testCount === undefined ? 'test count not captured' : `${context.testCount} test${context.testCount === 1 ? '' : 's'}`,
    context.sonarStatus ? `SonarQube ${context.sonarStatus}` : 'SonarQube not captured',
    context.mr ? `MR !${context.mr.iid} ${context.mr.state}/${context.mr.review_status}` : 'MR not linked',
    context.build ? `build ${context.build.status} #${context.build.number}` : 'build not captured',
  ];
  return {
    name: runCompletionEvidenceCheckName(context.skill),
    result: isVerifyLocal ? (cleanRun ? 'warn' : 'fail') : cleanRun && strongSignal ? 'pass' : 'warn',
    environment: runCompletionEvidenceEnvironment(context),
    command: runCompletionEvidenceCommand(context.runId),
    confidence: strongSignal || (isVerifyLocal && cleanRun) || Boolean(context.sessionReport) ? 'high' : 'medium',
    summary: summaryParts.join('; '),
  };
}

function runCompletionEvidenceContext(run: unknown, ticket?: Ticket): RunCompletionEvidenceContext {
  const record = recordFromUnknown(run);
  const exitCode = Number(record['exitCode']);
  const skill = runString(record['skill']);
  const logText = readRunCompletionLogText(record);
  const sessionReport = runCompletionSessionReport(record, logText);
  const sourceText = runCompletionEvidenceSourceText(record, logText, sessionReport);
  return {
    record,
    runId: runString(record['id']) || 'unknown run',
    skill,
    status: runString(record['status']) || 'unknown',
    exitCode: Number.isFinite(exitCode) ? exitCode : undefined,
    promptMetadata: recordFromUnknown(record['promptMetadata']),
    progress: runProgressSummary(run),
    mr: ticket?.mr || undefined,
    build: ticket?.build || undefined,
    mrChangedFiles: mergeRequestChangedFileCount(ticket),
    sonarStatus: ticketSonarStatus(ticket),
    testCount: firstNumberField(record, ['testCount', 'tests', 'testsPassed', 'passedTests']),
    logText,
    sessionReport,
    replayRequests: replayRequestsFromContext(record, logText, sourceText),
    traceFlow: traceFlowEntriesFromText(sourceText),
  };
}

function runCompletionEvidenceWorkflow(skill: string): string {
  return skill === 'verify-local' ? 'verify-local' : 'implement';
}

function runCompletionEvidenceCheckName(skill: string): string {
  return skill === 'verify-local' ? 'Kronos verify-local result' : 'Kronos implement completion';
}

function runCompletionEvidenceEnvironment(context: RunCompletionEvidenceContext): string {
  const environment = runString(context.promptMetadata['verifyEnvironment']);
  return environment || (context.skill === 'verify-local' ? 'verify-local' : 'kronos');
}

function runCompletionEvidenceTargetLines(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  return [
    `Verification branch: ${runString(context.promptMetadata['verifyBranch']) || 'not captured'}.`,
    `Verification environment: ${runCompletionEvidenceEnvironment(context)}.`,
    `Verification mode: ${runString(context.promptMetadata['verifyMode']) || 'not captured'}.`,
  ];
}

function runCompletionEvidenceTargetSummaryParts(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  return [
    `branch ${runString(context.promptMetadata['verifyBranch']) || 'not captured'}`,
    `environment ${runCompletionEvidenceEnvironment(context)}`,
    `mode ${runString(context.promptMetadata['verifyMode']) || 'not captured'}`,
  ];
}

function runCompletionEvidenceTrackingLines(context: RunCompletionEvidenceContext): string[] {
  const ids = runCompletionEvidenceTrackingIds(context);
  return ids.length ? [`Tracking IDs used: ${ids.join(', ')}.`] : [];
}

function runCompletionEvidenceTrackingSummaryParts(context: RunCompletionEvidenceContext): string[] {
  const ids = runCompletionEvidenceTrackingIds(context);
  return ids.length ? [`tracking IDs ${ids.join(', ')}`] : [];
}

function runCompletionEvidenceReplayLines(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local' || context.replayRequests.length === 0) { return []; }
  const lines: string[] = [];
  context.replayRequests.forEach((request, index) => {
    const label = context.replayRequests.length === 1 ? 'Replay request:' : `Replay request ${index + 1}:`;
    const bodyLabel = request.bodyFile && request.bodyText
      ? ` body inlined from ${path.basename(request.bodyFile)}`
      : '';
    lines.push(`${label}${bodyLabel}`);
    lines.push(...fencedCodeBlock('bash', replayRequestCommandBlock(request)));
    if (request.bodyFile && request.bodyOmittedReason) {
      lines.push(`Replay request body (${path.basename(request.bodyFile)}): ${request.bodyOmittedReason}.`);
    }
  });
  return lines;
}

function runCompletionEvidenceTraceFlowLines(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local' || context.traceFlow.length === 0) { return []; }
  const ids = runCompletionEvidenceTrackingIds(context);
  const header = ids.length
    ? `Trace lookup flow for ${ids.join(', ')}:`
    : 'Trace lookup flow:';
  return [
    header,
    ...context.traceFlow.map(entry => {
      const detail = entry.detail ? `: ${entry.detail}` : '';
      return `- ${entry.component} ${entry.direction}${detail}`;
    }),
  ];
}

function runCompletionEvidenceTrackingIds(context: RunCompletionEvidenceContext): string[] {
  if (context.skill !== 'verify-local') { return []; }
  const verifiedIds = trackingIdsFromText([
    context.sessionReport,
    context.logText,
    runEventDetails(context.record['events']).join('\n'),
  ].filter(Boolean).join('\n'));
  if (verifiedIds.length) {
    return verifiedIds.slice(0, 12);
  }
  const hints = runString(context.promptMetadata['verifyTrackingHints']);
  if (!hints || /^No explicit tracking/i.test(hints)) { return []; }
  const ids = hints
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*[-*]\s*/, '').trim())
    .map(line => line.replace(/\s+\([^)]*\)\s*$/, '').trim())
    .flatMap(line => trackingIdsFromText(line))
    .filter(Boolean);
  return [...new Set(ids)].slice(0, 12);
}

function runCompletionEvidenceSourceText(record: Record<string, unknown>, logText: string, sessionReport: string | undefined): string {
  return [
    sessionReport,
    ...claudeLogTextFragments(logText),
    logText,
    runEventDetails(record['events']).join('\n'),
  ].filter(Boolean).join('\n');
}

function replayRequestsFromContext(record: Record<string, unknown>, logText: string, sourceText: string): ReplayRequestEvidence[] {
  const commands = uniqueStrings([
    ...curlCommandsFromClaudeLog(logText),
    ...curlCommandsFromText(sourceText),
  ].filter(replayCurlCommandLooksRelevant));
  return commands.slice(0, 4).map(command => replayRequestEvidence(record, command));
}

function curlCommandsFromClaudeLog(logText: string): string[] {
  if (!logText.trim()) { return []; }
  const commands: string[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) { continue; }
    try {
      const payload = recordFromUnknown(JSON.parse(trimmed));
      if (payload['type'] !== 'assistant') { continue; }
      const message = recordFromUnknown(payload['message']);
      for (const block of arrayFromUnknown(message['content'])) {
        const blockRecord = recordFromUnknown(block);
        if (blockRecord['type'] !== 'tool_use') { continue; }
        const input = recordFromUnknown(blockRecord['input']);
        const command = runString(input['command']).trim();
        if (/\bcurl\b/i.test(command)) {
          commands.push(command);
        }
      }
    } catch {
      // Ignore non-JSON log lines; stdout is a mixed stream on some Claude versions.
    }
  }
  return commands;
}

function curlCommandsFromText(text: string): string[] {
  const commands: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = commandLineFromText(lines[index] || '');
    if (!/^curl\b/i.test(line)) { continue; }
    const commandLines = [line];
    while (/\\\s*$/.test(commandLines[commandLines.length - 1] || '') && index + 1 < lines.length) {
      index += 1;
      commandLines.push(commandLineFromText(lines[index] || ''));
    }
    commands.push(commandLines.join('\n').trim());
  }
  return commands;
}

function commandLineFromText(line: string): string {
  return line.trim().replace(/^\$\s+/, '').replace(/^>\s?/, '').trim();
}

function replayCurlCommandLooksRelevant(command: string): boolean {
  if (!/\bcurl\b/i.test(command)) { return false; }
  if (/\/trace-lookup\b/i.test(command)) { return false; }
  return commandHasRequestBodyOption(command)
    || /\bX-Tracking-?Id\b|tracking[-_\s]?id|\breplay\b|replay-[A-Za-z0-9._-]+\.json\b/i.test(command);
}

function commandHasRequestBodyOption(command: string): boolean {
  return /(?:^|\s)(?:--data(?:-raw|-binary|-ascii|-urlencode)?|--json|-d)(?:\s|=)/i.test(command);
}

function replayRequestEvidence(record: Record<string, unknown>, command: string): ReplayRequestEvidence {
  const bodyReference = replayBodyReferenceFromCommand(command);
  const body = bodyReference ? readReplayBodyFile(record, bodyReference.fileReference) : undefined;
  const evidence: ReplayRequestEvidence = { command };
  if (bodyReference) { evidence.bodyReference = bodyReference; }
  if (body?.filePath) { evidence.bodyFile = body.filePath; }
  if (body?.text) { evidence.bodyText = body.text; }
  if (body?.omittedReason) { evidence.bodyOmittedReason = body.omittedReason; }
  return evidence;
}

function replayBodyReferenceFromCommand(command: string): ReplayBodyReference | undefined {
  const match = /(--data(?:-raw|-binary|-ascii|-urlencode)?|--json|-d)(?:\s+|=)(?:"@([^"]+)"|'@([^']+)'|@(\S+))/i.exec(command);
  const fileReference = normalizeReplayBodyReference(match?.[2] || match?.[3] || match?.[4]);
  if (!match || !fileReference) { return undefined; }
  return {
    fullMatch: match[0],
    option: match[1] || '--data-binary',
    fileReference,
  };
}

function normalizeReplayBodyReference(value: string | undefined): string {
  return String(value || '').replace(/[;,)]+$/g, '').trim();
}

function readReplayBodyFile(record: Record<string, unknown>, fileReference: string): { filePath: string; text?: string; omittedReason?: string } | undefined {
  const filePath = resolveReplayBodyFile(record, fileReference);
  if (!filePath) { return undefined; }
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) { return undefined; }
    const maxBytes = 128 * 1024;
    if (stat.size > maxBytes) {
      return {
        filePath,
        omittedReason: `not embedded because the request body is ${stat.size} bytes (limit ${maxBytes})`,
      };
    }
    return { filePath, text: fs.readFileSync(filePath, 'utf8') };
  } catch {
    return undefined;
  }
}

function resolveReplayBodyFile(record: Record<string, unknown>, fileReference: string): string | undefined {
  const reference = fileReference.trim();
  if (!reference || reference.includes('\0') || /^-/.test(reference) || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(reference)) {
    return undefined;
  }
  const roots = replayBodySearchRoots(record);
  const candidates = path.isAbsolute(reference)
    ? [reference]
    : roots.map(root => path.resolve(root, reference));
  for (const candidate of uniqueStrings(candidates)) {
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) { continue; }
      if (roots.some(root => safePathInside(candidate, root))) {
        return candidate;
      }
    } catch {
      // Ignore missing or unreadable candidate paths.
    }
  }
  return undefined;
}

function replayBodySearchRoots(record: Record<string, unknown>): string[] {
  const branch = recordFromUnknown(record['branch']);
  const promptMetadata = recordFromUnknown(record['promptMetadata']);
  const logPath = runString(record['logPath']);
  return uniqueStrings([
    record['cwd'],
    record['worktreePath'],
    record['projectPath'],
    record['workspacePath'],
    branch['worktreePath'],
    branch['path'],
    promptMetadata['workspacePath'],
    promptMetadata['projectPath'],
    promptMetadata['worktreePath'],
    logPath ? path.dirname(logPath) : '',
    RUNS_DIR,
  ].map(existingSafeDirectory).filter((value): value is string => Boolean(value)));
}

function existingSafeDirectory(value: unknown): string | undefined {
  const directory = runString(value);
  if (!directory || !path.isAbsolute(directory)) { return undefined; }
  try {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) { return undefined; }
    const realDirectory = fs.realpathSync(directory);
    if (realDirectory === path.parse(realDirectory).root) { return undefined; }
    return realDirectory;
  } catch {
    return undefined;
  }
}

function safePathInside(filePath: string, directoryPath: string): boolean {
  try {
    return isExistingRealPathInside(filePath, directoryPath);
  } catch {
    return false;
  }
}

function replayRequestCommandBlock(request: ReplayRequestEvidence): string {
  if (!request.bodyText || !request.bodyReference) {
    return request.command.trim();
  }
  const delimiter = replayHereDocDelimiter(request.bodyText);
  const command = request.command
    .replace(request.bodyReference.fullMatch, `${request.bodyReference.option} @-`)
    .trimEnd();
  const body = request.bodyText.endsWith('\n') ? request.bodyText : `${request.bodyText}\n`;
  return `${command} <<'${delimiter}'\n${body}${delimiter}`;
}

function replayHereDocDelimiter(body: string): string {
  let delimiter = 'KRONOS_REPLAY_BODY';
  let suffix = 1;
  while (body.includes(delimiter)) {
    delimiter = `KRONOS_REPLAY_BODY_${suffix}`;
    suffix += 1;
  }
  return delimiter;
}

function fencedCodeBlock(language: string, content: string): string[] {
  const fence = markdownFenceFor(content);
  return [`${fence}${language}`, content, fence];
}

function markdownFenceFor(content: string): string {
  const matches = content.match(/`{3,}/g) || [];
  const length = Math.max(3, ...matches.map(match => match.length + 1));
  return '`'.repeat(length);
}

function traceFlowEntriesFromText(text: string): TraceFlowEntry[] {
  const entries: TraceFlowEntry[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    addTraceFlowEntry(entries, seen, traceFlowEntryFromLine(line));
  }
  for (const value of jsonValuesFromText(text)) {
    collectTraceFlowEntriesFromUnknown(value, entries, seen, 0);
  }
  return entries.slice(0, 40);
}

function jsonValuesFromText(text: string): unknown[] {
  const values: unknown[] = [];
  for (const match of text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/gi)) {
    const parsed = parseJsonValue(match[1] || '');
    if (parsed !== undefined) { values.push(parsed); }
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^[{[]/.test(trimmed)) { continue; }
    const parsed = parseJsonValue(trimmed);
    if (parsed !== undefined) { values.push(parsed); }
  }
  return values;
}

function parseJsonValue(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function collectTraceFlowEntriesFromUnknown(value: unknown, entries: TraceFlowEntry[], seen: Set<string>, depth: number): void {
  if (depth > 8 || value === undefined || value === null) { return; }
  if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) {
      addTraceFlowEntry(entries, seen, traceFlowEntryFromLine(line));
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectTraceFlowEntriesFromUnknown(item, entries, seen, depth + 1));
    return;
  }
  const record = recordFromUnknown(value);
  if (Object.keys(record).length === 0) { return; }
  addTraceFlowEntry(entries, seen, traceFlowEntryFromRecord(record));
  for (const child of Object.values(record)) {
    collectTraceFlowEntriesFromUnknown(child, entries, seen, depth + 1);
  }
}

function traceFlowEntryFromRecord(record: Record<string, unknown>): TraceFlowEntry | undefined {
  const componentText = traceRecordFieldString(record, ['component', 'service', 'serviceName', 'api', 'route', 'endpoint', 'operation', 'name', 'target', 'system'])
    || JSON.stringify(record).slice(0, 4000);
  const directionText = traceRecordFieldString(record, ['direction', 'type', 'eventType', 'messageType', 'kind', 'phase'])
    || JSON.stringify(record).slice(0, 4000);
  const component = traceComponentFromText(componentText);
  const direction = traceDirectionFromText(directionText);
  if (!component || !direction) { return undefined; }
  return {
    component,
    direction,
    detail: traceDetailFromRecord(record),
  };
}

function traceFlowEntryFromLine(line: string): TraceFlowEntry | undefined {
  const normalized = line.replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!normalized || !/(REQUEST|RESPONSE)/i.test(normalized)) { return undefined; }
  const component = traceComponentFromText(normalized);
  const direction = traceDirectionFromText(normalized);
  if (!component || !direction) { return undefined; }
  return {
    component,
    direction,
    detail: traceDetailFromLine(normalized),
  };
}

function addTraceFlowEntry(entries: TraceFlowEntry[], seen: Set<string>, entry: TraceFlowEntry | undefined): void {
  if (!entry) { return; }
  const key = `${entry.component}|${entry.direction}|${entry.detail}`;
  if (seen.has(key)) { return; }
  seen.add(key);
  entries.push(entry);
}

function traceComponentFromText(text: string): string | undefined {
  if (/\bepaRouter\b|\bepa\s+router\b/i.test(text)) { return 'epaRouter'; }
  if (/\bidentifysubscriberrelation\b|\bidentify subscriber relation\b/i.test(text)) { return 'identifysubscriberrelation'; }
  if (/\bmembervalidation\b|\bmember validation\b/i.test(text)) { return 'membervalidation'; }
  if (/\bauthorization\b/i.test(text)) { return 'authorization'; }
  if (/\bMHK\b/i.test(text)) { return 'MHK'; }
  if (/\bCarelon\b/i.test(text)) { return 'Carelon'; }
  return undefined;
}

function traceDirectionFromText(text: string): TraceFlowEntry['direction'] | undefined {
  const request = /\bREQUEST\b/i.exec(text);
  const response = /\bRESPONSE\b/i.exec(text);
  if (!request && !response) { return undefined; }
  if (request && response) {
    return request.index <= response.index ? 'REQUEST' : 'RESPONSE';
  }
  return request ? 'REQUEST' : 'RESPONSE';
}

function traceDetailFromLine(line: string): string {
  const direction = /\b(?:REQUEST|RESPONSE)\b/i.exec(line);
  const detail = direction ? line.slice(direction.index + direction[0].length) : line;
  return compactTraceDetail(detail.replace(/^[\s:|>\-]+/, ''));
}

function traceDetailFromRecord(record: Record<string, unknown>): string {
  const method = traceRecordFieldString(record, ['method', 'httpMethod']);
  const url = traceRecordFieldString(record, ['url', 'uri', 'path', 'endpoint']);
  const status = traceRecordFieldString(record, ['status', 'statusCode', 'httpStatus', 'responseCode']);
  const payload = traceRecordFieldValue(record, ['payload', 'body', 'requestBody', 'responseBody', 'request', 'response', 'message', 'data']);
  return compactTraceDetail([
    method,
    url,
    status ? `status ${status}` : '',
    payload === undefined ? '' : compactTracePayload(payload),
  ].filter(Boolean).join(' '));
}

function traceRecordFieldString(record: Record<string, unknown>, keys: string[]): string {
  const value = traceRecordFieldValue(record, keys);
  if (typeof value === 'string') { return value.trim(); }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  return '';
}

function traceRecordFieldValue(record: Record<string, unknown>, keys: string[]): unknown {
  const targets = new Set(keys.map(key => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (targets.has(key.toLowerCase())) {
      return value;
    }
  }
  return undefined;
}

function compactTracePayload(value: unknown): string {
  if (typeof value === 'string') {
    return compactTraceDetail(value);
  }
  try {
    return compactTraceDetail(JSON.stringify(value));
  } catch {
    return '';
  }
}

function compactTraceDetail(value: string, maxLength = 1200): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 3)}...`;
}

function claudeLogTextFragments(logText: string): string[] {
  if (!logText.trim()) { return []; }
  const fragments: string[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) { continue; }
    try {
      const payload = recordFromUnknown(JSON.parse(trimmed));
      if (payload['type'] === 'result') {
        const result = runString(payload['result']);
        if (result) { fragments.push(result); }
      } else if (payload['type'] === 'assistant') {
        const message = recordFromUnknown(payload['message']);
        for (const block of arrayFromUnknown(message['content'])) {
          collectClaudeTextFragment(block, fragments);
        }
      }
    } catch {
      // Ignore non-JSON log lines; stdout is a mixed stream on some Claude versions.
    }
  }
  return fragments;
}

function collectClaudeTextFragment(value: unknown, fragments: string[]): void {
  if (typeof value === 'string') {
    if (value.trim()) { fragments.push(value); }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => collectClaudeTextFragment(item, fragments));
    return;
  }
  const record = recordFromUnknown(value);
  const text = runString(record['text']) || runString(record['content']);
  if (text) {
    fragments.push(text);
  }
  const content = record['content'];
  if (content !== undefined && content !== text) {
    collectClaudeTextFragment(content, fragments);
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function runCompletionSessionReport(record: Record<string, unknown>, logText: string): string | undefined {
  return compactEvidenceReport(
    finalReportFromClaudeLog(logText)
    || finalReportFromText(logText)
    || finalReportFromEvents(record['events'])
  );
}

function finalReportFromEvents(value: unknown): string | undefined {
  const events = arrayFromUnknown(value).map(recordFromUnknown);
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) { continue; }
    const label = runString(event['label']);
    const detail = runString(event['detail']);
    const type = runString(event['type']);
    const combined = [label, detail].filter(Boolean).join('\n').trim();
    if (detail && (type === 'done' || looksLikeFinalReport(detail))) {
      return detail;
    }
    if (combined && looksLikeFinalReport(combined)) {
      return combined;
    }
  }
  return undefined;
}

function finalReportFromClaudeLog(logText: string): string | undefined {
  if (!logText.trim()) { return undefined; }
  const reports: string[] = [];
  for (const line of logText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) { continue; }
    try {
      const payload = recordFromUnknown(JSON.parse(trimmed));
      if (payload['type'] === 'result') {
        const result = runString(payload['result']);
        if (result) { reports.push(result); }
      } else if (payload['type'] === 'assistant') {
        const message = recordFromUnknown(payload['message']);
        for (const block of arrayFromUnknown(message['content'])) {
          const blockRecord = recordFromUnknown(block);
          if (blockRecord['type'] === 'text') {
            const text = runString(blockRecord['text']);
            if (text) { reports.push(text); }
          }
        }
      }
    } catch {
      // Ignore non-JSON log lines; stdout is a mixed stream on some Claude versions.
    }
  }
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const report = reports[index];
    if (report && looksLikeFinalReport(report)) {
      return report;
    }
  }
  for (let index = reports.length - 1; index >= 0; index -= 1) {
    const report = reports[index];
    if (report && report.trim().length > 120) {
      return report;
    }
  }
  return undefined;
}

function finalReportFromText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) { return undefined; }
  const markers = [
    /(?:^|\n)\s*#{1,4}\s*(?:final\s+)?(?:verification\s+)?(?:summary|report|result|findings)\b/i,
    /(?:^|\n)\s*(?:final\s+)?(?:verification\s+)?(?:summary|report|result|findings)\s*:/i,
    /(?:^|\n)\s*verdict\s*:/i,
  ];
  for (const marker of markers) {
    const match = marker.exec(trimmed);
    if (match?.index !== undefined && match.index >= 0) {
      return trimmed.slice(match.index).trim();
    }
  }
  return undefined;
}

function looksLikeFinalReport(text: string): boolean {
  return /final (summary|report)|verification (summary|report|result)|verdict|root cause|test results?|curl|x-tracking-?id|fix analysis|defect no longer reproduces|awaiting deployment/i.test(text);
}

function compactEvidenceReport(text: string | undefined, maxLength = 6000): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) { return undefined; }
  if (trimmed.length <= maxLength) { return trimmed; }
  return `${trimmed.slice(0, maxLength - 80).trimEnd()}\n\n[report truncated to ${maxLength} characters; see run log for full output]`;
}

function runCompletionEvidenceReportSummary(report: string | undefined): string | undefined {
  const lines = report?.split(/\r?\n/)
    .map(line => line.replace(/^\s*[#>*|:-]+\s*/, '').trim())
    .filter(line => line && !/^[-:|]+$/.test(line));
  if (!lines?.length) { return undefined; }
  const preferred = lines.find(line => /verdict/i.test(line))
    || lines.find(line => /fix|defect|pass|fail|success|awaiting deployment/i.test(line))
    || lines.find(line => /root cause/i.test(line))
    || lines[0];
  return preferred ? compactSingleLine(preferred, 300) : undefined;
}

function trackingIdsFromText(text: string): string[] {
  const ids: string[] = [];
  const patterns = [
    /\bX-Tracking-?Id\b["']?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]{7,})/gi,
    /\btracking[-_\s]?id\b["']?\s*[:=]\s*["']?([A-Za-z0-9][A-Za-z0-9._:-]{7,})/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const candidate = normalizeTrackingId(match[1]);
      if (candidate && isUsefulTrackingId(candidate)) {
        ids.push(candidate);
      }
    }
  }
  return [...new Set(ids)];
}

function normalizeTrackingId(value: string | undefined): string {
  return String(value || '').replace(/^[<("{']+|[>)."',;]+$/g, '').trim();
}

function isUsefulTrackingId(value: string): boolean {
  if (value.length < 8) { return false; }
  if (/^[A-Za-z]+$/.test(value)) { return false; }
  return /^[A-Za-z0-9][A-Za-z0-9._:-]+$/.test(value);
}

function readRunCompletionLogText(record: Record<string, unknown>): string {
  const logPath = runString(record['logPath']);
  if (!logPath) { return ''; }
  try {
    if (!fs.existsSync(logPath) || !isExistingRealPathInside(logPath, RUNS_DIR) || !fs.statSync(logPath).isFile()) {
      return '';
    }
    const stat = fs.statSync(logPath);
    const maxBytes = 128 * 1024;
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(logPath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      return buffer.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function compactSingleLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 3)}...`;
}

export function evaluatePostRunReadiness(input: {
  run: unknown;
  ticketKey?: string;
  ticket?: Ticket;
  now?: Date;
}): PostRunReadiness {
  const now = input.now || new Date();
  const inputRun = recordFromUnknown(input.run);
  const runStatus = runString(inputRun['status']);
  const failureKind = classifyRunFailure(input.run);
  const failureReason = runFailureReason(inputRun);
  if (!input.ticketKey || !input.ticket) {
    const readiness: PostRunReadiness = {
      evaluatedAt: now.toISOString(),
      status: isSuccessfulRunStatus(runStatus) ? 'needs_human' : 'blocked',
      summary: isSuccessfulRunStatus(runStatus)
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

  const deploymentPendingSummary = fixMergedAwaitingDeploymentSummary(inputRun, input.ticket);
  if (deploymentPendingSummary) {
    return {
      evaluatedAt: now.toISOString(),
      ticketKey: input.ticketKey,
      status: 'needs_human',
      summary: deploymentPendingSummary,
      nextAction: 'deploy_monitor',
      evidenceGate: gateSummary,
      failureKind,
    };
  }

  if (!isSuccessfulRunStatus(runStatus)) {
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

export function postRunReadinessRunPatch(run: unknown, readiness: PostRunReadiness): PostRunReadinessRunPatch {
  const record = recordFromUnknown(run);
  const currentStatus = runString(record['status']);
  const patch: PostRunReadinessRunPatch = {
    readiness,
    failureKind: readiness.failureKind,
  };
  const status = postRunReadinessStatusTransition(currentStatus, readiness);
  if (status) {
    patch.status = status;
  }
  const nextStatus = status || currentStatus;
  if (nextStatus === 'needs_human' && !runString(record['failureReason'])) {
    patch.failureReason = readiness.summary;
  }
  return patch;
}

function postRunReadinessStatusTransition(runStatus: string, readiness: PostRunReadiness): PostRunReadinessRunPatch['status'] {
  if (!isSuccessfulRunStatus(runStatus)) { return undefined; }
  if (readiness.status === 'ready') { return 'waiting_for_review'; }
  if (readiness.status === 'needs_human' || readiness.status === 'blocked') { return 'needs_human'; }
  return undefined;
}

export function classifyRunFailure(run: unknown): RunFailureKind {
  const record = recordFromUnknown(run);
  const status = runString(record['status']);
  if (!status && Object.keys(record).length === 0) { return 'unknown'; }
  if (isSuccessfulRunStatus(status)) { return 'none'; }
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

function runCompletedForEvidence(record: Record<string, unknown>): boolean {
  const status = runString(record['status']);
  return isSuccessfulRunStatus(status)
    || (status === 'needs_human' && terminalRunOutcome(record) === 'completed')
    || verifyLocalLoopInterruptedAfterFinalSummary(record);
}

function runCleanForEvidence(record: Record<string, unknown>, exitCode: number | undefined): boolean {
  return runCompletedForEvidence(record)
    && (exitCode === undefined || exitCode === 0 || verifyLocalLoopInterruptedAfterFinalSummary(record));
}

function verifyLocalLoopInterruptedAfterFinalSummary(record: Record<string, unknown>): boolean {
  if (runString(record['skill']) !== 'verify-local') { return false; }
  if (runString(record['status']) !== 'needs_human') { return false; }
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n');
  if (!/Possible tool loop detected|Stopped after \d+ repeated/i.test(text)) { return false; }
  if (!/final (summary|report)|verification (summary|report)|verdict|result/i.test(text)) { return false; }
  return /defect no longer reproduces|fix (?:verified|works|confirmed)|reported failure no longer occurs|pass(?:ed|ing)?|success/i.test(text);
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
  const name = evidenceString(check, 'name');
  if (!name.startsWith('Kronos ') || (!name.includes('completion') && !name.includes('result'))) { return false; }
  if (runId === 'unknown run') { return true; }
  return evidenceString(check, 'command') === command
    || evidenceString(check, 'summary').includes(`run ${runId}`);
}

function evidenceNoteMatchesRunCompletion(note: object, runId: string): boolean {
  const text = evidenceString(note, 'text');
  return runId === 'unknown run'
    ? /^Kronos (implement|verify-local) run unknown run completed\./.test(text)
    : new RegExp(`^Kronos (implement|verify-local) run ${escapeRegExp(runId)} completed\\.`).test(text);
}

function runCompletionEvidenceCommand(runId: string): string {
  return `kronos run ${runId}`;
}

function runString(value: unknown): string {
  return typeof value === 'string' ? value : '';
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
  return arrayFromUnknown(value).flatMap(event => {
    const record = recordFromUnknown(event);
    return [record['label'], record['detail']];
  });
}

function fixMergedAwaitingDeploymentSummary(record: Record<string, unknown>, ticket: Ticket): string | undefined {
  if (runString(record['skill']) !== 'verify-local') { return undefined; }
  const metadata = recordFromUnknown(record['promptMetadata']);
  if (runString(metadata['verifyMode']) !== 'confirm-fix-works') { return undefined; }
  if (!verifyTargetIsTest(metadata, ticket)) { return undefined; }
  if (!fixAppearsMergedInDevelop(metadata, ticket)) { return undefined; }
  if (!testStillShowsOldBehavior(record, ticket) && ticket.next_action !== 'deploy_monitor') { return undefined; }
  return 'Verify-local found the fix on develop, but TEST still appears to be running the old behavior; fix is merged and awaiting deployment to TEST.';
}

function verifyTargetIsTest(metadata: Record<string, unknown>, ticket: Ticket): boolean {
  const environment = runString(metadata['verifyEnvironment']).toLowerCase();
  const environmentUrl = runString(metadata['verifyEnvironmentUrl']).toLowerCase();
  if (environment === 'test' || /\btest\b/.test(environmentUrl)) { return true; }
  return evidenceEnvironmentResults(ticket).some(result => evidenceString(result, 'environment').toLowerCase() === 'test');
}

function fixAppearsMergedInDevelop(metadata: Record<string, unknown>, ticket: Ticket): boolean {
  const branch = runString(metadata['verifyBranch']).replace(/^origin\//, '').toLowerCase();
  return branch === 'develop' || ticket.mr?.state === 'merged' || ticket.next_action === 'deploy_monitor';
}

function testStillShowsOldBehavior(record: Record<string, unknown>, ticket: Ticket): boolean {
  const text = [
    record['failureReason'],
    record['error'],
    ...runEventDetails(record['events']),
    ...evidenceEnvironmentResults(ticket).flatMap(result => [
      evidenceString(result, 'environment'),
      evidenceString(result, 'status'),
      evidenceString(result, 'detail'),
    ]),
    ...evidenceChecks(ticket).flatMap(check => [
      evidenceString(check, 'name'),
      evidenceString(check, 'result'),
      evidenceString(check, 'summary'),
    ]),
  ].map(runText).filter((line): line is string => Boolean(line)).join('\n').toLowerCase();
  return /old behavior|still reproduc|still fail|not deployed|awaiting deploy|deployment pending|test.*(?:old|not updated|stale)|environment.*(?:old|stale)/.test(text);
}

function resolveTicketFromRunRecord(tickets: Record<string, Ticket>, run: unknown): PostRunTicketResolution | undefined {
  const searchValues = runSearchStrings(recordFromUnknown(run));
  if (searchValues.length === 0) { return undefined; }
  const matches = Object.entries(tickets).filter(([key]) => ticketKeyAppearsInStrings(key, searchValues));
  if (matches.length !== 1) { return undefined; }
  const matched = matches[0];
  return matched ? { ticketKey: matched[0], ticket: matched[1] } : undefined;
}

function runSearchStrings(record: Record<string, unknown>): string[] {
  const branch = recordFromUnknown(record['branch']);
  const promptMetadata = recordFromUnknown(record['promptMetadata']);
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

function ticketLinkedToProject(ticket: Ticket, projectName: string): boolean {
  const target = projectName.toLowerCase();
  return ticket.projects.some(project => project.toLowerCase() === target);
}

function mergeRequestChangedFileCount(ticket?: Ticket): number | undefined {
  const files = ticket?.mr?.changed_files ?? ticket?.mr?.files;
  if (files === undefined) { return undefined; }
  return normalizeChangedFiles(files).length;
}

function ticketSonarStatus(ticket?: Ticket): string | undefined {
  return firstStringField(recordFromUnknown(ticket), [
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
    const parsed = optionalFiniteNumberFromUnknown(record[key]);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}
