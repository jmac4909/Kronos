import * as http from 'http';
import * as https from 'https';
import { unknownErrorCode } from './errorUtils';
import { parseJsonWithLabel } from './jsonFiles';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';
import { redactSensitiveTokens } from './sensitiveText';

export interface JenkinsRestRequestOptions {
  timeoutMs?: number;
}

export interface JenkinsHttpRequest {
  method: 'GET';
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  maxResponseBytes: number;
}

export interface JenkinsHttpResponse {
  statusCode: number;
  body: string;
  headers: Record<string, string | string[] | undefined>;
}

export type JenkinsHttpTransport = (request: JenkinsHttpRequest) => Promise<JenkinsHttpResponse>;

export interface JenkinsRestClientOptions {
  env?: NodeJS.ProcessEnv;
  transport?: JenkinsHttpTransport;
  maxResponseBytes?: number;
  maxTestCases?: number;
  maxStages?: number;
}

export interface JenkinsBuildSummary {
  number: number;
  status: string;
  url: string;
  building?: boolean;
  timestamp?: number;
  duration?: number;
  estimatedDuration?: number;
}

export interface JenkinsBuildCause {
  shortDescription: string;
  userName?: string;
}

export interface JenkinsBuildArtifact {
  fileName: string;
  relativePath: string;
}

export interface JenkinsBuildChange {
  id?: string;
  message?: string;
  timestamp?: number;
  author?: string;
  affectedPaths: string[];
}

export interface JenkinsBuildDetails extends JenkinsBuildSummary {
  fullDisplayName?: string;
  description?: string;
  queueId?: number;
  causes: JenkinsBuildCause[];
  artifacts: JenkinsBuildArtifact[];
  changes: JenkinsBuildChange[];
}

export interface JenkinsFailedTestCase {
  className?: string;
  name: string;
  status: string;
  duration?: number;
  errorDetails?: string;
  errorStackTrace?: string;
}

export interface JenkinsTestReportContext {
  passCount: number;
  failCount: number;
  skipCount: number;
  totalCount: number;
  duration?: number;
  failedCases: JenkinsFailedTestCase[];
  failedCasesAvailable: number;
  complete: boolean;
}

export interface JenkinsPipelineStage {
  id?: string;
  name: string;
  status: string;
  startTimeMillis?: number;
  durationMillis?: number;
  pauseDurationMillis?: number;
}

export type JenkinsOptionalContextStatus = 'complete' | 'unavailable' | 'partial';

export interface JenkinsBuildContextCompleteness {
  complete: boolean;
  buildComplete: boolean;
  testReport: JenkinsOptionalContextStatus;
  stages: JenkinsOptionalContextStatus;
  configuration: JenkinsOptionalContextStatus;
  logsIncluded: false;
  warnings: string[];
}

export interface JenkinsBuildContext {
  schemaVersion: 1;
  provider: 'jenkins';
  fetchedAt: string;
  jobOrBuildUrl: string;
  build: JenkinsBuildDetails;
  tests?: JenkinsTestReportContext;
  stages?: JenkinsPipelineStage[];
  sonarProjectKey?: string;
  sonarBranch?: string;
  completeness: JenkinsBuildContextCompleteness;
}

interface JenkinsRestConfig {
  baseUrl?: string;
  username?: string;
  token?: string;
}

interface OptionalJenkinsJsonResult {
  status: JenkinsOptionalContextStatus;
  value?: unknown;
  warning?: string;
}

interface OptionalJenkinsTextResult {
  status: JenkinsOptionalContextStatus;
  value?: string;
}

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_TEST_CASES = 500;
const DEFAULT_MAX_STAGES = 200;
const MAX_PROVIDER_TEXT_LENGTH = 16000;
const MAX_BUILD_CAUSES = 100;
const MAX_BUILD_ARTIFACTS = 1000;
const MAX_BUILD_CHANGES = 500;
const MAX_AFFECTED_PATHS = 500;
const BUILD_TREE = [
  'number',
  'result',
  'building',
  'url',
  'timestamp',
  'duration',
  'estimatedDuration',
  'queueId',
  'description',
  'fullDisplayName',
  'actions[causes[shortDescription,userName]]',
  'artifacts[fileName,relativePath]',
  'changeSet[items[commitId,id,msg,timestamp,author[fullName],affectedPaths]]',
].join(',');
const JOB_OR_BUILD_TREE = `lastBuild[${BUILD_TREE}],lastCompletedBuild[${BUILD_TREE}],${BUILD_TREE}`;
const TEST_REPORT_TREE = 'failCount,skipCount,passCount,totalCount,duration,suites[name,duration,cases[className,name,status,duration,errorDetails,errorStackTrace]]';

