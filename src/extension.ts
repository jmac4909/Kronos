import * as vscode from 'vscode';
import { KronosState } from './state/KronosState';
import { ProjectTreeProvider } from './views/ProjectTreeProvider';
import { QueueTreeProvider } from './views/QueueTreeProvider';
import { SessionTreeProvider } from './views/SessionTreeProvider';
import { TaskTreeProvider } from './views/TaskTreeProvider';
import { ReviewTreeProvider, type ReviewSeenKeysStore } from './views/ReviewTreeProvider';
import { TicketTreeProvider } from './views/TicketTreeProvider';
import * as path from 'path';
import * as fs from 'fs';
import type { DiscoveredProject, QueueItem, Ticket } from './state/types';
import type { KronosState as KronosStateSnapshot } from './state/types';
import { dispatchClaudeSession, openInClaude, ensureAuth, cleanupStaleWorktrees, listSavedSessions, listSessionStoreIssues, openSavedSession, getAggregateStats, openRunCenter, listRuns, type DispatchOptions, type KronosRun, type PromptRunMetadata, type RunCenterActionRequest } from './runners/sessionDispatcher';
import { PromptHistoryDiff, createPromptHistorySnapshot, diffPromptHistorySnapshots, latestPromptHistorySnapshot, listPromptHistorySnapshots, listPromptTemplates, repairRequiredPromptTemplates, runPromptSmokeTests } from './services/promptManager';
import { KRONOS_DIR, STATE_AUDIT_FILE, listBackups, listStateAuditEvents, restoreBackup } from './services/stateStore';
import { PlannedAction, buildBacklogTriageReport, overnightCandidatePlans, planByProject, planByRelease, planForMinutes, planNextActions as buildNextActionPlan, planToQueueItem as buildQueueItemFromPlan } from './services/queuePlanner';
import {
  buildQueueDispatchAppendPrompt,
  buildQueueDispatchCollisionTarget,
  buildQueueDispatchExtraPrompt,
  buildQueueDispatchPlan,
  buildQueueDispatchScopeHint,
  queueDispatchMissingProjectMessage,
  queueDispatchNoProjectPathMessage,
} from './services/queueDispatchPlan';
import { actionDisplayLabel as actionToLabel } from './services/actionCatalog';
import { isCodeAction } from './services/actionSemantics';
import { formatDateTimeLabel, formatTimeLabel } from './services/dateLabels';
import { writeEvidenceExport } from './services/evidenceStore';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceString } from './services/evidenceData';
import { EvidenceHandoffPlan, buildEvidenceHandoffPlan } from './services/evidenceHandoff';
import { EvidencePublishDestination, EvidencePublishResult, buildEvidencePublishPlan, publishEvidencePlan, readyPublishDestinations } from './services/evidencePublisher';
import {
  EVIDENCE_CHECK_CONFIDENCE_OPTIONS,
  EVIDENCE_CHECK_ENVIRONMENT_OPTIONS,
  EVIDENCE_CHECK_RESULT_OPTIONS,
  EVIDENCE_ENVIRONMENT_OPTIONS,
  EVIDENCE_ENVIRONMENT_RESULT_OPTIONS,
  EVIDENCE_NOTE_KIND_OPTIONS,
  buildTicketEnvironmentResultInput,
  buildTicketEvidenceCheckInput,
} from './services/evidenceCommandInputs';
import { RUNS_DIR, archiveRun, listRunStoreIssues, markRunCancelled, markRunContinued, markRunNeedsHuman, markRunPaused, readArchivedRuns, runRecordPath, writeRunRecord } from './services/runStore';
import { RecoveryInventory, RecoveryItem, buildRecoveryInventory, resolveRecoveryActionForRequest, type RecoveryInventoryInput } from './services/recoveryCenter';
import { DispatchCollision, detectDispatchCollisions, type DispatchCollisionInput } from './services/collisionDetector';
import { gitlabAdapter, jenkinsAdapter, jiraAdapter, sonarAdapter } from './services/integrationAdapters';
import { buildRunCompletionEvidenceCheck, buildRunCompletionEvidenceText, evaluatePostRunReadiness, postRunReadinessRunPatch, resolvePostRunTicket, shouldRecordRunCompletionEvidence } from './services/postRunReadiness';
import { existingAcceptanceCriterion, extractAcceptanceCriteria } from './services/acceptanceCriteria';
import type { ExistingAcceptanceCriterion } from './services/acceptanceCriteria';
import { buildHumanReviewInbox } from './services/humanReviewInbox';
import { EvidenceGateResult, evaluateEvidenceGate, panelEvidenceGates } from './services/evidenceGate';
import { decideEvidenceHandoff } from './services/evidenceGatePolicy';
import { computeAgentQualityScore } from './services/agentQualityScore';
import { INTEGRATION_MANIFEST_FILE, auditIntegrationManifest, readIntegrationManifest, writeIntegrationManifestSnapshot } from './services/integrationManifest';
import { KronosProfile, listProfiles, resolveDefaultBaseBranch, resolveProfile, sanitizeBranch as sanitizeProfileBranch } from './services/profileManager';
import { AgingThresholds, analyzeAging } from './services/agingAnalyzer';
import { SafetyPlan, assessSafetyGate } from './services/safetyGate';
import { computeTrendMetrics } from './services/trendMetrics';
import {
  TicketFilter,
  TicketGroupBy,
  TICKET_FILTER_PRESETS,
  cleanTicketFilter,
  describeTicketFilter,
  setTicketFilterString,
  ticketFilterChoiceItems,
  ticketFilterFacetValues,
  ticketFilterPromptFields,
} from './services/ticketFilters';
import { buildRunResumePrompt, readRunLogTail } from './services/runRecovery';
import { addTicketEvidenceCheck, addTicketEvidenceNote, addTicketRunCompletionEvidence, extractTicketAcceptanceCriteria, linkMergeRequestToTicket, previewLinkMergeRequestToTicket, reconcileTerminalMergeRequestState, recordTicketEnvironmentResult, updateTicketAcceptanceCriteria, updateTicketBuildStatus, updateTicketMergeRequestStatus } from './services/ticketMutations';
import { addPlanToQueue as addPlanToQueueState, addTicketToQueue, linkTicketToProject, recordPlanQueueDecision, removeTicketFromQueue as removeTicketFromQueueState, reorderQueueItem, selectNextQueueItem, unlinkTicketFromProject } from './services/queueMutations';
import { removeProject as removeProjectFromState, setProjectConfigValue, setProjectIntegrationConfig, setScanDirs, writeProjectSetupConfig } from './services/projectMutations';
import { DoctorCheck, runDoctorChecks as collectDoctorChecks, runDoctorReachabilityChecks as collectDoctorReachabilityChecks } from './services/doctorChecks';
import { checkClaudeModelAccess } from './services/cliProbes';
import { buildCombinedVerificationPlan, buildCombinedVerificationPromptVars } from './services/combinedVerification';
import { buildDiscoveryQuickPickEntries, discoveryCandidateNeedsJiraKey, type DiscoveryQuickPickEntry } from './services/discoveryQuickPick';
import { buildPromptWorkspaceModel, promptHistoryTemplatesForProjects } from './services/promptWorkspaceModel';
import { buildSonarReport } from './services/sonarReportView';
import { buildSonarBranchPickItems, buildSonarFixBranchStrategy, buildSonarFixInstructionBlock } from './services/sonarCommandPlan';
import { buildRegisteredProjectItems, buildTicketGroupProjectItems, buildTicketProjectItems, getProjectNameForPath, getProjectPath, groupTicketsByProject } from './services/projectSelection';
import { buildProjectSetupPrompt, projectSetupConfirmation } from './services/projectSetupPlan';
import { buildAgingReportHtml } from './services/agingReportView';
import { buildTicketHtml } from './services/ticketPanelView';
import { buildDashboardHtml } from './services/dashboardPanelView';
import { buildDiffHtml } from './services/diffPanelView';
import { buildJiraBoardHtml } from './services/jiraBoardPanelView';
import { computeAttentionBadge } from './services/attentionBadge';
import { configIntervalMs, configIntervalSeconds, configIntervalSecondsMs, parsePositiveNumberInput, positiveConfigNumber } from './services/intervalConfig';
import { buildNextActionContext, buildNextActionStartDecision, skillForAction } from './services/nextActionContext';
import { mergeRequestReviewStatusLabel } from './services/mergeRequestLabels';
import { createWorkspaceDiffArtifact, currentGitRef, firstRemoteBranchMatching, originProjectPath } from './services/gitWorkspace';
import { signalProcessTree, stopProcessTree, supportsProcessTreeSuspend } from './services/processTree';
import { createWebviewReadyMonitor } from './services/webviewDiagnostics';
import { WEBVIEW_ACTION_PANEL_SCRIPT, WEBVIEW_JIRA_BOARD_SCRIPT, createWebviewNonce, webviewScriptCspOptions, withWebviewCsp } from './services/webviewSecurity';
import { normalizeBoardMessage, normalizeWebviewCommand } from './services/webviewMessages';
import {
  AGENT_QUALITY_OPERATOR_COMMANDS,
  AGING_REPORT_MESSAGE_COMMANDS,
  BACKLOG_TRIAGE_MESSAGE_COMMANDS,
  BOARD_MESSAGE_COMMANDS,
  DASHBOARD_MESSAGE_COMMANDS,
  DOCTOR_OPERATOR_COMMANDS,
  EVIDENCE_GATE_MESSAGE_COMMANDS,
  EVIDENCE_HANDOFF_OPERATOR_COMMANDS,
  EVIDENCE_PUBLISH_OPERATOR_COMMANDS,
  HUMAN_REVIEW_MESSAGE_COMMANDS,
  INTEGRATION_CONTRACT_MESSAGE_COMMANDS,
  INTEGRATION_MANIFEST_OPERATOR_COMMANDS,
  MR_AUTOPILOT_MESSAGE_COMMANDS,
  PLAN_MESSAGE_COMMANDS,
  PROFILES_OPERATOR_COMMANDS,
  PROMPT_HISTORY_OPERATOR_COMMANDS,
  PROMPT_MANAGER_OPERATOR_COMMANDS,
  PROMPT_SMOKE_OPERATOR_COMMANDS,
  RECOVERY_MESSAGE_COMMANDS,
  SESSION_STATS_OPERATOR_COMMANDS,
  SETUP_WIZARD_MESSAGE_COMMANDS,
  SPEC_BEANSTALK_MESSAGE_COMMANDS,
  STATE_AUDIT_OPERATOR_COMMANDS,
  TICKET_DETAIL_MESSAGE_COMMANDS,
  TREND_METRICS_OPERATOR_COMMANDS,
} from './services/webviewCommandRegistry';
import { isTicketOperatorCommand, resolveOperatorCommandRoute } from './services/operatorCommandRouting';
import { kronosTerminalOptions } from './services/terminalProfiles';
import { unknownErrorMessage } from './services/errorUtils';
import { isKronosScriptMissingError, requiredScripts } from './services/scriptClient';
import { activeRunStatusBarSummary } from './services/activeRunDisplay';
import { isFreshActiveRun } from './services/runStatus';
import { buildRunCompletionNotification } from './services/runCompletionNotification';
import { appendRunWarnings } from './services/runMetadata';
import { LIVE_MR_DIFF_TIMEOUT_MS, loadMrFileHints } from './services/mergeRequestFileHints';
import { countLabel } from './services/countLabels';
import { ticketStringArray } from './services/ticketFields';
import {
  RUN_ACTION_QUICK_PICK_ITEMS,
  STALE_FINISHED_ARCHIVE_HOURS,
  buildRunQuickPickItems,
  isFinishedArchiveRun,
  isStaleFinishedArchiveRun,
  isResumableRun,
  isRetryableRun,
  resolveRunArtifactFile,
  resolveRunWorkspace,
  runProcessPid,
  type RunActionQuickPickItem,
  type RunArtifactPathResult,
} from './services/runActionHelpers';
import { isRecord, optionalTrimmedStringFromUnknown, recordEntriesFromUnknown, recordFromUnknown, recordKeysFromUnknown, recordString } from './services/records';
import {
  explicitProjectName,
  resolveMergeRequestUrl,
  resolveProjectName,
  resolveQueueCommandItem,
  resolveQueueIndex,
  resolveRecoveryFocusId,
  resolveRunId,
  resolveTaskId,
  resolveTicketKey,
  stringFromUnknown,
  ticketProjectNamesForCommand,
} from './services/commandPayloads';
import { openReviewTicketEntries, reviewBranchTickets as buildReviewBranchTickets } from './services/reviewWork';
import { decideReviewMonitorAction, reviewDeployMonitorActionHandled, reviewMergeRequestNotificationKey, reviewTerminalMergeRequestActionKey, type ReviewDeployMonitorResult, type ReviewMonitorDecision, type ReviewTerminalMergeRequestAction } from './services/reviewMonitor';
import { REVIEW_MR_NOTIFICATION_KEYS_STORAGE_KEY, REVIEW_SEEN_KEYS_STORAGE_KEY, normalizeReviewSeenKeys, planNewReviewNotification } from './services/reviewNotifications';
import { decideQueueRemoval } from './services/queueRemovalPolicy';
import { deployMonitorAttentionIssue, deployMonitorHandoffCheckName, hasDeployMonitorHandoffIssue, hasHandledDeployMonitorRun, resolveDeployMonitorProject } from './services/deployMonitorHandoff';
import { actionButton, kronosActionPanelScript, normalizeActionPanelMessage, operatorCommandRow, type ActionPanelMessage } from './services/operatorPanel';
import { buildPromptHistoryHtml, buildPromptManagerHtml, buildPromptSmokeTestsHtml } from './services/promptPanelView';
import { buildRecoveryHtml, buildStateAuditLogHtml } from './services/recoveryPanelView';
import { buildHumanReviewInboxHtml } from './services/humanReviewPanelView';
import { buildEvidenceGateHtml, buildEvidenceHandoffHtml, buildEvidencePublishHtml } from './services/evidencePanelView';
import { buildBacklogTriageHtml, buildCollisionReportHtml, buildProjectBatchPlanHtml, buildQueuePlanModeHtml, buildQueuePlannerHtml, buildReleaseBatchPlanHtml } from './services/queuePlannerPanelView';
import { buildAgentQualityScoreHtml, buildDoctorHtml, buildIntegrationManifestHtml, buildProfilesHtml, buildSessionStatsHtml, buildTrendMetricsHtml } from './services/operationsReportPanelView';
import { buildSpecBeanstalkHtml } from './services/specBeanstalkPanelView';
import { DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR, buildSpecBeanstalkPrompt, inspectSpecBeanstalkProject, runSpecBeanstalkGeneration, type SpecBeanstalkProjectStatus, type SpecBeanstalkSummary } from './services/specBeanstalk';
import { buildSetupWizardPlan } from './services/setupWizard';
import { buildSetupWizardHtml } from './services/setupWizardPanelView';
import { buildMrAutopilotPlan } from './services/mrAutopilot';
import { buildMrAutopilotHtml } from './services/mrAutopilotPanelView';
import { buildIntegrationContractReport } from './services/integrationContractHarness';
import { buildIntegrationContractHtml } from './services/integrationContractPanelView';
import { loadClaudeDotEnv } from './services/claudeEnv';
import {
  VERIFY_LOCAL_MODE_TARGETS,
  buildCustomVerifyLocalBranchTarget,
  buildVerifyLocalBranchTargets,
  buildVerifyLocalEnvironmentTarget,
  buildVerifyLocalPromptText,
  buildVerifyLocalPromptVars,
  buildVerifyRemoteDeploymentTarget,
  normalizeHttpUrl,
  verifyLocalTargetSummary,
  type VerifyLocalBranchTarget,
  type VerifyLocalEnvironmentKind,
  type VerifyLocalEnvironmentTarget,
  type VerifyLocalModeTarget,
  type VerifyLocalPromptTarget,
} from './services/verifyLocalPlan';

