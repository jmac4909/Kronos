# Kronos — Terminal Work Companion

<p align="center">
  <img src="media/kronos-marketplace-icon.png" alt="Kronos terminal companion icon" width="112">
</p>

<p align="center">
  A terminal-first VS Code companion that brings Jira, GitLab, Jenkins, and SonarQube evidence into operator-controlled Claude sessions.
</p>

<p align="center">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-3178C6">
  <img alt="VS Code 1.85 or newer" src="https://img.shields.io/badge/VS%20Code-%5E1.85-23A8F2">
  <img alt="Zero third-party runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-22C55E">
  <img alt="222 automated local tests" src="https://img.shields.io/badge/test%20suite-222%20local-22C55E">
  <img alt="Preview status" src="https://img.shields.io/badge/status-preview-F59E0B">
</p>

> **Preview software.** Kronos is ready for local evaluation, not represented as a Marketplace release or production service. The repository is source-available for portfolio review under the included [source-review license](LICENSE).

![Kronos Jira Work Board with synthetic tickets, sessions, and provider state](docs/assets/kronos-work-board.png)

Kronos solves a narrow enterprise-development problem: the evidence needed for a coding task is spread across work tracking, source control, builds, and code quality tools, while the actual AI-assisted work happens in an interactive terminal. Kronos organizes that evidence without turning the editor into an autonomous executor.

## What Kronos Delivers

| Surface | Outcome |
| --- | --- |
| **Work** | Search and filter Jira work, see current/empty/loading/partial/stale/error refresh state without losing the last good result, explicitly link the right local project and branch, then open a focused ticket workspace. Shared Jira keys never infer a repository. |
| **Sessions** | Organize operator-owned Claude terminals by local project, attach multiple Jira contexts when useful, and never read terminal contents. |
| **Projects** | Track each registered repository's current branch and clean/dirty status, then open bounded diff, MR, CI, and provider actions. |
| **Attention** | Show the newest meaningful provider state by project, distinguish GitLab MR, Jenkins, and SonarQube with separate icons, use shared green/yellow/red state colors, resurface still-open MRs after the next poll, and retain full history in the private audit. |
| **Context composer** | Review fetched evidence, edit the focus, and place one shell-inert line in the chosen terminal with submission disabled. |
| **Context Basket** | Select multiple Jira, MR, CI, and local Git artifacts, review provenance/freshness/completeness/conflicts together, then place one reference-only bundle without copying or submitting provider content. |
| **Local search** | Use one bounded Quick Pick to find session titles, explicit Jira contexts, registered projects/branches, provider bindings, event summaries, and artifact labels without reading terminal content. |
| **Handoffs and branch profiles** | Export selected context/audit references and hashes to a private local Markdown/JSON pair, and explicitly route Jenkins/SonarQube reads for known branches without switching Git or posting anywhere. |

### A 60-second workflow

1. Select a Jira ticket and its local project.
2. Attach a terminal you already own, or explicitly choose **Start Claude for Ticket**.
3. Fetch bounded Jira, GitLab, Jenkins, or SonarQube evidence.
4. Review the normalized evidence as untrusted data and edit the operator focus.
5. Place one source immediately, or add several sources to **Context Basket** and edit one combined focus.
6. Choose **Place in Terminal**. Kronos inserts one reference with execution disabled.
7. Decide whether to press Enter yourself; later provider changes appear in **Attention** and the session audit.

![Kronos two-step context review and post-insertion terminal sequence, using synthetic data](docs/assets/kronos-context-composer.png)

The second render is an explicitly labeled interaction sequence: the composer is shown before insertion, and the terminal panel shows the state after the composer closes. Both renders use deliberately synthetic `DEMO-*` records and example-only provider state. They contain no live credentials, employer data, usernames, or machine paths.

## Human-in-the-Loop by Construction

Kronos has two intentional terminal-write boundaries:

| Boundary | Allowed behavior | Guardrail |
| --- | --- | --- |
| Explicit Claude launch | Create and focus a new terminal after **New Claude** from Sessions/a Project or **Start Claude for Ticket** | Accepts only a validated `claude` or `claude-*` executable, narrowly allowlisted interactive flags, and one typed permission mode; experimental bypass requires a modal confirmation every time |
| Context insertion | Place a reviewed reference and editable focus in an attached terminal | Uses shell-inert quoting and VS Code's `sendText(..., false)`; Kronos never presses Enter |

