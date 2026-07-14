# Kronos Terminal-First Completion Audit

Audit date: 2026-07-14

## Outcome

The repository is ready for the operator-owned human feedback pass in `HUMAN_FEEDBACK_CHECKLIST.md`. The automated suite proves the product boundary and the main synthetic journeys. It does not replace a live VS Code test with the operator's Claude, Jira, GitLab, Jenkins, and SonarQube configuration.

## Requirement Evidence

| Area | Automated evidence | Status |
| --- | --- | --- |
| Product surface | Manifest gate enforces exactly Work, Sessions, Attention, 34 commands, and 10 settings. The activation harness registers and directly exercises every command. Runtime graph rejects cycles and dead runtime exports. | Pass |
| Jira board | DOM and board tests cover search, status/project/label filters, completed-work defaults, reset/rerender behavior, registered projects, branches, and ticket-scoped actions. | Pass |
| Jira context | Unit tests cover bounded REST reads, newest-comment fetching with chronological rendering, recursive empty-value pruning, meaningful `false`/`0`, arbitrary raw attachments, byte/count limits, hashes, and partial warnings. | Pass |
| Terminal ownership | Unit and activation tests prove explicit validated Claude launch, one launch per action, no automatic Jira insertion, inert shell quoting, `sendText(..., false)` for context, and no transcript reads or terminal disposal. | Pass |
| Sessions | Unit and activation tests cover standalone versus ticket identity, focus/reconnect, pause/resume, detach, stop management, removal, audit persistence, launch races, and terminal-close races. Terminal objects remain open. | Pass |
| Projects and Git | Tests cover configurable bounded discovery, registered-first selection, authoritative uncheck, integration setup, branch reads without Git execution, VS Code built-in Git status/diff, caps of 500 paths and 512 KiB, redacted `[GIT-project]` context, and linked launch directories. | Pass |
| Merge requests | Tests cover current-branch discovery, ticket fallback, ambiguity refusal, durable local bindings, initial healthy/mergeable attention, partial review reads, known-MR opening, and prefilled new-MR browser navigation without creating an MR. | Pass |
| Jenkins and SonarQube | Tests cover bounded Jenkins/Sonar reads, retained Jenkins build targets, deterministic latest-first choices, Sonar branch dashboard links, branch choices, literal `sonar.projectKey` discovery from Jenkins XML, and rejection of expression-only values. | Pass |
| Attention | Tests cover real transitions, initial MR observation, provider failures/recoveries, acknowledgements, grouping, provider target choices, and suppression/collapse of unchanged same-source provider failures. | Pass |
| Setup and Doctor | DOM and activation tests cover dedicated dashboards, allowlisted actions, credential-readiness reporting, and no credential values in UI. | Pass |
| Security and dependencies | Public-surface, security, and context-governance gates pass. Runtime dependencies are empty; only TypeScript and Node/VS Code type packages are development dependencies. `npm audit` reports zero known vulnerabilities. | Pass |
| Packaging | `npm run feedback:ready` compiles, tests, packages, checks the VSIX contents, rejects legacy/development/local-state files, and creates a safe synthetic feedback state. | Final gate |

## Changes Found During This Audit

- Repeated provider-read failures now create Attention only when the normalized source state or error changes. A recovery resets the transition, so the same later failure is visible again.
- Legacy duplicate provider-read events are collapsed in Attention without deleting audit history.
- Jenkins job configuration and observed build targets are stored separately, so multiple real builds remain available from Attention.
- Jenkins build choices are deterministically latest-first even when bindings share a timestamp.
- Jenkins XML discovery skips expression-valued Sonar settings while still accepting a later safe literal setting.
- Direct command coverage now exercises project Git/MR actions and the session pause, resume, detach, stop, and remove workflow.
- The activation harness now exercises all 34 contributed commands, including synthetic successful Jira refresh, MR/CI context insertion, project-routed provider context, and manual provider polling without using a live endpoint.
- The safe feedback state now includes validated paused/detached ticket and standalone Sessions plus synthetic MR, Jenkins, SonarQube, and repeated-failure Attention evidence. This supports visual review without launching a terminal or contacting a provider.
- The public-surface gate now rejects local-state paths, machine-specific home paths, known employer identifiers, private-key material, and high-confidence token shapes before the remaining test suite runs.
- VS Code types are pinned to the advertised 1.85 minimum. Optional terminal shell-integration metadata is read through a compatibility shim so newer editors retain the extra CWD detail without making that later API mandatory.
- Public product renders use only synthetic `DEMO-*` records, generic project names, and example-only provider state; their editable SVG sources are excluded from the packaged VSIX.
- The board render shows an achievable unfiltered state, while the context-composer render labels its composer and terminal views as consecutive interaction steps rather than simultaneous UI.
- Packaged README links are pinned to the intended public `main` branch so image and documentation URLs remain stable after release.

## Operator-Only Signoff Still Required

Run `npm run feedback:ready`, install the produced VSIX, and complete `HUMAN_FEEDBACK_CHECKLIST.md`. The human pass must confirm:

- actual terminal focus, title, Claude startup, typing, and non-submitting insertion in the target VS Code build;
- visual clarity and keyboard behavior of the Jira board, composer, Setup, and Doctor;
- live provider authentication, pagination, permission behavior, and organization-specific response shapes;
- Windows filesystem and terminal behavior on a real Windows extension host;
- no provider, repository, or terminal mutation during the live journey.

## Focused Next Features

1. **Context basket.** Let the operator collect Jira, MR, diff, Jenkins, and Sonar evidence into one editable preview, then place one non-submitting reference in the selected terminal.
2. **Provider health timeline.** Show last checked, last changed, next poll, current normalized failure, and suppressed repeat count per provider without generating more Attention noise.
3. **Redacted handoff bundle.** Export selected audit/context artifacts plus hashes as a local Markdown/JSON bundle for an MR or Jira update, without posting anything automatically.
4. **Branch profiles.** Allow optional per-project branch mappings for Jenkins jobs and SonarQube keys when one repository has multiple pipeline layouts.
5. **Local session search.** Search session titles, ticket keys, branches, provider bindings, and saved artifact labels without indexing terminal contents.
