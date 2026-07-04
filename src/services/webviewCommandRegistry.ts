export const BOARD_MESSAGE_COMMANDS = new Set([
  'link',
  'unlink',
  'addToQueue',
  'removeFromQueue',
  'start',
  'openJira',
  'openMr',
  'getComments',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
]);

export const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'extractAcceptanceCriteria',
  'updateAcceptanceCriteria',
  'viewTicket',
  'evidenceHandoff',
  'publishEvidence',
]);

export const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'addEvidence',
  'addEvidenceCheck',
  'extractAcceptanceCriteria',
  'updateAcceptanceCriteria',
  'startTicket',
  'addToQueue',
  'viewTicket',
  'evidenceGate',
  'runCenter',
  'recoveryCenter',
  'doctor',
  'queuePlanner',
]);

export const DASHBOARD_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'nextBestAction',
  'queuePlanner',
  'runCenter',
  'humanReviewInbox',
  'evidenceGate',
  'recoveryCenter',
  'addEvidence',
  'addEvidenceCheck',
  'startTicket',
  'viewTicket',
]);

export const PLAN_MESSAGE_COMMANDS = new Set([
  'startPlan',
  'queuePlan',
  'pinPlan',
  'snoozePlan',
  'snoozePlanToday',
  'rejectPlan',
  'viewTicket',
  'addEvidence',
]);

export const BACKLOG_TRIAGE_MESSAGE_COMMANDS = new Set([
  'linkTicket',
  'startTicket',
  'addToQueue',
  'addEvidence',
  'addEvidenceCheck',
  'viewTicket',
]);

export const TICKET_DETAIL_MESSAGE_COMMANDS = new Set([
  'startTicket',
  'addToQueue',
  'removeFromQueue',
  'linkTicket',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'evidenceGate',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
  'openJira',
  'openMr',
  'openBuild',
]);

export const RECOVERY_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'executeRecoveryItem',
]);

export const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>([
  ['addToQueue', 'kronos.addToQueue'],
  ['addEvidence', 'kronos.addEvidence'],
  ['addEvidenceCheck', 'kronos.addEvidenceCheck'],
  ['linkTicket', 'kronos.linkTicket'],
  ['setup', 'kronos.setup'],
  ['settings', 'kronos.settings'],
  ['doctor', 'kronos.doctor'],
  ['integrationManifest', 'kronos.integrationManifest'],
  ['snapshotIntegrationManifest', 'kronos.snapshotIntegrationManifest'],
  ['profiles', 'kronos.profiles'],
  ['queuePlanner', 'kronos.queuePlanner'],
  ['humanReviewInbox', 'kronos.humanReviewInbox'],
  ['promptManager', 'kronos.promptManager'],
  ['promptSmokeTests', 'kronos.promptSmokeTests'],
  ['snapshotPromptPack', 'kronos.snapshotPromptPack'],
  ['promptHistory', 'kronos.promptHistory'],
  ['repairPromptPack', 'kronos.repairPromptPack'],
  ['runCenter', 'kronos.runCenter'],
  ['stats', 'kronos.stats'],
  ['sessionHistory', 'kronos.sessionHistory'],
  ['viewTicket', 'kronos.viewTicket'],
  ['recordEnvironmentResult', 'kronos.recordEnvironmentResult'],
  ['extractAcceptanceCriteria', 'kronos.extractAcceptanceCriteria'],
  ['updateAcceptanceCriteria', 'kronos.updateAcceptanceCriteria'],
  ['evidenceGate', 'kronos.evidenceGate'],
  ['exportEvidence', 'kronos.exportEvidence'],
  ['evidenceHandoff', 'kronos.evidenceHandoff'],
  ['publishEvidence', 'kronos.publishEvidence'],
  ['agentQualityScore', 'kronos.agentQualityScore'],
  ['trendMetrics', 'kronos.trendMetrics'],
  ['agingReport', 'kronos.agingReport'],
  ['recoveryCenter', 'kronos.recoveryCenter'],
  ['stateAuditLog', 'kronos.stateAuditLog'],
]);

export const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set(OPERATOR_COMMAND_TO_VSCODE_COMMAND.keys());

function operatorCommandSet(commands: string[]): ReadonlySet<string> {
  for (const command of commands) {
    if (!OPERATOR_COMMAND_MESSAGE_COMMANDS.has(command)) {
      throw new Error(`Unknown Kronos operator command: ${command}`);
    }
  }
  return new Set(commands);
}

export const SESSION_STATS_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'sessionHistory',
  'agentQualityScore',
  'trendMetrics',
]);

export const PROMPT_MANAGER_OPERATOR_COMMANDS = operatorCommandSet([
  'promptSmokeTests',
  'snapshotPromptPack',
  'promptHistory',
  'repairPromptPack',
]);

export const PROMPT_SMOKE_OPERATOR_COMMANDS = operatorCommandSet([
  'promptManager',
  'snapshotPromptPack',
  'promptHistory',
  'repairPromptPack',
]);

export const PROMPT_HISTORY_OPERATOR_COMMANDS = operatorCommandSet([
  'snapshotPromptPack',
  'promptManager',
  'promptSmokeTests',
  'repairPromptPack',
]);

export const STATE_AUDIT_OPERATOR_COMMANDS = operatorCommandSet([
  'recoveryCenter',
  'doctor',
  'stats',
]);

export const EVIDENCE_HANDOFF_OPERATOR_COMMANDS = operatorCommandSet([
  'viewTicket',
  'evidenceGate',
  'exportEvidence',
  'publishEvidence',
]);

export const EVIDENCE_PUBLISH_OPERATOR_COMMANDS = operatorCommandSet([
  'viewTicket',
  'evidenceGate',
  'exportEvidence',
  'evidenceHandoff',
]);

export const AGENT_QUALITY_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'stats',
  'trendMetrics',
  'evidenceGate',
]);

export const TREND_METRICS_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'stats',
  'agentQualityScore',
  'agingReport',
]);

export const INTEGRATION_MANIFEST_OPERATOR_COMMANDS = operatorCommandSet([
  'snapshotIntegrationManifest',
  'doctor',
  'profiles',
  'promptManager',
]);

export const PROFILES_OPERATOR_COMMANDS = operatorCommandSet([
  'settings',
  'doctor',
  'integrationManifest',
]);

export const DOCTOR_OPERATOR_COMMANDS = operatorCommandSet([
  'setup',
  'settings',
  'integrationManifest',
  'profiles',
  'recoveryCenter',
  'stateAuditLog',
]);

export const AGING_REPORT_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'queuePlanner',
  'humanReviewInbox',
  'trendMetrics',
  'evidenceGate',
]);

export const TICKET_SCOPED_OPERATOR_COMMANDS = new Set([
  'addToQueue',
  'addEvidence',
  'addEvidenceCheck',
  'linkTicket',
  'recordEnvironmentResult',
  'extractAcceptanceCriteria',
  'updateAcceptanceCriteria',
  'viewTicket',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
]);
