# Kronos Terminal-First Product Contract

Status: normative contract for the terminal-first evaluation build.

## Product Statement

Kronos is a VS Code work companion for organizing Jira work and operator-controlled Claude sessions. The operator may attach an existing terminal or explicitly ask Kronos to create and focus a new Claude terminal. Kronos prepares bounded provider context, monitors merge-request and CI state, and preserves a private audit trail without taking control of the resulting conversation or the software-delivery workflow.

Kronos has five bounded runtime verbs:

1. **Read** ticket and provider context.
2. **Start** a validated Claude command, only after an explicit operator action.
3. **Insert** an editable local context reference without submission.
4. **Monitor** bounded provider state for meaningful structural changes.
5. **Audit** what context and provider evidence was observed.

Anything outside those five verbs is outside the product.

## Ownership Invariants

The operator owns the terminal, process, interactive agent, repository, and submission decision at all times, including when Kronos creates the terminal on request.

Kronos never:

- launches Claude automatically or in response to provider data, polling, activation, or reload;
- launches an arbitrary executable or Claude management command: explicit start accepts only a validated `claude` or `claude-*` executable plus narrowly allowlisted interactive flags;
- creates a terminal except after **New Claude** or **Start Claude for Ticket**;
- reads, records, parses, or summarizes terminal input, output, or scrollback;
- submits inserted provider context or presses Enter for the operator;
- runs project tests, builds, static-analysis scans, deployments, database commands, or remediation commands;
- creates or removes worktrees;
- creates, switches, stages, commits, resets, pushes, merges, rebases, or deletes Git branches or refs;
- approves, comments on, merges, closes, or otherwise changes a merge request;
- mutates Jira, GitLab, Jenkins, SonarQube, or database state;
- closes, interrupts, or kills the operator's terminal when management stops.

An explicit Claude-start action validates its configured executable, approved interactive flags, terminal name, and working directory before creating anything. Positional prompts/subcommands and permission-escalating, tool-allowing, directory-expanding, MCP, plugin, background, and non-interactive flags are rejected. It creates and focuses one VS Code terminal and executes the validated Claude command exactly once. It does not use a subprocess library, observe whether Claude succeeded, or read the resulting terminal.

`Manage Focused Terminal` records a private association between a work session and the terminal object the operator explicitly focused. It does not grant Kronos general control of that terminal.

Persisted terminal names and process IDs are descriptive metadata, not durable identity. After extension reload, live attachment starts detached. Selecting the Session is the explicit reconnect action: Kronos reconnects the sole unclaimed open terminal, or requires the operator to choose when more than one is available. Context insertion remains blocked until that live object association exists.

## Navigation Contract

Kronos exposes exactly four activity views.

### Work

Work is the Jira-centered entry point and presents a board rather than an unstructured issue list.

It supports:

- refreshing Jira work metadata;
- searching tickets and filtering by status, Jira namespace, explicitly linked local project, and label;
- hiding or showing completed work by the configured default, explicitly overriding it, and clearing filters reversibly;
- opening one canonical ticket workspace;
- explicitly discovering local projects from open workspace folders and configured roots, within configured depth/result limits, then registering only selected folders;
- configuring each registered project's GitLab project ID/path, Jenkins job URL, SonarQube project key, and default monitoring branch through a guided local editor;
- reading a registered project's current Git branch without invoking Git, plus explicitly reading status and a bounded diff through VS Code's built-in Git model;
- choosing or unlinking one primary local launch project for a ticket while preserving the separate Jira namespace metadata;
- managing the explicitly focused terminal for that ticket;
- explicitly creating and focusing a Claude terminal linked to that ticket;
- inserting Jira, GitLab MR/pipeline, or combined Jenkins/SonarQube context.

Jira normalization recursively removes values with no meaningful content: `null`, blank strings, empty arrays, empty objects, and recursively empty structured text. Boolean `false`, numeric `0`, and other real values remain. This rule applies to standard and custom fields so hundreds of empty defaults do not overwhelm the board or inserted context.

The ticket workspace prioritizes either terminal-first sequence:

1. optionally choose the registered local project/branch that future launches should use;
2. start a new validated Claude terminal for this ticket, or manage an existing focused terminal;
3. insert the context needed now;
4. continue working in the operator-owned terminal.

Project linking changes local Kronos metadata only. A Jira key such as `ABC-123` contributes the Jira namespace `ABC` for display and filtering, but it never selects, creates, or infers a local repository. Only the operator's explicit **Add Project** / **Choose Ticket Project and Branch** action links a ticket to one registered project. A new ticket-launched terminal may use that linked project folder as its starting directory. Linking never changes branch, index, worktree, or repository state, and never changes the current directory of an existing terminal.

