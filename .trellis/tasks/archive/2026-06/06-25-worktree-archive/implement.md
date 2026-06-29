# WorkTree archive/delete — Implementation Plan

## Phase 1: Safe delete MVP

1. Extend Git service (`lib/git-worktree.ts`)
   - Add status inspection for linked worktrees.
   - Add deletion helper around `git worktree remove`.
   - Protect main worktree from deletion.

2. Add session lifecycle helper (`lib/rpc-manager.ts`)
   - Add `destroyRpcSessionsForCwd(cwd)`.
   - Ensure running sessions are destroyed before filesystem removal.

3. Add API route
   - Prefer extending `app/api/git/worktrees/route.ts` with `DELETE` or create `app/api/git/worktrees/delete/route.ts` if route shape is clearer.
   - Return `409` with dirty status when force is required.

4. Update sidebar UI (`components/SessionSidebar.tsx`)
   - Add right-click menu for WorkTree rows in the CWD picker.
   - Add delete confirmation modal/inline panel.
   - On success: remove ephemeral WorkTree entry, select fallback cwd, refresh sessions and explorer.

5. Docs
   - Update `docs/modules/api.md`, `docs/modules/frontend.md`, and `docs/modules/library.md`.

6. Validation
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`
   - Manual: delete clean WorkTree.
   - Manual: dirty WorkTree returns warning, then force delete works.
   - Manual: active session in WorkTree is destroyed and UI remains stable.

## Phase 2: Archive MVP

1. Add archive Git helpers
   - Preflight status/merge-base.
   - Squash commit helper.
   - Push helper.
   - Merge-in-main helper.
   - Remove WorkTree after successful merge.

2. Add archive API
   - `POST /api/git/worktrees/archive` with `{ cwd, confirmedRisk: true }`.
   - Do not run or verify `/trellis-finish-work`; the user runs finish tooling manually before confirmation.
   - Destroy active WorkTree sessions immediately before final WorkTree removal.

3. Add archive UI
   - Archive modal from context menu.
   - Warn about unsaved/unfinished work and manual finish tooling.
   - Loading/error state for the synchronous archive operation.

4. Cleanup after success
   - Remove WorkTree from ephemeral state.
   - Select fallback/main cwd if the removed WorkTree was selected.
   - Refresh session list and file explorer.

## Risky Files / Rollback Points

- `components/SessionSidebar.tsx`: large inline component; keep context menu/modal helpers local and small.
- `lib/git-worktree.ts`: destructive Git commands; unit-like manual checks are essential.
- `lib/rpc-manager.ts`: session registry invariant; do not break one-wrapper-per-session behavior.
- Archive job routes: avoid persistent state assumptions; jobs disappear on server restart.

## Open Implementation Risks

- `/trellis-finish-work` is a prompt/skill workflow, not a deterministic Git command.
- Merge conflicts cannot be safely auto-resolved.
- Squashing rewrites WorkTree branch history; shared branches need explicit warning/opt-in.
- Removing a cwd while the user has a file tab open should degrade gracefully.
