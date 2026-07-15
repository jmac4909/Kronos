import type { ProjectGitEvidence } from './vscodeGitReadService';

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
