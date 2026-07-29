# Handoff — implementer (HNR-04)

## Status

HNR-04 complete: production-artifact smoke, docs, and full validation gate.

No commit / push / merge.

## Files changed (this subtask + prior HNR chain already on tree)

### HNR-04

- `scripts/test-github-automation-production-runtime.mjs` — real `.next` jobs Retry route smoke under temp `PI_CODING_AGENT_DIR`; overdue `retry_due` + malformed fullName fixture; asserts no `handler_not_ready` / `default_handler_defensive_fallback`, real lease attempt++, zero network, zero user agentDir writes.
- `package.json` — script `test:github-automation-production-runtime`.
- `docs/architecture/overview.md` — direct handler binding, deadline timers, Node startup reconcile, production smoke gate.
- `docs/modules/library.md` — scheduler map + invariants + instrumentation entry.
- `docs/modules/api.md` — status/verify non-wake, jobs retry wake, HNR scheduler note, production smoke command.
- `docs/operations/troubleshooting.md` — `handler_not_ready` / overdue retry runbook + release verification.

### Already present from HNR-01…03 (not re-authored here)

- `lib/github-automation-scheduler.ts`, `lib/github-issue-analysis-runner.ts`, `lib/github-automation-types.ts`, `lib/github-automation-runtime.ts`
- `instrumentation.ts`
- `scripts/test-github-automation-gia03.mjs`, `scripts/test-github-automation-gia07.mjs`

## Verification

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | PASS (GIA-01 + issue-analysis 24 + GIA-03 11 + GIA-04 7 + GIA-07 27) |
| `npm run lint` | 0 errors (pre-existing warnings only; smoke unused-arg warning fixed) |
| `node_modules/.bin/tsc --noEmit` | PASS (clean) |
| `npm run build` | PASS (fresh `.next`; includes `instrumentation.js` + static handler bind in chunks) |
| `npm run test:github-automation-production-runtime` | PASS — `status=blocked reason=malformed_full_name attempt=2`, no fallback codes, `networkAttempts=0` |
| `git diff --check` | PASS |

Production smoke evidence:

- artifact: `.next/server/app/api/github-automation/jobs/[jobId]/route.js`
- POST retry → 200 `accepted`
- settled via real analysis handler path (not parking default)

Post-build bundle spot-check: scheduler chunk binds production handler as static import (`j.si`), tracks `nextWakeAtMs`, no cold sync-require register path for ordinary ticks.

## Remaining risks / checker focus

1. **Deploy #25:** startup reconcile will resume existing `retry_due` jobs; if remote comment is not desired, set `paused=true` before upgrade (do not hand-edit job JSON).
2. **Live UAT still required:** cold test-App human Issue + real comment/close gates are not replaced by mock suite or the pre-network production smoke.
3. **Multi-process:** still depends on filesystem lease/fence; smoke is single-process.
4. **Daily CI cost:** production smoke must not be glued into every unit suite without an explicit build step; release path is `build` then smoke.

## Decisions needed from main session

1. Mark HNR-04 / implementing complete and hand to checker for local review.
2. Whether to deploy now and allow automatic recovery of #25 (or pause first).
3. Whether release notes / version bump are in-scope for a follow-up (out of this implementer subtask; no commit performed).
