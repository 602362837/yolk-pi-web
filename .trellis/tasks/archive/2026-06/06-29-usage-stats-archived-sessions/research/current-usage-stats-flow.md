# Current Usage Stats Flow

## Entry points

- Lower-left `Usage` button in `components/AppShell.tsx` opens `components/UsageStatsModal.tsx`.
- `UsageStatsModal` calls `GET /api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` and, when scoped to current cwd, adds `cwd=<active cwd>`.
- `app/api/usage/route.ts` validates date range and calls `getUsageStats()` from `lib/usage-stats.ts`.

## Aggregation logic

`lib/usage-stats.ts#getUsageStats()`:

1. Calls `listAllSessions()` from `lib/session-reader.ts`.
2. Applies optional exact `session.cwd === options.cwd` filtering.
3. Opens each matched session file with `SessionManager.open(session.path)`.
4. Iterates every JSONL entry in the file.
5. Counts only entries where `entry.type === "message"`, `entry.message.role === "assistant"`, and `entry.message.usage` exists.
6. Filters by entry timestamp.
7. Aggregates totals by day, provider/model, provider, and session.

Because it reads all entries in each active session file directly, in-session UI branch collapse should not affect the modal aggregation by itself.

## Active session source

`lib/session-reader.ts#listAllSessions()` delegates to `SessionManager.listAll()` from the pi SDK. The SDK implementation scans only `getSessionsDir()` (`~/.pi/agent/sessions/...`) when no custom session directory is supplied.

The web app archives sessions by moving JSONL files from `sessions/` to `sessions-archive/`:

- `app/api/sessions/archive/route.ts` calls `archiveSessionFile()`.
- `lib/session-reader.ts#archiveSessionFile()` renames `/sessions/` to `/sessions-archive/`.
- `app/api/sessions/route.ts` still uses `listAllSessions()` for active sessions, and separately calls `scanArchivedCwds()` only to show archive counts.
- `app/api/sessions/archived/route.ts` can list archived sessions for a cwd via `listArchivedSessionsForCwd()`.

## Likely gap

`getUsageStats()` never calls `listArchivedSessionsForCwd()`, `scanArchivedCwds()`, or scans `sessions-archive/` globally. Therefore archived sessions are excluded from Usage stats in both "All" and "Cwd" scopes.

## Related data-loss path

Worktree removal/archive APIs call `deleteSessionsForCwd()`, which deletes active session files instead of moving them to `sessions-archive/`. Once deleted, usage can no longer be recovered from local session JSONL files.

## Separate top-bar stats behavior

The top-bar current-session token/cost display in `AppShell` uses `sessionStats` from `hooks/useAgentSession.ts`, computed from the currently loaded `messages` array. That `messages` array comes from `buildSessionContext(entries, leafId)`, which follows the selected leaf path rather than all branches. This is separate from the lower-left Usage modal and may omit sibling in-session branches depending on the selected leaf.
