const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-failure-contract-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const errorUtils = require('../out/services/errorUtils.js');
const operationStages = require('../out/services/operationStageOutcome.js');
const { JiraRestClient } = require('../out/services/jiraRestClient.js');
const jiraContext = require('../out/services/jiraTicketContext.js');
const { JenkinsRestClient } = require('../out/services/jenkinsRestClient.js');
const ciContextStore = require('../out/services/ciContextStore.js');
const managedProviderMonitor = require('../out/services/managedProviderMonitor.js');
const workSessions = require('../out/services/workSessionStore.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('context completion reports every provider, artifact, snapshot, insertion, session, and audit stage', () => {
  const outcome = operationStages.finalizeInsertedContext({
    operation: 'JIRA-7 context placement',
    providerRead: { state: 'partial', detail: 'Comments were partial and the prior valid ticket body was retained.' },
    artifactWrite: { state: 'succeeded', detail: 'Private immutable artifact written.' },
    snapshot: { state: 'partial', detail: 'Normalized snapshot includes explicit warnings.' },
    sessionUpdate: () => ({ id: 'session-seven' }),
    auditAppend: session => assert.equal(session.id, 'session-seven'),
  });
  assert.equal(outcome.failed, false);
  assert.equal(outcome.partial, true);
  assert.deepEqual(outcome.steps.map(step => [step.stage, step.state]), [
    ['provider-read', 'partial'],
    ['artifact-write', 'succeeded'],
    ['snapshot', 'partial'],
    ['insertion', 'succeeded'],
    ['session-update', 'succeeded'],
    ['audit', 'succeeded'],
  ]);
  for (const label of ['Provider read', 'Artifact write', 'Snapshot', 'Insertion', 'Session update', 'Audit append']) {
    assert.match(outcome.display, new RegExp(label));
  }
  assert.match(outcome.display, /without submission/);

  const preparationFailure = operationStages.failedOperationStageOutcome(
    'JIRA-7 context preparation',
    [
      { stage: 'provider-read', state: 'succeeded' },
      { stage: 'snapshot', state: 'succeeded' },
    ],
    'artifact-write',
    Object.assign(new Error('private artifact path is read only'), { code: 'EROFS' }),
    'Private context artifact write failed.',
  );
  assert.equal(preparationFailure.steps.find(step => step.stage === 'artifact-write').state, 'failed');
  assert.equal(preparationFailure.steps.find(step => step.stage === 'insertion').state, 'not-attempted');
  assert.equal(preparationFailure.steps.find(step => step.stage === 'session-update').state, 'not-attempted');
  assert.match(preparationFailure.display, /Provider read succeeded/);
  assert.match(preparationFailure.display, /Artifact write failed/);
  assert.match(preparationFailure.display, /Insertion not-attempted/);
});

test('session failure still attempts audit and reports retained insertion without exposing credentials', () => {
  const secret = ['glpat-', 'failure-contract-secret'].join('');
  let auditCalls = 0;
  const sessionFailure = Object.assign(new Error(`private state denied Authorization: Bearer ${secret}`), { code: 'EACCES' });
  const outcome = operationStages.finalizeInsertedContext({
    operation: 'MR-17 context placement',
    providerRead: { state: 'succeeded' },
    sessionUpdate: () => { throw sessionFailure; },
    auditAppend: session => {
      auditCalls += 1;
      assert.equal(session, undefined);
    },
  });
  assert.equal(auditCalls, 1);
  assert.equal(outcome.failed, true);
  assert.equal(outcome.steps.find(step => step.stage === 'insertion').state, 'succeeded');
  assert.equal(outcome.steps.find(step => step.stage === 'session-update').state, 'failed');
  assert.equal(outcome.steps.find(step => step.stage === 'audit').state, 'succeeded');
  assert.match(outcome.display, /Session update failed/);
  assert.match(outcome.display, /Audit append succeeded/);
  assert.doesNotMatch(outcome.display, new RegExp(secret));
  assert.match(outcome.display, /REDACTED/);
});

test('audit failure does not hide a successful local session update or inserted reference', () => {
  const updated = { id: 'session-audit-failure' };
  const outcome = operationStages.finalizeInsertedContext({
    operation: 'CI context placement',
    providerRead: { state: 'succeeded' },
    sessionUpdate: () => updated,
    auditAppend: session => {
      assert.equal(session, updated);
      throw Object.assign(new Error('audit path is read only'), { code: 'EROFS' });
    },
  });
  assert.equal(outcome.failed, true);
  assert.equal(outcome.steps.find(step => step.stage === 'insertion').state, 'succeeded');
  assert.equal(outcome.steps.find(step => step.stage === 'session-update').state, 'succeeded');
  assert.equal(outcome.steps.find(step => step.stage === 'audit').state, 'failed');
  assert.match(outcome.display, /Insertion succeeded/);
  assert.match(outcome.display, /Session update succeeded/);
  assert.match(outcome.display, /Audit append failed/);
});