Project discovery roots, scan depth, and result limit are operator settings. An explicit Work/Setup action opens VS Code's native multi-folder picker, merges the selected machine-local parent folders into the configured roots, and immediately presents bounded discovery results. The registration editor sorts registered projects first and checked, followed by unchecked discoveries; accepting it makes that checked set authoritative. Newly registered projects immediately open a guided integration editor; Setup can reopen it for every registered project. The editor accepts only project-specific read identifiers and URLs, shows credential readiness without credential values, and pre-fills the default monitoring branch from the currently observed Git branch. Blank optional fields clear that binding. A ticket receives GitLab, Jenkins, and SonarQube project configuration only from its explicit local project link; Jira project keys and legacy project tags are never defaults. Unregistering a linked project requires confirmation and clears affected local launch links without changing Jira namespace metadata. Discovery skips symbolic child directories and dependency trees and reads only directory and Git `HEAD` metadata. Registered projects become available from the prominent **Add Project** control at the top of every Jira card and from the ticket workspace. Jira completed-work visibility and additional completed status names are mapped settings shared by the Work tree and Jira board.

It does not plan or execute software-delivery work.

Only an explicit project action invoked from the ticket path creates a ticket-to-repository link. Jira refresh, a shared Jira namespace, project registration, provider setup, polling, and standalone **New Claude** never create one.

### Sessions

Sessions is the durable operational view for interactive operator-owned terminals. Registered repositories are intentionally kept in the separate Projects view.

Each session presents:

- its operator-facing project/title identity and every explicitly attached Jira context;
- attached, detached, paused, or closed management state;
- the live terminal attachment count without terminal contents;
- provider bindings;
- latest context-artifact freshness and completeness;
- monitoring readiness, last attempt, latest successful poll, failures, and skips;
- the linked local project path and currently observed branch when available.

Supported session actions are focus, explicit reattach, detach, pause monitoring, resume monitoring, poll now, open audit, stop management, and confirmed local removal. Removal never closes a terminal; it removes the session record and colocated monitor snapshots while retaining shared audit history and saved context artifacts.

Selecting any Session means “open its terminal.” A live attachment is focused immediately. When VS Code has discarded the ephemeral attachment, Kronos never guesses from a saved process ID or duplicate terminal name: it reconnects the only unclaimed open terminal or asks the operator to choose one, then focuses it.

**New Claude** creates a project-oriented session with a workspace-derived title, validates the configured Claude command/name/cwd, creates and focuses one terminal, and starts Claude. The created terminal tab includes the branch read from the actual launch directory when Git `HEAD` is available. **Start Claude for Ticket** also includes the initiating ticket key in that title. This is launch-time display metadata only: Kronos does not invoke Git and does not write to or rename an existing terminal. A new project session contains no fake or placeholder ticket key. An operator may later attach one or more real Jira contexts to any explicitly managed terminal; this never creates or submits terminal input automatically. Legacy ticket-keyed records remain readable for migration compatibility, but Sessions and monitoring are presented and deduplicated by project when a project is known.

Stopping management disables monitoring and detaches the in-memory association. It never closes the terminal.

Session lifecycle has three independent axes: management is active or stopped; the terminal relationship is none, attached, detached, or closed; and monitoring is running, paused, ineligible, or stopped. Only a live in-memory VS Code Terminal binding is attached. A persisted attachment after reload is detached until explicit reconnect. A terminal close event records closed terminal history while leaving the Session available for a new explicit reconnect. Stopping management records stopped management and detached terminal metadata because Kronos did not close the operator-owned terminal.

### Projects

Projects is the registered local repository inventory. It is a peer of Sessions rather than a nested session section, because repository state and terminal lifecycle are independent concerns.

Each registered Project shows its current branch and clean, dirty, staged, or conflicted state. Refreshing the view asks VS Code's built-in Git model to load a registered repository when necessary, reads status without loading the full diff, and falls back to bounded local Git `HEAD` metadata for the branch. Selecting the project opens a complete bounded status/diff document; expanding it exposes secret-redacted Git-context insertion, an existing-MR or prefilled new-MR browser action, ticket-scoped MR/CI evidence insertion, and provider setup. The Projects toolbar refreshes branch/status, manages the registered project set and discovery roots, and can request the normal provider poll.

