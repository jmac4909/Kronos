# Terminal-First Managed Work Sessions

Status: implemented for evaluation on the isolated `feature/terminal-first-context` branch.

## Product Contract

Kronos organizes a ticket and its provider evidence around a terminal the operator already owns. It does not replace the terminal with a one-click agent run or take ownership of the PTY.

The operator chooses the terminal, edits the inserted reference, decides when to press Enter, directs the interactive agent, and can detach or stop Kronos management without closing the terminal. Kronos records terminal metadata and provider evidence, but never captures terminal input, output, or scrollback.

## Operator Workflow

1. Focus the interactive terminal you want to keep using.
2. From a ticket, click **Manage This Terminal**, or run **Kronos: Manage Active Operator Terminal**. Kronos creates or reopens one durable work session for the ticket and records the terminal name and process identity when available, together with the ticket's configured project context.
3. Insert the evidence needed for the next instruction:
   - **Insert `[JIRA-123]`** fetches Jira ticket context.
   - **Insert `[MR-77]`** fetches the linked GitLab merge request, review, pipeline, job, and test context.
   - **Insert `[CI-JIRA-123]`** fetches linked Jenkins and SonarQube evidence.
4. Review or extend the inserted line, then press Enter yourself. Kronos calls VS Code terminal insertion with execution disabled; it never submits the line.
5. Keep working interactively. Kronos polls provider bindings in the background and reports meaningful structural transitions without running remediation commands.
6. Use the Kronos Sessions tree to focus, reattach, detach, audit, or stop managing the work session. Stopping management disables its monitoring and leaves the operator terminal open.

For an active managed session, context is inserted only into its attached terminal. If that binding changes while data is being fetched, insertion is canceled and the operator must focus or reattach the intended terminal. For an unmanaged ticket, the explicitly focused active terminal is used.

## Implemented Context Actions

### Jira: `[JIRA-123]`

The Jira action fresh-fetches the issue through native Jira REST when configured. It normalizes the title, summary, description, all returned issue fields plus field names/schema, paginated comments, labels, components, versions, and attachment metadata. Attachment bodies are deliberately not downloaded; a ticket with attachments is marked partial and says that only metadata was retained. REST failure or unavailable credentials falls back to cached Kronos ticket data and marks the artifact partial.

The Jira Board and Ticket Detail expose the ticket-scoped insert button, so a click prepares the artifact and inserts a line beginning with the ticket key into the intended terminal.

### GitLab: `[MR-77]`

The GitLab action fresh-fetches the linked merge request and bounded review/evidence data: MR metadata and description, notes, discussions, approvals, diffs, pipeline history, selected pipeline, jobs, test summary, and test report. Pagination, response-byte budgets, item limits, and text budgets are reflected in completeness warnings when anything is unavailable or truncated.

The action is available from ticket details and MR Autopilot when the ticket has a valid MR IID and a configured GitLab project ID/path or parseable MR URL.

### Jenkins and SonarQube: `[CI-JIRA-123]`

The combined CI action can include either provider or both:

- Jenkins contributes bounded build metadata, result/building state, causes, changes, artifacts, stage results, and test results. Jenkins console and job logs are never fetched or saved.
- SonarQube contributes the project/branch quality gate, selected measures, and bounded paginated unresolved issues.

If one provider fails, the other provider's evidence can still be saved with an explicit partial warning. If neither can be fetched, no reference is inserted.

## Managed Monitoring

Active work sessions automatically receive provider bindings from their ticket and project configuration. Monitoring starts with Kronos, repeats at `kronos.reviewPollIntervalSec`, and can be run immediately with **Kronos: Poll Managed Providers**. Polling is read-only and compares compact normalized digests; it does not keep full provider responses as monitoring baselines.

The first successful observation establishes a baseline. Later polls record and notify only structural transitions:

- GitLab: new pipeline, failed/canceled/succeeded/recovered pipeline, newly failed or recovered blocking jobs, and failed or recovered tests.
- Jenkins: new build, failed/unstable, succeeded/recovered, newly failed or recovered tests, and newly failed or recovered stages.
- SonarQube: quality-gate failure/recovery and unresolved-issue increases/decreases.

A transition notification can open the relevant provider page, insert fresh MR or CI context, or be acknowledged. Notification display and acknowledgement are also auditable events. Provider errors do not create false recovery events: the last valid provider digest is retained while another provider is refreshed.

Each work session exposes monitoring readiness in the Sessions tree and audit view:

- `healthy`: all configured provider contexts polled successfully;
- `partial`: at least one provider polled while another failed or was skipped;
- `blocked`: nothing could be polled because configured providers failed or were invalid;
- `idle`: the session had no provider work to poll.

The same views show the last attempt, last successful provider poll, summary, provider bindings, artifact count, and terminal attachment state.

After an extension reload, Kronos restores a live terminal binding only when one existing terminal uniquely matches the saved name and process identity. It does not create a substitute terminal when no safe match exists.

## Durable State and Audit

By default, terminal-first data lives under `~/.claude/kronos` (or the explicitly configured `KRONOS_DIR`):

- `work-sessions/<session-id>/session.json` stores the ticket, project, operator-terminal metadata, provider bindings, latest context references, monitoring configuration, and readiness.
- `jira-context/`, `gitlab-context/`, and `ci-context/` contain normalized JSON evidence and prompt-boundary Markdown.
- per-session GitLab and CI digest files store compact monitoring baselines.
- `monitor-events.jsonl` is the append-only event ledger for session creation, terminal attachment/detachment, context insertion, baselines, provider transitions, notifications, acknowledgements, and operator decisions.

