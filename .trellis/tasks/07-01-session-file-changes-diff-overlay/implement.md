# Implementation Plan — Session file changes diff overlay

## Preconditions

- Task remains in planning until the user approves implementation.
- Follow project validation minimums:
  - `npm run lint`
  - `node_modules/.bin/tsc --noEmit`
- Do not run `next build` directly.

## Ordered Checklist

### 1. Shared types and diff utility

- [ ] Add browser-safe wire types to `lib/types.ts`:
  - `SessionFileChangeStatus`
  - `SessionFileChangeSourceKind`
  - `SessionChangedFileSummary`
  - `SessionChangesSummaryResponse`
  - `SessionFileDiffResponse`
- [ ] Add `lib/unified-diff.ts`:
  - generate unified diff from optional before/after text
  - count additions/deletions
  - enforce max diff size
- [ ] If using the `diff` package, add it as a direct dependency in `package.json`.

### 2. Session file change tracker

- [ ] Add `lib/session-file-changes.ts`.
- [ ] Implement sidecar path helpers:
  - `getSessionChangesPath(sessionId)`
  - `readSessionChangesSidecar(sessionId)`
  - `writeSessionChangesSidecar(sidecar)` using temp-file + rename
  - `deleteSessionChangesSidecar(sessionId)` best effort
- [ ] Implement path normalization:
  - resolve tool path against cwd
  - require cwd-relative path for displayed records
  - skip/mark outside-workspace paths
- [ ] Implement bounded text snapshot helper:
  - stat file
  - classify missing/text/binary/too-large/unreadable
  - read UTF-8 text only inside size limits and without NUL bytes
- [ ] Implement `recordSessionFileChangeEvent({ sessionId, sessionFile, cwd, event })`:
  - handle `tool_execution_start` for `edit` and `write`
  - explicitly ignore `bash` events in MVP
  - handle `tool_execution_end`
  - ignore errored known-path tool calls unless after-state proves a partial change occurred
  - update cumulative file records
  - return `{ changed: boolean; fileCount: number }`

### 3. RPC integration

- [ ] Update `lib/rpc-manager.ts`:
  - import tracker lazily or directly
  - call tracker from `AgentSessionWrapper.start()` for every event
  - preserve existing event forwarding order and idle reset behavior
  - optionally emit `{ type: "session_file_changes_update" }` to listeners after tracker changes
- [ ] Update `AgentEvent` typing locally if needed without weakening existing event handling.
- [ ] Ensure fork destroy behavior remains unchanged.

### 4. API routes

- [ ] Add `app/api/sessions/[id]/changes/route.ts`.
- [ ] Add `app/api/sessions/[id]/changes/file/route.ts`.
- [ ] Both routes should:
  - resolve session with `resolveSessionPath(id)`
  - return JSON errors with appropriate status codes
  - omit raw snapshots and absolute paths
  - tolerate missing sidecar as an empty state
- [ ] Update session delete flow in `app/api/sessions/[id]/route.ts` to delete sidecar best effort.

### 5. Frontend UI

- [ ] Add `components/UnifiedDiffView.tsx` for read-only unified diff rendering.
- [ ] Add `components/FileDiffModal.tsx`:
  - fetch one file diff
  - render loading/error/metadata-only states
  - close on button / Escape if practical
- [ ] Add `components/SessionChangesFloatingPanel.tsx`:
  - fetch summary by session id
  - hide when no files
  - display status badges and `+N -M`
  - open diff modal on row click
  - refresh during agent runs or via synthetic SSE version prop
- [ ] Mount panel in `components/ChatWindow.tsx` for existing sessions.
- [ ] Avoid hardcoded colors; use CSS variables and existing inline style patterns.

### 6. Hook/event refresh wiring

Choose one implementation:

- [ ] Preferred: expose a `changesVersion` counter from `hooks/useAgentSession.ts` when it sees `session_file_changes_update` or `agent_end`; pass it to `SessionChangesFloatingPanel`.
- [ ] Simpler: pass `agentRunning` to the panel and poll summary while running, then refetch once on completion.

### 7. Documentation

- [ ] Update `docs/modules/api.md` with new routes.
- [ ] Update `docs/modules/frontend.md` with new components.
- [ ] Update `docs/modules/library.md` with new library modules.
- [ ] Update `docs/architecture/overview.md` with sidecar/non-Git tracking invariant.
- [ ] Update `AGENTS.md` if the module entry points or top-level navigation table should mention the new feature.

## Manual Validation Scenarios

1. Non-Git temp workspace, existing text file, agent uses `edit`:
   - floating panel appears
   - file status is modified
   - modal shows cumulative diff
2. Non-Git temp workspace, agent uses `write` for a new file:
   - file status is added
   - modal shows all additions
3. Multiple edits to the same file:
   - one row only
   - additions/deletions reflect cumulative baseline-to-latest diff
4. Binary or oversized file:
   - no raw content shown
   - explanatory metadata-only state shown
5. Existing session without sidecar:
   - no crash
   - no floating widget or empty state as designed
6. Archived session with sidecar:
   - diff can still be viewed read-only
7. Bash mutation:
   - bash-created or bash-edited files are not listed in MVP
   - UI/API wording does not imply bash coverage

## Risky Files / Rollback Points

- `lib/rpc-manager.ts`: central live session lifecycle; keep changes minimal and easily reversible.
- `hooks/useAgentSession.ts`: central browser streaming state; avoid broad refactors.
- Sidecar writer: protect against corrupt writes with atomic rename and safe parse fallbacks.
- Future bash scanner work should be a separate design; do not add recursive workspace scans in this MVP.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```
