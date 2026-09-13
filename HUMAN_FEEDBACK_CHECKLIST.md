# Kronos Terminal-First Human Feedback Checklist

Use this checklist for a 20-to-30-minute hands-on evaluation of the Jira board, standalone sessions, explicit Claude start/resume, and operator-owned terminal workflow.

## Non-Negotiable Boundary

During this review, Kronos may read provider data, explicitly create/focus a VS Code terminal and execute a validated new or resume Claude command, insert a non-submitting context reference, monitor provider status, and write a private local audit record.

Kronos must never:

- launch automatically, on reload, during refresh/polling, or without **New Claude**, **Start Claude for Ticket**, or explicit selection of a disconnected Session;
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
6. Run **Kronos: Setup** and confirm its dedicated dashboard clearly groups Claude launch, project folders, registered projects, Jira, provider updates, Team Prompt Library, and private state without exposing secrets. Confirm readiness appears once in the header rather than in a repeated status card. Confirm its runtime guide shows the correct native private-state and provider-environment paths plus precise reload behavior. If **Open Provider Config** creates the file, confirm Kronos immediately warns that saved values require **Developer: Reload Window** before the extension host can see them. Exercise its Check Setup, Jira Board, prompt/settings, project-folder, Projects, and Sessions actions; confirm these configuration/navigation actions are not repeated as primary buttons in every view header.
7. Run **Kronos: Check Setup** and confirm its dedicated dashboard shows compact ready/review/blocked totals, places actionable problems first, refreshes in place, and reports Jira/provider/Claude readiness without displaying credential values. On a full-width desktop editor it should use available columns; on a laptop or narrower editor it should collapse without horizontal crowding.
8. Open **Kronos: Settings** and confirm it returns to the existing Setup dashboard rather than opening a competing configuration flow. From the relevant Setup rows open Claude or visibility settings, identify the Claude command, permission mode, terminal-name, starting-folder behavior, and update options, then return to Setup. Confirm permission mode offers Manual/default, Accept Edits, Plan, Auto, Don't Ask, and experimental Bypass Permissions with clear descriptions. Keep the command at `claude` or a trusted `claude-*` wrapper with only approved interactive flags for the launch tests; raw permission flags do not belong in the command. Provider credentials remain in the private environment-file path shown by Setup.
9. Find **Claude Session tracking** in Setup and Check Setup. When disabled, confirm a Claude launch suggests it without requiring it. Choose **Not Now** once and confirm launch continues unchanged. Then choose **Enable Tracking**, review the modal scope, and confirm Kronos adds one `resume|clear` `SessionStart` hook while retaining unrelated user Claude settings and hooks plus a private backup. Invalid or symbolic-link settings must be reported and left unchanged.

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

The synthetic state includes one detached ticket session, one detached standalone session, current project-owned MR/pipeline/Jenkins/Sonar snapshots, and retained audit transitions. Every provider URL uses the reserved `.invalid` domain and no terminal is started. Opening the fixture in the extension can exercise automatic read-failure handling against those intentionally unreachable hosts; do not use **Check Updates** unless you want to review that unavailable-provider behavior. Use the initial rows to review active-work grouping, readiness language, target pickers, and current-state replacement before creating your own live terminal sessions.

Use a real ticket only when its provider data is approved for local context capture. The fixture is synthetic and must not be used to post or mutate provider state.

## Jira Work Board

1. Refresh Jira tickets.
2. Confirm completed stories are hidden by default.
3. Clear **Hide completed**, confirm completed rows appear, then enable it again and confirm they disappear.
4. Search by part of a ticket key or summary, then by an update date, attachment filename/type, MR IID/author/branch, and build number/status. Confirm Work and the Jira board find the same ticket evidence and only matching rows remain.
5. Open **More filters**, then apply Jira project, local project, and label filters individually and in combination. Confirm Jira namespaces never satisfy the local-project filter (or the reverse), and each result and empty-result state is understandable. Close and reopen the board and confirm the disclosure state is retained.
6. Clear the filters and confirm the board returns to its default non-completed view.
7. Open one ticket workspace and confirm the title, summary, description, status, provider links, and known completeness warnings are easy to find.
8. Inspect a ticket with sparse standard/custom fields. Confirm `null`, blank text, empty arrays/objects, and recursively empty rich text are absent while meaningful `false` and `0` values remain.
9. Confirm each board card keeps only **Start Claude** and **Choose project** together; selecting the card or its ticket key opens the ticket workspace. In the Work sidebar, confirm hovering a ticket row shows only **Start Claude**, selecting the row opens its workspace, and right-clicking shows only ticket-scoped actions without Connect Focused Terminal or the general Team Prompt Library.
10. Confirm dense cards show only the linked local project, two labels plus a count, and current MR/build state. Jira namespace and attachment metadata should remain searchable and available after opening the ticket, without repeating as chips on every card.
11. Confirm Work sidebar rows show Jira status plus the linked local project, or priority when unlinked. Hover a row and confirm the remaining ticket facts and select/right-click guidance are available without widening the sidebar.

