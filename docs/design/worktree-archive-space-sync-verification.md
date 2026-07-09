# WorkTree Archive Space Sync — Manual Verification

> Generated: 2026-07-09 during WT-05 (docs/tests/verification).
> Based on implementation in `lib/project-registry.ts`, `app/api/git/worktrees/`, `components/SessionSidebar.tsx`.

## Prerequisites

- A registered Git project in the web UI.
- At least one WorkTree created via UI or CLI.

## Verification Scenarios

### 1. UI Archive WorkTree

**Steps:**
1. Select the worktree space in the Sidebar.
2. Click the archive action (⏸ Archive) on the worktree space.
3. Confirm the risk dialog.

**Expected:**
- API returns `archivedSpaces` with the matching space marked `archived: true, missing: true`.
- The worktree space immediately disappears from the Sidebar project tree.
- The selected space falls back to the same project's `main` space (or another active space).
- The new main space is selected and its sessions load.
- The archived WorkTree directory is removed from the filesystem.

**Actual:**
- [ ] _To be verified manually_

---

### 2. UI Delete WorkTree

**Steps:**
1. Select the worktree space in the Sidebar.
2. Confirm the delete action.
3. If dirty, confirm force delete.

**Expected:**
- API returns `archivedSpaces` with the matching space marked `archived: true, missing: true`.
- The worktree space immediately disappears from the Sidebar.
- Fallback space selection works (main → active non-missing → fallbackCwd → null).
- Related session files (`*.jsonl`) are deleted.
- `deletedSessionIds` are reported.

**Actual:**
- [ ] _To be verified manually_

---

### 3. CLI `git worktree remove`

**Steps:**
1. In a terminal, run `git worktree remove <path>` for a worktree.
2. In the web UI, refresh the project list (click the refresh button at top of Sidebar).
3. Alternatively, call `POST /api/projects/[projectId]/worktrees/refresh`.

**Expected:**
- Full refresh (`syncProjectWorktreeSpaces`) runs `git worktree list --porcelain`.
- The removed worktree's space is archived (`archived: true, missing: true`).
- The missing-only follow-up pass (`syncMissingWorktreeSpaces`) also catches it.
- Response includes `archivedMissing` and optional `missingSync.archivedSpaces`.
- The space no longer appears in active spaces.

**Actual:**
- [ ] _To be verified manually_

---

### 4. Direct Delete WorkTree Directory

**Steps:**
1. In a terminal, delete the WorkTree directory: `rm -rf <worktree-path>`.
2. In the web UI, load the project list with `GET /api/projects?sync=missing`.

**Expected:**
- Missing-only sync (`syncMissingWorktreeSpaces`) detects the missing path via `canonicalizeProjectPath()`.
- The space is soft-archived (`archived: true, missing: true`) with audit metadata.
- `GET /api/projects` response includes `sync.archivedSpaces`.

**Actual:**
- [ ] _To be verified manually_

---

### 5. `git worktree move`

**Steps:**
1. In a terminal, move a worktree: `git worktree move <old-path> <new-path>`.
2. In the web UI, trigger a full refresh via `POST /api/projects/[projectId]/worktrees/refresh`.

**Expected:**
- Full refresh discovers the new path via `git worktree list --porcelain` and upserts a new (or un-archives existing) space.
- The old path space is archived (`archived: true, missing: true`).
- `archivedMissing` includes the old space id.
- The new path space appears as an active worktree space.

**Actual:**
- [ ] _To be verified manually_

---

### 6. Symlink / Display Path Scenarios

**Steps:**
1. Register a project where the display path is a symlink (e.g., `/var/project` → `/real/path/to/project`).
2. Create a WorkTree and verify it appears as a space.
3. Archive the WorkTree via UI.

**Expected:**
- `pathKey` (resolved realpath) is the primary matching key.
- `displayPath` and `realPath` serve as fallbacks.
- No duplicate spaces for the same canonical WorkTree.
- Archive matches the space regardless of which alias is used as input.
- `unmatchedPaths` in the response correctly reports any path alias that did not match a space.

**Actual:**
- [ ] _To be verified manually_

---

## Automated Verification

```bash
npm run lint && node_modules/.bin/tsc --noEmit
```

- [x] Passes (as of 2026-07-09)

## Notes

- The frontend `loadProjects()` does **not** include `?sync=missing` by default; the query parameter is available for backend consumers (e.g., `ypic` CLI or explicit refresh flows). The Sidebar relies on the immediate optimistic merge of `archivedSpaces` from archive/delete API responses plus the `POST .../refresh` endpoint for explicit manual refresh.
- `invalidateAllowedRootsCache()` is called after archive/delete to ensure the file API stops authorizing the removed WorkTree path immediately.
- `allowed-roots.ts` already skips `archived` and `missing` spaces when building the root set, providing a secondary safety net.
