import { JiraTicketSnapshot, normalizeJiraIssueKey } from './jiraRestClient';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';

export type JiraContextValue = string | number | boolean | null | JiraContextValue[] | { [key: string]: JiraContextValue };

export interface JiraContextField {
  id: string;
  name: string;
  custom: boolean;
  value: JiraContextValue;
  text: string;
  schema?: JiraContextValue;
}

export interface JiraAttachmentContext {
  filename: string;
  id?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: string;
  contentUrl?: string;
  thumbnailUrl?: string;
  metadata: { [key: string]: JiraContextValue };
}

export interface JiraCommentContext {
  body: string;
  id?: string;
  author?: string;
  authorAccountId?: string;
  created?: string;
  updated?: string;
  metadata: { [key: string]: JiraContextValue };
}

export interface JiraTicketContextCompleteness {
  source: 'jira-rest' | 'kronos-state-fallback';
  complete: boolean;
  allFieldsFetched: boolean;
  commentsComplete: boolean;
  commentsFetched: number;
  attachmentsMetadataOnly: true;
  fieldCount: number;
  customFieldCount: number;
  expectedCommentCount?: number;
  commentPageCount?: number;
  commentResponseBytes?: number;
  warnings: string[];
}

export interface JiraTicketContext {
  schemaVersion: 1;
  key: string;
  title: string;
  summary: string;
  description: string;
  url?: string;
  fetchedAt: string;
  project?: string;
  issueType?: string;
  status?: string;
  priority?: string;
  resolution?: string;
  assignee?: string;
  reporter?: string;
  creator?: string;
  created?: string;
  updated?: string;
  dueDate?: string;
  labels: string[];
  components: string[];
  fixVersions: string[];
  attachments: JiraAttachmentContext[];
  comments: JiraCommentContext[];
  coreFields: JiraContextField[];
  customFields: JiraContextField[];
  completeness: JiraTicketContextCompleteness;
}

export interface JiraFallbackTicket {
  [key: string]: unknown;
}

