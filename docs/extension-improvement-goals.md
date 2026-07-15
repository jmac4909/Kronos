# Kronos Extension Improvement Goals

Status: working roadmap for cleanup, hardening, and the next product pass after the terminal-first preview.

This document is a backlog, not a completion claim. The product contract remains normative. Each goal below states an operator outcome, the cases that must be handled, and the evidence required before the goal can be marked complete.

## North-star goal

Make Kronos feel like a dependable terminal work cockpit: Jira work, local repositories, operator-owned Claude sessions, merge requests, pipelines, SonarQube, and audit evidence stay organized and current while the operator retains complete control of the terminal, prompt, repository, and provider actions.

Kronos should reduce context gathering and monitoring friction. It must not become a one-click autonomous coding or delivery system.

## Non-negotiable boundaries

Every cleanup and feature must preserve these invariants:

- Kronos has only five runtime verbs: read, explicitly start Claude, insert without submission, monitor, and audit.
- A Jira namespace such as `ABC` is ticket metadata only. It never selects or infers a local repository.
- A ticket receives a local project only after an explicit operator link.
- Standalone sessions never receive a fabricated Jira ticket.
- Kronos never reads terminal input, output, or scrollback.
- Kronos never presses Enter for inserted context.
- Kronos never runs project commands or mutates Git, Jira, GitLab, Jenkins, SonarQube, or a database.
- Stopping or removing Kronos management never closes the operator's terminal.
- Provider reads, files, pagination, text, attachments, and polling are bounded.
- Credentials and terminal content never enter UI, context artifacts, monitor snapshots, audit records, or Git.
- The installed extension keeps zero third-party runtime dependencies. Node built-ins and the VS Code API remain the runtime boundary.

## Priority definitions

- **P0 — trust:** identity, terminal ownership, state correctness, security, and provider-monitoring behavior.
- **P1 — core experience:** Work, Sessions, Projects, Attention, Setup, Doctor, and context usability.
- **P2 — maintainability:** smaller modules, clearer schemas, stronger evidence, performance, accessibility, and documentation.
- **P3 — expansion:** valuable additions that remain inside the terminal-first boundary.

## P0 goals — correctness and trust

### G01 — Make every identity explicit and unambiguous

**Goal statement:** Kronos shall maintain separate canonical identities for the Jira namespace, Jira ticket, explicitly linked local project, session project, provider project, MR, pipeline, Jenkins job/build, and SonarQube project/branch, with no inference across those boundaries unless a documented discovery rule produces exactly one safe provider match.

Cases to cover:

- Four local repositories may all serve tickets under the same Jira namespace.
- Two tickets with the same namespace may link to different repositories.
- An unlinked ticket stays unlinked across Jira refresh, provider polling, project registration, reload, and standalone session creation.
- An explicit ticket-to-project link survives refresh and is cleared only by explicit unlinking or confirmed project removal.
- A project-oriented session may have no Jira ticket, one ticket, or several explicitly added tickets.
- Provider bindings remain resource-specific and cannot overwrite unrelated provider identities.
- Legacy inferred `Ticket.projects` data cannot act as a link or provider configuration source.

Completion evidence:

- Introduce a versioned state migration that replaces the legacy `projects` array and the underspecified `launch_project` name with one clearly named explicit local-project link.
- Read old schema records safely, write only the new canonical schema, and document rollback/recovery behavior.
- Add migration, shared-Jira-key, multi-project, unlink, reload, and malformed-record regressions.
- Prove that unlinked tickets return no project-scoped GitLab, Jenkins, or SonarQube configuration.

### G02 — Make terminal ownership correct through the full lifecycle

**Goal statement:** Every Session selection shall open the exact live VS Code terminal attached to that session, and every detach, reload, reconnect, close, stop-management, and removal path shall fail safely without guessing or controlling the terminal process.

Cases to cover:

- New Claude with and without an open workspace.
- Start Claude for a linked and an unlinked ticket.
- Manage an already focused terminal without launching or writing anything.
- Multiple sessions with duplicate terminal names.
- The only unclaimed terminal can reconnect after reload; multiple candidates require a picker.
- Terminal closes during launch, provider fetch, composer review, or insertion.
- The operator changes the active terminal while context is being fetched.
- Detached, paused, closed, and removed session records remain understandable.
- Removing an old session deletes only its local session/snapshot records and never shared artifacts or the terminal.

