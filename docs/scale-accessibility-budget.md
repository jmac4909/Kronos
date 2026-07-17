# Scale, Responsiveness, and Accessibility Budget

This is the checked G17 budget for the terminal-first preview. Limits are safety ceilings, not targets. Kronos summarizes or truncates before a collection can grow without bound, and provider reads remain explicit, read-only, origin-pinned, and subject to their transport timeout.

## Collection and read budgets

| Surface | Shipped bound | Presentation rule |
| --- | --- | --- |
| Jira Work | 500 issues by default, 10 pages, 50 rows per page, 10 MiB total response, 15 seconds per request | Work tree and board render the bounded catalog; completed work is hidden by default, not discarded. |
| Jira comments | 100 pages of 100 newest-first comments, 20 MiB total response | Retained comments are restored to chronological order and partial reads are labeled. |
| Jira attachments | 100 fetches, 25 MiB each, 100 MiB total | Raw bytes are private artifacts; the UI renders metadata and a reference instead of the payload. |
| Registered projects | 200 canonical registrations | Project views show registered projects first; setup renders all 200 and discovery remains separate. |
| Project discovery | 50 roots, depth 5, 500 results, 2,000 entries per directory, 5,000 visited directories | Results stop at the configured bound and report truncation. |
| Work sessions | 200 rows by default, 1,000 hard maximum; each record has 64 terminals, 64 provider bindings, 200 artifacts, and 32 warnings | Views load newest records first; terminal contents are never read. |
| Attention ledger | 2,000 newest ledger rows, 50 MiB read ceiling, 16 KiB per event | Only the newest unacknowledged state per logical provider stream renders. |
| Exact Attention event context | One retained transition; 32 KiB JSON and 48 KiB Markdown | Right-click review freezes only the selected GitLab MR, Jenkins, or SonarQube event and inserts one inert reference without a provider read. |
| Session history | Caller reads 1,000 newest events; Markdown sorts normalized event times and renders the newest 500 | A truncation line states how many history items were omitted; caller-owned input order is unchanged. |
| Local Git | 500 changed paths and 512 KiB diff text | Summary renders before the immutable full bounded artifact reference. |
| Context composer | 20 evidence summaries, 20 warnings, 2,000 operator-focus characters | Full evidence stays in private artifacts; insertion is one inert non-submitting reference. |
| Team Prompt Library | 20 local paths, 10 remote URLs, 20 eligible files per directory, 100 prompts per library, 500 prompts total, 1 MiB and 10-second remote read per manifest, 20,000 characters per reviewed body | Explicit refresh builds one searchable Quick Pick; the full reviewed prompt remains in a private immutable snapshot and insertion is one inert non-submitting reference. |
| Context Basket | 20 selected references, 256 KiB mutable state, 20 source warnings, 4,000 operator-focus characters | Renders provenance/freshness/size/hash summaries; immutable source payloads are referenced, not copied. |
| Local evidence search | 2,000 ephemeral entries: 200 projects, 200 sessions, 300 ticket contexts, 400 provider bindings, 400 artifacts, 500 events | Rebuilt for each Quick Pick; no terminal object or content is an index input. |
| Local handoff | 100 selected references from at most 100 context and 500 audit candidates; 2 MiB per Markdown/JSON file | Exports redacted references, summaries, and hashes only; source payloads remain in their private artifacts. |
| Project branch profiles | 20 profiles per registered project and 20,000 input characters | Exact MR branch match wins, then one explicit active fallback; profiles route reads but never switch Git. |
| GitLab | 20 pages by default, 5 MiB per response, 30 MiB aggregate | Missing optional discussions, approvals, jobs, or tests produce partial evidence rather than a false success. |
| Jenkins | 5 MiB per response, 500 failed test cases, 200 stages, 1,000 artifacts, 500 changes | Optional JUnit/Pipeline endpoints may be unavailable; summaries remain bounded. |
| SonarQube | 20 issue pages, 100 issues per page, 2,000 issues, 50 MiB aggregate | The view renders gate/measures and a small issue summary, with the validated dashboard link for detail. |
| Provider polling | One in-process poll promise and one cross-window lease; minimum configured interval 15 seconds | Overlapping polls coalesce. A contending window does not duplicate provider reads. |

## Responsiveness budgets

The deterministic local scale gate uses deliberately generous CI ceilings so it catches accidental quadratic or unbounded work without becoming a timing lottery:

- Build a 500-ticket board with long summaries and labels in under 2,000 ms and under 8 MiB of HTML.
- Filter and derive facets for 500 tickets in under 1,000 ms.
- Render a 2,000-item Session history into its exact newest 500-item Markdown summary in under 1,000 ms and under 2 MiB without mutating the source.
- Render all 200 project-integration forms in under 2,000 ms and under 8 MiB, and project 200 maximally rich Session summaries in under 1,000 ms with each tooltip below 10,000 characters.
- Render at most 20 bounded evidence summaries and 20 warnings from an oversized provider preview in under 1,000 ms and under 256 KiB; the full payload remains available only through its private artifact reference.
- A newer explicit Jira refresh aborts the prior transport signal and owns the only state write. Scheduled refreshes and overlapping provider polls coalesce.

These are extension-host construction budgets, not claims about network latency or VS Code paint time. Real VS Code zoom, screen-reader, Windows, and live-provider behavior remains a human gate in `HUMAN_FEEDBACK_CHECKLIST.md`.

## Accessibility contract

- Every interactive form control has visible text or an associated label.
- Jira cards support Enter and Space, expose a descriptive accessible name, and retain visible `:focus-visible` treatment.
- Dynamic Work state and filter counts use polite status regions; failures use an assertive alert.
- Shared CSS uses VS Code theme variables, an explicit forced-colors rule, wrapping/overflow containment, and a single-column narrow-panel breakpoint.
- Color is supplementary: status text, icons, headings, and borders carry the same meaning.
- Large provider evidence is represented by summaries and operator-opened artifacts; it is not injected into the DOM wholesale.

The automated gate checks markup and CSS invariants. Keyboard traversal, focus order, screen-reader speech, high-contrast appearance, 200% zoom, and narrow-panel usability still require the recorded real-VS-Code pass.
