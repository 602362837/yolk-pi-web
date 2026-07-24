# handoff — PSI-01 complete (await parent mark done)

## Subtask

- **id:** PSI-01
- **title:** 实现 space-local index 基础设施
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Implemented the project-space local session candidate index store foundation only. No route switch, no list query/recovery, no lifecycle hook migration beyond read-adapter prep on the legacy global sidecar.

Exact paths:

- main: `<project-root>/.ypi/sessions/index.v1.json`
- worktree: `<worktree-root>/.ypi/sessions/index.v1.json`

JSONL remains under `getAgentDir()/sessions/**` (unchanged).

## Files Changed

| Path | Change |
| --- | --- |
| `lib/project-space-session-index.ts` | **new** schema-v1 store: parse bounds, path resolve, gitignore, process queue, cross-process mkdir lock (live-PID safe), lock-time reread/merge, temp+rename, last-good retention, upsert/remove/mutate APIs |
| `lib/project-session-index.ts` | keep as **read migration adapter**; export `readProjectSessionIndex` / `listLegacyIndexedSessionsForSpace`; deprecate write path (PSI-03 will stop callers) |
| `.gitignore` | add anchored `/.ypi/sessions/` only (not whole `.ypi/`) |
| `scripts/test-project-space-session-index.mjs` | **new** focused store tests (`--group store`) |
| `package.json` | add `test:project-space-session-index` script |

## Validation

```bash
npm run test:project-space-session-index -- --group store
# 15 passed, 0 failed

npx eslint lib/project-space-session-index.ts lib/project-session-index.ts --max-warnings=0
# clean

node_modules/.bin/tsc --noEmit
# EXIT 0
```

Store acceptance covered:

- main/worktree resolve to own roots + identity isolation
- illegal path / symlink / archive / future-malformed schema fail closed
- concurrent upsert/remove keeps all updates; failed write preserves last-good
- index/tmp/lock git-ignored; `.ypi/tasks` still trackable; non-git spaces work
- incompatible user `.ypi/sessions/.gitignore` not overwritten (git exclude fallback)

## Explicitly NOT done (later subtasks)

- PSI-02 query/recovery/`listSessionsForProjectSpace`
- PSI-03 lifecycle write-through / stop writing legacy sidecar
- PSI-04 Studio batch projection
- PSI-05 route feature-flag switch
- PSI-06 benchmarks
- PSI-07 docs

## Risks / notes for checker & main session

1. Path canonicalization is duplicated (registry-compatible local helper) so focused strip-loader tests do not import `project-registry.ts` parameter properties. Behavior mirrors `canonicalizeProjectPath` (realpath → pathKey).
2. Stale lock recovery never steals from a live PID (may time out waiters) — same safety posture as Grok provider lock.
3. If ignore cannot be verified in a git worktree, mutate fails closed and does **not** persist a new index (last-good retained).
4. Legacy global sidecar still has live write callers (`agent-session-bootstrap`, `rpc-manager`); PSI-03 must stop them. PSI-01 only prepared the read adapter.
5. Member environment blocked shell mutation of `task.json` and has no `ypi_studio_task` tool — **parent must** `update_implementation_subtask` / claim flow to mark PSI-01 done with the validation evidence above.

## Decisions needed from main session

1. Mark PSI-01 done with validation evidence.
2. Claim/select next ready subtasks: **PSI-02** and **PSI-03** can run in parallel after PSI-01.
3. No product decisions blocked.
