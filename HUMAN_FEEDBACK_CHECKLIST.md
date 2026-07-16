# Kronos Terminal-First Human Feedback Checklist

Use this checklist for a 20-to-30-minute hands-on evaluation of the Jira board, standalone sessions, explicit Claude launch, and operator-owned terminal workflow.

## Non-Negotiable Boundary

During this review, Kronos may read provider data, explicitly create/focus a VS Code terminal and execute a validated Claude command, insert a non-submitting context reference, monitor provider status, and write a private local audit record.

Kronos must never:

- launch automatically, on reload, during refresh/polling, or without **New Claude** / **Start Claude for Ticket**;
- execute an arbitrary program, positional Claude subcommand, or project command; only a validated `claude` or `claude-*` executable with approved interactive flags and the typed permission-mode setting is allowed;
- read terminal input, output, or scrollback;
- press Enter or submit inserted provider-context text;
- run a project test, build, scan, deployment, or remediation command;
- create, switch, commit, push, merge, or otherwise change Git;
- mutate Jira, GitLab, Jenkins, SonarQube, or a database;
- close the operator's terminal when management stops.

Stop the review immediately if any boundary is crossed.

## Setup

1. Run `npm test` and `npm run package` from the Kronos repository. Confirm the focused product-surface contracts pass alongside the state, provider, terminal, security, DOM, scale, and exact-package gates.
2. Install with `code --install-extension kronos-0.1.0.vsix --force`.
3. Reload VS Code.
4. Open the Kronos activity icon.
5. Confirm exactly four views are visible: **Work**, **Sessions**, **Projects**, and **Attention**, with no nested Projects section inside Sessions.
6. Run **Kronos: Setup** and confirm its dedicated dashboard clearly groups Claude launch, discovery folders, registered projects, Jira, monitoring providers, Team Prompt Library, and private state without exposing secrets. Confirm its runtime guide shows the correct native private-state and provider-environment paths plus precise reload behavior. If **Open Private Config** creates the file, confirm Kronos immediately warns that saved values require **Developer: Reload Window** before the extension host and Doctor can see them. Exercise its Doctor, Jira Board, prompt/settings, discovery-folder, Projects, and Sessions actions; confirm these configuration/navigation actions are not repeated as primary buttons in every view header.
7. Run **Kronos: Doctor** and confirm its dedicated dashboard shows ready/review/blocked totals, places actionable problems first, refreshes in place, and reports Jira/provider/Claude readiness without displaying credential values.
8. Open **Kronos: Guided Settings** and confirm it returns to the existing Setup dashboard rather than opening a competing configuration flow. From the relevant Setup rows open Claude or visibility settings, identify the Claude command, permission mode, terminal-name, cwd behavior, and polling options, then return to Setup. Confirm permission mode offers Manual/default, Accept Edits, Plan, Auto, Don't Ask, and experimental Bypass Permissions with clear descriptions. Keep the command at `claude` or a trusted `claude-*` wrapper with only approved interactive flags for the launch tests; raw permission flags do not belong in the command. Provider credentials remain in the private environment-file path shown by Setup.

For a safe synthetic local state, use:

```bash
npm run feedback:state
KRONOS_DIR="$PWD/.kronos/feedback-state" code .
```

On Windows PowerShell:

```powershell
npm run feedback:state
$env:KRONOS_DIR = "$PWD\.kronos\feedback-state"
code .
```

The synthetic state includes one detached ticket session, one detached standalone session, retained MR/Jenkins/Sonar targets, and several Attention transitions. Polling is paused, every provider URL uses the reserved `.invalid` domain, and no terminal is started. Use these rows to review grouping, target pickers, and newest-state replacement before creating your own live terminal sessions. Do not resume this fixture's monitoring unless you specifically want to exercise unavailable-provider behavior.

Use a real ticket only when its provider data is approved for local context capture. The fixture is synthetic and must not be used to post or mutate provider state.

## Jira Work Board

