export type SafetyRisk =
  | 'read-only'
  | 'state-write'
  | 'repo-write'
  | 'branch-switch'
  | 'destructive'
  | 'external-publish';

export interface SafetyPlan {
  operationId: string;
  title: string;
  target?: string;
  risks: SafetyRisk[];
  changes: string[];
  warnings?: string[];
  confirmationLabel?: string;
}

export interface SafetyAssessment {
  operationId: string;
  title: string;
  target?: string;
  risks: SafetyRisk[];
  highestRisk: SafetyRisk;
  requiresConfirmation: boolean;
  requiresWorkspaceTrust: boolean;
  workspaceTrustSummary: string;
  modal: boolean;
  confirmationLabel: string;
  message: string;
}

const RISK_WEIGHT: Record<SafetyRisk, number> = {
  'read-only': 0,
  'state-write': 1,
  'repo-write': 2,
  'external-publish': 3,
  'branch-switch': 4,
  'destructive': 5,
};

const TRUST_REQUIRED_RISKS = new Set<SafetyRisk>([
  'repo-write',
  'branch-switch',
  'destructive',
  'external-publish',
]);

export function assessSafetyGate(plan: SafetyPlan): SafetyAssessment {
  const risks = normalizeRisks(plan.risks);
  const highestRisk = risks.reduce((highest, risk) => (
    RISK_WEIGHT[risk] > RISK_WEIGHT[highest] ? risk : highest
  ), 'read-only' as SafetyRisk);
  const requiresConfirmation = risks.some(risk => risk !== 'read-only');
  const requiresWorkspaceTrust = risks.some(risk => TRUST_REQUIRED_RISKS.has(risk));
  const modal = ['branch-switch', 'destructive', 'external-publish'].includes(highestRisk);
  const confirmationLabel = plan.confirmationLabel || defaultConfirmationLabel(highestRisk);
  const assessment: SafetyAssessment = {
    operationId: plan.operationId,
    title: plan.title,
    risks,
    highestRisk,
    requiresConfirmation,
    requiresWorkspaceTrust,
    workspaceTrustSummary: workspaceTrustRiskSummary(risks),
    modal,
    confirmationLabel,
    message: buildSafetyMessage(plan, risks, highestRisk),
  };
  if (plan.target) { assessment.target = plan.target; }
  return assessment;
}

function normalizeRisks(risks: SafetyRisk[]): SafetyRisk[] {
  const source: SafetyRisk[] = risks.length > 0 ? risks : ['read-only'];
  const unique = Array.from(new Set<SafetyRisk>(source));
  return unique.sort((a, b) => RISK_WEIGHT[b] - RISK_WEIGHT[a]);
}

function defaultConfirmationLabel(risk: SafetyRisk): string {
  if (risk === 'destructive') { return 'Proceed'; }
  if (risk === 'branch-switch') { return 'Start Anyway'; }
  if (risk === 'external-publish') { return 'Continue'; }
  if (risk === 'repo-write') { return 'Start'; }
  if (risk === 'state-write') { return 'Update State'; }
  return 'Open';
}

function workspaceTrustRiskSummary(risks: SafetyRisk[]): string {
  if (risks.includes('destructive')) { return 'remove files or clean managed worktrees'; }
  if (risks.includes('branch-switch')) { return 'change branches or worktree state'; }
  if (risks.includes('external-publish')) { return 'publish evidence or update external systems'; }
  if (risks.includes('repo-write')) { return 'modify repository files or launch an agent in a project workspace'; }
  return 'change Kronos state';
}

function buildSafetyMessage(plan: SafetyPlan, risks: SafetyRisk[], highestRisk: SafetyRisk): string {
  const lines = [
    `Kronos Safety Gate: ${plan.title}`,
    plan.target ? `Target: ${plan.target}` : '',
    `Highest risk: ${highestRisk}`,
    `Risk classes: ${risks.join(', ')}`,
    '',
    'Will change:',
    ...plan.changes.map(change => `- ${change}`),
  ].filter(Boolean);

  if (plan.warnings?.length) {
    lines.push('', 'Warnings:', ...plan.warnings.map(warning => `- ${warning}`));
  }

  return lines.join('\n');
}
