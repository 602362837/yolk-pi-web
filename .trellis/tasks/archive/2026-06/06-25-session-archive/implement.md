# Session Archive — Implementation Plan

## Phase 1: Backend Core

### 1.1 lib/session-reader.ts — archive helpers

New functions (append to existing file):

- `getSessionsArchiveDir()` — returns `getAgentDir() + "/sessions-archive"`
- `archiveSessionFile(sessionPath: string)` — core rename logic:
  1. Compute target path (replace `sessions/` with `sessions-archive/` in the path)
  2. `mkdirSync(dirname(target), { recursive: true })`
  3. `renameSync(source, target)`
  4. Scan sibling files for `parentSession` references, update JSONL header if needed
  5. Return new path
- `unarchiveSessionFile(sessionPath: string)` — reverse rename
- `scanArchivedCwds()` — sync scan of `sessions-archive/` directory:
  1. `readdirSync` top-level dirs
  2. Decode cwd from dir name (reverse the `--path--` encoding)
  3. Count `.jsonl` files per dir
  4. Return `{ cwds: string[], counts: Record<string, number> }`
- `listArchivedSessionsForCwd(cwd: string)` — parse JSONL headers in archive dir for a specific cwd, return `SessionInfo[]`
- `resolveArchivedSessionPath(sessionId: string)` — find a session in the archive dir by scanning

Extend `resolveSessionPath()`:
- After cache miss and active scan, also check archive dir
- Cache archived paths the same way (path contains `sessions-archive/` so it's distinguishable)

**Validation**: TypeScript compiles, functions are unit-testable via manual invocation.

### 1.2 API Route: POST /api/sessions/archive/route.ts

```
app/api/sessions/archive/route.ts
```

- Parse `{ sessionIds: string[] }` from body
- For each id:
  - `resolveSessionPath(id)` → get current path
  - Verify it's in `sessions/` (not already archived)
  - `getRpcSession(id)?.destroy()` — kill active RPC
  - `archiveSessionFile(path)` — move file
  - `invalidateSessionPathCache(id)` — clear cache
- Return `{ archived: [...], errors: [...] }`

### 1.3 API Route: POST /api/sessions/unarchive/route.ts

```
app/api/sessions/unarchive/route.ts
```

- Parse `{ sessionIds: string[] }` from body
- For each id:
  - `resolveSessionPath(id)` → should find in archive
  - Verify it's in `sessions-archive/`
  - `unarchiveSessionFile(path)` — move file back
  - `invalidateSessionPathCache(id)` — clear cache
- Return `{ unarchived: [...], errors: [...] }`

### 1.4 API Route: POST /api/sessions/archive-all/route.ts

```
app/api/sessions/archive-all/route.ts
```

- Parse `{ cwd: string }` from body
- List all active sessions, filter by cwd match (using `cwdKeys()`)
- Archive each one (reuse archive logic from 1.2)
- Destroy all RPC sessions for that cwd
- Return `{ archived: [...], errors: [...] }`

### 1.5 API Route: GET /api/sessions/archived/route.ts

```
app/api/sessions/archived/route.ts
```

- Parse `cwd` from query params
- `listArchivedSessionsForCwd(cwd)` → return `{ sessions: SessionInfo[] }`

### 1.6 Extend GET /api/sessions/route.ts

- After `listAllSessions()`, also call `scanArchivedCwds()`
- Return extended response: `{ sessions, archivedCwds, archivedCounts }`

### 1.7 Extend GET /api/sessions/[id]/route.ts

- When `resolveSessionPath(id)` returns a path containing `sessions-archive/`, include `archived: true` in the response info object
- Archived sessions are read-only: the session detail still loads, but the frontend will block sends

**Phase 1 validation**:
```bash
npm run lint
node_modules/.bin/tsc --noEmit
# Manual: curl tests for archive/unarchive/list APIs
```

---

## Phase 2: Frontend — Single Session Archive

### 2.1 lib/types.ts

Add `archived?: boolean` to `SessionInfo` interface.

### 2.2 SessionSidebar.tsx — state & data loading

- Extend `loadSessions()` to capture `archivedCwds` and `archivedCounts` from the response
- Add state: `archivedCounts`, `archivedCwds`, `archivedSessions`, `archivedExpanded`
- Add `loadArchivedSessions(cwd)` function that calls `GET /api/sessions/archived?cwd=...`

### 2.3 SessionItem — archive button

- Add archive button (📦 icon) to the hover action group: `[Rename] [Archive] [Delete]`
- On click: optimistic remove + `POST /api/sessions/archive`
- If archiving the currently selected session, notify parent via callback

### 2.4 Archived section in session list

- Below the active session list, render a collapsible "Archived (N)" header
- Only visible when `archivedCounts[selectedCwd] > 0`
- On expand: call `loadArchivedSessions(selectedCwd)`
- Render archived sessions with muted/italic styling
- Each archived session has: [Unarchive] and [Delete] hover actions

### 2.5 useAgentSession.ts — read-only mode

- When session detail response includes `archived: true`, set a flag
- Pass `archived` flag to ChatInput to disable sending
- Show a top banner in ChatWindow: "This session is archived. Unarchive to continue."

**Phase 2 validation**:
```bash
npm run lint
node_modules/.bin/tsc --noEmit
# Manual: archive a session, verify it moves to archived section, view it read-only, unarchive it
```

---

## Phase 3: Frontend — Batch & One-Click Archive

### 3.1 Workspace menu (⋯ button)

- Add a "⋯" button in the session list header area (next to Refresh)
- Menu items:
  - "归档所有会话" (Archive all sessions) — triggers archive-all flow
  - "选择归档…" (Select to archive…) — enters multi-select mode

### 3.2 Archive All flow

- Click "Archive all" → confirmation dialog: "归档 <cwd> 下的 N 个会话？"
- Confirm → `POST /api/sessions/archive-all { cwd }` → refresh list
- If the currently viewed session was in the archived set, show archived banner

### 3.3 Multi-select mode

- State: `multiSelectMode: boolean`, `selectedForArchive: Set<string>`
- When active:
  - Each SessionItem shows a checkbox (left of content)
  - A bottom action bar appears: "[Archive N sessions] [Cancel]"
  - Clicking a session toggles selection instead of opening it
- "Archive N sessions" → `POST /api/sessions/archive { sessionIds: [...] }` → exit multi-select → refresh

### 3.4 CWD picker — archive-only projects

- `getRecentCwds()` accepts optional `archivedCwds` parameter
- Cwds with archived sessions but no active sessions are appended at the end
- In the picker dropdown, these rows show muted styling with "(archived)" label

**Phase 3 validation**:
```bash
npm run lint
node_modules/.bin/tsc --noEmit
# Manual: batch archive, archive-all, verify CWD picker shows archived-only projects
```

---

## Phase 4: Polish & Docs

### 4.1 Update docs

- `docs/modules/api.md` — add new routes to the route table
- `docs/modules/library.md` — add new lib functions
- `docs/modules/frontend.md` — note SessionSidebar archive features
- `docs/architecture/overview.md` — add archive path to session lifecycle section
- `AGENTS.md` — no change needed (top-level structure unchanged)

### 4.2 Final validation

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Full manual test of all flows: single archive, batch archive, archive-all, unarchive, view archived, archive-only project visibility.
