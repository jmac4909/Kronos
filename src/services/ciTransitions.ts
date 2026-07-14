import * as crypto from 'crypto';
import type { JenkinsBuildContext } from './jenkinsRestClient';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';
import { redactSensitiveTokens } from './sensitiveText';
import type { SonarBranchContext } from './sonarRestClient';

export type JenkinsCiTransitionKind =
  | 'jenkins_new_build'
  | 'jenkins_failed'
  | 'jenkins_recovered'
  | 'jenkins_succeeded'
  | 'jenkins_tests_failed'
  | 'jenkins_tests_recovered'
  | 'jenkins_stages_failed'
  | 'jenkins_stages_recovered';

export type SonarCiTransitionKind =
  | 'sonar_gate_failed'
  | 'sonar_gate_recovered'
  | 'sonar_issues_increased'
  | 'sonar_issues_decreased';

export type CiMonitorTransitionKind = JenkinsCiTransitionKind | SonarCiTransitionKind;

export interface JenkinsCiDigest {
  schemaVersion: 1;
  provider: 'jenkins';
  jobOrBuildUrl: string;
  buildUrl: string;
  buildNumber: number;
  status: string;
  building: boolean;
  testsAvailable: boolean;
  failedTestCount: number;
  stagesAvailable: boolean;
  failedStageNames: string[];
  failedStageNamesTruncated: boolean;
  fingerprint: string;
}

export interface SonarMetricDigest {
  metric: string;
  value?: string;
  periodValue?: string;
}

export interface SonarCiDigest {
  schemaVersion: 1;
  provider: 'sonarqube';
  projectKey: string;
  branch: string;
  dashboardUrl: string;
  gateAvailable: boolean;
  gateStatus: string;
  issueCountAvailable: boolean;
  unresolvedIssueCount: number;
  metricsAvailable: boolean;
  metrics: SonarMetricDigest[];
  fingerprint: string;
}

export interface CiMonitorDigest {
  schemaVersion: 1;
  fingerprint: string;
  jenkins?: JenkinsCiDigest;
  sonar?: SonarCiDigest;
}

export interface CiMonitorContextInput {
  jenkins?: JenkinsBuildContext;
  sonar?: SonarBranchContext;
}

interface CiTransitionBase {
  key: string;
  kind: CiMonitorTransitionKind;
  previousFingerprint: string;
  currentFingerprint: string;
}

export interface JenkinsCiTransition extends CiTransitionBase {
  provider: 'jenkins';
  kind: JenkinsCiTransitionKind;
  buildNumber: number;
  previousBuildNumber: number;
  status: string;
  previousStatus: string;
  building: boolean;
  failedTestCount: number;
  failedStageNames: string[];
  affectedStageNames: string[];
  url: string;
}

export interface SonarCiTransition extends CiTransitionBase {
  provider: 'sonarqube';
  kind: SonarCiTransitionKind;
  projectKey: string;
  branch: string;
  gateStatus: string;
  previousGateStatus: string;
  unresolvedIssueCount: number;
  previousUnresolvedIssueCount: number;
  issueDelta: number;
  url: string;
}

export type CiMonitorTransition = JenkinsCiTransition | SonarCiTransition;

interface JenkinsDigestMaterial {
  schemaVersion: 1;
  provider: 'jenkins';
  jobOrBuildUrl: string;
  buildUrl: string;
  buildNumber: number;
  status: string;
  building: boolean;
  testsAvailable: boolean;
  failedTestCount: number;
  stagesAvailable: boolean;
  failedStageNames: string[];
  failedStageNamesTruncated: boolean;
}

interface SonarDigestMaterial {
  schemaVersion: 1;
  provider: 'sonarqube';
  projectKey: string;
  branch: string;
  dashboardUrl: string;
  gateAvailable: boolean;
  gateStatus: string;
  issueCountAvailable: boolean;
  unresolvedIssueCount: number;
  metricsAvailable: boolean;
  metrics: SonarMetricDigest[];
}