## Local Projects and Branches

1. From **Setup**, choose **Choose Folders**, select two safe parent folders such as `IdeaProjects` in one native dialog, and confirm **Manage Projects** opens immediately. Confirm the parent folders are discovery roots only: repositories found inside them remain unchecked until explicitly registered. On Windows, include a repository folder exposed through a OneDrive reparse point or directory junction and confirm it is offered by its canonical path. Confirm a linked non-repository container is not searched recursively unless you explicitly choose that container as a discovery root. Confirm Work does not repeat this discovery button and Projects has one **Manage Projects** entry point.
2. Confirm registered projects are checked at the top, newly discovered projects are unchecked below them, deeper/out-of-limit folders do not appear, and accepting the picker makes the checked state authoritative. Uncheck one unlinked project and confirm it is unregistered.
3. Confirm newly registered projects open **Project integrations**. Give one project a friendly name, enter a GitLab numeric ID or `group/project` path, a reusable Jenkins `/job/<name>/` URL, SonarQube project key, and default branch; confirm credential readiness is shown without any secret values. Verify the Jenkins guide explains nested `/job/` folders, multibranch parent routing, and why `/branch/`, view/console/API, server-root, and numbered-build URLs are not accepted. Check out a different local branch that has no SonarQube analysis and confirm provider status still reads the explicitly saved default SonarQube branch. Leave an optional field blank and confirm it can be cleared.
4. Reopen **Configure Project Integrations** from Setup and confirm the saved values appear for all registered projects and the observed Git branch was the initial default.

- Before linking any Jira ticket or opening any terminal Session, use **Check Provider Updates**. Confirm the configured project shows the latest check in Projects, GitLab/Jenkins/SonarQube reads occur for that project, and resulting Attention items are grouped under the project. Open a merge request for the current branch, check again, then switch the same repository to a second ticket branch and open another merge request without linking either Jira ticket; confirm the next check discovers the second IID and gives it its own project-owned Attention row. Reload VS Code and confirm automatic checks resume for the project without creating a Session row or fake Jira identity.

5. Expand the Jira board's local-project disclosure and confirm it shows each project name, absolute path, and branch currently named by Git `HEAD` without occupying space when collapsed.
6. Use **Choose project** in the top row of two Jira cards, attach projects from the selected roots, and confirm the control changes to **Change project** while each ticket workspace and Work row show the right branch and launch directory.
7. Load at least two tickets with the same Jira namespace, such as `ABC-123` and `ABC-124`, while four repositories are registered under one discovery root. Confirm none is linked by default; link each ticket explicitly to a different repository and confirm Jira refresh preserves only those choices.
8. Switch branches yourself in the terminal, refresh or reopen the board, and confirm Kronos reflects the new branch without running a Git command.
9. Start Claude for the linked ticket and confirm its new terminal starts in the selected project directory and its terminal tab shows both the ticket key and current Git branch, such as `Claude · JIRA-123 @ feature/name`.
10. Choose **Connect Focused Terminal** on an existing terminal and confirm linking does not change that terminal's directory or send `cd`.
11. Poll the linked ticket and confirm only its explicitly selected local project's GitLab/Jenkins/SonarQube identifiers are used. Then unlink the local project and confirm future launches use workspace/home fallback and no registered repository is inferred from the Jira key.
12. Open the separate **Projects** view. Confirm every registered project shows its current branch and clean/dirty status, including staged or conflicted detail when present. Use its refresh action after switching branches, then open status/diff and verify the repository is unchanged.
   Confirm each Project row keeps only **Start Claude** inline; review/setup/rename actions remain available after expanding or right-clicking the selected Project.