These actions use VS Code's built-in Git read model and provider REST reads. They never stage, commit, push, create an MR through an API, or otherwise mutate Git or provider state.

### Attention

Attention is the project-aware inbox for changes that merit operator review. Items are grouped by registered project when known, with their real Jira contexts retained inside the group; sessions without a project fall back to their session identity.

Attention is a current-state projection, not a historical feed. For each project, provider, and subject facet (for example GitLab MR, GitLab pipeline, Jenkins build, SonarQube gate, or provider-read health), only the newest transition is shown. A later failure, recovery, partial read, build, pipeline, or gate result replaces the older row. Acknowledging that newest row clears the stream without resurfacing a superseded event. An open merge request is the deliberate exception: clearing it snoozes it only until the next successful GitLab poll, when one new current-state reminder is recorded. The reminder remains stable until cleared again, and closed or merged MRs do not return. Every transition remains in the append-only session audit.

That projection uses one canonical stream identity: current project or fallback session, provider, resource, logical subject, and facet. MR IIDs and SonarQube project/branch pairs remain independent logical subjects. Pipeline IDs and Jenkins build numbers are occurrences, so their newest state replaces the older occurrence for the same MR pipeline or configured project job. Provider-read failure, partial, and recovery events share one health stream, with GitLab health additionally scoped to its MR.

Eligible items include:

- the first successful observation of a merge request, even when its initial state is healthy and mergeable;
- merge-request review or pipeline structural changes;
- newly failing or recovered GitLab jobs/tests;
- Jenkins build, stage, or test failures and recoveries;
- SonarQube quality-gate or unresolved-issue changes;
- partial provider reads and monitoring blockers;
- unsafe or unavailable local monitoring state.

A ticket-linked item may open its ticket workspace. Applicable items may open a validated provider URL, open an editable composer for fresh MR/CI context, place the reviewed reference into the explicitly attached terminal without submission, or be acknowledged locally. If multiple retained SonarQube branch targets or Jenkins builds are available, opening the provider uses a native latest-first picker; otherwise it opens directly. Choosing a SonarQube branch also makes that branch the project's local monitoring target, records the operator decision, and refreshes read-only polling. SonarQube dashboard URLs may retain only the non-secret `id` and `branch` routing parameters. Acknowledgement never changes provider state.

The first successful merge-request observation creates one durable transition in Attention: informational when healthy and warning-level when it already needs review. Its comparison baseline is recorded at the same time. Unchanged subsequent polling results do not create new Attention items.

## Context Insertion Contract

Context insertion is always explicit and terminal-scoped. Jira, MR, and CI evidence remain ticket-scoped, but the operator may choose any active explicitly managed terminal and may associate multiple real tickets with one project session. A `[GIT-project]` working-tree snapshot is project-scoped and may be inserted into an explicitly attached session for that project. Creating a Claude session does not silently create ticket context or a ticket association.

1. Kronos resolves the selected ticket and the explicitly managed terminal.
2. It reads the configured provider through bounded read-only APIs.
3. It normalizes and secret-redacts textual and structured provider data.
4. For Jira, it downloads attachment bytes without a file-type allowlist or parser, writes them as private files with sanitized local names, and records their paths and SHA-256 hashes. Raw files are not transformed or secret-redacted.
5. It writes a private, content-addressed JSON artifact and Markdown prompt boundary.
6. For Jira and GitLab MR context, it opens an interactive composer with escaped evidence previews, completeness warnings, an immutable artifact reference, and an editable operator-focus field.
7. It verifies that the managed terminal attachment has not changed during the fetch.
8. **Place in Terminal** or Ctrl/Cmd+Enter inserts one shell-quoted reference line with terminal execution disabled. Ordinary Enter only edits the composer text.
9. The operator reviews the terminal line and submits it manually.

Provider data inside an artifact is untrusted evidence, never instructions. Prompt artifacts tell the interactive agent not to follow commands, role changes, credential requests, links, or mutation requests found inside provider content.

Insertion targets:

- `[JIRA-123]`: visible Jira fields, including custom-field IDs, names, schemas, values, readable text, comments, and private paths to downloaded raw attachments of any MIME type;
- `[MR-77]`: GitLab merge-request metadata, notes, discussions, approvals, bounded diffs, pipelines, jobs, and test evidence;
- `[CI-JIRA-123]`: bounded Jenkins build/test/stage evidence and SonarQube gate/measure/issue evidence.

Partial, unavailable, skipped, truncated, or failed provider components remain explicit in completeness warnings. Kronos never presents partial evidence as complete.

