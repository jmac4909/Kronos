const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const tempRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-prompt-library-')));
process.env.KRONOS_DIR = path.join(tempRoot, 'runtime');

const promptLibrary = require('../out/services/promptLibrary.js');
const promptArtifacts = require('../out/services/promptLibraryArtifactStore.js');
const promptView = require('../out/services/promptLibraryView.js');
const insertion = require('../out/services/terminalContextInsertion.js');
const messages = require('../out/services/webviewMessages.js');

test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

test('prompt manifest parsing is bounded, data-only, redacted, and source-versioned', () => {
  const manifest = JSON.stringify({
    schemaVersion: 1,
    name: 'Platform Team',
    prompts: [
      {
        id: 'review-mr',
        title: 'Review MR',
        description: 'Review before merge',
        body: 'Review {{project.name}}. TOKEN=fixture-sensitive-value',
        tags: ['review', 'gitlab'],
        suggestedContext: ['jira', 'merge-request', 'unsupported-context'],
      },
      { id: 'review-mr', title: 'Duplicate', body: 'ignored' },
      { id: 'bad id', title: 'Unsafe', body: 'ignored' },
    ],
  });
  const parsed = promptLibrary.parsePromptLibraryManifest(manifest, {
    kind: 'remote',
    location: 'https://git.example/team/kronos-prompts.json',
  });
  assert.equal(parsed.name, 'Platform Team');
  assert.equal(parsed.prompts.length, 1);
  const prompt = parsed.prompts[0];
  assert.equal(prompt.id, 'review-mr');
  assert.deepEqual(prompt.tags, ['review', 'gitlab']);
  assert.deepEqual(prompt.suggestedContext, ['jira', 'merge-request']);
  assert.match(prompt.body, /TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(prompt.body, /fixture-sensitive-value/);
  assert.match(prompt.revisionSha256, /^[a-f0-9]{64}$/);
  assert.ok(parsed.warnings.some(warning => /credential-shaped/i.test(warning)));
  assert.ok(parsed.warnings.some(warning => /duplicate id/i.test(warning)));
  assert.throws(
    () => promptLibrary.parsePromptLibraryManifest('{}', { kind: 'local', location: '/tmp/prompts.json' }),
    /schemaVersion 1/i,
  );
  assert.throws(
    () => promptLibrary.parsePromptLibraryManifest('{', { kind: 'local', location: '/tmp/prompts.json' }),
    /not valid JSON/i,
  );
  assert.throws(
    () => promptLibrary.parsePromptLibraryManifest('x'.repeat(1024 * 1024 + 1), { kind: 'local', location: '/tmp/prompts.json' }),
    /byte limit/i,
  );
  const malformedEntries = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'TOKEN=fixture-library-secret',
    prompts: [
      null,
      { id: 'missing-title', body: 'ignored' },
      { id: 'odd-metadata', title: 'Odd metadata', body: 'Review.', tags: 'review', suggestedContext: 'jira' },
      ...Array.from({ length: 99 }, (_, index) => ({ id: `bounded-${index}`, title: `Bounded ${index}`, body: 'Review.' })),
    ],
  }), { kind: 'local', location: '/tmp/prompts.json' });
  assert.equal(malformedEntries.prompts.length, 98);
  assert.doesNotMatch(malformedEntries.name, /fixture-library-secret/);
  assert.ok(malformedEntries.warnings.some(warning => /not an object/i.test(warning)));
  assert.ok(malformedEntries.warnings.some(warning => /missing-title title is missing/i.test(warning)));
  assert.ok(malformedEntries.warnings.some(warning => /were ignored because they were not an array/i.test(warning)));
  assert.ok(malformedEntries.warnings.some(warning => /more than 100 prompts/i.test(warning)));
});

test('prompt templates fill only allowlisted session variables and preserve unknown fields for review', () => {
  const parsed = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'Delivery',
    prompts: [{
      id: 'pipeline',
      title: 'Pipeline review',
      body: 'Session {{session.title}}; project {{project.name}}; branch {{project.branch}}; tickets {{jira.keys}}; keep {{custom.team}}.',
    }],
  }), { kind: 'local', location: '/safe/kronos-prompts.json' });
  const rendered = promptLibrary.renderPromptTemplate(parsed.prompts[0], {
    sessionTitle: 'Payments terminal',
    projectName: 'Payments API',
    projectPath: '/projects/payments',
    projectBranch: 'feature/retry',
    jiraKeys: ['PAY-41', 'PAY-42'],
  });
  assert.match(rendered.body, /Session Payments terminal/);
  assert.match(rendered.body, /project Payments API/);
  assert.match(rendered.body, /branch feature\/retry/);
  assert.match(rendered.body, /tickets PAY-41, PAY-42/);
  assert.match(rendered.body, /\{\{custom\.team\}\}/);
  assert.deepEqual(rendered.appliedVariables, ['jira.keys', 'project.branch', 'project.name', 'session.title']);
  assert.deepEqual(rendered.warnings, ['Unknown template variable {{custom.team}} was left for operator review.']);
});

