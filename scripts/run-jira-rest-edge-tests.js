const assert = require('node:assert/strict');
const test = require('node:test');

const {
  JiraRestCancelledError,
  JiraRestClient,
  JiraRestError,
  normalizeJiraBaseUrl,
  resolveJiraRestConfig,
} = require('../out/services/jiraRestClient.js');

const jiraEnv = {
  JIRA_BASE_URL: 'https://jira.example',
  JIRA_EMAIL: 'fixture@example.test',
  JIRA_API_TOKEN: 'fixture-token',
};
const jiraConfig = resolveJiraRestConfig(jiraEnv);

test('Jira Work edge matrix preserves bounded rows across validation and pagination stops', async () => {
  const aborted = new AbortController();
  aborted.abort();
  await assert.rejects(
    new JiraRestClient({ env: jiraEnv, transport: async () => jsonResponse({}) })
      .searchWorkList({ signal: aborted.signal }),
    JiraRestCancelledError,
  );

  for (const [jql, expected] of [
    ['x'.repeat(16 * 1024 + 1), /exceeds the 16384-character safety limit/i],
    [`project = SAFE${String.fromCharCode(0)}`, /unsafe control character/i],
  ]) {
    const client = workClient(async () => jsonResponse({}), {}, { JIRA_JQL: jql });
    await assert.rejects(client.searchWorkList(), expected);
  }

  let snapshot = await workClient(async () => jsonResponse(null)).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /invalid pagination object/i);

  snapshot = await workClient(async () => jsonResponse({ issues: null, isLast: true })).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /valid issues array/i);
  assert.equal(snapshot.complete, false);

  snapshot = await workClient(async () => jsonResponse({
    issues: [null],
    isLast: true,
  })).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /1 malformed issue row;/i);

  snapshot = await workClient(async () => jsonResponse({
    issues: [null, {}, { key: 'SAFE-2', fields: {} }],
    warningMessages: Array.from({ length: 22 }, (_, index) => ` warning\n${index} `),
    errorMessages: [123],
    isLast: true,
  })).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /3 malformed issue rows;/i);
  assert.match(snapshot.warnings.join(' '), /3 additional warning messages/i);
  assert.doesNotMatch(snapshot.warnings.join(' '), /\n/);

  for (const unsafeToken of [undefined, 7, '', `bad${String.fromCharCode(0)}token`, 'x'.repeat(16 * 1024 + 1)]) {
    snapshot = await workClient(async () => jsonResponse({ issues: [], isLast: false, nextPageToken: unsafeToken }))
      .searchWorkList();
    assert.match(snapshot.warnings.join(' '), /did not provide a safe nextPageToken/i);
  }

  snapshot = await workClient(
    async () => jsonResponse({ issues: [], isLast: false, nextPageToken: 'next' }),
    { maxWorkListPages: 1 },
  ).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /safety limit of 1 pages/i);

  snapshot = await workClient(
    async () => jsonResponse({ issues: [workIssue('SAFE-1')], isLast: false, nextPageToken: 'next' }),
    { maxWorkListIssues: 1 },
  ).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /safety limit of 1 issues/i);

  snapshot = await workClient(
    async () => jsonResponse({ issues: [workIssue('SAFE-1'), workIssue('SAFE-2')], isLast: false, nextPageToken: 'next' }),
    { maxWorkListIssues: 1 },
  ).searchWorkList();
  assert.deepEqual(snapshot.issues.map(issue => issue.key), ['SAFE-1']);
  assert.match(snapshot.warnings.join(' '), /safety limit of 1 issues/i);

  const fullPage = paddedJson({ issues: [], isLast: false, nextPageToken: 'next' }, 1024);
  snapshot = await workClient(
    async () => textResponse(fullPage),
    { maxWorkListPages: 2, maxTotalWorkListBytes: 1024, maxResponseBytes: 2048 },
  ).searchWorkList();
  assert.match(snapshot.warnings.join(' '), /1024-byte cumulative safety limit/i);

  let call = 0;
  snapshot = await workClient(async () => {
    call += 1;
    if (call === 1) {
      return jsonResponse({ issues: [workIssue('SAFE-1')], isLast: false, nextPageToken: 'next' });
    }
    return textResponse('x'.repeat(1024));
  }, { maxTotalWorkListBytes: 1024, maxResponseBytes: 2048 }).searchWorkList();
  assert.deepEqual(snapshot.issues.map(issue => issue.key), ['SAFE-1']);
  assert.match(snapshot.warnings.join(' '), /responses reached the 1024-byte cumulative safety limit/i);
  assert.match(snapshot.warnings.join(' '), /1 previously fetched issue was retained/i);

  call = 0;
  snapshot = await workClient(async () => {
    call += 1;
    if (call === 1) {
      return jsonResponse({ issues: [workIssue('SAFE-1'), workIssue('SAFE-2')], isLast: false, nextPageToken: 'next' });
    }
    throw new Error('private second-page failure');
  }).searchWorkList();
  assert.deepEqual(snapshot.issues.map(issue => issue.key), ['SAFE-1', 'SAFE-2']);
  assert.match(snapshot.warnings.join(' '), /2 previously fetched issues were retained/i);
  assert.doesNotMatch(snapshot.warnings.join(' '), /private second-page failure/i);
});