13. Choose the inline or expanded **Start Claude** action. Confirm exactly one terminal opens in that registered directory, its title shows the current branch, and the new Session has the project identity but no Jira ticket or context.
14. In an existing terminal whose current directory is a subfolder of that project, choose **Connect Focused Terminal** without a ticket. Confirm the standalone Session uses the registered project nickname/name and root while preserving the terminal's actual subfolder as attachment detail. Confirm project context actions find that terminal without asking for Jira.
15. Use **Rename project**, **Review merge request**, and the other Project-row actions on a registered Project after refreshing or changing its discovery-root path spelling. Confirm every action re-resolves the registered project instead of showing **Select a currently registered project**. Merge the previously bound merge request, open another one for the current branch, then review it without polling first; confirm the composer uses the new IID rather than the merged saved binding. With a project-only Session focused, confirm merge request and build/quality context open the editable composer and insert without adding Jira context. Confirm the nickname appears in Projects, Work, the Jira board, project setup, local search, Sessions, and Attention while its stable identity, canonical path, linked tickets/sessions, provider configuration, and Git state remain unchanged. Clear it and confirm every surface falls back to the stable project name.
16. Insert the project's `[GIT-project]` context into its explicitly attached session. Confirm the composer previews changed paths, potential credential material is redacted from the private artifact, and the terminal line is not submitted.
17. Use **Open merge request**. Confirm bounded live discovery opens the current branch's existing merge request rather than an older merged result; when none is open, confirm a prefilled GitLab new merge request page opens and nothing is created until you act in GitLab. If discovery is ambiguous, confirm Kronos refuses to guess.
18. In **Project integrations**, expand **Branch routing**, add two **Branch overrides** lines using `branch | Jenkins URL | SonarQube key | SonarQube branch`, choose one optional fallback, save, and reopen the form. Confirm both profiles and the fallback round-trip exactly and **Branch routing** opens automatically when saved values exist.
19. Link a ticket whose known MR source branch exactly matches the second profile, poll once, and confirm Jenkins uses that profile's job/branch while SonarQube uses its project key/provider branch. Use a ticket without a matching MR profile and confirm only the explicit active fallback is used.
20. Enter a duplicate branch, unsafe branch, credential-bearing URL, or active name not present in the profile list. Confirm save is refused with a bounded repair message and the prior valid setup remains unchanged.
20. Confirm saving or selecting a profile never switches the repository branch, changes a worktree, invents a ticket-project link, or sends a provider write.

## Start Claude for a Ticket

1. Count the open terminals, then choose **Start Claude for Ticket** from the selected ticket.
2. Confirm exactly one terminal is created and focused, its title contains the current branch when the launch directory is a Git project, and the configured `claude`/`claude-*` command is executed exactly once.
3. Confirm no Jira context is submitted automatically and Kronos does not read or summarize Claude's output.
4. In Sessions, confirm the new session shows the real ticket key and title.
5. Under **Add context**, choose **Review Jira ticket** and confirm no terminal text is written while the provider read is in progress or when the review composer first opens.
6. Confirm the composer shows an escaped preview of the ticket description, recent comments, warnings, and a collapsible context reference. Edit **What Claude should focus on** with normal Enter/newlines and confirm nothing is inserted yet.
7. Choose **Add to terminal** or press Ctrl/Cmd+Enter in the composer. Confirm exactly one shell-quoted reference is inserted, Enter is not pressed, and the terminal remains fully interactive and operator-controlled.
8. Inspect the referenced Jira artifact. Confirm meaningful custom-field names and values, comments, attachment download/skip reasons, provenance, pruning, and partial-completeness warnings are understandable. Include a `.msg` or other binary fixture and an uncommon file type; confirm both are stored byte-for-byte as private files, referenced by sanitized paths and hashes, and never embedded, parsed, previewed, or executed by Kronos.
9. Review the inserted line and decide yourself whether to press Enter in the terminal.

To verify the existing-terminal path as well:

10. Start or focus a separate terminal you control and choose **Connect Focused Terminal** from the ticket workspace.
11. Confirm Kronos associates the focused terminal but does not create a terminal, launch Claude, or write anything yet.
12. Reopen the ticket workspace and confirm **Open terminal** is now the primary action, **Start another Claude** remains available, and **Connect focused terminal** is no longer shown for the already connected ticket.

If GitLab and CI providers are safely configured:

13. Insert the linked `[MR-N]` context and confirm the composer includes recent notes/discussions plus explicit review, pipeline, job, and test completeness.
14. Insert `[CI-TICKET-KEY]` and confirm Jenkins and SonarQube evidence clearly says which provider portions were fetched, partial, or unavailable.

## Team Prompt Library

