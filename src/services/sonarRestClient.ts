import * as http from 'http';
import * as https from 'https';
import { unknownErrorCode } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export interface SonarRestRequestOptions {
  timeoutMs?: number;
}

export interface SonarBranchContextRequestOptions extends SonarRestRequestOptions {
  metricKeys?: readonly string[];
}

export interface SonarHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface SonarHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type SonarHttpTransport = (request: SonarHttpRequest) => Promise<SonarHttpResponse>;

export interface SonarRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: SonarHttpTransport;
  maxResponseBytes?: number;
  maxIssuePages?: number;
  issuesPerPage?: number;
  maxIssues?: number;
}

export interface SonarRestConfig {
  baseUrl: string;
  token: string;
}

export interface SonarQualityGateCondition {
  status?: string;
  metricKey?: string;
  comparator?: string;
  errorThreshold?: string;
  actualValue?: string;
  periodIndex?: number;
}

export interface SonarQualityGateStatus {
  status: string;
  conditions: SonarQualityGateCondition[];
  ignoredConditions?: boolean;
  caycStatus?: string;
}

export interface SonarMeasure {
  metric: string;
  value?: string;
  periodValue?: string;
  bestValue?: boolean;
}

export interface SonarIssueImpact {
  softwareQuality?: string;
  severity?: string;
}

export interface SonarIssueTextRange {
  startLine?: number;
  endLine?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface SonarIssueContext {
  key?: string;
  rule?: string;
  severity?: string;
  component?: string;
  project?: string;
  line?: number;
  textRange?: SonarIssueTextRange;
  message: string;
  status?: string;
  resolution?: string;
  issueStatus?: string;
  type?: string;
  scope?: string;
  effort?: string;
  debt?: string;
  author?: string;
  cleanCodeAttribute?: string;
  cleanCodeAttributeCategory?: string;
  creationDate?: string;
  updateDate?: string;
  closeDate?: string;
  tags: string[];
  impacts: SonarIssueImpact[];
}

export interface SonarIssueCollection {
  issues: SonarIssueContext[];
  complete: boolean;
  fetched: number;
  pages: number;
  responseBytes: number;
  total?: number;
  warnings: string[];
}

export interface SonarBranchContextCompleteness {
  complete: boolean;
  qualityGateComplete: boolean;
  measuresComplete: boolean;
  issuesComplete: boolean;
  issuesFetched: number;
  issuePages: number;
  issueResponseBytes: number;
  issuesTotal?: number;
  warnings: string[];
}

export interface SonarBranchContext {
  schemaVersion: 1;
  provider: 'sonarqube';
  fetchedAt: string;
  projectKey: string;
  branch: string;
  dashboardUrl: string;
  qualityGate: SonarQualityGateStatus;
  measures: SonarMeasure[];
  issues: SonarIssueContext[];
  completeness: SonarBranchContextCompleteness;
}

interface SonarJsonResponse {
  value: unknown;
  bodyBytes: number;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ISSUE_PAGES = 20;
const DEFAULT_ISSUES_PER_PAGE = 100;
const DEFAULT_MAX_ISSUES = 2000;
const MAX_TOTAL_ISSUE_RESPONSE_BYTES = 50 * 1024 * 1024;
const MAX_PROVIDER_TEXT_LENGTH = 16000;

export const DEFAULT_SONAR_METRIC_KEYS = [
  'alert_status',
  'bugs',
  'vulnerabilities',
  'code_smells',
  'security_hotspots',
  'coverage',
  'new_coverage',
  'duplicated_lines_density',
  'new_duplicated_lines_density',
  'reliability_rating',
  'new_reliability_rating',
  'security_rating',
  'new_security_rating',
  'sqale_rating',
  'new_maintainability_rating',
  'ncloc',
  'tests',
  'test_success_density',
  'skipped_tests',
  'test_failures',
  'test_errors',
] as const;

export class SonarRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: SonarHttpTransport;
  private readonly maxResponseBytes: number;
  private readonly maxIssuePages: number;
  private readonly issuesPerPage: number;
  private readonly maxIssues: number;
  private readonly maxTotalIssueResponseBytes: number;

