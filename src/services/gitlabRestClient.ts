import * as http from 'http';
import * as https from 'https';
import { unknownErrorCode, unknownErrorMessage } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export interface GitLabMergeRequestTarget {
  projectIdOrPath: string;
  iid: number;
}

export interface GitLabRestRequestOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  maxPages?: number;
}

export interface GitLabHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface GitLabHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type GitLabHttpTransport = (request: GitLabHttpRequest) => Promise<GitLabHttpResponse>;

export interface GitLabRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: GitLabHttpTransport;
  maxResponseBytes?: number;
  maxTotalBytes?: number;
  maxPages?: number;
}

export interface GitLabMergeRequestContextOptions extends GitLabRestRequestOptions {
  includeDiffs?: boolean;
  includeTestReport?: boolean;
}

export interface GitLabMergeRequestMonitorOptions extends GitLabRestRequestOptions {
  includeReview?: boolean;
}

export interface GitLabMergeRequestDiscoveryInput {
  projectIdOrPath: string;
  ticketKey?: string;
  sourceBranch?: string;
}

export interface GitLabDiscoveredMergeRequest {
  iid: number;
  title: string;
  sourceBranch: string;
  targetBranch?: string;
  webUrl?: string;
  updatedAt?: string;
}

export interface GitLabMergeRequestDiscoveryResult {
  match?: GitLabDiscoveredMergeRequest;
  strategy?: 'source-branch' | 'ticket-key' | 'project-open';
  candidateCount: number;
  ambiguous: boolean;
}

export interface GitLabMergeRequestContextSnapshot {
  mr: unknown;
  notes: unknown[];
  discussions: unknown[];
  approvals?: unknown;
  diffs: unknown[];
  pipelines: unknown[];
  pipeline?: unknown;
  jobs: unknown[];
  testReportSummary?: unknown;
  testReport?: unknown;
  fetchedAt: string;
  responseBytes: number;
  completeness: {
    notesComplete: boolean;
    discussionsComplete: boolean;
    diffsComplete: boolean;
    pipelinesComplete: boolean;
    jobsComplete: boolean;
    testsComplete: boolean;
    warnings: string[];
  };
}

export interface GitLabMergeRequestMonitorSnapshot {
  mr: unknown;
  notes: unknown[];
  discussions: unknown[];
  approvals?: unknown;
  pipelines: unknown[];
  pipeline?: unknown;
  jobs: unknown[];
  testReportSummary?: unknown;
  fetchedAt: string;
  responseBytes: number;
  completeness: {
    notesComplete: boolean;
    discussionsComplete: boolean;
    approvalsComplete: boolean;
    pipelinesComplete: boolean;
    jobsComplete: boolean;
    testsComplete: boolean;
    warnings: string[];
  };
}

interface GitLabRestConfig {
  apiBaseUrl: string;
  token: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_PAGES = 20;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 30 * 1024 * 1024;

export class GitLabRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: GitLabHttpTransport;
  private readonly maxResponseBytes: number;
  private readonly maxTotalBytes: number;
  private readonly maxPages: number;

