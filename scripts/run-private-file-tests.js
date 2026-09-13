const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const privateFiles = require('../out/services/privateFilePrimitives.js');

function fixtureRoot(t) {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-private-files-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function options(overrides = {}) {
  return {
    label: 'Private file behavior fixture',
    maxBytes: 128,
    temporaryPrefix: 'private-file-fixture',
    fileMode: 0o600,
    ...overrides,
  };
}

function withPatchedFs(replacements, operation) {
  const originals = new Map();
  for (const [name, replacement] of Object.entries(replacements)) {
    originals.set(name, fs[name]);
    fs[name] = replacement;
  }
  try {
    return operation();
  } finally {
    for (const [name, original] of originals) fs[name] = original;
  }
}

function statWith(stat, overrides) {
  return {
    ...stat,
    isFile: () => stat.isFile(),
    isDirectory: () => stat.isDirectory(),
    isSymbolicLink: () => stat.isSymbolicLink(),
    ...overrides,
  };
}

test('private directory and open-flag policies reject unsafe inputs and cover every intent', t => {
  const root = fixtureRoot(t);
  assert.throws(() => privateFiles.ensurePrivateDirectoryPath(path.parse(root).root, 'Fixture'), /filesystem root/);
  for (const mode of [-1, 0o1000, 1.5]) {
    assert.throws(() => privateFiles.ensurePrivateDirectoryPath(path.join(root, 'bad-mode'), 'Fixture', mode), /mode is invalid/);
  }

  const directory = path.join(root, 'one', 'two');
  assert.equal(privateFiles.ensurePrivateDirectoryPath(directory, 'Fixture', 0o750), directory);
  assert.equal(privateFiles.ensurePrivateDirectoryPath(directory, 'Fixture', 0o700), directory);
  assert.equal(privateFiles.assertSafeDirectoryPath(directory, 'Fixture'), directory);
  assert.throws(() => privateFiles.assertSafeDirectoryPath(path.join(root, 'missing'), 'Fixture'), /unsafe or unavailable/);
  const parentFile = path.join(root, 'parent-file');
  fs.writeFileSync(parentFile, 'not a directory');
  assert.throws(
    () => privateFiles.ensurePrivateDirectoryPath(path.join(parentFile, 'child'), 'Fixture'),
    /unsafe directory component|non-directory parent/,
  );

  const constants = { noFollow: 0x20000, nonBlocking: 0x800, directory: 0x10000 };
  const expected = {
    read: fs.constants.O_RDONLY | constants.noFollow,
    'exclusive-write': fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | constants.noFollow,
    'append-write': fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | constants.noFollow,
    'read-nonblocking': fs.constants.O_RDONLY | constants.nonBlocking | constants.noFollow,
    'read-write-nonblocking': fs.constants.O_RDWR | constants.nonBlocking | constants.noFollow,
    'directory-read': fs.constants.O_RDONLY | constants.directory | constants.noFollow,
  };
  for (const [intent, flags] of Object.entries(expected)) {
    assert.equal(privateFiles.privateFileOpenFlags(intent, 'linux', constants), flags);
  }
  assert.equal(
    privateFiles.privateFileOpenFlags('read-nonblocking', 'linux', { noFollow: constants.noFollow }),
    fs.constants.O_RDONLY | constants.noFollow,
  );
  assert.equal(
    privateFiles.privateFileOpenFlags('directory-read', 'linux', { noFollow: constants.noFollow }),
    fs.constants.O_RDONLY | constants.noFollow,
  );
  assert.equal(privateFiles.privateFileOpenFlags('read-write-nonblocking', 'win32', {}), fs.constants.O_RDWR);
  assert.doesNotThrow(() => privateFiles.securePrivateDescriptorMode(-1, 0o600, 'win32'));
});

test('bounded reads, atomic writes, and append tails cover absent, empty, full, and rejected files', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'data'), 'Fixture');
  const filePath = path.join(directory, 'state.txt');
  const readOptions = options({ expectedMode: 0o600 });

  assert.equal(privateFiles.readPrivateBufferFileIfPresent(filePath, readOptions), null);
  assert.equal(privateFiles.readPrivateTextFileIfPresent(filePath, readOptions), null);
  assert.equal(privateFiles.readPrivateTextTailLinesIfPresent(filePath, readOptions), null);
  assert.throws(
    () => privateFiles.writePrivateTextFileAtomically(filePath, 'value', options({ temporaryPrefix: ' bad prefix ' })),
    /temporary prefix is invalid/,
  );
  assert.equal(fs.existsSync(filePath), false);

  assert.equal(privateFiles.writePrivateTextFileAtomically(filePath, '', options()), filePath);
  assert.deepEqual(privateFiles.readPrivateBufferFileIfPresent(filePath, readOptions), Buffer.alloc(0));
  assert.equal(privateFiles.readPrivateTextFileIfPresent(filePath, readOptions), '');
  assert.deepEqual(privateFiles.readPrivateTextTailLinesIfPresent(filePath, readOptions), []);
  privateFiles.writePrivateTextFileAtomically(filePath, 'alpha\r\nbeta\n', options());
  assert.deepEqual(privateFiles.readPrivateTextTailLinesIfPresent(filePath, options()), ['alpha', 'beta']);
  assert.deepEqual(
    privateFiles.readPrivateTextTailLinesIfPresent(filePath, options({ maxBytes: 8 })),
    ['beta'],
  );
  assert.deepEqual(
    privateFiles.readPrivateTextTailLinesIfPresent(filePath, options({ maxBytes: 2 })),
    [],
  );
  for (const maxBytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => privateFiles.readPrivateTextTailLinesIfPresent(filePath, options({ maxBytes })),
      /positive safe integer/,
    );
  }

  const appendPath = path.join(directory, 'events.jsonl');
  assert.throws(() => privateFiles.appendPrivateTextRecord(appendPath, '', options()), /record is empty/);
  assert.throws(() => privateFiles.appendPrivateTextRecord(appendPath, 'x'.repeat(129), options()), /byte limit/);
  assert.equal(privateFiles.appendPrivateTextRecord(appendPath, 'one\n', options()), appendPath);
  assert.equal(privateFiles.appendPrivateTextRecord(appendPath, 'two\n', options()), appendPath);
  assert.deepEqual(privateFiles.readPrivateTextTailLinesIfPresent(appendPath, options()), ['one', 'two']);

  const directoryTarget = path.join(directory, 'not-a-file');
  fs.mkdirSync(directoryTarget);
  assert.throws(() => privateFiles.readPrivateTextFileIfPresent(directoryTarget, readOptions), /not a safe regular file/);
  assert.throws(() => privateFiles.writePrivateTextFileAtomically(directoryTarget, 'value', options()), /not a safe replaceable file/);
  assert.throws(() => privateFiles.appendPrivateTextRecord(directoryTarget, 'value\n', options()), /not a safe replaceable file/);

  if (process.platform !== 'win32') {
    fs.chmodSync(filePath, 0o640);
    assert.throws(() => privateFiles.readPrivateTextFileIfPresent(filePath, readOptions), /private permissions/);
  }
  assert.doesNotThrow(() => privateFiles.syncPrivateDirectory(directory));
});