  constructor(options: SonarRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultSonarTransport;
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1024, 25 * 1024 * 1024);
    this.maxIssuePages = boundedInteger(options.maxIssuePages, DEFAULT_MAX_ISSUE_PAGES, 1, 100);
    this.issuesPerPage = boundedInteger(options.issuesPerPage, DEFAULT_ISSUES_PER_PAGE, 1, 500);
    this.maxIssues = boundedInteger(options.maxIssues, DEFAULT_MAX_ISSUES, 1, 10000);
    this.maxTotalIssueResponseBytes = Math.min(
      MAX_TOTAL_ISSUE_RESPONSE_BYTES,
      this.maxResponseBytes * this.maxIssuePages,
    );
  }

  async qualityGateStatus(
    projectKey: string,
    branch: string,
    options: SonarRestRequestOptions = {},
  ): Promise<SonarQualityGateStatus> {
    const target = normalizeSonarTarget(projectKey, branch);
    const response = await this.requestJson(
      '/api/qualitygates/project_status',
      `SonarQube quality gate for ${target.projectKey}`,
      { projectKey: target.projectKey, branch: target.branch },
      options,
    );
    return normalizeQualityGateResponse(response.value);
  }

  async measures(
    projectKey: string,
    branch: string,
    options: SonarBranchContextRequestOptions = {},
  ): Promise<SonarMeasure[]> {
    const target = normalizeSonarTarget(projectKey, branch);
    const metricKeys = normalizeMetricKeys(options.metricKeys || DEFAULT_SONAR_METRIC_KEYS);
    const response = await this.requestJson(
      '/api/measures/component',
      `SonarQube measures for ${target.projectKey}`,
      { component: target.projectKey, branch: target.branch, metricKeys: metricKeys.join(',') },
      options,
    );
    return normalizeSonarMeasureResponse(response.value);
  }

