# Kronos Terminal-First Completion Audit

Audit date: 2026-07-14

## Outcome

The repository is ready for the operator-owned human feedback pass in `HUMAN_FEEDBACK_CHECKLIST.md`. The automated suite proves the product boundary and the main synthetic journeys. It does not replace a live VS Code test with the operator's Claude, Jira, GitLab, Jenkins, and SonarQube configuration.

## Requirement Evidence

| Area | Automated evidence | Status |
| --- | --- | --- |
| Product surface | Manifest gate enforces exactly Work, Sessions, Projects, Attention, 36 commands, and 10 settings. The activation harness registers and directly exercises every command. Runtime graph rejects cycles and dead runtime exports. | Pass |
| Jira board | Unit, activation, DOM, and board tests cover search, Jira-namespace/explicit-local-project/label filters, completed-work defaults, reset/rerender behavior, registered projects, branches, explicit Add/Change/Unlink linkage, keyboard-focusable cards, current/empty/loading/partial/stale/error/no-match states, retained last-known tickets, and bounded actions. | Pass |
| Jira context | Unit tests cover bounded REST reads, newest-comment fetching with chronological rendering, recursive empty-value pruning, meaningful `false`/`0`, arbitrary raw attachments, byte/count limits, hashes, and partial warnings. | Pass |
| Terminal ownership | Unit and activation tests prove explicit validated Claude launch, one launch per action, no automatic Jira insertion, exact managed-attachment verification before and after evidence fetch, exactly-once inert `sendText(..., false)` context placement, and no transcript reads or terminal disposal. | Pass |
| Sessions | Unit and activation tests cover project-centered labels, multiple explicit Jira contexts per session, context insertion into any explicitly managed terminal, focus/reconnect, pause/resume, detach, stop management, removal, audit persistence, launch races, and terminal-close races. Terminal objects remain open. | Pass |
| Projects and Git | Tests cover the dedicated Projects view, configurable bounded discovery, registered-first selection, authoritative uncheck, integration setup, explicit-only ticket links across multiple repositories sharing one Jira namespace, branch reads without Git execution, on-demand read-only VS Code Git loading, clean/dirty status, caps of 500 paths and 512 KiB, redacted `[GIT-project]` context, and linked launch directories. | Pass |
| Merge requests | Tests cover current-branch discovery, ticket fallback, ambiguity refusal, durable local bindings, initial healthy/mergeable attention, partial review reads, known-MR opening, and prefilled new-MR browser navigation without creating an MR. | Pass |
| Jenkins and SonarQube | Tests cover bounded Jenkins/Sonar reads, retained Jenkins build targets, deterministic latest-first choices with saved timestamps, Sonar branch dashboard links, persisted monitored-branch choices, literal `sonar.projectKey` discovery from Jenkins XML, and rejection of expression-only values. | Pass |
| Attention | Tests cover real transitions, initial and cleared-but-still-open MR reminders, healthy SonarQube observations, provider failures/recoveries, acknowledgements, project grouping, newest-state replacement without stale-row resurrection, provider branch/build choices, and editable MR/CI insertion. | Pass |
| Setup and Doctor | Unit, DOM, and activation tests cover one shared readiness snapshot, blocked-first ordering, allowlisted per-row actions, private comment-only provider template creation, missing versus invalid configuration, immediate Poll Now verification, credential-presence labels, and no credential values in UI. | Pass |
| Security and dependencies | Public-surface, security, and context-governance gates pass. Runtime dependencies are empty; only TypeScript and Node/VS Code type packages are development dependencies. `npm audit` reports zero known vulnerabilities. | Pass |
| Packaging | `npm run feedback:ready` compiles, tests, packages, checks the VSIX contents, rejects legacy/development/local-state files, and creates a safe synthetic feedback state. | Final gate |
| Quality evidence | `docs/verification-matrix.json` maps roadmap goals to named test declarations and explicit human gates. `scripts/check-quality-evidence.js` rejects missing tests, checklist markers, command/setting/module/test metric drift, or a human gate silently marked complete. | Pass |
| State and provider contracts | `docs/state-ownership.md` gives every persisted/in-memory record one writer, ingress, bound, compatibility rule, and consumer. `docs/provider-contract-matrix.md` records request, bound, normalization, completeness, and error behavior for all four providers; the quality gate checks both documents' required rows. | Pass |
| Scale and accessibility | `docs/scale-accessibility-budget.md` records shipped collection/read/poll and local timing budgets. A dedicated gate builds 500 ticket cards, filters 500 tickets, summarizes 2,000 supplied audit events to 500, checks labels/focus/forced-colors/narrow-panel invariants, and proves a newer explicit Jira refresh supersedes the prior state writer. Real VS Code screen-reader, zoom, and paint behavior remain human gates. | Automated pass; human gate open |
| Orchestration boundaries | Work refresh concurrency has one focused coordinator with independent concurrency tests. Deterministic provider transition recording and provider-read health normalization now have focused owners/tests outside the polling loop, covering identity, duplicate suppression, recovery, safe failure categories, completeness components, and fingerprints. Activation and polling retain workflow sequencing and VS Code/operator notification decisions. | Pass for extracted slices; further small extractions remain optional |

