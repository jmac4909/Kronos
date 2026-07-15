# Changelog

All notable changes to the Kronos preview are documented here.

## [Unreleased]

### Added

- Added a private bounded Context Basket for selecting Jira, GitLab MR, Jenkins/SonarQube, and local Git artifacts, reviewing provenance/freshness/completeness/size/hash/conflicts, explicitly refreshing sources, and placing one reference-only non-submitting bundle into an exact managed terminal.
- Added ephemeral bounded local evidence search across session titles, explicit Jira contexts, registered projects/branches, provider bindings, artifact labels, and audit-event summaries without reading or indexing terminal content.
- Added private local Markdown/JSON handoff bundles for up to 100 selected redacted context/audit references and hashes; exports never include terminal content, copy source payloads, or post to a provider.
- Added up to 20 explicit per-project Jenkins/SonarQube branch-routing profiles with exact MR-branch selection and an optional explicit fallback; profiles never infer ticket links or switch Git branches.
- Added a source-checked transition matrix for every declared GitLab MR, pipeline/job/test, Jenkins, and SonarQube transition, and extracted restart-safe current Attention projection from the view.
- Prioritized extension improvement roadmap covering identity, terminal lifecycle, provider reconciliation, Attention, cross-platform persistence, UX, maintainability, and release evidence.
- Dedicated Projects view with current branch, clean/dirty status, read-only Git loading, and existing project evidence actions.
- Recruiter-facing product overview, architecture, engineering metrics, and synthetic product renders.
- Branded Marketplace icon and preview metadata.
- Public-surface validation for tracked local state, machine paths, employer identifiers, private keys, and high-confidence token shapes.
- Security, support, and contribution guidance.

### Changed