  async issues(
    projectKey: string,
    branch: string,
    options: SonarRestRequestOptions = {},
  ): Promise<SonarIssueCollection> {
    const target = normalizeSonarTarget(projectKey, branch);
    const issues: SonarIssueContext[] = [];
    const warnings: string[] = [];
    let total: number | undefined;
    let pages = 0;
    let responseBytes = 0;
    let complete = false;
    let providerRowsFetched = 0;
    let retainedAllProviderRows = true;

    while (pages < this.maxIssuePages && issues.length < this.maxIssues) {
      const pageNumber = pages + 1;
      const requestedPageSize = Math.min(this.issuesPerPage, this.maxIssues - issues.length);
      let response: SonarJsonResponse;
      try {
        response = await this.requestJson(
          '/api/issues/search',
          `SonarQube issues for ${target.projectKey} page ${pageNumber}`,
          {
            componentKeys: target.projectKey,
            branch: target.branch,
            resolved: false,
            p: pageNumber,
            ps: requestedPageSize,
            facets: 'severities,types,rules',
          },
          options,
        );
      } catch (error: unknown) {
        warnings.push(safeSonarCollectionWarning(pageNumber, error));
        break;
      }
      responseBytes += response.bodyBytes;
      if (responseBytes > this.maxTotalIssueResponseBytes) {
        warnings.push(`SonarQube issue collection stopped at the ${this.maxTotalIssueResponseBytes}-byte cumulative response safety limit.`);
        break;
      }
      if (!isRecord(response.value) || !Array.isArray(response.value['issues'])) {
        warnings.push(`SonarQube issue page ${pageNumber} returned an invalid pagination payload; previously fetched issues were retained.`);
        break;
      }
      const paging = isRecord(response.value['paging']) ? response.value['paging'] : {};
      const reportedPageIndex = nonNegativeInteger(paging['pageIndex']);
      const reportedPageSize = nonNegativeInteger(paging['pageSize']);
      if (reportedPageIndex !== undefined && reportedPageIndex !== pageNumber) {
        warnings.push(`SonarQube issue pagination stopped at page ${pageNumber} because the provider returned page index ${reportedPageIndex}.`);
        break;
      }
      if (reportedPageSize !== undefined && reportedPageSize !== requestedPageSize) {
        warnings.push(`SonarQube issue pagination stopped at page ${pageNumber} because the provider page size did not match the requested ${requestedPageSize}-issue bound.`);
        break;
      }
      const rawIssues = arrayFromUnknown(response.value['issues']);
      if (rawIssues.length > requestedPageSize) {
        warnings.push(`SonarQube issue page ${pageNumber} exceeded the requested ${requestedPageSize}-issue bound; the page was not retained.`);
        break;
      }
      const reportedTotal = sonarIssueTotal(response.value);
      if (total !== undefined && reportedTotal !== undefined && reportedTotal !== total) {
        warnings.push(`SonarQube issue pagination stopped at page ${pageNumber} because the reported issue total changed from ${total} to ${reportedTotal}.`);
        break;
      }
      const effectiveTotal = reportedTotal ?? total;
      if (effectiveTotal !== undefined && providerRowsFetched + rawIssues.length > effectiveTotal) {
        warnings.push(`SonarQube issue pagination stopped because the next page would exceed the reported total of ${effectiveTotal}.`);
        break;
      }
      const incompleteIssueRecords = rawIssues.some(issue => !isCompleteSonarIssueRecord(issue));
      const pageIssues = rawIssues
        .map(normalizeSonarIssue)
        .filter((issue): issue is SonarIssueContext => Boolean(issue));
      if (pageIssues.length !== rawIssues.length || incompleteIssueRecords) {
        retainedAllProviderRows = false;
        warnings.push(`SonarQube issue page ${pageNumber} contained invalid or over-limit issue data that was omitted or truncated.`);
      }
      const remaining = this.maxIssues - issues.length;
      if (pageIssues.length > remaining) {
        retainedAllProviderRows = false;
        warnings.push(`SonarQube issue page ${pageNumber} exceeded the remaining ${remaining}-issue safety limit; extra issues were omitted.`);
      }
      issues.push(...pageIssues.slice(0, remaining));
      pages = pageNumber;
      total = effectiveTotal;
      providerRowsFetched += rawIssues.length;

      const fetchedProviderRows = rawIssues.length;
      const reachedKnownTotal = total !== undefined && providerRowsFetched === total;
      const reachedShortPage = fetchedProviderRows < requestedPageSize;
      if (reachedKnownTotal || reachedShortPage || fetchedProviderRows === 0) {
        if (total !== undefined && providerRowsFetched < total) {
          warnings.push(`SonarQube issue pagination ended after ${providerRowsFetched} of ${total} reported issues.`);
        }
        complete = retainedAllProviderRows && (total === undefined ? reachedShortPage : reachedKnownTotal);
        break;
      }
    }

    if (!complete && issues.length >= this.maxIssues) {
      warnings.push(`SonarQube issue collection stopped at the safety limit of ${this.maxIssues} issues.`);
    } else if (!complete && pages >= this.maxIssuePages) {
      warnings.push(`SonarQube issue collection stopped at the safety limit of ${this.maxIssuePages} pages.`);
    }
    const result: SonarIssueCollection = {
      issues,
      complete,
      fetched: issues.length,
      pages,
      responseBytes,
      warnings: uniqueStrings(warnings),
    };
    if (total !== undefined) { result.total = total; }
    return result;
  }

