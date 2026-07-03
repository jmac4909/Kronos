# Kronos Human Feedback Checklist

Use this checklist for the first hands-on review. The target session is 20 to 30 minutes.

## Setup

1. Run `npm run feedback:ready`.
2. Confirm it reports `Human feedback readiness: PASS`.
3. Install the VSIX with `code --install-extension kronos-0.1.0.vsix --force`.
4. Reload VS Code.
5. Run `Kronos: Open Dashboard`.

Alternative dev path: open this folder in VS Code and start the `Run Kronos Extension` launch configuration.

## Safe Review State

`npm run feedback:ready` validates and packages Kronos; it does not seed fixture tickets or write sample state under `~/.claude/kronos`.

For mutation steps, use a scratch ticket that already exists in the reviewer's local `~/.claude/kronos/state.json` and is clearly safe for test evidence. If the available state only contains real work tickets, run the smoke as read-only: inspect panels and gates, but skip evidence note/check creation, export, and publish/handoff actions. Record "no safe scratch ticket available" in feedback notes.

## Smoke Flow

1. Confirm the Kronos activity bar appears and all six tree views load.
2. Open Dashboard and check whether the command center makes the current day obvious: now, next, blocked, needs human, evidence, quality, and recovery.
3. Open the Jira Board. Try search, filters, grouping, a ticket modal, and a ticket detail view.
4. In Ticket Detail, inspect timeline, acceptance criteria, linked MR/build/project fields, evidence ledger, and evidence gate.
5. On the approved scratch ticket only, add one evidence note and one evidence check.
6. On the approved scratch ticket only, export evidence and open the evidence handoff panel. Confirm the comment is understandable and safe to paste manually.
7. Open Queue Planner, Backlog Triage, Next Best Action, Plan Next 2 Hours, and Overnight Candidates. Check whether each recommendation explains why it is next.
8. Open Run Center. Inspect saved runs, logs, status labels, recovery actions, retry/resume affordances, and archive behavior.
9. Open Recovery Center and Human Review Inbox. Confirm the highest-risk item is easy to identify.
10. Open Kronos Doctor, Integration Manifest, Profile Manager, Prompt Manager, Prompt Smoke Tests, Prompt History, Trend Metrics, Agent Quality, and Aging Report.

## Feedback Questions

- What was the first moment where the UI felt unclear or unsafe?
- Which panel best explained the next action, and which panel felt noisy?
- Could you tell the difference between "agent finished" and "work is ready"?
- Did evidence gates make the review safer, or did they feel like paperwork?
- Were any buttons or commands too dangerous, ambiguous, or hard to recover from?
- What information was missing before you would trust an overnight run?
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
- Dashboard, Board, Ticket Detail, Run Center, Evidence Gate, Recovery Center, Doctor, and Prompt Manager all open without runtime errors.
- A human reviewer can complete the smoke flow and provide feedback without reading implementation files.
