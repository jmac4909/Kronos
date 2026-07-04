import * as vscode from 'vscode';
import { KronosState } from './state/KronosState';
import { ProjectTreeProvider } from './views/ProjectTreeProvider';
import { QueueTreeProvider } from './views/QueueTreeProvider';
import { SessionTreeProvider } from './views/SessionTreeProvider';
import { TaskTreeProvider } from './views/TaskTreeProvider';
import { ReviewTreeProvider, type ReviewSeenKeysStore } from './views/ReviewTreeProvider';
import { TicketTreeProvider } from './views/TicketTreeProvider';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import type { DiscoveredProject, MergeRequestChangedFile, QueueItem, Ticket } from './state/types';
import type { KronosState as KronosStateSnapshot } from './state/types';
import { dispatchClaudeSession, openInClaude, ensureAuth, cleanupStaleWorktrees, listSavedSessions, listSessionStoreIssues, openSavedSession, getAggregateStats, openRunCenter, listRuns, type DispatchOptions, type KronosRun, type PromptRunMetadata, type RunCenterActionRequest } from './runners/sessionDispatcher';
import { PromptHistoryDiff, PromptSmokeTest, PromptTemplateInfo, buildDefaultPromptSmokeTests, createPromptHistorySnapshot, diffPromptHistorySnapshots, latestPromptHistorySnapshot, listPromptHistorySnapshots, listPromptTemplates, repairRequiredPromptTemplates, runPromptSmokeTests } from './services/promptManager';
import { KRONOS_DIR, STATE_AUDIT_FILE, listBackups, listStateAuditEvents, restoreBackup } from './services/stateStore';
import { PlannedAction, buildBacklogTriageReport, overnightCandidatePlans, planByProject, planByRelease, planForMinutes, planNextActions as buildNextActionPlan, planToQueueItem as buildQueueItemFromPlan } from './services/queuePlanner';
import { actionDisplayLabel as actionToLabel } from './services/actionCatalog';
import { isCodeAction, isProofSensitiveAction } from './services/actionSemantics';
import { toValidDate } from './services/dateValues';
import { writeEvidenceExport } from './services/evidenceStore';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceRecordCount, evidenceString } from './services/evidenceData';
import { EvidenceHandoffPlan, buildEvidenceHandoffPlan } from './services/evidenceHandoff';
import { EvidencePublishDestination, EvidencePublishResult, buildEvidencePublishPlan, publishEvidencePlan, readyPublishDestinations } from './services/evidencePublisher';
import { RUNS_DIR, archiveRun, listRunStoreIssues, markRunCancelled, markRunContinued, markRunNeedsHuman, markRunPaused, readArchivedRuns, runRecordPath, writeRunRecord } from './services/runStore';
import { RecoveryInventory, RecoveryItem, buildRecoveryInventory, type RecoveryInventoryInput } from './services/recoveryCenter';
import { TimelineEvent, buildTicketTimeline } from './services/ticketTimeline';
import { DispatchCollision, detectDispatchCollisions, type DispatchCollisionInput } from './services/collisionDetector';
import { gitlabAdapter, jiraAdapter, sonarAdapter, type MergeRequestDiffResult } from './services/integrationAdapters';
import { buildRunCompletionEvidenceCheck, buildRunCompletionEvidenceText, evaluatePostRunReadiness, postRunReadinessRunPatch, resolvePostRunTicket, shouldRecordRunCompletionEvidence } from './services/postRunReadiness';
import { extractAcceptanceCriteria } from './services/acceptanceCriteria';
import type { ExistingAcceptanceCriterion } from './services/acceptanceCriteria';
import { buildHumanReviewInbox } from './services/humanReviewInbox';
import { EvidenceGateResult, evaluateEvidenceGate, evaluateEvidenceGates } from './services/evidenceGate';
import { decideEvidenceHandoff } from './services/evidenceGatePolicy';
import { computeAgentQualityScore } from './services/agentQualityScore';
import { DashboardWorklistItem, DashboardWorklistLane, buildDashboardWorklist } from './services/dashboardWorklist';
import { INTEGRATION_MANIFEST_FILE, auditIntegrationManifest, readIntegrationManifest, writeIntegrationManifestSnapshot } from './services/integrationManifest';
import { KronosProfile, listProfiles, resolveDefaultBaseBranch, resolveProfile, sanitizeBranch as sanitizeProfileBranch } from './services/profileManager';
import { AgingThresholds, analyzeAging } from './services/agingAnalyzer';
import { SafetyPlan, assessSafetyGate } from './services/safetyGate';
import { computeTrendMetrics } from './services/trendMetrics';
import { TicketFilter, TicketGroupBy, TICKET_FILTER_PRESETS, describeTicketFilter } from './services/ticketFilters';
import { buildRunResumePrompt, readRunLogTail } from './services/runRecovery';
import { addTicketEvidenceCheck, addTicketEvidenceNote, addTicketRunCompletionEvidence, linkMergeRequestToTicket, previewLinkMergeRequestToTicket, reconcileTerminalMergeRequestState, recordTicketEnvironmentResult, replaceTicketAcceptanceCriteria, updateTicketAcceptanceCriteria, updateTicketMergeRequestStatus, type TicketEvidenceCheckInput } from './services/ticketMutations';
import { addPlanToQueue as addPlanToQueueState, addTicketToQueue, linkTicketToProject, recordPlanQueueDecision, removeTicketFromQueue as removeTicketFromQueueState, reorderQueueItem, selectNextQueueItem, unlinkTicketFromProject } from './services/queueMutations';
import { removeProject as removeProjectFromState, setProjectConfigValue, setProjectIntegrationConfig, setScanDirs, writeProjectSetupConfig } from './services/projectMutations';
import { DoctorCheck, runDoctorChecks as collectDoctorChecks, runDoctorReachabilityChecks as collectDoctorReachabilityChecks } from './services/doctorChecks';
import { checkClaudeModelAccess } from './services/cliProbes';
import { buildCombinedVerificationPlan, buildCombinedVerificationPromptVars } from './services/combinedVerification';
import { primaryChangedFilePath } from './services/changedFiles';
import { buildSonarReport, type SonarIssue } from './services/sonarReportView';
import { buildAgingReportHtml } from './services/agingReportView';
import { computeAttentionBadge } from './services/attentionBadge';
import { configIntervalMs, configIntervalSeconds, configIntervalSecondsMs, parsePositiveNumberInput, positiveConfigNumber } from './services/intervalConfig';
import { buildNextActionContext, buildNextActionStartDecision, skillForAction } from './services/nextActionContext';
import { createWorkspaceDiffArtifact, firstRemoteBranchMatching, originProjectPath } from './services/gitWorkspace';
import { signalProcessTree, stopProcessTree, supportsProcessTreeSuspend } from './services/processTree';
import { createWebviewReadyMonitor } from './services/webviewDiagnostics';
import { WEBVIEW_ACTION_PANEL_SCRIPT, WEBVIEW_JIRA_BOARD_SCRIPT, WEBVIEW_READY_COMMAND, createWebviewNonce, webviewRuntimeScriptTag, webviewRuntimeScriptUri, webviewScriptCspOptions, withWebviewCsp } from './services/webviewSecurity';
import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss, safeHttpHref } from './services/webviewHtml';
import { kronosTerminalOptions } from './services/terminalProfiles';
import { unknownErrorCode, unknownErrorMessage } from './services/errorUtils';
import { isKronosScriptMissingError } from './services/scriptClient';
import { activeRunStatusBarSummary } from './services/activeRunDisplay';
import { isFreshActiveRun } from './services/runStatus';
import { isAttentionRunStatus, runAttentionDetail, runAttentionLine } from './services/runAttention';
import { buildRunCompletionNotification } from './services/runCompletionNotification';
import { isRecord, recordFromUnknown } from './services/records';
import { openReviewTicketEntries, reviewBranchTickets as buildReviewBranchTickets } from './services/reviewWork';
import { decideReviewMonitorAction, reviewDeployMonitorActionHandled, reviewTerminalMergeRequestActionKey, type ReviewDeployMonitorResult, type ReviewMonitorDecision, type ReviewTerminalMergeRequestAction } from './services/reviewMonitor';
import { decideQueueRemoval } from './services/queueRemovalPolicy';
import { deployMonitorAttentionIssue, deployMonitorHandoffCheckName, hasDeployMonitorHandoffIssue, hasHandledDeployMonitorRun, resolveDeployMonitorProject } from './services/deployMonitorHandoff';
import { actionButton, actionRow, kronosActionPanelScript, kronosOperatorPanelCss, normalizeActionPanelMessage, operatorCommandRow, type ActionPanelMessage } from './services/operatorPanel';
import { buildPromptHistoryHtml, buildPromptManagerHtml, buildPromptSmokeTestsHtml } from './services/promptPanelView';
import { buildRecoveryHtml, buildStateAuditLogHtml } from './services/recoveryPanelView';
import { buildHumanReviewInboxHtml } from './services/humanReviewPanelView';
import { buildEvidenceGateHtml, buildEvidenceHandoffHtml, buildEvidencePublishHtml } from './services/evidencePanelView';
import { buildBacklogTriageHtml, buildCollisionReportHtml, buildProjectBatchPlanHtml, buildQueuePlanModeHtml, buildQueuePlannerHtml, buildReleaseBatchPlanHtml } from './services/queuePlannerPanelView';
import { buildAgentQualityScoreHtml, buildDoctorHtml, buildIntegrationManifestHtml, buildProfilesHtml, buildTrendMetricsHtml } from './services/operationsReportPanelView';

let statusBarItem: vscode.StatusBarItem;
interface BadgeTarget {
  badge?: vscode.ViewBadge | undefined;
}
const REQUIRED_PROMPTS = [
  'implement-system',
  'verify-local',
  'sonar-scan',
  'sonar-fix',
  'sonar-fix-branch',
  'fix-finding',
  'verify-develop',
  'verify-test',
  'resolve-conflicts',
  'verify-combined',
  'continue-work',
];
const LIVE_MR_DIFF_LIMIT = 4;
const LIVE_MR_DIFF_TIMEOUT_MS = 8000;
const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000;
const REVIEW_SEEN_KEYS_STORAGE_KEY = 'kronos.review.seenKeys.v1';
const reviewPollFailureNotifications = new Map<string, number>();
const reviewTerminalMergeRequestActions = new Set<string>();
const OPTIONAL_SCRIPT_PANEL_WARNING = 'Kronos integration scripts are not installed. Run Kronos: Doctor for setup details.';

function stringFromUnknown(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function panelIntegrationErrorMessage(error: unknown, fallback: string): string {
  return isKronosScriptMissingError(error) ? OPTIONAL_SCRIPT_PANEL_WARNING : unknownErrorMessage(error, fallback);
}

function warnUnexpectedPanelIntegrationError(error: unknown, fallback: string): string {
  const detail = panelIntegrationErrorMessage(error, fallback);
  if (!isKronosScriptMissingError(error)) {
    console.warn(detail);
  }
  return detail;
}

async function runWebviewPanelAction(action: () => Promise<void> | void, fallback: string): Promise<void> {
  try {
    await action();
  } catch (e: unknown) {
    const detail = warnUnexpectedPanelIntegrationError(e, fallback);
    vscode.window.showWarningMessage(detail);
  }
}

function formatWebviewDateTime(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleString() || fallback;
}

function formatWebviewDate(value: unknown, fallback = 'N/A'): string {
  return toValidDate(value)?.toLocaleDateString() || fallback;
}

function openExternalHttpUrl(url: string): void {
  try {
    const parsed = vscode.Uri.parse(url);
    if (parsed.scheme !== 'http' && parsed.scheme !== 'https') {
      vscode.window.showWarningMessage(`Refusing to open non-HTTP URL: ${parsed.scheme}`);
      return;
    }
    vscode.env.openExternal(parsed);
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, 'Invalid external URL.'));
    vscode.window.showWarningMessage('Refusing to open invalid URL.');
  }
}

function runNotificationCommandAction(
  selection: Thenable<string | undefined>,
  actionLabel: string,
  command: string,
  failureFallback: string
): void {
  void selection.then(action => {
    if (action !== actionLabel) { return; }
    void vscode.commands.executeCommand(command).then(undefined, (e: unknown) => {
      void vscode.window.showWarningMessage(unknownErrorMessage(e, failureFallback));
    });
  }, (e: unknown) => {
    void vscode.window.showWarningMessage(unknownErrorMessage(e, failureFallback));
  });
}

function notifyNewReviewItems(reviewTree: ReviewTreeProvider, notifiedReviewKeys: Set<string>): void {
  const items = reviewTree.getNewReviewItems();
  const currentKeys = new Set(items.map(item => item.activityKey || item.ticketKey));
  for (const key of notifiedReviewKeys) {
    if (!currentKeys.has(key)) {
      notifiedReviewKeys.delete(key);
    }
  }
  const freshItems = items.filter(item => !notifiedReviewKeys.has(item.activityKey || item.ticketKey));
  for (const item of freshItems) {
    notifiedReviewKeys.add(item.activityKey || item.ticketKey);
  }
  if (freshItems.length === 0) { return; }

  const primary = freshItems[0];
  if (!primary) { return; }
  const mr = primary.mrIid !== undefined ? `MR !${primary.mrIid}` : 'MR';
  const activity = primary.activity ? ` - ${primary.activity}` : '';
  const suffix = freshItems.length > 1 ? ` (+${freshItems.length - 1} more)` : '';
  runNotificationCommandAction(
    vscode.window.showInformationMessage(
      `${primary.ticketKey}: ${mr} needs review${activity}${suffix}`,
      'Open Review'
    ),
    'Open Review',
    'kronosReview.focus',
    'Failed to open Kronos Review.'
  );
}

function reviewSeenKeysStore(globalState: vscode.Memento): ReviewSeenKeysStore {
  return {
    get: () => normalizeReviewSeenKeys(globalState.get<unknown>(REVIEW_SEEN_KEYS_STORAGE_KEY)),
    update: keys => globalState.update(REVIEW_SEEN_KEYS_STORAGE_KEY, normalizeReviewSeenKeys([...keys]) || []),
  };
}

function normalizeReviewSeenKeys(value: unknown): string[] | undefined {
  if (value === undefined) { return undefined; }
  if (!Array.isArray(value)) { return []; }
  const keys = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      keys.add(item.trim());
    }
  }
  return [...keys].sort();
}

async function runCommandProgress(
  options: vscode.ProgressOptions,
  task: (
    progress: vscode.Progress<{ message?: string; increment?: number }>,
    token: vscode.CancellationToken
  ) => Thenable<unknown>,
  failureFallback: string
): Promise<void> {
  try {
    await vscode.window.withProgress(options, task);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, failureFallback));
  }
}

function startActiveRunPanelRefresh(
  panel: vscode.WebviewPanel,
  state: KronosState,
  render: () => void | Promise<void>,
): void {
  const pollIntervalMs = configIntervalMs(vscode.workspace.getConfiguration('kronos').get<number>('sessionPollIntervalMs', 5000), 5000, 1000);
  let wasActive = listRuns().some(run => isFreshActiveRun(run));
  let rendering = false;
  const pollTimer = setInterval(() => {
    const hasActive = listRuns().some(run => isFreshActiveRun(run));
    if (!hasActive && !wasActive) { return; }
    if (rendering) { return; }
    rendering = true;
    void Promise.resolve()
      .then(() => {
        state.reloadAndNotify();
        return render();
      })
      .catch((e: unknown) => { warnUnexpectedPanelIntegrationError(e, 'Kronos panel auto-refresh failed.'); })
      .finally(() => {
        wasActive = listRuns().some(run => isFreshActiveRun(run));
        rendering = false;
      });
  }, pollIntervalMs);
  panel.onDidDispose(() => clearInterval(pollTimer));
}

function startBackgroundRefreshPoll(throttledRefresh: () => Promise<void>, intervalMs: number): vscode.Disposable {
  const timer = setInterval(() => { void throttledRefresh(); }, intervalMs);
  return { dispose: () => clearInterval(timer) };
}

function startStatusBarRunRefresh(state: KronosState, intervalMs: number): vscode.Disposable {
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 5000;
  let hadActiveRuns = false;
  const timer = setInterval(() => {
    const hasActiveRuns = listRuns().some(run => isFreshActiveRun(run));
    if (hasActiveRuns || hadActiveRuns) {
      updateStatusBar(state);
    }
    hadActiveRuns = hasActiveRuns;
  }, safeIntervalMs);
  return { dispose: () => clearInterval(timer) };
}

async function startClaudeDispatch(
  projectPath: string,
  skill: string,
  ticket?: string,
  onCompleteOrOpts?: ((code: number) => void) | DispatchOptions,
  customPrompt?: string
): Promise<boolean> {
  const canDispatch = await confirmWorkspaceTrustForAssessment(assessSafetyGate({
    operationId: 'startClaudeDispatch',
    title: `Start Claude /${skill}`,
    target: ticket ? `${ticket} / ${projectPath}` : projectPath,
    risks: ['repo-write'],
    changes: [
      `Launch a Claude /${skill} agent in the project workspace.`,
      'Allow the agent session to inspect and modify repository files as directed by the selected workflow.',
    ],
    confirmationLabel: 'Start',
  }));
  if (!canDispatch) { return false; }

  try {
    const launch = await dispatchClaudeSession(projectPath, skill, ticket, onCompleteOrOpts, customPrompt);
    return launch.launched;
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, `Failed to start ${skill} session.`));
    return false;
  }
}

const BOARD_MESSAGE_COMMANDS = new Set([
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
const EVIDENCE_GATE_MESSAGE_COMMANDS = new Set([
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
const HUMAN_REVIEW_MESSAGE_COMMANDS = new Set([
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
const DASHBOARD_MESSAGE_COMMANDS = new Set([
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
const PLAN_MESSAGE_COMMANDS = new Set([
  'startPlan',
  'queuePlan',
  'pinPlan',
  'snoozePlan',
  'snoozePlanToday',
  'rejectPlan',
  'viewTicket',
  'addEvidence',
]);
const BACKLOG_TRIAGE_MESSAGE_COMMANDS = new Set([
  'linkTicket',
  'startTicket',
  'addToQueue',
  'addEvidence',
  'addEvidenceCheck',
  'viewTicket',
]);
const TICKET_DETAIL_MESSAGE_COMMANDS = new Set([
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
const RECOVERY_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'executeRecoveryItem',
]);
const OPERATOR_COMMAND_TO_VSCODE_COMMAND = new Map<string, string>([
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
const OPERATOR_COMMAND_MESSAGE_COMMANDS = new Set(OPERATOR_COMMAND_TO_VSCODE_COMMAND.keys());
const SESSION_STATS_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'sessionHistory',
  'agentQualityScore',
  'trendMetrics',
]);
const PROMPT_MANAGER_OPERATOR_COMMANDS = operatorCommandSet([
  'promptSmokeTests',
  'snapshotPromptPack',
  'promptHistory',
  'repairPromptPack',
]);
const PROMPT_SMOKE_OPERATOR_COMMANDS = operatorCommandSet([
  'promptManager',
  'snapshotPromptPack',
  'promptHistory',
  'repairPromptPack',
]);
const PROMPT_HISTORY_OPERATOR_COMMANDS = operatorCommandSet([
  'snapshotPromptPack',
  'promptManager',
  'promptSmokeTests',
  'repairPromptPack',
]);
const STATE_AUDIT_OPERATOR_COMMANDS = operatorCommandSet([
  'recoveryCenter',
  'doctor',
  'stats',
]);
const EVIDENCE_HANDOFF_OPERATOR_COMMANDS = operatorCommandSet([
  'viewTicket',
  'evidenceGate',
  'exportEvidence',
  'publishEvidence',
]);
const EVIDENCE_PUBLISH_OPERATOR_COMMANDS = operatorCommandSet([
  'viewTicket',
  'evidenceGate',
  'exportEvidence',
  'evidenceHandoff',
]);
const AGENT_QUALITY_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'stats',
  'trendMetrics',
  'evidenceGate',
]);
const TREND_METRICS_OPERATOR_COMMANDS = operatorCommandSet([
  'runCenter',
  'stats',
  'agentQualityScore',
  'agingReport',
]);
const INTEGRATION_MANIFEST_OPERATOR_COMMANDS = operatorCommandSet([
  'snapshotIntegrationManifest',
  'doctor',
  'profiles',
  'promptManager',
]);
const PROFILES_OPERATOR_COMMANDS = operatorCommandSet([
  'settings',
  'doctor',
  'integrationManifest',
]);
const DOCTOR_OPERATOR_COMMANDS = operatorCommandSet([
  'setup',
  'settings',
  'integrationManifest',
  'profiles',
  'recoveryCenter',
  'stateAuditLog',
]);
const AGING_REPORT_MESSAGE_COMMANDS = new Set([
  'refreshPanel',
  'queuePlanner',
  'humanReviewInbox',
  'trendMetrics',
  'evidenceGate',
]);
const TICKET_SCOPED_OPERATOR_COMMANDS = new Set([
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

function operatorCommandSet(commands: string[]): ReadonlySet<string> {
  for (const command of commands) {
    if (!OPERATOR_COMMAND_MESSAGE_COMMANDS.has(command)) {
      throw new Error(`Unknown Kronos operator command: ${command}`);
    }
  }
  return new Set(commands);
}

function normalizeWebviewCommand(raw: unknown, allowed: Set<string>): string | null {
  const command = recordFromUnknown(raw)['command'];
  if (typeof command !== 'string' || !allowed.has(command)) { return null; }
  return command;
}

function normalizeBoardMessage(raw: unknown): { command: string; ticket: string; project: string } | null {
  const command = normalizeWebviewCommand(raw, BOARD_MESSAGE_COMMANDS);
  if (!command) { return null; }
  const message = recordFromUnknown(raw);
  return {
    command,
    ticket: typeof message['ticket'] === 'string' ? message['ticket'] : '',
    project: typeof message['project'] === 'string' ? message['project'] : '',
  };
}

function normalizeSonarIssueCommandList(value: unknown): SonarIssue[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .map(normalizeSonarIssueCommandValue)
    .filter((issue): issue is SonarIssue => Boolean(issue));
}

function normalizeSonarIssueCommandValue(value: unknown): SonarIssue | null {
  const record = recordFromUnknown(value);
  const issue: SonarIssue = {};
  if (typeof record['severity'] === 'string') { issue.severity = record['severity']; }
  if (typeof record['rule'] === 'string') { issue.rule = record['rule']; }
  if (typeof record['component'] === 'string') { issue.component = record['component']; }
  if (record['line'] !== undefined) { issue.line = record['line']; }
  if (typeof record['message'] === 'string') { issue.message = record['message']; }
  return issue.severity || issue.rule || issue.component || issue.message || issue.line !== undefined ? issue : null;
}

function formatSonarIssuePromptLine(issue: SonarIssue): string {
  const file = String(issue.component || '').replace(/^[^:]+:/, '') || '?';
  const rule = String(issue.rule || '').replace(/^[^:]+:/, '') || '-';
  const line = issue.line === undefined || issue.line === null || issue.line === '' ? '?' : String(issue.line);
  return `- [${issue.severity || '-'}] ${rule}: ${file}:${line} — ${issue.message || ''}`;
}

function agingThresholdsFromConfig(): Partial<AgingThresholds> {
  const config = vscode.workspace.getConfiguration('kronos');
  const entries: Array<[keyof AgingThresholds, string]> = [
    ['reviewDays', 'staleReviewDays'],
    ['buildFailureDays', 'staleBuildFailureDays'],
    ['blockedDays', 'staleBlockedDays'],
    ['verificationDays', 'staleVerificationDays'],
    ['ticketDays', 'staleTicketDays'],
  ];
  const thresholds: Partial<AgingThresholds> = {};
  for (const [key, setting] of entries) {
    const value = config.get<number>(setting);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      thresholds[key] = value;
    }
  }
  return thresholds;
}

function trendWindowDaysFromConfig(): number {
  const value = vscode.workspace.getConfiguration('kronos').get<number>('trendWindowDays', 14);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 14;
}

async function confirmSafetyGate(plan: SafetyPlan): Promise<boolean> {
  const assessment = assessSafetyGate(plan);
  const hasWorkspaceTrust = await confirmWorkspaceTrustForAssessment(assessment);
  if (!hasWorkspaceTrust) { return false; }
  if (!assessment.requiresConfirmation) { return true; }
  const action = await vscode.window.showWarningMessage(
    assessment.message,
    { modal: assessment.modal },
    assessment.confirmationLabel,
    'Cancel'
  );
  return action === assessment.confirmationLabel;
}

async function confirmWorkspaceTrustForAssessment(assessment: ReturnType<typeof assessSafetyGate>): Promise<boolean> {
  if (!assessment.requiresWorkspaceTrust || vscode.workspace.isTrusted) {
    return true;
  }
  const action = await vscode.window.showWarningMessage(
    `Kronos is running in Restricted Mode. Trust this workspace before ${assessment.title}; this action can ${assessment.workspaceTrustSummary}.`,
    'Manage Workspace Trust',
    'Cancel'
  );
  if (action === 'Manage Workspace Trust') {
    try {
      await vscode.commands.executeCommand('workbench.trust.manage');
    } catch (e: unknown) {
      vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not open Workspace Trust management.'));
    }
  }
  return false;
}

async function openTextFileIfExists(filePath: string, missingMessage: string): Promise<void> {
  if (!filePath || !fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(missingMessage);
    return;
  }
  try {
    if (!fs.statSync(filePath).isFile()) {
      vscode.window.showWarningMessage(missingMessage);
      return;
    }
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Could not inspect text file ${filePath}.`));
    vscode.window.showWarningMessage(missingMessage);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  await vscode.window.showTextDocument(doc, { preview: false });
}

type RunArtifactPathResult =
  | { ok: true; filePath: string }
  | { ok: false; reason: 'missing' | 'outside-runs-dir' };

function isPathInsideDirectory(filePath: string, directoryPath: string): boolean {
  try {
    const realDirectory = fs.realpathSync(directoryPath);
    const realPath = fs.realpathSync(filePath);
    const relative = path.relative(realDirectory, realPath);
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Could not resolve artifact path ${filePath}.`));
    return false;
  }
}

function resolveRunArtifactFile(filePath: string | undefined): RunArtifactPathResult {
  if (typeof filePath !== 'string' || !filePath.trim() || !fs.existsSync(filePath)) {
    return { ok: false, reason: 'missing' };
  }
  try {
    if (!fs.statSync(filePath).isFile()) {
      return { ok: false, reason: 'missing' };
    }
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Could not inspect run artifact ${filePath}.`));
    return { ok: false, reason: 'missing' };
  }
  if (!isPathInsideDirectory(filePath, RUNS_DIR)) {
    return { ok: false, reason: 'outside-runs-dir' };
  }
  return { ok: true, filePath };
}

function warnForRunArtifactPath(result: Extract<RunArtifactPathResult, { ok: false }>, missingMessage: string): void {
  vscode.window.showWarningMessage(
    result.reason === 'outside-runs-dir'
      ? 'Refusing to open run artifact outside Kronos runs directory.'
      : missingMessage
  );
}

async function openRunArtifactFileIfExists(filePath: string | undefined, missingMessage: string): Promise<void> {
  const resolved = resolveRunArtifactFile(filePath);
  if (!resolved.ok) {
    warnForRunArtifactPath(resolved, missingMessage);
    return;
  }
  await openTextFileIfExists(resolved.filePath, missingMessage);
}

function warnIfRunStillActive(run: KronosRun, action: 'retry' | 'resume'): boolean {
  if (!isFreshActiveRun(run)) { return false; }
  vscode.window.showWarningMessage(`Run ${run.id} is still active. Stop it or let it finish before attempting to ${action}.`);
  return true;
}

function isRetryableRun(run: KronosRun): boolean {
  return !isFreshActiveRun(run) && resolveRunArtifactFile(run.promptPath).ok;
}

function isResumableRun(run: KronosRun): boolean {
  return !isFreshActiveRun(run) && (
    resolveRunArtifactFile(run.promptPath).ok
    || resolveRunArtifactFile(run.logPath).ok
  );
}

async function retryRunFromPrompt(state: KronosState, run: KronosRun): Promise<void> {
  if (warnIfRunStillActive(run, 'retry')) { return; }
  const promptPath = resolveRunArtifactFile(run?.promptPath);
  if (!promptPath.ok) {
    warnForRunArtifactPath(promptPath, 'Run prompt artifact not found.');
    return;
  }
  if (!run.projectPath || !fs.existsSync(run.projectPath)) {
    vscode.window.showWarningMessage('Original project path no longer exists.');
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Retry ${run.project} ${run.skill}${run.ticket ? ` ${run.ticket}` : ''} in the original project workspace?`,
    'Retry',
    'Cancel'
  );
  if (confirm !== 'Retry') { return; }

  const prompt = fs.readFileSync(promptPath.filePath, 'utf-8');
  const projectName = run.project || path.basename(run.projectPath);
  const ticketKey = run.ticket || undefined;
  const retryMetadata = {
    ...(run.promptMetadata || {}),
    retryOfRunId: run.id,
  };
  await startClaudeDispatch(run.projectPath, run.skill, ticketKey, {
    customPrompt: prompt,
    promptMetadata: retryMetadata,
    projectNameOverride: projectName,
    onComplete: refreshAfterDispatch(state, projectName, ticketKey),
  });
}

function resolveRunWorkspace(run: KronosRun): string | null {
  for (const candidate of [run.worktreePath, run.cwd, run.projectPath]) {
    if (typeof candidate === 'string' && candidate.trim()) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
          return candidate;
        }
      } catch (e: unknown) {
        console.warn(unknownErrorMessage(e, `Could not inspect run workspace ${candidate}.`));
      }
    }
  }
  return null;
}

async function resumeSelectedRun(state: KronosState, run: KronosRun): Promise<void> {
  if (warnIfRunStillActive(run, 'resume')) { return; }
  const workspace = resolveRunWorkspace(run);
  if (!workspace) {
    vscode.window.showWarningMessage('Run workspace no longer exists.');
    return;
  }
  const projectPath = run.projectPath || workspace;
  const projectName = run.project || path.basename(projectPath);
  const ticketKey = run.ticket || undefined;
  const confirm = await vscode.window.showWarningMessage(
    `Resume run ${run.id} in ${workspace}? Kronos will dispatch a continuation prompt using the saved prompt and recent log tail.`,
    'Resume Run',
    'Cancel'
  );
  if (confirm !== 'Resume Run') { return; }

  try {
    const promptPath = resolveRunArtifactFile(run.promptPath);
    const logPath = resolveRunArtifactFile(run.logPath);
    const originalPrompt = promptPath.ok
      ? fs.readFileSync(promptPath.filePath, 'utf-8')
      : '';
    const logTail = logPath.ok ? readRunLogTail(logPath.filePath) : '';
    const resumePrompt = buildRunResumePrompt(run, originalPrompt, logTail);
    const resumeMetadata: PromptRunMetadata = {
      ...(run.promptMetadata || {}),
      name: `resume-${run.id}`,
      source: 'custom',
      retryOfRunId: run.id,
    };

    await startClaudeDispatch(projectPath, run.skill || 'continue-work', ticketKey, {
      customPrompt: resumePrompt,
      promptMetadata: resumeMetadata,
      workspaceCwd: workspace,
      projectNameOverride: projectName,
      appendSystemPrompt: getImplementPrompt(state),
      onComplete: refreshAfterDispatch(state, projectName, ticketKey),
    });
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to resume run.'));
  }
}

async function archiveSelectedRun(runId: string): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `Archive run ${runId}? Its run record, log, and saved prompt will move under the run archive.`,
    'Archive',
    'Cancel'
  );
  if (confirm !== 'Archive') { return; }

  try {
    const archived = archiveRun(runId);
    const action = await vscode.window.showInformationMessage(`Archived run ${runId}.`, 'Open Archived Record');
    if (action === 'Open Archived Record') {
      await openRunArtifactFileIfExists(archived.runPath, 'Archived run record not found.');
    }
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to archive run.'));
  }
}

const FINISHED_ARCHIVE_STATUSES = new Set<KronosRun['status']>(['completed', 'waiting_for_review', 'failed', 'cancelled']);

function isFinishedArchiveRun(run: KronosRun): boolean {
  return FINISHED_ARCHIVE_STATUSES.has(run.status);
}

function runCountLabel(count: number): string {
  return `${count} finished run${count === 1 ? '' : 's'}`;
}

