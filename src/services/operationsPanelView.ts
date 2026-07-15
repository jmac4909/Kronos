import { operationsActionButton, operationsActionScript } from './operatorPanel';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export type OperationsStatus = 'pass' | 'warn' | 'fail';

export interface SetupStep {
  title: string;
  detail: string;
  status: OperationsStatus;
  action: string;
  actionLabel: string;
}

export interface SetupPanelInput {
  steps: SetupStep[];
  runtime: OperationsRuntimeGuide;
  nonce: string;
  actionScriptUri: string;
}

export interface OperationsRuntimeGuide {
  platformLabel: string;
  privateStatePath: string;
  providerEnvPath: string;
}

export interface DoctorCheck {
  name: string;
  detail: string;
  status: OperationsStatus;
  action?: string;
  actionLabel?: string;
}

export interface DoctorPanelInput {
  checks: DoctorCheck[];
  runtime: OperationsRuntimeGuide;
  nonce: string;
  actionScriptUri: string;
}

export function buildSetupPanelHtml(input: SetupPanelInput): string {
  const attentionCount = input.steps.filter(step => step.status !== 'pass').length;
  const headline = attentionCount === 0
    ? 'Ready for terminal-first work'
    : `${attentionCount} setup item${attentionCount === 1 ? '' : 's'} to review`;
  const tone = input.steps.some(step => step.status === 'fail') ? 'fail' : attentionCount > 0 ? 'warn' : 'pass';
  const steps = input.steps.map(step => `<article class="setup-step ${escapeClass(step.status)}">
    <div class="setup-step-heading">
      <span class="status-mark ${escapeClass(step.status)}" aria-hidden="true"></span>
      <div>
        <h2>${escapeHtml(step.title)}</h2>
        <div class="setup-detail">${escapeHtml(step.detail)}</div>
      </div>
    </div>
    ${operationsActionButton(step.action, step.actionLabel)}
  </article>`).join('');

  return `<!DOCTYPE html>
<html>
<head><style>
${operationsPanelCss()}
.setup-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; }
.setup-step { display: flex; min-height: 142px; flex-direction: column; justify-content: space-between; gap: 18px; padding: 16px; border: 1px solid var(--k-border); border-top: 3px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.setup-step.pass { border-top-color: var(--k-ok); }
.setup-step.warn { border-top-color: var(--k-warn); }
.setup-step.fail { border-top-color: var(--k-danger); }
.setup-step-heading { display: grid; grid-template-columns: 12px minmax(0, 1fr); gap: 10px; align-items: start; }
.setup-step h2 { margin: 0 0 5px; font-size: 14px; font-weight: 650; }
.setup-detail { color: var(--k-muted); font-size: 12px; line-height: 1.5; }
.setup-step .kronos-button { align-self: flex-start; }
.provider-guide { margin-top: 18px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
.provider-guide summary { padding: 13px 15px; cursor: pointer; font-weight: 650; }
.provider-guide-body { padding: 0 15px 15px; color: var(--k-muted); }
.provider-guide code { color: var(--k-fg); }
.provider-guide ul { margin-bottom: 0; padding-left: 20px; }
</style></head>
<body><main class="kronos-shell operations-shell">
  <header class="kronos-header operations-header">
    <div>
      <h1 class="kronos-title">Kronos Setup</h1>
      <div class="kronos-subtitle">Configure Claude terminals, local projects, Jira work, and read-only provider monitoring.</div>
    </div>
    <span class="kronos-pill ${escapeClass(tone)}">${tone === 'pass' ? 'Ready' : tone === 'warn' ? 'Review' : 'Blocked'}</span>
  </header>
  <div class="kronos-action-row operations-actions">
    ${operationsActionButton('openDoctor', 'Run Doctor', true)}
    ${operationsActionButton('openJiraBoard', 'Open Jira Board')}
    ${operationsActionButton('openSettings', 'Advanced VS Code Settings')}
    ${operationsActionButton('refreshPanel', 'Refresh')}
  </div>
  <section class="operations-hero ${escapeClass(tone)}">
    <div class="kronos-section-title">Setup status</div>
    <strong>${escapeHtml(headline)}</strong>
    <p>Nothing starts automatically. Every Claude terminal remains interactive and operator-owned.</p>
  </section>
  <section class="setup-grid">${steps}</section>
  <details class="provider-guide">
    <summary>Private provider environment guide</summary>
    <div class="provider-guide-body">
      <p>Kronos reads provider configuration from <code>${escapeHtml(input.runtime.providerEnvPath)}</code>. Existing extension-host environment values take precedence. Credential values are never shown here.</p>
      <ul>
        <li>Jira: <code>JIRA_BASE_URL</code>, <code>JIRA_EMAIL</code>, <code>JIRA_API_TOKEN</code>, optional <code>JIRA_JQL</code></li>
        <li>GitLab: <code>GITLAB_API_BASE_URL</code> or <code>GITLAB_BASE_URL</code>, plus <code>GITLAB_TOKEN</code></li>
        <li>Jenkins: <code>JENKINS_URL</code>, optional username/API token, and optional Jenkins-only <code>JENKINS_TLS_REJECT_UNAUTHORIZED=false</code> for a locally trusted corporate endpoint</li>
        <li>SonarQube: <code>SONAR_HOST_URL</code> or <code>SONAR_URL</code>, plus <code>SONAR_TOKEN</code></li>
      </ul>
      <p>After changing the private environment file, reload the VS Code window and run Doctor again.</p>
    </div>
  </details>
  ${operationsRuntimeGuide(input.runtime)}
</main>
${operationsActionScript(input.nonce, input.actionScriptUri, 'Kronos Setup')}
</body></html>`;
}