Kronos reads, organizes, inserts, monitors, and audits. It does **not**:

- launch automatically or expose a generic command runner;
- read terminal input, output, or scrollback;
- submit inserted text;
- run project tests, builds, scans, deployments, or remediation;
- create, switch, commit, push, merge, or otherwise mutate Git;
- write to Jira, GitLab, Jenkins, SonarQube, or a database;
- close an operator's terminal.

The complete normative boundary is in the [terminal-first product contract](docs/terminal-first-product-contract.md).

Claude launch settings expose Manual/default, Accept Edits, Plan, Auto, Don't Ask, and experimental Bypass Permissions as an enum. Raw permission flags are rejected from the command setting, so the selected mode has one visible authority. Bypass is translated to `--dangerously-skip-permissions` only after the operator chooses that setting and confirms the blocking warning for that individual launch; canceling or opening Claude Settings creates no terminal or session.

## Architecture

```mermaid
flowchart LR
    O[Operator] --> UI[VS Code: Work / Sessions / Projects / Attention]
    UI --> C[Command and service layer]

    C -->|bounded GET reads| P[Jira / GitLab / Jenkins / SonarQube]
    C -->|VS Code Git API + .git/HEAD| G[Local project evidence]
    C --> S[Private local artifacts and audit]
    S --> M[Provider monitor]
    M --> UI

    C -->|explicit validated start| T[Operator-owned Claude terminal]
    C -->|reviewed text, execute=false| T

    classDef boundary fill:#102f46,stroke:#38bdf8,color:#eaf6ff;
    classDef local fill:#153322,stroke:#4ade80,color:#effff4;
    class C,T boundary;
    class G,S,M local;
```

The installed extension uses the VS Code API and Node built-ins only. It has **zero third-party runtime dependencies** and does not bundle an agent SDK, subprocess helper, or provider client library.

### Engineering proof

| Measure | Current preview |
| --- | ---: |
| Enterprise provider integrations | 4 |
| Focused VS Code views | 4 |
| Audited terminal-write paths | 2 |
| Manifest-covered commands | 40 |
| Manifest-covered settings | 11 |
| Reachable runtime modules checked for cycles/dead exports | 84 |
| Third-party runtime dependencies | 0 |
| Automated Node/DOM/board tests | 222 |

Automated gates also cover the runtime graph, security boundary, context governance, activation surface, provider transitions, private state, credential redaction, and packaged extension contents.

## Try It Locally

Requirements:

- Node.js 20 or newer
- VS Code 1.85 or newer
- the Claude CLI only if you choose to exercise explicit terminal launch

```bash
git clone <repository-url>
cd Kronos
npm ci
npm test
npm run package
code --install-extension kronos-0.1.0.vsix --force
```

Reload VS Code and open the Kronos activity icon. The extension exposes exactly four views: **Work**, **Sessions**, **Projects**, and **Attention**.

Each view keeps only its primary workflow icons visible: Work owns Jira refresh/board/filter, Sessions owns terminal creation/attachment, Projects owns repository refresh/registration, and Attention owns manual polling. Basket, search, handoff, and other secondary actions remain in the relevant view's **…** menu; Setup is the single configuration hub.

### Isolated synthetic fixture

```bash
npm run feedback:state
KRONOS_DIR="$PWD/.kronos/feedback-state" code .
```

PowerShell:

```powershell
npm run feedback:state
$env:KRONOS_DIR = "$PWD\.kronos\feedback-state"
code .
```

The fixture uses `.invalid` provider URLs. It must not contact or mutate real systems, and it never starts a terminal automatically.

## Configuration

Kronos reads provider credentials from the extension process environment and, when present, `~/.kronos/.env` or `KRONOS_ENV_FILE`. Credential values are never written to context artifacts, work-session records, URLs, or audit events.

| Provider | Required values | Optional values |
| --- | --- | --- |
| Jira | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | `JIRA_JQL` |
| GitLab | `GITLAB_TOKEN` | `GITLAB_API_BASE_URL` or `GITLAB_BASE_URL` |
| Jenkins | `JENKINS_URL` | `JENKINS_USER` / `JENKINS_USERNAME`, `JENKINS_API_TOKEN` / `JENKINS_TOKEN`, narrowly scoped `JENKINS_TLS_REJECT_UNAUTHORIZED=false` for a locally trusted corporate endpoint |
| SonarQube | `SONAR_HOST_URL` or `SONAR_URL`, `SONAR_TOKEN` | project and branch bindings configured per local project |