let statusBarItem: vscode.StatusBarItem;
let kronosOutputChannel: vscode.OutputChannel | undefined;
let reviewPollStatusEmitter: vscode.EventEmitter<void> | undefined;
interface BadgeTarget {
  badge?: vscode.ViewBadge | undefined;
}

interface ReviewPollResult {
  startedAt: string;
  endedAt: string;
  checked: number;
  changed: number;
  failed: number;
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
const REVIEW_POLL_FAILURE_NOTIFICATION_MS = 15 * 60 * 1000;
const reviewPollFailureNotifications = new Map<string, number>();
const reviewMergeRequestNotifications = new Set<string>();
const reviewTerminalMergeRequestActions = new Set<string>();
let reviewMergeRequestNotificationState: vscode.Memento | undefined;
const OPTIONAL_SCRIPT_PANEL_WARNING = 'Kronos integration scripts are not installed. Run Kronos: Doctor for setup details.';
let lastSpecBeanstalkResult: SpecBeanstalkSummary | undefined;
let lastReviewPollAt: string | undefined;
let lastReviewPollDetail = 'MR polling has not run yet.';

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

function appendKronosLog(message: string, detail?: string): void {
  const line = `[${new Date().toISOString()}] ${message}`;
  if (!kronosOutputChannel) {
    console.info(detail ? `${line}\n${detail}` : line);
    return;
  }
  kronosOutputChannel.appendLine(line);
  if (detail) {
    kronosOutputChannel.appendLine(detail);
  }
}

function describeKronosState(state: KronosState): string {
  const projects = Object.keys(state.state?.projects || {}).length;
  const tickets = Object.keys(state.state?.tickets || {}).length;
  const queue = state.queue?.items?.length || 0;
  return `${countLabel(projects, 'project')}, ${countLabel(tickets, 'ticket')}, ${countLabel(queue, 'queue item')}`;
}

function reviewPollTreeMessage(): string {
  if (!lastReviewPollAt) {
    return lastReviewPollDetail;
  }
  return `Last MR poll ${formatTimeLabel(lastReviewPollAt)} - ${lastReviewPollDetail}`;
}

function recordReviewPollStatus(result: ReviewPollResult): void {
  lastReviewPollAt = result.endedAt;
  lastReviewPollDetail = `${countLabel(result.checked, 'MR')} checked, ${countLabel(result.changed, 'state update')}, ${countLabel(result.failed, 'failure')}`;
  appendKronosLog('Review MR polling finished.', lastReviewPollDetail);
  reviewPollStatusEmitter?.fire();
}

function ensureInitialIntegrationManifest(): void {
  const status = readIntegrationManifest();
  if (status.present) {
    appendKronosLog('Integration manifest found.', status.path);
    return;
  }
  try {
    const result = writeIntegrationManifestSnapshot();
    appendKronosLog('Generated initial integration manifest.', `${result.path}\n${result.audit.summary}`);
  } catch (e: unknown) {
    appendKronosLog('Failed to generate initial integration manifest.', unknownErrorMessage(e, 'Unknown manifest snapshot failure.'));
  }
}

async function runWebviewPanelAction(action: () => Promise<void> | void, fallback: string): Promise<void> {
  try {
    await action();
  } catch (e: unknown) {
    const detail = warnUnexpectedPanelIntegrationError(e, fallback);
    vscode.window.showWarningMessage(detail);
  }
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

type ReviewViewReveal = (ticketKey?: string) => Promise<boolean>;

async function openReviewView(targetTicketKey?: string, revealReviewView?: ReviewViewReveal): Promise<void> {
  const errors: string[] = [];
  let opened = false;
  try {
    await vscode.commands.executeCommand('workbench.view.extension.kronos');
    opened = true;
  } catch (e: unknown) {
    errors.push(unknownErrorMessage(e, 'Could not reveal Kronos activity view.'));
  }
  try {
    await vscode.commands.executeCommand('workbench.views.service.openView', 'kronosReview');
    opened = true;
  } catch (e: unknown) {
    errors.push(unknownErrorMessage(e, 'Could not open Kronos Review view.'));
  }
  if (revealReviewView) {
    try {
      if (await revealReviewView(targetTicketKey)) { return; }
    } catch (e: unknown) {
      errors.push(unknownErrorMessage(e, 'Could not reveal Kronos Review item.'));
    }
  }
  try {
    await vscode.commands.executeCommand('kronosReview.focus');
    if (revealReviewView) {
      try {
        if (await revealReviewView(targetTicketKey)) { return; }
      } catch (e: unknown) {
        errors.push(unknownErrorMessage(e, 'Could not reveal focused Kronos Review item.'));
      }
    }
    return;
  } catch (e: unknown) {
    errors.push(unknownErrorMessage(e, 'Could not focus Kronos Review.'));
  }
  if (opened) { return; }
  try {
    await vscode.commands.executeCommand('workbench.action.focusSideBar');
    return;
  } catch (e: unknown) {
    errors.push(unknownErrorMessage(e, 'Could not focus VS Code sidebar.'));
  }
  console.warn(`Could not focus Kronos Review view. ${errors.join(' ')}`);
  throw new Error(errors[errors.length - 1] || 'Could not focus Kronos Review view.');
}

function notifyNewReviewItems(reviewTree: ReviewTreeProvider, notifiedReviewKeys: Set<string>): void {
  const plan = planNewReviewNotification(reviewTree.getNewReviewItems(), notifiedReviewKeys);
  notifiedReviewKeys.clear();
  for (const key of plan.nextNotifiedKeys) {
    notifiedReviewKeys.add(key);
  }
  if (!plan.message) { return; }
  runNotificationCommandAction(
    vscode.window.showInformationMessage(
      plan.message,
      'Open Review'
    ),
    'Open Review',
    'kronos.openReview',
    'Failed to open Kronos Review.'
  );
}

function reviewSeenKeysStore(globalState: vscode.Memento): ReviewSeenKeysStore {
  return {
    get: () => normalizeReviewSeenKeys(globalState.get<unknown>(REVIEW_SEEN_KEYS_STORAGE_KEY)),
    update: keys => globalState.update(REVIEW_SEEN_KEYS_STORAGE_KEY, normalizeReviewSeenKeys([...keys]) || []),
  };
}

function seedReviewMergeRequestNotifications(globalState: vscode.Memento): void {
  reviewMergeRequestNotificationState = globalState;
  reviewMergeRequestNotifications.clear();
  for (const key of normalizeReviewSeenKeys(globalState.get<unknown>(REVIEW_MR_NOTIFICATION_KEYS_STORAGE_KEY)) || []) {
    reviewMergeRequestNotifications.add(key);
  }
}

function rememberReviewMergeRequestNotification(notificationKey: string): boolean {
  if (reviewMergeRequestNotifications.has(notificationKey)) { return false; }
  reviewMergeRequestNotifications.add(notificationKey);
  const persistedKeys = normalizeReviewSeenKeys([...reviewMergeRequestNotifications]) || [];
  const update = reviewMergeRequestNotificationState?.update(REVIEW_MR_NOTIFICATION_KEYS_STORAGE_KEY, persistedKeys);
  void update?.then(undefined, (e: unknown) => {
    console.warn(unknownErrorMessage(e, 'Failed to persist MR review notification keys.'));
  });
  return true;
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
  const safeIntervalMs = configIntervalMs(intervalMs, 5000);
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

type TargetedVerificationSurface = 'local' | 'remote';

async function startTargetedTicketVerification(
  state: KronosState,
  treeItem: unknown,
  surface: TargetedVerificationSurface,
): Promise<void> {
  const ticketKey = resolveTicketKey(treeItem);
  if (!ticketKey || !state.state) {
    vscode.window.showErrorMessage('No ticket selected.');
    return;
  }
  const ticket = state.state.tickets[ticketKey];
  const projectName = await pickTicketProjectNameForDispatch(
    state,
    treeItem,
    ticketKey,
    surface === 'remote' ? `Verify ${ticketKey} against which remote project?` : `Verify ${ticketKey} locally in which project?`,
  );
  if (!projectName) { return; }
  const projectPath = getProjectPath(state.state?.projects, projectName);
  if (!projectPath) { return; }

  let branch: VerifyLocalBranchTarget | undefined;
  let environment: VerifyLocalEnvironmentTarget | undefined;
  if (surface === 'remote') {
    environment = await pickVerifyLocalEnvironmentTarget(projectName, { remoteOnly: true });
    if (!environment) { return; }
    branch = buildVerifyRemoteDeploymentTarget(environment);
  } else {
    branch = await pickVerifyLocalBranchTarget(state, ticketKey, ticket, projectName, projectPath);
    if (!branch) { return; }
    environment = await pickVerifyLocalEnvironmentTarget(projectName);
    if (!environment) { return; }
  }
  const mode = await pickVerifyLocalModeTarget();
  if (!mode) { return; }
  const target: VerifyLocalPromptTarget = { ticketKey, projectName, branch, environment, mode, ticket };
  const confirm = await vscode.window.showInformationMessage(
    `Start targeted ${surface === 'remote' ? 'verify-remote' : 'verify-local'} for ${verifyLocalTargetSummary(target)}`,
    'Start Verification', 'Cancel'
  );
  if (confirm !== 'Start Verification') { return; }

  const verifyVars = buildVerifyLocalPromptVars(target);
  const verifyPrompt = loadPromptForDispatch(state, 'verify-local', verifyVars, projectPath);
  const promptMetadata: PromptRunMetadata = {
    ...verifyPrompt.metadata,
    verifySurface: surface,
    verifyBranch: branch.branch,
    verifyEnvironment: environment.promptValue,
    verifyMode: mode.mode,
  };
  if (environment.url) { promptMetadata.verifyEnvironmentUrl = environment.url; }
  const trackingHints = verifyVars.VERIFY_TRACKING_HINTS;
  if (trackingHints?.trim()) { promptMetadata.verifyTrackingHints = trackingHints; }
  const dispatchOptions: DispatchOptions = {
    onComplete: refreshAfterDispatch(state, projectName, ticketKey),
    customPrompt: buildVerifyLocalPromptText(verifyPrompt.text, verifyVars),
    promptMetadata,
    projectNameOverride: projectName,
  };
  if (branch.checkout === 'ref') {
    dispatchOptions.parallel = true;
    dispatchOptions.worktreeBranch = branch.ref;
    dispatchOptions.worktreeCheckout = 'ref';
  }

  await startClaudeDispatch(projectPath, 'verify-local', ticketKey, dispatchOptions);
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

function specBeanstalkAnalyzerPath(extensionUri: vscode.Uri): string {
  return vscode.Uri.joinPath(extensionUri, 'resources', 'spec-beanstalk', 'xlsx_to_markdown.py').fsPath;
}

function specBeanstalkProjectStatuses(state: KronosState): SpecBeanstalkProjectStatus[] {
  return Object.entries(state.state?.projects || {})
    .flatMap(([projectName, project]) => {
      const projectPath = project.path;
      return projectPath ? [inspectSpecBeanstalkProject(projectName, projectPath)] : [];
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName));
}

async function pickSpecBeanstalkProject(state: KronosState, placeHolder: string): Promise<{ projectName: string; projectPath: string } | undefined> {
  const projectName = await pickProjectName(state, placeHolder);
  if (!projectName) { return undefined; }
  const projectPath = getProjectPath(state.state?.projects, projectName);
  if (!projectPath) {
    vscode.window.showWarningMessage(`${projectName} has no project path recorded.`);
    return undefined;
  }
  return { projectName, projectPath };
}

async function generateSpecBeanstalkArtifacts(
  state: KronosState,
  extensionUri: vscode.Uri,
  selectedProject?: { projectName: string; projectPath: string },
): Promise<SpecBeanstalkSummary | undefined> {
  const target = selectedProject || await pickSpecBeanstalkProject(state, 'Generate Excel API spec into which Java repo?');
  if (!target) { return undefined; }
  const workbook = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    filters: { 'Excel workbooks': ['xlsx'] },
    openLabel: 'Use Workbook',
    title: 'Select .xlsx API spec workbook',
  });
  const workbookPath = workbook?.[0]?.fsPath;
  if (!workbookPath) { return undefined; }
  const outputDir = await vscode.window.showInputBox({
    prompt: 'Output folder inside the Java repo',
    value: DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR.replace(/\\/g, '/'),
    placeHolder: 'docs/api-spec',
  });
  if (outputDir === undefined) { return undefined; }
  const canGenerate = await confirmSafetyGate({
    operationId: 'kronos.specBeanstalkGenerate',
    title: 'Generate Spec Beanstalk artifacts',
    target: `${target.projectName} / ${outputDir || DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR}`,
    risks: ['repo-write'],
    changes: [
      `Read .xlsx workbook: ${path.basename(workbookPath)}`,
      `Write generated Markdown, sheet files, and JSON trace under ${outputDir || DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR}.`,
      'Preserve workbook formatting metadata as source evidence; do not modify Java code.',
    ],
    confirmationLabel: 'Generate',
  });
  if (!canGenerate) { return undefined; }

  let generated: SpecBeanstalkSummary | undefined;
  await runCommandProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Kronos: Generating Spec Beanstalk artifacts...' },
    async progress => {
      progress.report({ message: 'Parsing workbook with Python analyzer' });
      const generationOptions = {
        projectPath: target.projectPath,
        workbookPath,
        outputDir: outputDir || DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR,
      };
      const configuredPython = vscode.workspace.getConfiguration('kronos').get<string>('pythonPath')?.trim();
      generated = runSpecBeanstalkGeneration(
        specBeanstalkAnalyzerPath(extensionUri),
        configuredPython ? { ...generationOptions, pythonPath: configuredPython } : generationOptions,
      );
    },
    'Failed to generate Spec Beanstalk artifacts.'
  );
  if (!generated) { return undefined; }
  lastSpecBeanstalkResult = generated;
  const action = await vscode.window.showInformationMessage(
    `Generated Spec Beanstalk artifacts: ${generated.sheetCount} sheets, ${generated.cellCount} cells, ${generated.formattedCellCount} formatted cells.`,
    'Open Spec',
    'Start Beanstalk'
  );
  if (action === 'Open Spec') {
    await openTextFileIfExists(generated.absoluteIndexPath, 'Generated Spec Beanstalk index not found.');
  } else if (action === 'Start Beanstalk') {
    await startSpecBeanstalkRun(state, extensionUri, { projectName: target.projectName, projectPath: target.projectPath, summary: generated });
  }
  return generated;
}

async function startSpecBeanstalkRun(
  state: KronosState,
  extensionUri: vscode.Uri,
  selected?: { projectName: string; projectPath: string; summary?: SpecBeanstalkSummary },
): Promise<void> {
  const target = selected || await pickSpecBeanstalkProject(state, 'Start / continue Spec Beanstalk in which Java repo?');
  if (!target) { return; }
  let summary = selected?.summary || inspectSpecBeanstalkProject(target.projectName, target.projectPath).summary;
  if (!summary) {
    const action = await vscode.window.showWarningMessage(
      `${target.projectName} does not have generated Spec Beanstalk artifacts under ${DEFAULT_SPEC_BEANSTALK_OUTPUT_DIR}.`,
      'Generate Spec',
      'Cancel'
    );
    if (action !== 'Generate Spec') { return; }
    summary = await generateSpecBeanstalkArtifacts(state, extensionUri, target);
    if (!summary) { return; }
  }

  const scope = await vscode.window.showInputBox({
    prompt: 'What should Claude implement or continue from the generated spec?',
    placeHolder: 'Leave blank for the next coherent API implementation slice',
  });
  if (scope === undefined) { return; }
  const prompt = buildSpecBeanstalkPrompt(summary, scope);
  const launched = await startClaudeDispatch(target.projectPath, 'spec-beanstalk', undefined, {
    customPrompt: prompt,
    promptMetadata: {
      name: 'spec-beanstalk',
      source: 'custom',
      path: summary.indexPath,
      variables: ['SPEC_INDEX', 'SPEC_TRACE', 'SOURCE_WORKBOOK'],
      providedVariables: [summary.indexPath, summary.tracePath, summary.sourceWorkbook],
    },
    projectNameOverride: target.projectName,
    workspaceCwd: target.projectPath,
    onComplete: refreshAfterDispatch(state, target.projectName),
  });
  if (launched) {
    vscode.window.showInformationMessage(`Started Spec Beanstalk for ${target.projectName}.`);
  }
}

async function openLastOrSelectedSpecBeanstalkIndex(state: KronosState): Promise<void> {
  if (lastSpecBeanstalkResult?.absoluteIndexPath && fs.existsSync(lastSpecBeanstalkResult.absoluteIndexPath)) {
    await openTextFileIfExists(lastSpecBeanstalkResult.absoluteIndexPath, 'Generated Spec Beanstalk index not found.');
    return;
  }
  const candidates = specBeanstalkProjectStatuses(state).filter(project => project.summary?.absoluteIndexPath);
  if (candidates.length === 0) {
    vscode.window.showWarningMessage('No generated Spec Beanstalk index found.');
    return;
  }
  const picks: Array<vscode.QuickPickItem & { project: SpecBeanstalkProjectStatus }> = candidates.map(project => {
    const item: vscode.QuickPickItem & { project: SpecBeanstalkProjectStatus } = { label: project.projectName, project };
    if (project.summary?.sourceWorkbook) { item.description = project.summary.sourceWorkbook; }
    if (project.summary?.indexPath) { item.detail = project.summary.indexPath; }
    return item;
  });
  const picked = candidates.length === 1
    ? candidates[0]
    : await vscode.window.showQuickPick(picks, { placeHolder: 'Open which Spec Beanstalk index?' }).then(item => item?.project);
  if (picked?.summary?.absoluteIndexPath) {
    await openTextFileIfExists(picked.summary.absoluteIndexPath, 'Generated Spec Beanstalk index not found.');
  }
}

function openSpecBeanstalkPanel(state: KronosState, extensionUri: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosSpecBeanstalk', 'Kronos Spec Beanstalk', extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Spec Beanstalk');
  const render = () => {
    logReady.arm();
    panel.webview.html = withWebviewCsp(buildSpecBeanstalkHtml({
      projects: specBeanstalkProjectStatuses(state),
      lastResult: lastSpecBeanstalkResult,
      nonce,
      actionScriptUri,
    }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, SPEC_BEANSTALK_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Spec Beanstalk action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      if (request.command === 'refreshPanel') {
        render();
        return;
      }
      if (request.command === 'generateSpec') {
        await generateSpecBeanstalkArtifacts(state, extensionUri);
        render();
        return;
      }
      if (request.command === 'startBeanstalk') {
        await startSpecBeanstalkRun(state, extensionUri);
        render();
        return;
      }
      if (request.command === 'openGeneratedSpec') {
        await openLastOrSelectedSpecBeanstalkIndex(state);
      }
    }, 'Spec Beanstalk action failed.');
  });
  render();
}

