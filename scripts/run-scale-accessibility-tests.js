const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { performance } = require('node:perf_hooks');

const { buildJiraWorkBoardHtml } = require('../out/services/jiraWorkBoardView.js');
const {
  collectWorkTicketFilterOptions,
  workTicketMatchesFilter,
} = require('../out/services/workTicketFilters.js');
const { buildWorkSessionAuditMarkdown } = require('../out/services/workSessionAuditView.js');
const { sessionInventoryPresentation } = require('../out/services/sessionInventoryPresentation.js');
const { buildProjectIntegrationPanelHtml } = require('../out/services/projectIntegrationView.js');
const { buildContextComposerHtml } = require('../out/services/contextComposerView.js');
const { buildTicketWorkspaceHtml } = require('../out/services/ticketWorkspaceView.js');
const { JiraRestClient, JiraRestCancelledError } = require('../out/services/jiraRestClient.js');

const root = path.resolve(__dirname, '..');

test('500-ticket board stays inside the checked render and output budget', () => {
  const state = scaleWorkCatalog(500);
  const started = performance.now();
  const html = buildJiraWorkBoardHtml({
    state,
    nonce: 'scale-fixture-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-jira-work-board.js',
  });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 2_000, `500-ticket board took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(html, 'utf8') < 8 * 1024 * 1024, 'board HTML exceeded 8 MiB');
  assert.equal((html.match(/data-ticket-card/g) || []).length, 500);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /tabindex="0" aria-label="Open SCALE-1:/);
  assert.match(html, /@media \(max-width: 580px\)/);
});

test('500-ticket filtering and facet collection stay inside the checked CPU budget', () => {
  const tickets = scaleWorkCatalog(500).tickets;
  const started = performance.now();
  const options = collectWorkTicketFilterOptions(tickets);
  const matched = Object.entries(tickets).filter(([key, ticket]) => workTicketMatchesFilter(key, ticket, {
    query: 'bounded fixture',
    jiraProject: 'TEAM-3',
    completion: 'all',
  }));
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_000, `500-ticket filter pass took ${elapsedMs.toFixed(1)} ms`);
  assert.equal(options.jiraProjects.length, 8);
  assert.ok(options.labels.length <= 12);
  assert.ok(matched.length > 0 && matched.length < 500);
});

test('2000 supplied audit events render only the newest 500 inside the checked budget', () => {
  const session = scaleSession();
  const events = Array.from({ length: 2_000 }, (_, index) => ({
    schemaVersion: 1,
    id: `event-${index}`,
    at: new Date(Date.UTC(2026, 6, 14, 12, 0, index % 60)).toISOString(),
    sessionId: session.id,
    type: 'provider.transition',
    source: 'gitlab',
    summary: `Bounded transition ${index} ${'detail '.repeat(20)}`,
    subject: { kind: 'merge-request', id: String(index % 25), ticketKey: 'SCALE-1' },
    before: { state: 'running' },
    after: { state: 'success' },
  }));
  const started = performance.now();
  const markdown = buildWorkSessionAuditMarkdown(session, events);
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_000, `audit summary took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(markdown, 'utf8') < 2 * 1024 * 1024, 'audit Markdown exceeded 2 MiB');
  assert.equal((markdown.match(/^\- \*\*/gm) || []).length, 500);
  assert.match(markdown, /Showing the newest 500 of 2000 supplied events/);
});

