import type { KronosState, Ticket } from '../state/types';
import {
  WEBVIEW_READY_COMMAND,
  webviewRuntimeScriptTag,
  webviewRuntimeScriptUri,
} from './webviewSecurity';
import { escapeAttr, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';
import { isCompletedWorkTicket } from './workTicketFilters';
import { listLocalProjects } from './projectCatalog';

export const JIRA_WORK_BOARD_SCRIPT = 'kronos-jira-work-board.js';

export const JIRA_WORK_BOARD_ACTIONS = [
  'openTicketWorkspace',
  'startClaudeForTicket',
  'manageActiveTerminal',
  'chooseTicketProject',
  'insertJiraContext',
  'insertGitLabContext',
  'insertCiContext',
] as const;

export type JiraWorkBoardAction = typeof JIRA_WORK_BOARD_ACTIONS[number];

export interface JiraWorkBoardInput {
  state: KronosState | null;
  nonce: string;
  scriptUri: string;
  doneStatusNames?: readonly string[];
  hideCompletedByDefault?: boolean;
}

interface BoardTicket {
  key: string;
  ticket: Ticket;
  status: string;
  statusToken: string;
  completed: boolean;
  jiraProject: string;
  jiraProjectToken: string;
  localProject: string;
  localProjectToken: string;
  labels: string[];
  labelTokens: string[];
  searchText: string;
}

interface BoardColumn {
  status: string;
  statusToken: string;
  completed: boolean;
  tickets: BoardTicket[];
}

/** Pure HTML builder; command registration and provider reads stay in the extension runtime. */
export function buildJiraWorkBoardHtml(input: JiraWorkBoardInput): string {
  const customDoneStatuses = new Set(
    (input.doneStatusNames || []).map(filterToken).filter(Boolean),
  );
  const tickets = Object.entries(input.state?.tickets || {})
    .map(([key, ticket]) => normalizeBoardTicket(key, ticket, customDoneStatuses))
    .filter((ticket): ticket is BoardTicket => ticket !== null)
    .sort(compareBoardTickets);
  const columns = boardColumns(tickets);
  const statuses = uniqueFacet(tickets.map(ticket => ticket.status));
  const jiraProjects = uniqueFacet(tickets.map(ticket => ticket.jiraProject));
  const linkedProjectFilters = uniqueFacet(tickets.map(ticket => ticket.localProject));
  const labels = uniqueFacet(tickets.flatMap(ticket => ticket.labels));
  const completedCount = tickets.filter(ticket => ticket.completed).length;
  const hideCompletedByDefault = input.hideCompletedByDefault !== false;
  const initiallyVisibleCount = hideCompletedByDefault ? tickets.length - completedCount : tickets.length;
  const refreshedAt = safeSingleLine(input.state?.refreshedAt, 100);
  const localProjects = listLocalProjects(input.state);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  ${kronosWebviewBaseCss()}
  [hidden] { display: none !important; }
  .jira-board-shell { max-width: none; }
  .jira-board-header { align-items: center; }
  .jira-board-heading-actions { display: flex; align-items: center; gap: 8px; }
  .jira-board-filters { display: grid; grid-template-columns: minmax(220px, 2fr) repeat(4, minmax(130px, 1fr)) auto auto; gap: 8px; align-items: end; padding: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
  .jira-board-filter { display: grid; gap: 4px; min-width: 0; }
  .jira-board-filter label, .jira-board-toggle-label { color: var(--k-muted); font-size: 10px; font-weight: 650; text-transform: uppercase; }
  .jira-board-filter input, .jira-board-filter select { width: 100%; min-height: 30px; padding: 4px 8px; color: var(--k-fg); background: var(--vscode-input-background, var(--k-bg)); border: 1px solid var(--vscode-input-border, var(--k-border)); border-radius: var(--k-radius-sm); font: inherit; }
  .jira-board-filter input::placeholder { color: var(--vscode-input-placeholderForeground, var(--k-muted)); }
  .jira-board-toggle { display: flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 4px; white-space: nowrap; }
  .jira-board-toggle input { margin: 0; }
  .jira-board-reset { min-height: 30px; }
  .jira-board-summary { min-height: 20px; margin: 8px 2px 12px; color: var(--k-muted); font-size: 11px; }
  .jira-projects { display: grid; gap: 8px; margin-bottom: 12px; padding: 11px 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
  .jira-projects-header { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .jira-projects-header h2 { margin: 0; color: var(--k-fg); font-size: 12px; text-transform: none; }
  .jira-projects-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 7px; }
  .jira-project { min-width: 0; padding: 8px 9px; border: 1px solid var(--k-border); border-radius: var(--k-radius-sm); background: var(--k-surface-soft); }
  .jira-project-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .jira-project-name { font-weight: 650; }
  .jira-project-branch { color: var(--k-info); font-size: 10px; overflow-wrap: anywhere; }
  .jira-project-path { margin-top: 4px; color: var(--k-muted); font-size: 10px; overflow-wrap: anywhere; }
  .jira-board { display: flex; align-items: flex-start; gap: 10px; min-height: 360px; padding-bottom: 12px; overflow-x: auto; scrollbar-gutter: stable; }
  .jira-board-column { display: grid; flex: 1 0 280px; min-width: 280px; max-width: 380px; gap: 8px; padding: 9px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface-soft); }
  .jira-board-column-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; padding: 0 2px; color: var(--k-muted); font-size: 11px; font-weight: 650; text-transform: uppercase; }
  .jira-board-column-count { display: inline-flex; align-items: center; justify-content: center; min-width: 22px; min-height: 20px; padding: 0 6px; border-radius: 999px; color: var(--k-fg); background: var(--k-bg); }
  .jira-board-cards { display: grid; gap: 8px; }
  .jira-ticket-card { display: grid; gap: 8px; padding: 10px; border: 1px solid var(--k-border); border-left: 3px solid var(--k-info); border-radius: var(--k-radius); background: var(--k-surface); cursor: pointer; }
  .jira-ticket-card[data-ticket-type="bug"] { border-left-color: var(--k-danger); }
  .jira-ticket-card:hover, .jira-ticket-card:focus-within { border-color: var(--k-border-strong); background: var(--k-hover); }
  .jira-ticket-card:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--k-accent)); outline-offset: 2px; }
  .jira-ticket-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .jira-ticket-heading-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; }
  .jira-ticket-heading-actions .kronos-button { min-height: 23px; max-width: 170px; padding: 2px 7px; overflow: hidden; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .jira-ticket-key { color: var(--k-accent); font-size: 11px; font-weight: 700; }
  .jira-ticket-open { margin: 0; padding: 0; border: 0; color: var(--k-accent); background: transparent; font: inherit; cursor: pointer; }
  .jira-ticket-open:hover { text-decoration: underline; }
  .jira-ticket-open:focus-visible { outline: 1px solid var(--vscode-focusBorder, var(--k-accent)); outline-offset: 2px; }
  .jira-ticket-priority { color: var(--k-muted); font-size: 10px; }
  .jira-ticket-summary { font-size: 12px; font-weight: 550; line-height: 1.4; }
  .jira-ticket-meta, .jira-ticket-actions { display: flex; flex-wrap: wrap; gap: 5px; }
  .jira-ticket-chip { display: inline-flex; align-items: center; min-height: 18px; padding: 1px 7px; border: 1px solid var(--k-border); border-radius: 999px; color: var(--k-muted); background: var(--k-surface-soft); font-size: 10px; line-height: 1.2; }
  .jira-ticket-chip.project { color: var(--k-info); background: var(--k-info-bg); border-color: transparent; }
  .jira-ticket-chip.mr { color: var(--k-warn); background: var(--k-warn-bg); border-color: transparent; }
  .jira-ticket-chip.build { color: var(--k-ok); background: var(--k-ok-bg); border-color: transparent; }
  .jira-ticket-actions { padding-top: 2px; border-top: 1px solid var(--k-border); }
  .jira-ticket-actions .kronos-button { min-height: 25px; padding: 3px 7px; font-size: 10px; }
  .jira-ticket-actions .primary { font-weight: 700; }
  .jira-board-empty { width: min(520px, 100%); }
  @media (max-width: 980px) {
    .jira-board-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .jira-board-filter.search { grid-column: 1 / -1; }
  }
  @media (max-width: 580px) {
    body { padding: 14px; }
    .jira-board-filters { grid-template-columns: 1fr; }
    .jira-board-filter.search { grid-column: auto; }
    .jira-board-column { min-width: 250px; flex-basis: 250px; }
  }
</style>
${webviewRuntimeScriptTag(input.nonce, webviewRuntimeScriptUri(input.scriptUri))}
<script nonce="${escapeAttr(input.nonce)}" id="kronos-jira-work-board-script" defer src="${escapeAttr(input.scriptUri)}" data-kronos-script-kind="jira-work-board" data-kronos-webview-name="Kronos Jira Work Board" data-kronos-ready-command="${escapeAttr(WEBVIEW_READY_COMMAND)}"></script>
</head>
<body>
<main class="kronos-shell jira-board-shell">
  <header class="kronos-header jira-board-header">
    <div>
      <h1 class="kronos-title">Jira Work Board</h1>
      <div class="kronos-subtitle">${tickets.length} ticket${tickets.length === 1 ? '' : 's'}${refreshedAt ? ` · refreshed ${escapeHtml(refreshedAt)}` : ''}. Open a workspace or start Claude for the ticket you choose.</div>
    </div>
  </header>

  <section class="jira-projects" aria-label="Registered local projects">
    <div class="jira-projects-header"><h2>Local Projects</h2><span class="kronos-subtitle">Branch is read locally from Git HEAD</span></div>
    ${localProjects.length > 0
    ? `<div class="jira-projects-grid">${localProjects.map(project => `<div class="jira-project"><div class="jira-project-heading"><span class="jira-project-name">${escapeHtml(project.name)}</span><span class="jira-project-branch">${escapeHtml(project.branch || (project.available ? 'branch unavailable' : 'folder unavailable'))}</span></div><div class="jira-project-path">${escapeHtml(project.path)}</div></div>`).join('')}</div>`
    : '<div class="kronos-empty">No local projects registered. Open a project folder or configure discovery roots, then use Discover and Manage Local Projects from the Work toolbar.</div>'}
  </section>

  <section class="jira-board-filters" aria-label="Jira board filters">
    <div class="jira-board-filter search">
      <label for="jira-board-search">Search</label>
      <input id="jira-board-search" type="search" placeholder="Key, summary, Jira project, local project, label…" autocomplete="off">
    </div>
    ${selectFilter('jira-board-status', 'Status', statuses)}
    ${selectFilter('jira-board-jira-project', 'Jira project', jiraProjects)}
    ${selectFilter('jira-board-local-project', 'Local project', linkedProjectFilters)}
    ${selectFilter('jira-board-label', 'Label', labels)}
    <label class="jira-board-toggle" for="jira-board-hide-done">
      <input id="jira-board-hide-done" type="checkbox" data-default-checked="${hideCompletedByDefault ? 'true' : 'false'}"${hideCompletedByDefault ? ' checked' : ''}>
      <span class="jira-board-toggle-label">Hide completed</span>
    </label>
    <button id="jira-board-reset" class="kronos-button jira-board-reset" type="button">Reset</button>
  </section>
  <div id="jira-board-filter-summary" class="jira-board-summary" aria-live="polite">${initiallyVisibleCount} of ${tickets.length} shown${hideCompletedByDefault && completedCount > 0 ? ` · ${completedCount} completed hidden` : ''}</div>

  <section id="jira-work-board" class="jira-board" aria-label="Jira tickets by status">
    ${columns.map(column => buildColumnHtml(column, hideCompletedByDefault)).join('')}
    ${tickets.length === 0 ? '<div class="kronos-empty jira-board-empty">No Jira tickets are loaded. Refresh Work after configuring Jira in Kronos Doctor.</div>' : ''}
  </section>
  <div id="jira-board-no-matches" class="kronos-empty jira-board-empty" hidden>No tickets match these filters.</div>
</main>
</body>
</html>`;
}

export function isCompletedJiraStatus(status: unknown, additionalDoneStatuses: ReadonlySet<string> = new Set()): boolean {
  const token = filterToken(status);
  if (!token) { return false; }
  return isCompletedWorkTicket({ jira_status: additionalDoneStatuses.has(token) ? 'Done' : safeSingleLine(status, 160) });
}

function normalizeBoardTicket(
  keyValue: string,
  ticket: Ticket,
  customDoneStatuses: ReadonlySet<string>,
): BoardTicket | null {
  const key = normalizeTicketKey(keyValue);
  if (!key) { return null; }
  const status = safeSingleLine(ticket.jira_status, 160) || 'Unknown';
  const jiraProject = safeSingleLine(ticket.jira_project_key, 200);
  const localProject = safeSingleLine(ticket.linked_local_project, 200);
  const labels = uniqueFacet(ticket.labels || []);
  return {
    key,
    ticket,
    status,
    statusToken: filterToken(status),
    completed: isCompletedBoardTicket(ticket, customDoneStatuses),
    jiraProject,
    jiraProjectToken: filterToken(jiraProject),
    localProject,
    localProjectToken: filterToken(localProject),
    labels,
    labelTokens: labels.map(filterToken),
    searchText: [
      key,
      safeSingleLine(ticket.summary, 1_000),
      safeSingleLine(ticket.description, 2_000),
      safeSingleLine(ticket.type, 160),
      safeSingleLine(ticket.priority, 160),
      status,
      safeSingleLine(ticket.jira_status_category, 100),
      jiraProject,
      localProject,
      ...labels,
      safeSingleLine(ticket.mr?.title, 1_000),
      safeSingleLine(ticket.mr?.state, 100),
      safeSingleLine(ticket.mr?.review_status, 100),
      safeSingleLine(ticket.build?.status, 100),
    ].map(filterToken).filter(Boolean).join(' '),
  };
}

function boardColumns(tickets: readonly BoardTicket[]): BoardColumn[] {
  const byStatus = new Map<string, BoardColumn>();
  for (const ticket of tickets) {
    let column = byStatus.get(ticket.statusToken);
    if (!column) {
      column = {
        status: ticket.status,
        statusToken: ticket.statusToken,
        completed: ticket.completed,
        tickets: [],
      };
      byStatus.set(ticket.statusToken, column);
    }
    column.tickets.push(ticket);
  }
  return [...byStatus.values()].sort(compareColumns);
}

function compareColumns(left: BoardColumn, right: BoardColumn): number {
  if (left.completed !== right.completed) { return left.completed ? 1 : -1; }
  const rank = statusRank(left.status) - statusRank(right.status);
  return rank || left.status.localeCompare(right.status);
}

function statusRank(status: string): number {
  const token = filterToken(status);
  if (/backlog|icebox/.test(token)) { return 10; }
  if (/review|test|qa|verify/.test(token)) { return 40; }
  if (/selected|ready|to do|todo|open|new/.test(token)) { return 20; }
  if (/progress|develop|implement/.test(token)) { return 30; }
  if (/block|hold|imped/.test(token)) { return 50; }
  if (isCompletedJiraStatus(status)) { return 90; }
  return 60;
}

function isCompletedBoardTicket(ticket: Ticket, additionalDoneStatuses: ReadonlySet<string>): boolean {
  return isCompletedWorkTicket(ticket, additionalDoneStatuses);
}

function compareBoardTickets(left: BoardTicket, right: BoardTicket): number {
  const updatedDifference = timestamp(right.ticket.updated) - timestamp(left.ticket.updated);
  return updatedDifference || left.key.localeCompare(right.key);
}

function buildColumnHtml(column: BoardColumn, hideCompletedByDefault: boolean): string {
  const visibleByDefault = !hideCompletedByDefault || !column.completed;
  return `<section class="jira-board-column" data-status-column="${escapeAttr(column.statusToken)}" data-completed-column="${column.completed ? 'true' : 'false'}"${visibleByDefault ? '' : ' hidden'}>
    <header class="jira-board-column-header"><span>${escapeHtml(column.status)}</span><span class="jira-board-column-count" data-column-count>${visibleByDefault ? column.tickets.length : 0}</span></header>
    <div class="jira-board-cards">${column.tickets.map(buildTicketCardHtml).join('')}</div>
  </section>`;
}

function buildTicketCardHtml(ticket: BoardTicket): string {
  const value = ticket.ticket;
  const summary = safeSingleLine(value.summary, 1_000) || 'Untitled ticket';
  const priority = safeSingleLine(value.priority, 120);
  const type = safeSingleLine(value.type, 120) || 'Issue';
  const typeKind = /bug|defect/i.test(type) ? 'bug' : 'issue';
  const jiraProject = ticket.jiraProject;
  const launchProject = ticket.localProject;
  const projectChips = [
    jiraProject ? chip(`Jira: ${jiraProject}`, 'project') : '',
    launchProject ? chip(`Project: ${launchProject}`, 'project') : '',
  ].join('');
  const labelChips = ticket.labels.slice(0, 4).map(label => chip(label, '')).join('');
  const overflowCount = Math.max(0, ticket.labels.length - 4);
  const mrChip = value.mr
    ? chip(`MR !${value.mr.iid} · ${safeSingleLine(value.mr.review_status, 100) || value.mr.state}`, 'mr')
    : '';
  const buildChip = value.build
    ? chip(`Build #${value.build.number} · ${safeSingleLine(value.build.status, 100) || 'unknown'}`, 'build')
    : '';
  const attachmentCount = value.attachments?.length || 0;
  const attachmentChip = attachmentCount > 0
    ? chip(`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`, '')
    : '';
  const projectActionLabel = launchProject ? `Project: ${launchProject}` : '+ Add Project';
  return `<article class="jira-ticket-card" data-ticket-card data-ticket="${escapeAttr(ticket.key)}" data-status="${escapeAttr(ticket.statusToken)}" data-jira-project="${escapeAttr(ticket.jiraProjectToken)}" data-local-project="${escapeAttr(ticket.localProjectToken)}" data-labels="${escapeAttr(JSON.stringify(ticket.labelTokens))}" data-search="${escapeAttr(ticket.searchText)}" data-completed="${ticket.completed ? 'true' : 'false'}" data-ticket-type="${typeKind}">
    <div class="jira-ticket-heading"><button type="button" class="jira-ticket-key jira-ticket-open" data-action="openTicketWorkspace" data-ticket="${escapeAttr(ticket.key)}" aria-label="Open ${escapeAttr(ticket.key)}: ${escapeAttr(summary)}">${escapeHtml(ticket.key)}</button><div class="jira-ticket-heading-actions">${actionButton('chooseTicketProject', projectActionLabel, ticket.key)}<span class="jira-ticket-priority">${escapeHtml(priority || type)}</span></div></div>
    <div class="jira-ticket-summary">${escapeHtml(summary)}</div>
    <div class="jira-ticket-meta">${projectChips}${labelChips}${overflowCount > 0 ? chip(`+${overflowCount} more`, '') : ''}${mrChip}${buildChip}${attachmentChip}</div>
    <div class="jira-ticket-actions" aria-label="Actions for ${escapeAttr(ticket.key)}">
      ${actionButton('startClaudeForTicket', 'Start Claude', ticket.key, true)}
      ${actionButton('openTicketWorkspace', 'Workspace', ticket.key)}
      ${actionButton('manageActiveTerminal', 'Manage Focused', ticket.key)}
      ${actionButton('insertJiraContext', `[${ticket.key}]`, ticket.key)}
      ${actionButton('insertGitLabContext', 'Insert MR Evidence', ticket.key)}
      ${actionButton('insertCiContext', 'Insert CI Evidence', ticket.key)}
    </div>
  </article>`;
}