async function archiveFinishedRuns(): Promise<void> {
  const runs = listRuns().filter(isFinishedArchiveRun);
  if (runs.length === 0) {
    vscode.window.showInformationMessage('No completed, review-ready, failed, or cancelled Kronos runs to archive.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Archive ${runCountLabel(runs.length)}? Completed, review-ready, failed, and cancelled runs will move under the run archive. Active, paused, and needs-human runs stay visible.`,
    'Archive Finished',
    'Cancel'
  );
  if (confirm !== 'Archive Finished') { return; }

  let archived = 0;
  let failed = 0;
  for (const run of runs) {
    try {
      archiveRun(run.id);
      archived += 1;
    } catch (e: unknown) {
      failed += 1;
      console.warn(unknownErrorMessage(e, `Failed to archive ${run.id}.`));
    }
  }

  if (failed > 0) {
    vscode.window.showWarningMessage(`Archived ${runCountLabel(archived)}; ${failed} failed. See developer console for details.`);
    return;
  }
  vscode.window.showInformationMessage(`Archived ${runCountLabel(archived)}.`);
}

async function pauseSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  if (!supportsProcessTreeSuspend()) {
    vscode.window.showWarningMessage('Pausing Kronos runs is not supported on Windows. Use Stop to cancel the run, or let it continue.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Pause run ${run.id}? Kronos will send SIGSTOP to its process tree and keep the run visible as paused.`,
    'Pause Run',
    'Cancel'
  );
  if (confirm !== 'Pause Run') { return; }

  try {
    const signalResult = signalProcessTree(processPid, 'SIGSTOP');
    if (!signalResult.signalled) {
      vscode.window.showWarningMessage(`Run ${run.id} was not paused because no process signal was sent${signalResult.error ? `: ${signalResult.error}` : '.'}`);
      return;
    }
    markRunPaused(run.id, `Paused by operator. ${signalResult.method} SIGSTOP sent.`);
    vscode.window.showInformationMessage(`Paused run ${run.id}.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to pause run.'));
  }
}

async function continueSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  if (!supportsProcessTreeSuspend()) {
    vscode.window.showWarningMessage('Continuing paused Kronos runs is not supported on Windows. Use Resume or Retry for saved run artifacts.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Continue run ${run.id}? Kronos will send SIGCONT to its process tree and mark it running.`,
    'Continue Run',
    'Cancel'
  );
  if (confirm !== 'Continue Run') { return; }

  try {
    const signalResult = signalProcessTree(processPid, 'SIGCONT');
    if (!signalResult.signalled) {
      vscode.window.showWarningMessage(`Run ${run.id} was not continued because no process signal was sent${signalResult.error ? `: ${signalResult.error}` : '.'}`);
      return;
    }
    markRunContinued(run.id, `Continued by operator. ${signalResult.method} SIGCONT sent.`);
    vscode.window.showInformationMessage(`Continued run ${run.id}.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to continue run.'));
  }
}

async function cancelSelectedRun(run: KronosRun): Promise<void> {
  const processPid = runProcessPid(run);
  const status = String(run.status || 'unknown');
  const confirm = await vscode.window.showWarningMessage(
    `Cancel run ${run.id} (currently ${status})? Kronos will mark it cancelled and attempt to stop its process tree.`,
    'Cancel Run',
    'Keep Running'
  );
  if (confirm !== 'Cancel Run') { return; }

  try {
    const stopResult = stopProcessTree(processPid);
    if (stopResult.attempted && !stopResult.signalled) {
      vscode.window.showWarningMessage(`Run ${run.id} was not cancelled because process stop failed${stopResult.error ? `: ${stopResult.error}` : '.'}`);
      return;
    }
    markRunCancelled(
      run.id,
      stopResult.signalled
        ? `Cancelled by operator. ${stopResult.method} stop requested.`
        : 'Cancelled by operator. No process pid was recorded.',
    );
    vscode.window.showInformationMessage(`Marked run ${run.id} as cancelled.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to cancel run.'));
  }
}

async function openRunDiffArtifact(run: KronosRun): Promise<void> {
  const cwd = run.worktreePath || run.cwd || run.projectPath;
  if (!cwd || !fs.existsSync(cwd)) {
    vscode.window.showWarningMessage('Run workspace no longer exists.');
    return;
  }
  try {
    const artifact = createWorkspaceDiffArtifact(run, RUNS_DIR);
    await openRunArtifactFileIfExists(artifact.filePath, 'Run diff artifact not found.');
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to open run diff.'));
  }
}

async function markSelectedRunNeedsHuman(run: KronosRun): Promise<void> {
  const reason = await vscode.window.showInputBox({
    prompt: `Why does ${run.id} need human review?`,
    placeHolder: 'e.g., ambiguous product requirement, unsafe worktree, missing credential, manual QA needed',
  });
  if (reason === undefined) { return; }
  try {
    markRunNeedsHuman(run.id, reason);
    vscode.window.showInformationMessage(`Marked run ${run.id} as needs-human.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to mark run needs-human.'));
  }
}

function runLastEventLabel(run: KronosRun): string {
  const events = Array.isArray(run.events) ? run.events : [];
  const last = events[events.length - 1];
  return typeof last?.label === 'string' ? last.label : '';
}

function runQuickPickDetail(run: KronosRun): string {
  const status = String(run.status || '');
  const detail = isAttentionRunStatus(status)
    ? runAttentionDetail(run)
    : runLastEventLabel(run);
  return `${formatWebviewDateTime(run.startedAt)} - ${detail || run.cwd || ''}`;
}

function runQuickPickDescription(run: KronosRun): string {
  const status = String(run.status || 'unknown');
  if (!isAttentionRunStatus(status)) {
    return status;
  }
  const detail = runAttentionLine(run);
  return detail ? `${status} - ${detail}` : status;
}

function runProcessPid(run: KronosRun): number | undefined {
  const pid = Number(run.processPid ?? Reflect.get(run, 'pid'));
  return Number.isFinite(pid) && pid > 0 ? pid : undefined;
}

function findRunById(runId: string): KronosRun | undefined {
  return listRuns().find(run => run.id === runId);
}

function resolveRunItem(item: unknown): KronosRun | undefined {
  const runId = resolveRunId(item);
  return runId ? findRunById(runId) : undefined;
}

async function pickRun(runs: KronosRun[], placeHolder: string, emptyMessage: string): Promise<KronosRun | undefined> {
  if (runs.length === 0) {
    vscode.window.showInformationMessage(emptyMessage);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(runs.map(run => ({
    label: `${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}`,
    description: runQuickPickDescription(run),
    detail: runQuickPickDetail(run),
    run,
  })), { placeHolder });
  return picked?.run;
}

function kronosScriptableWebviewOptions(extensionUri?: vscode.Uri): vscode.WebviewOptions {
  return extensionUri
    ? { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')] }
    : { enableScripts: true, localResourceRoots: [] };
}

function kronosActionPanelScriptUri(panel: vscode.WebviewPanel, extensionUri?: vscode.Uri): string {
  const scriptUri = kronosMediaScriptUri(panel, extensionUri, WEBVIEW_ACTION_PANEL_SCRIPT);
  if (!scriptUri) {
    throw new Error('Kronos action panels require a packaged webview script URI.');
  }
  return scriptUri;
}

interface KronosActionWebviewPanel {
  panel: vscode.WebviewPanel;
  nonce: string;
  actionScriptUri: string;
}

function createKronosActionWebviewPanel(viewType: string, title: string, extensionUri?: vscode.Uri): KronosActionWebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    viewType,
    title,
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  return { panel, nonce, actionScriptUri };
}

function kronosJiraBoardScriptUri(panel: vscode.WebviewPanel, extensionUri?: vscode.Uri): string {
  const scriptUri = kronosMediaScriptUri(panel, extensionUri, WEBVIEW_JIRA_BOARD_SCRIPT);
  if (!scriptUri) {
    throw new Error('Kronos Jira Board requires a packaged webview script URI.');
  }
  return scriptUri;
}

function kronosMediaScriptUri(panel: vscode.WebviewPanel, extensionUri: vscode.Uri | undefined, scriptFile: string): string | undefined {
  return extensionUri
    ? panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', scriptFile)).toString()
    : undefined;
}

function openInteractiveRunCenter(state: KronosState, extensionUri?: vscode.Uri, focusRunId?: string): void {
  openRunCenter({
    extensionUri,
    focusRunId,
    onAction: request => executeRunCenterAction(state, request),
  });
}

async function executeRunCenterAction(state: KronosState, request: RunCenterActionRequest): Promise<void> {
  if (request.command === 'archiveFinishedRuns') {
    await archiveFinishedRuns();
    return;
  }
  const run = findRunById(request.runId);
  if (request.command === 'openRunRecord') {
    await openRunArtifactFileIfExists(runRecordPath(request.runId), 'Run record not found.');
    return;
  }
  if (!run) {
    vscode.window.showWarningMessage('Run record not found.');
    return;
  } else if (request.command === 'openRunLog') {
    await openRunArtifactFileIfExists(run.logPath, 'Run log not found.');
  } else if (request.command === 'openRunPrompt') {
    await openRunArtifactFileIfExists(run.promptPath, 'Run prompt artifact not found.');
  } else if (request.command === 'openRunWorkspace') {
    const cwd = run.worktreePath || run.cwd || run.projectPath;
    if (cwd && fs.existsSync(cwd)) {
      const terminal = vscode.window.createTerminal(kronosTerminalOptions({ name: `Kronos ${run.project || run.id}`, cwd }));
      terminal.show();
    } else {
      vscode.window.showWarningMessage('Run workspace no longer exists.');
    }
  } else if (request.command === 'openRunDiff') {
    await openRunDiffArtifact(run);
  } else if (request.command === 'markNeedsHuman') {
    await markSelectedRunNeedsHuman(run);
  } else if (request.command === 'pauseRun') {
    await pauseSelectedRun(run);
  } else if (request.command === 'continueRun') {
    await continueSelectedRun(run);
  } else if (request.command === 'cancelRun') {
    await cancelSelectedRun(run);
  } else if (request.command === 'resumeRun') {
    await resumeSelectedRun(state, run);
  } else if (request.command === 'retryRun') {
    await retryRunFromPrompt(state, run);
  } else if (request.command === 'archiveRun') {
    await archiveSelectedRun(request.runId);
  }
}

function openTicketExternalUrl(state: KronosState, ticketKey: string, kind: 'jira' | 'mr' | 'build'): void {
  const ticket = state.state?.tickets?.[ticketKey];
  if (!ticket) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  const url = kind === 'jira'
    ? ticketStringField(ticket, 'jira_url')
    : kind === 'mr'
      ? ticketStringField(isRecord(ticket.mr) ? ticket.mr : null, 'url')
      : ticketStringField(isRecord(ticket.build) ? ticket.build : null, 'url');
  if (!url) {
    vscode.window.showWarningMessage(`No ${kind} URL recorded for ${ticketKey}.`);
    return;
  }
  openExternalHttpUrl(url);
}

async function executeTicketDetailAction(state: KronosState, command: string, ticketKey: string, extensionUri?: vscode.Uri): Promise<void> {
  if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey || 'Ticket'} is no longer in Kronos state.`);
    return;
  }
  if (command === 'startTicket') {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (command === 'addToQueue') {
    await tryExecuteTicketOperatorCommand(command, ticketKey);
  } else if (command === 'removeFromQueue') {
    await removeTicketFromQueue(state, ticketKey, true, extensionUri);
  } else if (command === 'linkTicket') {
    await tryExecuteTicketOperatorCommand(command, ticketKey);
  } else if (await tryExecuteTicketOperatorCommand(command, ticketKey)) {
    return;
  } else if (command === 'openJira') {
    openTicketExternalUrl(state, ticketKey, 'jira');
  } else if (command === 'openMr') {
    openTicketExternalUrl(state, ticketKey, 'mr');
  } else if (command === 'openBuild') {
    openTicketExternalUrl(state, ticketKey, 'build');
  }
}

async function promptTicketView(
  state: KronosState,
  currentFilter: TicketFilter,
  currentGroupBy: TicketGroupBy,
  reviewOnly: boolean,
): Promise<{ filter: TicketFilter; groupBy: TicketGroupBy } | null> {
  const fields = [
    { label: 'Search text', id: 'query' },
    { label: 'Project', id: 'project' },
    { label: 'Action status', id: 'action' },
    { label: 'Priority', id: 'priority' },
    { label: 'Label', id: 'label' },
    { label: 'MR state', id: 'mrState' },
    { label: 'Build status', id: 'buildStatus' },
    { label: 'Stale age', id: 'staleDays' },
    ...(reviewOnly ? [] : [{ label: 'Link state', id: 'linked' }, { label: 'Group by', id: 'groupBy' }]),
    { label: 'Clear filters', id: 'clear' },
  ];
  const picked = await vscode.window.showQuickPick(fields, { placeHolder: `Current: ${describeTicketFilter(currentFilter)}` });
  if (!picked) { return null; }
  if (picked.id === 'clear') {
    return { filter: {}, groupBy: 'none' };
  }

  const filter: TicketFilter = { ...currentFilter };
  let groupBy = currentGroupBy;
  const tickets = Object.values(state.state?.tickets || {});

  if (picked.id === 'query') {
    setTicketFilterString(filter, 'query', await promptOptionalText('Ticket search text', filter.query));
  } else if (picked.id === 'project') {
    setTicketFilterString(filter, 'project', await promptOptionalChoice('Project', filter.project, uniqueStrings([
      ...Object.keys(state.state?.projects || {}),
      ...tickets.flatMap(ticket => ticket.projects || []),
    ])));
  } else if (picked.id === 'action') {
    setTicketFilterString(filter, 'action', await promptOptionalChoice('Action status', filter.action, uniqueStrings(tickets.map(ticket => ticket.next_action))));
  } else if (picked.id === 'priority') {
    setTicketFilterString(filter, 'priority', await promptOptionalChoice('Priority', filter.priority, uniqueStrings(tickets.map(ticket => ticket.priority))));
  } else if (picked.id === 'label') {
    setTicketFilterString(filter, 'label', await promptOptionalChoice('Label', filter.label, uniqueStrings(tickets.flatMap(ticket => ticket.labels || []))));
  } else if (picked.id === 'mrState') {
    setTicketFilterString(filter, 'mrState', await promptOptionalChoice('MR state', filter.mrState, uniqueStrings([
      'none',
      'opened',
      'merged',
      'closed',
      'pending_review',
      'approved',
      'changes_requested',
      ...tickets.flatMap(ticket => ticket.mr ? [ticket.mr.state, ticket.mr.review_status] : []),
    ])));
  } else if (picked.id === 'buildStatus') {
    setTicketFilterString(filter, 'buildStatus', await promptOptionalChoice('Build status', filter.buildStatus, uniqueStrings([
      'none',
      ...tickets.map(ticket => ticket.build?.status || ''),
    ])));
  } else if (picked.id === 'staleDays') {
    const value = await vscode.window.showInputBox({
      prompt: 'Minimum age in days; leave blank for any age',
      value: filter.staleDays ? String(filter.staleDays) : '',
      validateInput: value => !value.trim() || (/^\d+$/.test(value.trim()) && Number(value.trim()) > 0) ? null : 'Enter a positive whole number.',
    });
    if (value === undefined) { return null; }
    if (value.trim()) { filter.staleDays = Number(value.trim()); }
    else { delete filter.staleDays; }
  } else if (picked.id === 'linked') {
    const linked = await promptOptionalChoice('Link state', filter.linked, ['linked', 'unlinked']);
    if (linked === 'linked' || linked === 'unlinked') { filter.linked = linked; }
    else { delete filter.linked; }
  } else if (picked.id === 'groupBy') {
    const selected = await promptOptionalChoice('Group by', groupBy, ['none', 'action', 'project', 'priority']);
    groupBy = (selected === 'action' || selected === 'project' || selected === 'priority') ? selected : 'none';
  }

  return { filter: cleanTicketFilter(filter), groupBy };
}

async function promptOptionalText(placeHolder: string, current?: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({ placeHolder, value: current || '', prompt: 'Leave blank to clear this filter.' });
  if (value === undefined) { return current; }
  return value.trim() || undefined;
}

async function promptOptionalChoice(placeHolder: string, current: string | undefined, values: string[]): Promise<string | undefined> {
  const options: vscode.QuickPickItem[] = ['Any', ...values].map(value => {
    const option: vscode.QuickPickItem = { label: value };
    if (value === current) { option.description = 'current'; }
    return option;
  });
  const picked = await vscode.window.showQuickPick(options, { placeHolder });
  if (!picked) { return current; }
  return picked.label === 'Any' ? undefined : picked.label;
}

function setTicketFilterString<K extends 'query' | 'project' | 'action' | 'priority' | 'label' | 'mrState' | 'buildStatus'>(
  filter: TicketFilter,
  key: K,
  value: string | undefined,
): void {
  const trimmed = value?.trim();
  if (trimmed) { filter[key] = trimmed; }
  else { delete filter[key]; }
}

function cleanTicketFilter(filter: TicketFilter): TicketFilter {
  const cleaned: TicketFilter = {};
  if (filter.query?.trim()) { cleaned.query = filter.query.trim(); }
  if (filter.project?.trim()) { cleaned.project = filter.project.trim(); }
  if (filter.action?.trim()) { cleaned.action = filter.action.trim(); }
  if (filter.priority?.trim()) { cleaned.priority = filter.priority.trim(); }
  if (filter.label?.trim()) { cleaned.label = filter.label.trim(); }
  if (filter.mrState?.trim()) { cleaned.mrState = filter.mrState.trim(); }
  if (filter.buildStatus?.trim()) { cleaned.buildStatus = filter.buildStatus.trim(); }
  if (filter.staleDays && filter.staleDays > 0) { cleaned.staleDays = filter.staleDays; }
  if (filter.linked) { cleaned.linked = filter.linked; }
  return cleaned;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function getImplementPrompt(state: KronosState): string {
  return state.loadPrompt('implement-system');
}

function loadPromptForDispatch(
  state: KronosState,
  name: string,
  vars: Record<string, string> = {},
  projectPath?: string,
): { text: string; metadata: PromptRunMetadata } {
  const rendered = state.renderPrompt(name, vars, projectPath);
  if (!rendered) {
    return {
      text: '',
      metadata: { name, source: 'global', missingVariables: Object.keys(vars).sort() },
    };
  }
  return {
    text: rendered.text,
    metadata: {
      name: rendered.name,
      source: rendered.source,
      path: rendered.path,
      templateHash: rendered.templateHash,
      renderedHash: rendered.renderedHash,
      modifiedAt: rendered.modifiedAt,
      variables: rendered.variables,
      providedVariables: rendered.providedVariables,
      missingVariables: rendered.missingVariables,
    },
  };
}

function loadEnvFile(): void {
  const envPath = path.join(os.homedir(), '.claude', '.env');
  try {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const [k, ...rest] = trimmed.split('=');
        const key = k?.trim();
        if (!key) { continue; }
        const val = rest.join('=').trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) { process.env[key] = val; }
      }
    }
  } catch (e: unknown) {
    if (unknownErrorCode(e) !== 'ENOENT') {
      console.warn(unknownErrorMessage(e, `Could not load Kronos env file ${envPath}.`));
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  loadEnvFile();
  const state = new KronosState();

  const projectTree = new ProjectTreeProvider(state);
  const queueTree = new QueueTreeProvider(state);
  const sessionTree = new SessionTreeProvider(state);
  const taskTree = new TaskTreeProvider(state);
  const reviewTree = new ReviewTreeProvider(state, reviewSeenKeysStore(context.globalState));
  const notifiedReviewKeys = new Set<string>();
  const ticketTree = new TicketTreeProvider(state);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kronosSessions', sessionTree),
    vscode.window.registerTreeDataProvider('kronosTasks', taskTree),
  );

  // Shared refresh guard — prevents concurrent refresh calls
  let refreshing = false;
  let lastRefreshTime = 0;
  const throttledRefresh = async () => {
    if (refreshing || Date.now() - lastRefreshTime < 60000) { return; }
    refreshing = true;
    lastRefreshTime = Date.now();
    try {
      await state.refresh();
    } catch (e: unknown) {
      warnUnexpectedPanelIntegrationError(e, 'Kronos auto-refresh failed.');
    } finally {
      refreshing = false;
    }
  };

  // Tree views with auto-refresh on focus
  let attentionBadgeTarget: BadgeTarget | undefined;
  const updateAttentionBadge = () => {
    if (!attentionBadgeTarget) { return; }
    const summary = computeAttentionBadge({
      state: state.state,
      queue: state.queue,
      runs: listRuns(),
      newReviewItems: reviewTree.getNewReviewCount(),
      agingThresholds: agingThresholdsFromConfig(),
    });
    attentionBadgeTarget.badge = summary.count > 0
      ? { value: summary.count, tooltip: summary.tooltip }
      : undefined;
  };
  for (const [id, provider] of [
    ['kronosProjects', projectTree],
    ['kronosTickets', ticketTree],
    ['kronosQueue', queueTree],
    ['kronosReview', reviewTree],
  ] as const) {
    const view = vscode.window.createTreeView(id, { treeDataProvider: provider });
    if (id === 'kronosProjects') {
      attentionBadgeTarget = view;
    }
    const updateReviewBadge = () => {
      if (id !== 'kronosReview') { return; }
      const count = reviewTree.getNewReviewCount();
      view.badge = count > 0
        ? { value: count, tooltip: `${count} new review item${count === 1 ? '' : 's'}` }
        : undefined;
    };
    if (id === 'kronosReview') {
      updateReviewBadge();
      context.subscriptions.push(reviewTree.onDidChangeNewReviewCount(updateReviewBadge));
      context.subscriptions.push(reviewTree.onDidChangeNewReviewCount(() => notifyNewReviewItems(reviewTree, notifiedReviewKeys)));
      if (view.visible) {
        reviewTree.markVisibleReviewItemsSeen();
      }
    }
    const visibilitySubscription = view.onDidChangeVisibility(e => {
      if (!e.visible) { return; }
      void throttledRefresh().finally(() => {
        if (id === 'kronosReview') {
          reviewTree.markVisibleReviewItemsSeen();
        }
      });
    });
    context.subscriptions.push(view, visibilitySubscription);
  }
  updateAttentionBadge();
  context.subscriptions.push(
    state.onDidChange(updateAttentionBadge),
    state.onDidSessionChange(updateAttentionBadge),
    reviewTree.onDidChangeNewReviewCount(updateAttentionBadge),
  );

  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  statusBarItem.command = 'kronos.openDashboard';
  updateStatusBar(state);
  context.subscriptions.push(
    state.onDidChange(() => updateStatusBar(state)),
    state.onDidSessionChange(() => updateStatusBar(state)),
  );
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  let runtimePollingDisposables: vscode.Disposable[] = [];
  const stopRuntimePolling = () => {
    for (const disposable of runtimePollingDisposables.splice(0)) {
      disposable.dispose();
    }
  };
  const startRuntimePolling = () => {
    stopRuntimePolling();
    const config = vscode.workspace.getConfiguration('kronos');
    const sessionPollMs = configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000);
    sessionTree.startPolling(sessionPollMs);
    queueTree.startPolling(sessionPollMs);
    runtimePollingDisposables = [
      startBackgroundRefreshPoll(throttledRefresh, configIntervalSecondsMs(config.get<number>('pollIntervalSec', 300), 300, 1)),
      startReviewAutomation(state),
      startStatusBarRunRefresh(state, sessionPollMs),
    ];
  };
  const notifyStateLoadIssues = () => {
    if (state.loadIssues.length === 0) { return; }
    const loaded = state.state ? 'loaded with warnings' : 'could not load state.json';
    runNotificationCommandAction(
      vscode.window.showWarningMessage(`Kronos ${loaded}. Run Doctor for details.`, 'Run Doctor'),
      'Run Doctor',
      'kronos.doctor',
      'Failed to open Kronos Doctor.'
    );
  };
  const runStartupSideEffects = () => {
    startRuntimePolling();
    try {
      notifyStateLoadIssues();
    } catch (e: unknown) {
      warnUnexpectedPanelIntegrationError(e, 'Kronos startup state notification failed.');
    }
    try {
      if (!state.state || Object.keys(state.state.projects).length === 0) {
        runNotificationCommandAction(
          vscode.window.showInformationMessage(
            'Welcome to Kronos! Run setup to configure auth and scan for projects.',
            'Run Setup', 'Later'
          ),
          'Run Setup',
          'kronos.setup',
          'Failed to start Kronos setup.'
        );
      }

      // Report stale worktrees from previous sessions without deleting anything automatically.
      const cleanupPreview = cleanupStaleWorktrees({ remove: false });
      if (cleanupPreview.removable > 0 || cleanupPreview.blocked > 0) {
        runNotificationCommandAction(
          vscode.window.showWarningMessage(
            `Kronos found ${cleanupPreview.results.length} tracked worktree(s): ${cleanupPreview.removable} clean, ${cleanupPreview.blocked} need review.`,
            'Review Cleanup'
          ),
          'Review Cleanup',
          'kronos.cleanupWorktrees',
          'Failed to open Kronos worktree cleanup.'
        );
      }
    } catch (e: unknown) {
      warnUnexpectedPanelIntegrationError(e, 'Kronos startup cleanup check failed.');
    }
  };
  context.subscriptions.push(
    { dispose: stopRuntimePolling },
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('kronos.pollIntervalSec')
        || e.affectsConfiguration('kronos.sessionPollIntervalMs')
        || e.affectsConfiguration('kronos.reviewPollIntervalSec')
        || e.affectsConfiguration('kronos.profile')
      ) {
        startRuntimePolling();
        updateStatusBar(state);
        updateAttentionBadge();
      }
    }),
  );

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('kronos.refresh', async () => {
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Refreshing all projects...' },
        async () => {
          await state.refresh();
          lastRefreshTime = Date.now();
        },
        'Failed to refresh Kronos projects.'
      );
    }),

    vscode.commands.registerCommand('kronos.openExternalUrl', async (url: string) => {
      openExternalHttpUrl(String(url || ''));
    }),

    vscode.commands.registerCommand('kronos.refreshProject', async (item: unknown) => {
      const projectName = resolveProjectName(state, item) || await pickProjectName(state, 'Refresh which Kronos project?');
      if (projectName) {
        await state.refresh(projectName);
        lastRefreshTime = Date.now();
      }
    }),

    vscode.commands.registerCommand('kronos.filterTickets', async () => {
      const result = await promptTicketView(state, ticketTree.getFilter(), ticketTree.getGroupBy(), false);
      if (!result) { return; }
      ticketTree.setView(result.filter, result.groupBy);
      vscode.window.showInformationMessage(`Tickets view: ${describeTicketFilter(result.filter)}${result.groupBy !== 'none' ? `, grouped by ${result.groupBy}` : ''}.`);
    }),

    vscode.commands.registerCommand('kronos.ticketSavedView', async () => {
      const picked = await vscode.window.showQuickPick(
        TICKET_FILTER_PRESETS.map(preset => ({ label: preset.label, description: preset.id, preset })),
        { placeHolder: 'Saved ticket view' }
      );
      if (!picked) { return; }
      ticketTree.setView(picked.preset.view.filter, picked.preset.view.groupBy);
      vscode.window.showInformationMessage(`Tickets view: ${picked.preset.label}.`);
    }),

    vscode.commands.registerCommand('kronos.clearTicketFilters', async () => {
      ticketTree.clearView();
      vscode.window.showInformationMessage('Tickets view filters cleared.');
    }),

    vscode.commands.registerCommand('kronos.filterReviews', async () => {
      const result = await promptTicketView(state, reviewTree.getFilter(), 'none', true);
      if (!result) { return; }
      reviewTree.setFilter(result.filter);
      vscode.window.showInformationMessage(`Review view: ${describeTicketFilter(result.filter)}.`);
    }),

    vscode.commands.registerCommand('kronos.clearReviewFilters', async () => {
      reviewTree.clearFilter();
      vscode.window.showInformationMessage('Review filters cleared.');
    }),

    vscode.commands.registerCommand('kronos.discover', async () => {
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Scanning for projects...' },
        async () => {
          const result = await state.discover();
          try {
            const candidates: DiscoveredProject[] = result.candidates || [];
            if (candidates.length === 0) {
              vscode.window.showInformationMessage('No unregistered projects found in scan directories.');
              return;
            }

            // Show ALL repos, group by readiness
            const withConfig = candidates.filter(c => c.has_project_json);
            const withJiraGuess = candidates.filter(c => !c.has_project_json && c.suggested_jira_key);
            const noConfig = candidates.filter(c => !c.has_project_json && !c.suggested_jira_key);

            const items: vscode.QuickPickItem[] = [];

            if (withConfig.length > 0) {
              items.push({ label: '--- Ready to register (has config) ---', kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of withConfig) {
                items.push({ label: c.repo_name, description: '$(check) Has .claude/project.json', detail: c.path, picked: true });
              }
            }

            if (withJiraGuess.length > 0) {
              items.push({ label: `--- Jira key guessed (${withJiraGuess.length} repos) ---`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of withJiraGuess) {
                const parent = c.path.split(/[\\/]/).slice(-2, -1)[0] || '';
                items.push({ label: c.repo_name, description: `Jira: ${c.suggested_jira_key} | ${parent}`, detail: c.path });
              }
            }

            if (noConfig.length > 0) {
              items.push({ label: `--- No config (${noConfig.length} repos) ---`, kind: vscode.QuickPickItemKind.Separator } as vscode.QuickPickItem);
              for (const c of noConfig) {
                const parent = c.path.split(/[\\/]/).slice(-2, -1)[0] || '';
                items.push({ label: c.repo_name, description: `${parent} — needs Jira key`, detail: c.path });
              }
            }

            const selected = await vscode.window.showQuickPick<vscode.QuickPickItem>(items, {
              canPickMany: true,
              placeHolder: `Found ${candidates.length} repos — select which to register`,
            });

            if (selected && selected.length > 0) {
              let registered = 0;
              for (const s of selected) {
                if (!s.detail) { continue; }
                const candidate = candidates.find(c => c.path === s.detail);
                try {
                  await state.register(s.detail);
                  registered++;

                  // For repos without config AND no guessed Jira key, ask for one
                  if (candidate && !candidate.has_project_json && !candidate.suggested_jira_key) {
                    const jiraKey = await vscode.window.showInputBox({
                      prompt: `Jira project key for ${s.label}?`,
                      placeHolder: 'e.g., EDIPVR (leave empty to skip)',
                    });
                    if (jiraKey) {
                      setProjectConfigValue(s.label, 'jira_project_key', jiraKey);
                      state.reloadAndNotify();
                    }
                  }
                } catch (e: unknown) {
                  vscode.window.showWarningMessage(unknownErrorMessage(e, `Failed to register ${s.label || s.detail}.`));
                }
              }
              vscode.window.showInformationMessage(`Registered ${registered} project(s). Run Refresh to pull tickets.`);
            }
          } catch (e: unknown) {
            vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to parse discovery results.'));
          }
        },
        'Failed to discover Kronos projects.'
      );
    }),

    vscode.commands.registerCommand('kronos.register', async () => {
      const folders = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: 'Register Project',
      });
      if (folders && folders[0]) {
        await state.register(folders[0].fsPath);
        vscode.window.showInformationMessage(`Registered: ${folders[0].fsPath}`);
      }
    }),

    vscode.commands.registerCommand('kronos.implement', async (item: unknown) => {
      const ticketKey = resolveTicketKey(item);
      if (!ticketKey || !state.state) { return; }
      const ticket = state.state.tickets[ticketKey];
      if (!ticket) { return; }

      const projects = ticket.projects || [];
      let targetProjects: string[] = [];

      if (projects.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} is not linked to any project. Link it first.`);
        return;
      } else if (projects.length === 1) {
        targetProjects = projects;
      } else {
        const picks = await vscode.window.showQuickPick(
          projects.map(p => ({ label: p, picked: true })),
          { canPickMany: true, placeHolder: `${ticketKey} is linked to ${projects.length} projects — which to implement in?` }
        );
        if (!picks || picks.length === 0) { return; }
        targetProjects = picks.map(p => p.label);
      }

      const canStart = await confirmDispatchCollisions(state, { ticketKey, projects: targetProjects, action: 'implement' }, context.extensionUri);
      if (!canStart) { return; }

      for (const projName of targetProjects) {
        const projectPath = getProjectPath(state, projName);
        if (!projectPath) { continue; }
        const otherProjects = targetProjects.filter(p => p !== projName);
        const scopeHint = otherProjects.length > 0
          ? `\n\nADDITIONAL CONTEXT FROM USER: You are working in ${projName}. Focus ONLY on changes relevant to this codebase. Other projects also being updated for this ticket: ${otherProjects.join(', ')}.`
          : '';
        await startClaudeDispatch(projectPath, 'implement', ticketKey, {
          onComplete: refreshAfterDispatch(state, projName, ticketKey),
          parallel: true,
          appendSystemPrompt: getImplementPrompt(state) + scopeHint,
        });
      }
    }),

    vscode.commands.registerCommand('kronos.deployMonitor', async (item: unknown) => {
      const ticketKey = resolveTicketKey(item);
      const projectName = await pickTicketProjectNameForDispatch(
        state,
        item,
        ticketKey,
        ticketKey ? `Deploy monitor ${ticketKey} in which project?` : 'Deploy monitor which project?',
      );
      if (!projectName) { return; }
      const projectPath = getProjectPath(state, projectName);
      if (projectPath) {
        const promptMetadata: PromptRunMetadata = {
          source: 'slash',
          handoff: 'manual-deploy-monitor',
        };
        const mrIid = ticketKey ? state.state?.tickets?.[ticketKey]?.mr?.iid : undefined;
        if (mrIid !== undefined) { promptMetadata.mergeRequestIid = mrIid; }
        const dispatchOptions: DispatchOptions = {
          onComplete: refreshAfterDispatch(state, projectName, ticketKey),
          promptMetadata,
        };
        if (projectName) { dispatchOptions.projectNameOverride = projectName; }
        await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey, dispatchOptions);
      } else {
        vscode.window.showWarningMessage(projectName ? `${projectName} is not registered as a Kronos project.` : 'No project linked. Link the ticket to a project first.');
      }
    }),

    vscode.commands.registerCommand('kronos.verifyFix', async (item: unknown) => {
      const ticketKey = resolveTicketKey(item);
      const projectName = await pickTicketProjectNameForDispatch(
        state,
        item,
        ticketKey,
        ticketKey ? `Verify fix for ${ticketKey} in which project?` : 'Verify fix in which project?',
      );
      if (!projectName) { return; }
      const projectPath = getProjectPath(state, projectName);
      if (projectPath) {
        await startClaudeDispatch(projectPath, 'verify-fix', ticketKey, {
          onComplete: refreshAfterDispatch(state, projectName, ticketKey),
          projectNameOverride: projectName,
        });
      } else {
        vscode.window.showWarningMessage(projectName ? `${projectName} is not registered as a Kronos project.` : 'No project linked. Link the ticket to a project first.');
      }
    }),

    vscode.commands.registerCommand('kronos.startNext', async () => {
      try {
        const selection = selectNextQueueItem();
        if (selection.empty || !selection.item) {
          vscode.window.showInformationMessage('Queue is empty. Add tickets from the Tickets view.');
          return;
        }
        const item = selection.item;
        const projs: string[] = item.projects || [];
        const projLabel = projs.join(', ') || 'unlinked';
        if (item.action === 'refresh') {
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const p of projs) { await state.refresh(p); }
        } else if (projs.length > 0) {
          const dispatchTargets: Array<{ projectName: string; projectPath: string }> = [];
          const missingProjects: string[] = [];
          for (const projName of projs) {
            const projectPath = getProjectPath(state, projName);
            if (projectPath) {
              dispatchTargets.push({ projectName: projName, projectPath });
            } else {
              missingProjects.push(projName);
            }
          }
          if (missingProjects.length > 0) {
            vscode.window.showWarningMessage(`Cannot start ${item.ticket || item.id || 'queue item'}; linked project ${missingProjects.join(', ')} is not registered.`);
            return;
          }
          if (dispatchTargets.length === 0) {
            vscode.window.showWarningMessage(`Cannot start ${item.ticket || 'queue item'}; no project path was found.`);
            return;
          }
          const canStart = await confirmDispatchCollisions(state, {
            ticketKey: item.ticket,
            projects: projs,
            action: item.action,
            excludeQueueItemId: item.id,
          }, context.extensionUri);
          if (!canStart) { return; }
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const target of dispatchTargets) {
            const skill = skillForAction(item.action);
            const codeAction = isCodeAction(item.action);
            const ticketKey = item.ticket || undefined;
            const dispatchOptions: DispatchOptions = {
              onComplete: refreshAfterDispatch(state, target.projectName, ticketKey),
              parallel: codeAction,
              projectNameOverride: target.projectName,
            };
            if (codeAction) { dispatchOptions.appendSystemPrompt = getImplementPrompt(state); }
            await startClaudeDispatch(target.projectPath, skill, ticketKey, dispatchOptions);
          }
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to get next queue item.'));
      }
    }),

    vscode.commands.registerCommand('kronos.nextBestAction', async () => {
      const plans = planNextActions(state);
      if (plans.length === 0) {
        vscode.window.showInformationMessage('No actionable tickets found.');
        return;
      }

      const picked = await vscode.window.showQuickPick(
        plans.slice(0, 25).map(plan => {
          const context = buildNextActionContext(plan, { state: state.state, queue: state.queue });
          return {
            label: `${plan.ticketKey || 'Refresh'}: ${actionToLabel(plan.action)} (${plan.score})`,
            description: `${plan.projects.join(', ') || 'unlinked'} - risk: ${context.risks.join(', ')}`,
            detail: `${plan.reason} | ${context.commandLabel} | ${context.blockers.length ? `Blocked: ${context.blockers.join('; ')}` : `Preflight: ${context.preflight.join('; ')}`}`,
            plan,
            context,
          };
        }),
        { placeHolder: 'Next best Kronos action' }
      );
      if (!picked) { return; }

      const actions = picked.plan.ticketKey
        ? picked.plan.source === 'queue'
          ? ['Start', 'Pin to Queue', 'View Ticket', 'Add Evidence']
          : ['Start', 'Add to Queue', 'Pin to Queue', 'Snooze 1 Hour', 'Snooze Today', 'Reject Recommendation', 'View Ticket', 'Add Evidence']
        : ['Start'];
      const action = await vscode.window.showQuickPick(actions, { placeHolder: `${picked.label}: what should Kronos do?` });
      if (!action) { return; }

      if (action === 'Start') {
        await startPlannedAction(state, picked.plan, picked.context);
      } else if (action === 'Add to Queue' && picked.plan.ticketKey) {
        addPlanToQueue(state, picked.plan, false);
      } else if (action === 'Pin to Queue' && picked.plan.ticketKey) {
        addPlanToQueue(state, picked.plan, true);
      } else if (action === 'Snooze 1 Hour' && picked.plan.ticketKey) {
        recordPlanDecision(state, picked.plan, 'snoozed', 60);
        vscode.window.showInformationMessage(`Snoozed ${picked.plan.ticketKey} for 1 hour.`);
      } else if (action === 'Snooze Today' && picked.plan.ticketKey) {
        recordPlanDecision(state, picked.plan, 'snoozed', minutesUntilTomorrow());
        vscode.window.showInformationMessage(`Snoozed ${picked.plan.ticketKey} until tomorrow.`);
      } else if (action === 'Reject Recommendation' && picked.plan.ticketKey) {
        const reason = await vscode.window.showInputBox({
          prompt: `Why reject ${picked.plan.ticketKey}?`,
          placeHolder: 'e.g., not in scope this sprint, blocked by product',
        });
        if (reason === undefined) { return; }
        recordPlanDecision(state, picked.plan, 'rejected', undefined, reason || undefined);
        vscode.window.showInformationMessage(`Rejected ${picked.plan.ticketKey} recommendation.`);
      } else if (action === 'View Ticket' && picked.plan.ticketKey) {
        await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey: picked.plan.ticketKey });
      } else if (action === 'Add Evidence' && picked.plan.ticketKey) {
        await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: picked.plan.ticketKey });
      }
    }),

    vscode.commands.registerCommand('kronos.queuePlanner', async () => {
      openQueuePlannerPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.backlogTriage', async () => {
      openBacklogTriagePanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.projectBatchPlan', async () => {
      openProjectBatchPlanPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.releaseBatchPlan', async () => {
      openReleaseBatchPlanPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.collisionReport', async () => {
      await openCollisionReportPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.planNextTwoHours', async () => {
      openQueuePlanWindowPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.overnightCandidates', async () => {
      openOvernightCandidatesPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.addTask', async () => {
      const title = await vscode.window.showInputBox({
        prompt: 'Task title',
        placeHolder: 'e.g., Research 278 routing logic',
      });
      if (title) {
        await state.addTask(title);
      }
    }),

    vscode.commands.registerCommand('kronos.completeTask', async (item: unknown) => {
      const taskId = resolveTaskId(item);
      if (taskId) {
        await state.completeTask(taskId);
      }
    }),

    vscode.commands.registerCommand('kronos.openProject', async (item: unknown) => {
      const projectName = resolveProjectName(state, item);
      const projectPath = getProjectPath(state, projectName);
      if (projectName && projectPath) {
        const terminal = vscode.window.createTerminal(kronosTerminalOptions({
          name: projectName,
          cwd: projectPath,
        }));
        terminal.show();
      }
    }),

    vscode.commands.registerCommand('kronos.openInClaude', async (item: unknown) => {
      const projectName = resolveProjectName(state, item);
      const projectPath = getProjectPath(state, projectName);
      if (projectPath) {
        openInClaude(projectPath);
      }
    }),

    vscode.commands.registerCommand('kronos.jiraBoard', async () => {
      const panel = vscode.window.createWebviewPanel(
        'kronosJiraBoard', 'Kronos: Jira Board',
        vscode.ViewColumn.One, kronosScriptableWebviewOptions(context.extensionUri)
      );
      const nonce = createWebviewNonce();
      const logReady = createWebviewReadyMonitor(panel, 'Kronos Jira Board');
      const renderBoard = () => {
        const scriptUri = kronosJiraBoardScriptUri(panel, context.extensionUri);
        logReady.arm();
        panel.webview.html = withWebviewCsp(buildJiraBoardHtml(state, nonce, scriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
      };
      const hasTicket = (ticketKey: string) => Boolean(state.state?.tickets?.[ticketKey]);
      const hasProject = (projectName: string) => Boolean(state.state?.projects?.[projectName]);
      const openKnownTicketUrl = (ticketKey: string, kind: 'jira' | 'mr') => {
        const ticket = state.state?.tickets?.[ticketKey];
        const url = kind === 'jira' ? ticket?.jira_url : ticket?.mr?.url;
        if (url) {
          openExternalHttpUrl(url);
        } else {
          vscode.window.showWarningMessage(`${ticketKey} has no ${kind === 'jira' ? 'Jira' : 'merge request'} URL recorded.`);
        }
      };
      panel.webview.onDidReceiveMessage(async (msg) => {
        if (logReady(msg)) { return; }
        const request = normalizeBoardMessage(msg);
        if (!request) {
          vscode.window.showWarningMessage('Ignored invalid Kronos board request.');
          return;
        }
        await runWebviewPanelAction(async () => {
          const { command, ticket, project } = request;

          if (command === 'link' && hasTicket(ticket) && hasProject(project)) {
            try {
              linkTicketToProject(ticket, project);
              state.reloadAndNotify();
            } catch (e: unknown) {
              vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to link ticket.'));
            }
          } else if (command === 'unlink' && hasTicket(ticket) && hasProject(project)) {
            try {
              unlinkTicketFromProject(ticket, project);
              state.reloadAndNotify();
            } catch (e: unknown) {
              vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to unlink ticket.'));
            }
          } else if (command === 'addToQueue' && hasTicket(ticket)) {
            try {
              const result = addTicketToQueue(ticket);
              state.reloadAndNotify();
              if (result.alreadyInQueue) { vscode.window.showInformationMessage(`${ticket} is already in the queue.`); }
            } catch (e: unknown) {
              vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to add ticket to queue.'));
            }
          } else if (command === 'removeFromQueue' && hasTicket(ticket)) {
            await removeTicketFromQueue(state, ticket, true, context.extensionUri);
          } else if (command === 'start' && hasTicket(ticket)) {
            await startTicketFromActionPanel(state, ticket);
            return;
          } else if (command === 'openJira' && hasTicket(ticket)) {
            openKnownTicketUrl(ticket, 'jira');
            return;
          } else if (command === 'openMr' && hasTicket(ticket)) {
            openKnownTicketUrl(ticket, 'mr');
            return;
          } else if (command === 'getComments' && hasTicket(ticket)) {
            try {
              const result = await jiraAdapter.ticketComments(state, ticket);
              panel.webview.postMessage({ command: 'comments', ticket, data: result });
            } catch (e: unknown) {
              const detail = warnUnexpectedPanelIntegrationError(e, 'Could not load comments');
              panel.webview.postMessage({ command: 'comments', ticket, data: [], error: detail });
            }
            return;
          } else if (hasTicket(ticket) && await tryExecuteTicketOperatorCommand(command, ticket)) {
            renderBoard();
            return;
          } else {
            vscode.window.showWarningMessage('Ignored invalid Kronos board request.');
          }
          renderBoard();
        }, 'Kronos board action failed.');
      });
      renderBoard();
    }),

    vscode.commands.registerCommand('kronos.viewTicket', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state) { return; }
      if (!state.state.tickets[ticketKey]) { return; }
      const panel = vscode.window.createWebviewPanel(
        'kronosTicket', `${ticketKey}: Ticket`,
        vscode.ViewColumn.One, kronosScriptableWebviewOptions(context.extensionUri)
      );
      const nonce = createWebviewNonce();
      const actionScriptUri = kronosActionPanelScriptUri(panel, context.extensionUri);
      const logReady = createWebviewReadyMonitor(panel, `${ticketKey}: Ticket`);
      const render = () => {
        const freshTicket = state.state?.tickets?.[ticketKey];
        if (!freshTicket) {
          panel.webview.html = withWebviewCsp(`<!DOCTYPE html><html><body><div class="kronos-empty">Ticket not found.</div></body></html>`);
          return;
        }
        panel.title = `${ticketKey}: ${freshTicket.summary}`;
        logReady.arm();
        panel.webview.html = withWebviewCsp(buildTicketHtml(ticketKey, freshTicket, state, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
      };
      render();
      panel.webview.onDidReceiveMessage(async msg => {
        if (logReady(msg)) { return; }
        const request = normalizeActionPanelMessage(msg, TICKET_DETAIL_MESSAGE_COMMANDS);
        if (!request) {
          vscode.window.showWarningMessage('Ignored invalid Kronos ticket action.');
          return;
        }
        await runWebviewPanelAction(async () => {
          await executeTicketDetailAction(state, request.command, ticketKey, context.extensionUri);
          render();
        }, 'Kronos ticket action failed.');
      });
    }),

    vscode.commands.registerCommand('kronos.addEvidence', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for evidence.');
        return;
      }

      const kind = await vscode.window.showQuickPick(
        [
          { label: 'note', description: 'General implementation or review note' },
          { label: 'test', description: 'Verification command, result, or environment proof' },
          { label: 'risk', description: 'Known risk, gap, or follow-up to preserve' },
          { label: 'decision', description: 'Architecture or product decision made during work' },
        ],
        { placeHolder: `Evidence type for ${ticketKey}` }
      );
      if (!kind) { return; }

      const text = await vscode.window.showInputBox({
        prompt: `Evidence for ${ticketKey}`,
        placeHolder: 'e.g., npm test passed locally; Sonar gate is green; QA risk remains around OAuth timeout',
        ignoreFocusOut: true,
      });
      if (!text?.trim()) { return; }

      const evidenceKind = kind.label as 'note' | 'test' | 'risk' | 'decision';
      try {
        addTicketEvidenceNote(ticketKey, { kind: evidenceKind, text: text.trim() });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Added ${kind.label} evidence to ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add ticket evidence.'));
      }
    }),

    vscode.commands.registerCommand('kronos.addEvidenceCheck', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for evidence check.');
        return;
      }

      const name = await vscode.window.showInputBox({
        prompt: `Evidence check name for ${ticketKey}`,
        placeHolder: 'e.g., npm test, Jenkins build, Sonar gate, smoke checkout flow',
        ignoreFocusOut: true,
      });
      if (!name?.trim()) { return; }

      const result = await vscode.window.showQuickPick(
        [
          { label: 'pass', description: 'Check passed' },
          { label: 'warn', description: 'Check has caveats or partial coverage' },
          { label: 'fail', description: 'Check failed and should block handoff' },
          { label: 'unknown', description: 'Result is inconclusive' },
        ],
        { placeHolder: `Result for ${name.trim()}` }
      );
      if (!result) { return; }

      const environment = await vscode.window.showQuickPick(
        ['local', 'develop', 'test', 'prod', 'n/a'],
        { placeHolder: 'Environment for this check' }
      );
      if (!environment) { return; }

      const command = await vscode.window.showInputBox({
        prompt: 'Command or procedure used',
        placeHolder: 'e.g., npm test -- --runInBand; manual smoke through checkout retry',
        ignoreFocusOut: true,
      });
      if (command === undefined) { return; }

      const summary = await vscode.window.showInputBox({
        prompt: 'Short result summary',
        placeHolder: 'e.g., 214 tests passed; checkout retry returned 200 after timeout',
        ignoreFocusOut: true,
      });
      if (summary === undefined) { return; }

      const artifact = await vscode.window.showInputBox({
        prompt: 'Artifact path or URL (optional)',
        placeHolder: 'e.g., /tmp/kronos-checkout.log or https://jenkins/job/123',
        ignoreFocusOut: true,
      });
      if (artifact === undefined) { return; }

      const confidence = await vscode.window.showQuickPick(
        [
          { label: 'high', description: 'Directly proves the behavior' },
          { label: 'medium', description: 'Useful but partial coverage' },
          { label: 'low', description: 'Weak or indirect signal' },
        ],
        { placeHolder: 'Confidence level' }
      );
      if (!confidence) { return; }

      try {
        const evidenceCheck: TicketEvidenceCheckInput = {
          name: name.trim(),
          result: result.label as 'pass' | 'fail' | 'warn' | 'unknown',
          command,
          summary,
          artifactPath: artifact,
          confidence: confidence.label as 'low' | 'medium' | 'high',
        };
        if (environment !== 'n/a') { evidenceCheck.environment = environment; }
        addTicketEvidenceCheck(ticketKey, evidenceCheck);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Added ${result.label} evidence check to ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add evidence check.'));
      }
    }),

    vscode.commands.registerCommand('kronos.recordEnvironmentResult', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
        vscode.window.showWarningMessage('No ticket selected for environment result.');
        return;
      }

      const environment = await vscode.window.showQuickPick(
        ['local', 'develop', 'test', 'prod'],
        { placeHolder: `Environment result for ${ticketKey}` }
      );
      if (!environment) { return; }
      const status = await vscode.window.showQuickPick(
        [
          { label: 'pass', description: 'Environment check passed' },
          { label: 'warn', description: 'Environment check has caveats' },
          { label: 'fail', description: 'Environment check failed' },
          { label: 'unknown', description: 'Environment state is unknown' },
        ],
        { placeHolder: `Status for ${environment}` }
      );
      if (!status) { return; }
      const detail = await vscode.window.showInputBox({
        prompt: `${environment} result detail`,
        placeHolder: 'e.g., deployed build 123 passed smoke checkout retry',
        ignoreFocusOut: true,
      });
      if (!detail?.trim()) { return; }
      const artifact = await vscode.window.showInputBox({
        prompt: 'Artifact path or URL (optional)',
        placeHolder: 'e.g., Jenkins URL, screenshot, log path',
        ignoreFocusOut: true,
      });
      if (artifact === undefined) { return; }

      try {
        recordTicketEnvironmentResult(ticketKey, {
          environment,
          status: status.label as 'pass' | 'fail' | 'warn' | 'unknown',
          detail: detail.trim(),
          artifactPath: artifact,
        });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Recorded ${environment} ${status.label} result for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to record environment result.'));
      }
    }),

    vscode.commands.registerCommand('kronos.extractAcceptanceCriteria', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for acceptance criteria extraction.');
        return;
      }

      const existingCriteria = evidenceAcceptanceCriteria(ticket)
        .map(existingAcceptanceCriterion)
        .filter((criterion): criterion is ExistingAcceptanceCriterion => Boolean(criterion));
      const extracted = extractAcceptanceCriteria(ticket.description, existingCriteria);
      if (extracted.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} has no obvious acceptance criteria in its description.`);
        return;
      }

      const existingCount = existingCriteria.length;
      if (existingCount > 0) {
        const confirm = await vscode.window.showWarningMessage(
          `${ticketKey} already has ${existingCount} acceptance criterion item(s). Replace with ${extracted.length} extracted item(s)? Existing checked state is preserved when text matches.`,
          'Replace',
          'Cancel'
        );
        if (confirm !== 'Replace') { return; }
      }

      try {
        replaceTicketAcceptanceCriteria(ticketKey, extracted);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Extracted ${extracted.length} acceptance criterion item(s) for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to extract acceptance criteria.'));
      }
    }),

    vscode.commands.registerCommand('kronos.updateAcceptanceCriteria', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for acceptance criteria update.');
        return;
      }
      const criteria = evidenceAcceptanceCriteria(ticket)
        .filter(criterion => evidenceString(criterion, 'id').length > 0 && evidenceString(criterion, 'text').length > 0);
      if (criteria.length === 0) {
        const action = await vscode.window.showWarningMessage(
          `${ticketKey} has no extracted acceptance criteria.`,
          'Extract',
          'Cancel'
        );
        if (action === 'Extract') {
          await vscode.commands.executeCommand('kronos.extractAcceptanceCriteria', { ticketKey });
        }
        return;
      }

      const picked = await vscode.window.showQuickPick(
        criteria.map(criterion => ({
          label: evidenceString(criterion, 'text'),
          description: evidenceChecked(criterion) ? 'checked' : 'unchecked',
          detail: evidenceString(criterion, 'id'),
          picked: evidenceChecked(criterion),
          criterionId: evidenceString(criterion, 'id'),
        })),
        { canPickMany: true, placeHolder: `Checked acceptance criteria for ${ticketKey}` }
      );
      if (!picked) { return; }

      try {
        updateTicketAcceptanceCriteria(ticketKey, picked.map(item => item.criterionId));
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Updated ${picked.length}/${criteria.length} checked acceptance criterion item(s) for ${ticketKey}.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update acceptance criteria.'));
      }
    }),

    vscode.commands.registerCommand('kronos.evidenceGate', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (ticketKey && state.state?.tickets?.[ticketKey]) {
        openEvidenceGatePanel(state, [evaluateEvidenceGate(ticketKey, state.state.tickets[ticketKey])], `Evidence Gate: ${ticketKey}`, { extensionUri: context.extensionUri });
        return;
      }
      if (!state.state) {
        vscode.window.showWarningMessage('No Kronos state loaded.');
        return;
      }
      openEvidenceGatePanel(state, evidenceGatePanelGatesForState(state), 'Kronos Evidence Gate', { refreshAllEvidenceGates: true, extensionUri: context.extensionUri });
    }),

    vscode.commands.registerCommand('kronos.exportEvidence', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence export.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      await vscode.env.clipboard.writeText(exported.comment);
      const actions = ['Open Export'];
      if (ticket.jira_url) { actions.push('Open Jira'); }
      if (ticket.mr?.url) { actions.push('Open MR'); }
      const action = await vscode.window.showInformationMessage(
        `Exported evidence for ${ticketKey} and copied comment text.`,
        ...actions
      );
      if (action === 'Open Export') {
        await openTextFileIfExists(exported.filePath, 'Evidence export not found.');
      } else if (action === 'Open Jira' && ticket.jira_url) {
        openExternalHttpUrl(ticket.jira_url);
      } else if (action === 'Open MR' && ticket.mr?.url) {
        openExternalHttpUrl(ticket.mr.url);
      }
    }),

    vscode.commands.registerCommand('kronos.evidenceHandoff', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence handoff.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      const plan = buildEvidenceHandoffPlan(ticketKey, ticket, exported);
      await vscode.env.clipboard.writeText(plan.comment);
      openEvidenceHandoffPanel(plan, context.extensionUri);
      vscode.window.showInformationMessage(`Prepared evidence handoff for ${ticketKey} and copied comment text.`);
    }),

    vscode.commands.registerCommand('kronos.publishEvidence', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      const ticket = ticketKey ? state.state?.tickets?.[ticketKey] : undefined;
      if (!ticketKey || !ticket) {
        vscode.window.showWarningMessage('No ticket selected for evidence publishing.');
        return;
      }

      const exported = writeEvidenceExport(ticketKey, ticket);
      const plan = buildEvidencePublishPlan(ticketKey, ticket, exported.comment);
      const ready = readyPublishDestinations(plan);
      if (ready.length === 0) {
        openEvidencePublishPanel(plan.destinations.map(destination => {
          const result: EvidencePublishDestination = {
            kind: destination.kind,
            label: destination.label,
            status: destination.status,
            detail: destination.detail,
          };
          if (destination.endpoint) { result.endpoint = destination.endpoint; }
          return result;
        }), ticketKey, context.extensionUri);
        vscode.window.showWarningMessage(`No evidence publish destinations are ready for ${ticketKey}. Use Evidence Handoff for manual posting.`);
        return;
      }

      type EvidenceDestinationQuickPick = vscode.QuickPickItem & { destination: EvidencePublishDestination };
      const destinationItems: EvidenceDestinationQuickPick[] = ready.map(destination => {
        const item: EvidenceDestinationQuickPick = {
          label: destination.label,
          detail: destination.detail,
          destination,
          picked: true,
        };
        if (destination.endpoint) { item.description = destination.endpoint; }
        return item;
      });
      const selected = await vscode.window.showQuickPick(
        destinationItems,
        { placeHolder: `Publish evidence for ${ticketKey}`, canPickMany: true }
      );
      if (!selected || selected.length === 0) { return; }

      const canPublish = await confirmSafetyGate({
        operationId: 'kronos.publishEvidence',
        title: 'Publish Evidence Comment',
        target: ticketKey,
        risks: ['external-publish'],
        changes: selected.map(item => `Post the generated evidence comment to ${item.destination.label}.`),
        warnings: [
          'Review the generated evidence artifact before publishing. Kronos will not print credential values.',
          `Evidence markdown remains saved at ${exported.filePath}.`,
        ],
        confirmationLabel: 'Publish Evidence',
      });
      if (!canPublish) { return; }

      try {
        const results = await publishEvidencePlan(plan, selected.map(item => item.destination.kind));
        openEvidencePublishPanel(results, ticketKey, context.extensionUri);
        const posted = results.filter(result => result.status === 'posted').length;
        const failed = results.filter(result => result.status === 'failed').length;
        vscode.window.showInformationMessage(`Evidence publish complete for ${ticketKey}: ${posted} posted, ${failed} failed.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to publish evidence.'));
      }
    }),

    vscode.commands.registerCommand('kronos.addToQueue', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey) { return; }
      try {
        const data = addTicketToQueue(ticketKey);
        state.reloadAndNotify();
        if (data.alreadyInQueue) {
          vscode.window.showInformationMessage(`${ticketKey} is already in the queue.`);
        } else if (data.added) {
          vscode.window.showInformationMessage(`Added ${ticketKey} to queue.`);
        }
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to add to queue.'));
      }
    }),

    vscode.commands.registerCommand('kronos.removeFromQueue', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey) { return; }
      await removeTicketFromQueue(state, ticketKey, true, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.removeProject', async (item: unknown) => {
      const name = resolveProjectName(state, item);
      if (!name) { return; }
      const canRemove = await confirmSafetyGate({
        operationId: 'kronos.removeProject',
        title: 'Remove Project',
        target: name,
        risks: ['state-write'],
        changes: [
          `Unregister ${name} from Kronos state.`,
          'Move the project back to discovered repositories.',
        ],
        confirmationLabel: 'Remove',
      });
      if (!canRemove) { return; }
      try {
        const result = removeProjectFromState(name);
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Removed ${name}. Unlinked ${result.ticketsUnlinked.length} ticket(s) and kept it in discovered repos.`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, `Failed to remove ${name}.`));
      }
    }),

    vscode.commands.registerCommand('kronos.registerDiscovered', async (projectPath: string) => {
      if (projectPath) {
        try {
          await state.register(projectPath);
          const projectName = projectPath.split(/[\\/]/).pop() || '';
          vscode.window.showInformationMessage(`Registered: ${projectName}`);

          const setup = await vscode.window.showInformationMessage(
            `Set up ${projectName}? This will generate CLAUDE.md and find GitLab/SonarQube config.`,
            'Set Up', 'Skip'
          );
          if (setup === 'Set Up') {
            // Resolve and write project config from the extension side; agent sessions cannot write .claude/.
            let gitlabId: number | null = null;
            let sonarKey: string | null = null;
            try {
              const gitlabPath = originProjectPath(projectPath);
              try {
                gitlabId = await gitlabAdapter.projectId(gitlabPath);
              } catch (e: unknown) {
                vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not resolve GitLab project ID.'));
              }
              try {
                sonarKey = await sonarAdapter.projectKey(projectName);
              } catch (e: unknown) {
                vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not resolve SonarQube project key.'));
              }
            } catch (e: unknown) {
              vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not inspect project remotes for setup.'));
            }

            const profile = getActiveProfile();
            writeProjectSetupConfig({
              projectPath,
              projectName,
              gitlabProjectId: gitlabId,
              sonarProjectKey: sonarKey,
              defaultBranch: profile.defaultBaseBranch,
            });

            // Also update Kronos state so MR polling works immediately
            try {
              const updates = setProjectIntegrationConfig(projectName, {
                gitlabProjectId: gitlabId,
                sonarProjectKey: sonarKey,
                defaultBranch: profile.defaultBaseBranch,
              });
              if (updates.length > 0) {
                state.reloadAndNotify();
              }
            } catch (e: unknown) {
              vscode.window.showWarningMessage(unknownErrorMessage(e, 'Could not update Kronos project integration config.'));
            }

            const setupPrompt = `Set up project ${projectName} at ${projectPath}. Do these things:

1. Read the pom.xml for artifactId, groupId, parent, dependencies, build profiles
2. Read src/main/resources/application*.yml for datasources, ports, profiles
3. Check for existing CLAUDE.md — update it, or create one if missing
4. The CLAUDE.md should document: build commands (including gen profiles), run commands (profiles, port), mock server (if any), API endpoints, test data files, SonarQube config
5. Do NOT touch .claude/project.json — it has already been configured with gitlab_project_id=${gitlabId} and sonar_project_key=${sonarKey}
6. Report what was set up`;

            await startClaudeDispatch(projectPath, 'init-project', undefined, {
              onComplete: refreshAfterDispatch(state, projectName),
              customPrompt: setupPrompt,
            });
          }
        } catch (e: unknown) {
          vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to register project.'));
        }
      }
    }),

    vscode.commands.registerCommand('kronos.startQueueItem', async (treeItemOrData: unknown) => {
      const queueData = resolveQueueCommandItem(treeItemOrData);
      if (!queueData) { return; }

      const pathProject = getProjectNameForPath(state, queueData.projectPath);
      const projs = queueData.projects.length > 0 ? queueData.projects : pathProject ? [pathProject] : [];
      const directProjectPath = projs.length === 0 ? queueData.projectPath : undefined;
      const projLabel = projs.join(', ') || directProjectPath || 'unlinked';

      if (queueData.action === 'refresh') {
        if (projs.length === 0) {
          vscode.window.showWarningMessage(`Cannot refresh ${projLabel}; it is not registered as a Kronos project.`);
          return;
        }
        for (const p of projs) { await state.refresh(p); }
        vscode.window.showInformationMessage(`Refreshed ${projLabel}.`);
        return;
      }

      const skill = skillForAction(queueData.action);
      const codeAction = isCodeAction(queueData.action);

      if (projs.length === 0 && !directProjectPath) {
        vscode.window.showWarningMessage(`${queueData.ticket} is not linked to any project.`);
        return;
      }

      const dispatchTargets: Array<{ projectName?: string; projectPath: string }> = [];
      const missingProjects: string[] = [];
      for (const projName of projs) {
        const projectPath = getProjectPath(state, projName);
        if (projectPath) {
          dispatchTargets.push({ projectName: projName, projectPath });
        } else {
          missingProjects.push(projName);
        }
      }
      if (dispatchTargets.length === 0 && directProjectPath) {
        dispatchTargets.push({ projectPath: directProjectPath });
      }
      if (missingProjects.length > 0) {
        const target = queueData.ticket || queueData.id || 'queue item';
        vscode.window.showWarningMessage(`Cannot start ${target}; linked project ${missingProjects.join(', ')} is not registered.`);
        return;
      }
      if (dispatchTargets.length === 0) {
        vscode.window.showWarningMessage(`Cannot start ${queueData.ticket || 'queue item'}; no project path was found.`);
        return;
      }

      const collisionTarget: { ticketKey?: string | null; projects: string[]; action: string; excludeQueueItemId?: string } = {
        projects: projs,
        action: queueData.action,
      };
      if (queueData.ticket) { collisionTarget.ticketKey = queueData.ticket; }
      if (queueData.id) { collisionTarget.excludeQueueItemId = queueData.id; }
      const canStart = await confirmDispatchCollisions(state, collisionTarget, context.extensionUri);
      if (!canStart) { return; }

      const actionLabel = queueData.action.replace(/_/g, ' ');
      const extra = await vscode.window.showInputBox({
        prompt: `Starting [${actionLabel}] on ${projLabel}/${queueData.ticket || ''}. Any additional context? (leave empty to just start)`,
        placeHolder: 'e.g., focus on the auth flow, skip UI changes',
      });
      if (extra === undefined) { return; }
      const extraPrompt = extra ? `\n\nADDITIONAL CONTEXT FROM USER: ${extra}` : '';

      for (const target of dispatchTargets) {
        const otherProjects = target.projectName ? projs.filter(p => p !== target.projectName) : [];
        const projectLabel = target.projectName || target.projectPath;
        const scopeHint = otherProjects.length > 0 ? `\nYou are working in ${projectLabel}. Focus ONLY on this codebase. Other projects: ${otherProjects.join(', ')}.` : '';
        const dispatchOptions: DispatchOptions = {
          onComplete: refreshAfterDispatch(state, target.projectName, queueData.ticket),
          parallel: codeAction,
        };
        if (target.projectName) { dispatchOptions.projectNameOverride = target.projectName; }
        const appendSystemPrompt = codeAction ? getImplementPrompt(state) + scopeHint + extraPrompt : extraPrompt || undefined;
        if (appendSystemPrompt) { dispatchOptions.appendSystemPrompt = appendSystemPrompt; }
        await startClaudeDispatch(target.projectPath, skill, queueData.ticket || undefined, dispatchOptions);
      }
    }),

    vscode.commands.registerCommand('kronos.openDashboard', async () => {
      try {
        const panel = vscode.window.createWebviewPanel(
          'kronosDashboard',
          'Kronos Dashboard',
          vscode.ViewColumn.One,
          kronosScriptableWebviewOptions(context.extensionUri)
        );
        const nonce = createWebviewNonce();
        const actionScriptUri = kronosActionPanelScriptUri(panel, context.extensionUri);
        const logReady = createWebviewReadyMonitor(panel, 'Kronos Dashboard');
        const render = async () => {
          let data: unknown = {};
          let loadWarning: string | undefined;
          try {
            data = await state.morningBrief();
          } catch (e: unknown) {
            loadWarning = warnUnexpectedPanelIntegrationError(e, 'Morning brief unavailable.');
          }
          logReady.arm();
          panel.webview.html = withWebviewCsp(buildDashboardHtml(state, data, nonce, loadWarning, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
        };
        await render();
        startActiveRunPanelRefresh(panel, state, render);
        panel.webview.onDidReceiveMessage(async msg => {
          if (logReady(msg)) { return; }
          const request = normalizeActionPanelMessage(msg, DASHBOARD_MESSAGE_COMMANDS);
          if (!request) {
            vscode.window.showWarningMessage('Ignored invalid Kronos dashboard action.');
            return;
          }
          await runWebviewPanelAction(async () => {
            if (request.command === 'refreshPanel') {
              state.reloadAndNotify();
              await render();
              return;
            }
            await executeDashboardAction(state, request, context.extensionUri);
            await render();
          }, 'Kronos dashboard action failed.');
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to generate dashboard.'));
      }
    }),

    vscode.commands.registerCommand('kronos.queueMoveUp', async (treeItem: unknown) => {
      const idx = resolveQueueIndex(treeItem);
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'up');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.queueMoveDown', async (treeItem: unknown) => {
      const idx = resolveQueueIndex(treeItem);
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'down');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.queuePinTop', async (treeItem: unknown) => {
      const idx = resolveQueueIndex(treeItem);
      if (idx === undefined) { return; }
      const result = reorderQueueItem(idx, 'top');
      if (!result.changed) { return; }
      state.reloadAndNotify();
    }),

    vscode.commands.registerCommand('kronos.openMrDiff', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey) {
        const url = resolveMergeRequestUrl(treeItem);
        if (url) { openExternalHttpUrl(url); }
        return;
      }
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: `Loading diff for ${ticketKey}...` },
        async () => {
          try {
            const data = await gitlabAdapter.mergeRequestDiff(state, ticketKey);
            const panel = vscode.window.createWebviewPanel(
              'kronosMrDiff', `MR: ${data.mr.title}`,
              vscode.ViewColumn.One, { enableScripts: false }
            );
            panel.webview.html = withWebviewCsp(buildDiffHtml(data));
          } catch (e: unknown) {
            vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to load MR diff.'));
          }
        },
        'Failed to open merge request diff.'
      );
    }),

    vscode.commands.registerCommand('kronos.verifyLocal', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state) {
        vscode.window.showErrorMessage('No ticket selected.');
        return;
      }
      const ticket = state.state.tickets[ticketKey];
      const projs = ticket?.projects || [];
      let projectName: string;
      if (projs.length === 0) {
        vscode.window.showWarningMessage(`${ticketKey} is not linked to any project.`);
        return;
      } else if (projs.length === 1) {
        const onlyProject = projs[0];
        if (!onlyProject) { return; }
        projectName = onlyProject;
      } else {
        const pick = await vscode.window.showQuickPick(projs.map(p => ({ label: p })), { placeHolder: `Verify ${ticketKey} in which project?` });
        if (!pick) { return; }
        projectName = pick.label;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const confirm = await vscode.window.showInformationMessage(
        `Verify ${ticketKey} locally? Will build, start app, replay the defect, and compare local vs test env.`,
        'Verify', 'Cancel'
      );
      if (confirm !== 'Verify') { return; }

      const verifyPrompt = loadPromptForDispatch(state, 'verify-local', { TICKET_KEY: ticketKey }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-local', ticketKey, {
        onComplete: refreshAfterDispatch(state, projectName, ticketKey),
        customPrompt: verifyPrompt.text,
        promptMetadata: verifyPrompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.sonarScan', async (item: unknown) => {
      let projectName = resolveProjectName(state, item);
      if (!projectName && state.state) {
        projectName = await pickProjectName(state, 'Run SonarQube scan for which project?');
      }
      if (!projectName || !state.state) {
        vscode.window.showWarningMessage('No project found for scan.');
        return;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;
      const baseBranch = getProjectBaseBranch(state, projectName);

      const mode = await vscode.window.showQuickPick(
        [
          { label: `New scan (${baseBranch})`, description: `Checkout ${baseBranch}, pull latest, scan`, value: 'new' },
          { label: 'Pull latest & rescan', description: 'Pull latest on current branch, rescan', value: 'pull' },
        ],
        { placeHolder: 'SonarQube scan mode' }
      );
      if (!mode) { return; }

      const commandArg = recordFromUnknown(item);
      const branch = mode.value === 'new' ? (stringFromUnknown(commandArg['branch']) || baseBranch) : '';
      const scanPrompt = loadPromptForDispatch(state, 'sonar-scan', { PROJECT_NAME: projectName, SONAR_KEY: sonarKey, BRANCH: branch }, projectPath);

      await startClaudeDispatch(projectPath, 'sonar-scan', undefined, {
        onComplete: async (code: number, run: KronosRun) => {
          await refreshAfterDispatch(state, projectName)(code, run);
          const action = await vscode.window.showInformationMessage(
            `SonarQube scan complete for ${projectName}.`,
            'View Report', 'Dismiss'
          );
          if (action === 'View Report') {
            await vscode.commands.executeCommand('kronos.sonarReport', { projectName });
          }
        },
        customPrompt: scanPrompt.text,
        promptMetadata: scanPrompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.sonarReport', async (item: unknown) => {
      let projectName = resolveProjectName(state, item);
      if (!projectName && state.state) {
        projectName = await pickProjectName(state, 'Open SonarQube report for which project?');
      }
      if (!projectName || !state.state) {
        vscode.window.showWarningMessage('No project found.');
        return;
      }
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;
      const baseBranch = getProjectBaseBranch(state, projectName);

      let branchItems: vscode.QuickPickItem[] = [];
      try {
        const branchesData = await sonarAdapter.branches(sonarKey);
        const branches = branchesData.branches;
        branchItems = branches.map(b => ({
          label: b.name,
          description: `${b.isMain ? '(main) ' : ''}${b.status?.qualityGateStatus || ''}`,
        }));
      } catch (e: unknown) {
        const detail = unknownErrorMessage(e, 'Could not load SonarQube branches.');
        console.warn(detail);
        branchItems = [{ label: baseBranch, description: '(default; Sonar branches unavailable)', detail }];
      }
      if (branchItems.length === 0) {
        branchItems = [{ label: baseBranch, description: '(default)' }];
      }

      const picked = await vscode.window.showQuickPick(branchItems, { placeHolder: 'Select branch' });
      if (!picked) { return; }
      const branch = picked.label;

      try {
        const [gate, measures, issues] = await Promise.all([
          sonarAdapter.gate(sonarKey, branch),
          sonarAdapter.measures(sonarKey, branch),
          sonarAdapter.issues(sonarKey, branch),
        ]);
        const nonce = createWebviewNonce();
        const reportInput = {
          projectName,
          branch,
          sonarKey,
          gate,
          measures,
          issues,
          nonce,
        };
        if (process.env['SONAR_HOST_URL']) { Object.assign(reportInput, { host: process.env['SONAR_HOST_URL'] }); }
        const report = buildSonarReport(reportInput);
        const panel = vscode.window.createWebviewPanel('sonarReport', `Sonar: ${projectName}`, vscode.ViewColumn.One, { enableScripts: true, localResourceRoots: [] });
        panel.webview.html = withWebviewCsp(report.html, webviewScriptCspOptions(panel.webview.cspSource, nonce));

        const sonarCommands = new Set(['fixSonar', 'openSonar']);
        panel.webview.onDidReceiveMessage(async (msg: unknown) => {
          const command = normalizeWebviewCommand(msg, sonarCommands);
          if (command === 'fixSonar') {
            panel.dispose();
            await vscode.commands.executeCommand('kronos.fixSonarIssues', { projectName, sourceBranch: branch, issuesData: report.issueList });
          } else if (command === 'openSonar' && report.dashboardUrl) {
            openExternalHttpUrl(report.dashboardUrl);
          }
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to fetch SonarQube report.'));
      }
    }),

    vscode.commands.registerCommand('kronos.fixSonarIssues', async (item: unknown) => {
      if (!state.state) {
        vscode.window.showWarningMessage('No project found.');
        return;
      }
      let projectName = resolveProjectName(state, item);
      if (!projectName) {
        projectName = await pickProjectName(state, 'Fix SonarQube issues in which project?');
      }
      if (!projectName) { return; }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;

      const customInstructions = await vscode.window.showInputBox({
        placeHolder: 'e.g. suppress S107 on PasProviderValidationServiceImpl, skip S1192',
        prompt: 'Custom instructions: "suppress" = add @SuppressWarnings, "skip" = don\'t touch, blank = fix all',
      });
      if (customInstructions === undefined) { return; }

      const commandArg = recordFromUnknown(item);
      const sourceBranch = stringFromUnknown(commandArg['sourceBranch']) || '';
      const isProtected = !sourceBranch || sourceBranch === 'develop' || sourceBranch === 'main' || sourceBranch === 'master';
      const branchStrategy = isProtected
        ? `You are fixing issues from the ${sourceBranch || 'develop'} branch. Create a NEW branch: bugfix/sonar-${projectName.toLowerCase()} from ${sourceBranch || 'develop'}. After fixing and pushing, create a GitLab MR from your branch into ${sourceBranch || 'develop'} using: python ~/.claude/scripts/gitlab_api.py --create-mr`
        : `You are fixing issues on branch ${sourceBranch}. Stay on this branch — push directly, it already has an open MR.`;

      // Format pre-fetched issues if available
      let issuesBlock = '';
      const issuesData = normalizeSonarIssueCommandList(commandArg['issuesData']);
      if (issuesData.length > 0) {
        const lines = issuesData.map(formatSonarIssuePromptLine);
        issuesBlock = `KNOWN ISSUES (already fetched — do NOT re-query SonarQube for the issue list):\n${lines.join('\n')}`;
      }

      const instructionBlock = [
        customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${customInstructions}` : '',
        `BRANCH STRATEGY:\n${branchStrategy}`,
        issuesBlock,
      ].filter(Boolean).join('\n\n');

      const safetyPlan: SafetyPlan = {
        operationId: 'kronos.fixSonarIssues',
        title: 'Fix SonarQube Issues',
        target: `${projectName}${sourceBranch ? ` / ${sourceBranch}` : ''}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          isProtected
            ? `Create a new bugfix/sonar-${projectName.toLowerCase()} branch from ${sourceBranch || 'develop'}.`
            : `Modify the existing source branch ${sourceBranch}.`,
          'Apply source changes for SonarQube findings.',
          'May push changes and create or update a merge request through the agent prompt.',
        ],
        confirmationLabel: 'Fix Sonar',
      };
      if (customInstructions) { safetyPlan.warnings = ['Custom Sonar instructions will be passed to the agent.']; }
      const canFix = await confirmSafetyGate(safetyPlan);
      if (!canFix) { return; }

      const fixPrompt = loadPromptForDispatch(state, 'sonar-fix', { PROJECT_NAME: projectName, SONAR_KEY: sonarKey, CUSTOM_INSTRUCTIONS: instructionBlock }, projectPath);

      await startClaudeDispatch(projectPath, 'fix-sonar', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: fixPrompt.text,
        promptMetadata: fixPrompt.metadata,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.sonarCombined', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length === 0) {
        vscode.window.showInformationMessage('No open review MRs to fix.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Fix sonar issues in which project?', 'branches');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;

      const branchList = tickets.map(t => t.key).join(', ');
      const canFixAll = await confirmSafetyGate({
        operationId: 'kronos.sonarCombined',
        title: 'Fix SonarQube on Review Branches',
        target: `${projectName}: ${branchList}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          `Dispatch Sonar fix agents for ${tickets.length} review branch(es).`,
          'Agents may edit source files, push branch updates, and update merge requests.',
        ],
        confirmationLabel: 'Fix All',
      });
      if (!canFixAll) { return; }

      const customInstructions = await vscode.window.showInputBox({
        placeHolder: 'e.g. suppress S107 on PasProviderValidationServiceImpl, skip S1192',
        prompt: 'Custom instructions: "suppress" = add @SuppressWarnings, "skip" = don\'t touch, blank = fix all',
      });
      if (customInstructions === undefined) { return; }
      const instructionBlock = customInstructions ? `CUSTOM INSTRUCTIONS (follow these overrides):\n${customInstructions}` : '';

      for (const ticket of tickets) {
        // Find the remote branch for this ticket's MR
        let remoteBranch = '';
        if (ticket.mr?.url) {
          try {
            const branch = await gitlabAdapter.mergeRequestBranch(state, ticket.key);
            if (branch) { remoteBranch = `origin/${branch}`; }
          } catch (e: unknown) {
            console.warn(unknownErrorMessage(e, `Could not resolve MR branch for ${ticket.key}.`));
          }
        }
        if (!remoteBranch) {
          try {
            const first = firstRemoteBranchMatching(projectPath, `*${ticket.key}*`);
            if (first) { remoteBranch = first; }
          } catch (e: unknown) {
            console.warn(unknownErrorMessage(e, `Could not find fallback remote branch for ${ticket.key}.`));
          }
        }

        const prompt = loadPromptForDispatch(state, 'sonar-fix-branch', { SONAR_KEY: sonarKey, TICKET_KEY: ticket.key, CUSTOM_INSTRUCTIONS: instructionBlock }, projectPath);

        const dispatchOptions: DispatchOptions = {
          onComplete: refreshAfterDispatch(state, projectName, ticket.key),
          customPrompt: prompt.text,
          promptMetadata: prompt.metadata,
          parallel: true,
        };
        if (remoteBranch) { dispatchOptions.worktreeBranch = remoteBranch; }
        await startClaudeDispatch(projectPath, 'sonar-fix', ticket.key, dispatchOptions);
      }
    }),

    vscode.commands.registerCommand('kronos.fixFinding', async (args: unknown) => {
      const commandArg = recordFromUnknown(args);
      let projectName = resolveProjectName(state, args);
      if (!projectName && state.state) {
        projectName = await pickProjectName(state, 'Fix verification finding in which project?');
      }
      const projectPath = stringFromUnknown(commandArg['projectPath']) || getProjectPath(state, projectName);
      if (!projectPath || !projectName) {
        vscode.window.showWarningMessage('No project specified.');
        return;
      }

      const description = await vscode.window.showInputBox({
        prompt: 'Describe the finding to fix (or leave empty to fix all findings from the last verification)',
        placeHolder: 'e.g., missing routing_cache_v2.sql migration file for EDIPVR-3322',
      });
      if (description === undefined) { return; }

      const findingDesc = description || 'Fix all CRITICAL and FAIL findings from the last develop verification. Read the session history or git log to find what was flagged.';

      const safetyPlan: SafetyPlan = {
        operationId: 'kronos.fixFinding',
        title: 'Fix Verification Finding',
        target: projectName,
        risks: ['repo-write'],
        changes: [
          'Dispatch an agent in the project workspace.',
          'Allow source edits needed to address the verification finding.',
        ],
        confirmationLabel: 'Fix Finding',
      };
      if (!description) { safetyPlan.warnings = ['Blank finding text asks the agent to infer all critical/failing findings from prior context.']; }
      const canFix = await confirmSafetyGate(safetyPlan);
      if (!canFix) { return; }

      const prompt = loadPromptForDispatch(state, 'fix-finding', { FINDING_DESC: findingDesc }, projectPath);

      await startClaudeDispatch(projectPath, 'fix-finding', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.verifyDevelop', async (item: unknown) => {
      let projectName = resolveProjectName(state, item);
      if (!projectName || !state.state) {
        const projects = Object.keys(state.state?.projects || {});
        if (projects.length === 1) {
          projectName = projects[0];
          if (!projectName) { return; }
        }
        else {
          const pick = await vscode.window.showQuickPick(projects.map(p => ({ label: p })), { placeHolder: 'Verify develop for which project?' });
          if (!pick) { return; }
          projectName = pick.label;
        }
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const reviewTickets = Object.entries(state.state?.tickets || {})
        .filter(([_, t]) => t.mr && t.mr.state === 'merged' && t.projects.includes(projectName))
        .map(([k]) => k);
      const tickets = reviewTickets;
      if (tickets.length === 0) {
        vscode.window.showInformationMessage('No merged tickets found for this project.');
        return;
      }
      const ticketList = tickets.join(', ');

      const canVerify = await confirmSafetyGate({
        operationId: 'kronos.verifyDevelop',
        title: 'Verify Develop',
        target: `${projectName}: ${ticketList}`,
        risks: ['repo-write'],
        changes: [
          'Dispatch an agent in the project workspace.',
          'Run develop verification for merged tickets.',
          'May create local artifacts or follow-up findings.',
        ],
        confirmationLabel: 'Verify Develop',
      });
      if (!canVerify) { return; }

      const prompt = loadPromptForDispatch(state, 'verify-develop', { PROJECT_NAME: projectName, TICKET_LIST: ticketList }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-develop', undefined, {
        onComplete: async (code: number, run: KronosRun) => {
          await refreshAfterDispatch(state, projectName)(code, run);
          const action = await vscode.window.showInformationMessage(
            `Develop verification complete for ${projectName}. Fix any findings?`,
            'Fix Findings', 'Dismiss'
          );
          if (action === 'Fix Findings') {
            await vscode.commands.executeCommand('kronos.fixFinding', { projectName, projectPath, tickets: ticketList });
          }
        },
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.verifyTest', async () => {
      if (!state.state) { return; }

      const mergedTickets = Object.entries(state.state.tickets)
        .filter(([_, t]) => t.mr && t.mr.state === 'merged')
        .map(([k, t]) => ({ key: k, summary: t.summary, projects: t.projects }));
      if (mergedTickets.length === 0) {
        vscode.window.showInformationMessage('No merged tickets to verify in TEST.');
        return;
      }

      const picked = await pickProjectFromTickets(state, mergedTickets, 'Verify TEST for which project?', 'merged tickets');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const ticketList = tickets.map(t => t.key).join(', ');

      const canVerify = await confirmSafetyGate({
        operationId: 'kronos.verifyTest',
        title: 'Verify TEST',
        target: `${projectName}: ${ticketList}`,
        risks: ['repo-write'],
        changes: [
          `Dispatch TEST verification for ${tickets.length} merged ticket(s).`,
          'May start local tooling and write verification artifacts.',
        ],
        confirmationLabel: 'Verify',
      });
      if (!canVerify) { return; }

      const prompt = loadPromptForDispatch(state, 'verify-test', { PROJECT_NAME: projectName, TICKET_LIST: ticketList }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-test', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.resolveConflicts', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length < 2) {
        vscode.window.showInformationMessage('Need at least 2 open review MRs to resolve conflicts.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Resolve conflicts in which project?', 'branches');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;

      const ordered = await vscode.window.showQuickPick(
        tickets.map(t => ({ label: t.key, description: t.summary, picked: true })),
        { canPickMany: true, placeHolder: 'Select branches in MERGE ORDER (first = merge first, last = merge last)' }
      );
      if (!ordered || ordered.length < 2) { return; }

      const mergeOrder = ordered.map(o => o.label);
      const branchLookups = await Promise.all(mergeOrder.map(async k => {
        try {
          const branch = await gitlabAdapter.mergeRequestBranch(state, k);
          return { key: k, branch };
        } catch (e: unknown) {
          console.warn(unknownErrorMessage(e, `Could not resolve MR branch for ${k}.`));
          return { key: k, branch: k };
        }
      }));

      const branchOrder = branchLookups.map((b, i) => `${i + 1}. ${b.key} (branch: ${b.branch})`).join('\n');
      const canResolve = await confirmSafetyGate({
        operationId: 'kronos.resolveConflicts',
        title: 'Resolve Merge Conflicts',
        target: `${projectName}: ${mergeOrder.join(', ')}`,
        risks: ['branch-switch', 'repo-write'],
        changes: [
          'Dispatch an agent to merge review branches in the selected order.',
          'Allow conflict-resolution source edits in the project workspace.',
        ],
        warnings: ['Branch order affects conflict resolution and final combined state.'],
        confirmationLabel: 'Resolve Conflicts',
      });
      if (!canResolve) { return; }
      const prompt = loadPromptForDispatch(state, 'resolve-conflicts', { BRANCH_ORDER: branchOrder }, projectPath);

      await startClaudeDispatch(projectPath, 'resolve-conflicts', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: prompt.text,
        promptMetadata: prompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.verifyCombined', async () => {
      if (!state.state) { return; }
      const reviewTickets = reviewBranchTickets(state);
      if (reviewTickets.length === 0) {
        vscode.window.showInformationMessage('No open review MRs to verify.');
        return;
      }

      const picked = await pickProjectFromTickets(state, reviewTickets, 'Verify combined changes in which project?', 'MRs');
      if (!picked) { return; }
      const { projectName, projectPath, tickets } = picked;
      const branchPlans = buildCombinedVerificationPlan(tickets);

      const branchList = branchPlans.map(plan => `${plan.ticketKey} (${plan.branch}, MR ${plan.mrIid ? `!${plan.mrIid}` : '?'})`).join(', ');
      const canVerify = await confirmSafetyGate({
        operationId: 'kronos.verifyCombined',
        title: 'Verify Combined MRs',
        target: `${projectName}: ${branchList}`,
        risks: ['branch-switch', 'repo-write'],
        changes: [
          `Merge ${tickets.length} review branch(es) into a combined local state.`,
          'Run combined verification in the project workspace.',
        ],
        warnings: ['Local merge conflicts may require manual recovery if the agent cannot resolve them.'],
        confirmationLabel: 'Verify',
      });
      if (!canVerify) { return; }

      const promptVars = buildCombinedVerificationPromptVars(branchPlans);

      const combinedPrompt = loadPromptForDispatch(state, 'verify-combined', {
        TICKET_KEYS: promptVars.ticketKeys,
        MERGE_COMMANDS: promptVars.mergeCommands,
        BRANCH_TABLE: promptVars.branchTable
      }, projectPath);

      await startClaudeDispatch(projectPath, 'verify-combined', undefined, {
        onComplete: refreshAfterDispatch(state, projectName),
        customPrompt: combinedPrompt.text,
        promptMetadata: combinedPrompt.metadata,
      });
    }),

    vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state) { return; }
      const ticket = state.state.tickets[ticketKey];
      const projs = ticket?.projects || [];
      let projectName: string;
      if (projs.length === 0) { return; }
      else if (projs.length === 1) {
        const onlyProject = projs[0];
        if (!onlyProject) { return; }
        projectName = onlyProject;
      }
      else {
        const pick = await vscode.window.showQuickPick(projs.map(p => ({ label: p })), { placeHolder: `Send back ${ticketKey} to which project?` });
        if (!pick) { return; }
        projectName = pick.label;
      }
      const projectPath = getProjectPath(state, projectName);
      if (!projectPath) { return; }

      const feedback = await vscode.window.showInputBox({
        prompt: `What's missing or wrong with ${ticketKey}? (Claude will continue on the existing branch)`,
        placeHolder: 'e.g., missing migration file, service layer not updated, AC #1 and #5 not met',
      });
      if (!feedback) { return; }

      const branch = ticket?.mr ? `${ticketKey}` : undefined;
      const canContinue = await confirmSafetyGate({
        operationId: 'kronos.rejectReview',
        title: 'Send Review Back to Agent',
        target: `${ticketKey} / ${projectName}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          'Dispatch an implementation agent on the existing review branch.',
          'Apply source changes based on the supplied feedback.',
          'May push branch updates through the agent prompt.',
        ],
        confirmationLabel: 'Continue Work',
      });
      if (!canContinue) { return; }

      const continuePrompt = loadPromptForDispatch(state, 'continue-work', { TICKET_KEY: ticketKey, BRANCH: branch || ticketKey, FEEDBACK: feedback }, projectPath);

      await startClaudeDispatch(projectPath, 'implement', ticketKey, {
        onComplete: refreshAfterDispatch(state, projectName, ticketKey),
        customPrompt: continuePrompt.text,
        promptMetadata: continuePrompt.metadata,
        appendSystemPrompt: getImplementPrompt(state),
      });
    }),

    vscode.commands.registerCommand('kronos.linkMrToTicket', async (treeItem: unknown) => {
      let orphanKey = resolveTicketKey(treeItem);
      if (!orphanKey && state.state) {
        orphanKey = await pickOrphanMergeRequestTicket(state.state);
      }
      if (!orphanKey || !state.state) { return; }
      const orphan = state.state.tickets[orphanKey];
      if (!orphan?.mr) {
        vscode.window.showWarningMessage('No merge request found to link.');
        return;
      }

      const ticketKey = await vscode.window.showInputBox({
        prompt: `Link MR !${orphan.mr.iid} to which Jira ticket?`,
        placeHolder: 'e.g. EDIPVR-3413',
      });
      if (!ticketKey) { return; }

      let preview;
      try {
        preview = previewLinkMergeRequestToTicket(state.state, {
          orphanKey,
          targetTicketKey: ticketKey,
          jiraBaseUrl: process.env['JIRA_BASE_URL'] || 'https://bcbsma.atlassian.net',
        });
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to preview merge request link.'));
        return;
      }

      let allowReviewHandoffWithWarnings = false;
      if (preview.reviewReady) {
        const handoffDecision = decideEvidenceHandoff(ticketKey, preview.ticket);
        const evidenceTicketKey = state.state.tickets[ticketKey] ? ticketKey : orphanKey;
        if (!handoffDecision.allowed) {
          const action = await vscode.window.showWarningMessage(
            handoffDecision.message,
            'Open Gate',
            'Add Evidence',
            'Cancel'
          );
          if (action === 'Open Gate') {
            openEvidenceGatePanel(state, [handoffDecision.gate], `Evidence Gate: ${ticketKey}`, { extensionUri: context.extensionUri });
          } else if (action === 'Add Evidence') {
            await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey: evidenceTicketKey });
          }
          return;
        }
        if (handoffDecision.requiresConfirmation) {
          const action = await vscode.window.showWarningMessage(
            handoffDecision.message,
            'Continue Handoff',
            'Open Gate',
            'Cancel'
          );
          if (action === 'Open Gate') {
            openEvidenceGatePanel(state, [handoffDecision.gate], `Evidence Gate: ${ticketKey}`, { extensionUri: context.extensionUri });
            return;
          }
          if (action !== 'Continue Handoff') { return; }
          allowReviewHandoffWithWarnings = true;
        }
      }

      const canLink = await confirmSafetyGate({
        operationId: 'kronos.linkMrToTicket',
        title: 'Link Merge Request to Ticket',
        target: `${orphanKey} -> ${ticketKey}`,
        risks: ['state-write'],
        changes: [
          `Attach MR !${orphan.mr.iid} to ${ticketKey}.`,
          preview.reviewReady ? 'Mark the ticket as review-ready only after the evidence gate check.' : 'Keep the ticket out of review-ready handoff state.',
          orphanKey !== ticketKey ? `Remove orphan ticket entry ${orphanKey}.` : `Update ${ticketKey} in place.`,
        ],
        confirmationLabel: 'Link MR',
      });
      if (!canLink) { return; }

      try {
        linkMergeRequestToTicket({
          orphanKey,
          targetTicketKey: ticketKey,
          jiraBaseUrl: process.env['JIRA_BASE_URL'] || 'https://bcbsma.atlassian.net',
          allowReviewHandoffWithWarnings,
        });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Linked MR !${orphan.mr.iid} → ${ticketKey}`);
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to link merge request to ticket.'));
      }
    }),

    vscode.commands.registerCommand('kronos.openMrInGitlab', async (treeItem: unknown) => {
      const url = resolveMergeRequestUrl(treeItem);
      if (url) { openExternalHttpUrl(url); }
    }),

    vscode.commands.registerCommand('kronos.setup', async () => {
      await runSetupWizard();
    }),

    vscode.commands.registerCommand('kronos.settings', async () => {
      await runSettingsMenu(state);
    }),

    vscode.commands.registerCommand('kronos.linkTicket', async (ticketKeyOrItem: unknown) => {
      const ticketKey = resolveTicketKey(ticketKeyOrItem);
      if (!ticketKey || !state.state) { return; }
      const allProjects = Object.keys(state.state.projects);
      if (allProjects.length === 0) {
        vscode.window.showWarningMessage('No projects registered.');
        return;
      }
      const current = state.state.tickets[ticketKey]?.projects || [];
      const picks = await vscode.window.showQuickPick(
        allProjects.map(p => ({ label: p, picked: current.includes(p), description: current.includes(p) ? 'linked' : '' })),
        { canPickMany: true, placeHolder: `Select projects for ${ticketKey} (toggle on/off)` }
      );
      if (!picks) { return; }
      const selected = picks.map(p => p.label);
      try {
        for (const p of selected) {
          if (!current.includes(p)) { linkTicketToProject(ticketKey, p); }
        }
        for (const p of current) {
          if (!selected.includes(p)) { unlinkTicketFromProject(ticketKey, p); }
        }
        state.reloadAndNotify();
      } catch (e: unknown) {
        vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update ticket project links.'));
      }
    }),

    vscode.commands.registerCommand('kronos.unlinkTicket', async (item: unknown) => {
      const ticketKey = resolveTicketKey(item);
      const projectName = stringFromUnknown(recordFromUnknown(item)['linkedProject']);
      if (ticketKey && projectName) {
        const canUnlink = await confirmSafetyGate({
          operationId: 'kronos.unlinkTicket',
          title: 'Unlink Ticket from Project',
          target: `${ticketKey} / ${projectName}`,
          risks: ['state-write'],
          changes: [
            `Remove ${projectName} from ${ticketKey}'s linked projects.`,
            'Leave Jira, MR, and repository data untouched.',
          ],
          confirmationLabel: 'Unlink',
        });
        if (!canUnlink) { return; }
        try {
          unlinkTicketFromProject(ticketKey, projectName);
          state.reloadAndNotify();
        } catch (e: unknown) {
          vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to unlink ticket.'));
        }
      }
    }),

    vscode.commands.registerCommand('kronos.sessionHistory', async () => {
      const sessions = listSavedSessions();
      const issues = listSessionStoreIssues();
      if (sessions.length === 0) {
        if (issues.length > 0) {
          vscode.window.showWarningMessage(`No readable saved sessions. Kronos found ${issues.length} saved session store issue(s). Run Kronos: Doctor.`);
        } else {
          vscode.window.showInformationMessage('No saved sessions yet.');
        }
        return;
      }
      const items = sessions.map(s => {
        const date = toValidDate(s.startedAt);
        const isDone = s.events.some(e => e.type === 'done');
        const icon = isDone ? '$(check)' : '$(error)';
        return {
          label: `${icon} ${s.project} — ${s.skill} ${s.ticket}`,
          description: date?.toLocaleString() || 'Unknown',
          detail: s.events.find(e => e.type === 'done')?.label || s.events[s.events.length - 1]?.label || '',
          session: s,
        };
      });
      const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select a session to reopen' });
      if (pick) { openSavedSession(pick.session); }
    }),

    vscode.commands.registerCommand('kronos.stats', async () => {
      const stats = getAggregateStats();
      const issues = listSessionStoreIssues();
      const sessions = stats.sessions;
      if (sessions.length === 0) {
        if (issues.some(issue => issue.kind === 'invalid_session_stats')) {
          vscode.window.showWarningMessage('No readable session stats. Kronos found an invalid stats.json. Run Kronos: Doctor.');
        } else {
          vscode.window.showInformationMessage('No session data yet. Run some actions to collect stats.');
        }
        return;
      }
      const panel = vscode.window.createWebviewPanel('kronosStats', 'Kronos: Session Stats', vscode.ViewColumn.One, kronosScriptableWebviewOptions(context.extensionUri));
      const nonce = createWebviewNonce();
      const actionScriptUri = kronosActionPanelScriptUri(panel, context.extensionUri);
      attachOperatorCommandHandler(panel, 'Kronos Session Stats', SESSION_STATS_OPERATOR_COMMANDS);
      const esc = escapeHtml;

      const totalSessions = sessions.length;
      const successes = sessions.filter(s => s.verdict === 'success').length;
      const avgDuration = Math.round(sessions.reduce((a, s) => a + s.durationSec, 0) / totalSessions);
      const avgTools = Math.round(sessions.reduce((a, s) => a + s.toolCalls, 0) / totalSessions);
      const totalErrors = sessions.reduce((a, s) => a + s.toolErrors, 0);
      const totalFiles = sessions.reduce((a, s) => a + s.filesEdited, 0);

      const bySkill: Record<string, typeof sessions> = {};
      for (const s of sessions) {
        const bucket = bySkill[s.skill] || [];
        bucket.push(s);
        bySkill[s.skill] = bucket;
      }

      const skillRows = Object.entries(bySkill).map(([skill, items]) => {
        const avg = Math.round(items.reduce((a, s) => a + s.durationSec, 0) / items.length);
        const succ = items.filter(s => s.verdict === 'success').length;
        const tools = Math.round(items.reduce((a, s) => a + s.toolCalls, 0) / items.length);
        return `<tr><td>${esc(skill)}</td><td>${items.length}</td><td>${succ}/${items.length}</td><td>${avg}s</td><td>${tools}</td></tr>`;
      }).join('');

      const recentRows = sessions.slice(-15).reverse().map(s => {
        const date = formatWebviewDateTime(s.startedAt);
        const verdict = s.verdict === 'success' ? '<span class="pill pass">PASS</span>' : '<span class="pill fail">FAIL</span>';
        return `<tr><td>${date}</td><td>${esc(s.project)}</td><td>${esc(s.skill)}</td><td>${esc(s.ticket || '-')}</td><td>${verdict}</td><td>${s.durationSec}s</td><td>${s.toolCalls}</td><td>${s.toolErrors}</td><td>${s.filesEdited}</td></tr>`;
      }).join('');
      const actions = operatorCommandRow([
        actionButton('runCenter', 'Run Center'),
        actionButton('sessionHistory', 'Session History'),
        actionButton('agentQualityScore', 'Agent Quality'),
        actionButton('trendMetrics', 'Trend Metrics'),
      ]);

      panel.webview.html = withWebviewCsp(`<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Session Stats</h1>
      <div class="kronos-subtitle">Aggregate run outcomes, tool use, errors, and recent session history</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${totalSessions}</div><div class="lbl">Sessions</div></div>
    <div class="summary-card"><div class="num">${successes}/${totalSessions}</div><div class="lbl">Success Rate</div></div>
    <div class="summary-card"><div class="num">${avgDuration}s</div><div class="lbl">Avg Duration</div></div>
    <div class="summary-card"><div class="num">${avgTools}</div><div class="lbl">Avg Tool Calls</div></div>
    <div class="summary-card"><div class="num">${totalErrors}</div><div class="lbl">Total Errors</div></div>
    <div class="summary-card"><div class="num">${totalFiles}</div><div class="lbl">Files Changed</div></div>
  </div>
  <div class="operator-section"><h2>By Action Type</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Action</th><th>Sessions</th><th>Success</th><th>Avg Time</th><th>Avg Tools</th></tr>${skillRows}</table></div></div>
  <div class="operator-section"><h2>Recent Sessions</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Date</th><th>Project</th><th>Action</th><th>Ticket</th><th>Result</th><th>Time</th><th>Tools</th><th>Errors</th><th>Files</th></tr>${recentRows}</table></div></div>
</div>${kronosActionPanelScript(nonce, 'Kronos Session Stats', actionScriptUri)}</body></html>`, webviewScriptCspOptions(panel.webview.cspSource, nonce));
    }),

    vscode.commands.registerCommand('kronos.agentQualityScore', async () => {
      openAgentQualityScorePanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.trendMetrics', async () => {
      openTrendMetricsPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.agingReport', async () => {
      openAgingReportPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.runCenter', async (item: unknown) => {
      openInteractiveRunCenter(state, context.extensionUri, resolveRunId(item));
    }),

    vscode.commands.registerCommand('kronos.openRunArtifact', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns(), 'Select a Kronos run', 'No persisted Kronos runs yet.');
      if (!run) { return; }

      const action = await vscode.window.showQuickPick(
        ['Open Log', 'Open Prompt', 'Open Run Record', 'Open Workspace Terminal', 'Open Workspace Diff', 'Mark Needs Human', 'Pause Run', 'Continue Run', 'Cancel Run', 'Resume Run', 'Retry Saved Prompt', 'Archive Run'],
        { placeHolder: `Inspect ${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}` }
      );
      if (!action) { return; }

      if (action === 'Open Log') {
        await openRunArtifactFileIfExists(run.logPath, 'Run log not found.');
      } else if (action === 'Open Prompt') {
        await openRunArtifactFileIfExists(run.promptPath, 'Run prompt artifact not found.');
      } else if (action === 'Open Run Record') {
        await openRunArtifactFileIfExists(runRecordPath(run.id), 'Run record not found.');
      } else if (action === 'Open Workspace Terminal') {
        const cwd = run.worktreePath || run.cwd || run.projectPath;
        if (cwd && fs.existsSync(cwd)) {
          const terminal = vscode.window.createTerminal(kronosTerminalOptions({ name: `Kronos ${run.project}`, cwd }));
          terminal.show();
        } else {
          vscode.window.showWarningMessage('Run workspace no longer exists.');
        }
      } else if (action === 'Open Workspace Diff') {
        await openRunDiffArtifact(run);
      } else if (action === 'Mark Needs Human') {
        await markSelectedRunNeedsHuman(run);
      } else if (action === 'Pause Run') {
        await pauseSelectedRun(run);
      } else if (action === 'Continue Run') {
        await continueSelectedRun(run);
      } else if (action === 'Cancel Run') {
        await cancelSelectedRun(run);
      } else if (action === 'Resume Run') {
        await resumeSelectedRun(state, run);
      } else if (action === 'Retry Saved Prompt') {
        await retryRunFromPrompt(state, run);
      } else if (action === 'Archive Run') {
        await archiveSelectedRun(run.id);
      }
    }),

    vscode.commands.registerCommand('kronos.retryRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns().filter(isRetryableRun), 'Retry which saved Kronos prompt?', 'No runs with saved prompt artifacts found.');
      if (!run) { return; }
      await retryRunFromPrompt(state, run);
    }),

    vscode.commands.registerCommand('kronos.resumeRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns().filter(isResumableRun), 'Resume which Kronos run?', 'No resumable Kronos runs found.');
      if (!run) { return; }
      await resumeSelectedRun(state, run);
    }),

    vscode.commands.registerCommand('kronos.pauseRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns().filter(run => run.status === 'running' || run.status === 'preflight'), 'Pause which Kronos run?', 'No running Kronos runs to pause.');
      if (!run) { return; }
      await pauseSelectedRun(run);
    }),

    vscode.commands.registerCommand('kronos.continueRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns().filter(run => run.status === 'paused'), 'Continue which Kronos run?', 'No paused Kronos runs to continue.');
      if (!run) { return; }
      await continueSelectedRun(run);
    }),

    vscode.commands.registerCommand('kronos.archiveRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns(), 'Archive which Kronos run?', 'No persisted Kronos runs to archive.');
      if (!run) { return; }
      await archiveSelectedRun(run.id);
    }),

    vscode.commands.registerCommand('kronos.cancelRun', async (item: unknown) => {
      const run = resolveRunItem(item) || await pickRun(listRuns(), 'Cancel which Kronos run?', 'No persisted Kronos runs to cancel.');
      if (!run) { return; }
      await cancelSelectedRun(run);
    }),

    vscode.commands.registerCommand('kronos.doctor', async () => {
      openDoctorPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.integrationManifest', async () => {
      openIntegrationManifestPanel(context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.snapshotIntegrationManifest', async () => {
      await snapshotIntegrationManifest();
    }),

    vscode.commands.registerCommand('kronos.profiles', async () => {
      openProfilesPanel(context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.promptManager', async () => {
      openPromptManager(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.promptSmokeTests', async () => {
      openPromptSmokeTestsPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.snapshotPromptPack', async () => {
      snapshotPromptPack(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.promptHistory', async () => {
      openPromptHistoryPanel(context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.repairPromptPack', async () => {
      await repairPromptPack(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.humanReviewInbox', async () => {
      openHumanReviewInbox(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.recoveryCenter', async (item: unknown) => {
      await openRecoveryCenter(state, context.extensionUri, resolveRecoveryFocusId(item));
    }),

    vscode.commands.registerCommand('kronos.stateAuditLog', async () => {
      openStateAuditLogPanel(context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.cleanupWorktrees', async () => {
      const preview = cleanupStaleWorktrees({ remove: false });
      if (preview.results.length === 0) {
        vscode.window.showInformationMessage('No tracked Kronos worktrees found.');
        return;
      }
      if (preview.removable === 0) {
        vscode.window.showWarningMessage(`No worktrees are safe to remove. ${preview.blocked} need manual review.`);
        return;
      }
      const canClean = await confirmSafetyGate({
        operationId: 'kronos.cleanupWorktrees',
        title: 'Cleanup Stale Worktrees',
        target: `${preview.removable} clean / ${preview.blocked} blocked`,
        risks: ['destructive'],
        changes: [
          `Remove ${preview.removable} clean tracked Kronos worktree(s).`,
          'Untrack missing worktrees from Kronos metadata.',
          `Leave ${preview.blocked} blocked worktree(s) untouched for manual review.`,
        ],
        warnings: ['Only the dry-run removable set will be cleaned. Dirty worktrees are not removed.'],
        confirmationLabel: 'Remove Clean Worktrees',
      });
      if (!canClean) { return; }
      const cleaned = cleanupStaleWorktrees({ remove: true });
      vscode.window.showInformationMessage(`Removed ${cleaned.removed} worktree(s). ${cleaned.blocked} still need manual review.`);
    }),
  );

  const startupSideEffectsTimer = setTimeout(runStartupSideEffects, 0);
  context.subscriptions.push({ dispose: () => clearTimeout(startupSideEffectsTimer) });

  context.subscriptions.push({
    dispose: () => {
      projectTree.dispose();
      ticketTree.dispose();
      queueTree.dispose();
      reviewTree.dispose();
      sessionTree.dispose();
      taskTree.dispose();
      state.dispose();
    },
  });
}

async function runSetupWizard(): Promise<void> {
  // Step 1: Check gcloud auth
  const authOk = await ensureAuth();
  if (!authOk) {
    return;
  }
  vscode.window.showInformationMessage('GCP auth OK');

  // Step 2: Check Claude model access
  let modelOk = false;
  const config = vscode.workspace.getConfiguration('kronos');
  const model = config.get<string>('dispatchModel', 'claude-opus-4-6');
  modelOk = checkClaudeModelAccess(model).ok;

  if (!modelOk) {
    const pick = await vscode.window.showWarningMessage(
      `Model "${model}" is not accessible. Pick a different model?`,
      'Pick Model', 'Skip'
    );
    if (pick === 'Pick Model') {
      const models = ['claude-opus-4-6', 'claude-opus-4-6[1m]', 'claude-sonnet-4-6', 'claude-sonnet-4@20250514', 'claude-haiku-4-5'];
      const selected = await vscode.window.showQuickPick(models, { placeHolder: 'Select a model your Vertex project supports' });
      if (selected) {
        await config.update('dispatchModel', selected, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${selected}`);
      }
    }
  } else {
    vscode.window.showInformationMessage(`$(check) Model "${model}" OK`);
  }

  // Step 3: Discover projects
  const discover = await vscode.window.showInformationMessage(
    'Scan for projects to register?',
    'Discover', 'Skip'
  );
  if (discover === 'Discover') {
    await vscode.commands.executeCommand('kronos.discover');
  }

  vscode.window.showInformationMessage('Kronos setup complete. Use Refresh to pull tickets from Jira.');
}

async function runSettingsMenu(state: KronosState): Promise<void> {
  const config = vscode.workspace.getConfiguration('kronos');

  type SettingsMenuItemId = 'profile' | 'dispatchModel' | 'pollInterval' | 'sessionPoll' | 'scanDirectories' | 'authCheck';
  type SettingsMenuItem = vscode.QuickPickItem & { id: SettingsMenuItemId };

  const pick = await vscode.window.showQuickPick<SettingsMenuItem>([
    { id: 'profile', label: '$(settings) Profile', description: getActiveProfile().label, detail: 'Provider/default-branch behavior profile' },
    { id: 'dispatchModel', label: '$(cloud) Dispatch Model', description: config.get('dispatchModel', 'claude-opus-4-6'), detail: 'Claude model for dispatched sessions' },
    { id: 'pollInterval', label: '$(clock) Poll Interval', description: `${configIntervalSeconds(config.get<number>('pollIntervalSec', 300), 300, 1)}s`, detail: 'How often to auto-refresh project status' },
    { id: 'sessionPoll', label: '$(pulse) Session Poll', description: `${configIntervalMs(config.get<number>('sessionPollIntervalMs', 5000), 5000, 1000)}ms`, detail: 'How often to check for active Claude sessions' },
    { id: 'scanDirectories', label: '$(folder) Scan Directories', description: 'Edit scan dirs for project discovery', detail: 'Which directories to scan for repos' },
    { id: 'authCheck', label: '$(key) Run Auth Check', description: 'Verify GCP + Claude access', detail: 'Check gcloud auth and model permissions' },
  ], { placeHolder: 'Kronos Settings' });

  if (!pick) { return; }

  switch (pick.id) {
    case 'profile': {
      const current = getActiveProfile().id;
      const selected = await vscode.window.showQuickPick(
        listProfiles().map(profile => ({ label: profile.label, description: profile.id === current ? '(current)' : profile.id, detail: profile.description, profile })),
        { placeHolder: 'Select Kronos profile' }
      );
      if (selected) {
        await config.update('profile', selected.profile.id, vscode.ConfigurationTarget.Global);
        if (!config.get<string>('defaultBaseBranch')) {
          await config.update('defaultBaseBranch', selected.profile.defaultBaseBranch, vscode.ConfigurationTarget.Global);
        }
        vscode.window.showInformationMessage(`Kronos profile set to ${selected.profile.label}.`);
      }
      break;
    }
    case 'dispatchModel': {
      const models = ['claude-opus-4-6', 'claude-opus-4-6[1m]', 'claude-sonnet-4-6', 'claude-sonnet-4@20250514', 'claude-haiku-4-5'];
      const current = config.get<string>('dispatchModel', 'claude-opus-4-6');
      const selected = await vscode.window.showQuickPick(
        models.map(m => ({ label: m, description: m === current ? '(current)' : '' })),
        { placeHolder: 'Select model' }
      );
      if (selected) {
        await config.update('dispatchModel', selected.label, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Model set to ${selected.label}`);
      }
      break;
    }
    case 'pollInterval': {
      const val = await vscode.window.showInputBox({ prompt: 'Refresh interval in seconds', value: String(config.get('pollIntervalSec', 300)) });
      await updatePositiveNumberSetting(config, 'pollIntervalSec', val, 'Refresh interval must be a positive number of seconds.');
      break;
    }
    case 'sessionPoll': {
      const val = await vscode.window.showInputBox({ prompt: 'Session poll interval in ms', value: String(config.get('sessionPollIntervalMs', 5000)) });
      await updatePositiveNumberSetting(config, 'sessionPollIntervalMs', val, 'Session poll interval must be a positive number of milliseconds.');
      break;
    }
    case 'scanDirectories': {
      const currentState = state.state;
      const val = await vscode.window.showInputBox({
        prompt: 'Scan directories (comma-separated)',
        value: currentState?.settings?.scan_dirs?.join(', ') || '',
      });
      if (val) {
        const newDirs = val.split(',').map(d => d.trim()).filter(Boolean);
        try {
          const result = setScanDirs(newDirs);
          state.reloadAndNotify();
          vscode.window.showInformationMessage(`Scan dirs updated: ${result.scanDirs.join(', ')}`);
        } catch (e: unknown) {
          vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update scan dirs.'));
        }
      }
      break;
    }
    case 'authCheck':
      await vscode.commands.executeCommand('kronos.setup');
      break;
    default: {
      const exhaustive: never = pick.id;
      throw new Error(`Unhandled settings menu item: ${exhaustive}`);
    }
  }
}

async function updatePositiveNumberSetting(
  config: vscode.WorkspaceConfiguration,
  key: string,
  input: string | undefined,
  invalidMessage: string,
): Promise<void> {
  const parsed = parsePositiveNumberInput(input);
  if (parsed.kind === 'empty') { return; }
  if (parsed.kind === 'invalid') {
    vscode.window.showWarningMessage(invalidMessage);
    return;
  }
  await config.update(key, parsed.value, vscode.ConfigurationTarget.Global);
}

function openPromptManager(state: KronosState, extensionUri?: vscode.Uri): void {
  const globalTemplates = listPromptTemplates();
  const projects = state.state?.projects || {};
  const projectOverrides: Array<{ project: string; template: PromptTemplateInfo }> = [];
  for (const [projectName, project] of Object.entries(projects)) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      projectOverrides.push({ project: projectName, template });
    }
  }
  const smokeResults = runPromptSmokeTests(buildPromptSmokeTests(state, globalTemplates, projectOverrides));

  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptManager', 'Kronos Prompt Manager', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptManagerHtml(globalTemplates, projectOverrides, smokeResults, REQUIRED_PROMPTS, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt Manager', PROMPT_MANAGER_OPERATOR_COMMANDS);
}

function openPromptSmokeTestsPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const globalTemplates = listPromptTemplates();
  const projectOverrides: Array<{ project: string; template: PromptTemplateInfo }> = [];
  for (const [projectName, project] of Object.entries(state.state?.projects || {})) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      projectOverrides.push({ project: projectName, template });
    }
  }
  const results = runPromptSmokeTests(buildPromptSmokeTests(state, globalTemplates, projectOverrides));
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptSmokeTests', 'Kronos Prompt Smoke Tests', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptSmokeTestsHtml(results, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt Smoke Tests', PROMPT_SMOKE_OPERATOR_COMMANDS);
}