Completion evidence:

- One lifecycle state machine defines attached, detached, paused, stopped, closed, and removed behavior.
- Race tests cover double-click launch, delayed terminal creation, terminal-close events, reload, and changed insertion targets.
- A real VS Code feedback pass confirms focus and reconnect behavior on Linux and Windows.

### G03 — Make every context insertion reviewable, exact, and non-submitting

**Goal statement:** Jira, MR, CI, and Git evidence shall always open an editable review surface, retain an immutable artifact reference, target only the explicitly attached terminal selected by the operator, and insert exactly once with execution disabled.

Cases to cover:

- Jira fields, custom fields, comments, attachments, pruning, and partial reads.
- MR notes, discussions, approvals, diffs, pipelines, jobs, and test evidence.
- Jenkins and SonarQube complete, partial, mixed-success, and unavailable reads.
- Project diff evidence with secret-like text and bounded truncation.
- Ordinary Enter edits the focus; Ctrl/Cmd+Enter or Insert places one line.
- Duplicate DOM initialization and repeated button clicks cannot duplicate insertion.
- Terminal detachment or rebinding during fetch cancels placement.
- POSIX and PowerShell-safe inert quoting remains non-executing.

Completion evidence:

- Every insertion path uses one shared target-verification and `sendText(..., false)` boundary.
- Artifacts clearly distinguish fetched, partial, unavailable, skipped, and truncated components.
- Raw attachments remain byte-for-byte private files that Kronos never parses, previews, or executes.
- DOM, activation, race, quoting, redaction, and manual terminal tests pass.

### G04 — Turn monitoring and Attention into one deterministic state machine

**Goal statement:** A poll shall produce an Attention change only when the normalized provider state meaningfully changes, while the current Attention projection shows only the newest relevant state and the append-only audit retains the complete history.

Cases to cover:

- The first MR observation appears even when initially healthy and mergeable.
- The same source and same normalized error do not create repeated events.
- Failure, recovery, partial read, and a later failure replace one another in Attention.
- Incomplete reads do not erase last-known complete facets or create false recovery.
- Clearing an open MR snoozes it only until the next successful poll.
- An uncleared open-MR reminder does not duplicate on unchanged polls.
- Merged or closed MRs do not resurface.
- Newer pipelines, jobs, builds, test results, quality gates, and Sonar issues replace stale rows.
- Acknowledging the newest event never resurrects an older one.
- Restart and cross-window lease recovery do not duplicate transitions.
- A configured registered project polls GitLab, Jenkins, and SonarQube without any Jira link or terminal Session.
- Project-owned bindings, baselines, health, and Attention survive Session removal and extension reload.
- The first completed healthy Jenkins build appears once, just like the first healthy MR and SonarQube gate.
- Jenkins aborted, canceled, cancelled, and unstable results plus SonarQube warning gates use the same unhealthy classification for baselines and later transitions.
- Provider-read failure or partial state replaces the related GitLab MR, Jenkins build, or SonarQube branch row; recovery reveals the newest provider result instead of adding a second green row.
- A provider that first becomes available after another CI provider established the combined baseline still emits its one initial healthy Jenkins build or SonarQube gate observation.

Completion evidence:

- One documented transition key defines project/session, provider, resource, subject, and facet.
- Baseline, transition, acknowledgement, reminder, and projection logic share that key.
- Table-driven tests cover every transition pair and restart behavior.
- The audit can reconstruct the sequence even when Attention contains one row.

### G05 — Establish one provider-binding source of truth

**Goal statement:** MR and CI identity shall reconcile deterministically across the Work catalog, session provider bindings, monitor snapshots, project configuration, and freshly discovered provider state so the UI never says “no MR” when a valid current binding exists and never polls a stale subject.

Cases to cover:

- A bound MR wins an older `work.json` MR.
- A matching monitor digest may enrich the current MR but cannot replace its identity.
- Current-branch MR discovery runs before Jira-key search.
- Exactly one discovery result binds locally; zero remains unbound and multiple results are reported without guessing.
- Closed/merged MR identity is retained long enough for the closing transition and then cannot drive open-MR reminders.
- Project actions can find the known MR through the explicit local-project link.
- Provider URLs remain credential-free and pinned to the configured origin.
- Jenkins job configuration, observed builds, and selected historical targets remain distinct.
- SonarQube project and branch identity remains intact in dashboard URLs and branch selection.
- Project actions can find and insert the known MR from the registered-project monitor without a Jira link; insertion still requires an explicit project terminal.

