# Kronos Windows Feedback - VS Code 1.127.0

Context: Windows 11 manual testing on VS Code 1.127.0.

## Bugs

1. Unit test mocks do not handle `gcloud.cmd` on Windows. `resolveGcloudCommand()` correctly returns `gcloud.cmd`, but several mocks only match bare `gcloud`.
2. Run records can remain `running` when worktree creation fails. If `git worktree add` times out or errors during setup, mark the run failed so future dispatches do not see phantom collisions.
3. Webview buttons are dead on VS Code 1.127.0 / Windows 11 for Jira Board, Run Center, Evidence Gate, and Human Review Inbox. Check extension host DevTools console for script/CSP/sandbox errors.
4. Evidence gate can block queue removal after a fresh implement run transitions to `await_review`. The gate is premature because evidence may be added after the run.

## Feature Suggestions

5. Show a `$(sync~spin)` indicator in the Sessions tree view for active runs.
6. Add a persistent status bar item such as `Kronos: 1 running` that opens Run Center.
7. Show rough progress during active runs, such as tool call count, files changed, or elapsed time.
8. Show a toast notification on run completion with actions to open the review item or Run Center.
9. Add a badge count on the Review tree view for new items.
10. Add an aggregate badge count on the Kronos activity bar icon for items needing attention.
11. Highlight new review items since the Review view was last opened.
12. Auto-refresh active webview panels. Run Center should poll while runs are active; Evidence Gate, Human Review Inbox, Dashboard, and Aging Report need refresh buttons.
13. Auto-poll MR status for tickets in Review and continue the automation loop through deploy monitoring when merged.

## Round 2 - July 2, 2026

### Bugs

1. Run records may still appear stuck in `running` after dispatch failure. Two EDIPVR-3413 records were found with active-looking status even though Run Center showed completion/archive behavior.
2. Evidence gate blocks queue removal after successful implement. Post-run completion should auto-add evidence from run results, including files changed, test count, SonarQube status, and MR link.
3. Worktree cleanup fails on `Dirty worktree: ?? .claude/`. Ignore Claude Code generated `.claude/` content when judging managed worktrees safe to remove.
4. Readiness is `unknown` on completed runs because ticket state may not be available after completion. Reload state before post-run readiness evaluation.

### Feature Suggestions

5. Show active-run spin and inline progress metrics on Work Queue items.
6. Sort Run Center with active/running first, then completed/review/needs-human, and failed/cancelled at the bottom.
7. Add bulk archive for finished runs.
8. Notify when new review items arrive.
9. Briefly animate new review items with a timed `$(sync~spin)` indicator.
10. Show the concrete `needs_human` reason without requiring the log.
11. Auto-refresh active webview panels and include manual refresh actions.
12. Auto-poll MR status for tickets in Review and trigger deploy-monitor after merge.
13. Notify on run completion with an action to open Review or Run Center.

## Current Handling

- Bug 1 is fixed in the unit-test command mocks for Windows `gcloud.cmd`.
- Bug 2 is fixed by failing and completing the persisted run when managed worktree setup fails before launch.
- Bug 3 is validated on the Windows EC2 lab with VS Code 1.127.0. Jira Board, Run Center, Evidence Gate, and Human Review Inbox opened as webviews, and a Human Review Inbox button click opened Kronos Doctor, proving the webview script and `postMessage` path executed on Windows.
- Bug 4 is fixed by adding a basic completion evidence note when an implement run reaches `await_review` with no evidence notes, before post-run queue removal.
- Feature 5 is implemented with active persisted runs in the Sessions tree using a `sync~spin` icon.
- Feature 6 is implemented with a status bar `Kronos: N running` indicator that opens Run Center.
- Feature 7 is implemented with shared persisted-run progress summaries shown in Run Center and active Sessions tree rows.
- Feature 8 is implemented with a review-ready completion toast that can open the review/MR diff or Run Center.
- Features 9 and 11 are implemented with an in-memory Review tree badge count plus `NEW` highlighting for review items that appeared since the Review view was last opened.
- Feature 10 is implemented with an aggregate Kronos attention badge on the primary Projects tree view, using the VS Code `TreeView.badge` API exposed for activity-bar views.
- Feature 12 is implemented with Run Center polling while active persisted runs exist plus refresh buttons on Run Center, Evidence Gate, Human Review Inbox, Dashboard, and Aging Report.
- Feature 13 is implemented with periodic review MR polling. Open review MRs update persisted MR state/review/comment metadata, merged MRs transition the ticket to `deploy_monitor`, and Kronos starts a deploy-monitor run when no deploy monitor is already active for that ticket.
- Review attention is scoped to active review work: the Review tree, new-item badge, combined verification, conflict resolution, and review-branch Sonar fixes only include tickets in `await_review` with an open MR. Merged MRs remain visible in ticket details and the develop/TEST verification commands, while deploy-monitor owns the post-merge path.
- Round 2 bug 1 is guarded in two layers: terminal-looking active run records are normalized for active-run checks, and active run files are now rewritten when that repair happens so stale `running` JSON does not keep resurfacing.
- Round 2 bug 2 is handled by post-run completion evidence text/checks with progress, changed files, test count, SonarQube, MR, and build details.
- Round 2 bug 3 is handled by ignoring generated `.claude/` entries during managed worktree cleanliness checks.
- Round 2 bug 4 is handled by reloading state after dispatch before resolving the ticket and evaluating post-run readiness.
- Round 2 features 5-13 are implemented through Work Queue active metrics, Run Center sorting and bulk archive, review notifications and timed spin, concrete attention summaries, webview refresh actions, review MR polling, deploy-monitor handoff, and completion toasts.
- Windows validation note: the lab is Windows Server rather than Windows 11, but it is running VS Code 1.127.0 with the packaged `jmacke01.kronos@0.1.0` VSIX. The final smoke artifacts were `01-jira-board.png`, `02-run-center.png`, `03-evidence-gate.png`, `04-human-review-inbox.png`, and `05-human-review-open-doctor-click.png` under `C:\ProgramData\KronosLab\smoke`.