function warnIfRunStillActive(run: KronosRun, action: 'retry' | 'resume'): boolean {
  if (!isFreshActiveRun(run)) { return false; }
  vscode.window.showWarningMessage(`Run ${run.id} is still active. Stop it or let it finish before attempting to ${action}.`);
  return true;
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

async function archiveFinishedRuns(): Promise<void> {
  const runs = listRuns().filter(isFinishedArchiveRun);
  if (runs.length === 0) {
    vscode.window.showInformationMessage('No completed, review-ready, failed, or cancelled Kronos runs to archive.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Archive ${countLabel(runs.length, 'finished run')}? Completed, review-ready, failed, and cancelled runs will move under the run archive. Active, paused, and needs-human runs stay visible.`,
    'Archive Finished',
    'Cancel'
  );
  if (confirm !== 'Archive Finished') { return; }

  const { archived, failed } = archiveFinishedRunRecords(runs);
  if (failed > 0) {
    vscode.window.showWarningMessage(`Archived ${countLabel(archived, 'finished run')}; ${failed} failed. See developer console for details.`);
    return;
  }
  vscode.window.showInformationMessage(`Archived ${countLabel(archived, 'finished run')}.`);
}

function archiveFinishedRunRecords(runs: KronosRun[]): { archived: number; failed: number } {
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
  return { archived, failed };
}

async function promptForStaleRunCenterArchive(now = new Date()): Promise<void> {
  const staleRuns = staleFinishedArchiveRuns(now);
  if (staleRuns.length === 0) { return; }
  const action = await vscode.window.showWarningMessage(
    `Run Center has ${countLabel(staleRuns.length, 'finished run')} older than ${STALE_FINISHED_ARCHIVE_HOURS} hours.`,
    'Archive Stale Runs',
    'Later',
  );
  if (action !== 'Archive Stale Runs') { return; }
  const result = archiveFinishedRunRecords(staleRuns);
  if (result.failed > 0) {
    vscode.window.showWarningMessage(`Archived ${countLabel(result.archived, 'stale run')}; ${result.failed} failed. See developer console for details.`);
    return;
  }
  vscode.window.showInformationMessage(`Archived ${countLabel(result.archived, 'stale run')}.`);
}

function staleFinishedArchiveRuns(now = new Date()): KronosRun[] {
  return listRuns().filter(run => isStaleFinishedArchiveRun(run, now));
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
  const picked = await vscode.window.showQuickPick(buildRunQuickPickItems(runs), { placeHolder });
  return picked?.run;
}

function discoveryQuickPickItem(entry: DiscoveryQuickPickEntry): vscode.QuickPickItem {
  if (entry.separator) {
    return { label: entry.label, kind: vscode.QuickPickItemKind.Separator };
  }
  const item: vscode.QuickPickItem = {
    label: entry.label,
  };
  if (entry.description !== undefined) { item.description = entry.description; }
  if (entry.detail !== undefined) { item.detail = entry.detail; }
  if (entry.picked !== undefined) { item.picked = entry.picked; }
  return item;
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

interface SmokeOpenedPanel {
  viewType: string;
  title: string;
  html: string;
}

interface SmokePanelRecord {
  viewType: string;
  title: string;
  panel: vscode.WebviewPanel;
}

interface KronosFeedbackSmokeApi {
  openedPanels: () => SmokeOpenedPanel[];
}

const smokeOpenedPanels: SmokePanelRecord[] = [];

function isFeedbackSmokeRun(): boolean {
  return process.env['KRONOS_FEEDBACK_SMOKE'] === '1';
}

function recordSmokePanel(viewType: string, title: string, panel: vscode.WebviewPanel): void {
  if (!isFeedbackSmokeRun()) { return; }
  const record = { viewType, title, panel };
  smokeOpenedPanels.push(record);
  panel.onDidDispose(() => {
    const index = smokeOpenedPanels.indexOf(record);
    if (index >= 0) {
      smokeOpenedPanels.splice(index, 1);
    }
  });
}

function feedbackSmokeApi(): { __kronosSmoke?: KronosFeedbackSmokeApi } {
  if (!isFeedbackSmokeRun()) { return {}; }
  return {
    __kronosSmoke: {
      openedPanels: () => smokeOpenedPanels.map(record => ({
        viewType: record.viewType,
        title: record.title,
        html: record.panel.webview.html,
      })),
    },
  };
}

function createKronosActionWebviewPanel(viewType: string, title: string, extensionUri?: vscode.Uri): KronosActionWebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    viewType,
    title,
    vscode.ViewColumn.One,
    kronosScriptableWebviewOptions(extensionUri)
  );
  recordSmokePanel(viewType, title, panel);
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
    onPanelOpened: (panel, viewType, title) => recordSmokePanel(viewType, title, panel),
    onAction: request => executeRunCenterAction(state, request),
  });
  void promptForStaleRunCenterArchive();
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
  }
  await executeRunAction(state, run, request.command);
}