test('Jira comment pagination classifies partial, invalid, stalled, cancelled, and capped reads', async () => {
  let client = new JiraRestClient({ env: jiraEnv, transport: async () => jsonResponse(null) });
  let comments = await client.paginatedComments(jiraConfig, 'SAFE-1', {});
  assert.match(comments.warnings.join(' '), /invalid pagination object/i);

  client = new JiraRestClient({
    env: jiraEnv,
    commentsPerPage: 1,
    transport: async () => jsonResponse({ comments: [], total: 2, isLast: false }),
  });
  comments = await client.paginatedComments(jiraConfig, 'SAFE-1', {});
  assert.match(comments.warnings.join(' '), /pagination did not advance safely/i);

  client = new JiraRestClient({
    env: jiraEnv,
    commentsPerPage: 1,
    maxCommentPages: 1,
    transport: async () => jsonResponse({ comments: [{ id: 'latest' }], total: 2, isLast: false }),
  });
  comments = await client.paginatedComments(jiraConfig, 'SAFE-1', {});
  assert.deepEqual(comments.comments, [{ id: 'latest' }]);
  assert.match(comments.warnings.join(' '), /safety limit of 1 pages/i);

  client = new JiraRestClient({ env: jiraEnv, transport: async () => { throw new Error('private comment failure'); } });
  comments = await client.paginatedComments(jiraConfig, 'SAFE-1', {});
  assert.match(comments.warnings.join(' '), /0 previously fetched comments were retained/i);
  assert.doesNotMatch(comments.warnings.join(' '), /private comment failure/i);

  let call = 0;
  client = new JiraRestClient({
    env: jiraEnv,
    commentsPerPage: 1,
    transport: async () => {
      call += 1;
      if (call === 1) return jsonResponse({ comments: [{ id: 'latest' }], total: 2, isLast: false });
      throw Object.assign(new Error('private later failure'), { code: 'ECONNRESET' });
    },
  });
  comments = await client.paginatedComments(jiraConfig, 'SAFE-1', {});
  assert.deepEqual(comments.comments, [{ id: 'latest' }]);
  assert.match(comments.warnings.join(' '), /1 previously fetched comment was retained/i);

  client = new JiraRestClient({
    env: jiraEnv,
    transport: async () => { throw Object.assign(new Error('superseded'), { name: 'AbortError' }); },
  });
  await assert.rejects(client.paginatedComments(jiraConfig, 'SAFE-1', {}), JiraRestCancelledError);
});

test('Jira attachment budgets and content classification retain only bounded evidence', async () => {
  let client = new JiraRestClient({
    env: jiraEnv,
    maxAttachmentBytes: 1024,
    maxTotalAttachmentBytes: 1024,
    transport: async () => { throw new Error('private attachment failure'); },
  });
  let attachments = await client.attachmentContents(jiraConfig, {
    fields: {
      attachment: [
        { id: {}, size: 1 },
        { id: 'too-large', size: 1025 },
        { id: 'failed', size: 1 },
        { id: 'budget-exhausted', size: 1 },
      ],
    },
  }, {});
  assert.deepEqual(attachments.contents.map(item => item.reason), [
    'invalid-id',
    'per-file-byte-limit',
    'fetch-failed',
    'total-byte-limit',
  ]);
  assert.equal(attachments.fetchCount, 1);
  assert.match(attachments.warnings.join(' '), /3 skipped, and 1 failed/i);

  client = new JiraRestClient({
    env: jiraEnv,
    maxAttachmentBytes: 1024,
    maxTotalAttachmentBytes: 1024,
    transport: async () => ({
      statusCode: 200,
      body: Buffer.alloc(600),
      headers: { 'x-ignored': 'value', 'CONTENT-TYPE': ['text/plain; charset="UTF-8"'] },
    }),
  });
  attachments = await client.attachmentContents(jiraConfig, {
    fields: { attachment: [{ id: 7, size: 600, mimetype: 'text/plain; version=1' }, { id: 'second', size: 600 }] },
  }, {});
  assert.equal(attachments.contents[0].status, 'captured');
  assert.equal(attachments.contents[0].id, '7');
  assert.equal(attachments.contents[0].responseMimeType, 'text/plain');
  assert.equal(attachments.contents[0].bytes.length, 600);
  assert.equal(attachments.contents[1].reason, 'total-byte-limit');

  client = new JiraRestClient({
    env: jiraEnv,
    maxAttachmentFetches: 1,
    transport: async () => ({ statusCode: 200, body: 'ok', headers: {} }),
  });
  attachments = await client.attachmentContents(jiraConfig, {
    fields: { attachment: [{ id: 'one' }, { id: 'two' }] },
  }, {});
  assert.deepEqual(attachments.contents.map(item => item.reason), [undefined, 'fetch-count-limit']);
  assert.equal(attachments.contents[0].sourceSha256.length, 64);

  const missing = await client.requestAttachmentBytes(jiraConfig, { index: 0, status: 'skipped' }, 1024, {});
  assert.equal(missing.content.reason, 'invalid-metadata');

  client = new JiraRestClient({
    env: jiraEnv,
    transport: async () => ({ statusCode: 0, body: '', headers: { 'Content-Type': 'not-a-mime' } }),
  });
  const zeroStatus = await client.requestAttachmentBytes(
    jiraConfig,
    { index: 0, status: 'skipped', id: 'zero' },
    1024,
    {},
  );
  assert.equal(zeroStatus.content.reason, 'http-0');

  const limitSource = new JiraRestClient({
    env: jiraEnv,
    maxResponseBytes: 1024,
    transport: async () => textResponse('x'.repeat(1025)),
  });
  let limitError;
  try {
    await limitSource.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'limit fixture', {}, {});
  } catch (error) {
    limitError = error;
  }
  assert.match(limitError?.message || '', /1024-byte response safety limit/i);
  client = new JiraRestClient({ env: jiraEnv, transport: async () => { throw limitError; } });
  const limited = await client.requestAttachmentBytes(
    jiraConfig,
    { index: 0, status: 'skipped', id: 'limited' },
    1024,
    {},
  );
  assert.equal(limited.content.reason, 'response-byte-limit');
});