function snapshotPromptPack(state: KronosState, extensionUri?: vscode.Uri): void {
  const templates = promptHistoryTemplatesForState(state);
  const previous = latestPromptHistorySnapshot('workspace');
  const snapshot = createPromptHistorySnapshot(templates, { scope: 'workspace' });
  const diff = diffPromptHistorySnapshots(snapshot, previous);
  const changed = diff.summary.added + diff.summary.removed + diff.summary.changed;
  vscode.window.showInformationMessage(`Prompt snapshot saved: ${changed} changed, ${diff.summary.unchanged} unchanged.`);
  openPromptHistoryDiffPanel(diff, extensionUri);
}

function openPromptHistoryPanel(extensionUri?: vscode.Uri): void {
  const snapshots = listPromptHistorySnapshots(25);
  const latest = snapshots[0];
  const previous = latest ? snapshots.find(snapshot => snapshot.scope === latest.scope && snapshot.id !== latest.id) : undefined;
  const diff = latest ? diffPromptHistorySnapshots(latest, previous) : undefined;
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptHistory', 'Kronos Prompt History', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptHistoryHtml(snapshots, diff, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt History', PROMPT_HISTORY_OPERATOR_COMMANDS);
}

async function repairPromptPack(state: KronosState, extensionUri?: vscode.Uri): Promise<void> {
  const globalTemplates = listPromptTemplates();
  const globalByName = new Set(globalTemplates.filter(template => template.source === 'global').map(template => template.name));
  const missing = REQUIRED_PROMPTS.filter(name => !globalByName.has(name));
  if (missing.length === 0) {
    vscode.window.showInformationMessage('Required Kronos prompt pack is already present.');
    return;
  }
  const canRepair = await confirmSafetyGate({
    operationId: 'kronos.repairPromptPack',
    title: 'Repair Prompt Pack',
    target: path.join(KRONOS_DIR, 'prompts'),
    risks: ['state-write'],
    changes: [
      `Create ${missing.length} missing required prompt template file(s).`,
      'Leave existing prompt templates untouched.',
      'Generated templates are starter prompts that should be reviewed before production use.',
    ],
    warnings: ['This does not install external scripts or credentials.'],
    confirmationLabel: 'Create Missing Prompts',
  });
  if (!canRepair) { return; }
  const result = repairRequiredPromptTemplates(REQUIRED_PROMPTS);
  const action = await vscode.window.showInformationMessage(
    `Created ${result.created.length} prompt template(s). ${result.existing.length} already existed.`,
    'Open Prompt Manager'
  );
  if (action === 'Open Prompt Manager') {
    openPromptManager(state, extensionUri);
  }
}

