import { isRecord } from './records';
import { redactSensitiveTokens } from './sensitiveText';

export type OperationFailureKind =
  | 'configuration'
  | 'authentication'
  | 'permission'
  | 'timeout'
  | 'dns'
  | 'tls'
  | 'redirect'
  | 'rate_limit'
  | 'not_found'
  | 'response_limit'
  | 'malformed_response'
  | 'pagination'
  | 'lease_busy'
  | 'local_state'
  | 'network'
  | 'unavailable';

export interface OperationFailure {
  kind: OperationFailureKind;
  summary: string;
  nextAction: string;
  retryable: boolean;
  display: string;
}

export function unknownErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  const message = unknownErrorField(error, 'message');
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export function unknownErrorCode(error: unknown): string {
  const code = unknownErrorField(error, 'code');
  if (typeof code === 'string' && code.trim()) {
    return code;
  }
  return typeof code === 'number' ? String(code) : '';
}

export function unknownErrorField(error: unknown, key: string): unknown {
  return isRecord(error) ? Reflect.get(error, key) : undefined;
}

/** Maps arbitrary provider/local failures onto one redacted operator vocabulary. */
export function boundedOperationFailure(error: unknown, fallback: string): OperationFailure {
  const summary = safeFailureSummary(unknownErrorMessage(error, fallback), fallback);
  const kind = operationFailureKind(error, summary);
  const guidance = FAILURE_GUIDANCE[kind];
  return {
    kind,
    summary,
    nextAction: guidance.nextAction,
    retryable: guidance.retryable,
    display: `${summary} [${kind.replace(/_/g, ' ')}] ${guidance.nextAction}`,
  };
}

const FAILURE_GUIDANCE: Record<OperationFailureKind, { nextAction: string; retryable: boolean }> = {
  configuration: {
    nextAction: 'Open Setup, complete the missing local configuration, reload the window if credentials changed, then check setup.',
    retryable: false,
  },
  authentication: {
    nextAction: 'Verify the credential is current in the private provider environment, reload the window, then check setup.',
    retryable: false,
  },
  permission: {
    nextAction: 'Verify that the configured account has read access to this resource, then retry from Check Setup or the original action.',
    retryable: false,
  },
  timeout: {
    nextAction: 'Retry the read; if it repeats, check provider reachability in Check Setup. Last-known-good evidence remains retained.',
    retryable: true,
  },
  dns: {
    nextAction: 'Check the configured provider hostname and network DNS, then retry the read.',
    retryable: true,
  },
  tls: {
    nextAction: 'Check the provider certificate and configured HTTPS endpoint; use only the documented Jenkins-specific TLS exception when appropriate.',
    retryable: false,
  },
  redirect: {
    nextAction: 'Correct the configured provider base URL so credentialed reads stay on one origin, then retry.',
    retryable: false,
  },
  rate_limit: {
    nextAction: 'Wait for the provider limit to reset, then poll again. Unchanged retries do not add Attention rows.',
    retryable: true,
  },
  not_found: {
    nextAction: 'Verify the explicit project/resource binding and read permission, then retry discovery or the original action.',
    retryable: false,
  },
  response_limit: {
    nextAction: 'Narrow the provider result where configurable, or inspect the partial saved evidence and its truncation warnings.',
    retryable: false,
  },
  malformed_response: {
    nextAction: 'Check setup and verify the provider/version endpoint, then retry the read; the response body was not displayed or trusted.',
    retryable: true,
  },
  pagination: {
    nextAction: 'Retry the bounded read. Cached or last-known-good rows remain retained when the provider page sequence is incomplete.',
    retryable: true,
  },
  lease_busy: {
    nextAction: 'Another Kronos window may be checking updates; wait for it to finish or close that window, then choose Check Updates.',
    retryable: true,
  },
  local_state: {
    nextAction: 'Check setup and inspect private-state permissions, path safety, and free disk space before retrying.',
    retryable: false,
  },
  network: {
    nextAction: 'Check provider reachability and the configured endpoint, then retry. Last-known-good evidence remains retained.',
    retryable: true,
  },
  unavailable: {
    nextAction: 'Check setup, then retry the original action.',
    retryable: true,
  },
};

function operationFailureKind(error: unknown, summary: string): OperationFailureKind {
  const code = unknownErrorCode(error).toUpperCase();
  const text = `${code} ${summary}`.toLowerCase();
  const status = httpStatus(text);
  if (status === 401) { return 'authentication'; }
  if (status === 403) { return 'permission'; }
  if (status === 404) { return 'not_found'; }
  if (status === 429) { return 'rate_limit'; }
  if (/\b(?:enotfound|eai_again)\b|\bdns\b|\bgetaddrinfo\b/.test(text)) { return 'dns'; }
  if (/\b(?:etimedout|timeout|timed out)\b/.test(text)) { return 'timeout'; }
  if (/\b(?:certificate|self signed|unable to verify|tls|ssl)\b/.test(text)) { return 'tls'; }
  if (/\bredirect\b|outside the configured .*origin|refused to send .*credentials/.test(text)) { return 'redirect'; }
  if (/\b(?:rate limit|rate_limited)\b/.test(text)) { return 'rate_limit'; }
  if (/\b(?:not found|not_found)\b/.test(text)) { return 'not_found'; }
  if (/response safety limit|cumulative .*limit|byte limit|exceeds? the .*byte|too large/.test(text)) {
    return 'response_limit';
  }
  if (/invalid json|malformed|invalid payload|invalid .*structure|unexpected .*response/.test(text)) {
    return 'malformed_response';
  }
  if (/\bpaginat|page sequence|next page/.test(text)) { return 'pagination'; }
  if (/\blease\b|another kronos window|contended/.test(text)) { return 'lease_busy'; }
  if (/configuration (?:missing|incomplete)|not configured|requires? [A-Z_]|missing [A-Z_]|project .*missing or invalid/.test(summary)) {
    return 'configuration';
  }
  if (/\b(?:eacces|eperm|enospc|erofs)\b|private state|unsafe (?:file|directory|path)|symbolic link/.test(text)) {
    return 'local_state';
  }
  if (/\b(?:econnrefused|econnreset|enetunreach|ehostunreach|network|socket hang up)\b/.test(text)) {
    return 'network';
  }
  return 'unavailable';
}

function httpStatus(text: string): number | undefined {
  const match = /\bhttp\s+(\d{3})\b/.exec(text);
  return match?.[1] ? Number(match[1]) : undefined;
}

function safeFailureSummary(value: string, fallback: string): string {
  const redacted = redactSensitiveTokens(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (redacted) { return redacted.slice(0, 800); }
  return redactSensitiveTokens(fallback).replace(/\s+/g, ' ').trim().slice(0, 800) || 'Operation unavailable.';
}
