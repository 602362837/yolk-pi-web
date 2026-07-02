# Implementation Plan: Git diff side-by-side viewer

## Pre-development Context Read

- Task artifacts: `prd.md`, `design.md`, `implement.md`.
- Project docs: `docs/modules/frontend.md`, `docs/modules/api.md`, `docs/modules/library.md`.
- Trellis specs:
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/frontend/component-guidelines.md`
  - `.trellis/spec/frontend/directory-structure.md`
  - `.trellis/spec/frontend/hook-guidelines.md`
  - `.trellis/spec/frontend/state-management.md`
  - `.trellis/spec/frontend/type-safety.md`
  - `.trellis/spec/frontend/quality-guidelines.md`
  - `.trellis/spec/index.md` because `.trellis/spec/guides/index.md` is absent.

## Ordered Checklist

1. Build unified diff parsing/rendering support.
   - Add a side-by-side renderer component or helper local to the shared diff view.
   - Parse hunk old/new start lines from `@@ -a,b +c,d @@`.
   - Convert diff hunks into aligned rows with old/new line numbers and line content.
   - Pair adjacent deletion/addition runs to represent modifications.
   - Preserve metadata and hunk rows.

2. Add shared modal/view component.
   - Extract duplicated modal shell behavior from `GitCommitDiffModal.tsx` and `FileDiffModal.tsx`.
   - Provide mode switch buttons: `并排模式 / Side-by-side` and `统一模式 / Unified`.
   - Default mode to side-by-side.
   - Keep Escape close and overlay click close behavior.

3. Refactor Git commit diff adapter.
   - Keep existing fetch logic and git-specific labels.
   - Render the shared modal with commit hash/path/status/addition/deletion metadata.
   - Preserve binary/too-large/unavailable messages.

4. Refactor session file diff adapter.
   - Keep existing fetch logic and session-specific labels.
   - Render the shared modal with path/status/tool/addition/deletion metadata.
   - Preserve metadata-only/outside-workspace/unreadable/unchanged messages.

5. Update docs.
   - Update `docs/modules/frontend.md` to describe added/changed shared diff components.

6. Validate.
   - Run `npm run lint`.
   - Run `node_modules/.bin/tsc --noEmit`.
   - Manual reasoning checks for added/deleted/modified/renamed diff examples.

## Risky Files / Rollback Points

- `components/GitCommitDiffModal.tsx`: source-specific fetch behavior must remain unchanged.
- `components/FileDiffModal.tsx`: overlay positioning currently differs from Git modal; shared shell must allow source-specific sizing/positioning.
- `components/UnifiedDiffView.tsx`: avoid breaking current unified rendering.
- New parser logic: must tolerate metadata lines and malformed/truncated diff text without throwing.

## Validation Matrix

| Scenario | Expected result |
| --- | --- |
| Git modified file | Opens in side-by-side mode, old/new line numbers align, unified toggle works. |
| Git added file | Old side blank for added rows, new side shows additions. |
| Git deleted file | Old side shows deletions, new side blank. |
| Git renamed file with hunks | Header metadata renders and hunks compare old/new content. |
| Session modified file | Opens in side-by-side mode with session metadata and tool names. |
| Binary/too-large/unavailable | No broken viewer; readable fallback text. |
| Escape / overlay click | Modal closes for both entry points. |

## Validation Results

- `npm run lint` passed.
- `node_modules/.bin/tsc --noEmit` passed.
- Parser behavior reviewed against modified, added, deleted, and rename-with-hunk unified diff shapes.

## Start Gate

Completed before implementation: user approved the plan and `python ./.trellis/scripts/task.py start 07-01-git-diff-side-by-side-viewer` was run.
