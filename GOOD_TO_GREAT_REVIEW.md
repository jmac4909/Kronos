# Kronos Good-to-Great Review

## Purpose

This document is a historical product audit plus the current remaining-gap list. It should not be read as a live implementation checklist.

The original review was written when Kronos behaved mostly like a VS Code command launcher over state files and prompt templates. Since then, the Windows and human-feedback work has implemented or hardened many of the recommendations: Run Center, Recovery Center, Evidence Gate, Queue Planner, Next Best Action, Doctor, Integration Manifest, Prompt Manager, Prompt History, runtime state validation, feedback readiness checks, and webview action handling.

Keep this review for the design rationale: Kronos should be a safe, explainable SDLC operations console that can plan work, supervise agent sessions, preserve evidence, prevent destructive mistakes, and recover when automation gets stuck.

## Current Implemented State

- Run lifecycle: dispatches create saved run/session records, progress webviews, prompt/log artifacts, status notifications, and Run Center actions for retry, resume, archive, cancel, and opening related context.
- Safety and recovery: commands are routed through safety gates where risk is known, restricted workspace behavior is explicit, state backups/audit entries exist, worktree cleanup is reviewed through recovery paths, and risky items surface in Recovery Center or Human Review Inbox.
- Planning: Queue Planner, Backlog Triage, Next Best Action, project/release batch plans, Collision Report, Plan Next 2 Hours, Overnight Candidates, Aging Report, Trend Metrics, and Agent Quality views are present.
- Evidence: ticket detail includes timeline and evidence sections; evidence notes/checks, gate evaluation, export, handoff, and safety-gated publish surfaces exist.
- Integrations and health: Kronos Doctor, Integration Manifest, and Profile Manager expose provider/script/auth/config state instead of letting missing dependencies break operator panels silently.
- Prompt governance: Prompt Manager, Prompt Smoke Tests, Prompt History, manifest checks, template validation, and prompt repair flows exist.
- State and tests: state/queue parsing has runtime validation, writes use state-store helpers, `npm test` covers the core regression harness, and `npm run feedback:ready` packages and checks the human-feedback build.
- Webview hardening: shared escaping/link helpers, CSP/action scripts, readiness monitors, and Windows shell handling for `npm`/`npx` have been added. Recent Windows smoke evidence is kept in `WINDOWS_FEEDBACK_2026-07-02.md`.

## Historical Audit Notes And Current Status

### 1. Agent Lifecycle

Historical concern: session state was too shallow to distinguish "agent process ended" from "work is ready."

Current status: Run Center and persisted run/session records now provide the main lifecycle surface. Operators can inspect run state, logs/prompts, completion notifications, recovery guidance, and retry/resume/archive/cancel actions.

Remaining gap: validate stale-run recovery after crashes and real Windows extension-host interruptions. A run can still need operator cleanup if the extension exits before final status reconciliation.

### 2. Safety And Reversibility

Historical concern: cleanup, branch changes, state writes, and external publishing needed explicit preflight and recovery paths.

Current status: safety-gate classification, workspace trust restrictions, state backups/audit, safe worktree lifecycle helpers, Recovery Center, Human Review Inbox, and manual evidence handoff/publish checks now cover the high-risk paths.

Remaining gap: keep expanding dry-run/preview coverage for every destructive, branch-mutating, or external-publish command. Provider-specific publish boundaries still need real operator feedback.

### 3. Queueing And Planning

Historical concern: queueing was manual and under-explained.

Current status: planning panels now explain recommended work through Queue Planner, Backlog Triage, Next Best Action, collision checks, batch plans, aging reports, and overnight candidate review.

Remaining gap: recommendation quality depends on live provider state. Scoring should continue to improve as Jira, MR, build, Sonar, stale-age, and dependency signals are verified in real work.

### 4. Evidence

Historical concern: proof lived mostly in session output instead of a ticket-centered ledger.

