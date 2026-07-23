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
  const terminalConnected = workSession?.status === 'active' && liveTerminalCount > 0;
  const workspaceSubtitle = terminalConnected
    ? 'Open the connected terminal or review context before adding it.'
    : workSession
      ? 'Reconnect your terminal or start another Claude session.'
      : input.localProject
        ? 'Start Claude or connect a terminal you already own.'
        : 'Choose a project, then start Claude or connect a terminal you already own.';
  const mrIid = connectedMergeRequestIid(ticket, workSession);
  const terminalActions = [
    ...(terminalConnected
      ? [ticketWorkspaceActionButton('focusWorkSessionTerminal', 'Open terminal', { ticket: ticketKey, primary: true })]
      : workSession
        ? [ticketWorkspaceActionButton('manageActiveTerminal', 'Connect focused terminal', { ticket: ticketKey, primary: true })]
        : [ticketWorkspaceActionButton('startClaudeForTicket', 'Start Claude', { ticket: ticketKey, primary: true })]),
    ...(!terminalConnected && !workSession
      ? [ticketWorkspaceActionButton('manageActiveTerminal', 'Connect focused terminal', { ticket: ticketKey })]
      : [ticketWorkspaceActionButton('startClaudeForTicket', 'Start another Claude', { ticket: ticketKey })]),
    ticketWorkspaceActionButton(
      'chooseTicketProject',
      input.localProject ? 'Change project' : 'Choose project',
      { ticket: ticketKey },
    ),
  ];
  const contextActions = [
    ...(ticket.source === 'jira'
      ? [ticketWorkspaceActionButton('insertJiraContext', 'Review Jira ticket', { ticket: ticketKey })]
      : []),
    ticketWorkspaceActionButton(
      'insertGitLabContext',
      mrIid !== undefined ? `Review merge request !${mrIid}` : 'Review merge request',
      { ticket: ticketKey },
    ),
    ticketWorkspaceActionButton('insertCiContext', 'Review build & quality', { ticket: ticketKey }),
    ticketWorkspaceActionButton('openPromptLibrary', 'Add team prompt', { ticket: ticketKey }),
  ];
  const mainSections = [
    buildTicketSummary(ticket, input.localProject),
    buildMergeRequestSummary(ticket, workSession),
    buildBuildSummary(ticket),
  ].filter(Boolean);
  const sideSections = [
    buildMonitoringSummary(workSession, input.providerPolling || []),
    buildArtifactSummary(workSession?.artifacts || []),
    buildProviderBindings(workSession),
  ].filter(Boolean);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  ${kronosWebviewBaseCss()}
  .workspace-shell { max-width: 1320px; }
  .workspace-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(300px, .55fr); gap: 14px; }
  .workspace-grid.single { grid-template-columns: minmax(0, 900px); }
  .terminal-workspace { border-color: color-mix(in srgb, var(--k-accent) 60%, var(--k-border)); background: linear-gradient(145deg, var(--k-accent-bg), var(--k-surface) 42%); }
  .terminal-workspace h2 { color: var(--k-fg); font-size: 15px; text-transform: none; }
  .workspace-action-groups { display: grid; gap: 10px; margin: 14px 0; }
  .workspace-action-group { display: grid; gap: 5px; }
  .workspace-action-label { color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .workspace-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .workspace-actions .kronos-button { min-height: 30px; }
  .workspace-facts { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
  .workspace-fact { min-width: 0; padding: 9px 10px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
  .workspace-fact span { display: block; color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .workspace-fact strong { display: block; margin-top: 3px; overflow-wrap: anywhere; }
  .workspace-location { display: grid; gap: 4px; margin-top: 9px; color: var(--k-muted); font-size: 11px; }
  .workspace-location span { display: flex; gap: 6px; min-width: 0; }
  .workspace-location strong { color: var(--k-fg); font-weight: 550; overflow-wrap: anywhere; }
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
  .workspace-details { padding: 0; }
  .workspace-details summary { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 14px; cursor: pointer; font-weight: 650; }
  .workspace-details-body { padding: 0 14px 13px; }
  .workspace-detail-count { color: var(--k-muted); font-size: 11px; font-weight: 550; }
  .workspace-safety { margin: 10px 0 0; color: var(--k-muted); font-size: 11px; }
  @media (max-width: 900px) { .workspace-grid { grid-template-columns: 1fr; } }
</style>
${ticketWorkspaceActionScript(input.nonce, input.actionScriptUri)}
</head>
<body>
<main class="kronos-shell workspace-shell">
  <header class="kronos-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(ticketKey)} — ${escapeHtml(summary)}</h1>
      <div class="kronos-subtitle">${workspaceSubtitle}</div>
    </div>
  </header>

  <section class="kronos-card terminal-workspace">
    <h2>Work on this ticket</h2>
    <div class="workspace-action-groups">
      <div class="workspace-action-group"><span class="workspace-action-label">Terminal</span><div class="workspace-actions">${terminalActions.join('')}</div></div>
      <div class="workspace-action-group"><span class="workspace-action-label">Add context</span><div class="workspace-actions">${contextActions.join('')}</div></div>
    </div>
    ${buildTerminalWorkspaceFacts(workSession, liveTerminalCount, input.localProject)}
    <p class="workspace-safety">Actions run only when selected. Context opens for review and is never submitted automatically.</p>
    ${buildProviderLinks(ticket, workSession)}
  </section>

  <div class="workspace-grid${sideSections.length > 0 ? '' : ' single'} kronos-section">
    <div class="kronos-stack">
      ${mainSections.join('')}
    </div>
    ${sideSections.length > 0 ? `<div class="kronos-stack">${sideSections.join('')}</div>` : ''}
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
  const projectName = localProject?.displayName || localProject?.name || 'Current workspace';
  const branch = localProject?.branch || (localProject ? 'Unavailable' : 'Not linked');
  const directory = localProject?.path || 'Current workspace folder';
  return `<div class="workspace-facts">
    ${fact('Terminal', `<span class="status-pill ${escapeClass(attachment.tone)}">${escapeHtml(attachment.label)}</span>`, true)}
    ${fact('Project', projectName)}
  </div><div class="workspace-location"><span>Branch <strong>${escapeHtml(branch)}</strong></span><span>Folder <strong>${escapeHtml(directory)}</strong></span></div>`;
}

function buildProviderLinks(ticket: Ticket, workSession: WorkSessionRecord | undefined): string {
  const links: string[] = [];
  addProviderLink(links, ticket.jira_url, 'Open Jira');
  addProviderLink(links, ticket.mr?.url || mergeRequestBinding(workSession)?.url, 'Open merge request');
  addProviderLink(links, ticket.build?.url, 'Open Build');
  return links.length > 0 ? `<nav class="provider-links" aria-label="Provider links">${links.join('')}</nav>` : '';
}

function buildTicketSummary(ticket: Ticket, localProject?: LocalProjectSummary): string {
  const labels = (ticket.labels || []).map(label => singleLine(label, 100)).filter(Boolean);
  const description = singleLinePreservingBreaks(ticket.description, 20_000);
  return `<section class="kronos-card">
    <h2>Ticket details</h2>
    <div class="workspace-facts">
      ${fact('Type', singleLine(ticket.type, 120) || 'Unknown')}
      ${fact('Status', displayState(ticket.jira_status))}
      ${fact('Priority', singleLine(ticket.priority, 120) || 'Unknown')}
      ${fact('Updated', ticket.updated ? formatWebviewDateTime(ticket.updated, 'Unknown') : 'Unknown')}
      ${fact('Jira project', singleLine(ticket.jira_project_key, 200) || 'Unknown')}
      ${fact('Local project', singleLine(localProject?.displayName || localProject?.name || ticket.linked_local_project, 200) || 'Not linked')}
      ${fact('Attachments', String(ticket.attachments?.length || 0))}
      ${fact('Labels', labels.join(', ') || 'None')}
    </div>
    ${description ? `<div class="kronos-section"><h3>Description</h3><div class="description">${escapeHtml(description)}</div></div>` : ''}
  </section>`;
}

function buildMergeRequestSummary(ticket: Ticket, workSession: WorkSessionRecord | undefined): string {
  const mr = ticket.mr;
  if (!mr) {
    const binding = mergeRequestBinding(workSession);
    if (binding && /^[1-9][0-9]*$/.test(binding.subjectId)) {
      return `<section class="kronos-card">
        <h2>Merge Request !${escapeHtml(binding.subjectId)}</h2>
        <div class="muted">Connected to this ticket${binding.projectId ? ` · project ${escapeHtml(singleLine(binding.projectId, 500))}` : ''}.</div>
      </section>`;
    }
    return '';
  }
  const sourceBranch = singleLine(mr.source_branch, 240);
  const targetBranch = singleLine(mr.target_branch, 240);
  return `<section class="kronos-card">
    <h2>Merge Request !${escapeHtml(mr.iid)}</h2>
    ${mr.title ? `<div>${escapeHtml(singleLine(mr.title, 1_000))}</div>` : ''}
    <div class="workspace-facts kronos-section">
      ${fact('State', displayState(mr.state))}
      ${fact('Review', displayState(mr.review_status))}
      ${fact('Source branch', sourceBranch || 'Unknown')}
      ${fact('Target branch', targetBranch || 'Unknown')}
      ${fact('Comments', String(mr.comment_count || 0))}
      ${fact('Unresolved', String(mr.unresolved_discussion_count || 0))}
    </div>
  </section>`;
}

function buildBuildSummary(ticket: Ticket): string {
  const build = ticket.build;
  if (!build) { return ''; }
  return `<section class="kronos-card">
    <h2>Build #${escapeHtml(build.number)}</h2>
    <div class="workspace-facts">${fact('Status', displayState(build.status))}</div>
  </section>`;
}

function buildMonitoringSummary(
  workSession: WorkSessionRecord | undefined,
  providerPolling: readonly ProviderPollingViewStatus[],
): string {
  const state = monitoringState(workSession);
  const providerRows = providerPolling.map(provider => `<div class="workspace-fact">
    <span>${escapeHtml(provider.provider)}</span>
    <strong><span class="status-pill ${escapeClass(provider.state === 'active' ? 'healthy' : provider.state === 'discovering' ? 'waiting' : provider.state === 'paused' ? 'off' : 'partial')}">${escapeHtml(providerPollingStateLabel(provider.state))}</span></strong>
    <div class="muted">${escapeHtml(singleLine(provider.detail, 500))}</div>
  </div>`).join('');
  if (!workSession) {
    if (!providerRows) { return ''; }
    return `<section class="kronos-card"><h2>Provider updates</h2><span class="status-pill unmanaged">Ready to connect</span><p class="muted">Connect a terminal to keep provider updates with this ticket.</p>${providerRows ? `<div class="workspace-facts kronos-section">${providerRows}</div>` : ''}</section>`;
  }
  const monitoring = workSession.monitoring;
  const monitoringFacts = [
    fact('Last checked', monitoring.lastAttemptAt ? formatWebviewDateTime(monitoring.lastAttemptAt, 'Unknown') : 'Never'),
    fact('Last successful', monitoring.lastPolledAt ? formatWebviewDateTime(monitoring.lastPolledAt, 'Unknown') : 'Never'),
    ...(monitoring.lastFailureCount ? [fact('Problems', String(monitoring.lastFailureCount))] : []),
    ...(monitoring.lastSkippedCount ? [fact('Skipped sources', String(monitoring.lastSkippedCount))] : []),
  ];
  return `<section class="kronos-card">
    <h2>Provider updates</h2>
    <span class="status-pill ${escapeClass(state.tone)}">${escapeHtml(state.label)}</span>
    ${providerRows ? `<div class="workspace-facts kronos-section">${providerRows}</div>` : ''}
    <div class="workspace-facts kronos-section">${monitoringFacts.join('')}</div>
    ${monitoring.lastSummary ? `<div>${escapeHtml(singleLine(monitoring.lastSummary, 1_000))}</div>` : ''}
  </section>`;
}

function buildArtifactSummary(artifacts: readonly WorkSessionContextArtifact[]): string {
  if (artifacts.length === 0) { return ''; }
  const recent = [...artifacts]
    .sort((left, right) => timestamp(right.recordedAt) - timestamp(left.recordedAt))
    .slice(0, 6);
  const rows = recent.map(artifact => {
    const warnings = artifact.warnings.slice(0, 2).map(warning => singleLine(warning, 500)).filter(Boolean);
    return `<div class="artifact">
      <strong>${escapeHtml(singleLine(artifact.label, 300) || artifact.kind)}</strong>
      <div class="meta">${artifact.complete ? 'Complete' : 'Partial'} • ${escapeHtml(formatWebviewDateTime(artifact.fetchedAt, 'Unknown'))}</div>
      ${warnings.map(warning => `<div class="warning">${escapeHtml(warning)}</div>`).join('')}
    </div>`;
  });
  return `<section class="kronos-card">
    <h2>Saved context</h2>
    <div class="muted">${artifacts.length} saved item${artifacts.length === 1 ? '' : 's'}</div>
    <div class="artifact-list">${rows.join('')}</div>
  </section>`;
}

function buildProviderBindings(workSession: WorkSessionRecord | undefined): string {
  const bindings = workSession?.providerBindings || [];
  if (bindings.length === 0) { return ''; }
  const rows = bindings.slice(-12).reverse()
    .map(binding => `<li><strong>${escapeHtml(providerName(binding.provider))}</strong> · ${escapeHtml(providerResource(binding.resource, binding.subjectId))}</li>`);
  return `<details class="kronos-card workspace-details">
    <summary>Connected sources <span class="workspace-detail-count">${bindings.length}</span></summary>
    <div class="workspace-details-body">
      ${bindings.length > rows.length ? `<div class="muted">Showing ${rows.length} of ${bindings.length} connected sources.</div>` : ''}
      <ul class="provider-binding-list">${rows.join('')}</ul>
    </div>
  </details>`;
}

function terminalAttachmentState(
  workSession: WorkSessionRecord | undefined,
  liveTerminalCount: number,
): { label: string; tone: string } {
  if (!workSession) { return { label: 'Ready to connect', tone: 'unmanaged' }; }
  if (workSession.status === 'closed') { return { label: 'Tracking stopped', tone: 'closed' }; }
  if (liveTerminalCount > 0) {
    return {
      label: liveTerminalCount === 1 ? 'Connected' : `${liveTerminalCount} connected`,
      tone: 'attached',
    };
  }
  return { label: 'Not connected', tone: 'detached' };
}

function monitoringState(workSession: WorkSessionRecord | undefined): { label: string; tone: string } {
  if (!workSession || !workSession.monitoring.enabled) { return { label: 'Off', tone: 'off' }; }
  const state = workSession.monitoring.lastState;
  if (!state) { return { label: 'Waiting for first check', tone: 'waiting' }; }
  const labels = { healthy: 'Up to date', partial: 'Needs review', blocked: 'Blocked', idle: 'No changes' } as const;
  return { label: labels[state], tone: state };
}

function providerPollingStateLabel(state: ProviderPollingViewStatus['state']): string {
  return {
    active: 'Checking',
    discovering: 'Finding source',
    paused: 'Not checking',
    setup: 'Setup needed',
  }[state];
}

function providerName(provider: WorkSessionRecord['providerBindings'][number]['provider']): string {
  return { jira: 'Jira', gitlab: 'GitLab', jenkins: 'Jenkins', sonar: 'SonarQube' }[provider];
}

function providerResource(resource: string, subjectId: string): string {
  const name = singleLine(resource, 120).replace(/[-_]+/g, ' ').replace(/^./, value => value.toUpperCase()) || 'Source';
  const id = singleLine(subjectId, 300);
  return `${name}${id ? name.toLowerCase() === 'merge request' && /^[1-9][0-9]*$/.test(id) ? ` !${id}` : ` ${id}` : ''}`;
}

function displayState(value: unknown): string {
  const normalized = singleLine(value, 160).replace(/[_/.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) { return 'Unknown'; }
  if (normalized.toLowerCase() === 'opened') { return 'Open'; }
  return `${normalized.charAt(0).toLocaleUpperCase()}${normalized.slice(1)}`;
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
