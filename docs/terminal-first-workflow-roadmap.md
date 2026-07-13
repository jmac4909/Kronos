# Terminal-First Workflow Roadmap

## Product Principle

Kronos organizes and hydrates work while the operator keeps ownership of the interactive terminal. Context actions may prepare local artifacts and insert editable text, but they must not press Enter, replace the terminal, or silently start an agent run.

## Slice 1: Jira Context Insert

Implemented in this change:

- `Insert [JIRA-123]` from the Jira Board and Ticket Detail.
- Fresh native Jira REST hydration for all issue fields, field names/schema, paginated comments, and attachment metadata.
- Explicit partial-state warnings when comment limits/failures occur or attachment bodies are not downloaded.
- A local per-user context artifact with an untrusted-data prompt boundary.
- One shell-inert reference line inserted into the operator's selected terminal without submission.

## Slice 2: MR and Pipeline Watch

Reuse the current review poller, GitLab MR/notes/discussions/approvals reads, and Jenkins build status reads. Add:

1. A normalized monitor event for MR, review, pipeline, job, test, build, and deploy transitions.
2. Native GitLab head-pipeline, pipeline-job, and test-report reads. Fetch job logs only on demand and redact likely credentials.
3. Richer Jenkins snapshots: build number, state, building flag, timestamp, duration, result URL, and failed-stage summary when available.
4. Review notifications for meaningful transitions such as approval, requested changes, new unresolved discussion, pipeline failure, recovery, and deployment completion.
5. `Insert [MR-123]` / `Insert Pipeline Context` actions that fresh-fetch one linked work item, write a local artifact, and insert an editable non-submitting terminal reference.
6. Continue monitoring through `await_review` and `deploy_monitor` until the relevant CI/deploy reaches a terminal state.

The first implementation should notify on transitions, not every poll. A failed pipeline notification should offer `Open Pipeline`, `Insert Context`, and `Acknowledge`, while leaving remediation to the interactive terminal.

## Slice 3: Work Session Organizer

Create a durable work-item workspace keyed by Jira ticket, not by a one-click agent run. It can associate:

- operator-selected terminal/session identity and working directory;
- Jira, MR, pipeline, build, test, deploy, and evidence snapshots;
- commits and branches observed for the work item;
- decisions, corrections, handoffs, and human approvals;
- generated context artifacts and their freshness/completeness.

Kronos should observe session metadata and offer navigation; it should not capture terminal contents or take control of the PTY.

## Slice 4: Auditable Data and Test Context

Add a redacted append-only `monitor-events.jsonl` ledger containing timestamps, provider/project IDs, before/after states, notification outcome, and artifact paths. Do not record tokens, authorization headers, raw logs, or signed URL query strings.

Database context should use named, read-only, allowlisted query profiles with row/byte limits and provenance. Test context should record the command, environment, result, duration, and artifact path. Both should produce local context artifacts that can be inserted into the same operator-owned terminal workflow.

## Non-Negotiable Safety Rules

- Never auto-submit inserted terminal text.
- Never send raw provider text directly to a PTY.
- Treat ticket, review, log, and attachment content as untrusted prompt data.
- Pin credentialed requests to configured provider origins.
- Bound pages, bytes, logs, attachments, and retained history.
- Make partial or stale context visible instead of silently truncating it.
- Require explicit confirmation for provider mutations, deploys, restarts, cleanup, or database writes.