1. Create a safe local schema-v1 manifest with two prompts and configure its file or parent directory in `kronos.promptLibraryLocalPaths`. Configure a raw HTTPS manifest from a disposable Git branch in `kronos.promptLibraryRemoteManifestUrls`; do not put a token in the URL.
2. Open **Team Prompt Library** from a ticket workspace, Session, and registered Project. Confirm it always targets an already managed terminal and never creates a terminal, launches Claude, requires a Jira ticket for the Project path, or writes anything while the picker/editor opens.
3. Search by title, library, description, tag, and suggested context. Choose a prompt using `{{session.title}}`, `{{project.name}}`, `{{project.path}}`, `{{project.branch}}`, `{{jira.key}}`, `{{jira.keys}}`, and one unknown variable. Confirm allowlisted values are filled from the selected Session, the unknown variable stays visible with a warning, and no Jira key is invented for a ticket-free Project Session.
4. Confirm the editor gives most widescreen space to the complete prompt, keeps source provenance, tags, suggested context, filled placeholders, and safety details in a compact side rail, and collapses cleanly to one column in a narrower laptop panel. Confirm **Library settings** stays with the library details instead of beside the placement action. Edit with normal Enter/newlines; confirm nothing reaches the terminal until **Add to terminal** or Ctrl/Cmd+Enter.
5. Place once and confirm exactly one `[PROMPT-*]` reference is inserted into the intended terminal with Enter not pressed. Inspect the referenced private Markdown/JSON pair and confirm it contains the reviewed redacted body and source revision, not terminal contents or provider credentials. Re-trigger the webview action if practical and confirm no duplicate snapshot or terminal write appears.
6. Make the remote URL temporarily unavailable and reopen the library. Confirm Kronos labels its bounded warning and offers the private latest-good copy. Restore it with a changed valid manifest and confirm the next explicit open shows the new revision. Confirm no redirect is followed and no remote manifest can launch Claude, execute a command, change Git, or submit terminal input.

## Context Basket

1. From Jira, merge request, build/quality, and local Git composers, choose **Add to basket** for at least two sources. Confirm adding does not write to or submit terminal input.
2. Open **Context Basket** from Work, Sessions, or Projects. Confirm each row shows its source, provenance, fetched time, completeness, size, short hash, warnings, and any same-source/different-content conflict.
3. Choose **Refresh source**. Confirm Kronos opens the normal explicit source review and does not replace the selection until you choose **Add to basket** on the refreshed item.
4. Remove one selection and confirm its saved source still exists. Clear the basket and confirm the modal explains that saved sources remain available.
5. Re-add multiple sources, edit **What Claude should focus on** with ordinary Enter/newlines, choose **Add to terminal**, and select an active Session. Confirm exactly one `[BASKET-*]` line appears in the intended terminal and Enter is not pressed.
6. Inspect the basket Markdown. Confirm it contains references, hashes, provenance, completeness, conflicts, warnings, and the operator focus, but does not copy Jira descriptions, comments, diffs, job output, or other provider payloads.
7. Confirm placement leaves the basket selected for reuse and the audit records the bundle without terminal input, output, or scrollback.

## Sessions View