test('immutable private files and pairs publish, verify, reject partial state, and roll back failures', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'artifacts'), 'Fixture');
  const firstPath = path.join(directory, 'first.txt');
  const secondPath = path.join(directory, 'second.txt');
  const firstOptions = options({ label: 'First immutable fixture', temporaryPrefix: 'first' });
  const secondOptions = options({ label: 'Second immutable fixture', temporaryPrefix: 'second' });

  assert.deepEqual(privateFiles.ensureImmutablePrivateFile(firstPath, 'one', firstOptions), {
    path: firstPath,
    created: true,
  });
  assert.deepEqual(privateFiles.ensureImmutablePrivateFile(firstPath, Buffer.from('one'), firstOptions), {
    path: firstPath,
    created: false,
  });
  assert.throws(
    () => privateFiles.ensureImmutablePrivateFile(firstPath, 'different', firstOptions),
    /immutable content address/,
  );

  fs.unlinkSync(firstPath);
  const createdPair = privateFiles.ensureImmutablePrivateFilePair(
    firstPath, 'one', firstOptions, secondPath, Buffer.from('two'), secondOptions,
  );
  assert.equal(createdPair.first.created, true);
  assert.equal(createdPair.second.created, true);
  const verifiedPair = privateFiles.ensureImmutablePrivateFilePair(
    firstPath, 'one', firstOptions, secondPath, 'two', secondOptions,
  );
  assert.equal(verifiedPair.first.created, false);
  assert.equal(verifiedPair.second.created, false);

  fs.unlinkSync(secondPath);
  assert.throws(
    () => privateFiles.ensureImmutablePrivateFilePair(
      firstPath, 'one', firstOptions, secondPath, 'two', secondOptions,
    ),
    /pair is incomplete/,
  );
  assert.equal(fs.readFileSync(firstPath, 'utf8'), 'one');

  fs.unlinkSync(firstPath);
  fs.writeFileSync(secondPath, 'two', { mode: 0o600 });
  assert.throws(
    () => privateFiles.ensureImmutablePrivateFilePair(
      firstPath, 'one', firstOptions, secondPath, 'two', secondOptions,
    ),
    /pair is incomplete/,
  );

  fs.unlinkSync(secondPath);
  const missingParentPath = path.join(root, 'missing-parent', 'second.txt');
  assert.throws(
    () => privateFiles.ensureImmutablePrivateFilePair(
      firstPath, 'one', firstOptions, missingParentPath, 'two', secondOptions,
    ),
    /directory is unsafe or unavailable/,
  );
  assert.equal(fs.existsSync(firstPath), false, 'a newly published first file rolls back after second-file failure');
});

