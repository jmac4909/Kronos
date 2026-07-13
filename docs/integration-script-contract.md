# Kronos Integration Script Contract

Kronos does not ship provider credentials. Runtime scripts are discovered from `KRONOS_SCRIPTS_DIR` or `~/.claude/scripts`, and sessions inherit the VS Code extension process environment. On activation the extension reads `~/.claude/.env` and merges values that are not already present in `process.env`, so Doctor checks, MR polling, integration adapters, and dispatched sessions can use the same credential source.

Required scripts:

- `kronos_state.py`
- `pipeline_monitor.py`

Script commands must print JSON to stdout and write diagnostics to stderr. Non-zero exits should include a concise stderr message. Credential values must come from inherited environment variables and must never be echoed, embedded in script argv, or written to Kronos state files.

Kronos: Integration Contracts runs a local contract harness over this file and the required script bundle. It checks that the documented command/API shapes match the extension calls and that required scripts are installed; it does not call enterprise providers or require credentials.

## Native Jira Ticket Context API

The interactive `[JIRA-123]` context action hydrates the selected issue through native Jira REST using `JIRA_BASE_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN`. Credentialed reads are pinned to the configured base URL, which must use HTTPS except for loopback development. It fetches the complete issue field object plus field names/schema, then paginates comments into a local per-user context snapshot. Credentials and authorization headers must never be written to the snapshot or prompt artifact.

```text
GET /rest/api/3/issue/<ticket_key>?fields=*all&expand=names,schema
GET /rest/api/3/issue/<ticket_key>/comment?startAt=<offset>&maxResults=100&orderBy=created
```

The generated prompt includes Jira field text, all fetched comments, and attachment metadata. Attachment bodies remain metadata-only until a separately bounded and allowlisted download/extraction flow is implemented, so tickets with attachments are explicitly marked partial. Comment collection has per-response, cumulative-response, and page-count safety limits; earlier pages are retained and marked partial if a later page fails. Artifacts use `0700` directories and `0600` files on POSIX and inherit the user's profile ACL on Windows. The terminal receives only a single-line reference to the prompt artifact and Kronos never submits it automatically; if the active terminal changes during hydration, insertion is cancelled.

## Jira and State Script Commands

Kronos retains the script-backed Jira refresh path for the lightweight board/index state and as a legacy comment fallback. The fallback comment command is:

```text
kronos_state.py --ticket-comments <ticket_key>
```

The output may be either an array of comments or an object with `comments`. Each comment may include `body`, `renderedBody`, `created`, `author`, and `authorName`.

`kronos_state.py` also owns state refresh, project discovery, queue operations, and morning brief commands through `src/services/stateScriptAdapter.ts`. Keep those commands compatible with that adapter rather than calling script flags directly from the extension.

## GitLab Merge Request API

GitLab merge request polling uses native REST calls with `GITLAB_TOKEN` and `GITLAB_API_BASE_URL` or `GITLAB_BASE_URL`. Registered projects should define `config.gitlab_project_id`; if absent, Kronos can derive the encoded project path from a parseable GitLab MR URL. Review tickets should include `mr.iid` and at least one linked project.

```text
GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>
GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/notes
GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/discussions
GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/approvals
GET /api/v4/projects/<project_id>/merge_requests/<mr_iid>/diffs
```

MR status reads should include MR state, review status or approval data, comment metadata from notes, and discussion metadata when available. Diff reads normalize GitLab `diffs` or legacy `changes` into `files`. Branch resolution uses `source_branch` and `target_branch` from the merge request record.

Project setup may resolve project IDs with:

```text
GET /api/v4/projects/<namespace%2Fproject>
```

The response should include numeric `id`.

## Jenkins Build API

Jenkins build polling and trigger calls use native REST calls. Registered projects should define `config.jenkins_url` with the job URL Kronos should poll or trigger. `JENKINS_URL` may provide the Jenkins base URL for relative job paths. `JENKINS_USER` or `JENKINS_USERNAME` plus `JENKINS_API_TOKEN` or `JENKINS_TOKEN` are used for Basic auth when present; a token without a user is sent as a bearer token. Credential values must stay in the inherited environment and must not be written to state, logs, or command arguments.

```text
GET <jenkins_job_url>/api/json?tree=lastBuild[number,result,building,url,timestamp,duration],lastCompletedBuild[number,result,building,url,timestamp,duration],number,result,building,url,timestamp,duration
POST <jenkins_job_url>/build
POST <jenkins_job_url>/buildWithParameters
```

Build status polling normalizes the latest Jenkins build into ticket `build.number`, `build.status`, and `build.url`. Trigger calls should return the Jenkins queue location when Jenkins provides it.

## SonarQube Commands

Kronos routes SonarQube lookup and report data through `pipeline_monitor.py`:

```text
pipeline_monitor.py --find-sonar-key <project_name>
pipeline_monitor.py --sonar-branches <sonar_project_key>
pipeline_monitor.py --sonar-gate <sonar_project_key> --branch <branch>
pipeline_monitor.py --sonar-measures <sonar_project_key> --branch <branch>
pipeline_monitor.py --sonar-issues <sonar_project_key> --branch <branch>
```

`--find-sonar-key` should return `sonar_project_key`. `--sonar-branches` should return `branches`, where each branch has `name`, optional `isMain`, and optional quality gate status. The gate, measures, and issues commands may return provider-native JSON; Kronos keeps those payloads unknown until the report view normalizes the fields it renders.

## Dispatch Environment

Dispatched Claude sessions inherit the VS Code extension process environment. Kronos sets a run-scoped temporary directory with `KRONOS_RUN_TMPDIR`, `TMPDIR`, `TMP`, and `TEMP` so generated helper scripts can stay isolated and be cleaned up after the run. Operators may provide provider tokens through the parent VS Code environment, OS credential setup, or `~/.claude/.env`; existing parent environment values take precedence over values from the file.

Because Claude CLI sessions cannot reliably expand values that Kronos loaded from `.env`, the extension also injects a controlled `--append-system-prompt` block with resolved credential command snippets when relevant credentials are present. Examples include a SonarQube `mvn sonar:sonar -Dsonar.host.url=... -Dsonar.token=...` command, DEV/TEST curl auth headers, and a GitLab merge-request creation curl template. Sessions must use only those Kronos-provided snippets when literal credentials are required, must not read `.env`, and must not print, transform, save, or include credential values in reports, evidence, commits, tickets, or comments. Kronos redacts known credential values before writing run stdout/stderr to persisted run logs.
