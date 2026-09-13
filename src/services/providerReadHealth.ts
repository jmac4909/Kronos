import * as crypto from 'crypto';
import type { JenkinsBuildContext } from './jenkinsRestClient';
import type { SonarBranchContext } from './sonarRestClient';
import { boundedOperationFailure, type OperationFailureKind } from './errorUtils';

export type ProviderReadState = 'complete' | 'partial' | 'failed';

const DIRECT_READ_FAILURE_REASONS: Partial<Record<OperationFailureKind, string>> = Object.freeze({
  authentication: 'authentication',
  permission: 'permission',
  not_found: 'not_found',
  rate_limit: 'rate_limited',
  response_limit: 'safety_limit',
  configuration: 'configuration',
  timeout: 'timeout',
  dns: 'dns',
  tls: 'tls',
  network: 'network',
});

const READ_FAILURE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  authentication: 'authentication unavailable',
  permission: 'read permission unavailable',
  not_found: 'merge request not found',
  rate_limited: 'provider rate limited',
  provider_5xx: 'provider server error',
  provider_4xx: 'provider request refused',
  timeout: 'request timed out',
  dns: 'provider hostname unavailable',
  tls: 'provider TLS verification failed',
  safety_limit: 'bounded read limit reached',
  configuration: 'provider configuration unavailable',
  network: 'network unavailable',
  malformed_response: 'provider response was malformed',
});

export function providerReadFailureReason(error: unknown): string {
  const failure = boundedOperationFailure(error, 'Provider read unavailable.');
  const directReason = DIRECT_READ_FAILURE_REASONS[failure.kind];
  if (directReason) { return directReason; }
  const statusMatch = /\bhttp\s+(\d{3})\b/.exec(failure.summary.toLowerCase());
  const status = statusMatch?.[1] ? Number(statusMatch[1]) : undefined;
  if (status !== undefined && status >= 500) { return 'provider_5xx'; }
  if (status !== undefined) { return 'provider_4xx'; }
  return failure.kind === 'malformed_response' ? 'malformed_response' : 'unavailable';
}

export function readFailureLabel(reason: string): string {
  if (!Object.prototype.hasOwnProperty.call(READ_FAILURE_LABELS, reason)) {
    return 'provider unavailable';
  }
  return READ_FAILURE_LABELS[reason]!;
}

export function deterministicReadStatusFingerprint(
  provider: 'jenkins' | 'sonar',
  state: ProviderReadState,
  reason: string,
  generation: number,
  components: string,
): string {
  return crypto.createHash('sha256')
    .update(JSON.stringify({ provider, state, reason, generation, components }))
    .digest('hex');
}

export function jenkinsIncompleteReadComponents(context: JenkinsBuildContext): string[] {
  return [
    ...(!context.completeness.buildComplete ? ['build'] : []),
    ...(context.completeness.testReport === 'partial' ? ['tests'] : []),
    ...(context.completeness.stages === 'partial' ? ['stages'] : []),
  ];
}

export function sonarIncompleteReadComponents(context: SonarBranchContext): string[] {
  return [
    ...(!context.completeness.qualityGateComplete ? ['quality-gate'] : []),
    ...(!context.completeness.measuresComplete ? ['measures'] : []),
    ...(!context.completeness.issuesComplete ? ['issues'] : []),
  ];
}