test('private file primitives fail closed on links, unsupported flags, size limits, and filesystem errors', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'fail-closed'), 'Fixture');
  const filePath = path.join(directory, 'state.txt');
  fs.writeFileSync(filePath, 'content', { mode: 0o600 });

  assert.equal(privateFiles.privateFileNoFollowFlag('win32'), 0);
  assert.throws(() => privateFiles.privateFileNoFollowFlag('linux', 0), /O_NOFOLLOW support/);
  assert.throws(() => privateFiles.privateFileNoFollowFlag('linux', 'bad'), /O_NOFOLLOW support/);
  assert.throws(() => privateFiles.readPrivateTextFileIfPresent(filePath, options({ maxBytes: 3 })), /byte limit/);
  assert.throws(() => privateFiles.writePrivateTextFileAtomically(filePath, 'toolong', options({ maxBytes: 3 })), /byte limit/);

  const linkedPath = path.join(directory, 'linked.txt');
  if (process.platform !== 'win32') {
    fs.symlinkSync(filePath, linkedPath);
    assert.throws(() => privateFiles.readPrivateTextFileIfPresent(linkedPath, options()), /symbolic link/);
    assert.throws(() => privateFiles.assertSafeDirectoryPath(linkedPath, 'Fixture'), /symbolic link/);
  }

  const originalLstat = fs.lstatSync;
  const accessError = Object.assign(new Error('fixture access failure'), { code: 'EACCES' });
  assert.throws(() => withPatchedFs({
    lstatSync(target) {
      if (target === filePath) throw accessError;
      return originalLstat(target);
    },
  }, () => privateFiles.readPrivateTextFileIfPresent(filePath, options())), /fixture access failure/);

  const originalMkdir = fs.mkdirSync;
  const mkdirError = Object.assign(new Error('fixture mkdir failure'), { code: 'EACCES' });
  assert.throws(() => withPatchedFs({
    mkdirSync(target, mkdirOptions) {
      if (target.endsWith('mkdir-failure')) throw mkdirError;
      return originalMkdir(target, mkdirOptions);
    },
  }, () => privateFiles.ensurePrivateDirectoryPath(path.join(directory, 'mkdir-failure'), 'Fixture')), /fixture mkdir failure/);

  assert.throws(() => withPatchedFs({
    fstatSync() { return { isDirectory: () => false }; },
  }, () => privateFiles.syncPrivateDirectory(directory)), /parent is not a directory/);
});

