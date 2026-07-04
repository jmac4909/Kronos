import { isRecord, recordString } from './records';

export type RunLikeRecord = Record<string, unknown>;

export function isRunLikeRecord(value: unknown): value is RunLikeRecord {
  return isRecord(value);
}

export function hasRetryMetadata(run: RunLikeRecord): boolean {
  const promptMetadata = run['promptMetadata'];
  return isRecord(promptMetadata) && recordString(promptMetadata, 'retryOfRunId').length > 0;
}
