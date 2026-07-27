# Review：CHECK-06（task-level final）

## Scope

Final checker gate for LOOP-01 → DOC-05:

**修复 GitHub 自动化评论自触发循环，并建立 @ 开发者指令响应闭环**

Reviewed production code, focused tests, docs, `checks.md`, approved HTML, and paused-safe runtime config. No production code changes in this review. No commit / push / merge. Global paused left **true**.

## Verdict

**Pass**

Residual operator-only gap: live unpaused GitHub mutation smoke intentionally not run while `paused=true`.

## Coverage vs PRD / Design / UI

| Area | Evidence | Result |
| --- | --- | --- |
| R1 self/Bot isolation | `classifyGithubWebhookActorSource` (`performedViaAppId` first, Bot/App fallback); ignore reasons `self_app_event` / `bot_actor_event`; TEST-04 g1–g80 (100 App edits) zero job/gen/wake/mutation | Pass |
| R2 action matrix | `classifyIssueActionMatrix` + LOOP-01 labeled/closed/human comment/reopened/paused tests | Pass |
| R3 generation gate | `isGithubAutomationGenerationEligible` only `issues.opened` / `reopened`; terminal no free gen++ | Pass |
| R4 marker/no-op PATCH | v2 marker `kind+repo+issue` (+ receipt `commentId`); body equality `writePerformed:false`; unknown-outcome re-list | Pass |
| R5 exact comment | GET by id + author/type/updatedAt/body hash; superseded / author mismatch tests | Pass |
| R6 Phase 1 commands | `@AppBot` / `/ypi` + 状态/重新评估/采纳/暂停/继续; legacy bare adopt only while awaiting owner | Pass (approved UI; no separate `重试` enum — continue/retry-wake covers wake) |
| R7 receipt/status | Chinese builders; exact-comment receipt; semantic status; no body/hash/path echo | Pass vs approved HTML contract |
| R8 closed park | lifecycle `issue_closed`; keep WorkTree; reopen + explicit continue | Pass (focused tests) |
| R9 tests/docs | focused suites green; six DOC-05 docs contract-aligned | Pass |
| Global paused authority | `~/.pi/agent/github-automation/config.json` `paused:true` before/after; command path never writes config | Pass |
| No free-text injection | enum-only parser; unattended / unattended-runner TEST-04 sentinels | Pass |
| Schema compat | v1 missing fields fail-closed tests | Pass |
| UI gate | `github-issue-command-loop.html` + user approval in `ui.md` / `plan-review.md` | Pass |

## Code quality (spot)

- Ingress fail-closed: unknown actor, missing version, bot author, non-owner.
- Self/Bot path: exclusive delivery audit, `enqueueEligible:false`, zero job bind/wake.
- Durable command key + `intended → remote_confirmed` crash path covered.
- Store keeps opaque `commentBodySha256` only; projection denylist includes `commentBody` / `issueBody` / `rawBody`.
- Docs no longer imply “any issue_comment enqueues” or historical-comment scan adoption.
- Receipt copy distinguishes per-job pause vs global paused; Bot not described as assignee.

## Verification (re-run this review)

| Command | Result |
| --- | --- |
| `npm run test:github-automation` | **pass** 93/93 |
| `npm run test:github-unattended` | **pass** 18/18 |
| `npm run test:github-unattended-runner` | **pass** 14/14 |
| `npm run test:github-publish-policy` | **pass** 23/23 |
| `npm run lint` | **pass** (0 errors; 11 pre-existing warnings, unrelated) |
| `node_modules/.bin/tsc --noEmit` | **pass** |
| Global paused re-read | **true** (`enabled:true`, `mode:triage`) |

## Findings fixed

None (validation-only; no in-scope production defect requiring checker patch).

## Remaining findings

### Blocking

None.

### Non-blocking

1. Self-loop harness injects App events at webhook ingress and asserts zero wake/handler/remote mutation; it does not re-feed a live PATCH→webhook network loop. Acceptable with permanent LOOP-01 filter + mock counters; live observation still needs operator window after unpause.
2. HTML vs production copy is contract-aligned (Accepted/Rejected/Ignored, command table, global pause wording). Production is slightly richer (e.g. “（YPI 自动化）”, `/ypi` help) — additive/safer.
3. Non-owner **targeted** commands emit rejected receipt (matches approved HTML) rather than total silence; non-targeted non-owner remains audit-only.
4. Historical g1–g80 not rewritten/deleted (by design).

## Stop conditions checked

| Condition | Result |
| --- | --- |
| Self event can create/wake job? | **No** (tests) |
| Same body still PATCH? | **No** (IDEMP-02) |
| Comment can clear global paused / set validation/branch/remote? | **No** |
| HTML/approval missing? | **No** |
| Focused tests / lint errors / tsc related failures? | **No** |

## Live smoke

**Not executed.** Global `paused=true` intentionally unchanged. Requires explicit user decision and maintenance window per `checks.md`.

## Change set reviewed

| Area | Paths |
| --- | --- |
| LOOP/IDEMP/CMD | `lib/github-automation-runtime.ts`, `lib/github-automation-store.ts`, `lib/github-automation-comments.ts`, `lib/github-owner-intent.ts`, `lib/github-issue-triage-runner.ts` |
| TEST-04 | `scripts/test-github-automation.mjs`, `scripts/test-github-unattended.mjs`, `scripts/test-github-unattended-runner.mjs` |
| DOC-05 | `docs/architecture/overview.md`, `docs/modules/api.md`, `docs/modules/library.md`, `docs/integrations/README.md`, `docs/integrations/github-app-automation-setup.md`, `docs/operations/troubleshooting.md` |
| Artifacts | `brief.md`, `prd.md`, `design.md`, `implement.md`, `ui.md`, `plan-review.md`, `github-issue-command-loop.html`, `checks.md` |