function openPromptHistoryDiffPanel(diff: PromptHistoryDiff, extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptHistory', 'Kronos Prompt History', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptHistoryHtml(listPromptHistorySnapshots(25), diff, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt History', PROMPT_HISTORY_OPERATOR_COMMANDS);
}

function promptHistoryTemplatesForState(state: KronosState): PromptTemplateInfo[] {
  const byKey = new Map<string, PromptTemplateInfo>();
  for (const template of listPromptTemplates()) {
    byKey.set(`${template.source}:${template.name}:${template.path}`, template);
  }
  for (const project of Object.values(state.state?.projects || {})) {
    for (const template of listPromptTemplates(project.path).filter(t => t.source === 'project')) {
      byKey.set(`${template.source}:${template.name}:${template.path}`, template);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => `${a.source}:${a.name}:${a.path}`.localeCompare(`${b.source}:${b.name}:${b.path}`));
}

function buildPromptSmokeTests(
  state: KronosState,
  globalTemplates: PromptTemplateInfo[],
  projectOverrides: Array<{ project: string; template: PromptTemplateInfo }>,
): PromptSmokeTest[] {
  const tests = buildDefaultPromptSmokeTests(globalTemplates, { idPrefix: 'global' });
  for (const { project, template } of projectOverrides) {
    const projectPath = state.state?.projects?.[project]?.path;
    if (projectPath) {
      tests.push(...buildDefaultPromptSmokeTests([template], { idPrefix: `project:${project}`, projectPath }));
    }
  }

  const manifest = readIntegrationManifest().manifest;
  for (const [templateName, entry] of Object.entries(manifest?.prompts || {})) {
    for (const [idx, smoke] of (entry.smoke_tests || []).entries()) {
      const test: PromptSmokeTest = {
        id: `manifest:${templateName}:${smoke.name || idx + 1}`,
        templateName,
        source: 'manifest',
      };
      if (smoke.variables) { test.variables = smoke.variables; }
      if (smoke.mustContain) { test.mustContain = smoke.mustContain; }
      if (smoke.mustNotContain) { test.mustNotContain = smoke.mustNotContain; }
      if (smoke.allowMissingVariables !== undefined) { test.allowMissingVariables = smoke.allowMissingVariables; }
      tests.push(test);
    }
  }
  return tests;
}

async function openRecoveryCenter(state: KronosState, extensionUri?: vscode.Uri, focusItemId?: string): Promise<void> {
  const backups = listBackups();
  const inventory = buildRecoveryInventoryForState(state, backups);
  openRecoveryPanel(state, inventory, backups, focusItemId, extensionUri);

  if (!inventory.items.some(item => item.action)) {
    vscode.window.showInformationMessage('Recovery Center found no active recovery items.');
  }
}

function buildRecoveryInventoryForState(state: KronosState, backups = listBackups()): RecoveryInventory {
  const input: RecoveryInventoryInput = {
    runs: listRuns(),
    runStoreIssues: listRunStoreIssues(),
    backups,
    worktreeReport: cleanupStaleWorktrees({ remove: false }),
    doctorChecks: runDoctorChecks(state),
  };
  if (state.state?.tickets) { input.tickets = state.state.tickets; }
  return buildRecoveryInventory(input);
}

function openRecoveryPanel(state: KronosState, initialInventory: RecoveryInventory, initialBackups = listBackups(), focusItemId?: string, extensionUri?: vscode.Uri): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosRecoveryCenter',
    'Kronos Recovery Center',
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Recovery Center');
  let currentInventory = initialInventory;
  let currentBackups = initialBackups;
  const render = (refresh = false) => {
    if (refresh) {
      state.reloadAndNotify();
      currentBackups = listBackups();
      currentInventory = buildRecoveryInventoryForState(state, currentBackups);
    }
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildRecoveryHtml(currentInventory, nonce, focusItemId, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  startActiveRunPanelRefresh(panel, state, () => render(true));
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, RECOVERY_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos recovery action.');
      return;
    }
    if (request.command === 'refreshPanel') {
      await runWebviewPanelAction(() => render(true), 'Kronos recovery action failed.');
      return;
    }
    const item = currentInventory.items.find(candidate => candidate.id === request.itemId);
    if (!item) {
      vscode.window.showWarningMessage('Recovery item is no longer available.');
      return;
    }
    await runWebviewPanelAction(async () => {
      await executeRecoveryAction(item, state, currentBackups, request.recoveryAction, extensionUri);
      render(true);
    }, 'Kronos recovery action failed.');
  });
}