const MAX_STATUS_CHARS = 64;
const MAX_PROJECT_KEY_CHARS = 500;
const MAX_BRANCH_CHARS = 1_000;
const MAX_URL_CHARS = 8_192;
const MAX_SOURCE_STAGES = 1_000;
const MAX_FAILED_STAGES = 100;
const MAX_STAGE_NAME_CHARS = 256;
const MAX_SOURCE_METRICS = 256;
const MAX_METRICS = 64;
const MAX_METRIC_KEY_CHARS = 128;
const MAX_METRIC_VALUE_CHARS = 256;
const MAX_SOURCE_ISSUES = 10_000;
const MAX_COUNT = 1_000_000_000;

const FAILURE_STATUSES = new Set(['error', 'failed', 'failure', 'unstable']);
const SUCCESS_STATUSES = new Set(['ok', 'passed', 'success', 'succeeded']);
const SONAR_GATE_FAILURE_STATUSES = new Set(['error', 'failed', 'failure']);
const SONAR_GATE_SUCCESS_STATUSES = new Set(['ok', 'passed', 'success', 'succeeded']);
const RESOLVED_ISSUE_STATUSES = new Set([
  'closed',
  'false_positive',
  'fixed',
  'removed',
  'resolved',
  'wont_fix',
  'wontfix',
]);
const KEY_SONAR_METRICS = new Set([
  'alert_status',
  'bugs',
  'code_smells',
  'coverage',
  'duplicated_lines_density',
  'maintainability_rating',
  'ncloc',
  'new_coverage',
  'new_duplicated_lines_density',
  'new_maintainability_rating',
  'new_reliability_rating',
  'new_security_rating',
  'reliability_rating',
  'security_hotspots',
  'security_rating',
  'skipped_tests',
  'sqale_rating',
  'test_errors',
  'test_failures',
  'test_success_density',
  'tests',
  'vulnerabilities',
]);

export function jenkinsCiDigestFromContext(context: JenkinsBuildContext): JenkinsCiDigest | null;
export function jenkinsCiDigestFromContext(context: unknown): JenkinsCiDigest | null;
export function jenkinsCiDigestFromContext(context: unknown): JenkinsCiDigest | null {
  if (!isRecord(context) || context['provider'] !== 'jenkins' || !isRecord(context['build'])) { return null; }
  const build = context['build'];
  const jobOrBuildUrl = safeProviderUrl(context['jobOrBuildUrl']);
  const buildNumber = boundedNonNegativeInteger(build['number']);
  if (!jobOrBuildUrl || buildNumber === undefined) { return null; }
  const suppliedBuildUrl = safeProviderUrl(build['url']);
  const buildUrl = suppliedBuildUrl && sameOrigin(jobOrBuildUrl, suppliedBuildUrl)
    ? suppliedBuildUrl
    : jobOrBuildUrl;
  const tests = isRecord(context['tests']) ? context['tests'] : undefined;
  const completeness = isRecord(context['completeness']) ? context['completeness'] : {};
  const testsAvailable = Boolean(tests)
    && completeness['testReport'] === 'complete'
    && tests?.['complete'] !== false;
  const failedTestCount = tests ? boundedCount(tests['failCount']) : 0;
  const stageResult = failedStagesFromContext(context['stages']);
  return createJenkinsDigest({
    schemaVersion: 1,
    provider: 'jenkins',
    jobOrBuildUrl,
    buildUrl,
    buildNumber,
    status: normalizedStatus(build['status']),
    building: build['building'] === true,
    testsAvailable,
    failedTestCount,
    stagesAvailable: Array.isArray(context['stages']) && completeness['stages'] === 'complete',
    failedStageNames: stageResult.names,
    failedStageNamesTruncated: stageResult.truncated,
  });
}

