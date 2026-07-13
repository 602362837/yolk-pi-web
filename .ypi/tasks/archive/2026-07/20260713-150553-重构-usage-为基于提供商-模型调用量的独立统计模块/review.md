# Review：独立 Provider / Model Usage

## Findings Fixed

- None. Findings below require implementation/design decisions and are not safe checker-only fixes.

## Remaining Findings

### Blocker — cross-process deduplication is not atomic

`lib/llm-usage-store.ts` checks `existsSync(target)` and then calls `renameSync(tmpPath, target)`. On POSIX, rename replaces an existing destination, so two processes writing the same event id can both report success and the second replaces the first. This does not satisfy R4's `wx`/equivalent atomic unique-create guarantee.

**Fix:** retain the tmp-write, but publish with an atomic no-replace primitive (for example hard-link tmp → target and treat `EEXIST` as idempotent, then unlink tmp), or another platform-supported exclusive-create protocol. Add a multi-process same-eventId test.

### Blocker — capture coverage and terminal-call semantics are incomplete

Only `lib/rpc-manager.ts` (Chat) and `lib/ypi-studio-child-session-runner.ts` (Studio SDK) call `recordObservedUsage`. No recorder integration exists for Studio CLI, terminal env assist, Trellis assist, models-config test, warmup, or historical backfill. Error/abort terminal calls with no assistant `usage` are also not recorded. The SPIKE explicitly documents compaction/branch as a known gap, but the implementation neither records all other supported public completions nor persists a complete coverage checkpoint.

**Fix:** wrap each direct public completion with `createCall()` before start and the appropriate final/error/abort recorder call; parse CLI final `message_end`; implement deterministic JSONL backfill/checkpoint; list compaction/branch as unconditional known gaps until SDK support exists. Add entrypoint, fallback, error/abort, stream-final, CLI, and backfill tests.

### Blocker — live observed events have random ids, so they cannot meet required dedup/backfill semantics

`recordObservedUsage()` allocates a new random call/event id for every observation. It is not idempotent if a final callback is repeated, and it cannot share the required `sessionId + entryId` key with historical/live backfill. Its comment claiming repeated calls are idempotent is incorrect.

**Fix:** use a stable final-message/session-entry identity when the public SDK provides it, or defer persistent-session records to a deterministic tail/backfill path. Do not claim live/backfill dedup until they share one event id. Test duplicate observer delivery and concurrent live/backfill.

### Blocker — UI approval record is still absent

`ui.md` explicitly says user approval for Revision 1 is not obtained. The Studio UI hard gate therefore remains unmet, regardless of the existing HTML prototype.

**Fix:** main session must obtain and record explicit user approval for the linked prototype/revision before accepting UI implementation.

### Non-blocking — legacy view cannot be restored from the ledger modal and accessibility is incomplete

When `UsageStatsModal` selects `ledger`, it renders `UsageProviderModelTable` without a switch-back control. The new dialog also lacks focus trap/Escape handling, and clickable provider/model `<tr>` elements are not keyboard-operable. This diverges from the approved UI/a11y requirements and weakens the legacy rollback UX.

**Fix:** pass a view-switch callback, add a Session 统计 control, focus management/Escape handling, and semantic keyboard buttons for expansion/detail.

### Non-blocking — query/API and validation gaps

No `test:llm-usage-api`, capture, or backfill scripts exist despite the plan. `/api/usage/calls` does not set `Cache-Control: no-store`; corrupt/skipped diagnostics are hidden when `knownGaps` is empty; store read validation accepts malformed numeric fields and arbitrary extra fields rather than enforcing the event allowlist. Date parsing says local while storage/query grouping is UTC.

**Fix:** add API/query fixture coverage and no-store header; always show diagnostics; make the on-disk schema validator finite/non-negative and allowlist-based; choose and consistently document UTC date semantics.

## Verification

- `git diff --check` — pass.
- `npm run lint` — pass.
- `node_modules/.bin/tsc --noEmit` — pass.
- `npm run test:llm-usage-store` — pass (34/34), but does not exercise process concurrency or production entrypoints.
- `npm run test:usage-rollup` — pass.
- Manual browser/prototype acceptance — not run; approval record is missing.

## Verdict

**Needs work.** Legacy session API/topbar regression coverage passes, and normalizer/retry isolation are directionally sound. However atomic dedup, required capture/backfill coverage, live dedup, and the mandatory UI approval gate block acceptance.
