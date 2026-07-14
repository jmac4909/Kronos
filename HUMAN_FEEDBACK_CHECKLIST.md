# Kronos Terminal-First Human Feedback Checklist

Use this checklist for a 20-to-30-minute hands-on evaluation of the Jira board, standalone sessions, explicit Claude launch, and operator-owned terminal workflow.

## Non-Negotiable Boundary

During this review, Kronos may read provider data, explicitly create/focus a VS Code terminal and execute a validated Claude command, insert a non-submitting context reference, monitor provider status, and write a private local audit record.

Kronos must never:

- launch automatically, on reload, during refresh/polling, or without **New Claude** / **Start Claude for Ticket**;
- execute an arbitrary program, positional Claude subcommand, or project command; only a validated `claude` or `claude-*` executable with approved interactive flags is allowed;
- read terminal input, output, or scrollback;
- press Enter or submit inserted provider-context text;
- run a project test, build, scan, deployment, or remediation command;
- create, switch, commit, push, merge, or otherwise change Git;
- mutate Jira, GitLab, Jenkins, SonarQube, or a database;
- close the operator's terminal when management stops.

Stop the review immediately if any boundary is crossed.

## Setup

1. Run `npm run compile` and `npm run package` from the Kronos repository.
2. Install with `code --install-extension kronos-0.1.0.vsix --force`.
3. Reload VS Code.
4. Open the Kronos activity icon.
5. Confirm exactly three views are visible: **Work**, **Sessions**, and **Attention**.
6. Run **Kronos: Setup** and confirm its guidance is understandable and does not expose secrets.
7. Run **Kronos: Doctor** and confirm Jira/provider/Claude launch readiness is reported without displaying credential values.
8. Open **Kronos: Settings** and identify the Claude command, terminal-name, cwd behavior, and polling options. Keep the command at `claude` or a trusted `claude-*` wrapper with only approved interactive flags for the launch tests; provider credentials remain in the private environment-file path shown by Setup.

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

Use a real ticket only when its provider data is approved for local context capture. The fixture is synthetic and must not be used to post or mutate provider state.

## Jira Work Board

1. Refresh Jira tickets.
2. Confirm completed stories are hidden by default.
3. Clear **Hide completed**, confirm completed rows appear, then enable it again and confirm they disappear.
4. Search by part of a ticket key or summary and confirm only matching rows remain.
5. Apply status, project, and label filters individually and in combination. Confirm each result and empty-result state is understandable.
6. Clear the filters and confirm the board returns to its default non-completed view.
7. Open one ticket workspace and confirm the title, summary, description, status, provider links, and known completeness warnings are easy to find.
8. Inspect a ticket with sparse standard/custom fields. Confirm `null`, blank text, empty arrays/objects, and recursively empty rich text are absent while meaningful `false` and `0` values remain.
9. Confirm the visible actions are limited to the explicit Claude launch, terminal attach, read, insert, monitor, and audit workflow.

## Start Claude for a Ticket

1. Count the open terminals, then choose **Start Claude for Ticket** from the selected ticket.
2. Confirm exactly one terminal is created and focused and the configured `claude`/`claude-*` command is executed exactly once.
3. Confirm no Jira context is submitted automatically and Kronos does not read or summarize Claude's output.
4. In Sessions, confirm the new session shows the real ticket key and title.
5. Choose **Insert `[TICKET-KEY]`**.
6. Confirm exactly one editable reference is inserted, Enter is not pressed, and the terminal remains fully interactive and operator-controlled.
7. Inspect the referenced Jira artifact. Confirm meaningful custom-field names and values, comments, attachment capture/skip reasons, provenance, pruning, and partial-completeness warnings are understandable.
8. Edit the inserted line and decide yourself whether to press Enter.

To verify the existing-terminal path as well:

9. Start or focus a separate terminal you control and choose **Manage Focused Terminal** from a ticket.
10. Confirm Kronos associates the focused terminal but does not create a terminal, launch Claude, or write anything yet.

If GitLab and CI providers are safely configured:

11. Insert the linked `[MR-N]` context and confirm review, pipeline, job, and test completeness is explicit.
12. Insert `[CI-TICKET-KEY]` and confirm Jenkins and SonarQube evidence clearly says which provider portions were fetched, partial, or unavailable.

## Sessions View

1. Choose **New Claude** and confirm exactly one new terminal is created and focused without asking for a Jira ticket.
2. Confirm the configured Claude command is executed exactly once and the session appears using its workspace-derived standalone title with no fake ticket key or ticket link.
3. Confirm the ticket-linked session separately shows its real ticket key, attached terminal state, provider bindings, monitoring state, last attempt, and latest result without showing terminal content.
4. Focus each managed terminal from Sessions and confirm the correct terminal receives focus.
5. Detach the standalone terminal and confirm it remains open and Claude remains operator-controlled.
6. Focus the intended terminal and explicitly reattach it.
7. Pause monitoring on the ticket-linked session and confirm provider polling stops for that work session.
8. Resume monitoring and run **Poll Managed Providers** once.
9. Open each available work-session audit. Confirm it uses the standalone title or real ticket identity as appropriate and contains no terminal transcript.
10. Stop managing both sessions and confirm both terminals remain open and usable.

## Launch Validation and Operations

1. In Settings, temporarily change the Claude executable to a harmless but disallowed command such as `echo`.
2. Choose **New Claude** and confirm Kronos rejects the setting before creating a terminal or executing anything.
3. Restore a trusted `claude` or `claude-*` executable. If the selected ticket has a configured project path, test once with a safely invalid fixture path and confirm launch fails before terminal creation.
4. Restore a valid project path or choose workspace/home cwd behavior. Confirm Doctor reports the repaired general launch settings.
5. Confirm Setup, Doctor, and Settings never print provider tokens, environment secrets, or credential values.

## Attention View

1. Confirm provider failures, recoveries, partial reads, and monitoring blockers are grouped by real ticket when linked, or by standalone session title when not linked, rather than scattered by provider.
2. Open an attention item's provider page and confirm it points to the expected configured provider.
3. For a ticket-linked item, open the related ticket workspace. Confirm a standalone item does not fabricate that action or a ticket key.
4. Insert fresh MR or CI context from the item when applicable; confirm the reference goes only to the explicitly attached terminal and is not submitted.
5. Acknowledge the item and confirm acknowledgement changes only local Attention/audit state.
6. Confirm ordinary unchanged polls do not create repeated attention noise.

## Reload and Recovery

1. With standalone and ticket-linked sessions present, reload VS Code.
2. Confirm both durable sessions and their audit history remain with the same standalone/title versus ticket identity distinction.
3. Confirm Kronos does not launch another terminal or Claude process during reload.
4. Confirm each live terminal is shown as detached after reload; Kronos must not restore it from a saved name or process ID.
5. Explicitly reattach the focused terminal and confirm ticket context insertion works again.
6. Temporarily make one provider unavailable or use a safe invalid test configuration. Confirm the other providers remain usable, the result is marked partial/blocked, and no stale success is reported as current.

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

- only Work, Sessions, and Attention appear in the Kronos activity container;
- the Jira board can search/filter status/project/label, hide completed work by default, and show it on request;
- a reviewer can complete both standalone New Claude and ticket-to-terminal-to-context journeys without source-code knowledge;
- explicit Claude starts create/focus one terminal and execute only the validated Claude command once;
- standalone sessions remain ticket-free while ticket-triggered sessions retain their real Jira identity;
- every insertion is editable and non-submitting;
- terminal focus, detach, reattach, pause, resume, audit, and stop-management behavior is clear;
- meaningful MR/pipeline/CI changes reach Attention without duplicate unchanged noise;
- context and audit records expose provenance and partial completeness without terminal contents or credentials;
- recursively empty Jira values are absent while meaningful `false` and `0` values remain;
- Setup, Doctor, and Settings make configuration repair understandable without exposing secrets;
- the installed extension has zero third-party runtime dependencies;
- the repository and all providers remain unchanged by Kronos throughout the review.