export function sonarCiDigestFromContext(context: SonarBranchContext): SonarCiDigest | null;
export function sonarCiDigestFromContext(context: unknown): SonarCiDigest | null;
export function sonarCiDigestFromContext(context: unknown): SonarCiDigest | null {
  if (!isRecord(context) || context['provider'] !== 'sonarqube' || !isRecord(context['qualityGate'])) {
    return null;
  }
  const projectKey = boundedSingleLine(context['projectKey'], MAX_PROJECT_KEY_CHARS);
  const branch = boundedSingleLine(context['branch'], MAX_BRANCH_CHARS);
  const dashboardUrl = safeSonarDashboardUrl(context['dashboardUrl'], projectKey, branch);
  if (!projectKey || !branch || !dashboardUrl) { return null; }
  const completeness = isRecord(context['completeness']) ? context['completeness'] : {};
  const reportedTotal = boundedNonNegativeInteger(completeness['issuesTotal']);
  const issues = arrayFromUnknown(context['issues']);
  const issueCountAvailable = reportedTotal !== undefined || completeness['issuesComplete'] === true;
  const unresolvedIssueCount = reportedTotal ?? countUnresolvedIssues(issues);
  return createSonarDigest({
    schemaVersion: 1,
    provider: 'sonarqube',
    projectKey,
    branch,
    dashboardUrl,
    gateAvailable: completeness['qualityGateComplete'] === true,
    gateStatus: normalizedStatus(context['qualityGate']['status']),
    issueCountAvailable,
    unresolvedIssueCount,
    metricsAvailable: completeness['measuresComplete'] === true,
    metrics: metricsFromContext(context['measures']),
  });
}

export function normalizeJenkinsCiDigest(value: unknown): JenkinsCiDigest | null {
  if (!isRecord(value)
    || value['schemaVersion'] !== 1
    || value['provider'] !== 'jenkins'
    || typeof value['building'] !== 'boolean'
    || typeof value['testsAvailable'] !== 'boolean'
    || typeof value['stagesAvailable'] !== 'boolean'
    || typeof value['failedStageNamesTruncated'] !== 'boolean') {
    return null;
  }
  const jobOrBuildUrl = safeProviderUrl(value['jobOrBuildUrl']);
  const suppliedBuildUrl = safeProviderUrl(value['buildUrl']);
  const buildNumber = boundedNonNegativeInteger(value['buildNumber']);
  const failedTestCount = boundedNonNegativeInteger(value['failedTestCount']);
  const failedStageNames = normalizeStoredStageNames(value['failedStageNames']);
  if (!jobOrBuildUrl
    || !suppliedBuildUrl
    || !sameOrigin(jobOrBuildUrl, suppliedBuildUrl)
    || buildNumber === undefined
    || failedTestCount === undefined
    || failedStageNames === null) {
    return null;
  }
  return createJenkinsDigest({
    schemaVersion: 1,
    provider: 'jenkins',
    jobOrBuildUrl,
    buildUrl: suppliedBuildUrl,
    buildNumber,
    status: normalizedStatus(value['status']),
    building: value['building'],
    testsAvailable: value['testsAvailable'],
    failedTestCount,
    stagesAvailable: value['stagesAvailable'],
    failedStageNames,
    failedStageNamesTruncated: value['failedStageNamesTruncated'],
  });
}

export function normalizeSonarCiDigest(value: unknown): SonarCiDigest | null {
  if (!isRecord(value)
    || value['schemaVersion'] !== 1
    || value['provider'] !== 'sonarqube'
    || typeof value['gateAvailable'] !== 'boolean'
    || typeof value['issueCountAvailable'] !== 'boolean'
    || typeof value['metricsAvailable'] !== 'boolean') {
    return null;
  }
  const projectKey = boundedSingleLine(value['projectKey'], MAX_PROJECT_KEY_CHARS);
  const branch = boundedSingleLine(value['branch'], MAX_BRANCH_CHARS);
  const dashboardUrl = safeSonarDashboardUrl(value['dashboardUrl'], projectKey, branch);
  const unresolvedIssueCount = boundedNonNegativeInteger(value['unresolvedIssueCount']);
  const metrics = normalizeStoredMetrics(value['metrics']);
  if (!projectKey || !branch || !dashboardUrl || unresolvedIssueCount === undefined || metrics === null) {
    return null;
  }
  return createSonarDigest({
    schemaVersion: 1,
    provider: 'sonarqube',
    projectKey,
    branch,
    dashboardUrl,
    gateAvailable: value['gateAvailable'],
    gateStatus: normalizedStatus(value['gateStatus']),
    issueCountAvailable: value['issueCountAvailable'],
    unresolvedIssueCount,
    metricsAvailable: value['metricsAvailable'],
    metrics,
  });
}