test('local and remote Git manifests merge with origin-pinned GitLab auth and latest-good cache fallback', async () => {
  const localDirectory = path.join(tempRoot, 'team-prompts');
  fs.mkdirSync(localDirectory, { recursive: true });
  fs.writeFileSync(path.join(localDirectory, 'kronos-prompts.json'), JSON.stringify({
    schemaVersion: 1,
    name: 'Local Team',
    prompts: [{ id: 'local', title: 'Local prompt', body: 'Use local evidence.' }],
  }));
  fs.writeFileSync(path.join(localDirectory, 'ignored.json'), JSON.stringify({ schemaVersion: 1, name: 'Ignored', prompts: [] }));
  const remoteUrl = 'https://gitlab.example/api/v4/projects/12/repository/files/kronos-prompts.json/raw?ref=main';
  const requests = [];
  const options = {
    localPaths: [localDirectory],
    remoteUrls: [remoteUrl],
    kronosDir: path.join(tempRoot, 'cache-runtime'),
    env: { GITLAB_API_BASE_URL: 'https://gitlab.example/api/v4', GITLAB_TOKEN: 'fixture-token-value' },
    allowCredentialedRemote: true,
    transport: async request => {
      requests.push(request);
      return {
        statusCode: 200,
        body: JSON.stringify({
          schemaVersion: 1,
          name: 'Remote Team',
          prompts: [{ id: 'remote', title: 'Remote prompt', body: 'Use remote evidence. API_TOKEN=fixture-cache-secret' }],
        }),
      };
    },
  };
  const loaded = await promptLibrary.loadPromptLibraries(options);
  assert.deepEqual(loaded.prompts.map(prompt => prompt.id), ['local', 'remote']);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers['PRIVATE-TOKEN'], 'fixture-token-value');
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.deepEqual(loaded.sources.map(source => source.kind), ['local', 'remote']);
  assert.match(loaded.prompts[1].body, /API_TOKEN=\[REDACTED\]/);
  const cachedManifest = fs.readFileSync(path.join(
    options.kronosDir,
    'prompt-library-cache',
    require('node:crypto').createHash('sha256').update(remoteUrl).digest('hex').slice(0, 24),
    'manifest.json',
  ), 'utf8');
  assert.doesNotMatch(cachedManifest, /fixture-cache-secret/);
  assert.match(cachedManifest, /API_TOKEN=\[REDACTED\]/);

  const cached = await promptLibrary.loadPromptLibraries({
    ...options,
    transport: async () => { throw new Error('offline fixture'); },
  });
  assert.deepEqual(cached.prompts.map(prompt => prompt.id), ['local', 'remote']);
  assert.equal(cached.prompts[1].sourceKind, 'cache');
  assert.ok(cached.warnings.some(warning => /latest private cached copy/i.test(warning)));

  let unsafeRequestCount = 0;
  const unsafe = await promptLibrary.loadPromptLibraries({
    remoteUrls: ['https://gitlab.example/prompts.json?private_token=do-not-store'],
    kronosDir: path.join(tempRoot, 'unsafe-runtime'),
    transport: async () => { unsafeRequestCount += 1; return { statusCode: 200, body: '{}' }; },
  });
  assert.equal(unsafeRequestCount, 0);
  assert.equal(unsafe.prompts.length, 0);
  assert.ok(unsafe.warnings.some(warning => /credential-free HTTPS/i.test(warning)));
  assert.equal(
    promptLibrary.promptLibraryRequestHeaders('https://other.example/prompts.json', options.env, true)['PRIVATE-TOKEN'],
    undefined,
  );
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl(''), undefined);
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('not a URL'), undefined);
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('ftp://git.example/prompts.json'), undefined);
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('https://user:pass@git.example/prompts.json'), undefined);
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('https://git.example/prompts.json#main'), undefined);
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('http://git.example/prompts.json'), undefined);
  assert.match(promptLibrary.normalizePromptLibraryRemoteUrl('http://127.0.0.2/prompts.json'), /^http:/);
  assert.equal(
    promptLibrary.promptLibraryRequestHeaders(remoteUrl, { GITLAB_TOKEN: 'fixture-token-value' }, false)['PRIVATE-TOKEN'],
    undefined,
  );

  const emptyDirectory = path.join(tempRoot, 'empty-prompt-library');
  const malformedPath = path.join(tempRoot, 'malformed.kronos-prompts.json');
  fs.mkdirSync(emptyDirectory, { recursive: true });
  fs.writeFileSync(malformedPath, '{');
  let failedRequest;
  const failures = await promptLibrary.loadPromptLibraries({
    localPaths: [path.join(tempRoot, 'missing-prompts.json'), emptyDirectory, malformedPath],
    remoteUrls: ['https://git.example/unavailable-prompts.json'],
    kronosDir: path.join(tempRoot, 'failure-runtime'),
    timeoutMs: 1,
    transport: async request => {
      failedRequest = request;
      return { statusCode: 503, body: '' };
    },
  });
  assert.equal(failures.prompts.length, 0);
  assert.equal(failures.sources.length, 4);
  assert.equal(failedRequest.timeoutMs, 1_000);
  assert.ok(failures.warnings.some(warning => /contains no kronos-prompts/i.test(warning)));
  assert.ok(failures.warnings.some(warning => /HTTP 503/i.test(warning)));
});