  async branchContext(
    projectKey: string,
    branch: string,
    options: SonarBranchContextRequestOptions = {},
  ): Promise<SonarBranchContext> {
    const target = normalizeSonarTarget(projectKey, branch);
    const warnings: string[] = [];
    const [gateResult, measureResult, issueResult] = await Promise.allSettled([
      this.qualityGateStatus(target.projectKey, target.branch, options),
      this.measures(target.projectKey, target.branch, options),
      this.issues(target.projectKey, target.branch, options),
    ]);

    let qualityGateComplete = gateResult.status === 'fulfilled';
    const qualityGate = gateResult.status === 'fulfilled'
      ? gateResult.value
      : { status: 'UNKNOWN', conditions: [] };
    if (gateResult.status === 'rejected') {
      qualityGateComplete = false;
      warnings.push(safeSonarContextWarning('SonarQube quality gate', gateResult.reason));
    }

    let measuresComplete = measureResult.status === 'fulfilled';
    const measures = measureResult.status === 'fulfilled' ? measureResult.value : [];
    if (measureResult.status === 'rejected') {
      measuresComplete = false;
      warnings.push(safeSonarContextWarning('SonarQube measures', measureResult.reason));
    }

    let issues = emptySonarIssueCollection();
    if (issueResult.status === 'fulfilled') {
      issues = issueResult.value;
      warnings.push(...issues.warnings);
    } else {
      warnings.push(safeSonarContextWarning('SonarQube issues', issueResult.reason));
    }

    const completeness: SonarBranchContextCompleteness = {
      complete: qualityGateComplete && measuresComplete && issues.complete,
      qualityGateComplete,
      measuresComplete,
      issuesComplete: issues.complete,
      issuesFetched: issues.fetched,
      issuePages: issues.pages,
      issueResponseBytes: issues.responseBytes,
      warnings: uniqueStrings(warnings),
    };
    if (issues.total !== undefined) { completeness.issuesTotal = issues.total; }
    return {
      schemaVersion: 1,
      provider: 'sonarqube',
      fetchedAt: new Date().toISOString(),
      projectKey: target.projectKey,
      branch: target.branch,
      dashboardUrl: buildSonarDashboardUrl(resolveSonarRestConfig(this.env).baseUrl, target.projectKey, target.branch),
      qualityGate,
      measures,
      issues: issues.issues,
      completeness,
    };
  }

  async projectContext(
    projectKey: string,
    branch: string,
    options: SonarBranchContextRequestOptions = {},
  ): Promise<SonarBranchContext> {
    return this.branchContext(projectKey, branch, options);
  }

  private async requestJson(
    apiPath: string,
    label: string,
    query: Record<string, string | number | boolean>,
    options: SonarRestRequestOptions,
  ): Promise<SonarJsonResponse> {
    const config = resolveSonarRestConfig(this.env);
    const url = buildSonarApiUrl(config.baseUrl, apiPath, query);
    let response: SonarHttpResponse;
    try {
      response = await this.transport({
        method: 'GET',
        url,
        headers: sonarHeaders(config),
        timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 120000),
        maxResponseBytes: this.maxResponseBytes,
      });
    } catch (error: unknown) {
      if (error instanceof SonarRestError) { throw error; }
      const code = unknownErrorCode(error);
      throw new SonarRestError(
        `SonarQube REST request failed while fetching ${label}${code ? ` (${code})` : ''}. `
        + 'Check connectivity and SonarQube configuration; credentials and response bodies are not displayed.',
      );
    }
    const bodyBytes = Buffer.byteLength(response.body, 'utf8');
    if (bodyBytes > this.maxResponseBytes) {
      throw new SonarRestError(`SonarQube REST ${label} exceeded the ${this.maxResponseBytes}-byte response safety limit.`);
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw sonarHttpError(label, response.statusCode);
    }
    return { value: parseSonarJson(response.body, label), bodyBytes };
  }
}

export function createSonarRestClient(options: SonarRestClientOptions = {}): SonarRestClient {
  return new SonarRestClient(options);
}

export const sonarRestClient = createSonarRestClient();

export function isSonarRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    resolveSonarRestConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function resolveSonarRestConfig(env: NodeJS.ProcessEnv = process.env): SonarRestConfig {
  const baseUrl = normalizeSonarBaseUrl(env['SONAR_HOST_URL']) || normalizeSonarBaseUrl(env['SONAR_URL']);
  const token = firstNonEmpty(env['SONAR_TOKEN']);
  const missing: string[] = [];
  if (!baseUrl) { missing.push('SONAR_HOST_URL or SONAR_URL'); }
  if (!token) { missing.push('SONAR_TOKEN'); }
  if (missing.length > 0) {
    throw new SonarRestError(`SonarQube REST configuration missing ${missing.join(', ')}. Values are not displayed.`);
  }
  if (!baseUrl || !token) {
    throw new SonarRestError('SonarQube REST configuration is incomplete. Values are not displayed.');
  }
  return { baseUrl, token };
}

export function normalizeSonarBaseUrl(value: string | undefined): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

