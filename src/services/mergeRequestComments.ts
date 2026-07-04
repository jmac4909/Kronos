import type { MergeRequestComment } from '../state/types';

export function sortMergeRequestCommentsByCreated(comments: MergeRequestComment[]): MergeRequestComment[] {
  return comments
    .map((comment, index) => ({ comment, index, time: comment.created ? Date.parse(comment.created) : NaN }))
    .sort((a, b) => {
      const aHasTime = Number.isFinite(a.time);
      const bHasTime = Number.isFinite(b.time);
      if (aHasTime && bHasTime && a.time !== b.time) {
        return a.time - b.time;
      }
      if (aHasTime !== bHasTime) {
        return aHasTime ? 1 : -1;
      }
      return a.index - b.index;
    })
    .map(item => item.comment);
}
