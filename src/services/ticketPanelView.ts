import { QueueState, Ticket } from '../state/types';
import { buildStatusKind } from './buildStatus';
import { evidenceAcceptanceCriteria, evidenceChecked, evidenceChecks, evidenceEnvironmentResults, evidenceNotes, evidenceString } from './evidenceData';
import { EvidenceGateResult, evaluateEvidenceGate } from './evidenceGate';
import { mergeRequestCommentsFromRecord } from './mergeRequestComments';
import { mergeRequestReviewStatusLabel } from './mergeRequestLabels';
import { actionButton, kronosActionPanelScript } from './operatorPanel';
import { ticketStringArray, ticketStringField } from './ticketFields';
import { TimelineEvent, buildTicketTimeline } from './ticketTimeline';
import { escapeClass, escapeHtml, kronosWebviewBaseCss, safeHttpHref } from './webviewHtml';
import { formatWebviewDate, formatWebviewDateTime } from './webviewFormat';

type TicketTimelineRuns = Parameters<typeof buildTicketTimeline>[0]['runs'];

export interface TicketPanelRenderInput {
  queue?: QueueState | null;
  runs?: TicketTimelineRuns;
  nonce?: string;
  actionScriptUri?: string;
}

export function buildTicketHtml(key: string, ticket: Ticket, input: TicketPanelRenderInput = {}): string {
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
  const timeline = buildTicketTimeline({
    ticketKey: key,
    ticket,
    ...(input.queue !== undefined ? { queue: input.queue } : {}),
    ...(input.runs !== undefined ? { runs: input.runs } : {}),
  });
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
    const comments = mergeRequestCommentsFromRecord(mr).slice(-5).reverse();
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
        <div><strong>MR !${esc(ticketStringField(mr, 'iid', '?'))}</strong> — <span style="color:${reviewColor}">${esc(mergeRequestReviewStatusLabel(reviewStatus))}</span></div>
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
    const buildKind = buildStatusKind(buildStatus);
    const buildColor = buildKind === 'pass' ? '#4caf50' : buildKind === 'fail' ? '#f44336' : '#ff9800';
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
  const isQueued = Boolean(input.queue?.items?.some(item => item.ticket === key));
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
  .timeline-detail { color: var(--k-muted); white-space: normal; overflow-wrap: anywhere; line-height: 1.45; }
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
</div>${input.nonce ? kronosActionPanelScript(input.nonce, 'Kronos Ticket Detail', input.actionScriptUri) : ''}</body></html>`;
}

export function buildTicketGateHtml(gate: EvidenceGateResult): string {
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

export function buildTicketTimelineHtml(events: TimelineEvent[]): string {
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
  return `<div class="section"><h3>Agent Timeline</h3><div class="timeline">${rows}</div></div>`;
}
