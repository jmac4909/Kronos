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

An explicit Claude-start action validates its configured executable, approved interactive flags, typed permission mode, terminal name, and working directory before creating anything. Positional prompts/subcommands and raw permission, tool-allowing, directory-expanding, MCP, plugin, background, and non-interactive flags are rejected. The typed launch mode is one of Manual/default, Accept Edits, Plan, Auto, Don't Ask, or Bypass Permissions. Non-default modes are appended only by the launcher. Bypass Permissions is explicitly experimental: Kronos shows a blocking warning for every requested bypass launch, offers launch, Claude Settings, or cancel, and creates no session or terminal unless the operator chooses the launch action. It creates and focuses one VS Code terminal and executes the resulting validated Claude command exactly once. It does not use a subprocess library, observe whether Claude succeeded, or read the resulting terminal.

`Manage Focused Terminal` records a private association between a work session and the terminal object the operator explicitly focused. It does not grant Kronos general control of that terminal.

Persisted terminal names and process IDs are descriptive metadata, not durable identity. After extension reload, live attachment starts detached. Selecting the Session is the explicit reconnect action: Kronos reconnects the sole unclaimed open terminal, or requires the operator to choose when more than one is available. Context insertion remains blocked until that live object association exists.

## Navigation Contract

Kronos exposes exactly four activity views.

### Work

Work is the Jira-centered entry point and presents a board rather than an unstructured issue list.

It supports:

- refreshing Jira work metadata;
- showing current, empty, loading, partial, stale, error, and filter-no-match states distinctly in both the Work tree and Jira board, while retaining the last usable tickets during an in-flight, partial, or failed refresh;
- searching ticket keys, summaries, descriptions, types, priorities, statuses, Jira namespaces, explicit local projects and nicknames, labels, update timestamps, attachment names/types, MR identity/author/branches/state, and build number/status; independently filtering by status, Jira namespace, explicitly linked local project, and label;
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

Project discovery roots, scan depth, and result limit are operator settings. A discovery root is only a parent folder Kronos may inspect, such as `IdeaProjects`; it is never itself registered merely because it was selected. Setup is the one normal discovery-folder picker; **Manage Registered Projects** in Projects scans the configured roots and open workspace folders so the operator can explicitly register the repositories they actively use. The registration editor sorts registered projects first and checked, followed by unchecked discoveries; accepting it makes that checked repository set authoritative. Only registered repositories appear in Projects and become eligible for Attention ownership, ticket links, project-scoped sessions, nicknames, and project MR/CI actions. Every action re-resolves the row's stable catalog name against current registration and uses the current canonical path, so a stale path spelling or nested VS Code tree target cannot reject an otherwise registered project. Newly registered projects immediately open a guided integration editor; Setup can reopen it for every registered project. The editor accepts an optional presentation-only nickname plus project-specific read identifiers and URLs, shows credential readiness without credential values, and pre-fills the default monitoring branch from the currently observed Git branch. The nickname is the visible project name across Work, Sessions, Projects, Attention, Jira selection, and new project launches, while the catalog key and canonical path remain stable identities. Blank optional fields clear the nickname or binding. A ticket receives GitLab, Jenkins, and SonarQube project configuration only from its explicit local project link; Jira project keys and legacy project tags are never defaults. Unregistering a linked project requires confirmation and clears affected local launch links without changing Jira namespace metadata. Discovery skips symbolic child directories and dependency trees and reads only directory and Git `HEAD` metadata. Registered projects become available from the prominent **Add Project** or **Change / Unlink Project** control at the top of every Jira card and from the ticket workspace; the current project and explicit unlink choice are ordered first. Jira cards themselves are keyboard-focusable and open with Enter or Space. Each card exposes only **Start Claude** and **Workspace** as repeated workflow actions; terminal management and Jira/MR/CI insertion live in that ticket workspace. Jira completed-work visibility and additional completed status names are mapped settings shared by the Work tree and Jira board. A result becomes stale after the larger of five minutes or two configured Jira refresh intervals. Partial and failed refreshes remain explicit local UI state and never erase the last successful catalog; **Doctor** appears in the status banner only when the current result needs repair.

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

