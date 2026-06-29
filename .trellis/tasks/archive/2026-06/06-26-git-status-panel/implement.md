# Implementation Plan

## Read First

- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `.trellis/spec/frontend/index.md`
- `.trellis/spec/guides/index.md`

## Steps

1. **Add type definitions** — `lib/types.ts`
   - Add `GitFileChange`, `GitCommitInfo`, `GitStatusInfo` interfaces.
   - Validation: `tsc --noEmit` passes.

2. **Add API route** — `app/api/git/status/route.ts`
   - Parse `git status --porcelain=v2 --branch` for branch/changes.
   - Parse `git log` for recent commits.
   - Parse `git stash list` for stash count.
   - Detect worktree via `git rev-parse --git-common-dir` vs `--git-dir`.
   - Return `{ status: GitStatusInfo | null }`.
   - Validation: `curl localhost:30141/api/git/status?cwd=...` returns expected data.

3. **Add panel component** — `components/GitPanel.tsx`
   - Props: `{ cwd, refreshKey }`.
   - Internal fetch + state management.
   - Sections: branch bar, commits, staged, unstaged, untracked, stash.
   - Refresh button.
   - Follow existing panel styles (`var(--bg-panel)`, `var(--font-mono)`, etc).
   - Validation: component renders without errors.

4. **Integrate into AppShell** — `components/AppShell.tsx`
   - Extend `activeTopPanel` type to include `"git"`.
   - Add `gitDirty` state (fetched separately for button indicator).
   - Add `gitRefreshKey` state, increment on `onAgentEnd` and cwd change.
   - Add Git button in top bar after Subagents.
   - Add Git panel in dropdown section.
   - Import `GitPanel`.
   - Validation: panel opens/closes, mutual exclusion with other panels works.

5. **Update docs**
   - `docs/modules/api.md` — add `git/status/` entry.
   - `docs/modules/frontend.md` — add `GitPanel.tsx` entry.

## Validation

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

Manual:
- Git repo: panel shows branch, commits, changes.
- Non-git: panel shows "Not a Git repository".
- Dirty state: orange dot on Git button.
- Agent end: panel auto-refreshes.
- CWD switch: panel data updates.
