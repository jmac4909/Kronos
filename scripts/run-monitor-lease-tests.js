const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const leases = require('../out/services/managedMonitorLease.js');

function withPatched(object, replacements, operation) {
  const originals = new Map();
  for (const [name, replacement] of Object.entries(replacements)) {
    originals.set(name, object[name]);
    object[name] = replacement;
  }
  try {
    return operation();
  } finally {
    for (const [name, original] of originals) object[name] = original;
  }
}

function withLease(t, name, operation) {
  const root = fixtureRoot(t, name);
  const handle = leases.tryAcquireManagedMonitorLease({ kronosDir: root });
  assert.equal(handle.acquired, true);
  try {
    operation(handle, root);
  } finally {
    handle.release();
  }
}

function fixtureRoot(t, name = 'lease') {
  const parent = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'kronos-monitor-lease-')));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return path.join(parent, name);
}

function readLease(root) {
  return JSON.parse(fs.readFileSync(leases.managedMonitorLeasePath({ kronosDir: root }), 'utf8'));
}

function writeRawLease(root, value) {
  const leasePath = leases.managedMonitorLeasePath({ kronosDir: root });
  fs.mkdirSync(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(leasePath, typeof value === 'string' ? value : `${JSON.stringify(value)}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') {
    fs.chmodSync(root, 0o700);
    fs.chmodSync(path.dirname(leasePath), 0o700);
    fs.chmodSync(leasePath, 0o600);
  }
  return leasePath;
}

test('managed monitor leases clamp TTLs, renew ownership, recover expiration, and make release idempotent', t => {
  const root = fixtureRoot(t);
  const at = new Date('2026-07-20T00:00:00.000Z');
  assert.equal(
    leases.managedMonitorLeasePath({ kronosDir: root }),
    path.join(path.resolve(root), 'leases', 'managed-monitor-poll.lease'),
  );

  const first = leases.tryAcquireManagedMonitorLease({ kronosDir: root, ttlMs: 1, now: at });
  assert.equal(first.acquired, true);
  assert.equal(Date.parse(first.lease.expiresAt) - Date.parse(first.lease.acquiredAt), 1_000);
  assert.equal(Object.isFrozen(first.lease), true);
  const duplicate = leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: at });
  assert.deepEqual({ acquired: duplicate.acquired, reason: duplicate.reason }, { acquired: false, reason: 'active' });
  assert.equal(duplicate.renew(), false);
  assert.equal(duplicate.release(), false);

  assert.equal(first.renew({ ttlMs: Number.NaN, now: new Date(at.getTime() + 250) }), true);
  assert.equal(Date.parse(first.lease.expiresAt) - Date.parse(first.lease.acquiredAt), 300_000);
  assert.equal(readLease(root).ownerId, first.lease.ownerId);
  assert.equal(first.renew({ ttlMs: 60 * 60 * 1000, now: new Date(at.getTime() + 500) }), true);
  assert.equal(Date.parse(first.lease.expiresAt) - Date.parse(first.lease.acquiredAt), 30 * 60 * 1000);
  assert.equal(first.release(), true);
  assert.equal(first.release(), false);
  assert.equal(first.renew(), false);

  const expiring = leases.tryAcquireManagedMonitorLease({ kronosDir: root, ttlMs: 1_000, now: at });
  assert.equal(expiring.acquired, true);
  const recovered = leases.tryAcquireManagedMonitorLease({
    kronosDir: root,
    ttlMs: 5_000,
    now: new Date(at.getTime() + 1_001),
  });
  assert.equal(recovered.acquired, true);
  assert.notEqual(recovered.lease.ownerId, expiring.lease.ownerId);
  assert.equal(expiring.renew(), false);
  assert.equal(expiring.release(), false);
  assert.equal(recovered.release(), true);
  assert.match(leases.managedMonitorLeasePath(), /managed-monitor-poll\.lease$/);
});

test('managed monitor lease acquisition fails closed for invalid time, unsafe paths, and malformed records', t => {
  const invalidTimeRoot = fixtureRoot(t, 'invalid-time');
  assert.deepEqual(
    (() => {
      const handle = leases.tryAcquireManagedMonitorLease({ kronosDir: invalidTimeRoot, now: new Date(Number.NaN) });
      return { acquired: handle.acquired, reason: handle.reason };
    })(),
    { acquired: false, reason: 'unsafe' },
  );

  const parentFileRoot = fixtureRoot(t, 'parent-file');
  fs.mkdirSync(path.dirname(parentFileRoot), { recursive: true });
  fs.writeFileSync(parentFileRoot, 'not a directory');
  const unsafeParent = leases.tryAcquireManagedMonitorLease({ kronosDir: parentFileRoot });
  assert.equal(unsafeParent.reason, 'unsafe');

  const cases = [
    null,
    'not json',
    [],
    { schema: 'wrong' },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z', extra: true,
    },
    {
      schema: 'wrong', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 2, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'INVALID', pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 7, pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 0,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: '1',
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1.5,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: 'invalid', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00Z', expiresAt: '2026-07-20T00:00:05.000Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:00.500Z',
    },
    {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T01:00:00.000Z',
    },
  ];
  for (const [index, value] of cases.entries()) {
    const root = fixtureRoot(t, `malformed-${index}`);
    writeRawLease(root, value);
    const handle = leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: new Date('2026-07-20T00:00:01.000Z') });
    assert.deepEqual({ acquired: handle.acquired, reason: handle.reason }, { acquired: false, reason: 'unsafe' });
  }

  for (const [name, prepare] of [
    ['empty-file', leasePath => fs.truncateSync(leasePath, 0)],
    ['oversized-file', leasePath => fs.writeFileSync(leasePath, 'x'.repeat(4097), { mode: 0o600 })],
    ['directory-file', leasePath => { fs.unlinkSync(leasePath); fs.mkdirSync(leasePath); }],
  ]) {
    const root = fixtureRoot(t, name);
    const leasePath = writeRawLease(root, {
      schema: 'kronos.managed-monitor-lease', schemaVersion: 1, ownerId: 'a'.repeat(48), pid: 1,
      acquiredAt: '2026-07-20T00:00:00.000Z', expiresAt: '2026-07-20T00:00:05.000Z',
    });
    prepare(leasePath);
    assert.equal(leases.tryAcquireManagedMonitorLease({ kronosDir: root }).reason, 'unsafe');
  }
});

test('expired crash pins are recovered only when the unique hard link proves lease identity', t => {
  const root = fixtureRoot(t);
  const at = new Date('2026-07-20T00:00:00.000Z');
  const crashed = leases.tryAcquireManagedMonitorLease({ kronosDir: root, ttlMs: 1_000, now: at });
  assert.equal(crashed.acquired, true);
  const leasePath = crashed.leasePath;
  const pinPath = path.join(path.dirname(leasePath), `.${path.basename(leasePath)}.${'a'.repeat(32)}.unlink-pin`);
  fs.linkSync(leasePath, pinPath);

  const active = leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: new Date(at.getTime() + 500) });
  assert.equal(active.reason, 'active');
  const recovered = leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: new Date(at.getTime() + 1_001) });
  assert.equal(recovered.acquired, true);
  assert.equal(fs.existsSync(pinPath), false);
  assert.equal(recovered.release(), true);

  const ambiguous = leases.tryAcquireManagedMonitorLease({ kronosDir: root, ttlMs: 1_000, now: at });
  assert.equal(ambiguous.acquired, true);
  const firstPin = path.join(path.dirname(ambiguous.leasePath), `.${path.basename(ambiguous.leasePath)}.${'b'.repeat(32)}.unlink-pin`);
  const secondPin = path.join(path.dirname(ambiguous.leasePath), `.${path.basename(ambiguous.leasePath)}.${'c'.repeat(32)}.unlink-pin`);
  fs.linkSync(ambiguous.leasePath, firstPin);
  fs.linkSync(ambiguous.leasePath, secondPin);
  const rejected = leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: new Date(at.getTime() + 1_001) });
  assert.equal(rejected.reason, 'unsafe');
});

test('lease creation and recovery fail closed across entropy, descriptor, identity, and contention faults', t => {
  const entropyRoot = fixtureRoot(t, 'entropy');
  assert.equal(withPatched(crypto, {
    randomBytes() { throw new Error('fixture entropy failure'); },
  }, () => leases.tryAcquireManagedMonitorLease({ kronosDir: entropyRoot }).reason), 'unsafe');

  const openRoot = fixtureRoot(t, 'open');
  const originalOpen = fs.openSync;
  assert.equal(withPatched(fs, {
    openSync(filePath, flags, mode) {
      if (String(filePath).endsWith('.lease')) throw Object.assign(new Error('fixture open failure'), { code: 'EACCES' });
      return originalOpen(filePath, flags, mode);
    },
  }, () => leases.tryAcquireManagedMonitorLease({ kronosDir: openRoot }).reason), 'unsafe');

  const descriptorRoot = fixtureRoot(t, 'descriptor');
  const originalFstat = fs.fstatSync;
  let fstatCalls = 0;
  const unsafeDescriptor = withPatched(fs, {
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 1 ? { ...stat, isFile: () => false } : stat;
    },
  }, () => leases.tryAcquireManagedMonitorLease({ kronosDir: descriptorRoot }));
  assert.equal(unsafeDescriptor.reason, 'unsafe');
  assert.equal(fs.existsSync(leases.managedMonitorLeasePath({ kronosDir: descriptorRoot })), false);

  const changedRoot = fixtureRoot(t, 'changed');
  fstatCalls = 0;
  const changed = withPatched(fs, {
    fstatSync(descriptor) {
      const stat = originalFstat(descriptor);
      fstatCalls += 1;
      return fstatCalls === 2 ? { ...stat, size: stat.size + 1 } : stat;
    },
  }, () => leases.tryAcquireManagedMonitorLease({ kronosDir: changedRoot }));
  assert.equal(changed.reason, 'unsafe');

  const expiredRoot = fixtureRoot(t, 'expired-contention');
  const at = new Date('2026-07-20T00:00:00.000Z');
  const expired = leases.tryAcquireManagedMonitorLease({ kronosDir: expiredRoot, ttlMs: 1_000, now: at });
  assert.equal(expired.acquired, true);
  const originalLink = fs.linkSync;
  const contended = withPatched(fs, {
    linkSync(source, target) {
      if (source === expired.leasePath) throw Object.assign(new Error('fixture contention'), { code: 'EEXIST' });
      return originalLink(source, target);
    },
  }, () => leases.tryAcquireManagedMonitorLease({
    kronosDir: expiredRoot,
    now: new Date(at.getTime() + 1_001),
  }));
  assert.equal(contended.reason, 'contended');

  for (const [name, code, reason] of [['second-create-contended', 'EEXIST', 'contended'], ['second-create-unsafe', 'EACCES', 'unsafe']]) {
    const root = fixtureRoot(t, name);
    const expiredHandle = leases.tryAcquireManagedMonitorLease({ kronosDir: root, ttlMs: 1_000, now: at });
    assert.equal(expiredHandle.acquired, true);
    let leaseOpenCalls = 0;
    const result = withPatched(fs, {
      openSync(filePath, flags, mode) {
        if (filePath === expiredHandle.leasePath && (flags & fs.constants.O_EXCL)) {
          leaseOpenCalls += 1;
          if (leaseOpenCalls === 2) throw Object.assign(new Error('fixture second create race'), { code });
        }
        return originalOpen(filePath, flags, mode);
      },
    }, () => leases.tryAcquireManagedMonitorLease({ kronosDir: root, now: new Date(at.getTime() + 1_001) }));
    assert.equal(result.reason, reason);
  }
});

test('lease renewal and release reject races, short IO, invalid clocks, and directory sync failures', t => {
  withLease(t, 'invalid-renewal-time', handle => {
    assert.equal(handle.renew({ now: new Date(Number.NaN) }), false);
  });

  withLease(t, 'renewal-link-failure', (handle, root) => {
    const originalLink = fs.linkSync;
    assert.equal(withPatched(fs, {
      linkSync(source, target) {
        if (source === handle.leasePath) throw Object.assign(new Error('fixture link failure'), { code: 'EPERM' });
        return originalLink(source, target);
      },
    }, () => handle.renew()), false);
    assert.equal(readLease(root).ownerId, handle.lease.ownerId);
  });

  withLease(t, 'renewal-short-read', handle => {
    const originalRead = fs.readSync;
    assert.equal(withPatched(fs, {
      readSync(descriptor, buffer, offset, length, position) {
        if (position === 0) return 0;
        return originalRead(descriptor, buffer, offset, length, position);
      },
    }, () => handle.renew()), false);
  });

  withLease(t, 'renewal-short-write', handle => {
    const originalWrite = fs.writeSync;
    assert.equal(withPatched(fs, {
      writeSync(descriptor, buffer, offset, length, position) {
        if (position === 0) return 0;
        return originalWrite(descriptor, buffer, offset, length, position);
      },
    }, () => handle.renew()), false);
  });

  withLease(t, 'renewal-identity-drift', handle => {
    const originalFstat = fs.fstatSync;
    let calls = 0;
    assert.equal(withPatched(fs, {
      fstatSync(descriptor) {
        const stat = originalFstat(descriptor);
        calls += 1;
        return calls >= 4 ? { ...stat, ino: Number(stat.ino) + 1 } : stat;
      },
    }, () => handle.renew()), false);
  });

  withLease(t, 'release-link-failure', handle => {
    const originalLink = fs.linkSync;
    assert.equal(withPatched(fs, {
      linkSync(source, target) {
        if (source === handle.leasePath) throw Object.assign(new Error('fixture release race'), { code: 'ENOENT' });
        return originalLink(source, target);
      },
    }, () => handle.release()), false);
  });

  const syncRoot = fixtureRoot(t, 'release-sync-failure');
  const syncHandle = leases.tryAcquireManagedMonitorLease({ kronosDir: syncRoot });
  assert.equal(syncHandle.acquired, true);
  const originalFsync = fs.fsyncSync;
  assert.equal(withPatched(fs, {
    fsyncSync(descriptor) {
      const stat = fs.fstatSync(descriptor);
      if (stat.isDirectory()) throw new Error('fixture directory sync failure');
      return originalFsync(descriptor);
    },
  }, () => syncHandle.release()), false);
  assert.equal(fs.existsSync(syncHandle.leasePath), false);

  withLease(t, 'owner-replaced', (handle, root) => {
    const replacement = { ...readLease(root), ownerId: 'b'.repeat(48) };
    fs.writeFileSync(handle.leasePath, `${JSON.stringify(replacement)}\n`, { mode: 0o600 });
    assert.equal(handle.renew(), false);
    assert.equal(handle.release(), false);
  });

  withLease(t, 'lease-disappeared', handle => {
    fs.unlinkSync(handle.leasePath);
    assert.equal(handle.renew(), false);
    assert.equal(handle.release(), false);
  });
});
