# Kronos Human Feedback Checklist

Use this checklist for the first hands-on review. The target session is 20 to 30 minutes.

## Setup

1. Run `npm run feedback:ready`.
2. Confirm it reports `Human feedback readiness: PASS`.
3. Run `npm run feedback:smoke` in a graphical or `xvfb-run` capable environment with the native VS Code/Electron GUI libraries installed.
4. Install the VSIX with `code --install-extension kronos-0.1.0.vsix --force`.
5. Reload VS Code.
6. Run `Kronos: Open Dashboard`.

Alternative dev path: open this folder in VS Code and start the `Run Kronos Extension (Feedback State)` launch configuration. It resets the fixture-state setup before launch and points the extension host at `.claude/kronos-feedback-state`.

## Safe Review State

`npm run feedback:ready` validates and packages Kronos; it does not seed fixture tickets or write sample state under `~/.claude/kronos`.

For a safe synthetic state with the installed VSIX, run:

```bash
npm run feedback:state
KRONOS_DIR="$PWD/.claude/kronos-feedback-state" code .
```

On Windows PowerShell:

```powershell
npm run feedback:state
$env:KRONOS_DIR = "$PWD\.claude\kronos-feedback-state"
code .
```

The fixture creates `KRONOS-FB-1`, `KRONOS-FB-2`, and `KRONOS-FB-3` under an ignored local directory. It is safe for evidence note/check mutation and operator-panel review, but it is synthetic provider data and should not be posted to real Jira, GitLab, Jenkins, or Sonar systems.

For mutation steps, use a scratch ticket that already exists in the reviewer's local `~/.claude/kronos/state.json` and is clearly safe for test evidence. If the available state only contains real work tickets, run the smoke as read-only: inspect panels and gates, but skip evidence note/check creation, export, and publish/handoff actions. Record "no safe scratch ticket available" in feedback notes.

## Smoke Flow

1. Confirm the Kronos activity bar appears and all six tree views load.
2. Open Dashboard and check whether the command center and Operator Cockpit make the current day obvious: setup readiness, MR autopilot, spec traceability, contracts, quality, now, next, blocked, needs human, evidence, and recovery.
3. Open the Jira Board. Try search, filters, grouping, a ticket modal, and a ticket detail view.
4. In Ticket Detail, inspect timeline, acceptance criteria, linked MR/build/project fields, evidence ledger, and evidence gate.
5. With a safe interactive Claude terminal focused, click `Insert [KRONOS-FB-1]`. Confirm Kronos inserts one editable reference line, does not press Enter, and leaves the terminal fully operator-controlled. Skip this step if the fixture has no configured Jira credentials.
6. On the approved scratch ticket only, add one evidence note and one evidence check.
7. On the approved scratch ticket only, export evidence and open the evidence handoff panel. Confirm the comment is understandable and safe to paste manually.
8. Open Queue Planner, Backlog Triage, Next Best Action, Plan Next 2 Hours, and Overnight Candidates. Check whether each recommendation explains why it is next.
9. Open Setup Wizard, Integration Contracts, and MR Autopilot. Confirm setup blockers, script command contracts, guarded MR polling, pass-plan counts, preflight blockers, and next-action flow are understandable.
10. Open Spec Beanstalk. Confirm the panel makes the two modes clear: generate `.xlsx` spec artifacts into a Java repo, or start/continue Claude implementation from the generated spec, and that traceability from workbook formatting to Markdown/JSON artifacts is inspectable.
11. Run Verify Local and Verify Remote on a safe scratch ticket if available. Confirm local asks for project, branch, environment, and before-fix vs after-fix mode; confirm remote asks for project, remote environment, and mode without offering a branch picker.
12. Open Run Center. Inspect saved runs, logs, status labels, recovery actions, retry/resume affordances, and archive behavior.
13. Open Recovery Center and Human Review Inbox. Confirm the highest-risk item is easy to identify.
14. Open Kronos Doctor, Integration Manifest, Profile Manager, Prompt Manager, Prompt Smoke Tests, Prompt History, Trend Metrics, Agent Quality, and Aging Report. Confirm Agent Quality explains recurring failure themes, not just the numeric score.

## Feedback Questions

- What was the first moment where the UI felt unclear or unsafe?
- Which panel best explained the next action, and which panel felt noisy?
- Could you tell the difference between "agent finished" and "work is ready"?
- Did evidence gates make the review safer, or did they feel like paperwork?
- Were any buttons or commands too dangerous, ambiguous, or hard to recover from?
- What information was missing before you would trust an overnight run?
- Would you trust Spec Beanstalk to preserve important Excel formatting, or would you need to inspect the generated trace first?
- What should be on the Dashboard but is currently buried elsewhere?

## Stop Conditions

Stop the review and capture notes if any of these happen:

- A webview opens blank.
- A command crashes the extension host.
- A malformed ticket, MR, build, evidence row, or run record breaks a panel.
- A destructive or publishing action does not clearly state what it will change.
- A panel cannot explain what the operator should do next.

## Signoff Bar

This build is ready for broader feedback when:

- `npm run feedback:ready` passes.
- `npm test` includes the webview DOM behavior checks for Board filtering, modal actions, comments, and action-panel payloads.
- `npm run feedback:smoke` opens and checks rendered fixture content/action wiring for the dashboard, board, ticket detail, evidence gate, evidence handoff, run center, recovery center, human review inbox, doctor, prompt manager, queue planner, backlog triage, and Spec Beanstalk.
- Dashboard, Board, Ticket Detail, Run Center, Evidence Gate, Recovery Center, Doctor, and Prompt Manager all open without runtime errors.
- Setup Wizard, Integration Contracts, and MR Autopilot all open without runtime errors and explain whether automation is safe to continue.
- Verify Local prompts for branch, environment, and reproduction/fix-confirmation mode before dispatch. Verify Remote prompts for remote environment and mode only; the branch is whatever is deployed in that environment.
- Sonar scan/fix, Verify Develop, Verify TEST, and Verify Combined create managed worktrees rather than switching the main checkout.
- Spec Beanstalk opens without runtime errors and clearly separates generate-only from start/continue Claude implementation.
- A human reviewer can complete the smoke flow and provide feedback without reading implementation files.
