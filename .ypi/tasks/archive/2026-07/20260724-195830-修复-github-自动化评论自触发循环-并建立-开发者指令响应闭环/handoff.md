# Handoff：TEST-04 完成

## Subtask

- **ID**: TEST-04
- **Title**: Add loop and command regression coverage
- **Status**: implemented (awaiting checker / DOC-05 parallel or CHECK-06)
- **Member**: implementer

## Files Changed

- `scripts/test-github-automation.mjs` — TEST-04 suite:
  - g1–g80 self-loop (1 human open + App assign/4 labels/comment create + **100** App comment edits; login rename; delivery replay)
  - exact-comment TOCTOU (status vs historical 采纳, superseded edit, author mismatch)
  - pause/continue + free-text unsupported + global paused fail-closed
  - deleted comment + closed lifecycle + schema v1 missing fields
  - command effect crash-intent → remote_confirmed without double side effect
- `scripts/test-github-unattended.mjs` — TEST-04 no free-text injection into prompt/task/runner/validation
- `scripts/test-github-unattended-runner.mjs` — TEST-04 structured pause/retry never accept free-text; fixture allowlist fix for empty-default repos in start-gates test
- `scripts/test-github-publish-policy.mjs` — unchanged (regression green)

## Acceptance mapped

| Criterion | Coverage |
| --- | --- |
| 100 App self comment edits, zero job/generation/wake/mutation | `TEST-04 g1-g80 self-loop…` |
| Action matrix / deleted / closed / paused | LOOP-01 + TEST-04 deleted/closed + pause/continue global paused |
| Exact comment replay / superseded / historical adopt ignored | `TEST-04 exact comment TOCTOU…` + CMD-03 adopt replay |
| Marker no-op / unknown-outcome | IDEMP-02 existing tests (still green) |
| Crash/reconcile command effect | `TEST-04 command effect crash-intent…` |
| No comment text injection | unattended + unattended-runner TEST-04 cases |

## Verification

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | **pass** (93/93) |
| `npm run test:github-unattended` | **pass** (18/18) |
| `npm run test:github-unattended-runner` | **pass** (14/14) |
| `npm run test:github-publish-policy` | **pass** (23/23) |

No production `lib/` changes. Global automation paused not modified. No commit / push / merge. No live GitHub mutations.

## Notes / Risks

- Self-loop chain feeds **ingress** only (webhook → audit ignore); it does not re-emit App PATCH as a live network loop. LOOP-01 + mock mutation counter prove zero handler/wake/remote write.
- Continue path stamps job `reasonCode=retry_wake` after structured wake; command effect keeps `continue_requested` — tests accept both.
- Delivery id replay returns `duplicate` (exclusive-create), not a second `ignored` row.
- Status receipt next-step copy may mention「采纳」as guidance; recognized command must still be「状态」only.
- Empty-default allowlist required fixture repo in unattended-runner start-gates test (pre-existing fragility, fixed in TEST-04 scope).

## Main session next

1. Mark TEST-04 done; keep **DOC-05** parallel if not finished.
2. **CHECK-06** (checker): focused suites already green; still need lint/tsc + privacy scans + HTML copy review.
3. Do **not** unpause global automation without explicit user decision.
4. No production code changes in this subtask — checker should focus on regression strength and any DOC-05 staleness.