export function buildDoctorPanelHtml(input: DoctorPanelInput): string {
  const summary = {
    pass: input.checks.filter(check => check.status === 'pass').length,
    warn: input.checks.filter(check => check.status === 'warn').length,
    fail: input.checks.filter(check => check.status === 'fail').length,
  };
  const sortedChecks = [...input.checks].sort((left, right) => statusRank(left.status) - statusRank(right.status));
  const rows = sortedChecks.map(check => `<article class="doctor-check ${escapeClass(check.status)}">
    <span class="kronos-pill ${escapeClass(check.status)}">${check.status === 'pass' ? 'Ready' : check.status === 'warn' ? 'Review' : 'Blocked'}</span>
    <div>
      <h2>${escapeHtml(check.name)}</h2>
      <div class="doctor-detail">${escapeHtml(check.detail)}</div>
      ${check.action && check.actionLabel
        ? `<div class="doctor-action">${operationsActionButton(check.action, check.actionLabel)}</div>`
        : ''}
    </div>
  </article>`).join('');
  const tone = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'pass';
  const headline = summary.fail > 0
    ? `${summary.fail} blocking check${summary.fail === 1 ? '' : 's'}`
    : summary.warn > 0
      ? `${summary.warn} item${summary.warn === 1 ? '' : 's'} to review`
      : 'All checks ready';

  return `<!DOCTYPE html>
<html>
<head><style>
${operationsPanelCss()}
.doctor-summary { display: grid; grid-template-columns: repeat(3, minmax(110px, 1fr)); gap: 10px; margin: 0 0 18px; }
.doctor-stat { padding: 13px 14px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
.doctor-stat strong { display: block; font-size: 25px; line-height: 1; }
.doctor-stat span { display: block; margin-top: 5px; color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
.doctor-stat.pass strong { color: var(--k-ok); }
.doctor-stat.warn strong { color: var(--k-warn); }
.doctor-stat.fail strong { color: var(--k-danger); }
.doctor-list { display: grid; gap: 8px; }
.doctor-check { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 12px; align-items: start; padding: 13px 14px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.doctor-check.pass { border-left-color: var(--k-ok); }
.doctor-check.warn { border-left-color: var(--k-warn); }
.doctor-check.fail { border-left-color: var(--k-danger); }
.doctor-check h2 { margin: 0 0 3px; font-size: 13px; font-weight: 650; }
.doctor-detail { color: var(--k-muted); font-size: 12px; line-height: 1.45; word-break: break-word; }
.doctor-action { margin-top: 9px; }
.privacy-note { margin: 15px 0 0; color: var(--k-muted); font-size: 12px; }
@media (max-width: 620px) {
  .doctor-summary { grid-template-columns: 1fr; }
  .doctor-check { grid-template-columns: 1fr; }
}
</style></head>
<body><main class="kronos-shell operations-shell">
  <header class="kronos-header operations-header">
    <div>
      <h1 class="kronos-title">Kronos Doctor</h1>
      <div class="kronos-subtitle">Local readiness for Jira work, projects, provider reads, private state, and explicit Claude launch.</div>
    </div>
    <span class="kronos-pill ${escapeClass(tone)}">${escapeHtml(headline)}</span>
  </header>
  <div class="kronos-action-row operations-actions">
    ${operationsActionButton('refreshPanel', 'Run Checks Again', true)}
    ${operationsActionButton('openSetup', 'Guided Setup')}
    ${operationsActionButton('openSettings', 'Advanced Settings')}
    ${operationsActionButton('openJiraBoard', 'Jira Board')}
  </div>
  <section class="doctor-summary" aria-label="Doctor check totals">
    <div class="doctor-stat pass"><strong>${summary.pass}</strong><span>Ready</span></div>
    <div class="doctor-stat warn"><strong>${summary.warn}</strong><span>Review</span></div>
    <div class="doctor-stat fail"><strong>${summary.fail}</strong><span>Blocked</span></div>
  </section>
  <section class="doctor-list">${rows}</section>
  ${operationsRuntimeGuide(input.runtime)}
  <p class="privacy-note">Doctor never launches Claude, runs a repair, executes a project command, or displays credential values.</p>
</main>
${operationsActionScript(input.nonce, input.actionScriptUri, 'Kronos Doctor')}
</body></html>`;
}

