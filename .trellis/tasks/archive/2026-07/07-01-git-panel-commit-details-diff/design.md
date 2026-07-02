# Design — Git panel commit details and diff viewer

## Summary

Extend the existing Git top-bar dropdown into a read-only commit inspection panel. The current branch preview/switch, graph, local changes, and stash summaries remain in place. A selected graph commit drives a commit-detail pane; changed files in that pane can be double-clicked to open a large modal diff viewer.

The core invariant is: **this feature is read-only except for the already-existing explicit branch switch action**.

## Architecture

```text
GitPanel
  ├─ GET /api/git/status?cwd=...
  ├─ GET /api/git/graph?cwd=...&branch=...
  ├─ CommitGraph(selectedHash, onSelectCommit)
  ├─ GET /api/git/commit?cwd=...&hash=...
  │   └─ commit metadata + first-parent/root changed-file list
  └─ GitCommitDiffModal
      └─ GET /api/git/diff?cwd=...&hash=...&path=...&oldPath=...
          └─ UnifiedDiffView or fallback message
```

## API Boundaries

Add two read-only Git APIs under `app/api/git/`.

### `GET /api/git/commit`

Query:

- `cwd`: workspace directory.
- `hash`: selected commit hash from graph/status data.

Behavior:

- Validate `cwd` is a Git repository with `git rev-parse --show-toplevel`.
- Validate `hash` resolves to a commit with `git rev-parse --verify <hash>^{commit}`.
- Read commit metadata with argv-array `execFile("git", args)`.
- Read changed files relative to the selected commit's first parent; root commits use `--root`.
- Return `detail: null` for non-Git directories only when matching existing Git panel non-repo behavior makes sense; otherwise use JSON errors for invalid input.

Response type to add to `lib/types.ts`:

```ts
export type GitCommitFileStatus = "M" | "A" | "D" | "R" | "C" | "T" | "U" | "?";

export interface GitCommitChangedFile {
  status: GitCommitFileStatus;
  file: string;
  oldFile?: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface GitCommitDetail {
  hash: string;
  shortHash: string;
  parents: string[];
  author: { name: string; email: string; date: string; relativeDate: string };
  committer: { name: string; email: string; date: string };
  subject: string;
  body: string;
  refs: GitCommitRef[];
  files: GitCommitChangedFile[];
}
```

### `GET /api/git/diff`

Query:

- `cwd`: workspace directory.
- `hash`: selected commit hash.
- `path`: current/new path to diff.
- `oldPath` optional: old path for rename/copy display or pathspec fallback.

Behavior:

- Validate `cwd` and `hash` as above.
- Produce a patch for root commits or first-parent comparison:
  - root: selected commit against the empty tree/root patch;
  - non-root: first parent → selected commit.
- Use `--no-ext-diff`, `--no-color`, `--find-renames`, `--find-copies`, and a `--` pathspec separator.
- Enforce a bounded `maxBuffer`; too-large output returns a structured fallback, not a thrown panel failure.
- Binary/unavailable diffs return `diffAvailable: false` with a reason.

Response type to add to `lib/types.ts`:

```ts
export type GitCommitDiffReason = "binary" | "too-large" | "unavailable";

export interface GitCommitFileDiffResponse {
  hash: string;
  file: string;
  oldFile?: string;
  diffAvailable: boolean;
  diff?: string;
  reason?: GitCommitDiffReason;
}
```

## Git Command and Parsing Strategy

- All Git execution uses `execFile` argv arrays. No shell command strings.
- Commit identity is normalized by `rev-parse --verify <hash>^{commit}` before other reads.
- Metadata uses a NUL-delimited pretty format because commit messages can contain newlines but not NUL bytes.
- Changed files are read from Git diff-tree/show output with rename/copy detection enabled.
- Additions/deletions are best-effort. Text files should normally get counts from `--numstat`; binary files may report `binary: true` and omit counts.
- Merge commits are compared to their first parent for MVP. If a merge commit has no first-parent content changes, the UI shows a clear empty state.

## Frontend Design

### Commit graph selection

`components/CommitGraph.tsx` gains optional props:

```ts
selectedHash?: string | null;
onSelectCommit?: (commit: GitGraphCommit) => void;
```

Rows become clickable/selectable, with selected-row styling distinct from hover styling. The row still renders graph lines, refs, subject, and date as today.

`components/GitPanel.tsx` owns:

- `selectedCommitHash`
- `commitDetail`
- `commitDetailLoading/error`
- `diffFile` modal state

When graph data changes because the preview branch or refresh changes, `GitPanel` should keep the selection if the commit still exists; otherwise select the first visible commit when available or clear selection.

### Commit details area

Render under the graph and before staged/unstaged summaries:

- subject/message
- short/full hash
- author and commit dates
- refs/branches/tags when available
- parent short hashes
- changed file list with status, old → new path for rename/copy, and `+N -M` counts when available
- empty state for no changed files

Double-clicking a changed file opens the modal diff. A single click may highlight the file locally but must not navigate or mutate Git state.

### Diff modal

Add `components/GitCommitDiffModal.tsx` or keep a private GitPanel subcomponent if the implementation remains small. The modal should be large/full-screen enough for wide diffs:

- fixed overlay above the app (`position: fixed; inset: ...; z-index` greater than top dropdown)
- close button and Escape key support
- header with commit short hash and path (`old → new` for renames/copies)
- loading, error, no-diff/binary/too-large fallback states
- `UnifiedDiffView` for available unified diffs

## Compatibility

- Existing branch preview/select behavior stays non-mutating.
- Existing explicit Switch button and dirty-worktree guard remain unchanged.
- Existing staged/unstaged/untracked/stash sections remain visible below commit details.
- Non-Git workspaces keep the existing “Not a Git repository” state.
- No external dependency is required for Git diffs because Git itself returns unified patches.

## Documentation Updates

- `docs/modules/api.md`: add `git/commit` and `git/diff` routes.
- `docs/modules/frontend.md`: update `GitPanel`, `CommitGraph`, and add the diff modal component if new.
- `docs/modules/library.md`: update `lib/types.ts` Git wire types if useful.
- `AGENTS.md`: update only if the top-level Git module entry point wording changes materially.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Large patches freeze browser or overflow API buffers | Bound `execFile` buffer and return `too-large` fallback. |
| Binary file diffs are unreadable | Detect binary patch messages / empty text patch and show `binary` fallback. |
| Rename/copy path parsing is fragile | Keep both old and new paths in detail response; diff by new path plus optional old path fallback. |
| Merge commit semantics surprise users | Document/use first-parent comparison for MVP and show empty state if no files. |
| Dropdown becomes too tall | Keep max-height scrolling and use modal for actual diff content. |
