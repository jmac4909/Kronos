const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const REQUIRED_COMMANDS = [
  'kronos.openDashboard',
  'kronos.setupWizard',
  'kronos.mrAutopilot',
  'kronos.integrationContractReport',
  'kronos.jiraBoard',
  'kronos.viewTicket',
  'kronos.insertJiraContext',
  'kronos.insertGitLabContext',
  'kronos.insertCiContext',
  'kronos.manageActiveTerminal',
  'kronos.pollManagedWorkSessions',
  'kronos.openWorkSessionAudit',
  'kronos.focusWorkSessionTerminal',
  'kronos.reattachWorkSessionTerminal',
  'kronos.detachWorkSessionTerminal',
  'kronos.closeWorkSession',
  'kronos.evidenceGate',
  'kronos.evidenceHandoff',
  'kronos.runCenter',
  'kronos.recoveryCenter',
  'kronos.humanReviewInbox',
  'kronos.doctor',
  'kronos.promptManager',
  'kronos.queuePlanner',
  'kronos.backlogTriage',
  'kronos.specBeanstalk',
  'kronos.specBeanstalkGenerate',
  'kronos.specBeanstalkStart',
];

const PANEL_SMOKE = [
  { command: 'kronos.openDashboard', viewType: 'kronosDashboard' },
  { command: 'kronos.setupWizard', viewType: 'kronosSetupWizard' },
  { command: 'kronos.mrAutopilot', viewType: 'kronosMrAutopilot' },
  { command: 'kronos.integrationContractReport', viewType: 'kronosIntegrationContracts' },
  { command: 'kronos.jiraBoard', viewType: 'kronosJiraBoard' },
  { command: 'kronos.viewTicket', args: ['KRONOS-FB-1'], viewType: 'kronosTicket' },
  { command: 'kronos.evidenceGate', args: ['KRONOS-FB-1'], viewType: 'kronosEvidenceGate' },
  { command: 'kronos.evidenceHandoff', args: [{ ticketKey: 'KRONOS-FB-1' }], viewType: 'kronosEvidenceHandoff' },
  { command: 'kronos.runCenter', args: [{ id: 'feedback-run-needs-human' }], viewType: 'kronosRunCenter' },
  { command: 'kronos.recoveryCenter', args: [{ runId: 'feedback-run-needs-human' }], viewType: 'kronosRecoveryCenter' },
  { command: 'kronos.humanReviewInbox', viewType: 'kronosHumanReviewInbox' },
  { command: 'kronos.doctor', viewType: 'kronosDoctor' },
  { command: 'kronos.promptManager', viewType: 'kronosPromptManager' },
  { command: 'kronos.queuePlanner', viewType: 'kronosQueuePlanner' },
  { command: 'kronos.backlogTriage', viewType: 'kronosBacklogTriage' },
  { command: 'kronos.specBeanstalk', viewType: 'kronosSpecBeanstalk' },
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function webviewTabs() {
  const tabs = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      if (input && typeof input.viewType === 'string') {
        tabs.push({ title: tab.label, viewType: input.viewType });
      }
    }
  }
  return tabs;
}

function smokeApi(extension) {
  const api = extension.exports && extension.exports.__kronosSmoke;
  assert.ok(api && typeof api.openedPanels === 'function', 'Kronos smoke API should expose openedPanels()');
  return api;
}

function openedSmokePanels(extension) {
  return smokeApi(extension).openedPanels();
}

function panelForViewType(extension, viewType) {
  const panels = openedSmokePanels(extension).filter(panel => panel.viewType === viewType);
  assert.ok(panels.length > 0, `${viewType} should have a smoke panel record`);
  return panels[panels.length - 1];
}

function assertHtmlContains(html, markers, label) {
  assert.ok(html.includes('<body'), `${label} should contain rendered HTML`);
  for (const marker of markers) {
    assert.ok(html.includes(marker), `${label} should include ${marker}`);
  }
}

function assertAction(html, action, attrs = {}) {
  assert.ok(html.includes(`data-action="${action}"`), `panel HTML should include action ${action}`);
  for (const [name, value] of Object.entries(attrs)) {
    assert.ok(html.includes(`data-${name}="${value}"`), `action ${action} should expose data-${name}=${value}`);
  }
}