export function buildCiMonitorDigest(input: CiMonitorContextInput): CiMonitorDigest | null;
export function buildCiMonitorDigest(input: { jenkins?: unknown; sonar?: unknown }): CiMonitorDigest | null;
export function buildCiMonitorDigest(
  input: { jenkins?: unknown; sonar?: unknown },
): CiMonitorDigest | null {
  const jenkins = input.jenkins === undefined ? null : jenkinsCiDigestFromContext(input.jenkins);
  const sonar = input.sonar === undefined ? null : sonarCiDigestFromContext(input.sonar);
  if (!jenkins && !sonar) { return null; }
  return createCombinedDigest(jenkins, sonar);
}

export function normalizeCiMonitorDigest(value: unknown): CiMonitorDigest | null {
  if (!isRecord(value) || value['schemaVersion'] !== 1) { return null; }
  const jenkins = value['jenkins'] === undefined ? null : normalizeJenkinsCiDigest(value['jenkins']);
  const sonar = value['sonar'] === undefined ? null : normalizeSonarCiDigest(value['sonar']);
  if ((value['jenkins'] !== undefined && !jenkins)
    || (value['sonar'] !== undefined && !sonar)
    || (!jenkins && !sonar)) {
    return null;
  }
  return createCombinedDigest(jenkins, sonar);
}

export function mergeCiMonitorDigest(previousValue: unknown, currentValue: unknown): CiMonitorDigest | null {
  const previous = normalizeCiMonitorDigest(previousValue);
  const current = normalizeCiMonitorDigest(currentValue);
  if (!current) { return null; }

  let jenkins = current.jenkins;
  if (jenkins && previous?.jenkins
    && jenkinsResourceIdentity(jenkins.jobOrBuildUrl) === jenkinsResourceIdentity(previous.jenkins.jobOrBuildUrl)
    && jenkins.buildNumber === previous.jenkins.buildNumber) {
    jenkins = normalizeJenkinsCiDigest({
      ...jenkins,
      testsAvailable: jenkins.testsAvailable || previous.jenkins.testsAvailable,
      failedTestCount: jenkins.testsAvailable ? jenkins.failedTestCount : previous.jenkins.failedTestCount,
      stagesAvailable: jenkins.stagesAvailable || previous.jenkins.stagesAvailable,
      failedStageNames: jenkins.stagesAvailable ? jenkins.failedStageNames : previous.jenkins.failedStageNames,
      failedStageNamesTruncated: jenkins.stagesAvailable
        ? jenkins.failedStageNamesTruncated
        : previous.jenkins.failedStageNamesTruncated,
    }) || jenkins;
  }

  let sonar = current.sonar;
  if (sonar && previous?.sonar
    && sonar.projectKey === previous.sonar.projectKey
    && sonar.branch === previous.sonar.branch) {
    sonar = normalizeSonarCiDigest({
      ...sonar,
      gateAvailable: sonar.gateAvailable || previous.sonar.gateAvailable,
      gateStatus: sonar.gateAvailable ? sonar.gateStatus : previous.sonar.gateStatus,
      issueCountAvailable: sonar.issueCountAvailable || previous.sonar.issueCountAvailable,
      unresolvedIssueCount: sonar.issueCountAvailable
        ? sonar.unresolvedIssueCount
        : previous.sonar.unresolvedIssueCount,
      metricsAvailable: sonar.metricsAvailable || previous.sonar.metricsAvailable,
      metrics: sonar.metricsAvailable ? sonar.metrics : previous.sonar.metrics,
    }) || sonar;
  }
  return createCombinedDigest(jenkins || null, sonar || null);
}