/** Builds a non-credentialed branch dashboard URL without requiring an API token. */
export function sonarDashboardUrl(
  projectKey: string,
  branch: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const baseUrl = normalizeSonarBaseUrl(env['SONAR_HOST_URL']) || normalizeSonarBaseUrl(env['SONAR_URL']);
  if (!baseUrl) { return undefined; }
  try {
    const target = normalizeSonarTarget(projectKey, branch);
    return buildSonarDashboardUrl(baseUrl, target.projectKey, target.branch);
  } catch {
    return undefined;
  }
}

export function normalizeQualityGateStatus(value: unknown): SonarQualityGateStatus {
  const root = isRecord(value) ? value : {};
  const projectStatus = isRecord(root['projectStatus']) ? root['projectStatus'] : root;
  const result: SonarQualityGateStatus = {
    status: boundedProviderText(projectStatus['status'], 500) || 'UNKNOWN',
    conditions: arrayFromUnknown(projectStatus['conditions'])
      .map(normalizeQualityGateCondition)
      .filter((condition): condition is SonarQualityGateCondition => Boolean(condition)),
  };
  if (typeof projectStatus['ignoredConditions'] === 'boolean') {
    result.ignoredConditions = projectStatus['ignoredConditions'];
  }
  assignString(result, 'caycStatus', projectStatus['caycStatus'], 500);
  return result;
}

export function normalizeSonarMeasures(value: unknown): SonarMeasure[] {
  if (!isRecord(value)) { return []; }
  const component = isRecord(value['component']) ? value['component'] : value;
  const measures: SonarMeasure[] = [];
  for (const rawMeasure of arrayFromUnknown(component['measures'])) {
    if (!isRecord(rawMeasure)) { continue; }
    const metric = boundedProviderText(rawMeasure['metric'], 1000);
    if (!metric) { continue; }
    const measure: SonarMeasure = { metric };
    assignString(measure, 'value', rawMeasure['value'], 2000);
    if (isRecord(rawMeasure['period'])) { assignString(measure, 'periodValue', rawMeasure['period']['value'], 2000); }
    if (typeof rawMeasure['bestValue'] === 'boolean') { measure.bestValue = rawMeasure['bestValue']; }
    measures.push(measure);
  }
  return measures;
}

function normalizeQualityGateResponse(value: unknown): SonarQualityGateStatus {
  if (!isRecord(value) || !isRecord(value['projectStatus'])
    || !isRequiredProviderTextWithinLimit(value['projectStatus']['status'], 500)) {
    throw new SonarRestError('SonarQube quality gate returned an invalid payload. Response content is not displayed.');
  }
  const rawConditions = value['projectStatus']['conditions'];
  if (!Array.isArray(rawConditions)) {
    throw new SonarRestError('SonarQube quality gate returned invalid condition data. Response content is not displayed.');
  }
  const normalized = normalizeQualityGateStatus(value);
  if (normalized.conditions.length !== rawConditions.length
    || rawConditions.some(condition => !isCompleteQualityGateCondition(condition))
    || !isOptionalBoolean(value['projectStatus']['ignoredConditions'])
    || !isOptionalProviderTextWithinLimit(value['projectStatus']['caycStatus'], 500)) {
    throw new SonarRestError('SonarQube quality gate contained invalid conditions. Response content is not displayed.');
  }
  return normalized;
}

function normalizeSonarMeasureResponse(value: unknown): SonarMeasure[] {
  if (!isRecord(value) || !isRecord(value['component']) || !Array.isArray(value['component']['measures'])) {
    throw new SonarRestError('SonarQube measures returned an invalid payload. Response content is not displayed.');
  }
  const normalized = normalizeSonarMeasures(value);
  if (normalized.length !== value['component']['measures'].length
    || value['component']['measures'].some(measure => !isCompleteSonarMeasureRecord(measure))) {
    throw new SonarRestError('SonarQube measures contained invalid records. Response content is not displayed.');
  }
  return normalized;
}

function isCompleteQualityGateCondition(value: unknown): boolean {
  if (!isRecord(value)) { return false; }
  const textFields: ReadonlyArray<readonly [string, number]> = [
    ['status', 500],
    ['metricKey', 1000],
    ['comparator', 100],
    ['errorThreshold', 2000],
    ['actualValue', 2000],
  ];
  if (textFields.some(([key, limit]) => !isOptionalProviderTextWithinLimit(value[key], limit))) { return false; }
  return value['periodIndex'] === undefined || nonNegativeInteger(value['periodIndex']) !== undefined;
}