function operationsPanelCss(): string {
  return `${kronosWebviewBaseCss()}
  .operations-shell { max-width: 1080px; }
  .operations-header { align-items: center; }
  .operations-actions { margin: 0 0 16px; }
  .operations-hero { margin: 0 0 16px; padding: 15px 17px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-border); border-radius: var(--k-radius); background: linear-gradient(135deg, var(--k-surface-soft), var(--k-surface)); }
  .operations-hero.pass { border-left-color: var(--k-ok); }
  .operations-hero.warn { border-left-color: var(--k-warn); }
  .operations-hero.fail { border-left-color: var(--k-danger); }
  .operations-hero strong { display: block; font-size: 17px; }
  .operations-hero p { margin: 5px 0 0; color: var(--k-muted); font-size: 12px; }
  .status-mark { width: 9px; height: 9px; margin-top: 5px; border-radius: 50%; background: var(--k-muted); box-shadow: 0 0 0 3px color-mix(in srgb, var(--k-muted) 16%, transparent); }
  .status-mark.pass { background: var(--k-ok); box-shadow: 0 0 0 3px var(--k-ok-bg); }
  .status-mark.warn { background: var(--k-warn); box-shadow: 0 0 0 3px var(--k-warn-bg); }
  .status-mark.fail { background: var(--k-danger); box-shadow: 0 0 0 3px var(--k-danger-bg); }
  .runtime-guide { margin-top: 16px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .runtime-guide summary { padding: 13px 15px; cursor: pointer; font-weight: 650; }
  .runtime-guide-body { padding: 0 15px 15px; color: var(--k-muted); font-size: 12px; line-height: 1.5; }
  .runtime-guide-body p { margin: 8px 0 0; }
  .runtime-guide-body code { color: var(--k-fg); word-break: break-all; }
  @media (max-width: 760px) { .operations-header .kronos-pill { margin-top: 12px; } }`;
}

function operationsRuntimeGuide(input: OperationsRuntimeGuide): string {
  return `<details class="runtime-guide">
    <summary>Runtime paths and reload behavior</summary>
    <div class="runtime-guide-body">
      <p>Extension host: ${escapeHtml(input.platformLabel)}. Private state root: <code>${escapeHtml(input.privateStatePath)}</code>. Provider environment file: <code>${escapeHtml(input.providerEnvPath)}</code>.</p>
      <p><code>KRONOS_DIR</code> selects the private state root and <code>KRONOS_ENV_FILE</code> selects the provider file. Set either before starting VS Code. On Windows PowerShell, set <code>$env:KRONOS_DIR = 'C:\\path\\to\\kronos-state'</code> before starting <code>code</code>; on macOS/Linux, export the variable before starting <code>code</code>.</p>
      <p>After changing either path or editing provider values, use <strong>Developer: Reload Window</strong> for a deterministic extension-host reload. Refresh can load previously absent supported values, but it never replaces values already supplied to the extension-host environment.</p>
    </div>
  </details>`;
}

function statusRank(status: OperationsStatus): number {
  if (status === 'fail') { return 0; }
  if (status === 'warn') { return 1; }
  return 2;
}
