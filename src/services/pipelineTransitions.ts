import * as crypto from 'crypto';
import type { GitLabMergeRequestContextSnapshot, GitLabMergeRequestMonitorSnapshot } from './gitlabRestClient';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';
import { redactSensitiveTokens } from './sensitiveText';

export type GitLabPipelineTransitionKind =
  | 'new_pipeline'
  | 'pipeline_failed'
  | 'pipeline_canceled'
  | 'pipeline_recovered'
  | 'pipeline_succeeded'
  | 'blocking_jobs_failed'
  | 'blocking_jobs_recovered'
  | 'tests_failed'
  | 'tests_recovered';

export interface GitLabFailedJobDigest {
  id: number;
  name: string;
  status: string;
  stage?: string;
  url?: string;
}

export interface GitLabPipelineTestDigest {
  available: boolean;
  total: number;
  failed: number;
  error: number;
  skipped: number;
}

export interface GitLabPipelineDigest {
  schemaVersion: 1;
  id: number;
  status: string;
  failedJobs: GitLabFailedJobDigest[];
  failedJobsTruncated: boolean;
  jobsComplete: boolean;
  tests: GitLabPipelineTestDigest;
  testsComplete: boolean;
  fetchedAt: string;
  fingerprint: string;
  projectIdOrPath?: string;
  url?: string;
  ref?: string;
  sha?: string;
}

export interface GitLabPipelineTransition {
  kind: GitLabPipelineTransitionKind;
  key: string;
  pipelineId: number;
  currentStatus: string;
  currentFingerprint: string;
  jobs: GitLabFailedJobDigest[];
  tests: GitLabPipelineTestDigest;
  previousPipelineId?: number;
  previousStatus?: string;
  previousFingerprint?: string;
}

interface PipelineDigestMaterial {
  schemaVersion: 1;
  id: number;
  status: string;
  failedJobs: GitLabFailedJobDigest[];
  failedJobsTruncated: boolean;
  jobsComplete: boolean;
  tests: GitLabPipelineTestDigest;
  testsComplete: boolean;
  projectIdOrPath?: string;
  url?: string;
  ref?: string;
  sha?: string;
}

interface NormalizedJobCandidate extends GitLabFailedJobDigest {
  allowFailure: boolean;
  retried: boolean;
}

const MAX_SOURCE_JOBS = 1_000;
const MAX_SOURCE_PIPELINES = 1_000;
const MAX_FAILED_JOBS = 100;
const MAX_TEST_SUITES = 500;
const MAX_JOB_NAME_CHARS = 256;
const MAX_STAGE_CHARS = 128;
const MAX_STATUS_CHARS = 64;
const MAX_REF_CHARS = 1_024;
const MAX_SHA_CHARS = 128;
const MAX_PROJECT_CHARS = 1_024;
const MAX_URL_CHARS = 8_192;
const MAX_FETCHED_AT_CHARS = 128;
const MAX_TEST_COUNT = 1_000_000_000;
const PIPELINE_FAILURE_STATUSES = new Set(['failed', 'failure', 'error']);
const PIPELINE_CANCELED_STATUSES = new Set(['canceled', 'cancelled']);
const PIPELINE_SUCCESS_STATUSES = new Set(['success', 'succeeded', 'passed']);

export function normalizeGitLabPipelineDigest(
  snapshot: GitLabMergeRequestContextSnapshot | GitLabMergeRequestMonitorSnapshot,
): GitLabPipelineDigest | null;
export function normalizeGitLabPipelineDigest(snapshot: unknown): GitLabPipelineDigest | null;
export function normalizeGitLabPipelineDigest(snapshot: unknown): GitLabPipelineDigest | null {
  const root = isRecord(snapshot) ? snapshot : {};
  const pipeline = selectedPipeline(root);
  if (!pipeline) { return null; }

  const tests = testDigestFromSnapshot(root);
  const completeness = isRecord(root['completeness']) ? root['completeness'] : {};
  return buildPipelineDigest(
    pipeline,
    root['jobs'],
    tests,
    boundedString(root['fetchedAt'], MAX_FETCHED_AT_CHARS),
    completeness['jobsComplete'] !== false,
    completeness['testsComplete'] !== false,
  );
}

export function normalizeStoredGitLabPipelineDigest(value: unknown): GitLabPipelineDigest | null {
  return normalizeExistingDigest(value);
}