export class JenkinsRestClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: JenkinsHttpTransport;
  private readonly maxResponseBytes: number;
  private readonly maxTestCases: number;
  private readonly maxStages: number;

  constructor(options: JenkinsRestClientOptions = {}) {
    this.env = options.env || process.env;
    this.transport = options.transport || defaultJenkinsTransport;
    this.maxResponseBytes = boundedInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES, 1024, 25 * 1024 * 1024);
    this.maxTestCases = boundedInteger(options.maxTestCases, DEFAULT_MAX_TEST_CASES, 1, 5000);
    this.maxStages = boundedInteger(options.maxStages, DEFAULT_MAX_STAGES, 1, 1000);
  }

  async buildStatus(jobUrl: string, options: JenkinsRestRequestOptions = {}): Promise<JenkinsBuildSummary | null> {
    const normalizedJobUrl = normalizeJenkinsJobUrl(jobUrl, resolveJenkinsRestConfig(this.env).baseUrl);
    if (!normalizedJobUrl) { return null; }
    const tree = 'lastBuild[number,result,building,url,timestamp,duration,estimatedDuration],lastCompletedBuild[number,result,building,url,timestamp,duration,estimatedDuration],number,result,building,url,timestamp,duration,estimatedDuration';
    const response = await this.requestJson(normalizedJobUrl, 'Jenkins build status', { tree }, options);
    const record = isRecord(response.value) ? response.value : {};
    const candidate = firstBuildRecord(record['lastBuild'], record['lastCompletedBuild'], record);
    return candidate ? normalizeJenkinsBuild(candidate, normalizedJobUrl) : null;
  }

  async buildContext(jobOrBuildUrl: string, options: JenkinsRestRequestOptions = {}): Promise<JenkinsBuildContext> {
    const config = resolveJenkinsRestConfig(this.env);
    const normalizedInputUrl = normalizeJenkinsJobUrl(jobOrBuildUrl, config.baseUrl);
    if (!normalizedInputUrl) {
      throw new JenkinsRestError('Jenkins job or build URL is missing or invalid.');
    }
    const response = await this.requestJson(
      normalizedInputUrl,
      'Jenkins build context',
      { tree: JOB_OR_BUILD_TREE },
      options,
    );
    const root = isRecord(response.value) ? response.value : {};
    const nestedBuildRecord = firstBuildRecord(root['lastBuild'], root['lastCompletedBuild']);
    const buildRecord = nestedBuildRecord || (looksLikeBuildRecord(root) ? root : undefined);
    if (!buildRecord) {
      throw new JenkinsRestError('Jenkins build context did not contain a usable build record. Response content is not displayed.');
    }
    const buildFallbackUrl = nestedBuildRecord
      ? appendJenkinsBuildNumber(normalizedInputUrl, nonNegativeInteger(buildRecord['number']))
      : normalizedInputUrl;
    const build = normalizeJenkinsBuildDetails(buildRecord, buildFallbackUrl);
    if (!build) {
      throw new JenkinsRestError('Jenkins build context did not contain a valid build number. Response content is not displayed.');
    }

    const buildInspection = inspectJenkinsBuildRecord(buildRecord, buildFallbackUrl);
    const warnings: string[] = [...buildInspection.warnings];
    const configurationUrl = nestedBuildRecord
      ? normalizedInputUrl
      : jenkinsJobUrlFromBuild(build.url, build.number) || normalizedInputUrl;
    const [testResult, stageResult, configurationResult] = await Promise.all([
      this.requestOptionalJson(build.url, 'Jenkins test report', { tree: TEST_REPORT_TREE }, options, 'testReport/api/json'),
      this.requestOptionalJson(build.url, 'Jenkins Pipeline stages', {}, options, 'wfapi/describe'),
      this.requestOptionalText(configurationUrl, 'Jenkins job configuration', options, 'config.xml'),
    ]);
    if (testResult.warning) { warnings.push(testResult.warning); }
    if (stageResult.warning) { warnings.push(stageResult.warning); }

    let tests: JenkinsTestReportContext | undefined;
    let testStatus = testResult.status;
    if (testResult.value !== undefined) {
      tests = normalizeJenkinsTestReport(testResult.value, this.maxTestCases);
      if (!tests) {
        testStatus = 'partial';
        warnings.push('Jenkins test report returned an invalid payload; no test details were retained.');
      } else if (!tests.complete) {
        testStatus = 'partial';
        warnings.push(`Jenkins failed-test details were incomplete or limited to ${this.maxTestCases} cases.`);
      }
    }

    let stages: JenkinsPipelineStage[] | undefined;
    let stageStatus = stageResult.status;
    if (stageResult.value !== undefined) {
      const normalizedStages = normalizeJenkinsStages(stageResult.value, this.maxStages);
      stages = normalizedStages.stages;
      if (!normalizedStages.valid) {
        stageStatus = 'partial';
        warnings.push('Jenkins Pipeline stage data returned an invalid payload.');
      }
      if (normalizedStages.truncated) {
        stageStatus = 'partial';
        warnings.push(`Jenkins Pipeline stage details were limited to ${this.maxStages} stages.`);
      }
    }

    const completeness: JenkinsBuildContextCompleteness = {
      complete: buildInspection.complete && testStatus === 'complete' && stageStatus === 'complete',
      buildComplete: buildInspection.complete,
      testReport: testStatus,
      stages: stageStatus,
      configuration: configurationResult.status,
      logsIncluded: false,
      warnings: uniqueStrings(warnings),
    };
    const context: JenkinsBuildContext = {
      schemaVersion: 1,
      provider: 'jenkins',
      fetchedAt: new Date().toISOString(),
      jobOrBuildUrl: normalizedInputUrl,
      build,
      completeness,
    };
    if (tests) { context.tests = tests; }
    if (stages) { context.stages = stages; }
    if (configurationResult.value) {
      const sonarConfiguration = sonarConfigurationFromJenkinsXml(configurationResult.value);
      if (sonarConfiguration.projectKey) { context.sonarProjectKey = sonarConfiguration.projectKey; }
      if (sonarConfiguration.branch) { context.sonarBranch = sonarConfiguration.branch; }
    }
    return context;
  }

  private async requestOptionalText(
    resourceUrl: string,
    label: string,
    options: JenkinsRestRequestOptions,
    suffix: string,
  ): Promise<OptionalJenkinsTextResult> {
    try {
      const response = await this.requestRaw(resourceUrl, label, {}, options, suffix);
      if (response.statusCode === 404) { return { status: 'unavailable' }; }
      if (response.statusCode < 200 || response.statusCode >= 300) { return { status: 'partial' }; }
      return { status: 'complete', value: response.body };
    } catch {
      return { status: 'partial' };
    }
  }

  private async requestOptionalJson(
    resourceUrl: string,
    label: string,
    query: Record<string, string | number | boolean>,
    options: JenkinsRestRequestOptions,
    suffix: string,
  ): Promise<OptionalJenkinsJsonResult> {
    try {
      const response = await this.requestRaw(resourceUrl, label, query, options, suffix);
      if (response.statusCode === 404) {
        return { status: 'unavailable', warning: `${label} is unavailable on this Jenkins build.` };
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return { status: 'partial', warning: `${label} failed with HTTP ${response.statusCode}; response content is not displayed.` };
      }
      return { status: 'complete', value: parseJenkinsJson(response.body, label) };
    } catch (error: unknown) {
      return { status: 'partial', warning: safeJenkinsOptionalWarning(label, error) };
    }
  }

  private async requestJson(
    jobUrl: string,
    label: string,
    query: Record<string, string | number | boolean> = {},
    options: JenkinsRestRequestOptions = {},
    suffix = 'api/json',
  ): Promise<{ value: unknown; headers: Record<string, string | string[] | undefined> }> {
    const response = await this.requestRaw(jobUrl, label, query, options, suffix);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw jenkinsHttpError(label, response.statusCode);
    }
    return {
      value: parseJenkinsJson(response.body, label),
      headers: response.headers,
    };
  }

  private async requestRaw(
    jobUrl: string,
    label: string,
    query: Record<string, string | number | boolean> = {},
    options: JenkinsRestRequestOptions = {},
    suffix = '',
  ): Promise<JenkinsHttpResponse> {
    const config = resolveJenkinsRestConfig(this.env);
    const url = buildJenkinsUrl(jobUrl, suffix, query);
    assertJenkinsCredentialOrigin(config, url);
    let response: JenkinsHttpResponse;
    try {
      response = await this.transport({
        method: 'GET',
        url,
        timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 250, 120000),
        maxResponseBytes: this.maxResponseBytes,
        headers: jenkinsHeaders(config),
      });
    } catch (error: unknown) {
      if (error instanceof JenkinsRestError) { throw error; }
      const code = unknownErrorCode(error);
      throw new JenkinsRestError(
        `Jenkins REST ${label} request failed${code ? ` (${code})` : ''}. `
        + 'Check connectivity and Jenkins configuration; credentials and response bodies are not displayed.',
      );
    }
    if (Buffer.byteLength(response.body, 'utf8') > this.maxResponseBytes) {
      throw new JenkinsRestError(`Jenkins REST ${label} exceeded the ${this.maxResponseBytes}-byte response safety limit.`);
    }
    if (response.statusCode === 401 || response.statusCode === 403) {
      throw new JenkinsRestError(`Jenkins REST ${label} failed with HTTP ${response.statusCode}. Check Jenkins credentials; values are not displayed.`);
    }
    return response;
  }
}

