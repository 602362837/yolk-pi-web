# review — integrated checker (strict)

## Verdict

**Pass** for the scoped regression class:

> GitHub automation **manual retry empty-run** caused by **handler not ready on cold process** + **invisible/generic bootstrap failure** + missing **30142 real Session proof**.

**Not in scope / not claimed fixed:** Issue #22 business work（chat 打开底部模型性能问题）. Post-Session `implementer_error` is residual, outside this gate.

---

## Checker report (checks.md §6)

```text
30142: PASS
PID/processEpoch/codeRevision: 21307 / pe-21307-ms2vfgr2 / 0.8.4/Yc4X_1B0Snpiv_Frv88V9#b9e4050ab1
Job/generation: job_1278854433_22_g1_01a6cdde / g1
Attempt baseline → final: 900 → 901
Events: unattended_retry_wake → job_started → unattended_implementing → unattended_session_created
Session availability / agentRuns: active (sessionId non-null) / 1
Same WT/branch/task/history: PASS
Post-proof pause: PASS (phase=paused, status=paused, checkpoint=implementing)
30141 protected: PASS (PID 16545 still LISTEN on 30141; never killed by this task)
Focused tests/lint/tsc: handler-runtime 9/9; session-bootstrap 8/8; unattended-runner 20/20; publish-policy 28/28; tsc clean; lint 0 errors
Blockers: none for empty-run / handler-not-ready / invisible-bootstrap class
Conclusion: PASS — may claim only this regression fixed; not Issue #22 business completion
```

---

## Findings Fixed

None by this checker pass. Implementation already includes:

1. **GHR-01 readiness authority** — `lib/github-automation-handler-runtime.ts` is process-global single-flight; scheduler registry kind=`github_issue_triage` + generation is live truth; webhook / Settings retry-resume / ensure-wake / tick all gate on `ensureGithubAutomationJobHandlerReady()`; lease-before-attempt; `handler_not_ready` without attempt increment; default handler defensive path returns `handler_not_ready` for non-`received` production phases.
2. **Production async-module load fix** — dynamic `import()` + await thenable require namespaces; named-export interop (direct/getter/default/thenable); register-then-verify live registry fallback; allowlisted diagnostics only (`handler_module_export_missing` / load failures) — no path/specifier/stack.
3. **GHR-02 typed bootstrap + disposition** — `lib/agent-session-bootstrap-errors.ts` classification before sanitize; runner catch maps `session_bootstrap_failed|transient` + allowlisted `bootstrapCode/stage/retryable`; explicit `blocked` / `retry_due` disposition; success path `unattended_session_created` + independent counters; known branches audited against `runner_no_progress` fold.
4. **GHR-04 harness** — `scripts/verify-github-automation-30142.mjs` default read-only; mutation requires `--confirm-single-retry`; rejects redirect semantics; pause gate understands phase/schedulerState/`already_paused`.
5. **GHR-06 real proof** — single retry on RC 30142 created WorkTree Session on same g1.

---

## Remaining Findings

### Non-blocking (out of product claim)

1. **Post-Session `implementer_error`** (disk event `2026-07-27T06:55:08.738Z`): after `unattended_session_created`, agent layer recorded `implementer_error` with sanitized message `Internal GitHub automation error`. Job was immediately post-proof paused. This does **not** reopen the empty-run gate (handler ran, Session exists, attempt only +1). Operators continuing #22 unattended must investigate implementer runtime separately.
2. **Harness API event sampling empty** — harness may report `events: []` while disk safe events hold the sequence; evidence correctly used disk. Optional follow-up only.
3. **Job residual state** — paused at `checkpoint=implementing`, `blockedAtLayer=agent`, `sessionId` still live, `noProgressRunCount=2` historical. Do not unpause under this task unless intentionally resuming Issue #22 business work.
4. **Uncommitted production surface** — handler-runtime, bootstrap errors, tests, harness, runner/session edits are still local (no commit/push/merge by design). Main session owns packaging.

### Blocking

**None** for the empty-run regression class.

---

## Requirement coverage (R1–R11 / C1–C11)

| ID | Result | Evidence |
| --- | --- | --- |
| R1/C1 readiness authority | Pass | `github-automation-handler-runtime.ts`; registry kind+generation; concurrent single-flight test |
| R2/C2 all entries gated | Pass | projection action ensure; scheduler ensure/tick ensure; runtime webhook ensure |
| R3/C3–C4 handler_not_ready no-spin | Pass | fault tests no lease/attempt/no-progress; disk prior `github_automation_handler_not_ready` with allowlisted meta |
| R4–R5/C5–C6 typed bootstrap + disposition | Pass | session-bootstrap 8/8; runner classify before sanitize; scheduler preserves reason |
| R6 success evidence | Pass | disk `unattended_session_created` meta `{sessionIdShort,hasProjectId,hasSpaceId,hasContextId,hasSessionFile}` only |
| R7/C7 attempt semantics | Pass | 900→901; lease run once; agentRunCount independent =1 |
| R8/C8 same generation | Pass | jobId/g1/branch `ypi/gha/1278854433/issue-22/g1`/task/space `wt_b9a34ba5adde488f` preserved |
| R9/C10 UI unchanged | Pass | no diff on `components/GithubAutomationConfig.tsx` / `app/globals.css` |
| R10 offline gate | Pass | focused suites below |
| R11/C11 30142 real | Pass | see disk spot-check + ghr-06-evidence |

