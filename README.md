# Kronos - Claude Code Orchestrator

Kronos is a VS Code extension for coordinating multi-project Claude Code work. It brings tickets, merge requests, builds, quality checks, run history, evidence, and recovery actions into one operator cockpit inside VS Code.

## Current Readiness

This build is ready for local human feedback, not marketplace release. The core extension compiles, packages, and has regression coverage for state validation, prompt governance, evidence gates, queue planning, run recovery, Spec Beanstalk workbook conversion, webview escaping, webview DOM interactions, and integration wrappers.

The extension expects local operator state under `~/.claude/kronos` and optional integration scripts under `~/.claude/scripts`. On activation it reads `~/.claude/.env` into the extension process for provider credentials, preserving values already supplied by the OS or VS Code launcher. Dispatch also injects resolved credential command snippets through `--append-system-prompt` when needed, so sessions can use SonarQube, DEV/TEST curl, and GitLab MR commands without reading `.env`; Kronos redacts known credential values before writing run logs. Missing integrations should be surfaced through Kronos Doctor instead of crashing the UI. Human feedback mutation steps require an explicitly safe scratch ticket in that local state; the VSIX does not bundle sample tickets.

Recent Windows webview smoke evidence covers Jira Board, Run Center, Evidence Gate, and Human Review Inbox script readiness and click handling. Keep snapshot-specific lab details in `WINDOWS_FEEDBACK_2026-07-02.md`; the human feedback checklist remains the operator UX gate for the target review environment.

## Quick Start

```bash
npm install
npm run feedback:state
npm run feedback:ready
code --install-extension kronos-0.1.0.vsix --force
```

Reload VS Code after installing the VSIX, then open the command palette and run `Kronos: Open Dashboard`.

For extension-host testing from this repo, open the folder in VS Code and run the `Run Kronos Extension (Feedback State)` launch configuration. That launch path resets the safe fixture state, compiles the extension, and starts the dev host with `KRONOS_DIR=${workspaceFolder}/.claude/kronos-feedback-state`.

`npm run feedback:state` creates an isolated fixture under `.claude/kronos-feedback-state`. Launch VS Code with `KRONOS_DIR` pointing at that directory when you need safe synthetic tickets for evidence mutation and human-feedback smoke testing.

## Main Surfaces To Review

- Activity bar tree views: Projects, Tickets, Work Queue, Review, Sessions, and Ad-hoc Tasks.
- Dashboard: command center, worklist lanes, queue health, evidence readiness, quality trends, and next actions.
- Setup Wizard, Integration Contracts, and MR Autopilot: first-run readiness, script command contract checks, and a guarded review-loop control surface with pass-plan and preflight blockers.
- Jira Board and Ticket Detail: filtering, modal actions, timeline, evidence ledger, links, builds, MRs, acceptance criteria, and an explicit `Insert [JIRA-123]` action that hydrates a local per-user Jira context artifact and references it in the active terminal without submitting the prompt.
- Run Center and Recovery Center: active/failed runs, archived records, logs, retry/resume/cancel paths, and unsafe worktree recovery.
- Verify Ticket: local verification lets the operator choose a branch; remote verification targets DEV/TEST/custom as deployed and does not choose a branch. Both support before-fix reproduction and after-fix verification. When remote TEST/DEV/custom after-fix verification proves the defect no longer reproduces, the run should report success and stop; local app startup is only for local-only runs, failed/inconclusive remote replay, or an explicit local follow-up.
- Evidence workflow: add notes/checks, evaluate gates, export markdown, handoff packet, and publish plan.
- Planning workflow: queue planner, backlog triage, project batch plan, release batch plan, collision report, next two hours, and overnight candidates.
- Spec Beanstalk: convert `.xlsx` API specs into Markdown plus JSON trace artifacts inside a Java repo, then start or continue Claude implementation against that generated source of truth.
- Operations: Kronos Doctor, integration manifest, profile manager, prompt manager, prompt smoke tests, prompt history, and Agent Quality failure themes.

## Validation Commands

```bash
npm run compile
npm test
npm run webview:dom
npm run feedback:smoke
npm run package
npm run feedback:state
npm run feedback:ready
```

`npm test` runs the manifest check, security invariants, prompt governance, TypeScript compile, unit/regression harness, and DOM-level webview behavior checks.
`npm run webview:dom` exercises the packaged Jira Board and action-panel browser scripts against a DOM implementation, covering board filtering, ticket modals, comments, and posted action payloads.
`npm run feedback:smoke` creates the safe fixture, compiles, and runs the main Kronos operator panels inside a VS Code Extension Development Host. It verifies command registration, rendered fixture content, and key operator action wiring for the dashboard, board, ticket detail, evidence gate/handoff, run center, recovery, review, doctor, prompt, planning, and Spec Beanstalk panels. On headless Linux it uses `xvfb-run` when available and requires the native VS Code/Electron GUI libraries such as GTK 3.
Spec Beanstalk generation uses the packaged `resources/spec-beanstalk/xlsx_to_markdown.py` analyzer and Python standard library only. It writes `spec-beanstalk.md`, per-sheet Markdown, `spec-beanstalk-trace.json`, and `spec-beanstalk-summary.json` under `docs/api-spec` by default.
External provider scripts and native REST calls must follow the contract in `docs/integration-script-contract.md`; comprehensive selected-ticket Jira context uses native REST with inherited Jira credentials while the lightweight board refresh retains its script contract. Kronos Doctor checks GitLab MR polling prerequisites against `GITLAB_TOKEN`, a GitLab base URL, registered `gitlab_project_id` or parseable MR URL, and MR IID metadata. Jenkins build polling uses native REST against registered `jenkins_url` job URLs with inherited Jenkins credentials when present.
The terminal-owned Jira, MR/pipeline monitoring, work-session organization, audit, test, and read-only data roadmap lives in `docs/terminal-first-workflow-roadmap.md`.
`npm run feedback:ready` runs the full validation/package path, verifies the VSIX contains the expected user-facing files and compiled extension output, and reminds the tester that human operator feedback is still required before broader release.

## Feedback Target

Use `HUMAN_FEEDBACK_CHECKLIST.md` for the first review pass. The goal is to find whether a real operator can understand what needs attention, safely inspect work, trust the evidence gates, and decide the next action without reading source code.