export function createJenkinsRestClient(options: JenkinsRestClientOptions = {}): JenkinsRestClient {
  return new JenkinsRestClient(options);
}

export const jenkinsRestClient = createJenkinsRestClient();

export function normalizeJenkinsJobUrl(value: string | undefined, baseUrl?: string): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  const normalizedBase = normalizeJenkinsBaseUrl(baseUrl);
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : normalizedBase
      ? new URL(trimmed, `${normalizedBase}/`).toString()
      : `https://${trimmed}`;
  return normalizeJenkinsHttpUrl(withScheme);
}

export function normalizeJenkinsBaseUrl(value: string | undefined): string | undefined {
  const trimmed = optionalTrimmedStringFromUnknown(value);
  if (!trimmed) { return undefined; }
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
  return normalizeJenkinsHttpUrl(withScheme);
}

export function isJenkinsRestConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(normalizeJenkinsBaseUrl(env['JENKINS_URL']));
}

function resolveJenkinsRestConfig(env: NodeJS.ProcessEnv): JenkinsRestConfig {
  const config: JenkinsRestConfig = {};
  const baseUrl = normalizeJenkinsBaseUrl(env['JENKINS_URL']);
  const username = firstNonEmpty(env['JENKINS_USER'], env['JENKINS_USERNAME']);
  const token = firstNonEmpty(env['JENKINS_API_TOKEN'], env['JENKINS_TOKEN']);
  if (baseUrl) { config.baseUrl = baseUrl; }
  if (username) { config.username = username; }
  if (token) { config.token = token; }
  return config;
}