1. Choose **New Claude** and confirm exactly one new terminal is created and focused without asking for a Jira ticket.
2. Confirm the configured Claude command is executed exactly once and the session appears using its workspace-derived standalone title with no fake ticket key or ticket link.
3. Leave Claude Terminal Layout at **Editor Split**. Confirm the first Kronos-launched Claude terminal opens as an editor tab and a second Kronos-launched Claude terminal opens in a separate main-editor column beside it, not as a split inside the first terminal editor. Keep an unrelated pre-existing terminal open and confirm Kronos does not move it automatically.
4. Change Claude Terminal Layout to **Editor Tabs**, launch once, and confirm no automatic split is created. Change it to **Panel**, launch once, and confirm the terminal opens in the terminal panel. Restore **Editor Split** and confirm the next launch returns to the editor area instead of inheriting the prior panel terminal's location.
5. Open **Terminal Layout** from Sessions and choose **Show all editor columns evenly**. Confirm all visible editor groups become equal width without moving, writing to, interrupting, or closing a terminal. Then choose **Toggle Full Size** twice from an attached editor Session and confirm VS Code maximizes then restores that editor group. Repeat on a Kronos-launched panel Session and confirm the panel maximizes then restores.
6. In a disposable isolated workspace, set Claude Permission Mode to experimental Bypass Permissions. Choose **New Claude**, confirm the modal explains that prompts will be skipped and offers **Launch Without Permission Prompts**, **Open Claude Settings**, and cancel. Cancel once and choose Settings once; both paths must create no terminal or Session. Confirm once and verify exactly one terminal starts with `claude --dangerously-skip-permissions`, then restore Manual/default before continuing.
7. Confirm the project session shows its real Jira context(s), attached terminal state, provider bindings, monitoring state, last attempt, latest result, and audited launch permission mode without showing terminal content.
8. Select each attached Session and confirm its correct terminal opens immediately.
9. With a managed Claude conversation still running, use **Developer: Reload Window**. Confirm its Session reconnects to the same terminal without showing **Resume available**, creating another terminal, or submitting another Claude command. Select it and confirm it only focuses the existing terminal with its content intact.
10. Close and reopen VS Code, or reboot the machine when practical. Confirm the revived empty shell is not treated as a live Claude attachment and nothing resumes automatically. The Session should show **Resume available**. Select it and confirm one exact `claude --resume <uuid>` command runs in the saved folder, reusing the marker-matched revived terminal when it exists. Select the now-connected Session again and confirm no second resume is submitted.
11. In that managed shell, use Claude `/resume` and choose a different conversation. Exit Claude, run `cd` to a different safe folder, and start `claude --resume <uuid>` manually. Within a few seconds, confirm the same Kronos Session remains attached and keeps its display name, project, Jira contexts, and providers. Restart the machine or close the terminal, select the Session, and confirm Kronos resumes the newly selected conversation in the newly saved folder—not the original UUID or project folder. Confirm ordinary startup and `/compact` create no tracking event, and no lifecycle event or audit view exposes terminal content or a Claude transcript.
12. For a Session created by an older Kronos build, confirm selection offers **Resume a Claude conversation…** plus any unclaimed open terminals. Choose the former and confirm Claude's own session picker opens with bare `claude --resume`; Kronos must not guess a conversation from terminal text, title, process ID, or folder.
13. Repeat resume with experimental Bypass Permissions in an isolated disposable workspace. Confirm the blocking warning appears again before the resume command and cancel creates or submits nothing. Restore Manual/default afterward.
14. Detach the standalone terminal and confirm it remains open and Claude remains operator-controlled. Selecting it again in the same editor session should reconnect the marker-matched live terminal without submitting a resume command.
15. Try the Session pause/resume action for a configured registered project and confirm Kronos explains that polling belongs to the project and remains automatic; the Session setting must not stop project polling.
16. Run **Check Provider Updates** once and confirm the Project, not the Session, receives the latest provider health.
17. Open the ticket workspace and confirm GitLab, Jenkins, and SonarQube each show active, discovering, paused, or setup state. Confirm GitLab discovers a unique open MR by current branch/ticket key without a manual connect prompt and refuses an ambiguous fixture.
18. Open each available work-session audit. Confirm it uses the standalone title or real ticket identity as appropriate and contains no terminal transcript or Claude session UUID.
19. Stop managing one session and confirm its terminal remains open and usable. Remove an old session, confirm the terminal still remains open, and confirm the removed row no longer appears while retained context/audit files remain local.
20. After two unchanged polls, inspect the Project. Confirm it shows the latest attempt, last successful poll, last meaningful change, next scheduled poll, normalized current error, and increasing quiet/suppressed count without adding Attention rows. The Session may show legacy history, but it must not claim ownership of configured-project polling.
21. Right-click a Session and choose **Rename Session**. Confirm the new display name appears in Sessions, search, history, and handoff choices while the terminal, Claude resume identity, project, Jira contexts, and provider links stay unchanged. Rename it to blank and confirm the original generated title returns.

## Local Evidence Search

1. Choose **Search** from each Kronos view toolbar and type portions of a Session title, Jira key, registered project, current branch, provider subject, saved-context label, and recent history. Confirm each expected row is discoverable through label, description, or detail matching.
2. Select one result of each kind. Confirm Session focuses/reconnects its terminal, Jira opens its workspace or retained session audit, Project opens bounded read-only Git evidence, Provider opens only a validated URL or audit, Artifact opens its private file, and Event opens its session audit.
3. Include a terminal with distinctive visible text that appears nowhere in Kronos metadata. Confirm searching that text returns no result and Kronos does not read or index terminal input, output, or scrollback.
4. Change a session title or create a new local event, reopen search, and confirm the rebuilt Quick Pick reflects current state without a separate indexing task or persistent search file.