export function mergeGitLabPipelineDigest(
  previousValue: unknown,
  currentValue: unknown,
): GitLabPipelineDigest | null {
  const previous = normalizeExistingDigest(previousValue);
  const current = normalizeExistingDigest(currentValue);
  if (!current) { return null; }
  if (!previous || !samePipelineIdentity(previous, current)) { return current; }
  const effective: GitLabPipelineDigest = {
    ...current,
    jobsComplete: current.jobsComplete || previous.jobsComplete,
    failedJobs: current.jobsComplete ? current.failedJobs : previous.failedJobs,
    failedJobsTruncated: current.jobsComplete ? current.failedJobsTruncated : previous.failedJobsTruncated,
    testsComplete: current.testsComplete || previous.testsComplete,
    tests: current.testsComplete ? current.tests : previous.tests,
  };
  return normalizeExistingDigest(effective);
}

export function compareGitLabPipelineDigests(previous: unknown, current: unknown): GitLabPipelineTransition[] {
  const previousDigest = normalizeExistingDigest(previous);
  const currentDigest = normalizeExistingDigest(current);
  if (!previousDigest || !currentDigest || previousDigest.fingerprint === currentDigest.fingerprint) {
    return [];
  }

  const transitions: GitLabPipelineTransition[] = [];
  const samePipeline = samePipelineIdentity(previousDigest, currentDigest);
  if (!samePipeline) {
    transitions.push(makeTransition('new_pipeline', previousDigest, currentDigest, []));
  }

  appendPipelineStatusTransition(transitions, previousDigest, currentDigest);
  appendBlockingJobTransitions(transitions, previousDigest, currentDigest, samePipeline);
  appendTestTransitions(transitions, previousDigest, currentDigest);
  return transitions;
}

function selectedPipeline(root: Record<string, unknown>): Record<string, unknown> | undefined {
  const mergeRequest = isRecord(root['mr']) ? root['mr'] : {};
  const headPipeline = isRecord(mergeRequest['head_pipeline']) ? mergeRequest['head_pipeline'] : undefined;
  const directPipeline = isRecord(root['pipeline']) ? root['pipeline'] : undefined;
  const pipelines = arrayFromUnknown(root['pipelines']).slice(0, MAX_SOURCE_PIPELINES)
    .filter(isRecord)
    .filter(pipeline => positiveInteger(pipeline['id']) !== undefined);

  if (directPipeline && positiveInteger(directPipeline['id']) !== undefined) {
    const id = positiveInteger(directPipeline['id']);
    const listMatch = pipelines.find(pipeline => positiveInteger(pipeline['id']) === id);
    const headMatch = headPipeline && positiveInteger(headPipeline['id']) === id ? headPipeline : undefined;
    return { ...(listMatch || {}), ...(headMatch || {}), ...directPipeline };
  }
  if (headPipeline && positiveInteger(headPipeline['id']) !== undefined) {
    const id = positiveInteger(headPipeline['id']);
    const listMatch = pipelines.find(pipeline => positiveInteger(pipeline['id']) === id);
    return { ...(listMatch || {}), ...headPipeline };
  }

  const mrSha = boundedString(mergeRequest['sha'], MAX_SHA_CHARS);
  const matchingSha = mrSha
    ? pipelines.filter(pipeline => boundedString(pipeline['sha'], MAX_SHA_CHARS) === mrSha)
    : [];
  const candidates = matchingSha.length > 0 ? matchingSha : pipelines;
  return [...candidates].sort((left, right) => {
    return (positiveInteger(right['id']) || 0) - (positiveInteger(left['id']) || 0);
  })[0];
}

function buildPipelineDigest(
  pipeline: Record<string, unknown>,
  jobsValue: unknown,
  tests: GitLabPipelineTestDigest,
  fetchedAt: string,
  jobsComplete = true,
  testsComplete = true,
  failedJobsTruncatedOverride = false,
): GitLabPipelineDigest | null {
  const id = positiveInteger(pipeline['id']);
  if (id === undefined) { return null; }
  const failedJobResult = failedJobDigests(jobsValue);
  const material: PipelineDigestMaterial = {
    schemaVersion: 1,
    id,
    status: normalizedStatus(firstDefined(pipeline['status'], pipeline['detailed_status'])),
    failedJobs: failedJobResult.jobs,
    failedJobsTruncated: failedJobResult.truncated || failedJobsTruncatedOverride,
    jobsComplete,
    tests,
    testsComplete,
  };
  assignString(material, 'projectIdOrPath', pipelineProjectIdOrPath(pipeline));
  assignString(material, 'url', safeProviderUrl(firstString(pipeline['web_url'], pipeline['url'])));
  assignString(material, 'ref', boundedString(pipeline['ref'], MAX_REF_CHARS));
  assignString(material, 'sha', boundedString(pipeline['sha'], MAX_SHA_CHARS));
  return {
    ...material,
    fetchedAt,
    fingerprint: stableFingerprint(material),
  };
}

