# Kronos - Claude Code Orchestrator

Kronos is a VS Code extension for coordinating multi-project Claude Code work. It brings tickets, merge requests, builds, quality checks, run history, evidence, and recovery actions into one operator cockpit inside VS Code.

## Current Readiness

This build is ready for local human feedback, not marketplace release. The core extension compiles, packages, and has regression coverage for state validation, prompt governance, evidence gates, queue planning, run recovery, webview escaping, and integration wrappers.

The extension expects local operator state under `~/.claude/kronos` and optional integration scripts under `~/.claude/scripts`. Missing integrations should be surfaced through Kronos Doctor instead of crashing the UI.

Windows webview execution has been smoke-tested in the EC2 lab on VS Code 1.127.0. Jira Board, Run Center, Evidence Gate, and Human Review Inbox reported script readiness and accepted click actions without CSP or runtime errors. The human feedback checklist remains the operator UX gate.

## Quick Start

```bash
npm install
npm run feedback:ready
code --install-extension kronos-0.1.0.vsix --force
```

Reload VS Code after installing the VSIX, then open the command palette and run `Kronos: Open Dashboard`.

For extension-host testing from this repo, open the folder in VS Code and run the `Run Kronos Extension` launch configuration.

## Main Surfaces To Review

- Activity bar tree views: Projects, Tickets, Work Queue, Review, Sessions, and Ad-hoc Tasks.
- Dashboard: command center, worklist lanes, queue health, evidence readiness, quality trends, and next actions.
- Jira Board and Ticket Detail: filtering, modal actions, timeline, evidence ledger, links, builds, MRs, and acceptance criteria.
- Run Center and Recovery Center: active/failed runs, archived records, logs, retry/resume/cancel paths, and unsafe worktree recovery.
- Evidence workflow: add notes/checks, evaluate gates, export markdown, handoff packet, and publish plan.
- Planning workflow: queue planner, backlog triage, project batch plan, release batch plan, collision report, next two hours, and overnight candidates.
- Operations: Kronos Doctor, integration manifest, profile manager, prompt manager, prompt smoke tests, and prompt history.

## Validation Commands

```bash
npm run compile
npm test
npm run package
npm run feedback:ready
```

`npm test` runs the manifest check, security invariants, prompt governance, TypeScript compile, and the unit/regression harness.
`npm run feedback:ready` runs the full validation/package path, verifies the VSIX contains the expected user-facing files and compiled extension output, and reminds the tester that human operator feedback is still required before broader release.

## Feedback Target

Use `HUMAN_FEEDBACK_CHECKLIST.md` for the first review pass. The goal is to find whether a real operator can understand what needs attention, safely inspect work, trust the evidence gates, and decide the next action without reading source code.