export function normalizeJiraTicketContext(
  ticketKey: string,
  snapshot: JiraTicketSnapshot | unknown,
  fallbackTicket?: JiraFallbackTicket,
): JiraTicketContext {
  const key = normalizeJiraIssueKey(ticketKey);
  const snapshotRecord = isRecord(snapshot) ? snapshot : {};
  const issue = isRecord(snapshotRecord['issue'])
    ? snapshotRecord['issue']
    : isRecord(snapshot) && isRecord(snapshot['fields'])
      ? snapshot
      : undefined;
  if (!issue) {
    return buildFallbackJiraTicketContext(
      key,
      fallbackTicket || {},
      arrayFromUnknown(snapshotRecord['comments']),
      stringArray(snapshotRecord['warnings']),
    );
  }

  const fields = isRecord(issue['fields']) ? issue['fields'] : {};
  const names = isRecord(issue['names']) ? issue['names'] : {};
  const schemas = isRecord(issue['schema']) ? issue['schema'] : {};
  const normalizedFields = normalizeFields(fields, names, schemas);
  const coreFields = normalizedFields.filter(field => !field.custom);
  const customFields = normalizedFields.filter(field => field.custom);
  const fetchedComments = Array.isArray(snapshotRecord['comments']) ? snapshotRecord['comments'] : [];
  const snapshotComments = fetchedComments.length > 0 || snapshotRecord['commentsComplete'] === true
    ? fetchedComments
    : commentsFromIssueFields(fields);
  const comments = snapshotComments.map(normalizeComment);
  const attachments = arrayFromUnknown(fields['attachment']).map(normalizeAttachment);
  const summary = adfToText(fields['summary']);
  const description = adfToText(fields['description']);
  const commentsComplete = typeof snapshotRecord['commentsComplete'] === 'boolean'
    ? snapshotRecord['commentsComplete']
    : commentsAreCompleteInIssueFields(fields);
  const commentTotal = nonNegativeInteger(snapshotRecord['commentTotal'])
    ?? issueCommentTotal(fields);
  const commentPageCount = nonNegativeInteger(snapshotRecord['commentPageCount']);
  const commentResponseBytes = nonNegativeInteger(snapshotRecord['commentResponseBytes']);
  const allFieldsFetched = isRecord(issue['names']) && isRecord(issue['schema']);
  const warnings = stringArray(snapshotRecord['warnings']);
  if (!allFieldsFetched) {
    warnings.push('Jira field names or schema metadata were unavailable; field labels may be incomplete.');
  }
  if (!commentsComplete) {
    warnings.push('Jira comments may be incomplete.');
  }
  if (attachments.length > 0) {
    warnings.push(`${attachments.length} Jira attachment bod${attachments.length === 1 ? 'y was' : 'ies were'} not downloaded; attachment metadata is included.`);
  }
  const completeness: JiraTicketContextCompleteness = {
    source: 'jira-rest',
    complete: allFieldsFetched && commentsComplete && attachments.length === 0,
    allFieldsFetched,
    commentsComplete,
    commentsFetched: comments.length,
    attachmentsMetadataOnly: true,
    fieldCount: normalizedFields.length,
    customFieldCount: customFields.length,
    warnings: uniqueStrings(warnings),
  };
  if (commentTotal !== undefined) { completeness.expectedCommentCount = commentTotal; }
  if (commentPageCount !== undefined) { completeness.commentPageCount = commentPageCount; }
  if (commentResponseBytes !== undefined) { completeness.commentResponseBytes = commentResponseBytes; }

  const context: JiraTicketContext = {
    schemaVersion: 1,
    key,
    title: summary,
    summary,
    description,
    fetchedAt: optionalTrimmedStringFromUnknown(snapshotRecord['fetchedAt']) || new Date().toISOString(),
    labels: stringArray(fields['labels']),
    components: namedValueArray(fields['components']),
    fixVersions: namedValueArray(fields['fixVersions']),
    attachments,
    comments,
    coreFields,
    customFields,
    completeness,
  };
  assignString(context, 'url', firstString(snapshotRecord['issueUrl'], issue['self']));
  assignString(context, 'project', namedValue(fields['project']));
  assignString(context, 'issueType', namedValue(fields['issuetype']));
  assignString(context, 'status', namedValue(fields['status']));
  assignString(context, 'priority', namedValue(fields['priority']));
  assignString(context, 'resolution', namedValue(fields['resolution']));
  assignString(context, 'assignee', namedValue(fields['assignee']));
  assignString(context, 'reporter', namedValue(fields['reporter']));
  assignString(context, 'creator', namedValue(fields['creator']));
  assignString(context, 'created', fields['created']);
  assignString(context, 'updated', fields['updated']);
  assignString(context, 'dueDate', fields['duedate']);
  return context;
}

export function buildFallbackJiraTicketContext(
  ticketKey: string,
  ticket: JiraFallbackTicket,
  comments: readonly unknown[],
  warnings: readonly string[] = [],
): JiraTicketContext {
  const key = normalizeJiraIssueKey(ticketKey);
  const summary = firstString(ticket['summary'], ticket['title']) || key;
  const description = adfToText(ticket['description']);
  const normalizedFields = normalizeFields(ticket, {}, {});
  const coreFields = normalizedFields.filter(field => !field.custom);
  const customFields = normalizedFields.filter(field => field.custom);
  const normalizedComments = comments.map(normalizeComment);
  const fallbackWarnings = uniqueStrings([
    'Native Jira REST context was unavailable; this artifact contains cached Kronos ticket data.',
    ...warnings,
  ]);
  const context: JiraTicketContext = {
    schemaVersion: 1,
    key,
    title: summary,
    summary,
    description,
    fetchedAt: new Date().toISOString(),
    labels: stringArray(ticket['labels']),
    components: namedValueArray(ticket['components']),
    fixVersions: namedValueArray(ticket['fixVersions'] ?? ticket['fixVersion']),
    attachments: arrayFromUnknown(ticket['attachments']).map(normalizeAttachment),
    comments: normalizedComments,
    coreFields,
    customFields,
    completeness: {
      source: 'kronos-state-fallback',
      complete: false,
      allFieldsFetched: false,
      commentsComplete: false,
      commentsFetched: normalizedComments.length,
      attachmentsMetadataOnly: true,
      fieldCount: normalizedFields.length,
      customFieldCount: customFields.length,
      warnings: fallbackWarnings,
    },
  };
  assignString(context, 'url', firstString(ticket['jira_url'], ticket['jiraUrl'], ticket['url']));
  assignString(context, 'project', namedValue(ticket['project']));
  assignString(context, 'issueType', firstString(ticket['type'], namedValue(ticket['issuetype'])));
  assignString(context, 'status', firstString(ticket['jira_status'], namedValue(ticket['status'])));
  assignString(context, 'priority', namedValue(ticket['priority']));
  assignString(context, 'resolution', namedValue(ticket['resolution']));
  assignString(context, 'assignee', namedValue(ticket['assignee']));
  assignString(context, 'reporter', namedValue(ticket['reporter']));
  assignString(context, 'creator', namedValue(ticket['creator']));
  assignString(context, 'created', firstString(ticket['created'], ticket['created_at']));
  assignString(context, 'updated', firstString(ticket['updated'], ticket['updated_at']));
  assignString(context, 'dueDate', firstString(ticket['duedate'], ticket['dueDate']));
  return context;
}