export function compareJenkinsCiDigests(previousValue: unknown, currentValue: unknown): JenkinsCiTransition[] {
  const previous = normalizeJenkinsCiDigest(previousValue);
  const current = normalizeJenkinsCiDigest(currentValue);
  if (!previous || !current || previous.fingerprint === current.fingerprint) { return []; }
  const comparableResource = jenkinsResourceIdentity(previous.jobOrBuildUrl)
    === jenkinsResourceIdentity(current.jobOrBuildUrl);
  const newBuild = previous.buildNumber !== current.buildNumber || !comparableResource;
  const transitions: JenkinsCiTransition[] = [];

  if (newBuild) {
    transitions.push(makeJenkinsTransition('jenkins_new_build', previous, current, []));
  }
  if (comparableResource) {
    appendJenkinsStatusTransitions(transitions, previous, current, newBuild);
    appendJenkinsTestTransitions(transitions, previous, current, newBuild);
    appendJenkinsStageTransitions(transitions, previous, current, newBuild);
  }
  return transitions;
}

export function compareSonarCiDigests(previousValue: unknown, currentValue: unknown): SonarCiTransition[] {
  const previous = normalizeSonarCiDigest(previousValue);
  const current = normalizeSonarCiDigest(currentValue);
  if (!previous
    || !current
    || previous.fingerprint === current.fingerprint
    || previous.projectKey !== current.projectKey
    || previous.branch !== current.branch) {
    return [];
  }
  const transitions: SonarCiTransition[] = [];
  if (current.gateAvailable) {
    const previousGateFailed = sonarGateFailed(previous.gateStatus);
    const currentGateFailed = sonarGateFailed(current.gateStatus);
    if (currentGateFailed && (!previous.gateAvailable || !previousGateFailed)) {
      transitions.push(makeSonarTransition('sonar_gate_failed', previous, current));
    } else if (previous.gateAvailable && previousGateFailed && sonarGateSucceeded(current.gateStatus)) {
      transitions.push(makeSonarTransition('sonar_gate_recovered', previous, current));
    }
  }
  if (previous.issueCountAvailable && current.issueCountAvailable) {
    if (current.unresolvedIssueCount > previous.unresolvedIssueCount) {
      transitions.push(makeSonarTransition('sonar_issues_increased', previous, current));
    } else if (current.unresolvedIssueCount < previous.unresolvedIssueCount) {
      transitions.push(makeSonarTransition('sonar_issues_decreased', previous, current));
    }
  }
  return transitions;
}

export function compareCiMonitorDigests(previousValue: unknown, currentValue: unknown): CiMonitorTransition[] {
  const previous = normalizeCiMonitorDigest(previousValue);
  const current = normalizeCiMonitorDigest(currentValue);
  if (!previous || !current || previous.fingerprint === current.fingerprint) { return []; }
  const transitions: CiMonitorTransition[] = [];
  if (previous.jenkins && current.jenkins) {
    transitions.push(...compareJenkinsCiDigests(previous.jenkins, current.jenkins));
  }
  if (previous.sonar && current.sonar) {
    transitions.push(...compareSonarCiDigests(previous.sonar, current.sonar));
  }
  return transitions;
}

function createJenkinsDigest(material: JenkinsDigestMaterial): JenkinsCiDigest {
  return { ...material, fingerprint: stableFingerprint(material) };
}

function createSonarDigest(material: SonarDigestMaterial): SonarCiDigest {
  return { ...material, fingerprint: stableFingerprint(material) };
}