**New Claude** creates a project-oriented session, validates the configured Claude command/permission-mode/name/cwd, creates and focuses one terminal, and starts Claude. From Sessions it uses the configured workspace/home launch choice; from a registered Project it always uses that exact project directory. The created terminal tab includes the branch read from the actual launch directory when Git `HEAD` is available. **Start Claude for Ticket** also includes the initiating ticket key in that title. This is launch-time display metadata only: Kronos does not invoke Git and does not write to or rename an existing terminal. A new project session contains no fake or placeholder ticket key. An operator may later attach one or more real Jira contexts to any explicitly managed terminal; this never creates or submits terminal input automatically. Legacy ticket-keyed records remain readable for migration compatibility, but Sessions and monitoring are presented and deduplicated by project when a project is known.

Stopping management disables monitoring and detaches the in-memory association. It never closes the terminal.

Session lifecycle has three independent axes: management is active or stopped; the terminal relationship is none, attached, detached, or closed; and monitoring is running, paused, ineligible, or stopped. Only a live in-memory VS Code Terminal binding is attached. A persisted attachment after reload is detached until explicit reconnect. A terminal close event records closed terminal history while leaving the Session available for a new explicit reconnect. Stopping management records stopped management and detached terminal metadata because Kronos did not close the operator-owned terminal.

### Projects

Projects is the registered local repository inventory. It is a peer of Sessions rather than a nested session section, because repository state and terminal lifecycle are independent concerns.

Each registered Project shows its current branch and clean, dirty, staged, or conflicted state. Refreshing the view asks VS Code's built-in Git model to load a registered repository when necessary, reads status without loading the full diff, and falls back to bounded local Git `HEAD` metadata for the branch. Selecting the project opens a complete bounded status/diff document. Its inline and expanded **Start Claude in project** actions both carry the canonical registered project target, create a ticket-free standalone Session in that exact directory, and start Claude there; expanding it also exposes secret-redacted Git-context insertion, a live-discovered existing-MR or prefilled new-MR browser action, project-scoped MR/CI evidence insertion without a Jira ticket, and provider setup. MR browser and insertion actions repeat bounded open-MR discovery for the observed branch/project before selecting a target; an older durable binding never silently overrides that live result. The Projects toolbar visibly prioritizes branch/status refresh and management of the registered project set; manual polling and other secondary project actions remain in its overflow menu.

Project setup may store at most 20 explicit branch-routing profiles. Each exact match branch can override the Jenkins job URL, SonarQube project key, and SonarQube provider branch for read-only evidence; one configured profile may be the fallback. An exact observed local or linked-MR source branch wins before that fallback. Branch names and provider identifiers are validated, credential-bearing URLs are rejected, and malformed persisted profiles are omitted at Work-catalog ingress. Profiles belong only to an explicitly registered project. Saving valid provider setup activates bounded project-owned polling immediately; the current local branch supplies ticket-free routing. A profile becomes ticket-visible only through an explicit ticket-project link. Profiles never infer a link from a Jira namespace, select or switch a Git branch, change a worktree, or write to a provider.

When an existing terminal is managed without a ticket, its shell-integration cwd is matched to the most-specific containing registered project when available. The Session stores that canonical project name/root while its terminal attachment retains the actual cwd. Project actions accept either the stable name or canonical folder match and repair older workspace-label associations; provider polling therefore cannot split merely because of a Windows path spelling or a pre-registration Session label.

These actions use VS Code's built-in Git read model and provider REST reads. They never stage, commit, push, create an MR through an API, or otherwise mutate Git or provider state.

### Attention

Attention is the project-aware inbox for changes that merit operator review. Items are grouped only by registered local project. Events without an explicit local project share one clearly labeled **Unassigned project** group rather than fabricating a project from a Jira key or creating ticket/session-level groups. A validated Jira context may remain as a secondary row action, but it never defines provider identity or grouping. A project-owned GitLab/Jenkins/Sonar row may open the matching project MR/CI composer through an explicitly attached project Session without adding Jira identity.