1. Refresh Jira tickets.
2. Confirm completed stories are hidden by default.
3. Clear **Hide completed**, confirm completed rows appear, then enable it again and confirm they disappear.
4. Search by part of a ticket key or summary, then by an update date, attachment filename/type, MR IID/author/branch, and build number/status. Confirm Work and the Jira board find the same ticket evidence and only matching rows remain.
5. Apply status, Jira project, local project, and label filters individually and in combination. Confirm Jira namespaces never satisfy the local-project filter (or the reverse), and each result and empty-result state is understandable.
6. Clear the filters and confirm the board returns to its default non-completed view.
7. Open one ticket workspace and confirm the title, summary, description, status, provider links, and known completeness warnings are easy to find.
8. Inspect a ticket with sparse standard/custom fields. Confirm `null`, blank text, empty arrays/objects, and recursively empty rich text are absent while meaningful `false` and `0` values remain.
9. Confirm the visible actions are limited to the explicit Claude launch, terminal attach, read, insert, monitor, and audit workflow.

## Local Projects and Branches

1. From **Kronos Setup**, choose **Choose Folders**, select two safe parent folders such as `IdeaProjects` in one native dialog, and confirm **Manage Registered Projects** opens immediately. Confirm the parent folders are discovery roots only: repositories found inside them remain unchecked until explicitly registered. Confirm Work does not repeat this discovery button and Projects has one **Manage Registered Projects** entry point.
2. Confirm registered projects are checked at the top, newly discovered projects are unchecked below them, deeper/out-of-limit folders do not appear, and accepting the picker makes the checked state authoritative. Uncheck one unlinked project and confirm it is unregistered.
3. Confirm newly registered projects open **Project Integration Setup**. Give one project a nickname, enter a GitLab numeric ID or `group/project` path, Jenkins job URL, SonarQube project key, and default branch; confirm credential readiness is shown without any secret values. Leave an optional field blank and confirm it can be cleared.
4. Reopen **Configure Project Integrations** from Setup and confirm the saved values appear for all registered projects and the observed Git branch was the initial default.

- Before linking any Jira ticket or opening any terminal Session, use **Poll Managed Providers**. Confirm the configured project shows an active/latest poll in Projects, GitLab/Jenkins/SonarQube reads occur for that project, and resulting Attention items are grouped under the project. Open an MR for the current branch, poll, then switch the same repository to a second ticket branch and open another MR without linking either Jira ticket; confirm the next poll discovers the second IID and gives it its own project-owned Attention row. Reload VS Code and confirm polling resumes from the same private project owner without creating a Session row or fake Jira identity.

