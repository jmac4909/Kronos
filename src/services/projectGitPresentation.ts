import type { ProjectGitEvidence } from './vscodeGitReadService';
import { operationsActionButton, operationsActionScript } from './operatorPanel';
import { escapeClass, escapeHtml, kronosWebviewBaseCss } from './webviewHtml';

export const PROJECT_GIT_STATE_ACTIONS: ReadonlySet<string> = new Set([
  'refresh',
  'openSourceControl',
  'close',
]);

export interface ProjectGitStatePanelInput {
  projectName: string;
  displayName?: string;
  evidence: ProjectGitEvidence;
  nonce: string;
  actionScriptUri: string;
}

export interface ProjectGitStatusPresentation {
  state: 'unavailable' | 'clean' | 'changed';
  label: string;
  tooltip: string;
  stagedCount: number;
  modifiedCount: number;
  untrackedCount: number;
  conflictCount: number;
}

/** Pure Projects-view projection for bounded read-only Git evidence. */
export function projectGitStatusPresentation(evidence: ProjectGitEvidence): ProjectGitStatusPresentation {
  if (!evidence.available) {
    return emptyPresentation('unavailable', 'status unavailable', 'unavailable');
  }
  if (evidence.changeCount === 0) {
    return emptyPresentation('clean', 'clean', 'clean working tree');
  }

  const stagedCount = evidence.changes.filter(change => change.staged).length;
  const untrackedCount = evidence.changes.filter(change => change.status === 'untracked').length;
  const conflictCount = evidence.changes.filter(change => isConflictStatus(change.status)).length;
  const modifiedCount = evidence.changes.filter(change =>
    !change.staged && change.status !== 'untracked' && !isConflictStatus(change.status)
  ).length;
  return {
    state: 'changed',
    label: [
      `${evidence.changeCount} change${evidence.changeCount === 1 ? '' : 's'}`,
      ...(stagedCount > 0 ? [`${stagedCount} staged`] : []),
      ...(conflictCount > 0 ? [`${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`] : []),
    ].join(' · '),
    tooltip: [
      `${evidence.changeCount} total`,
      `${stagedCount} staged`,
      `${modifiedCount} modified`,
      `${untrackedCount} untracked`,
      `${conflictCount} conflicted`,
    ].join(', '),
    stagedCount,
    modifiedCount,
    untrackedCount,
    conflictCount,
  };
}

