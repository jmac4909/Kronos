'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function publishedStateFailures(state) {
  const failures = [];
  if (state.status.trim()) { failures.push('worktree is not clean'); }
  if (!state.branch || state.branch === 'HEAD') { failures.push('repository is not on a named branch'); }
  if (!/^[a-f0-9]{40}$/.test(state.localHead)) { failures.push('local HEAD is invalid'); }
  if (!/^[a-f0-9]{40}$/.test(state.remoteHead)) { failures.push('remote branch HEAD is unavailable or invalid'); }
  if (state.localHead && state.remoteHead && state.localHead !== state.remoteHead) {
    failures.push('local and remote branch heads do not match');
  }
  return failures;
}

function verifyPublishedBranch(workspaceRoot = root) {
  const branch = git(workspaceRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']).trim();
  const remote = git(workspaceRoot, ['config', '--get', `branch.${branch}.remote`]).trim();
  const remoteRef = git(workspaceRoot, ['config', '--get', `branch.${branch}.merge`]).trim();
  if (!remote || !remoteRef.startsWith('refs/heads/')) {
    throw new Error(`Branch ${branch} does not have a configured remote branch.`);
  }
  const localHead = git(workspaceRoot, ['rev-parse', 'HEAD']).trim();
  const remoteLine = git(workspaceRoot, ['ls-remote', '--exit-code', remote, remoteRef]).trim();
  const remoteHead = remoteLine.split(/\s+/)[0] || '';
  const state = {
    status: git(workspaceRoot, ['status', '--porcelain=v1', '--untracked-files=all']),
    branch,
    localHead,
    remoteHead,
  };
  const failures = publishedStateFailures(state);
  if (failures.length > 0) { throw new Error(`Kronos publish verification failed: ${failures.join('; ')}.`); }
  return { branch, remote, remoteRef, head: localHead };
}

function git(workspaceRoot, args) {
  return execFileSync('git', args, { cwd: workspaceRoot, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

if (require.main === module) {
  try {
    const result = verifyPublishedBranch(root);
    console.log(`Kronos publish state OK (${result.branch}; clean; local and ${result.remote}/${result.remoteRef} at ${result.head}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = { publishedStateFailures, verifyPublishedBranch };