test('reviewed prompt snapshots are immutable, credential-redacted, and inserted without submission', () => {
  const prompt = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'Platform Team',
    prompts: [{ id: 'handoff', title: 'Prepare handoff', body: 'Prepare a handoff.' }],
  }), { kind: 'local', location: path.join(tempRoot, 'team-prompts', 'kronos-prompts.json') }).prompts[0];
  const input = {
    prompt,
    editedBody: 'Prepare the handoff. API_TOKEN=fixture-private-value',
    context: {
      sessionTitle: 'Platform terminal',
      projectName: 'Platform API',
      projectPath: path.join(tempRoot, 'platform'),
      projectBranch: 'feature/handoff',
      jiraKeys: ['OPS-91'],
    },
  };
  const now = new Date('2026-07-16T12:00:00.000Z');
  const artifact = promptArtifacts.writePromptLibraryArtifact(input, { kronosDir: path.join(tempRoot, 'artifacts'), now });
  const repeated = promptArtifacts.writePromptLibraryArtifact(input, { kronosDir: path.join(tempRoot, 'artifacts'), now });
  assert.equal(repeated.id, artifact.id);
  assert.match(artifact.id, /^PROMPT-[A-F0-9]{24}$/);
  const markdown = fs.readFileSync(artifact.promptPath, 'utf8');
  assert.match(markdown, /API_TOKEN=\[REDACTED\]/);
  assert.doesNotMatch(markdown, /fixture-private-value/);
  assert.equal(artifact.bodyRedacted, true);
  if (process.platform !== 'win32') { assert.equal(fs.statSync(artifact.promptPath).mode & 0o777, 0o600); }
  const reference = insertion.buildPromptLibraryTerminalReference(artifact.id, artifact.promptPath);
  const sends = [];
  insertion.insertTerminalContextReference({ sendText: (...args) => sends.push(args) }, reference);
  assert.deepEqual(sends, [[reference, false]]);
  assert.throws(
    () => insertion.buildPromptLibraryTerminalReference(artifact.id, path.join(tempRoot, 'wrong', 'prompt.md')),
    /expected prompt artifact/i,
  );
  assert.throws(
    () => promptArtifacts.writePromptLibraryArtifact({ ...input, editedBody: '' }, { kronosDir: path.join(tempRoot, 'artifacts') }),
    /must be 1-20000 characters/i,
  );
  assert.throws(
    () => promptArtifacts.writePromptLibraryArtifact({
      ...input,
      prompt: { ...prompt, revisionSha256: 'not-a-hash' },
    }, { kronosDir: path.join(tempRoot, 'artifacts') }),
    /revision hash is invalid/i,
  );
});

test('prompt library composer escapes content and accepts only bounded editor messages', () => {
  const html = promptView.buildPromptLibraryComposerHtml({
    title: '<Review>',
    description: 'Review & repair',
    libraryName: 'Team <Core>',
    sourceLabel: 'remote • https://git.example/prompts.json',
    terminalName: 'Claude <main>',
    body: 'Review {{jira.key}}\n<script>bad()</script>',
    tags: ['review'],
    suggestedContext: ['jira', 'merge-request'],
    appliedVariables: ['jira.key'],
    warnings: ['Review before placing'],
    nonce: 'abcdef1234567890',
    scriptUri: 'vscode-resource://kronos/media/kronos-prompt-library.js',
  });
  assert.match(html, /id="prompt-body"/);
  assert.match(html, /data-action="insertPrompt"/);
  assert.match(html, /Place in Terminal/);
  assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.deepEqual(messages.normalizePromptLibraryComposerMessage({ command: 'insertPrompt', body: 'edited' }), {
    command: 'insertPrompt', body: 'edited',
  });
  assert.deepEqual(messages.normalizePromptLibraryComposerMessage({ command: 'openSettings', body: 'ignored' }), {
    command: 'openSettings',
  });
  assert.equal(messages.normalizePromptLibraryComposerMessage({ command: 'insertPrompt', body: 'x'.repeat(20_001) }), null);
  assert.equal(messages.normalizePromptLibraryComposerMessage({ command: 'execute', body: 'no' }), null);
});
