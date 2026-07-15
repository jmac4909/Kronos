const assert = require('node:assert/strict');
const test = require('node:test');

const { WorkRefreshCoordinator } = require('../out/services/workRefreshCoordinator.js');

test('scheduled Work refreshes coalesce behind one in-flight read', async () => {
  const reads = [];
  const coordinator = new WorkRefreshCoordinator(signal => new Promise(resolve => {
    reads.push({ signal, resolve });
  }));
  const first = coordinator.run(false);
  const overlap = await coordinator.run(false);
  assert.deepEqual(overlap, { kind: 'coalesced' });
  assert.equal(reads.length, 1);
  assert.equal(reads[0].signal.aborted, false);
  reads[0].resolve('current');
  assert.deepEqual(await first, { kind: 'complete', value: 'current' });
});

test('a newer explicit Work refresh supersedes a late stale result', async () => {
  const reads = [];
  const coordinator = new WorkRefreshCoordinator(signal => new Promise(resolve => {
    reads.push({ signal, resolve });
  }));
  const stale = coordinator.run(true);
  const newest = coordinator.run(true);
  assert.equal(reads.length, 2);
  assert.equal(reads[0].signal.aborted, true);
  assert.equal(reads[1].signal.aborted, false);
  reads[1].resolve('newest');
  assert.deepEqual(await newest, { kind: 'complete', value: 'newest' });
  reads[0].resolve('stale');
  assert.deepEqual(await stale, { kind: 'superseded' });
});

test('a failed Work refresh releases ownership for the next request', async () => {
  let attempt = 0;
  const coordinator = new WorkRefreshCoordinator(async () => {
    attempt += 1;
    if (attempt === 1) { throw new Error('synthetic read failure'); }
    return 'recovered';
  });
  await assert.rejects(coordinator.run(true), /synthetic read failure/);
  assert.deepEqual(await coordinator.run(false), { kind: 'complete', value: 'recovered' });
});

test('disposing Work refresh orchestration aborts its active read', async () => {
  let activeSignal;
  let resolveRead;
  const coordinator = new WorkRefreshCoordinator(signal => new Promise(resolve => {
    activeSignal = signal;
    resolveRead = resolve;
  }));
  const active = coordinator.run(false);
  coordinator.dispose();
  assert.equal(activeSignal.aborted, true);
  resolveRead('ignored');
  assert.deepEqual(await active, { kind: 'superseded' });
});