function normalizeJenkinsBuild(record: Record<string, unknown>, fallbackUrl: string): JenkinsBuildSummary | null {
  const number = nonNegativeInteger(record['number']);
  if (number === undefined) { return null; }
  const buildingValue = typeof record['building'] === 'boolean' ? record['building'] : undefined;
  const status = boundedProviderText(firstDefined(record['result'], record['status']), 500)
    || (buildingValue ? 'BUILDING' : 'UNKNOWN');
  const url = sanitizeJenkinsReturnedUrl(
    optionalTrimmedStringFromUnknown(record['url']),
    safeUrlOrigin(fallbackUrl),
  ) || fallbackUrl;
  const summary: JenkinsBuildSummary = { number, status, url };
  if (buildingValue !== undefined) { summary.building = buildingValue; }
  assignNonNegativeNumber(summary, 'timestamp', record['timestamp']);
  assignNonNegativeNumber(summary, 'duration', record['duration']);
  assignNonNegativeNumber(summary, 'estimatedDuration', record['estimatedDuration']);
  return summary;
}

function normalizeJenkinsBuildDetails(record: Record<string, unknown>, fallbackUrl: string): JenkinsBuildDetails | null {
  const summary = normalizeJenkinsBuild(record, fallbackUrl);
  if (!summary) { return null; }
  const details: JenkinsBuildDetails = {
    ...summary,
    causes: normalizeJenkinsCauses(record['actions']),
    artifacts: normalizeJenkinsArtifacts(record['artifacts']),
    changes: normalizeJenkinsChanges(record['changeSet']),
  };
  assignString(details, 'fullDisplayName', record['fullDisplayName']);
  assignString(details, 'description', record['description'], MAX_PROVIDER_TEXT_LENGTH);
  assignNonNegativeNumber(details, 'queueId', record['queueId']);
  return details;
}