function assertPanelHtml(extension, viewType) {
  const html = panelForViewType(extension, viewType).html || '';
  const sharedTicket = 'KRONOS-FB-1';
  switch (viewType) {
    case 'kronosDashboard':
      assertHtmlContains(html, [
        'Kronos Dashboard',
        'Operator Brief',
        'Operator Cockpit',
        'Setup Wizard',
        'MR Autopilot',
        'Integration Contracts',
        'KRONOS-FB-2',
        'Intentional fixture failed build should be first.',
        'Evidence Gate',
        'Spec Beanstalk',
      ], viewType);
      assertAction(html, 'nextBestAction');
      assertAction(html, 'setupWizard');
      assertAction(html, 'mrAutopilot');
      assertAction(html, 'runCenter');
      assertAction(html, 'humanReviewInbox');
      assertAction(html, 'specBeanstalk');
      break;
    case 'kronosSetupWizard':
      assertHtmlContains(html, [
        'Kronos Setup Wizard',
        'First-run readiness',
        'Integration scripts',
        'Safe operator state',
        'Spec Beanstalk',
      ], viewType);
      assertAction(html, 'setup');
      assertAction(html, 'doctor');
      assertAction(html, 'integrationContractReport');
      break;
    case 'kronosMrAutopilot':
      assertHtmlContains(html, [
        'Kronos MR Autopilot',
        'Safe Pass',
        'Candidates',
        'KRONOS-FB-1',
      ], viewType);
      assertAction(html, 'runAutopilotPass');
      assertAction(html, 'pollReviewMergeRequests');
      assertAction(html, 'insertGitLabContext', { ticket: sharedTicket });
      assertAction(html, 'insertCiContext', { ticket: sharedTicket });
      break;
    case 'kronosIntegrationContracts':
      assertHtmlContains(html, [
        'Kronos Integration Contracts',
        'Contract Harness',
        'gitlab_api.py --mr-status',
        'pipeline_monitor.py --sonar-issues',
      ], viewType);
      assertAction(html, 'doctor');
      assertAction(html, 'integrationManifest');
      break;
    case 'kronosJiraBoard':
      assertHtmlContains(html, [
        'Jira Board',
        'board-filter',
        'data-kronos-webview-name="Kronos Jira Board"',
        'KRONOS-FB-1',
        'KRONOS-FB-2',
        'KRONOS-FB-3',
        'Remove from Queue',
        'data-action="start"',
        'id="modal-overlay"',
      ], viewType);
      assertAction(html, 'openJira', { ticket: sharedTicket });
      assertAction(html, 'removeFromQueue');
      break;
    case 'kronosTicket':
      assertHtmlContains(html, [
        'Review-ready fixture with evidence and a linked MR',
        'Evidence Ledger',
        'Synthetic local smoke',
        'Dashboard shows next action.',
        'MR !41',
        'Build #142',
      ], viewType);
      assertAction(html, 'evidenceHandoff', { ticket: sharedTicket });
      assertAction(html, 'publishEvidence', { ticket: sharedTicket });
      assertAction(html, 'insertJiraContext', { ticket: sharedTicket });
      assertAction(html, 'manageActiveTerminal', { ticket: sharedTicket });
      assertAction(html, 'insertGitLabContext', { ticket: sharedTicket });
      assertAction(html, 'insertCiContext', { ticket: sharedTicket });
      break;
    case 'kronosEvidenceGate':
      assertHtmlContains(html, [
        'Evidence Gate: KRONOS-FB-1',
        'Evidence readiness by ticket and check',
        'Passing',
      ], viewType);
      assertAction(html, 'refreshPanel');
      break;
    case 'kronosEvidenceHandoff':
      assertHtmlContains(html, [
        'Evidence Handoff: KRONOS-FB-1',
        'Manual posting packet',
        'Kronos did not call a posting API.',
        'Comment Payload',
        'Synthetic local verification passed.',
      ], viewType);
      assertAction(html, 'viewTicket', { ticket: sharedTicket });
      assertAction(html, 'publishEvidence', { ticket: sharedTicket });
      break;
    case 'kronosRunCenter':
      assertHtmlContains(html, [
        'Kronos Run Center',
        'feedback-run-needs-human',
        'needs_human',
        'Synthetic run requires human review',
      ], viewType);
      assertAction(html, 'resumeRun', { 'run-id': 'feedback-run-needs-human' });
      assertAction(html, 'retryRun', { 'run-id': 'feedback-run-needs-human' });
      break;
    case 'kronosRecoveryCenter':
      assertHtmlContains(html, [
        'Kronos Recovery Center',
        'feedback-run-needs-human',
        'Synthetic run requires human review',
        'feedback-run-paused-stale',
        'Review Paused Run',
        'data-focused-item="true"',
      ], viewType);
      assertAction(html, 'executeRecoveryItem', { 'run-id': 'feedback-run-needs-human' });
      break;
    case 'kronosHumanReviewInbox':
      assertHtmlContains(html, [
        'Kronos Human Review Inbox',
        'operator decision is safer than automation',
        'feedback-run-needs-human',
      ], viewType);
      assertAction(html, 'runCenter', { 'run-id': 'feedback-run-needs-human' });
      break;
    case 'kronosDoctor':
      assertHtmlContains(html, [
        'Kronos Doctor',
        'kronos_state.py',
        'Provider network reachability',
      ], viewType);
      break;
    case 'kronosPromptManager':
      assertHtmlContains(html, [
        'Kronos Prompt Manager',
        'Prompt Smoke Tests',
        'Required Prompt Pack',
      ], viewType);
      break;
    case 'kronosQueuePlanner':
      assertHtmlContains(html, [
        'Kronos Queue Planner',
        'KRONOS-FB-2',
        'Intentional fixture failed build should be first.',
      ], viewType);
      assertAction(html, 'startPlan');
      break;
    case 'kronosBacklogTriage':
      assertHtmlContains(html, [
        'Kronos Backlog Triage',
        'feedback-service',
        'KRONOS-FB-3',
      ], viewType);
      assertAction(html, 'viewTicket');
      break;
    case 'kronosSpecBeanstalk':
      assertHtmlContains(html, [
        'Spec Beanstalk',
        'Excel API spec to Java implementation loop',
        'Generate Spec',
        'Start / Continue',
        'feedback-service',
        'No spec',
      ], viewType);
      assertAction(html, 'generateSpec');
      assertAction(html, 'startBeanstalk');
      assertAction(html, 'openGeneratedSpec');
      break;
    default:
      assert.fail(`No rendered HTML smoke assertions configured for ${viewType}`);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, label, timeoutMs = 8000, detailFactory) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (predicate()) { return; }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  const detail = lastError ? ` Last error: ${lastError.message}` : '';
  const extra = detailFactory ? ` ${detailFactory()}` : '';
  throw new Error(`Timed out waiting for ${label}.${detail}${extra}`);
}