Context files are private and content-addressed as `context-<hash>.json` and `prompt-<hash>.md`. Existing content-addressed files are validated and reused, never overwritten; changed content creates a new immutable artifact so older audit references remain meaningful. On POSIX systems, Kronos enforces private directory/file permissions (`0700`/`0600`) and rejects symbolic-link or unsafe-path substitutions.

**Kronos: Open Managed Work Session Audit** opens a rendered, escaped Markdown view of current readiness, artifacts, warnings, and the recent event timeline. The audit explicitly states that terminal contents were not collected.

## Commands

| Command title | Command ID | Purpose |
| --- | --- | --- |
| Kronos: Manage Active Operator Terminal | `kronos.manageActiveTerminal` | Create/reopen a ticket work session and attach the focused terminal. |
| Kronos: Insert Jira Context in Active Terminal | `kronos.insertJiraContext` | Fetch, save, and insert `[JIRA-123]` without submission. |
| Kronos: Insert GitLab MR and Pipeline Context | `kronos.insertGitLabContext` | Fetch, save, and insert `[MR-77]` without submission. |
| Kronos: Insert Jenkins and SonarQube Context | `kronos.insertCiContext` | Fetch, save, and insert `[CI-JIRA-123]` without submission. |
| Kronos: Poll Managed Providers | `kronos.pollManagedWorkSessions` | Poll GitLab, Jenkins, and SonarQube bindings now. |
| Kronos: Open Managed Work Session Audit | `kronos.openWorkSessionAudit` | Open readiness, artifacts, and audit events. |
| Kronos: Focus Managed Terminal | `kronos.focusWorkSessionTerminal` | Focus the live operator terminal bound to a work session. |
| Kronos: Reattach Active Terminal to Work Session | `kronos.reattachWorkSessionTerminal` | Bind the focused terminal without reading or controlling it. |
| Kronos: Detach Terminal from Work Session | `kronos.detachWorkSessionTerminal` | Stop managing that binding and leave the terminal open. |
| Kronos: Stop Managing Work Session | `kronos.closeWorkSession` | Disable management/monitoring while leaving the terminal open. |

## Security and Ownership Boundaries

- Terminal context insertion is explicit, one line, shell-inert, path-validated, and always non-submitting.
- Kronos never reads terminal input/output, captures scrollback, creates a replacement PTY for a managed work session, sends provider-supplied commands, or closes the operator's terminal.
- Provider credentials, authorization headers, cookies, tokens, credentialed URLs, and signed secret query values are not written to artifacts or audit metadata.
- Provider text is treated as untrusted input. It is normalized, control-stripped, secret-redacted, bounded, and wrapped in a unique prompt-injection boundary before it can be referenced from a terminal.
- GitLab variables, GitLab job traces, Jenkins console/job logs, and Jira attachment bodies are not fetched for this workflow.
- Credentialed provider requests are constrained to their configured origins; redirect or returned-URL behavior cannot silently move credentials to another host.
- Truncation, unavailable endpoints, metadata-only attachments, and provider failures are visible as partial completeness/readiness, never silently represented as complete.
- This workflow performs provider reads only. It does not merge, deploy, restart, clean up, mutate Jira/GitLab/Jenkins/SonarQube, or write to a database.

## Future Design: Custom Database Context Connector (Not Implemented)

A database connector should extend the same explicit artifact-and-reference workflow, not turn ticket text or chat text into arbitrary SQL.

The first safe version should have these constraints:

1. **Named read-only profiles.** A project binds a logical profile ID to a database type and secret reference. DSNs, passwords, certificates, and tokens stay in the operating-system/approved secret store and never enter work-session records, artifacts, audit metadata, or prompts.
2. **Database-enforced read-only access.** Use a dedicated least-privilege database role plus a read-only transaction. Reject writes, DDL, multiple statements, stored-procedure calls, and any operation outside the connector's read-only capability even if a query profile is misconfigured.
3. **Allowlisted query profiles.** Operators select a versioned query ID such as `ticket-order-summary`; Jira/provider text can supply only schema-validated parameters. Do not accept free-form SQL from a ticket, attachment, comment, model, or inserted prompt. Use bound parameters, never string interpolation.
4. **Allowlisted data scope.** Each query declares permitted databases, schemas, tables/views, columns, parameter types, and caller/project bindings. The connector rejects scope expansion rather than guessing.
5. **Hard execution limits.** Enforce statement timeout, row count, response-byte, cell-size, and concurrency limits. No unbounded pagination, exports, large-object downloads, or automatic retries that multiply load.
6. **Redaction before persistence.** Apply configured sensitive-column classifications and value-pattern redaction before results reach disk or chat. Drop denied columns entirely. Never preserve raw driver errors that may include a connection string or SQL parameters.
7. **Provenance and completeness.** Save the logical database/profile ID, query profile/version, redacted parameter summary, execution time, duration, returned/truncated row counts, schema version, and warnings. Do not save the credential source or secret value.
8. **Explicit operator insertion and audit.** A future action such as `Insert [DB-JIRA-123]` would execute one selected allowlisted query, write a private content-addressed artifact with an untrusted-data boundary, append a redacted audit event, and insert only a non-submitting reference into the operator-owned terminal.
9. **No background data polling initially.** Start with explicit operator-triggered reads. Any later monitoring must compare redacted bounded digests, use a separately approved cadence, and avoid retaining full result sets as baselines.

Database writes, migrations, production repair, unrestricted exploration, and model-selected SQL remain outside this connector. They require a separate explicitly approved workflow with stronger authorization and review.
