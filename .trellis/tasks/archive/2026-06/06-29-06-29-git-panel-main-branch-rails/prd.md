# Fix git panel main branch rail duplication

## Goal

When the current Git branch is `main`, the Git panel should not render separate current-branch and main-branch rails/columns. It should show only the emphasized main branch rail.

## Requirements

- Preserve the existing branch ordering strategy for non-`main` branches: current branch first/leftmost, then `main`.
- When the current branch is `main`, treat current branch and main as the same visual lane instead of duplicating lanes.
- Keep existing commit ordering and styling behavior otherwise unchanged.
- Scope the change to the Git panel visualization logic/UI.

## Acceptance Criteria

- [x] On a non-`main` branch, the Git panel still shows the current branch lane to the left of the `main` lane.
- [x] On the `main` branch, the Git panel shows a single emphasized `main` lane and does not reserve/render an extra left lane for the current branch.
- [x] Lint and TypeScript checks pass, or any skipped validation is explained.
