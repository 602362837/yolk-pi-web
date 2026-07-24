# handoff — PSI-06 complete (await parent mark done)

## Subtask

- **id:** PSI-06
- **title:** 完成正确性、安全与性能基准
- **status:** implementation complete (member cannot write task.json; parent must mark done)

## Summary

Added scale correctness fixtures (~300 sessions / ~180 Studio children) and a fixed-sample performance benchmark with hard gates. Ran lint/tsc/focused tests/bench. All hard gates passed on this machine; related-entry stretch target also passed (models baseline is noisy due to provider cold-start / anyrouter jiti warnings — not session inventory contention).

## Files Changed

| Path | Change |
| --- | --- |
| `scripts/test-project-space-session-index.mjs` | new `--group scale` (~300/180 fixture, missing/corrupt recovery, single-flight, 1/22/100 candidates, inventoryGlobalCalls=0, studioProjectionCalls≤unique tasks) |
| `scripts/bench-project-space-sessions.mjs` | **new** cold/warm P50/P95, candidate sizes, single-flight, web-config/models-config/models related concurrency probe, JSON report, hard+stretch gates |
| `package.json` | add `bench:project-space-sessions` script |

## Validation

```bash
npm run test:project-space-session-index -- --group all
# 54 passed, 0 failed

npm run test:session-title
# passed

npm run test:studio-child-sessions
# all passed

npm run lint
# 0 errors (11 pre-existing warnings unrelated)

node_modules/.bin/tsc --noEmit
# EXIT 0

npm run bench:project-space-sessions -- --samples 30 --warmup 1 --json /tmp/psi06-bench.json
# All gates passed.
```

### Benchmark evidence (darwin arm64, node v26, samples=30)

Fixture: `totalSessions=320`, `totalChildren=180`, `targetRoots=22`, `targetChildren=60`, `uniqueTasks=3`

| Metric | Result | Gate |
| --- | --- | --- |
| warm P50 | **40.8ms** | ≤ 500ms PASS |
| warm P95 | **46.2ms** | ≤ 1.5s PASS |
| cold P95 | **73.3ms** | ≤ 5s PASS |
| cold max | **88.2ms** | < 10s PASS |
| inventoryGlobalCalls (warm/cold) | **0** | =0 PASS |
| studioProjectionCalls ≤ uniqueLinkedTasks | **90≤90** | PASS |
| concurrent recovery single-flight | **recoveryRuns=1** | PASS |
| web-config added P95 | **0.0ms** | no 10s-class / ≤500ms PASS |
| models-config added P95 | **0.1ms** | PASS |
| models added P95 | **−617.7ms** (baseline colder than concurrent) | no 10s-class PASS; stretch PASS |

Candidate sizes warm P95: roots=1 → 35.1ms; 22 → 75.5ms; 100 → 99.8ms.

Models probe notes: jiti-loaded `createWebAgentSessionServices`; anyrouter provider fails to load under bench harness (`@/lib/anyrouter-config` / ACCOUNT_STORE_DIR). Models isolation baseline shows independent cold-start noise (max ~2.9s on first samples). Session list concurrency does **not** add 10s waits; residual models latency is provider/runtime Phase 2 territory, not inventory scan.

## Explicitly NOT done (PSI-07)

- Architecture / API / library / troubleshooting docs
- AGENTS.md navigation updates
- Final checker cross-file review

## Risks / notes for checker & main session

1. Absolute timings measured on local external volume; absolute numbers may vary, but gates cleared with large margin on this host.
2. Models related probe uses jiti (Node strip-only cannot load parameter properties). Production Next path is unaffected.
3. Scale tests clear `agentDir/sessions` between fixtures to avoid cross-case pollution in shared `PI_CODING_AGENT_DIR`.
4. Member cannot mutate Studio `task.json` — **parent must** mark PSI-06 done and claim PSI-07.

## Decisions needed from main session

1. Mark PSI-06 done with the validation evidence above.
2. Claim/select **PSI-07** (docs only).
3. Optional: open Phase 2 if product wants `/api/models` provider cold-start isolation (outside this task).