function openStateAuditLogPanel(extensionUri?: vscode.Uri): void {
  const events = listStateAuditEvents(200);
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosStateAuditLog', 'Kronos State Audit Log', extensionUri);
  panel.webview.html = withWebviewCsp(buildStateAuditLogHtml(events, STATE_AUDIT_FILE, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos State Audit Log', STATE_AUDIT_OPERATOR_COMMANDS);
}

async function executeRecoveryAction(item: RecoveryItem, state: KronosState, backups = listBackups(), requestedAction?: string, extensionUri?: vscode.Uri): Promise<void> {
  const action = recoveryActionForRequest(item, requestedAction);
  if (!action) {
    vscode.window.showWarningMessage('Recovery item action is no longer available.');
    return;
  }
  if (action === 'openRunCenter') {
    openInteractiveRunCenter(state, extensionUri, item.runId);
    return;
  }
  if (action === 'retryRun') {
    const run = listRuns().find(r => r.id === item.runId);
    if (!run) {
      vscode.window.showWarningMessage('Run record not found.');
      return;
    }
    await retryRunFromPrompt(state, run);
    return;
  }
  if (action === 'resumeRun') {
    const run = listRuns().find(r => r.id === item.runId);
    if (!run) {
      vscode.window.showWarningMessage('Run record not found.');
      return;
    }
    await resumeSelectedRun(state, run);
    return;
  }
  if (action === 'archiveRun') {
    if (!item.runId) { return; }
    await archiveSelectedRun(item.runId);
    return;
  }
  if (action === 'openRunLog') {
    const run = listRuns().find(r => r.id === item.runId);
    await openRunArtifactFileIfExists(run?.logPath, 'Run log not found.');
    return;
  }
  if (action === 'openRunPrompt') {
    const run = listRuns().find(r => r.id === item.runId);
    await openRunArtifactFileIfExists(run?.promptPath, 'Run prompt artifact not found.');
    return;
  }
  if (action === 'linkMrToTicket') {
    if (!item.ticketKey) {
      vscode.window.showWarningMessage('Recovery item does not include a ticket key.');
      return;
    }
    await vscode.commands.executeCommand('kronos.linkMrToTicket', { ticketKey: item.ticketKey });
    return;
  }
  if (action === 'cleanupWorktrees') {
    await vscode.commands.executeCommand('kronos.cleanupWorktrees');
    return;
  }
  if (action === 'openDoctor') {
    await vscode.commands.executeCommand('kronos.doctor');
    return;
  }
  if (action === 'restoreBackup') {
    await pickAndRestoreBackup(state, backups, item.backupPath);
  }
}

function recoveryActionForRequest(item: RecoveryItem, requestedAction?: string): RecoveryItem['action'] {
  const available = [item.action, ...(item.secondaryActions || []).map(action => action.action)];
  if (requestedAction) {
    return available.includes(requestedAction as RecoveryItem['action'])
      ? requestedAction as RecoveryItem['action']
      : undefined;
  }
  return item.action;
}

async function pickAndRestoreBackup(state: KronosState, backups = listBackups(), preferredBackupPath?: string): Promise<void> {
  if (backups.length === 0) {
    vscode.window.showInformationMessage('No Kronos state backups found.');
    return;
  }

  const choices = backups.map(backup => ({
    label: `${backup.targetName} - ${formatWebviewDateTime(backup.createdAt)}`,
    description: `${Math.max(1, Math.round(backup.size / 1024))} KB`,
    detail: backup.filePath,
    backup,
  }));
  const preferred = preferredBackupPath ? choices.find(choice => choice.backup.filePath === preferredBackupPath) : undefined;
  const picked = preferred || await vscode.window.showQuickPick(choices, { placeHolder: 'Select a Kronos backup' });
  if (!picked) { return; }

  const action = await vscode.window.showQuickPick(
    ['Open Backup', 'Restore Backup'],
    { placeHolder: `${picked.backup.targetName}: ${picked.backup.filePath}` }
  );
  if (!action) { return; }

  if (action === 'Open Backup') {
    await openTextFileIfExists(picked.backup.filePath, 'Backup file not found.');
    return;
  }

  const canRestore = await confirmSafetyGate({
    operationId: 'restoreBackup',
    title: 'Restore Kronos Backup',
    target: picked.backup.targetName,
    risks: ['state-write'],
    changes: [
      `Restore ${picked.backup.targetName} from ${formatWebviewDateTime(picked.backup.createdAt)}.`,
      'Back up the current file before replacing it.',
    ],
    confirmationLabel: 'Restore',
  });
  if (!canRestore) { return; }

  try {
    restoreBackup(picked.backup.filePath);
    state.reloadAndNotify();
    vscode.window.showInformationMessage(`Restored ${picked.backup.targetName} from backup.`);
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to restore backup.'));
  }
}

function openHumanReviewInbox(state: KronosState, extensionUri?: vscode.Uri): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosHumanReviewInbox',
    'Kronos Human Review Inbox',
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Human Review Inbox');
  const render = () => {
    const inbox = buildHumanReviewInbox({
      state: state.state,
      queue: state.queue,
      runs: listRuns(),
      worktreeReport: cleanupStaleWorktrees({ remove: false }),
      doctorChecks: runDoctorChecks(state),
    });
    const htmlOptions = { nonce, actionScriptUri };
    if (state.state?.tickets) { Object.assign(htmlOptions, { tickets: state.state.tickets }); }
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildHumanReviewInboxHtml(inbox, htmlOptions), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, HUMAN_REVIEW_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos human review request.');
      return;
    }
    await runWebviewPanelAction(async () => {
      if (request.command === 'refreshPanel') {
        state.reloadAndNotify();
        render();
        return;
      }
      await executeHumanReviewAction(state, request.command, request.ticket, request.runId, request.itemId);
      render();
    }, 'Kronos human review action failed.');
  });
  render();
  startActiveRunPanelRefresh(panel, state, render);
}

async function executeHumanReviewAction(state: KronosState, command: string, ticketKey: string, runId = '', itemId = ''): Promise<void> {
  if (ticketKey && !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }

  if (command === 'startTicket' && ticketKey) {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (ticketKey && await tryExecuteTicketOperatorCommand(command, ticketKey)) {
    return;
  } else if (command === 'runCenter' || command === 'recoveryCenter' || command === 'doctor' || command === 'queuePlanner') {
    await executeOperatorCommandAction(command, '', runId, itemId);
  } else {
    vscode.window.showWarningMessage('Ignored Kronos human review action without a valid target.');
  }
}

async function startTicketFromActionPanel(state: KronosState, ticketKey: string): Promise<void> {
  const ticket = state.state?.tickets?.[ticketKey];
  if (!ticket) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  if (!ticket.projects?.length) {
    vscode.window.showWarningMessage(`${ticketKey} is not linked to a project.`);
    return;
  }
  if (ticket.next_action === 'done') {
    vscode.window.showInformationMessage(`${ticketKey} is already done.`);
    return;
  }

  const plan = planNextActions(state).find(candidate => candidate.ticketKey === ticketKey) || {
    planId: `human-review:${ticketKey}`,
    ticketKey,
    action: ticket.next_action === 'blocked' ? 'implement' : (ticket.next_action || 'implement'),
    projects: ticket.projects,
    score: 0,
    scoreBreakdown: [],
    reason: 'Started from Human Review Inbox.',
    source: 'ticket' as const,
    ticketSummary: ticket.summary,
  };
  await vscode.commands.executeCommand('kronos.startQueueItem', { item: planToQueueItem(state, plan) });
}

function openEvidenceGatePanel(
  state: KronosState,
  gates: EvidenceGateResult[],
  title: string,
  options: { refreshAllEvidenceGates?: boolean; extensionUri?: vscode.Uri } = {},
): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosEvidenceGate',
    title,
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(options.extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, options.extensionUri);
  const gateTicketKeys = gates.map(gate => gate.ticketKey);
  const logReady = createWebviewReadyMonitor(panel, title);
  const render = () => {
    const freshGates = options.refreshAllEvidenceGates
      ? evidenceGatePanelGatesForState(state)
      : gateTicketKeys
        .map(ticketKey => {
          const ticket = state.state?.tickets?.[ticketKey];
          return ticket ? evaluateEvidenceGate(ticketKey, ticket) : undefined;
        })
        .filter((gate): gate is EvidenceGateResult => Boolean(gate));
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildEvidenceGateHtml(freshGates, title, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, EVIDENCE_GATE_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos evidence gate request.');
      return;
    }
    await runWebviewPanelAction(async () => {
      if (request.command === 'refreshPanel') {
        state.reloadAndNotify();
        render();
        return;
      }
      if (!request.ticket || !state.state?.tickets?.[request.ticket]) {
        vscode.window.showWarningMessage('Ignored invalid Kronos evidence gate request.');
        return;
      }
      await executeEvidenceGateAction(request.command, request.ticket);
      render();
    }, 'Kronos evidence gate action failed.');
  });
  render();
  startActiveRunPanelRefresh(panel, state, render);
}

function evidenceGatePanelGatesForState(state: KronosState): EvidenceGateResult[] {
  const currentState = state.state;
  if (!currentState) { return []; }
  return evaluateEvidenceGates(currentState.tickets)
    .filter(gate => gate.status !== 'pass' || isProofSensitiveAction(currentState.tickets[gate.ticketKey]?.next_action));
}

function openEvidenceHandoffPanel(plan: EvidenceHandoffPlan, extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosEvidenceHandoff', `Evidence Handoff: ${plan.ticketKey}`, extensionUri);
  panel.webview.html = withWebviewCsp(buildEvidenceHandoffHtml(plan, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Evidence Handoff', EVIDENCE_HANDOFF_OPERATOR_COMMANDS);
}

function openEvidencePublishPanel(results: Array<EvidencePublishResult | EvidencePublishDestination>, ticketKey: string, extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosEvidencePublish', `Evidence Publish: ${ticketKey}`, extensionUri);
  panel.webview.html = withWebviewCsp(buildEvidencePublishHtml(results, ticketKey, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Evidence Publish', EVIDENCE_PUBLISH_OPERATOR_COMMANDS);
}

async function executeEvidenceGateAction(command: string, ticketKey: string): Promise<void> {
  if (!await tryExecuteTicketOperatorCommand(command, ticketKey)) {
    vscode.window.showWarningMessage('Ignored Kronos evidence gate action without a valid target.');
  }
}

async function executeOperatorCommandAction(command: string, ticketKey = '', runId = '', itemId = ''): Promise<void> {
  const commandId = OPERATOR_COMMAND_TO_VSCODE_COMMAND.get(command);
  if (!commandId) {
    vscode.window.showWarningMessage('Ignored unknown Kronos operator action.');
    return;
  }
  if (TICKET_SCOPED_OPERATOR_COMMANDS.has(command)) {
    if (!ticketKey) {
      vscode.window.showWarningMessage('This Kronos action needs a ticket context.');
      return;
    }
    await vscode.commands.executeCommand(commandId, { ticketKey });
    return;
  }
  if (command === 'evidenceGate' && ticketKey) {
    await vscode.commands.executeCommand(commandId, { ticketKey });
    return;
  }
  if ((command === 'runCenter' || command === 'recoveryCenter') && (runId || itemId)) {
    await vscode.commands.executeCommand(commandId, { runId, itemId });
    return;
  }
  await vscode.commands.executeCommand(commandId);
}

async function tryExecuteTicketOperatorCommand(command: string, ticketKey: string): Promise<boolean> {
  if (!TICKET_SCOPED_OPERATOR_COMMANDS.has(command) && command !== 'evidenceGate') {
    return false;
  }
  await executeOperatorCommandAction(command, ticketKey);
  return true;
}

function attachOperatorCommandHandler(panel: vscode.WebviewPanel, webviewName: string, allowedCommands: ReadonlySet<string>): ReturnType<typeof createWebviewReadyMonitor> {
  const logReady = createWebviewReadyMonitor(panel, webviewName);
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, allowedCommands);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos operator action.');
      return;
    }
    await runWebviewPanelAction(
      () => executeOperatorCommandAction(request.command, request.ticket, request.runId),
      'Kronos operator action failed.',
    );
  });
  return logReady;
}

interface PlanActionPanelRenderResult {
  plans: PlannedAction[];
  html: string;
}

interface PlanActionPanelOptions {
  viewType: string;
  title: string;
  readyName?: string;
  invalidActionWarning: string;
  failureWarning: string;
  render: (nonce: string, actionScriptUri: string) => PlanActionPanelRenderResult;
}

function openPlanActionPanel(state: KronosState, extensionUri: vscode.Uri | undefined, options: PlanActionPanelOptions): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel(options.viewType, options.title, extensionUri);
  let currentPlans: PlannedAction[] = [];
  const logReady = createWebviewReadyMonitor(panel, options.readyName || options.title);
  const render = () => {
    const result = options.render(nonce, actionScriptUri);
    currentPlans = result.plans;
    logReady.arm();
    panel.webview.html = withWebviewCsp(result.html, webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage(options.invalidActionWarning);
      return;
    }
    await runWebviewPanelAction(async () => {
      await executePlanPanelAction(state, currentPlans, request);
      if (shouldRerenderPlanPanelAfterAction(request.command)) {
        render();
      }
    }, options.failureWarning);
  });
  render();
}

