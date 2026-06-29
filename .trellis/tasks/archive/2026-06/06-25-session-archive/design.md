# Session Archive — Design

## Storage Model

Archive directory mirrors the active sessions directory:

```
~/.pi/agent/
├── sessions/                          # Active sessions (existing)
│   └── --path-to-project--/
│       └── <timestamp>_<uuid>.jsonl
└── sessions-archive/                  # Archived sessions (new)
    └── --path-to-project--/
        └── <timestamp>_<uuid>.jsonl
```

Archive/unarchive = `fs.renameSync()` between the two trees. Same filename, mirrored directory structure.

## Data Flow

### Archive Flow

```
User clicks archive
  → Frontend optimistic remove from list
  → POST /api/sessions/archive { sessionIds: ["id1"] }
  → Server: resolveSessionPath(id) → find file in sessions/
  → Server: destroy active RPC session if alive
  → Server: compute target = replace sessions/ with sessions-archive/
  → Server: mkdirSync target dir, renameSync file
  → Server: update parentSession refs in sibling JSONL headers
  → Server: invalidate session path cache
  → Response: { archived: [{id, path}], errors: [] }
  → Frontend: refresh archived count
```

### Session Listing Flow (extended)

```
GET /api/sessions
  → listAllSessions()             — existing, unchanged (active only)
  → scanArchivedCwds()            — NEW: scan sessions-archive/ dirs
  → Response: {
      sessions: SessionInfo[],     — active only
      archivedCwds: string[],      — cwds with archived sessions
      archivedCounts: {cwd: N}     — per-cwd archive count
    }
```

### CWD Picker Visibility

```
getRecentCwds(activeSessions, extraCwds)
  → existing logic: extract cwds from active sessions
  → NEW: append archivedCwds that have no active sessions
  → Result: all projects visible, archive-only ones at bottom
```

## API Design

### New Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `sessions/archive/` | POST | Archive one or more sessions |
| `sessions/unarchive/` | POST | Unarchive one or more sessions |
| `sessions/archive-all/` | POST | Archive all sessions for a cwd |
| `sessions/archived/` | GET | List archived sessions for a cwd |

### Extended Routes

| Route | Change |
|-------|--------|
| `sessions/` GET | Add `archivedCwds`, `archivedCounts` to response |
| `sessions/[id]` GET | Fallback to archive dir if not found in active dir |

### Request/Response Shapes

```typescript
// POST /api/sessions/archive
Request:  { sessionIds: string[] }
Response: { archived: Array<{id: string, path: string}>, errors: Array<{id: string, error: string}> }

// POST /api/sessions/unarchive
Request:  { sessionIds: string[] }
Response: { unarchived: Array<{id: string, path: string}>, errors: Array<{id: string, error: string}> }

// POST /api/sessions/archive-all
Request:  { cwd: string }
Response: { archived: Array<{id: string, path: string}>, errors: Array<{id: string, error: string}> }

// GET /api/sessions/archived?cwd=<encoded-cwd>
Response: { sessions: SessionInfo[] }
```

## lib Layer

### session-reader.ts additions

```typescript
export function getSessionsArchiveDir(): string
  // → getAgentDir() + "/sessions-archive"

export async function listArchivedSessions(cwd?: string): Promise<SessionInfo[]>
  // Scan sessions-archive/ like listAllSessions() but for a specific cwd
  // Cannot use SessionManager.listAll() (only scans sessions/)
  // → Manual JSONL header parsing for session metadata

export function scanArchivedCwds(): { cwds: string[], counts: Record<string, number> }
  // Sync scan of sessions-archive/ top-level dirs
  // Decode cwd from dir name, count .jsonl files per dir

export function archiveSession(sessionId: string): { id: string, newPath: string }
  // Resolve path → compute archive target → destroy RPC → rename → update refs → clear cache

export function unarchiveSession(sessionId: string): { id: string, newPath: string }
  // Reverse: resolve from archive → compute active target → rename → update refs → clear cache

export function archiveAllSessionsForCwd(cwd: string): Array<{id: string, newPath: string}>
  // List active sessions for cwd → archive each
```

### resolveSessionPath() extension

Add a secondary lookup in `sessions-archive/` when the active path cache misses. Cache entries are tagged with source (`active` | `archived`) to support separate listing.

### Path cache extension

The existing `__piSessionPathCache` (Map<string, string>) stores sessionId→path. Archived sessions get cached the same way (the path itself reveals whether it's archived via path prefix).

## Frontend

### types.ts

```typescript
export interface SessionInfo {
  // ... existing fields
  archived?: boolean;  // true for archived sessions
}
```

### SessionSidebar.tsx changes

1. **State additions**:
   - `archivedCounts: Record<string, number>` — from GET /api/sessions response
   - `archivedCwds: string[]` — from GET /api/sessions response
   - `archivedSessions: SessionInfo[]` — loaded on demand per cwd
   - `archivedExpanded: boolean` — collapsed by default
   - `multiSelectMode: boolean` — for batch archive
   - `selectedForArchive: Set<string>` — selected session ids

2. **Archive button on SessionItem**: Added to hover actions alongside Rename/Delete. No confirmation needed.

3. **Archived section**: Collapsible section at bottom of session list. Loads from `GET /api/sessions/archived?cwd=...` when expanded.

4. **Multi-select mode**: Triggered from workspace-level ⋯ menu. Checkboxes on each session, action bar at bottom.

5. **CWD picker**: `getRecentCwds()` receives archivedCwds, appends projects with no active sessions at the end with muted styling.

### useAgentSession.ts changes

When the loaded session is archived (detected from path or from a flag in the session detail response), set `canSend = false` and provide an `archived` flag for the UI to show the banner.

## Edge Cases

| Case | Handling |
|------|----------|
| Archive session with active RPC | Destroy RPC first, then move file |
| Archive session with fork children | Only archive the target; children become roots in the tree |
| Archive currently viewed session | Show read-only banner with unarchive button |
| All sessions archived for a cwd | Project still visible in CWD picker (muted style) |
| Archive dir missing | Create on first archive operation |
| Concurrent archive of same session | renameSync will fail on second call; report error |
| parentSession path update | Scan sibling files in same dir, rewrite header line if it references the moved file |
