# Handoff — IMP-001 replanning

## Artifacts updated

`improvements/imp_nk4hrw4s/`:

- `brief.md`, `prd.md`, `design.md`, `implement.md`, `checks.md`
- `plan-review.md`, `ui.md`, `review.md`, `summary.md`

## Result

Corrected scope from ordinary Chat provider retry to GitHub automation runner / YPI Studio implementer child. Plan covers structured error mapping, bounded durable retry/backoff, attempt/session/run provenance, and fail-closed idempotence against duplicate implementation or publish. No UI and no production implementation.

## Evidence reviewed

- `lib/github-automation-session.ts`: child result currently lacks structured request/failure provenance.
- `lib/github-automation-runner.ts`: implementer retry currently uses error-message fallback; checker owns `check_runtime_unavailable`; state only has `lastMember/lastRunId`.

## Validation run

Documentation-only planning; no test command run. Verified artifact files were written. No commit/push/merge.

## Remaining risks / decision needed

Approve D1–D5 in `plan-review.md`, especially the fail-closed rule if Pi public child evidence cannot prove failure occurred before the first provider request. The main session should also supply/retain a redacted attempt-906 event timeline for IMP-01 reproduction; do not infer it from sanitized error text.
