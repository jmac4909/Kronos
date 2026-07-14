# Kronos — Terminal Work Companion

Kronos is a terminal-first VS Code companion for organizing Jira work and interactive Claude sessions. The operator can attach a terminal they already own or explicitly ask Kronos to create and focus a new Claude terminal. Kronos reads Jira, GitLab, Jenkins, and SonarQube context; inserts editable context references without submitting them; monitors provider status; and keeps a private audit trail.

## Product Boundary

Kronos **organizes, explicitly starts Claude, reads, inserts, monitors, and audits**.

Kronos never:

- launches anything automatically;
- executes an arbitrary command: the two explicit Claude-start actions accept only a validated `claude` or `claude-*` executable plus a narrow allowlist of interactive, non-escalating flags;
- reads terminal input, output, or scrollback;
- submits inserted provider context or presses Enter for the operator;
- runs project tests, builds, scans, deployments, or remediation commands;
- creates, switches, commits, pushes, merges, or otherwise changes Git branches or worktrees;
- changes Jira, GitLab, Jenkins, SonarQube, or database state.

The operator chooses every launch, owns the resulting interactive session, edits every inserted reference, decides when to submit it, directs the work, and can stop Kronos management without closing the terminal.

The normative boundary and navigation model are in [docs/terminal-first-product-contract.md](docs/terminal-first-product-contract.md).

## Three Views

### Work

Work is a Jira board with search, status, project, and label filters. Completed work is hidden by default and can be shown explicitly. Refresh the board, combine or clear filters, open one ticket workspace, then either attach an existing focused terminal or choose **Start Claude for Ticket**. Ticket association is created only from this ticket path, never by standalone **New Claude**.

Use **Choose Project Discovery Folders** from the Work toolbar or Setup to select multiple parent folders in VS Code's native folder picker—for example, `IdeaProjects` and `PycharmProjects`. Kronos saves those machine-local roots and immediately opens **Discover and Manage Local Projects**. Registered projects appear first and checked; newly discovered projects follow unchecked. Accepting the picker registers checked projects and unregisters unchecked ones. Newly registered projects then open a guided **Project Integration Setup** for their GitLab project ID/path, Jenkins job URL, SonarQube project key, and default monitoring branch. The same editor can be reopened for all projects from Setup or from the project itself. It reports whether the private global provider credentials are ready but stores only the project-specific identifiers and never displays a token. Removing a ticket-linked project requires confirmation and clears only that local launch link. Settings control root removal, scan depth, and result limit. Discovery is bounded and read-only. Each Jira card has an **Add Project** control in its top row; once linked it shows the current project name. Kronos reads lightweight branch metadata directly from `.git/HEAD`; the Projects area can additionally read status and a bounded diff through VS Code's built-in Git model. Kronos never invokes a Git mutation or changes the repository. Future ticket-launched Claude terminals start in the linked folder. Existing terminals are never moved or sent a `cd` command. The linked project's integration values take precedence when Kronos polls that ticket's providers.

From a ticket workspace, explicitly insert the context needed for the next instruction:

- `[JIRA-123]` for Jira fields, description, comments, custom fields, and paths to bounded raw attachment files of any type;
- `[MR-77]` for GitLab merge-request, review, diff, pipeline, job, and test evidence;
- `[CI-JIRA-123]` for Jenkins build/test/stage and SonarQube gate/measure/issue evidence.

Jira and MR insertion first opens a composer containing an escaped preview of the fetched description, comments, notes, and completeness warnings. The private artifact reference is fixed, while **Operator focus** is editable. **Place in Terminal** or Ctrl/Cmd+Enter inserts one shell-quoted line with execution disabled; ordinary Enter edits the textarea. CI insertion uses the same non-submitting terminal boundary. In every case, only the operator can press Enter in the terminal.