function inspectJenkinsBuildRecord(
  record: Record<string, unknown>,
  fallbackUrl: string,
): { complete: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const rawBuildUrl = optionalTrimmedStringFromUnknown(record['url']);
  if (rawBuildUrl && !sanitizeJenkinsReturnedUrl(rawBuildUrl, safeUrlOrigin(fallbackUrl))) {
    warnings.push('Jenkins returned an unsafe or cross-origin build URL; the URL was replaced with a pinned job-origin URL.');
  }
  if (providerTextExceedsSafetyLimit(firstDefined(record['result'], record['status']), 500)
    || providerTextExceedsSafetyLimit(record['fullDisplayName'], 4000)
    || providerTextExceedsSafetyLimit(record['description'], MAX_PROVIDER_TEXT_LENGTH)) {
    warnings.push('Jenkins build text exceeded safety limits and was truncated.');
  }

  let causeCount = 0;
  let invalidCauseData = false;
  const rawActions = record['actions'];
  if (rawActions !== undefined && !Array.isArray(rawActions)) {
    invalidCauseData = true;
  } else if (Array.isArray(rawActions)) {
    for (const action of rawActions) {
      if (!isRecord(action) || action['causes'] === undefined) { continue; }
      if (!Array.isArray(action['causes'])) {
        invalidCauseData = true;
        continue;
      }
      for (const cause of action['causes']) {
        causeCount += 1;
        if (!isRecord(cause)
          || !boundedProviderText(cause['shortDescription'], 4000)
          || providerTextExceedsSafetyLimit(cause['shortDescription'], 4000)
          || providerTextExceedsSafetyLimit(cause['userName'], 1000)) {
          invalidCauseData = true;
        }
      }
    }
  }
  if (causeCount > MAX_BUILD_CAUSES || invalidCauseData) {
    warnings.push(`Jenkins build causes were invalid or exceeded the ${MAX_BUILD_CAUSES}-item safety limit; some details were omitted.`);
  }

  const rawArtifacts = record['artifacts'];
  if (rawArtifacts !== undefined) {
    const invalidArtifacts = !Array.isArray(rawArtifacts) || rawArtifacts.some(artifact => (
      !isRecord(artifact)
      || !boundedProviderText(artifact['fileName'], 2000)
      || !boundedProviderText(artifact['relativePath'], 4000)
      || providerTextExceedsSafetyLimit(artifact['fileName'], 2000)
      || providerTextExceedsSafetyLimit(artifact['relativePath'], 4000)
    ));
    if (invalidArtifacts || (Array.isArray(rawArtifacts) && rawArtifacts.length > MAX_BUILD_ARTIFACTS)) {
      warnings.push(`Jenkins build artifacts were invalid or exceeded the ${MAX_BUILD_ARTIFACTS}-item safety limit; some details were omitted.`);
    }
  }

  const rawChangeSet = record['changeSet'];
  if (rawChangeSet !== undefined) {
    let invalidChangeData = !isRecord(rawChangeSet);
    const rawChanges = isRecord(rawChangeSet) ? rawChangeSet['items'] : undefined;
    if (rawChanges !== undefined && !Array.isArray(rawChanges)) {
      invalidChangeData = true;
    } else if (Array.isArray(rawChanges)) {
      for (const change of rawChanges) {
        if (!isRecord(change)) {
          invalidChangeData = true;
          continue;
        }
        if (providerTextExceedsSafetyLimit(firstDefined(change['commitId'], change['id']), 1000)
          || providerTextExceedsSafetyLimit(change['msg'], 8000)
          || (isRecord(change['author']) && providerTextExceedsSafetyLimit(change['author']['fullName'], 1000))) {
          invalidChangeData = true;
        }
        const rawPaths = change['affectedPaths'];
        if (rawPaths !== undefined && (!Array.isArray(rawPaths)
          || rawPaths.length > MAX_AFFECTED_PATHS
          || rawPaths.some(pathValue => !boundedProviderText(pathValue, 4000)
            || providerTextExceedsSafetyLimit(pathValue, 4000)))) {
          invalidChangeData = true;
        }
      }
      if (rawChanges.length > MAX_BUILD_CHANGES) { invalidChangeData = true; }
    }
    if (invalidChangeData) {
      warnings.push(`Jenkins changes were invalid or exceeded the ${MAX_BUILD_CHANGES}-change safety limit; some details were omitted.`);
    }
  }
  return { complete: warnings.length === 0, warnings };
}

function normalizeJenkinsCauses(value: unknown): JenkinsBuildCause[] {
  const causes: JenkinsBuildCause[] = [];
  for (const action of arrayFromUnknown(value)) {
    if (!isRecord(action)) { continue; }
    for (const rawCause of arrayFromUnknown(action['causes'])) {
      if (!isRecord(rawCause)) { continue; }
      const shortDescription = boundedProviderText(rawCause['shortDescription'], 4000);
      if (!shortDescription) { continue; }
      const cause: JenkinsBuildCause = { shortDescription };
      assignString(cause, 'userName', rawCause['userName'], 1000);
      causes.push(cause);
      if (causes.length >= MAX_BUILD_CAUSES) { return causes; }
    }
  }
  return causes;
}

function normalizeJenkinsArtifacts(value: unknown): JenkinsBuildArtifact[] {
  const artifacts: JenkinsBuildArtifact[] = [];
  for (const rawArtifact of arrayFromUnknown(value)) {
    if (!isRecord(rawArtifact)) { continue; }
    const fileName = boundedProviderText(rawArtifact['fileName'], 2000);
    const relativePath = boundedProviderText(rawArtifact['relativePath'], 4000);
    if (!fileName || !relativePath) { continue; }
    artifacts.push({ fileName, relativePath });
    if (artifacts.length >= MAX_BUILD_ARTIFACTS) { break; }
  }
  return artifacts;
}

