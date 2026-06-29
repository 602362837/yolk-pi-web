# WorkTree archive/delete — Design

## Architecture Overview

The feature should be split into a UI action surface, a Git WorkTree lifecycle service, a server-side job runner for long operations, and explicit session cleanup.

```text
SessionSidebar CWD picker row context menu
  ├─ Delete WorkTree…
  │   └─ DELETE /api/git/worktrees?cwd=...
  │       ├─ lib/git-worktree.ts status + remove
  │       ├─ lib/rpc-manager.ts destroy sessions by cwd
  │       └─ returns next recommended cwd
  └─ Archive WorkTree…
      └─ POST /api/git/worktrees/archive
          └─ creates archive job
              ├─ preflight git status
              ├─ finish-work prompt/manual checkpoint
              ├─ squash/commit/push
              ├─ merge into main/original branch
              ├─ destroy active sessions for cwd
              └─ git worktree remove
```

## Key Design Decision

MVP archive is a single confirmed Git operation, but finish-work tooling is deliberately manual. The UI warns the user to finish/save work and run any desired `/trellis-finish-work` flow before pressing Archive; it does not verify that the command completed.

MVP stages:

1. Risk confirmation: warn about unsaved/unfinished work and manual finish tooling.
2. Preflight: inspect WorkTree status, current branch, main worktree path/branch, dirty files, and merge base.
3. Squash/prepare: create one squashed commit from the WorkTree branch relative to merge base.
4. Push: push the archive branch.
5. Merge: merge into the original/main branch from the main worktree.
6. Cleanup: destroy active sessions for the WorkTree cwd, remove WorkTree, refresh UI and select the main worktree if needed.

## API Contracts

### Status

```text
GET /api/git/worktrees/status?cwd=<abs path>
```

Response:

```ts
{
  worktree: WorktreeInfo;
  cwd: string;
  branch?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
  dirty: boolean;
  dirtySummary: string[];
  ahead?: number;
  behind?: number;
  hasUnpushedCommits?: boolean;
  mergeBase?: string;
}
```

### Delete

```text
DELETE /api/git/worktrees?cwd=<abs path>&force=false
```

Behavior:

- validate cwd is a Git linked worktree, not the main worktree;
- compute status;
- if dirty and `force=false`, return `409` with status summary;
- destroy active RPC sessions for sessions whose cwd resolves to this WorkTree;
- run `git -C <mainWorktreePath|cwd> worktree remove [--force] <cwd>`;
- return a fallback cwd, usually `mainWorktreePath`.

### Archive

```text
POST /api/git/worktrees/archive
{ cwd: string, confirmedRisk: true }
```

Response:

```ts
{
  success: true;
  cwd: string;
  fallbackCwd?: string;
  destroyedSessionIds: string[];
  branchName: string;
  pushed: boolean;
  merged: boolean;
  squashed: boolean;
}
```

## Git Operations

Keep all Git calls in `lib/git-worktree.ts` using `execFile`, never shell concatenation.

Add helpers:

- `getWorktreeStatus(cwd)`
- `removeGitWorktree({ cwd, force })`
- `getMergeBase({ cwd, baseRef })`
- `createSquashCommit({ cwd, baseRef, message })`
- `pushBranch({ cwd, branch, remote })`
- `mergeBranchInMainWorktree({ mainWorktreePath, branch, mode })`

Preferred squash strategy:

```text
git -C <cwd> merge-base HEAD <baseRef>
git -C <cwd> reset --soft <mergeBase>
git -C <cwd> commit -m <message>
```

This rewrites the WorkTree branch history, so archive must warn before doing it and should not run if the branch has unpushed/shared commits unless the user opts in.

## Session Safety

Deleting the WorkTree only invalidates the filesystem cwd; session JSONL files can remain.

Required server helper:

```ts
destroyRpcSessionsForCwd(cwd: string): string[]
```

Implementation options:

- extend `AgentSessionWrapper` or registry metadata to expose `inner.cwd`/session manager header cwd;
- or resolve active session ids to session files and read headers.

Before `git worktree remove`:

1. abort running agents if needed;
2. call `destroy()` on matching wrappers;
3. remove registry entries via existing `onDestroy` cleanup;
4. clear selected cwd client-side after success.

Historical sessions with deleted cwd should still list. Git metadata lookup already fails closed in `session-reader`; the UI should avoid opening FileExplorer for missing cwd and offer a clear “workspace no longer exists” message if selected.

## UI Design

- Add `onContextMenu` to WorkTree CWD picker rows.
- Context menu contents:
  - `Archive WorkTree…`
  - `Delete WorkTree…`
- Delete modal:
  - path, branch, main worktree;
  - dirty/unmerged warning;
  - require force checkbox only if status is dirty.
- Archive modal:
  - path, branch, main worktree;
  - risk warning that finish tooling is manual;
  - single Archive confirmation button with loading/error state.

## Trade-offs

- Fully automatic archive is convenient but risky because finish-work may require agent judgement, commits, and conflict handling.
- Guided archive is more UI/API work than a single button, but makes destructive Git operations recoverable and debuggable.
- Keeping historical sessions avoids data loss; hiding/removing them would be surprising and requires session-file migration.