Attention is a current-state projection, not a historical feed. For each project, provider, and subject facet (for example GitLab MR, GitLab pipeline, Jenkins build, or SonarQube gate), only the newest transition is shown. Provider-read health shares the related MR, build, or project/branch facet: a failed or partial read temporarily replaces stale provider truth, while recovery reveals the newest provider result instead of adding a second green row. A later failure, recovery, partial read, build, pipeline, or gate result replaces the older row. When domain events share one provider timestamp, later append order wins; a same-poll failed or partial read remains actionable over bounded domain evidence until a complete read. Acknowledging that newest row clears the stream without resurfacing a superseded event. An open merge request is the deliberate exception: clearing it snoozes it only until the next successful GitLab poll, when one new current-state reminder is recorded. The reminder remains stable until cleared again, and closed or merged MRs do not return. Every transition remains in the append-only session audit.

Visible Attention headlines and notifications describe operator value, delivery impact, and retained evidence rather than internal polling vocabulary. They identify the relevant MR, pipeline, build, branch, test/stage/job count, review requirement, or missing data scope whenever that structured evidence exists. A recovered read says the specific MR/build/quality results are current again; a partial or failed read says which results are missing and that the last known evidence remains visible. Raw transition identifiers remain audit metadata and are never the primary user message. This presentation is derived at render time, so retained historical rows receive the same clear language without rewriting the append-only audit.

That projection uses one canonical stream identity: configured registered-project monitor or legacy fallback Session, provider, logical resource, subject, and facet. A legacy ticket Session and the registered-project monitor that carry the same proven provider-project/resource identity resolve to the registered project before newest-state selection, so one MR cannot appear once under each owner; ambiguous matches are left unassigned rather than guessed. MR IIDs and SonarQube project/branch pairs remain independent logical subjects. Pipeline IDs and Jenkins build numbers are occurrences, so their newest state replaces the older occurrence for the same MR pipeline or configured project job. Provider-read failure, partial, and recovery events resolve to the corresponding GitLab MR, Jenkins build, or SonarQube project/branch stream.

Eligible items include:

- the first successful observation of a merge request, even when its initial state is healthy and mergeable;
- the first completed successful Jenkins build and the first available healthy or unhealthy SonarQube gate;
- merge-request review or pipeline structural changes;
- newly failing or recovered GitLab jobs/tests;
- Jenkins build, stage, or test failures and recoveries;
- SonarQube quality-gate or unresolved-issue changes;
- partial provider reads and monitoring blockers;
- unsafe or unavailable local monitoring state.

A ticket-linked item may open its ticket workspace. Applicable ticket-linked or registered-project items may open a validated provider URL, open the correctly scoped editable composer for fresh MR/CI context, place the reviewed reference into the explicitly attached terminal without submission, or be acknowledged locally. A project-owned notification carries the canonical project name/path to that composer instead of requiring or fabricating a ticket key. An item without a validated provider URL opens that registered project's integration repair UI, or Doctor when it has no project, rather than implying that a dashboard can open. If multiple retained SonarQube branch targets or Jenkins builds are available, opening the provider uses a native latest-first picker; otherwise it opens directly. Choosing a SonarQube branch also makes that branch the project's local monitoring target, records the operator decision, and refreshes read-only polling. SonarQube dashboard URLs may retain only the non-secret `id` and `branch` routing parameters. Acknowledgement never changes provider state.

The first successful merge-request observation and first completed successful Jenkins build create durable informational transitions in Attention; an initially unhealthy MR, Jenkins build, or available SonarQube gate is warning-level. This remains true when Jenkins or SonarQube first becomes available after the other provider already established the combined CI baseline. Their comparison baselines are recorded at the same time. Jenkins `ABORTED`, `CANCELED`, `CANCELLED`, and `UNSTABLE` results and SonarQube warning gates use the same unhealthy classification for both initial observations and later transitions. GitLab pipeline initial observations reuse the same failed/canceled classifier as later pipeline transitions. Unchanged subsequent polling results do not create new Attention items.