function normalizeJenkinsChanges(value: unknown): JenkinsBuildChange[] {
  const changeSet = isRecord(value) ? value : {};
  const changes: JenkinsBuildChange[] = [];
  for (const rawChange of arrayFromUnknown(changeSet['items'])) {
    if (!isRecord(rawChange)) { continue; }
    const change: JenkinsBuildChange = {
      affectedPaths: arrayFromUnknown(rawChange['affectedPaths'])
        .map(pathValue => boundedProviderText(pathValue, 4000))
        .filter((pathValue): pathValue is string => Boolean(pathValue))
        .slice(0, MAX_AFFECTED_PATHS),
    };
    assignString(change, 'id', firstDefined(rawChange['commitId'], rawChange['id']), 1000);
    assignString(change, 'message', rawChange['msg'], 8000);
    assignNonNegativeNumber(change, 'timestamp', rawChange['timestamp']);
    if (isRecord(rawChange['author'])) { assignString(change, 'author', rawChange['author']['fullName'], 1000); }
    changes.push(change);
    if (changes.length >= MAX_BUILD_CHANGES) { break; }
  }
  return changes;
}

function normalizeJenkinsTestReport(value: unknown, maxTestCases: number): JenkinsTestReportContext | undefined {
  if (!isRecord(value) || !Array.isArray(value['suites'])) { return undefined; }
  const rawPassCount = nonNegativeInteger(value['passCount']);
  const rawFailCount = nonNegativeInteger(value['failCount']);
  const rawSkipCount = nonNegativeInteger(value['skipCount']);
  if (rawPassCount === undefined || rawFailCount === undefined || rawSkipCount === undefined) { return undefined; }
  const failedCases: JenkinsFailedTestCase[] = [];
  let failedCasesAvailable = 0;
  let caseRecordsAvailable = 0;
  let valid = true;
  for (const rawSuite of value['suites']) {
    if (!isRecord(rawSuite) || !Array.isArray(rawSuite['cases'])) {
      valid = false;
      continue;
    }
    for (const rawCase of rawSuite['cases']) {
      if (!isRecord(rawCase)) {
        valid = false;
        continue;
      }
      caseRecordsAvailable += 1;
      const status = boundedProviderText(rawCase['status'], 500) || 'UNKNOWN';
      if (!isFailedTestStatus(status)) { continue; }
      failedCasesAvailable += 1;
      if (failedCases.length >= maxTestCases) { continue; }
      const normalizedName = boundedProviderText(rawCase['name'], 2000);
      if (!normalizedName || status === 'UNKNOWN'
        || providerTextExceedsSafetyLimit(rawCase['status'], 500)
        || providerTextExceedsSafetyLimit(rawCase['name'], 2000)
        || providerTextExceedsSafetyLimit(rawCase['className'], 4000)
        || providerTextExceedsSafetyLimit(rawCase['errorDetails'], 8000)
        || providerTextExceedsSafetyLimit(rawCase['errorStackTrace'], MAX_PROVIDER_TEXT_LENGTH)) {
        valid = false;
      }
      const name = normalizedName || 'Unnamed test';
      const testCase: JenkinsFailedTestCase = { name, status };
      assignString(testCase, 'className', rawCase['className'], 4000);
      assignNonNegativeNumber(testCase, 'duration', rawCase['duration']);
      assignString(testCase, 'errorDetails', rawCase['errorDetails'], 8000);
      assignString(testCase, 'errorStackTrace', rawCase['errorStackTrace'], MAX_PROVIDER_TEXT_LENGTH);
      failedCases.push(testCase);
    }
  }
  const passCount = rawPassCount;
  const failCount = rawFailCount;
  const skipCount = rawSkipCount;
  const computedTotalCount = passCount + failCount + skipCount;
  const providerTotalCount = nonNegativeInteger(value['totalCount']);
  const totalCount = providerTotalCount ?? computedTotalCount;
  if (providerTotalCount !== undefined && providerTotalCount !== computedTotalCount) { valid = false; }
  if (caseRecordsAvailable !== computedTotalCount) { valid = false; }
  const report: JenkinsTestReportContext = {
    passCount,
    failCount,
    skipCount,
    totalCount,
    failedCases,
    failedCasesAvailable,
    complete: valid && failedCasesAvailable === failCount && failedCasesAvailable <= maxTestCases,
  };
  assignNonNegativeNumber(report, 'duration', value['duration']);
  return report;
}

