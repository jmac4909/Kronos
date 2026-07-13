# Kronos — Claude Code Orchestrator

VS Code extension for multi-project SDLC orchestration with Claude Code. Manages Jira tickets, GitLab MRs, Jenkins builds, SonarQube quality gates, and automated implementation/verification across Spring Boot microservices.

## Current Host Notes

Current repo root: `/home/ec2-user/kronos`. This workspace intentionally lives outside `/home/ec2-user/projects`; do not move, delete, extract, or reclassify it during project-organization cleanup without explicit approval.

For Codex-wide navigation on this host, start with `/home/ec2-user/AGENTS.md` and `/home/ec2-user/.codex/memories/extensions/ad_hoc/notes/20260701T145649Z-current-navigation-index.md`.

## Development Notes

Read `GOOD_TO_GREAT_REVIEW.md`, `README.md`, `HUMAN_FEEDBACK_CHECKLIST.md`, and this `CLAUDE.md` before significant design or implementation work. Keep enterprise credentials, Jira/GitLab/Jenkins/Sonar details, Claude/GCP auth data, and generated session state out of git.

## Architecture

```
VS Code Extension (TypeScript)     External Scripts            State Files
src/extension.ts                   ~/.claude/scripts/*         ~/.claude/kronos/state.json
src/runners/sessionDispatcher.ts   Integration script bundle   ~/.claude/kronos/queue.json
src/state/KronosState.ts                                       ~/.claude/kronos/runs/
src/state/types.ts                                             ~/.claude/kronos/sessions/
src/services/                      Prompts and manifests       ~/.claude/kronos/stats.json
src/views/                         under ~/.claude/kronos/     ~/.claude/kronos/prompts/
```

## Build & Run

### Prerequisites
- Node.js 20+, npm
- TypeScript 5.4+
- `@types/vscode`, `@types/node` (dev deps only)

### Build Commands
```bash
npm install                  # install dev dependencies (first time only)
npm run compile              # compile TypeScript
npm test                     # manifest, security, prompt, compile, and unit checks
npm run watch                # compile on save
npm run package              # build .vsix package
```

### Package & Install
```bash
npx @vscode/vsce package --no-dependencies --allow-missing-repository
code --install-extension kronos-0.1.0.vsix --force
```
Reload VS Code after install: `Ctrl+Shift+P` → "Reload Window"

### Dev Cycle
Edit TypeScript -> `npm run compile` -> package -> install -> reload. Or open the repo in VS Code and run the `Run Kronos Extension` launch configuration.

## Project Structure

### Extension (TypeScript)
- **`src/extension.ts`** — command handlers and WebView builders for the dashboard, board, ticket detail, run center, evidence panels, recovery, prompt manager, doctor, planning reports, and metrics.
- **`src/services/`** — service layer for state validation, queue planning, evidence, recovery, prompts, integrations, private Jira context hydration/artifacts, safety gates, metrics, and webview helpers.
- **`src/runners/sessionDispatcher.ts`** — dispatches Claude sessions via `claude -p`, manages worktrees, progress WebView panels, persisted run records, session stats, and stream-json parsing.
- **`src/state/KronosState.ts`** — reads state/queue files, file watchers, script runner, prompt loader, and integration adapters.
- **`src/state/types.ts`** — TypeScript interfaces for state schema.
- **`src/views/`** — 6 TreeDataProviders: Projects, Tickets, Queue, Review, Sessions, Tasks.

### Python Scripts (`~/.claude/scripts/`)
- **`kronos_state.py`** — state CRUD, Jira/GitLab polling, ticket/project management, queue, discovery, MR diffs, morning brief.
- **`kronos_engine.py`** — overnight orchestrator with VPN watchdog, smart scheduler.
- **`app-runner.sh`** — start/stop/status for Spring Boot + mock server. Reads CLAUDE.md for config.

### Prompts (`~/.claude/kronos/prompts/`)
All dispatched Claude sessions use prompt templates from `.md` files with `{{VARIABLE}}` substitution:
- `implement-system.md` — rules for implement sessions (build, test, sonar, app startup)
- `verify-local.md` — single ticket verification for local branch-targeted and remote deployed-environment checks
- `verify-develop.md` — verify all merged tickets on develop
- `verify-combined.md` — verify branches merged together
- `sonar-scan.md`, `sonar-fix.md`, `sonar-fix-branch.md` — SonarQube scan and fix
- `fix-finding.md` — fix verification findings on new branch
- `resolve-conflicts.md` — sequential branch rebasing
- `continue-work.md` — continue after review rejection

### State (`~/.claude/kronos/`)
- **`state.json`** — v3 schema: projects (config, health), tickets (top-level, linked to projects), evidence, overnight settings
- **`queue.json`** — manual work queue
- **`runs/`** — persisted run records, logs, prompts, and archive data
- **`sessions/`** — saved session events (last 20), JSON files with stats
- **`stats.json`** — aggregate session stats (last 100)
- **`active-worktrees.json`** — tracks worktrees for cleanup

## Key Patterns

### Dispatching Sessions
All actions dispatch via `dispatchClaudeSession()` which:
1. Opens progress WebView panel immediately
2. Checks GCP auth via `ensureAuth()`
3. Creates worktree if `parallel: true` (feature branches use local name, read-only scan/verify flows use `origin/<branch>` refs)
4. Spawns `claude -p` with `--output-format stream-json --verbose`
5. Parses stream events into progress panel in real time
6. Persists a run record with prompt, log, branch/worktree, status, and recovery metadata
7. Saves session + stats on completion
8. Runs `onComplete` callback (refresh state, update evidence/queue state, or surface recovery)

### Worktree Strategy
- Managed sessions fetch `origin`, create a worktree with `git worktree add`, and do not switch branches in the main worktree.
- Feature-branch sessions strip the `origin/` prefix before checkout so `git push` can work from the worktree.
- Sonar scan/fix and broader verify flows run in managed worktrees; targeted Verify Remote does not choose or checkout a branch and hits the selected deployed environment as-is.
- After creating a worktree, Kronos attempts `git pull --ff-only`.
- Cleanup only removes tracked worktrees that are clean and have no unpushed branch state. Dirty worktrees or branches without matching remotes are sent to Recovery Center for manual review.

### Prompts
Loaded via `state.loadPrompt('name', { VAR: 'value' })`. Template variables use `{{VAR}}` syntax. Edit prompts without rebuilding extension.

### State Schema (v3)
Tickets are top-level (not nested under projects). Each ticket has `projects: string[]` array. Queue is manual (add/remove, not auto-computed). Open MRs not linked to tickets show as `MR-{iid}`.

## Common Issues

| Issue | Cause | Fix |
|---|---|---|
| Missing external script | `~/.claude/scripts` is not installed or manifest drifted | Run Kronos Doctor and Integration Manifest |
| Claude or GCloud auth failure | Local operator auth is missing or expired | Run Kronos Setup / Auth Check |
| Dirty tracked worktree | A managed session left local changes or unpushed branch state | Use Recovery Center before cleanup |
| Agent finished but work is not ready | Evidence gate or post-run readiness failed | Add evidence, run checks, or mark needs-human |
| Publishing evidence is unsafe | Jira/GitLab destinations are missing or external publish needs confirmation | Use Evidence Handoff for manual posting |

## External Requirements

- Claude Code CLI must be available for dispatched sessions.
- GCloud auth is required when using Vertex-backed Claude profiles.
- Jira and Sonar integrations are script-backed; GitLab MR polling and Jenkins build polling/trigger helpers use native REST with inherited environment credentials. Missing providers should surface through Kronos Doctor instead of crashing UI panels.