async function executeRunAction(state: KronosState, run: KronosRun, command: string): Promise<void> {
  if (command === 'openRunLog') {
    await openRunArtifactFileIfExists(run.logPath, 'Run log not found.');
  } else if (command === 'openRunPrompt') {
    await openRunArtifactFileIfExists(run.promptPath, 'Run prompt artifact not found.');
  } else if (command === 'openRunRecord') {
    await openRunArtifactFileIfExists(runRecordPath(run.id), 'Run record not found.');
  } else if (command === 'openRunWorkspace') {
    const cwd = run.worktreePath || run.cwd || run.projectPath;
    if (cwd && fs.existsSync(cwd)) {
      const terminal = vscode.window.createTerminal(kronosTerminalOptions({ name: `Kronos ${run.project || run.id}`, cwd }));
      terminal.show();
    } else {
      vscode.window.showWarningMessage('Run workspace no longer exists.');
    }
  } else if (command === 'openRunDiff') {
    await openRunDiffArtifact(run);
  } else if (command === 'markNeedsHuman') {
    await markSelectedRunNeedsHuman(run);
  } else if (command === 'pauseRun') {
    await pauseSelectedRun(run);
  } else if (command === 'continueRun') {
    await continueSelectedRun(run);
  } else if (command === 'cancelRun') {
    await cancelSelectedRun(run);
  } else if (command === 'resumeRun') {
    await resumeSelectedRun(state, run);
  } else if (command === 'retryRun') {
    await retryRunFromPrompt(state, run);
  } else if (command === 'archiveRun') {
    await archiveSelectedRun(run.id);
  }
}