**Refresh Jira Tickets** uses Jira Cloud's bounded read-only JQL search directly from the extension. Set `JIRA_JQL` to choose the Work list; otherwise Kronos reads unresolved work plus the last 30 days of resolved work assigned to the current Jira user, and the board hides completed rows locally by default. A partial paginated read retains prior rows instead of silently dropping them. Jira values are pruned recursively before storage and display: `null`, empty strings, empty arrays, empty objects, and recursively empty rich text disappear, while meaningful `false` and `0` values remain.

### Sessions

The Sessions view contains two ordered sections: interactive **Sessions** first and registered **Projects** below it. Sessions shows both standalone Claude sessions and ticket-linked work sessions with their ephemeral live-terminal attachment. **New Claude** creates and focuses a standalone terminal without inventing a Jira key or ticket link. **Start Claude for Ticket** creates the same operator-owned terminal experience but records the selected ticket association.

Each session reports whether the terminal is attached, which providers are bound, context freshness, monitoring health, and the latest poll result where applicable. Selecting a Session opens its attached terminal immediately. If the live attachment was lost after reload, Kronos lets you choose which currently open terminal to reconnect and then opens it. A Kronos-created terminal tab includes the Git branch read from its actual launch directory—for example, `Claude · JIRA-123 @ feature/context` or `Claude @ main`—without invoking Git or renaming an existing terminal.

From Sessions, the operator can focus or reattach the terminal, poll providers, pause or resume monitoring, inspect the audit, detach the terminal, stop management, or explicitly remove an old local session record. Detaching, stopping, and removal never close the terminal. Removal deletes that session's local record and colocated monitor snapshots after confirmation while retaining shared audit history and saved context artifacts.

Each registered Project shows its current branch and change count when the repository is already known to VS Code. Expand it to explicitly open that repository in VS Code's built-in Git model and view a read-only status/diff, insert a secret-redacted `[GIT-project]` working-tree snapshot into one attached project session, open an existing MR or a prefilled GitLab new-MR page, insert MR or Jenkins/SonarQube evidence, or edit provider polling setup. Opening the new-MR page is explicit browser navigation; Kronos never posts or creates the MR itself.

After VS Code reloads, persisted history remains but the live terminal starts detached. Kronos does not trust a saved terminal name or process ID as proof of identity. Select the Session: if exactly one unclaimed terminal is open it reconnects and opens it; otherwise choose the intended terminal from the list.

### Attention

Attention is the session- and ticket-aware inbox for meaningful provider changes and monitoring problems: merge-request review changes, pipeline failures or recoveries, Jenkins test/stage changes, SonarQube gate or issue changes, partial provider reads, and monitoring blockers.

An attention item can open the originating provider page, open its ticket workspace when ticket-linked, insert applicable fresh MR or CI context into the managed terminal, or be acknowledged. Acknowledgement changes only the local audit state.

## Typical Journey

1. Open **Kronos > Work**, choose discovery folders, register the projects you need, and complete their optional provider-polling identifiers; then use the Jira board filters and select a ticket.
2. Choose the ticket's local project/branch, then choose **Start Claude for Ticket**, or focus an existing terminal and choose **Manage Focused Terminal**.
3. For an explicit start, Kronos validates the configured executable and approved interactive flags, terminal name, and working directory; it then creates and focuses one VS Code terminal and executes that command once.
4. Choose **Insert `[JIRA-123]`**. Kronos writes a private context artifact and opens the context composer.
5. Review the fetched evidence, add an optional operator focus, choose **Place in Terminal** (or Ctrl/Cmd+Enter), then press Enter in the terminal yourself and continue directing the interactive session normally.
6. Once a project and ticket session are configured, Kronos immediately begins read-only provider polling and continues on the configured interval. GitLab finds a unique open MR by current branch first and Jira key second; it refuses ambiguous matches. The MR/CI buttons are evidence insertion actions, not connection steps.
7. Respond to meaningful changes from **Attention** by opening the provider, inserting fresh context, or acknowledging the event.
8. Use **Sessions > Open Work Session Audit** to inspect context provenance, completeness, transitions, and acknowledgements. Terminal contents are never part of the audit.
9. Choose **Stop Managing Work Session** when finished. The terminal remains open and under operator control.

