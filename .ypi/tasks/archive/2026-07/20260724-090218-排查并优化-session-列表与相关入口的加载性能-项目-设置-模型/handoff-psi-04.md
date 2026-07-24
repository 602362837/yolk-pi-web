# handoff — PSI-04 complete (await parent mark done)

## Subtask

- **id:** PSI-04
- **title:** 实现筛选后的 Studio 批量投影
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Implemented filtered Studio child display batch projection for the project-space session list path.

- Parent-visible children are selected first (`toApiShape` root-id gate).
- Display is projected only for those children via `projectStudioChildDisplaysBatch` / `attachStudioChildDisplays`.
- Task detail is loaded once per unique `(cwdPathKey + taskId)` with task.json `mtimeMs:size` fingerprint cache (TTL 30s, LRU 256).
- Run/subtask-specific fields are derived per child so same-task different runs do not cross-contaminate.
- `listYpiStudioTasks(scope:all)` fallback is memoized per cwd (at most once per batch / TTL window).
- Display is **not** persisted into the space index; only allowlisted `studioChild` pointers remain.
- Task I/O failures degrade to header-only `{ subtaskId }` and never fail the session list.
- Existing `projectStudioChildDisplay` callers keep working via re-export; single-child path now also uses the shared task cache (TTL raised from 1s to 30s with fingerprint invalidation).

## Files Changed

| Path | Change |
| --- | --- |
| `lib/studio-child-display-projection.ts` | **new** batch + single projection, fingerprint cache, invalidate API, counters |
| `lib/session-reader.ts` | re-export `projectStudioChildDisplay`; invalidate display cache from `invalidateSessionListSnapshots` |
| `lib/project-space-session-list.ts` | after parent-visible filter, batch-attach displays; content-safe counters/diagnostics |
| `scripts/test-project-space-session-index.mjs` | implement `--group studio` (5 tests) |

## Validation

```bash
npm run test:project-space-session-index -- --group studio
# 5 passed, 0 failed

npm run test:project-space-session-index -- --group query
# 7 passed, 0 failed (regression)

npm run test:session-title
# session-title tests passed

npm run test:studio-child-sessions
# all passed

npx eslint lib/studio-child-display-projection.ts lib/session-reader.ts lib/project-space-session-list.ts --max-warnings=0
# clean

node_modules/.bin/tsc --noEmit
# EXIT 0
```

Acceptance covered:

- 100 children / 1 task → `studioProjectionCalls=1`, run A/B titles & summaries isolated
- space list projects only parent-visible children; orphan / missing-parent children excluded
- `studioProjectionCalls <= uniqueLinkedTasks`
- missing task → header-only display; list still succeeds
- index entry has pointer only (`studioChildDisplay` not persisted)
- different cwd + same taskId → separate cache keys / two loads

## Explicitly NOT done (later subtasks)

- PSI-05 route feature-flag switch + 5s response snapshot / 503 mapping
- PSI-06 300/180 benchmark + settings/models concurrency
- PSI-07 docs

## Risks / notes for checker & main session

1. `listAllSessions(... includeStudioChildDisplay)` still projects per child call-site, but each call now hits the shared task-detail cache, so same-task N+1 is already mitigated for residual global paths; space route switch remains PSI-05.
2. Single-child display TTL moved 1s → 30s with fingerprint; mutations that call `invalidateSessionListSnapshots` clear the new caches. External task.json edits rely on fingerprint, not TTL alone.
3. Archive task keys are not fingerprint-statted under `.ypi/tasks/<id>/task.json`; missing stat uses fingerprint `absent` and still loads via `getYpiStudioTaskDetail` (including archive key forms when provided).
4. Member cannot mark `task.json` done — **parent must** update PSI-04 status with the evidence above.

## Decisions needed from main session

1. Mark PSI-04 done with validation evidence.
2. Claim/select **PSI-05** (route integration) next.
3. No product decisions blocked.
