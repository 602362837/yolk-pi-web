# IMP-001 30142 真实验收证据

**At:** 2026-07-27  
**Job:** `job_1278854433_22_g1_01a6cdde` generation **1**  
**Verdict for IMP-001 (empty shell / prompt-sentinel):** **PASS**

## Environment

| Item | Value |
| --- | --- |
| 30141 | **protected** PID **16545** (never killed) |
| 30142 RC | `node bin/pi-web.js --port 30142 --no-open` next-server PID **38466** |
| BUILD_ID | `shmEPmXpW7TdSgW0g35Of` |
| provenance | `0.8.4/shmEPmXpW7TdSgW0g35Of#d52e591aeb` / processEpoch `pe-38466-ms2xnrwk` |
| 30142 after | **stopped** (only RC) |

## Sequence

```text
unattended_retry_wake (resumeCheckpoint=implementing)
→ job_started (attempt 902, owner …-38466-…)
→ unattended_implementer_finished (runId=gha-impl-61842217-68b, childStatus=succeeded, outputChars=834)
→ unattended_validation_failed (failedLabel=npm run lint)
→ post-proof pause
```

**No** `full_agent_prompt_sentinel` / instant Internal-error preflight suicide.

## Child session proof (not empty)

File:  
`…/2026-07-27T07-56-43-859Z_019fa293-81d3-75fb-a2d2-2cfdaec2343f.jsonl`

| Metric | Value |
| --- | --- |
| size | **245722** bytes |
| lines | **47** |
| messages | **43** |
| user | **1** |
| assistant | **19** |
| tool | **23** |

Parent binding session `019fa25b-…1602` may still be empty by design; **Agent work is in the child session**.

## Job after proof

| Field | Value |
| --- | --- |
| attempt | 901 → **902** |
| generation | **1** |
| lastMember | **implementer** |
| lastRunId | **gha-impl-61842217-68b** |
| final | paused after validation_failed (lint) |

## Claim scope

| Claim | Result |
| --- | --- |
| Prompt-sentinel false positive fixed in production path | **PASS** |
| Full-agent child actually runs (messages/tools) | **PASS** |
| 30141 protected | **PASS** |
| #22 business complete | **NOT claimed** (stopped at validation_failed / pause) |