function openTicketExternalUrl(state: KronosState, ticketKey: string, kind: 'jira' | 'mr' | 'build'): void {
  const ticket = state.state?.tickets?.[ticketKey];
  if (!ticket) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  const url = kind === 'jira'
    ? recordString(recordFromUnknown(ticket), 'jira_url')
    : kind === 'mr'
      ? recordString(isRecord(ticket.mr) ? ticket.mr : {}, 'url')
      : recordString(isRecord(ticket.build) ? ticket.build : {}, 'url');
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
  const fields = ticketFilterPromptFields(reviewOnly);
  const picked = await vscode.window.showQuickPick(fields, { placeHolder: `Current: ${describeTicketFilter(currentFilter)}` });
  if (!picked) { return null; }
  if (picked.id === 'clear') {
    return { filter: {}, groupBy: 'none' };
  }

  const filter: TicketFilter = { ...currentFilter };
  let groupBy = currentGroupBy;
  const tickets = recordEntriesFromUnknown(state.state?.tickets).map(([, ticket]) => ticket);

  if (picked.id === 'query') {
    setTicketFilterString(filter, 'query', await promptOptionalText('Ticket search text', filter.query));
  } else if (picked.id === 'project') {
    setTicketFilterString(filter, 'project', await promptOptionalChoice('Project', filter.project, ticketFilterFacetValues('project', tickets, state.state?.projects)));
  } else if (picked.id === 'action') {
    setTicketFilterString(filter, 'action', await promptOptionalChoice('Action status', filter.action, ticketFilterFacetValues('action', tickets, state.state?.projects)));
  } else if (picked.id === 'priority') {
    setTicketFilterString(filter, 'priority', await promptOptionalChoice('Priority', filter.priority, ticketFilterFacetValues('priority', tickets, state.state?.projects)));
  } else if (picked.id === 'label') {
    setTicketFilterString(filter, 'label', await promptOptionalChoice('Label', filter.label, ticketFilterFacetValues('label', tickets, state.state?.projects)));
  } else if (picked.id === 'mrState') {
    setTicketFilterString(filter, 'mrState', await promptOptionalChoice('MR state', filter.mrState, ticketFilterFacetValues('mrState', tickets, state.state?.projects)));
  } else if (picked.id === 'buildStatus') {
    setTicketFilterString(filter, 'buildStatus', await promptOptionalChoice('Build status', filter.buildStatus, ticketFilterFacetValues('buildStatus', tickets, state.state?.projects)));
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
  const options: vscode.QuickPickItem[] = ticketFilterChoiceItems(values, current);
  const picked = await vscode.window.showQuickPick(options, { placeHolder });
  if (!picked) { return current; }
  return picked.label === 'Any' ? undefined : picked.label;
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

function withGoalPrompt(goal: string, prompt: string): string {
  return [`/goal "${goal}"`, prompt.trim()].filter(Boolean).join('\n\n');
}

export function activate(context: vscode.ExtensionContext) {
  smokeOpenedPanels.splice(0, smokeOpenedPanels.length);
  kronosOutputChannel = vscode.window.createOutputChannel('Kronos');
  reviewPollStatusEmitter = new vscode.EventEmitter<void>();
  context.subscriptions.push(kronosOutputChannel, reviewPollStatusEmitter);
  appendKronosLog('Kronos extension activated.');
  const envLoad = loadClaudeDotEnv();
  if (envLoad.error) {
    appendKronosLog('Kronos could not load ~/.claude/.env.', envLoad.error);
    vscode.window.showWarningMessage('Kronos could not load ~/.claude/.env. Doctor and integrations may miss credentials.');
  } else if (envLoad.present) {
    appendKronosLog(
      'Kronos loaded ~/.claude/.env for the extension process.',
      `${envLoad.loaded} value(s) merged, ${envLoad.skippedExisting} existing value(s) preserved, ${envLoad.invalid} invalid line(s) ignored.`,
    );
  }
  const state = new KronosState();

  const projectTree = new ProjectTreeProvider(state);
  const queueTree = new QueueTreeProvider(state);
  const sessionTree = new SessionTreeProvider(state);
  const taskTree = new TaskTreeProvider(state);
  seedReviewMergeRequestNotifications(context.globalState);
  const reviewTree = new ReviewTreeProvider(state, reviewSeenKeysStore(context.globalState));
  let revealReviewView: ReviewViewReveal | undefined;
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
      revealReviewView = async (ticketKey?: string) => {
        const items = reviewTree.getChildren() as Array<vscode.TreeItem & { ticketKey?: string }>;
        const target = ticketKey ? items.find(item => item.ticketKey === ticketKey) : undefined;
        const first = target || items.find(item => Boolean(item.ticketKey));
        if (!first) { return false; }
        await (view as vscode.TreeView<vscode.TreeItem>).reveal(first, { select: true, focus: true, expand: true });
        return true;
      };
      view.message = reviewPollTreeMessage();
      updateReviewBadge();
      context.subscriptions.push(reviewPollStatusEmitter.event(() => {
        view.message = reviewPollTreeMessage();
      }));
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
    state.onDidChange(() => {
      appendKronosLog('Kronos state changed.', describeKronosState(state));
      updateAttentionBadge();
    }),
    state.onDidSessionChange(() => {
      appendKronosLog('Kronos session state changed.', `${countLabel(state.sessions.length, 'active session')}`);
      updateAttentionBadge();
    }),
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
    ensureInitialIntegrationManifest();
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
            `Kronos found ${countLabel(cleanupPreview.results.length, 'tracked worktree')}: ${countLabel(cleanupPreview.removable, 'clean worktree')}, ${countLabel(cleanupPreview.blocked, 'worktree needing review')}.`,
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
          appendKronosLog('Manual Jira/state refresh started.');
          await state.refresh();
          lastRefreshTime = Date.now();
          appendKronosLog('Manual Jira/state refresh finished.', describeKronosState(state));
        },
        'Failed to refresh Kronos projects.'
      );
    }),

    vscode.commands.registerCommand('kronos.pollReviewMergeRequests', async () => {
      if (!getActiveProfile().providers.gitlab) {
        vscode.window.showInformationMessage('MR polling is disabled for the active Kronos profile.');
        return;
      }
      await runCommandProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Kronos: Polling merge requests...' },
        async () => {
          const result = await pollReviewMergeRequests(state);
          recordReviewPollStatus(result);
        },
        'Failed to poll Kronos merge requests.'
      );
    }),

    vscode.commands.registerCommand('kronos.openReview', async (target: unknown) => {
      const targetTicketKey = resolveTicketKey(target) || optionalTrimmedStringFromUnknown(target);
      await openReviewView(targetTicketKey, revealReviewView);
    }),

    vscode.commands.registerCommand('kronos.openExternalUrl', async (url: string) => {
      openExternalHttpUrl(String(url || ''));
    }),

    vscode.commands.registerCommand('kronos.refreshProject', async (item: unknown) => {
      const projectName = resolveProjectName(state, item) || await pickProjectName(state, 'Refresh which Kronos project?');
      if (projectName) {
        appendKronosLog(`Manual project refresh started for ${projectName}.`);
        await state.refresh(projectName);
        lastRefreshTime = Date.now();
        appendKronosLog(`Manual project refresh finished for ${projectName}.`, describeKronosState(state));
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

            const items = buildDiscoveryQuickPickEntries(candidates).map(discoveryQuickPickItem);

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

                  if (discoveryCandidateNeedsJiraKey(candidate)) {
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
              vscode.window.showInformationMessage(`Registered ${countLabel(registered, 'project')}. Run Refresh to pull tickets.`);
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

      const projects = ticketStringArray(ticket.projects);
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
        const projectPath = getProjectPath(state.state?.projects, projName);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
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
        const projs = ticketStringArray(item.projects);
        const projLabel = projs.join(', ') || 'unlinked';
        if (item.action === 'refresh') {
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const p of projs) { await state.refresh(p); }
        } else if (projs.length > 0) {
          const dispatchPlan = buildQueueDispatchPlan({
            projects: projs,
            resolveProjectPath: projectName => getProjectPath(state.state?.projects, projectName),
          });
          if (dispatchPlan.missingProjects.length > 0) {
            vscode.window.showWarningMessage(queueDispatchMissingProjectMessage({ target: item.ticket || item.id, missingProjects: dispatchPlan.missingProjects }));
            return;
          }
          if (dispatchPlan.dispatchTargets.length === 0) {
            vscode.window.showWarningMessage(queueDispatchNoProjectPathMessage(item.ticket));
            return;
          }
          const canStart = await confirmDispatchCollisions(state, buildQueueDispatchCollisionTarget({
            ticket: item.ticket,
            projects: projs,
            action: item.action,
            id: item.id,
          }), context.extensionUri);
          if (!canStart) { return; }
          vscode.window.showInformationMessage(`Starting: [${item.action}] ${projLabel}/${item.ticket || 'refresh'}`);
          for (const target of dispatchPlan.dispatchTargets) {
            const skill = skillForAction(item.action);
            const codeAction = isCodeAction(item.action);
            const ticketKey = item.ticket || undefined;
            const dispatchOptions: DispatchOptions = {
              onComplete: refreshAfterDispatch(state, target.projectName, ticketKey),
              parallel: codeAction,
            };
            if (target.projectName) { dispatchOptions.projectNameOverride = target.projectName; }
            const appendSystemPrompt = buildQueueDispatchAppendPrompt({ codeAction, implementPrompt: codeAction ? getImplementPrompt(state) : '' });
            if (appendSystemPrompt) { dispatchOptions.appendSystemPrompt = appendSystemPrompt; }
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
      if (projectPath) {
        openInClaude(projectPath);
      }
    }),

    vscode.commands.registerCommand('kronos.jiraBoard', async () => {
      const panel = vscode.window.createWebviewPanel(
        'kronosJiraBoard', 'Kronos: Jira Board',
        vscode.ViewColumn.One, kronosScriptableWebviewOptions(context.extensionUri)
      );
      recordSmokePanel('kronosJiraBoard', 'Kronos: Jira Board', panel);
      const nonce = createWebviewNonce();
      const logReady = createWebviewReadyMonitor(panel, 'Kronos Jira Board');
      const renderBoard = () => {
        const scriptUri = kronosJiraBoardScriptUri(panel, context.extensionUri);
        logReady.arm();
        panel.webview.html = withWebviewCsp(buildJiraBoardHtml({
          state: state.state,
          queue: state.queue,
          nonce,
          scriptUri,
        }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
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
        const request = normalizeBoardMessage(msg, BOARD_MESSAGE_COMMANDS);
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
      const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosTicket', `${ticketKey}: Ticket`, context.extensionUri);
      const logReady = createWebviewReadyMonitor(panel, `${ticketKey}: Ticket`);
      const render = () => {
        const freshTicket = state.state?.tickets?.[ticketKey];
        if (!freshTicket) {
          panel.webview.html = withWebviewCsp(`<!DOCTYPE html><html><body><div class="kronos-empty">Ticket not found.</div></body></html>`);
          return;
        }
        panel.title = `${ticketKey}: ${freshTicket.summary}`;
        logReady.arm();
        panel.webview.html = withWebviewCsp(buildTicketHtml(ticketKey, freshTicket, {
          queue: state.queue,
          runs: listRuns(),
          nonce,
          actionScriptUri,
        }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
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
        EVIDENCE_NOTE_KIND_OPTIONS,
        { placeHolder: `Evidence type for ${ticketKey}` }
      );
      if (!kind) { return; }

      const text = await vscode.window.showInputBox({
        prompt: `Evidence for ${ticketKey}`,
        placeHolder: 'e.g., npm test passed locally; Sonar gate is green; QA risk remains around OAuth timeout',
        ignoreFocusOut: true,
      });
      if (!text?.trim()) { return; }

      try {
        addTicketEvidenceNote(ticketKey, { kind: kind.label, text: text.trim() });
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
        EVIDENCE_CHECK_RESULT_OPTIONS,
        { placeHolder: `Result for ${name.trim()}` }
      );
      if (!result) { return; }

      const environment = await vscode.window.showQuickPick(
        EVIDENCE_CHECK_ENVIRONMENT_OPTIONS,
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
        EVIDENCE_CHECK_CONFIDENCE_OPTIONS,
        { placeHolder: 'Confidence level' }
      );
      if (!confidence) { return; }

      try {
        addTicketEvidenceCheck(ticketKey, buildTicketEvidenceCheckInput({
          name,
          result: result.label,
          environment: environment.label,
          command,
          summary,
          artifactPath: artifact,
          confidence: confidence.label,
        }));
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
        EVIDENCE_ENVIRONMENT_OPTIONS,
        { placeHolder: `Environment result for ${ticketKey}` }
      );
      if (!environment) { return; }
      const status = await vscode.window.showQuickPick(
        EVIDENCE_ENVIRONMENT_RESULT_OPTIONS,
        { placeHolder: `Status for ${environment.label}` }
      );
      if (!status) { return; }
      const detail = await vscode.window.showInputBox({
        prompt: `${environment.label} result detail`,
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
        recordTicketEnvironmentResult(ticketKey, buildTicketEnvironmentResultInput({
          environment: environment.label,
          status: status.label,
          detail,
          artifactPath: artifact,
        }));
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Recorded ${environment.label} ${status.label} result for ${ticketKey}.`);
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
        try {
          const result = extractTicketAcceptanceCriteria(ticketKey, { replaceExisting: false });
          if (result.changed) {
            state.reloadAndNotify();
          }
        } catch (e: unknown) {
          vscode.window.showErrorMessage(unknownErrorMessage(e, 'Failed to update acceptance criteria status.'));
          return;
        }
        vscode.window.showWarningMessage(`${ticketKey} has no obvious acceptance criteria in its description.`);
        return;
      }

      const existingCount = existingCriteria.length;
      if (existingCount > 0) {
        const confirm = await vscode.window.showWarningMessage(
          `${ticketKey} already has ${countLabel(existingCount, 'acceptance criterion item')}. Replace with ${countLabel(extracted.length, 'extracted item')}? Existing checked state is preserved when text matches.`,
          'Replace',
          'Cancel'
        );
        if (confirm !== 'Replace') { return; }
      }

      try {
        const result = extractTicketAcceptanceCriteria(ticketKey, { replaceExisting: true });
        state.reloadAndNotify();
        vscode.window.showInformationMessage(`Extracted ${countLabel(result.criteriaCount, 'acceptance criterion item')} for ${ticketKey}.`);
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
        vscode.window.showInformationMessage(`Updated ${countLabel(picked.length, 'checked acceptance criterion item')} out of ${countLabel(criteria.length, 'acceptance criterion item')} for ${ticketKey}.`);
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
        vscode.window.showInformationMessage(`Removed ${name}. Unlinked ${countLabel(result.ticketsUnlinked.length, 'ticket')} and kept it in discovered repos.`);
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
            projectSetupConfirmation(projectName),
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

            const setupPrompt = buildProjectSetupPrompt({
              projectName,
              projectPath,
              gitlabProjectId: gitlabId,
              sonarProjectKey: sonarKey,
            });

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

      const dispatchPlan = buildQueueDispatchPlan({
        projects: queueData.projects,
        projectPath: queueData.projectPath,
        pathProject: getProjectNameForPath(state.state?.projects, queueData.projectPath),
        resolveProjectPath: projectName => getProjectPath(state.state?.projects, projectName),
      });
      const projs = dispatchPlan.projects;
      const projLabel = dispatchPlan.projectLabel;

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

      if (projs.length === 0 && !dispatchPlan.directProjectPath) {
        vscode.window.showWarningMessage(`${queueData.ticket} is not linked to any project.`);
        return;
      }

      if (dispatchPlan.missingProjects.length > 0) {
        vscode.window.showWarningMessage(queueDispatchMissingProjectMessage({ target: queueData.ticket || queueData.id, missingProjects: dispatchPlan.missingProjects }));
        return;
      }
      if (dispatchPlan.dispatchTargets.length === 0) {
        vscode.window.showWarningMessage(queueDispatchNoProjectPathMessage(queueData.ticket));
        return;
      }

      const collisionTarget = buildQueueDispatchCollisionTarget({
        ticket: queueData.ticket,
        id: queueData.id,
        projects: projs,
        action: queueData.action,
      });
      const canStart = await confirmDispatchCollisions(state, collisionTarget, context.extensionUri);
      if (!canStart) { return; }

      const actionLabel = actionToLabel(queueData.action);
      const extra = await vscode.window.showInputBox({
        prompt: `Starting [${actionLabel}] on ${projLabel}/${queueData.ticket || ''}. Any additional context? (leave empty to just start)`,
        placeHolder: 'e.g., focus on the auth flow, skip UI changes',
      });
      if (extra === undefined) { return; }
      const extraPrompt = buildQueueDispatchExtraPrompt(extra);

      for (const target of dispatchPlan.dispatchTargets) {
        const scopeHint = buildQueueDispatchScopeHint(target, projs);
        const dispatchOptions: DispatchOptions = {
          onComplete: refreshAfterDispatch(state, target.projectName, queueData.ticket),
          parallel: codeAction,
        };
        if (target.projectName) { dispatchOptions.projectNameOverride = target.projectName; }
        const appendSystemPrompt = buildQueueDispatchAppendPrompt({ codeAction, implementPrompt: codeAction ? getImplementPrompt(state) : '', scopeHint, extraPrompt });
        if (appendSystemPrompt) { dispatchOptions.appendSystemPrompt = appendSystemPrompt; }
        await startClaudeDispatch(target.projectPath, skill, queueData.ticket || undefined, dispatchOptions);
      }
    }),

    vscode.commands.registerCommand('kronos.openDashboard', async () => {
      try {
        const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosDashboard', 'Kronos Dashboard', context.extensionUri);
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
          panel.webview.html = withWebviewCsp(buildDashboardHtml({
            state: state.state,
            queue: state.queue,
            runs: listRuns(),
            plans: planNextActions(state),
            brief: data,
            trendWindowDays: trendWindowDaysFromConfig(),
            agingThresholds: agingThresholdsFromConfig(),
            setupPlan: currentSetupWizardPlan(state),
            integrationContractReport: currentIntegrationContractReport(),
            specProjects: specBeanstalkProjectStatuses(state),
            nonce,
            loadWarning,
            actionScriptUri,
          }), webviewScriptCspOptions(panel.webview.cspSource, nonce));
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

    vscode.commands.registerCommand('kronos.setupWizard', async () => {
      openSetupWizardPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.mrAutopilot', async () => {
      openMrAutopilotPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.specBeanstalk', async () => {
      openSpecBeanstalkPanel(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.specBeanstalkGenerate', async () => {
      await generateSpecBeanstalkArtifacts(state, context.extensionUri);
    }),

    vscode.commands.registerCommand('kronos.specBeanstalkStart', async () => {
      await startSpecBeanstalkRun(state, context.extensionUri);
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
      await startTargetedTicketVerification(state, treeItem, 'local');
    }),

    vscode.commands.registerCommand('kronos.verifyRemote', async (treeItem: unknown) => {
      await startTargetedTicketVerification(state, treeItem, 'remote');
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
      if (!projectPath) { return; }

      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;
      const baseBranch = getProjectBaseBranch(state, projectName);

      const mode = await vscode.window.showQuickPick(
        [
          { label: `New scan (${baseBranch})`, description: `Checkout ${baseBranch}, pull latest, scan`, value: 'new' },
          { label: 'Pull latest & rescan', description: 'Use an isolated worktree for the current branch, pull latest, rescan', value: 'pull' },
        ],
        { placeHolder: 'SonarQube scan mode' }
      );
      if (!mode) { return; }

      const commandArg = recordFromUnknown(item);
      const branch = mode.value === 'new'
        ? (stringFromUnknown(commandArg['branch']) || baseBranch)
        : (currentGitRef(projectPath) || baseBranch);
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
        parallel: true,
        worktreeBranch: remoteBranchRef(branch),
        worktreeCheckout: 'ref',
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
        branchItems = buildSonarBranchPickItems(branchesData.branches, baseBranch);
      } catch (e: unknown) {
        const detail = unknownErrorMessage(e, 'Could not load SonarQube branches.');
        console.warn(detail);
        branchItems = buildSonarBranchPickItems([], baseBranch, detail);
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
        const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('sonarReport', `Sonar: ${projectName}`, context.extensionUri);
        const reportInput = {
          projectName,
          branch,
          sonarKey,
          gate,
          measures,
          issues,
          nonce,
          actionScriptUri,
        };
        if (process.env['SONAR_HOST_URL']) { Object.assign(reportInput, { host: process.env['SONAR_HOST_URL'] }); }
        const report = buildSonarReport(reportInput);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
      if (!projectPath) { return; }
      const sonarKey = state.state.projects[projectName]?.config?.sonar_project_key || projectName;

      const customInstructions = await vscode.window.showInputBox({
        placeHolder: 'e.g. suppress S107 on PasProviderValidationServiceImpl, skip S1192',
        prompt: 'Custom instructions: "suppress" = add @SuppressWarnings, "skip" = don\'t touch, blank = fix all',
      });
      if (customInstructions === undefined) { return; }

      const commandArg = recordFromUnknown(item);
      const sourceBranch = stringFromUnknown(commandArg['sourceBranch']) || '';
      const sonarSourceBranch = sourceBranch || getProjectBaseBranch(state, projectName);
      const isProtected = !sourceBranch || sourceBranch === 'develop' || sourceBranch === 'main' || sourceBranch === 'master';
      const branchStrategy = buildSonarFixBranchStrategy(projectName, sonarSourceBranch);
      const instructionBlock = buildSonarFixInstructionBlock({
        customInstructions,
        branchStrategy,
        issuesData: commandArg['issuesData'],
      });

      const safetyPlan: SafetyPlan = {
        operationId: 'kronos.fixSonarIssues',
        title: 'Fix SonarQube Issues',
        target: `${projectName}${sourceBranch ? ` / ${sourceBranch}` : ''}`,
        risks: ['repo-write', 'external-publish'],
        changes: [
          isProtected
            ? `Create a new bugfix/sonar-${projectName.toLowerCase()} branch from ${sonarSourceBranch}.`
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
        customPrompt: withGoalPrompt('SonarQube quality gate passes', fixPrompt.text),
        promptMetadata: fixPrompt.metadata,
        appendSystemPrompt: getImplementPrompt(state),
        parallel: true,
        worktreeBranch: remoteBranchRef(sonarSourceBranch),
        worktreeCheckout: isProtected ? 'ref' : 'branch',
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
          customPrompt: withGoalPrompt('SonarQube quality gate passes', prompt.text),
          promptMetadata: prompt.metadata,
          parallel: true,
          worktreeCheckout: 'branch',
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
      const projectPath = stringFromUnknown(commandArg['projectPath']) || getProjectPath(state.state?.projects, projectName);
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
        const projects = recordKeysFromUnknown(state.state?.projects);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
      if (!projectPath) { return; }

      const reviewTickets = recordEntriesFromUnknown(state.state?.tickets)
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
        parallel: true,
        worktreeBranch: remoteBranchRef(getProjectBaseBranch(state, projectName)),
        worktreeCheckout: 'ref',
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
          `Dispatch TEST verification for ${countLabel(tickets.length, 'merged ticket')}.`,
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
        parallel: true,
        worktreeBranch: remoteBranchRef(getProjectBaseBranch(state, projectName)),
        worktreeCheckout: 'ref',
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
        parallel: true,
        worktreeBranch: remoteBranchRef(getProjectBaseBranch(state, projectName)),
        worktreeCheckout: 'ref',
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
        parallel: true,
        worktreeBranch: remoteBranchRef(getProjectBaseBranch(state, projectName)),
        worktreeCheckout: 'ref',
      });
    }),

    vscode.commands.registerCommand('kronos.rejectReview', async (treeItem: unknown) => {
      const ticketKey = resolveTicketKey(treeItem);
      if (!ticketKey || !state.state) { return; }
      const ticket = state.state.tickets[ticketKey];
      const projs = ticketStringArray(ticket?.projects);
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
      const projectPath = getProjectPath(state.state?.projects, projectName);
      if (!projectPath) { return; }

      const feedback = await vscode.window.showInputBox({
        prompt: `What's missing or wrong with ${ticketKey}? (Claude will continue on the existing branch)`,
        placeHolder: 'e.g., missing migration file, service layer not updated, AC #1 and #5 not met',
      });
      if (!feedback) { return; }

      let branch = ticket?.mr ? `${ticketKey}` : undefined;
      if (ticket?.mr) {
        try {
          branch = await gitlabAdapter.mergeRequestBranch(state, ticketKey);
        } catch (e: unknown) {
          console.warn(unknownErrorMessage(e, `Could not resolve MR branch for ${ticketKey}.`));
        }
      }
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

      const dispatchOptions: DispatchOptions = {
        onComplete: refreshAfterDispatch(state, projectName, ticketKey),
        customPrompt: continuePrompt.text,
        promptMetadata: continuePrompt.metadata,
        appendSystemPrompt: getImplementPrompt(state),
        parallel: true,
        worktreeCheckout: 'branch',
      };
      if (branch) { dispatchOptions.worktreeBranch = remoteBranchRef(branch); }
      await startClaudeDispatch(projectPath, 'implement', ticketKey, dispatchOptions);
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
      const current = ticketStringArray(state.state.tickets[ticketKey]?.projects);
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
          vscode.window.showWarningMessage(`No readable saved sessions. Kronos found ${countLabel(issues.length, 'saved session store issue')}. Run Kronos: Doctor.`);
        } else {
          vscode.window.showInformationMessage('No saved sessions yet.');
        }
        return;
      }
      const items = sessions.map(s => {
        const isDone = s.events.some(e => e.type === 'done');
        const icon = isDone ? '$(check)' : '$(error)';
        return {
          label: `${icon} ${s.project} — ${s.skill} ${s.ticket}`,
          description: formatDateTimeLabel(s.startedAt, 'Unknown'),
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
      const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosStats', 'Kronos: Session Stats', context.extensionUri);
      attachOperatorCommandHandler(panel, 'Kronos Session Stats', SESSION_STATS_OPERATOR_COMMANDS);
      panel.webview.html = withWebviewCsp(buildSessionStatsHtml(stats, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
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

      const action = await vscode.window.showQuickPick<RunActionQuickPickItem>(
        RUN_ACTION_QUICK_PICK_ITEMS,
        { placeHolder: `Inspect ${run.project} - ${run.skill}${run.ticket ? ` ${run.ticket}` : ''}` }
      );
      if (!action) { return; }
      await executeRunAction(state, run, action.runCommand);
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

    vscode.commands.registerCommand('kronos.integrationContractReport', async () => {
      openIntegrationContractPanel(context.extensionUri);
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
          `Remove ${countLabel(preview.removable, 'clean tracked Kronos worktree')}.`,
          'Untrack missing worktrees from Kronos metadata.',
          `Leave ${countLabel(preview.blocked, 'blocked worktree')} untouched for manual review.`,
        ],
        warnings: ['Only the dry-run removable set will be cleaned. Dirty worktrees are not removed.'],
        confirmationLabel: 'Remove Clean Worktrees',
      });
      if (!canClean) { return; }
      const cleaned = cleanupStaleWorktrees({ remove: true });
      vscode.window.showInformationMessage(`Removed ${countLabel(cleaned.removed, 'worktree')}. ${countLabel(cleaned.blocked, 'blocked worktree')} still ${cleaned.blocked === 1 ? 'needs' : 'need'} manual review.`);
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

  return feedbackSmokeApi();
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
      if (val !== undefined) {
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
  const model = buildPromptWorkspaceModel(state.state?.projects || {});
  const smokeResults = runPromptSmokeTests(model.smokeTests);

  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptManager', 'Kronos Prompt Manager', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptManagerHtml(model.globalTemplates, model.projectOverrides, smokeResults, REQUIRED_PROMPTS, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt Manager', PROMPT_MANAGER_OPERATOR_COMMANDS);
}

function openPromptSmokeTestsPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const results = runPromptSmokeTests(buildPromptWorkspaceModel(state.state?.projects || {}).smokeTests);
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosPromptSmokeTests', 'Kronos Prompt Smoke Tests', extensionUri);
  panel.webview.html = withWebviewCsp(buildPromptSmokeTestsHtml(results, nonce, actionScriptUri), webviewScriptCspOptions(panel.webview.cspSource, nonce));
  attachOperatorCommandHandler(panel, 'Kronos Prompt Smoke Tests', PROMPT_SMOKE_OPERATOR_COMMANDS);
}

function snapshotPromptPack(state: KronosState, extensionUri?: vscode.Uri): void {
  const templates = promptHistoryTemplatesForProjects(state.state?.projects || {});
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
      `Create ${countLabel(missing.length, 'missing required prompt template file')}.`,
      'Leave existing prompt templates untouched.',
      'Generated templates are starter prompts that should be reviewed before production use.',
    ],
    warnings: ['This does not install external scripts or credentials.'],
    confirmationLabel: 'Create Missing Prompts',
  });
  if (!canRepair) { return; }
  const result = repairRequiredPromptTemplates(REQUIRED_PROMPTS);
  const action = await vscode.window.showInformationMessage(
    `Created ${countLabel(result.created.length, 'prompt template')}. ${countLabel(result.existing.length, 'prompt template')} already existed.`,
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosRecoveryCenter', 'Kronos Recovery Center', extensionUri);
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
    if (request.command === 'archiveFinishedRuns') {
      await runWebviewPanelAction(async () => {
        await archiveFinishedRuns();
        render(true);
      }, 'Kronos recovery archive action failed.');
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
  const action = resolveRecoveryActionForRequest(item, requestedAction);
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

async function pickAndRestoreBackup(state: KronosState, backups = listBackups(), preferredBackupPath?: string): Promise<void> {
  if (backups.length === 0) {
    vscode.window.showInformationMessage('No Kronos state backups found.');
    return;
  }

  const choices = backups.map(backup => ({
    label: `${backup.targetName} - ${formatDateTimeLabel(backup.createdAt)}`,
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
      `Restore ${picked.backup.targetName} from ${formatDateTimeLabel(picked.backup.createdAt)}.`,
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosHumanReviewInbox', 'Kronos Human Review Inbox', extensionUri);
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
  const projects = ticketStringArray(ticket.projects);
  if (projects.length === 0) {
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
    projects,
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosEvidenceGate', title, options.extensionUri);
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
  return panelEvidenceGates(state.state?.tickets);
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
  const route = resolveOperatorCommandRoute({ command, ticketKey, runId, itemId });
  if (route.kind === 'unknown') {
    vscode.window.showWarningMessage('Ignored unknown Kronos operator action.');
    return;
  }
  if (route.kind === 'missingTicket') {
    vscode.window.showWarningMessage('This Kronos action needs a ticket context.');
    return;
  }
  if (route.argument) {
    await vscode.commands.executeCommand(route.commandId, route.argument);
    return;
  }
  await vscode.commands.executeCommand(route.commandId);
}

async function tryExecuteTicketOperatorCommand(command: string, ticketKey: string): Promise<boolean> {
  if (!isTicketOperatorCommand(command)) {
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
      () => executeOperatorCommandAction(request.command, request.ticket, request.runId, request.itemId),
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosBacklogTriage', 'Kronos Backlog Triage', extensionUri);
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosCollisionReport', 'Kronos Collision Report', extensionUri);
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
          `${countLabel(planWindow.plans.length, 'action')}, estimated ${planWindow.estimatedMinutes} minutes`,
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
          countLabel(plans.length, 'linked implementation/build candidate'),
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
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosAgingReport', 'Kronos Aging Report', extensionUri);
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

function openSetupWizardPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosSetupWizard', 'Kronos Setup Wizard', extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Setup Wizard');
  const render = () => {
    logReady.arm();
    panel.webview.html = withWebviewCsp(
      buildSetupWizardHtml(currentSetupWizardPlan(state), nonce, actionScriptUri),
      webviewScriptCspOptions(panel.webview.cspSource, nonce),
    );
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, SETUP_WIZARD_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos setup wizard action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      if (request.command === 'refreshPanel') {
        state.reloadAndNotify();
        render();
        return;
      }
      await executeOperatorCommandAction(request.command);
      render();
    }, 'Kronos setup wizard action failed.');
  });
  render();
}

function openMrAutopilotPanel(state: KronosState, extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosMrAutopilot', 'Kronos MR Autopilot', extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos MR Autopilot');
  const render = () => {
    logReady.arm();
    panel.webview.html = withWebviewCsp(
      buildMrAutopilotHtml(buildMrAutopilotPlan({ state: state.state, queue: state.queue, runs: listRuns() }), nonce, actionScriptUri),
      webviewScriptCspOptions(panel.webview.cspSource, nonce),
    );
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, MR_AUTOPILOT_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos MR Autopilot action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      await executeMrAutopilotAction(state, request, extensionUri);
      render();
    }, 'Kronos MR Autopilot action failed.');
  });
  render();
  startActiveRunPanelRefresh(panel, state, render);
}

function openIntegrationContractPanel(extensionUri?: vscode.Uri): void {
  const { panel, nonce, actionScriptUri } = createKronosActionWebviewPanel('kronosIntegrationContracts', 'Kronos Integration Contracts', extensionUri);
  const logReady = createWebviewReadyMonitor(panel, 'Kronos Integration Contracts');
  const render = () => {
    logReady.arm();
    panel.webview.html = withWebviewCsp(
      buildIntegrationContractHtml(currentIntegrationContractReport(), nonce, actionScriptUri),
      webviewScriptCspOptions(panel.webview.cspSource, nonce),
    );
  };
  panel.webview.onDidReceiveMessage(async msg => {
    if (logReady(msg)) { return; }
    const request = normalizeActionPanelMessage(msg, INTEGRATION_CONTRACT_MESSAGE_COMMANDS);
    if (!request) {
      vscode.window.showWarningMessage('Ignored invalid Kronos integration contract action.');
      return;
    }
    await runWebviewPanelAction(async () => {
      if (request.command === 'refreshPanel') {
        render();
        return;
      }
      await executeOperatorCommandAction(request.command);
      render();
    }, 'Kronos integration contract action failed.');
  });
  render();
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

function currentSetupWizardPlan(state: KronosState) {
  const manifestStatus = readIntegrationManifest();
  return buildSetupWizardPlan({
    state: state.state,
    queue: state.queue,
    profile: getActiveProfile(),
    doctorChecks: runDoctorChecks(state),
    manifestStatus,
    manifestAudit: auditIntegrationManifest(manifestStatus),
    scripts: requiredScripts(),
  });
}

function currentIntegrationContractReport() {
  return buildIntegrationContractReport({
    contractDocText: readPackagedIntegrationContract(),
    scripts: requiredScripts(),
  });
}

function readPackagedIntegrationContract(): string {
  const contractPath = path.join(__dirname, '..', 'docs', 'integration-script-contract.md');
  try {
    return fs.readFileSync(contractPath, 'utf8');
  } catch {
    return '';
  }
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
    resolveProjectPath: projectName => getProjectPath(state.state?.projects, projectName),
  }, plan);
}

function refreshAfterDispatch(state: KronosState, projectName?: string, ticketKey?: string): (code: number, run: KronosRun) => Promise<void> {
  return async (_code: number, run: KronosRun) => {
    let resolvedTicketKey = resolveDispatchTicketKey(ticketKey, run);
    const refreshWarning = await reloadStateAfterDispatch(state, projectName);
    if (refreshWarning) {
      run.warnings = appendRunWarnings(run.warnings, [refreshWarning]);
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
  return [optionalTrimmedStringFromUnknown(ticketKey), optionalTrimmedStringFromUnknown(run.ticket)].find(Boolean);
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

function remoteBranchRef(branch: string): string {
  const safeBranch = sanitizeBranchName(branch.replace(/^origin\//, ''));
  return `origin/${safeBranch}`;
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
    buildTicketProjectItems(projects, state.state?.projects),
    { placeHolder },
  );
  return picked?.label;
}

interface VerifyLocalBranchQuickPickItem extends vscode.QuickPickItem {
  target?: VerifyLocalBranchTarget;
  custom?: boolean;
}

async function pickVerifyLocalBranchTarget(
  state: KronosState,
  ticketKey: string,
  ticket: Ticket | undefined,
  projectName: string,
  projectPath: string,
): Promise<VerifyLocalBranchTarget | undefined> {
  const currentBranch = currentGitRef(projectPath);
  const targets = buildVerifyLocalBranchTargets({
    ticketKey,
    ticket,
    defaultBranch: getProjectBaseBranch(state, projectName),
    currentBranch,
  });
  const items: VerifyLocalBranchQuickPickItem[] = [
    ...targets.map(target => ({
      label: target.label,
      description: target.description,
      detail: target.checkout === 'current'
        ? 'Use the current worktree state; no managed checkout.'
        : `Verify in an isolated worktree at ${target.ref}.`,
      target,
    })),
    { label: 'Custom branch...', description: 'Enter feature/X, bugfix/X, or another branch name', custom: true },
  ];
  const picked = await vscode.window.showQuickPick(items, { placeHolder: `Select branch target for ${ticketKey}` });
  if (!picked) { return undefined; }
  if (picked.custom) {
    const branch = await vscode.window.showInputBox({
      prompt: 'Branch to verify',
      placeHolder: 'feature/KRONOS-123',
      validateInput: value => buildCustomVerifyLocalBranchTarget(value) ? null : 'Use a safe branch name such as develop, feature/ABC-123, or bugfix/ABC-123.',
    });
    return buildCustomVerifyLocalBranchTarget(branch || '');
  }
  return picked.target;
}

interface VerifyLocalEnvironmentQuickPickItem extends vscode.QuickPickItem {
  targetEnvironment: VerifyLocalEnvironmentKind;
}

interface VerifyLocalEnvironmentPickOptions {
  remoteOnly?: boolean;
}

async function pickVerifyLocalEnvironmentTarget(
  projectName: string,
  options: VerifyLocalEnvironmentPickOptions = {},
): Promise<VerifyLocalEnvironmentTarget | undefined> {
  const allItems: VerifyLocalEnvironmentQuickPickItem[] = [
    { label: 'local (mock)', description: 'Replay against local app plus mocks', targetEnvironment: 'local' },
    { label: 'DEV', description: 'Replay against DEV environment', targetEnvironment: 'DEV' },
    { label: 'TEST', description: 'Replay against TEST environment', targetEnvironment: 'TEST' },
    { label: 'Custom URL...', description: 'Replay against an operator-provided HTTP(S) endpoint', targetEnvironment: 'custom' },
  ];
  const items = options.remoteOnly
    ? allItems.filter(item => item.targetEnvironment !== 'local')
    : allItems;
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: options.remoteOnly
      ? 'Select remote verification environment'
      : 'Select verification environment',
  });
  if (!picked) { return undefined; }
  if (picked.targetEnvironment === 'custom') {
    const url = await vscode.window.showInputBox({
      prompt: 'Custom verification base URL',
      placeHolder: 'https://service.example/path',
      validateInput: value => normalizeHttpUrl(value) ? null : 'Enter an http:// or https:// URL.',
    });
    const normalized = normalizeHttpUrl(url);
    if (!normalized) { return undefined; }
    return buildVerifyLocalEnvironmentTarget('custom', { customUrl: normalized, projectName, env: process.env });
  }
  return buildVerifyLocalEnvironmentTarget(picked.targetEnvironment, { projectName, env: process.env });
}

async function pickVerifyLocalModeTarget(): Promise<VerifyLocalModeTarget | undefined> {
  const picked = await vscode.window.showQuickPick(
    VERIFY_LOCAL_MODE_TARGETS.map(mode => ({ label: mode.label, description: mode.description, mode })),
    { placeHolder: 'Select verification mode' },
  );
  return picked?.mode;
}

async function pickProjectName(state: KronosState, placeHolder: string): Promise<string | undefined> {
  const projects = buildRegisteredProjectItems(state.state?.projects);
  if (projects.length === 0) {
    vscode.window.showWarningMessage('No projects registered.');
    return undefined;
  }
  if (projects.length === 1) {
    return projects[0]?.label;
  }
  const picked = await vscode.window.showQuickPick(
    projects,
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
      description: mergeRequestReviewStatusLabel(ticket.mr?.review_status, 'merge request'),
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
      const result = await pollReviewMergeRequests(state, () => !disposed);
      recordReviewPollStatus(result);
    } catch (e: unknown) {
      appendKronosLog('Review MR polling failed.', unknownErrorMessage(e, 'Review MR polling failed.'));
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

async function pollReviewMergeRequests(state: KronosState, shouldContinue: () => boolean = () => true): Promise<ReviewPollResult> {
  const startedAt = new Date().toISOString();
  const result: ReviewPollResult = {
    startedAt,
    endedAt: startedAt,
    checked: 0,
    changed: 0,
    failed: 0,
  };
  appendKronosLog('Review MR polling started.');
  if (!shouldContinue()) { return finishReviewPollResult(result); }
  state.reloadAndNotify();
  if (!shouldContinue()) { return finishReviewPollResult(result); }
  await reconcileTerminalReviewMergeRequests(state, shouldContinue);
  if (!shouldContinue()) { return finishReviewPollResult(result); }
  for (const candidate of reviewMergeRequestCandidates(state)) {
    if (!shouldContinue()) { return finishReviewPollResult(result); }
    result.checked += 1;
    try {
      const status = await gitlabAdapter.mergeRequestStatus(state, candidate.ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
      if (!shouldContinue()) { return finishReviewPollResult(result); }
      const update = updateTicketMergeRequestStatus({ ticketKey: candidate.ticketKey, status });
      if (!shouldContinue()) { return finishReviewPollResult(result); }
      if (update.changed) {
        result.changed += 1;
        appendKronosLog(`MR state changed for ${candidate.ticketKey}.`, `${status.state || 'unknown'} / ${status.review_status || 'unknown'}`);
        state.reloadAndNotify();
      }
      if (!shouldContinue()) { return finishReviewPollResult(result); }
      await pollReviewBuildStatus(state, candidate.ticketKey, result, shouldContinue);
      if (!shouldContinue()) { return finishReviewPollResult(result); }
      const decision = decideReviewMonitorAction(candidate.ticketKey, update);
      if (decision.kind === 'deploy_monitor') {
        if (!shouldContinue()) { return finishReviewPollResult(result); }
        const deployResult = await startDeployMonitorForMergedTicket(state, candidate.ticketKey, update.ticket);
        if (reviewDeployMonitorActionHandled(deployResult)) {
          rememberReviewTerminalMergeRequestAction(candidate.ticketKey, update.ticket, 'deploy_monitor');
        }
      } else if (decision.kind === 'blocked') {
        if (!shouldContinue()) { return finishReviewPollResult(result); }
        notifyReviewMonitorDecision(candidate.ticketKey, decision);
      } else if (decision.kind === 'notify') {
        if (!shouldContinue()) { return finishReviewPollResult(result); }
        const notificationKey = reviewMergeRequestNotificationKey(candidate.ticketKey, update);
        if (!rememberReviewMergeRequestNotification(notificationKey)) { continue; }
        notifyReviewMonitorDecision(candidate.ticketKey, decision);
      }
    } catch (e: unknown) {
      if (!shouldContinue()) { return finishReviewPollResult(result); }
      result.failed += 1;
      appendKronosLog(`Failed to poll MR status for ${candidate.ticketKey}.`, unknownErrorMessage(e, 'unknown error'));
      notifyReviewMergeRequestPollFailure(candidate.ticketKey, e);
    }
  }
  return finishReviewPollResult(result);
}

async function pollReviewBuildStatus(
  state: KronosState,
  ticketKey: string,
  result: ReviewPollResult,
  shouldContinue: () => boolean,
): Promise<void> {
  try {
    const build = await jenkinsAdapter.buildStatus(state, ticketKey, { timeout: LIVE_MR_DIFF_TIMEOUT_MS });
    if (!shouldContinue() || !build) { return; }
    const update = updateTicketBuildStatus({ ticketKey, build });
    if (update.changed) {
      result.changed += 1;
      appendKronosLog(`Jenkins build state changed for ${ticketKey}.`, `${build.status} #${build.number}`);
      state.reloadAndNotify();
    }
  } catch (e: unknown) {
    if (!shouldContinue()) { return; }
    result.failed += 1;
    appendKronosLog(`Failed to poll Jenkins build status for ${ticketKey}.`, unknownErrorMessage(e, 'unknown error'));
  }
}

function finishReviewPollResult(result: ReviewPollResult): ReviewPollResult {
  return { ...result, endedAt: new Date().toISOString() };
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
      return vscode.commands.executeCommand('kronos.openReview');
    } else if (action === 'Run Doctor') {
      return vscode.commands.executeCommand('kronos.doctor');
    }
    return undefined;
  }).then(undefined, (e: unknown) => {
    console.warn(unknownErrorMessage(e, 'Failed to handle MR polling failure action.'));
  });
}

function notifyReviewMonitorDecision(ticketKey: string, decision: ReviewMonitorDecision): void {
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
      return vscode.commands.executeCommand('kronos.openReview', { ticketKey });
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
  const byProject = groupTicketsByProject(tickets);

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
      buildTicketGroupProjectItems(byProject, countLabel),
      { placeHolder }
    );
    if (!pick) { return null; }
    projectName = pick.label;
  }

  const projectPath = getProjectPath(state.state?.projects, projectName);
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
  } else if (command === 'setupWizard') {
    await vscode.commands.executeCommand('kronos.setupWizard');
  } else if (command === 'mrAutopilot') {
    await vscode.commands.executeCommand('kronos.mrAutopilot');
  } else if (command === 'integrationContractReport') {
    await vscode.commands.executeCommand('kronos.integrationContractReport');
  } else if (command === 'agentQualityScore') {
    await vscode.commands.executeCommand('kronos.agentQualityScore');
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
  } else if (command === 'specBeanstalk') {
    await vscode.commands.executeCommand('kronos.specBeanstalk');
  } else if (command === 'startTicket' && ticketKey) {
    await startTicketFromActionPanel(state, ticketKey);
  } else if ((command === 'viewTicket' || command === 'addEvidence' || command === 'addEvidenceCheck') && ticketKey) {
    await tryExecuteTicketOperatorCommand(command, ticketKey);
  } else {
    vscode.window.showWarningMessage('Ignored Kronos dashboard action without a valid target.');
  }
}

async function executeMrAutopilotAction(state: KronosState, request: ActionPanelMessage, extensionUri?: vscode.Uri): Promise<void> {
  const command = request.command;
  const ticketKey = request.ticket;
  const runId = request.runId;
  if (ticketKey && !state.state?.tickets?.[ticketKey]) {
    vscode.window.showWarningMessage(`${ticketKey} is no longer in Kronos state.`);
    return;
  }
  if (command === 'refreshPanel') {
    state.reloadAndNotify();
    return;
  }
  if (command === 'runAutopilotPass' || command === 'pollReviewMergeRequests') {
    await vscode.commands.executeCommand('kronos.pollReviewMergeRequests');
    state.reloadAndNotify();
    return;
  }
  if (command === 'startTicket' && ticketKey) {
    await startTicketFromActionPanel(state, ticketKey);
    return;
  }
  if ((command === 'viewTicket' || command === 'evidenceGate') && ticketKey) {
    await tryExecuteTicketOperatorCommand(command, ticketKey);
    return;
  }
  if (command === 'runCenter') {
    openInteractiveRunCenter(state, extensionUri, runId || undefined);
    return;
  }
  if (command === 'humanReviewInbox' || command === 'queuePlanner') {
    await executeOperatorCommandAction(command);
    return;
  }
  vscode.window.showWarningMessage('Ignored Kronos MR Autopilot action without a valid target.');
}

export function deactivate() {}
