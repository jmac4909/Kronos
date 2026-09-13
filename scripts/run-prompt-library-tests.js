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

test('prompt templates stay useful without a ticket or linked project and redact variable values', () => {
  const prompt = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'Terminal-first extras',
    prompts: [{
      id: 'standalone-review',
      title: 'Standalone review',
      body: [
        'Session: {{ session.title }}',
        'Project: {{project.name}} at {{project.path}} on {{project.branch}}',
        'Primary ticket: {{jira.key}}',
        'All tickets: {{jira.keys}}',
        'Repeat: {{project.name}}',
      ].join('\n'),
    }],
  }), { kind: 'local', location: '/safe/standalone.kronos-prompts.json' }).prompts[0];
  prompt.warnings.push('Fixture warning remains visible.');

  const standalone = promptLibrary.renderPromptTemplate(prompt, {
    sessionTitle: '  Interactive\nterminal  ',
    jiraKeys: [],
  });
  assert.match(standalone.body, /Session: Interactive terminal/);
  assert.match(standalone.body, /Project: No linked project at No linked project path on Branch unavailable/);
  assert.match(standalone.body, /Primary ticket: No Jira context/);
  assert.match(standalone.body, /All tickets: No Jira context/);
  assert.deepEqual(standalone.appliedVariables, [
    'jira.key',
    'jira.keys',
    'project.branch',
    'project.name',
    'project.path',
    'session.title',
  ]);
  assert.deepEqual(standalone.warnings, ['Fixture warning remains visible.']);

  const secret = ['TOKEN=', 'fixture-template-secret'].join('');
  const linked = promptLibrary.renderPromptTemplate(prompt, {
    sessionTitle: 'Review session',
    projectName: `Payments ${secret}`,
    projectPath: '/projects/payments',
    projectBranch: 'feature/review',
    jiraKeys: ['PAY-41', secret],
  });
  assert.doesNotMatch(linked.body, /fixture-template-secret/);
  assert.match(linked.body, /\[REDACTED\]/);
  assert.match(linked.body, /PAY-41/);
});

test('one invalid shared prompt never hides valid neighboring prompts', () => {
  const parsed = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'Shared team prompts',
    prompts: [
      { id: 'before', title: 'Before', body: 'Review before the invalid entry.' },
      { id: 'too-long', title: 'Too long', body: 'x'.repeat(20_001) },
      { id: 'missing-body', title: 'Missing body' },
      { id: 'after', title: 'After', body: 'Review after the invalid entry.' },
    ],
  }), { kind: 'remote', location: 'https://git.example/team/kronos-prompts.json' });
  assert.deepEqual(parsed.prompts.map(prompt => prompt.id), ['before', 'after']);
  assert.equal(parsed.warnings.length, 2);
  assert.match(parsed.warnings[0], /Prompt too-long body must be 1-20000 characters/i);
  assert.match(parsed.warnings[1], /Prompt missing-body body is missing/i);
  assert.ok(parsed.warnings.every(warning => warning.length <= 2_000));
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