function normalizeJenkinsStages(value: unknown, maxStages: number): {
  stages: JenkinsPipelineStage[];
  valid: boolean;
  truncated: boolean;
} {
  if (!isRecord(value) || !Array.isArray(value['stages'])) {
    return { stages: [], valid: false, truncated: false };
  }
  const source = value['stages'];
  const stages: JenkinsPipelineStage[] = [];
  let valid = true;
  for (const rawStage of source.slice(0, maxStages)) {
    if (!isRecord(rawStage)) {
      valid = false;
      continue;
    }
    const name = boundedProviderText(rawStage['name'], 2000);
    if (!name) {
      valid = false;
      continue;
    }
    if (providerTextExceedsSafetyLimit(rawStage['name'], 2000)
      || providerTextExceedsSafetyLimit(rawStage['status'], 500)
      || providerTextExceedsSafetyLimit(rawStage['id'], 500)) {
      valid = false;
    }
    const stage: JenkinsPipelineStage = {
      name,
      status: boundedProviderText(rawStage['status'], 500) || 'UNKNOWN',
    };
    assignString(stage, 'id', rawStage['id'], 500);
    assignNonNegativeNumber(stage, 'startTimeMillis', rawStage['startTimeMillis']);
    assignNonNegativeNumber(stage, 'durationMillis', rawStage['durationMillis']);
    assignNonNegativeNumber(stage, 'pauseDurationMillis', rawStage['pauseDurationMillis']);
    stages.push(stage);
  }
  return { stages, valid, truncated: source.length > maxStages };
}

function jenkinsHeaders(config: JenkinsRestConfig): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'kronos-jenkins-rest',
  };
  if (config.username && config.token) {
    headers.Authorization = `Basic ${Buffer.from(`${config.username}:${config.token}`).toString('base64')}`;
  } else if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }
  return headers;
}

function buildJenkinsUrl(jobUrl: string, suffix: string, query: Record<string, string | number | boolean>): string {
  const normalized = normalizeJenkinsJobUrl(jobUrl);
  if (!normalized) { throw new JenkinsRestError('Jenkins resource URL is invalid.'); }
  const base = `${normalized.replace(/\/+$/, '')}/`;
  const url = new URL(suffix.replace(/^\/+/, ''), base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function assertJenkinsCredentialOrigin(config: JenkinsRestConfig, requestUrl: string): void {
  if (!config.username && !config.token) { return; }
  if (!config.baseUrl) {
    throw new JenkinsRestError('Jenkins credentials require JENKINS_URL so credentialed requests can be pinned to one origin.');
  }
  const requestOrigin = new URL(requestUrl).origin;
  const configuredOrigin = new URL(config.baseUrl).origin;
  if (requestOrigin !== configuredOrigin) {
    throw new JenkinsRestError('Refused to send Jenkins credentials to a URL outside the configured JENKINS_URL origin.');
  }
}

function normalizeJenkinsHttpUrl(value: string, trimTrailingSlash = true): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHostname(url.hostname))) {
      return undefined;
    }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const normalized = url.toString();
    return trimTrailingSlash ? normalized.replace(/\/+$/, '') : normalized;
  } catch {
    return undefined;
  }
}

function sanitizeJenkinsReturnedUrl(value: string | undefined, expectedOrigin?: string): string | undefined {
  if (!value) { return undefined; }
  const normalized = normalizeJenkinsHttpUrl(value, false);
  if (!normalized || (expectedOrigin && safeUrlOrigin(normalized) !== expectedOrigin)) { return undefined; }
  return normalized;
}

function appendJenkinsBuildNumber(jobUrl: string, buildNumber: number | undefined): string {
  if (buildNumber === undefined) { return jobUrl; }
  return `${jobUrl.replace(/\/+$/, '')}/${buildNumber}/`;
}

function jenkinsJobUrlFromBuild(buildUrl: string, buildNumber: number): string | undefined {
  const normalized = normalizeJenkinsHttpUrl(buildUrl);
  if (!normalized) { return undefined; }
  try {
    const url = new URL(normalized);
    const suffix = `/${buildNumber}`;
    const pathName = url.pathname.replace(/\/+$/, '');
    if (!pathName.endsWith(suffix)) { return undefined; }
    url.pathname = `${pathName.slice(0, -suffix.length)}/`;
    return normalizeJenkinsHttpUrl(url.toString());
  } catch {
    return undefined;
  }
}

function sonarConfigurationFromJenkinsXml(value: string): { projectKey?: string; branch?: string } {
  const decoded = decodeBasicXmlEntities(value);
  const projectKey = literalSonarProperty(decoded, 'sonar.projectKey', /^[A-Za-z0-9_.:-]{1,400}$/);
  const branch = literalSonarProperty(decoded, 'sonar.branch.name', /^[A-Za-z0-9_./:-]{1,500}$/);
  return {
    ...(projectKey ? { projectKey } : {}),
    ...(branch ? { branch } : {}),
  };
}

