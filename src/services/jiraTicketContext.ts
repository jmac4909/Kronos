import * as crypto from 'crypto';
import { JiraTicketSnapshot, normalizeJiraIssueKey } from './jiraRestClient';
import { arrayFromUnknown, isRecord, optionalFiniteNumberFromUnknown, optionalTrimmedStringFromUnknown } from './records';
import {
  isEmptyJiraRichText,
  pruneEmptyJiraValue,
  type JiraArtifactValue,
  type JiraUnprunedValue,
} from './jiraValuePruning';

const MAX_CONTEXT_TEXT_CHARS = 1024 * 1024;
const MAX_FIELD_TEXT_CHARS = 256 * 1024;
const MAX_NORMALIZED_CONTEXT_BYTES = 10 * 1024 * 1024;
const GLOBAL_CONTEXT_TRUNCATION = '[Truncated by Kronos global context safety limit]';
const SENSITIVE_FIELD_PATTERN = /^(?:authorization|cookie|set-cookie|credential|password|passwd|secret|token|api[_-]?key|private[_-]?key|access[_-]?token|client[_-]?secret)$/i;
const SENSITIVE_FIELD_LABEL_PATTERN = /(?:authorization|cookie|credential|password|passwd|secret|token|api[ _-]?key|private[ _-]?key|access[ _-]?token|client[ _-]?secret)/i;
const UNSAFE_ATTACHMENT_TEXT_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export type JiraContextValue = JiraArtifactValue;

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
  contentStatus: 'captured' | 'skipped' | 'failed';
  id?: string;
  size?: number;
  mimeType?: string;
  created?: string;
  author?: string;
  contentReason?: string;
  contentMimeType?: string;
  contentBytes?: number;
  contentSha256?: string;
  textSha256?: string;
  textContent?: string;
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
  attachmentsMetadataOnly: boolean;
  attachmentsComplete: boolean;
  attachmentsTotal: number;
  attachmentBodiesCaptured: number;
  attachmentBodiesSkipped: number;
  attachmentBodiesFailed: number;
  attachmentFetchCount: number;
  attachmentResponseBytes: number;
  fieldCount: number;
  customFieldCount: number;
  missingFieldNameIds: string[];
  missingFieldSchemaIds: string[];
  truncatedFieldIds: string[];
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
  const fieldNormalization = normalizeFields(fields, names, schemas);
  const normalizedFields = fieldNormalization.fields;
  const coreFields = normalizedFields.filter(field => !field.custom);
  const customFields = normalizedFields.filter(field => field.custom);
  const fetchedComments = Array.isArray(snapshotRecord['comments']) ? snapshotRecord['comments'] : [];
  const snapshotComments = fetchedComments.length > 0 || snapshotRecord['commentsComplete'] === true
    ? fetchedComments
    : commentsFromIssueFields(fields);
  const comments = snapshotComments.map(normalizeComment);
  const attachmentContents = arrayFromUnknown(snapshotRecord['attachmentContents']);
  const attachments = arrayFromUnknown(fields['attachment']).map((value, index) =>
    normalizeAttachment(value, attachmentContents[index], index));
  const summary = adfToText(fields['summary']);
  const description = adfToText(fields['description']);
  const commentsComplete = typeof snapshotRecord['commentsComplete'] === 'boolean'
    ? snapshotRecord['commentsComplete']
    : commentsAreCompleteInIssueFields(fields);
  const commentTotal = nonNegativeInteger(snapshotRecord['commentTotal'])
    ?? issueCommentTotal(fields);
  const commentPageCount = nonNegativeInteger(snapshotRecord['commentPageCount']);
  const commentResponseBytes = nonNegativeInteger(snapshotRecord['commentResponseBytes']);
  const attachmentFetchCount = nonNegativeInteger(snapshotRecord['attachmentFetchCount']) || 0;
  const attachmentResponseBytes = nonNegativeInteger(snapshotRecord['attachmentResponseBytes']) || 0;
  const attachmentBodiesCaptured = attachments.filter(item => item.contentStatus === 'captured').length;
  const attachmentBodiesSkipped = attachments.filter(item => item.contentStatus === 'skipped').length;
  const attachmentBodiesFailed = attachments.filter(item => item.contentStatus === 'failed').length;
  const attachmentsComplete = attachments.every(item => item.contentStatus === 'captured');
  const attachmentsMetadataOnly = attachments.length > 0 && attachmentBodiesCaptured === 0;
  const allFieldsFetched = isRecord(issue['names'])
    && isRecord(issue['schema'])
    && fieldNormalization.missingNameIds.length === 0
    && fieldNormalization.missingSchemaIds.length === 0;
  const fieldsUntruncated = fieldNormalization.truncatedIds.length === 0;
  const warnings = stringArray(snapshotRecord['warnings']);
  if (!allFieldsFetched) {
    warnings.push('Jira field names or schema metadata were unavailable for one or more visible returned fields.');
  }
  if (fieldNormalization.missingNameIds.length > 0) {
    warnings.push(`Jira field display names were missing for: ${fieldNormalization.missingNameIds.join(', ')}.`);
  }
  if (fieldNormalization.missingSchemaIds.length > 0) {
    warnings.push(`Jira field schema metadata was missing for: ${fieldNormalization.missingSchemaIds.join(', ')}.`);
  }
  if (!fieldsUntruncated) {
    warnings.push(`Jira field values were truncated at normalization safety limits for: ${fieldNormalization.truncatedIds.join(', ')}.`);
  }
  if (!commentsComplete) {
    warnings.push('Jira comments may be incomplete.');
  }
  if (!attachmentsComplete) {
    warnings.push(
      `Jira attachment bodies were partial: ${attachmentBodiesCaptured} captured, ${attachmentBodiesSkipped} skipped, and ${attachmentBodiesFailed} failed. Attachment metadata is included for all ${attachments.length}.`,
    );
  }
  const completeness: JiraTicketContextCompleteness = {
    source: 'jira-rest',
    complete: allFieldsFetched
      && fieldsUntruncated
      && commentsComplete
      && attachmentsComplete
      && uniqueStrings(warnings).length === 0,
    allFieldsFetched,
    commentsComplete,
    commentsFetched: comments.length,
    attachmentsMetadataOnly,
    attachmentsComplete,
    attachmentsTotal: attachments.length,
    attachmentBodiesCaptured,
    attachmentBodiesSkipped,
    attachmentBodiesFailed,
    attachmentFetchCount,
    attachmentResponseBytes,
    fieldCount: normalizedFields.length,
    customFieldCount: customFields.length,
    missingFieldNameIds: fieldNormalization.missingNameIds,
    missingFieldSchemaIds: fieldNormalization.missingSchemaIds,
    truncatedFieldIds: fieldNormalization.truncatedIds,
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
  assignString(context, 'url', sanitizedProviderUrl(firstString(snapshotRecord['issueUrl'], issue['self'])));
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
  return enforceNormalizedContextBudget(context);
}

