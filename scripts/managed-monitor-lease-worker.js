const managedMonitorLease = require('../out/services/managedMonitorLease.js');

let leaseHandle;

process.on('message', message => {
  if (!message || typeof message !== 'object' || typeof message.requestId !== 'number') { return; }
  const respond = payload => {
    if (process.connected) { process.send({ requestId: message.requestId, ...payload }); }
  };

  try {
    if (message.command === 'acquire') {
      leaseHandle = managedMonitorLease.tryAcquireManagedMonitorLease({
        kronosDir: message.kronosDir,
        ttlMs: message.ttlMs,
      });
      respond({
        acquired: leaseHandle.acquired,
        reason: leaseHandle.reason,
        ownerId: leaseHandle.lease?.ownerId,
        pid: process.pid,
      });
      return;
    }
    if (message.command === 'release') {
      const released = leaseHandle?.release() || false;
      if (released) { leaseHandle = undefined; }
      respond({ released, pid: process.pid });
      return;
    }
    if (message.command === 'shutdown') {
      leaseHandle?.release();
      leaseHandle = undefined;
      respond({ stopped: true, pid: process.pid });
      return;
    }
    respond({ error: 'unsupported-command', pid: process.pid });
  } catch {
    respond({ error: 'worker-operation-failed', pid: process.pid });
  }
});

process.on('disconnect', () => {
  leaseHandle?.release();
  process.exit(0);
});