function normalizeExistingDigest(value: unknown): GitLabPipelineDigest | null {
  if (!isRecord(value)) { return null; }
  const tests = normalizeTestDigest(value['tests']);
  return buildPipelineDigest(
    value,
    value['failedJobs'],
    tests,
    boundedString(value['fetchedAt'], MAX_FETCHED_AT_CHARS),
    booleanValue(value['jobsComplete']) !== false,
    booleanValue(value['testsComplete']) !== false,
    booleanValue(value['failedJobsTruncated']) === true,
  );
}

function failedJobDigests(value: unknown): { jobs: GitLabFailedJobDigest[]; truncated: boolean } {
  const source = arrayFromUnknown(value);
  const candidates = source.slice(0, MAX_SOURCE_JOBS)
    .map(normalizeJobCandidate)
    .filter((job): job is NormalizedJobCandidate => Boolean(job));
  const latestByNameAndStage = new Map<string, NormalizedJobCandidate>();
  for (const candidate of candidates) {
    if (candidate.retried) { continue; }
    const identity = `${candidate.stage || ''}\u0000${candidate.name}`;
    const existing = latestByNameAndStage.get(identity);
    if (!existing || candidate.id > existing.id) {
      latestByNameAndStage.set(identity, candidate);
    }
  }
  const allFailed = [...latestByNameAndStage.values()]
    .filter(job => !job.allowFailure && PIPELINE_FAILURE_STATUSES.has(job.status))
    .sort((left, right) => left.id - right.id || left.name.localeCompare(right.name));
  const jobs = allFailed.slice(0, MAX_FAILED_JOBS).map(job => {
    const digest: GitLabFailedJobDigest = {
      id: job.id,
      name: job.name,
      status: job.status,
    };
    assignString(digest, 'stage', job.stage);
    assignString(digest, 'url', job.url);
    return digest;
  });
  return {
    jobs,
    truncated: source.length > MAX_SOURCE_JOBS || allFailed.length > MAX_FAILED_JOBS,
  };
}

function normalizeJobCandidate(value: unknown): NormalizedJobCandidate | undefined {
  if (!isRecord(value)) { return undefined; }
  const id = positiveInteger(value['id']);
  const name = boundedString(value['name'], MAX_JOB_NAME_CHARS);
  if (id === undefined || !name) { return undefined; }
  const candidate: NormalizedJobCandidate = {
    id,
    name,
    status: normalizedStatus(value['status']),
    allowFailure: booleanValue(firstDefined(value['allow_failure'], value['allowFailure'])) === true,
    retried: booleanValue(value['retried']) === true,
  };
  assignString(candidate, 'stage', boundedString(value['stage'], MAX_STAGE_CHARS));
  assignString(candidate, 'url', safeProviderUrl(firstString(value['web_url'], value['url'])));
  return candidate;
}

function testDigestFromSnapshot(root: Record<string, unknown>): GitLabPipelineTestDigest {
  const summary = normalizeTestDigest(root['testReportSummary']);
  if (summary.available) { return summary; }
  return normalizeTestDigest(root['testReport']);
}