/** A read-only project Git dashboard; branch changes stay in VS Code's native Source Control UI. */
export function buildProjectGitStatePanelHtml(input: ProjectGitStatePanelInput): string {
  const evidence = input.evidence;
  const status = projectGitStatusPresentation(evidence);
  const localBranches = evidence.branches.filter(branch => branch.kind === 'local');
  const remoteBranches = evidence.branches.filter(branch => branch.kind === 'remote');
  const sync = evidence.upstream
    ? `${evidence.ahead ?? 0} ahead · ${evidence.behind ?? 0} behind`
    : 'No upstream';
  const warning = evidence.warning
    ? `<div class="message warn" role="status">${escapeHtml(evidence.warning)}</div>`
    : '';
  const changes = evidence.changes.length > 0
    ? `<div class="kronos-table-wrap"><table class="kronos-table">
      <thead><tr><th>Path</th><th>State</th><th>Area</th></tr></thead>
      <tbody>${evidence.changes.map(change => `<tr>
        <td><code>${escapeHtml(change.path)}</code></td>
        <td>${escapeHtml(change.status)}</td>
        <td><span class="kronos-pill ${change.staged ? 'info' : 'neutral'}">${change.staged ? 'Staged' : 'Working tree'}</span></td>
      </tr>`).join('')}</tbody>
    </table></div>`
    : `<div class="kronos-empty compact">${evidence.available ? 'Clean working tree.' : 'Git status is not available yet.'}</div>`;
  const diff = evidence.diff
    ? `<details class="git-detail"><summary>Diff against HEAD${evidence.diffTruncated ? ' · truncated' : ''}</summary><pre>${escapeHtml(evidence.diff)}</pre></details>`
    : '';

  return `<!DOCTYPE html>
<html><head><style>
${kronosWebviewBaseCss()}
.git-shell { max-width: 1320px; }
.git-header { align-items: center; }
.git-path { margin-top: 4px; color: var(--k-muted); font-family: var(--vscode-editor-font-family, monospace); font-size: 11px; word-break: break-all; }
.git-actions { margin: 0 0 16px; }
.git-note { margin-bottom: 16px; }
.git-stat-value { overflow: hidden; font-size: 17px; line-height: 1.35; font-weight: 680; text-overflow: ellipsis; white-space: nowrap; }
.branch-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.branch-card { min-width: 0; padding: 14px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.branch-card h2 { margin: 0 0 9px; font-size: 13px; }
.branch-list { max-height: 320px; margin: 0; padding: 0; overflow: auto; list-style: none; scrollbar-gutter: stable; }
.branch-list li { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 4px; border-bottom: 1px solid color-mix(in srgb, var(--k-border) 75%, transparent); }
.branch-list li:last-child { border-bottom: 0; }
.branch-name { overflow: hidden; font-family: var(--vscode-editor-font-family, monospace); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.git-section { margin-top: 18px; }
.git-section > h2 { margin: 0 0 10px; color: var(--k-muted); font-size: 11px; letter-spacing: .02em; text-transform: uppercase; }
.git-detail { margin-top: 12px; border: 1px solid var(--k-border); border-radius: var(--k-radius); background: var(--k-surface); }
.git-detail summary { padding: 11px 13px; cursor: pointer; font-weight: 650; }
.git-detail pre { max-height: 520px; margin: 0 12px 12px; overflow: auto; white-space: pre; }
@media (max-width: 760px) { .branch-grid { grid-template-columns: 1fr; } .git-header .kronos-pill { margin-top: 12px; } }
</style></head>
<body><main class="kronos-shell git-shell">
  <header class="kronos-header git-header">
    <div>
      <h1 class="kronos-title">${escapeHtml(input.displayName || input.projectName)} Git state</h1>
      <div class="kronos-subtitle">Branches and working-tree evidence from VS Code's built-in Git model.</div>
      <div class="git-path">${escapeHtml(evidence.projectPath)}</div>
    </div>
    <span class="kronos-pill ${escapeClass(status.state === 'clean' ? 'pass' : status.state === 'changed' ? 'warn' : 'fail')}">${escapeHtml(status.label)}</span>
  </header>
  <div class="kronos-action-row git-actions">
    ${operationsActionButton('openSourceControl', 'Open Source Control to switch', true)}
    ${operationsActionButton('refresh', 'Refresh')}
    ${operationsActionButton('close', 'Close')}
  </div>
  <div class="message git-note">Kronos keeps Git read-only. VS Code Source Control performs branch checkout so you can confirm the target and resolve dirty-tree conflicts there.</div>
  ${warning}
  <section class="kronos-stat-grid" aria-label="Git summary">
    ${gitStat(evidence.detached ? 'Detached HEAD' : evidence.branch || 'Unavailable', 'Current branch')}
    ${gitStat(String(evidence.changeCount), 'Changed paths', status.state)}
    ${gitStat(sync, evidence.upstream ? `Upstream · ${evidence.upstream}` : 'Upstream')}
    ${gitStat(String(evidence.branchCount), `Branches${evidence.branchesTruncated ? ' · list truncated' : ''}`)}
  </section>
  <section class="git-section">
    <h2>Available branches</h2>
    <div class="branch-grid">
      ${branchCard('Local', localBranches)}
      ${branchCard('Remote', remoteBranches)}
    </div>
  </section>
  <section class="git-section">
    <h2>Working tree</h2>
    ${changes}
    ${diff}
  </section>
</main>
${operationsActionScript(input.nonce, input.actionScriptUri, 'Kronos Project Git State')}
</body></html>`;
}

function gitStat(value: string, label: string, tone = ''): string {
  return `<div class="kronos-stat ${escapeClass(tone)}"><div class="git-stat-value" title="${escapeHtml(value)}">${escapeHtml(value)}</div><div class="kronos-stat-label">${escapeHtml(label)}</div></div>`;
}

function branchCard(title: string, branches: ProjectGitEvidence['branches']): string {
  const items = branches.length > 0
    ? `<ul class="branch-list">${branches.map(branch => `<li><span class="branch-name" title="${escapeHtml(branch.name)}">${escapeHtml(branch.name)}</span>${branch.current ? '<span class="kronos-pill pass">Current</span>' : ''}</li>`).join('')}</ul>`
    : '<div class="kronos-empty compact">None reported by VS Code.</div>';
  return `<article class="branch-card"><h2>${escapeHtml(title)} <span class="kronos-muted">${branches.length}</span></h2>${items}</article>`;
}

function emptyPresentation(
  state: ProjectGitStatusPresentation['state'],
  label: string,
  tooltip: string,
): ProjectGitStatusPresentation {
  return {
    state,
    label,
    tooltip,
    stagedCount: 0,
    modifiedCount: 0,
    untrackedCount: 0,
    conflictCount: 0,
  };
}

function isConflictStatus(status: string): boolean {
  return status === 'added by us'
    || status === 'added by them'
    || status === 'deleted by us'
    || status === 'deleted by them'
    || status === 'both added'
    || status === 'both deleted'
    || status === 'both modified';
}
