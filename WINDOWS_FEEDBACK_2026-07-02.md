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

## Current Handling

- Bug 1 is fixed in the unit-test command mocks for Windows `gcloud.cmd`.
- Bug 2 is fixed by failing and completing the persisted run when managed worktree setup fails before launch.
- Bug 3 has script-acquisition hardening plus webview boot/error diagnostics in `webviewSecurity`; it still needs confirmation in VS Code 1.127.0 extension host DevTools on Windows 11.
- Bug 4 is fixed by adding a basic completion evidence note when an implement run reaches `await_review` with no evidence notes, before post-run queue removal.
- Feature 5 is implemented with active persisted runs in the Sessions tree using a `sync~spin` icon.
- Feature 6 is implemented with a status bar `Kronos: N running` indicator that opens Run Center.
- Feature 8 is implemented with a review-ready completion toast that can open the review/MR diff or Run Center.
- Feature 12 is implemented with Run Center polling while active persisted runs exist plus refresh buttons on Run Center, Evidence Gate, Human Review Inbox, Dashboard, and Aging Report.
- Remaining feature suggestions are part of the cleanup goal backlog.