function actionButton(action: JiraWorkBoardAction, label: string, ticket: string, primary = false): string {
  return `<button type="button" class="kronos-button${primary ? ' primary' : ''}" data-action="${action}" data-ticket="${escapeAttr(ticket)}">${escapeHtml(label)}</button>`;
}

function chip(label: string, className: string): string {
  return `<span class="jira-ticket-chip${className ? ` ${className}` : ''}">${escapeHtml(label)}</span>`;
}

function selectFilter(id: string, label: string, values: readonly string[]): string {
  const options = values.map(value => `<option value="${escapeAttr(filterToken(value))}">${escapeHtml(value)}</option>`).join('');
  const allLabel = label === 'Status' ? 'All statuses' : `All ${label.toLowerCase()}s`;
  return `<div class="jira-board-filter"><label for="${id}">${label}</label><select id="${id}"><option value="">${escapeHtml(allLabel)}</option>${options}</select></div>`;
}

function uniqueFacet(values: readonly string[]): string[] {
  const retained = new Map<string, string>();
  for (const raw of values) {
    const value = safeSingleLine(raw, 200);
    const token = filterToken(value);
    if (value && token && !retained.has(token)) { retained.set(token, value); }
  }
  return [...retained.values()].sort((left, right) => left.localeCompare(right));
}

function normalizeTicketKey(value: unknown): string {
  if (typeof value !== 'string') { return ''; }
  const key = value.trim().toUpperCase();
  return /^[A-Z][A-Z0-9_]*-[0-9]{1,12}$/.test(key) ? key : '';
}

function filterToken(value: unknown): string {
  return safeSingleLine(value, 2_000).toLocaleLowerCase();
}

function safeSingleLine(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
    : '';
}

function timestamp(value: string | undefined): number {
  if (!value) { return 0; }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