## Context Insertion Contract

Context insertion is always explicit and terminal-scoped. Jira evidence remains ticket-scoped. MR and CI evidence may be scoped either to an explicit ticket or directly to a registered project, and the operator may choose any active explicitly managed terminal. A `[GIT-project]` working-tree snapshot is project-scoped and may be inserted into an explicitly attached session for that project. A `[PROMPT-*]` team-prompt snapshot may be opened from Work, Sessions, Projects, or a ticket workspace, but it still requires an active explicitly managed terminal. Creating a Claude session does not silently create ticket context or a ticket association.

1. Kronos resolves the selected ticket and the explicitly managed terminal.
2. It reads the configured provider through bounded read-only APIs.
3. It normalizes and secret-redacts textual and structured provider data.
4. For Jira, it downloads attachment bytes without a file-type allowlist or parser, writes them as private files with sanitized local names, and records their paths and SHA-256 hashes. Raw files are not transformed or secret-redacted.
5. It writes a private, content-addressed JSON artifact and Markdown prompt boundary.
6. It opens an interactive composer with escaped evidence previews, completeness warnings, an immutable artifact reference, an editable operator-focus field, and an explicit **Add to Basket** action for supported Jira, MR, CI, and Git artifacts.
7. It captures the exact session, terminal-binding, and VS Code terminal object selected before the fetch, then re-resolves that same attachment before opening the composer and again before placement. Detachment, close, or rebinding cancels the stale placement rather than guessing.
8. **Place in Terminal** or Ctrl/Cmd+Enter performs one exactly-once shell-quoted reference insertion with terminal execution disabled. Ordinary Enter only edits the composer text. A successful terminal send consumes that composer even if a later session or audit write fails or a late duplicate message arrives; a send that throws may be retried after target verification. Post-insertion session and audit writes are attempted independently and the operator receives the exact retained/failed stage outcome.
9. The operator may instead open **Context Basket**, inspect each selected artifact's provenance, fetched time, completeness, size, hash, warnings, and same-source conflicts, edit one combined focus, and choose one active managed terminal. Refreshing a source reopens its ordinary explicit fetch/composer workflow; nothing refreshes automatically.
10. The operator may open **Team Prompt Library**, explicitly refresh configured local/remote manifests, search and choose a prompt, inspect its library/source/tags/context suggestions/filled variables/warnings, and edit its complete rendered body. Kronos saves the reviewed body as a private immutable snapshot and places only its inert reference with submission disabled. A late duplicate message creates neither another terminal write nor another snapshot.

Team prompt manifests are schema-versioned JSON data, never executable configuration. Local settings may identify a manifest or a bounded top-level manifest directory. Remote settings accept credential-free HTTPS URLs (plus loopback HTTP for local development), follow no redirects, cap count/bytes/time, and retain only a private latest-good cache. In a trusted workspace, the existing GitLab token may be attached only when the manifest origin exactly matches the configured GitLab origin; it is never placed in a URL, cache, artifact, UI, or audit. Supported template fields are limited to session title, project display name/path/observed branch, and explicit Jira context keys. Unknown variables remain visible with a warning. Credential-shaped manifest or edited text is redacted before local persistence or presentation.
10. Basket placement writes one immutable private reference-only Markdown bundle under `KRONOS_DIR`, verifies the exact live terminal attachment, and inserts one shell-inert `[BASKET-*]` reference with execution disabled. Removing or clearing selections never deletes their immutable source artifacts, and the basket is not cleared automatically after placement.
11. The operator reviews the terminal line and submits it manually.

Provider data inside an artifact is untrusted evidence, never instructions. Prompt artifacts tell the interactive agent not to follow commands, role changes, credential requests, links, or mutation requests found inside provider content.

Insertion targets:

