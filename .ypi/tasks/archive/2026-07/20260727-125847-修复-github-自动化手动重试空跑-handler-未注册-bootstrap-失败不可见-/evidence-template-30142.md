# Evidence Template — 30142 real acceptance (GHR-06)

> Fill this during **GHR-06** only. Do **not** record credentials, PEM/JWT/webhook secrets, absolute WorkTree/session paths, `sessionFile`, raw Issue/comment bodies, prompts, transcripts, module specifiers, or stacks.
>
> Harness: `scripts/verify-github-automation-30142.mjs`  
> Manual fallback: `checks.md` §4  
> Default job: `job_1278854433_22_g1_01a6cdde` (generation 1)

## 0. Operator pre-flight

| Item | Value |
| --- | --- |
| Date (UTC) | |
| Operator / agent | |
| Target jobId | `job_1278854433_22_g1_01a6cdde` or: |
| Same-shape substitute? | no / yes — jobId: |
| `PI_CODING_AGENT_DIR` (logical only, no expand if sensitive) | default `~/.pi/agent` / other: |
| RC build command | `npm run build` (never direct `next build`) |
| RC start command | `node bin/pi-web.js --port 30142 --no-open` |

### Isolation checklist

- [ ] `lsof -nP -iTCP:30141 -sTCP:LISTEN` — other shared-agent-dir ypi stopped/isolated
- [ ] `lsof -nP -iTCP:30142 -sTCP:LISTEN` — free before start, then single RC PID
- [ ] No second ypi process sharing the same agent dir is scheduling this job
- [ ] Per-job paused (or global paused) before baseline capture

## 1. Port / process attribution

```bash
lsof -nP -iTCP:30142 -sTCP:LISTEN
curl -fsS http://localhost:30142/api/cli/health
curl -fsS http://localhost:30142/api/github-automation/status
```

| Field | Value |
| --- | --- |
| LISTEN PID (lsof) | |
| health.pid | |
| health.app / version | |
| status.runtimeProvenance.packageVersion | |
| status.runtimeProvenance.buildId | |
| status.runtimeProvenance.codeRevision | |
| status.runtimeProvenance.processEpoch | |
| status.runtimeProvenance.policyVersion | |
| status.runtimeProvenance.processStartedAt | |
| HTTP 301/302 observed? | **must be no** |

Paste **allowlisted** snippets only:

```json
// health (pid/app/version only)
```

```json
// status.runtimeProvenance only
```

## 2. Baseline (before retry)

```bash
JOB_ID='job_1278854433_22_g1_01a6cdde'
curl -fsS "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
```

Or read-only harness:

```bash
node scripts/verify-github-automation-30142.mjs \
  --job-id job_1278854433_22_g1_01a6cdde \
  --base-url http://localhost:30142
```

| Field | Baseline |
| --- | --- |
| jobId | |
| generation | **1** expected |
| attempt | |
| phase / status / checkpoint | |
| reasonCode | |
| sessionAvailability | |
| agentExecutionState | |
| blockedAtLayer | |
| sessionIdShort | null expected |
| counts.schedulerRuns | |
| counts.agentRuns | |
| counts.noProgressRuns | |
| counts.meaningfulProgress | |
| headBranch (safe) | |
| workspaceLabel (safe) | |
| events tail marker (date + last kind/at only) | |

## 3. Mutation (exactly once)

Harness (preferred):

```bash
node scripts/verify-github-automation-30142.mjs \
  --job-id job_1278854433_22_g1_01a6cdde \
  --base-url http://localhost:30142 \
  --confirm-single-retry --pause-first --post-proof-pause
```

Manual fallback:

```bash
# pause if needed (once)
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"action":"pause"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"

# single retry only
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"action":"retry"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
```

| Guard | Result |
| --- | --- |
| pause count | ≤1 |
| retry POST count | **exactly 1** |
| resume+retry double-send? | **no** |
| loop/retry spam? | **no** |

## 4. Expected vs forbidden sequences

### Pass sequence (minimum)

```text
unattended_retry_wake
→ job_started
→ unattended_implementing
→ unattended_session_created
```

### Observed (allowlisted kinds/reason only)

| # | kind | reasonCode | meta allowlist (bootstrapCode/stage/retryable/sessionIdShort/…) | at |
| --- | --- | --- | --- | --- |
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

### Forbidden (any ⇒ FAIL, do not claim fix)

- [ ] `handler_not_ready` / `github_automation_handler_not_ready`
- [ ] `unattended_session_bootstrap_failed` / `session_bootstrap_*`
- [ ] `job_no_progress_backoff` / `runner_no_progress` empty-spin
- [ ] meta only `Internal GitHub automation error`
- [ ] generation → 2 (g2)
- [ ] attempt reset or empty-spin explosion
- [ ] Session still none / fake Agent active without Session
- [ ] HTTP redirect / wrong PID / wrong provenance

## 5. Final cross-check

| Check | Result | Notes |
| --- | --- | --- |
| sessionAvailability `active` \| `ended` | PASS/FAIL | |
| counts.agentRuns ≥ 1 | PASS/FAIL | |
| sessionIdShort present | PASS/FAIL | short id only |
| meaningful progress advanced / `session_created` | PASS/FAIL | |
| generation still 1 | PASS/FAIL | |
| jobId unchanged | PASS/FAIL | |
| headBranch / workspaceLabel same | PASS/FAIL | |
| attempt not reset; delta small (≈ +1 lease) | PASS/FAIL | baseline → final: |
| status.runtimeProvenance still RC | PASS/FAIL | |
| Session header projectId+spaceId = WorkTree space (not main) | PASS/FAIL | record ids only, no paths |
| runner sidecar sessionId non-null (server-only; do not paste path) | PASS/FAIL | yes/no only |
| policy not skipped | PASS/FAIL | |

## 6. Post-proof stop-bleed

Immediately after Session evidence:

```bash
curl -fsS -X POST -H 'Content-Type: application/json' \
  -d '{"action":"pause"}' \
  "http://localhost:30142/api/github-automation/jobs/${JOB_ID}"
```

| Item | Value |
| --- | --- |
| post-proof pause | PASS/FAIL |
| business #22 diff reviewed/merged/published by this task? | **must be no** |
| WorkTree/task/session/events retained? | yes |

## 7. Checker summary block

```text
30142: PASS|FAIL
PID/processEpoch/codeRevision: ...
Job/generation: job_… / g1
Attempt baseline → final: ... → ...
Events: retry_wake → job_started → unattended_implementing → session_created
Session availability / agentRuns: ... / ...
Same WT/branch/task/history: PASS|FAIL
Post-proof pause: PASS|FAIL
Focused tests/lint/tsc: (from GHR-05)
Blockers: ...
Conclusion: only PASS when all mandatory gates pass
```

## 8. Harness JSON attachment

Attach or paste the **redacted** harness stdout (`evaluation` + `checkerTemplate` + provenance fields only). Delete any accidental path/secret before filing.
