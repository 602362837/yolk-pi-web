# WorkTree delete/archive actions

## Goal

Design a WorkTree lifecycle feature in the sidebar so users can right-click a WorkTree workspace and either delete it locally or archive/finish it back into the original branch.

## User Value

- Delete removes throwaway WorkTrees with an explicit warning about losing unmerged work.
- Archive provides a guided finish path: run the project finish-work workflow, compact/squash the WorkTree commits, commit and push, merge into the original branch, then remove the local WorkTree.
- Session handling is safe when the WorkTree directory disappears.

## Confirmed Facts

- WorkTree creation already exists through `POST /api/git/worktrees` and `lib/git-worktree.ts`.
- Sidebar currently shows WorkTree rows in the CWD picker and WorkTree badges on session rows.
- Session browsing is file-based under `~/.pi/agent/sessions`; deleting a WorkTree does not automatically delete session JSONL files.
- Active agent sessions live in `globalThis.__piSessions` via `lib/rpc-manager.ts`; they must be destroyed before deleting their cwd.
- Existing `/trellis-finish-work` prompt says code commits are **not** done inside that command; it archives Trellis tasks and records the session journal after work commits already exist.
- There is no current API for WorkTree delete/archive; `app/api/git/worktrees/route.ts` only creates WorkTrees.

## Requirements

- Add a WorkTree row context menu or equivalent right-click action surface in the workspace picker.
- Offer `Delete WorkTree…` and `Archive WorkTree…` only for rows identified by `WorktreeInfo`.
- Delete flow must warn that unmerged commits/uncommitted changes can be lost and must require confirmation.
- Delete flow must remove the local Git worktree safely and refresh the sidebar/workspace state.
- Archive flow must protect against data loss and should not delete the WorkTree until finish, squash/commit/push/merge all succeed.
- The design must account for active sessions whose cwd is the WorkTree being removed.
- The feature should update docs/module maps when implemented.

## Proposed MVP Scope

- Implement a backend WorkTree status/delete API first.
- Implement archive as a staged backend job with explicit steps and progress, but start with a conservative manual-confirmation boundary before destructive operations if full automation is too risky.
- Keep session JSONL history; mark/degrade deleted WorkTree sessions as historical sessions with missing cwd rather than deleting them.

## Acceptance Criteria

- Right-clicking a WorkTree workspace exposes Delete and Archive actions.
- Delete confirmation shows branch/path and warns about unmerged work.
- Delete refuses or blocks when the WorkTree has uncommitted changes unless the user explicitly confirms force deletion.
- Active `AgentSessionWrapper`s for the removed cwd are destroyed before `git worktree remove` runs.
- After deletion, selected cwd moves to the main worktree or another valid cwd, file explorer refreshes, and session list remains usable.
- Archive does not remove the WorkTree unless all selected finish steps succeed.
- Archive progress/errors are visible to the user and recoverable.

## Out of Scope

- Renaming package/bin or changing WorkTree creation defaults.
- Deleting historical session JSONL files for the WorkTree.
- Solving remote merge conflicts automatically in the first implementation.

## Decisions

- Archive will run the Git finish path after a single risk confirmation: squash the WorkTree branch, push it, merge into the main worktree branch, then remove the local WorkTree.
- The user runs `/trellis-finish-work` or any other finish tooling manually before pressing Archive; the UI does not wait for or verify that command.
- If the deleted/archived WorkTree is the selected workspace, the sidebar switches back to the main worktree path returned by the backend.