function literalSonarProperty(value: string, property: string, allowed: RegExp): string | undefined {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates: Array<{ index: number; value: string }> = [];
  for (const match of value.matchAll(new RegExp(`<${escaped}>\\s*([^<]+?)\\s*</${escaped}>`, 'gi'))) {
    if (match[1]) { candidates.push({ index: match.index, value: match[1] }); }
  }
  const assignmentPattern = new RegExp(
    `(?:^|[\\s'"<>;])(?:-D)?${escaped}\\s*(?:=|:)\\s*(?:"([^"]+)"|'([^']+)'|([^\\s<>"';&]+))`,
    'gim',
  );
  for (const match of value.matchAll(assignmentPattern)) {
    const candidate = match[1] || match[2] || match[3];
    if (candidate) { candidates.push({ index: match.index, value: candidate }); }
  }
  for (const candidate of candidates.sort((left, right) => left.index - right.index)) {
    const literal = candidate.value.trim();
    if (literal && allowed.test(literal) && redactSensitiveTokens(literal) === literal) { return literal; }
  }
  return undefined;
}

function decodeBasicXmlEntities(value: string): string {
  return value.replace(/&(?:quot|apos|lt|gt|amp);/gi, entity => {
    const normalized = entity.toLowerCase();
    if (normalized === '&quot;') { return '"'; }
    if (normalized === '&apos;') { return "'"; }
    if (normalized === '&lt;') { return '<'; }
    if (normalized === '&gt;') { return '>'; }
    return '&';
  });
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function safeUrlOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function firstBuildRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(value => isRecord(value) && nonNegativeInteger(value['number']) !== undefined) as Record<string, unknown> | undefined;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find(value => value !== undefined && value !== null);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) { return trimmed; }
  }
  return undefined;
}

function looksLikeBuildRecord(record: Record<string, unknown>): boolean {
  return record['number'] !== undefined;
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

function providerTextExceedsSafetyLimit(value: unknown, maxLength: number): boolean {
  const text = optionalTrimmedStringFromUnknown(value);
  return Boolean(text && text.length > maxLength);
}

function isFailedTestStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return !['PASSED', 'PASS', 'FIXED', 'SKIPPED', 'SKIP', 'SUCCESS'].includes(normalized);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function safeJenkinsOptionalWarning(label: string, error: unknown): string {
  if (error instanceof JenkinsRestError) { return error.message; }
  const code = unknownErrorCode(error);
  return `${label} could not be fetched${code ? ` (${code})` : ''}; response content is not displayed.`;
}

function parseJenkinsJson(body: string, label: string): unknown {
  try {
    return parseJsonWithLabel(body, label);
  } catch {
    throw new JenkinsRestError(`Jenkins REST ${label} returned invalid JSON. Response content is not displayed.`);
  }
}

function jenkinsHttpError(label: string, statusCode: number): JenkinsRestError {
  if (statusCode === 401 || statusCode === 403) {
    return new JenkinsRestError(`Jenkins REST ${label} failed with HTTP ${statusCode}. Check Jenkins credentials; values are not displayed.`);
  }
  if (statusCode === 404) {
    return new JenkinsRestError(`Jenkins REST ${label} failed with HTTP 404. The job or build may be missing or unavailable.`);
  }
  if (statusCode === 429) {
    return new JenkinsRestError(`Jenkins REST ${label} failed with HTTP 429. Jenkins rate limiting prevented the fetch.`);
  }
  return new JenkinsRestError(`Jenkins REST ${label} failed with HTTP ${statusCode}. Response content is not displayed.`);
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) { return fallback; }
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

export class JenkinsRestError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, JenkinsRestError.prototype);
    this.name = 'JenkinsRestError';
  }
}

function defaultJenkinsTransport(request: JenkinsHttpRequest): Promise<JenkinsHttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch {
      reject(new JenkinsRestError('Invalid Jenkins REST URL.'));
      return;
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname))) {
      reject(new JenkinsRestError('Jenkins REST requires HTTPS except for loopback development.'));
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
          reject(new JenkinsRestError(`Jenkins REST response exceeded the ${request.maxResponseBytes}-byte safety limit.`));
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
        reject(new JenkinsRestError('Jenkins REST response ended unexpectedly.'));
      });
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new JenkinsRestError(`Timed out after ${request.timeoutMs}ms reaching Jenkins REST API.`));
    });
    req.on('error', () => {
      reject(new JenkinsRestError('Jenkins REST network request failed.'));
    });
    req.end();
  });
}
