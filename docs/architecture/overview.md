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
  │                        │   startRpcSession() ─────────▶│ createWebAgentSessionServices()
  │                        │                               │ + createAgentSessionFromServices()
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

- **Links domain** is a standalone subsystem isolated from all LLM auth (see [Links / GitHub OAuth Device Flow](#links--github-oauth-device-flow) below). It stores OAuth connection metadata and secrets under `~/.pi/agent/links/` and must never import `auth.json`, `auth-accounts/`, `auth-api-key-accounts/`, `CredentialStore`, `ModelRuntime`, or RPC auth reload modules.
- Project Registry is the only top-level project list data source: `/api/projects` reads `~/.pi/agent/pi-web-projects.json` and never scans sessions to synthesize projects.
- Sessions are project-space history records, not project records. Space session lists may filter session headers by `projectId`/`spaceId` and may show exact-cwd legacy sessions separately, but they must not backfill legacy headers automatically.
- Session browsing does not create an AgentSession: API routes read `.jsonl` files through `lib/session-reader.ts`; the only write side effect is pruning stale sessions whose cwd points at a deleted WorkTree.
- Sending commands creates or reuses an in-process AgentSession through `lib/rpc-manager.ts`.
- Client state and SSE streaming behavior are centralized in `hooks/useAgentSession.ts`.
- File viewing and workspace metadata use explicit API routes under `app/api/files/`, `app/api/cwd/`, and `app/api/git/`.

## Appearance skins

Appearance is an independent, service-instance-wide background-skin domain; it is not a full color-theme system and does not use `pi-web.json` or the generic file-upload route. Browser light/dark preference remains the existing local `pi-theme` setting. Skins are either **image** (static WebP full) or **video** (local MP4 full + WebP poster/thumb); GIF/animation WebP, WebM/MOV, remote URL, and audio playback are out of scope. Its durable layout is:

```text
<getAgentDir()>/appearance/
  index.json                      # schema-v1 metadata only (kind optional; missing => image)
  skins/<opaque-id>.webp          # image full only
  skins/<opaque-id>.mp4           # video full only (original validated bytes; P0 no re-encode)
  skins/<opaque-id>.thumb.webp    # image thumbnail OR video poster
  .tmp/ .trash/ .mutation.lock/
```

`lib/appearance-store.ts` reads a missing catalog as the current default appearance. It treats malformed/unknown catalog data (including unknown `kind` / mime pairings) as fail-closed and never repairs it during a read. Mutations use an opaque catalog revision and `If-Match` CAS, a process queue plus cross-process mkdir lock, atomic metadata replacement, and rollback-capable asset staging/quarantine. An active skin deletion is one transaction that clears `activeSkinId` before committing asset removal for the kind-specific full file plus shared `.thumb.webp`; a failed transaction must leave the last valid catalog and assets usable. Catalog and wire projections contain opaque ids, cleaned names, `kind`, dimensions, optional `durationMs` (video), bounded presentation values, and app-local asset URLs only—never paths, hashes, source bytes, source metadata, or decoder/probe diagnostics.

Uploads are handled only by `POST /api/appearance/skins` (form allowlist `file` / `name` / `revision` / optional `poster`). The server sniffs content rather than trusting filename or Content-Type: JPEG/PNG/static WebP go through `lib/appearance-image.ts` (`sharp`); MP4 goes through `lib/appearance-video.ts` (bounded ftyp/moov parse, size/duration/resolution caps, no stream re-encode). Video poster prefers ffmpeg frame extract via exact-pinned `ffmpeg-static` (strategy A) with optional form `poster` image fallback (strategy B) when a frame cannot be produced. Successful uploads currently auto-activate. Public limits keep image `maxUploadBytes` at 20 MiB and add video-specific `maxVideoUploadBytes` (50 MiB), `maxVideoDurationMs` (30s), `maxVideoLongEdge` (1920), shared `maxSkins` (30) and `maxTotalBytes` (250 MiB). Asset reads resolve a catalog-referenced opaque id plus fixed `full|thumbnail` variant: image full and all thumbnails are `image/webp`; video full is `video/mp4` with byte `Range` support. Responses use private immutable caching, ETag, and `nosniff`; catalog/mutation responses are `no-store`.

`app/layout.tsx` is `force-dynamic` and reads a safe active-skin bootstrap before rendering. For image skins it emits app-local full-asset CSS vars; for video skins it bootstraps **poster/thumbnail URL only**, `data-appearance-kind="video"`, and an inert host `#appearance-bg-video` **without** `src` (no SSR autoplay). Absent/corrupt/missing assets fall back to the original opaque surfaces without blocking Chat. `app/globals.css` keeps fixed inert `body::before` (image or poster fallback) + veil `body::after`, styles the single fixed video layer with `object-fit` / `object-position` mapped from presentation, and applies translucent semantic surface tokens only under `html[data-appearance="skin"]`; elevated dialogs and high-density tool surfaces retain solid/high-opacity tokens. Playback tokens (`data-appearance-playback`) drive playing vs poster/hidden/error paint. No active skin must preserve the pre-feature light/dark rendering.

The client store (`hooks/useAppearance.ts` + pure `lib/appearance-playback-policy.ts`) re-fetches catalog metadata, applies image skins only after `Image.decode` of the full asset, and applies video skins by painting poster first then attaching at most one muted/loop/`playsInline` background `<video>` when policy allows. Policy pauses/detaches on `prefers-reduced-motion`, hidden document, optional Save-Data, and browser-local poster-only preference (`localStorage` key `pi-appearance-poster-only`); only the visible tab plays. Generation guards prevent stale apply races; switch/unmount releases prior `src`. Same-tab subscribers, `BroadcastChannel("pi-web-appearance-v1")`, and focus/visibility revalidate remain; there is no polling and no media bytes in React state. A failed fetch, decode, or autoplay retains poster/previous effective background. Settings → 外观 is an immediate-save mixed image/video manager (kind badges, duration, poster-only toggle, processing copy); it must not mark, save, or reset the `pi-web.json` draft.

**Stop-bleed / rollback:** hide video upload or ignore `kind=video` (poster-only or default surfaces); keep on-disk mp4/poster assets; do not rewrite sessions, models, auth, or `pi-web.json`.

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

### YPI Studio free-text approval boundary

`lib/ypi-studio-tasks.ts` uses the same pure `isExplicitYpiStudioApprovalText()` gate before writing a free-text `user-input` approval grant for either a main plan or an improvement plan. The gate normalizes Unicode NFKC and horizontal whitespace, rejects newline input and strings over 80 code points, rejects negation/wait/revision intent, then accepts only a small anchored Chinese/English command allowlist. It must not search for approval keywords inside discussion, questions, quotations, diagnostics (for example `排查浮窗批准问题`), or longer text. Passing this parser is not authorization by itself: existing awaiting status, bound context, material/UI evidence, revision, and temporal gates still apply. Typed user-widget approval actions remain structured actions and do not pass through free-text classification. Historical grants are not migrated.

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
- Chat top-bar Studio child discovery uses dedicated `GET /api/sessions/:id/studio-children` (`lib/studio-child-session-list.ts` + `hooks/useStudioChildSessions.ts` + `components/SubagentPanel.tsx`). Identity is only high-confidence header association (`studioChild.kind === "ypi-studio-child-session"` and exact `parentSessionId`); ordinary forks, name similarity, and old `subagent` / `trellis_subagent` tool-call/`sessionFile` recursive parsing are not used (the former `/api/agent/subagent-children` route and `parse-subagent-children` helper are deleted). Panel status prefers task.json run records and marks header fallback with `statusMayBeStale`. Wire projection is bounded (all normal active children, newest 20 terminal, defensive active hard cap) and never returns absolute paths or child content bodies. Opening a child row navigates the current workbench via existing `handleSelectSession` into the same read-only audit Chat/SSE path; it must not inject child messages/usage into the parent Chat.
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
- **Explicit archive capability (kept):** `POST /api/sessions/archive`, `archive-all`, `unarchive`, `GET /api/sessions/archived`, session-by-id detail with `archived: true` (read-only chat), and Chat top-bar session rollup when `usage.includeArchived` is enabled. `scanArchivedCwds()` remains available in `lib/session-reader.ts` for explicit helpers but is not wired into active list routes. The global Usage ledger never scans session inventory or archive storage.
- **Project list source:** Project Registry (`pi-web-projects.json`), not archive cwd counts or a CWD picker synthesized from sessions.

Archive-all matches target sessions by canonical cwd against the lightweight **active** inventory and must not call SDK `SessionManager.listAll()`. Removing archive I/O from the Sidebar path does **not** by itself rewrite active `listAllSessions()` into a directed per-space scan; that remains a separate performance concern.

### Session inventory memory contract

- **In scope (lightweight only):** global/project **active** session lists, allowed-roots session cwd discovery, delete sessions for WorkTree cwd, archive-all (active inventory), **explicit** archived session lists, and Chat top-bar session_rollup inventory helpers that need name/count/firstMessage/modified.
- **Out of scope (may open full files):** session detail, context/branch tree, export, and session_rollup precise assistant-`usage` scans for the selected parent/child JSONL files. Session rollup builds its session set from the lightweight inventory (`listAllSessions` / archived helpers with `includeStudioChildren: true`) and must not depend on `allMessagesText`. The global Usage ledger does not use session inventory at all.
- **Studio child defaults unchanged:** list roots hide Studio children unless `includeStudioChildren` is set; UI may opt into `includeStudioChildDisplay` for task-title projection; session_rollup Studio-child inclusion is unchanged.
- **Rollback:** code-level only — restore previous inventory call sites to SDK `SessionManager.listAll()` if needed. No JSONL migration or data rollback. Do not long-term default back to the full-text inventory path.

### Tool calls and events

- Pi stores tool calls as `{type:"toolCall", id, name, arguments}`.
- Web UI types use `{toolCallId, toolName, input}`.
- Normalize with `normalizeToolCalls()` in `lib/normalize.ts`; it is used during file load and streaming.
- Newer pi emits `compaction_start` / `compaction_end`; older pi emits `auto_compaction_start` / `auto_compaction_end`. Handle both.

### Session file-change projection

- Session changed-file sidecars remain non-Git (edit/write tool events only); Chat no longer mounts a floating changed-file panel. Do not derive session file changes from `git status` or `git diff`.
- `lib/rpc-manager.ts` forwards live edit/write tool events to `lib/session-file-changes.ts`, which captures bounded before/after text snapshots and persists `~/.pi/agent/session-changes/<session-id>.json`.
- Session JSONL files are not modified for this UI-only projection.
- MVP tracks built-in `edit` and `write` tools only; arbitrary `bash` file mutations are not shown unless a future scanner/sandbox design adds explicit support.

### Usage accounting

Global Usage and Chat top-bar rollup are **two retained boundaries**. Do not merge them or resurrect a dual-view UI.

#### Global ledger (only global Usage UI)

- Sidebar Usage opens the independent call ledger only (`components/UsageProviderModelTable.tsx` → `GET /api/usage/calls`). There is no `Session 统计` tab and no global Session-scan page.
- Ledger data lives under `usage-events/v1/` (one immutable event file per call). Session archive/delete never mutates or deletes ledger events. Historical event files and Session JSONL are never rewritten for this feature.
- `lib/llm-usage-recorder.ts` always records by default. Retired `usage.statsSource` is ignored on read, not projected by the config API, and stripped on the next `pi-web.json` usage save; old `"legacy"` values must not stop ledger writes. `setRecorderEnabled(false)` remains diagnostics/tests only.
- Date semantics for `/api/usage/calls` (server-local, not browser-local):
  1. Browser `from`/`to` (`YYYY-MM-DD`) parse to inclusive local-day instants (`00:00:00.000` … `23:59:59.999`) via `lib/local-date-range.ts`.
  2. `lib/llm-usage-store.ts` scans every **UTC** `YYYY-MM-DD` partition that intersects those instants (candidate index only; max 366 days).
  3. `lib/llm-usage-query.ts` keeps only events with `occurredAt` inside the inclusive instant range, then applies optional cwd/provider/model/source/status filters.
  4. `byDay` groups by the same server-local calendar day; response `range.from/to` echo the request labels; `range.timezone` is the process-local zone.
- Query cache keys hash full ISO boundary instants plus every filter (not UTC day labels alone).
- Wire `coverage` diagnostics remain on the ledger API for ops/compat; the Usage UI does **not** render coverage banners, known gaps, corrupt counts, or legacy-compat footers.
- Ledger UI: workspace filter defaults to and resets to **全部** (request omits `cwd` unless the user chooses 当前); source/status use shared `SelectDropdown` (`size="toolbar"`); token volumes use `lib/token-format.ts` with **M primary + exact secondary** (compact axes keep exact in tooltip). Daily charts use `byDay` + `byDayModel`: line trend (single-day pie fallback) and stacked bars side by side; shared **使用量/费用** metric toggle; Token 拆分 on the next row; tooltips follow the active metric (`M · exact` or `$x.xx`) and may show the other metric as secondary. Sidebar and modal header share `UsageLedgerIcon` geometry.

#### Session rollup (Chat top bar only)

- `GET /api/usage` is **session_rollup only**. `sessionId` is required; missing it returns `400 { error: "sessionId is required" }` and must not scan sessions. There is no global date-range aggregate on this route.
- `GET /api/usage?sessionId=<id>` returns a lightweight lifetime (optional `from`/`to`) rollup via `getUsageStatsForSessionRollup()`: parent own totals, Studio child totals, combined totals, child count, and child summaries. If the selected session is a Studio child, the rollup resolves back to its parent id when possible. Additive fields: `selectedSessionTotals`, `parentRollupTotals` (equals `totals`), `selectedSessionKind`, `childSessions[].contextUsage`. Callers that ignore additive fields continue to work.
- `usage.includeArchived` controls whether session_rollup may read `sessions-archive/`; it does **not** control the global ledger. Settings copy must say Session rollup scope only.
- Session rollup totals come only from standard assistant message `usage` fields in selected parent/child JSONL. It does not parse `.ypi/.runtime/studio-subagents/*.jsonl` sidecars, does not estimate CLI `--no-session` runner cost, and does not return transcript/prompt/output/artifact bodies.
- Child `contextUsage` is a bounded numeric-only projection (`percent`, `contextWindow`, `tokens`, availability/source, optional capture time). The SDK child runner samples authoritative `AgentSession.getContextUsage()` at low frequency and once before teardown; CLI/historical/never-sampled children return explicit null-valued `unavailable`. Never derive occupancy from lifetime usage or progress tokens/tps.
- Chat top-bar display口径 (confirmed, `SessionStatsChips` / `useAgentSession`): `parent` compact shows parent rollup total and appends `incl. Studio` only when Studio children have real usage (child tokens or cost > 0, not mere child count); `standalone` shows own usage with no child marker; `studio_child` shows only that child's `selectedSessionTotals` (no bare `+child` / parent-rollup placeholder) while tooltip may include parent rollup + parent id. Prefer `session_rollup` API; fall back to local `messages` usage while loading/on failure. Display-only: never mutate parent JSONL or append child content to the React message list.
- All token aggregation (ledger and session rollup) excludes `cacheWrite` per the cache-write removal decision; deprecated fields stay at 0 for wire compatibility.

### Model price configuration

Model pricing is configured by writing directly to Pi's single source of truth: `~/.pi/agent/models.json`. The web UI never creates a separate price file.

**Write paths by model kind:**
- **Built-in / extension models**: prices are saved under `providers.<provider>.modelOverrides.<model>.cost.{input,output,cacheRead}`.
- **Custom models**: prices are saved on the matching `providers.<provider>.models[].cost` entry.
- **Explicit free models**: user marks a model as free. `cost` is written as 0 in `models.json` and the model is recorded in `pi-web.json` `usage.explicitFreeModels[]` so the UI can distinguish "missing price" from "intentionally free" without relying on zero-matches.

**Safety invariants:**
- All models.json writers (ModelsConfig PUT, model-price PATCH, and OpenAI-compatible `/models` sync apply) share `lib/models-config-store.ts`: in-process queue + cross-process mkdir lock, opaque revision, atomic `tmp + rename`, best-effort `0600`, and pre-write backup. Nested lock acquisition is forbidden.
- The price config service (`lib/model-price-config.ts`) never touches `apiKey`, `baseUrl`, `headers`, `compat`, or `tiers` fields. It does a minimal deep-merge of only the `cost.input/output/cacheRead` fields.
- For custom `models[]` entries, if a `cost` object is written, the service fills missing schema-required rates (`input`/`output`/`cacheRead`/`cacheWrite`) with `0` so Pi ModelRuntime does not reject the entire `models.json`. Existing `cacheWrite` values are preserved; billing UI still does not manage cache-write pricing.
- Writes use atomic `tmp + rename`, best-effort `0600` permissions, and an opaque revision hash for concurrency control (409 on stale revision / `If-Match`). Malformed models.json fails closed and is never overwritten with empty `{ providers: {} }`.
- Before and after each price write, the service verifies the file can be read back and loads a fresh provider-aware `ModelRuntime` (or narrow catalog view) to confirm resolved prices match expectations. Partial failures roll back to the pre-write backup.
- JSONC comments are stripped with `stripJsonComments()` on read and lost on write (clean JSON output). A backup file (`models.json.pi-price-backup`) is saved before every coordinated write.
- The API projection (`ModelPriceListResponse`) never exposes `apiKey`, full `baseUrl`, headers, auth/account data, absolute paths, or the raw `models.json` content.
- ModelsConfig GET keeps the legacy body shape and exposes revision via `ETag` / `X-Models-Config-Revision` only; PUT may send `If-Match` and always returns additive `revision`.

### OpenAI-compatible `/models` sync invariants

`POST /api/models-config/sync` discovers remote model ids for one saved custom OpenAI-compatible provider and merges new ids on confirmed user action. This is the third models.json writer alongside ModelsConfig PUT and model-price PATCH.

**Provider eligibility (server-side, fail-closed):** target must exist in saved `models.json.providers`, must **not** be a Pi built-in provider or fixed extension (`grok-cli`/`kiro`/`google-antigravity`), must have provider-level `api` of `openai-completions` or `openai-responses`, and must have a valid `http(s)` baseUrl. Re-checked on every preview and apply.

**SSRF / secret protection:** body accepts only `action`+`providerId` (preview) or those plus `previewId`/`revision`/`modelIds` (apply). Rejects `url`/`baseUrl`/`headers`/`apiKey`/`path`. Server reads baseUrl/credentials only from saved config. API/cache/errors never project secrets.

**Endpoint discovery:** already-`/v1/models` or `/models` → use as-is. `/v1` → append `/models`. Otherwise → `/models` first, only 404/405 fall back to `/v1/models`. Other errors stop. `redirect: "manual"`, max 3 same-origin, cross-origin blocked.

**Credentials:** auth.json `api_key` wins, models.json `apiKey` is fallback. OAuth is `unsupported_auth`. Custom Authorization headers preserved.

**Preview (zero disk write):** bounded fetch (10s/1MiB/2000 models/256-byte id), in-memory cache (opaque id, 5min TTL, max 20 entries, fingerprint-only — no secrets).

**Apply (shared lock, merge, verify):** validates preview/revision/fingerprint, merges under shared library lock, existing objects untouched, new ids append `{ id }` in remote order, only target provider changed. Atomic write + backup, fresh ModelRuntime verification with backup rollback on failure, best-effort live reload.

**Scope exclusions:** never syncs built-in/fixed/non-OpenAI providers; never infers prices/context/capabilities; never deletes local models; never accepts arbitrary URLs.


**Intelligent price suggestions** (suggest API) follow a two-phase pipeline:
1. **Phase 1 — deterministic matching**: Fetches the OpenRouter public model catalog (`GET https://openrouter.ai/api/v1/models`, HTTPS-only allowlist) and performs exact model-id matching with price extraction. Alias/near-match results carry lower confidence.
2. **Phase 2 — AI-assisted extraction**: For remaining unresolved models, bounded evidence excerpts are passed to the configured pricing assistant model (from `usage.pricingAssistant` / `usage.pricingAssistantFallback`). The AI receives only pre-fetched text excerpts, never network/file/tool access, and must return valid structured JSON. Hallucinated or malformed output is rejected.

Suggestions always carry per-field evidence URLs, confidence scores, match method, and warnings. They are never auto-applied: the user must review each suggestion in the Settings UI and explicitly confirm before the PATCH API writes anything to `models.json`. The suggest API accepts at most 20 targets per request and rejects URL/prompt/path/key injection fields.

### Usage accounting — cache-write removal

Per the cache-write removal decision, new usage events no longer collect `cacheWrite` or `cacheWrite1h` from the SDK. The v1 ledger types (`LlmUsageTokens`, `LlmUsageTotals`) and session-rollup `UsageTotals` retain `cacheWrite` as a deprecated numeric field fixed at 0 for backward compatibility; aggregators (`addLlmUsageToTotals`, rollup `addTotals`/`addUsage`) no longer accumulate it.

Key invariants:
- Historical usage event files under `usage-events/v1/` and historical Session JSONL are never rewritten or migrated.
- `cost.total` remains the SDK authoritative total and is not recalculated.
- SDK `totalTokens` may still include cache-write tokens internally; the project uses the provider's authoritative total without attempting to decompose it.
- Session rollup (`/api/usage?sessionId=`) and ledger (`/api/usage/calls`) both exclude cache-write; wire `cacheWrite` stays at 0.
- All UI surfaces (global ledger modal, session stats chips, message footer, chat top bar) have removed cache-write rows, columns, tooltips, and local fallback accumulations.
- Cache Read remains displayed independently; the cache-hit ratio formula is `cacheRead / (input + cacheRead)`.

### Exact token + M display

All token values in Usage, ledger, topbar, and message footers follow these conventions (implemented by `lib/token-format.ts`):
- **M**: derived `tokens / 1_000_000`, at most 2 decimal places with trailing zeros stripped (e.g., `1.23 M`). Primary visual unit for Usage ledger token volumes. Never used as storage or aggregation input.
- **Exact**: full locale-grouped integer (e.g., `1,234,567 tokens`). Secondary/detail unit next to M in Usage ledger UI; still used for non-volume counts (calls) and full-precision tooltips.
- **Compact**: for tight spaces like chips and chart axes (≥1M → `1.2M`, ≥1k → `1k`, otherwise exact). Callers must include the exact value in a tooltip or secondary text.

### Models and tools

- `GET /api/models` returns `defaultModel` from `~/.pi/agent/settings.json`.
- Chat `set_model` is **session-scoped** (IMP-002 plan A): runtime model + JSONL `model_change` update for the open session, but `AgentSession.setModel` must not rewrite `settings.json` `defaultProvider`/`defaultModel`. Isolation is implemented in `lib/rpc-manager.ts` via `withSessionScopedSettingsDefaults` (`lib/session-model-pin.ts`). Explicit Settings/CLI paths that call SettingsManager default writers remain the global-default entry points.
- **Two default-model sources, separate responsibilities:** `~/.pi/agent/pi-web.json` `yolk.defaultModel` is the Web Chat default (new sessions + cold-start server fallback); `~/.pi/agent/settings.json` is the CLI/SDK compatibility default. Chat cold start must not silently use `settings.json` as the session model.
- **Server cold-start model priority (plan B):** when `startRpcSession` creates a wrapper without a live agent, `applyWebSessionColdStartDefaults` sets the initial runtime model to (1) a recoverable session model from path `model_change` entries, (2) yolk specific model + thinking when `yolk.defaultModel.mode === "specific"`, or (3) SDK/settings default. Yolk apply is session-scoped (never writes `settings.json`) and does not override a recoverable session model. Studio child sessions skip yolk. The client-side `set_model` before prompt remains the primary guarantee that the UI desired model wins.
- New-session tool names are passed to `POST /api/agent/new` as `toolNames[]`.
- Existing sessions infer presets via `get_tools` and `getPresetFromTools()`.
- Auth changes must `await reloadRpcAuthState()` so live AgentSessions reload auth/model state before the API returns success. Each live wrapper offline-refreshes its own `ModelRuntime`, replaces the same provider/id model descriptor without `setModel()` / `model_change` / settings defaults, and cleans pi-ai session resources (OpenAI Codex reusable WebSockets must reconnect after ChatGPT account activation to pick up new auth headers). Per-wrapper failures are isolated.
- **Web CredentialStore + ModelRuntime (pi SDK 0.80.10)**: Application code uses `lib/web-credential-store.ts` (file-backed `CredentialStore` over `auth.json`) and `lib/web-model-runtime.ts` (`createWebModelRuntime` / `getWebModelRuntime` / `createWebAgentSessionServices`). File-backed stores passed to a ModelRuntime are wrapped by `lib/grok-active-credential-store.ts` only for Grok: SDK refresh runs under the shared Grok provider lock with a lock-time Active-slot reread. Raw stores remain available to locked account lifecycle code, and in-memory add/reauth stores remain unwrapped. Do not import root `AuthStorage`, call `ModelRegistry.create()`, or read `services.authStorage` / `services.modelRegistry` / `inner.modelRegistry`. Main Chat and Studio SDK children each get an isolated `ModelRuntime` so cwd-local extension providers cannot leak across sessions; only fixed-provider administrative runtimes are path-keyed and reused. Temporary `modelsPath` (Models Config test / price write verification) never enters the default runtime cache. Request auth prefers `ModelRuntime.getAuth()` or runtime `completeSimple`/`streamSimple`.
- **Fixed provider registration (Grok + Kiro + Antigravity)**: Every Web entry point (main sessions, Models API, Auth API, Studio SDK children, Skills/Commands, assistant model resolvers) must register fixed providers on the **target** `ModelRuntime` through `createWebAgentSessionServices` / `getWebModelRuntime` and `webExtensionFactories()` from `lib/pi-provider-extensions.ts`. `pi-grok-cli@0.5.0`, `pi-kiro-provider@0.2.2`, and `@yofriadi/pi-antigravity-oauth@0.3.0` ship TypeScript source and are loaded only via jiti + `serverExternalPackages` (never static Next imports of package `src/**`). Order is always Grok → Kiro → Antigravity before call-site extras. Antigravity’s first jiti import forces `PI_OAUTH_CALLBACK_HOST=127.0.0.1` under single-flight so the OAuth callback cannot bind a non-loopback interface. `ensureWebProvidersBootstrapped()` is a legacy OAuth/cold-path preload only — not a catalog guarantee for another runtime. `createWebProviderAwareModelRegistry()` is removed. Per-provider load failures are isolated. `pi-antigravity-rotator` is not a dependency or runtime.
- **Grok global Active auth**: Session Authorization pinning is retired. Models `Activate` only sets the provider-global Active account in OAuth metadata / `auth.json` via the Web `CredentialStore`. `reloadRpcAuthState()` offline-refreshes each live `ModelRuntime`, replaces same-identity live model descriptors without calling `setModel()` / writing `model_change`, and cleans provider session resources. All ordinary live Grok sessions and new sessions use the current Active for **subsequent** provider requests; already in-flight requests keep the token they started with. Historical JSONL `grokAccountStorageId` remains parseable but is ignored at runtime and is never migrated.
- **Kiro global Active auth**: Same opaque OAuth store semantics as Grok under `auth-accounts/kiro/` (`kiroAdapter` in `lib/oauth-account-providers.ts`). Builder ID / Google / GitHub OAuth only (no credential JSON import). Activate sets global Active + live reload; no per-session Kiro pin. Secrets (`access`/`refresh`/`clientSecret`/full `profileArn`) never cross the API/DOM boundary.
- **Antigravity global Active auth**: Opaque OAuth store under `auth-accounts/google-antigravity/` (`antigravityAdapter`). Google OAuth login only (no credential JSON import). Credential requires non-empty `access`/`refresh`/`projectId` and finite `expires`; `projectId` is server-side secret only. Activate sets global Active + `reloadRpcAuthState()`; no per-session pin. Refresh/Activate share `withAntigravityProviderLock()`; non-Active refresh cannot overwrite `auth.json`. Tokens/refresh/`projectId` never cross API/DOM/SSE/log.
- **Path B account auto-failover chain**: Independent controllers, outermost first: **Antigravity** (`lib/antigravity-account-failover.ts`, `globalThis.__piAntigravityFailover`) → **Kiro** (`lib/kiro-account-failover.ts`, `__piKiroFailover`) → **Grok** (`lib/grok-account-failover.ts`, `__piGrokFailover`) → **OpenCode Go** → **ChatGPT** → Pi native post-run. Each is default-off and provider-scoped (non-matching providers passthrough). Manual Activate is never a lock. Per turn: max one actual switch and one retry; concurrent sessions reuse a single Active change (no cascade). SSE events (`antigravity_account_failover` / `kiro_account_failover` / `grok_account_failover` / …) project only status/reason/retry/safe message — never account ids, tokens, projectId, or paths.
- **Grok account auto-failover**: When `grok.autoFailover.enabled` is true, explicit Grok quota/usage/credits/monthly/weekly exhaustion or explicit rate-limit / too-many-requests errors can rotate global Active. Classifier rejects bare HTTP status, fuzzy help text, auth/reauth, network, timeout, 5xx, context, content, and model errors. Fixed env-token bypass returns a display-safe non-retry status.
- **Kiro account auto-failover**: When `kiro.autoFailover.enabled` is true, only explicit AWS quota reason codes (`MONTHLY_REQUEST_COUNT`, `OVERAGE_REQUEST_LIMIT_EXCEEDED`, `CONVERSATION_LIMIT_EXCEEDED`, `DAILY_REQUEST_COUNT`, `ServiceQuotaExceededError`, `authFailure.reason=quota_or_entitlement` without auth subclass) or explicit quota exhausted / rate-limit text trigger. Hard-negatives include `INSUFFICIENT_MODEL_CAPACITY`, bare 429/403, network/timeout/5xx, auth/reauth, context/content/model. Candidates need readable credential + **fresh/live** primary GetUsageLimits remaining > 0; **stale/unknown/reauth fail-closed**.
- **Antigravity account auto-failover**: When `antigravity.autoFailover.enabled` is true, only explicit `RESOURCE_EXHAUSTED` / quota exhausted/exceeded / quotaResetDelay|TimeStamp / `rate_limit_exceeded` / too many requests / explicit rate-limit text on provider `google-antigravity` trigger. Hard-negatives include bare 429 / `Cloud Code Assist API error (429)`, 401/403, auth/token/project, network/timeout/abort, 5xx/529/capacity, context/content/safety/model. Candidates need readable credential + **fresh/live** quota entry for the **current public model’s accepted keys** (fixed `0.3.0` mapping in `lib/antigravity-model-quota.ts`) with `remainingFraction > 0`; **stale/unknown/reauth/unmapped/other-model-only/same-group-sibling-only fail-closed**. Failover is **model-aware and not group-aware** — UI group remaining (Flash/Opus conservative aggregates) never opens a candidate. Default project `rising-fact-p41fc` is never health evidence.
- **Grok token refresh**: The managed Active slot is the authority shared by SDK and managed refresh. Both use `withGrokProviderLock()` and lock-time rereads; SDK `CredentialStore.modify()` supplies Pi's expiry double-check, while `getGrokAccessToken(..., { forceRefresh: true })` performs a real refresh even when locally valid. A successful refresh atomically commits the slot (tmp+rename, 0600), rechecks the Active pointer, then mirrors `auth.json` only if it remains Active. Lock order is **Grok provider → auth.json**. A failed mirror is surfaced but never rolls the rotated slot back; later coordinated reads/reconciliation can repair the mirror. Non-Active refresh never changes `auth.json`; force/non-force flights do not let an ordinary valid read suppress a forced refresh.
- **Kiro token refresh**: Same CAS/single-flight/forceRefresh pattern in `lib/kiro-account-token.ts` for provider id `kiro`, preserving Builder ID / social credential fields server-side.
- **Antigravity token refresh**: Same CAS/single-flight/forceRefresh pattern in `lib/antigravity-account-token.ts` under Antigravity provider lock; refresh results merge with existing `projectId` so upstream omissions cannot drop it.
- **Grok quota**: Web-owned billing client in `lib/grok-subscription-quota.ts`. No private `pi-grok-cli` path imports. Reads monthly (`/billing`) and optional weekly (`/billing?format=credits`) with 60s fresh / 24h stale TTL, 10s timeout, single-flight, and one forced refresh+retry on 401/403 (parenthesized status check + `forceRefresh:true`). Only normalized allowlist fields reach the wire (`GrokQuotaResultV1`); all responses carry `Cache-Control: no-store`. POST reset-credit returns 405 for Grok.
- **Kiro quota**: Web-owned GetUsageLimits client in `lib/kiro-subscription-quota.ts`. Endpoint only `https://q.<validated-commercial-region>.amazonaws.com/` with `X-Amz-Target: AmazonCodeWhispererService.GetUsageLimits`. Never accepts credential-supplied arbitrary URLs; never uses per-turn `meteringEvent` as subscription quota. Parses `usageBreakdownList` / `usageBreakdown` precision-first into `KiroQuotaResultV1` buckets (primary prefers `CREDIT`). 60s fresh / 24h stale, single-flight, 10s timeout, one 401 force-refresh retry. POST returns 405. Unavailable buckets stay unavailable (never 0%).
- **Antigravity quota**: Web-owned fixed Cloud Code client in `lib/antigravity-subscription-quota.ts`. Endpoint only `POST https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels` with server-side Bearer + `{"project":"<projectId>"}` (no credential URL/headers, no rotator proxy). Parses bounded per-model `quotaInfo.remainingFraction`/`resetTime` into `AntigravityQuotaResultV1` windows; `usedPercent = 100 × (1 − remaining)`; invalid remaining rejected (never fake 0%). **5min fresh** / 24h stale, single-flight, 10s timeout, one 401 force-refresh retry (manual `refresh=1` bypasses fresh TTL); 403 → access_denied/invalid_project. POST returns 405. `resetTime` is display-only.
- **Top-bar provider usage (N-ring + optional aggregate)**: Full, Compact, and Aggregate share one N-ring primitive (`ProviderUsageRingUnitView` in `components/ProviderUsageTrigger.tsx` + contracts in `components/ProviderUsagePanelContract.ts`). Provider adapters (GPT/Grok/Kiro/Antigravity) emit only **unordered safe window candidates** from the account's actual allowlisted quota data — they never invent missing 5h/7d/week/month layers and never choose layer index, outer/inner, or center. The shared pure projector (`projectProviderUsageWindows` + duration resolver in `ProviderUsagePanelContract`) filters present/trusted candidates, resolves duration only from explicit positive values or strict period tokens/labels (never provider name, array/field/id order, percent, remaining, resetAt, resourceType, or generic `Limits/quota` text), then builds rings: single safe candidate → one ring (duration may be unknown); multi-candidate → only unique trusted duration ranks, sorted **outer→inner = short→long** (outermost is the shortest comparable window); unknown/tie ranks stay detail-only with fixed safe copy (`另有窗口仅在详情展示`); if no unique ranks remain, `ringUnit` is null and the column shows a safe detail fallback (no forged ring/center). Antigravity is special: `lib/antigravity-usage-ring.ts` + `lib/antigravity-quota-groups.ts` project priority model **groups** as **dual-independent side-by-side rings** (Flash | Opus single-layer units via `ringSlots`/`ringUnits`, conservative max(used)/min(remaining)); concentric multi-layer N-ring remains **period-only** and must never encode Flash outer + Opus inner. Non-priority multi-model stays **detail-only** (“多模型/详情”). `resetTime` is never duration evidence; never sum/average into a total percent. `centerLayerId` is always the final outermost layer (`layers[0]`); outer unknown percent shows that label + `—` (or same-bucket remaining fallback for Kiro) and never borrows an inner percent. Layer identity uses fixed hue/stroke tokens (solid / dashed / dotted); per-layer `>=80` warning / `>=95` danger is a second channel. Used arcs with `percent>0` may show CSS-only SVG-mask sheen flow; `prefers-reduced-motion: reduce` stops flow and nonessential panel motion. Aggregate shell theming uses `:root` / `html.dark` usage semantic tokens (no fixed night surface); aggregate trigger ring stays 30px, panel column-header rings target 40px (minimum 38px, `flex-shrink:0`). **Aggregate** is controlled by `usage.providerPanelsAggregated` (default/`missing` = `false`). When true, AppShell **mutually exclusively** mounts one `ProviderUsageAggregatePanel` (hover/focus open, 220ms grace close across trigger+panel, Escape with focus-suppression, non-accordion provider columns in GPT→Grok→Kiro→Antigravity order) instead of standalone triggers; there is no cross-provider total ring/percent and no new quota API. When false, standalone Full/Compact remain click-to-open detail; Compact is global `usage.providerPanelsCompact` (default false) rendering provider label + one N-ring unit (not text summary chips). Aggregate on disables Compact in Settings UI but **retains** the compact boolean. Per-provider `chatgpt|grok|kiro|antigravity.usagePanelEnabled` still control mount/polling. Kiro remaining never becomes percent and never participates in duration ordering. Host stays a single `.app-top-usage-panel` with one right-padding reserve. Runtime stop-bleed: set `usage.providerPanelsAggregated=false` (credentials/cache/Compact preference untouched).
- **Full extension scope**: The approved `pi-grok-cli` default factory includes Cursor tools, vision, and Imagine alongside the provider core. Kiro uses only the public `pi-kiro-provider` default factory. Antigravity uses only the public `@yofriadi/pi-antigravity-oauth` default factory (non-official Cloud Code channel; wide OAuth scope; hard-coded IDE client + simulated UA — see integrations docs). Main inference uses the global Active credential from auth.json after live reload.
- **Grok account data layout**: Credentials under `~/.pi/agent/auth-accounts/grok-cli/` with `accounts.json` (0600, metadata only) and per-account `<storage-id>.json` (0600, full credential). Deleted accounts move to `deleted/`. Quota cache is `.quota-cache.json`.
- **Kiro account data layout**: Credentials under `~/.pi/agent/auth-accounts/kiro/` with the same 0600/0700 / `deleted/` / `.quota-cache.json` layout as Grok.
- **Antigravity account data layout**: Credentials under `~/.pi/agent/auth-accounts/google-antigravity/` with metadata-only `accounts.json`, per-account secret files holding `access`/`refresh`/`projectId`, `.quota-cache.json` (normalized model windows only), provider refresh/activate lock dir, and `deleted/`.
- ChatGPT usage auto-refresh is backend-owned, not browser-tab-owned. The scheduler state lives on `globalThis.__piChatGptUsageRefreshScheduler` and uses `~/.pi/agent/chatgpt-usage-refresh.lock` to reduce duplicate refresh loops across Node processes. Stale lock detection follows the configured refresh cycle dynamically.
- Trellis subagent child processes resolve model policy from `pi-web.json` `trellis.subagents`: explicit tool input wins, then per-agent fixed policy, then optional route table policy, then default policy, then `.pi/agents/*` frontmatter, then Pi CLI defaults. Automatic routing is opt-in and classifies `text`/`multimodal` plus `simple`/`standard`/`complex`/`critical`; router failures fall back to configured safe route/default behavior. The default policy follows the main session model when the Pi extension context exposes it; otherwise it safely falls back to Pi default. If the selected child model process fails, existing `.pi/agents/*` `fallbackModels` frontmatter entries are retried in order; if those also fail and the main session model is known, the child finally falls back to the main session model.
- YPI Studio workflow orchestration is loaded as a built-in extension factory from `lib/rpc-manager.ts` so every web-created AgentSession receives the `ypi_studio_task` and `ypi_studio_subagent` tools plus `/studio-init`, `/studio-start`, `/studio-feature`, `/studio-bugfix`, `/studio-ui`, `/studio-continue`, `/studio-check`, and `/studio-archive` commands regardless of the selected workspace's project-local `.pi` files. The default workflows (feature-dev / bugfix / ui-change) include a `completed → user_acceptance` transition so the session widget's completed CTA can atomically return a completed task to user acceptance; `review-only` excludes this edge. `ypi_studio_task current/get` returns compact summaries by default (artifact paths, recent 10 events plus total count, subtask/run summaries, and next action hints) and requires explicit `detail="full"` opt-in for complete task JSON; `ypi_studio_subagent` results likewise embed compact task summaries so polling/collecting child runs does not replay full documents/events into chat context; `ypi_studio_wait` is the preferred main-path wait primitive after async delegation, streaming progress as tool updates and returning terminal child results to the same model turn. **Studio Context Integrity (SCI):** main-session LLM context is a **system single channel** — `input` only records chat approval grants (`recordYpiStudioUserApproval`) and continues without transforming user text (new user JSONL stays free of `<ypi-studio-*>` blocks); each turn `before_agent_start` appends one-shot startup first-reply/orchestration brief (no duplicate knowledge) plus `buildStudioState(root, key, event.prompt)` and the orchestration rule so state + related knowledge refresh every turn with knowledge query = user prompt. Chat L0 strips known historical injection blocks for bubble/Copy/Edit and may show a compact non-interactive `Studio · {status}` tag (`lib/ypi-studio-message-display.ts` + `UserMessageView`); session title seeds also strip; **no JSONL migration**. Child sessions still skip the parent extension and use `buildMemberPrompt`. The extension injects `.ypi/tasks` workflow state and bounded `.ypi/knowledge` summaries into each turn via that system path, binds sessions through stable context ids (`pi_<sessionId>` first, transcript hash second, process fallback last; see exclusive session ownership below), resolves Studio member model/thinking policies through the pure `lib/ypi-studio-policy.ts` chain `toolInput > memberConfig > defaultPolicy > followMain > piDefault`, canonicalizes member ids before config/member-file lookup, emits policy diagnostics/warnings in live progress and final tool results, isolates child member Pi processes from Trellis injection with child env flags, and stores structured task progress under the selected workspace's `.ypi/` directory. Studio tasks may also contain `implementationPlan` plus `implementationProgress`: architects save a structured subtask plan before `awaiting_approval`, and after user approval the parent session claims ready subtasks before dispatching implementer with `subtaskId`. The scheduler contract is batch-oriented at orchestration level: each implementer child run receives exactly one `subtaskId`, but the parent session must fill available `maxConcurrency` slots by claiming all ready subtasks that fit and launching one async implementer run per claimed subtask in the same orchestration turn. The schemaVersion 2 contract treats `implementationPlan.subtasks[].dependsOn` as the DAG scheduling source for serial, parallel, and mixed work; `execution.groups` is only a UI/readability projection. Progress remains legacy-compatible while adding `waiting` (with `pending` displayed as waiting), `queued`, `failed`, multi active/queued/next ids, run ids, and derived `waitingOn`/`blockedBy` reasons. The server-derived implementation projection also includes a compact subtask timeline and optional session runtime projection; when queued/running implementation subtasks exist and the main model turn is idle, Chat must present this as `waiting_for_studio_children`/“Studio 后台仍在工作” rather than as a stopped Studio workflow. Child Studio progress uses optional `details.run.progress` fields (`phase`, `tokens`, `tokenSource`, `tps`, `currentTool`, `itemsPreview`, `warnings`, `display`, `terminationReason`) so Chat and the session widget can distinguish `starting`, `waiting_model`, `streaming`, `running_tool`, `waiting_for_user`, and `finished` while showing only bounded recent activity by default. Preview/transcript/API projection clipping is display/storage protection and is surfaced as neutral display metadata; it does not by itself mark the child run failed. Studio child process output is projected rather than relayed raw: stdout is parsed as JSONL into safe progress/final fields, non-text deltas such as tool-call/thinking updates are ignored for parent output, raw stdout/stderr is not retained or used as final-output fallback, line/stderr/final-output/transcript/API response caps prevent oversized strings, and idle/max-runtime/line-limit failures terminate the child run with warnings instead of letting the parent session hang. Active child member processes are registered in `lib/ypi-studio-subagent-runtime.ts`; async Studio child runs also carry parent session continuation metadata so a terminal child can nudge the same live parent session with an idempotent follow-up to collect the run and keep driving `implementation_next`/claim/dispatch without waiting for user input. Continuations are kept pending when the parent callback is temporarily unavailable or rejects delivery, and the parent wrapper retries follow-up prompts while the model is busy so ready work is not lost just because the child finished between UI polls or during a transient streaming window. Web-created sessions pass the raw session id into the Studio extension, register continuation aliases for raw `sessionId`, `pi_<sessionId>`, and transcript hash, and expose `studioChildRunCount` through `get_state`/`agent_end` so the UI keeps showing `waiting_for_studio_children` after the model turn ends. Async child progress remains in the in-process runtime registry and is merged into widget/API projections while the run is active; `task.json` persists only lifecycle snapshots (start, child-session audit reference, terminal state), so widgets and continuation decisions receive live state without high-frequency task-file writes. While such child runs remain queued/running, the parent `AgentSessionWrapper` idle timeout is extended so the continuation callback stays registered and the main Chat remains the visible orchestrator. Explicit parent abort/destroy and abort routes still cancel matching children, using POSIX process-group termination or Windows `taskkill` fallback where possible. The `awaiting_approval -> implementing` transition is hard-gated: entering `awaiting_approval` writes `meta.approvalGate`, only a later explicit user approval (chat `recordYpiStudioUserApproval` with `source=user-input`, or atomic widget `approveYpiStudioPlanFromWidget` with `source=user-widget`) writes `meta.approvalGrant`, and `override` cannot bypass the gate; subtask claim/running/done updates also require the main task to already be in `implementing`. Phase 1 / IMP-002 session-widget decision CTAs are server-projected only (`userActions[]`: `approve_plan` / `request_plan_changes` / `approve_improvement_plan` / `start_user_acceptance` / `return_to_user_acceptance` / `studio_archive`, max 2, revision/context-bound, no remote-exec payload); write paths revalidate under the parent task mutation lock with zero partial writes. Clean `review` projects `start_user_acceptance` for an explicit `review → user_acceptance` enter step; `completed && !archived` projects primary `studio_archive` (Chat-only `/studio-archive`) plus optional `return_to_user_acceptance` (PATCH only; requires `completed → user_acceptance` workflow edge). Main-result acceptance (`canAcceptMain`) remains gated to `user_acceptance` only. Improvement plan approval stays instance-scoped and leaves the parent in `waiting_for_improvements`. Best-effort autocontinue may fill main DAG slots after main approval, or instance DAG slots (command carries `improvementId`) after improvement approval. **Hybrid B (Phase 1 widget continuation):** after a successful decision PATCH for `approve_plan` / `request_plan_changes` / `approve_improvement_plan`, continuation now travels through the Chat `handleSend` path — the widget builds a fixed guided prompt via `lib/ypi-studio-widget-continue.ts` and calls `AppShell.onComposeSend`. The server route no longer calls `bestEffortContinueAfterWidgetRequestPlanChanges` as a main path (helper retained for tests/rollback). This avoids server-side `inner.prompt` model misalignment and makes continuation visible in the Chat transcript. `start_user_acceptance` and result-acceptance actions never trigger Chat Send. **Completed CTAs:** `return_to_user_acceptance` is a pure PATCH (no Chat Send); `studio_archive` is Chat-only — the widget calls `onComposeSend("/studio-archive")` to trigger model-led knowledge archival via the existing extension command, never silent PATCH archive from the widget. Send failure does not roll back the PATCH (partial toast). Preview/modal/document paths remain GET-only and never write grants. Before a task may enter `awaiting_approval`, it must contain a meaningful non-TBD `plan-review.md` artifact. The task detail UI treats this file as the dedicated plan-approval preview, but viewing it or opening its Markdown links does not grant approval. Plan-approval links are task-local only: the browser intercepts relative Markdown links for UX, and the task file preview API is the server-side safety boundary that rejects URL schemes, absolute paths, `..` escapes, directory targets, and symlink escapes. If a child member emits a blocking extension UI request (`select`, `confirm`, `input`, or `editor`), the run is marked `waiting_for_user` and the prompt details are surfaced in the parent tool result instead of leaving the parent session waiting indefinitely. Completed Studio tasks can be archived by moving `.ypi/tasks/<task-id>/` to `.ypi/tasks/archive/<YYYY-MM>/<task-id>/`; archive also records `task.json` metadata/events, clears runtime pointers to the task, writes `.ypi/knowledge/<timestamp>-<slug>.md`, and updates `.ypi/knowledge/index.json`. Active task scanning skips `.ypi/tasks/archive`, archived tasks use stable keys `archived:<YYYY-MM>:<task-id>`, and system-prompt knowledge injection reads only index summaries with hard length limits rather than full archived artifacts.
- YPI Studio **exclusive session ownership** is a write-side invariant on active tasks: **one task has at most one session-class owner**, while **one session may still bind many different tasks** (the multi-task widget is unchanged). Session-class context ids are only `pi_<sessionId>`, `pi_transcript_<hash>`, and `pi_process_<hash>`; unknown/non-session values in `contextIds` are treated as metadata and preserved. Create initializes owner when a `contextId` is supplied. Explicit `bind`/continue (`bindYpiStudioTaskToContext` / `PATCH ... { action: "bind", contextId }`) is the only public transfer path: under `withTaskMutationLock` it replaces all known session-class keys with the new owner (non-session keys stay), writes the new runtime pointer, and compare-before-unlinks removed-context pointers only when they still point at this task. Idempotent re-bind to the same sole owner refreshes the pointer without a transfer event. Transfer clears a main-task `meta.approvalGrant` whose grant context differs from the new owner so cross-session approval cannot be reused; the new owner must re-approve explicitly. Ordinary active-task mutations (artifact/plan/transition/approval/claim/subtask/improvement paths that carry a context) call `assertTaskBoundToContext` and must not append or implicitly reclaim ownership. Session-link reading stays exact-`contextIds` only and does **not** guess the current owner from array order, `updatedAt`, or runtime pointers. Legacy multi-owner tasks are not migrated on read; the next explicit bind lazily normalizes them. Archived tasks remain immutable and continue to reject bind; archive cleanup still clears matching runtime pointers.
- YPI Studio **improvement flow** is an additive, main-task-owned lifecycle for issues raised during main-task user acceptance. Each improvement instance (`improvements.instances[]` with `schemaVersion: 1`) lives under the single owning main task at `.ypi/tasks/<task>/improvements/<imp-id>/` and carries a stable `imp_…` id, display id `IMP-001`…, title, bounded `feedback`, `status`/`phase`/`owner` (default owner `improver`), optional `approval`/`acceptance`/`disposition`/`approvalMode`, and its own artifact/plan/progress/run metadata. Instances never appear in the top-level Tasks list, never bind/chat/archive/complete independently, and the main task remains the only top-level record. Main-flow status extension: `review -> user_acceptance -> completed` (no issues) or `user_acceptance -> waiting_for_improvements` (once the user confirms creating an improvement) and `waiting_for_improvements -> review` only after **every** instance is `accepted` or explicitly `accepted_not_doing`; `completed`/`archive` are blocked while any instance remains unresolved (`analysis | waiting_clarification | waiting_prototype | waiting_plan_approval | implementing | checking | waiting_user_acceptance | cancelled | failed`), so a failed or cancelled item keeps the main task blocked until the user explicitly accepts “not doing” it with a reason and timestamp. All instance mutations reuse the parent `withTaskMutationLock` (staging + atomic rename + JSONL event append + `reconcileYpiStudioImprovements`), and the reconcile re-reads **all** instances after every terminal transition so concurrent final-instance completion cannot prematurely complete the main task. Improvements can only be created from `review`, `user_acceptance`, or `waiting_for_improvements`; the `create` transition and the main task's move to `waiting_for_improvements` are atomic within the same lock, so a duplicate request never produces two instances. Valid instance transitions are limited to `analysis -> waiting_plan_approval -> implementing -> checking -> waiting_user_acceptance -> accepted`; `implementing` requires a recorded user approval of the current revision (and the same session `contextId` when one was recorded), `recordYpiStudioImprovementApproval()` requires a meaningful non-TBD `plan-review.md` and a task-local HTML prototype whenever `ui.md` indicates a UI change, and `reviseYpiStudioImprovementPlan()`/`updateYpiStudioImprovementArtifact()` atomically bump the instance revision and clear any stale grant, so an old approved revision cannot implement. The instance file resolver `resolveYpiStudioImprovementRelativeFile()` (used by `GET /api/studio/tasks/[taskKey]/files/?improvementId=…`) scopes to the instance root and rejects URL schemes, absolute paths, `..` traversal, backslashes, directory targets, and symlink escapes relative to that directory; an unknown `improvementId`, an instance that does not belong to the task, or a task without improvements returns an error without reading any file — `../task.json` reaching back into the task directory is rejected. Bounded projection: widget/compact-tool/JSONL-event payloads expose only `taskId`, `improvementId`, status, counts, the first unresolved instance's blocker and next action, and a per-instance `{ id, displayId, title, status, owner, updatedAt, canAccept? }` (plus a bounded `feedbackPreview` in the compact tool projection); they never carry full `feedback` text or child transcripts. The session widget additionally receives optional filename-only `quickPreviews[]` (plan-review / prototype / improvement-plan + approval tone) for permanent read-only plan/HTML entries and may confirm `transition_improvement → accepted` for `waiting_user_acceptance` instances; preview paths stay GET-only and never write grants. The authoritative `getYpiStudioTaskDetail` is the only layer that returns full instance `feedback`, and only the detail-page “概览” tab consumes it. **Migration & rollback:** v1 tasks without an `improvements` field project as having no improvements, are never auto-written back, never become top-level tasks, and the field upgrades lazily on first improvement mutation. Custom workflows that lack `user_acceptance`/improvement capabilities surface the capability gap and are never overwritten. Rolling back the feature only disables the new actions/gate; existing improvement records stay read-only, auditable, and still require an explicit `accepted_not_doing` disposition to close unresolved instances, so historical data is never silently dropped. A new default `improver` member is added in the fixed Settings → Studio order `architect / improver / ui-designer / implementer / checker` with default policy `model.mode=followMain` and `thinking=inherit`, resolvable through the same `toolInput > memberConfig > defaultPolicy > followMain > piDefault` chain; default member/workflow template refresh remains non-destructive (exact-default files only, custom files untouched).
- Session-scoped Trellis task association remains high-confidence only (session transcript evidence or exact per-session runtime pointers). When evidence identifies a child task, the web projection promotes it to the nearest available parent task so the floating widget represents the main task context without mutating Trellis metadata.
- YPI Studio UI prototype gate is a workflow/prompt/checker invariant: if a task changes pages, adds frontend functionality, changes existing interactions, changes approval/confirmation experience, or changes user-visible information structure, the architect must dispatch the UI designer to produce an HTML prototype based on the existing project and request user approval before implementation. `ui.md` may carry the HTML prototype or link to a `.html` file, but pure Markdown cannot satisfy the gate; checker treats missing HTML prototype or approval record as blocking.
- Session-scoped YPI Studio widgets use high-confidence exact `contextIds` matches (`pi_<sessionId>` / `pi_transcript_<hash>`) and ignore `pi_process_*` as widget evidence. After exclusive transfer, the previous session no longer has the task in `contextIds`, so it drops out of bound candidates even if the transcript still mentions the task (transcript hits stay diagnostics-only). A single session can still show multiple different bound tasks; exclusivity is per task, not per session. The floating multi-task card keeps a fixed 360px desktop width and a display-only eight-station rail (`Brief → Design → Implement → Checks → Review → User Acceptance → Completed → Archived`) driven by workflow/status evidence rather than planning-file presence; permanent plan/HTML quick actions come from additive `quickPreviews` descriptors, improvement/main result acceptance reuse existing task PATCH transitions (no parallel grant), and Phase 1 plan decision CTAs render only from additive `userActions` after the read-only preview strip without replacing rail/accept/preview/runtime blocks. The chat UI triggers a debounced session-task recheck when Studio tool progress/results expose a task id/key, recent preview changes, or display-limit flags, so newly created/rebound Studio tasks and live `t/s`/phase updates can surface without a full page reload.
- When all tools are disabled, `lib/rpc-manager.ts` clears the agent system prompt.
- Memory diagnostic snapshots are a bounded, read-only运维 capability — not a leak fix. `POST /api/diagnostics/memory-snapshot` (and the Settings → 诊断 button) capture one schema-v1 snapshot in the current server process and atomically write it to `<getAgentDir()>/diagnostics/`. The collector (`lib/memory-diagnostics.ts`) composes process/V8 metrics and bounded owner projections from `rpc-manager`, `ypi-studio-subagent-runtime`, `session-reader`, `browser-share-manager`, `terminal-manager`, and `session-file-changes` under a 5s cooperative deadline and a 5 MiB final-JSON cap (with a compact fallback that drops per-item samples but keeps totals). Capture is strictly read-only: no abort/destroy/cleanup/reset/GC, no session start/list, no content/tool-result/system-prompt/response-id/buffer/env/credential reads. OpenAI Codex WebSocket debug stats are queried **only for known active openai-codex sessions via public getters** and only numeric/boolean fields are kept (per-known-session coverage, not the full private map; previous response ids and error strings are never persisted). A process-global single-flight guard (`globalThis.__piMemoryDiagnosticSnapshotInFlight`) rejects concurrent triggers with `409 snapshot_in_progress`. The API/UI return **metadata only**; the full JSON is never sent over HTTP or rendered in the browser. The snapshot retains local workspace/session paths and ids (with a `privacy` block + share-before-review warning) to aid correlation. Files use input-free names `memory-<UTC compact>-pid<PID>-<8hex>.json`, written via same-directory tmp + `rename` with best-effort `0700`/`0600`. There is no automatic retention/list/download center; users delete files manually. Diagnostics are additive and do not change JSONL, task, session, or config formats.

## Links / GitHub OAuth Device Flow

The **Links** domain is a standalone subsystem isolated from all LLM auth — it never imports `auth.json`, `auth-accounts/`, `auth-api-key-accounts/`, `CredentialStore`, `ModelRuntime`, or RPC auth reload. P0 supports connecting multiple GitHub identities through **GitHub OAuth Device Flow** using a **product-owned GitHub OAuth App**.

### Product Decisions

- **Authorization path**: GitHub OAuth Device Flow only — no PAT input, no Authorization Code callback, no `gh auth` import.
- **App identity**: Product-owned GitHub OAuth App with Device Flow enabled. Client id from server-only `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`; **no client secret** (Device Flow does not require one).
- **Terminal user**: Does not create an OAuth App, does not paste PAT, does not configure client id/secrets.
- **Scope**: Fixed `read:user` — no `repo`, `workflow`, or org management permissions.
- **Multi-account**: Multiple distinct GitHub numeric user ids can be connected simultaneously.
- **Duplicate identity**: Returns `409 duplicate_identity`; the new access token is not written locally. Users must disconnect first to reauthorize.
- **Disconnect**: Soft-deletes metadata + removes local OAuth secret. Does **not** revoke the remote GitHub OAuth grant.
- **Isolation**: Links operates entirely within `~/.pi/agent/links/` and its own REST/SSE routes. It never reads or writes LLM auth storage.

### Storage Layout

```text
~/.pi/agent/links/
  registry.json                  — metadata for all connections (connected + disconnected)
  .locks/
    registry.lock/               — cross-process mkdir lock for registry mutations
    <provider>/                  — provider-scoped per-connection mkdir locks
  github/
    <opaque-connection-id>.json  — OAuth secret (GitHubOAuthSecretV1, 0600)
    .quarantine-<random>.json    — quarantined secret during disconnect rollback
```

- Directories `0700`, files `0600`.
- Atomic writes: tmp → fsync → rename (same-directory).
- Provider-keyed process queue + cross-process mkdir lock.
- Registry is metadata-only — no `device_code`, access token, or raw upstream data.
- `device_code` never reaches disk.
- Duplicate detection by provider + `providerUserId` (numeric id) under lock.
- Disconnect: quarantine secret → update registry → final unlink (restore on failure).

### Authorization State Machine

```text
starting
  → awaiting_user
      ├─ authorization_pending → awaiting_user
      ├─ slow_down → awaiting_user (interval += GitHub response / min 5s)
      ├─ access_denied → denied
      ├─ expired_token / TTL → expired
      ├─ local cancel → cancelled
      ├─ network/timeout/bad response → failed
      └─ access token
           → validating_identity
              ├─ invalid token/bad /user → failed
              └─ valid identity
                   → persisting
                      ├─ duplicate → duplicate
                      ├─ store failure → failed
                      └─ connected
```

`globalThis.__piLinkAuthorizations` holds short-lived authorization sessions: opaque authorization id, provider, `userCode`, `deviceCode` (server-memory only), interval, expiry, status, sanitized result/error, AbortController, subscriber set. Constraints:

- Max 20 concurrent authorization sessions; beyond limit returns `429 authorization_capacity_exceeded`.
- Terminal states retained for 2 min TTL for SSE reconnect, then cleaned.
- Pending sessions are **never** persisted to disk; server restart loses them.
- Background polling runs independently of SSE subscribers; browser close / SSE disconnect does not cancel.
- DELETE cancel terminates polling but cannot guarantee cancellation of an already-approved remote grant.

### GitHub Fixed Network Contract

1. **Device code**: `POST https://github.com/login/device/code` — body: `client_id=<server>&scope=read:user`.
2. **Token polling**: `POST https://github.com/login/oauth/access_token` — body: `client_id=<server>&device_code=<memory>&grant_type=urn:ietf:params:oauth:grant-type:device_code`. Respects `interval`, `slow_down` (min +5s), `authorization_pending`, `access_denied`, `expired_token`, `device_flow_disabled`.
3. **Identity validation**: `GET https://api.github.com/user` — Bearer token, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`.

All calls enforce timeout (10s), response size cap (64 KiB), JSON Accept, redirect rejection, and fixed host/path. Raw upstream bodies must not leak into errors. The verification URI is fixed as `https://github.com/login/device`.

### Security Boundaries

- `userCode` is the short-term code GitHub shows users — it **may** appear in the browser/UI but must be cleared on terminal states, view changes, and unmount.
- `device_code` only exists in server memory (`globalThis.__piLinkAuthorizations`) — never on wire, disk, logs, metadata, or errors.
- Access token only exists in upstream responses, identity validation calls, and the secret file (`links/github/<id>.json`) — never on wire, DOM, metadata, logs, or task/session JSONL.
- Client secret is never configured, packaged, or referenced.
- Stable error codes only — no raw upstream bodies, absolute paths, or stack traces in API responses.
- All REST responses use `Cache-Control: no-store`; SSE uses `no-cache, no-store`.

### Provider Registry

`lib/links-provider-registry.ts` maintains an allowlist (`github` only in P0). Unknown providers fail closed. The `LinkProviderAdapter` interface encapsulates:

- `startAuthorization()` — initiates the provider OAuth flow (returns `deviceCode` internally only).
- `pollAuthorization()` — polls token endpoint with interval-aware backoff.
- `validateCredential()` — calls the provider identity endpoint.

Adapters are registered once at server init via `registerLinkProviderAdapter()`.

### Integration with Settings UI

Settings → Links is a root-level leaf (after Studio, before 模型与用量). Operations are **immediate-save** — they never mark `pi-web.json` dirty. Global Save/Reset is hidden/disabled on the Links view. The Link operations stay local to `~/.pi/agent/links/` and the in-process authorization manager; the Settings modal, `pi-web.json`, and LLM auth stores are never touched.

### Rollback

Hide the `links` Settings leaf and return 503 from authorization start. Retain `~/.pi/agent/links/` data — do not auto-delete or migrate back to `auth.json`. Pending authorizations are memory-only; a server restart naturally clears them. Remote GitHub OAuth grants must be manually revoked by the user at GitHub Settings → Applications → Authorized OAuth Apps.

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

`projectId`, `spaceId`, and `grokAccountStorageId` are optional. `projectId` and `spaceId` are written for new project-space sessions and inherited on fork. `grokAccountStorageId` is a **deprecated ignored** historical field retained only for JSONL parse compatibility; runtime auth uses the global Active Grok account. Legacy files that omit or include it are not migrated or rewritten.

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

`studioChild.status` is best-effort display/audit metadata. Studio task state, subagent run terminal status, approval gates, and implementation subtask progress remain authoritative in `.ypi/tasks/<task-id>/task.json`, so old tasks and sessions that omit `studioChild`, `runner`, or `childSessionId` require no migration. The Chat top-bar child inventory (`GET /api/sessions/:id/studio-children`) therefore prefers the matching task run for panel status and only falls back to this header field with an explicit stale marker; it never invents `running` / `runtime_lost` from modified age, tokens, or transcript text.

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

### Grok global Active account failover

Optional, default-off auto-failover for `grok-cli` managed OAuth accounts (`grok.autoFailover` in `pi-web.json`). Implemented as an independent Path B controller so ChatGPT production semantics stay untouched. Outer chain after Kiro is applied: Kiro → Grok → OpenCode Go → ChatGPT → Pi native.

**Product semantics**:
- Models `Activate` sets the current global Active only; it is not a lock/pin.
- Eligible errors on the current Active (including a manually activated account) may rotate Active and retry once when the switch is enabled.
- Switch affects all ordinary live/new Grok sessions' **next** requests; in-flight requests do not swap tokens mid-flight.
- Default budget: 1 attempt / 1 actual switch / 1 same-turn retry. Concurrent sessions share a process lock; the first switcher activates the next account, later entrants see Active-changed and retry without cascading to a third account.

**Classifier** (`detectGrokFailoverReason`):
- Positive: structured/explicit quota, usage, credits, monthly/weekly exhaustion; explicit rate-limit-exceeded / too-many-requests.
- Negative: bare status codes, fuzzy documentation text, auth/reauth, network, timeout, 5xx, context overflow, content filter, model unavailable.

**Candidates**: circular order from the trigger account; skip trigger/cooldown/missing credential/stale/reauth/exhausted monthly or weekly quota.

**Frontend**: Settings → Grok toggle; Models global Active copy; Chat `grok_account_failover` notice with Retrying only when `retry:true`.

**Rollback**: Disable `grok.autoFailover.enabled`. GPT/OpenCode Go/Kiro/Antigravity paths remain independent. Historical headers stay ignored.

### Kiro global Active account failover

Optional, default-off auto-failover for `kiro` managed OAuth accounts (`kiro.autoFailover` in `pi-web.json`). Independent Path B controller (`lib/kiro-account-failover.ts`, process state `globalThis.__piKiroFailover`) immediately inside Antigravity on the outer chain.

**Product semantics**:
- Activate / auto-switch sets provider-global Active only; affects ordinary live/new Kiro sessions on the **next** request; in-flight requests keep their token.
- No per-session Kiro pin and no credential import.
- Default budget matches Grok: 1 attempt / 1 actual switch / 1 same-turn retry with process lock + Active double-check + pre-Activate TOCTOU.

**Classifier** (`detectKiroFailoverReason`):
- Positive: explicit AWS reason codes (`MONTHLY_REQUEST_COUNT`, `OVERAGE_REQUEST_LIMIT_EXCEEDED`, `CONVERSATION_LIMIT_EXCEEDED`, `DAILY_REQUEST_COUNT`, `ServiceQuotaExceededError`), non-auth `quota_or_entitlement`, explicit quota exhausted / rate-limit text.
- Hard-negative first: `INSUFFICIENT_MODEL_CAPACITY`, bare status codes, auth/reauth, network/timeout, 5xx, context/content/model/help fuzzy text.

**Candidates**: circular from trigger; require readable/refreshable credential, no reauth, and **fresh/live** primary GetUsageLimits remaining > 0. Stale/unknown/unavailable quota is **fail-closed** (never blind rotate).

**Frontend**: Settings → Kiro toggle; Models global-Active copy; Chat `kiro_account_failover` notice with Retrying only when `retry:true`.

**Rollback**: Disable `kiro.autoFailover.enabled` and/or `kiro.usagePanelEnabled`. Grok/GPT/OpenCode Go/Antigravity remain independent. Keep `auth-accounts/kiro/` credentials.

### Antigravity global Active account failover

Optional, default-off auto-failover for `google-antigravity` managed OAuth accounts (`antigravity.autoFailover` in `pi-web.json`). Outermost independent Path B controller (`lib/antigravity-account-failover.ts`, process state `globalThis.__piAntigravityFailover`).

**Product semantics**:
- Activate / auto-switch sets provider-global Active only; affects ordinary live/new Antigravity sessions on the **next** request; in-flight requests keep their token.
- No per-session pin and no credential import.
- Model-aware: candidates must have fresh/live quota for the **current public model** via the fixed `0.3.0` mapping (`lib/antigravity-model-quota.ts`) with `remainingFraction > 0`. Other models’ remaining quota never qualifies the account.
- Default budget: 1 actual switch + 1 same-turn retry with process lock + Active double-check + candidate revalidation + pre-Activate TOCTOU.
- Default project `rising-fact-p41fc` is never health evidence.

**Classifier** (`detectAntigravityFailoverReason`):
- Positive: explicit `RESOURCE_EXHAUSTED`, quota exhausted/exceeded, quotaResetDelay/TimeStamp, `rate_limit_exceeded`, too many requests, explicit rate-limit text (may accompany 429, but 429 alone is not enough).
- Hard-negative first: bare 429 / `Cloud Code Assist API error (429)`, 401/403, auth/token/project, network/timeout/abort, 5xx/529/capacity/overloaded, context/content/safety/model, fuzzy help.

**Candidates**: circular from trigger; require readable credential, no reauth, fresh/live matching-model entry remaining > 0. Stale/unknown/unmapped/other-model-only is **fail-closed**.

**Frontend**: Settings → Antigravity toggles; Models global-Active + risk disclosure; Chat `antigravity_account_failover` notice with Retrying only when `retry:true`.

**Rollback**: Disable `antigravity.autoFailover.enabled` and/or `antigravity.usagePanelEnabled`. Kiro/Grok/GPT/OpenCode Go remain independent. Keep `auth-accounts/google-antigravity/` credentials and normalized quota cache.