function isCompleteSonarMeasureRecord(value: unknown): boolean {
  if (!isRecord(value) || !isRequiredProviderTextWithinLimit(value['metric'], 1000)
    || !isOptionalProviderTextWithinLimit(value['value'], 2000)
    || !isOptionalBoolean(value['bestValue'])) {
    return false;
  }
  const period = value['period'];
  return period === undefined || (isRecord(period) && isOptionalProviderTextWithinLimit(period['value'], 2000));
}

function isCompleteSonarIssueRecord(value: unknown): boolean {
  if (!isRecord(value) || !isRequiredProviderTextWithinLimit(value['message'], MAX_PROVIDER_TEXT_LENGTH)) { return false; }
  const textFields: ReadonlyArray<readonly [string, number]> = [
    ['key', 1000],
    ['rule', 1000],
    ['severity', 500],
    ['component', 4000],
    ['project', 2000],
    ['status', 500],
    ['resolution', 500],
    ['issueStatus', 500],
    ['type', 500],
    ['scope', 500],
    ['effort', 500],
    ['debt', 500],
    ['author', 2000],
    ['cleanCodeAttribute', 500],
    ['cleanCodeAttributeCategory', 500],
    ['creationDate', 500],
    ['updateDate', 500],
    ['closeDate', 500],
  ];
  if (textFields.some(([key, limit]) => !isOptionalProviderTextWithinLimit(value[key], limit))) { return false; }
  if (value['line'] !== undefined && nonNegativeInteger(value['line']) === undefined) { return false; }

  const tags = value['tags'];
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 100
    || tags.some(tag => !isRequiredProviderTextWithinLimit(tag, 500)))) {
    return false;
  }
  const impacts = value['impacts'];
  if (impacts !== undefined && (!Array.isArray(impacts) || impacts.length > 100
    || impacts.some(impact => !isCompleteSonarImpact(impact)))) {
    return false;
  }
  const textRange = value['textRange'];
  return textRange === undefined || isCompleteSonarTextRange(textRange);
}

function isCompleteSonarImpact(value: unknown): boolean {
  if (!isRecord(value)) { return false; }
  const hasValue = value['softwareQuality'] !== undefined || value['severity'] !== undefined;
  return hasValue
    && isOptionalProviderTextWithinLimit(value['softwareQuality'], 500)
    && isOptionalProviderTextWithinLimit(value['severity'], 500);
}

function isCompleteSonarTextRange(value: unknown): boolean {
  if (!isRecord(value)) { return false; }
  const keys = ['startLine', 'endLine', 'startOffset', 'endOffset'] as const;
  return keys.some(key => value[key] !== undefined)
    && keys.every(key => value[key] === undefined || nonNegativeInteger(value[key]) !== undefined);
}

function isRequiredProviderTextWithinLimit(value: unknown, maxLength: number): boolean {
  const text = optionalTrimmedStringFromUnknown(value);
  return Boolean(text && text.length <= maxLength);
}

function isOptionalProviderTextWithinLimit(value: unknown, maxLength: number): boolean {
  return value === undefined || value === null || isRequiredProviderTextWithinLimit(value, maxLength);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === 'boolean';
}

function normalizeQualityGateCondition(value: unknown): SonarQualityGateCondition | undefined {
  if (!isRecord(value)) { return undefined; }
  const condition: SonarQualityGateCondition = {};
  assignString(condition, 'status', value['status'], 500);
  assignString(condition, 'metricKey', value['metricKey'], 1000);
  assignString(condition, 'comparator', value['comparator'], 100);
  assignString(condition, 'errorThreshold', value['errorThreshold'], 2000);
  assignString(condition, 'actualValue', value['actualValue'], 2000);
  assignNonNegativeNumber(condition, 'periodIndex', value['periodIndex']);
  return Object.keys(condition).length > 0 ? condition : undefined;
}