export function buildFallbackJiraTicketContext(
  ticketKey: string,
  ticket: JiraFallbackTicket,
  comments: readonly unknown[],
  warnings: readonly string[] = [],
): JiraTicketContext {
  const key = normalizeJiraIssueKey(ticketKey);
  const summary = redactProviderText(firstString(ticket['summary'], ticket['title'])) || key;
  const description = adfToText(ticket['description']);
  const fieldNormalization = normalizeFields(ticket, {}, {});
  const normalizedFields = fieldNormalization.fields;
  const coreFields = normalizedFields.filter(field => !field.custom);
  const customFields = normalizedFields.filter(field => field.custom);
  const normalizedComments = comments.map(normalizeComment);
  const attachments = arrayFromUnknown(ticket['attachments']).map((value, index) =>
    normalizeAttachment(value, undefined, index));
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
    attachments,
    comments: normalizedComments,
    coreFields,
    customFields,
    completeness: {
      source: 'kronos-state-fallback',
      complete: false,
      allFieldsFetched: false,
      commentsComplete: false,
      commentsFetched: normalizedComments.length,
      attachmentsMetadataOnly: attachments.length > 0,
      attachmentsComplete: attachments.length === 0,
      attachmentsTotal: attachments.length,
      attachmentBodiesCaptured: 0,
      attachmentBodiesSkipped: attachments.length,
      attachmentBodiesFailed: 0,
      attachmentFetchCount: 0,
      attachmentResponseBytes: 0,
      fieldCount: normalizedFields.length,
      customFieldCount: customFields.length,
      missingFieldNameIds: fieldNormalization.missingNameIds,
      missingFieldSchemaIds: fieldNormalization.missingSchemaIds,
      truncatedFieldIds: fieldNormalization.truncatedIds,
      warnings: fallbackWarnings,
    },
  };
  assignString(context, 'url', sanitizedProviderUrl(firstString(ticket['jira_url'], ticket['jiraUrl'], ticket['url'])));
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
  return enforceNormalizedContextBudget(context);
}