- Closed G02's synthetic terminal-lifecycle cases with a focused suite and activation races covering workspace/home launches, linked/unlinked tickets, non-launching existing-terminal management, duplicate terminal names, exact reconnect choice, focus changes during fetch, close/rebind invalidation, lifecycle projection, and removal isolation; real Linux/Windows VS Code focus and reconnect remain explicit human gates.
- Closed all 12 canonical-identity roadmap clauses with direct regressions for multiple repositories under one Jira namespace, independent explicit ticket links, unlinked-ticket persistence and provider isolation, multi-ticket standalone sessions, resource-specific provider bindings, and schema-v1 migration/fail-closed recovery.
- Replaced goal-presence-only validation with a fingerprinted case-level roadmap inventory: all 230 G01-G22 goal statements, cases, and completion clauses now report direct automated evidence, required human signoff, or an explicit open count, and stale mappings fail closed when roadmap text changes.
- Extracted provider environment parsing/safety, shared readiness, and Setup/Doctor readiness projection from the monolithic unit harness into a dedicated `provider:readiness` suite retained by `npm test`.
- Routed provider-environment, Work-catalog, work-session-record, and TerminalFirstState load/watch failures through the shared bounded redacted vocabulary before any Setup, Doctor, Work, or log surface consumes them.
- Setup and Doctor now show current bounded Jira/provider live-read failures and partial components over static configuration readiness, with repair-versus-retry actions and stream-specific recovery.
- Extracted Projects Git-status presentation into a pure tested owner covering unavailable, clean, staged, modified, untracked, conflicted, and over-limit evidence.
- Routed project Git evidence warnings and every tree-provider refresh fallback through the shared bounded, credential-redacted failure vocabulary while retaining usable read-only status after a diff-only failure.
- Added exhaustive Jira-board filter-composition coverage across all five filter subsets plus direct Enter/Space card-activation assertions.
- Extracted project registration, identity, configuration, discovery, and Git-pointer coverage from the monolithic unit harness into a dedicated `project:catalog` suite retained by the single `npm test` gate.
- Routed all operator-visible workflow failures and managed-provider polling logs through the shared bounded, credential-redacted failure vocabulary, with a source guard against raw arbitrary error text returning to those boundaries.
- Made registered-project identity canonical by real path and separate from an editable display label; renaming a Project now leaves ticket links, sessions, provider configuration, and Git state untouched, while duplicate persisted paths fail closed to one inventory row.
- Unified project-provider configuration normalization at Setup and `work.json` ingress so ambiguous GitLab identities, credential-bearing or unsafe Jenkins URLs, malformed SonarQube keys, unsafe branch names, and unknown fields never reach polling consumers.
- Added one Jira refresh lifecycle shared by the Work tree and board, with distinct current, empty, loading, partial, stale, error, and no-match states; in-flight, partial, and failed refreshes retain the last usable tickets and expose bounded Refresh/Doctor repair actions.
- Made every linked Jira card and ticket workspace label its repository control as **Change / Unlink Project**, sort the current project first beside its unlink choice, and expose keyboard-focusable card navigation.
- Added a machine-checked requirement-to-test matrix and derived README metric gate; automated output now lists covered feature groups and keeps real VS Code, operator-terminal, Windows, multi-window, and live-provider signoff explicitly open.
- Documented one owner and canonical data flow for every local/in-memory record, plus a checked Jira/GitLab/Jenkins/SonarQube request-bound-normalization-completeness-error matrix.
- Added four sanitized file-based enterprise provider fixtures that exercise Jira partial rich work, GitLab MR/review/pipeline/test context, Jenkins multibranch optional evidence, and SonarQube branch gate/measure/issue normalization without new runtime dependencies.
- Added checked collection/read/render budgets and a 500-ticket/2,000-event synthetic scale gate; shared webviews now declare forced-colors behavior, project setup labels every input and renders the full 200-project registration ceiling.
- A newer explicit Jira refresh now aborts and supersedes the prior read while scheduled refreshes continue to coalesce; a late stale response cannot overwrite the newer Work catalog or error state.
- Extracted Work refresh concurrency from the extension activation hotspot into a focused coordinator with independent coalescing, supersession, failure-recovery, and disposal tests.
- Extracted deterministic provider transition recording and provider-read health normalization from the polling hotspot; independent tests now prove event identity, unchanged-failure suppression, recovery, safe error categories, completeness components, and fingerprints.
- Projects and Sessions now show one provider-health model with last attempt, last full success, last meaningful change, next scheduled poll, current normalized error, and unchanged-poll suppression count; these values are local operational visibility and never create Attention rows.
- Attention items without a validated provider URL now route directly to the registered project integration repair UI, or Doctor when no project is available, instead of presenting a dead dashboard action.
- Hardened one-time legacy-state migration by rejecting symbolic-link ancestors, recognizing broken target links, and recursively applying private directory/file modes after same-filesystem renames.
- Added shared bounded immutable-artifact and two-file pair primitives with content verification, incomplete-pair refusal, and no-replace publication; local Git, Jira, GitLab, and CI context evidence—including arbitrary binary Jira attachments—now use them for consistent Windows/POSIX path safety.
- Moved the append-only monitor-event ledger onto shared identity-checked append and bounded-tail primitives, eliminating its separate Windows/POSIX open-flag implementation while retaining complete-line tail reads.
- Moved the Work catalog, work-session directory creation, and provider-config template creation onto the shared bounded atomic state layer, including safe private-directory creation that rejects symbolic-link ancestors and recovery by replacing an oversized prior regular file with valid bounded state.
- Moved durable work-session records onto the shared cross-platform private-file primitive and added an explicit 4 MiB record cap, so oversized or path-raced session state fails closed and remains visible in Doctor.
- Made all Jira, MR, CI, and Git composer placement use one exact managed-terminal attachment guard and exactly-once non-submitting send transition; detachment/rebinding during fetch cancels the stale composer and late queued messages cannot place a second line.
- Unified Setup, Doctor, Projects, and project integration around one secret-free provider-readiness model; added direct private-config editing with a comment-only private template, immediate Poll Now verification, and one bounded action on every readiness row.
- Added one redacted actionable failure vocabulary for provider reads and common operator workflows, distinguishing configuration, authentication, permission, timeout, DNS, TLS, redirect, rate limit, not found, response bound, malformed response, pagination, lease contention, local state, network, and unknown availability failures.
- Added one Session lifecycle projection shared by Sessions, polling readiness, and command guards; terminal exit is now durable `closed` history, explicit detach remains `detached`, and stopping management detaches metadata without falsely claiming that the operator-owned terminal closed.
- Introduced shared cross-platform private-file primitives for the monitoring lease and MR/pipeline/CI snapshots, with Windows lstat/fstat identity checks, POSIX `O_NOFOLLOW`, bounded complete reads/writes, same-directory atomic replacement, and stale-state preservation on rejected writes.
- Defined one hashed Attention stream identity across monitoring and projection, so provider health transitions replace stale health rows, newer pipelines/builds replace older occurrences, and separate MRs or SonarQube branches remain independently actionable.
- Centralized GitLab merge-request target reconciliation so durable session bindings, catalog evidence, configured project identity, polling, status, and context insertion share one deterministic precedence rule.
- Split Jira namespace and explicit local repository into independent Work-tree and Jira-board filters, including separately persisted webview choices.
- Migrated the Work catalog to schema v2 with `linked_local_project` as the only ticket-to-repository identity; schema-v1 `launch_project` records migrate safely and legacy project tags are discarded.
- Separated Jira namespace metadata from local repository links; tickets now use only explicit operator-selected projects for launch and provider configuration.
- Generalized repository instructions so they do not assume a specific machine or workspace path.
- Clarified that the public source is available for portfolio and security review under an all-rights-reserved evaluation license.
- Renamed the merge-request browser action to make clear that Kronos opens a page but does not create an MR.
- Corrected informational pills to use the information color rather than the success color.
- Reworked realistic credential-shaped test literals so public secret scanners do not mistake fixtures for live values.

## 0.1.0 - Unreleased preview

### Added

- Four focused VS Code views: Work, Sessions, Projects, and Attention.
- Jira work board with bounded local filtering and project/branch linkage.
- Explicit validated Claude terminal launch and non-submitting context insertion.
- Read-only Jira, GitLab, Jenkins, and SonarQube clients.
- Private context artifacts, provider monitoring, transitions, and session audit.
- Manifest, runtime-graph, security-boundary, context-governance, unit, DOM, board, fixture, and package validation.
