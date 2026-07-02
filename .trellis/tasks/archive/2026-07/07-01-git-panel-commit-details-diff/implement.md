# Implementation Plan — Git panel commit details and diff viewer

## Preconditions

- Task remains in planning until review/approval, then run `task.py start`.
- Follow the loaded frontend/component/type-safety guidelines.
- Use argv-array Git execution only (`execFile`).
- Do not run `next build` directly.

## Ordered Checklist

### 1. Shared Git wire types

- [x] Extend `lib/types.ts` with:
  - `GitCommitFileStatus`
  - `GitCommitChangedFile`
  - `GitCommitDetail`
  - `GitCommitDiffReason`
  - `GitCommitFileDiffResponse`
- [x] Reuse existing `GitCommitRef` for refs/decorations.

### 2. Commit detail API

- [x] Add `app/api/git/commit/route.ts`.
- [x] Implement route-local Git helper using `execFile` and safe `maxBuffer`.
- [x] Validate `cwd` is a Git repository.
- [x] Validate and normalize `hash` with `rev-parse --verify <hash>^{commit}`.
- [x] Parse metadata from NUL-delimited `git show -s --format=...` output.
- [x] Parse refs/decorations consistently with `app/api/git/graph/route.ts`.
- [x] Parse changed files with first-parent/root semantics, rename/copy detection, binary-safe additions/deletions.
- [x] Return typed JSON `{ detail }` and clear JSON errors.

### 3. Commit file diff API

- [x] Add `app/api/git/diff/route.ts`.
- [x] Reuse route-local validation helpers or extract small helpers only if duplication becomes large.
- [x] Generate a unified patch for root or first-parent comparison.
- [x] Use `--` before pathspecs and include `oldPath` only as a fallback pathspec when provided.
- [x] Bound output size; map too-large/binary/unavailable cases to `diffAvailable: false`.
- [x] Return typed JSON `GitCommitFileDiffResponse`.

### 4. Commit graph selection UI

- [x] Update `components/CommitGraph.tsx` props with `selectedHash` and `onSelectCommit`.
- [x] Make rows clickable/selectable while preserving hover tooltips and graph lane rendering.
- [x] Add selected-row styling using CSS variables.
- [x] Preserve current behavior for callers that do not pass selection props.

### 5. GitPanel commit-detail state and rendering

- [x] In `components/GitPanel.tsx`, add selected commit state.
- [x] On graph refresh/branch preview change, preserve selection if possible, otherwise select first visible commit or clear.
- [x] Fetch `/api/git/commit` for selected hash and show loading/error/empty states.
- [x] Render metadata and changed-file list under the graph.
- [x] Show status, old → new paths, and additions/deletions when present.
- [x] Double-click on a changed file opens the diff modal.
- [x] Keep staged/unstaged/untracked/stash summaries below the new commit-detail area.

### 6. Diff modal UI

- [x] Add `components/GitCommitDiffModal.tsx`.
- [x] Fetch `/api/git/diff` on open.
- [x] Render a fixed large modal with close button and Escape support.
- [x] Reuse `components/UnifiedDiffView.tsx` for available diffs.
- [x] Render clear fallback messages for binary, too-large, unavailable, loading, and error states.
- [x] Ensure modal z-index appears above the top-panel dropdown.

### 7. Documentation

- [x] Update `docs/modules/api.md` with `git/commit` and `git/diff`.
- [x] Update `docs/modules/frontend.md` for GitPanel/CommitGraph and the new modal component.
- [x] Update `docs/modules/library.md` for the new Git wire types in `lib/types.ts` if necessary.
- [x] Check whether `AGENTS.md` module entry points need wording updates.

## Manual Validation Scenarios

1. Non-Git directory:
   - Git panel still renders “Not a Git repository”.
2. Normal commit selection:
   - Clicking a graph row highlights it and loads metadata/files.
3. Branch preview switch:
   - Changing the preview branch updates graph and selected commit details.
   - Switch remains explicit and dirty worktree protection still applies.
4. Root commit:
   - File list renders additions or a clear empty state.
5. Modified/added/deleted file:
   - Double-click opens modal and shows a unified diff.
6. Rename/copy:
   - Detail row displays `old → new`; modal diffs the correct path.
7. Binary or very large file:
   - Detail row does not crash; modal shows a clear fallback.
8. Existing local status summaries:
   - Staged, unstaged, untracked, and stash sections remain visible and accurate.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Risky Files / Rollback Points

- `components/GitPanel.tsx`: large existing component; keep changes localized and avoid rewriting branch-switch logic.
- `components/CommitGraph.tsx`: graph layout is custom; only add selection/click props around existing row rendering.
- `app/api/git/commit/route.ts` and `app/api/git/diff/route.ts`: command parsing must handle Git edge cases without shell interpolation.
- `lib/types.ts`: keep shared type additions backwards compatible.
