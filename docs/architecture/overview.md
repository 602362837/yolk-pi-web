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

### `ypic` CLI reuse flow

`ypic` is an additive terminal chat entry that does not embed its own Pi SDK runtime. Instead it reuses a running yolk-pi-web server over the existing HTTP/SSE API and never auto-starts a server:

```text
Terminal ypic
  ├─ GET /api/cli/health
  │    ├─ ok + app: "yolk-pi-web"  → reuse this server
  │    └─ fail / mismatched app    → print guidance to start `ypi` / Web server manually
  ├─ GET  /api/projects          → find an existing non-archived space matching cwd
  │    └─ POST /api/projects { path }  → if none, register cwd as a project/space
  │                                       (idempotent by canonical pathKey)
  ├─ POST /api/agent/draft  { cwd, projectId, spaceId } → create empty session
  ├─ GET  /api/agent/[id]/events               → connect SSE before the first prompt
  └─ POST /api/agent/[id] { type: "prompt" }   → send the first and follow-up messages
```

`ypic` never self-starts a server: the health endpoint (`GET /api/cli/health`) returns stable identification metadata only (`ok`, `app`, `version`, `pid`, `capabilities`) so the CLI can distinguish a reusable ypi server from another service occupying the same port, and it never exposes env, tokens, user paths, or secrets. When the current directory is not already a known project/space, `ypic` registers it through the existing Project Registry API (idempotent by canonical `pathKey`, reusing `fs.realpath`) so the Web/Studio side treats the directory as a normal project space; chat still works even if registration is skipped, since pi binds sessions by `cwd`. Sessions created through this flow still go through `createConfiguredEmptyAgentSession()` and `startRpcSession()`, so the single-wrapper invariant, YPI Studio / Browser Share extension injection, tool-call normalization, file-change sidecars, usage accounting, and the Studio approval gate all remain identical to Web-created sessions. No new session storage format is introduced. `ypic` is a thin HTTP/SSE client over `bin/ypic.js` (CommonJS, Node built-ins only) and must not import project TypeScript (`lib/**`) so the npm-published package can execute it directly; the shared server-startup helper lives in `bin/server-runner.js`.

#### CLI rendering abstraction: `TerminalFrame` / `PlainFrame`

`ypic` decouples output rendering and input handling via two frame abstractions
that share a common `write`/`writeLine`/`info`/`setStatusDot`/`setStatusText`/
`setModelText`/`setInputHint`/`setPrompt` interface, selected at startup by
`createFrame()`:

- **`TerminalFrame`** (TTY mode, `frame.kind === "tty"`): Only enabled when
  `stdout.isTTY`, `stdin.isTTY`, `NO_COLOR` is unset, and `YPIC_PLAIN` is
  unset. Uses the terminal's alternate screen buffer (`\x1b[?1049h`/`\x1b[?1049l`).
  The visible area is split into:
  - **History rows** (`rows - 3`): A scrolling ring buffer of completed lines
    plus a streaming partial line, rendering assistant deltas, tool-call
    markers, and Studio summaries.
  - **Separator row** (`rows - 2`): A gray full-width `─` line.
  - **Status row** (`rows - 1`): Left side shows a colored dot (`●`) and
    status (idle/RUNNING/ERROR) plus optional context text; right side shows
    the current `provider/modelId · thinking` string.
  - **Input row** (`rows`): A green `> ` prompt plus raw keyboard input
    (basic line editing: backspace, enter, Ctrl-C/D, printable characters).
  Redraws are throttled to ~60 Hz; terminal resize triggers an immediate full
  redraw. SIGINT increments a counter: first Ctrl-C aborts a running agent
  turn; a second Ctrl-C within 1.5 s quits.

- **`PlainFrame`** (fallback, `frame.kind === "plain"`): Activated when TTY
  conditions aren't met (pipes, CI, `NO_COLOR`, `YPIC_PLAIN=1`). Thin wrapper
  around a user-supplied `readline` interface. `write`/`writeLine` go directly
  to `stdout`; `info` writes `[YPIC:info]`-prefixed messages to `stderr`.
  Status/model/hint setter methods are no-ops, so no ANSI sequences are ever
  emitted. Input is handled by `readline`'s standard `line`/`SIGINT` events.

Both frames expose a `modelText` setter so the main loop can update the visible
model after `/model` switches or agent state resolution; the TTY frame redraws
the status row, while the plain frame is a no-op.


## Key Boundaries

- Project Registry is the only top-level project list data source: `/api/projects` reads `~/.pi/agent/pi-web-projects.json` and never scans sessions to synthesize projects.
- Sessions are project-space history records, not project records. Space session lists may filter session headers by `projectId`/`spaceId` and may show exact-cwd legacy sessions separately, but they must not backfill legacy headers automatically.
- Session browsing does not create an AgentSession: API routes read `.jsonl` files through `lib/session-reader.ts`; the only write side effect is pruning stale sessions whose cwd points at a deleted WorkTree.
- Sending commands creates or reuses an in-process AgentSession through `lib/rpc-manager.ts`.
- Client state and SSE streaming behavior are centralized in `hooks/useAgentSession.ts`.
- File viewing and workspace metadata use explicit API routes under `app/api/files/`, `app/api/cwd/`, and `app/api/git/`.

## Project Registry

Project records are stored at:

