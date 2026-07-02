# Git panel commit details and diff viewer

## Goal

Improve the existing Git top-bar panel so users can inspect commit history like an IDE: selecting a commit shows its changed files and commit metadata, and opening a changed file shows a read-only diff for that file.

## Confirmed Facts

- The project is a single Next.js app with `components/`, `app/api/`, and `lib/` boundaries.
- `components/GitPanel.tsx` currently renders branch status, a local-branch preview/switch control, a commit graph via `components/CommitGraph.tsx`, staged/unstaged/untracked files, and stash count.
- `app/api/git/status/route.ts` returns current branch/worktree status and recent commits.
- `app/api/git/graph/route.ts` returns graph commits and local branch metadata for an optional validated local branch.
- Shared Git UI types live in `lib/types.ts`.
- A reusable unified diff renderer already exists: `components/UnifiedDiffView.tsx`; session-change diffs use modal-style rendering in `components/FileDiffModal.tsx`.

## Requirements

- Selecting a commit in the commit graph/list must load and display a commit-detail area.
- The commit-detail area must include useful metadata such as short/full hash, author, dates, subject/message, refs/branches when available, and parent hashes when available.
- The commit-detail area must list files changed by the selected commit with status and additions/deletions when Git can provide them.
- The file list must handle modified, added, deleted, renamed, copied, and binary/metadata-only files without crashing.
- Double-clicking a changed file must open a read-only diff panel for that file in the selected commit.
- Diff loading must be bounded and browser-safe; large/binary/unavailable diffs should show an explanatory fallback instead of failing the whole panel.
- Existing branch preview/switch behavior must continue to work, including explicit Switch action and dirty-worktree protection.
- Existing staged/unstaged/untracked/stash summaries must remain available.
- API routes must use argv-array Git execution (`execFile`) and must not interpolate user input into shell commands.

## Acceptance Criteria

- [ ] Clicking a commit row highlights/selects it and displays changed files plus commit metadata.
- [ ] Commit details update when switching the preview branch or refreshing the panel.
- [ ] A selected commit with no changed files or an initial/root commit renders a clear empty state or correct file list.
- [ ] Double-clicking a changed file opens a diff view for that commit/file.
- [ ] Modified files show a unified diff; added/deleted files show appropriate full-file diff; binary/too-large diffs show a clear message.
- [ ] Rename/copy paths display old → new path and diff the correct file path.
- [ ] Non-Git directories still show the existing “Not a Git repository” state.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope

- Editing, staging, committing, reverting, cherry-picking, checkout/reset, or other Git mutations.
- Side-by-side IDE-quality syntax-highlighted diff editing.
- Remote branch switching or fetching from remotes.

## Decisions

- Diff opens as a full-screen / large modal overlay after double-clicking a changed file. This gives wide diffs enough space and avoids overcomplicating the existing top-bar dropdown layout.