export function adfToText(value: unknown): string {
  if (typeof value === 'string') { return value.trim(); }
  if (value === undefined || value === null) { return ''; }
  if (Array.isArray(value)) {
    return cleanAdfText(value.map(item => renderAdfNode(item)).join(''));
  }
  if (!isRecord(value)) { return String(value); }
  if (Array.isArray(value['content']) || typeof value['type'] === 'string') {
    return cleanAdfText(renderAdfNode(value));
  }
  return readableText(normalizeContextValue(value));
}

export function normalizeContextValue(value: unknown): JiraContextValue {
  return normalizeContextValueInternal(value, new WeakSet<object>(), 0);
}

function normalizeFields(
  fields: Record<string, unknown>,
  names: Record<string, unknown>,
  schemas: Record<string, unknown>,
): JiraContextField[] {
  return Object.entries(fields).map(([id, rawValue]) => {
    const schema = schemas[id];
    const normalizedValue = normalizeContextValue(id === 'attachment' ? sanitizeAttachmentField(rawValue) : rawValue);
    const field: JiraContextField = {
      id,
      name: optionalTrimmedStringFromUnknown(names[id]) || id,
      custom: id.startsWith('customfield_') || isCustomFieldSchema(schema),
      value: normalizedValue,
      text: readableText(normalizedValue),
    };
    if (schema !== undefined) {
      field.schema = normalizeContextValue(schema);
    }
    return field;
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function normalizeAttachment(value: unknown): JiraAttachmentContext {
  const attachment = isRecord(value) ? value : {};
  const filename = firstString(attachment['filename'], attachment['name']) || 'attachment';
  const metadataSource = sanitizeProviderMetadata(attachment);
  const normalized: JiraAttachmentContext = {
    filename,
    metadata: isRecord(metadataSource) ? normalizedRecord(metadataSource) : {},
  };
  assignString(normalized, 'id', attachment['id']);
  const size = nonNegativeInteger(attachment['size']);
  if (size !== undefined) { normalized.size = size; }
  assignString(normalized, 'mimeType', firstString(attachment['mimeType'], attachment['mimetype']));
  assignString(normalized, 'created', attachment['created']);
  assignString(normalized, 'author', namedValue(attachment['author']));
  assignString(normalized, 'contentUrl', sanitizedProviderUrl(firstString(attachment['content'], attachment['self'])));
  assignString(normalized, 'thumbnailUrl', sanitizedProviderUrl(firstString(attachment['thumbnail'])));
  return normalized;
}

function normalizeComment(value: unknown): JiraCommentContext {
  const comment = isRecord(value) ? value : {};
  const metadataSource = { ...comment };
  delete metadataSource['body'];
  const safeMetadata = sanitizeProviderMetadata(metadataSource);
  const normalized: JiraCommentContext = {
    body: adfToText(comment['body'] ?? value),
    metadata: isRecord(safeMetadata) ? normalizedRecord(safeMetadata) : {},
  };
  assignString(normalized, 'id', comment['id']);
  assignString(normalized, 'author', firstString(
    namedValue(comment['author']),
    comment['authorName'],
    comment['author_name'],
  ));
  if (isRecord(comment['author'])) {
    assignString(normalized, 'authorAccountId', comment['author']['accountId']);
  }
  assignString(normalized, 'created', firstString(comment['created'], comment['created_at']));
  assignString(normalized, 'updated', firstString(comment['updated'], comment['updated_at']));
  return normalized;
}

function sanitizeAttachmentField(value: unknown): unknown {
  return arrayFromUnknown(value).map(item => isRecord(item) ? sanitizeProviderMetadata(item) : item);
}

function sanitizeProviderMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderMetadata);
  }
  if (!isRecord(value)) {
    return value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && (/(?:url|self|content|thumbnail)$/i.test(key) || /^(?:https?:)?\/\//i.test(item))) {
      sanitized[key] = sanitizedProviderUrl(item) || null;
    } else {
      sanitized[key] = sanitizeProviderMetadata(item);
    }
  }
  return sanitized;
}