function enforceNormalizedContextBudget(context: JiraTicketContext): JiraTicketContext {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { return context; }

  addContextWarning(
    context,
    `Jira context was truncated to fit the ${MAX_NORMALIZED_CONTEXT_BYTES}-byte normalized artifact safety limit.`,
  );
  pruneCommentsToGlobalBudget(context);
  truncateDerivedFieldTextToGlobalBudget(context);
  truncateFieldPayloadsToGlobalBudget(context);
  discardAttachmentBodiesToGlobalBudget(context);
  compactAncillaryContextToGlobalBudget(context);
  synchronizeCompleteness(context);
  if (serializedContextBytes(context) > MAX_NORMALIZED_CONTEXT_BYTES) {
    throw new Error(`Jira context could not be reduced below the ${MAX_NORMALIZED_CONTEXT_BYTES}-byte normalized artifact safety limit.`);
  }
  return context;
}

function pruneCommentsToGlobalBudget(context: JiraTicketContext): void {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES || context.comments.length === 0) { return; }
  const comments = context.comments;
  context.completeness.commentsComplete = false;
  addContextWarning(
    context,
    `Jira comments were truncated to fit the ${MAX_NORMALIZED_CONTEXT_BYTES}-byte normalized artifact safety limit.`,
  );
  let lower = 0;
  let upper = comments.length;
  while (lower < upper) {
    const candidateCount = Math.ceil((lower + upper) / 2);
    context.comments = comments.slice(comments.length - candidateCount);
    context.completeness.commentsFetched = candidateCount;
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) {
      lower = candidateCount;
    } else {
      upper = candidateCount - 1;
    }
  }
  context.comments = comments.slice(comments.length - lower);
  context.completeness.commentsFetched = lower;
}

function truncateDerivedFieldTextToGlobalBudget(context: JiraTicketContext): void {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { return; }
  const candidates = allContextFields(context)
    .filter(field => field.text !== GLOBAL_CONTEXT_TRUNCATION)
    .sort((left, right) => serializedValueBytes(right.text) - serializedValueBytes(left.text)
      || left.id.localeCompare(right.id));
  let changed = false;
  for (const field of candidates) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    if (serializedValueBytes(field.text) <= serializedValueBytes(GLOBAL_CONTEXT_TRUNCATION)) { continue; }
    field.text = GLOBAL_CONTEXT_TRUNCATION;
    markFieldTruncated(context, field.id);
    changed = true;
  }
  if (changed) {
    addContextWarning(context, 'Readable Jira field text was truncated by the global normalized artifact safety limit; structured values were retained where possible.');
  }
}

function truncateFieldPayloadsToGlobalBudget(context: JiraTicketContext): void {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { return; }
  const fields = allContextFields(context);
  const valueCandidates = [...fields].sort((left, right) =>
    serializedValueBytes(right.value) - serializedValueBytes(left.value) || left.id.localeCompare(right.id));
  let valuesChanged = false;
  for (const field of valueCandidates) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    if (field.value === GLOBAL_CONTEXT_TRUNCATION) { continue; }
    if (serializedValueBytes(field.value) <= serializedValueBytes(GLOBAL_CONTEXT_TRUNCATION)) { continue; }
    field.value = GLOBAL_CONTEXT_TRUNCATION;
    field.text = GLOBAL_CONTEXT_TRUNCATION;
    markFieldTruncated(context, field.id);
    valuesChanged = true;
  }

  const schemaCandidates = [...fields]
    .filter(field => field.schema !== undefined)
    .sort((left, right) => serializedValueBytes(right.schema) - serializedValueBytes(left.schema)
      || left.id.localeCompare(right.id));
  let schemasChanged = false;
  for (const field of schemaCandidates) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    if (field.schema === GLOBAL_CONTEXT_TRUNCATION) { continue; }
    if (serializedValueBytes(field.schema) <= serializedValueBytes(GLOBAL_CONTEXT_TRUNCATION)) { continue; }
    field.schema = GLOBAL_CONTEXT_TRUNCATION;
    markFieldTruncated(context, field.id);
    schemasChanged = true;
  }
  if (valuesChanged || schemasChanged) {
    addContextWarning(context, 'One or more Jira field values or schemas were truncated by the global normalized artifact safety limit; field IDs and names were retained.');
  }
}

