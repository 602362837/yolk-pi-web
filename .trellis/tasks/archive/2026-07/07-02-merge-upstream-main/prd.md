# Merge upstream main

## Goal

Bring the local `main` branch up to date with `upstream/main` while preserving local work, and summarize the user-visible upstream functionality before merging.

## Background / Confirmed Facts

- Current branch is `main` and the working tree was clean before task creation.
- Remotes:
  - `origin`: `git@github.com:602362837/pi-agnet-web.git`
  - `upstream`: `git@github.com:twofive1203/pi-agnet-web.git`
- `git fetch upstream main` advanced `upstream/main` from `55b12ef` to `b772460`.
- Upstream-only feature commits identified:
  - `04f9775 feat: add git commit details and diff viewer`
  - `ee76c2b feat: add side-by-side diff viewer`
  - `014162d feat: link side-by-side diff scrolling`
- Upstream also includes Trellis bookkeeping/template updates and release metadata changes.

## Upstream Feature Summary

1. Git commit details and diff viewer
   - Adds API routes for commit details and Git diff retrieval (`app/api/git/commit/route.ts`, `app/api/git/diff/route.ts`).
   - Adds a commit diff modal and expands `GitPanel` / `CommitGraph` interactions so users can inspect commits and file diffs from the Git UI.
   - Adds shared diff-related response types in `lib/types.ts` and updates module docs.

2. Side-by-side diff viewer
   - Adds reusable diff modal/view components, including `SideBySideDiffView.tsx`.
   - Refactors file and commit diff modals to use the shared side-by-side diff experience.
   - Provides clearer before/after file comparison in the web UI.

3. Linked horizontal scrolling for side-by-side diffs
   - Keeps the left and right panes horizontally synchronized for easier comparison of long lines.
   - Adds a synchronization guard to avoid scroll feedback loops.

## Requirements

- Merge `upstream/main` into local `main` without pushing to any remote.
- Preserve local-only work unless an explicit conflict resolution requires choosing the upstream version for a specific file.
- Resolve merge conflicts, if any, in a way that keeps both local Trellis integration/design-subagent work and upstream Git diff viewer functionality where compatible.
- Keep generated/runtime or task bookkeeping changes coherent after the merge.
- Summarize the merged upstream functionality and any notable conflict resolutions for the user.

## Acceptance Criteria

- [x] `git merge upstream/main` or equivalent integration is completed on local `main`.
- [x] No unresolved conflict markers remain.
- [x] `git status` is clean or only contains the expected Trellis task/session bookkeeping from this task.
- [x] The final summary lists the upstream features brought in and any important conflict-resolution decisions.
- [x] At least `npm run lint` and `node_modules/.bin/tsc --noEmit` are attempted after the merge, unless blocked by pre-existing dependency/environment issues.

## Completion Notes

- Merge commit created: `e722983 Merge remote-tracking branch 'upstream/main'`.
- Conflict resolved in `components/GitPanel.tsx` by keeping both local `SelectDropdown` branch preview/switch UI and upstream `GitCommitDiffModal` commit diff viewer wiring.
- Validation passed: `npm run lint`, `node_modules/.bin/tsc --noEmit`, and Trellis check subagent review.
- No code-spec update was needed; the task did not introduce a new local implementation convention beyond integrating upstream behavior.

## Out of Scope

- Pushing to `origin` or `upstream`.
- Reworking the upstream features beyond conflict resolution and basic integration fixes.
- Release publishing or production deployment.
