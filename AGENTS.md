# Kronos Agent Guide

This file is the canonical working guide for automated contributors in this repository.

## Start Here

1. Read `README.md` for the current user workflow.
2. Read `docs/terminal-first-product-contract.md` before changing commands, terminals, provider access, persistence, or visible product behavior.
3. Read `HUMAN_FEEDBACK_CHECKLIST.md` before changing UI, terminal focus/layout, reattachment, live-provider behavior, or Windows file handling.
4. Inspect `git status` before editing. Preserve unrelated user changes and keep the patch within the requested feature boundary.

Treat executable checks as the authority for manifest counts, test totals, coverage, and packaged files. Do not copy those values into this guide because they change frequently.

## Product Boundary

Kronos is a terminal-first VS Code work companion for Jira work and operator-controlled Claude sessions. It may read bounded provider context, explicitly start a validated Claude terminal, insert an editable context reference without submitting it, monitor provider state, and write a private local audit.

The operator always owns the terminal, process, repository, and submission decision. Kronos must never:

- launch automatically or expose a generic command runner;
- read, capture, parse, or summarize terminal input, output, or scrollback;
- submit inserted text or press Enter for the operator;
- run project builds, tests, scans, deployments, database commands, or remediation;
- mutate Git, provider data, merge requests, tickets, or CI state;
- close, interrupt, or kill an operator terminal.

There are only two terminal-write paths:

- `src/services/terminalContextInsertion.ts` inserts a reviewed reference with `sendText(..., false)`.
- `src/services/claudeTerminalLauncher.ts` starts or explicitly resumes a narrowly validated `claude` or `claude-*` command after **New Claude**, **Start Claude for Ticket**, or selection of a disconnected Session. New managed terminals receive a generated Claude UUID; exact resume uses only the current persisted UUID. `src/services/claudeSessionTracking.ts` owns the optional, confirmed user-level `resume|clear` `SessionStart` hook and private lifecycle event validation that can update only the correlated binding's current UUID and saved resume folder after `/resume`, `/clear`, or a later manual `claude --resume`. Legacy Sessions may open Claude's own picker. Permission modes remain typed; bypass mode requires a fresh modal confirmation in `src/terminalFirstExtension.ts`.

Do not create another terminal-write path or weaken either guard.

## Runtime and Data Safety

- Runtime code may use only the VS Code API and Node built-ins. Keep runtime dependencies at zero.
- Provider runtime traffic is credential-pinned, bounded, and read-only. Do not add provider write methods, arbitrary URLs, redirects that cross the configured origin, helper subprocesses, or external scripts.
- Credentials come from the extension environment and the private Kronos environment file. Never log, persist, display, insert, commit, or place credential values in fixtures.
- Private artifacts and state belong under `~/.kronos` or `KRONOS_DIR`, with the existing confinement, size, permission, atomic-write, and redaction checks intact.
- Fixtures use synthetic `DEMO-*` identities and `.invalid`, `.example`, or `.test` domains. They must not contact real systems.
- Do not commit generated output or local state such as `out/`, `.kronos/`, `.claude/`, `.vscode-test/`, coverage output, environment files, or packaged VSIX files.

## Code Map

- `src/extension.ts`: thin activation export.
- `src/terminalFirstExtension.ts`: composition root and audited public command handlers.
- `src/services/terminalFirstCommandRouter.ts`: manifest-to-handler routing contract.
- `src/services/claudeTerminalLauncher.ts`: explicit Claude launch validation and placement.
- `src/services/managedClaudeTerminalIdentity.ts`: non-secret terminal identity markers and strict UUID/editor-session validation; markers are candidates only and must match private Session state before use.
- `src/services/terminalContextInsertion.ts`: non-submitting terminal insertion.
- `src/services/activeAttentionMonitor.ts`: pure project-owned active-delivery visibility, readiness, ordering, and notification policy.
- `src/services/workSessionStore.ts`: durable Session identity plus optional presentation-only display names; renaming must never change terminal, Claude resume, project, Jira, or provider identity.
- `src/state/TerminalFirstState.ts`: bounded Jira Work catalog and refresh state.
- `src/views/`: Work, Sessions, Projects, and Attention presentation.
- `src/services/*RestClient.ts`: bounded provider reads.
- `scripts/`: executable security, contract, behavior, coverage, packaging, and publication evidence.

Keep parsing, normalization, state projection, and policy decisions in focused pure helpers when practical. Keep VS Code handlers thin, redact failures before they reach UI/log/state boundaries, and add a regression at the lowest layer that proves the requested behavior.

## Working Method

- Search with `rg`/`rg --files` and inspect the nearest implementation, tests, and contract language before editing.
- Prefer the smallest coherent change. Avoid opportunistic refactors that obscure the feature or mix unrelated ownership boundaries.
- Update user docs, the product contract, checklist, and executable evidence together when behavior or public surface changes.
- Do not infer a Jira-to-repository link. Only explicit operator linking creates one.
- Keep Projects as the complete monitored inventory and Attention as a derived active-work monitor. A completed Jenkins result or available SonarQube gate may be acknowledged locally by its exact current fingerprint; running/pending checks stay non-dismissible, changed truth reappears, and old transitions never keep finished healthy work visible.
- Track and reposition only Kronos-launched terminals. Never reinterpret or move unrelated user terminals.
- Treat Reload Window and editor/machine restart differently: reconnect a binding and current-or-launch UUID marker match during the same VS Code editor session without sending a command; only an explicit Session selection may resume after the editor session changes. The optional Claude lifecycle hook may reconcile only a matching managed binding from bounded `SessionStart` metadata; it must never read `transcript_path`, terminal input, output, or scrollback. Never infer a Claude conversation from terminal text, name, process ID, or folder.
- Keep visible features inside the explicit read, start, insert, monitor, and audit verbs.
- State remaining live-provider, real-terminal, accessibility, multi-window, or Windows validation honestly; automated mocks are not human signoff.

## Validation

Run the narrowest relevant checks while iterating, then use the full gate before handing off a code change:

```bash
npm ci
npm test
git diff --check
```

Useful focused gates include:

- terminal launch, placement, lifecycle: `npm run terminal:lifecycle`
- command additions or routing: `npm run command:routing`
- view/manifest behavior: `npm run product:surface`
- webview changes: `npm run webview:dom` and `npm run webview:jira-board`
- provider transport/contracts: `npm run provider:transport` and `npm run provider:fixtures`
- persistence and recovery: `npm run persistence:recovery` and `npm run private:files`
- release/package surface: `npm run release:preflight`

For UI, terminal, provider, or release-facing changes, also run:

```bash
npm run feedback:smoke
npm run package
npm run feedback:ready
```

Only commit or push when the user requests publication. Stage only intended files, verify the diff and clean status, push the current branch, then run `npm run publish:verify`. Do not open a pull request, deploy, or mutate external systems unless separately requested.
