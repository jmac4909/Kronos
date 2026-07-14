import type { KronosState, Project, Ticket } from '../state/types';
import type { JiraWorkListSnapshot } from './jiraRestClient';
import { isRecord } from './records';

export interface JiraWorkCatalogResult {
  state: KronosState;
  retainedFromPrevious: number;
}

/** Converts a bounded Jira search snapshot into the small private Work catalog. */
export function catalogFromJiraWorkList(
  snapshot: JiraWorkListSnapshot,
  current: KronosState,
  jiraBaseUrl: string,
): JiraWorkCatalogResult {
  const projects: Record<string, Project> = { ...current.projects };
  const tickets: Record<string, Ticket> = {};
  const baseUrl = jiraBaseUrl.replace(/\/+$/, '');
  let rejectedIssueCount = 0;
  for (const value of snapshot.issues) {
    const issue = isRecord(value) ? value : undefined;
    const key = normalizedIssueKey(issue?.['key']);
    const fields = isRecord(issue?.['fields']) ? issue['fields'] : undefined;
    const summary = providerText(fields?.['summary']);
    if (!key || !fields || !summary) {
      rejectedIssueCount += 1;
      continue;
    }
    const previous = current.tickets[key];
    const projectKey = nestedProviderText(fields['project'], 'key') || previous?.jira_project_key;
    const rawStatus = fields['status'];
    const statusName = nestedProviderText(rawStatus, 'name');
    const ticket: Ticket = {
      summary,
      type: nestedProviderText(fields['issuetype'], 'name') || previous?.type || 'Issue',
      priority: nestedProviderText(fields['priority'], 'name') || previous?.priority || 'Unknown',
      jira_status: statusName || previous?.jira_status || 'Unknown',
      source: 'jira',
      projects: [],
      mr: previous?.mr || null,
      build: previous?.build || null,
      jira_url: `${baseUrl}/browse/${encodeURIComponent(key)}`,
    };
    if (projectKey) { ticket.jira_project_key = projectKey; }
    const statusCategory = jiraStatusCategory(rawStatus)
      || (!statusName ? previous?.jira_status_category : undefined);
    if (statusCategory) { ticket.jira_status_category = statusCategory; }
    if (previous?.launch_project && projects[previous.launch_project]?.path) {
      ticket.launch_project = previous.launch_project;
    }
    const updated = providerText(fields['updated']);
    const labels = Array.isArray(fields['labels'])
      ? fields['labels'].map(providerText).filter((item): item is string => Boolean(item)).slice(0, 500)
      : [];
    if (updated) { ticket.updated = updated; }
    if (labels.length > 0) { ticket.labels = [...new Set(labels)]; }
    const description = jiraDescriptionText(fields['description']);
    if (description) {
      ticket.description = description;
    } else if (!Object.prototype.hasOwnProperty.call(fields, 'description') && previous?.description) {
      ticket.description = previous.description;
    }
    const attachments = jiraAttachmentMetadata(fields['attachment']);
    if (attachments) {
      if (attachments.length > 0) { ticket.attachments = attachments; }
    } else if (previous?.attachments) {
      ticket.attachments = previous.attachments.map(item => ({ ...item }));
    }
    tickets[key] = ticket;
  }

  let retainedFromPrevious = 0;
  if (!snapshot.complete || rejectedIssueCount > 0) {
    for (const [key, ticket] of Object.entries(current.tickets)) {
      if (tickets[key]) { continue; }
      tickets[key] = ticket;
      retainedFromPrevious += 1;
    }
  }
  return {
    state: { schemaVersion: 1, refreshedAt: snapshot.fetchedAt, projects, tickets },
    retainedFromPrevious,
  };
}

function normalizedIssueKey(value: unknown): string | undefined {
  const key = providerText(value)?.toUpperCase();
  return key && /^[A-Z][A-Z0-9_]*-\d{1,12}$/.test(key) ? key : undefined;
}

function nestedProviderText(value: unknown, key: string): string | undefined {
  return isRecord(value) ? providerText(value[key]) : undefined;
}

function jiraStatusCategory(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value['statusCategory'])) { return undefined; }
  return providerText(value['statusCategory']['key']) || providerText(value['statusCategory']['name']);
}

function providerText(value: unknown): string | undefined {
  if (typeof value !== 'string') { return undefined; }
  const normalized = value.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function jiraDescriptionText(value: unknown): string | undefined {
  if (typeof value === 'string') { return providerMultilineText(value); }
  if (!isRecord(value) && !Array.isArray(value)) { return undefined; }
  const fragments: string[] = [];
  let visited = 0;
  let textLength = 0;
  const visit = (node: unknown, depth: number): void => {
    if (depth > 32 || visited >= 10_000 || textLength >= 32_000) { return; }
    visited += 1;
    if (typeof node === 'string') {
      fragments.push(node);
      textLength += node.length;
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) { visit(child, depth + 1); }
      return;
    }
    if (!isRecord(node)) { return; }
    if (typeof node['text'] === 'string') {
      fragments.push(node['text']);
      textLength += node['text'].length;
    }
    const type = typeof node['type'] === 'string' ? node['type'] : '';
    if (type === 'hardBreak') { fragments.push('\n'); }
    const content = node['content'];
    if (Array.isArray(content)) {
      for (const child of content) { visit(child, depth + 1); }
    }
    if (type === 'paragraph' || type === 'heading' || type === 'listItem'
      || type === 'bulletList' || type === 'orderedList' || type === 'codeBlock') {
      fragments.push('\n');
    }
  };
  visit(value, 0);
  return providerMultilineText(fragments.join('').slice(0, 32_000));
}

function providerMultilineText(value: string): string | undefined {
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001f\u007f\u2028\u2029]/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .replace(/ *\r?\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return normalized ? normalized.slice(0, 32_000) : undefined;
}

function jiraAttachmentMetadata(value: unknown): Ticket['attachments'] | undefined {
  if (!Array.isArray(value)) { return undefined; }
  const attachments: NonNullable<Ticket['attachments']> = [];
  for (const candidate of value.slice(0, 200)) {
    if (!isRecord(candidate)) { continue; }
    const filename = providerText(candidate['filename']);
    if (!filename) { continue; }
    const rawSize = candidate['size'];
    const size = typeof rawSize === 'number' && Number.isFinite(rawSize) && rawSize >= 0
      ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(rawSize))
      : 0;
    attachments.push({
      filename: filename.slice(0, 1_000),
      size,
      mimeType: providerText(candidate['mimeType']) || 'application/octet-stream',
    });
  }
  return attachments;
}
