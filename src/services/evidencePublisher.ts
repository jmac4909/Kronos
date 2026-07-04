import * as http from 'http';
import * as https from 'https';
import { Ticket } from '../state/types';
import { unknownErrorMessage } from './errorUtils';

type EvidencePublishKind = 'jira' | 'gitlab_mr';
type EvidencePublishStatus = 'ready' | 'missing_config' | 'unsupported_url' | 'skipped' | 'posted' | 'failed';

export interface EvidencePublishDestination {
  kind: EvidencePublishKind;
  label: string;
  status: EvidencePublishStatus;
  detail: string;
  endpoint?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface EvidencePublishPlan {
  ticketKey: string;
  comment: string;
  destinations: EvidencePublishDestination[];
}

export interface EvidencePublishResult {
  kind: EvidencePublishKind;
  label: string;
  status: EvidencePublishStatus;
  detail: string;
  endpoint?: string;
  httpStatus?: number;
}

interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

interface HttpResponse {
  statusCode: number;
  body: string;
}

type EvidenceHttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export function buildEvidencePublishPlan(
  ticketKey: string,
  ticket: Ticket,
  comment: string,
  env: NodeJS.ProcessEnv = process.env,
): EvidencePublishPlan {
  return {
    ticketKey,
    comment,
    destinations: [
      buildJiraDestination(ticketKey, ticket, comment, env),
      buildGitLabDestination(ticket, comment, env),
    ],
  };
}

export async function publishEvidencePlan(
  plan: EvidencePublishPlan,
  kinds: EvidencePublishKind[],
  transport: EvidenceHttpTransport = defaultHttpTransport,
): Promise<EvidencePublishResult[]> {
  const selected = new Set(kinds);
  const results: EvidencePublishResult[] = [];
  for (const destination of plan.destinations) {
    if (!selected.has(destination.kind)) {
      const skipped: EvidencePublishResult = {
        kind: destination.kind,
        label: destination.label,
        status: 'skipped',
        detail: 'Destination was not selected for publishing.',
      };
      if (destination.endpoint) { skipped.endpoint = destination.endpoint; }
      results.push(skipped);
      continue;
    }
    results.push(await publishDestination(destination, transport));
  }
  return results;
}

export function readyPublishDestinations(plan: EvidencePublishPlan): EvidencePublishDestination[] {
  return plan.destinations.filter(destination => destination.status === 'ready' && Boolean(destination.endpoint && destination.headers && destination.body));
}

async function publishDestination(destination: EvidencePublishDestination, transport: EvidenceHttpTransport): Promise<EvidencePublishResult> {
  if (destination.status !== 'ready' || !destination.endpoint || !destination.headers || destination.body === undefined) {
    const result: EvidencePublishResult = {
      kind: destination.kind,
      label: destination.label,
      status: destination.status,
      detail: destination.detail,
    };
    if (destination.endpoint) { result.endpoint = destination.endpoint; }
    return result;
  }
  if (!isHttpUrl(destination.endpoint)) {
    return {
      kind: destination.kind,
      label: destination.label,
      status: 'failed',
      detail: 'Evidence publish endpoint must use HTTP or HTTPS.',
      endpoint: destination.endpoint,
    };
  }

  const body = JSON.stringify(destination.body);
  let response: HttpResponse;
  try {
    response = await transport({
      method: 'POST',
      url: destination.endpoint,
      headers: {
        ...destination.headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body).toString(),
      },
      body,
    });
  } catch (e: unknown) {
    return {
      kind: destination.kind,
      label: destination.label,
      status: 'failed',
      detail: unknownErrorMessage(e, 'Evidence publish request failed.'),
      endpoint: destination.endpoint,
    };
  }
  const ok = response.statusCode >= 200 && response.statusCode < 300;
  return {
    kind: destination.kind,
    label: destination.label,
    status: ok ? 'posted' : 'failed',
    detail: ok ? 'Evidence comment posted.' : responsePreview(response.body) || `HTTP ${response.statusCode}`,
    endpoint: destination.endpoint,
    httpStatus: response.statusCode,
  };
}