function createCombinedDigest(
  jenkins: JenkinsCiDigest | null,
  sonar: SonarCiDigest | null,
): CiMonitorDigest {
  const material: { schemaVersion: 1; jenkins?: string; sonar?: string } = { schemaVersion: 1 };
  const digest: CiMonitorDigest = { schemaVersion: 1, fingerprint: '' };
  if (jenkins) {
    material.jenkins = jenkins.fingerprint;
    digest.jenkins = jenkins;
  }
  if (sonar) {
    material.sonar = sonar.fingerprint;
    digest.sonar = sonar;
  }
  digest.fingerprint = stableFingerprint(material);
  return digest;
}

function appendJenkinsStatusTransitions(
  transitions: JenkinsCiTransition[],
  previous: JenkinsCiDigest,
  current: JenkinsCiDigest,
  newBuild: boolean,
): void {
  const previousFailed = jenkinsFailed(previous.status);
  const currentFailed = jenkinsFailed(current.status);
  if (currentFailed && (!previousFailed || newBuild)) {
    transitions.push(makeJenkinsTransition('jenkins_failed', previous, current, current.failedStageNames));
    return;
  }
  if (jenkinsSucceeded(current.status) && !jenkinsSucceeded(previous.status)) {
    transitions.push(makeJenkinsTransition(
      previousFailed ? 'jenkins_recovered' : 'jenkins_succeeded',
      previous,
      current,
      [],
    ));
  }
}

function appendJenkinsTestTransitions(
  transitions: JenkinsCiTransition[],
  previous: JenkinsCiDigest,
  current: JenkinsCiDigest,
  newBuild: boolean,
): void {
  if (!current.testsAvailable) { return; }
  if (current.failedTestCount > 0
    && (!previous.testsAvailable || previous.failedTestCount === 0 || newBuild)) {
    transitions.push(makeJenkinsTransition('jenkins_tests_failed', previous, current, []));
  } else if (previous.testsAvailable
    && previous.failedTestCount > 0
    && current.failedTestCount === 0) {
    transitions.push(makeJenkinsTransition('jenkins_tests_recovered', previous, current, []));
  }
}

function appendJenkinsStageTransitions(
  transitions: JenkinsCiTransition[],
  previous: JenkinsCiDigest,
  current: JenkinsCiDigest,
  newBuild: boolean,
): void {
  if (!current.stagesAvailable) { return; }
  const previousNames = new Set(previous.failedStageNames);
  const currentNames = new Set(current.failedStageNames);
  const newlyFailed = newBuild
    ? [...currentNames]
    : [...currentNames].filter(name => !previousNames.has(name));
  const recovered = previous.stagesAvailable
    ? (newBuild
      ? (currentNames.size === 0 ? [...previousNames] : [])
      : [...previousNames].filter(name => !currentNames.has(name)))
    : [];
  if (newlyFailed.length > 0) {
    transitions.push(makeJenkinsTransition('jenkins_stages_failed', previous, current, newlyFailed));
  }
  if (recovered.length > 0) {
    transitions.push(makeJenkinsTransition('jenkins_stages_recovered', previous, current, recovered));
  }
}

function makeJenkinsTransition(
  kind: JenkinsCiTransitionKind,
  previous: JenkinsCiDigest,
  current: JenkinsCiDigest,
  affectedStageNames: string[],
): JenkinsCiTransition {
  const affected = [...new Set(affectedStageNames)].sort().slice(0, MAX_FAILED_STAGES);
  return {
    provider: 'jenkins',
    kind,
    key: stableFingerprint({
      provider: 'jenkins',
      kind,
      previousFingerprint: previous.fingerprint,
      currentFingerprint: current.fingerprint,
      affectedStageNames: affected,
    }),
    previousFingerprint: previous.fingerprint,
    currentFingerprint: current.fingerprint,
    buildNumber: current.buildNumber,
    previousBuildNumber: previous.buildNumber,
    status: current.status,
    previousStatus: previous.status,
    building: current.building,
    failedTestCount: current.failedTestCount,
    failedStageNames: [...current.failedStageNames],
    affectedStageNames: affected,
    url: current.buildUrl,
  };
}

