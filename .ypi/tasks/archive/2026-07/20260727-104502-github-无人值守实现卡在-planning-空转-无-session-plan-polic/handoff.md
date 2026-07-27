# Architect / Implementer Handoff — GHA-CLOSE-08

## Status

- **Subtask:** GHA-CLOSE-08 (文档、回滚与最终门禁)
- **Result:** done (docs + final verification)
- **Production code in this subtask:** none (documentation/navigation only)
- **No** `commit` / `push` / `merge`

## Files Changed (this subtask)

| Path | Summary |
| --- | --- |
| `docs/architecture/overview.md` | Expanded P1 unattended: disposition no-spin SM, counts, command once, policy stages, WorkTree Session binding, env copy isolation, lease fencing, runtime provenance, #22 same-generation recovery |
| `docs/integrations/README.md` | P1 observability/disposition/recovery section; key modules + test matrix; layered rollback without history rewrite |
| `docs/integrations/github-app-automation-setup.md` | Operator #22 FAQ + table: dual-layer UI, full restart, reconcile, `retry_conditions_unchanged`, doc cross-links |
| `docs/modules/api.md` | Status/jobs safe projection, provenance, command fall-through, legacy reconcile on retry, test suite list |
| `docs/modules/library.md` | Scheduler disposition/fencing; worktree spaceId; session scrubbed env copy; automation invariants + tests |
| `docs/operations/troubleshooting.md` | Test matrix + architecture/setup cross-links (runbook already present from GHA-CLOSE-05) |
| `AGENTS.md` | Navigation only: disposition/lease/Jobs UI/reconcile + provenance/troubleshoot pointers; `test:github-unattended-runner` |

Already accurate from earlier subtasks (no edit required this pass):

- `docs/modules/frontend.md` — Jobs dual-layer UI (GHA-CLOSE-06)
- `docs/operations/troubleshooting.md` — full #22 stop-bleed / recovery section (GHA-CLOSE-05)

## Validation

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | **113 passed / 0 failed** |
| `npm run test:github-unattended` | **19 passed / 0 failed** |
| `npm run test:github-unattended-runner` | **18 passed / 0 failed** |
| `npm run test:github-publish-policy` | **28 passed / 0 failed** |
| `npm run lint` | **0 errors** (11 pre-existing warnings, unrelated) |
| `node_modules/.bin/tsc --noEmit` | **pass** (empty output, exit 0) |
| `git diff --check` (GHA-CLOSE-08 docs + AGENTS) | **pass** |

## Acceptance vs GHA-CLOSE-08

| Acceptance | Evidence |
| --- | --- |
| 用户可仅从文档判断卡在哪一层及下一步 | architecture P1 SM + dual-layer fields; troubleshooting #22 runbook; setup FAQ |
| rollback 可分别关闭 UI 增强、自动 retry、unattended，而不删历史 | integrations README rollback steps 1–6 |
| 无未审批产品决定被实现 | docs only; no new product knobs; skip-policy still forbidden |

## Remaining risks / main session

1. **Studio tool:** this member environment has no `ypi_studio_task` tool; parent must mark GHA-CLOSE-08 **done** and close the plan (8/8) if not already.
2. **#22 live recovery** is still an operator action after deploy: pause → full restart → provenance check → single retry. Docs describe it; do not auto-mutate production job state from this subtask.
3. **Checker localReview** was required on the plan; independent checker may still want to spot-check docs vs `checks.md` matrix.
4. Production package still needs **full process restart** before trusting #22 recovery against a live install.

## Decisions needed from main session

1. Mark GHA-CLOSE-08 done / plan complete in Studio.
2. Operator: deploy + restart `ypi`, then execute #22 recovery runbook once.
3. Optional: independent checker pass on docs/diff before release.