function buildJiraDestination(ticketKey: string, ticket: Ticket, comment: string, env: NodeJS.ProcessEnv): EvidencePublishDestination {
  const jiraBase = firstNonEmpty(env['JIRA_BASE_URL'], baseUrlFromIssueUrl(ticket.jira_url));
  const email = env['JIRA_EMAIL'];
  const token = env['JIRA_API_TOKEN'];
  if (!ticket.jira_url && !jiraBase) {
    return missing('jira', 'Jira ticket comment', 'No Jira URL or JIRA_BASE_URL is configured.');
  }
  if (!jiraBase || !email || !token) {
    return missing('jira', 'Jira ticket comment', 'JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN are required. Values are not displayed.');
  }
  if (!isHttpUrl(jiraBase)) {
    return unsupported('jira', 'Jira ticket comment', 'Jira URL must use HTTP or HTTPS.');
  }
  const endpoint = jiraCommentEndpoint(jiraBase, ticketKey);
  return {
    kind: 'jira',
    label: 'Jira ticket comment',
    status: 'ready',
    detail: 'Ready to post an Atlassian document-format evidence comment.',
    endpoint,
    headers: {
      Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
      Accept: 'application/json',
    },
    body: {
      body: {
        type: 'doc',
        version: 1,
        content: comment.split(/\r?\n/).map(line => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
      },
    },
  };
}

function buildGitLabDestination(ticket: Ticket, comment: string, env: NodeJS.ProcessEnv): EvidencePublishDestination {
  if (!ticket.mr?.url) {
    return missing('gitlab_mr', 'Merge request comment', 'No merge request URL is recorded for this ticket.');
  }
  const token = env['GITLAB_TOKEN'];
  if (!token) {
    return missing('gitlab_mr', 'Merge request comment', 'GITLAB_TOKEN is required. Value is not displayed.');
  }
  const endpoint = gitLabNoteEndpoint(ticket.mr.url, ticket.mr.iid, env['GITLAB_API_BASE_URL']);
  if (!endpoint) {
    return {
      kind: 'gitlab_mr',
      label: 'Merge request comment',
      status: 'unsupported_url',
      detail: 'Merge request URL does not look like a GitLab /-/merge_requests URL.',
    };
  }
  return {
    kind: 'gitlab_mr',
    label: `Merge request !${ticket.mr.iid} comment`,
    status: 'ready',
    detail: 'Ready to post a GitLab merge request note.',
    endpoint,
    headers: {
      'PRIVATE-TOKEN': token,
      Accept: 'application/json',
    },
    body: { body: comment },
  };
}

function gitLabNoteEndpoint(mrUrl: string, iid: number, configuredApiBase?: string): string | undefined {
  try {
    const parsed = new URL(mrUrl);
    if (!isHttpProtocol(parsed)) { return undefined; }
    const marker = '/-/merge_requests/';
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex <= 1) { return undefined; }
    const projectPath = decodeURIComponent(parsed.pathname.slice(1, markerIndex));
    const urlIid = parsed.pathname.slice(markerIndex + marker.length).split('/')[0];
    const targetIid = urlIid || String(iid);
    const apiBase = configuredApiBase || `${parsed.origin}/api/v4`;
    if (!isHttpUrl(apiBase)) { return undefined; }
    return `${normalizeGitLabApiBase(apiBase)}/api/v4/projects/${encodeURIComponent(projectPath)}/merge_requests/${encodeURIComponent(targetIid)}/notes`;
  } catch {
    return undefined;
  }
}

function normalizeGitLabApiBase(apiBase: string): string {
  return apiBase.replace(/\/+$/, '').replace(/\/api\/v4$/, '');
}

function baseUrlFromIssueUrl(issueUrl: string | undefined): string | undefined {
  if (!issueUrl) { return undefined; }
  try {
    const parsed = new URL(issueUrl);
    if (!isHttpProtocol(parsed)) { return undefined; }
    const browseIndex = parsed.pathname.indexOf('/browse/');
    if (browseIndex > 0) {
      const base = new URL(parsed.origin);
      base.pathname = parsed.pathname.slice(0, browseIndex);
      return base.toString();
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function jiraCommentEndpoint(jiraBase: string, ticketKey: string): string {
  const base = new URL(jiraBase);
  base.pathname = `${base.pathname.replace(/\/+$/, '')}/`;
  base.search = '';
  base.hash = '';
  return new URL(`rest/api/3/issue/${encodeURIComponent(ticketKey)}/comment`, base).toString();
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find(value => value && value.trim())?.trim();
}

function missing(kind: EvidencePublishKind, label: string, detail: string): EvidencePublishDestination {
  return { kind, label, status: 'missing_config', detail };
}

function unsupported(kind: EvidencePublishKind, label: string, detail: string): EvidencePublishDestination {
  return { kind, label, status: 'unsupported_url', detail };
}

function isHttpUrl(url: string): boolean {
  try {
    return isHttpProtocol(new URL(url));
  } catch {
    return false;
  }
}

function isHttpProtocol(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function responsePreview(body: string): string {
  return body.trim().replace(/\s+/g, ' ').slice(0, 240);
}

function defaultHttpTransport(request: HttpRequest): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    let parsed: URL;
    try {
      parsed = new URL(request.url);
    } catch (e: unknown) {
      reject(e);
      return;
    }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: request.method,
      headers: request.headers,
      timeout: 30000,
    }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode || 0,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Evidence publish request timed out.')));
    req.write(request.body);
    req.end();
  });
}
