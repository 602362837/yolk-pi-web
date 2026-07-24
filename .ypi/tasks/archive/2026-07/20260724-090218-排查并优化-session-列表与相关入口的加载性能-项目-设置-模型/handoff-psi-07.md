# handoff — PSI-07 complete (await parent mark done)

## Subtask

- **id:** PSI-07
- **title:** 更新架构与模块文档
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Documented the shipped project-space directed session index (PSI-01…06) without claiming local index is JSONL truth. Removed stale “project-space still uses global `listAllSessions()`” architecture notes. AGENTS kept navigational (module entry + data table only).

## Files Changed

| Path | Change |
| --- | --- |
| `docs/architecture/overview.md` | New “Project-space session candidate index” invariants: space-local path, JSONL truth, hot path, recovery/503, lifecycle, legacy global migration, gitignore, env rollback, timing privacy; updated session header / archive / inventory sections |
| `docs/modules/api.md` | Project-space route contract (`listSessionsForProjectSpace`, query flags, 503, feature flag); inventory source table split directed vs global; implementation pointers |
| `docs/modules/library.md` | New modules: space index/list/lifecycle, studio display batch, timing; legacy global adapter; dual-boundary performance section |
| `docs/modules/frontend.md` | Sidebar contract note: same success body; 503 uses existing error channel; no new partial/stale UI |
| `docs/operations/troubleshooting.md` | Ops section: paths, rebuild 503, safe index delete/rebuild, gitignore, rollback env, bench commands, Phase 2 models note |
| `AGENTS.md` | Module entry for directed list; data table for space-local index + legacy seed |

## Validation

```bash
# stale “still global filter” claims removed from architecture/api performance docs
rg -n "project-space listing still calls global|directed per-space inventory / project-session index redesign is out of scope|Best-effort \`~/.pi/agent/pi-web-session-index.json\` maintenance" docs/ AGENTS.md
# no hits on those obsolete phrases

rg -n "listSessionsForProjectSpace|session_index_rebuilding|PI_WEB_PROJECT_SPACE_SESSION_LIST|\.ypi/sessions/index\.v1\.json" docs/ AGENTS.md
# present across overview/api/library/frontend/troubleshooting/AGENTS

npm run lint
# 0 errors (11 pre-existing warnings unrelated)

node_modules/.bin/tsc --noEmit
# EXIT 0
```

## Acceptance checklist (docs)

- [x] Docs no longer claim project-space hot path is full `listAllSessions()` filter
- [x] Local index is candidate/summary only; JSONL under `getAgentDir()/sessions` remains truth
- [x] Legacy global sidecar is migration seed / stop-write, not hot authority
- [x] Ops can delete/rebuild index and roll back via env without touching JSONL
- [x] AGENTS stays navigational; details live under `docs/`

## Explicitly NOT done

- Production code changes (docs-only subtask)
- git commit / push / merge
- Checker final cross-file pass (required by implement plan)

## Risks / notes for checker & main session

1. Chat top-bar `GET /api/sessions/:id/studio-children` still documents global `listAllSessions` — intentional, not the project-space route.
2. Absolute bench numbers remain in PSI-06 handoff; docs point at `npm run bench:project-space-sessions` rather than freezing host timings.
3. Member cannot mutate Studio `task.json` — **parent must** mark PSI-07 done and close the implementation plan.

## Decisions needed from main session

1. Mark PSI-07 done with the validation evidence above.
2. Dispatch checker for docs/implementation consistency per `checks.md` §11.
3. No further product decisions blocked for this task.