- `[JIRA-123]`: visible Jira fields, including custom-field IDs, names, schemas, values, readable text, comments, and private paths to downloaded raw attachments of any MIME type;
- `[MR-77]`: GitLab merge-request metadata, notes, discussions, approvals, bounded diffs, pipelines, jobs, and test evidence;
- `[CI-JIRA-123]`: bounded Jenkins build/test/stage evidence and SonarQube gate/measure/issue evidence.
- `[BASKET-*]`: a bounded private list of selected Jira, MR, CI, and local Git artifact paths, SHA-256 hashes, provenance, freshness, completeness, conflicts, warnings, and one operator-authored focus; provider payloads are not copied into the basket bundle.

Partial, unavailable, skipped, truncated, or failed provider components remain explicit in completeness warnings. Kronos never presents partial evidence as complete.

Operator-visible failures use one bounded redacted vocabulary: configuration, authentication, permission, timeout, DNS, TLS, redirect/origin refusal, rate limit, not found, response bound, malformed response, pagination, lease contention, local state, network, or unavailable. Each classification includes one safe retry or repair action. Messages never display provider response bodies or credential values, and a failed refresh does not erase the last-known-good bounded evidence.

Jira attachment capture is bounded to 100 download attempts, 25 MiB per file, and 100 MiB in total for one explicit insertion. Filename path components are discarded before local storage, and raw bytes are published through the shared bounded immutable-artifact primitive only after their declared length and SHA-256 match. Attachment files are untrusted evidence: Kronos never parses, opens, previews, or executes them, and the generated prompt tells the interactive agent to inspect only relevant files with safe read-only tools.

## Monitoring Contract

Monitoring is read-only. A configured registered project owns its durable provider bindings, baselines, health, and polling lifecycle independently of Jira tickets and terminal Sessions. A new standalone Session begins with no Jira identity; creating, closing, or removing it does not start, stop, or own registered-project polling. Legacy provider-bound ticket Sessions remain a compatibility fallback only when no configured registered project owns that target.

- The default interval is configured by `kronos.managedProviderPollIntervalSec`.
- The operator can pause, resume, or poll a session immediately.
- A private cross-window lease prevents duplicate concurrent polling against one Kronos data directory. POSIX uses `O_NOFOLLOW`; Windows, where that flag is unsupported, uses exclusive creation and lstat/fstat identity verification around every lease read, write, renewal, and unlink.
- The lease and mutable MR/pipeline/CI snapshots share the same platform boundary: POSIX requires `O_NOFOLLOW`; Windows uses path/descriptor identity checks; reads must match one bounded regular-file identity from open through completion; writes use a fully synced exclusive temporary file and same-directory atomic replacement.
- Monitoring baselines contain bounded normalized digests, not full provider responses.
- `work.json` remains the local Work catalog and records the latest bounded MR and Jenkins build projection observed by monitoring. It is capped at 32 MiB and uses the shared private-directory, bounded-read, and atomic-write primitives; an oversized existing regular file can be recovered by a valid bounded replacement, while symbolic-link paths remain rejected. Jira refreshes preserve provider projections until newer evidence arrives. A newer binding wins stale MR identity, and a digest is used only when its MR IID matches that identity.
- GitLab target selection has one precedence rule across polling, status, and context insertion: the newest valid durable session binding owns MR identity; explicit local-project configuration supplies the provider project when the binding does not; origin-pinned URLs are fallback evidence only; and the Work catalog is considered only when no valid binding exists.
- Work catalog schema v2 stores Jira namespace metadata separately from the sole explicit `linked_local_project`. Schema-v1 `launch_project` values migrate at the read boundary; legacy project-tag arrays never become repository links.
- Incomplete provider components do not erase the last complete component or create false recovery events.
- Losing lease ownership stops persistence and prevents the next provider request from starting.
- Provider errors affect readiness and Attention; they do not trigger remediation.
- A configured Jenkins job permits a bounded, best-effort read of that job's `/config.xml`. When SonarQube has no explicit project binding, literal `sonar.projectKey` and optional literal `sonar.branch.name` values may establish the read-only SonarQube target for the same poll. Raw XML is never persisted, expression-valued properties are ignored, and the request remains pinned to the configured Jenkins origin.
- Jenkins multibranch parents are detected from their provider class and resolved to the configured branch job before build evidence is read. Missing JUnit and Pipeline-stage endpoints are normal unavailable evidence, not a failed provider read. A Jenkins-only TLS verification override may be explicitly configured for a locally trusted corporate endpoint without affecting other providers.