function sanitizedProviderUrl(value: string): string | undefined {
  if (!value) { return undefined; }
  try {
    const url = new URL(value, 'https://kronos.invalid');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.origin === 'https://kronos.invalid' ? url.pathname : url.toString();
  } catch {
    return undefined;
  }
}

function commentsFromIssueFields(fields: Record<string, unknown>): unknown[] {
  const commentContainer = isRecord(fields['comment']) ? fields['comment'] : {};
  return arrayFromUnknown(commentContainer['comments']);
}

function commentsAreCompleteInIssueFields(fields: Record<string, unknown>): boolean {
  const commentContainer = isRecord(fields['comment']) ? fields['comment'] : undefined;
  if (!commentContainer) { return false; }
  if (commentContainer['isLast'] === true) { return true; }
  const comments = arrayFromUnknown(commentContainer['comments']);
  const total = nonNegativeInteger(commentContainer['total']);
  return total !== undefined && comments.length >= total;
}

function issueCommentTotal(fields: Record<string, unknown>): number | undefined {
  const commentContainer = isRecord(fields['comment']) ? fields['comment'] : undefined;
  return commentContainer ? nonNegativeInteger(commentContainer['total']) : undefined;
}

function namedValueArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return uniqueStrings(values.map(namedValue).filter(Boolean));
}

function namedValue(value: unknown): string {
  if (typeof value === 'string') { return value.trim(); }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  if (!isRecord(value)) { return ''; }
  return firstString(
    value['displayName'],
    value['name'],
    value['value'],
    value['key'],
    value['summary'],
    value['emailAddress'],
    value['accountId'],
  );
}

function normalizeContextValueInternal(value: unknown, seen: WeakSet<object>, depth: number): JiraContextValue {
  if (value === null || value === undefined) { return null; }
  if (typeof value === 'string' || typeof value === 'boolean') { return value; }
  if (typeof value === 'number') { return Number.isFinite(value) ? value : String(value); }
  if (typeof value === 'bigint') { return value.toString(); }
  if (typeof value !== 'object') { return String(value); }
  if (depth >= 40) { return '[Maximum depth reached]'; }
  if (seen.has(value)) { return '[Circular value]'; }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => normalizeContextValueInternal(item, seen, depth + 1));
    }
    if (isRecord(value) && isAdfDocument(value)) {
      return adfToText(value);
    }
    const result: { [key: string]: JiraContextValue } = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = normalizeContextValueInternal(item, seen, depth + 1);
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function normalizedRecord(value: Record<string, unknown>): { [key: string]: JiraContextValue } {
  const normalized = normalizeContextValue(value);
  return isContextRecord(normalized) ? normalized : {};
}

