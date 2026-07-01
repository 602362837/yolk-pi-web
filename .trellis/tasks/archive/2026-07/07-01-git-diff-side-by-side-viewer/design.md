# Design: Git diff side-by-side viewer

## Architecture

Introduce reusable diff UI components under `components/`:

- `DiffModalShell.tsx` or equivalent shared modal component:
  - owns modal chrome, title/subtitle metadata slot, close button, Escape handling, overlay click close, scroll container, and mode switch controls;
  - accepts source-specific metadata as React nodes/props;
  - accepts loading/error/fallback/content state from the caller.
- `DiffView.tsx` or equivalent renderer:
  - accepts unified diff text plus selected mode;
  - renders existing unified mode through `UnifiedDiffView`;
  - renders new side-by-side mode through parsed unified diff rows.
- `SideBySideDiffView.tsx` or equivalent private renderer/parser helpers:
  - parses unified diff headers and hunks;
  - reconstructs aligned old/new rows from `-`, `+`, and context lines;
  - shows old and new line numbers separately;
  - treats file headers (`---`, `+++`) and hunk headers (`@@`) as section rows;
  - uses existing theme variables and current add/delete colors.

Existing source-specific components remain as data-fetching adapters:

- `GitCommitDiffModal.tsx` fetches `GET /api/git/diff`, formats commit/file metadata and git-specific reason labels, then renders the shared modal.
- `FileDiffModal.tsx` fetches `GET /api/sessions/[id]/changes/file`, formats session-change metadata and session-specific reason labels, then renders the shared modal.

## Data Flow

```text
GitPanel changed file double-click
  -> GitCommitDiffModal adapter
  -> /api/git/diff unified diff response
  -> shared diff modal + renderer

SessionChangesFloatingPanel changed file click
  -> FileDiffModal adapter
  -> /api/sessions/[id]/changes/file unified diff response
  -> shared diff modal + renderer
```

## Contracts

- Keep API response contracts unchanged for this MVP. Both existing APIs already return unified diff text.
- Side-by-side mode is reconstructed from available unified diff hunks, so it shows changed regions plus diff context, not necessarily the full file when the diff payload omits unchanged regions.
- Default selected mode is `side-by-side` for every newly mounted modal.
- Unified mode keeps the existing `UnifiedDiffView` display aside from the new mode switch.
- Loading, error, and no-diff fallback states remain readable and source-specific.

## Parser Notes

Supported unified diff input:

- Git diffs with `diff --git`, `index`, `rename from`, `rename to`, `---`, `+++`, and `@@` lines.
- `diff` package patches produced by `createTwoFilesPatch()` for session file changes.
- Added files (`@@ -0,0 +...`) should show blank old-side cells and added new-side rows.
- Deleted files should show removed old-side rows and blank new-side cells.
- Modifications represented as adjacent delete/add blocks should align old and new lines pairwise where possible, with extra rows padded on the shorter side.
- Truncation marker lines or unexpected lines should render as neutral metadata rows rather than crashing.

## Styling

- Use inline styles with existing CSS variables: `--bg`, `--bg-panel`, `--bg-subtle`, `--bg-hover`, `--border`, `--text`, `--text-muted`, `--text-dim`, `--accent`, `--font-mono`.
- Additions: green text/background consistent with current unified renderer.
- Deletions: red text/background consistent with current unified renderer.
- Context: normal text/background.
- Hunk/file metadata rows: muted/accent styling.
- Side-by-side columns should scroll together in one container for alignment.

## Documentation

Update `docs/modules/frontend.md` when adding the shared diff modal/view components or materially changing the existing component map.