Completion evidence:

- Add one reconciliation service used by Work, Sessions, Projects, Attention, polling, and context insertion.
- Remove duplicate “effective MR” and target-selection rules from view/controller paths.
- Add stale-catalog, stale-snapshot, new-binding, ambiguity, close, reload, and multi-project tests.

### G06 — Make local persistence and the monitoring lease cross-platform and recoverable

**Goal statement:** Kronos shall read and write private local state atomically and safely on Linux, macOS, and Windows, including lease acquisition where `O_NOFOLLOW` is unavailable.

Cases to cover:

- Windows lease creation without unsupported flags.
- Symlinked files, parent directories, replacement races, and identity changes.
- Stale lease owner, expired lease, renewal loss, and shutdown release.
- Oversized, truncated, malformed, unsupported-schema, and partially written JSON.
- Two VS Code windows using the same `KRONOS_DIR`.
- Default-directory migration from the legacy location.
- Cleanup of session-local snapshots without deleting shared context or audit data.

Completion evidence:

- Platform-specific safe-open behavior is isolated behind one file primitive layer.
- Every state file documents ownership, size cap, schema, atomic-write behavior, and cleanup lifecycle.
- Windows-native tests and a two-window manual poll test pass.

### G07 — Make failure behavior actionable and truthful

**Goal statement:** Every failed or partial operation shall say which provider read, artifact write, session update, insertion, snapshot, and audit step succeeded or failed, without hiding a previous valid result or implying that a mutation occurred.

Cases to cover:

- Missing credentials versus invalid credentials versus insufficient permission.
- Timeout, DNS, TLS, redirect rejection, pagination failure, response-size rejection, and malformed payload.
- Jira succeeds while attachments or comments are partial.
- Jenkins succeeds while JUnit or pipeline-stage APIs are unavailable.
- SonarQube or GitLab fails while another provider succeeds.
- Local state succeeds but audit append fails, or the reverse.
- Poll lease is unavailable versus provider configuration is missing.

Completion evidence:

- Use one bounded error vocabulary across Doctor, Setup, Work, Sessions, Attention, notifications, and audits.
- Every retryable error shows the safe next action and never exposes a credential value.
- Failure regressions assert both visible state and retained last-known-good evidence.

## P1 goals — core operator experience

### G08 — Make the Jira Work board a clear, durable control surface

**Goal statement:** The Work board shall make it fast to find active Jira work, understand ticket state, explicitly select the correct repository, and enter the terminal workflow without confusing Jira namespaces with local projects.

Cases to cover:

- Split **Jira project/namespace** and **Local project** into separate filters and card concepts.
- Completed work is hidden by default but always reversible and configurable for custom statuses.
- Search, status, Jira namespace, local project, label, and completed-state filters compose correctly.
- Filter state survives rerender and reset returns to the configured default.
- Empty, loading, partial, stale, error, and no-match states are distinct.
- Ticket cards expose a prominent explicit Add/Change/Unlink Project control.
- Large ticket sets, long summaries, many labels, and sparse custom fields stay readable.
- Keyboard navigation, focus order, labels, and screen-reader names work.

Completion evidence:

- Board data types stop calling Jira namespaces and local repositories by the same generic `projects` name.
- DOM and pure-builder tests cover every filter combination and action.
- Manual feedback confirms a ticket can reach a new or existing terminal in two obvious actions.

### G09 — Make Projects the trustworthy repository inventory

**Goal statement:** Projects shall remain a peer view that shows the registered repository, real path, branch, read-only status, provider readiness, and relevant evidence actions independently of terminal-session lifecycle.

Cases to cover:

- Native multi-folder discovery-root selection.
- Configurable roots, depth, and result limits.
- Registered projects sorted first and checked; unchecked discoveries remain unregistered.
- Authoritative uncheck with confirmation when tickets would be unlinked.
- Duplicate names, duplicate real paths, missing folders, symlinked children, worktrees, and detached HEAD.
- Clean, dirty, staged, untracked, conflicted, and oversized diff states.
- Existing MR page versus prefilled new-MR page, with no API creation.
- Git, MR, Jenkins, and Sonar context actions require an explicitly managed target session.