Current status: evidence ledger, timeline, gate evaluation, export, handoff, and publish-plan surfaces exist in ticket detail and related panels.

Remaining gap: broader feedback is needed on which evidence is required for each ticket type, and external posting should remain manual or explicitly confirmed until provider behavior is trusted.

### 5. Integrations

Historical concern: Jira, GitLab, Jenkins, Sonar, GCP, Claude CLI, scripts, and prompt packs were hidden dependencies.

Current status: Doctor and Integration Manifest make these dependencies inspectable, and provider/script failures should surface as operator-readable checks.

Remaining gap: the integration layer is still script-backed. Installation, repair, and provider contract validation need continued hardening against real enterprise environments.

### 6. Operator UI

Historical concern: Kronos had lists, but not a cockpit.

Current status: Dashboard, Jira Board, Ticket Detail, Run Center, Recovery Center, Human Review Inbox, planning panels, quality reports, prompt panels, and integration health panels now form the operator cockpit.

Remaining gap: the first real human-feedback pass is still required. The main question is not whether panels open, but whether an operator can quickly tell what is next, what is blocked, what is unsafe, and what evidence exists.

### 7. Prompt Governance

Historical concern: prompt templates were editable but not governed.

Current status: Prompt Manager, Prompt Smoke Tests, Prompt History, prompt manifest checks, template validation, and prompt hash/provenance flows now exist.

Remaining gap: prompt smoke coverage still needs a realistic corpus for each supported workflow and enterprise profile.

### 8. State Reliability

Historical concern: state and queue files were too trusting.

Current status: runtime validation, state-store helpers, backups, restore paths, and audit records now protect the main state files.

Remaining gap: concurrent writes between the extension host and external scripts should keep getting stress-tested. Any remaining direct state mutation should move behind typed state-store methods.

### 9. Testing

Historical concern: there was no clear test strategy.

Current status: `npm test` now runs manifest, security, prompt, compile, and unit/regression checks. `npm run feedback:ready` wraps validation and packaging for human review.

Remaining gap: true end-to-end VS Code extension-host coverage and real-provider smoke tests remain separate from the Node-level harness.

### 10. Configuration And Onboarding

Historical concern: setup was environment-specific.

Current status: Profile Manager, Integration Manifest, Doctor checks, workspace-trust behavior, configurable state paths, and provider health reporting reduce hardcoded assumptions.

Remaining gap: sample/scratch operator state is not bundled. Human feedback needs an explicitly safe local state source before mutation steps, and new-user onboarding still needs real-world polish.

## Product Principles To Preserve

- Explain the next action before running it: reason, risk, preflight, and expected mutation.
- Treat "agent finished" and "work is ready" as different states.
- Preserve ticket-centered evidence: acceptance criteria, checks, builds, Sonar status, logs, screenshots, artifacts, and manual notes.
- Prefer recovery over silent cleanup when worktrees, branches, runs, or integrations are ambiguous.
- Keep credentials and enterprise details out of repo files, logs, docs, and generated handoff text.
- Keep external publish manual or explicitly confirmed unless the operator has opted into automation for that provider.

## Current Remaining Gaps

1. Complete the human-feedback review with safe sample state and capture whether operators can navigate the cockpit without source-code context.
2. Add or document an end-to-end VS Code extension-host smoke path beyond the current Node regression harness.
3. Harden stale-run reconciliation after extension crashes, terminal interruptions, and Windows process-tree edge cases.
4. Stress-test state locking and audit behavior while extension commands and external scripts both touch `~/.claude/kronos`.
5. Improve first-run onboarding, scratch state guidance, and provider setup/repair instructions.
6. Keep refining planning scores from real Jira, MR, build, Sonar, dependency, and stale-age signals.

## The Great Version In One Sentence

Kronos becomes great when it is not merely a launcher for Claude sessions, but a safe, explainable SDLC operations console that can plan the next action, supervise agent work, preserve evidence, prevent destructive mistakes, and recover gracefully when automation gets stuck.