```text
~/.pi/agent/pi-web-projects.json
```

Each project has a stable `id`, display `rootPath`, canonical `pathKey`, metadata fields (`displayName`, `tags`, `pinned`, `archived`, `metadata`, `lastOpenedAt`), and a `spaces` map. The `main` space represents the project root; its identifier remains `spaceId: "main"` even though the UI fallback label is `主空间` when no custom display name is set. `worktree` spaces represent Git worktrees discovered from `git worktree list --porcelain` or created through the WorkTree API.

WorkTree space metadata is best-effort. Registry records may store the worktree branch, repo/worktree path, main-worktree path/branch, `discoveredAt`, and optional creation-time `baseRef` when a worktree is created through `POST /api/git/worktrees`. Git discovery cannot reconstruct creation-time base refs for old or external worktrees, so missing `baseRef` must be displayed as unknown or clearly treated as a fallback rather than guessed as `main`. Refreshing discovered worktrees should preserve an existing stored `baseRef` instead of dropping it.

Path matching uses `canonicalizeProjectPath()` from `lib/project-registry.ts`: expand and normalize the display path, prefer `fs.realpath` for `realRootPath`/`realPath`, and compare the resulting de-trailed `pathKey`. Project and space dedupe, WorkTree matching, legacy exact-cwd matching, and allowed-root checks should compare `pathKey` rather than display paths so symlinks do not create duplicate projects.

`pi-web-session-index.json` is a best-effort performance sidecar for newly linked/forked sessions. Session JSONL headers remain the source of truth for project-space linkage. Session-list inventory is produced by the project-owned bounded scanner in `lib/session-metadata-scanner.ts` (not Pi SDK `SessionManager.listAll()` / `buildSessionInfo()`): it streams each JSONL by chunk, extracts only list metadata, and never retains `allMessages` / `allMessagesText` or full message/tool content. List reads then apply a bounded one-second single-flight snapshot and invalidate it after local delete/archive/unarchive mutations; stale external writes are reconciled by the short TTL. The index must never be treated as an exclusion list without inventory/header reconciliation. Detail/context/branch/export and Usage assistant-usage scans may still open target files fully; only inventory/list/batch cwd operations stay on the lightweight path.

### WorkTree Archive Space Sync

When a Git WorkTree is archived or deleted (via UI/API, CLI, or direct filesystem operations), the corresponding Project Registry worktree space must be synchronized so the Sidebar no longer shows a stale, now-invalid workspace. The strategy uses two complementary layers:

**1. Active cleanup (UI/API-initiated)**

`archiveGitWorktree()` (archive) and `removeGitWorktree()` (delete) call `archiveWorktreeSpacesByPaths()` with multiple path aliases (`cwd`, `status.cwd`, `status.worktree.repoRoot`) to reliably match the worktree space. Matching uses `pathKey` as the primary key with `displayPath` and `realPath` as fallbacks. Matched spaces are soft-archived: `archived: true`, `missing: true`, with additive audit metadata (`archivedReason`, `archivedAt`, `lastKnownPath`) — never hard-deleted from the registry. After archiving, `invalidateAllowedRootsCache()` is called so the file API does not retain authorization for the removed WorkTree path.

**2. Passive sync (external changes)**

- **Missing-only sync** (`syncMissingWorktreeSpaces`): Scans non-archived worktree spaces across all (or a single) projects, checks filesystem existence via `canonicalizeProjectPath()`, and soft-archives spaces whose directories no longer exist. No Git commands are executed. Suitable for lightweight triggers such as project-list loads or Sidebar refreshes.
- **Full Git refresh** (`syncProjectWorktreeSpaces`): Runs `git worktree list --porcelain` to discover current worktrees, upserts discovered spaces (un-archiving previously-archived ones if the path reappears), and archives spaces not found by Git. After the full refresh, a best-effort missing-only pass catches CLI removals that the Git porcelain may not reflect.

**Frontend integration**

`SessionSidebar.confirmWorktreeAction()` optimistically merges the API response's `archivedSpaces` into local project state so the worktree space disappears immediately, then refreshes projects in the background. If the currently-selected space was the archived one, fallback preference: (1) `main` space of the same project, (2) any other active non-missing space, (3) API-provided `fallbackCwd`, (4) null.

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
- `projectId`/`spaceId` are optional project-space linkage fields. New web-created linked sessions write both fields and update `pi-web-session-index.json`; old sessions without either field remain readable/openable and are reported as legacy unassigned.
- YPI Studio child sessions are persistent audit sessions marked by a header `studioChild` object. The standard `parentSession` field still points to the parent chat JSONL file for Pi/fork display compatibility, while `studioChild.parentSessionId` stores the parent chat session id used by Studio runtime correlation. `.ypi/tasks/<task>/task.json` remains the workflow/run status source of truth; the child JSONL is only an audit, replay, provider-affinity, and usage-accounting carrier. When a child tab connects to `/api/agent/[id]/events`, the server follows the child JSONL as a read-only audit stream (`studio_child_audit_changed` / `studio_child_audit_end`) instead of calling `startRpcSession()`; this lets the reused chat renderer refresh while preserving the child guard and avoiding Studio/Browser Share tool injection. Usage accounting may roll up assistant `usage` from child JSONL files to the parent session, but parent chat `messages`, SSE payloads, and model context must not receive child transcripts, child messages, or child usage detail entries. UI session projections may add optional `studioChildDisplay` (`subtaskId`, `subtaskTitle`, `taskTitle`, `runSummary`) so sidebar titles and new child `session_info` names share one pure formatter: stable `subtaskId · subtaskTitle` when a step is bound, otherwise `member · taskTitle` with no fake step numbers, under the 50-char budget. Projection cache keys include `subtaskId` and `runId`. Historical children update through read-time projection only; no JSONL migration or header schema change.
- Active inventory (`listAllSessions`, allowed-roots cwd discovery, delete-by-cwd, archive-all) and archived list inventory reuse `scanSessionInventory()` / `scanSessionMetadata()` from `lib/session-metadata-scanner.ts`. Results keep path/id/cwd/name/parent path, created/modified, messageCount, and a bounded `firstMessage` (API default 100 chars; UI titles still use the existing 50-char display normalization). Single-file failures are isolated; malformed/orphan files are omitted rather than failing the whole list.
- Session files are fully rewritable when updating display metadata such as cascade reparenting on delete.
- Deleting or archiving a linked Git WorkTree also deletes session JSONL files whose `cwd` points at that WorkTree; session listing also prunes stale missing `*.worktrees/*` cwd sessions left by older versions.
- Orphaned sessions whose first line cannot be parsed as a valid header are marked `orphaned: true` and displayed as incomplete, not clickable.

