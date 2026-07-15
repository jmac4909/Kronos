import type { Ticket } from '../state/types';
import type { WorkSessionContextArtifact, WorkSessionRecord } from './workSessionStore';
import { ticketWorkspaceActionButton, ticketWorkspaceActionScript } from './operatorPanel';
import { formatWebviewDateTime } from './webviewFormat';
import { escapeAttr, escapeClass, escapeHtml, kronosWebviewBaseCss, safeHttpHref } from './webviewHtml';
import type { LocalProjectSummary } from './projectCatalog';
import { effectiveTicketMergeRequest } from './providerBindingReconciliation';

export interface TicketWorkspaceViewInput {
  ticketKey: string;
  ticket: Ticket;
  nonce: string;
  actionScriptUri: string;
  workSession?: WorkSessionRecord | null;
  liveTerminalCount?: number;
  localProject?: LocalProjectSummary | undefined;
  providerPolling?: readonly ProviderPollingViewStatus[];
}

export interface ProviderPollingViewStatus {
  provider: 'GitLab' | 'Jenkins' | 'SonarQube';
  state: 'active' | 'discovering' | 'paused' | 'setup';
  detail: string;
}

export function buildTicketWorkspaceHtml(input: TicketWorkspaceViewInput): string {
  const ticketKey = singleLine(input.ticketKey, 160) || 'Ticket';
  const ticket = {
    ...input.ticket,
    mr: effectiveTicketMergeRequest(input.ticket, input.workSession, null),
  };
  const summary = singleLine(ticket.summary, 1_000) || 'Untitled ticket';
  const workSession = input.workSession || undefined;
  const liveTerminalCount = resolveLiveTerminalCount(workSession, input.liveTerminalCount);
  const mrIid = connectedMergeRequestIid(ticket, workSession);
  const actionButtons = [
    ticketWorkspaceActionButton(
      'chooseTicketProject',
      input.localProject ? `Change / Unlink Project: ${input.localProject.name}` : 'Add Project / Branch',
      { ticket: ticketKey },
    ),
    ticketWorkspaceActionButton('startClaudeForTicket', 'Start Claude for Ticket', { ticket: ticketKey, primary: true }),
    ticketWorkspaceActionButton('manageActiveTerminal', 'Manage Focused Terminal', { ticket: ticketKey }),
    ...(ticket.source === 'jira'
      ? [ticketWorkspaceActionButton('insertJiraContext', `Insert [${ticketKey}]`, { ticket: ticketKey })]
      : []),
    ticketWorkspaceActionButton(
      'insertGitLabContext',
      mrIid !== undefined ? `Insert [MR-${mrIid}]` : 'Find & Insert MR Evidence',
      { ticket: ticketKey },
    ),
    ticketWorkspaceActionButton('insertCiContext', `Insert [CI-${ticketKey}] Evidence`, { ticket: ticketKey }),
  ];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  ${kronosWebviewBaseCss()}
  .workspace-shell { max-width: 1120px; }
  .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(280px, .65fr); gap: 14px; }
  .terminal-workspace { border-color: color-mix(in srgb, var(--k-accent) 60%, var(--k-border)); background: linear-gradient(145deg, var(--k-accent-bg), var(--k-surface) 42%); }
  .terminal-workspace h2 { color: var(--k-fg); font-size: 15px; text-transform: none; }
  .workspace-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .workspace-actions .kronos-button { min-height: 30px; }
  .workspace-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
  .workspace-fact { min-width: 0; padding: 9px 10px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
  .workspace-fact span { display: block; color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .workspace-fact strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
  .provider-links { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
  .provider-link { display: inline-flex; align-items: center; min-height: 28px; padding: 4px 9px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); color: var(--k-accent); text-decoration: none; }
  .provider-link:hover { background: var(--k-hover); text-decoration: underline; }
  .status-pill { display: inline-flex; align-items: center; min-height: 22px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 650; }
  .status-pill.healthy, .status-pill.attached { color: var(--k-ok); background: var(--k-ok-bg); }
  .status-pill.partial, .status-pill.detached, .status-pill.waiting { color: var(--k-warn); background: var(--k-warn-bg); }
  .status-pill.blocked, .status-pill.closed { color: var(--k-danger); background: var(--k-danger-bg); }
  .status-pill.idle, .status-pill.off, .status-pill.unmanaged { color: var(--k-muted); background: var(--k-surface-soft); }
  .description { white-space: pre-wrap; overflow-wrap: anywhere; }
  .artifact-list { display: grid; gap: 7px; margin-top: 8px; }
  .artifact { padding: 8px 9px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
  .artifact .meta, .muted { color: var(--k-muted); font-size: 11px; }
  .artifact .warning { margin-top: 3px; color: var(--k-warn); font-size: 11px; }
  .provider-binding-list { margin: 8px 0 0; padding-left: 18px; }
  .provider-binding-list li { margin: 3px 0; overflow-wrap: anywhere; }
  @media (max-width: 760px) { .workspace-grid { grid-template-columns: 1fr; } }
</style>
${ticketWorkspaceActionScript(input.nonce, input.actionScriptUri)}
</head>
<body>
<main class="kronos-shell workspace-shell">
  <header class="kronos-header">
    <div>
      <div class="kronos-subtitle">Terminal-first ticket workspace</div>
      <h1 class="kronos-title">${escapeHtml(ticketKey)} — ${escapeHtml(summary)}</h1>
      <div class="kronos-subtitle">Start a new Claude terminal explicitly, or attach one you already own. Provider polling is automatic for configured ticket sessions; Insert actions only place reviewed evidence in the terminal and never press Enter.</div>
    </div>
  </header>

  <section class="kronos-card terminal-workspace">
    <h2>Terminal Workspace</h2>
    <div class="workspace-actions">${actionButtons.join('')}</div>
    ${buildTerminalWorkspaceFacts(workSession, liveTerminalCount, input.localProject)}
    ${buildProviderLinks(ticket, workSession)}
  </section>

  <div class="workspace-grid kronos-section">
    <div class="kronos-stack">
      ${buildTicketSummary(ticket, input.localProject)}
      ${buildJiraSummary(ticket)}
      ${buildMergeRequestSummary(ticket, workSession)}
      ${buildBuildSummary(ticket)}
    </div>
    <div class="kronos-stack">
      ${buildMonitoringSummary(workSession, input.providerPolling || [])}
      ${buildArtifactSummary(workSession?.artifacts || [])}
      ${buildProviderBindings(workSession)}
    </div>
  </div>
</main>
</body>
</html>`;
}

function buildTerminalWorkspaceFacts(
  workSession: WorkSessionRecord | undefined,
  liveTerminalCount: number,
  localProject: LocalProjectSummary | undefined,
): string {
  const attachment = terminalAttachmentState(workSession, liveTerminalCount);
  const monitoring = monitoringState(workSession);
  const artifactCount = workSession?.artifacts.length || 0;
  return `<div class="workspace-facts">
    ${fact('Terminal', `<span class="status-pill ${escapeClass(attachment.tone)}">${escapeHtml(attachment.label)}</span>`, true)}
    ${fact('Monitoring', `<span class="status-pill ${escapeClass(monitoring.tone)}">${escapeHtml(monitoring.label)}</span>`, true)}
    ${fact('Saved context', `${artifactCount} artifact${artifactCount === 1 ? '' : 's'}`)}
    ${fact('Session', workSession ? sessionStatusLabel(workSession.status) : 'Ready to connect')}
    ${fact('Launch project', localProject?.displayName || localProject?.name || 'workspace fallback')}
    ${fact('Git branch', localProject?.branch || (localProject ? 'unavailable' : 'not linked'))}
    ${fact('Launch directory', localProject?.path || 'current workspace')}
  </div>`;
}

function buildProviderLinks(ticket: Ticket, workSession: WorkSessionRecord | undefined): string {
  const links: string[] = [];
  addProviderLink(links, ticket.jira_url, 'Open Jira');
  addProviderLink(links, ticket.mr?.url || mergeRequestBinding(workSession)?.url, 'Open MR');
  addProviderLink(links, ticket.build?.url, 'Open Build');
  return links.length > 0 ? `<nav class="provider-links" aria-label="Provider links">${links.join('')}</nav>` : '';
}

function buildTicketSummary(ticket: Ticket, localProject?: LocalProjectSummary): string {
  const labels = (ticket.labels || []).map(label => singleLine(label, 100)).filter(Boolean);
  const description = singleLinePreservingBreaks(ticket.description, 20_000);
  return `<section class="kronos-card">
    <h2>Ticket</h2>
    <div class="workspace-facts">
      ${fact('Type', singleLine(ticket.type, 120) || 'unknown')}
      ${fact('Priority', singleLine(ticket.priority, 120) || 'unknown')}
      ${fact('Jira project', singleLine(ticket.jira_project_key, 200) || 'unknown')}
      ${fact('Local project', singleLine(localProject?.displayName || ticket.linked_local_project, 200) || 'not linked')}
      ${fact('Labels', labels.join(', ') || 'none')}
    </div>
    ${description ? `<div class="kronos-section"><h3>Description</h3><div class="description">${escapeHtml(description)}</div></div>` : ''}
  </section>`;
}

function buildJiraSummary(ticket: Ticket): string {
  return `<section class="kronos-card">
    <h2>Jira</h2>
    <div class="workspace-facts">
      ${fact('Source', singleLine(ticket.source, 80))}
      ${fact('Status', singleLine(ticket.jira_status, 160) || 'unknown')}
      ${fact('Updated', ticket.updated ? formatWebviewDateTime(ticket.updated, 'Unknown') : 'Unknown')}
      ${fact('Attachments', String(ticket.attachments?.length || 0))}
    </div>
  </section>`;
}

function buildMergeRequestSummary(ticket: Ticket, workSession: WorkSessionRecord | undefined): string {
  const mr = ticket.mr;
  if (!mr) {
    const binding = mergeRequestBinding(workSession);
    if (binding && /^[1-9][0-9]*$/.test(binding.subjectId)) {
      return `<section class="kronos-card">
        <h2>Merge Request !${escapeHtml(binding.subjectId)}</h2>
        <div class="muted">Connected locally to this work session${binding.projectId ? ` · project ${escapeHtml(singleLine(binding.projectId, 500))}` : ''}.</div>
      </section>`;
    }
    return '<section class="kronos-card"><h2>Merge Request</h2><div class="muted">No linked merge request.</div></section>';
  }
  const sourceBranch = singleLine(mr.source_branch, 240);
  const targetBranch = singleLine(mr.target_branch, 240);
  return `<section class="kronos-card">
    <h2>Merge Request !${escapeHtml(mr.iid)}</h2>
    ${mr.title ? `<div>${escapeHtml(singleLine(mr.title, 1_000))}</div>` : ''}
    <div class="workspace-facts kronos-section">
      ${fact('State', singleLine(mr.state, 80))}
      ${fact('Review', singleLine(mr.review_status, 120))}
      ${fact('Source branch', sourceBranch || 'unknown')}
      ${fact('Target branch', targetBranch || 'unknown')}
      ${fact('Comments', String(mr.comment_count || 0))}
      ${fact('Unresolved', String(mr.unresolved_discussion_count || 0))}
    </div>
  </section>`;
}

function buildBuildSummary(ticket: Ticket): string {
  const build = ticket.build;
  if (!build) {
    return '<section class="kronos-card"><h2>Build</h2><div class="muted">No linked build.</div></section>';
  }
  return `<section class="kronos-card">
    <h2>Build #${escapeHtml(build.number)}</h2>
    <div class="workspace-facts">${fact('Status', singleLine(build.status, 160) || 'unknown')}</div>
  </section>`;
}

function buildMonitoringSummary(
  workSession: WorkSessionRecord | undefined,
  providerPolling: readonly ProviderPollingViewStatus[],
): string {
  const state = monitoringState(workSession);
  const providerRows = providerPolling.map(provider => `<div class="workspace-fact">
    <span>${escapeHtml(provider.provider)}</span>
    <strong><span class="status-pill ${escapeClass(provider.state === 'active' ? 'healthy' : provider.state === 'discovering' ? 'waiting' : provider.state === 'paused' ? 'off' : 'partial')}">${escapeHtml(provider.state)}</span></strong>
    <div class="muted">${escapeHtml(singleLine(provider.detail, 500))}</div>
  </div>`).join('');
  if (!workSession) {
    return `<section class="kronos-card"><h2>Automatic Provider Monitoring</h2><span class="status-pill unmanaged">Ready to connect</span><p class="muted">Manage the focused terminal to associate it with this ticket and monitor linked providers.</p>${providerRows ? `<div class="workspace-facts kronos-section">${providerRows}</div>` : ''}</section>`;
  }
  const monitoring = workSession.monitoring;
  return `<section class="kronos-card">
    <h2>Automatic Provider Monitoring</h2>
    <span class="status-pill ${escapeClass(state.tone)}">${escapeHtml(state.label)}</span>
    ${providerRows ? `<div class="workspace-facts kronos-section">${providerRows}</div>` : ''}
    <div class="workspace-facts kronos-section">
      ${fact('Last attempt', monitoring.lastAttemptAt ? formatWebviewDateTime(monitoring.lastAttemptAt, 'Unknown') : 'Never')}
      ${fact('Last successful poll', monitoring.lastPolledAt ? formatWebviewDateTime(monitoring.lastPolledAt, 'Unknown') : 'Never')}
      ${fact('Failures', String(monitoring.lastFailureCount || 0))}
      ${fact('Skipped', String(monitoring.lastSkippedCount || 0))}
    </div>
    ${monitoring.lastSummary ? `<div>${escapeHtml(singleLine(monitoring.lastSummary, 1_000))}</div>` : ''}
  </section>`;
}

function buildArtifactSummary(artifacts: readonly WorkSessionContextArtifact[]): string {
  const recent = [...artifacts]
    .sort((left, right) => timestamp(right.recordedAt) - timestamp(left.recordedAt))
    .slice(0, 6);
  const rows = recent.map(artifact => {
    const warnings = artifact.warnings.slice(0, 2).map(warning => singleLine(warning, 500)).filter(Boolean);
    return `<div class="artifact">
      <strong>${escapeHtml(singleLine(artifact.label, 300) || artifact.kind)}</strong>
      <div class="meta">${artifact.complete ? 'complete' : 'partial'} • ${escapeHtml(formatWebviewDateTime(artifact.fetchedAt, 'Unknown'))}</div>
      ${warnings.map(warning => `<div class="warning">${escapeHtml(warning)}</div>`).join('')}
    </div>`;
  });
  return `<section class="kronos-card">
    <h2>Saved Context</h2>
    <div class="muted">${artifacts.length} content-addressed artifact${artifacts.length === 1 ? '' : 's'}</div>
    ${rows.length > 0 ? `<div class="artifact-list">${rows.join('')}</div>` : '<p class="muted">Inserted Jira, merge request, and CI context will appear here.</p>'}
  </section>`;
}

function buildProviderBindings(workSession: WorkSessionRecord | undefined): string {
  const bindings = workSession?.providerBindings || [];
  const rows = bindings.slice(-12).reverse()
    .map(binding => `<li><strong>${escapeHtml(binding.provider)}</strong> · ${escapeHtml(binding.resource)} · ${escapeHtml(singleLine(binding.subjectId, 300))}</li>`);
  return `<section class="kronos-card">
    <h2>Provider Bindings</h2>
    ${bindings.length > rows.length ? `<div class="muted">Showing the newest ${rows.length} of ${bindings.length} local bindings.</div>` : ''}
    ${rows.length > 0 ? `<ul class="provider-binding-list">${rows.join('')}</ul>` : '<div class="muted">No provider bindings.</div>'}
  </section>`;
}

function terminalAttachmentState(
  workSession: WorkSessionRecord | undefined,
  liveTerminalCount: number,
): { label: string; tone: string } {
  if (!workSession) { return { label: 'Ready to connect', tone: 'unmanaged' }; }
  if (workSession.status === 'closed') { return { label: 'Session closed', tone: 'closed' }; }
  if (liveTerminalCount > 0) {
    return {
      label: `${liveTerminalCount} live terminal${liveTerminalCount === 1 ? '' : 's'} attached`,
      tone: 'attached',
    };
  }
  return { label: 'Terminal detached', tone: 'detached' };
}

function monitoringState(workSession: WorkSessionRecord | undefined): { label: string; tone: string } {
  if (!workSession || !workSession.monitoring.enabled) { return { label: 'Off', tone: 'off' }; }
  const state = workSession.monitoring.lastState;
  if (!state) { return { label: 'Waiting for first poll', tone: 'waiting' }; }
  return { label: state, tone: state };
}

function sessionStatusLabel(status: WorkSessionRecord['status']): string {
  return status === 'active' ? 'Active' : 'Closed';
}

function addProviderLink(links: string[], value: string | undefined, label: string): void {
  const href = safeHttpHref(value);
  if (!href) { return; }
  links.push(`<a class="provider-link" href="${href}" title="${escapeAttr(label)}">${escapeHtml(label)} &rarr;</a>`);
}

function fact(label: string, value: string, trustedHtml = false): string {
  return `<div class="workspace-fact"><span>${escapeHtml(label)}</span><strong>${trustedHtml ? value : escapeHtml(value)}</strong></div>`;
}

function resolveLiveTerminalCount(workSession: WorkSessionRecord | undefined, value: number | undefined): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) { return value; }
  return workSession?.terminals.filter(terminal => terminal.status === 'attached').length || 0;
}

function connectedMergeRequestIid(ticket: Ticket, workSession: WorkSessionRecord | undefined): number | undefined {
  if (ticket.mr && Number.isSafeInteger(ticket.mr.iid) && ticket.mr.iid > 0) { return ticket.mr.iid; }
  const subjectId = mergeRequestBinding(workSession)?.subjectId;
  if (!subjectId || !/^[1-9][0-9]*$/.test(subjectId)) { return undefined; }
  const iid = Number(subjectId);
  return Number.isSafeInteger(iid) ? iid : undefined;
}

function mergeRequestBinding(workSession: WorkSessionRecord | undefined): WorkSessionRecord['providerBindings'][number] | undefined {
  return [...(workSession?.providerBindings || [])]
    .reverse()
    .find(binding => binding.provider === 'gitlab' && binding.resource === 'merge-request');
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function singleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function singleLinePreservingBreaks(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/g, '').trim().slice(0, maxLength)
    : '';
}
