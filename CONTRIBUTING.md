# Contributing

Kronos is source-available for evaluation; it is not currently an open-source project. Feedback and reproducible bug reports are welcome. Before preparing a code contribution, open an issue and obtain written authorization for that contribution under the repository's license.

## Development Setup

```bash
npm ci
npm test
```

The installed extension must retain zero third-party runtime dependencies. TypeScript and test/package tooling may be development dependencies, but runtime code must use only the VS Code API and Node built-ins.

## Non-negotiable Product Boundary

Changes must not add:

- automatic terminal launch or a generic command runner;
- terminal input, output, or scrollback capture;
- automatic submission of inserted context;
- workspace test, build, scan, deployment, or remediation execution;
- Git mutations;
- provider write operations;
- credential values in state, artifacts, URLs, logs, or UI;
- terminal closing or hidden ownership transfer.

The two permitted terminal-write paths are the explicitly validated Claude launch and reviewed insertion through `sendText(..., false)`. Read the [product contract](docs/terminal-first-product-contract.md) before changing either path.

## Validation

Before proposing a change, run:

```bash
npm ci
npm test
npm run feedback:smoke
npm run package
npm run feedback:ready
git diff --check
```

Use [HUMAN_FEEDBACK_CHECKLIST.md](HUMAN_FEEDBACK_CHECKLIST.md) for changes that affect visible UI, terminals, provider behavior, reattachment, or Windows-specific file handling.

## Public-Surface Hygiene

- Use only `.invalid`, `.example`, or `.test` provider domains in fixtures.
- Use synthetic `DEMO-*` ticket keys and generic project names.
- Do not commit `.env` files, provider payloads, raw attachments, `.kronos`, `.claude`, `.vscode-test`, build output, packaged VSIX files, or machine-specific paths.
- Construct credential-shape redaction fixtures at runtime so repository secret scanners do not see realistic token literals.
- Do not weaken `npm run public:check`; add a focused regression when expanding it.

## Change Quality

Keep changes focused, preserve the three-view product shape, update documentation when behavior changes, and describe both automated evidence and any remaining human validation honestly.