function shouldRerenderPlanPanelAfterAction(command: string): boolean {
  return command !== 'startPlan' && command !== 'viewTicket' && command !== 'addEvidence';
}

function openQueuePlannerPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  openPlanActionPanel(state, extensionUri, {
    viewType: 'kronosQueuePlanner',
    title: 'Kronos Queue Planner',
    invalidActionWarning: 'Ignored invalid Kronos queue planner action.',
    failureWarning: 'Kronos queue planner action failed.',
    render: (nonce, actionScriptUri) => {
      const plans = planNextActions(state).slice(0, 50);
      return {
        plans,
        html: buildQueuePlannerHtml(plans, nonce, actionScriptUri),
      };
    },
  });
}

function findPlanById(plans: PlannedAction[], planId: string): PlannedAction | undefined {
  return plans.find(plan => plan.planId === planId);
}

async function executePlanPanelAction(
  state: KronosState,
  plans: PlannedAction[],
  request: { command: string; ticket: string; planId: string },
): Promise<void> {
  const plan = findPlanById(plans, request.planId);
  if (!plan) {
    vscode.window.showWarningMessage('That Kronos recommendation is no longer available.');
    return;
  }

  if (request.command === 'startPlan') {
    await startPlannedAction(state, plan);
  } else if (request.command === 'queuePlan' && plan.ticketKey) {
    addPlanToQueue(state, plan, false);
  } else if (request.command === 'pinPlan' && plan.ticketKey) {
    addPlanToQueue(state, plan, true);
  } else if (request.command === 'snoozePlan' && plan.ticketKey) {
    recordPlanDecision(state, plan, 'snoozed', 60);
    vscode.window.showInformationMessage(`Snoozed ${plan.ticketKey} for 1 hour.`);
  } else if (request.command === 'snoozePlanToday' && plan.ticketKey) {
    recordPlanDecision(state, plan, 'snoozed', minutesUntilTomorrow());
    vscode.window.showInformationMessage(`Snoozed ${plan.ticketKey} until tomorrow.`);
  } else if (request.command === 'rejectPlan' && plan.ticketKey) {
    const reason = await vscode.window.showInputBox({
      prompt: `Why reject ${plan.ticketKey}?`,
      placeHolder: 'e.g., not in scope this sprint, blocked by product',
    });
    if (reason === undefined) { return; }
    recordPlanDecision(state, plan, 'rejected', undefined, reason || undefined);
    vscode.window.showInformationMessage(`Rejected ${plan.ticketKey} recommendation.`);
  } else if (request.command === 'viewTicket' && plan.ticketKey) {
    await tryExecuteTicketOperatorCommand(request.command, plan.ticketKey);
  } else if (request.command === 'addEvidence' && plan.ticketKey) {
    await tryExecuteTicketOperatorCommand(request.command, plan.ticketKey);
  }
}

function openBacklogTriagePanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosBacklogTriage',
    'Kronos Backlog Triage',
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Backlog Triage');
  const render = () => {
    const report = buildBacklogTriageReport({ state: state.state, queue: state.queue });
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildBacklogTriageHtml(report, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, BACKLOG_TRIAGE_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos backlog triage action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      await executeBacklogTriageAction(state, request.command, request.ticket);
      render();
    }, 'Kronos backlog triage action failed.');
  });
}