function makeSonarTransition(
  kind: SonarCiTransitionKind,
  previous: SonarCiDigest,
  current: SonarCiDigest,
): SonarCiTransition {
  return {
    provider: 'sonarqube',
    kind,
    key: stableFingerprint({
      provider: 'sonarqube',
      kind,
      previousFingerprint: previous.fingerprint,
      currentFingerprint: current.fingerprint,
    }),
    previousFingerprint: previous.fingerprint,
    currentFingerprint: current.fingerprint,
    projectKey: current.projectKey,
    branch: current.branch,
    gateStatus: current.gateStatus,
    previousGateStatus: previous.gateStatus,
    unresolvedIssueCount: current.unresolvedIssueCount,
    previousUnresolvedIssueCount: previous.unresolvedIssueCount,
    issueDelta: current.unresolvedIssueCount - previous.unresolvedIssueCount,
    url: current.dashboardUrl,
  };
}

function failedStagesFromContext(value: unknown): { names: string[]; truncated: boolean } {
  if (!Array.isArray(value)) { return { names: [], truncated: false }; }
  const source = value.slice(0, MAX_SOURCE_STAGES);
  const failedNames: string[] = [];
  let truncated = value.length > MAX_SOURCE_STAGES;
  for (const stage of source) {
    if (!isRecord(stage) || !stageFailed(normalizedStatus(stage['status']))) { continue; }
    const rawName = optionalTrimmedStringFromUnknown(stage['name']) || '';
    const name = boundedSingleLine(rawName, MAX_STAGE_NAME_CHARS);
    if (!name) {
      truncated = true;
      continue;
    }
    if (rawName.length > MAX_STAGE_NAME_CHARS) { truncated = true; }
    failedNames.push(name);
  }
  const uniqueNames = [...new Set(failedNames)].sort();
  return {
    names: uniqueNames.slice(0, MAX_FAILED_STAGES),
    truncated: truncated || uniqueNames.length > MAX_FAILED_STAGES,
  };
}

function normalizeStoredStageNames(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_FAILED_STAGES) { return null; }
  const names: string[] = [];
  for (const item of value) {
    const name = boundedSingleLine(item, MAX_STAGE_NAME_CHARS);
    if (!name || name !== item) { return null; }
    names.push(name);
  }
  return [...new Set(names)].sort();
}

function metricsFromContext(value: unknown): SonarMetricDigest[] {
  const byMetric = new Map<string, SonarMetricDigest>();
  for (const item of arrayFromUnknown(value).slice(0, MAX_SOURCE_METRICS)) {
    if (!isRecord(item)) { continue; }
    const metric = boundedMetricKey(item['metric']);
    if (!metric || !KEY_SONAR_METRICS.has(metric)) { continue; }
    const digest: SonarMetricDigest = { metric };
    const measureValue = boundedSingleLine(item['value'], MAX_METRIC_VALUE_CHARS);
    const periodValue = boundedSingleLine(item['periodValue'], MAX_METRIC_VALUE_CHARS);
    if (measureValue) { digest.value = measureValue; }
    if (periodValue) { digest.periodValue = periodValue; }
    byMetric.set(metric, digest);
  }
  return [...byMetric.values()]
    .sort((left, right) => left.metric.localeCompare(right.metric))
    .slice(0, MAX_METRICS);
}

function normalizeStoredMetrics(value: unknown): SonarMetricDigest[] | null {
  if (!Array.isArray(value) || value.length > MAX_METRICS) { return null; }
  const byMetric = new Map<string, SonarMetricDigest>();
  for (const item of value) {
    if (!isRecord(item)) { return null; }
    const metric = boundedMetricKey(item['metric']);
    if (!metric || !KEY_SONAR_METRICS.has(metric) || byMetric.has(metric)) { return null; }
    const digest: SonarMetricDigest = { metric };
    if (item['value'] !== undefined) {
      const measureValue = boundedSingleLine(item['value'], MAX_METRIC_VALUE_CHARS);
      if (!measureValue || measureValue !== item['value']) { return null; }
      digest.value = measureValue;
    }
    if (item['periodValue'] !== undefined) {
      const periodValue = boundedSingleLine(item['periodValue'], MAX_METRIC_VALUE_CHARS);
      if (!periodValue || periodValue !== item['periodValue']) { return null; }
      digest.periodValue = periodValue;
    }
    byMetric.set(metric, digest);
  }
  return [...byMetric.values()].sort((left, right) => left.metric.localeCompare(right.metric));
}

