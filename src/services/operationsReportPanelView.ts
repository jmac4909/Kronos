import type { AgentQualityScore } from './agentQualityScore';
import type { DoctorCheck } from './doctorChecks';
import type { IntegrationManifestAudit, IntegrationManifestStatus } from './integrationManifest';
import { actionButton, kronosActionPanelScript, kronosOperatorPanelCss, operatorCommandRow } from './operatorPanel';
import { listProfiles, type KronosProfile } from './profileManager';
import { requiredScripts } from './scriptClient';
import type { TrendMetricsReport } from './trendMetrics';
import { escapeClass, escapeHtml } from './webviewHtml';
import { formatWebviewDateTime } from './webviewFormat';
import { countLabel } from './countLabels';

interface SessionStatsRow {
  project: string;
  skill: string;
  ticket?: string;
  startedAt?: string;
  verdict: string;
  durationSec: number;
  toolCalls: number;
  toolErrors: number;
  filesEdited: number;
}

interface SessionStatsReport {
  sessions: SessionStatsRow[];
}

export function buildSessionStatsHtml(stats: SessionStatsReport, nonce?: string, actionScriptUri?: string): string {
  const sessions = stats.sessions;
  const totalSessions = sessions.length;
  const successes = sessions.filter(session => session.verdict === 'success').length;
  const avgDuration = totalSessions > 0 ? Math.round(sessions.reduce((total, session) => total + session.durationSec, 0) / totalSessions) : 0;
  const avgTools = totalSessions > 0 ? Math.round(sessions.reduce((total, session) => total + session.toolCalls, 0) / totalSessions) : 0;
  const totalErrors = sessions.reduce((total, session) => total + session.toolErrors, 0);
  const totalFiles = sessions.reduce((total, session) => total + session.filesEdited, 0);

  const bySkill: Record<string, SessionStatsRow[]> = {};
  for (const session of sessions) {
    const bucket = bySkill[session.skill] || [];
    bucket.push(session);
    bySkill[session.skill] = bucket;
  }

  const skillRows = Object.entries(bySkill).map(([skill, items]) => {
    const avg = Math.round(items.reduce((total, session) => total + session.durationSec, 0) / items.length);
    const succ = items.filter(session => session.verdict === 'success').length;
    const tools = Math.round(items.reduce((total, session) => total + session.toolCalls, 0) / items.length);
    return `<tr><td>${escapeHtml(skill)}</td><td>${items.length}</td><td>${succ}/${items.length}</td><td>${avg}s</td><td>${tools}</td></tr>`;
  }).join('');

  const recentRows = sessions.slice(-15).reverse().map(session => {
    const date = formatWebviewDateTime(session.startedAt);
    const verdict = session.verdict === 'success' ? '<span class="pill pass">PASS</span>' : '<span class="pill fail">FAIL</span>';
    return `<tr><td>${date}</td><td>${escapeHtml(session.project)}</td><td>${escapeHtml(session.skill)}</td><td>${escapeHtml(session.ticket || '-')}</td><td>${verdict}</td><td>${session.durationSec}s</td><td>${session.toolCalls}</td><td>${session.toolErrors}</td><td>${session.filesEdited}</td></tr>`;
  }).join('');
  const actions = operatorCommandRow([
    actionButton('runCenter', 'Run Center'),
    actionButton('sessionHistory', 'Session History'),
    actionButton('agentQualityScore', 'Agent Quality'),
    actionButton('trendMetrics', 'Trend Metrics'),
  ]);

  return `<!DOCTYPE html>
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
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Session Stats', actionScriptUri) : ''}</body></html>`;
}

