# GHR-06 Evidence — 30142 real acceptance (rework PASS)

## Verdict

**30142: PASS** — same-generation Session created after a single retry on the RC process.

Do claim the empty-run regression fixed for the production handler-load class. Issue #22 business work remains out of scope and was paused after proof.

## Checker report

```text
30142: PASS
PID/processEpoch/codeRevision: 21307 / pe-21307-ms2vfgr2 / 0.8.4/Yc4X_1B0Snpiv_Frv88V9#b9e4050ab1
Job/generation: job_1278854433_22_g1_01a6cdde / g1
Attempt baseline → final: 900 → 901
Events (disk safe events, same jobId):
  unattended_retry_wake
  → job_started
  → unattended_implementing
  → unattended_session_created
Session availability / agentRuns: active / 1
lastMeaningfulProgress.kind: session_created
Same WT/branch/task/history: PASS (branch ypi/gha/1278854433/issue-22/g1, WT label preserved)
Post-proof pause: PASS (status/phase paused after proof)
30141 protected: PASS (PID 16545 never killed; health still ok)
Focused tests/lint/tsc: handler-runtime 9/9; tsc clean; lint 0 errors
Conclusion: PASS — production async-module load fix validated on real g1 job
```

## Root cause fixed (production)

Previous FAIL (`handler_module_export_missing`) came from Next webpack **async modules**:

- `require("./github-issue-triage-runner")` does not throw
- exports are not functions until the module thenable settles
- old readiness path checked `typeof mod.githubIssueTriageJobHandler !== "function"` immediately

Fix in `lib/github-automation-handler-runtime.ts`:

1. Prefer dynamic `import()`, always await thenables from import/require
2. Resolve named exports with default/getter/thenable interop
3. Fall back to `registerGithubIssueTriageHandler()` + live registry verify
4. Keep allowlisted diagnostics only (no path/specifier/stack)

Regression tests added in `scripts/test-github-handler-runtime.mjs` for:

- thenable/async-module namespace settlement
- register-only export path
- incomplete namespace still → `handler_module_export_missing` (not no-progress)

Harness pause gate also fixed: paused may appear as `phase=paused` / `schedulerState=paused` while `status=retry_due`; `already_paused` is treated as success.

## Timeline (safe)

| Step | Result |
| --- | --- |
| 30141 listen | PID **16545** (protected throughout) |
| `npm run build` | BUILD_ID `Yc4X_1B0Snpiv_Frv88V9` |
| Start RC 30142 | next-server PID **21307**, processEpoch `pe-21307-ms2vfgr2` |
| Health/status direct 200 | no redirect; provenance matches RC |
| Baseline job | g1, attempt **900**, Session **none**, reason was `handler_not_ready` from prior FAIL |
| Single retry | exactly 1 POST retry (no resume+retry, no loop) |
| Session proof | `sessionAvailability=active`, short id `019fa25b…1602`, agentRuns **1**, meaningfulProgress **session_created** |
| Safe events | `unattended_retry_wake` → `job_started` → `unattended_implementing` → `unattended_session_created` |
| Post-proof pause | PASS → job `status=paused` / `phase=paused` / checkpoint `implementing` |
| Stop only 30142 | PASS; 30141 still healthy |

## Baseline → final (allowlisted)

### Baseline

- jobId: `job_1278854433_22_g1_01a6cdde`
- generation: 1
- attempt: 900
- phase/status: paused / retry_due
- checkpoint: studio_task_ready
- reasonCode: handler_not_ready
- sessionAvailability: none
- agentRuns: 0
- branch: `ypi/gha/1278854433/issue-22/g1`
- workspaceLabel: `yolk-pi-web · WT issue-22 g1`

### Final (after single retry + post-proof pause)

- generation: 1 (unchanged)
- attempt: 901 (one lease run; not reset; no empty spin)
- sessionAvailability: active
- sessionIdShort: `019fa25b…1602`
- agentRuns: 1
- meaningfulProgress: 1 (`session_created`)
- headBranch / workspaceLabel unchanged
- post-proof: paused

## Notes

1. Harness JSON `events: []` because the script does not read local event files by default; disk safe events for the same jobId confirm the full required sequence.
2. Immediately after Session-created, a transient `unattended_implementer_error` / `implementer_error` appeared (agent layer). That is **outside** the empty-run handler/bootstrap gate; Session proof already succeeded and post-proof pause was applied so Issue #22 business work is not part of this task.
3. No g2, no history wipe, no attempt reset, no credentials/paths in this evidence.

## Local temp artifacts (not committed)

- `/tmp/ypi-ghr06-rework/harness-result.txt`
- `/tmp/ypi-ghr06-rework/job-before.json`
- `/tmp/ypi-ghr06-rework/job-after.json`
- `/tmp/ypi-ghr06-rework/rc-30142.log`