function normalizeTestDigest(value: unknown): GitLabPipelineTestDigest {
  if (!isRecord(value)) { return emptyTestDigest(); }
  if (booleanValue(value['available']) === false) { return emptyTestDigest(); }
  const totalRecord = isRecord(value['total']) ? value['total'] : value;
  let total = testCount(firstDefined(
    totalRecord['count'],
    totalRecord['total'],
    totalRecord['total_count'],
    totalRecord['totalCount'],
  ));
  let failed = testCount(firstDefined(totalRecord['failed'], totalRecord['failed_count'], totalRecord['failedCount']));
  let error = testCount(firstDefined(totalRecord['error'], totalRecord['error_count'], totalRecord['errorCount']));
  let skipped = testCount(firstDefined(totalRecord['skipped'], totalRecord['skipped_count'], totalRecord['skippedCount']));
  let success = testCount(firstDefined(totalRecord['success'], totalRecord['success_count'], totalRecord['successCount']));
  const hasDirectCounts = [total, failed, error, skipped, success].some(count => count !== undefined);

  if (!hasDirectCounts) {
    const suites = arrayFromUnknown(firstDefined(value['test_suites'], value['suites'])).slice(0, MAX_TEST_SUITES);
    if (suites.length === 0) { return emptyTestDigest(); }
    total = sumSuiteCounts(suites, ['total_count', 'totalCount', 'count']);
    failed = sumSuiteCounts(suites, ['failed_count', 'failedCount', 'failed']);
    error = sumSuiteCounts(suites, ['error_count', 'errorCount', 'error']);
    skipped = sumSuiteCounts(suites, ['skipped_count', 'skippedCount', 'skipped']);
    success = sumSuiteCounts(suites, ['success_count', 'successCount', 'success']);
  }

  const normalizedFailed = failed || 0;
  const normalizedError = error || 0;
  const normalizedSkipped = skipped || 0;
  const derivedTotal = boundedTestCount((success || 0) + normalizedFailed + normalizedError + normalizedSkipped);
  return {
    available: true,
    total: Math.max(total || 0, derivedTotal),
    failed: normalizedFailed,
    error: normalizedError,
    skipped: normalizedSkipped,
  };
}

function sumSuiteCounts(suites: unknown[], keys: string[]): number {
  let total = 0;
  for (const suite of suites) {
    if (!isRecord(suite)) { continue; }
    const count = testCount(firstDefined(...keys.map(key => suite[key]))) || 0;
    total = boundedTestCount(total + count);
  }
  return total;
}

function emptyTestDigest(): GitLabPipelineTestDigest {
  return { available: false, total: 0, failed: 0, error: 0, skipped: 0 };
}

function appendPipelineStatusTransition(
  transitions: GitLabPipelineTransition[],
  previous: GitLabPipelineDigest,
  current: GitLabPipelineDigest,
): void {
  const previousFailed = pipelineFailed(previous.status) || pipelineCanceled(previous.status);
  const currentFailed = pipelineFailed(current.status);
  const currentCanceled = pipelineCanceled(current.status);
  if (currentFailed && (!pipelineFailed(previous.status) || previous.status !== current.status || previous.id !== current.id)) {
    transitions.push(makeTransition('pipeline_failed', previous, current, current.failedJobs));
    return;
  }
  if (currentCanceled && (!pipelineCanceled(previous.status) || previous.status !== current.status || previous.id !== current.id)) {
    transitions.push(makeTransition('pipeline_canceled', previous, current, current.failedJobs));
    return;
  }
  if (pipelineSucceeded(current.status) && !pipelineSucceeded(previous.status)) {
    transitions.push(makeTransition(previousFailed ? 'pipeline_recovered' : 'pipeline_succeeded', previous, current, []));
  }
}

function appendBlockingJobTransitions(
  transitions: GitLabPipelineTransition[],
  previous: GitLabPipelineDigest,
  current: GitLabPipelineDigest,
  samePipeline: boolean,
): void {
  if (!current.jobsComplete) { return; }
  const previousJobs = samePipeline ? new Map(previous.failedJobs.map(job => [job.id, job])) : new Map<number, GitLabFailedJobDigest>();
  const currentJobs = new Map(current.failedJobs.map(job => [job.id, job]));
  const newlyFailed = current.failedJobs.filter(job => !previousJobs.has(job.id));
  const recovered = samePipeline ? previous.failedJobs.filter(job => !currentJobs.has(job.id)) : [];
  if (newlyFailed.length > 0) {
    transitions.push(makeTransition('blocking_jobs_failed', previous, current, newlyFailed));
  }
  if (recovered.length > 0) {
    transitions.push(makeTransition('blocking_jobs_recovered', previous, current, recovered));
  }
}

function appendTestTransitions(
  transitions: GitLabPipelineTransition[],
  previous: GitLabPipelineDigest,
  current: GitLabPipelineDigest,
): void {
  if (!current.testsComplete || !current.tests.available) { return; }
  const previousFailures = previous.tests.failed + previous.tests.error;
  const currentFailures = current.tests.failed + current.tests.error;
  if (currentFailures > 0 && (!previous.tests.available || previousFailures === 0)) {
    transitions.push(makeTransition('tests_failed', previous, current, []));
  } else if (previous.tests.available && previousFailures > 0 && currentFailures === 0) {
    transitions.push(makeTransition('tests_recovered', previous, current, []));
  }
}

