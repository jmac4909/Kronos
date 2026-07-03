import { isActionCode, isActionProofSensitive } from './actionCatalog';

export function isCodeAction(action: string | null | undefined): boolean {
  return isActionCode(action);
}

export function isProofSensitiveAction(action: string | null | undefined): boolean {
  return isActionProofSensitive(action);
}

export function isReviewReadyAction(action: string | null | undefined): boolean {
  return isProofSensitiveAction(action);
}

export function isHandoffAction(action: string | null | undefined): boolean {
  return isProofSensitiveAction(action);
}