5. Confirm the Jira board shows the project name, absolute path, and the branch currently named by Git `HEAD`.
6. Use **Add Project** in the top row of two Jira cards, attach projects from the selected roots, and confirm the control changes to the project name while each ticket workspace and Work row show the right branch and launch directory.
7. Load at least two tickets with the same Jira namespace, such as `ABC-123` and `ABC-124`, while four repositories are registered under one discovery root. Confirm none is linked by default; link each ticket explicitly to a different repository and confirm Jira refresh preserves only those choices.
8. Switch branches yourself in the terminal, refresh or reopen the board, and confirm Kronos reflects the new branch without running a Git command.
9. Start Claude for the linked ticket and confirm its new terminal starts in the selected project directory and its terminal tab shows both the ticket key and current Git branch, such as `Claude · JIRA-123 @ feature/name`.
10. Choose **Manage Focused Terminal** on an existing terminal and confirm linking does not change that terminal's directory or send `cd`.
11. Poll the linked ticket and confirm only its explicitly selected local project's GitLab/Jenkins/SonarQube identifiers are used. Then unlink the local project and confirm future launches use workspace/home fallback and no registered repository is inferred from the Jira key.
12. Open the separate **Projects** view. Confirm every registered project shows its current branch and clean/dirty status, including staged or conflicted detail when present. Use its refresh action after switching branches, then open status/diff and verify the repository is unchanged.
13. Choose the inline or expanded **Start Claude in project** action. Confirm exactly one terminal opens in that registered directory, its title shows the current branch, and the new Session has the project identity but no Jira ticket or context.
14. In an existing terminal whose current directory is a subfolder of that project, choose **Manage Focused Terminal** without a ticket. Confirm the standalone Session uses the registered project nickname/name and root while preserving the terminal's actual subfolder as attachment detail. Confirm project context actions find that terminal without asking for Jira.
15. Use **Set project nickname**, **Insert MR evidence**, and the other Project-row actions on a registered Project after refreshing or changing its discovery-root path spelling. Confirm every action re-resolves the registered project instead of showing **Select a currently registered project**. Merge the previously bound MR, open another MR for the current branch, then use **Insert MR evidence** without polling first; confirm the composer uses the new IID rather than the merged saved binding. With a project-only Session focused, confirm MR and Jenkins/Sonar evidence open the editable composer and insert without adding Jira context. Confirm the nickname appears in Projects, Work, the Jira board, project setup, local search, Sessions, and Attention while its stable identity, canonical path, linked tickets/sessions, provider configuration, and Git state remain unchanged. Clear it and confirm every surface falls back to the stable project name.
16. Insert the project's `[GIT-project]` context into its explicitly attached session. Confirm the composer previews changed paths, potential credential material is redacted from the private artifact, and the terminal line is not submitted.
17. Use **Open merge request page**. Confirm bounded live discovery opens the current branch's existing MR rather than an older merged binding; when no open MR is found, confirm a prefilled GitLab new-MR browser page opens and no MR is created until you act in GitLab. If discovery is ambiguous, confirm Kronos refuses to guess.
18. In **Project Integration Setup**, add two explicit branch-profile lines using `branch | Jenkins URL | SonarQube key | SonarQube branch`, choose one optional active fallback, save, and reopen the form. Confirm both profiles and the active choice round-trip exactly.
19. Link a ticket whose known MR source branch exactly matches the second profile, poll once, and confirm Jenkins uses that profile's job/branch while SonarQube uses its project key/provider branch. Use a ticket without a matching MR profile and confirm only the explicit active fallback is used.
20. Enter a duplicate branch, unsafe branch, credential-bearing URL, or active name not present in the profile list. Confirm save is refused with a bounded repair message and the prior valid setup remains unchanged.
20. Confirm saving or selecting a profile never switches the repository branch, changes a worktree, invents a ticket-project link, or sends a provider write.

## Start Claude for a Ticket

1. Count the open terminals, then choose **Start Claude for Ticket** from the selected ticket.
2. Confirm exactly one terminal is created and focused, its title contains the current branch when the launch directory is a Git project, and the configured `claude`/`claude-*` command is executed exactly once.
3. Confirm no Jira context is submitted automatically and Kronos does not read or summarize Claude's output.
4. In Sessions, confirm the new session shows the real ticket key and title.
5. Choose **Insert `[TICKET-KEY]`** and confirm no terminal text is written while the provider read is in progress or when the composer first opens.
6. Confirm the composer shows an escaped preview of the ticket description, recent comments, warnings, and a fixed artifact reference. Edit **Operator focus** with normal Enter/newlines and confirm nothing is inserted yet.
7. Choose **Place in Terminal** or press Ctrl/Cmd+Enter in the composer. Confirm exactly one shell-quoted reference is inserted, Enter is not pressed, and the terminal remains fully interactive and operator-controlled.
8. Inspect the referenced Jira artifact. Confirm meaningful custom-field names and values, comments, attachment download/skip reasons, provenance, pruning, and partial-completeness warnings are understandable. Include a `.msg` or other binary fixture and an uncommon file type; confirm both are stored byte-for-byte as private files, referenced by sanitized paths and hashes, and never embedded, parsed, previewed, or executed by Kronos.
9. Review the inserted line and decide yourself whether to press Enter in the terminal.

To verify the existing-terminal path as well:

10. Start or focus a separate terminal you control and choose **Manage Focused Terminal** from a ticket.
11. Confirm Kronos associates the focused terminal but does not create a terminal, launch Claude, or write anything yet.

If GitLab and CI providers are safely configured:

12. Insert the linked `[MR-N]` context and confirm the composer includes recent notes/discussions plus explicit review, pipeline, job, and test completeness.
13. Insert `[CI-TICKET-KEY]` and confirm Jenkins and SonarQube evidence clearly says which provider portions were fetched, partial, or unavailable.

## Team Prompt Library