Monitoring can observe GitLab, Jenkins, and SonarQube. Jira remains explicitly refreshed from Work rather than continuously monitored as terminal content.

Saving project integration data requests an immediate bounded provider poll in addition to the interval. Activation, Poll Now, Jira refresh, and relevant legacy Session changes may also request a coalesced poll. Provider polling configuration comes from the registered project's own GitLab, Jenkins, SonarQube, and branch-profile setup; no ticket link or terminal Session is required. Project polling searches open MRs by the observed current source branch when no MR is known and whenever that branch moves away from the currently bound MR; a finished bound MR also returns to discovery. When a poll first observes that the bound MR finished, it performs at most one immediate follow-up discovery so a unique replacement can appear in the same poll. If branch discovery has no match and there is no Jira context, the project's sole open MR may be selected. Ticket-backed legacy fallback may search by Jira key in title/description. A different discovered IID receives its own first-observation baseline and Attention stream. Exactly one match is bound locally; ambiguous results are reported and never guessed. When a different branch has no MR yet, an existing open MR remains monitored until a unique replacement appears. Explicit ticket-project links only project current provider facts onto that ticket and never create polling authority. Project MR and CI insertion controls work with an operator-owned project Session without adding a Jira context; all insertion controls fetch reviewed evidence only and are not provider-connect controls.

## Audit and Local State

By default, private terminal-first state lives under `~/.kronos`, or the explicitly configured `KRONOS_DIR`.

**Search Local Sessions and Evidence** builds a fresh in-memory index each time it opens. The index is capped at 2,000 separately budgeted metadata entries across registered projects/branches, sessions, explicit ticket contexts, provider bindings, saved artifact labels, and the newest audit-event summaries. It is never written to disk, includes no artifact payload or provider response body, and cannot accept terminal bindings, input, output, or scrollback as a source. Selecting a result performs only its existing bounded action: focus/reconnect a managed terminal, open a ticket workspace, read project Git evidence, open a private artifact, open a validated provider URL, or open the local session audit.

**Create Private Local Handoff** starts from one explicitly selected work session. The operator chooses up to 100 saved context and audit references from capped local candidates, supplies a bounded title/note, and receives one immutable private Markdown/JSON pair under `KRONOS_DIR`. Context entries retain artifact path, completeness, warnings, and SHA-256; audit entries retain normalized event identity, time, source/type, summary, subject, and a canonical SHA-256. Credential-shaped text is redacted before publication. The bundle never copies provider payloads, attachment bytes, terminal content, or scrollback, and creation performs no provider request or mutation. The local audit records only the bundle reference/hash and selection count.

The canonical owner, ingress, compatibility, and consumer for every record are listed in [State Ownership and Data Flow](state-ownership.md). Provider request, bound, normalization, completeness, and error behavior are listed in the [Provider Read Contract Matrix](provider-contract-matrix.md).

Collection ceilings, local render/read timing gates, superseding Jira refresh behavior, and the automated versus human accessibility boundary are listed in [Scale, Responsiveness, and Accessibility Budget](scale-accessibility-budget.md).

The one-time migration from the legacy default directory rejects symbolic-link ancestors and unsupported entries, caps traversal at 20,000 entries and 2 GiB, and recursively applies private file and directory modes before the migrated state is accepted.