test('failure vocabulary distinguishes configuration, credentials, permission, transport, and bounded payload faults', () => {
  const withCode = (message, code) => Object.assign(new Error(message), { code });
  const cases = [
    [new Error('Provider configuration missing GITLAB_TOKEN.'), 'configuration'],
    [new Error('Provider request failed with HTTP 401.'), 'authentication'],
    [new Error('Provider request failed with HTTP 403.'), 'permission'],
    [withCode('connect timed out', 'ETIMEDOUT'), 'timeout'],
    [withCode('getaddrinfo failed', 'ENOTFOUND'), 'dns'],
    [new Error('TLS certificate verification failed.'), 'tls'],
    [new Error('Redirect outside the configured provider origin was rejected.'), 'redirect'],
    [new Error('Provider pagination next page failed.'), 'pagination'],
    [new Error('Provider response exceeded the response safety limit.'), 'response_limit'],
    [new Error('Provider returned invalid JSON.'), 'malformed_response'],
  ];
  for (const [error, expected] of cases) {
    const result = errorUtils.boundedOperationFailure(error, 'Provider read failed.');
    assert.equal(result.kind, expected);
    assert.ok(result.nextAction.length > 20);
    if (result.retryable) {
      assert.match(result.nextAction, /retry|poll again/i);
      assert.doesNotMatch(result.nextAction, /token=|authorization:|bearer /i);
    }
  }
  assert.notEqual(errorUtils.boundedOperationFailure(cases[0][0], 'failed').kind, cases[1][1]);
  assert.notEqual(errorUtils.boundedOperationFailure(cases[1][0], 'failed').kind, cases[2][1]);
});

test('Jira retains successful ticket and recent comment evidence when later comments and attachments are partial', async () => {
  const client = new JiraRestClient({
    env: {
      JIRA_BASE_URL: 'https://jira.example',
      JIRA_EMAIL: 'operator@example.test',
      JIRA_API_TOKEN: 'fixture-only',
    },
    commentsPerPage: 1,
    maxCommentPages: 3,
    transport: async request => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/comment')) {
        const startAt = Number(url.searchParams.get('startAt') || 0);
        if (startAt > 0) { return { statusCode: 503, body: '', headers: {} }; }
        return {
          statusCode: 200,
          body: JSON.stringify({
            comments: [{ id: 'latest', body: 'Retained recent comment', created: '2026-07-15T10:00:00.000Z' }],
            total: 2,
            isLast: false,
          }),
          headers: {},
        };
      }
      if (url.pathname.includes('/attachment/content/')) {
        return { statusCode: 503, body: '', headers: {} };
      }
      return {
        statusCode: 200,
        body: JSON.stringify({
          fields: {
            summary: 'Retained Jira ticket',
            description: 'The base ticket read remains valid.',
            attachment: [{ id: '101', filename: 'evidence.msg', size: 12 }],
          },
          names: { summary: 'Summary', description: 'Description', attachment: 'Attachment' },
          schema: {
            summary: { type: 'string', system: 'summary' },
            description: { type: 'string', system: 'description' },
            attachment: { type: 'array', system: 'attachment' },
          },
        }),
        headers: {},
      };
    },
  });
  const snapshot = await client.ticketContext('JIRA-7');
  const context = jiraContext.normalizeJiraTicketContext('JIRA-7', snapshot);
  assert.equal(context.summary, 'Retained Jira ticket');
  assert.equal(context.comments[0].body, 'Retained recent comment');
  assert.equal(context.completeness.commentsComplete, false);
  assert.equal(context.completeness.attachmentBodiesFailed, 1);
  assert.equal(context.completeness.complete, false);
  assert.match(context.completeness.warnings.join(' '), /previously fetched comment|comments may be incomplete/i);
  assert.match(context.completeness.warnings.join(' '), /attachment.*partial/i);
});