---

## Disk spot-check (live, read-only)

### Job `~/.pi/agent/github-automation/jobs/job_1278854433_22_g1_01a6cdde.json`

| Field | Value |
| --- | --- |
| jobId | `job_1278854433_22_g1_01a6cdde` |
| generation | **1** |
| attempt | **901** |
| phase / status | `paused` / `paused` |
| checkpoint | `implementing` |
| agentRunCount | **1** |
| meaningfulProgressCount | **1** |
| lastMeaningfulProgressKind | **`session_created`** |
| progressRevision | 1 |
| noProgressRunCount | 2 (historical; not post-proof empty spin) |

### Runner sidecar (allowlisted)

| Field | Value |
| --- | --- |
| sessionId | **`019fa25b-1d0b-731e-88af-1b2e86911602`** (non-null) |
| contextId | `pi_019fa25b-1d0b-731e-88af-1b2e86911602` |
| generation | 1 |
| branchName | `ypi/gha/1278854433/issue-22/g1` |
| spaceId | `wt_b9a34ba5adde488f` |
| taskId | `20260727-094902-github-22-chat打开底部模型性能问题` |
| projectId | present |
| pauseRequested | true |
| reasonCode | `pause_requested` |

### Safe events (`2026-07-27.jsonl`, job filter, proof window `T06:55`)

```text
unattended_retry_wake (resumeCheckpoint=studio_task_ready)
→ job_started (attempt=901, ownerId contains 21307)
→ unattended_implementing (executionProfile=full-agent)
→ unattended_session_created (sessionIdShort=019fa25b…1602; binding flags only)
→ unattended_implementer_error (residual; outside empty-run claim)
→ legacy_job_reconciled (generation=1, preservedAttempt=901)
```

Privacy scan on proof-window events: no `/Users/`, `/Volumes/`, PEM/JWT markers, or `MODULE_NOT_FOUND` specifier leakage.

### Process protection

- **30141** still LISTEN: PID **16545** (`next-server`) — protected.
- **30142** RC stopped after proof (no current LISTEN) — expected.

---

## Code audit notes (strict)

### Handler load (production root cause of rework FAIL → PASS)

Prior production FAIL was `handler_module_export_missing` under Next webpack async modules (`require` does not throw; exports not functions until thenable settles). Current loader:

1. Prefer `import()` and always `awaitIfThenable`
2. require path also awaits thenable namespaces
3. resolve named exports with getter/default/thenable interop
4. fallback `registerGithubIssueTriageHandler()` + live registry verify kind
5. test hooks only for fault/async shapes

### Bootstrap

- Classification in `classifyAgentSessionBootstrapFailure` / typed `AgentSessionBootstrapError` **before** `safeGithubAutomationErrorMessage`
- `MODULE_NOT_FOUND` → fixed `session_runtime_module_missing` without specifier
- Runner returns explicit dispositions; scheduler must not rewrite known reasons to `runner_no_progress` (covered by session-bootstrap suite)

### UI gate

No component/CSS change; existing dual-layer projection fields only.

---

## Verification

| Command / check | Result |
| --- | --- |
| `npm run test:github-handler-runtime` | **PASS** 9/9 |
| `npm run test:github-session-bootstrap` | **PASS** 8/8 |
| `npm run test:github-unattended-runner` | **PASS** 20/20 |
| `npm run test:github-publish-policy` | **PASS** 28/28 |
| `node_modules/.bin/tsc --noEmit` | **PASS** (clean) |
| `npm run lint` | **PASS** 0 errors (11 pre-existing warnings only) |
| `node scripts/verify-github-automation-30142.mjs --help` | default read-only documented |
| Disk job/runner/events spot-check | **PASS** Session real, g1, 900→901 |
| 30141 still running | **PASS** PID 16545 |
| UI component/CSS dirty | **none** |
| No production re-retry by checker | **honored** |

(Full `test:github-automation` / `test:github-unattended` not re-run in this integrated pass; critical GHR suites + unattended-runner + publish-policy cover the regression surface. Prior handoff already recorded RC build + harness exit 0.)

---

## Product claim scope (must not overclaim)

| Claim | Allowed? |
| --- | --- |
| Manual retry no longer empty-runs via default handler / `runner_no_progress` when full handler can load | **Yes** |
| Handler not ready is visible as `handler_not_ready` without lease spin | **Yes** |
| Bootstrap failures are typed + disposition-preserving; success emits safe Session-created | **Yes** |
| Real g1 #22 job created WorkTree Session after one 30142 retry | **Yes** |
| Issue #22 “chat 打开底部模型性能” is fixed / ready to merge | **No** |
| implementer_error after Session means automation fully healthy for #22 business | **No** |

---

## Verdict summary

**Pass** — empty-run regression class is fixed with real 30142 Session evidence and offline regression locks. Main session may move this task to user acceptance / review for that claim only. Do not treat residual agent-layer `implementer_error` or Issue #22 product work as closed by this task.