1. Create a safe local schema-v1 manifest with two prompts and configure its file or parent directory in `kronos.promptLibraryLocalPaths`. Configure a raw HTTPS manifest from a disposable Git branch in `kronos.promptLibraryRemoteManifestUrls`; do not put a token in the URL.
2. Open **Team Prompt Library** from a ticket workspace, Session, and registered Project. Confirm it always targets an already managed terminal and never creates a terminal, launches Claude, requires a Jira ticket for the Project path, or writes anything while the picker/editor opens.
3. Search by title, library, description, tag, and suggested context. Choose a prompt using `{{session.title}}`, `{{project.name}}`, `{{project.path}}`, `{{project.branch}}`, `{{jira.key}}`, `{{jira.keys}}`, and one unknown variable. Confirm allowlisted values are filled from the selected Session, the unknown variable stays visible with a warning, and no Jira key is invented for a ticket-free Project Session.
4. Confirm the editor shows the complete prompt, source provenance, tags, suggested context, filled variables, and warnings. Edit it with normal Enter/newlines; confirm nothing reaches the terminal until **Place in Terminal** or Ctrl/Cmd+Enter.
5. Place once and confirm exactly one `[PROMPT-*]` reference is inserted into the intended terminal with Enter not pressed. Inspect the referenced private Markdown/JSON pair and confirm it contains the reviewed redacted body and source revision, not terminal contents or provider credentials. Re-trigger the webview action if practical and confirm no duplicate snapshot or terminal write appears.
6. Make the remote URL temporarily unavailable and reopen the library. Confirm Kronos labels its bounded warning and offers the private latest-good copy. Restore it with a changed valid manifest and confirm the next explicit open shows the new revision. Confirm no redirect is followed and no remote manifest can launch Claude, execute a command, change Git, or submit terminal input.

## Context Basket

1. From Jira, MR, CI, and local Git composers, choose **Add to Basket** for at least two sources. Confirm adding does not write to or submit terminal input.
2. Open **Context Basket** from Work, Sessions, or Projects. Confirm each row shows its source, provenance, fetched time, completeness, size, short hash, warnings, and any same-source/different-content conflict.
3. Choose **Refresh Source…**. Confirm Kronos opens the normal explicit source fetch/composer and does not replace the selection until you choose **Add to Basket** on the refreshed artifact.
4. Remove one selection and confirm its referenced private artifact still exists. Clear the basket and confirm the modal explains that source artifacts are retained.
5. Re-add multiple sources, edit the combined focus with ordinary Enter/newlines, choose **Place Basket in Terminal**, and select an active managed session. Confirm exactly one `[BASKET-*]` line appears in the intended terminal and Enter is not pressed.
6. Inspect the basket Markdown. Confirm it contains references, hashes, provenance, completeness, conflicts, warnings, and the operator focus, but does not copy Jira descriptions, comments, diffs, job output, or other provider payloads.
7. Confirm placement leaves the basket selected for reuse and the audit records the bundle without terminal input, output, or scrollback.

## Sessions View

1. Choose **New Claude** and confirm exactly one new terminal is created and focused without asking for a Jira ticket.
2. Confirm the configured Claude command is executed exactly once and the session appears using its workspace-derived standalone title with no fake ticket key or ticket link.
3. In a disposable isolated workspace, set Claude Permission Mode to experimental Bypass Permissions. Choose **New Claude**, confirm the modal explains that prompts will be skipped and offers **Launch Without Permission Prompts**, **Open Claude Settings**, and cancel. Cancel once and choose Settings once; both paths must create no terminal or Session. Confirm once and verify exactly one terminal starts with `claude --dangerously-skip-permissions`, then restore Manual/default before continuing.
4. Confirm the project session shows its real Jira context(s), attached terminal state, provider bindings, monitoring state, last attempt, latest result, and audited launch permission mode without showing terminal content.
5. Select each attached Session and confirm its correct terminal opens immediately.
6. Reload VS Code, select a detached Session, and confirm Kronos reconnects the sole unclaimed terminal or asks which open terminal belongs to the Session before opening it.
7. Detach the standalone terminal and confirm it remains open and Claude remains operator-controlled.
8. Try the Session pause/resume action for a configured registered project and confirm Kronos explains that polling belongs to the project and remains automatic; the Session setting must not stop project polling.
9. Run **Poll Managed Providers** once and confirm the Project, not the Session, receives the latest provider health.
10. Open the ticket workspace and confirm GitLab, Jenkins, and SonarQube each show active, discovering, paused, or setup state. Confirm GitLab discovers a unique open MR by current branch/ticket key without a manual connect prompt and refuses an ambiguous fixture.
11. Open each available work-session audit. Confirm it uses the standalone title or real ticket identity as appropriate and contains no terminal transcript.
12. Stop managing one session and confirm its terminal remains open and usable. Remove an old session, confirm the terminal still remains open, and confirm the removed row no longer appears while retained context/audit files remain local.
13. After two unchanged polls, inspect the Project. Confirm it shows the latest attempt, last successful poll, last meaningful change, next scheduled poll, normalized current error, and increasing quiet/suppressed count without adding Attention rows. The Session may show legacy history, but it must not claim ownership of configured-project polling.