function discardAttachmentBodiesToGlobalBudget(context: JiraTicketContext): void {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { return; }
  const captured = context.attachments
    .filter(attachment => attachment.contentStatus === 'captured')
    .sort((left, right) => serializedValueBytes(right.textContent) - serializedValueBytes(left.textContent)
      || left.filename.localeCompare(right.filename));
  let changed = false;
  for (const attachment of captured) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    attachment.contentStatus = 'skipped';
    attachment.contentReason = 'normalized-context-byte-limit';
    delete attachment.textContent;
    delete attachment.textSha256;
    changed = true;
  }
  if (changed) {
    addContextWarning(context, 'One or more captured Jira attachment bodies were omitted from the artifact by the global normalized-size safety limit; metadata and source hashes were retained.');
  }
}

function compactAncillaryContextToGlobalBudget(context: JiraTicketContext): void {
  if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { return; }
  let attachmentMetadataChanged = false;
  for (const attachment of context.attachments) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    if (Object.keys(attachment.metadata).length === 0) { continue; }
    attachment.metadata = {};
    attachmentMetadataChanged = true;
    markFieldTruncated(context, 'attachment');
  }
  if (attachmentMetadataChanged) {
    addContextWarning(context, 'Extended Jira attachment metadata was truncated by the global normalized artifact safety limit.');
  }

  for (const [key, fieldId] of [
    ['labels', 'labels'],
    ['components', 'components'],
    ['fixVersions', 'fixVersions'],
  ] as const) {
    if (serializedContextBytes(context) <= MAX_NORMALIZED_CONTEXT_BYTES) { break; }
    if (context[key].length === 0) { continue; }
    context[key] = [];
    markFieldTruncated(context, fieldId);
  }

  if (serializedContextBytes(context) > MAX_NORMALIZED_CONTEXT_BYTES) {
    context.description = GLOBAL_CONTEXT_TRUNCATION;
    markFieldTruncated(context, 'description');
  }
  if (serializedContextBytes(context) > MAX_NORMALIZED_CONTEXT_BYTES) {
    context.summary = GLOBAL_CONTEXT_TRUNCATION;
    context.title = GLOBAL_CONTEXT_TRUNCATION;
    markFieldTruncated(context, 'summary');
  }

  if (serializedContextBytes(context) > MAX_NORMALIZED_CONTEXT_BYTES) {
    for (let index = 0; index < context.attachments.length; index += 1) {
      const attachment = context.attachments[index];
      if (!attachment) { continue; }
      attachment.filename = `attachment-${index + 1}`;
      attachment.metadata = {};
    }
    for (const field of allContextFields(context)) {
      field.name = field.id;
      field.value = GLOBAL_CONTEXT_TRUNCATION;
      field.text = GLOBAL_CONTEXT_TRUNCATION;
      delete field.schema;
      markFieldTruncated(context, field.id);
    }
    addContextWarning(context, 'Jira field labels and ancillary values required emergency compaction at the global normalized artifact safety limit.');
  }
}

function synchronizeCompleteness(context: JiraTicketContext): void {
  const captured = context.attachments.filter(item => item.contentStatus === 'captured').length;
  const skipped = context.attachments.filter(item => item.contentStatus === 'skipped').length;
  const failed = context.attachments.filter(item => item.contentStatus === 'failed').length;
  context.completeness.commentsFetched = context.comments.length;
  context.completeness.attachmentsTotal = context.attachments.length;
  context.completeness.attachmentBodiesCaptured = captured;
  context.completeness.attachmentBodiesSkipped = skipped;
  context.completeness.attachmentBodiesFailed = failed;
  context.completeness.attachmentsComplete = skipped === 0 && failed === 0;
  context.completeness.attachmentsMetadataOnly = context.attachments.length > 0 && captured === 0;
  context.completeness.fieldCount = context.coreFields.length + context.customFields.length;
  context.completeness.customFieldCount = context.customFields.length;
  context.completeness.truncatedFieldIds = uniqueStrings(context.completeness.truncatedFieldIds);
  context.completeness.warnings = uniqueStrings(context.completeness.warnings);
  context.completeness.complete = context.completeness.allFieldsFetched
    && context.completeness.commentsComplete
    && context.completeness.attachmentsComplete
    && context.completeness.truncatedFieldIds.length === 0
    && context.completeness.warnings.length === 0;
}