function makeTransition(
  kind: GitLabPipelineTransitionKind,
  previous: GitLabPipelineDigest,
  current: GitLabPipelineDigest,
  jobs: GitLabFailedJobDigest[],
): GitLabPipelineTransition {
  return {
    kind,
    key: stableFingerprint({
      kind,
      previousPipeline: pipelineIdentity(previous),
      currentPipeline: pipelineIdentity(current),
      previousFingerprint: previous.fingerprint,
      currentFingerprint: current.fingerprint,
      jobIds: jobs.map(job => job.id),
    }),
    pipelineId: current.id,
    previousPipelineId: previous.id,
    previousStatus: previous.status,
    currentStatus: current.status,
    previousFingerprint: previous.fingerprint,
    currentFingerprint: current.fingerprint,
    jobs: jobs.map(job => ({ ...job })),
    tests: { ...current.tests },
  };
}

function pipelineIdentity(digest: GitLabPipelineDigest): string {
  return `${digest.projectIdOrPath || ''}:${digest.id}`;
}

function samePipelineIdentity(previous: GitLabPipelineDigest, current: GitLabPipelineDigest): boolean {
  if (previous.id !== current.id) { return false; }
  if (!previous.projectIdOrPath || !current.projectIdOrPath) { return true; }
  return previous.projectIdOrPath === current.projectIdOrPath;
}

function pipelineProjectIdOrPath(pipeline: Record<string, unknown>): string {
  const numericId = positiveInteger(firstDefined(pipeline['project_id'], pipeline['projectId']));
  if (numericId !== undefined) { return String(numericId); }
  const project = isRecord(pipeline['project']) ? pipeline['project'] : {};
  const nestedId = positiveInteger(project['id']);
  return boundedString(firstDefined(
    pipeline['project_id_or_path'],
    pipeline['projectIdOrPath'],
    pipeline['project_path'],
    project['path_with_namespace'],
    project['path'],
    nestedId,
  ), MAX_PROJECT_CHARS);
}

function pipelineFailed(status: string): boolean {
  return PIPELINE_FAILURE_STATUSES.has(status);
}

function pipelineCanceled(status: string): boolean {
  return PIPELINE_CANCELED_STATUSES.has(status);
}

function pipelineSucceeded(status: string): boolean {
  return PIPELINE_SUCCESS_STATUSES.has(status);
}

function normalizedStatus(value: unknown): string {
  const statusRecord = isRecord(value) ? value : undefined;
  const raw = boundedString(firstDefined(
    statusRecord?.['group'],
    statusRecord?.['text'],
    statusRecord?.['label'],
    value,
  ), MAX_STATUS_CHARS).toLowerCase().replace(/[\s-]+/g, '_');
  return /^[a-z][a-z0-9_]*$/.test(raw) ? raw : 'unknown';
}

function safeProviderUrl(value: string): string {
  if (!value || value.length > MAX_URL_CHARS) { return ''; }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return ''; }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString().slice(0, MAX_URL_CHARS);
  } catch {
    return '';
  }
}

function testCount(value: unknown): number | undefined {
  const numeric = optionalFiniteNumberFromUnknown(value);
  if (numeric === undefined || numeric < 0) { return undefined; }
  return boundedTestCount(Math.floor(numeric));
}

function boundedTestCount(value: number): number {
  return Math.min(MAX_TEST_COUNT, Math.max(0, Math.floor(value)));
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = optionalFiniteNumberFromUnknown(value);
  if (numeric === undefined || !Number.isSafeInteger(numeric) || numeric <= 0) { return undefined; }
  return numeric;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') { return value; }
  const normalized = optionalTrimmedStringFromUnknown(value)?.toLowerCase();
  if (normalized === 'true') { return true; }
  if (normalized === 'false') { return false; }
  return undefined;
}

function boundedString(value: unknown, maxLength: number): string {
  const text = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : optionalTrimmedStringFromUnknown(value) || '';
  return redactSensitiveTokens(text)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = optionalTrimmedStringFromUnknown(value);
    if (text) { return text; }
  }
  return '';
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function assignString<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  const text = optionalTrimmedStringFromUnknown(value);
  if (text) {
    target[key] = text as T[K];
  }
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