test('maximum project and session collections render bounded summaries within local budgets', () => {
  const projects = Array.from({ length: 250 }, (_, index) => ({
    name: `Project-${String(index).padStart(3, '0')}`,
    displayName: `Long registered project ${index} ${'name '.repeat(20)}`,
    path: `/workspace/project-${index}/${'nested/'.repeat(10)}`,
    branch: `feature/SCALE-${index}`,
    branchProfiles: Array.from({ length: 20 }, (_value, profile) =>
      `release/${profile} | https://jenkins.example.test/job/project-${index}/job/release-${profile}/ | app:${index} | release/${profile}`
    ).join('\n'),
  }));
  const projectStarted = performance.now();
  const projectHtml = buildProjectIntegrationPanelHtml({
    projects,
    providerReadiness: [
      { name: 'GitLab', ready: true, detail: 'Ready' },
      { name: 'Jenkins', ready: true, detail: 'Ready' },
      { name: 'SonarQube', ready: true, detail: 'Ready' },
    ],
    nonce: 'scale-project-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-project-integration.js',
  });
  const projectElapsedMs = performance.now() - projectStarted;
  assert.ok(projectElapsedMs < 2_000, `200-project setup took ${projectElapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(projectHtml, 'utf8') < 8 * 1024 * 1024, 'project setup HTML exceeded 8 MiB');
  assert.equal((projectHtml.match(/data-project-card/g) || []).length, 200);
  assert.doesNotMatch(projectHtml, /data-project-name="Project-200"/);

  const sessions = Array.from({ length: 200 }, (_, index) => scaleRichSession(index));
  const sessionStarted = performance.now();
  const presentations = sessions.map(session => sessionInventoryPresentation(
    session,
    indexParity(session.id),
    60_000,
    `feature/SCALE-${session.id}`,
  ));
  const sessionElapsedMs = performance.now() - sessionStarted;
  assert.ok(sessionElapsedMs < 1_000, `200-session summary pass took ${sessionElapsedMs.toFixed(1)} ms`);
  assert.equal(presentations.length, 200);
  assert.ok(presentations.every(item => item.tooltip.length < 10_000), 'session tooltip exceeded its summary budget');
  assert.match(presentations[0].tooltip, /\+52 more/);
  assert.match(presentations[0].tooltip, /\+80 more/);
});

test('large artifact previews render summaries without copying provider payloads into the DOM', () => {
  const hugeDetail = `${'provider payload '.repeat(8_000)}DO-NOT-RENDER-TAIL`;
  const started = performance.now();
  const composer = buildContextComposerHtml({
    title: 'Large evidence composer',
    subtitle: hugeDetail,
    sourceLabel: 'Scale fixture',
    terminalName: 'Claude — Scale',
    reference: `[SCALE-CONTEXT] Read private artifact ${hugeDetail}`,
    suggestedFocus: hugeDetail,
    evidence: Array.from({ length: 100 }, (_, index) => ({ label: `Evidence ${index}`, detail: hugeDetail })),
    warnings: Array.from({ length: 100 }, (_, index) => `Warning ${index} ${hugeDetail}`),
    nonce: 'scale-composer-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-context-composer.js',
  });
  const elapsedMs = performance.now() - started;
  assert.ok(elapsedMs < 1_000, `large composer summary took ${elapsedMs.toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(composer, 'utf8') < 256 * 1024, 'composer copied too much provider evidence');
  assert.equal((composer.match(/class="evidence-item"/g) || []).length, 20);
  assert.equal((composer.match(/class="message warn"/g) || []).length, 20);
  assert.match(composer, /Open Full Context/);
  assert.doesNotMatch(composer, /DO-NOT-RENDER-TAIL/);

  const session = scaleRichSession(0);
  const workspace = buildTicketWorkspaceHtml({
    ticketKey: 'SCALE-1',
    ticket: {
      summary: 'Bounded ticket workspace',
      type: 'Story',
      priority: 'High',
      jira_status: 'Review',
      source: 'jira',
      mr: null,
      build: null,
    },
    nonce: 'scale-workspace-nonce',
    actionScriptUri: 'vscode-resource://kronos/media/kronos-action-panel.js',
    workSession: session,
    liveTerminalCount: 1,
  });
  assert.equal((workspace.match(/class="artifact"/g) || []).length, 6);
  assert.equal((workspace.match(/<li><strong>gitlab<\/strong>/g) || []).length, 12);
  assert.match(workspace, /Showing the newest 12 of 64 local bindings/);
});

test('scale budget documents every bounded collection and supersession rule', () => {
  const budget = fs.readFileSync(path.join(root, 'docs', 'scale-accessibility-budget.md'), 'utf8');
  for (const row of [
    '| Jira Work |',
    '| Jira comments |',
    '| Jira attachments |',
    '| Registered projects |',
    '| Project discovery |',
    '| Work sessions |',
    '| Attention ledger |',
    '| Session audit |',
    '| Local Git |',
    '| Context composer |',
    '| GitLab |',
    '| Jenkins |',
    '| SonarQube |',
    '| Provider polling |',
  ]) {
    assert.match(budget, new RegExp(escapeRegex(row)), row);
  }
  assert.match(budget, /newer explicit Jira refresh aborts the prior transport signal and owns the only state write/i);
  assert.match(budget, /overlapping provider polls coalesce/i);
});

test('shared webview accessibility CSS and form labels cover focus, forced colors, and narrow panels', () => {
  const baseCss = fs.readFileSync(path.join(root, 'src', 'services', 'webviewHtml.ts'), 'utf8');
  const projectIntegration = fs.readFileSync(path.join(root, 'src', 'services', 'projectIntegrationView.ts'), 'utf8');
  const board = fs.readFileSync(path.join(root, 'src', 'services', 'jiraWorkBoardView.ts'), 'utf8');
  assert.match(baseCss, /:focus-visible/);
  assert.match(baseCss, /@media \(forced-colors: active\)/);
  assert.match(baseCss, /@media \(max-width: 760px\)/);
  assert.match(projectIntegration, /<label>\$\{escapeHtml\(label\)\}[^]*<input[^]*<\/label>/);
  assert.match(projectIntegration, /input\.projects\.slice\(0, 200\)/);
  assert.match(board, /role="\$\{isError \? 'alert' : 'status'\}"/);
  assert.match(board, /aria-label="Open \$\{escapeAttr\(ticket\.key\)\}/);
});

test('an aborted Jira read rejects before transport and is not reported as a provider failure', async () => {
  let transportCalls = 0;
  const client = new JiraRestClient({
    env: {
      JIRA_BASE_URL: 'https://jira.example.test',
      JIRA_EMAIL: 'fixture@example.test',
      JIRA_API_TOKEN: 'fixture-token-not-a-secret',
    },
    transport: async () => {
      transportCalls += 1;
      throw new Error('transport must not run');
    },
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.searchWorkList({ signal: controller.signal }), JiraRestCancelledError);
  assert.equal(transportCalls, 0);
});

function scaleWorkCatalog(count) {
  const tickets = {};
  for (let index = 1; index <= count; index += 1) {
    const completed = index % 7 === 0;
    tickets[`SCALE-${index}`] = {
      summary: `Bounded fixture ${index} ${'long summary '.repeat(24)}`,
      type: index % 9 === 0 ? 'Bug' : 'Story',
      priority: ['Low', 'Medium', 'High'][index % 3],
      jira_status: completed ? 'Done' : ['Open', 'In Progress', 'Review'][index % 3],
      jira_status_category: completed ? 'done' : 'indeterminate',
      jira_project_key: `TEAM-${index % 8}`,
      source: 'jira',
      labels: Array.from({ length: 12 }, (_, label) => `label-${label}`),
      linked_local_project: `Project ${index % 20}`,
      mr: null,
      build: null,
    };
  }
  return {
    schemaVersion: 2,
    refreshedAt: '2026-07-14T12:00:00.000Z',
    projects: {},
    tickets,
  };
}

function scaleSession() {
  return {
    schemaVersion: 1,
    id: 'session-scale-1',
    kind: 'ticket',
    ticketKey: 'SCALE-1',
    ticketKeys: ['SCALE-1'],
    title: 'Scale fixture session',
    status: 'active',
    createdAt: '2026-07-14T12:00:00.000Z',
    updatedAt: '2026-07-14T12:00:00.000Z',
    terminals: [],
    providerBindings: [],
    artifacts: [],
    monitoring: { enabled: true },
  };
}

function scaleRichSession(index) {
  const session = scaleSession();
  session.id = `session-scale-${index}`;
  session.ticketKey = `SCALE-${index + 1}`;
  session.ticketKeys = Array.from({ length: 100 }, (_value, ticket) => `SCALE-${index * 100 + ticket + 1}`);
  session.projectName = `Project ${index}`;
  session.projectPath = `/workspace/project-${index}`;
  session.providerBindings = Array.from({ length: 64 }, (_value, binding) => ({
    id: `gitlab-mr-${index}-${binding}`,
    provider: 'gitlab',
    resource: 'merge-request',
    subjectId: `${binding}-${'subject'.repeat(60)}`,
    attachedAt: '2026-07-14T12:00:00.000Z',
    url: `https://gitlab.example.test/group/app/-/merge_requests/${binding + 1}`,
  }));
  session.artifacts = Array.from({ length: 200 }, (_value, artifact) => ({
    id: `artifact-${index}-${artifact}`,
    kind: 'gitlab',
    label: `Artifact ${artifact} ${'summary '.repeat(30)}`,
    promptPath: `/private/kronos/context-${index}-${artifact}.md`,
    fetchedAt: '2026-07-14T12:00:00.000Z',
    recordedAt: new Date(Date.UTC(2026, 6, 14, 12, 0, artifact % 60)).toISOString(),
    complete: artifact % 2 === 0,
    warnings: Array.from({ length: 32 }, (_warning, warning) => `Bounded warning ${warning} ${'detail '.repeat(20)}`),
  }));
  return session;
}

function indexParity(value) {
  return Number(value.split('-').at(-1)) % 2;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
