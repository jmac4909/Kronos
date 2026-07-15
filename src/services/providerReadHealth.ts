import * as crypto from 'crypto';
import type { JenkinsBuildContext } from './jenkinsRestClient';
import type { SonarBranchContext } from './sonarRestClient';
import { boundedOperationFailure } from './errorUtils';

export type ProviderReadState = 'complete' | 'partial' | 'failed';

export function providerReadFailureReason(error: unknown): string {
  const failure = boundedOperationFailure(error, 'Provider read unavailable.');
  if (failure.kind === 'authentication' || failure.kind === 'permission') { return failure.kind; }
  if (failure.kind === 'not_found') { return 'not_found'; }
  if (failure.kind === 'rate_limit') { return 'rate_limited'; }
  if (failure.kind === 'response_limit') { return 'safety_limit'; }
  if (failure.kind === 'configuration') { return 'configuration'; }
  if (failure.kind === 'timeout' || failure.kind === 'dns' || failure.kind === 'tls' || failure.kind === 'network') {
    return failure.kind;
  }
  const statusMatch = /\bhttp\s+(\d{3})\b/.exec(failure.summary.toLowerCase());
  const status = statusMatch?.[1] ? Number(statusMatch[1]) : undefined;
  if (status !== undefined && status >= 500) { return 'provider_5xx'; }
  if (status !== undefined) { return 'provider_4xx'; }
  return failure.kind === 'malformed_response' ? 'malformed_response' : 'unavailable';
}

export function readFailureLabel(reason: string): string {
  if (reason === 'authentication') { return 'authentication unavailable'; }
  if (reason === 'permission') { return 'read permission unavailable'; }
  if (reason === 'not_found') { return 'merge request not found'; }
  if (reason === 'rate_limited') { return 'provider rate limited'; }
  if (reason === 'provider_5xx') { return 'provider server error'; }
  if (reason === 'provider_4xx') { return 'provider request refused'; }
  if (reason === 'timeout') { return 'request timed out'; }
  if (reason === 'dns') { return 'provider hostname unavailable'; }
  if (reason === 'tls') { return 'provider TLS verification failed'; }
  if (reason === 'safety_limit') { return 'bounded read limit reached'; }
  if (reason === 'configuration') { return 'provider configuration unavailable'; }
  if (reason === 'network') { return 'network unavailable'; }
  if (reason === 'malformed_response') { return 'provider response was malformed'; }
  return 'provider unavailable';
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