test('bounded descriptor operations reject identity drift, truncation, and short writes', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'descriptor-faults'), 'Fixture');
  const filePath = path.join(directory, 'state.txt');
  fs.writeFileSync(filePath, 'abcdef\n', { mode: 0o600 });

  const originalFstat = fs.fstatSync;
  let fstatCalls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 1 ? statWith(stat, { ino: Number(stat.ino) + 1 }) : stat;
    },
  }, () => privateFiles.readPrivateTextFileIfPresent(filePath, options())), /changed while it was being opened/);

  fstatCalls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 2 ? statWith(stat, { ino: Number(stat.ino) + 1 }) : stat;
    },
  }, () => privateFiles.readPrivateTextFileIfPresent(filePath, options())), /changed while it was being read/);

  const originalRead = fs.readSync;
  const originalWrite = fs.writeSync;
  assert.throws(() => withPatchedFs({
    readSync() { return 0; },
  }, () => privateFiles.readPrivateTextFileIfPresent(filePath, options())), /ended before its recorded size/);
  assert.throws(() => withPatchedFs({
    readSync() { return 0; },
  }, () => privateFiles.readPrivateTextTailLinesIfPresent(filePath, options())), /ended during a bounded tail read/);

  const atomicPath = path.join(directory, 'atomic.txt');
  assert.throws(() => withPatchedFs({
    writeSync() { return 0; },
  }, () => privateFiles.writePrivateTextFileAtomically(atomicPath, 'value', options())), /could not be written completely/);
  assert.equal(fs.existsSync(atomicPath), false);

  const appendPath = path.join(directory, 'append.txt');
  fs.writeFileSync(appendPath, 'first\n', { mode: 0o600 });
  assert.throws(() => withPatchedFs({
    writeSync(descriptor, buffer, offset, length, position) {
      if (position === null) return Math.max(0, length - 1);
      return originalWrite(descriptor, buffer, offset, length, position);
    },
  }, () => privateFiles.appendPrivateTextRecord(appendPath, 'second\n', options())), /could not be appended atomically/);

  assert.equal(typeof originalRead, 'function');
});

test('atomic publication removes private temporaries after unsafe descriptor state', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'atomic-faults'), 'Fixture');
  const filePath = path.join(directory, 'state.txt');
  const originalFstat = fs.fstatSync;
  let fstatCalls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 1 ? statWith(stat, { isFile: () => false }) : stat;
    },
  }, () => privateFiles.writePrivateTextFileAtomically(filePath, 'value', options())), /temporary path is not a safe regular file/);
  assert.equal(fs.existsSync(filePath), false);
  for (const name of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory, name));

  fstatCalls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 2 ? statWith(stat, { size: stat.size + 1 }) : stat;
    },
  }, () => privateFiles.writePrivateTextFileAtomically(filePath, 'value', options())), /temporary file changed while it was written/);
  assert.equal(fs.existsSync(filePath), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('private file publication and append fail closed across commit-time path races', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'commit-races'), 'Fixture');
  const atomicPath = path.join(directory, 'atomic.txt');
  const originalRandomBytes = crypto.randomBytes;
  const fixedEntropy = Buffer.alloc(8, 7);
  const temporaryPath = path.join(directory, `.atomic-fixture.${process.pid}.${fixedEntropy.toString('hex')}.tmp`);
  fs.writeFileSync(temporaryPath, 'occupied', { mode: 0o600 });
  assert.throws(() => withPatchedFs({}, () => {
    crypto.randomBytes = () => fixedEntropy;
    try {
      privateFiles.writePrivateTextFileAtomically(atomicPath, 'value', options({ temporaryPrefix: 'atomic-fixture' }));
    } finally {
      crypto.randomBytes = originalRandomBytes;
    }
  }), /temporary path already exists/);
  fs.unlinkSync(temporaryPath);

  const originalLstat = fs.lstatSync;
  assert.throws(() => withPatchedFs({
    lstatSync(target) {
      const stat = originalLstat(target);
      return target === temporaryPath && stat.isFile()
        ? statWith(stat, { ino: Number(stat.ino) + 1 })
        : stat;
    },
  }, () => {
    crypto.randomBytes = () => fixedEntropy;
    try {
      return privateFiles.writePrivateTextFileAtomically(atomicPath, 'value', options({ temporaryPrefix: 'atomic-fixture' }));
    } finally {
      crypto.randomBytes = originalRandomBytes;
    }
  }), /temporary path changed before commit/);
  assert.equal(fs.existsSync(atomicPath), false);

  const syncFailurePath = path.join(directory, 'sync-failure.txt');
  const originalFsync = fs.fsyncSync;
  assert.throws(() => withPatchedFs({
    fsyncSync(descriptor) {
      if (fs.fstatSync(descriptor).isDirectory()) throw new Error('fixture commit directory sync failure');
      return originalFsync(descriptor);
    },
  }, () => privateFiles.writePrivateTextFileAtomically(syncFailurePath, 'committed', options())), /directory sync failure/);
  assert.equal(fs.readFileSync(syncFailurePath, 'utf8'), 'committed');

  const appendPath = path.join(directory, 'append.txt');
  fs.writeFileSync(appendPath, 'first\n', { mode: 0o600 });
  const originalFstat = fs.fstatSync;
  let appendFstatCalls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      appendFstatCalls += 1;
      return appendFstatCalls === 1 ? statWith(stat, { ino: Number(stat.ino) + 1 }) : stat;
    },
  }, () => privateFiles.appendPrivateTextRecord(appendPath, 'second\n', options())), /changed while it was being opened for append/);

  let appendLstatCalls = 0;
  assert.throws(() => withPatchedFs({
    lstatSync(target) {
      const stat = originalLstat(target);
      if (target === appendPath) {
        appendLstatCalls += 1;
        if (appendLstatCalls === 2) return statWith(stat, { ino: Number(stat.ino) + 1 });
      }
      return stat;
    },
  }, () => privateFiles.appendPrivateTextRecord(appendPath, 'second\n', options())), /path changed while it was being opened for append/);
});