Completion evidence:

- Registration identity is stable by canonical path, with a separate optional nickname that can be set or cleared without rewriting links.
- Branch/status refresh never invokes a Git executable or mutates repository state.
- Integration status is visible without displaying credentials.

### G10 — Make Sessions feel like direct terminal bookmarks

**Goal statement:** Sessions shall organize active and historical operator-owned terminals without adding ceremony: clicking a session opens its terminal, New Claude works without a ticket, ticket sessions show real context, and old records are easy to remove safely.

Cases to cover:

- Standalone, ticket-started, and existing-terminal sessions.
- Project/title, branch, ticket contexts, attachment state, monitoring state, and latest result are scannable.
- Multiple Jira contexts may be added explicitly to one project session.
- Click-to-focus, explicit reconnect, detach, pause, resume, poll, audit, stop, and remove have distinct language.
- Closed terminals and removed projects do not leave misleading active states.
- Terminal title shows project/ticket and observed branch at launch without later renaming an operator terminal.

Completion evidence:

- The primary click action always means Open Terminal; repair choices appear only when needed.
- Destructive local-record removal is confirmed and explains exactly what remains.
- Session search is designed without indexing terminal content.

### G11 — Make Attention quiet, current, and directly useful

**Goal statement:** Attention shall show only work that merits operator review, grouped by project when known, with enough current state and safe actions to decide what to do next.

Cases to cover:

- MR, pipeline, Jenkins, SonarQube, provider health, and local monitoring blockers.
- Informational, warning, failure, recovery, partial, and blocked severities.
- Provider page opens with a validated URL; missing URLs give a repair action.
- Multiple Jenkins builds or SonarQube branches use a latest-first picker.
- Ticket actions exist only for real ticket context.
- MR/CI insertion opens the composer rather than submitting or “connecting” a provider.
- Acknowledge, snooze-open-MR, and historical audit semantics are understandable.

Completion evidence:

- Rows visibly show project, provider, subject, observed time, last changed time, and why attention is required.
- No action button implies a provider mutation.
- Human feedback confirms unchanged polling is quiet and real transitions are noticeable.

### G12 — Restore Setup, Doctor, and Settings as coherent guided UI

**Goal statement:** A new operator shall be able to configure Claude launch, Jira, discovery roots, registered projects, GitLab, Jenkins, SonarQube, polling, and private state—and repair failures—without reading source code or seeing secret values.

Cases to cover:

- First run, partially configured, fully ready, invalid URL, missing credential, and insufficient-permission states.
- Project registration immediately offers project-specific integration setup.
- Registered project integration values can be reviewed and cleared.
- Current Git branch pre-fills the default monitoring branch.
- Doctor orders blocked items first and distinguishes config, auth, permission, reachability, and optional evidence.
- Settings link to the relevant guided UI instead of becoming a second competing setup flow.
- Windows paths, environment-file locations, and reload requirements are explained precisely.

Completion evidence:

- Setup and Doctor share one readiness model and cannot disagree about the same configuration.
- Credential presence is reported only as present/missing/invalid-needs-test; values are never rendered.
- Every blocked row has one bounded next action.

### G13 — Make provider behavior complete for real enterprise variants

**Goal statement:** Jira, GitLab, Jenkins, and SonarQube reads shall handle the common organization-specific variants needed by Kronos while staying bounded, origin-pinned, read-only, and explicit about unavailable evidence.

Cases to cover:

- Jira token pagination, recent completed work, custom statuses, rich text, custom fields, comments, and arbitrary attachments.
- GitLab numeric IDs and encoded group/subgroup paths, paginated discussions, approvals, pipelines, jobs, tests, and branch/ticket MR discovery.
- Jenkins classic and multibranch jobs, queued/running/completed builds, absent JUnit or Pipeline APIs, literal Sonar configuration in bounded XML, and optional Jenkins-only TLS override.
- SonarQube quality gates, measures, issues, project/branch selection, server variants, and safe dashboard routing parameters.
- Rate limiting, permission-limited fields, partial pages, and providers returning unexpected but valid extra fields.

Completion evidence:

- Each provider has a small contract matrix of request, bound, normalization, truncation, completeness, and error behavior.
- Sanitized recorded fixtures cover real response variants without adding provider SDKs or runtime libraries.
- Live-provider feedback records versions, permissions, and any unsupported endpoint shape.

