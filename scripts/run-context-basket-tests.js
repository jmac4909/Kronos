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
const { assertSafeTerminalContextReference } = require('../out/services/terminalContextInsertion.js');
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
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(contextBasketPath()).mode & 0o777, 0o600);
  }
  assert.throws(() => addContextBasketItem(input({
    promptPath: artifact,
    contentSha256: '0'.repeat(64),
  })), /does not match its supplied SHA-256 hash/);
  assert.throws(() => addContextBasketItem(input({
    promptPath: artifact,
    contentSha256: 'not-a-sha',
  })), /SHA-256 is invalid/);
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
  assert.doesNotThrow(() => assertSafeTerminalContextReference(buildContextBasketReference(bundle)));
});

test('basket bundle creation revalidates selected source content and metadata', () => {
  const artifact = sourceArtifact('bundle-integrity', 'AAAA');
  const added = addContextBasketItem(input({ promptPath: artifact }));
  assert.doesNotThrow(() => writeContextBasketBundle([added], 'Use only verified evidence.'));

  fs.writeFileSync(artifact, 'BBBB', { mode: 0o600 });
  assert.throws(
    () => writeContextBasketBundle([added], 'Reject changed evidence.'),
    /source artifact changed after selection/,
  );

  fs.writeFileSync(artifact, 'AAAA', { mode: 0o600 });
  assert.throws(
    () => writeContextBasketBundle([{ ...added, sizeBytes: added.sizeBytes + 1 }], 'Reject stale metadata.'),
    /source artifact size changed after selection/,
  );
  assert.throws(
    () => writeContextBasketBundle([{ ...added, contentSha256: 'not-a-sha' }], 'Reject malformed metadata.'),
    /SHA-256 is invalid/,
  );

  fs.unlinkSync(artifact);
  assert.throws(
    () => writeContextBasketBundle([added], 'Reject missing evidence.'),
    /source artifact is unavailable/,
  );
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
  assert.match(html, /Add to terminal/);
  assert.match(html, /Clear basket/);
  assert.ok(html.indexOf('data-action="close"') < html.indexOf('data-action="clear"'));
  assert.match(html, /data-entry-id="basket-/);
  assert.match(html, /Actions run only when selected/);
  assert.match(html, /Refresh source/);
  assert.match(html, /<details class="basket-source-details"><summary>Source details<\/summary>/);
  assert.match(html, /kronos-pill info">Jira<\/span>/);
  assert.match(html, /Saved /);
  assert.doesNotMatch(html, /Saved 2026-07-15T11:00:00\.000Z/);
  assert.doesNotMatch(html, /class="kronos-stat"/);
  assert.doesNotMatch(html, /must be dropped/);
});

test('basket HTML renders conflict, completeness, source-kind, hash, and size boundaries', () => {
  const base = {
    id: 'basket-view-boundary',
    kind: 'git',
    sourceKey: 'git:Application',
    label: 'Working tree evidence',
    provenance: 'Local Git Application @ main',
    promptPath: sourceArtifact('view-boundary', 'boundary evidence'),
    fetchedAt: 'not-a-timestamp',
    addedAt: '2026-07-20T12:00:00.000Z',
    complete: false,
    sizeBytes: 1024,
    warnings: ['Read stopped at the configured limit.'],
    refresh: { kind: 'git', projectName: 'Application' },
  };
  const html = buildContextBasketHtml({
    items: [
      base,
      { ...base, id: 'basket-view-large', kind: 'ci', label: 'CI evidence', sizeBytes: 1024 * 1024, complete: true },
      { ...base, id: 'basket-view-unknown', kind: 'unexpected', label: 'Unknown evidence', sizeBytes: 7 },
    ],
    conflictIds: new Set([base.id]),
    nonce: 'basket-boundary-nonce',
    scriptUri: 'vscode-resource://kronos/media/kronos-context-basket.js',
    focus: 'Compare only the bounded evidence.',
  });
  assert.match(html, /basket-item conflict/);
  assert.match(html, /Conflict: another basket item has different content/);
  assert.match(html, /Project changes/);
  assert.match(html, /Build &amp; quality/);
  assert.match(html, /SHA-256: <code>unavailable<\/code>/);
  assert.match(html, /1\.0 KiB/);
  assert.match(html, /1\.0 MiB/);
  assert.match(html, /7 B/);
  assert.match(html, /Compare only the bounded evidence/);
  assert.match(html, />2<\/span><span class="basket-summary-label">Partial/);
  assert.match(html, />1<\/span><span class="basket-summary-label">Conflicts/);
});

test('basket persisted-state ingress covers schemas, refresh owners, field bounds, and retention limits', () => {
  const artifact = sourceArtifact('schema-matrix', 'schema matrix evidence');
  const base = {
    id: 'basket-schema-matrix',
    kind: 'jira',
    sourceKey: 'jira:SCHEMA-1',
    label: 'Schema matrix',
    provenance: 'Jira ticket SCHEMA-1',
    promptPath: artifact,
    fetchedAt: '2026-07-20T12:00:00.000Z',
    addedAt: '2026-07-20T12:01:00.000Z',
    complete: true,
    sizeBytes: 22,
    warnings: [],
    refresh: { kind: 'jira', ticketKey: 'schema-1' },
  };
  const writeRaw = value => fs.writeFileSync(contextBasketPath(), `${JSON.stringify(value)}\n`, { mode: 0o600 });
  for (const value of [null, [], {}, { schemaVersion: 2, items: [] }, { schemaVersion: 1, items: {} }]) {
    writeRaw(value);
    assert.throws(() => listContextBasketItems(), /schema is invalid or unsupported/i);
  }
  const invalidItems = [
    [null, /must be an object/i],
    [{ ...base, kind: 'unknown' }, /kind is invalid/i],
    [{ ...base, refresh: null }, /refresh target is invalid/i],
    [{ ...base, refresh: { kind: 'gitlab', ticketKey: 'SCHEMA-1' } }, /refresh target is invalid/i],
    [{ ...base, refresh: { kind: 'jira' } }, /requires a ticket key/i],
    [{ ...base, kind: 'gitlab', refresh: { kind: 'gitlab' } }, /requires a ticket or registered project/i],
    [{ ...base, kind: 'ci', refresh: { kind: 'ci' } }, /requires a ticket or registered project/i],
    [{ ...base, kind: 'git', refresh: { kind: 'git' } }, /requires a project/i],
    [{ ...base, id: 'bad/id' }, /id is invalid/i],
    [{ ...base, sourceKey: '' }, /text field is missing/i],
    [{ ...base, label: 'x'.repeat(1_201) }, /text field is missing/i],
    [{ ...base, promptPath: kronosDir }, /inside the Kronos data directory/i],
    [{ ...base, promptPath: path.join(os.tmpdir(), 'outside-basket.md') }, /inside the Kronos data directory/i],
    [{ ...base, fetchedAt: 'invalid' }, /timestamp is invalid/i],
    [{ ...base, addedAt: '' }, /text field is missing/i],
    [{ ...base, sizeBytes: -1 }, /artifact size is invalid/i],
    [{ ...base, sizeBytes: Number.MAX_SAFE_INTEGER + 1 }, /artifact size is invalid/i],
    [{ ...base, contentSha256: 'wrong' }, /SHA-256 is invalid/i],
  ];
  for (const [item, expected] of invalidItems) {
    writeRaw({ schemaVersion: 1, items: [item] });
    assert.throws(() => listContextBasketItems(), expected);
  }

  const items = Array.from({ length: 21 }, (_, index) => ({
    ...base,
    id: `basket-schema-${index}`,
    warnings: index === 20 ? Array.from({ length: 12 }, (_, warning) => `warning ${warning}`) : 'invalid warnings',
  }));
  writeRaw({ schemaVersion: 1, items });
  const retained = listContextBasketItems();
  assert.equal(retained.length, 20);
  assert.equal(retained[0].id, 'basket-schema-1');
  assert.equal(retained.at(-1).warnings.length, 10);
  assert.deepEqual(retained[0].warnings, []);
  retained[0].label = 'mutated clone';
  assert.notEqual(listContextBasketItems()[0].label, 'mutated clone');
  assert.equal(removeContextBasketItem('missing-entry'), false);
  assert.throws(() => removeContextBasketItem('bad/id'), /id is invalid/i);
  assert.equal(clearContextBasket(), 20);
  assert.deepEqual(listContextBasketItems(), []);
});

test('basket bundle boundaries cover empty input, fallback conflict identity, focus sanitization, and invalid clocks', () => {
  assert.throws(() => writeContextBasketBundle([], 'nothing selected'), /basket is empty/i);
  const artifact = sourceArtifact('bundle-boundaries', 'bundle boundary evidence');
  const first = addContextBasketItem(input({
    sourceKey: 'jira:BOUNDARY-1',
    promptPath: artifact,
    refresh: { kind: 'jira', ticketKey: 'BOUNDARY-1' },
  }));
  const withoutHashes = [
    { ...first, id: 'basket-boundary-first', contentSha256: undefined },
    { ...first, id: 'basket-boundary-second', contentSha256: undefined },
  ];
  assert.deepEqual([...contextBasketConflictIds(withoutHashes)].sort(), [
    'basket-boundary-first', 'basket-boundary-second',
  ]);
  assert.throws(
    () => writeContextBasketBundle([first], 'invalid clock', { now: new Date(Number.NaN) }),
    /current time is invalid/i,
  );
  const bundle = writeContextBasketBundle([first], 7);
  const body = fs.readFileSync(bundle.promptPath, 'utf8');
  assert.match(body, /Review the selected evidence together before making changes/);
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
