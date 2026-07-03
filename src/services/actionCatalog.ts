export const TICKET_ACTIONS = [
  'implement',
  'in_progress',
  'fix_build',
  'await_review',
  'verify',
  'deploy_monitor',
  'blocked',
  'done',
] as const;

export const QUEUE_ACTIONS = [...TICKET_ACTIONS, 'refresh'] as const;

export type TicketAction = typeof TICKET_ACTIONS[number];
export type QueueAction = typeof QUEUE_ACTIONS[number];
export type ActionName = QueueAction;

export interface ActionIconSpec {
  id: string;
  color?: string;
}

interface ActionCatalogEntry {
  label: string;
  skill: string;
  estimatedMinutes: number;
  planningScore: number;
  code?: boolean;
  proofSensitive?: boolean;
  ticketIcon?: ActionIconSpec;
  queueIcon?: ActionIconSpec;
}

const DEFAULT_SKILL = 'implement';
const DEFAULT_ESTIMATED_MINUTES = 30;
const DEFAULT_PLANNING_SCORE = 40;

const ACTION_CATALOG: Record<ActionName, ActionCatalogEntry> = {
  implement: {
    label: 'To Do',
    skill: 'implement',
    estimatedMinutes: 45,
    planningScore: 60,
    code: true,
    ticketIcon: { id: 'circle-outline', color: 'disabledForeground' },
    queueIcon: { id: 'play-circle', color: 'charts.green' },
  },
  in_progress: {
    label: 'In Progress',
    skill: 'implement',
    estimatedMinutes: 45,
    planningScore: 65,
    code: true,
    ticketIcon: { id: 'tools', color: 'charts.blue' },
    queueIcon: { id: 'tools', color: 'charts.blue' },
  },
  fix_build: {
    label: 'Build Failed',
    skill: 'implement',
    estimatedMinutes: 45,
    planningScore: 95,
    code: true,
    ticketIcon: { id: 'flame', color: 'testing.iconFailed' },
    queueIcon: { id: 'flame', color: 'testing.iconFailed' },
  },
  await_review: {
    label: 'Review',
    skill: DEFAULT_SKILL,
    estimatedMinutes: 20,
    planningScore: 80,
    proofSensitive: true,
    ticketIcon: { id: 'git-pull-request', color: 'charts.yellow' },
    queueIcon: { id: 'git-pull-request', color: 'charts.yellow' },
  },
  verify: {
    label: 'QA',
    skill: 'verify-fix',
    estimatedMinutes: 30,
    planningScore: 85,
    proofSensitive: true,
    ticketIcon: { id: 'beaker', color: 'charts.purple' },
    queueIcon: { id: 'beaker', color: 'charts.purple' },
  },
  deploy_monitor: {
    label: 'Deploying',
    skill: 'deploy-monitor',
    estimatedMinutes: 20,
    planningScore: 70,
    proofSensitive: true,
    ticketIcon: { id: 'rocket', color: 'charts.blue' },
    queueIcon: { id: 'rocket', color: 'charts.blue' },
  },
  blocked: {
    label: 'Blocked',
    skill: DEFAULT_SKILL,
    estimatedMinutes: 15,
    planningScore: 15,
    ticketIcon: { id: 'lock', color: 'testing.iconFailed' },
    queueIcon: { id: 'lock', color: 'testing.iconFailed' },
  },
  done: {
    label: 'Done',
    skill: DEFAULT_SKILL,
    estimatedMinutes: DEFAULT_ESTIMATED_MINUTES,
    planningScore: DEFAULT_PLANNING_SCORE,
    proofSensitive: true,
    ticketIcon: { id: 'pass', color: 'testing.iconPassed' },
    queueIcon: { id: 'pass', color: 'testing.iconPassed' },
  },
  refresh: {
    label: 'Refresh',
    skill: DEFAULT_SKILL,
    estimatedMinutes: 10,
    planningScore: DEFAULT_PLANNING_SCORE,
    queueIcon: { id: 'refresh' },
  },
};

export function actionDisplayLabel(action: string): string {
  return actionMetadata(action)?.label || action.replace(/_/g, ' ');
}

export function actionSkill(action: string): string {
  return actionMetadata(action)?.skill || DEFAULT_SKILL;
}

export function actionEstimateMinutes(action: string): number {
  return actionMetadata(action)?.estimatedMinutes || DEFAULT_ESTIMATED_MINUTES;
}

export function actionPlanningScore(action: string): number {
  return actionMetadata(action)?.planningScore || DEFAULT_PLANNING_SCORE;
}

export function isActionCode(action: string | null | undefined): boolean {
  return Boolean(action && actionMetadata(action)?.code === true);
}

export function isActionProofSensitive(action: string | null | undefined): boolean {
  return Boolean(action && actionMetadata(action)?.proofSensitive === true);
}

export function ticketActionIconSpec(action: string): ActionIconSpec | undefined {
  return actionMetadata(action)?.ticketIcon;
}

export function queueActionIconSpec(action: string): ActionIconSpec | undefined {
  return actionMetadata(action)?.queueIcon;
}

function actionMetadata(action: string): ActionCatalogEntry | undefined {
  return ACTION_CATALOG[action as ActionName];
}
