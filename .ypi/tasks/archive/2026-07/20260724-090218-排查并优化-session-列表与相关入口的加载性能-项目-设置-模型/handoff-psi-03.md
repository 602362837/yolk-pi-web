# handoff — PSI-03 complete (await parent mark done)

## Subtask

- **id:** PSI-03
- **title:** 接入 session 生命周期维护
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Wired create/bootstrap, fork, Studio child create/status, rename, archive, unarchive, delete, cascade reparent, delete-by-cwd/WorkTree cleanup, and project/space relink into the space-local session index. JSONL remains the truth; index writes are best-effort and never roll back session files. Legacy global sidecar writes are stopped (no-op).

## Files Changed

| Path | Change |
| --- | --- |
| `lib/project-space-session-lifecycle.ts` | **new** lifecycle helpers: build/upsert/remove/relink/refresh/unarchive/batch; cache invalidation slot for PSI-05 |
| `lib/project-session-index.ts` | legacy `upsertProjectSessionIndexEntry` is now a no-op; read migration adapter retained |
| `lib/session-project-link.ts` | dynamic-import `canonicalizeProjectPath` so strip-loader tests can use header helpers |
| `lib/agent-session-bootstrap.ts` | create/bootstrap write-through to space-local index |
| `lib/rpc-manager.ts` | fork write-through; `message_end` / `agent_end` invalidate list snapshots |
| `lib/ypi-studio-child-session-runner.ts` | Studio child header create + status patch refresh space-local entry |
| `lib/session-reader.ts` | delete-by-cwd/WorkTree cleanup removes index entries; archive/unarchive cascade reparent refreshes siblings |
| `app/api/sessions/[id]/route.ts` | rename refresh; delete remove + reparented sibling refresh |
| `app/api/sessions/archive/route.ts` | remove from active space index after archive |
| `app/api/sessions/archive-all/route.ts` | same for bulk archive |
| `app/api/sessions/unarchive/route.ts` | upsert after restore from header link |
| `scripts/test-project-space-session-index.mjs` | **lifecycle** group tests |

## Validation

```bash
npm run test:project-space-session-index -- --group lifecycle
# 9 passed, 0 failed

npm run test:project-space-session-index -- --group store
# 15 passed, 0 failed

npm run test:studio-child-sessions
# all passed

npx eslint lib/project-space-session-lifecycle.ts lib/project-session-index.ts \
  lib/session-project-link.ts lib/agent-session-bootstrap.ts lib/rpc-manager.ts \
  lib/session-reader.ts lib/ypi-studio-child-session-runner.ts \
  app/api/sessions/[id]/route.ts app/api/sessions/archive/route.ts \
  app/api/sessions/unarchive/route.ts app/api/sessions/archive-all/route.ts \
  --max-warnings=0
# clean

node_modules/.bin/tsc --noEmit
# EXIT 0
```

### Mutation audit

| Mutation | Hook |
| --- | --- |
| create/bootstrap | `upsertProjectSpaceSessionFromFile` |
| fork | same + parent id/file |
| Studio child create | upsert after header write |
| Studio child status | `refreshProjectSpaceSessionIndexEntry` |
| rename | refresh after `appendSessionInfo` |
| archive / archive-all | header capture → `removeProjectSpaceSessionByHeader` |
| unarchive | `upsertProjectSpaceSessionAfterUnarchive` |
| delete | remove + reparent sibling refresh |
| cascade parent rewrite (archive/unarchive/delete) | sibling refresh |
| delete-by-cwd / WorkTree cleanup | await batch remove from headers |
| relink | `relinkSessionProjectSpace` (header first, old remove, new upsert) |
| message/agent end | invalidate session list snapshots (stat fingerprint remains durable fallback) |
| legacy global sidecar | write path no-op; file not deleted |

## Explicitly NOT done (later subtasks)

- PSI-02 query/recovery (may already be in progress in parallel)
- PSI-04 Studio batch projection
- PSI-05 route feature-flag switch / 5s snapshot wiring
- PSI-06 benchmarks
- PSI-07 docs

## Risks / notes for checker & main session

1. `removeProjectSpaceSessionByHeader` / unarchive upsert resolve space via registry; when the space root is missing/unwritable, mutation fails soft and relies on later reconciliation (PSI-02). Call sites that already hold a space object should prefer explicit `space` via upsert/remove helpers.
2. `deleteSessionFile` still fire-and-forgets a dynamic import for single-file prune paths; `deleteSessionsForCwd` awaits batch removal.
3. Studio child status updates may write index more often than create; fingerprint/stat still bounds cost. PSI-04/05 should avoid over-eager snapshot TTLs.
4. No general user-facing relink API exists yet; `relinkSessionProjectSpace` is ready for future bind/relink callers. Existing create/fork still write header then upsert (equivalent when previous link is empty).
5. Member environment cannot mutate Studio `task.json` — **parent must** mark PSI-03 done with the validation evidence above.

## Decisions needed from main session

1. Mark PSI-03 done with validation evidence.
2. Continue parallel G2: PSI-02 if not complete; then PSI-04.
3. No product decisions blocked.