function normalizeSonarIssue(value: unknown): SonarIssueContext | undefined {
  if (!isRecord(value)) { return undefined; }
  const message = boundedProviderText(value['message'], MAX_PROVIDER_TEXT_LENGTH);
  if (!message) { return undefined; }
  const issue: SonarIssueContext = {
    message,
    tags: arrayFromUnknown(value['tags'])
      .map(tag => boundedProviderText(tag, 500))
      .filter((tag): tag is string => Boolean(tag))
      .slice(0, 100),
    impacts: arrayFromUnknown(value['impacts'])
      .map(normalizeSonarImpact)
      .filter((impact): impact is SonarIssueImpact => Boolean(impact))
      .slice(0, 100),
  };
  assignString(issue, 'key', value['key'], 1000);
  assignString(issue, 'rule', value['rule'], 1000);
  assignString(issue, 'severity', value['severity'], 500);
  assignString(issue, 'component', value['component'], 4000);
  assignString(issue, 'project', value['project'], 2000);
  assignNonNegativeNumber(issue, 'line', value['line']);
  assignString(issue, 'status', value['status'], 500);
  assignString(issue, 'resolution', value['resolution'], 500);
  assignString(issue, 'issueStatus', value['issueStatus'], 500);
  assignString(issue, 'type', value['type'], 500);
  assignString(issue, 'scope', value['scope'], 500);
  assignString(issue, 'effort', value['effort'], 500);
  assignString(issue, 'debt', value['debt'], 500);
  assignString(issue, 'author', value['author'], 2000);
  assignString(issue, 'cleanCodeAttribute', value['cleanCodeAttribute'], 500);
  assignString(issue, 'cleanCodeAttributeCategory', value['cleanCodeAttributeCategory'], 500);
  assignString(issue, 'creationDate', value['creationDate'], 500);
  assignString(issue, 'updateDate', value['updateDate'], 500);
  assignString(issue, 'closeDate', value['closeDate'], 500);
  const textRange = normalizeSonarTextRange(value['textRange']);
  if (textRange) { issue.textRange = textRange; }
  return issue;
}

function normalizeSonarImpact(value: unknown): SonarIssueImpact | undefined {
  if (!isRecord(value)) { return undefined; }
  const impact: SonarIssueImpact = {};
  assignString(impact, 'softwareQuality', value['softwareQuality'], 500);
  assignString(impact, 'severity', value['severity'], 500);
  return Object.keys(impact).length > 0 ? impact : undefined;
}

function normalizeSonarTextRange(value: unknown): SonarIssueTextRange | undefined {
  if (!isRecord(value)) { return undefined; }
  const range: SonarIssueTextRange = {};
  assignNonNegativeNumber(range, 'startLine', value['startLine']);
  assignNonNegativeNumber(range, 'endLine', value['endLine']);
  assignNonNegativeNumber(range, 'startOffset', value['startOffset']);
  assignNonNegativeNumber(range, 'endOffset', value['endOffset']);
  return Object.keys(range).length > 0 ? range : undefined;
}

function normalizeSonarTarget(projectKey: string, branch: string): { projectKey: string; branch: string } {
  return {
    projectKey: normalizeSonarIdentifier(projectKey, 'project key'),
    branch: normalizeSonarIdentifier(branch, 'branch'),
  };
}

function normalizeSonarIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 1000 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new SonarRestError(`SonarQube ${label} is missing or invalid.`);
  }
  return normalized;
}

function normalizeMetricKeys(values: readonly string[]): string[] {
  const normalized = [...new Set(values.map(value => value.trim()).filter(value => /^[A-Za-z0-9_.-]+$/.test(value)))];
  if (normalized.length === 0 || normalized.length > 100) {
    throw new SonarRestError('SonarQube metric keys are missing or invalid.');
  }
  return normalized;
}

