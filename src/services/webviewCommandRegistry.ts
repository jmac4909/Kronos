export const BOARD_MESSAGE_COMMANDS = new Set([
  'link',
  'unlink',
  'addToQueue',
  'removeFromQueue',
  'start',
  'openJira',
  'openMr',
  'getComments',
  'insertJiraContext',
  'addEvidence',
  'addEvidenceCheck',
  'recordEnvironmentResult',
  'exportEvidence',
  'evidenceHandoff',
  'publishEvidence',
  'verifyLocal',
  'verifyRemote',
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
  'setupWizard',
  'mrAutopilot',
  'integrationContractReport',
  'agentQualityScore',
  'queuePlanner',
  'runCenter',
  'humanReviewInbox',
  'evidenceGate',
  'recoveryCenter',
  'specBeanstalk',
  'addEvidence',
  'addEvidenceCheck',
  'startTicket',
  'viewTicket',
]);

export const SPEC_BEANSTALK_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'generateSpec',
  'startBeanstalk',
  'openGeneratedSpec',
]);

export const SETUP_WIZARD_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'setup',
  'settings',
  'doctor',
  'integrationManifest',
  'integrationContractReport',
  'snapshotIntegrationManifest',
  'profiles',
  'openDashboard',
  'specBeanstalk',
]);

export const MR_AUTOPILOT_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'runAutopilotPass',
  'pollReviewMergeRequests',
  'humanReviewInbox',
  'queuePlanner',
  'runCenter',
  'evidenceGate',
  'viewTicket',
  'startTicket',
]);

export const INTEGRATION_CONTRACT_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'doctor',
  'integrationManifest',
  'snapshotIntegrationManifest',
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
  'insertJiraContext',
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
  'verifyLocal',
  'verifyRemote',
  'openJira',
  'openMr',
  'openBuild',
]);

export const RECOVERY_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'archiveFinishedRuns',
  'executeRecoveryItem',
]);

export const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>([
  ['addToQueue', 'kronos.addToQueue'],
  ['openDashboard', 'kronos.openDashboard'],
  ['addEvidence', 'kronos.addEvidence'],
  ['addEvidenceCheck', 'kronos.addEvidenceCheck'],
  ['linkTicket', 'kronos.linkTicket'],
  ['setup', 'kronos.setup'],
  ['settings', 'kronos.settings'],
  ['doctor', 'kronos.doctor'],
  ['integrationManifest', 'kronos.integrationManifest'],
  ['integrationContractReport', 'kronos.integrationContractReport'],
  ['snapshotIntegrationManifest', 'kronos.snapshotIntegrationManifest'],
  ['profiles', 'kronos.profiles'],
  ['setupWizard', 'kronos.setupWizard'],
  ['mrAutopilot', 'kronos.mrAutopilot'],
  ['pollReviewMergeRequests', 'kronos.pollReviewMergeRequests'],
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
  ['insertJiraContext', 'kronos.insertJiraContext'],
  ['recordEnvironmentResult', 'kronos.recordEnvironmentResult'],
  ['extractAcceptanceCriteria', 'kronos.extractAcceptanceCriteria'],
  ['updateAcceptanceCriteria', 'kronos.updateAcceptanceCriteria'],
  ['evidenceGate', 'kronos.evidenceGate'],
  ['exportEvidence', 'kronos.exportEvidence'],
  ['evidenceHandoff', 'kronos.evidenceHandoff'],
  ['publishEvidence', 'kronos.publishEvidence'],
  ['verifyLocal', 'kronos.verifyLocal'],
  ['verifyRemote', 'kronos.verifyRemote'],
  ['agentQualityScore', 'kronos.agentQualityScore'],
  ['trendMetrics', 'kronos.trendMetrics'],
  ['agingReport', 'kronos.agingReport'],
  ['recoveryCenter', 'kronos.recoveryCenter'],
  ['stateAuditLog', 'kronos.stateAuditLog'],
  ['specBeanstalk', 'kronos.specBeanstalk'],
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
  'integrationContractReport',
  'setupWizard',
  'profiles',
  'promptManager',
]);

export const PROFILES_OPERATOR_COMMANDS = operatorCommandSet([
  'settings',
  'setupWizard',
  'doctor',
  'integrationManifest',
]);

export const DOCTOR_OPERATOR_COMMANDS = operatorCommandSet([
  'setupWizard',
  'setup',
  'settings',
  'integrationManifest',
  'integrationContractReport',
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
  'insertJiraContext',
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
  'verifyLocal',
  'verifyRemote',
]);