function isContextRecord(value: JiraContextValue): value is { [key: string]: JiraContextValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAdfDocument(value: Record<string, unknown>): boolean {
  return value['type'] === 'doc' && Array.isArray(value['content']);
}

function isCustomFieldSchema(value: unknown): boolean {
  if (!isRecord(value)) { return false; }
  return value['custom'] === true
    || Boolean(optionalTrimmedStringFromUnknown(value['custom']))
    || nonNegativeInteger(value['customId']) !== undefined;
}

function renderAdfNode(value: unknown): string {
  if (typeof value === 'string') { return value; }
  if (!isRecord(value)) { return ''; }
  const type = optionalTrimmedStringFromUnknown(value['type']) || '';
  const attrs = isRecord(value['attrs']) ? value['attrs'] : {};
  const content = arrayFromUnknown(value['content']);
  if (type === 'text') {
    const text = typeof value['text'] === 'string' ? value['text'] : '';
    const links = arrayFromUnknown(value['marks'])
      .filter(isRecord)
      .filter(mark => mark['type'] === 'link')
      .map(mark => isRecord(mark['attrs']) ? firstString(mark['attrs']['href']) : '')
      .filter(Boolean);
    return links.length > 0 ? `${text} (${uniqueStrings(links).join(', ')})` : text;
  }
  if (type === 'hardBreak') { return '\n'; }
  if (type === 'rule') { return '\n---\n'; }
  if (type === 'mention') { return firstString(attrs['text'], attrs['displayName'], attrs['id']); }
  if (type === 'emoji') { return firstString(attrs['text'], attrs['shortName'], attrs['id']); }
  if (type === 'date') { return firstString(attrs['timestamp']); }
  if (type === 'status') { return firstString(attrs['text']); }
  if (type === 'inlineCard' || type === 'blockCard' || type === 'embedCard') {
    return firstString(attrs['url'], attrs['data']);
  }
  if (type === 'media' || type === 'mediaSingle' || type === 'mediaGroup') {
    const label = firstString(attrs['alt'], attrs['filename'], attrs['id']);
    const nested = content.map(renderAdfNode).join('');
    return label ? `[Attachment: ${label}]${nested}` : nested;
  }
  if (type === 'bulletList' || type === 'orderedList') {
    const start = nonNegativeInteger(attrs['order']) || 1;
    return content.map((item, index) => {
      const itemText = cleanAdfText(renderAdfNode(item)).replace(/\n/g, '\n  ');
      const marker = type === 'orderedList' ? `${start + index}.` : '-';
      return `${marker} ${itemText}\n`;
    }).join('');
  }
  if (type === 'table') {
    return `${content.map(renderAdfNode).join('')}\n`;
  }
  if (type === 'tableRow') {
    return `${content.map(item => cleanAdfText(renderAdfNode(item))).join(' | ')}\n`;
  }
  if (type === 'tableCell' || type === 'tableHeader') {
    return content.map(renderAdfNode).join(' ').trim();
  }
  const rendered = content.map(renderAdfNode).join('');
  if (type === 'paragraph' || type === 'heading' || type === 'blockquote' || type === 'codeBlock' || type === 'panel') {
    return `${rendered}\n`;
  }
  return rendered;
}

function cleanAdfText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function readableText(value: JiraContextValue): string {
  if (value === null) { return ''; }
  if (typeof value === 'string') { return value; }
  if (typeof value === 'number' || typeof value === 'boolean') { return String(value); }
  if (Array.isArray(value)) {
    return value.map(readableText).filter(Boolean).join(', ');
  }
  const preferred = firstString(
    value['displayName'],
    value['name'],
    value['value'],
    value['key'],
    value['summary'],
  );
  return preferred || JSON.stringify(value, null, 2);
}

function stringArray(value: unknown): string[] {
  return uniqueStrings(arrayFromUnknown(value).map(item => firstString(item)).filter(Boolean));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const stringValue = optionalTrimmedStringFromUnknown(value);
    if (stringValue) { return stringValue; }
  }
  return '';
}

function nonNegativeInteger(value: unknown): number | undefined {
  const number = optionalFiniteNumberFromUnknown(value);
  return number !== undefined && number >= 0 ? Math.floor(number) : undefined;
}

function assignString<T extends object, K extends keyof T>(target: T, key: K, value: unknown): void {
  const normalized = optionalTrimmedStringFromUnknown(value);
  if (normalized) {
    target[key] = normalized as T[K];
  }
}