  constructor(options: GitLabRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultGitLabTransport;
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1024, 25 * 1024 * 1024);
    this.maxTotalBytes = boundedInteger(options.maxTotalBytes, DEFAULT_MAX_TOTAL_BYTES, 1024, 250 * 1024 * 1024);
    this.maxPages = boundedInteger(options.maxPages, MAX_PAGES, 1, 100);
  }

  async projectId(gitlabPath: string, options: GitLabRestRequestOptions = {}): Promise<number | null> {
    const projectPath = gitlabPath.trim();
    if (!projectPath) { return null; }
    const data = await this.requestJson(`/projects/${encodeURIComponent(projectPath)}`, 'GitLab project lookup', {}, options);
    const record = isRecord(data.value) ? data.value : {};
    const id = optionalFiniteNumberFromUnknown(record['id']);
    return id !== undefined ? id : null;
  }

  async mergeRequest(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const data = await this.requestJson(mergeRequestPath(target), `GitLab MR !${target.iid}`, {}, options);
    return data.value;
  }

  /**
   * Finds one open MR without mutating GitLab. A unique current-branch match
   * wins; a Jira key in title/description is the bounded ticket fallback. A
   * registered project without Jira may use its sole open MR. Kronos refuses
   * to guess whenever multiple candidates remain.
   */
  async discoverOpenMergeRequest(
    input: GitLabMergeRequestDiscoveryInput,
    options: GitLabRestRequestOptions = {},
  ): Promise<GitLabMergeRequestDiscoveryResult> {
    const projectIdOrPath = input.projectIdOrPath.trim();
    const ticketKey = normalizeDiscoveryTicketKey(input.ticketKey);
    const sourceBranch = optionalTrimmedStringFromUnknown(input.sourceBranch);
    if (!projectIdOrPath) { throw new GitLabRestError('GitLab MR discovery needs a project ID or path.'); }
    if (sourceBranch) {
      const branchCandidates = normalizeDiscoveryCandidates((await this.requestJson(
        `/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
        `GitLab open MRs for branch ${sourceBranch}`,
        { state: 'opened', source_branch: sourceBranch, order_by: 'updated_at', sort: 'desc', page: 1, per_page: 20 },
        options,
      )).value);
      const branchMatch = uniqueDiscoveryMatch(branchCandidates, ticketKey);
      if (branchMatch.match || branchMatch.ambiguous) {
        return { ...branchMatch, strategy: 'source-branch' };
      }
    }

    if (ticketKey) {
      const ticketCandidates = normalizeDiscoveryCandidates((await this.requestJson(
        `/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
        `GitLab open MRs for ${ticketKey}`,
        { state: 'opened', search: ticketKey, in: 'title,description', order_by: 'updated_at', sort: 'desc', page: 1, per_page: 20 },
        options,
      )).value).filter(candidate => candidate.searchText.includes(ticketKey));
      return { ...uniqueDiscoveryMatch(ticketCandidates, ticketKey), strategy: 'ticket-key' };
    }

    const projectCandidates = normalizeDiscoveryCandidates((await this.requestJson(
      `/projects/${encodeURIComponent(projectIdOrPath)}/merge_requests`,
      'GitLab open MRs for registered project',
      { state: 'opened', order_by: 'updated_at', sort: 'desc', page: 1, per_page: 20 },
      options,
    )).value);
    return { ...uniqueDiscoveryMatch(projectCandidates, undefined), strategy: 'project-open' };
  }

  async mergeRequestStatus(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const [mr, comments, discussions, approvals] = await Promise.all([
      this.mergeRequest(target, options),
      this.paginatedArray(`${mergeRequestPath(target)}/notes`, `GitLab MR !${target.iid} notes`, {
        sort: 'asc',
        order_by: 'created_at',
      }, options),
      this.paginatedArray(`${mergeRequestPath(target)}/discussions`, `GitLab MR !${target.iid} discussions`, {}, options),
      this.optionalJson(`${mergeRequestPath(target)}/approvals`, `GitLab MR !${target.iid} approvals`, {}, options),
    ]);
    const status: Record<string, unknown> = { mr, comments, discussions };
    if (approvals !== undefined) { status['approvals'] = approvals; }
    return status;
  }

  async mergeRequestDiff(target: GitLabMergeRequestTarget, options: GitLabRestRequestOptions = {}): Promise<unknown> {
    const mr = await this.mergeRequest(target, options);
    const diffs = await this.paginatedArray(`${mergeRequestPath(target)}/diffs`, `GitLab MR !${target.iid} diffs`, {}, options)
      .catch(async (e: unknown) => {
        if (!isGitLabNotFoundError(e)) { throw e; }
        const changes = await this.requestJson(`${mergeRequestPath(target)}/changes`, `GitLab MR !${target.iid} changes`, {}, options);
        const record = isRecord(changes.value) ? changes.value : {};
        return arrayFromUnknown(record['changes']);
      });
    return { mr, files: diffs };
  }

  async mergeRequestMonitor(
    target: GitLabMergeRequestTarget,
    options: GitLabMergeRequestMonitorOptions = {},
  ): Promise<GitLabMergeRequestMonitorSnapshot> {
    const budget = new GitLabResponseBudget(
      boundedInteger(options.maxTotalBytes, this.maxTotalBytes, 1024, 250 * 1024 * 1024),
    );
    const warnings: string[] = [];
    const request = async (
      path: string,
      label: string,
      query: Record<string, string | number> = {},
    ) => {
      budget.assertAvailable(label);
      const response = await this.requestJson(path, label, query, options);
      budget.consume(response.bodyBytes, label);
      return response;
    };
    const collect = (
      path: string,
      label: string,
      query: Record<string, string | number> = {},
    ) => this.collectPaginatedArray(path, label, query, options, request);
    const optional = async (path: string, label: string): Promise<unknown | undefined> => {
      try {
        return (await request(path, label)).value;
      } catch (error: unknown) {
        warnings.push(`${safeGitLabPartialWarning(label, error)} The GitLab monitor snapshot is partial.`);
        return undefined;
      }
    };

    const mr = (await request(mergeRequestPath(target), `GitLab MR !${target.iid}`)).value;
    const pipelinesResult = await collect(
      `${mergeRequestPath(target)}/pipelines`,
      `GitLab MR !${target.iid} pipelines`,
    );
    warnings.push(...pipelinesResult.warnings);
    const pipelineRef = selectGitLabPipeline(mr, pipelinesResult.values, target.projectIdOrPath);
    let pipeline: unknown;
    let jobs: unknown[] = [];
    let jobsComplete = true;
    let testsComplete = true;
    let testReportSummary: unknown;
    if (pipelineRef) {
      const pipelineBase = `/projects/${encodeURIComponent(pipelineRef.projectIdOrPath)}/pipelines/${encodeURIComponent(String(pipelineRef.pipelineId))}`;
      pipeline = await optional(pipelineBase, `GitLab pipeline ${pipelineRef.pipelineId}`);
      const jobsResult = await collect(
        `${pipelineBase}/jobs`,
        `GitLab pipeline ${pipelineRef.pipelineId} jobs`,
        { include_retried: 'true' },
      );
      jobs = jobsResult.values;
      jobsComplete = jobsResult.complete;
      warnings.push(...jobsResult.warnings);
      testReportSummary = await optional(
        `${pipelineBase}/test_report_summary`,
        `GitLab pipeline ${pipelineRef.pipelineId} test summary`,
      );
      if (testReportSummary === undefined) { testsComplete = false; }
    }

    let notes: unknown[] = [];
    let discussions: unknown[] = [];
    let notesComplete = false;
    let discussionsComplete = false;
    let approvals: unknown;
    if (options.includeReview === true) {
      // Lifecycle reads happen after pipeline reads so bounded review history
      // can never consume the budget needed by pipeline monitoring.
      const notesResult = await collect(
        `${mergeRequestPath(target)}/notes`,
        `GitLab MR !${target.iid} notes`,
        { sort: 'asc', order_by: 'updated_at' },
      );
      const discussionsResult = await collect(
        `${mergeRequestPath(target)}/discussions`,
        `GitLab MR !${target.iid} discussions`,
      );
      warnings.push(...notesResult.warnings, ...discussionsResult.warnings);
      notes = notesResult.values;
      discussions = discussionsResult.values;
      notesComplete = notesResult.complete;
      discussionsComplete = discussionsResult.complete;
      approvals = await optional(
        `${mergeRequestPath(target)}/approvals`,
        `GitLab MR !${target.iid} approvals`,
      );
    }

    const snapshot: GitLabMergeRequestMonitorSnapshot = {
      mr,
      notes,
      discussions,
      pipelines: pipelinesResult.values,
      jobs,
      fetchedAt: new Date().toISOString(),
      responseBytes: budget.usedBytes,
      completeness: {
        notesComplete,
        discussionsComplete,
        approvalsComplete: approvals !== undefined,
        pipelinesComplete: pipelinesResult.complete,
        jobsComplete,
        testsComplete,
        warnings: uniqueStrings(warnings),
      },
    };
    if (approvals !== undefined) { snapshot.approvals = approvals; }
    if (pipeline !== undefined) { snapshot.pipeline = pipeline; }
    if (testReportSummary !== undefined) { snapshot.testReportSummary = testReportSummary; }
    return snapshot;
  }

  async mergeRequestContext(
    target: GitLabMergeRequestTarget,
    options: GitLabMergeRequestContextOptions = {},
  ): Promise<GitLabMergeRequestContextSnapshot> {
    const budget = new GitLabResponseBudget(
      boundedInteger(options.maxTotalBytes, this.maxTotalBytes, 1024, 250 * 1024 * 1024),
    );
    const warnings: string[] = [];
    const request = async (
      path: string,
      label: string,
      query: Record<string, string | number> = {},
    ) => {
      budget.assertAvailable(label);
      const response = await this.requestJson(path, label, query, options);
      budget.consume(response.bodyBytes, label);
      return response;
    };
    const collect = (
      path: string,
      label: string,
      query: Record<string, string | number> = {},
    ) => this.collectPaginatedArray(path, label, query, options, request);
    const optional = async (
      path: string,
      label: string,
      query: Record<string, string | number> = {},
    ): Promise<unknown | undefined> => {
      try {
        return (await request(path, label, query)).value;
      } catch (error: unknown) {
        warnings.push(`${safeGitLabPartialWarning(label, error)} The GitLab context is partial.`);
        return undefined;
      }
    };

    const mr = (await request(mergeRequestPath(target), `GitLab MR !${target.iid}`)).value;
    const notesResult = await collect(`${mergeRequestPath(target)}/notes`, `GitLab MR !${target.iid} notes`, {
      sort: 'asc',
      order_by: 'created_at',
    });
    const discussionsResult = await collect(`${mergeRequestPath(target)}/discussions`, `GitLab MR !${target.iid} discussions`);
    warnings.push(...notesResult.warnings, ...discussionsResult.warnings);
    const approvals = await optional(`${mergeRequestPath(target)}/approvals`, `GitLab MR !${target.iid} approvals`);

    let diffs: unknown[] = [];
    let diffsComplete = options.includeDiffs === false;
    if (options.includeDiffs !== false) {
      const diffResult = await collect(`${mergeRequestPath(target)}/diffs`, `GitLab MR !${target.iid} diffs`);
      diffs = diffResult.values;
      diffsComplete = diffResult.complete;
      warnings.push(...diffResult.warnings);
    }

    const pipelinesResult = await collect(`${mergeRequestPath(target)}/pipelines`, `GitLab MR !${target.iid} pipelines`);
    warnings.push(...pipelinesResult.warnings);
    const pipelineRef = selectGitLabPipeline(mr, pipelinesResult.values, target.projectIdOrPath);
    let pipeline: unknown;
    let jobs: unknown[] = [];
    let jobsComplete = true;
    let testsComplete = true;
    let testReportSummary: unknown;
    let testReport: unknown;
    if (pipelineRef) {
      const pipelineBase = `/projects/${encodeURIComponent(pipelineRef.projectIdOrPath)}/pipelines/${encodeURIComponent(String(pipelineRef.pipelineId))}`;
      pipeline = await optional(pipelineBase, `GitLab pipeline ${pipelineRef.pipelineId}`);
      const jobsResult = await collect(`${pipelineBase}/jobs`, `GitLab pipeline ${pipelineRef.pipelineId} jobs`, { include_retried: 'true' });
      jobs = jobsResult.values;
      jobsComplete = jobsResult.complete;
      warnings.push(...jobsResult.warnings);
      testReportSummary = await optional(`${pipelineBase}/test_report_summary`, `GitLab pipeline ${pipelineRef.pipelineId} test summary`);
      if (testReportSummary === undefined) { testsComplete = false; }
      if (options.includeTestReport !== false) {
        testReport = await optional(`${pipelineBase}/test_report`, `GitLab pipeline ${pipelineRef.pipelineId} test report`);
        if (testReport === undefined) { testsComplete = false; }
      }
    }

    const snapshot: GitLabMergeRequestContextSnapshot = {
      mr,
      notes: notesResult.values,
      discussions: discussionsResult.values,
      diffs,
      pipelines: pipelinesResult.values,
      jobs,
      fetchedAt: new Date().toISOString(),
      responseBytes: budget.usedBytes,
      completeness: {
        notesComplete: notesResult.complete,
        discussionsComplete: discussionsResult.complete,
        diffsComplete,
        pipelinesComplete: pipelinesResult.complete,
        jobsComplete,
        testsComplete,
        warnings: uniqueStrings(warnings),
      },
    };
    if (approvals !== undefined) { snapshot.approvals = approvals; }
    if (pipeline !== undefined) { snapshot.pipeline = pipeline; }
    if (testReportSummary !== undefined) { snapshot.testReportSummary = testReportSummary; }
    if (testReport !== undefined) { snapshot.testReport = testReport; }
    return snapshot;
  }

  private async optionalJson(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<unknown | undefined> {
    try {
      return (await this.requestJson(path, label, query, options)).value;
    } catch (e: unknown) {
      if (isGitLabNotFoundError(e)) { return undefined; }
      throw e;
    }
  }

  private async paginatedArray(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let page = 1;
    for (;;) {
      const response = await this.requestJson(path, `${label} page ${page}`, { ...query, page, per_page: 100 }, options);
      results.push(...arrayFromUnknown(response.value));
      const nextPage = nextPageHeader(response.headers);
      if (!nextPage || page >= MAX_PAGES) { break; }
      page = nextPage;
    }
    return results;
  }

  private async collectPaginatedArray(
    path: string,
    label: string,
    query: Record<string, string | number>,
    options: GitLabRestRequestOptions,
    request: (
      path: string,
      label: string,
      query?: Record<string, string | number>,
    ) => Promise<{ value: unknown; headers: Record<string, string | string[] | undefined>; bodyBytes: number }>,
  ): Promise<{ values: unknown[]; complete: boolean; warnings: string[] }> {
    const values: unknown[] = [];
    const warnings: string[] = [];
    const maxPages = boundedInteger(options.maxPages, this.maxPages, 1, 100);
    let page = 1;
    let pagesFetched = 0;
    const visitedPages = new Set<number>();
    for (;;) {
      if (visitedPages.has(page)) {
        warnings.push(`${label} returned a repeated pagination cursor; fetched items were retained.`);
        return { values, complete: false, warnings };
      }
      visitedPages.add(page);
      let response: Awaited<ReturnType<typeof request>>;
      try {
        response = await request(path, `${label} page ${page}`, { ...query, page, per_page: 100 });
      } catch (error: unknown) {
        warnings.push(
          `${label} stopped at page ${page}; ${values.length} previously fetched item${values.length === 1 ? '' : 's'} were retained. `
          + safeGitLabPartialWarning(`${label} page ${page}`, error),
        );
        return { values, complete: false, warnings };
      }
      pagesFetched += 1;
      values.push(...arrayFromUnknown(response.value));
      const nextPage = nextPageHeader(response.headers);
      if (!nextPage) { return { values, complete: true, warnings }; }
      if (pagesFetched >= maxPages) {
        warnings.push(`${label} stopped at the ${maxPages}-page safety limit.`);
        return { values, complete: false, warnings };
      }
      page = nextPage;
    }
  }

  private async requestJson(
    path: string,
    label: string,
    query: Record<string, string | number> = {},
    options: GitLabRestRequestOptions = {},
  ): Promise<{ value: unknown; headers: Record<string, string | string[] | undefined>; bodyBytes: number }> {
    const config = resolveGitLabRestConfig(this.env);
    const url = buildGitLabUrl(config.apiBaseUrl, path, query);
    const response = await this.transport({
      method: 'GET',
      url,
      timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      maxResponseBytes: boundedInteger(options.maxResponseBytes, this.maxResponseBytes, 1024, 25 * 1024 * 1024),
      headers: {
        Accept: 'application/json',
        'PRIVATE-TOKEN': config.token,
        'User-Agent': 'kronos-gitlab-rest',
      },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new GitLabRestError(`GitLab REST ${label} failed with HTTP ${response.statusCode}. Provider response content is not displayed.`);
    }
    const bodyBytes = Buffer.byteLength(response.body, 'utf8');
    const maxResponseBytes = boundedInteger(options.maxResponseBytes, this.maxResponseBytes, 1024, 25 * 1024 * 1024);
    if (bodyBytes > maxResponseBytes) {
      throw new GitLabRestError(`GitLab REST ${label} exceeded the ${maxResponseBytes}-byte response safety limit.`);
    }
    return {
      value: parseJsonWithLabel(response.body, label),
      headers: response.headers,
      bodyBytes,
    };
  }
}

export function createGitLabRestClient(options: GitLabRestClientOptions = {}): GitLabRestClient {
  return new GitLabRestClient(options);
}

export const gitlabRestClient = createGitLabRestClient();

export function resolveGitLabRestConfig(env: NodeJS.ProcessEnv = process.env): GitLabRestConfig {
  const apiBaseUrl = normalizeGitLabApiBaseUrl(firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  ));
  const token = firstNonEmpty(env['GITLAB_TOKEN']);
  const missing: string[] = [];
  if (!apiBaseUrl) { missing.push('GITLAB_BASE_URL'); }
  if (!token) { missing.push('GITLAB_TOKEN'); }
  if (missing.length > 0) {
    throw new GitLabRestError(`GitLab REST configuration missing ${missing.join(', ')}. Values are not displayed.`);
  }
  if (!apiBaseUrl || !token) {
    throw new GitLabRestError('GitLab REST configuration is incomplete. Values are not displayed.');
  }
  return { apiBaseUrl, token };
}

export function normalizeGitLabApiBaseUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/, '')}/api/v4`;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function gitLabProjectPathFromMergeRequestUrl(value: string | undefined): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return undefined; }
    const marker = '/-/merge_requests/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex <= 1) { return undefined; }
    return decodeURIComponent(parsed.pathname.slice(1, markerIndex));
  } catch {
    return undefined;
  }
}

export function configuredGitLabProjectPathFromMergeRequestUrl(
  value: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const projectPath = gitLabProjectPathFromMergeRequestUrl(value);
  if (!projectPath) { return undefined; }
  let configuredOrigin: string;
  try {
    configuredOrigin = new URL(resolveGitLabRestConfig(env).apiBaseUrl).origin;
  } catch {
    return undefined;
  }
  try {
    const candidate = new URL(value || '');
    return candidate.origin === configuredOrigin ? projectPath : undefined;
  } catch {
    return undefined;
  }
}

export function isGitLabRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeGitLabApiBaseUrl(firstNonEmpty(
    env['GITLAB_API_BASE_URL'],
    env['GITLAB_BASE_URL'],
    env['GITLAB_URL'],
    env['GITLAB_HOST'],
  )) && firstNonEmpty(env['GITLAB_TOKEN']));
}

class GitLabRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, GitLabRestError.prototype);
    this.name = 'GitLabRestError';
  }
}

function safeGitLabPartialWarning(label: string, error: unknown): string {
  if (error instanceof GitLabRestError) { return error.message; }
  const code = unknownErrorCode(error);
  return `${label} could not be fetched${code ? ` (${code})` : ''}; response content is not displayed.`;
}

function mergeRequestPath(target: GitLabMergeRequestTarget): string {
  return `/projects/${encodeURIComponent(target.projectIdOrPath)}/merge_requests/${encodeURIComponent(String(target.iid))}`;
}

function buildGitLabUrl(apiBaseUrl: string, path: string, query: Record<string, string | number>): string {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/`;
  const url = new URL(path.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function nextPageHeader(headers: Record<string, string | string[] | undefined>): number | undefined {
  const raw = headers['x-next-page'] || headers['X-Next-Page'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = optionalFiniteNumberFromUnknown(value);
  return page !== undefined && page > 0 ? Math.floor(page) : undefined;
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

interface NormalizedDiscoveryCandidate extends GitLabDiscoveredMergeRequest {
  searchText: string;
}

function normalizeDiscoveryTicketKey(value: string | undefined): string | undefined {
  const ticketKey = value?.trim().toUpperCase();
  if (!ticketKey) { return undefined; }
  if (!/^[A-Z][A-Z0-9_]{0,127}-[1-9][0-9]*$/.test(ticketKey)) {
    throw new GitLabRestError('GitLab MR discovery needs a valid Jira ticket key.');
  }
  return ticketKey;
}

function normalizeDiscoveryCandidates(value: unknown): NormalizedDiscoveryCandidate[] {
  const candidates: NormalizedDiscoveryCandidate[] = [];
  const seen = new Set<number>();
  for (const item of arrayFromUnknown(value).slice(0, 20)) {
    const record = isRecord(item) ? item : {};
    const iidValue = optionalFiniteNumberFromUnknown(record['iid']);
    const iid = iidValue !== undefined ? Math.floor(iidValue) : 0;
    if (!Number.isSafeInteger(iid) || iid <= 0 || seen.has(iid)) { continue; }
    const title = optionalTrimmedStringFromUnknown(record['title']) || `Merge request !${iid}`;
    const sourceBranch = optionalTrimmedStringFromUnknown(record['source_branch']);
    if (!sourceBranch) { continue; }
    const description = optionalTrimmedStringFromUnknown(record['description']) || '';
    const targetBranch = optionalTrimmedStringFromUnknown(record['target_branch']);
    const webUrl = optionalTrimmedStringFromUnknown(record['web_url']);
    const updatedAt = optionalTrimmedStringFromUnknown(record['updated_at']);
    const candidate: NormalizedDiscoveryCandidate = {
      iid,
      title: title.slice(0, 500),
      sourceBranch: sourceBranch.slice(0, 500),
      searchText: `${title}\n${description}\n${sourceBranch}`.toUpperCase(),
    };
    if (targetBranch) { candidate.targetBranch = targetBranch.slice(0, 500); }
    if (webUrl && /^https?:\/\//i.test(webUrl)) { candidate.webUrl = webUrl; }
    if (updatedAt) { candidate.updatedAt = updatedAt.slice(0, 100); }
    seen.add(iid);
    candidates.push(candidate);
  }
  return candidates;
}

function uniqueDiscoveryMatch(
  candidates: NormalizedDiscoveryCandidate[],
  ticketKey: string | undefined,
): Omit<GitLabMergeRequestDiscoveryResult, 'strategy'> {
  const narrowed = candidates.length > 1 && ticketKey
    ? candidates.filter(candidate => candidate.searchText.includes(ticketKey))
    : candidates;
  const usable = narrowed.length > 0 ? narrowed : candidates;
  if (usable.length !== 1) {
    return { candidateCount: usable.length, ambiguous: usable.length > 1 };
  }
  const selected = usable[0];
  if (!selected) { return { candidateCount: 0, ambiguous: false }; }
  const match: GitLabDiscoveredMergeRequest = {
    iid: selected.iid,
    title: selected.title,
    sourceBranch: selected.sourceBranch,
  };
  if (selected.targetBranch) { match.targetBranch = selected.targetBranch; }
  if (selected.webUrl) { match.webUrl = selected.webUrl; }
  if (selected.updatedAt) { match.updatedAt = selected.updatedAt; }
  return { match, candidateCount: usable.length, ambiguous: false };
}

function isGitLabNotFoundError(error: unknown): boolean {
  return /\bHTTP 40[34]\b/.test(unknownErrorMessage(error, ''));
}

interface GitLabPipelineRef {
  projectIdOrPath: string;
  pipelineId: number;
}

function selectGitLabPipeline(
  mr: unknown,
  pipelines: unknown[],
  fallbackProjectIdOrPath: string,
): GitLabPipelineRef | undefined {
  const mrRecord = isRecord(mr) ? mr : {};
  const headPipeline = isRecord(mrRecord['head_pipeline']) ? mrRecord['head_pipeline'] : undefined;
  const headPipelineId = optionalFiniteNumberFromUnknown(headPipeline?.['id']);
  if (headPipelineId !== undefined && headPipelineId > 0) {
    const projectId = optionalFiniteNumberFromUnknown(headPipeline?.['project_id'])
      ?? optionalFiniteNumberFromUnknown(mrRecord['project_id']);
    return {
      projectIdOrPath: projectId !== undefined ? String(Math.floor(projectId)) : fallbackProjectIdOrPath,
      pipelineId: Math.floor(headPipelineId),
    };
  }

  const sha = optionalTrimmedStringFromUnknown(mrRecord['sha']);
  const pipelineRecords = pipelines.filter(isRecord);
  const selected = (sha
    ? pipelineRecords.find(candidate => optionalTrimmedStringFromUnknown(candidate['sha']) === sha)
    : undefined) || pipelineRecords[0];
  const pipelineId = optionalFiniteNumberFromUnknown(selected?.['id']);
  if (pipelineId === undefined || pipelineId <= 0) { return undefined; }
  const projectId = optionalFiniteNumberFromUnknown(selected?.['project_id'])
    ?? optionalFiniteNumberFromUnknown(mrRecord['project_id']);
  return {
    projectIdOrPath: projectId !== undefined ? String(Math.floor(projectId)) : fallbackProjectIdOrPath,
    pipelineId: Math.floor(pipelineId),
  };
}

class GitLabResponseBudget {
  public usedBytes = 0;

  constructor(private readonly limitBytes: number) {}

  assertAvailable(label: string): void {
    if (this.usedBytes >= this.limitBytes) {
      throw new GitLabRestError(`GitLab REST ${label} could not be fetched because the cumulative response safety limit was reached.`);
    }
  }

  consume(bodyBytes: number, label: string): void {
    this.usedBytes += Math.max(0, Math.floor(bodyBytes));
    if (this.usedBytes > this.limitBytes) {
      throw new GitLabRestError(`GitLab REST ${label} exceeded the cumulative ${this.limitBytes}-byte response safety limit.`);
    }
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function defaultGitLabTransport(request: GitLabHttpRequest): Promise<GitLabHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new GitLabRestError('Invalid GitLab REST URL.'));
      return;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      reject(new GitLabRestError('Invalid GitLab REST URL protocol.'));
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: request.method,
      timeout: request.timeoutMs,
      headers: request.headers,
    }, res => {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      res.on('data', chunk => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        receivedBytes += buffer.length;
        if (receivedBytes > request.maxResponseBytes) {
          res.destroy();
          req.destroy();
          reject(new GitLabRestError(`GitLab REST response exceeded the ${request.maxResponseBytes}-byte safety limit.`));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
      res.on('error', () => {
        reject(new GitLabRestError('GitLab REST response ended unexpectedly.'));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new GitLabRestError(`Timed out after ${request.timeoutMs}ms reaching GitLab REST API.`));
    });
    req.on('error', () => {
      reject(new GitLabRestError('GitLab REST network request failed.'));
    });
    req.end();
  });
}
