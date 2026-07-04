import { KronosState, QueueState, Ticket } from '../state/types';
import { actionSkill } from './actionCatalog';
import { actionDisplayLabel as actionToLabel } from './actionCatalog';
import { isCodeAction, isProofSensitiveAction } from './actionSemantics';
import { evidenceRecordCount } from './evidenceData';
import { PlannedAction } from './queuePlanner';
import { SafetyPlan, SafetyRisk } from './safetyGate';

export interface NextActionContextInput {
  state: KronosState | null;
  queue: QueueState | null;
}

export interface NextActionOperationalContext {
  commandId: string;
  commandLabel: string;
  skill: string;
  risks: SafetyRisk[];
  preflight: string[];
  blockers: string[];
  summary: string;
}

export interface NextActionStartDecision {
  allowed: boolean;
  commandId: string;
  reason?: string;
  safetyPlan?: SafetyPlan;
  refreshProjects: string[];
}

export function buildNextActionContext(plan: PlannedAction, input: NextActionContextInput): NextActionOperationalContext {
  const ticket = plan.ticketKey ? input.state?.tickets?.[plan.ticketKey] : undefined;
  const risks = risksForPlan(plan);
  const preflight = preflightForPlan(plan, ticket);
  const blockers = blockersForPlan(plan, input);
  const skill = skillForAction(plan.action);
  const commandId = plan.action === 'refresh' ? 'kronos.refresh' : 'kronos.startQueueItem';
  const commandLabel = commandId === 'kronos.refresh'
    ? `Kronos: Refresh${plan.projects.length ? ` ${plan.projects.join(', ')}` : ''}`
    : `Kronos: Start Queue Item -> Claude /${skill}`;
  const target = plan.ticketKey || (plan.projects.length ? plan.projects.join(', ') : 'refresh');
  const summary = [
    `${actionToLabel(plan.action)} for ${target}`,
    `command ${commandId}`,
    `risk ${risks.join(', ')}`,
    blockers.length ? `blocked: ${blockers.join('; ')}` : `preflight: ${preflight.join('; ')}`,
  ].join(' | ');

  return {
    commandId,
    commandLabel,
    skill,
    risks,
    preflight,
    blockers,
    summary,
  };
}

export function buildNextActionStartDecision(plan: PlannedAction, context: NextActionOperationalContext): NextActionStartDecision {
  if (context.blockers.length > 0) {
    return {
      allowed: false,
      commandId: context.commandId,
      reason: `Cannot start ${plan.ticketKey || actionToLabel(plan.action)}: ${context.blockers.join('; ')}`,
      refreshProjects: [],
    };
  }

  const target = plan.ticketKey || (plan.projects.length ? plan.projects.join(', ') : actionToLabel(plan.action));
  const refreshProjects = context.commandId === 'kronos.refresh' ? plan.projects : [];
  const changes = context.commandId === 'kronos.refresh'
    ? [
        refreshProjects.length
          ? `Refresh provider state for ${refreshProjects.join(', ')}.`
          : 'Refresh all configured provider state.',
      ]
    : [
        `Dispatch Claude /${context.skill} for ${target}.`,
        plan.source === 'queue'
          ? 'Start the existing queued recommendation.'
          : 'Start the current recommendation without first adding it to the queue.',
      ];

  return {
    allowed: true,
    commandId: context.commandId,
    refreshProjects,
    safetyPlan: {
      operationId: context.commandId,
      title: context.commandId === 'kronos.refresh'
        ? 'Run Next Best Refresh'
        : `Start Next Best Action: ${actionToLabel(plan.action)}`,
      target,
      risks: context.risks,
      changes,
      warnings: context.preflight,
      confirmationLabel: context.commandId === 'kronos.refresh' ? 'Refresh' : 'Start',
    },
  };
}

export function skillForAction(action: string): string {
  return actionSkill(action);
}

function risksForPlan(plan: PlannedAction): SafetyRisk[] {
  if (plan.action === 'refresh') {
    return ['read-only'];
  }
  if (isCodeAction(plan.action)) {
    return ['repo-write'];
  }
  if (plan.action === 'deploy_monitor') {
    return ['read-only'];
  }
  return ['repo-write'];
}

function preflightForPlan(plan: PlannedAction, ticket: Ticket | undefined): string[] {
  const checks: string[] = [];
  if (plan.action === 'refresh') {
    checks.push('Confirm provider scripts and credentials are available.');
    return checks;
  }

  checks.push('Claude auth preflight must pass before dispatch.');
  if (plan.projects.length > 0) {
    checks.push(`Project link resolved: ${plan.projects.join(', ')}.`);
  }
  if (isCodeAction(plan.action)) {
    checks.push('Collision detector checks active runs, queued work, open MRs, and likely touched files.');
  }
  if (isProofSensitiveAction(plan.action)) {
    const evidenceCount = evidenceRecordCount(ticket);
    checks.push(evidenceCount > 0
      ? `Evidence ledger has ${evidenceCount} item(s).`
      : 'Evidence ledger is empty; add proof before handoff.');
  }
  if (plan.source === 'queue') {
    checks.push(`Existing queue item${plan.queueItem?.id ? ` ${plan.queueItem.id}` : ''} will be started.`);
  } else {
    checks.push('Recommendation is not queued; starting uses the current recommendation context.');
  }
  return checks;
}

function blockersForPlan(plan: PlannedAction, input: NextActionContextInput): string[] {
  const blockers: string[] = [];
  if (plan.ticketKey && !input.state?.tickets?.[plan.ticketKey]) {
    blockers.push(`Ticket ${plan.ticketKey} is no longer in state.`);
  }
  if (plan.action === 'done') {
    blockers.push('Ticket is already done; no dispatch is needed.');
  }
  if (plan.action !== 'refresh' && plan.projects.length === 0) {
    blockers.push('No linked project; link the ticket before dispatch.');
  }
  const missingProjects = plan.projects.filter(project => !input.state?.projects?.[project]);
  if (missingProjects.length > 0) {
    blockers.push(`Missing project config: ${missingProjects.join(', ')}.`);
  }
  return blockers;
}