- work-session records contain an operator-facing title, optional real ticket identity, terminal metadata, provider bindings, context references, and monitoring readiness; each record is capped at 4 MiB and uses the shared cross-platform private atomic file primitive;
- context directories contain normalized content-addressed provider artifacts and prompt boundaries; immutable artifacts use bounded byte verification and exclusive no-replace publication through the shared cross-platform private-file layer;
- prompt-library cache directories contain only bounded latest-good remote manifests, while prompt-library context directories contain the exact reviewed redacted body and provenance in a private immutable JSON/Markdown pair;
- compact monitor snapshots contain the latest comparison baseline;
- the append-only monitor-event ledger records session, context, transition, notification, acknowledgement, and operator-decision events; each JSONL record is capped at 16 KiB, each UI read uses a bounded complete-line tail window, and append/tail operations share the cross-platform path/descriptor identity layer.

The audit may include provider summaries, timestamps, completeness warnings, hashes, and private artifact paths. It never contains terminal input, terminal output, scrollback, provider credentials, authorization headers, cookies, raw job traces, or Jenkins console logs.

Kronos does not publish audit content externally. Opening an audit is a local read.

## Provider and Credential Boundary

Provider credentials are inherited from approved local configuration. They are never inserted into the terminal or persisted in work-session, context, snapshot, or audit records.

Credentialed requests are constrained to configured provider origins. Redirects and provider-returned URLs do not silently move credentials to another host. Response sizes, pagination, item counts, text sizes, and request timeouts are bounded.

Setup is the dedicated guided dashboard for Claude launch, project discovery and registration, Jira work, optional monitoring providers, the Team Prompt Library, and private state. Doctor is a dedicated status dashboard that places blocked and warning checks first. Setup, Doctor, Projects, and project integration consume one canonical secret-free provider-readiness model; Setup and Doctor render the same readiness snapshot. Automatic-polling readiness counts each available configured registered project directly and reports legacy ticket Sessions only as fallback owners; it never claims that a Jira context or terminal Session is required to activate project polling. Setup retains bounded configuration/navigation actions on their owning cards but omits redundant buttons from healthy provider-status cards; Doctor shows repair actions only on non-ready rows and routes discovery-folder repair back through Setup. Missing, present, and invalid-needs-test credential states are labels only—values are never rendered. The explicit private-config action opens the configured environment file and creates a private comment-only template when it is absent; immediately after creation Kronos warns that saved provider values require a VS Code window reload before Doctor rechecks them. The explicit Poll Now action performs only bounded provider reads. Both dashboards refresh in place and show the same native private-state/provider-file paths and reload requirements. Guided Settings returns to Setup; advanced VS Code Settings remain available from the relevant Setup rows and expose supported Claude command/permission-mode/name/cwd behavior, polling configuration, and local/remote prompt manifest arrays. Doctor names the active Claude permission mode, warns for Auto, and warns when experimental bypass is enabled. Provider credentials remain in the private environment-file path described by Setup, and no settings surface can authorize a generic shell command.

## Runtime Dependency Boundary

The installed extension has zero third-party runtime dependencies. Kronos uses the VS Code API and Node built-ins; it does not bundle an agent SDK, shell library, or helper CLI. The operator-installed Claude executable is external to Kronos and is reached only through the explicit, validated VS Code terminal-launch path.

## Command Surface

`terminalFirstCommandRouter.ts` is the sole runtime inventory for these command IDs and groups every route by Work, terminal, context, Session, Project, Attention, or operations responsibility. Activation supplies behavior callbacks through one audited VS Code registrar. The manifest, pure route inventory, and activation harness must agree exactly before packaging.

The public terminal-first command surface is intentionally limited to:

- Work: refresh the Jira board; search/filter/show completed/clear filters; open ticket workspace; start Claude for the selected ticket; manage a focused terminal; insert Jira/MR/CI context; open the Team Prompt Library; open the Context Basket;
- Sessions: create a project-oriented Claude session; add another Jira context; open the Team Prompt Library; poll providers; search local session/evidence metadata; create a private local handoff; open audit; focus/reattach/detach terminal; stop or remove local management; pause/resume monitoring;
- Projects: refresh registered branch/status; manage discovery and registration; start a ticket-free Claude session in the exact project directory; view bounded status/diff; insert project Git/MR/CI evidence; open the Team Prompt Library; open an existing or prefilled new MR page; configure project providers and explicit branch profiles; create a private local handoff; open the Context Basket;
- Attention: acknowledge item and open provider;
- Operations: search local session/evidence metadata from every view; open the Team Prompt Library or Context Basket from Work, Sessions, or Projects; Setup, Doctor, and Settings.

