const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const kronosDir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-context-basket-')));
process.env.KRONOS_DIR = kronosDir;

const {
  addContextBasketItem,
  buildContextBasketReference,
  clearContextBasket,
  contextBasketConflictIds,
  contextBasketPath,
  listContextBasketItems,
  removeContextBasketItem,
  writeContextBasketBundle,
} = require('../out/services/contextBasketStore.js');
const { buildContextBasketHtml } = require('../out/services/contextBasketView.js');
const { isSafeTerminalContextReference } = require('../out/services/terminalContextInsertion.js');
const { normalizeContextBasketMessage } = require('../out/services/webviewMessages.js');

test.beforeEach(() => clearContextBasket());
test.after(() => fs.rmSync(kronosDir, { recursive: true, force: true }));

test('context basket stores bounded provenance beside private artifact references', () => {
  const artifact = sourceArtifact('jira-one', 'private Jira fixture');
  const added = addContextBasketItem(input({ promptPath: artifact, contentSha256: undefined }));
  const listed = listContextBasketItems();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, added.id);
  assert.equal(listed[0].provenance, 'Jira ticket BASKET-1');
  assert.equal(listed[0].sizeBytes, Buffer.byteLength('private Jira fixture'));
  assert.match(listed[0].contentSha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.statSync(contextBasketPath()).mode & 0o777, 0o600);
  assert.throws(() => addContextBasketItem(input({
    promptPath: artifact,
    contentSha256: '0'.repeat(64),
  })), /does not match its supplied SHA-256 hash/);
  const stored = fs.readFileSync(contextBasketPath(), 'utf8');
  const tampered = JSON.parse(stored);
  tampered.items[0].promptPath = path.join(os.tmpdir(), 'outside-kronos', 'prompt.md');
  fs.writeFileSync(contextBasketPath(), `${JSON.stringify(tampered)}\n`, { mode: 0o600 });
  assert.throws(() => listContextBasketItems(), /inside the Kronos data directory/);
  fs.writeFileSync(contextBasketPath(), stored, { mode: 0o600 });
});

test('exact artifacts deduplicate while changed content for one source is marked conflicting', () => {
  const firstArtifact = sourceArtifact('jira-first', 'first version');
  const first = addContextBasketItem(input({ promptPath: firstArtifact }));
  const duplicate = addContextBasketItem(input({ promptPath: firstArtifact }));
  assert.equal(first.id, duplicate.id);
  assert.equal(listContextBasketItems().length, 1);

  const second = addContextBasketItem(input({ promptPath: sourceArtifact('jira-second', 'second version') }));
  const items = listContextBasketItems();
  assert.equal(items.length, 2);
  assert.deepEqual([...contextBasketConflictIds(items)].sort(), [first.id, second.id].sort());
});

test('removing a basket selection never deletes its private source artifact', () => {
  const artifact = sourceArtifact('git-one', 'working tree evidence');
  const added = addContextBasketItem(input({
    kind: 'git',
    sourceKey: 'git:Application',
    label: '[GIT-APPLICATION] local Git working tree',
    provenance: 'Local Git Application @ main',
    promptPath: artifact,
    refresh: { kind: 'git', projectName: 'Application' },
  }));
  assert.equal(removeContextBasketItem(added.id), true);
  assert.equal(listContextBasketItems().length, 0);
  assert.equal(fs.readFileSync(artifact, 'utf8'), 'working tree evidence');
});

test('project MR and CI basket sources refresh without fabricated Jira identities', () => {
  for (const kind of ['gitlab', 'ci']) {
    const added = addContextBasketItem(input({
      kind,
      sourceKey: `${kind}:Application`,
      label: `${kind} project evidence`,
      provenance: `${kind} evidence for Application`,
      promptPath: sourceArtifact(`${kind}-project`, `${kind} project evidence`),
      refresh: { kind, projectName: 'Application' },
    }));
    assert.deepEqual(added.refresh, { kind, projectName: 'Application' });
    assert.equal(Object.hasOwn(added.refresh, 'ticketKey'), false);
  }
  assert.throws(() => addContextBasketItem(input({
    kind: 'gitlab',
    sourceKey: 'gitlab:missing-owner',
    refresh: { kind: 'gitlab' },
  })), /requires a ticket or registered project/);
});

test('basket bundles retain references and hashes without copying source payloads', () => {
  addContextBasketItem(input({ promptPath: sourceArtifact('bundle-first', 'SECRET-SOURCE-PAYLOAD-ONE') }));
  addContextBasketItem(input({ promptPath: sourceArtifact('bundle-second', 'SECRET-SOURCE-PAYLOAD-TWO') }));
  const items = listContextBasketItems();
  const bundle = writeContextBasketBundle(items, 'Compare the evidence and explain conflicts.', {
    now: new Date('2026-07-15T12:00:00.000Z'),
  });
  const body = fs.readFileSync(bundle.promptPath, 'utf8');
  assert.equal(bundle.complete, false);
  assert.match(body, /Compare the evidence and explain conflicts\./);
  assert.match(body, /Artifact: `.*bundle-first.*`/);
  assert.doesNotMatch(body, /SECRET-SOURCE-PAYLOAD/);
  assert.equal(isSafeTerminalContextReference(buildContextBasketReference(bundle)), true);
});

test('basket messages and HTML expose only bounded explicit actions', () => {
  const added = addContextBasketItem(input({ promptPath: sourceArtifact('view-one', 'view evidence') }));
  assert.deepEqual(normalizeContextBasketMessage({
    command: 'refresh',
    entryId: added.id,
    focus: 'Refresh explicitly',
    credential: 'must be dropped',
  }), { command: 'refresh', entryId: added.id, focus: 'Refresh explicitly' });
  assert.equal(normalizeContextBasketMessage({ command: 'insert', focus: 'x'.repeat(4_001) }), null);
  const html = buildContextBasketHtml({
    items: [added],
    conflictIds: new Set(),
    nonce: 'basket-test-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-context-basket.js',
  });
  assert.match(html, /Place Basket in Terminal/);
  assert.match(html, /data-entry-id="basket-/);
  assert.match(html, /Nothing refreshes or submits automatically/);
  assert.doesNotMatch(html, /must be dropped/);
});

function sourceArtifact(stem, content) {
  const directory = path.join(kronosDir, 'fixtures', stem);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const artifact = path.join(directory, 'prompt.md');
  fs.writeFileSync(artifact, content, { mode: 0o600 });
  return artifact;
}

function input(overrides = {}) {
  return {
    kind: 'jira',
    sourceKey: 'jira:BASKET-1',
    label: '[BASKET-1] Jira context',
    provenance: 'Jira ticket BASKET-1',
    promptPath: sourceArtifact('default', 'default artifact'),
    fetchedAt: '2026-07-15T11:00:00.000Z',
    complete: true,
    warnings: [],
    refresh: { kind: 'jira', ticketKey: 'BASKET-1' },
    ...overrides,
  };
}
