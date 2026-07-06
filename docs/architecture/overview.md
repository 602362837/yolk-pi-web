# Architecture Overview

This document holds the architecture details that should not live in `AGENTS.md`.

## Runtime Flow

```text
Browser                Next.js Server              AgentSession (in-process)
  │                        │                               │
  ├─ GET /api/sessions ───▶ reads ~/.pi/agent/sessions/    │
  ├─ GET /api/sessions/[id] reads .jsonl file directly     │
  │                        │                               │
  ├─ send message ────────▶ POST /api/agent/[id]           │
  │                        │   startRpcSession() ─────────▶│ createAgentSession()
  │                        │   session.send(cmd) ─────────▶│ session.prompt()
  │                        │                               │
  ├─ SSE connect ─────────▶ GET /api/agent/[id]/events     │
  │                        │   session.onEvent() ◀─────────│ session.subscribe()
  │◀── data: {...} ────────│                               │
```

## Key Boundaries

- Session browsing does not create an AgentSession: API routes read `.jsonl` files through `lib/session-reader.ts`; the only write side effect is pruning stale sessions whose cwd points at a deleted WorkTree.
- Sending commands creates or reuses an in-process AgentSession through `lib/rpc-manager.ts`.
- Client state and SSE streaming behavior are centralized in `hooks/useAgentSession.ts`.
- File viewing and workspace metadata use explicit API routes under `app/api/files/`, `app/api/cwd/`, and `app/api/git/`.

## Project Invariants

### AgentSession lifecycle

- Keep one `AgentSessionWrapper` per session id in `globalThis.__piSessions`; hot reload makes plain module-level maps unsafe.
- Idle timeout is 10 minutes.
- Concurrent `startRpcSession()` calls must share `globalThis.__piStartLocks`.
- After `send("fork")`, capture the new session id and destroy the wrapper immediately. `AgentSession.fork()` mutates `inner.sessionId`; leaving the old wrapper alive can corrupt `parentSession` chains.

### Branching model

- Fork creates a new `.jsonl` file and is shown as a child in the sidebar via the header `parentSession` field.
- In-session branch uses `navigate_tree` within the same file. Multiple entries may share a `parentId`; switching branches calls `/api/sessions/[id]/context?leafId=`.

### Session files

- `parentSession` is display metadata only and does not affect chat content.
- Session files are fully rewritable when updating display metadata such as cascade reparenting on delete.
- Deleting or archiving a linked Git WorkTree also deletes session JSONL files whose `cwd` points at that WorkTree; session listing also prunes stale missing `*.worktrees/*` cwd sessions left by older versions.
- Orphaned sessions whose first line cannot be parsed as a valid header are marked `orphaned: true` and displayed as incomplete, not clickable.

### Archive path

Archived sessions are stored at:

```text
~/.pi/agent/sessions-archive/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

Archive/unarchive is a pure file move (`renameSync`) between `sessions/` and `sessions-archive/`. The session JSONL content is never modified. Active RPC sessions are destroyed before the file is moved.

The archive directory is scanned separately from `SessionManager.listAll()` (which only scans `sessions/`). Project visibility is preserved by returning `archivedCwds` and `archivedCounts` from `GET /api/sessions`, allowing the CWD picker to include projects that have only archived sessions.

### Tool calls and events

- Pi stores tool calls as `{type:"toolCall", id, name, arguments}`.
- Web UI types use `{toolCallId, toolName, input}`.
- Normalize with `normalizeToolCalls()` in `lib/normalize.ts`; it is used during file load and streaming.
- Newer pi emits `compaction_start` / `compaction_end`; older pi emits `auto_compaction_start` / `auto_compaction_end`. Handle both.

### Session file-change projection

- Session changed-file UI is sidecar-based and non-Git; do not derive it from `git status` or `git diff`.
- `lib/rpc-manager.ts` forwards live edit/write tool events to `lib/session-file-changes.ts`, which captures bounded before/after text snapshots and persists `~/.pi/agent/session-changes/<session-id>.json`.
- Session JSONL files are not modified for this UI-only projection.
- MVP tracks built-in `edit` and `write` tools only; arbitrary `bash` file mutations are not shown unless a future scanner/sandbox design adds explicit support.

### Models and tools

- `GET /api/models` returns `defaultModel` from `~/.pi/agent/settings.json`.
- New-session tool names are passed to `POST /api/agent/new` as `toolNames[]`.
- Existing sessions infer presets via `get_tools` and `getPresetFromTools()`.
- Auth changes call `reloadRpcAuthState()` so live AgentSessions reload auth/model state. The same path also cleans pi-ai session resources because OpenAI Codex keeps reusable WebSockets keyed by session id, and those sockets must reconnect after ChatGPT account activation to pick up new auth headers.
- ChatGPT usage auto-refresh is backend-owned, not browser-tab-owned. The scheduler state lives on `globalThis.__piChatGptUsageRefreshScheduler` and uses `~/.pi/agent/chatgpt-usage-refresh.lock` to reduce duplicate refresh loops across Node processes. Stale lock detection follows the configured refresh cycle dynamically.
- Trellis subagent child processes resolve model policy from `pi-web.json` `trellis.subagents`: explicit tool input wins, then per-agent fixed policy, then optional route table policy, then default policy, then `.pi/agents/*` frontmatter, then Pi CLI defaults. Automatic routing is opt-in and classifies `text`/`multimodal` plus `simple`/`standard`/`complex`/`critical`; router failures fall back to configured safe route/default behavior. The default policy follows the main session model when the Pi extension context exposes it; otherwise it safely falls back to Pi default. If the selected child model process fails, existing `.pi/agents/*` `fallbackModels` frontmatter entries are retried in order; if those also fail and the main session model is known, the child finally falls back to the main session model.
- YPI Studio workflow orchestration is loaded as a built-in extension factory from `lib/rpc-manager.ts` so every web-created AgentSession receives the `ypi_studio_task` and `ypi_studio_subagent` tools plus `/studio-init`, `/studio-start`, `/studio-feature`, `/studio-bugfix`, `/studio-ui`, `/studio-continue`, `/studio-check`, and `/studio-archive` commands regardless of the selected workspace's project-local `.pi` files. The extension injects `.ypi/tasks` workflow state and bounded `.ypi/knowledge` summaries into each turn, binds sessions through stable context ids (`pi_<sessionId>` first, transcript hash second, process fallback last), resolves Studio member model/thinking policies through the pure `lib/ypi-studio-policy.ts` chain `toolInput > memberConfig > defaultPolicy > followMain > piDefault`, canonicalizes member ids before config/member-file lookup, emits policy diagnostics/warnings in live progress and final tool results, isolates child member Pi processes from Trellis injection with child env flags, and stores structured task progress under the selected workspace's `.ypi/` directory. Studio tasks may also contain `implementationPlan` plus `implementationProgress`: architects save a structured subtask plan before `awaiting_approval`, and after user approval the parent session claims ready subtasks before dispatching implementer with `subtaskId`. The schemaVersion 2 contract treats `implementationPlan.subtasks[].dependsOn` as the DAG scheduling source for serial, parallel, and mixed work; `execution.groups` is only a UI/readability projection. Progress remains legacy-compatible while adding `waiting` (with `pending` displayed as waiting), `queued`, `failed`, multi active/queued/next ids, run ids, and derived `waitingOn`/`blockedBy` reasons. The server-derived implementation projection also includes a compact subtask timeline and optional session runtime projection; when queued/running implementation subtasks exist and the main model turn is idle, Chat must present this as `waiting_for_studio_children`/“Studio 后台仍在工作” rather than as a stopped Studio workflow. Child Studio progress uses optional `details.run.progress` fields (`phase`, `tokens`, `tokenSource`, `tps`, `currentTool`, `itemsPreview`, `warnings`, `display`, `terminationReason`) so Chat and the session widget can distinguish `starting`, `waiting_model`, `streaming`, `running_tool`, `waiting_for_user`, and `finished` while showing only bounded recent activity by default. Preview/transcript/API projection clipping is display/storage protection and is surfaced as neutral display metadata; it does not by itself mark the child run failed. Studio child process output is projected rather than relayed raw: stdout is parsed as JSONL into safe progress/final fields, non-text deltas such as tool-call/thinking updates are ignored for parent output, raw stdout/stderr is not retained or used as final-output fallback, line/stderr/final-output/transcript/API response caps prevent oversized strings, and idle/max-runtime/line-limit failures terminate the child run with warnings instead of letting the parent session hang. Active child member processes are registered in `lib/ypi-studio-subagent-runtime.ts`; async Studio child runs also carry parent session continuation metadata so a terminal child can nudge the same live parent session with an idempotent follow-up to collect the run and keep driving `implementation_next`/claim/dispatch without waiting for user input. While such child runs remain queued/running, the parent `AgentSessionWrapper` idle timeout is extended so the continuation callback stays registered and the main Chat remains the visible orchestrator. Explicit parent abort/destroy and abort routes still cancel matching children, using POSIX process-group termination or Windows `taskkill` fallback where possible. The `awaiting_approval -> implementing` transition is hard-gated: entering `awaiting_approval` writes `meta.approvalGate`, only a later explicit user approval input writes `meta.approvalGrant`, and `override` cannot bypass the gate; subtask claim/running/done updates also require the main task to already be in `implementing`. If a child member emits a blocking extension UI request (`select`, `confirm`, `input`, or `editor`), the run is marked `waiting_for_user` and the prompt details are surfaced in the parent tool result instead of leaving the parent session waiting indefinitely. Completed Studio tasks can be archived by moving `.ypi/tasks/<task-id>/` to `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`; archive also records `task.json` metadata/events, clears runtime pointers to the task, writes `.ypi/knowledge/<timestamp>-<slug>.md`, and updates `.ypi/knowledge/index.json`. Active task scanning skips `.ypi/tasks/archive`, archived tasks use stable keys `archived:<YYYY-MM>:<task-id>`, and prompt injection reads only index summaries with hard length limits rather than full archived artifacts.
- Session-scoped Trellis task association remains high-confidence only (session transcript evidence or exact per-session runtime pointers). When evidence identifies a child task, the web projection promotes it to the nearest available parent task so the floating widget represents the main task context without mutating Trellis metadata.
- Session-scoped YPI Studio widgets use high-confidence runtime/context/transcript evidence and ignore `pi_process_*` as widget evidence. The chat UI triggers a debounced session-task recheck when Studio tool progress/results expose a task id/key, recent preview changes, or display-limit flags, so newly created/rebound Studio tasks and live `t/s`/phase updates can surface without a full page reload.
- When all tools are disabled, `lib/rpc-manager.ts` clears the agent system prompt.

## Session File Format

Default location:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

Typical records:

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...]}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":0}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`entryIds[]` in `SessionContext` is parallel to `messages[]` and maps displayed messages back to `.jsonl` entry ids for fork and `navigate_tree` commands.