Operator-visible failures use one bounded redacted vocabulary: configuration, authentication, permission, timeout, DNS, TLS, redirect/origin refusal, rate limit, not found, response bound, malformed response, pagination, lease contention, local state, network, or unavailable. Each classification includes one safe retry or repair action. Messages never display provider response bodies or credential values, and a failed refresh does not erase the last-known-good bounded evidence.

Jira attachment capture is bounded to 100 download attempts, 25 MiB per file, and 100 MiB in total for one explicit insertion. Filename path components are discarded before local storage. Attachment files are untrusted evidence: Kronos never parses, opens, previews, or executes them, and the generated prompt tells the interactive agent to inspect only relevant files with safe read-only tools.

## Monitoring Contract

Monitoring is read-only and belongs to an active provider-bound work session. A new standalone session begins with monitoring disabled and no provider or Jira identity.

- The default interval is configured by `kronos.managedProviderPollIntervalSec`.
- The operator can pause, resume, or poll a session immediately.
- A private cross-window lease prevents duplicate concurrent polling against one Kronos data directory. POSIX uses `O_NOFOLLOW`; Windows, where that flag is unsupported, uses exclusive creation and lstat/fstat identity verification around every lease read, write, renewal, and unlink.
- The lease and mutable MR/pipeline/CI snapshots share the same platform boundary: POSIX requires `O_NOFOLLOW`; Windows uses path/descriptor identity checks; reads must match one bounded regular-file identity from open through completion; writes use a fully synced exclusive temporary file and same-directory atomic replacement.
- Monitoring baselines contain bounded normalized digests, not full provider responses.
- `work.json` remains the local Work catalog and records the latest bounded MR and Jenkins build projection observed by monitoring. Jira refreshes preserve those projections until newer provider evidence arrives. A newer binding wins stale MR identity, and a digest is used only when its MR IID matches that identity.
- GitLab target selection has one precedence rule across polling, status, and context insertion: the newest valid durable session binding owns MR identity; explicit local-project configuration supplies the provider project when the binding does not; origin-pinned URLs are fallback evidence only; and the Work catalog is considered only when no valid binding exists.
- Work catalog schema v2 stores Jira namespace metadata separately from the sole explicit `linked_local_project`. Schema-v1 `launch_project` values migrate at the read boundary; legacy project-tag arrays never become repository links.
- Incomplete provider components do not erase the last complete component or create false recovery events.
- Losing lease ownership stops persistence and prevents the next provider request from starting.
- Provider errors affect readiness and Attention; they do not trigger remediation.
- A configured Jenkins job permits a bounded, best-effort read of that job's `/config.xml`. When SonarQube has no explicit project binding, literal `sonar.projectKey` and optional literal `sonar.branch.name` values may establish the read-only SonarQube target for the same poll. Raw XML is never persisted, expression-valued properties are ignored, and the request remains pinned to the configured Jenkins origin.
- Jenkins multibranch parents are detected from their provider class and resolved to the configured branch job before build evidence is read. Missing JUnit and Pipeline-stage endpoints are normal unavailable evidence, not a failed provider read. A Jenkins-only TLS verification override may be explicitly configured for a locally trusted corporate endpoint without affecting other providers.

Monitoring can observe GitLab, Jenkins, and SonarQube. Jira remains explicitly refreshed from Work rather than continuously monitored as terminal content.

Saving project integration data, explicitly linking a ticket project, attaching a monitored ticket session, resuming monitoring, or refreshing Jira requests an immediate bounded provider poll in addition to the interval. Provider polling configuration comes only from that explicit project link or the session's explicit project identity. When no MR is already known, GitLab polling automatically searches open MRs by the observed current source branch and then by Jira key in title/description. Exactly one match is bound locally; ambiguous results are reported and never guessed. MR and CI insertion controls fetch reviewed evidence only and are not provider-connect controls.

## Audit and Local State

By default, private terminal-first state lives under `~/.kronos`, or the explicitly configured `KRONOS_DIR`:

- work-session records contain an operator-facing title, optional real ticket identity, terminal metadata, provider bindings, context references, and monitoring readiness;
- context directories contain normalized content-addressed provider artifacts and prompt boundaries;
- compact monitor snapshots contain the latest comparison baseline;
- the append-only monitor-event ledger records session, context, transition, notification, acknowledgement, and operator-decision events.

The audit may include provider summaries, timestamps, completeness warnings, hashes, and private artifact paths. It never contains terminal input, terminal output, scrollback, provider credentials, authorization headers, cookies, raw job traces, or Jenkins console logs.