Use **Kronos: Setup** for guided configuration and **Kronos: Doctor** for readiness checks. They share one readiness snapshot, expose one bounded action per row, and never display credential values. **Open Private Config** creates a private comment-only template when needed; save provider values there, then refresh Setup or Doctor. **Poll Now** verifies configured project monitoring without mutating a provider.

Local state is stored under `~/.kronos` by default or an explicitly configured `KRONOS_DIR`. On the first default-path start, Kronos safely migrates an existing legacy `~/.claude/kronos` directory without requiring a Python helper. Provider payloads are normalized, bounded, secret-redacted, wrapped as untrusted data, and written to private per-user files where the platform supports private permissions.

For a Jenkins controller whose certificate chain is supplied only by a corporate workstation trust setup, prefer installing the corporate CA for Node. If that is not possible, `JENKINS_TLS_REJECT_UNAUTHORIZED=false` disables certificate verification only for Kronos Jenkins requests; it does not weaken Jira, GitLab, or SonarQube transport.

## Validation

```bash
npm ci
npm test
npm run feedback:smoke
npm run package
npm run feedback:ready
# After committing and pushing a requested publish slice:
npm run publish:verify
```

`npm test` begins with a public-surface gate that rejects tracked local-state directories, machine-specific home paths, employer identifiers, private-key material, and high-confidence token shapes. The remaining checks enforce the manifest allowlist, reachable runtime graph, explicit-launch boundary, context governance, strict TypeScript compilation, unit behavior, cross-view product contracts, provider fixtures, large synthetic scale/accessibility behavior, exact dependency-free VSIX file surface, and dependency-free webviews. `npm run package` repeats the public, manifest, graph, security, governance, roadmap, claim, compile, and exact-surface gates before creating a VSIX; extra or missing files fail closed. The checked [verification matrix](docs/verification-matrix.json) maps roadmap goals to named tests and keeps real VS Code, operator-terminal, Windows, multi-window, and live-provider gates explicit. README engineering metrics are derived from the manifest, source tree, dependencies, and test declarations on every run.

For the interactive pass, use [HUMAN_FEEDBACK_CHECKLIST.md](HUMAN_FEEDBACK_CHECKLIST.md). Real-provider, terminal-focus, and Windows feedback remain explicit human gates; see the [completion audit](docs/terminal-first-completion-audit.md).

## Repository Map

```text
src/extension.ts                         thin activation entry point
src/terminalFirstExtension.ts            command registration and orchestration
src/services/*RestClient.ts              bounded read-only provider clients
src/services/*View.ts                    pure HTML builders for editor surfaces
src/services/terminalContextInsertion.ts non-submitting terminal insertion
src/services/claudeTerminalLauncher.ts   explicit validated Claude launch
src/state/                               terminal-first state model
media/                                   extension runtime and icon assets
scripts/                                 validation, packaging, and fixture tools
test-fixtures/providers/                 sanitized enterprise-shaped provider inputs
docs/                                    product contract, audit, and preview assets
```

## Current Limits

- Kronos is a local VS Code extension preview, not a hosted backend or autonomous software-development agent.
- Marketplace publication, adoption, production-scale operation, and live-provider compatibility are not claimed.
- Real VS Code/Claude, provider, focus/reattachment, and Windows checks require recorded human feedback.
- Raw Jira attachments are stored byte-for-byte under strict count and size limits; they are never parsed or executed by Kronos.
- This repository is source-available for review, not open source.
- The public repository is a sanitized source snapshot; private development-history metadata is intentionally excluded from the portfolio release.

## Project Information

- [Changelog](CHANGELOG.md)
- [Security policy](SECURITY.md)
- [Support and feedback](SUPPORT.md)
- [Contribution guide](CONTRIBUTING.md)
- [Human feedback checklist](HUMAN_FEEDBACK_CHECKLIST.md)
- [Extension improvement goals](docs/extension-improvement-goals.md)
- [Checked verification matrix](docs/verification-matrix.json)
- [State ownership and data flow](docs/state-ownership.md)
- [Provider read contract matrix](docs/provider-contract-matrix.md)
- [Scale and accessibility budget](docs/scale-accessibility-budget.md)

Copyright © 2026 Jeremy Mackey. All rights reserved.
