import { actionDisplayLabel } from './actionCatalog';

export function actionToLabel(action: string): string {
  return actionDisplayLabel(action);
}