## P2 goals — maintainability and release quality

### G14 — Split orchestration hotspots into reviewable modules

**Goal statement:** Command routing, view orchestration, provider polling, state reconciliation, and UI rendering shall be separated enough that a feature change has one obvious owner and can be reviewed without reading several thousand-line files.

Current hotspots to reduce deliberately:

- `src/terminalFirstExtension.ts` owns activation and most command workflows.
- `src/services/managedProviderMonitor.ts` owns several provider state machines.
- `scripts/run-unit-tests.js` contains most behavior tests in one file.
- Provider context and REST files repeat some normalization, bounds, and failure concepts.

Completion evidence:

- Extract by stable responsibility—Work, Sessions, Projects, Attention, provider reconciliation, and shared progress/error behavior—without expanding the public command surface.
- Keep local helpers local unless at least two real owners need the same invariant.
- Move tests into feature-focused files while retaining one `npm test` gate.
- Every extraction is behavior-preserving, independently tested, committed, and pushed as a small slice.

### G15 — Strengthen schemas, invariants, and state ownership

**Goal statement:** Every persisted and in-memory record shall have one owner, a bounded schema, normalization at ingress, and explicit compatibility behavior so views do not compensate for malformed or ambiguous state.

Cases to cover:

- Work catalog, session records, provider bindings, monitor baselines, Attention/audit events, context artifacts, and setup configuration.
- Optional versus unavailable versus partial values.
- Dates, branch names, URLs, project IDs, issue keys, attachment paths, and hashes.
- Legacy schemas, unknown fields, unsupported future schema versions, and corrupt records.

Completion evidence:

- Record ownership and data flow are documented in one diagram/table.
- Normalize once at provider/file ingress; internal consumers receive canonical types.
- Replace compatibility fields and broad unknown-shape probing after migration coverage exists.

### G16 — Make test results explain product quality, not just pass/fail

**Goal statement:** Validation shall report which operator journeys, boundary failures, platforms, and live integrations have evidence, and which still require human signoff.

Cases to cover:

- Pure normalization/transition tests.
- State migration and persistence tests.
- Provider transport/fixture tests.
- DOM and message-allowlist tests.
- VS Code activation and command routing tests.
- Terminal focus and lifecycle manual tests.
- Linux, Windows, and multi-window lease tests.
- Live Jira, GitLab, Jenkins, and SonarQube tests.

Completion evidence:

- Maintain a requirement-to-test matrix generated or checked by the local scripts.
- Test output summarizes feature groups and human gates.
- Documentation metrics such as command, setting, module, and test counts are derived or checked so `35`/`36`-style drift cannot recur.
- Required gate: `npm test`, `npm run feedback:smoke`, `npm run feedback:ready`, and `git diff --check`.
- No goal is called complete solely because synthetic tests pass when its acceptance criteria require real VS Code, Windows, or live-provider behavior.

### G17 — Keep the UI responsive, accessible, and bounded at realistic scale

**Goal statement:** Kronos shall remain understandable and responsive with realistic ticket, project, session, event, comment, attachment, diff, pipeline, and issue counts.

Cases to cover:

- Hundreds of tickets, the configured maximum projects, long labels/summaries, many sessions, and a long audit ledger.
- Slow provider reads, cancellation, repeated refresh actions, and overlapping polls.
- Keyboard-only operation, visible focus, screen-reader labels, high contrast, narrow panels, and zoom.
- Large artifacts and lists render summaries first rather than blocking the extension host.

Completion evidence:

- Document a render/read/poll budget for every bounded collection.
- Add cancellation and stale-result protection where a newer explicit request supersedes an older one.
- Run a large synthetic fixture and record responsiveness plus accessibility findings.

### G18 — Keep security, packaging, and documentation continuously aligned

**Goal statement:** Every shipped VSIX shall contain only the intended runtime, assets, license, and operator documentation; no local state, secrets, machine paths, private artifacts, stale claims, or unused runtime code may ship.

Cases to cover:

- Secret-like fixtures, environment files, local `.kronos` data, VSIX files, logs, screenshots, source maps, and development-only assets.
- Runtime dependency graph, cycles, dead exports, command allowlist, settings allowlist, webview CSP, message allowlists, and URL origin rules.
- README, product contract, completion audit, changelog, checklist, screenshots, and package metadata.