## Local Evidence Search

1. Choose **Search Local Sessions and Evidence** from each Kronos view toolbar and type portions of a session title, Jira key, registered project, current branch, provider subject, artifact label, and recent audit summary. Confirm each expected row is discoverable through label, description, or detail matching.
2. Select one result of each kind. Confirm Session focuses/reconnects its terminal, Jira opens its workspace or retained session audit, Project opens bounded read-only Git evidence, Provider opens only a validated URL or audit, Artifact opens its private file, and Event opens its session audit.
3. Include a terminal with distinctive visible text that appears nowhere in Kronos metadata. Confirm searching that text returns no result and Kronos does not read or index terminal input, output, or scrollback.
4. Change a session title or create a new local event, reopen search, and confirm the rebuilt Quick Pick reflects current state without a separate indexing task or persistent search file.

## Private Local Handoff

1. From Sessions or Projects choose **Create Private Local Handoff**, select one work session, then select a mix of saved context and audit references. Confirm context references are preselected, audit events remain explicit choices, and the picker refuses more than 100 selections.
2. Enter a title and optional next-step note. Include a safe credential-shaped fixture and confirm the saved bundle redacts it.
3. Confirm Kronos opens one private `handoff.md` beside `handoff.json`, and both contain session/project/Jira provenance, selected context paths/completeness/warnings/hashes, selected audit identities/summaries/hashes, and the operator note.
4. Confirm the pair does not contain source artifact payloads, attachment bytes, terminal names/content/scrollback, credentials, or provider response bodies.
5. Confirm creating the handoff performs no Jira/GitLab/Jenkins/SonarQube request or write, does not change Git, and records only the private bundle reference/hash/count in the local audit.

## Launch Validation and Operations

1. In Settings, temporarily change the Claude executable to a harmless but disallowed command such as `echo`.
2. Choose **New Claude** and confirm Kronos rejects the setting before creating a terminal or executing anything.
3. Restore a trusted `claude` or `claude-*` executable. If the selected ticket has a configured project path, test once with a safely invalid fixture path and confirm launch fails before terminal creation.
4. Restore a valid project path or choose workspace/home cwd behavior. Confirm Doctor reports the repaired general launch settings.
5. Confirm Setup, Doctor, and Settings never print provider tokens, environment secrets, or credential values.

## Attention View

