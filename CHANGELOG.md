# Changelog

All notable changes to the Kronos preview are documented here.

## [Unreleased]

### Added

- Prioritized extension improvement roadmap covering identity, terminal lifecycle, provider reconciliation, Attention, cross-platform persistence, UX, maintainability, and release evidence.
- Dedicated Projects view with current branch, clean/dirty status, read-only Git loading, and existing project evidence actions.
- Recruiter-facing product overview, architecture, engineering metrics, and synthetic product renders.
- Branded Marketplace icon and preview metadata.
- Public-surface validation for tracked local state, machine paths, employer identifiers, private keys, and high-confidence token shapes.
- Security, support, and contribution guidance.

### Changed

- Added one Jira refresh lifecycle shared by the Work tree and board, with distinct current, empty, loading, partial, stale, error, and no-match states; in-flight, partial, and failed refreshes retain the last usable tickets and expose bounded Refresh/Doctor repair actions.
- Made every linked Jira card and ticket workspace label its repository control as **Change / Unlink Project**, sort the current project first beside its unlink choice, and expose keyboard-focusable card navigation.
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