async function executeBacklogTriageAction(state: KronosState, command: string, ticketKey: string): Promise<void> {
  if (!ticketKey || !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey || 'Ticket'} is no longer in Kronos state.`);
    return;
  }
  if (command === 'startTicket') {
    await startTicketFromActionPanel(state, ticketKey);
  } else if (await tryExecuteTicketOperatorCommand(command, ticketKey)) {
    return;
  }
}

function openProjectBatchPlanPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  openPlanActionPanel(state, extensionUri, {
    viewType: 'kronosProjectBatchPlan',
    title: 'Kronos Project Batch Plan',
    invalidActionWarning: 'Ignored invalid Kronos project batch action.',
    failureWarning: 'Kronos project batch action failed.',
    render: (nonce, actionScriptUri) => {
      const plans = planNextActions(state);
      const batches = planByProject(plans, 5).slice(0, 20);
      return {
        plans,
        html: buildProjectBatchPlanHtml(batches, nonce, actionScriptUri),
      };
    },
  });
}

function openReleaseBatchPlanPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  openPlanActionPanel(state, extensionUri, {
    viewType: 'kronosReleaseBatchPlan',
    title: 'Kronos Release Batch Plan',
    invalidActionWarning: 'Ignored invalid Kronos release batch action.',
    failureWarning: 'Kronos release batch action failed.',
    render: (nonce, actionScriptUri) => {
      const plans = planNextActions(state);
      const batches = planByRelease(plans, 8).slice(0, 20);
      return {
        plans,
        html: buildReleaseBatchPlanHtml(batches, nonce, actionScriptUri),
      };
    },
  });
}

async function openCollisionReportPanel(state: KronosState, extensionUri?: vscode.Uri): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'kronosCollisionReport',
    'Kronos Collision Report',
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  let plans: PlannedAction[] = [];
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Collision Report');
  const render = async () => {
    plans = planNextActions(state).slice(0, 25);
    const mrFiles = await loadMrFileHints(state, plans);
    const reports = plans.map(plan => {
      const collisionInput: DispatchCollisionInput = {
        ticketKey: plan.ticketKey,
        projects: plan.projects,
        action: plan.action,
        queue: state.queue,
        runs: listRuns(),
        mrFiles,
      };
      if (state.state?.tickets) { collisionInput.tickets = state.state.tickets; }
      if (plan.queueItem?.id) { collisionInput.excludeQueueItemId = plan.queueItem.id; }
      const collisions = detectDispatchCollisions(collisionInput);
      return { plan, collisions };
    }).filter(report => report.collisions.length > 0);
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildCollisionReportHtml(reports, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  await render();
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, PLAN_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos collision report action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      await executePlanPanelAction(state, plans, request);
      await render();
    }, 'Kronos collision report action failed.');
  });
}

async function loadMrFileHints(state: KronosState, targets: Array<{ ticketKey?: string | null; projects: string[]; action: string }>): Promise<Record<string, MergeRequestChangedFile[]>> {
  const tickets = state.state?.tickets || {};
  const projectTargets = new Set<string>();
  const candidateKeys = new Set<string>();

  for (const target of targets) {
    if (!isCodeAction(target.action)) { continue; }
    for (const project of target.projects || []) {
      if (project) { projectTargets.add(project); }
    }
    if (target.ticketKey && tickets[target.ticketKey]?.mr?.state === 'opened') {
      candidateKeys.add(target.ticketKey);
    }
  }

  if (projectTargets.size === 0 && candidateKeys.size === 0) {
    return {};
  }

  for (const [ticketKey, ticket] of Object.entries(tickets)) {
    if (candidateKeys.size >= LIVE_MR_DIFF_LIMIT) { break; }
    if (ticket.mr?.state !== 'opened') { continue; }
    if (ticket.projects?.some(project => projectTargets.has(project))) {
      candidateKeys.add(ticketKey);
    }
  }

  const hints: Record<string, MergeRequestChangedFile[]> = {};
  for (const ticketKey of Array.from(candidateKeys).slice(0, LIVE_MR_DIFF_LIMIT)) {
    try {
      const diff = await gitlabAdapter.mergeRequestDiff(state, ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
      const files = diff.files;
      if (files.length > 0) {
        hints[ticketKey] = files;
      }
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, `Failed to load MR diff hints for ${ticketKey}.`));
    }
  }
  return hints;
}

function openQueuePlanWindowPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  openPlanActionPanel(state, extensionUri, {
    viewType: 'kronosPlanNextTwoHours',
    title: 'Kronos Plan Next 2 Hours',
    readyName: 'Kronos Planning Window',
    invalidActionWarning: 'Ignored invalid Kronos planning action.',
    failureWarning: 'Kronos planning action failed.',
    render: (nonce, actionScriptUri) => {
      const planWindow = planForMinutes(planNextActions(state), 120);
      return {
        plans: planWindow.plans,
        html: buildQueuePlanModeHtml(
          'Kronos Plan Next 2 Hours',
          `${planWindow.plans.length} action(s), estimated ${planWindow.estimatedMinutes} minutes`,
          planWindow.plans,
          nonce,
          actionScriptUri,
        ),
      };
    },
  });
}

function openOvernightCandidatesPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  openPlanActionPanel(state, extensionUri, {
    viewType: 'kronosOvernightCandidates',
    title: 'Kronos Overnight Candidates',
    invalidActionWarning: 'Ignored invalid Kronos overnight candidate action.',
    failureWarning: 'Kronos overnight candidate action failed.',
    render: (nonce, actionScriptUri) => {
      const plans = overnightCandidatePlans(planNextActions(state), 20);
      return {
        plans,
        html: buildQueuePlanModeHtml(
          'Kronos Overnight Candidates',
          `${plans.length} linked implementation/build candidate(s)`,
          plans,
          nonce,
          actionScriptUri,
        ),
      };
    },
  });
}

function openAgentQualityScorePanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const score = computeAgentQualityScore({ runs: listRuns(), tickets: state.state?.tickets || {} });
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosAgentQualityScore', 'Kronos Agent Quality Score', extensionUri);
  panel.webview.html = withWebviewCsp(buildAgentQualityScoreHtml(score, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Agent Quality Score', AGENT_QUALITY_OPERATOR_COMMANDS);
}

function openTrendMetricsPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const report = computeTrendMetrics({
    runs: listRuns(),
    tickets: state.state?.tickets || {},
    windowDays: trendWindowDaysFromConfig(),
  });
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosTrendMetrics', 'Kronos Trend Metrics', extensionUri);
  panel.webview.html = withWebviewCsp(buildTrendMetricsHtml(report, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Trend Metrics', TREND_METRICS_OPERATOR_COMMANDS);
}

function openAgingReportPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const panel = vscode.window.createWebviewPanel(
    'kronosAgingReport',
    'Kronos Aging Report',
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  const nonce = createWebviewNonce();
  const actionScriptUri = kronosActionPanelScriptUri(panel, extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Aging Report');
  const render = () => {
    const report = analyzeAging({
      tickets: state.state?.tickets || {},
      thresholds: agingThresholdsFromConfig(),
    });
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildAgingReportHtml(report, {
      actionsHtml: operatorCommandRow([
        actionButton('refreshPanel', 'Refresh'),
        actionButton('queuePlanner', 'Queue Planner'),
        actionButton('humanReviewInbox', 'Human Review'),
        actionButton('trendMetrics', 'Trend Metrics'),
        actionButton('evidenceGate', 'Evidence Gate'),
      ]),
      scriptHtml: kronosActionPanelScript(nonce, 'Kronos Aging Report', actionScriptUri),
    }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render();
  startActiveRunPanelRefresh(panel, state, render);
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, AGING_REPORT_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos aging report action.');
      return;
    }
    if (request.command === 'refreshPanel') {
      await runWebviewPanelAction(() => {
        state.reloadAndNotify();
        render();
      }, 'Kronos aging report action failed.');
      return;
    }
    await runWebviewPanelAction(
      () => executeOperatorCommandAction(request.command, request.ticket),
      'Kronos aging report action failed.',
    );
  });
}

function openIntegrationManifestPanel(extensionUri?: vscode.Uri): void {
  const status = readIntegrationManifest();
  const audit = auditIntegrationManifest(status);
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosIntegrationManifest', 'Kronos Integration Manifest', extensionUri);
  panel.webview.html = withWebviewCsp(buildIntegrationManifestHtml(status, audit, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Integration Manifest', INTEGRATION_MANIFEST_OPERATOR_COMMANDS);
}

async function snapshotIntegrationManifest(): Promise<void> {
  const canSnapshot = await confirmSafetyGate({
    operationId: 'kronos.snapshotIntegrationManifest',
    title: 'Snapshot Integration Manifest',
    target: INTEGRATION_MANIFEST_FILE,
    risks: ['state-write'],
    changes: [
      'Write a manifest snapshot with SHA-256 hashes for the current script bundle.',
      'Write SHA-256 hashes for global prompt templates in the Kronos prompt directory.',
      'Use the snapshot as the future drift baseline for Doctor and Integration Manifest.',
    ],
    warnings: ['Existing manifest contents will be replaced by the current local snapshot.'],
    confirmationLabel: 'Snapshot Manifest',
  });
  if (!canSnapshot) { return; }

  try {
    const result = writeIntegrationManifestSnapshot();
    const action = await vscode.window.showInformationMessage(
      `Snapshot integration manifest written. ${result.audit.summary}`,
      'Open Manifest',
      'Run Doctor'
    );
    if (action === 'Open Manifest') {
      await openTextFileIfExists(result.path, 'Integration manifest not found.');
    } else if (action === 'Run Doctor') {
      await vscode.commands.executeCommand('kronos.doctor');
    }
  } catch (e: unknown) {
    vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to snapshot integration manifest.'));
  }
}

function openProfilesPanel(extensionUri?: vscode.Uri): void {
  const active = getActiveProfile();
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosProfiles', 'Kronos Profiles', extensionUri);
  panel.webview.html = withWebviewCsp(buildProfilesHtml(active, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Profiles', PROFILES_OPERATOR_COMMANDS);
}

function openDoctorPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const checks = runDoctorChecks(state);
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosDoctor', 'Kronos Doctor', extensionUri);
  const logReady = attachOperatorCommandHandler(panel, 'Kronos Doctor', DOCTOR_OPERATOR_COMMANDS);
  const pendingCheck: DoctorCheck = {
    name: 'Provider network reachability',
    status: 'warn',
    detail: 'Checking configured provider endpoints...',
  };
  const render = (currentChecks: DoctorCheck[]) => {
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildDoctorHtml(currentChecks, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  render([...checks, pendingCheck]);
  runDoctorReachabilityChecks(state)
    .then(reachabilityChecks => render([...checks, ...reachabilityChecks]))
    .catch((e: unknown) => render([...checks, {
      name: 'Provider network reachability',
      status: 'fail',
      detail: unknownErrorMessage(e, 'Provider reachability checks failed.'),
    }]));
}

function doctorChecksInput(state: KronosState) {
  const model = vscode.workspace.getConfiguration('kronos').get<string>('dispatchModel', 'claude-opus-4-6');
  return {
    state: state.state,
    queue: state.queue,
    stateLoadErrors: state.loadIssues,
    sessionStoreIssues: listSessionStoreIssues(),
    profile: getActiveProfile(),
    requiredPrompts: REQUIRED_PROMPTS,
    dispatchModel: model,
  };
}

function runDoctorChecks(state: KronosState): DoctorCheck[] {
  return collectDoctorChecks(doctorChecksInput(state));
}

async function runDoctorReachabilityChecks(state: KronosState): Promise<DoctorCheck[]> {
  return collectDoctorReachabilityChecks(doctorChecksInput(state), { timeoutMs: 5000 });
}

async function startPlannedAction(
  state: KronosState,
  plan: PlannedAction,
  context = buildNextActionContext(plan, { state: state.state, queue: state.queue }),
): Promise<void> {
  const startDecision = buildNextActionStartDecision(plan, context);
  if (!startDecision.allowed) {
    vscode.window.showWarningMessage(startDecision.reason || 'Planned action is blocked.');
    return;
  }
  if (startDecision.safetyPlan) {
    const confirmed = await confirmSafetyGate(startDecision.safetyPlan);
    if (!confirmed) { return; }
  }
  if (startDecision.commandId === 'kronos.refresh') {
    vscode.window.showInformationMessage(`Starting: ${startDecision.safetyPlan?.target || 'refresh'}`);
    if (startDecision.refreshProjects.length > 0) {
      for (const project of startDecision.refreshProjects) { await state.refresh(project); }
    } else {
      await state.refresh();
    }
    return;
  }
  await vscode.commands.executeCommand('kronos.startQueueItem', { item: planToQueueItem(state, plan) });
}

function addPlanToQueue(state: KronosState, plan: PlannedAction, pinTop: boolean): void {
  const result = addPlanToQueueState(plan, { pinTop });
  state.reloadAndNotify();
  const label = plan.ticketKey || plan.action;
  if (result.alreadyQueued && result.pinned) {
    vscode.window.showInformationMessage(`Pinned ${label} to the top of the queue.`);
  } else if (result.alreadyQueued) {
    vscode.window.showInformationMessage(`${label} is already in the queue.`);
  } else {
    vscode.window.showInformationMessage(`${pinTop ? 'Pinned' : 'Added'} ${label} ${pinTop ? 'to the top of' : 'to'} the queue.`);
  }
}

function recordPlanDecision(
  state: KronosState,
  plan: PlannedAction,
  decision: 'rejected' | 'snoozed',
  snoozeMinutes?: number,
  reason?: string
): void {
  const options: { snoozeMinutes?: number; reason?: string } = {};
  if (snoozeMinutes !== undefined) { options.snoozeMinutes = snoozeMinutes; }
  if (reason !== undefined) { options.reason = reason; }
  recordPlanQueueDecision(plan, decision, options);
  state.reloadAndNotify();
}

function minutesUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / (60 * 1000)));
}

function ticketStringField(record: object | null | undefined, key: string, fallback = ''): string {
  const value = record ? Reflect.get(record, key) : undefined;
  return value === undefined || value === null ? fallback : String(value);
}

function ticketStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function mergeRequestComments(record: object | null | undefined): Array<Record<string, unknown>> {
  if (!record) { return []; }
  const value = Reflect.get(record, 'comments');
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => isRecord(item) && typeof item['body'] === 'string')
    : [];
}

function existingAcceptanceCriterion(record: object): ExistingAcceptanceCriterion | undefined {
  const text = evidenceString(record, 'text');
  if (!text) { return undefined; }
  const source = evidenceString(record, 'source');
  const criterion: ExistingAcceptanceCriterion = {
    text,
    checked: evidenceChecked(record),
  };
  const id = evidenceString(record, 'id');
  if (id) { criterion.id = id; }
  if (source === 'description' || source === 'manual') { criterion.source = source; }
  return criterion;
}

function ticketAttachments(value: unknown): TicketAttachmentSummary[] {
  if (!Array.isArray(value)) { return []; }
  return value
    .filter(isRecord)
    .map(item => ({
      filename: ticketStringField(item, 'filename', 'attachment'),
      size: Number.isFinite(Number(item['size'])) ? Number(item['size']) : 0,
      mimeType: ticketStringField(item, 'mimeType'),
    }));
}

interface TicketAttachmentSummary {
  filename: string;
  size: number;
  mimeType: string;
}

interface JiraBoardTicketPayload {
  summary: string;
  type: string;
  priority: string;
  status: string;
  description: string;
  labels: string[];
  projects: string[];
  attachments: TicketAttachmentSummary[];
  mr: { iid: string; status: string } | null;
  build: { number: string; status: string } | null;
  evidenceCount: number;
  hasJiraUrl: boolean;
  hasMrUrl: boolean;
  isQueued: boolean;
}

async function removeTicketFromQueue(state: KronosState, ticketKey: string, interactive: boolean, extensionUri?: vscode.Uri): Promise<boolean> {
  const ticket = state.state?.tickets?.[ticketKey];
  const decision = decideQueueRemoval(ticketKey, ticket, interactive);
  if (decision.kind === 'block_failing_gate' || decision.kind === 'block_missing_evidence') {
    vscode.window.showWarningMessage(decision.message || `${ticketKey} stayed in queue.`);
    return false;
  }
  if (decision.kind === 'confirm_failing_gate') {
    const action = await vscode.window.showWarningMessage(
      decision.message || `${ticketKey} has failing evidence gate checks.`,
      'Open Gate',
      'Remove Anyway',
      'Cancel'
    );
    if (action === 'Open Gate') {
      if (decision.gate) {
        if (extensionUri) {
          openEvidenceGatePanel(state, [decision.gate], `Evidence Gate: ${ticketKey}`, { extensionUri });
        } else {
          openEvidenceGatePanel(state, [decision.gate], `Evidence Gate: ${ticketKey}`);
        }
      }
      return false;
    }
    if (action !== 'Remove Anyway') {
      return false;
    }
  }
  if (decision.kind === 'confirm_missing_evidence') {
    const action = await vscode.window.showWarningMessage(
      decision.message || `${ticketKey} has no evidence records. Removing it from the queue will make the work harder to audit.`,
      'Add Evidence',
      'Remove Anyway',
      'Cancel'
    );
    if (action === 'Add Evidence') {
      await vscode.commands.executeCommand('kronos.addEvidence', { ticketKey });
      return false;
    }
    if (action !== 'Remove Anyway') {
      return false;
    }
  }

  const result = removeTicketFromQueueState(ticketKey);
  state.reloadAndNotify();
  if (interactive && result.removed === 0) {
    vscode.window.showInformationMessage(`${ticketKey} was not in the queue.`);
  }
  return true;
}

function planNextActions(state: KronosState): PlannedAction[] {
  return buildNextActionPlan({ state: state.state, queue: state.queue });
}

function planToQueueItem(state: KronosState, plan: PlannedAction): QueueItem {
  return buildQueueItemFromPlan({
    state: state.state,
    queue: state.queue,
    resolveProjectPath: projectName => getProjectPath(state, projectName),
  }, plan);
}

function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void> {
  return async (_code: number, run: KronosRun) => {
    let resolvedTicketKey = resolveDispatchTicketKey(ticketKey, run);
    const refreshWarning = await reloadStateAfterDispatch(state, projectName);
    if (refreshWarning) {
      run.warnings = [...(run.warnings || []), refreshWarning];
    }
    const ticketResolutionInput: { tickets?: Record<string, Ticket>; ticketKey?: string; projectName?: string; run?: unknown } = { run };
    if (state.state?.tickets) { ticketResolutionInput.tickets = state.state.tickets; }
    if (resolvedTicketKey) { ticketResolutionInput.ticketKey = resolvedTicketKey; }
    if (projectName) { ticketResolutionInput.projectName = projectName; }
    const resolvedTicket = resolvePostRunTicket(ticketResolutionInput);
    resolvedTicketKey = resolvedTicket.ticketKey || resolvedTicketKey;
    if (resolvedTicketKey) {
      let ticket = resolvedTicket.ticket;
      if (ticket && shouldRecordRunCompletionEvidence({ run, ticket })) {
        try {
          addTicketRunCompletionEvidence(resolvedTicketKey, {
            note: {
              kind: 'note',
              text: buildRunCompletionEvidenceText(run, ticket),
            },
            check: buildRunCompletionEvidenceCheck(run, ticket),
          });
        } catch (e: unknown) {
          vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to add run completion evidence.'));
        }
      }
      state.reloadAndNotify();
      const reloadedTicketInput: { tickets?: Record<string, Ticket>; ticketKey?: string; projectName?: string; run?: unknown } = { run, ticketKey: resolvedTicketKey };
      if (state.state?.tickets) { reloadedTicketInput.tickets = state.state.tickets; }
      if (projectName) { reloadedTicketInput.projectName = projectName; }
      const reloadedTicket = resolvePostRunTicket(reloadedTicketInput);
      resolvedTicketKey = reloadedTicket.ticketKey || resolvedTicketKey;
      ticket = reloadedTicket.ticket;
      const readinessInput: { run: unknown; ticketKey?: string; ticket?: Ticket } = { run, ticketKey: resolvedTicketKey };
      if (ticket) { readinessInput.ticket = ticket; }
      run.readiness = evaluatePostRunReadiness(readinessInput);
      Object.assign(run, postRunReadinessRunPatch(run, run.readiness));
      writeRunRecord(run);
      if (ticket && ['await_review', 'done', 'deploy_monitor'].includes(ticket.next_action)) {
        await removeTicketFromQueue(state, resolvedTicketKey, false);
      }
      await showRunCompletionToast(resolvedTicketKey, ticket, run);
    } else {
      run.readiness = evaluatePostRunReadiness({ run });
      Object.assign(run, postRunReadinessRunPatch(run, run.readiness));
      writeRunRecord(run);
    }
  };
}

async function reloadStateAfterDispatch(state: KronosState, projectName?: string): Promise<string | undefined> {
  let refreshWarning: string | undefined;
  if (projectName) {
    try {
      await state.refresh(projectName);
    } catch (e: unknown) {
      refreshWarning = unknownErrorMessage(e, `Failed to refresh Kronos state after dispatch for ${projectName}.`);
      vscode.window.showWarningMessage(refreshWarning);
    }
  }
  state.reloadAndNotify();
  return refreshWarning;
}

function resolveDispatchTicketKey(ticketKey: string | undefined, run: KronosRun): string | undefined {
  return [ticketKey, run.ticket]
    .map(value => typeof value === 'string' ? value.trim() : '')
    .find(Boolean);
}

async function showRunCompletionToast(ticketKey: string, ticket: Ticket | undefined, run: KronosRun): Promise<void> {
  const notification = buildRunCompletionNotification(ticketKey, ticket, run);
  if (!notification) { return; }
  const action = notification.severity === 'warning'
    ? await vscode.window.showWarningMessage(notification.message, ...notification.actions)
    : await vscode.window.showInformationMessage(notification.message, ...notification.actions);
  if (action === 'Open Review') {
    if (notification.reviewTarget === 'mr' && ticket?.mr) {
      await vscode.commands.executeCommand('kronos.openMrDiff', { ticketKey, ticket });
    } else {
      await vscode.commands.executeCommand('kronos.viewTicket', { ticketKey });
    }
  }
  if (action === 'Run Center') {
    await vscode.commands.executeCommand('kronos.runCenter');
  }
}

async function confirmDispatchCollisions(state: KronosState, target: {
  ticketKey?: string | null;
  projects: string[];
  action: string;
  excludeQueueItemId?: string;
}, extensionUri?: vscode.Uri): Promise<boolean> {
  const mrFiles = await loadMrFileHints(state, [target]);
  const collisionInput: DispatchCollisionInput = {
    ...target,
    queue: state.queue,
    runs: listRuns(),
    mrFiles,
  };
  if (state.state?.tickets) { collisionInput.tickets = state.state.tickets; }
  const collisions = detectDispatchCollisions(collisionInput);
  if (collisions.length === 0) { return true; }

  const detail = collisions.slice(0, 5)
    .map(c => `${collisionSeverityLabel(c.severity)} ${c.title}: ${c.detail}`)
    .join('\n');
  const more = collisions.length > 5 ? `\n...and ${collisions.length - 5} more.` : '';
  const action = await vscode.window.showWarningMessage(
    `Potential Kronos work collision:\n${detail}${more}`,
    { modal: true },
    'Start Anyway',
    'Open Run Center',
    'Cancel'
  );
  if (action === 'Open Run Center') {
    openInteractiveRunCenter(state, extensionUri);
    return false;
  }
  return action === 'Start Anyway';
}

function collisionSeverityLabel(severity: DispatchCollision['severity']): string {
  if (severity === 'high') { return '[HIGH]'; }
  if (severity === 'medium') { return '[MED]'; }
  return '[LOW]';
}

function getProjectPath(state: KronosState, projectName?: string): string | undefined {
  if (!projectName || !state.state) { return undefined; }
  return state.state.projects[projectName]?.path;
}

function getProjectNameForPath(state: KronosState, projectPath?: string): string | undefined {
  const targetPath = projectPathKey(projectPath);
  if (!targetPath || !state.state) { return undefined; }
  for (const [projectName, project] of Object.entries(state.state.projects)) {
    if (projectPathKey(project.path) === targetPath) { return projectName; }
  }
  return undefined;
}

function projectPathKey(projectPath?: string): string {
  if (!projectPath?.trim()) { return ''; }
  const normalized = path.normalize(projectPath.trim()).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function getActiveProfile(): KronosProfile {
  const config = vscode.workspace.getConfiguration('kronos');
  return resolveProfile(config.get<string>('profile'));
}

function getProjectBaseBranch(state: KronosState, projectName?: string): string {
  const config = vscode.workspace.getConfiguration('kronos');
  const configDefault = resolveDefaultBaseBranch(config.get<string>('profile'), config.get<string>('defaultBaseBranch'));
  if (!projectName || !state.state) { return sanitizeBranchName(configDefault); }
  const projectConfig = state.state.projects[projectName]?.config;
  return sanitizeBranchName(projectConfig?.base_branch || projectConfig?.default_branch || configDefault);
}

function sanitizeBranchName(branch: string): string {
  return sanitizeProfileBranch(branch) || 'develop';
}

function resolveProjectName(state: KronosState, item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const projectName = record['projectName'];
  if (typeof projectName === 'string' && projectName.trim()) { return projectName; }
  const ticket = recordFromUnknown(record['ticket']);
  const ticketProjects = ticket['projects'];
  if (Array.isArray(ticketProjects) && typeof ticketProjects[0] === 'string' && ticketProjects[0].trim()) {
    return ticketProjects[0];
  }
  const ticketKey = record['ticketKey'];
  if (typeof ticketKey === 'string' && state.state) {
    const t = state.state.tickets[ticketKey];
    if (t?.projects?.length) { return t.projects[0]; }
  }
  return undefined;
}

async function pickTicketProjectNameForDispatch(
  state: KronosState,
  item: unknown,
  ticketKey: string | undefined,
  placeHolder: string,
): Promise<string | undefined> {
  const explicitProject = explicitProjectName(item);
  if (explicitProject) { return explicitProject; }
  const projects = ticketProjectNamesForCommand(state, item, ticketKey);
  if (projects.length === 0) {
    if (!ticketKey) {
      return pickProjectName(state, placeHolder);
    }
    const target = ticketKey ? `${ticketKey} is` : 'Selected ticket is';
    vscode.window.showWarningMessage(`${target} not linked to any project.`);
    return undefined;
  }
  if (projects.length === 1) { return projects[0]; }
  const picked = await vscode.window.showQuickPick(
    projects.map(projectName => ({
      label: projectName,
      description: state.state?.projects[projectName]?.path || 'Project is not registered',
    })),
    { placeHolder },
  );
  return picked?.label;
}

function explicitProjectName(item: unknown): string | undefined {
  const record = recordFromUnknown(item);
  const projectName = stringFromUnknown(record['projectName']);
  if (projectName) { return projectName; }
  const nestedItem = recordFromUnknown(record['item']);
  return stringFromUnknown(nestedItem['projectName']);
}

function ticketProjectNamesForCommand(state: KronosState, item: unknown, ticketKey: string | undefined): string[] {
  const record = recordFromUnknown(item);
  const nestedItem = recordFromUnknown(record['item']);
  const projectSources = [
    recordFromUnknown(record['ticket'])['projects'],
    recordFromUnknown(nestedItem['ticket'])['projects'],
    ticketKey && state.state ? state.state.tickets[ticketKey]?.projects : undefined,
  ];
  for (const source of projectSources) {
    const projects = uniqueProjectNames(source);
    if (projects.length > 0) { return projects; }
  }
  return [];
}

function uniqueProjectNames(value: unknown): string[] {
  if (!Array.isArray(value)) { return []; }
  return [...new Set(value
    .filter((project): project is string => typeof project === 'string' && project.trim().length > 0)
    .map(project => project.trim()))];
}

function resolveRunId(item: unknown): string | undefined {
  if (typeof item === 'string' && item.trim()) { return item.trim(); }
  const record = recordFromUnknown(item);
  const runId = record['runId'];
  if (typeof runId === 'string' && runId.trim()) { return runId.trim(); }
  const id = record['id'];
  if (typeof id === 'string' && id.trim()) { return id.trim(); }
  return undefined;
}

function resolveItemId(item: unknown): string | undefined {
  const itemId = recordFromUnknown(item)['itemId'];
  return typeof itemId === 'string' && itemId.trim() ? itemId.trim() : undefined;
}

function resolveWorktreePath(item: unknown): string | undefined {
  const worktreePath = recordFromUnknown(item)['worktreePath'];
  return typeof worktreePath === 'string' && worktreePath.trim() ? worktreePath.trim() : undefined;
}

function resolveRecoveryFocusId(item: unknown): string | undefined {
  return resolveItemId(item) || resolveRunId(item) || resolveWorktreePath(item);
}

async function pickProjectName(state: KronosState, placeHolder: string): Promise<string | undefined> {
  const projects = Object.entries(state.state?.projects || {});
  if (projects.length === 0) {
    vscode.window.showWarningMessage('No projects registered.');
    return undefined;
  }
  if (projects.length === 1) {
    return projects[0]?.[0];
  }
  const picked = await vscode.window.showQuickPick(
    projects
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, project]) => ({ label, description: project.path || '' })),
    { placeHolder }
  );
  return picked?.label;
}

async function pickOrphanMergeRequestTicket(state: KronosStateSnapshot): Promise<string | undefined> {
  const candidates = Object.entries(state.tickets)
    .filter(([, ticket]) => ticket.source === 'adhoc' && Boolean(ticket.mr))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ticketKey, ticket]) => ({
      label: `${ticketKey} - MR !${ticket.mr?.iid || '?'}`,
      description: ticket.mr?.review_status.replace(/_/g, ' ') || 'merge request',
      detail: ticket.summary,
      ticketKey,
    }));
  if (candidates.length === 0) {
    vscode.window.showWarningMessage('No orphan merge requests found to link.');
    return undefined;
  }
  if (candidates.length === 1) {
    return candidates[0]?.ticketKey;
  }
  const picked = await vscode.window.showQuickPick(candidates, { placeHolder: 'Link which orphan MR to a Jira ticket?' });
  return picked?.ticketKey;
}

function resolveTicketKey(item: unknown): string | undefined {
  if (typeof item === 'string') { return item; }
  const record = recordFromUnknown(item);
  if (typeof record['ticketKey'] === 'string') { return record['ticketKey']; }
  const nestedItem = recordFromUnknown(record['item']);
  if (typeof nestedItem['ticket'] === 'string') { return nestedItem['ticket']; }
  if (typeof record['ticket'] === 'string') { return record['ticket']; }
  return undefined;
}

function resolveMergeRequestUrl(item: unknown): string | undefined {
  const ticket = recordFromUnknown(recordFromUnknown(item)['ticket']);
  const mr = recordFromUnknown(ticket['mr']);
  return stringFromUnknown(mr['url']);
}

interface QueueCommandPayload {
  id?: string;
  ticket?: string;
  projects: string[];
  projectPath?: string;
  action: string;
}

function resolveQueueCommandItem(item: unknown): QueueCommandPayload | undefined {
  return queueCommandPayloadFromRecord(recordFromUnknown(item))
    || queueCommandPayloadFromRecord(recordFromUnknown(recordFromUnknown(item)['item']));
}

function queueCommandPayloadFromRecord(record: Record<string, unknown>): QueueCommandPayload | undefined {
  const action = record['action'];
  if (typeof action !== 'string' || !action.trim()) { return undefined; }
  const projects = Array.isArray(record['projects'])
    ? record['projects']
      .filter((project): project is string => typeof project === 'string' && project.trim().length > 0)
      .map(project => project.trim())
    : [];
  const ticket = typeof record['ticket'] === 'string' && record['ticket'].trim() ? record['ticket'].trim() : undefined;
  const id = typeof record['id'] === 'string' && record['id'].trim() ? record['id'].trim() : undefined;
  const projectPath = stringFromUnknown(record['project_path']) || stringFromUnknown(record['projectPath']);
  const payload: QueueCommandPayload = { projects, action: action.trim() };
  if (id) { payload.id = id; }
  if (ticket) { payload.ticket = ticket; }
  if (projectPath) { payload.projectPath = projectPath; }
  return payload;
}

function resolveQueueIndex(item: unknown): number | undefined {
  const index = recordFromUnknown(item)['index'];
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : undefined;
}

function resolveTaskId(item: unknown): string | undefined {
  const taskId = recordFromUnknown(item)['taskId'];
  return typeof taskId === 'string' && taskId.trim() ? taskId : undefined;
}

function startReviewAutomation(state: KronosState): vscode.Disposable {
  if (!getActiveProfile().providers.gitlab) {
    return { dispose: () => undefined };
  }
  const config = vscode.workspace.getConfiguration('kronos');
  const fallbackSec = positiveConfigNumber(config.get<number>('pollIntervalSec', 300), 300);
  const pollIntervalMs = configIntervalSecondsMs(config.get<number>('reviewPollIntervalSec', fallbackSec), fallbackSec, 60);
  let running = false;
  let disposed = false;
  const poll = async () => {
    if (disposed || running) { return; }
    running = true;
    try {
      if (disposed) { return; }
      await pollReviewMergeRequests(state, () => !disposed);
    } catch (e: unknown) {
      console.warn(unknownErrorMessage(e, 'Review MR polling failed.'));
    } finally {
      running = false;
    }
  };
  void poll();
  const timer = setInterval(() => { void poll(); }, pollIntervalMs);
  return {
    dispose: () => {
      disposed = true;
      clearInterval(timer);
    },
  };
}

async function pollReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true): Promise<void> {
  if (!shouldContinue()) { return; }
  state.reloadAndNotify();
  if (!shouldContinue()) { return; }
  await reconcileTerminalReviewMergeRequests(state, shouldContinue);
  if (!shouldContinue()) { return; }
  for (const candidate of reviewMergeRequestCandidates(state)) {
    if (!shouldContinue()) { return; }
    try {
      const status = await gitlabAdapter.mergeRequestStatus(state, candidate.ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
      if (!shouldContinue()) { return; }
      const update = updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status });
      if (!shouldContinue()) { return; }
      if (update.changed) {
        state.reloadAndNotify();
      }
      if (!shouldContinue()) { return; }
      const decision = decideReviewMonitorAction(candidate.ticketKey, update);
      if (decision.kind === 'deploy_monitor') {
        if (!shouldContinue()) { return; }
        const result = await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket);
        if (reviewDeployMonitorActionHandled(result)) {
          rememberReviewTerminalMergeRequestAction(candidate.ticketKey, update.ticket, 'deploy_monitor');
        }
      } else if (decision.kind === 'blocked') {
        if (!shouldContinue()) { return; }
        notifyReviewMonitorDecision(decision);
      } else if (decision.kind === 'notify') {
        if (!shouldContinue()) { return; }
        notifyReviewMonitorDecision(decision);
      }
    } catch (e: unknown) {
      if (!shouldContinue()) { return; }
      console.warn(unknownErrorMessage(e, `Failed to poll MR status for ${candidate.ticketKey}.`));
      notifyReviewMergeRequestPollFailure(candidate.ticketKey, e);
    }
  }
}

async function reconcileTerminalReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true): Promise<void> {
  if (!shouldContinue()) { return; }
  const updates = reconcileTerminalMergeRequestState();
  if (!shouldContinue()) { return; }
  if (updates.some(update => update.changed)) {
    state.reloadAndNotify();
  }
  if (!shouldContinue()) { return; }
  for (const update of updates) {
    if (!shouldContinue()) { return; }
    const actionKey = reviewTerminalMergeRequestActionKey(update.ticketKey, update.ticket.mr?.iid, update.action);
    if (reviewTerminalMergeRequestActions.has(actionKey)) { continue; }
    if (update.action === 'deploy_monitor') {
      if (!shouldContinue()) { return; }
      const result = await startDeployMonitorForMergedTicket(state, update.ticketKey, update.ticket);
      if (reviewDeployMonitorActionHandled(result)) { reviewTerminalMergeRequestActions.add(actionKey); }
    } else if (update.action === 'blocked') {
      if (!shouldContinue()) { return; }
      reviewTerminalMergeRequestActions.add(actionKey);
      void vscode.window.showWarningMessage(`${update.ticketKey} ${update.message}`);
    }
  }
}

function rememberReviewTerminalMergeRequestAction(ticketKey: string, ticket: Ticket, action: ReviewTerminalMergeRequestAction): void {
  reviewTerminalMergeRequestActions.add(reviewTerminalMergeRequestActionKey(ticketKey, ticket.mr?.iid, action));
}

function notifyReviewMergeRequestPollFailure(ticketKey: string, error: unknown): void {
  const now = Date.now();
  const lastNotified = reviewPollFailureNotifications.get(ticketKey) || 0;
  if (now - lastNotified < REVIEW_POLL_FAILURE_NOTIFICATION_MS) { return; }
  reviewPollFailureNotifications.set(ticketKey, now);
  const detail = unknownErrorMessage(error, 'unknown error');
  const selection = vscode.window.showWarningMessage(
    `${ticketKey}: MR status polling failed: ${detail}`,
    'Open Review',
    'Run Doctor',
  );
  void selection.then(action => {
    if (action === 'Open Review') {
      return vscode.commands.executeCommand('kronosReview.focus');
    } else if (action === 'Run Doctor') {
      return vscode.commands.executeCommand('kronos.doctor');
    }
    return undefined;
  }).then(undefined, (e: unknown) => {
    console.warn(unknownErrorMessage(e, 'Failed to handle MR polling failure action.'));
  });
}

function notifyReviewMonitorDecision(decision: ReviewMonitorDecision): void {
  if (!decision.message) { return; }
  const actions = decision.url ? ['Open MR', 'Open Review'] : ['Open Review'];
  const selection = decision.severity === 'warning'
    ? vscode.window.showWarningMessage(decision.message, ...actions)
    : vscode.window.showInformationMessage(decision.message, ...actions);
  void selection.then(action => {
    if (action === 'Open MR' && decision.url) {
      openExternalHttpUrl(decision.url);
      return;
    }
    if (action === 'Open Review') {
      return vscode.commands.executeCommand('kronosReview.focus');
    }
    return undefined;
  }).then(undefined, (e: unknown) => {
    void vscode.window.showWarningMessage(unknownErrorMessage(e, 'Failed to handle MR review notification action.'));
  });
}

function reviewMergeRequestCandidates(state: KronosState) {
  return openReviewTicketEntries(state.state?.tickets)
    .map(([ticketKey, ticket]) => ({ ticketKey, ticket }));
}

function reviewBranchTickets(state: KronosState) {
  return buildReviewBranchTickets(state.state?.tickets);
}

async function startDeployMonitorForMergedTicket(state: KronosState, ticketKey: string, ticket: Ticket): Promise<ReviewDeployMonitorResult> {
  state.reloadAndNotify();
  const currentTicket = state.state?.tickets?.[ticketKey] || ticket;
  const project = resolveDeployMonitorProject(state.state, ticketKey, currentTicket);
  if (project.kind !== 'ok' || !project.projectName || !project.projectPath) {
    const reason = project.reason || `${ticketKey} MR merged, but deploy monitoring could not resolve a project.`;
    if (hasDeployMonitorHandoffIssue(currentTicket, reason)) {
      return 'blocked';
    }
    recordDeployMonitorHandoffIssue(state, ticketKey, currentTicket, reason);
    void vscode.window.showWarningMessage(reason);
    return 'blocked';
  }
  const projectName = project.projectName;
  const projectPath = project.projectPath;
  const mrIid = currentTicket.mr?.iid;
  const deployMonitorRuns = [...listRuns(), ...readArchivedRuns()];
  const deployMonitorMatch = { projectName, projectPath, ticketKey, mrIid };
  if (hasHandledDeployMonitorRun(deployMonitorRuns, deployMonitorMatch)) {
    void vscode.window.showInformationMessage(`${ticketKey} merged - deploy monitor already handled.`);
    return 'handled';
  }
  const attentionIssue = deployMonitorAttentionIssue(deployMonitorRuns, deployMonitorMatch);
  if (attentionIssue) {
    if (hasDeployMonitorHandoffIssue(currentTicket, attentionIssue)) {
      return 'blocked';
    }
    recordDeployMonitorHandoffIssue(state, ticketKey, currentTicket, attentionIssue);
    void vscode.window.showWarningMessage(attentionIssue, 'Run Center').then(action => {
      if (action === 'Run Center') {
        return vscode.commands.executeCommand('kronos.runCenter');
      }
      return undefined;
    }, (e: unknown) => {
      console.warn(unknownErrorMessage(e, 'Failed to open Run Center for deploy monitor issue.'));
    });
    return 'blocked';
  }
  const promptMetadata: PromptRunMetadata = {
    source: 'slash',
    handoff: 'review-monitor',
  };
  if (mrIid !== undefined) { promptMetadata.mergeRequestIid = mrIid; }
  const started = await startClaudeDispatch(projectPath, 'deploy-monitor', ticketKey, {
    onComplete: refreshAfterDispatch(state, projectName, ticketKey),
    projectNameOverride: projectName,
    promptMetadata,
  });
  if (!started) {
    const reason = `${ticketKey} merged, but deploy monitor did not start. Start deploy monitor manually from the Review view or ticket details.`;
    if (hasDeployMonitorHandoffIssue(currentTicket, reason)) {
      return 'blocked';
    }
    recordDeployMonitorHandoffIssue(state, ticketKey, currentTicket, reason);
    void vscode.window.showWarningMessage(reason);
    return 'blocked';
  }
  void vscode.window.showInformationMessage(`${ticketKey} merged - deploy monitor started.`);
  return 'started';
}

function recordDeployMonitorHandoffIssue(state: KronosState, ticketKey: string, ticket: Ticket, summary: string): void {
  state.reloadAndNotify();
  const currentTicket = state.state?.tickets?.[ticketKey] || ticket;
  if (hasDeployMonitorHandoffIssue(currentTicket, summary)) { return; }
  try {
    addTicketEvidenceCheck(ticketKey, {
      name: deployMonitorHandoffCheckName(currentTicket),
      result: 'fail',
      environment: 'Kronos review monitor',
      command: `kronos run deploy-monitor ${ticketKey}`,
      summary,
      confidence: 'high',
    });
    state.reloadAndNotify();
  } catch (e: unknown) {
    console.warn(unknownErrorMessage(e, `Failed to record deploy-monitor handoff issue for ${ticketKey}.`));
  }
}

async function pickProjectFromTickets<T extends { key: string; projects: string[] }>(
  state: KronosState,
  tickets: T[],
  placeHolder: string,
  countLabel = 'tickets',
): Promise<{ projectName: string; projectPath: string; tickets: T[] } | null> {
  const byProject: Record<string, T[]> = {};
  for (const t of tickets) {
    for (const p of t.projects) {
      const bucket = byProject[p] || [];
      if (!bucket.some(x => x.key === t.key)) { bucket.push(t); }
      byProject[p] = bucket;
    }
  }

  let projectName: string;
  const projectNames = Object.keys(byProject);
  if (projectNames.length === 0) { return null; }
  if (projectNames.length === 1) {
    const onlyProject = projectNames[0];
    if (!onlyProject) { return null; }
    projectName = onlyProject;
  }
  else {
    const pick = await vscode.window.showQuickPick(
      projectNames.map(p => ({ label: p, description: `${(byProject[p] || []).length} ${countLabel}` })),
      { placeHolder }
    );
    if (!pick) { return null; }
    projectName = pick.label;
  }

  const projectPath = getProjectPath(state, projectName);
  if (!projectPath) { return null; }

  return { projectName, projectPath, tickets: byProject[projectName] || [] };
}

function updateStatusBar(state: KronosState): void {
  if (state.loadIssues.length > 0) {
    statusBarItem.text = state.state ? '$(warning) Kronos: state warnings' : '$(error) Kronos: state error';
    statusBarItem.tooltip = state.loadIssues.map(issue => `${issue.target}: ${issue.detail}`).join('\n');
    statusBarItem.command = 'kronos.openDashboard';
    return;
  }
  if (!state.state) {
    statusBarItem.text = '$(clock) Kronos';
    statusBarItem.tooltip = 'Kronos state is not loaded.';
    statusBarItem.command = 'kronos.openDashboard';
    return;
  }
  const projects = state.state.projects;
  const count = Object.keys(projects).length;
  const sessions = state.sessions.length;
  const activeRunDisplay = activeRunStatusBarSummary(listRuns());
  if (activeRunDisplay) {
    statusBarItem.text = `$(sync~spin) Kronos: ${activeRunDisplay.text}`;
    statusBarItem.tooltip = activeRunDisplay.tooltip;
    statusBarItem.command = 'kronos.runCenter';
    return;
  }
  const greens = Object.values(projects).filter(p => p.health === 'green').length;
  const reds = Object.values(projects).filter(p => p.health === 'red').length;
  const yellows = Object.values(projects).filter(p => p.health === 'yellow').length;

  let health = '';
  if (reds > 0) { health += ` ${reds} red`; }
  if (yellows > 0) { health += ` ${yellows} yellow`; }
  if (greens > 0) { health += ` ${greens} green`; }

  statusBarItem.text = `$(clock) Kronos: ${sessions} sessions |${health || ` ${count} projects`}`;
  statusBarItem.tooltip = `Kronos — ${count} projects tracked, ${sessions} active sessions`;
  statusBarItem.command = 'kronos.openDashboard';
}

function dashboardBriefRecord(brief: unknown): Record<string, unknown> {
  return Boolean(brief) && typeof brief === 'object' && !Array.isArray(brief) ? brief as Record<string, unknown> : {};
}

function dashboardBriefItems(brief: Record<string, unknown>, key: string): unknown[] {
  const value = brief[key];
  return Array.isArray(value) ? value : [];
}

function dashboardBriefCount(brief: Record<string, unknown>, key: string): number {
  const value = brief[key];
  if (typeof value === 'number' && Number.isFinite(value)) { return value; }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function executeDashboardAction(state: KronosState, request: ActionPanelMessage, extensionUri?: vscode.Uri): Promise<void> {
  const command = request.command;
  const ticketKey = request.ticket;
  const runId = request.runId;
  if (ticketKey && !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }

  if (command === 'nextBestAction') {
    await vscode.commands.executeCommand('kronos.nextBestAction');
  } else if (command === 'queuePlanner') {
    await vscode.commands.executeCommand('kronos.queuePlanner');
  } else if (command === 'runCenter') {
    openInteractiveRunCenter(state, extensionUri, runId || undefined);
  } else if (command === 'humanReviewInbox') {
    await vscode.commands.executeCommand('kronos.humanReviewInbox');
  } else if (command === 'evidenceGate') {
    if (ticketKey) {
      await tryExecuteTicketOperatorCommand(command, ticketKey);
    } else {
      await vscode.commands.executeCommand('kronos.evidenceGate');
    }
  } else if (command === 'recoveryCenter') {
    await openRecoveryCenter(state, extensionUri, runId || undefined);
  } else if (command === 'startTicket' && ticketKey) {
    await startTicketFromActionPanel(state, ticketKey);
  } else if ((command === 'viewTicket' || command === 'addEvidence' || command === 'addEvidenceCheck') && ticketKey) {
    await tryExecuteTicketOperatorCommand(command, ticketKey);
  } else {
    vscode.window.showWarningMessage('Ignored Kronos dashboard action without a valid target.');
  }
}

function buildDashboardHtml(state: KronosState, brief: unknown, nonce?: string, loadWarning?: string, actionScriptUri?: string): string {
  const safeBrief = dashboardBriefRecord(brief);
  const projects = state.state?.projects || {};

  const allTickets = state.state?.tickets || {};
  const runs = listRuns();
  const activeRuns = runs.filter(run => isFreshActiveRun(run)).length;
  const failedRuns = runs.filter(r => r.status === 'failed' || r.status === 'cancelled').length;
  const needsHumanRuns = runs.filter(r => r.status === 'needs_human').length;
  const waitingForReviewRuns = runs.filter(r => r.status === 'waiting_for_review').length;
  const evidenceGates = evaluateEvidenceGates(allTickets);
  const evidenceGateFailures = evidenceGates.filter(gate => gate.status === 'fail').length;
  const evidenceGateWarnings = evidenceGates.filter(gate => gate.status === 'warn').length;
  const qualityScore = computeAgentQualityScore({ runs, tickets: allTickets });
  const agingReport = analyzeAging({ tickets: allTickets, thresholds: agingThresholdsFromConfig() });
  const humanReviewInbox = buildHumanReviewInbox({ state: state.state, queue: state.queue, runs });
  const worklistLanes = buildDashboardWorklist({ runs, humanReviewInbox, evidenceGates, agingReport });
  const trendReport = computeTrendMetrics({ runs, tickets: allTickets, windowDays: trendWindowDaysFromConfig() });
  const trendMetric = (label: string) => trendReport.metrics.find(metric => metric.label === label);
  const reworkMetric = trendMetric('Rework rate');
  const buildPassMetric = trendMetric('Build pass rate');
  const cycleMetric = trendMetric('Average cycle time');
  const nextPlan = planNextActions(state)[0];
  const nextContext = nextPlan ? buildNextActionContext(nextPlan, { state: state.state, queue: state.queue }) : undefined;
  const dashboardActions = actionRow([
    actionButton('nextBestAction', 'Next Best Action', { primary: true }),
    actionButton('refreshPanel', 'Refresh'),
    actionButton('queuePlanner', 'Queue Planner'),
    actionButton('runCenter', 'Run Center'),
    actionButton('humanReviewInbox', 'Human Review'),
    actionButton('evidenceGate', 'Evidence Gate'),
    actionButton('recoveryCenter', 'Recovery'),
  ]);
  const cockpitHtml = `<div class="cockpit">
    <div class="metric"><div class="num">${qualityScore.score}</div><div class="lbl">Agent Quality</div></div>
    <div class="metric ${escapeClass(reworkMetric?.status || 'neutral')}"><div class="num">${escapeHtml(reworkMetric?.value || 'n/a')}</div><div class="lbl">Rework Rate</div></div>
    <div class="metric ${escapeClass(buildPassMetric?.status || 'neutral')}"><div class="num">${escapeHtml(buildPassMetric?.value || 'n/a')}</div><div class="lbl">Build Pass</div></div>
    <div class="metric ${escapeClass(cycleMetric?.status || 'neutral')}"><div class="num">${escapeHtml(cycleMetric?.value || 'n/a')}</div><div class="lbl">Avg Cycle</div></div>
    <div class="metric"><div class="num">${activeRuns}</div><div class="lbl">Active Runs</div></div>
    <div class="metric ok"><div class="num">${waitingForReviewRuns}</div><div class="lbl">Waiting Review</div></div>
    <div class="metric warn"><div class="num">${needsHumanRuns}</div><div class="lbl">Needs Human</div></div>
    <div class="metric fail"><div class="num">${failedRuns}</div><div class="lbl">Failed/Cancelled</div></div>
    <div class="metric fail"><div class="num">${evidenceGateFailures}</div><div class="lbl">Gate Fails</div></div>
    <div class="metric warn"><div class="num">${evidenceGateWarnings}</div><div class="lbl">Gate Warnings</div></div>
    <div class="metric fail"><div class="num">${agingReport.summary.critical}</div><div class="lbl">Stale Critical</div></div>
    <div class="metric warn"><div class="num">${agingReport.summary.warning}</div><div class="lbl">Stale Warnings</div></div>
    <div class="next-action">
      <div class="lbl">Next Best Action</div>
      <strong>${nextPlan ? `${escapeHtml(nextPlan.ticketKey || 'Refresh')} - ${escapeHtml(actionToLabel(nextPlan.action))}` : 'No actionable work'}</strong>
      ${nextPlan ? `<div>${escapeHtml(nextPlan.reason)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Command:</strong> ${escapeHtml(nextContext.commandLabel)}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>Risk:</strong> ${escapeHtml(nextContext.risks.join(', '))}</div>` : ''}
      ${nextContext ? `<div class="next-meta"><strong>${nextContext.blockers.length ? 'Blocked' : 'Preflight'}:</strong> ${escapeHtml((nextContext.blockers.length ? nextContext.blockers : nextContext.preflight).join('; '))}</div>` : ''}
      <div class="next-action-controls">${dashboardActions}</div>
    </div>
  </div>`;
  const projectCards = Object.entries(projects).map(([name, proj]) => {
    const healthColor = proj.health === 'green' ? '#4caf50' : proj.health === 'yellow' ? '#ff9800' : proj.health === 'red' ? '#f44336' : '#666';
    const linkedCount = Object.values(allTickets).filter(t => t.projects?.includes(name)).length;
    return `<div class="project-card kronos-panel pad">
      <div class="card-header"><span class="health-dot" style="background:${healthColor}"></span> ${escapeHtml(name)}</div>
      <div class="card-body">${escapeHtml(proj.summary)}<br><small>${linkedCount} tickets | ${proj.open_mr_count} open MRs</small></div>
    </div>`;
  }).join('');

  const completedBrief = dashboardBriefItems(safeBrief, 'completed').map((r: unknown) => escapeHtml(String(r))).join(', ');
  const overnightActions = dashboardBriefCount(safeBrief, 'overnight_actions');
  const vpnDrops = dashboardBriefCount(safeBrief, 'vpn_drops');
  const briefHtml = overnightActions > 0
    ? `<div class="brief">
        <h3>Overnight Summary</h3>
        <p>${escapeHtml(String(overnightActions))} actions, ${escapeHtml(String(vpnDrops))} VPN drops</p>
        ${completedBrief ? `<p><strong>Completed:</strong> ${completedBrief}</p>` : ''}
      </div>`
    : '';

  const worklistHtml = buildDashboardWorklistHtml(worklistLanes);
  const warningHtml = loadWarning
    ? `<div class="dashboard-warning kronos-panel pad"><strong>Morning brief unavailable</strong><div>${escapeHtml(loadWarning)}</div></div>`
    : '';

  return `<!DOCTYPE html>
<html>
<head>
<style>
  ${kronosWebviewBaseCss()}
  .dashboard-shell { max-width: 1320px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0; }
  .cockpit { display: grid; grid-template-columns: repeat(auto-fit, minmax(128px, 1fr)); gap: 10px; margin: 12px 0 18px; }
  .metric, .next-action { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 12px; background: var(--k-surface-soft); }
  .metric { min-height: 72px; }
  .metric .num { font-size: 24px; line-height: 1.1; font-weight: 700; }
  .metric.good .num { color: #4caf50; }
  .metric.warn .num { color: #ff9800; }
  .metric.fail .num, .metric.bad .num { color: #f44336; }
  .lbl { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .next-action { grid-column: span 2; min-height: 0; font-size: 12px; border-color: color-mix(in srgb, var(--k-accent) 42%, var(--k-border)); }
  .next-action strong { display: block; margin: 4px 0; font-size: 14px; line-height: 1.35; }
  .next-meta { margin-top: 6px; color: var(--k-muted); line-height: 1.4; }
  .next-meta strong { display: inline; color: var(--k-fg); font-size: 12px; margin: 0; }
  .next-action-controls { margin-top: 10px; }
  .project-card { transition: border-color 0.15s, background-color 0.15s; }
  .project-card:hover { border-color: var(--k-accent); background: var(--k-surface-soft); }
  .card-header { font-weight: 650; margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
  .card-body { color: var(--k-muted); font-size: 13px; }
  .health-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  .brief { border-left: 3px solid var(--k-accent); padding: 12px; margin: 16px 0; border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .brief h3,
  .section h3 { margin: 0 0 8px; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .brief p { margin: 6px 0 0; }
  .section { margin: 20px 0; }
  .worklists { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin: 12px 0; }
  .lane { border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px 12px; background: var(--k-surface); }
  .lane h3 { margin: 0 0 8px 0; font-size: 13px; font-weight: 650; }
  .lane ul { list-style: none; padding: 0; margin: 0; }
  .work-item { border-top: 1px solid var(--k-border); padding: 8px 0; }
  .work-item:first-child { border-top: none; }
  .work-item strong { display: block; font-size: 12px; }
  .work-item div { color: var(--k-muted); font-size: 11px; margin-top: 2px; }
  .work-item .inline-actions { margin-top: 7px; }
  .work-item.critical strong { color: #f44336; }
  .work-item.warning strong { color: #ff9800; }
  .work-item.ok strong { color: #4caf50; }
  .lane-empty { color: var(--k-muted); font-size: 12px; }
  .dashboard-warning { margin: 12px 0; border-color: color-mix(in srgb, #ff9800 42%, var(--k-border)); color: var(--k-fg); }
  .dashboard-warning strong { display: block; margin-bottom: 4px; color: #ff9800; }
  .dashboard-warning div { color: var(--k-muted); font-size: 12px; line-height: 1.45; }
  @media (max-width: 820px) {
    .next-action { grid-column: 1; }
  }
</style>
</head>
<body><div class="kronos-shell dashboard-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Dashboard</h1>
      <div class="kronos-subtitle">${Object.keys(projects).length} project${Object.keys(projects).length === 1 ? '' : 's'} tracked, ${Object.keys(allTickets).length} ticket${Object.keys(allTickets).length === 1 ? '' : 's'} in state</div>
    </div>
  </div>
  ${warningHtml}
  ${cockpitHtml}
  ${briefHtml}
  ${worklistHtml}

  <div class="section">
    <h3 class="kronos-section-title">Projects</h3>
    <div class="grid">${projectCards || '<div class="kronos-empty">No projects registered.</div>'}</div>
  </div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Dashboard', actionScriptUri) : ''}</body>
</html>`;
}

function buildDashboardWorklistHtml(lanes: DashboardWorklistLane[]): string {
  const laneHtml = lanes.map(lane => {
    const items = lane.items.map(item => {
      const actions = dashboardWorkItemActions(lane.kind, item);
      return `<li class="work-item ${escapeClass(item.severity)}">
      <strong>${escapeHtml(item.title)}</strong>
      <div>${escapeHtml(item.detail)}</div>
      ${item.ticketKey || item.runId ? `<div>${escapeHtml([item.ticketKey, item.runId].filter(Boolean).join(' | '))}</div>` : ''}
      ${actions.length ? actionRow(actions) : ''}
    </li>`;
    }).join('');
    return `<div class="lane ${escapeClass(lane.kind)}">
      <h3>${escapeHtml(lane.title)}</h3>
      ${items ? `<ul>${items}</ul>` : `<div class="lane-empty">${escapeHtml(lane.emptyText)}</div>`}
    </div>`;
  }).join('');

  return `<div class="section">
    <h3 class="kronos-section-title">Command Center</h3>
    <div class="worklists">${laneHtml}</div>
  </div>`;
}

function dashboardWorkItemActions(kind: DashboardWorklistLane['kind'], item: DashboardWorklistItem): string[] {
  const ticket = item.ticketKey;
  const runId = item.runId;
  if (kind === 'needs_human') {
    return [
      ticket ? actionButton('viewTicket', 'View', { ticket, primary: true }) : '',
      ticket ? actionButton('startTicket', 'Start', { ticket }) : '',
      runId ? actionButton('runCenter', 'Run Center', { runId }) : '',
      runId ? actionButton('recoveryCenter', 'Recovery', { runId }) : '',
    ].filter(Boolean);
  }
  if (kind === 'active_runs') {
    return [
      runId ? actionButton('runCenter', 'Run Center', { runId }) : actionButton('runCenter', 'Run Center'),
      ticket ? actionButton('viewTicket', 'Ticket', { ticket }) : '',
    ].filter(Boolean);
  }
  if (kind === 'failing_gates') {
    return ticket ? [
      actionButton('evidenceGate', 'Gate', { ticket, primary: true }),
      actionButton('addEvidenceCheck', 'Add Check', { ticket }),
      actionButton('addEvidence', 'Add Evidence', { ticket }),
    ] : [];
  }
  if (kind === 'recent_completed') {
    return [
      ticket ? actionButton('viewTicket', 'Review', { ticket, primary: true }) : '',
      ticket ? actionButton('evidenceGate', 'Gate', { ticket }) : '',
      runId ? actionButton('runCenter', 'Run Center', { runId }) : '',
    ].filter(Boolean);
  }
  if (kind === 'stale_items') {
    return ticket ? [
      actionButton('viewTicket', 'View', { ticket, primary: true }),
      actionButton('startTicket', 'Start', { ticket }),
    ] : [];
  }
  return [];
}

function buildDiffHtml(data: MergeRequestDiffResult): string {
  const mr = data.mr;
  const files = data.files;
  const esc = escapeHtml;
  const fileAnchor = (idx: number, filePath: string) => `file-${idx}-${encodeURIComponent(filePath || `file-${idx + 1}`)}`;

  const fileList = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const icon = f.new_file ? '+' : f.deleted_file ? '-' : '~';
    const kind = f.new_file ? 'add' : f.deleted_file ? 'del' : 'mod';
    return `<a href="#${fileAnchor(idx, filePath)}" class="file-link ${kind}">${icon} ${esc(filePath)}</a>`;
  }).join('');

  const diffs = files.map((f, idx) => {
    const filePath = primaryChangedFilePath(f) || `file-${idx + 1}`;
    const lines = String(f.diff || '').split('\n').map((line: string) => {
      const escaped = esc(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        return `<div class="line add">${escaped}</div>`;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        return `<div class="line del">${escaped}</div>`;
      } else if (line.startsWith('@@')) {
        return `<div class="line hunk">${escaped}</div>`;
      }
      return `<div class="line">${escaped}</div>`;
    }).join('');
    const label = f.new_file ? '(new file)' : f.deleted_file ? '(deleted)' : '';
    return `<div class="file-diff" id="${fileAnchor(idx, filePath)}">
      <div class="file-header">${esc(filePath)} ${label}</div>
      <div class="diff-content">${lines}</div>
    </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .diff-shell { max-width: none; }
  .mr-meta { display: flex; flex-wrap: wrap; gap: 8px 16px; color: var(--k-muted); font-size: 12px; }
  .file-list { display: grid; gap: 2px; margin: 12px 0 18px; padding: 8px; }
  .file-link { display: block; padding: 3px 6px; border-radius: var(--k-radius-sm); text-decoration: none; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .file-link.add { color: var(--k-ok); }
  .file-link.del { color: var(--k-danger); }
  .file-link.mod { color: var(--k-accent); }
  .file-link:hover { background: var(--k-hover); text-decoration: none; }
  .file-diff { margin: 16px 0; }
  .file-header { background: var(--k-surface-soft); padding: 7px 12px; font-weight: 650; border: 1px solid var(--k-border); border-bottom: none; border-radius: var(--k-radius-sm) var(--k-radius-sm) 0 0; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; }
  .diff-content { border: 1px solid var(--k-border); border-radius: 0 0 var(--k-radius-sm) var(--k-radius-sm); overflow-x: auto; background: var(--k-bg); }
  .line { padding: 0 12px; white-space: pre; min-height: 18px; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; line-height: 18px; }
  .line.add { background: rgba(40, 167, 69, 0.15); color: var(--vscode-gitDecoration-addedResourceForeground); }
  .line.del { background: rgba(220, 53, 69, 0.15); color: var(--vscode-gitDecoration-deletedResourceForeground); }
  .line.hunk { background: var(--k-surface-soft); color: var(--k-accent); font-style: italic; }
</style></head><body><div class="kronos-shell diff-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">${esc(mr.title || 'Merge Request Diff')}</h1>
      <div class="mr-meta">
        <span>${esc(mr.source_branch || '')} &rarr; ${esc(mr.target_branch || '')}</span>
        <span>by ${esc(mr.author || '')}</span>
        <span>${files.length} files changed</span>
      </div>
    </div>
  </div>
  ${fileList ? `<div class="file-list kronos-panel">${fileList}</div>` : '<div class="kronos-empty">No changed files found.</div>'}
  ${diffs}
</div></body></html>`;
}

function buildJiraBoardHtml(state: KronosState, nonce: string, scriptUri: string): string {
  const esc = escapeHtml;
  const attr = escapeAttr;
  const tickets = state.state?.tickets || {};
  const projects = Object.keys(state.state?.projects || {});
  const queue = state.queue;
  const queuedKeys = new Set((queue?.items || []).map(i => i.ticket));

  const columns: Record<string, string[]> = {
    'To Do': [], 'Queued': [], 'In Progress': [], 'Review': [], 'Blocked': [], 'Done': [],
  };
  const columnMap: Record<string, string> = {
    implement: 'To Do', in_progress: 'In Progress', await_review: 'Review',
    deploy_monitor: 'In Progress', verify: 'In Progress', fix_build: 'In Progress',
    blocked: 'Blocked', done: 'Done', unknown: 'To Do',
  };

  const ticketData: Record<string, JiraBoardTicketPayload> = {};

  for (const [key, t] of Object.entries(tickets)) {
    const isQueued = queuedKeys.has(key);
    const labels = ticketStringArray(t.labels);
    const linkedProjects = ticketStringArray(t.projects);
    const attachments = ticketAttachments(t.attachments);
    const mr = isRecord(t.mr) ? t.mr : null;
    const build = isRecord(t.build) ? t.build : null;
    const summary = ticketStringField(t, 'summary');
    const ticketType = ticketStringField(t, 'type');
    const priority = ticketStringField(t, 'priority');
    const jiraStatus = ticketStringField(t, 'jira_status');
    const nextAction = ticketStringField(t, 'next_action', 'unknown');
    ticketData[key] = {
      summary,
      type: ticketType,
      priority,
      status: jiraStatus,
      description: ticketStringField(t, 'description'),
      labels,
      projects: linkedProjects,
      attachments,
      mr: mr ? {
        iid: ticketStringField(mr, 'iid', '?'),
        status: ticketStringField(mr, 'review_status'),
      } : null,
      build: build ? {
        number: ticketStringField(build, 'number', '?'),
        status: ticketStringField(build, 'status'),
      } : null,
      evidenceCount: evidenceRecordCount(t),
      hasJiraUrl: Boolean(t.jira_url),
      hasMrUrl: Boolean(mr && ticketStringField(mr, 'url')),
      isQueued,
    };
    let col = queuedKeys.has(key) ? 'Queued' : (columnMap[nextAction] || 'To Do');

    const projs = linkedProjects.map((p: string) => `<span class="tag proj">${esc(p)}</span>`).join('');
    const typeClass = ticketType.toLowerCase().includes('bug') || ticketType.toLowerCase().includes('defect') ? 'bug' : 'story';
    const mrReviewStatus = mr ? ticketStringField(mr, 'review_status') : '';
    const hasMrUrl = Boolean(mr && ticketStringField(mr, 'url'));
    const mrLabel = mr ? `MR !${esc(ticketStringField(mr, 'iid', '?'))} &middot; ${esc(mrReviewStatus.replace(/_/g, ' '))}` : '';
    const mrLink = mr
      ? hasMrUrl
        ? `<button type="button" class="badge mr clickable" data-action="openMr" data-ticket="${attr(key)}">${mrLabel}</button>`
        : `<span class="badge mr">${mrLabel}</span>`
      : '';
    const attBadge = attachments.length > 0 ? `<span class="badge att">${attachments.length} attachment${attachments.length === 1 ? '' : 's'}</span>` : '';
    const evidenceCount = evidenceRecordCount(t);
    const evidenceBadge = evidenceCount > 0 ? `<span class="badge evidence">${evidenceCount} evidence</span>` : '';
    const hasProjects = linkedProjects.length > 0;
    const statusTag = isQueued ? `<span class="tag status">${esc(jiraStatus)}</span>` : '';

    const linkButtons = projects.map(p => {
      const isLinked = linkedProjects.includes(p);
      return `<button type="button" class="link-btn ${isLinked ? 'linked' : ''}" data-action="${isLinked ? 'unlink' : 'link'}" data-ticket="${attr(key)}" data-project="${attr(p)}">${isLinked ? '&#10003;' : '+'} ${esc(p)}</button>`;
    }).join('');

    const queueBtn = isQueued
      ? `<button type="button" class="action-btn queued" data-action="removeFromQueue" data-ticket="${attr(key)}">Remove from Queue</button>`
      : hasProjects
        ? `<button type="button" class="action-btn" data-action="addToQueue" data-ticket="${attr(key)}">Add to Queue</button>`
        : '';

    const startBtn = isQueued && hasProjects
      ? `<button type="button" class="action-btn start" data-action="start" data-ticket="${attr(key)}">Start</button>`
      : '';

    const jiraLink = t.jira_url ? `<button type="button" class="jira-link clickable text-button" data-action="openJira" data-ticket="${attr(key)}">Jira</button>` : '';

    const searchText = [
      key,
      summary,
      priority,
      ticketType,
      jiraStatus,
      nextAction,
      ...linkedProjects,
      ...labels,
    ].map(value => String(value || '').toLowerCase()).join(' ');
    const card = `<div class="card ${typeClass}" data-ticket="${attr(key)}" data-search="${attr(searchText)}" tabindex="0" role="button">
      <div class="card-key">${esc(key)} <span class="priority">${esc(priority)}</span> ${statusTag}</div>
      <div class="card-summary">${esc(summary)}</div>
      <div class="card-tags">${projs} ${mrLink} ${attBadge} ${evidenceBadge}</div>
      <div class="card-links">${linkButtons}</div>
      <div class="card-actions">${queueBtn} ${startBtn} ${jiraLink}</div>
    </div>`;
    const columnCards = columns[col] || [];
    columnCards.push(card);
    columns[col] = columnCards;
  }

  const colHtml = Object.entries(columns).map(([name, cards]) => {
    const colClass = name === 'Queued' ? 'column queue-col' : 'column';
    return `<div class="${colClass}" role="region" aria-label="${attr(name)} tickets"><div class="col-header">${name} <span class="count" data-count>${cards.length}</span></div><div class="column-cards">${cards.join('')}<div class="empty-column" data-empty>No tickets.</div></div></div>`;
  }).join('');

  const ticketJsonRaw = escapeHtml(JSON.stringify(ticketData));
  return `<!DOCTYPE html>
<html><head>
<style>
  ${kronosWebviewBaseCss()}
  .board-shell { max-width: none; }
  .board-toolbar { justify-content: space-between; }
  .board-filter { width: min(440px, 100%); }
  .board-filter-summary { color: var(--k-muted); font-size: 12px; }
  .board { display: flex; align-items: stretch; gap: 12px; overflow-x: auto; min-height: 480px; padding-bottom: 10px; scrollbar-gutter: stable; }
  .column { min-width: 250px; flex: 1 0 250px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px; }
  .queue-col { border-color: color-mix(in srgb, var(--k-accent) 55%, var(--k-border)); }
  .col-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-weight: 650; font-size: 11px; padding: 2px 2px 10px; margin-bottom: 4px; color: var(--k-muted); text-transform: uppercase; letter-spacing: 0; }
  .col-header .count { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; color: var(--k-fg); background: var(--k-bg); font-weight: 650; }
  .column-cards { display: grid; gap: 8px; }
  .empty-column { display: none; padding: 14px 10px; color: var(--k-muted); font-size: 12px; text-align: center; border: 1px dashed var(--k-border); border-radius: var(--k-radius-sm); }
  .column.filtered-empty .empty-column { display: block; }
  .card { display: grid; gap: 7px; background: var(--k-bg); border: 1px solid var(--k-border); border-radius: var(--k-radius); padding: 10px; font-size: 11px; cursor: pointer; transition: border-color 0.15s, background-color 0.15s; }
  .card:hover, .card:focus { border-color: var(--k-accent); background: var(--k-hover); outline: none; }
  .card.bug { border-left: 3px solid #f44336; }
  .card.story { border-left: 3px solid #4caf50; }
  .card:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--k-accent)); outline-offset: 2px; }
  .card-key { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-weight: 650; font-size: 11px; }
  .card-key .priority { font-weight: 550; color: var(--k-muted); font-size: 10px; }
  .card-summary { line-height: 1.35; font-size: 12px; }
  .card-tags, .card-links, .card-actions { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 7px; border: 1px solid transparent; border-radius: 999px; font-size: 10px; line-height: 1.2; }
  .tag.proj { background: rgba(33,150,243,0.2); color: var(--vscode-textLink-foreground); }
  .badge { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 7px; border-radius: 999px; font-size: 10px; line-height: 1.2; border: 1px solid transparent; font-family: inherit; }
  .badge.mr { background: rgba(255,152,0,0.2); color: #ff9800; text-decoration: none; }
  .badge.att { border-color: var(--k-border); background: var(--k-surface-soft); color: var(--k-muted); }
  .badge.evidence { background: rgba(76,175,80,0.18); color: #4caf50; }
  .badge.mr:hover { text-decoration: underline; }
  .tag.status { border-color: var(--k-border); color: var(--k-muted); background: var(--k-surface-soft); }
  .link-btn { display: inline-flex; align-items: center; min-height: 22px; background: none; border: 1px solid var(--k-border); color: var(--k-fg); padding: 2px 8px; border-radius: 999px; font-size: 10px; cursor: pointer; opacity: 0.7; font-family: inherit; line-height: 1.2; }
  .link-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); }
  .link-btn.linked { border-color: #4caf50; color: #4caf50; opacity: 1; }
  .clickable { cursor: pointer; color: var(--k-accent); }
  .clickable:hover { text-decoration: underline; }
  .jira-link { font-size: 10px; }
  .badge.mr.clickable { cursor: pointer; }
  .action-btn { display: inline-flex; align-items: center; min-height: 24px; background: none; border: 1px solid var(--k-border); color: var(--k-fg); padding: 3px 8px; border-radius: var(--k-radius-sm); font-size: 10px; font-weight: 550; cursor: pointer; font-family: inherit; line-height: 1.2; }
  .action-btn:hover { background: var(--vscode-list-hoverBackground); }
  .action-btn.queued { border-color: #ff9800; color: #ff9800; }
  .action-btn.start { border-color: #4caf50; color: #4caf50; background: rgba(76,175,80,0.12); font-weight: 650; }
  .text-button { border: 0; background: none; padding: 0; font-family: inherit; }
  .muted { color: var(--k-muted); }

  .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; padding: 24px 16px; background: rgba(0,0,0,0.62); z-index: 100; justify-content: center; align-items: flex-start; overflow-y: auto; }
  .modal-overlay.show { display: flex; }
  .modal { position: relative; background: var(--k-surface); border: 1px solid var(--k-border); border-radius: var(--k-radius); width: min(820px, calc(100vw - 32px)); max-height: calc(100vh - 48px); overflow-y: auto; padding: 22px; box-shadow: 0 16px 48px rgba(0,0,0,0.35); }
  .modal h2 { margin: 0 30px 4px 0; font-size: 18px; line-height: 1.25; }
  .modal .meta { font-size: 12px; color: var(--k-muted); margin-bottom: 12px; }
  .modal .meta-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 12px 0 14px; padding: 12px; border: 1px solid var(--k-border); background: var(--k-surface-soft); border-radius: var(--k-radius); font-size: 12px; }
  .modal .meta-row .item { min-width: 0; word-break: break-word; }
  .modal .meta-row .item .lbl { color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; display: block; margin-bottom: 2px; }
  .modal .desc { max-height: 220px; overflow-y: auto; font-size: 12px; line-height: 1.55; white-space: pre-wrap; background: var(--k-surface-soft); padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); margin: 8px 0; }
  .modal .close-btn { position: absolute; top: 12px; right: 12px; display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; background: none; border: 1px solid transparent; border-radius: var(--k-radius-sm); color: var(--vscode-foreground); font-size: 20px; cursor: pointer; opacity: 0.72; z-index: 10; padding: 0; }
  .modal .close-btn:hover { opacity: 1; background: var(--vscode-list-hoverBackground); border-radius: 4px; }
  .modal .section { margin: 12px 0; }
  .modal .section h3 { color: var(--k-muted); font-size: 11px; font-weight: 650; margin: 0 0 6px 0; text-transform: uppercase; }
  .modal .comments { display: grid; gap: 8px; max-height: 260px; overflow-y: auto; }
  .modal .comment { border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 8px 10px; font-size: 12px; background: var(--k-surface-soft); }
  .modal .comment .author { font-weight: 650; font-size: 11px; }
  .modal .comment .date { color: var(--k-muted); font-size: 10px; margin-left: 6px; }
  .modal .comment-body { margin-top: 5px; white-space: pre-wrap; line-height: 1.45; }
  .modal .modal-actions { position: sticky; bottom: -22px; display: flex; gap: 8px; margin: 18px -22px -22px; padding: 12px 22px; flex-wrap: wrap; border-top: 1px solid var(--k-border); background: var(--k-surface); }
  .modal .modal-actions button { min-height: 28px; }
  .modal .modal-actions button:hover { background: var(--vscode-list-hoverBackground); }
  .modal .modal-actions button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; }
  .modal .modal-actions .jira-action { margin-left: auto; color: var(--vscode-textLink-foreground); }
  .modal-key { color: var(--k-muted); font-size: 12px; font-weight: 650; text-transform: uppercase; }
  .attachment-item { display: inline-block; margin-right: 8px; }
  .modal-blocked-hint { align-self: center; color: var(--k-muted); font-size: 11px; }
  @media (max-width: 760px) {
    .board-toolbar { justify-content: stretch; }
    .board-filter { width: 100%; }
    .column { min-width: 220px; }
    .modal { width: calc(100vw - 24px); padding: 18px; }
    .modal .modal-actions { margin: 16px -18px -18px; padding: 12px 18px; }
    .modal .modal-actions .jira-action { margin-left: 0; }
  }
</style>
${webviewRuntimeScriptTag(nonce, webviewRuntimeScriptUri(scriptUri))}
<script nonce="${escapeAttr(nonce)}" id="kronos-jira-board-script" defer src="${escapeAttr(scriptUri)}" data-kronos-script-kind="jira-board" data-kronos-webview-name="Kronos Jira Board" data-kronos-ready-command="${escapeAttr(WEBVIEW_READY_COMMAND)}"></script>
</head><body><div class="kronos-shell board-shell">
  <textarea id="kronos-jira-ticket-data" class="kronos-data-payload" hidden aria-hidden="true">${ticketJsonRaw}</textarea>
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Jira Board</h1>
      <div class="kronos-subtitle">${Object.keys(tickets).length} ticket${Object.keys(tickets).length === 1 ? '' : 's'} across ${projects.length} project${projects.length === 1 ? '' : 's'}</div>
    </div>
  </div>
  <div class="kronos-toolbar board-toolbar">
    <input id="board-filter" class="board-filter kronos-input" type="search" placeholder="Filter tickets" aria-label="Filter tickets">
    <span id="board-filter-summary" class="board-filter-summary" aria-live="polite">${Object.keys(tickets).length} total</span>
  </div>
  <div class="board">${colHtml}</div>

  <div class="modal-overlay" id="modal-overlay">
    <div class="modal" id="modal" role="dialog" aria-modal="true" aria-labelledby="modal-summary">
      <button class="close-btn" id="modal-close" type="button" aria-label="Close">&times;</button>
      <div id="modal-key" class="modal-key"></div>
      <h2 id="modal-summary"></h2>
      <div class="meta" id="modal-meta"></div>
      <div class="meta-row">
        <div class="item"><span class="lbl">Projects</span><span id="modal-projects"></span></div>
        <div class="item"><span class="lbl">Labels</span><span id="modal-labels"></span></div>
        <div class="item"><span class="lbl">Evidence</span><span id="modal-evidence"></span></div>
        <div class="item"><span class="lbl">MR</span><span id="modal-mr"></span></div>
        <div class="item"><span class="lbl">Build</span><span id="modal-build"></span></div>
        <div class="item"><span class="lbl">Attachments</span><span id="modal-attachments"></span></div>
      </div>
      <div class="section"><h3>Description</h3><div class="desc" id="modal-desc"></div></div>
      <div class="section"><h3>Comments</h3><div class="comments" id="modal-comments" aria-live="polite"></div></div>
      <div class="modal-actions" id="modal-actions"></div>
    </div>
  </div>
</div></body></html>`;
}

function buildTicketHtml(key: string, ticket: Ticket, state: KronosState, nonce?: string, actionScriptUri?: string): string {
  const esc = escapeHtml;
  const projectList = ticketStringArray(ticket.projects);
  const labelList = ticketStringArray(ticket.labels);
  const ticketType = ticketStringField(ticket, 'type');
  const priority = ticketStringField(ticket, 'priority');
  const summary = ticketStringField(ticket, 'summary');
  const jiraStatus = ticketStringField(ticket, 'jira_status');
  const nextAction = ticketStringField(ticket, 'next_action');
  const description = ticketStringField(ticket, 'description');
  const mr = ticket.mr;
  const build = ticket.build;
  const projs = projectList.map((p: string) =>
    `<span class="tag project">${esc(p)}</span>`
  ).join(' ');
  const labels = labelList.map((l: string) => `<span class="tag label">${esc(l)}</span>`).join(' ');
  const gate = evaluateEvidenceGate(key, ticket);
  const gateHtml = buildTicketGateHtml(gate);
  const timeline = buildTicketTimeline({ ticketKey: key, ticket, queue: state.queue, runs: listRuns() });
  const timelineHtml = buildTicketTimelineHtml(timeline);
  const criteria = evidenceAcceptanceCriteria(ticket);
  const criteriaHtml = criteria.length > 0
    ? `<div class="section"><h3>Acceptance Criteria</h3><div class="criteria-list">${criteria.map(criterion => `
      <div class="criterion ${evidenceChecked(criterion) ? 'checked' : ''}">
        <span class="criterion-box">${evidenceChecked(criterion) ? '&#x2611;' : '&#x2610;'}</span>
        <span>${esc(evidenceString(criterion, 'text', 'Untitled criterion'))}</span>
      </div>`).join('')}</div></div>`
    : '';
  const notes = evidenceNotes(ticket);
  const evidenceHtml = notes.length > 0
    ? `<div class="section"><h3>Evidence Ledger</h3><div class="evidence-list">${notes.slice().reverse().map(note => {
      const at = formatWebviewDateTime(evidenceString(note, 'at'), 'Unknown time');
      return `<div class="evidence-note">
        <span class="evidence-kind">${esc(evidenceString(note, 'kind', 'note'))}</span>
        <span class="evidence-time">${esc(at)}</span>
        <div>${esc(evidenceString(note, 'text'))}</div>
      </div>`;
    }).join('')}</div></div>`
    : '';
  const checks = evidenceChecks(ticket);
  const checkHtml = checks.length > 0
    ? `<div class="section"><h3>Evidence Checks</h3><div class="evidence-list">${checks.slice().reverse().map(check => {
      const at = formatWebviewDateTime(evidenceString(check, 'at'), 'Unknown time');
      const result = evidenceString(check, 'result', 'unknown');
      const environment = evidenceString(check, 'environment');
      const confidence = evidenceString(check, 'confidence');
      const summary = evidenceString(check, 'summary');
      const command = evidenceString(check, 'command');
      const artifactPath = evidenceString(check, 'artifact_path');
      const artifact = safeHttpHref(artifactPath);
      return `<div class="evidence-check ${escapeClass(result)}">
        <span class="evidence-kind">${esc(result)}</span>
        <span class="evidence-time">${esc(at)}${environment ? ` - ${esc(environment)}` : ''}${confidence ? ` - ${esc(confidence)} confidence` : ''}</span>
        <div><strong>${esc(evidenceString(check, 'name', 'Check'))}</strong>${summary ? ` - ${esc(summary)}` : ''}</div>
        ${command ? `<div class="evidence-command">${esc(command)}</div>` : ''}
        ${artifact ? `<a href="${artifact}" class="link">Open artifact &rarr;</a>` : artifactPath ? `<div class="evidence-command">${esc(artifactPath)}</div>` : ''}
      </div>`;
    }).join('')}</div></div>`
    : '';
  const environmentResults = evidenceEnvironmentResults(ticket);
  const environmentHtml = environmentResults.length > 0
    ? `<div class="section"><h3>Environment Results</h3><div class="evidence-list">${environmentResults.map(result => {
      const at = formatWebviewDateTime(evidenceString(result, 'checked_at'), 'Unknown time');
      const status = evidenceString(result, 'status', 'unknown');
      const artifactPath = evidenceString(result, 'artifact_path');
      const artifact = safeHttpHref(artifactPath);
      return `<div class="environment-result ${escapeClass(status)}">
        <span class="evidence-kind">${esc(status)}</span>
        <span class="evidence-time">${esc(evidenceString(result, 'environment', 'env'))} - ${esc(at)}</span>
        <div>${esc(evidenceString(result, 'detail'))}</div>
        ${artifact ? `<a href="${artifact}" class="link">Open artifact &rarr;</a>` : artifactPath ? `<div class="evidence-command">${esc(artifactPath)}</div>` : ''}
      </div>`;
    }).join('')}</div></div>`
    : '';

  const statusColor = nextAction === 'blocked' ? '#f44336'
    : nextAction === 'await_review' ? '#ff9800'
    : nextAction === 'in_progress' ? '#2196f3'
    : nextAction === 'implement' ? '#666'
    : '#4caf50';

  const typeIcon = ticketType.toLowerCase().includes('bug') || ticketType.toLowerCase().includes('defect') ? 'Bug' : 'Story';

  let mrHtml = '';
  if (mr) {
    const reviewStatus = ticketStringField(mr, 'review_status', 'pending_review');
    const reviewColor = reviewStatus === 'approved' ? '#4caf50' : reviewStatus === 'changes_requested' ? '#f44336' : '#ff9800';
    const mrUrl = safeHttpHref(ticketStringField(mr, 'url'));
    const commentCount = ticketStringField(mr, 'comment_count');
    const lastCommentAt = ticketStringField(mr, 'last_comment_at');
    const discussionCount = ticketStringField(mr, 'discussion_count');
    const unresolvedDiscussions = ticketStringField(mr, 'unresolved_discussion_count');
    const lastDiscussionAt = ticketStringField(mr, 'last_discussion_at');
    const discussionsResolved = ticketStringField(mr, 'discussions_resolved');
    const comments = mergeRequestComments(mr).slice(-5).reverse();
    const commentsHtml = comments.length > 0
      ? `<div class="mr-comments">${comments.map(comment => {
        const author = ticketStringField(comment, 'author');
        const created = ticketStringField(comment, 'created');
        const body = ticketStringField(comment, 'body');
        return `<div class="mr-comment">
          <div class="mr-comment-meta">${author ? esc(author) : 'Reviewer'}${created ? ` - ${esc(formatWebviewDateTime(created))}` : ''}</div>
          <div>${esc(body)}</div>
        </div>`;
      }).join('')}</div>`
      : '';
    mrHtml = `<div class="section">
      <h3>Merge Request</h3>
      <div class="mr-card">
        <div><strong>MR !${esc(ticketStringField(mr, 'iid', '?'))}</strong> — <span style="color:${reviewColor}">${esc(reviewStatus.replace(/_/g, ' '))}</span></div>
        <div>State: ${esc(ticketStringField(mr, 'state', 'unknown'))}</div>
        ${commentCount ? `<div>Comments: ${esc(commentCount)}${lastCommentAt ? ` · latest ${esc(formatWebviewDateTime(lastCommentAt))}` : ''}</div>` : ''}
        ${discussionCount || unresolvedDiscussions ? `<div>Discussions: ${esc(discussionCount || '?')}${unresolvedDiscussions ? ` · ${esc(unresolvedDiscussions)} unresolved` : ''}${discussionsResolved ? ` · ${discussionsResolved === 'true' ? 'resolved' : 'open'}` : ''}${lastDiscussionAt ? ` · latest ${esc(formatWebviewDateTime(lastDiscussionAt))}` : ''}</div>` : ''}
        ${commentsHtml}
        ${mrUrl ? `<a href="${mrUrl}" class="link">Open in GitLab &rarr;</a>` : ''}
      </div>
    </div>`;
  }

  let buildHtml = '';
  if (build) {
    const buildStatus = ticketStringField(build, 'status', 'unknown');
    const buildColor = buildStatus === 'SUCCESS' ? '#4caf50' : buildStatus === 'FAILURE' ? '#f44336' : '#ff9800';
    const buildUrl = safeHttpHref(ticketStringField(build, 'url'));
    buildHtml = `<div class="section">
      <h3>Build</h3>
      <div class="build-card" style="border-left-color:${buildColor}">
        <strong>Build #${esc(ticketStringField(build, 'number', '?'))}</strong> — <span style="color:${buildColor}">${esc(buildStatus)}</span>
        ${buildUrl ? `<br><a href="${buildUrl}" class="link">View in Jenkins &rarr;</a>` : ''}
      </div>
    </div>`;
  }

  const jiraUrl = safeHttpHref(ticketStringField(ticket, 'jira_url'));
  const mrActionUrl = mr ? safeHttpHref(ticketStringField(mr, 'url')) : '';
  const buildActionUrl = build ? safeHttpHref(ticketStringField(build, 'url')) : '';
  const isQueued = Boolean(state.queue?.items?.some(item => item.ticket === key));
  const actionButtons = [
    projectList.length > 0
      ? actionButton('startTicket', 'Start Work', { ticket: key, primary: true })
      : actionButton('linkTicket', 'Link Project', { ticket: key, primary: true }),
    isQueued
      ? actionButton('removeFromQueue', 'Remove Queue', { ticket: key })
      : actionButton('addToQueue', 'Add Queue', { ticket: key }),
    actionButton('addEvidence', 'Add Evidence', { ticket: key }),
    actionButton('addEvidenceCheck', 'Add Check', { ticket: key }),
    actionButton('recordEnvironmentResult', 'Record Env', { ticket: key }),
    actionButton('evidenceGate', 'Evidence Gate', { ticket: key }),
    actionButton('evidenceHandoff', 'Handoff', { ticket: key }),
    actionButton('publishEvidence', 'Publish', { ticket: key }),
    actionButton('exportEvidence', 'Export', { ticket: key }),
    jiraUrl ? actionButton('openJira', 'Open Jira', { ticket: key }) : '',
    mrActionUrl ? actionButton('openMr', 'Open MR', { ticket: key }) : '',
    buildActionUrl ? actionButton('openBuild', 'Open Build', { ticket: key }) : '',
  ].filter(Boolean).join('');

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosWebviewBaseCss()}
  .ticket-shell { max-width: 980px; }
  .ticket-header { margin-bottom: 18px; }
  .ticket-header h1 { margin-top: 4px; font-size: 22px; line-height: 1.25; }
  .ticket-header .key { color: var(--k-muted); font-size: 12px; font-weight: 650; text-transform: uppercase; }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; padding: 12px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); }
  .meta-item { min-width: 0; font-size: 13px; word-break: break-word; }
  .meta-item .label { color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; display: block; margin-bottom: 2px; }
  .status-badge { display: inline-flex; align-items: center; min-height: 22px; padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 650; color: white; }
  .section { margin: 20px 0; }
  .section h3 { margin: 0 0 8px 0; color: var(--k-muted); font-size: 11px; font-weight: 650; letter-spacing: 0; text-transform: uppercase; }
  .description { white-space: pre-wrap; word-break: break-word; font-size: 13px; line-height: 1.6; padding: 12px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius); }
  .tag { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11px; margin: 0 4px 4px 0; line-height: 1.2; }
  .tag.project { background: rgba(33, 150, 243, 0.2); color: var(--vscode-textLink-foreground); }
  .tag.label { border-color: var(--k-border); background: var(--k-surface-soft); color: var(--k-muted); }
  .mr-card, .build-card { padding: 12px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); margin: 4px 0; font-size: 13px; background: var(--k-surface-soft); }
  .mr-comments { display: grid; gap: 7px; margin-top: 9px; }
  .mr-comment { padding: 8px 10px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-bg); white-space: pre-wrap; word-break: break-word; }
  .mr-comment-meta { color: var(--k-muted); font-size: 10px; font-weight: 650; margin-bottom: 4px; text-transform: uppercase; }
  .gate { padding: 12px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); font-size: 12px; }
  .gate.pass { border-left-color: #4caf50; }
  .gate.warn { border-left-color: #ff9800; }
  .gate.fail { border-left-color: #f44336; }
  .gate-row { display: flex; gap: 8px; margin: 7px 0 0; align-items: flex-start; }
  .gate-status { display: inline-flex; align-items: center; flex: 0 0 auto; min-height: 20px; border: 1px solid var(--k-border); border-radius: 999px; padding: 2px 8px; font-weight: 650; font-size: 10px; line-height: 1.2; text-transform: uppercase; }
  .gate-status.pass { color: #4caf50; }
  .gate-status.warn { color: #ff9800; }
  .gate-status.fail { color: #f44336; }
  .timeline { border-left: 1px solid var(--k-border); margin-left: 8px; padding-top: 2px; }
  .timeline-event { position: relative; padding: 0 0 14px 18px; font-size: 12px; }
  .timeline-event::before { content: ""; position: absolute; left: -4px; top: 3px; width: 7px; height: 7px; border-radius: 50%; background: var(--vscode-descriptionForeground); }
  .timeline-event.success::before { background: #4caf50; }
  .timeline-event.warning::before { background: #ff9800; }
  .timeline-event.failure::before { background: #f44336; }
  .timeline-title { font-weight: 650; }
  .timeline-meta { color: var(--k-muted); font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
  .timeline-detail { color: var(--k-muted); white-space: pre-wrap; word-break: break-word; line-height: 1.45; }
  .criteria-list, .evidence-list { display: grid; gap: 7px; }
  .criterion { display: flex; gap: 8px; align-items: flex-start; padding: 8px 10px; background: var(--k-surface-soft); border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); font-size: 12px; line-height: 1.45; }
  .criterion.checked { opacity: 0.72; }
  .criterion-box { flex: 0 0 auto; color: var(--vscode-textLink-foreground); }
  .evidence-note { border: 1px solid var(--k-border); border-left: 3px solid var(--k-accent); border-radius: var(--k-radius-sm); padding: 9px 10px; background: var(--k-surface-soft); font-size: 12px; }
  .evidence-check, .environment-result { border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius-sm); padding: 9px 10px; background: var(--k-surface-soft); font-size: 12px; }
  .evidence-check.pass, .environment-result.pass { border-left-color: #4caf50; }
  .evidence-check.warn, .environment-result.warn, .evidence-check.unknown, .environment-result.unknown { border-left-color: #ff9800; }
  .evidence-check.fail, .environment-result.fail { border-left-color: #f44336; }
  .evidence-kind { display: inline-flex; align-items: center; min-height: 20px; margin-right: 8px; font-weight: 650; text-transform: uppercase; font-size: 10px; color: var(--k-muted); }
  .evidence-time { color: var(--k-muted); font-size: 10px; }
  .evidence-command { margin-top: 5px; font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; color: var(--k-muted); white-space: pre-wrap; word-break: break-word; }
  .link { color: var(--k-accent); text-decoration: none; font-size: 12px; }
  .link:hover { text-decoration: underline; }
  .actions { display: flex; gap: 8px; margin: 20px 0; flex-wrap: wrap; }
  .actions .kronos-button { min-height: 30px; }
</style></head><body><div class="kronos-shell ticket-shell">
  <div class="kronos-header ticket-header">
    <div>
      <div class="key">${esc(key)} · ${esc(typeIcon)} · ${esc(priority)}</div>
      <h1 class="kronos-title">${esc(summary)}</h1>
    </div>
  </div>

  <div class="meta">
    <div class="meta-item"><span class="label">Status</span><span class="status-badge" style="background:${statusColor}">${esc(jiraStatus)}</span></div>
    <div class="meta-item"><span class="label">Type</span>${esc(ticketType)}</div>
    <div class="meta-item"><span class="label">Priority</span>${esc(priority)}</div>
    <div class="meta-item"><span class="label">Updated</span>${escapeHtml(formatWebviewDate(ticket.updated))}</div>
  </div>

  ${projs ? `<div class="section"><h3>Linked Projects</h3>${projs}</div>` : ''}
  ${labels ? `<div class="section"><h3>Labels</h3>${labels}</div>` : ''}

  ${description ? `<div class="section"><h3>Description</h3><div class="description">${esc(description)}</div></div>` : ''}

  ${gateHtml}
  ${criteriaHtml}
  ${timelineHtml}
  ${checkHtml}
  ${environmentHtml}
  ${evidenceHtml}
  ${mrHtml}
  ${buildHtml}

  <div class="actions">${actionButtons}</div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Ticket Detail', actionScriptUri) : ''}</body></html>`;
}

function buildTicketGateHtml(gate: EvidenceGateResult): string {
  const rows = gate.checks
    .filter(check => check.status !== 'pass')
    .map(check => `<div class="gate-row">
      <span class="gate-status ${escapeClass(check.status)}">${escapeHtml(check.status)}</span>
      <span>${escapeHtml(check.title)}${check.detail ? ` - ${escapeHtml(check.detail)}` : ''}</span>
    </div>`)
    .join('');
  const body = rows || '<div class="gate-row"><span class="gate-status pass">pass</span><span>No failing or warning checks.</span></div>';
  return `<div class="section"><h3>Evidence Gate</h3><div class="gate ${escapeClass(gate.status)}">
    <div><strong>${escapeHtml(gate.status.toUpperCase())}</strong> - ${escapeHtml(gate.summary)}</div>
    ${body}
  </div></div>`;
}

function buildTicketTimelineHtml(events: TimelineEvent[]): string {
  if (events.length === 0) { return ''; }
  const rows = events.map(event => {
    const at = formatWebviewDateTime(event.at, 'No timestamp');
    const href = safeHttpHref(event.url);
    const link = href ? ` <a href="${href}" class="link">Open</a>` : '';
    const artifact = event.artifactPath ? ` <span class="timeline-artifact">${escapeHtml(event.artifactPath)}</span>` : '';
    return `<div class="timeline-event ${escapeClass(event.severity)}">
      <div class="timeline-meta">${escapeHtml(event.source)} · ${escapeHtml(at)}</div>
      <div class="timeline-title">${escapeHtml(event.title)}${link}</div>
      ${event.detail ? `<div class="timeline-detail">${escapeHtml(event.detail)}${artifact}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="section"><h3>Ticket Timeline</h3><div class="timeline">${rows}</div></div>`;
}

export function deactivate() {}
