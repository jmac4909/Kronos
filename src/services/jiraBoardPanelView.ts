import type { KronosState as KronosStateSnapshot, QueueState } from '../state/types';
import { evidenceRecordCount } from './evidenceData';
import { mergeRequestReviewStatusLabel } from './mergeRequestLabels';
import { finiteNumberFromUnknown, isRecord, recordEntriesFromUnknown, recordKeysFromUnknown, recordsFromUnknown } from './records';
import { ticketStringArray, ticketStringField } from './ticketFields';
import { WEBVIEW_READY_COMMAND, webviewRuntimeScriptTag, webviewRuntimeScriptUri } from './webviewSecurity';
import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export interface JiraBoardPanelInput {
  state: KronosStateSnapshot | null;
  queue: QueueState | null;
  nonce: string;
  scriptUri: string;
}

function ticketAttachments(value: unknown): TicketAttachmentSummary[] {
  return recordsFromUnknown(value)
    .map(item => ({
      filename: ticketStringField(item, 'filename', 'attachment'),
      size: finiteNumberFromUnknown(item['size']),
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

type BoardColumnName = 'To Do' | 'Queued' | 'In Progress' | 'Review' | 'Blocked' | 'Done';

const DEFAULT_BOARD_COLUMN: BoardColumnName = 'To Do';
const QUEUED_BOARD_COLUMN: BoardColumnName = 'Queued';
const BOARD_COLUMN_BY_ACTION: Record<string, BoardColumnName> = {
  implement: 'To Do', in_progress: 'In Progress', await_review: 'Review',
  deploy_monitor: 'In Progress', verify: 'In Progress', fix_build: 'In Progress',
  blocked: 'Blocked', done: 'Done', unknown: 'To Do',
};

export function buildJiraBoardHtml(input: JiraBoardPanelInput): string {
  const esc = escapeHtml;
  const attr = escapeAttr;
  const ticketEntries = recordEntriesFromUnknown(input.state?.tickets);
  const ticketCount = ticketEntries.length;
  const projects = recordKeysFromUnknown(input.state?.projects);
  const queuedKeys = new Set((input.queue?.items || []).map(i => i.ticket));

  const columns: Record<BoardColumnName, string[]> = {
    'To Do': [], 'Queued': [], 'In Progress': [], 'Review': [], 'Blocked': [], 'Done': [],
  };

  const ticketData: Record<string, JiraBoardTicketPayload> = {};

  for (const [key, t] of ticketEntries) {
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
    const col = isQueued ? QUEUED_BOARD_COLUMN : (BOARD_COLUMN_BY_ACTION[nextAction] ?? DEFAULT_BOARD_COLUMN);

    const projs = linkedProjects.map((p: string) => `<span class="tag proj">${esc(p)}</span>`).join('');
    const typeClass = ticketType.toLowerCase().includes('bug') || ticketType.toLowerCase().includes('defect') ? 'bug' : 'story';
    const mrReviewStatus = mr ? ticketStringField(mr, 'review_status') : '';
    const hasMrUrl = Boolean(mr && ticketStringField(mr, 'url'));
    const mrLabel = mr ? `MR !${esc(ticketStringField(mr, 'iid', '?'))} &middot; ${esc(mergeRequestReviewStatusLabel(mrReviewStatus))}` : '';
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
    columns[col].push(card);
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
${webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri))}
<script nonce="${escapeAttr(input.nonce)}" id="kronos-jira-board-script" defer src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="jira-board" data-kronos-webview-name="Kronos Jira Board" data-kronos-ready-command="${escapeAttr(WEBVIEW_READY_COMMAND)}"></script>
</head><body><div class="kronos-shell board-shell">
  <textarea id="kronos-jira-ticket-data" class="kronos-data-payload" hidden aria-hidden="true">${ticketJsonRaw}</textarea>
  <div class="kronos-header">
    <div>
      <h1 class="kronos-title">Jira Board</h1>
      <div class="kronos-subtitle">${ticketCount} ticket${ticketCount === 1 ? '' : 's'} across ${projects.length} project${projects.length === 1 ? '' : 's'}</div>
    </div>
  </div>
  <div class="kronos-toolbar board-toolbar">
    <input id="board-filter" class="board-filter kronos-input" type="search" placeholder="Filter tickets" aria-label="Filter tickets">
    <span id="board-filter-summary" class="board-filter-summary" aria-live="polite">${ticketCount} total</span>
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
