import { boundedOperationFailure, type OperationFailure } from './errorUtils';
import { redactSensitiveTokens } from './sensitiveText';

export type OperationStage =
  | 'provider-read'
  | 'artifact-write'
  | 'snapshot'
  | 'insertion'
  | 'session-update'
  | 'audit';

export type OperationStageState = 'succeeded' | 'partial' | 'failed' | 'skipped' | 'not-attempted';

export interface OperationStageResult {
  stage: OperationStage;
  state: OperationStageState;
  detail?: string;
  failure?: OperationFailure;
}

export interface OperationStageOutcome {
  operation: string;
  steps: OperationStageResult[];
  failed: boolean;
  partial: boolean;
  display: string;
}

export interface OperationStageInput {
  state: OperationStageState;
  detail?: string;
}

export interface FinalizeInsertedContextInput<T> {
  operation: string;
  providerRead: OperationStageInput;
  artifactWrite?: OperationStageInput;
  snapshot?: OperationStageInput;
  sessionUpdate?: (() => T) | undefined;
  auditAppend?: ((updatedSession: T | undefined) => void) | undefined;
}

const STAGE_ORDER: readonly OperationStage[] = [
  'provider-read',
  'artifact-write',
  'snapshot',
  'insertion',
  'session-update',
  'audit',
];

const STAGE_LABELS: Record<OperationStage, string> = {
  'provider-read': 'Provider read',
  'artifact-write': 'Artifact write',
  snapshot: 'Snapshot',
  insertion: 'Insertion',
  'session-update': 'Session update',
  audit: 'Audit append',
};

/**
 * Completes the two independent local bookkeeping steps after a reference was
 * already placed. Audit is still attempted when the session update fails so
 * the operator receives a truthful per-step outcome instead of one ambiguous
 * "audit update" error.
 */
export function finalizeInsertedContext<T>(input: FinalizeInsertedContextInput<T>): OperationStageOutcome {
  const steps = new Map<OperationStage, OperationStageResult>();
  setControlledStep(steps, 'provider-read', input.providerRead);
  setControlledStep(steps, 'artifact-write', input.artifactWrite || { state: 'succeeded' });
  setControlledStep(steps, 'snapshot', input.snapshot || { state: 'succeeded' });
  setControlledStep(steps, 'insertion', {
    state: 'succeeded',
    detail: 'One editable reference was placed without submission.',
  });

  let updatedSession: T | undefined;
  if (input.sessionUpdate) {
    try {
      updatedSession = input.sessionUpdate();
      setControlledStep(steps, 'session-update', { state: 'succeeded' });
    } catch (error: unknown) {
      setFailedStep(steps, 'session-update', error, 'Local session update failed.');
    }
  } else {
    setControlledStep(steps, 'session-update', {
      state: 'skipped',
      detail: 'No managed session required an update.',
    });
  }

  if (input.auditAppend) {
    try {
      input.auditAppend(updatedSession);
      setControlledStep(steps, 'audit', { state: 'succeeded' });
    } catch (error: unknown) {
      setFailedStep(steps, 'audit', error, 'Local audit append failed.');
    }
  } else {
    setControlledStep(steps, 'audit', {
      state: 'skipped',
      detail: 'No managed session required an audit append.',
    });
  }

  return buildOperationStageOutcome(input.operation, steps);
}

export function buildOperationStageOutcome(
  operation: string,
  values: ReadonlyMap<OperationStage, OperationStageResult> | readonly OperationStageResult[],
): OperationStageOutcome {
  const source: ReadonlyMap<OperationStage, OperationStageResult> = Array.isArray(values)
    ? new Map((values as readonly OperationStageResult[]).map(value => [value.stage, value]))
    : values as ReadonlyMap<OperationStage, OperationStageResult>;
  const steps = STAGE_ORDER.map(stage => normalizeStep(
    source.get(stage) || ({ stage, state: 'not-attempted' } as OperationStageResult),
  ));
  const safeOperation = safeControlledDetail(operation) || 'Operation';
  const failed = steps.some(step => step.state === 'failed');
  const partial = steps.some(step => step.state === 'partial');
  const display = `${safeOperation}: ${steps.map(formatStep).join('; ')}.`;
  return { operation: safeOperation, steps, failed, partial, display };
}

export function failedOperationStageOutcome(
  operation: string,
  completed: readonly OperationStageResult[],
  failedStage: OperationStage,
  error: unknown,
  fallback: string,
): OperationStageOutcome {
  const steps = new Map<OperationStage, OperationStageResult>();
  for (const step of completed) {
    const detail = safeControlledDetail(step.detail);
    steps.set(step.stage, { stage: step.stage, state: step.state, ...(detail ? { detail } : {}) });
  }
  setFailedStep(steps, failedStage, error, fallback);
  return buildOperationStageOutcome(operation, steps);
}

export class OperationStageOutcomeError extends Error {
  constructor(readonly outcome: OperationStageOutcome) {
    super(outcome.display);
    this.name = 'OperationStageOutcomeError';
  }
}

export function isOperationStageOutcomeError(error: unknown): error is OperationStageOutcomeError {
  return error instanceof OperationStageOutcomeError;
}

function setControlledStep(
  target: Map<OperationStage, OperationStageResult>,
  stage: OperationStage,
  input: OperationStageInput,
): void {
  const detail = safeControlledDetail(input.detail);
  target.set(stage, { stage, state: input.state, ...(detail ? { detail } : {}) });
}

function setFailedStep(
  target: Map<OperationStage, OperationStageResult>,
  stage: OperationStage,
  error: unknown,
  fallback: string,
): void {
  const failure = boundedOperationFailure(error, fallback);
  target.set(stage, { stage, state: 'failed', detail: failure.display, failure });
}

function formatStep(step: OperationStageResult): string {
  const detail = step.detail ? ` (${step.detail})` : '';
  return `${STAGE_LABELS[step.stage]} ${step.state}${detail}`;
}

function normalizeStep(step: OperationStageResult): OperationStageResult {
  const detail = safeControlledDetail(step.detail);
  return {
    stage: step.stage,
    state: step.state,
    ...(detail ? { detail } : {}),
    ...(step.failure ? { failure: step.failure } : {}),
  };
}

function safeControlledDetail(value: string | undefined): string {
  return redactSensitiveTokens(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 800);
}