async function executePanelSmoke(extension, entry) {
  console.log(`Executing ${entry.command}`);
  await vscode.commands.executeCommand(entry.command, ...(entry.args || []));
  await waitFor(
    () => openedSmokePanels(extension).some(panel => panel.viewType === entry.viewType),
    `${entry.viewType} webview after ${entry.command}`,
    8000,
    () => `Opened smoke panels: ${JSON.stringify(openedSmokePanels(extension))}. Tab metadata: ${JSON.stringify(webviewTabs())}.`,
  );
  assertPanelHtml(extension, entry.viewType);
}

async function closeAllEditors() {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await sleep(100);
}

async function run() {
  const kronosDir = process.env.KRONOS_DIR;
  assert.ok(kronosDir, 'KRONOS_DIR must be set for feedback smoke');
  assert.equal(process.env.KRONOS_FEEDBACK_SMOKE, '1', 'KRONOS_FEEDBACK_SMOKE marker must be set');

  const state = readJson(path.join(kronosDir, 'state.json'));
  const queue = readJson(path.join(kronosDir, 'queue.json'));
  assert.ok(state.tickets['KRONOS-FB-1'], 'feedback ticket KRONOS-FB-1 should exist');
  assert.ok(state.tickets['KRONOS-FB-2'], 'feedback ticket KRONOS-FB-2 should exist');
  assert.ok(state.tickets['KRONOS-FB-3'], 'feedback ticket KRONOS-FB-3 should exist');
  assert.equal(queue.items.length, 2, 'feedback queue should contain two items');

  const extension = vscode.extensions.getExtension('jmacke01.kronos');
  assert.ok(extension, 'Kronos extension should be registered in the Extension Development Host');
  await extension.activate();
  smokeApi(extension);

  const commands = await vscode.commands.getCommands(true);
  for (const command of REQUIRED_COMMANDS) {
    assert.ok(commands.includes(command), `${command} should be registered`);
  }

  await closeAllEditors();
  for (const entry of PANEL_SMOKE) {
    await executePanelSmoke(extension, entry);
  }

  const opened = openedSmokePanels(extension).map(panel => panel.viewType);
  for (const entry of PANEL_SMOKE) {
    assert.ok(opened.includes(entry.viewType), `${entry.viewType} should be open`);
  }
  console.log(`Kronos feedback smoke opened and checked ${PANEL_SMOKE.length} operator panels.`);
  await closeAllEditors();
}

module.exports = { run };
