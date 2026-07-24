# handoff — PSI-02 complete (await parent mark done)

## Subtask

- **id:** PSI-02
- **title:** 实现定向查询与完整恢复
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Implemented `listSessionsForProjectSpace` with directed cwd candidates, fingerprint-aware validation, complete recovery (legacy seed + directed scan + header-only global discovery), keyed single-flight, and 10s hard budget. JSONL remains under `getAgentDir()/sessions/**`. Hot path does **not** call `scanSessionInventory` / `listAllSessions`. Route is **not** switched (PSI-05). Studio batch projection is not fully optimized (PSI-04); child nesting uses existing header pointers only.

## Files Changed

| Path | Change |
| --- | --- |
| `lib/project-space-session-list.ts` | **new** directed query + recovery API, counters, encode-cwd helpers, bounded header read, last-good + single-flight, `listSessionsForProjectSpace` |
| `scripts/test-project-space-session-index.mjs` | add `--group query` and `--group recovery` fixtures |

Note: `lib/project-space-session-lifecycle.ts` already exists from parallel PSI-03 work; this subtask did not own those mutation hooks.

## Validation

```bash
npm run test:project-space-session-index -- --group query
# 7 passed, 0 failed

npm run test:project-space-session-index -- --group recovery
# 8 passed, 0 failed

npm run test:project-space-session-index -- --group store
# 15 passed, 0 failed (regression)

npx eslint lib/project-space-session-list.ts --max-warnings=0
# clean

node_modules/.bin/tsc --noEmit
# EXIT 0
```

Acceptance covered:

- Hot complete index: `inventoryGlobalCalls=0`, no header-only discovery
- Fingerprint reuse: unchanged files → `metadataScans=0`; single changed file → `metadataScans=1`
- Directed discovery of same-cwd external files; legacy only with `includeLegacy`
- Missing/corrupt/partial → full recovery, no silent empty/partial success
- Header-only discovery finds cross-cwd explicit project/space links
- Concurrent recovery single-flight (`recoveryRuns` total 1)
- No last-good + timeout → `503 session_index_rebuilding`
- With last-good + timeout → revalidated last-good (`usedLastGood=true`)
- Rejected flight can be retried after clear

## Explicitly NOT done (later subtasks)

- PSI-03 lifecycle write-through completeness (partially present in tree from parallel work)
- PSI-04 Studio batch projection / task fingerprint cache
- PSI-05 route feature-flag switch + response snapshot TTL
- PSI-06 benchmarks
- PSI-07 docs

## Risks / notes for checker & main session

1. Encoded-cwd helper mirrors SDK `getDefaultSessionDirPath` locally (`--${resolved with /,: → -}--`). Drift risk if SDK encoding changes.
2. Header-only discovery enumerates all active JSONL names and reads first line only — not `scanSessionInventory` body streaming, but cold recovery still O(global files) by design.
3. Registry is dynamically imported only when `options.space` is omitted (strip-loader / focused tests inject space).
4. `studioChildDisplay` is not populated yet (PSI-04/05); API shape fields exist with `undefined` display.
5. Background 5min reconcile is fire-and-forget single-flight; no progress UI (by design).
6. Member cannot mark `task.json` done — **parent must** claim/update PSI-02 done with the evidence above.

## Decisions needed from main session

1. Mark PSI-02 done with validation evidence.
2. Continue PSI-03 (if not already complete in parallel) and/or PSI-04 after both G2 subtasks.
3. No product decisions blocked.