function countUnresolvedIssues(value: unknown[]): number {
  let count = 0;
  for (const issue of value.slice(0, MAX_SOURCE_ISSUES)) {
    if (!isRecord(issue)) { continue; }
    const resolution = normalizedStatus(issue['resolution']);
    const issueStatus = normalizedStatus(issue['issueStatus'] ?? issue['status']);
    if (resolution !== 'unknown' || RESOLVED_ISSUE_STATUSES.has(issueStatus)) { continue; }
    count += 1;
  }
  return Math.min(count, MAX_COUNT);
}

function jenkinsFailed(status: string): boolean {
  return FAILURE_STATUSES.has(status) || status.startsWith('failed_') || status.endsWith('_failed');
}

function jenkinsSucceeded(status: string): boolean {
  return SUCCESS_STATUSES.has(status);
}

function stageFailed(status: string): boolean {
  return jenkinsFailed(status);
}

function sonarGateFailed(status: string): boolean {
  return SONAR_GATE_FAILURE_STATUSES.has(status);
}

function sonarGateSucceeded(status: string): boolean {
  return SONAR_GATE_SUCCESS_STATUSES.has(status);
}

function jenkinsResourceIdentity(value: string): string {
  try {
    const parsed = new URL(value);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length > 0 && /^\d+$/.test(segments[segments.length - 1] || '')) {
      segments.pop();
    }
    return `${parsed.origin}/${segments.join('/')}`.replace(/\/$/, '');
  } catch {
    return value;
  }
}

function normalizedStatus(value: unknown): string {
  const raw = boundedSingleLine(value, MAX_STATUS_CHARS).toLowerCase().replace(/[\s-]+/g, '_');
  return /^[a-z][a-z0-9_]*$/.test(raw) ? raw : 'unknown';
}

function boundedMetricKey(value: unknown): string {
  const metric = boundedSingleLine(value, MAX_METRIC_KEY_CHARS).toLowerCase();
  return /^[a-z][a-z0-9_]*$/.test(metric) ? metric : '';
}

function boundedSingleLine(value: unknown, maxLength: number): string {
  const text = optionalTrimmedStringFromUnknown(value) || '';
  return redactSensitiveTokens(text)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function boundedCount(value: unknown): number {
  return boundedNonNegativeInteger(value) ?? 0;
}

function boundedNonNegativeInteger(value: unknown): number | undefined {
  const numeric = optionalFiniteNumberFromUnknown(value);
  if (numeric === undefined || !Number.isSafeInteger(numeric) || numeric < 0) { return undefined; }
  return Math.min(numeric, MAX_COUNT);
}

function safeProviderUrl(value: unknown): string {
  const raw = optionalTrimmedStringFromUnknown(value);
  if (!raw || raw.length > MAX_URL_CHARS) { return ''; }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') { return ''; }
    parsed.username = '';
    parsed.password = '';
    parsed.search = '';
    parsed.hash = '';
    const normalized = parsed.toString();
    return normalized.length <= MAX_URL_CHARS ? normalized : '';
  } catch {
    return '';
  }
}

function safeSonarDashboardUrl(value: unknown, projectKey: string, branch: string): string {
  const base = safeProviderUrl(value);
  if (!base) { return ''; }
  try {
    const parsed = new URL(base);
    parsed.searchParams.set('id', projectKey);
    parsed.searchParams.set('branch', branch);
    const normalized = parsed.toString();
    return normalized.length <= MAX_URL_CHARS ? normalized : '';
  } catch {
    return '';
  }
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

function stableFingerprint(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