## Changes Found During This Audit

- Repeated provider-read failures create durable transitions only when the normalized source state or error changes.
- Jira, MR, CI, and Git composers now capture one exact session/binding/terminal attachment before fetch and re-resolve it before placement. Detachment or rebinding during fetch cancels the stale composer, a failed terminal send can be retried, and any successful send permanently consumes that composer even if its later local audit update fails or another queued message arrives.
- Setup, Doctor, Projects, and project integration now consume one secret-free provider configuration model. Setup and Doctor render the same canonical snapshot, every row has one bounded action, the private environment editor creates only a private comment-only template when absent, and Poll Now remains an explicit read-only operator action.
- Provider-read health, progress failures, Jira refresh, project setup, provider context warnings, and common panel actions now share a bounded redacted error vocabulary with one safe next action. Authentication and permission are distinct, as are timeout, DNS, TLS, redirect, rate limit, missing target, response bound, malformed response, pagination, lease contention, local state, network, and unknown availability.
- The monitoring lease, durable work-session records, and MR, pipeline, read-health, and combined CI snapshots now share one private-file foundation: Windows omits unsupported `O_NOFOLLOW` and compensates with path/descriptor identity verification; POSIX requires the kernel flag; writes are bounded, complete, private, and same-directory atomic. Each work-session record has an explicit 4 MiB read/write cap and rejected records appear as Doctor issues.
- Sessions, polling readiness, and command guards now share one lifecycle projection. Reloaded attachments become detached until explicitly reconnected, a VS Code terminal exit is recorded as closed history, explicit detach stays detached, paused monitoring stays separate, and stopping management never claims the still-open operator terminal was closed.
- GitLab polling, status, and context insertion now share one target resolver: the newest valid durable binding owns MR identity, matching provider evidence may enrich it, configured local-project identity supplies its read target, and stale catalog MR identity cannot override it.
- Work catalog schema v2 stores one explicit `linked_local_project`; schema-v1 links migrate, legacy inferred project tags are discarded, unavailable links are cleared with a load issue, and future schemas fail closed.
- Work filtering now keeps Jira namespaces and explicit local projects in separate typed facets, selectors, persisted board state, and card attributes so one identity cannot satisfy the other filter.
- Work now projects one Jira refresh lifecycle into both the tree and full board. Deferred reads show loading over retained rows; partial reads report retained counts and warnings; stale data is timed from the configured interval; failures keep last-known tickets visible; and empty or filter-no-match states remain distinct.
- Attention now shows only the newest transition for each project/provider/facet. Recoveries, later failures, builds, pipelines, and gate results replace stale rows; acknowledging the newest row cannot resurrect an older one. The append-only audit history is unchanged.
- Monitoring and Attention now share a canonical project-or-session/provider/resource/logical-subject/facet stream key. Separate MRs and SonarQube branches stay independent; pipeline IDs and Jenkins build numbers are occurrences whose newer state replaces their stale row; GitLab read health stays scoped to its MR.
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