### Archive path

Archived sessions are stored at:

```text
~/.pi/agent/sessions-archive/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

Archive/unarchive is a pure file move (`renameSync`) between `sessions/` and `sessions-archive/`. The session JSONL content is never modified. Active RPC sessions are destroyed before the file is moved.

Active sessions live under `sessions/`; archived sessions live under `sessions-archive/`. Both directories are enumerated by the same lightweight metadata scanner with different roots (`scanSessionInventory()` vs `scanSessionInventory({ rootDir: getSessionsArchiveDir() })`), but **call sites are separated**:

- **Active Sidebar / list hot path:** `GET /api/projects/:projectId/spaces/:spaceId/sessions` and `GET /api/sessions` only read active inventory. They do **not** call `scanArchivedCwds()`, do **not** walk `sessions-archive/`, and do **not** return `archivedCounts` / `archivedCwds`. SessionSidebar only displays active history and archive **write** actions (single/batch/archive-all); it has no archived list, count, or unarchive UI.
- **Explicit archive capability (kept):** `POST /api/sessions/archive`, `archive-all`, `unarchive`, `GET /api/sessions/archived`, session-by-id detail with `archived: true` (read-only chat), and Usage when `usage.includeArchived` is enabled. `scanArchivedCwds()` remains available in `lib/session-reader.ts` for explicit helpers but is not wired into active list routes.
- **Project list source:** Project Registry (`pi-web-projects.json`), not archive cwd counts or a CWD picker synthesized from sessions.

Archive-all matches target sessions by canonical cwd against the lightweight **active** inventory and must not call SDK `SessionManager.listAll()`. Removing archive I/O from the Sidebar path does **not** by itself rewrite active `listAllSessions()` into a directed per-space scan; that remains a separate performance concern.

### Session inventory memory contract

- **In scope (lightweight only):** global/project **active** session lists, allowed-roots session cwd discovery, delete sessions for WorkTree cwd, archive-all (active inventory), and **explicit** archived session lists / Usage archive helpers that need name/count/firstMessage/modified.
- **Out of scope (may open full files):** session detail, context/branch tree, export, and Usage precise assistant-`usage` scans for selected sessions. Usage still builds its session set from the lightweight inventory (`listAllSessions` / archived helpers with `includeStudioChildren: true`) and must not depend on `allMessagesText`.
- **Studio child defaults unchanged:** list roots hide Studio children unless `includeStudioChildren` is set; UI may opt into `includeStudioChildDisplay` for task-title projection; Usage opt-in child rollup is unchanged.
- **Rollback:** code-level only — restore previous inventory call sites to SDK `SessionManager.listAll()` if needed. No JSONL migration or data rollback. Do not long-term default back to the full-text inventory path.

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

### Usage accounting

- `GET /api/usage` is a read-only reporting path. It scans active sessions and, when `pi-web.json` `usage.includeArchived` is enabled, archived sessions; usage scans explicitly opt in to YPI Studio child audit sessions so Studio SDK child JSONL costs are visible in totals.
- Global usage responses keep the legacy `bySession` dimension as individual JSONL files and add `byParentSession` for parent-chat rollups. Ordinary sessions roll up to themselves; Studio child sessions roll up by `studioChild.parentSessionId`; unresolved/deleted parents still produce `parentFound=false` rows so child usage is not dropped.
- `GET /api/usage?sessionId=<id>` returns a lightweight lifetime `session_rollup` for the selected session: parent own totals, Studio child totals, combined totals, child count, and child session summaries. If the selected session is itself a Studio child, the rollup resolves back to its parent id when possible. The result also exposes additive `selectedSessionTotals` (the selected session's own usage), `parentRollupTotals` (parent own + Studio children, equal to `totals`), and `childSessions[].contextUsage` so the top bar can render confirmed values without guessing from generic totals. Old fields keep their semantics; callers that ignore additive fields continue to work.
- Child `contextUsage` is a bounded numeric-only projection (`percent`, `contextWindow`, `tokens`, availability/source, optional capture time). The SDK child runner samples authoritative `AgentSession.getContextUsage()` at low frequency and once before teardown; the runtime can retain that sample process-locally after unregister. CLI, historical/restarted, and never-sampled children return explicit null-valued `unavailable`. It never derives occupancy from lifetime usage or progress tokens/tps, never changes JSONL headers, and never returns child transcript, prompt, output, tool result, artifact, or path data.
- Chat top-bar usage display口径 (confirmed): a `parent` session compact shows the parent rollup total and appends `incl. Studio` only when Studio children have real usage (child token total or child cost > 0, not merely child count > 0); a `standalone` session compact shows its own usage with no child marker; a `studio_child` audit session compact shows only that child's own usage (`selectedSessionTotals`) and must not show a bare `+child` or a parent-rollup placeholder, while its tooltip may include the parent rollup total and parent id. The top bar must not mutate the parent session file or append child content to the React message list.
- Usage totals come only from standard assistant message `usage` fields persisted in session JSONL. The reporting path does not parse `.ypi/.runtime/studio-subagents/*.jsonl` sidecars, does not estimate CLI `--no-session` runner cost, and does not return transcript, prompt/output, or artifact bodies.
- Chat top-bar usage prefers the `session_rollup` API result and falls back to local parent-session `messages` usage while loading or after API failure. This is a display-only enhancement and must not mutate the parent session file or append child content to the React message list.

### Models and tools

- `GET /api/models` returns `defaultModel` from `~/.pi/agent/settings.json`.
- New-session tool names are passed to `POST /api/agent/new` as `toolNames[]`.
- Existing sessions infer presets via `get_tools` and `getPresetFromTools()`.
- Auth changes call `reloadRpcAuthState()` so live AgentSessions reload auth/model state. The same path also cleans pi-ai session resources because OpenAI Codex keeps reusable WebSockets keyed by session id, and those sockets must reconnect after ChatGPT account activation to pick up new auth headers.
- **Grok provider bootstrap**: Every Web entry point (main sessions, Models API, Auth API, Studio SDK children, assistant model resolvers) includes `grokCliExtension` through `webExtensionFactories()` or `ensureGrokBootstrapped()`. The `pi-grok-cli@0.4.1` extension registers the `grok-cli` provider, OAuth, static model catalog, and request hooks in the process-global pi-ai registry. Any `ModelRegistry.refresh()` call that does not first load Grok can reset it from the global provider set; `createGrokAwareModelRegistry()` and the audit of all `ModelRegistry.create` call sites prevents this.
- **Grok session-account isolation**: Each Grok session pins an opaque saved-account storage id in its JSONL header (`grokAccountStorageId`). The `grokSessionAccountExtension` (`before_provider_headers` hook) injects the session-bound Bearer token per request, overriding the global active account's credential. Concurrent Grok sessions with different accounts never share tokens. Active account switching only changes the default for new Grok sessions; existing sessions keep their binding. Fork inherits the parent binding; Studio SDK Grok children inherit the parent binding. Session binding is restored on resume from the JSONL header. Deleting an account with active session references returns 409 with a bounded reference count; the UI requires migration or explicit disconnect.
- **Grok token refresh**: Per-account single-flight refresh through `getOAuthApiKey()` in `pi-ai/oauth`. Refreshed credentials are atomically written to the account secret file (tmp+rename, 0600). The active-mirror to `auth.json` uses compare-and-set: only when the refreshed account is still the current active account at completion time. Different accounts refresh independently under different flight keys.
- **Grok quota**: Web-owned billing client in `lib/grok-subscription-quota.ts`. No private `pi-grok-cli` path imports. Reads monthly (`/billing`) and optional weekly (`/billing?format=credits`) with 60s fresh / 24h stale TTL, 10s timeout, single-flight, and one forced refresh+retry on 401/403. Only normalized allowlist fields reach the wire (`GrokQuotaResultV1`); all responses carry `Cache-Control: no-store`. POST reset-credit returns 405 for Grok.
- **Full extension scope**: The approved `pi-grok-cli` default factory includes Cursor tools, vision, and Imagine alongside the provider core. The `before_provider_headers` hook covers main inference requests; vision/Imagine token paths that bypass this hook are a documented risk.
- **Grok account data layout**: Credentials under `~/.pi/agent/auth-accounts/grok-cli/` with `accounts.json` (0600, metadata only) and per-account `<storage-id>.json` (0600, full credential). Deleted accounts move to `deleted/`. Quota cache is `.quota-cache.json`.
- ChatGPT usage auto-refresh is backend-owned, not browser-tab-owned. The scheduler state lives on `globalThis.__piChatGptUsageRefreshScheduler` and uses `~/.pi/agent/chatgpt-usage-refresh.lock` to reduce duplicate refresh loops across Node processes. Stale lock detection follows the configured refresh cycle dynamically.
- Trellis subagent child processes resolve model policy from `pi-web.json` `trellis.subagents`: explicit tool input wins, then per-agent fixed policy, then optional route table policy, then default policy, then `.pi/agents/*` frontmatter, then Pi CLI defaults. Automatic routing is opt-in and classifies `text`/`multimodal` plus `simple`/`standard`/`complex`/`critical`; router failures fall back to configured safe route/default behavior. The default policy follows the main session model when the Pi extension context exposes it; otherwise it safely falls back to Pi default. If the selected child model process fails, existing `.pi/agents/*` `fallbackModels` frontmatter entries are retried in order; if those also fail and the main session model is known, the child finally falls back to the main session model.
- YPI Studio workflow orchestration is loaded as a built-in extension factory from `lib/rpc-manager.ts` so every web-created AgentSession receives the `ypi_studio_task` and `ypi_studio_subagent` tools plus `/studio-init`, `/studio-start`, `/studio-feature`, `/studio-bugfix`, `/studio-ui`, `/studio-continue`, `/studio-check`, and `/studio-archive` commands regardless of the selected workspace's project-local `.pi` files. `ypi_studio_task current/get` returns compact summaries by default (artifact paths, recent 10 events plus total count, subtask/run summaries, and next action hints) and requires explicit `detail="full"` opt-in for complete task JSON; `ypi_studio_subagent` results likewise embed compact task summaries so polling/collecting child runs does not replay full documents/events into chat context; `ypi_studio_wait` is the preferred main-path wait primitive after async delegation, streaming progress as tool updates and returning terminal child results to the same model turn. The extension injects `.ypi/tasks` workflow state and bounded `.ypi/knowledge` summaries into each turn, binds sessions through stable context ids (`pi_<sessionId>` first, transcript hash second, process fallback last; see exclusive session ownership below), resolves Studio member model/thinking policies through the pure `lib/ypi-studio-policy.ts` chain `toolInput > memberConfig > defaultPolicy > followMain > piDefault`, canonicalizes member ids before config/member-file lookup, emits policy diagnostics/warnings in live progress and final tool results, isolates child member Pi processes from Trellis injection with child env flags, and stores structured task progress under the selected workspace's `.ypi/` directory. Studio tasks may also contain `implementationPlan` plus `implementationProgress`: architects save a structured subtask plan before `awaiting_approval`, and after user approval the parent session claims ready subtasks before dispatching implementer with `subtaskId`. The scheduler contract is batch-oriented at orchestration level: each implementer child run receives exactly one `subtaskId`, but the parent session must fill available `maxConcurrency` slots by claiming all ready subtasks that fit and launching one async implementer run per claimed subtask in the same orchestration turn. The schemaVersion 2 contract treats `implementationPlan.subtasks[].dependsOn` as the DAG scheduling source for serial, parallel, and mixed work; `execution.groups` is only a UI/readability projection. Progress remains legacy-compatible while adding `waiting` (with `pending` displayed as waiting), `queued`, `failed`, multi active/queued/next ids, run ids, and derived `waitingOn`/`blockedBy` reasons. The server-derived implementation projection also includes a compact subtask timeline and optional session runtime projection; when queued/running implementation subtasks exist and the main model turn is idle, Chat must present this as `waiting_for_studio_children`/“Studio 后台仍在工作” rather than as a stopped Studio workflow. Child Studio progress uses optional `details.run.progress` fields (`phase`, `tokens`, `tokenSource`, `tps`, `currentTool`, `itemsPreview`, `warnings`, `display`, `terminationReason`) so Chat and the session widget can distinguish `starting`, `waiting_model`, `streaming`, `running_tool`, `waiting_for_user`, and `finished` while showing only bounded recent activity by default. Preview/transcript/API projection clipping is display/storage protection and is surfaced as neutral display metadata; it does not by itself mark the child run failed. Studio child process output is projected rather than relayed raw: stdout is parsed as JSONL into safe progress/final fields, non-text deltas such as tool-call/thinking updates are ignored for parent output, raw stdout/stderr is not retained or used as final-output fallback, line/stderr/final-output/transcript/API response caps prevent oversized strings, and idle/max-runtime/line-limit failures terminate the child run with warnings instead of letting the parent session hang. Active child member processes are registered in `lib/ypi-studio-subagent-runtime.ts`; async Studio child runs also carry parent session continuation metadata so a terminal child can nudge the same live parent session with an idempotent follow-up to collect the run and keep driving `implementation_next`/claim/dispatch without waiting for user input. Continuations are kept pending when the parent callback is temporarily unavailable or rejects delivery, and the parent wrapper retries follow-up prompts while the model is busy so ready work is not lost just because the child finished between UI polls or during a transient streaming window. Web-created sessions pass the raw session id into the Studio extension, register continuation aliases for raw `sessionId`, `pi_<sessionId>`, and transcript hash, and expose `studioChildRunCount` through `get_state`/`agent_end` so the UI keeps showing `waiting_for_studio_children` after the model turn ends. Async child progress remains in the in-process runtime registry and is merged into widget/API projections while the run is active; `task.json` persists only lifecycle snapshots (start, child-session audit reference, terminal state), so widgets and continuation decisions receive live state without high-frequency task-file writes. While such child runs remain queued/running, the parent `AgentSessionWrapper` idle timeout is extended so the continuation callback stays registered and the main Chat remains the visible orchestrator. Explicit parent abort/destroy and abort routes still cancel matching children, using POSIX process-group termination or Windows `taskkill` fallback where possible. The `awaiting_approval -> implementing` transition is hard-gated: entering `awaiting_approval` writes `meta.approvalGate`, only a later explicit user approval input writes `meta.approvalGrant`, and `override` cannot bypass the gate; subtask claim/running/done updates also require the main task to already be in `implementing`. Before a task may enter `awaiting_approval`, it must contain a meaningful non-TBD `plan-review.md` artifact. The task detail UI treats this file as the dedicated plan-approval preview, but viewing it or opening its Markdown links does not grant approval. Plan-approval links are task-local only: the browser intercepts relative Markdown links for UX, and the task file preview API is the server-side safety boundary that rejects URL schemes, absolute paths, `..` escapes, directory targets, and symlink escapes. If a child member emits a blocking extension UI request (`select`, `confirm`, `input`, or `editor`), the run is marked `waiting_for_user` and the prompt details are surfaced in the parent tool result instead of leaving the parent session waiting indefinitely. Completed Studio tasks can be archived by moving `.ypi/tasks/<task-id>/` to `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`; archive also records `task.json` metadata/events, clears runtime pointers to the task, writes `.ypi/knowledge/<timestamp>-<slug>.md`, and updates `.ypi/knowledge/index.json`. Active task scanning skips `.ypi/tasks/archive`, archived tasks use stable keys `archived:<YYYY-MM>:<task-id>`, and prompt injection reads only index summaries with hard length limits rather than full archived artifacts.
- YPI Studio **exclusive session ownership** is a write-side invariant on active tasks: **one task has at most one session-class owner**, while **one session may still bind many different tasks** (the multi-task widget is unchanged). Session-class context ids are only `pi_<sessionId>`, `pi_transcript_<hash>`, and `pi_process_<hash>`; unknown/non-session values in `contextIds` are treated as metadata and preserved. Create initializes owner when a `contextId` is supplied. Explicit `bind`/continue (`bindYpiStudioTaskToContext` / `PATCH ... { action: "bind", contextId }`) is the only public transfer path: under `withTaskMutationLock` it replaces all known session-class keys with the new owner (non-session keys stay), writes the new runtime pointer, and compare-before-unlinks removed-context pointers only when they still point at this task. Idempotent re-bind to the same sole owner refreshes the pointer without a transfer event. Transfer clears a main-task `meta.approvalGrant` whose grant context differs from the new owner so cross-session approval cannot be reused; the new owner must re-approve explicitly. Ordinary active-task mutations (artifact/plan/transition/approval/claim/subtask/improvement paths that carry a context) call `assertTaskBoundToContext` and must not append or implicitly reclaim ownership. Session-link reading stays exact-`contextIds` only and does **not** guess the current owner from array order, `updatedAt`, or runtime pointers. Legacy multi-owner tasks are not migrated on read; the next explicit bind lazily normalizes them. Archived tasks remain immutable and continue to reject bind; archive cleanup still clears matching runtime pointers.
- YPI Studio **improvement flow** is an additive, main-task-owned lifecycle for issues raised during main-task user acceptance. Each improvement instance (`improvements.instances[]` with `schemaVersion: 1`) lives under the single owning main task at `.ypi/tasks/<task>/improvements/<imp-id>/` and carries a stable `imp_…` id, display id `IMP-001`…, title, bounded `feedback`, `status`/`phase`/`owner` (default owner `improver`), optional `approval`/`acceptance`/`disposition`/`approvalMode`, and its own artifact/plan/progress/run metadata. Instances never appear in the top-level Tasks list, never bind/chat/archive/complete independently, and the main task remains the only top-level record. Main-flow status extension: `review -> user_acceptance -> completed` (no issues) or `user_acceptance -> waiting_for_improvements` (once the user confirms creating an improvement) and `waiting_for_improvements -> review` only after **every** instance is `accepted` or explicitly `accepted_not_doing`; `completed`/`archive` are blocked while any instance remains unresolved (`analysis | waiting_clarification | waiting_prototype | waiting_plan_approval | implementing | checking | waiting_user_acceptance | cancelled | failed`), so a failed or cancelled item keeps the main task blocked until the user explicitly accepts “not doing” it with a reason and timestamp. All instance mutations reuse the parent `withTaskMutationLock` (staging + atomic rename + JSONL event append + `reconcileYpiStudioImprovements`), and the reconcile re-reads **all** instances after every terminal transition so concurrent final-instance completion cannot prematurely complete the main task. Improvements can only be created from `review`, `user_acceptance`, or `waiting_for_improvements`; the `create` transition and the main task's move to `waiting_for_improvements` are atomic within the same lock, so a duplicate request never produces two instances. Valid instance transitions are limited to `analysis -> waiting_plan_approval -> implementing -> checking -> waiting_user_acceptance -> accepted`; `implementing` requires a recorded user approval of the current revision (and the same session `contextId` when one was recorded), `recordYpiStudioImprovementApproval()` requires a meaningful non-TBD `plan-review.md` and a task-local HTML prototype whenever `ui.md` indicates a UI change, and `reviseYpiStudioImprovementPlan()`/`updateYpiStudioImprovementArtifact()` atomically bump the instance revision and clear any stale grant, so an old approved revision cannot implement. The instance file resolver `resolveYpiStudioImprovementRelativeFile()` (used by `GET /api/studio/tasks/[taskKey]/files/?improvementId=…`) scopes to the instance root and rejects URL schemes, absolute paths, `..` traversal, backslashes, directory targets, and symlink escapes relative to that directory; an unknown `improvementId`, an instance that does not belong to the task, or a task without improvements returns an error without reading any file — `../task.json` reaching back into the task directory is rejected. Bounded projection: widget/compact-tool/JSONL-event payloads expose only `taskId`, `improvementId`, status, counts, the first unresolved instance's blocker and next action, and a per-instance `{ id, displayId, title, status, owner, updatedAt }` (plus a bounded `feedbackPreview` in the compact tool projection); they never carry full `feedback` text or child transcripts. The authoritative `getYpiStudioTaskDetail` is the only layer that returns full instance `feedback`, and only the detail-page “概览” tab consumes it. **Migration & rollback:** v1 tasks without an `improvements` field project as having no improvements, are never auto-written back, never become top-level tasks, and the field upgrades lazily on first improvement mutation. Custom workflows that lack `user_acceptance`/improvement capabilities surface the capability gap and are never overwritten. Rolling back the feature only disables the new actions/gate; existing improvement records stay read-only, auditable, and still require an explicit `accepted_not_doing` disposition to close unresolved instances, so historical data is never silently dropped. A new default `improver` member is added in the fixed Settings → Studio order `architect / improver / ui-designer / implementer / checker` with default policy `model.mode=followMain` and `thinking=inherit`, resolvable through the same `toolInput > memberConfig > defaultPolicy > followMain > piDefault` chain; default member/workflow template refresh remains non-destructive (exact-default files only, custom files untouched).
- Session-scoped Trellis task association remains high-confidence only (session transcript evidence or exact per-session runtime pointers). When evidence identifies a child task, the web projection promotes it to the nearest available parent task so the floating widget represents the main task context without mutating Trellis metadata.
- YPI Studio UI prototype gate is a workflow/prompt/checker invariant: if a task changes pages, adds frontend functionality, changes existing interactions, changes approval/confirmation experience, or changes user-visible information structure, the architect must dispatch the UI designer to produce an HTML prototype based on the existing project and request user approval before implementation. `ui.md` may carry the HTML prototype or link to a `.html` file, but pure Markdown cannot satisfy the gate; checker treats missing HTML prototype or approval record as blocking.
- Session-scoped YPI Studio widgets use high-confidence exact `contextIds` matches (`pi_<sessionId>` / `pi_transcript_<hash>`) and ignore `pi_process_*` as widget evidence. After exclusive transfer, the previous session no longer has the task in `contextIds`, so it drops out of bound candidates even if the transcript still mentions the task (transcript hits stay diagnostics-only). A single session can still show multiple different bound tasks; exclusivity is per task, not per session. The chat UI triggers a debounced session-task recheck when Studio tool progress/results expose a task id/key, recent preview changes, or display-limit flags, so newly created/rebound Studio tasks and live `t/s`/phase updates can surface without a full page reload.
- When all tools are disabled, `lib/rpc-manager.ts` clears the agent system prompt.
- Memory diagnostic snapshots are a bounded, read-only运维 capability — not a leak fix. `POST /api/diagnostics/memory-snapshot` (and the Settings → 诊断 button) capture one schema-v1 snapshot in the current server process and atomically write it to `<getAgentDir()>/diagnostics/`. The collector (`lib/memory-diagnostics.ts`) composes process/V8 metrics and bounded owner projections from `rpc-manager`, `ypi-studio-subagent-runtime`, `session-reader`, `browser-share-manager`, `terminal-manager`, and `session-file-changes` under a 5s cooperative deadline and a 5 MiB final-JSON cap (with a compact fallback that drops per-item samples but keeps totals). Capture is strictly read-only: no abort/destroy/cleanup/reset/GC, no session start/list, no content/tool-result/system-prompt/response-id/buffer/env/credential reads. OpenAI Codex WebSocket debug stats are queried **only for known active openai-codex sessions via public getters** and only numeric/boolean fields are kept (per-known-session coverage, not the full private map; previous response ids and error strings are never persisted). A process-global single-flight guard (`globalThis.__piMemoryDiagnosticSnapshotInFlight`) rejects concurrent triggers with `409 snapshot_in_progress`. The API/UI return **metadata only**; the full JSON is never sent over HTTP or rendered in the browser. The snapshot retains local workspace/session paths and ids (with a `privacy` block + share-before-review warning) to aid correlation. Files use input-free names `memory-<UTC compact>-pid<PID>-<8hex>.json`, written via same-directory tmp + `rename` with best-effort `0700`/`0600`. There is no automatic retention/list/download center; users delete files manually. Diagnostics are additive and do not change JSONL, task, session, or config formats.

## Session File Format

Default location:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

Typical records:

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl","projectId":"prj_...","spaceId":"main"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...]}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":0}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`projectId`, `spaceId`, and `grokAccountStorageId` are optional. `projectId` and `spaceId` are written for new project-space sessions and inherited on fork; `grokAccountStorageId` is the opaque saved-account id bound for Grok session isolation and is inherited on fork/resume. Legacy files that omit them are not migrated or backfilled automatically.

YPI Studio SDK child sessions append optional `studioChild` metadata to the header without changing the standard Pi fields. SDK child profiles must not load the parent YPI Studio or Browser Share extensions; they should include the child guard extension from `lib/ypi-studio-child-guard.ts`, which blocks recursive Studio/subagent tools, Browser Share action tools, and best-effort direct `.ypi/tasks/**/task.json` mutations. Child members return lifecycle intentions to the parent chat; only the parent session uses Studio tools to update task state and approval-gated implementation progress:

```json
{
  "studioChild": {
    "schemaVersion": 1,
    "kind": "ypi-studio-child-session",
    "runner": "sdk",
    "visibility": "child",
    "status": "running",
    "parentSessionId": "<parent chat session id>",
    "parentSessionFile": "/abs/path/to/parent.jsonl",
    "contextId": "pi_<parent chat session id>",
    "taskId": "<studio task id>",
    "runId": "<studio subagent run id>",
    "member": "architect|implementer|checker|custom",
    "subtaskId": "<optional implementation subtask id>",
    "createdAt": "...",
    "finishedAt": "..."
  }
}
```

`studioChild.status` is best-effort display/audit metadata. Studio task state, subagent run terminal status, approval gates, and implementation subtask progress remain authoritative in `.ypi/tasks/<task-id>/task.json`, so old tasks and sessions that omit `studioChild`, `runner`, or `childSessionId` require no migration.

`entryIds[]` in `SessionContext` is parallel to `messages[]` and maps displayed messages back to `.jsonl` entry ids for fork and `navigate_tree` commands.

### OpenCode Go managed API-key account failover

An optional, default-off auto-failover mechanism for `opencode-go` managed API-key accounts. When enabled in `pi-web.json` (`opencodeGo.autoFailover.enabled`), the `AgentSessionWrapper` in `lib/rpc-manager.ts` patches the agent lifecycle to detect quota-exhausted or account-unusable errors and switch the globally active account once per turn.

**Error classification** (in `lib/opencode-go-account-failover.ts`):
- `quota_exhausted`: matched by conservative allowlist regex against `GoUsageLimitError`, `FreeUsageLimitError`, `Monthly usage limit reached`, `available balance`, `insufficient_quota`, `out of budget`, `quota exceeded`, `billing`, and 402 with credits/balance/quota hints. The trigger account enters a process-level cooldown (`exhaustedCooldownMs`, default 30 min).
- `account_unusable`: matched against `AuthError Invalid API key`, `AuthError Missing API key`, and 401/403 with unauthorized/forbidden/invalid-key/missing-key body text. The trigger account is **persistently disabled** inside the process-level lock (metadata `disabled=true`, `disabledBy="system"`, `autoDisabledReason="account_unusable"`), removing it from future failover candidates until a user manually re-enables it in Settings.
- Not eligible: transient 429/rate-limit, network errors, 5xx, timeouts, stream-end, context overflow, content filter — these never trigger a switch.

**No reliable quota API**: OpenCode Zen Go does not expose a public, API-key-authorized quota/balance/usage endpoint. v1 is strictly passive failover and never makes proactive quota queries. If a future public quota API becomes available, `lib/opencode-go-account-failover.ts` can integrate a quota cache without changing the error-driven failover path.

**Managed account enable/disable semantics** (in `lib/api-key-accounts.ts`):
- `disabled` accounts are additive metadata fields (`disabled`, `disabledAt`, `disabledReason`, `disabledBy`, `autoDisabledReason`, `enabledAt`, `enabledBy`). Old accounts without `disabled` are treated as enabled.
- Disabled accounts cannot be activated (`activateApiKeyAccount` throws `ApiKeyAccountDisabledError`) and are skipped in failover candidate selection.
- `enableApiKeyAccount` restores eligibility but does not auto-activate.
- Disabling an active account requires a replacement account id or explicit `clearActive`; the operation must never leave a disabled account as the active mirror.

**Concurrency model** (process-level):
- `globalThis.__piOpencodeGoFailover` holds a process-level mutex (`withFailoverLock`), a cooldown map (`exhaustedUntil`), and a `lastSwitchAt` timestamp.
- Each agent turn captures the active account id before the model request (`runTriggerAccountId`). After the native pi retry/compaction chain and the ChatGPT failover patch return, the opencode-go patch inspects the failed assistant message.
- Inside the lock: if `account_unusable`, persist-disable the trigger; if `quota_exhausted`, mark cooldown. Then check if `activeAfterLock !== triggerAccountId` (another session already switched) — if so, retry without switching (no A→B→C cascade).
- Before `activateApiKeyAccount(nextAccountId)`, double-check `activeBeforeActivate` — if changed, retry without switching (TOCTOU guard).
- Candidate selection skips active, trigger, attempted, disabled, cooldown accounts, and traverses the list circularly from the trigger's position.
- Default per-turn budget: `maxAttemptsPerTurn=1`, `maxAccountSwitchesPerTurn=1`.
- On success, the failed assistant message is removed from agent state so pi retries the same turn with the new active key. A structured `opencode_go_account_failover` SSE event is emitted to the frontend.

**Frontend feedback**:
- Settings → OpenCode Go toggle (`opencodeGo.autoFailover.enabled`) with strategy description and disabled-account guidance.
- Models → OpenCode Go account list shows disabled state, reason, Enable/Disable actions, and blocks activation of disabled accounts.
- `useAgentSession.ts` handles `opencode_go_account_failover` SSE events and surfaces lightweight notices (auto-dismissing after 12s) through `ChatInput`. Notices never include plaintext API keys.

**Rollback**: Disable `opencodeGo.autoFailover` in Settings. Old account metadata defaults to enabled; no migration required. Persistently disabled accounts may be manually re-enabled.