Kronos does not publish audit content externally. Opening an audit is a local read.

## Provider and Credential Boundary

Provider credentials are inherited from approved local configuration. They are never inserted into the terminal or persisted in work-session, context, snapshot, or audit records.

Credentialed requests are constrained to configured provider origins. Redirects and provider-returned URLs do not silently move credentials to another host. Response sizes, pagination, item counts, text sizes, and request timeouts are bounded.

Setup is a dedicated guided dashboard for Claude launch, project discovery and registration, Jira work, optional monitoring providers, and private state. Doctor is a dedicated status dashboard that places blocked and warning checks first. Setup, Doctor, Projects, and project integration consume one canonical secret-free provider-readiness model; Setup and Doctor render the same readiness snapshot and every row exposes one bounded action. Missing, present, and invalid-needs-test credential states are labels only—values are never rendered. The explicit private-config action opens the configured environment file and creates a private comment-only template when it is absent; the explicit Poll Now action performs only bounded provider reads. Both dashboards refresh in place. Settings exposes the supported Claude command/name/cwd behavior and polling configuration; provider credentials remain in the private environment-file path described by Setup. Settings cannot authorize a generic shell command.

## Runtime Dependency Boundary

The installed extension has zero third-party runtime dependencies. Kronos uses the VS Code API and Node built-ins; it does not bundle an agent SDK, shell library, or helper CLI. The operator-installed Claude executable is external to Kronos and is reached only through the explicit, validated VS Code terminal-launch path.

## Command Surface

The public terminal-first command surface is intentionally limited to:

- Work: refresh the Jira board; search/filter/show completed/clear filters; open ticket workspace; start Claude for the selected ticket; manage a focused terminal; insert Jira/MR/CI context;
- Sessions: create a project-oriented Claude session; add another Jira context; poll providers; open audit; focus/reattach/detach terminal; stop or remove local management; pause/resume monitoring;
- Projects: refresh registered branch/status; manage discovery and registration; view bounded status/diff; insert project Git/MR/CI evidence; open an existing or prefilled new MR page; configure project providers;
- Attention: acknowledge item and open provider;
- Operations: Setup, Doctor, and Settings.

No command outside this inventory is part of the terminal-first product contract. In particular, there is no generic terminal-command runner.

## Canonical Operator Journey

Ticket-linked journey:

1. In Work, the operator searches or filters the Jira board, selects a ticket, and opens its workspace.
2. The operator chooses `Start Claude for Ticket`, or focuses an existing terminal and chooses `Manage Focused Terminal`.
3. On explicit start, Kronos validates the configured Claude command/name/cwd, creates and focuses one VS Code terminal, and executes only that command.
4. The operator chooses `Insert [JIRA-123]`.
5. Kronos opens the context composer with the fixed private artifact reference, fetched evidence, and an editable operator-focus field.
6. The operator places the line into the terminal, reviews and submits it manually, then directs the work interactively.
7. Kronos monitors linked MR and CI providers without reading the terminal.
8. Meaningful changes appear in Attention and can produce fresh explicit MR/CI insertion actions.
9. The operator uses the work-session audit to inspect provenance and evidence.
10. The operator stops management when finished; the terminal remains open.

Standalone journey:

1. In Sessions, the operator chooses `New Claude`; Kronos derives a standalone title from the open workspace (or the launch time when no workspace is open).
2. Kronos validates the configured Claude command/name/cwd, creates and focuses one terminal, and executes the Claude command exactly once.
3. Sessions records a standalone session without a ticket key.
4. The operator owns and directs the conversation normally.
5. Stopping management leaves the terminal and Claude process alone.

## Failure Behavior

Kronos fails closed at ownership and credential boundaries:

- no focused or explicitly attached terminal means no insertion;
- an invalid Claude command, name, or cwd fails before terminal creation;
- a launch request whose executable is not `claude` or `claude-*` is rejected rather than treated as a generic shell command;
- no explicit start action means no terminal or process launch;
- a changed terminal binding cancels insertion;
- missing credentials or provider failures produce partial/blocked state, not fabricated evidence;
- an unsafe local path or lease prevents polling or persistence;
- a failed provider read does not start a mutation or remediation path;
- stopping or pausing monitoring never affects the terminal process.

Every error should tell the operator whether the provider read, local artifact write, terminal insertion, monitoring snapshot, or audit write succeeded, so retrying cannot be mistaken for a clean first attempt.
