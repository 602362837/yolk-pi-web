# IMP-001 Design — durable implementer retry lane

```text
GitHub runner (implementing)
 → durable attempt reservation/fence
 → GitHub session adapter starts Studio implementer child
 → structured child terminal provenance
 → transport-before-first-request?
    → persist retry due + bounded backoff → same fence lineage retry
    → otherwise stable implementer reason/operator block
 → succeeded exactly once → checking → existing checker/validation/final diff/publisher gates
```

## Authority

1. Pi/child runner may classify a provider transport failure only through a public/owned structured result adapter; raw provider text is untrusted diagnostic data.
2. `github-automation-session.ts` owns conversion to an allowlisted `GithubImplementerRunOutcome`.
3. `github-automation-runner.ts` owns durable reservation, budget, backoff, checkpoint transition and effect guards.
4. Existing checker reason codes remain checker-only; publisher remains server-owned.

## Proposed state (additive)

`GithubAutomationRunnerStateV1` gains an optional `implementerRetry` record, scoped to generation: `{ generation, attemptOrdinal, runId, runFence, childSessionIdHash?, providerRequestStarted, outcomeKind, retryCount, nextRetryAt? }`.

Persist reservation **before** child launch. Persist `providerRequestStarted=true` at the first observable request boundary where public SDK evidence exists. If that boundary cannot be observed reliably, fail closed: no automatic retry rather than claiming “before first request”. State validation rejects generation mismatch, ordinal gaps, duplicate fence, retry budget overflow, or retry after `checking`/publisher effects.

## Failure mapping

| Child outcome | Runner action |
| --- | --- |
| confirmed transport, before first request, budget available | `retry_due`, `implementer_provider_transport_failure`, bounded backoff |
| confirmed transport but request started / diff changed / unknown start state | block `implementer_provider_transport_failure_after_start` |
| SDK/session runtime unavailable before child launch | existing implementer runtime reason; never `check_runtime_unavailable` |
| cancelled/pause | preserve cancellation/pause semantics, no retry |
| auth/quota/context/policy/agent failure | existing non-automatic implementer block |

## Idempotence guard

Before auto retry and on resume, runner must atomically re-read state and verify: same job/generation/fence lineage; no active/terminal later-stage evidence; no publisher effect; no unaccounted WorkTree diff attributable to a prior uncertain child. Failed persistence means zero launch. A duplicate scheduler invocation observes the same reservation and does not create another child.

No UI change: Jobs reuses existing safe reason/retryability fields.