export function buildAgentQualityScoreHtml(score: AgentQualityScore, nonce?: string, actionScriptUri?: string): string {
  const componentRows = score.components.map(component => `<tr>
    <td>${escapeHtml(component.label)}</td>
    <td><strong>${escapeHtml(String(component.score))}</strong> / ${escapeHtml(String(component.max))}</td>
    <td>${escapeHtml(component.detail)}</td>
  </tr>`).join('');
  const metricRows = score.metrics.map(metric => `<div class="summary-card"><div class="num">${escapeHtml(metric.value)}</div><div class="lbl">${escapeHtml(metric.label)}</div></div>`).join('');
  const actions = operatorCommandRow([
    actionButton('runCenter', 'Run Center'),
    actionButton('stats', 'Session Stats'),
    actionButton('trendMetrics', 'Trend Metrics'),
    actionButton('evidenceGate', 'Evidence Gate'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Agent Quality Score</h1>
      <div class="kronos-subtitle">Run outcomes, evidence gates, builds, reviews, retries, and handoff readiness</div>
    </div>
  </div>
  ${actions}
  <div class="operator-hero">
    <div><span class="score">${score.score}</span><span class="grade">Grade ${escapeHtml(score.grade)}</span></div>
    <div>${escapeHtml(score.summary)}</div>
  </div>
  <div class="operator-summary">${metricRows}</div>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Component</th><th>Score</th><th>Detail</th></tr>${componentRows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Agent Quality Score', actionScriptUri) : ''}</body></html>`;
}

export function buildTrendMetricsHtml(report: TrendMetricsReport, nonce?: string, actionScriptUri?: string): string {
  const metricCards = report.metrics.map(metric => `<div class="summary-card ${escapeClass(metric.status)}">
    <div class="num">${escapeHtml(metric.value)}</div>
    <div class="lbl">${escapeHtml(metric.label)}</div>
    <div class="detail">${escapeHtml(metric.detail)}</div>
  </div>`).join('');
  const rows = report.metrics.map(metric => `<tr class="${escapeClass(metric.status)}">
    <td><span class="pill ${escapeClass(metric.status)}">${escapeHtml(metric.status)}</span></td>
    <td>${escapeHtml(metric.label)}</td>
    <td><strong>${escapeHtml(metric.value)}</strong></td>
    <td>${escapeHtml(metric.detail)}</td>
  </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('runCenter', 'Run Center'),
    actionButton('stats', 'Session Stats'),
    actionButton('agentQualityScore', 'Agent Quality'),
    actionButton('agingReport', 'Aging Report'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  .summary-card.good .num { color: #4caf50; }
  .summary-card.warn .num { color: #ff9800; }
  .summary-card.bad .num { color: #f44336; }
  .pill.good { color: #4caf50; background: rgba(76,175,80,0.16); }
  .pill.warn { color: #ff9800; background: rgba(255,152,0,0.16); }
  .pill.bad { color: #f44336; background: rgba(244,67,54,0.16); }
  .pill.neutral { color: var(--vscode-foreground); background: rgba(128,128,128,0.16); }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Trend Metrics</h1>
      <div class="kronos-subtitle">${escapeHtml(report.summary)} ${escapeHtml(countLabel(report.runsConsidered, 'run'))}, ${escapeHtml(countLabel(report.ticketsConsidered, 'ticket'))}, ${report.windowDays}-day window.</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">${metricCards}</div>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Status</th><th>Metric</th><th>Value</th><th>Detail</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Trend Metrics', actionScriptUri) : ''}</body></html>`;
}

export function buildIntegrationManifestHtml(status: IntegrationManifestStatus, audit: IntegrationManifestAudit, nonce?: string, actionScriptUri?: string): string {
  const artifactByKey = new Map(audit.artifacts.map(artifact => [`${artifact.kind}:${artifact.name}`, artifact]));
  const hashCell = (artifact: IntegrationManifestAudit['artifacts'][number] | undefined) => {
    if (!artifact) {
      return '<span class="pill warn">UNCHECKED</span>';
    }
    const hashes = [
      artifact.expectedSha256 ? `expected ${artifact.expectedSha256.substring(0, 12)}` : '',
      artifact.actualSha256 ? `actual ${artifact.actualSha256.substring(0, 12)}` : '',
    ].filter(Boolean).join(', ');
    return `<span class="pill ${artifact.status}">${artifact.status.toUpperCase()}</span><br><span class="hash-detail">${escapeHtml(artifact.detail)}${hashes ? ` ${escapeHtml(hashes)}` : ''}</span>`;
  };
  const scripts = requiredScripts().map(script => {
    const entry = status.manifest?.scripts?.[script.name];
    const artifact = artifactByKey.get(`script:${script.name}`);
    return `<tr>
      <td>${escapeHtml(script.name)}</td>
      <td><span class="pill ${script.present ? 'pass' : 'fail'}">${script.present ? 'PRESENT' : 'MISSING'}</span></td>
      <td>${hashCell(artifact)}</td>
      <td>${escapeHtml(entry?.version || '-')}</td>
      <td>${escapeHtml(entry?.sha256 || '-')}</td>
      <td>${escapeHtml(script.path)}</td>
    </tr>`;
  }).join('');
  const prompts = Object.entries(status.manifest?.prompts || {}).map(([name, entry]) => {
    const artifact = artifactByKey.get(`prompt:${name}`);
    return `<tr>
      <td>${escapeHtml(name)}</td>
      <td>${escapeHtml(entry.required ? 'required' : 'optional')}</td>
      <td>${hashCell(artifact)}</td>
      <td>${escapeHtml(entry.sha256 || '-')}</td>
    </tr>`;
  }).join('');
  const providers = Object.entries(status.manifest?.providers || {}).map(([name, entry]) => `<tr>
    <td>${escapeHtml(name)}</td>
    <td>${escapeHtml(entry.enabled === false ? 'disabled' : 'enabled')}</td>
    <td>${escapeHtml(entry.baseUrl || '-')}</td>
  </tr>`).join('');
  const messages = [...status.errors.map(error => ({ status: 'fail', text: error })), ...status.warnings.map(warning => ({ status: 'warn', text: warning }))];
  const messageRows = messages.map(message => `<div class="message ${message.status}">${escapeHtml(message.text)}</div>`).join('');
  const auditSummary = `<div class="message ${audit.status}">${escapeHtml(`Hash audit: ${audit.summary}`)}</div>`;
  const manifestPillClass = !status.present ? 'warn' : status.valid ? 'pass' : 'fail';
  const manifestPillLabel = status.present ? (status.valid ? 'VALID' : 'INVALID') : 'MISSING';
  const actions = operatorCommandRow([
    actionButton('snapshotIntegrationManifest', 'Snapshot'),
    actionButton('doctor', 'Doctor'),
    actionButton('profiles', 'Profiles'),
    actionButton('promptManager', 'Prompt Manager'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Integration Manifest</h1>
      <div class="kronos-subtitle">Script, prompt, and provider drift audit for the local integration bundle</div>
    </div>
    <span class="pill ${manifestPillClass}">${manifestPillLabel}</span>
  </div>
  ${actions}
  <div class="path">${escapeHtml(status.path)}</div>
  ${messageRows}
  ${auditSummary}
  <div class="operator-section"><h2>Required Scripts</h2>
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Script</th><th>Status</th><th>Hash Status</th><th>Version</th><th>Manifest SHA-256</th><th>Path</th></tr>${scripts}</table></div></div>
  <div class="operator-section"><h2>Prompts</h2>
  ${prompts ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Prompt</th><th>Required</th><th>Hash Status</th><th>Manifest SHA-256</th></tr>${prompts}</table></div>` : '<div class="kronos-empty">No prompt manifest entries.</div>'}</div>
  <div class="operator-section"><h2>Providers</h2>
  ${providers ? `<div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Provider</th><th>Status</th><th>Base URL</th></tr>${providers}</table></div>` : '<div class="kronos-empty">No provider manifest entries.</div>'}</div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Integration Manifest', actionScriptUri) : ''}</body></html>`;
}

export function buildProfilesHtml(active: KronosProfile, nonce?: string, actionScriptUri?: string): string {
  const rows = listProfiles().map(profile => {
    const providers = Object.entries(profile.providers)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .join(', ') || 'none';
    return `<tr class="${profile.id === active.id ? 'active' : ''}">
      <td>${escapeHtml(profile.label)}${profile.id === active.id ? ' <span class="pill pass profile-active-pill">ACTIVE</span>' : ''}</td>
      <td>${escapeHtml(profile.defaultBaseBranch)}</td>
      <td>${escapeHtml(providers)}</td>
      <td>${escapeHtml(profile.description)}</td>
    </tr>`;
  }).join('');
  const actions = operatorCommandRow([
    actionButton('settings', 'Settings'),
    actionButton('doctor', 'Doctor'),
    actionButton('integrationManifest', 'Manifest'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
  tr.active { background: var(--vscode-textBlockQuote-background); }
  .profile-active-pill { margin-left: 6px; }
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Profiles</h1>
      <div class="kronos-subtitle">Current profile, default branch behavior, and enabled provider groups</div>
    </div>
  </div>
  ${actions}
  <div class="table-wrap kronos-panel"><table class="kronos-table"><tr><th>Profile</th><th>Default Branch</th><th>Providers</th><th>Description</th></tr>${rows}</table></div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Profiles', actionScriptUri) : ''}</body></html>`;
}

export function buildDoctorHtml(checks: DoctorCheck[], nonce?: string, actionScriptUri?: string): string {
  const summary = {
    pass: checks.filter(c => c.status === 'pass').length,
    warn: checks.filter(c => c.status === 'warn').length,
    fail: checks.filter(c => c.status === 'fail').length,
  };
  const rows = checks.map(c => `<tr class="${c.status}">
    <td><span class="pill ${c.status}">${c.status.toUpperCase()}</span></td>
    <td>${escapeHtml(c.name)}</td>
    <td>${escapeHtml(c.detail)}</td>
  </tr>`).join('');
  const actions = operatorCommandRow([
    actionButton('setup', 'Auth Check'),
    actionButton('settings', 'Settings'),
    actionButton('integrationManifest', 'Manifest'),
    actionButton('profiles', 'Profiles'),
    actionButton('recoveryCenter', 'Recovery'),
    actionButton('stateAuditLog', 'Audit Log'),
  ]);

  return `<!DOCTYPE html>
<html><head><style>
  ${kronosOperatorPanelCss()}
</style></head><body><div class="kronos-shell operator-shell">
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Kronos Doctor</h1>
      <div class="kronos-subtitle">Commands, credentials, project config, state integrity, and provider reachability</div>
    </div>
  </div>
  ${actions}
  <div class="operator-summary">
    <div class="summary-card"><div class="num">${summary.pass}</div><div class="lbl">Passing</div></div>
    <div class="summary-card"><div class="num">${summary.warn}</div><div class="lbl">Warnings</div></div>
    <div class="summary-card"><div class="num">${summary.fail}</div><div class="lbl">Failing</div></div>
  </div>
  <div class="table-wrap kronos-panel"><table class="kronos-table">
    <tr><th>Status</th><th>Check</th><th>Detail</th></tr>
    ${rows}
  </table></div>
</div>${nonce ? kronosActionPanelScript(nonce, 'Kronos Doctor', actionScriptUri) : ''}</body></html>`;
}