function allContextFields(context: JiraTicketContext): JiraContextField[] {
  return [...context.coreFields, ...context.customFields];
}

function markFieldTruncated(context: JiraTicketContext, fieldId: string): void {
  const present = allContextFields(context).some(field => field.id === fieldId);
  if (present && !context.completeness.truncatedFieldIds.includes(fieldId)) {
    context.completeness.truncatedFieldIds.push(fieldId);
  }
  context.completeness.complete = false;
}

function addContextWarning(context: JiraTicketContext, warning: string): void {
  context.completeness.complete = false;
  context.completeness.warnings = uniqueStrings([...context.completeness.warnings, warning]);
}

function serializedValueBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function serializedContextBytes(context: JiraTicketContext): number {
  return Buffer.byteLength(JSON.stringify(context, null, 2), 'utf8');
}

export function adfToText(value: unknown): string {
  return adfToTextTracked(value);
}

function adfToTextTracked(value: unknown, tracker?: JiraValueNormalizationTracker): string {
  let rendered: string;
  if (typeof value === 'string') { rendered = value.trim(); }
  else if (value === undefined || value === null) { rendered = ''; }
  else if (Array.isArray(value)) {
    rendered = cleanAdfText(value.map(item => renderAdfNode(item)).join(''));
  } else if (!isRecord(value)) {
    rendered = String(value);
  } else if (Array.isArray(value['content']) || typeof value['type'] === 'string') {
    rendered = cleanAdfText(renderAdfNode(value));
  } else {
    rendered = readableText(normalizeContextValueTracked(value, tracker) ?? '');
  }
  return redactProviderText(rendered, tracker);
}

export function normalizeContextValue(value: unknown): JiraContextValue | undefined {
  return normalizeContextValueTracked(value);
}

function normalizeContextValueTracked(
  value: unknown,
  tracker?: JiraValueNormalizationTracker,
): JiraContextValue | undefined {
  return pruneEmptyJiraValue(normalizeContextValueInternal(value, new WeakSet<object>(), 0, tracker));
}

interface JiraFieldNormalizationResult {
  fields: JiraContextField[];
  missingNameIds: string[];
  missingSchemaIds: string[];
  truncatedIds: string[];
}

interface JiraValueNormalizationTracker {
  truncated: boolean;
}

function normalizeFields(
  fields: Record<string, unknown>,
  names: Record<string, unknown>,
  schemas: Record<string, unknown>,
): JiraFieldNormalizationResult {
  const missingNameIds: string[] = [];
  const missingSchemaIds: string[] = [];
  const truncatedIds: string[] = [];
  const normalizedFields = Object.entries(fields).map(([id, rawValue]): JiraContextField | undefined => {
    const schema = schemas[id];
    const expandedName = optionalTrimmedStringFromUnknown(names[id]);
    const fieldName = expandedName || id;
    const tracker: JiraValueNormalizationTracker = { truncated: false };
    const visibleValue = normalizeContextValueTracked(
      id === 'attachment' ? sanitizeAttachmentField(rawValue) : rawValue,
      tracker,
    );
    if (visibleValue === undefined) { return undefined; }
    if (!expandedName) { missingNameIds.push(id); }
    if (schema === undefined || schema === null) { missingSchemaIds.push(id); }
    const sensitiveField = SENSITIVE_FIELD_LABEL_PATTERN.test(id) || SENSITIVE_FIELD_LABEL_PATTERN.test(fieldName);
    const normalizedValue = sensitiveField
      ? '[REDACTED]'
      : visibleValue;
    const field: JiraContextField = {
      id,
      name: redactProviderText(fieldName),
      custom: id.startsWith('customfield_') || isCustomFieldSchema(schema),
      value: normalizedValue,
      text: boundedFieldText(normalizedValue, tracker),
    };
    if (schema !== undefined) {
      const normalizedSchema = normalizeContextValueTracked(schema, tracker);
      if (normalizedSchema !== undefined) { field.schema = normalizedSchema; }
    }
    if (tracker.truncated) { truncatedIds.push(id); }
    return field;
  }).filter((field): field is JiraContextField => field !== undefined)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  return {
    fields: normalizedFields,
    missingNameIds: uniqueStrings(missingNameIds),
    missingSchemaIds: uniqueStrings(missingSchemaIds),
    truncatedIds: uniqueStrings(truncatedIds),
  };
}