test('Jira request and configuration boundaries sanitize URLs and provider failures', async () => {
  for (const [env, missing] of [
    [{ JIRA_EMAIL: 'a@example.test', JIRA_API_TOKEN: 'token' }, /JIRA_BASE_URL/],
    [{ JIRA_BASE_URL: 'jira.example', JIRA_API_TOKEN: 'token' }, /JIRA_EMAIL/],
    [{ JIRA_BASE_URL: 'jira.example', JIRA_EMAIL: 'a@example.test' }, /JIRA_API_TOKEN/],
  ]) {
    assert.throws(() => resolveJiraRestConfig(env), missing);
  }
  assert.equal(normalizeJiraBaseUrl('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(normalizeJiraBaseUrl('http://[::1]:8080/'), 'http://[::1]:8080');

  let handler = async () => jsonResponse({});
  const client = new JiraRestClient({ env: jiraEnv, maxResponseBytes: 1024, transport: request => handler(request) });
  await assert.rejects(
    client.requestJson(jiraConfig, 'https://other.example/private', 'cross-origin fixture', {}, {}),
    /outside the configured JIRA_BASE_URL origin/i,
  );

  for (const [statusCode, expected] of [
    [401, /credentials and permissions/i],
    [403, /credentials and permissions/i],
    [404, /ticket may be missing or unavailable/i],
    [429, /rate limiting/i],
    [503, /HTTP 503/i],
  ]) {
    handler = async () => ({ statusCode, body: '{}', headers: {} });
    await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'HTTP fixture', {}, {}), expected);
  }

  handler = async () => ({ statusCode: 200, body: Buffer.from('{invalid'), headers: {} });
  await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'JSON fixture', {}, {}), /invalid JSON/i);
  handler = async () => { throw new JiraRestError('Synthetic bounded Jira error.'); };
  await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'error fixture', {}, {}), /Synthetic bounded Jira error/);
  handler = async () => { throw Object.assign(new Error('private transport failure'), { code: 'ETIMEDOUT' }); };
  await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'error fixture', {}, {}), /ETIMEDOUT/);
  handler = async () => { throw new Error('private transport failure'); };
  await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'error fixture', {}, {}), /request failed/i);
  handler = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
  await assert.rejects(client.requestJson(jiraConfig, '/rest/api/3/issue/SAFE-1', 'error fixture', {}, {}), JiraRestCancelledError);

  handler = async () => jsonResponse({ fields: { attachment: [] } });
  const ticketClient = new JiraRestClient({
    env: jiraEnv,
    transport: async request => new URL(request.url).pathname.endsWith('/comment')
      ? jsonResponse({ comments: [], total: 0, isLast: true })
      : handler(request),
  });
  for (const issueUrl of [undefined, 'not a URL', 'file:///tmp/SAFE-1']) {
    assert.equal((await ticketClient.ticketContext('SAFE-1', issueUrl)).issueUrl, 'https://jira.example/browse/SAFE-1');
  }
});

function workClient(transport, options = {}, envOverrides = {}) {
  return new JiraRestClient({
    env: { ...jiraEnv, ...envOverrides },
    transport,
    ...options,
  });
}

function workIssue(key) {
  return { key, fields: { summary: `Issue ${key}` } };
}

function jsonResponse(value, headers = {}) {
  return textResponse(JSON.stringify(value), headers);
}

function textResponse(body, headers = {}) {
  return { statusCode: 200, body, headers };
}

function paddedJson(value, targetBytes) {
  const base = JSON.stringify({ ...value, padding: '' });
  const paddingBytes = targetBytes - Buffer.byteLength(base, 'utf8');
  assert.ok(paddingBytes >= 0, 'fixture fits inside its target byte length');
  const body = JSON.stringify({ ...value, padding: 'x'.repeat(paddingBytes) });
  assert.equal(Buffer.byteLength(body, 'utf8'), targetBytes);
  return body;
}