1. Let Kronos discover an MR and a completed successful Jenkins build with no prior local baseline. Confirm each first successful observation appears once; a healthy mergeable MR and successful Jenkins build should be informational, while an MR already needing review or an unhealthy Jenkins build should be a warning. Then make Jenkins available only after SonarQube established the CI baseline, and repeat with SonarQube joining a Jenkins-only baseline; confirm the newly available provider still contributes exactly one first healthy result.
2. Confirm provider failures, recoveries, partial reads, and monitoring blockers are grouped only by registered local project. Work without an explicit project must share one **Unassigned project** group; no Jira key or session may become a top-level group. Confirm a validated Jira context remains only as an optional row action. Confirm GitLab MR rows use a pull-request icon, Jenkins rows use a server-process icon, and SonarQube rows use a shield icon. For each provider, confirm healthy/recovered rows are green, warning/partial rows are yellow, and failed/blocked rows are red. A GitLab, Jenkins, or SonarQube read failure/partial result must replace its related MR/build/branch row rather than appearing beside it; after recovery, the provider result must return without a second green recovery row. Confirm the headline states the delivery impact in user language—such as **Pipeline 412 is passing again**, **MR !78 has requested changes**, or **review data is incomplete: approvals, review discussions**—and never exposes `provider recovered`, `provider reads recovered`, or underscore-separated transition IDs. Confirm each row also writes out project, provider, subject, severity, observed time, last changed time, and why it needs attention so meaning never depends on color alone.
3. Open an attention item's provider page and confirm it points to the expected configured provider. For a SonarQube item, confirm its dashboard link keeps the expected project and branch routing. If the session retains multiple SonarQube branches or Jenkins builds, confirm a native latest-first picker shows saved times and opens the selected target; a selected SonarQube branch should become the project's monitored branch.
4. For a ticket-linked item, open the related ticket workspace. Confirm a standalone item does not fabricate that action or a ticket key.
5. Insert fresh MR or CI context from the item when applicable; confirm an editable composer opens first, then the reference goes only to the explicitly attached terminal and is not submitted.
6. Clear the item and confirm the audit remains available. Confirm an open MR says it is cleared only until the next successful poll, while other rows stay cleared until their next real transition; neither action changes a provider.
7. Confirm ordinary unchanged polls do not create repeated attention noise.
8. With Jenkins configured and no explicit SonarQube project key, use a safe fixture job whose `/config.xml` contains a literal `sonar.projectKey`. Confirm polling discovers SonarQube without retaining raw XML; confirm an expression value such as `${SONAR_PROJECT_KEY}` is ignored.
9. Cause a provider stream to change state more than once (for example failure, recovery, then partial). Confirm only its newest state remains in Attention, the older transitions remain in the audit, and acknowledging the newest state does not bring an older row back.
10. Clear an Attention item for an MR that remains open, then poll again. Confirm the MR returns once on that next poll, does not duplicate on later polls while uncleared, and stops returning after GitLab reports it merged or closed.
11. From a project-owned GitLab or Jenkins/Sonar Attention item with no Jira context, use **Insert MR evidence** or **Insert Jenkins / Sonar evidence**. Confirm Kronos chooses an explicitly attached Session for that project, opens the editable composer, and never asks for or adds a ticket key.
12. Observe Jenkins results `ABORTED`, `CANCELED`/`CANCELLED`, and `UNSTABLE`, plus a SonarQube warning gate, using safe fixtures. Confirm each is warning/failure state on first observation and on later transitions, and that a later successful result is shown as recovered.

## Scale and Accessibility

1. With a large safe/synthetic Work catalog, open the Jira board, use every filter, and reset it. Confirm long summaries wrap, the board remains responsive, counts update, and no ticket or project control becomes unreachable.
2. Use only the keyboard to traverse Setup, Doctor, Project Integration, the Jira board, ticket workspaces, and the context composer. Confirm focus is always visible; Jira cards open with Enter and Space; no action requires a pointer.
3. With a screen reader, confirm control labels, Jira card names, filter-result status updates, and Jira refresh errors are understandable without relying on color or visual position.
4. Test a VS Code high-contrast theme, 200% zoom, and a narrow editor panel. Confirm cards and status borders remain distinguishable, forms collapse to one column, content wraps or scrolls without covering actions, and the context composer remains editable.
5. Start one deliberately slow Jira refresh, then explicitly refresh again. Confirm the newer result wins, the older request does not create a stale failure banner, and no provider or terminal mutation occurs.
6. Record VS Code version, OS, zoom/theme, screen reader if used, approximate ticket count, and any focus/order/paint issue. Automated markup and construction timing do not close this real-UI gate.

## Reload and Recovery