test('prompt library boundary matrices cover aggregate limits, metadata pruning, home paths, and origin parsing', async () => {
  const metadata = promptLibrary.parsePromptLibraryManifest(JSON.stringify({
    schemaVersion: 1,
    name: 'Boundary prompts',
    prompts: [
      {
        id: 'rich', title: 'Rich prompt', description: 'Retained description', body: 'Review {{session.title}}.',
        tags: [' review ', 7, 'x'.repeat(51), 'review'],
        suggestedContext: ['jira', 'jira', null],
      },
      { id: 7, title: 'Numeric id', body: 'Ignored.' },
      { id: 'blank-title', title: '   ', body: 'Ignored.' },
    ],
  }), { kind: 'remote', location: 'https://git.example/rich.kronos-prompts.json' });
  assert.equal(metadata.prompts.length, 1);
  assert.deepEqual(metadata.prompts[0].tags, ['review']);
  assert.deepEqual(metadata.prompts[0].suggestedContext, ['jira']);
  assert.ok(metadata.warnings.some(warning => /missing, unsafe, or duplicate id/i.test(warning)));
  assert.ok(metadata.warnings.some(warning => /Unsupported suggested context null/i.test(warning)));

  const rendered = promptLibrary.renderPromptTemplate(metadata.prompts[0], {
    sessionTitle: ' \n ', projectName: ' \t ', projectPath: '', projectBranch: undefined,
    jiraKeys: [' ', 'SAFE-1'],
  });
  assert.match(rendered.body, /Review Unnamed session/);

  assert.equal(
    promptLibrary.normalizePromptLibraryRemoteUrl('https://git.example/TOKEN=fixture-secret/prompts.json'),
    undefined,
  );
  assert.equal(promptLibrary.normalizePromptLibraryRemoteUrl('x'.repeat(4_001)), undefined);
  const credentialHeaders = promptLibrary.promptLibraryRequestHeaders(
    'https://gitlab.example/prompts.json',
    {
      GITLAB_TOKEN: ' fixture-token ',
      GITLAB_HOST: 'gitlab.example',
      GITLAB_URL: 'https://user:password@gitlab.example',
      GITLAB_BASE_URL: 'ftp://gitlab.example',
      GITLAB_API_BASE_URL: 'https://[invalid',
    },
    true,
  );
  assert.equal(credentialHeaders['PRIVATE-TOKEN'], 'fixture-token');
  assert.equal(
    promptLibrary.promptLibraryRequestHeaders(
      'http://localhost/prompts.json',
      { GITLAB_TOKEN: 'fixture-token', GITLAB_URL: 'http://localhost' },
      true,
    )['PRIVATE-TOKEN'],
    'fixture-token',
  );

  const aggregateDirectory = path.join(tempRoot, 'aggregate-prompt-library');
  fs.mkdirSync(aggregateDirectory, { recursive: true });
  for (let libraryIndex = 0; libraryIndex < 6; libraryIndex += 1) {
    fs.writeFileSync(path.join(aggregateDirectory, `${libraryIndex}.kronos-prompts.json`), JSON.stringify({
      schemaVersion: 1,
      name: `Boundary ${libraryIndex}`,
      prompts: Array.from({ length: 100 }, (_, promptIndex) => ({
        id: `p-${libraryIndex}-${promptIndex}`, title: `Prompt ${promptIndex}`, body: 'Review.',
      })),
    }));
  }
  const aggregate = await promptLibrary.loadPromptLibraries({ localPaths: [aggregateDirectory] });
  assert.equal(aggregate.prompts.length, 500);
  assert.ok(aggregate.warnings.some(warning => /more than 500 prompts/i.test(warning)));

  const homeMisses = await promptLibrary.loadPromptLibraries({
    localPaths: ['~/kronos-prompt-library-missing-fixture', '~\\kronos-prompt-library-missing-fixture'],
  });
  assert.equal(homeMisses.prompts.length, 0);
  assert.equal(homeMisses.sources.length, 2);
  if (process.platform !== 'win32') {
    const target = path.join(tempRoot, 'symlink-prompt-target.json');
    const link = path.join(tempRoot, 'symlink-prompt-library.json');
    fs.writeFileSync(target, JSON.stringify({ schemaVersion: 1, name: 'Target', prompts: [] }));
    fs.symlinkSync(target, link);
    const linked = await promptLibrary.loadPromptLibraries({ localPaths: [link] });
    assert.equal(linked.prompts.length, 0);
    assert.match(linked.warnings[0], /symbolic link/i);
  }

  const cacheRoot = path.join(tempRoot, 'rich-cache-runtime');
  const richRemote = await promptLibrary.loadPromptLibraries({
    remoteUrls: ['https://git.example/rich-cache.json'],
    kronosDir: cacheRoot,
    transport: async () => ({
      statusCode: 200,
      body: JSON.stringify({
        schemaVersion: 1,
        name: 'Rich cache',
        prompts: [{
          id: 'rich-cache', title: 'Rich cache', description: 'Description', body: 'Review.',
          tags: ['cache'], suggestedContext: ['git'],
        }],
      }),
    }),
  });
  assert.equal(richRemote.prompts.length, 1);
  const cachedText = fs.readFileSync(path.join(
    cacheRoot,
    'prompt-library-cache',
    require('node:crypto').createHash('sha256').update('https://git.example/rich-cache.json').digest('hex').slice(0, 24),
    'manifest.json',
  ), 'utf8');
  assert.match(cachedText, /"description": "Description"/);
  assert.match(cachedText, /"tags"/);
  assert.match(cachedText, /"suggestedContext"/);
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
  insertion.insertEditableTerminalContextReference({ sendText: (...args) => sends.push(args) }, reference, '');
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
  assert.match(html, /Add to terminal/);
  assert.match(html, /Target terminal<\/span><strong>Claude &lt;main&gt;<\/strong>/);
  assert.match(html, /Library settings/);
  assert.match(html, /<details class="prompt-details"><summary>Suggested context<\/summary>/);
  assert.match(html, /<details class="prompt-details"><summary>Filled placeholders<\/summary>/);
  assert.match(html, /<details class="prompt-details"><summary>What happens next<\/summary>/);
  assert.match(html, /min-height: clamp\(380px, 58vh, 720px\)/);
  assert.match(html, /\.prompt-meta \{ position: static; max-height: none; overflow: visible; \}/);
  assert.ok(html.indexOf('data-action="insertPrompt"') < html.indexOf('data-action="openSettings"'));
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
