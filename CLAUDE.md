# Kronos — Terminal Work Companion

Kronos is a terminal-first VS Code extension for a Jira board and operator-controlled Claude sessions. The operator may attach an existing terminal or explicitly create a standalone or ticket-linked Claude terminal. Kronos also reads bounded provider context, inserts editable references without submission, monitors provider state, and keeps a private local audit.

## Repository Safety Notes

Keep credentials, provider payloads, context artifacts, work-session records, generated feedback state, and machine-specific paths out of Git. Work from a normal clone of this repository; do not assume a particular host, home directory, or workspace layout.

Read `README.md`, `docs/terminal-first-product-contract.md`, and `HUMAN_FEEDBACK_CHECKLIST.md` before significant work.

## Non-negotiable Runtime Boundary

Kronos never launches automatically, reads terminal contents, submits inserted context, runs arbitrary project commands, mutates Git, mutates a provider, or closes the operator's terminal.

There are exactly two intentional terminal-write boundaries:

- `src/services/terminalContextInsertion.ts` inserts a reviewed provider reference and must always pass `false` as the execution flag.
- `src/services/claudeTerminalLauncher.ts` is called only by explicit **New Claude** or **Start Claude for Ticket** actions. It validates command, name, and cwd before terminal creation; accepts only a `claude` or `claude-*` executable with narrowly allowlisted interactive flags; rejects positional prompts/subcommands and permission-escalating/tool/MCP/plugin flags; focuses the new VS Code terminal; and passes `true` only for that validated Claude start command.

Runtime code uses only the VS Code API and Node built-ins. Do not add runtime dependencies, external helper scripts, subprocess libraries, generic command execution, provider POST/PUT/PATCH/DELETE requests, or project automation.

## Product Shape

- `src/extension.ts` is a thin activation export.
- `src/terminalFirstExtension.ts` owns the audited public command surface.
- Work renders a Jira board with search, status, project, and label filters. Completed rows are hidden by default and explicitly showable.
- `src/views/ManagedSessionTreeProvider.ts` renders standalone and ticket-linked operator-managed sessions.
- `src/views/AttentionTreeProvider.ts` renders unacknowledged provider transitions.
- `src/state/TerminalFirstState.ts` refreshes the bounded Jira Work catalog through native GET requests.
- Jira normalization recursively removes null/blank/empty values while preserving meaningful `false` and `0` values.
- `src/services/*RestClient.ts` contains credential-pinned, bounded provider reads.
- context stores write private, content-addressed artifacts under `~/.kronos` or `KRONOS_DIR`.
- work-session and monitor stores persist terminal metadata and provider transitions, never terminal content.

The activity container exposes exactly three views: Work, Sessions, and Attention. Ticket association is created only by a ticket-triggered action; **New Claude** must never invent a Jira key. Every visible capability must stay within the explicit Claude launch, read, insert, monitor, and audit product boundary.

## Build and Validation

```bash
npm install
npm run compile
npm test
npm run feedback:smoke
npm run package
npm run feedback:ready
```

`npm test` enforces the manifest allowlist, explicit-launch boundary, prompt/context governance, strict TypeScript compilation, focused unit tests, and dependency-free webview behavior.

For an isolated manual fixture:

```bash
npm run feedback:state:force
KRONOS_DIR="$PWD/.kronos/feedback-state" code .
```

The fixture uses `.invalid` provider URLs and must not contact or mutate real systems.

## Credentials and Local Data

Kronos loads provider values from the extension process environment and, when present, `~/.kronos/.env` (or `KRONOS_ENV_FILE`). Supported provider variables are documented in `README.md`. Claude command/name/cwd settings are operator-controlled but must pass the launcher validation; never weaken them into a general shell surface. Never log, persist, insert, or commit credential values.

The default data directory is `~/.kronos`; `KRONOS_DIR` may point to an isolated directory.