test('private tail and permission hardening reject descriptor and identity drift', t => {
  const root = fixtureRoot(t);
  const directory = privateFiles.ensurePrivateDirectoryPath(path.join(root, 'hardening-races'), 'Fixture');
  const filePath = path.join(directory, 'state.txt');
  fs.writeFileSync(filePath, 'alpha\nbeta\n', { mode: 0o600 });
  const originalFstat = fs.fstatSync;

  let calls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      calls += 1;
      return calls === 1 ? statWith(stat, { ino: Number(stat.ino) + 1 }) : stat;
    },
  }, () => privateFiles.readPrivateTextTailLinesIfPresent(filePath, options())), /changed while it was being opened for a tail read/);

  calls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      calls += 1;
      return calls === 1 ? statWith(stat, { size: -1 }) : stat;
    },
  }, () => privateFiles.readPrivateTextTailLinesIfPresent(filePath, options())), /unsupported file size/);

  calls = 0;
  assert.throws(() => withPatchedFs({
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      calls += 1;
      return calls === 2 ? statWith(stat, { ino: Number(stat.ino) + 1 }) : stat;
    },
  }, () => privateFiles.readPrivateTextTailLinesIfPresent(filePath, options())), /changed while its tail was being read/);

  const immutablePath = path.join(directory, 'immutable.txt');
  privateFiles.ensureImmutablePrivateFile(immutablePath, 'fixed', options({ temporaryPrefix: 'immutable' }));
  const originalOpen = fs.openSync;
  let fileOpenCalls = 0;
  let hardenedDescriptor;
  assert.throws(() => withPatchedFs({
    openSync(target, flags, mode) {
      const descriptor = originalOpen(target, flags, mode);
      if (target === immutablePath && ++fileOpenCalls === 2) hardenedDescriptor = descriptor;
      return descriptor;
    },
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      return descriptor === hardenedDescriptor ? statWith(stat, { isFile: () => false }) : stat;
    },
  }, () => privateFiles.ensureImmutablePrivateFile(immutablePath, 'fixed', options({ temporaryPrefix: 'immutable' }))), /changed while its permissions were opened/);
});
