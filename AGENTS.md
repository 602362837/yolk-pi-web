# Pi Agent Web — Agent Guide

This file is the AI working entrypoint, documentation map, and project contract for the pi coding agent web UI. Keep detailed material in `docs/`; this file only tells agents where to read, where to archive, and which rules must be followed.

---

## Quick Start

```bash
npm install
npm run dev     # http://localhost:30141
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start dev server (port 30141, for dev work) |
| `npm run build` | Production build (only for publish, **not during dev**) |
| `npm run start` | Start production server (port 30141, for deployed instances) |
| `npm run lint` | Run ESLint |
| `node_modules/.bin/tsc --noEmit` | Type-check without emitting |

> **Never run `next build` during dev** — pollutes `.next/` and breaks `npm run dev`.

**npm-published binary**: `npx @agegr/pi-web@latest` or `npm install -g @agegr/pi-web && pi-web`
Supports `--port`, `--hostname`, and `PORT` env var. Entrypoint: `bin/pi-web.js`.

---

## Reading Order

| Task | Read first | Then inspect |
| --- | --- | --- |
| Understand the product | `README.md` | Architecture below |
| Locate source code | This file's Project Structure | Relevant source dirs |
| Change API behavior | This file's API routes | `app/api/` route file + RPC manager |
| Change UI component | This file's Components section | `components/` relevant file |
| Adjust business logic in lib | This file's Library section | `lib/` relevant file |
| Add/modify an API route | Existing `app/api/` routes | `lib/rpc-manager.ts` for agent routes |
| Debug session lifecycle | `lib/rpc-manager.ts` | This file's Project Invariants |
| Debug session file parsing | `lib/session-reader.ts` | Session File Format below |
| Add new hook | Existing `hooks/` | Nearby component that consumes it |
| Deploy / update production | This file's Deployment & Operations | `ecosystem.config.cjs`, proxy scripts |
| Configure CI / publish | `scripts/build-next.js`, `package.json` scripts | Git history |
| Understand session file format | This file's Session File Format | `lib/session-reader.ts`, `lib/types.ts` |

---

## Architecture

```
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ────▶ reads ~/.pi/agent/sessions/   │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  │                        │                               │
  ├─ send message ─────────▶ POST /api/agent/[id]          │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ──────────▶ GET /api/agent/[id]/events    │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ─────────│                               │
