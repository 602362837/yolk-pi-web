# Implementation Plan: Git panel branch preview

## Ordered Checklist

1. Work on a branch/revision that contains the existing Git panel implementation.
2. Extend `/api/git/graph` with optional local-branch filtering.
3. Update `GitPanel` selection defaults and graph fetch dependency so selection previews the branch.
4. Pass selected preview branch into `CommitGraph` while keeping real branch status text unchanged.
5. Adjust copy/tooltips to distinguish preview vs actual switching where helpful.
6. Update documentation tables/descriptions if route/component behavior changes.
7. Validate with lint and TypeScript.

## Validation Commands

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Rollback Points

- `app/api/git/graph/route.ts` optional query support can be reverted independently.
- `components/GitPanel.tsx` UI state/fetch changes are localized to the Git panel.

## Review Gate

Implementation should preserve the explicit Switch button as the only mutating action. Branch selector changes must be read-only.