function buildSonarApiUrl(baseUrl: string, apiPath: string, query: Record<string, string | number | boolean>): string {
  const url = new URL(apiPath.replace(/^\/+/, ''), `${baseUrl.replace(/\/+$/, '')}/`);
  if (url.origin !== new URL(baseUrl).origin) {
    throw new SonarRestError('Refused to send SonarQube credentials outside the configured provider origin.');
  }
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildSonarDashboardUrl(baseUrl: string, projectKey: string, branch: string): string {
  const url = new URL('dashboard', `${baseUrl.replace(/\/+$/, '')}/`);
  url.searchParams.set('id', projectKey);
  url.searchParams.set('branch', branch);
  return url.toString();
}

function sonarHeaders(config: SonarRestConfig): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${config.token}`,
    'User-Agent': 'kronos-sonarqube-rest',
  };
}

function sonarIssueTotal(value: Record<string, unknown>): number | undefined {
  const paging = isRecord(value['paging']) ? value['paging'] : {};
  return nonNegativeInteger(paging['total']) ?? nonNegativeInteger(value['total']);
}

function emptySonarIssueCollection(): SonarIssueCollection {
  return { issues: [], complete: false, fetched: 0, pages: 0, responseBytes: 0, warnings: [] };
}

function safeSonarCollectionWarning(pageNumber: number, error: unknown): string {
  if (error instanceof SonarRestError) {
    return `SonarQube issue page ${pageNumber} could not be fetched: ${error.message}`;
  }
  const code = unknownErrorCode(error);
  return `SonarQube issue page ${pageNumber} could not be fetched${code ? ` (${code})` : ''}; previously fetched issues were retained.`;
}

function safeSonarContextWarning(label: string, error: unknown): string {
  if (error instanceof SonarRestError) { return error.message; }
  const code = unknownErrorCode(error);
  return `${label} could not be fetched${code ? ` (${code})` : ''}; response content is not displayed.`;
}

function parseSonarJson(body: string, label: string): unknown {
  try {
    return parseJsonWithLabel(body, label);
  } catch {
    throw new SonarRestError(`SonarQube REST ${label} returned invalid JSON. Response content is not displayed.`);
  }
}

function sonarHttpError(label: string, statusCode: number): SonarRestError {
  if (statusCode === 401 || statusCode === 403) {
    return new SonarRestError(`SonarQube REST ${label} failed with HTTP ${statusCode}. Check SonarQube credentials and permissions; values are not displayed.`);
  }
  if (statusCode === 404) {
    return new SonarRestError(`SonarQube REST ${label} failed with HTTP 404. The project, branch, or API may be unavailable.`);
  }
  if (statusCode === 429) {
    return new SonarRestError(`SonarQube REST ${label} failed with HTTP 429. SonarQube rate limiting prevented the fetch.`);
  }
  return new SonarRestError(`SonarQube REST ${label} failed with HTTP ${statusCode}. Response content is not displayed.`);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = optionalFiniteNumberFromUnknown(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

function assignNonNegativeNumber<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  const number = optionalFiniteNumberFromUnknown(value);
  if (number !== undefined && number >= 0) { target[key] = number as T[K]; }
}

function assignString<T extends object, K extends keyof T>(target: T, key: K, value: unknown, maxLength = 4000): void {
  const text = boundedProviderText(value, maxLength);
  if (text) { target[key] = text as T[K]; }
}

function boundedProviderText(value: unknown, maxLength: number): string | undefined {
  const text = optionalTrimmedStringFromUnknown(value);
  return text ? text.slice(0, maxLength) : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export class SonarRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, SonarRestError.prototype);
    this.name = 'SonarRestError';
  }
}

function defaultSonarTransport(request: SonarHttpRequest): Promise<SonarHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new SonarRestError('Invalid SonarQube REST URL.'));
      return;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
      reject(new SonarRestError('SonarQube REST requires HTTPS except for loopback development.'));
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
      let settled = false;
      res.on('data', chunk => {
        if (settled) { return; }
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        receivedBytes += buffer.length;
        if (receivedBytes > request.maxResponseBytes) {
          settled = true;
          res.destroy();
          req.destroy();
          reject(new SonarRestError(`SonarQube REST response exceeded the ${request.maxResponseBytes}-byte safety limit.`));
          return;
        }
        chunks.push(buffer);
      });
      res.on('end', () => {
        if (settled) { return; }
        settled = true;
        resolve({
          statusCode: res.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
          headers: res.headers,
        });
      });
      res.on('error', () => {
        if (settled) { return; }
        settled = true;
        reject(new SonarRestError('SonarQube REST response ended unexpectedly.'));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new SonarRestError(`Timed out after ${request.timeoutMs}ms reaching SonarQube REST API.`));
    });
    req.on('error', () => {
      reject(new SonarRestError('SonarQube REST network request failed.'));
    });
    req.end();
  });
}
