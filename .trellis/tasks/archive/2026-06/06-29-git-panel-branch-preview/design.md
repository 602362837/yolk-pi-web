# Design: Git panel branch preview

## Scope

Modify the existing Git panel and graph API so selecting a local branch is a read-only preview action, while the explicit Switch button remains the only checkout mutation.

## Frontend Design

- `components/GitPanel.tsx` keeps `selectedBranch` as the branch selector value.
- Default/repair logic prefers `status.branch` when it exists in `graphData.branches`; otherwise it keeps a still-valid selection or falls back to the first branch.
- `fetchAll()` requests `/api/git/status` and `/api/git/graph` together.
- The graph request includes `branch=<selectedBranch>` when a selected branch is available, causing branch-selection changes to re-fetch the graph.
- `CommitGraph.currentBranch` receives the selected preview branch so layout/highlighting matches the preview perspective.
- Branch status text remains sourced from `status.branch` to represent the real checkout.
- A small helper label can clarify whether the commit graph is previewing the selected branch or the current branch.

## API Design

- Extend `app/api/git/graph/route.ts` with an optional `branch` query parameter.
- Validate `branch` against `refs/heads/<branch>` using `git show-ref --verify --quiet`.
- When valid, run `git log refs/heads/<branch> --decorate=full ...`.
- When omitted, preserve current behavior (`git log --all ...`).
- Return `{ data: null }` for invalid/non-Git cases to match the route's current best-effort failure mode.

## Data Flow

1. Git panel loads status and graph.
2. Branch selector is initialized to the real current branch when possible.
3. User selects a different local branch.
4. UI updates `selectedBranch`; `fetchAll()` reruns and asks graph API for that branch.
5. Commit graph renders the selected branch's history and highlight, with no checkout mutation.
6. If user clicks Switch, existing `/api/git/switch` performs guarded mutation and `fetchAll()` refreshes current status and graph.

## Compatibility / Safety

- No shell interpolation is added; existing `execFile` wrappers stay in use.
- Dirty-tree policy for switching is unchanged.
- Read-only preview uses local branch validation and does not mutate files.
- If graph preview fails, status still loads and switch controls remain based on available branch metadata.