## Private Local Handoff

1. From Sessions or Projects choose **Create Handoff**, select one Session, then select a mix of saved context and history references. Confirm saved context is preselected, history remains an explicit choice, and the picker refuses more than 100 selections.
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

1. With several registered Projects and no open MR, active build, unresolved failure, or incomplete read, confirm Attention says **No active delivery work** while Projects still lists the complete monitored inventory.
2. Open an MR and start its pipeline. Confirm the project appears as **In progress** with current MR/pipeline rows. Healthy running state is green, readable without color, and produces no pop-up.
3. Configure Jenkins and SonarQube for the project. Confirm missing configured results stay **In progress**, then passing results appear as healthy current rows. A completed healthy build with no open MR or unresolved issue disappears from Attention rather than becoming a permanent success notification.
4. Cause GitLab, Jenkins, or SonarQube to fail. Confirm the project moves to **Needs fixes**, sorts ahead of healthy work, retains job/test/stage/issue counts, and produces one actionable warning with **Open Provider** and fresh context when available.
5. Cause a partial/failed provider read or local monitoring blocker. Confirm the project moves to **Status incomplete**, stale provider truth is not shown as current, missing components are named, and the row remains until a complete current read recovers it.
6. With an open MR, make every configured pipeline/Jenkins/SonarQube check pass and leave approval outstanding. Confirm the project becomes **Ready for review** and announces that milestone once. Poll unchanged and confirm it does not notify again.
7. Satisfy approval requirements. Confirm the project becomes **Ready to merge** without a new pop-up. Start a new pipeline or introduce a problem, recover to review-ready again, and confirm the milestone may announce once for the new cycle.
8. Confirm a running Jenkins build and a pending/unavailable SonarQube gate have no clear action. After Jenkins stops and a SonarQube gate is available, use each row's inline X and confirm that exact result disappears locally without changing provider state or deleting audit history. Poll unchanged and confirm it stays cleared; then change the build/gate result and confirm the row returns. If a legacy/unassigned fallback row exists, clearing it likewise changes only local presentation.
9. Open a provider page and fresh **Review Merge Request** or **Review Build & Quality** context from project-owned rows with no Jira context. Confirm Kronos chooses a connected Session for that project, opens an editable composer, and never invents a Jira key or submits terminal input.
10. For a row backed by an exact retained transition, confirm **Use Event in Prompt** freezes only that event. For a synthetic current row without matching audit evidence, confirm the exact-event action is absent and fresh context remains available.
11. For SonarQube, confirm the dashboard link keeps project/branch routing and the latest-first branch picker works. Selecting another branch updates the monitored target and opens a fresh immutable CI review; the previous prompt remains unchanged. If the prior branch had a partial or failed read, confirm it remains in history but does not mark the newly selected healthy branch or project **Status incomplete**.
12. Observe Jenkins `ABORTED`, `CANCELED`/`CANCELLED`, and `UNSTABLE` plus a SonarQube warning gate. Confirm each is **Needs fixes** on current truth and later success removes the problem without recovery-notification noise.

## Scale and Accessibility

1. With a large safe/synthetic Work catalog, open the Jira board, use every filter, and reset it. Confirm long summaries wrap, the board remains responsive, counts update, and no ticket or project control becomes unreachable.
2. Use only the keyboard to traverse Setup, Check Setup, Project Integration, the Jira board, ticket workspaces, and the context composer. Confirm focus is always visible; Jira cards open with Enter and Space; no action requires a pointer.
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
- Was the distinction between **New Claude**, **Start Claude for Ticket**, **Resume available**, and **Connect Focused Terminal** obvious?
- Do failed Sessions or Projects reads show a clear **Check Setup** recovery row instead of looking empty?
- Are Project rows easy to scan with branch and change state visible, while provider details remain available in the tooltip?
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
- Kronos launches a process or terminal without an explicit **New Claude**, **Start Claude for Ticket**, or disconnected-Session selection;
- Reload Window submits a resume command, or a full restart resumes before the operator selects the Session;
- Kronos executes anything whose executable is not the validated `claude` or `claude-*` configuration;
- one explicit launch creates more than one terminal or executes the Claude command more than once;
- one explicit resume targets anything other than the saved UUID, or submits more than one resume command;
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
- Setup, Check Setup, and Settings make configuration repair understandable without exposing secrets;
- the installed extension has zero third-party runtime dependencies;
- the repository and all providers remain unchanged by Kronos throughout the review.