Completion evidence:

- Packaging fails closed on unexpected files or runtime dependencies.
- Public-surface scans run before tests and before release packaging.
- Product claims link to current automated or human evidence.
- The branch is clean and local/remote heads match after each requested publish slice.

## P3 goals — high-value additions inside the boundary

### G19 — Add a context basket

**Goal statement:** The operator may collect selected Jira, MR, project diff, Jenkins, and SonarQube artifacts into one bounded editable preview and place one non-submitting reference into the chosen managed terminal.

Cases to cover:

- Jira, GitLab MR, local Git, Jenkins, and SonarQube artifacts may be selected together without copying their payloads into basket state.
- Every selection shows provenance, freshness, completeness, size, hash, warnings, and same-source content conflicts.
- Exact artifacts deduplicate while a changed artifact from the same source remains an explicit conflict.
- Refresh opens the ordinary source composer and never silently replaces a selection.
- Removing or clearing selections never deletes their underlying private artifacts.
- Placement remains editable, verifies the exact managed terminal, inserts one reference, and never submits it.

Completion evidence:

- Focused store tests cover bounds, provenance, deduplication, conflicts, removal, and reference-only immutable bundles.
- DOM and operator-terminal tests cover explicit refresh, editable focus, exact placement, and non-submission.

### G20 — Add provider health and suppressed-noise visibility

**Goal statement:** Projects and Sessions shall show last attempted poll, last successful poll, last meaningful change, next scheduled poll, current normalized error, and suppressed unchanged-result count without creating more Attention rows.

Cases to cover:

- Sessions and Projects derive the same last-attempt, last-success, last-change, next-poll, current-error, and quiet-count model.
- A successful unchanged poll advances success and quiet counts without changing the last meaningful transition.
- A current normalized failure or partial result remains visible until that provider stream recovers.
- Health-only updates never create Attention history or imply automated remediation.

Completion evidence:

- Focused health tests cover session projection, project aggregation, persistence, failure/partial recovery, and quiet suppression.
- Real VS Code and live-provider feedback confirms the values agree across Sessions, Projects, Doctor, and actual polling.

### G21 — Add local session and evidence search

**Goal statement:** The operator may search session titles, explicit ticket keys, project names, branches, provider bindings, event summaries, and artifact labels without indexing or reading terminal content.

Cases to cover:

- Search covers sessions, explicit Jira contexts, projects, branches, provider bindings, audit summaries, and artifact labels.
- Terminal objects, input, output, and scrollback are structurally absent from index input.
- Source-specific and total result budgets prevent one large source from starving the rest.
- Every visible field is normalized and bounded before matching or display.
- The index is private, ephemeral, rebuilt from canonical local state, and removed with that state.
- Result actions retain only the bounded local target required to open the selected evidence.

Completion evidence:

- Focused search tests cover all sources, independent budgets, visible-field normalization, and bounded result actions.
- A real VS Code Quick Pick pass confirms current-state rebuilds, expected navigation, and terminal-text exclusion.

### G22 — Add safe handoff bundles and branch profiles

**Goal statement:** The operator may export selected redacted context/audit references and hashes to a local Markdown/JSON bundle, and may configure explicit per-project branch profiles for Jenkins and SonarQube variants.

Cases to cover:

- Handoffs contain bounded redacted context/audit references, hashes, provenance, and operator notes without source payloads or terminal content.
- Markdown and JSON publish as one private immutable pair and incomplete or external-path selections fail closed.
- Handoff creation never contacts or writes Jira, GitLab, Jenkins, SonarQube, Git, or a terminal.
- Branch profiles retain explicit Jenkins and SonarQube targets for up to the documented project limit.
- Duplicate, unsafe, credential-bearing, or unknown active profiles are rejected without replacing valid setup.
- CI routing uses an exact known MR branch, then only an explicit fallback; it never switches Git or creates a ticket-project link.

Completion evidence:

- Focused handoff/profile tests cover bounds, redaction, immutable pairs, invalid inputs, exact routing, and identity preservation.
- Real project UI and live-provider feedback confirms profile round trips and provider routing without repository or provider mutation.

## Feature and edge-case coverage map