No command outside this inventory is part of the terminal-first product contract. In particular, there is no generic terminal-command runner.

Visible view-title actions follow one checked hierarchy. Work shows Refresh Jira, Jira Board, and Filter. Sessions shows New Claude and Manage Focused Terminal. Projects shows Refresh Projects and Manage Registered Projects. Attention shows Poll Now. Clear-filter, Context Basket, local search, handoff, and secondary polling remain in the relevant view overflow menus. Setup is available from Work overflow and the command palette; Doctor and advanced settings are reached from Setup or the command palette rather than repeated in every view header.

The automated product-surface contract must exercise this hierarchy together with canonical Setup/project ownership, ticket-free Project launch, project-only Attention grouping, provider glyph/state-color semantics, rich Jira search/filter namespaces, ticket-workspace action ownership, and healthy Doctor behavior. These cross-view contracts run inside the same `npm test` gate as the lower-level state, provider, terminal, security, DOM, scale, and release-surface suites. Synthetic tests do not replace the explicit real-VS-Code, operator-terminal, Windows, multi-window, or live-provider gates.

## Canonical Operator Journey

Ticket-linked journey:

1. In Work, the operator searches or filters the Jira board, selects a ticket, and opens its workspace.
2. The operator chooses `Start Claude for Ticket`, or focuses an existing terminal and chooses `Manage Focused Terminal`.
3. On explicit start, Kronos validates the configured Claude command/permission-mode/name/cwd, obtains the per-launch modal confirmation when experimental bypass is selected, creates and focuses one VS Code terminal, and executes only the resulting validated command.
4. The operator chooses `Insert [JIRA-123]`.
5. Kronos opens the context composer with the fixed private artifact reference, fetched evidence, and an editable operator-focus field.
6. The operator places the line into the terminal, reviews and submits it manually, then directs the work interactively.
7. Kronos monitors linked MR and CI providers without reading the terminal.
8. Meaningful changes appear in Attention and can produce fresh explicit MR/CI insertion actions.
9. The operator uses the work-session audit to inspect provenance and evidence.
10. The operator stops management when finished; the terminal remains open.

Standalone journey:

1. In Sessions, the operator chooses `New Claude`, or chooses `Start Claude in project` on a registered Project; Kronos derives a standalone title from that explicit project, the open workspace, or the launch time when neither is available.
2. Kronos validates the configured Claude command/permission-mode/name/cwd, obtains the per-launch modal confirmation when experimental bypass is selected, creates and focuses one terminal, and executes the Claude command exactly once.
3. Sessions records a standalone session without a ticket key.
4. The operator owns and directs the conversation normally.
5. Stopping management leaves the terminal and Claude process alone.

## Failure Behavior

Kronos fails closed at ownership and credential boundaries:

- no focused or explicitly attached terminal means no insertion;
- an invalid Claude command, permission mode, name, or cwd fails before terminal creation;
- canceling the experimental bypass warning or choosing Claude Settings creates no session, terminal, or launch cooldown;
- a launch request whose executable is not `claude` or `claude-*` is rejected rather than treated as a generic shell command;
- no explicit start action means no terminal or process launch;
- a changed terminal binding cancels insertion;
- missing credentials or provider failures produce partial/blocked state, not fabricated evidence;
- an unsafe local path or lease prevents polling or persistence;
- a failed provider read does not start a mutation or remediation path;
- stopping or pausing monitoring never affects the terminal process.

Every failed or partial operation tells the operator whether the provider read, local artifact write, normalized or monitoring snapshot, terminal insertion, session update, and audit append succeeded, failed, remained partial, was skipped, or was not attempted, so retrying cannot be mistaken for a clean first attempt.