test('Jenkins keeps the valid build while unavailable JUnit and stage APIs stay explicit', async () => {
  const client = new JenkinsRestClient({
    env: { JENKINS_URL: 'https://jenkins.example' },
    transport: async request => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/testReport/api/json') || url.pathname.endsWith('/wfapi/describe')) {
        return { statusCode: 404, body: '', headers: {} };
      }
      if (url.pathname.endsWith('/config.xml')) { return { statusCode: 404, body: '', headers: {} }; }
      if (url.pathname.endsWith('/api/json')) {
        return {
          statusCode: 200,
          body: JSON.stringify({ number: 41, result: 'SUCCESS', building: false, url: 'https://jenkins.example/job/app/41/' }),
          headers: {},
        };
      }
      return { statusCode: 404, body: '', headers: {} };
    },
  });
  const context = await client.buildContext('https://jenkins.example/job/app/41/');
  assert.equal(context.build.number, 41);
  assert.equal(context.completeness.testReport, 'unavailable');
  assert.equal(context.completeness.stages, 'unavailable');
  assert.equal(context.completeness.complete, true, 'optional provider APIs do not erase a valid build read');
  assert.match(context.completeness.warnings.join(' '), /test report is unavailable/);
  assert.match(context.completeness.warnings.join(' '), /Pipeline stages is unavailable/);
});

test('mixed CI provider failure retains the other provider result with an explicit warning', () => {
  const jenkins = {
    completeness: {
      complete: true,
      buildComplete: true,
      testReport: 'unavailable',
      stages: 'unavailable',
      configuration: 'unavailable',
      logsIncluded: false,
      warnings: [],
    },
    build: { number: 9, status: 'SUCCESS' },
  };
  const context = ciContextStore.buildCiContext('JIRA-9', {
    jenkins,
    warnings: ['SonarQube read failed with HTTP 403. [permission] Verify read access.'],
  });
  assert.equal(context.completeness.jenkinsIncluded, true);
  assert.equal(context.completeness.sonarIncluded, false);
  assert.equal(context.jenkins.build.number, 9);
  assert.equal(context.completeness.complete, false);
  assert.match(context.completeness.warnings[0], /SonarQube.*403.*permission/);
});

test('poll notice distinguishes another-window lease ownership from missing provider configuration', () => {
  const lease = managedProviderMonitor.managedProviderPollNotice({
    polled: 0,
    transitions: 0,
    failures: 0,
    skipped: 0,
    unconfigured: 0,
    leaseUnavailable: true,
    leaseReason: 'contended',
  });
  const configuration = managedProviderMonitor.managedProviderPollNotice({
    polled: 0,
    transitions: 0,
    failures: 0,
    skipped: 0,
    unconfigured: 2,
    leaseUnavailable: false,
  });
  assert.equal(lease.kind, 'lease-unavailable');
  assert.match(lease.message, /Another Kronos window.*no duplicate read/i);
  assert.equal(configuration.kind, 'missing-configuration');
  assert.match(configuration.message, /2 project or legacy session targets missing provider configuration/);
  assert.doesNotMatch(configuration.message, /lease/);
});

test('failed monitoring remains visible while last-known-good timestamps stay retained', () => {
  const session = workSessions.createOrGetWorkSessionByTicket({ ticketKey: 'FAIL-7', title: 'Failure contract' });
  workSessions.recordWorkSessionMonitoringResult(session.id, {
    polled: 2,
    transitions: 1,
    failures: 0,
    skipped: 0,
    attemptedAt: '2026-07-15T10:00:00.000Z',
    summary: 'Two provider reads succeeded.',
  });
  workSessions.recordWorkSessionMonitoringResult(session.id, {
    polled: 0,
    transitions: 1,
    failures: 1,
    skipped: 0,
    attemptedAt: '2026-07-15T10:05:00.000Z',
    summary: 'One provider read failed; the previous snapshot remains retained.',
  });
  const stored = workSessions.readWorkSession(session.id);
  assert.equal(stored.monitoring.lastSuccessfulAt, '2026-07-15T10:00:00.000Z');
  assert.equal(stored.monitoring.lastAttemptAt, '2026-07-15T10:05:00.000Z');
  assert.equal(stored.monitoring.currentError, 'provider_read_failed');
  assert.match(stored.monitoring.lastSummary, /previous snapshot remains retained/);
});

test('operator surfaces use staged outcomes and the shared bounded failure vocabulary', () => {
  const extension = fs.readFileSync(path.join(root, 'src', 'terminalFirstExtension.ts'), 'utf8');
  assert.ok((extension.match(/finalizeInsertedContext\(/g) || []).length >= 5);
  assert.ok((extension.match(/failedOperationStageOutcome\(/g) || []).length >= 6);
  assert.match(extension, /managedProviderPollNotice\(result\)/);
  assert.doesNotMatch(extension, /local audit update failed|finish its local audit update/);
  for (const relativePath of [
    'src/terminalFirstExtension.ts',
    'src/services/operationStageOutcome.ts',
    'src/services/managedProviderMonitor.ts',
    'src/services/operationsReadiness.ts',
    'src/views/AttentionTreeProvider.ts',
    'src/views/ManagedSessionTreeProvider.ts',
  ]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /boundedOperationFailure\(|operationStageOutcome|providerReadDiagnostics|providerReadiness/);
  }
});
