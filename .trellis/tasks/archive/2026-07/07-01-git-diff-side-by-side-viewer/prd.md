# Git diff side-by-side viewer

## Goal

Improve file diff viewing so Git commit changed-file diffs and chat-session Files Changed diffs share reusable UI and support both unified and side-by-side comparison modes.

## User Value

- Users can inspect before/after file content more accurately in a side-by-side layout similar to IntelliJ IDEA.
- Both existing diff entry points behave consistently:
  - Git panel → selected commit → changed files → double-click a file.
  - Chat dialog/session Files Changed floating panel → click a changed file.

## Confirmed Facts

- The two entry points do **not** currently use the same modal component:
  - Git commit diffs use `components/GitCommitDiffModal.tsx`.
  - Session Files Changed diffs use `components/FileDiffModal.tsx`.
- Both modals currently share only the renderer `components/UnifiedDiffView.tsx`.
- Both backing APIs currently return unified diff text:
  - `GET /api/git/diff` returns `GitCommitFileDiffResponse.diff`.
  - `GET /api/sessions/[id]/changes/file` returns `SessionFileDiffResponse.diff`.
- Existing fallback states differ by source but are conceptually similar: loading, error, binary/too-large/unavailable/metadata-only messages.
- The relevant specs are the frontend layer. `.trellis/spec/guides/index.md` is absent in this repo; shared guidance was read from `.trellis/spec/index.md` instead.

## Requirements

- Refactor duplicate modal shell behavior into a reusable diff modal/view component while preserving source-specific metadata and reason labels.
- Keep the current unified diff mode available and label it as Unified/统一模式.
- Add a side-by-side mode that renders original content on the left and changed content on the right from the unified diff payload.
- Default newly opened diff modals to Side-by-side/并排模式.
- Side-by-side mode should show line numbers for old and new sides, align changed hunks, and visually distinguish additions/deletions/context using existing theme variables.
- Preserve existing loading, error, close-on-Escape, click-overlay-to-close, binary, too-large, and unavailable fallback behavior.
- Preserve existing API contracts unless implementation evidence shows the unified diff payload is insufficient.
- Update project docs/module map if adding or materially changing shared components.

## Acceptance Criteria

- [x] Git commit file diff modal offers Unified and Side-by-side modes and opens in Side-by-side by default.
- [x] Session Files Changed file diff modal offers the same Unified and Side-by-side modes and opens in Side-by-side by default.
- [x] The two modal entry points reuse a common component for modal shell and diff-mode rendering instead of duplicating the whole modal structure.
- [x] Unified mode remains equivalent to the current display, aside from the new mode switch controls.
- [x] Side-by-side mode reconstructs old/new columns correctly for additions, deletions, modifications, added files, deleted files, and renamed files when the unified diff includes those hunks.
- [x] Binary/too-large/unavailable/metadata-only diffs still show readable fallback text instead of a broken viewer.
- [x] Lint and type-check pass: `npm run lint` and `node_modules/.bin/tsc --noEmit`.

## Out of Scope

- Editing, accepting, reverting, or staging changes from the diff viewer.
- Git working-tree staged/unstaged diff opening beyond the already requested commit and session changed-file entry points.
- Pixel-perfect clone of IntelliJ IDEA diff UI.

## Decisions

- Default mode: Side-by-side/并排模式.

## Open Questions

- None currently blocking planning.