function normalizeAttachment(value: unknown, captureValue: unknown, index: number): JiraAttachmentContext {
  const attachment = isRecord(value) ? value : {};
  const filename = redactProviderText(firstString(attachment['filename'], attachment['name']) || 'attachment');
  const metadataSource = sanitizeAttachmentMetadata(attachment);
  const normalized: JiraAttachmentContext = {
    filename,
    contentStatus: 'skipped',
    contentReason: 'not-fetched',
    metadata: isRecord(metadataSource) ? normalizedRecord(metadataSource) : {},
  };
  assignString(normalized, 'id', attachment['id']);
  const size = nonNegativeInteger(attachment['size']);
  if (size !== undefined) { normalized.size = size; }
  assignString(normalized, 'mimeType', firstString(attachment['mimeType'], attachment['mimetype']));
  assignString(normalized, 'created', attachment['created']);
  assignString(normalized, 'author', namedValue(attachment['author']));
  applyAttachmentCapture(normalized, captureValue, index);
  return normalized;
}

function applyAttachmentCapture(
  attachment: JiraAttachmentContext,
  captureValue: unknown,
  index: number,
): void {
  const capture = isRecord(captureValue) ? captureValue : undefined;
  if (!capture || nonNegativeInteger(capture['index']) !== index) { return; }
  const captureId = optionalTrimmedStringFromUnknown(capture['id']);
  if (captureId && attachment.id && captureId !== attachment.id) {
    attachment.contentStatus = 'failed';
    attachment.contentReason = 'attachment-id-mismatch';
    return;
  }
  const status = capture['status'];
  if (status !== 'captured' && status !== 'skipped' && status !== 'failed') { return; }
  attachment.contentStatus = status;
  assignString(attachment, 'contentReason', capture['reason']);
  assignString(attachment, 'contentMimeType', capture['responseMimeType'] ?? capture['declaredMimeType']);
  const contentBytes = nonNegativeInteger(capture['responseBytes']);
  if (contentBytes !== undefined) { attachment.contentBytes = contentBytes; }
  const sourceSha256 = normalizedSha256(capture['sourceSha256']);
  if (sourceSha256) { attachment.contentSha256 = sourceSha256; }
  if (status !== 'captured') { return; }
  if (!sourceSha256) {
    attachment.contentStatus = 'failed';
    attachment.contentReason = 'invalid-content-hash';
    return;
  }
  if (typeof capture['text'] !== 'string' || UNSAFE_ATTACHMENT_TEXT_PATTERN.test(capture['text'])) {
    attachment.contentStatus = 'failed';
    attachment.contentReason = 'invalid-captured-text';
    delete attachment.contentSha256;
    return;
  }
  const textContent = redactProviderText(capture['text'].replace(/\r\n?/g, '\n'));
  attachment.textContent = textContent;
  attachment.textSha256 = sha256(textContent);
  delete attachment.contentReason;
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
  return arrayFromUnknown(value).map(item => isRecord(item) ? sanitizeAttachmentMetadata(item) : item);
}

function sanitizeAttachmentMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const metadata: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:content|self|thumbnail|contentUrl|thumbnailUrl)$/i.test(key)) { continue; }
    metadata[key] = sanitizeProviderMetadata(item);
  }
  return metadata;
}

function sanitizeProviderMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeProviderMetadata);
  }
  if (!isRecord(value)) {
    return typeof value === 'string' ? redactProviderText(value) : value;
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD_LABEL_PATTERN.test(key)) {
      if (normalizeContextValueTracked(item) !== undefined) { sanitized[key] = '[REDACTED]'; }
    } else if (typeof item === 'string' && (/(?:url|self|content|thumbnail)$/i.test(key) || /^(?:https?:)?\/\//i.test(item))) {
      sanitized[key] = sanitizedProviderUrl(item) || null;
    } else if (typeof item === 'string') {
      sanitized[key] = redactProviderText(item);
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

function sanitizedProviderUrlInText(value: string): string | undefined {
  if (!value) { return undefined; }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') { return undefined; }
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        url.searchParams.set(key, '[REDACTED]');
      }
    }
    url.hash = '';
    return url.toString();
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

function normalizeContextValueInternal(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  tracker?: JiraValueNormalizationTracker,
): JiraUnprunedValue {
  if (value === null || value === undefined) { return null; }
  if (typeof value === 'string') { return redactProviderText(value, tracker); }
  if (typeof value === 'boolean') { return value; }
  if (typeof value === 'number') { return Number.isFinite(value) ? value : String(value); }
  if (typeof value === 'bigint') { return value.toString(); }
  if (typeof value !== 'object') { return String(value); }
  if (depth >= 40) {
    if (tracker) { tracker.truncated = true; }
    return '[Maximum depth reached]';
  }
  if (seen.has(value)) { return '[Circular value]'; }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map(item => normalizeContextValueInternal(item, seen, depth + 1, tracker));
    }
    if (isRecord(value) && isAdfDocument(value)) {
      return isEmptyJiraRichText(value) ? '' : adfToTextTracked(value, tracker);
    }
    const result: { [key: string]: JiraUnprunedValue } = {};
    for (const [key, item] of Object.entries(value)) {
      const normalizedItem = pruneEmptyJiraValue(normalizeContextValueInternal(item, seen, depth + 1, tracker));
      if (normalizedItem === undefined) { continue; }
      result[key] = SENSITIVE_FIELD_PATTERN.test(key) ? '[REDACTED]' : normalizedItem;
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

function isContextRecord(value: JiraContextValue | undefined): value is { [key: string]: JiraContextValue } {
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

function boundedFieldText(value: JiraContextValue, tracker: JiraValueNormalizationTracker): string {
  const text = redactProviderText(readableText(value), tracker);
  if (text.length <= MAX_FIELD_TEXT_CHARS) { return text; }
  tracker.truncated = true;
  const suffix = '\n[Truncated by Kronos field text safety limit]';
  return `${text.slice(0, Math.max(0, MAX_FIELD_TEXT_CHARS - suffix.length))}${suffix}`;
}

function stringArray(value: unknown): string[] {
  return uniqueStrings(arrayFromUnknown(value).map(item => redactProviderText(firstString(item))).filter(Boolean));
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => redactProviderText(value)).filter(Boolean))];
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
    target[key] = redactProviderText(normalized) as T[K];
  }
}

function redactProviderText(value: string, tracker?: JiraValueNormalizationTracker): string {
  const sanitizedUrls = String(value).replace(/\bhttps?:\/\/[^\s<>"`]+/gi, rawValue => {
    let candidate = rawValue;
    let trailing = '';
    while (/[),.;!?]$/.test(candidate)) {
      trailing = `${candidate.slice(-1)}${trailing}`;
      candidate = candidate.slice(0, -1);
    }
    return `${sanitizedProviderUrlInText(candidate) || '[REDACTED URL]'}${trailing}`;
  });
  const sanitized = sanitizedUrls
    .replace(/-----BEGIN [^-\r\n]*(?:PRIVATE KEY|SECRET)[^-\r\n]*-----[\s\S]*?-----END [^-\r\n]*(?:PRIVATE KEY|SECRET)[^-\r\n]*-----/gi, '[REDACTED PRIVATE MATERIAL]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]{8,}/gi, '[REDACTED AUTHORIZATION]')
    .replace(/\b(?:glpat-|sqp_|ATATT|github_pat_|gh[pousr]_|sk-|xox[baprs]-)[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED PROVIDER TOKEN]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED AWS ACCESS KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[REDACTED JWT]')
    .replace(/([?&](?:token|access[_-]?token|api[_-]?key|private[_-]?token|password|secret)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/((?:authorization|token|private[-_ ]?token|access[-_ ]?token|api[-_ ]?key|client[-_ ]?secret|password|passwd|secret|credential)\s*[:=]\s*)(?!\[REDACTED(?:\s|\]))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/(["']?[A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_.-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/g, '$1[REDACTED]')
    .replace(/(^\s*[+\- ]?\s*(?:export\s+)?(?:(?:const|let|var|readonly|final|def|string)\s+)?[A-Z0-9_.-]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_.-]*\s*[:=]\s*).+$/gm, '$1[REDACTED]')
    .replace(/\u0000/g, '')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
  if (sanitized.length > MAX_CONTEXT_TEXT_CHARS && tracker) { tracker.truncated = true; }
  return sanitized.slice(0, MAX_CONTEXT_TEXT_CHARS).trim();
}

function normalizedSha256(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value.trim())
    ? value.trim().toLowerCase()
    : undefined;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}