1. With standalone and ticket-linked sessions present, reload VS Code.
2. Confirm both durable sessions and their audit history remain with the same standalone/title versus ticket identity distinction.
3. Confirm Kronos does not launch another terminal or Claude process during reload.
4. Confirm each live terminal is shown as detached after reload; Kronos must not restore it from a saved name or process ID alone.
5. Select the Session, confirm the sole unclaimed terminal reconnects or a terminal chooser appears, then confirm ticket context insertion works again.
6. Temporarily make one provider unavailable or use a safe invalid test configuration. Confirm the other providers remain usable, the result is marked partial/blocked, and no stale success is reported as current.

### Windows and multi-window ownership

1. On a real Windows host, repeat one Jira refresh and one provider poll. Confirm monitoring does not fail because `O_NOFOLLOW` is unavailable and private state remains readable after reload.
2. Open two VS Code windows against the same explicit `KRONOS_DIR`. Start provider polling in both within one poll interval. Confirm only one window owns the lease, the other reports lease contention without issuing duplicate provider reads, and the next poll succeeds after the owner closes or releases it.
3. Record the Windows version, VS Code version, filesystem type, whether the data directory is local or network-backed, and the observed lease owner/recovery result. Until this is recorded, Windows and multi-window verification remain open gates.

### Live-provider compatibility record

For each approved live Jira, GitLab, Jenkins, and SonarQube system exercised, record the product/server version, authentication type, effective read permissions, configured project/job/branch shape, endpoints that were unavailable, and whether the result was complete or partial. Do not record credentials, response bodies, employer identifiers, or private ticket content. Any provider not exercised remains an explicit open gate.

## Feedback Questions

- Was it always clear that you, not Kronos, owned the terminal and submission decision?
- Was the distinction between **New Claude**, **Start Claude for Ticket**, and **Manage Focused Terminal** obvious?
- Could you move from a filtered Jira ticket to a new or existing terminal in two obvious actions?
- Did the Jira board filters hide noise without hiding work you needed?
- Did recursive empty-value pruning make custom fields useful without losing meaningful `false` or `0` values?
- Could you distinguish attached, detached, paused, blocked, partial, and healthy session states?
- Which provider transition deserves an interrupting notification, and which should remain quietly in Attention?
- Was the audit sufficient to reconstruct what context was supplied without recording terminal content?
- What information was missing before you would trust background monitoring during normal interactive work?

## Stop Conditions

Stop and record the exact action if:

- any inserted terminal text is submitted automatically;
- Kronos launches a process or terminal without an explicit **New Claude** or **Start Claude for Ticket** action;
- Kronos executes anything whose executable is not the validated `claude` or `claude-*` configuration;
- one explicit launch creates more than one terminal or executes the Claude command more than once;
- a project command, test, build, scan, or deployment runs;
- the current Git branch, worktree, index, commit history, or remote changes;
- provider state changes;
- terminal content appears in a local artifact or audit;
- a context reference is inserted into a terminal other than the explicitly managed one;
- a standalone session receives a fabricated or inherited Jira key;
- a ticket link appears without starting or managing from the ticket path;
- a provider credential appears in UI, logs, context, or audit data;
- stopping management closes or interrupts the terminal;
- a malformed provider response or local record crashes a view.

## Signoff Bar

The terminal-first trial is ready for broader feedback when:

- only Work, Sessions, Projects, and Attention appear in the Kronos activity container;
- the Jira board can search/filter status/project/label, hide completed work by default, and show it on request;
- a reviewer can complete both standalone New Claude and ticket-to-terminal-to-context journeys without source-code knowledge;
- explicit Claude starts create/focus one terminal and execute only the validated Claude command once;
- standalone sessions remain ticket-free while ticket-triggered sessions retain their real Jira identity;
- every insertion is editable and non-submitting;
- one-click Session terminal open/reconnect, detach, pause, resume, audit, and stop-management behavior is clear;
- meaningful MR/pipeline/CI changes reach Attention without duplicate unchanged noise;
- context and audit records expose provenance and partial completeness without terminal contents or credentials;
- recursively empty Jira values are absent while meaningful `false` and `0` values remain;
- Setup, Doctor, and Settings make configuration repair understandable without exposing secrets;
- the installed extension has zero third-party runtime dependencies;
- the repository and all providers remain unchanged by Kronos throughout the review.