For work that does not begin with Jira, choose **Sessions > New Claude**. The resulting session is standalone and receives no ticket identity. A ticket association is created only through a separate ticket action from Work.

## Runtime, Local Data, and Credentials

The installed extension has **zero third-party runtime dependencies**. Its implementation uses the VS Code API and Node built-ins only; it does not use helper scripts, subprocess libraries, or a bundled agent SDK. The sole external program it can start is the operator-configured Claude executable, through a newly created VS Code terminal and only after **New Claude** or **Start Claude for Ticket** is clicked. TypeScript and the official VS Code type packages are development-only tooling. Release packaging uses the pinned official VS Code Extension Manager CLI (`@vscode/vsce@3.9.2`), which is not shipped in the extension.

Kronos uses local operator state under `~/.kronos` by default, or the explicitly configured `KRONOS_DIR`. Provider credentials are inherited from the extension environment and, when present, `~/.kronos/.env` (or `KRONOS_ENV_FILE`). Credential values are not written to context artifacts, work-session records, or audit events. The cross-window monitoring lease uses `O_NOFOLLOW` on supporting POSIX systems; Windows omits that unsupported open flag and instead relies on exclusive file creation plus pre/post-open file-identity checks.

Common read-only configuration variables are:

- Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, optional `JIRA_JQL`;
- GitLab: `GITLAB_TOKEN` and `GITLAB_API_BASE_URL` or `GITLAB_BASE_URL`;
- Jenkins: `JENKINS_URL`, plus optional `JENKINS_USER`/`JENKINS_USERNAME` and `JENKINS_API_TOKEN`/`JENKINS_TOKEN`;
- SonarQube: `SONAR_HOST_URL`/`SONAR_URL` and `SONAR_TOKEN`.

Structured context artifacts are bounded, normalized, secret-redacted, wrapped as untrusted provider data, and stored in private per-user files where the platform supports private file permissions. Jira attachments are downloaded byte-for-byte without a MIME allowlist or bundled parser, stored separately as private files, and referenced by a sanitized local path plus SHA-256. Raw attachments are intentionally not transformed or secret-redacted, may contain sensitive or malicious content, and must never be executed. One explicit Jira insertion reads at most 100 files, 25 MiB per file, and 100 MiB total. Provider reads remain pinned to the configured origin when credentials are sent. Kronos does not fetch GitLab job traces or Jenkins console logs.

Use **Kronos: Setup** for a guided dashboard covering Claude, discovery folders, registered projects, Jira, monitoring providers, and private local state. **Kronos: Doctor** opens a dedicated readiness dashboard with blocked and warning checks first, safe repair links, and no credential values. Both panels can refresh in place and link to the Jira board or relevant Settings. Use **Kronos: Settings** to change:

- project discovery roots selected through the native multi-folder picker, plus depth and result limit;
- whether completed Jira work is hidden by default and any team-specific completed status names;
- the validated Claude command, terminal name, and launch-directory behavior;
- Jira refresh and managed-provider polling intervals.

## Install for Local Evaluation

```bash
npm install
npm run compile
npm run package
code --install-extension kronos-0.1.0.vsix --force
```

Reload VS Code, open the Kronos activity icon, and confirm exactly three views appear: **Work**, **Sessions**, and **Attention**.

For an isolated local fixture:

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

Fixture data is synthetic. Do not use it to post or mutate real provider state.

## Developer Validation

These commands validate and package the extension itself; they are run manually by a developer. The installed Kronos runtime never invokes project tests, builds, or deployments.

```bash
npm run compile
npm test
npm run webview:dom
npm run feedback:smoke
npm run package
npm run feedback:ready
```

Use [HUMAN_FEEDBACK_CHECKLIST.md](HUMAN_FEEDBACK_CHECKLIST.md) for the terminal-first evaluation pass.
