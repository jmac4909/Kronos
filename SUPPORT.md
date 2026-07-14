# Support and Feedback

Kronos is a local-evaluation preview. It does not currently have a production support channel or service-level commitment.

## Before Opening an Issue

Run:

```bash
npm ci
npm test
npm run feedback:smoke
```

For installation or packaging problems, also run `npm run package` and record the command's final summary.

## Useful Issue Details

Include:

- Kronos commit or package version;
- operating system, VS Code version, and Node.js version;
- the affected surface: Work, Sessions, Attention, Setup, Doctor, or context composer;
- concise reproduction steps using synthetic data;
- expected and observed behavior;
- the relevant validation command and whether it passed.

Never attach credentials, provider payloads, raw Jira attachments, terminal transcripts, employer identifiers, private repository paths, or a full `~/.kronos` directory. Reduce logs to the smallest sanitized excerpt that demonstrates the problem.

Use a private GitHub security advisory instead of an issue when the report involves credential handling, origin pinning, local file permissions, untrusted provider content, terminal execution, or another security boundary.

## Current Scope

Kronos supports local source evaluation. Marketplace installation, production operation, live-provider compatibility, adoption, and cross-platform certification are not currently promised.
