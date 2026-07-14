# yolk pi web — Agent Guide

This file is the AI working entrypoint, documentation map, and project contract for the pi coding agent web UI. Keep detailed material in `docs/`; this file only says where to read, where to archive, and which rules must be followed.

## Quick Start

```bash
npm install
npm run dev     # http://localhost:30141
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server on port 30141. |
| `npm run lint` | Run ESLint. |
| `node_modules/.bin/tsc --noEmit` | Type-check without emitting. |
| `npm run build` | Production/release build through `scripts/build-next.js`. Do not use for routine dev work. |
| `npm run start` | Start the production server on port 30141. |

> Never run `next build` directly during development. It pollutes `.next/` and can break `npm run dev`; use `npm run build` only for release/publish validation.

## Reading Order

| Task | Read first | Then inspect |
| --- | --- | --- |
| Understand the product | `README.md` | `docs/architecture/overview.md` |
| Locate code | This file's project structure | `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md` |
| Change API behavior | `docs/modules/api.md` | Relevant `app/api/**/route.ts`, then `lib/rpc-manager.ts` or `lib/session-reader.ts` |
| Change UI behavior | `docs/modules/frontend.md` | Relevant file in `components/` or `hooks/` |
| Change shared logic | `docs/modules/library.md` | Relevant file in `lib/` and all callers |
| Change Grok OAuth, accounts, or quota | `docs/integrations/README.md` | `lib/pi-provider-extensions.ts`, `lib/grok-*.ts`, `lib/oauth-account-providers.ts`, `app/api/auth/quota/[provider]/route.ts` |
| Change session lifecycle, branching, JSONL, or SSE | `docs/architecture/overview.md` | `lib/rpc-manager.ts`, `lib/session-reader.ts`, `hooks/useAgentSession.ts` |
| Change code/comment/test conventions | `docs/standards/code-style.md` | Existing nearby code |
| Deploy, publish, or debug runtime | `docs/deployment/README.md` | `docs/operations/troubleshooting.md`, `ecosystem.config.cjs`, proxy scripts |
| Change dependencies or pi SDK integration | `docs/integrations/README.md` | `package.json`, installed pi docs under `node_modules/@earendil-works/pi-coding-agent/` |

## Project Structure

| Path | Purpose | Details |
| --- | --- | --- |
| `app/` | Next.js app routes, layout, global styles. | `README.md`, `docs/modules/api.md` |
| `app/api/` | API route handlers for sessions, agent RPC/SSE, files, models, skills, auth, usage, model prices, Git/worktrees, and config. | `docs/modules/api.md` |
| `components/` | React UI components. | `docs/modules/frontend.md` |
| `hooks/` | Client hooks for session state, theme, drag/drop, audio. | `docs/modules/frontend.md` |
| `lib/` | Shared server/client utilities, parsing, lifecycle, config, provider helpers, and Grok OAuth/accounts/quota modules. | `docs/modules/library.md` |
| `bin/` | npm-published `ypi` entrypoint. | `docs/deployment/README.md` |
| `scripts/` | Build and operational helpers. | `docs/deployment/README.md` |
| `public/` | Static assets. | Inspect files directly. |
| `docs/` | Project knowledge base and archive target. | This file's archive rules. |
| `.pi/` | Local Pi agent configuration, skills, prompts, and runtime helpers. | Read only when the active workflow/skill requires it. |

## Module Entry Points

| Area | Source entry | Documentation |
| --- | --- | --- |
| Session browsing/parsing | `lib/session-reader.ts`, `app/api/sessions/**` | `docs/architecture/overview.md`, `docs/modules/api.md` |
| Session changed-file overlay | `lib/session-file-changes.ts`, `components/SessionChangesFloatingPanel.tsx`, `app/api/sessions/[id]/changes/**` | `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md` |
| Project registry and project spaces | `lib/project-registry.ts`, `app/api/projects/**`, `components/SessionSidebar.tsx` | `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md` |
| Agent command lifecycle | `lib/rpc-manager.ts`, `app/api/agent/**` | `docs/architecture/overview.md` |
| Chat/session UI state | `hooks/useAgentSession.ts`, `components/ChatWindow.tsx`, `components/ChatInput.tsx` | `docs/modules/frontend.md` |
| Tool-call normalization | `lib/normalize.ts` | `docs/architecture/overview.md`, `docs/modules/library.md` |
| Workspace files and Git context | `app/api/files/**`, `app/api/git/**`, `lib/file-paths.ts`, `lib/git-worktree.ts`, `lib/workspace-title.ts` | `docs/modules/api.md`, `docs/modules/library.md` |
| YPI Studio members/workflows/tasks | `components/YpiStudioPanel.tsx`, `app/api/studio/**`, `lib/ypi-studio-*`, `lib/rpc-manager.ts` | `docs/modules/frontend.md`, `docs/modules/api.md`, `docs/modules/library.md` |
| Models, skills, auth, usage | `app/api/models*`, `app/api/skills/**`, `app/api/auth/**`, `app/api/usage/route.ts` | `docs/modules/api.md`, `docs/integrations/README.md` |
| Usage token display & cache-write removal | `lib/token-format.ts`, `lib/llm-usage-normalize.ts`, `lib/llm-usage-types.ts`, `lib/usage-stats.ts`, `components/UsageStatsModal.tsx`, `components/UsageProviderModelTable.tsx`, `components/SessionStatsChips.tsx` | `docs/architecture/overview.md`, `docs/modules/library.md`, `docs/modules/frontend.md` |
| Model price configuration | `app/api/model-prices/**`, `lib/model-price-*.ts`, `lib/token-format.ts`, `components/ModelPricesConfig.tsx`, `components/SettingsConfig.tsx` | `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/frontend.md`, `docs/modules/library.md`, `docs/integrations/README.md`, `docs/operations/troubleshooting.md` |
| Memory diagnostic snapshots | `lib/memory-diagnostics.ts`, `lib/memory-diagnostics-types.ts`, `app/api/diagnostics/memory-snapshot/route.ts`, `components/SettingsConfig.tsx` (diagnostics section) | `docs/modules/api.md`, `docs/modules/library.md`, `docs/modules/frontend.md`, `docs/operations/troubleshooting.md` |

## Project Invariants

Keep this section short and operational; detailed rationale belongs in `docs/architecture/overview.md`.

- Keep one `AgentSessionWrapper` per session id in `globalThis.__piSessions`; use `globalThis.__piStartLocks` for concurrent starts.
- After a fork, capture the new session id and destroy the old wrapper immediately.
- Distinguish forked sessions (new JSONL file) from in-session branches (`navigate_tree` in the same file).
- Normalize pi tool calls through `lib/normalize.ts`; do not hand-roll tool-call field mapping in components/routes.
- Track session changed-file UI through non-Git sidecars in `lib/session-file-changes.ts`; do not derive it from Git status.
- Treat session header `parentSession` as display metadata only; content comes from JSONL entries.
- Treat Project Registry as the project list source; sessions are space history and must not be scanned to synthesize top-level projects.
- Keep project/space path comparisons on canonical `pathKey` values so symlink/display paths do not duplicate projects.
- When changing event kinds, JSONL records, RPC payloads, config fields, or shared constants, search for all consumers first and update docs/tests/validation notes.
- cacheWrite is deprecated: new events and aggregators zero it; wire types retain the field; historical ledger/session files are never rewritten.
- Model prices are written only to `~/.pi/agent/models.json`; no separate price source. Use `lib/token-format.ts` for all token display; do not hand-roll locale/M formatting in UI components.
- Do not reset or overwrite unrelated user changes.

## Standards and Validation

| Topic | Entry point |
| --- | --- |
| Code style, comments, validation commands | `docs/standards/code-style.md` |
| TypeScript config | `tsconfig.json` |
| ESLint config | `eslint.config.mjs` |
| Package scripts and dependencies | `package.json` |

Minimum validation for code changes:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Deployment and Dependencies

| Topic | Entry point |
| --- | --- |
| Local development, production build/start, PM2, proxy scripts, npm package | `docs/deployment/README.md` |
| Runtime troubleshooting | `docs/operations/troubleshooting.md` |
| Third-party packages and pi SDK docs | `docs/integrations/README.md` |
| Published binary | `bin/pi-web.js` exposed as `ypi` |
| Build wrapper | `scripts/build-next.js` |
| PM2 config | `ecosystem.config.cjs` |

## Data and Configuration

| Item | Location |
| --- | --- |
| Default data dir | `~/.pi/agent/` |
| Data dir override | `PI_CODING_AGENT_DIR` |
| Session files | `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl` |
| Project registry | `~/.pi/agent/pi-web-projects.json` |
| Project-session index sidecar | `~/.pi/agent/pi-web-session-index.json` |
| Model config | `~/.pi/agent/models.json` |
| Settings/default model | `~/.pi/agent/settings.json` |
| Web UI settings (Yolk Pi chat defaults, WorkTree, Usage, Web Terminal, ChatGPT panel, Editor) | `~/.pi/agent/pi-web.json` |

## Archive Rules

All durable project knowledge belongs under `docs/`. Add or update docs first, then point to them from this file when the entry is important for future agents.

| Knowledge type | Archive location |
| --- | --- |
| Architecture, boundaries, data flow, invariants | `docs/architecture/` |
| API, component, hook, and library module behavior | `docs/modules/` |
| Code, comment, testing, and validation standards | `docs/standards/` |
| Deployment, environment, CI/CD, release notes | `docs/deployment/` |
| Third-party components, external services, SDK usage | `docs/integrations/` |
| Operations, logs, troubleshooting, runbooks | `docs/operations/` |
| Research, analysis, future improvements | `docs/research/` |
| Important technical decisions | `docs/architecture/decisions/` |
| Agent skill notes | `docs/` flat file with a descriptive name, unless a closer docs category fits |

Current docs index:

- `docs/architecture/overview.md` — runtime flow, invariants, session JSONL format.
- `docs/architecture/browser-share.md` — Chrome extension Browser Share bridge, binding flow, API, tools, and safety boundaries.
- `docs/architecture/decisions/README.md` — archive location for durable technical decisions.
- `docs/modules/api.md` — API route map and route implementation pointers.
- `docs/modules/frontend.md` — component/hook/style map.
- `docs/modules/library.md` — shared `lib/` module map and reuse rules.
- `docs/standards/code-style.md` — code, comment, validation, and testing entry point.
- `docs/deployment/README.md` — local, production, PM2, proxy, npm package, and data config.
- `docs/integrations/README.md` — dependency and pi SDK integration entry point.
- `docs/operations/troubleshooting.md` — runtime and development troubleshooting.
- `docs/research/README.md` — archive location for investigation notes and future research.
- `docs/SKILL_find_skills.md` — instructions for discovering/installing agent skills.

## AI Working Conventions

- Start by following the reading order for the task type.
- Before modifying code, read the relevant module docs and source files.
- Keep `AGENTS.md` concise and navigational; move detailed explanations to `docs/`.
- When adding/removing API routes, update `docs/modules/api.md` and this file only if the top-level navigation changes.
- When adding/removing major components, hooks, or shared modules, update the relevant file under `docs/modules/`.
- When changing deployment, dependencies, or external integrations, update `docs/deployment/` or `docs/integrations/`.
- Preserve user-authored content unless it is stale, misleading, duplicated in docs, or conflicts with this contract.
