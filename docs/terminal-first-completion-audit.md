# Kronos Terminal-First Completion Audit

Audit date: 2026-07-14

## Outcome

The repository is ready for the operator-owned human feedback pass in `HUMAN_FEEDBACK_CHECKLIST.md`. The automated suite proves the product boundary and the main synthetic journeys. It does not replace a live VS Code test with the operator's Claude, Jira, GitLab, Jenkins, and SonarQube configuration.

## Requirement Evidence

| Area | Automated evidence | Status |
| --- | --- | --- |
| Product surface | Manifest gate enforces exactly Work, Sessions, Projects, Attention, 36 commands, and 10 settings. The activation harness registers and directly exercises every command. Runtime graph rejects cycles and dead runtime exports. | Pass |
| Jira board | DOM and board tests cover search, Jira-namespace/explicit-local-project/label filters, completed-work defaults, reset/rerender behavior, registered projects, branches, and ticket-scoped actions. | Pass |
| Jira context | Unit tests cover bounded REST reads, newest-comment fetching with chronological rendering, recursive empty-value pruning, meaningful `false`/`0`, arbitrary raw attachments, byte/count limits, hashes, and partial warnings. | Pass |
| Terminal ownership | Unit and activation tests prove explicit validated Claude launch, one launch per action, no automatic Jira insertion, inert shell quoting, `sendText(..., false)` for context, and no transcript reads or terminal disposal. | Pass |
| Sessions | Unit and activation tests cover project-centered labels, multiple explicit Jira contexts per session, context insertion into any explicitly managed terminal, focus/reconnect, pause/resume, detach, stop management, removal, audit persistence, launch races, and terminal-close races. Terminal objects remain open. | Pass |
| Projects and Git | Tests cover the dedicated Projects view, configurable bounded discovery, registered-first selection, authoritative uncheck, integration setup, explicit-only ticket links across multiple repositories sharing one Jira namespace, branch reads without Git execution, on-demand read-only VS Code Git loading, clean/dirty status, caps of 500 paths and 512 KiB, redacted `[GIT-project]` context, and linked launch directories. | Pass |
| Merge requests | Tests cover current-branch discovery, ticket fallback, ambiguity refusal, durable local bindings, initial healthy/mergeable attention, partial review reads, known-MR opening, and prefilled new-MR browser navigation without creating an MR. | Pass |
| Jenkins and SonarQube | Tests cover bounded Jenkins/Sonar reads, retained Jenkins build targets, deterministic latest-first choices with saved timestamps, Sonar branch dashboard links, persisted monitored-branch choices, literal `sonar.projectKey` discovery from Jenkins XML, and rejection of expression-only values. | Pass |
| Attention | Tests cover real transitions, initial and cleared-but-still-open MR reminders, healthy SonarQube observations, provider failures/recoveries, acknowledgements, project grouping, newest-state replacement without stale-row resurrection, provider branch/build choices, and editable MR/CI insertion. | Pass |
| Setup and Doctor | DOM and activation tests cover dedicated dashboards, allowlisted actions, credential-readiness reporting, and no credential values in UI. | Pass |
| Security and dependencies | Public-surface, security, and context-governance gates pass. Runtime dependencies are empty; only TypeScript and Node/VS Code type packages are development dependencies. `npm audit` reports zero known vulnerabilities. | Pass |
| Packaging | `npm run feedback:ready` compiles, tests, packages, checks the VSIX contents, rejects legacy/development/local-state files, and creates a safe synthetic feedback state. | Final gate |

## Changes Found During This Audit

- Repeated provider-read failures create durable transitions only when the normalized source state or error changes.
- Work catalog schema v2 stores one explicit `linked_local_project`; schema-v1 links migrate, legacy inferred project tags are discarded, unavailable links are cleared with a load issue, and future schemas fail closed.
- Work filtering now keeps Jira namespaces and explicit local projects in separate typed facets, selectors, persisted board state, and card attributes so one identity cannot satisfy the other filter.
- Attention now shows only the newest transition for each project/provider/facet. Recoveries, later failures, builds, pipelines, and gate results replace stale rows; acknowledging the newest row cannot resurrect an older one. The append-only audit history is unchanged.
- Clearing an open MR now snoozes it until the next successful GitLab poll. That poll records one fresh reminder; unchanged polls do not duplicate an uncleared reminder, and merged or closed MRs stay cleared.
- Jenkins job configuration and observed build targets are stored separately, so multiple real builds remain available from Attention.
- Jenkins build choices are deterministically latest-first even when bindings share a timestamp.
- Jenkins XML discovery skips expression-valued Sonar settings while still accepting a later safe literal setting.
- Direct command coverage now exercises project Git/MR actions and the session pause, resume, detach, stop, and remove workflow.
- The activation harness now exercises all 36 contributed commands, including adding another Jira context to a managed terminal, synthetic successful Jira refresh, editable MR/CI context insertion, project-routed provider context, and manual provider polling without using a live endpoint.
- The safe feedback state now includes validated paused/detached ticket and standalone Sessions plus synthetic MR, Jenkins, SonarQube, and repeated-failure Attention evidence. This supports visual review without launching a terminal or contacting a provider.
- The public-surface gate now rejects local-state paths, machine-specific home paths, known employer identifiers, private-key material, and high-confidence token shapes before the remaining test suite runs.
- VS Code types are pinned to the advertised 1.85 minimum. Optional terminal shell-integration metadata is read through a compatibility shim so newer editors retain the extra CWD detail without making that later API mandatory.
- Recruiter-facing product renders use only synthetic `DEMO-*` records, generic project names, and example-only provider state; their editable SVG sources are excluded from the packaged VSIX.
- The board render shows an achievable unfiltered state, while the context-composer render labels its composer and terminal views as consecutive interaction steps rather than simultaneous UI.
- Packaged README links are pinned to the intended public `main` branch so image and documentation URLs remain stable after release.

## Operator-Only Signoff Still Required

Run `npm run feedback:ready`, install the produced VSIX, and complete `HUMAN_FEEDBACK_CHECKLIST.md`. The human pass must confirm:

- actual terminal focus, title, Claude startup, typing, and non-submitting insertion in the target VS Code build;
- visual clarity and keyboard behavior of the Jira board, composer, Setup, and Doctor;
- live provider authentication, pagination, permission behavior, and organization-specific response shapes;
- Windows filesystem and terminal behavior on a real Windows extension host;
- no provider, repository, or terminal mutation during the live journey.

## Improvement Roadmap

The prioritized cleanup, hardening, edge-case, and next-feature goals are maintained in [extension-improvement-goals.md](extension-improvement-goals.md). That roadmap distinguishes current automated evidence from required Windows, live-provider, and operator-owned terminal signoff.