| Surface | Minimum cases that must remain covered | Primary goals |
| --- | --- | --- |
| Activation/reload | no automatic launch, no automatic insertion, no duplicate polling owner, detached live terminals | G02, G04, G06 |
| Work/Jira board | loading, active/done, custom statuses, filters, reset, sparse/malformed data, explicit project link | G01, G07, G08 |
| Jira evidence | pagination, custom fields, rich text, comments, arbitrary attachments, pruning, truncation, partial reads | G03, G07, G13 |
| Project discovery | native roots, depth/limit, symlinks, duplicate paths/names, checked registration, confirmed unlink | G01, G06, G09 |
| Git evidence | branch, detached HEAD, worktree pointer, clean/dirty/staged/conflict, bounded diff, redaction | G03, G09 |
| Claude launch | standalone/ticket, allowed and rejected commands/flags, cwd fallback, branch title, double-click race | G02 |
| Existing terminal | explicit focus, exact attachment, duplicate names, reload chooser, detach/close/remove | G02, G10 |
| Context composer | escaped preview, editable focus, immutable ref, changed target, one inert insertion, no submit | G03 |
| GitLab | ID/path config, MR discovery, ambiguity, discussions, approvals, pipelines/jobs/tests, close/merge | G04, G05, G13 |
| Jenkins | classic/multibranch, job/build identity, running/completed, missing optional APIs, XML Sonar discovery, TLS | G04, G05, G13 |
| SonarQube | project/branch identity, gate/measures/issues, dashboard URL, multiple branch targets | G04, G05, G13 |
| Attention | baseline event, newest replacement, duplicate suppression, recovery, partial, acknowledge, open-MR reminder | G04, G11 |
| Setup/Doctor | first run, partial setup, credentials, per-project integration, repair actions, no secret display | G07, G12 |
| Local state/audit | private files, bounds, atomicity, schema migration, corrupt data, cleanup, no transcript/credentials | G01, G06, G15 |
| Security/package | zero runtime dependencies, allowlisted commands/messages, CSP, origin pinning, safe VSIX contents | G18 |
| Scale/accessibility | large fixtures, cancellation, keyboard, focus, screen reader, high contrast, narrow panels | G17 |

## Recommended execution order

1. **Canonical identity migration:** G01 and G15. Remove the legacy ticket-project ambiguity before adding more provider behavior.
2. **Work filter clarity:** the G08 slice that separates Jira namespace from explicit local project.
3. **Provider binding reconciliation:** G05, followed by the G04 transition-state matrix.
4. **Terminal lifecycle hardening:** G02 and G10, including reload and removal tests.
5. **Cross-platform persistence:** G06, with a real Windows pass.
6. **Setup/Doctor and error model:** G07 and G12.
7. **Provider variant matrix:** G13 using sanitized fixtures and live signoff.
8. **Module/test cleanup:** G14 and G16 in small behavior-preserving commits.
9. **Accessibility, scale, packaging, and documentation:** G17 and G18.
10. **New bounded features:** G19 through G22 only after P0 and P1 evidence is current.

## Definition of done for every slice

A slice is done only when:

1. The operator-visible outcome and negative cases are written before implementation.
2. The change preserves every non-negotiable boundary above.
3. Normal, empty, partial, malformed, failure, recovery, reload, and relevant race cases are considered.
4. Focused tests prove the changed behavior and a source guard is added when an invariant must not drift back.
5. `npm test` and `git diff --check` pass.
6. `npm run feedback:ready` passes for UI, packaging, state, dependency, or public-surface changes.
7. The product contract, completion audit, checklist, README, and changelog are updated when their claims change.
8. Real VS Code, Windows, or live-provider behavior is marked **human verification required** until recorded evidence exists.
9. The diff is reviewable, contains no credentials or machine-local data, and is committed as one intentional slice.
10. When publishing was requested, the commit is pushed and local/remote heads are verified equal.

## Explicit non-goals

- Autonomous ticket implementation or a one-click “do the work” button.
- Reading or summarizing the terminal transcript.
- Automatically submitting prompts.
- Running tests, builds, scans, deployments, database queries, or remediation commands.
- Git staging, committing, pushing, branching, merging, or worktree management.
- Creating, approving, commenting on, or merging provider records through APIs.
- Guessing a local repository from a Jira key, branch string, MR title, or folder name.
- Adding a third-party runtime SDK or generic shell/process execution layer.