```

**Session browsing** (read-only): reads `.jsonl` files directly via `lib/session-reader.ts` — no AgentSession created.

**Sending a message**: `startRpcSession()` in `lib/rpc-manager.ts` creates an AgentSession in-process.

---

## Project Structure

### API Routes (`app/api/`)

| Route | Methods | Purpose |
| --- | --- | --- |
| `sessions/` | GET | List all sessions grouped by cwd |
| `sessions/[id]/` | GET/PATCH/DELETE | Read session detail; rename; delete |
| `sessions/[id]/context/` | GET | Get context for a specific leafId |
| `sessions/[id]/export/` | GET | Export session as Markdown |
| `sessions/new/` | (410) | No longer used |
| `agent/new/` | POST | Create new session and send first message |
| `agent/[id]/` | GET/POST | Get agent state; send any command |
| `agent/[id]/events/` | GET | SSE event stream |
| `files/[...path]/` | GET | Read file contents for viewer |
| `models/` | GET | List available models + default model |
| `models-config/` | GET/POST | Read/write `~/.pi/agent/models.json` |
| `models-config/test/` | POST | Test a model config (sends a test completion) |
| `skills/` | GET | List installed skills for a given cwd |
| `skills/search/` | GET | Search skills.sh for available skills |
| `skills/install/` | POST | Install a skill via `npx skills add` |
| `commands/` | GET | List slash commands from skills for a cwd |
| `cwd/validate/` | POST | Validate a candidate workspace path |
| `git/worktrees/` | POST | Create a Git worktree from the selected cwd and allow immediate file browsing |
| `git/info/` | GET | Return best-effort Git metadata (branch/worktree info) for a cwd |
| `web-config/` | GET/PUT | Read/write `~/.pi/agent/pi-web.json` for web UI settings, including WorkTree defaults |
| `default-cwd/` | POST | Create and return `~/pi-cwd-<YYYYMMDD>` |
| `home/` | GET | Return `os.homedir()` |
| `usage/` | GET | Aggregate token/cost stats across sessions |
| `auth/providers/` | GET | List auth provider config statuses |
| `auth/all-providers/` | GET | List all known provider IDs |
| `auth/login/[provider]/` | GET | Initiate OAuth login for a provider |
| `auth/logout/[provider]/` | GET | Clear OAuth tokens for a provider |
| `auth/api-key/[provider]/` | GET | Get masked API key status for a provider |
| `auth/balance/[provider]/` | GET | Query DeepSeek account balance |
| `auth/quota/[provider]/` | GET | Query OpenAI Codex subscription quota |

### Library (`lib/`)

| File | Purpose |
| --- | --- |
| `rpc-manager.ts` | AgentSessionWrapper + registry + `startRpcSession()`. Manages lifecycle via `globalThis.__piSessions` |
| `session-reader.ts` | Parse `.jsonl` session files; `getModelNameMap`, `getModelList`, `getDefaultModel`, `resolveSessionPath` |
| `types.ts` | Shared TypeScript types (`AgentMessage`, `AssistantMessage`, `SessionEntry`, `SessionInfo`, etc.) |
| `pi-types.ts` | Wrapper interface `AgentSessionLike` — the contract expected by hooks/components from agent sessions |
| `normalize.ts` | `normalizeToolCalls()` — bridges pi's `{type:"toolCall",id,name,arguments}` to `{toolCallId,toolName,input}` |
| `agent-client.ts` | `sendAgentCommand()` — client-side fetch helper for `POST /api/agent/[id]` |
| *(in rpc-manager.ts)* | When all tools disabled, agent system prompt is cleared (line ~316) |
| `file-paths.ts` | Path normalization utilities for file viewer |
| `deepseek-balance.ts` | `getDeepSeekProviderBalance()` — query DeepSeek API balance |
| `subscription-quota.ts` | `getOAuthProviderSubscriptionQuota()` — query OpenAI Codex usage tiers |
| `npx.ts` | `runNpx()` — cross-platform `npx` wrapper (avoids shell, finds npx-cli.js directly) |
| `usage-stats.ts` | `getUsageStats()` — aggregate token/cost by day, model, provider, session |
| `pi-web-config.ts` | Read/write `~/.pi/agent/pi-web.json` and validate WorkTree web settings |
| `workspace-title.ts` | Shared browser/sidebar workspace title formatting from cwd + Git metadata |

### Components (`components/`)

| File | Purpose |
| --- | --- |
| `AppShell.tsx` | Top-level layout; URL state management; tab management |
| `SessionSidebar.tsx` | Session tree sidebar + integrated `FileExplorer` |
| `ChatWindow.tsx` | Message list, SSE streaming, fork/navigate logic |
| `ChatInput.tsx` | Input bar with model dropdown, thinking level, tool preset, compact controls, image upload |
| `MessageView.tsx` | Render one message (user/assistant/toolCall/toolResult) |
| `BranchNavigator.tsx` | In-session branch switcher UI |
| `ChatMinimap.tsx` | Scroll minimap alongside message list |
| `ToolPanel.tsx` | Exports `PRESET_NONE`, `PRESET_DEFAULT`, `PRESET_FULL`, `PRESET_SUBAGENT` + `getPresetFromTools()` |
| `ModelsConfig.tsx` | Modal for editing `models.json` (opened from sidebar bottom) |
| `SkillsConfig.tsx` | Modal for browsing and installing skills (opened from sidebar bottom) |
| `SettingsConfig.tsx` | Generic Settings modal; currently edits WorkTree defaults in `pi-web.json` |
| `UsageStatsModal.tsx` | Modal showing token/cost usage statistics |
| `FileExplorer.tsx` | File tree inside sidebar |
| `FileViewer.tsx` | File content viewer in a tab |
| `FileIcons.tsx` | Monochrome SVG icons for file/folder types |
| `MarkdownBody.tsx` | Markdown + KaTeX + syntax highlighting renderer |
| `TabBar.tsx` | Tab bar (Chat + open file tabs) |

### Hooks (`hooks/`)

| File | Purpose |
| --- | --- |
| `useAgentSession.ts` | Central session hook — manages session data, SSE, streaming state, all agent commands (send, fork, navigate, steer, compact, etc.), tools, models, thinking levels |
| `useTheme.ts` | Dark/light theme toggle with view-transition animation |
| `useDragDrop.ts` | Drag-and-drop handler for image attachments |
| `useAudio.ts` | Sound toggle + "done" chime playback via Web Audio API |

### Root Configuration & Scripts

| File | Purpose |
| --- | --- |
| `bin/pi-web.js` | npm-published entrypoint — resolves `next` bin, spawns `next start` with port/hostname CLI args, auto-opens browser on "Ready" |
| `scripts/build-next.js` | Production build helper — sets `HOME` to `.next-build-home/` to avoid protected Windows home junctions |
| `ecosystem.config.cjs` | PM2 process config — auto-restart, max 1GB memory, logs to `logs/` |
| `start-pi-web-proxy.sh` | Launch wrapper — sets `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` + `NODE_OPTIONS=--use-env-proxy` |
| `update-pi-web.sh` | Self-update script — `git pull --rebase --autostash`, `npm run build`, then relaunch with proxy |
| `eslint.config.mjs` | ESLint flat config — extends Next.js core-web-vitals + typescript, with relaxed hook rules |
| `tsconfig.json` | TypeScript config — `@/*` path alias, ES2017 target, bundler module resolution |
| `tailwind.config.ts` | Tailwind CSS v4 configuration |
| `postcss.config.mjs` | PostCSS config |
| `next.config.ts` | Next.js configuration |

---

## Project Invariants

### AgentSession Lifecycle (`lib/rpc-manager.ts`)

- One `AgentSessionWrapper` per session id, keyed in `globalThis.__piSessions` (survives hot-reload; plain module-level Map does not)
- Idle timeout: 10 minutes. Concurrent `startRpcSession()` calls share a single start Promise (`globalThis.__piStartLocks`)
- After a fork, the wrapper **must be destroyed immediately** — `AgentSession.fork()` mutates the wrapper's `inner.sessionId` in-place to the *new* id. If the wrapper stays alive under the old id, subsequent forks corrupt the `parentSession` chain. Pattern: `send("fork")` → capture `newSessionId` → `this.destroy()`.

### Two Kinds of Branching

- **Fork** (Fork button on user message): creates a new independent `.jsonl` file. Shown as a child in sidebar tree via `parentSession` header field.
- **In-session branch** (Continue button / BranchNavigator): calls `navigate_tree` within the same file. Multiple entries share the same `parentId`. Switching calls `/api/sessions/[id]/context?leafId=`.

### Session Files Are Fully Rewritable

`parentSession` in the header is **display metadata only** — zero effect on chat content. Safe to `writeFileSync` the entire file. Used when cascade-reparenting children on delete.

### ToolCall Field Normalization

Pi stores: `{type:"toolCall", id, name, arguments}`  
Our types use: `{toolCallId, toolName, input}`  
Normalize via `normalizeToolCalls()` in `lib/normalize.ts` — called in `session-reader.ts` (file load) and `ChatWindow.handleAgentEvent()` (streaming).

### New Session Tool Preset

Tool names are passed at creation (`POST /api/agent/new` → `toolNames[]`). For existing sessions, preset is inferred on mount via `get_tools` → `getPresetFromTools()`. When all tools disabled (`toolNames = []`), `rpc-manager.ts` clears the agent system prompt (line ~316).

### Model Defaults

`GET /api/models` returns `defaultModel` from `~/.pi/agent/settings.json`. Pre-selected on mount for new sessions.

### SSE Reconnect on Page Refresh Mid-Stream

On mount, `GET /api/agent/[id]` is called. If `state.isStreaming === true`, SSE reconnects automatically. `thinkingLevel` and `isCompacting` are also synced from this response.

### Compaction SSE Events

Newer pi emits `compaction_start` / `compaction_end`; older emits `auto_compaction_start` / `auto_compaction_end`. Both sets are handled in `handleAgentEvent`. Manual compact is a blocking POST — button disabled until response returns.

### Orphaned Sessions

Sessions whose first line can't be parsed as a valid header are marked `orphaned: true` in API — displayed with "incomplete" badge, not clickable.

---

## Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is a parallel array to `messages[]` — maps each displayed message back to its `.jsonl` entry id, used for fork and `navigate_tree` calls.

---

## CSS Variables (`app/globals.css`)

Available for components to reference directly:

```
--bg                    --bg-panel              --bg-hover
--bg-selected           --bg-subtle             --border
--text                  --text-muted            --text-dim
--accent                --accent-hover
--user-bg               --assistant-bg          --tool-bg
--font-mono             (set via Noto_Sans_Mono font)
```

These are mapped to CSS utility `--color-*` aliases as well. Theme toggles dark/light via `document.documentElement.classList.toggle("dark")`.

---

## Deployment & Operations

### Local Dev

```bash
npm run dev       # http://localhost:30141
```

Dev uses Next.js built-in hot-reload.

### Production Server

```bash
npm run build    # produces .next/ (run on deploy target or CI)
npm run start    # serves on :30141
```

**Or via PM2** (see `ecosystem.config.cjs`):

```bash
pm2 start ecosystem.config.cjs
```

PM2 auto-restarts on crash, max 1GB memory, logs to `logs/pi-web-out.log` / `logs/pi-web-error.log`.

### Proxy / Network Setup

The project ships two shell scripts for environments behind a proxy:

- `start-pi-web-proxy.sh` — sets `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY` + `NODE_OPTIONS=--use-env-proxy`
- `update-pi-web.sh` — `git pull --rebase --autostash`, build, then restart via proxy

Default proxy: `http://127.0.0.1:7897` (Clash). Override via `PROXY_URL` / `SOCKS_PROXY_URL`.

### npm Published Package

- Package: `@agegr/pi-web`
- Entrypoint: `bin/pi-web.js`
- Published files: `bin/`, `.next/`, `public/`, `next.config.ts`
- Requires: Node.js 20+ (uses `parseArgs` from `node:util`)

### Data Directory

Default: `~/.pi/agent/`  
Override via `PI_CODING_AGENT_DIR` environment variable.  
Session files: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`  
Model config: `~/.pi/agent/models.json`  
Web config: `~/.pi/agent/pi-web.json` (currently used for New WorkTree defaults)
Settings: `~/.pi/agent/settings.json`

---

## Archive Rules

All project knowledge belongs under `docs/`. When creating new documentation, use these guidelines:

| Knowledge type | Archive location |
| --- | --- |
| Architecture, boundaries, data flow | `docs/architecture/` or add to this file's Architecture section |
| Module / component behavior | `docs/modules/` or inline in source code |
| Code, comment, and test standards | `docs/standards/` |
| Deployment, environment, CI/CD | This file's Deployment section or `docs/deployment/` |
| Third-party components / SDKs | This file's Dependencies section or `docs/integrations/` |
| Operations, troubleshooting | `docs/operations/` |
| Research, analysis, decisions | `docs/research/` or `docs/architecture/decisions/` |
| Agent skills documentation | `docs/` — flat file, descriptive name |

Current `docs/` contents:
- `docs/SKILL_find_skills.md` — Instructions for discovering and installing agent skills

---

## AI Working Conventions

- Start a task by following the **Reading Order** table to locate relevant sources.
- Before modifying code, read the corresponding source file and the Project Invariants section.
- When you discover missing documentation, create it under `docs/` following the Archive Rules, then update this file's index pointers.
- Keep `AGENTS.md` concise and navigational — do not expand detailed explanations here.
- When modifying API routes, update this file's API Routes table if adding/removing routes.
- When modifying components or hooks, update this file's component/hook tables.
- `.trellis/` and `.pi/` are local-only directories (in `.gitignore`). If present, they contain local workflow state, not project documentation.
