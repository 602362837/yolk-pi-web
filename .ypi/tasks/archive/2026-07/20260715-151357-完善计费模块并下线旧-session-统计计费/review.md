# review — CHECK-01

Task: 完善计费模块并下线旧 session 统计计费  
Subtask: CHECK-01  
Checker: 检查员  
Date: 2026-07-15  
Verdict: **Pass**

## Scope reviewed

Independent review of the actual worktree diff (not subtask status alone), against `checks.md` / `implement.md` CHECK-01 / `plan-review.md` / approved HTML prototype.

### Diff evidence (worktree)

| Area | Evidence |
| --- | --- |
| DATE-01 | `lib/local-date-range.ts` (new), `lib/llm-usage-query.ts`, `app/api/usage/calls/route.ts`, `lib/llm-usage-store.ts` comments, `scripts/test-llm-usage-query.mjs` |
| LEGACY-01 | deleted `components/UsageStatsModal.tsx`; `app/api/usage/route.ts` sessionId-only; `lib/usage-stats.ts` rollup-only; `lib/pi-web-config.ts` / `lib/llm-usage-recorder.ts` retire `statsSource`; Settings copy |
| UI-01 | `components/UsageProviderModelTable.tsx`, `components/SelectDropdown.tsx` toolbar size, `components/UsageLedgerIcon.tsx`, `components/AppShell.tsx`, `app/globals.css` |
| DOC-01 | `AGENTS.md`, `docs/architecture/overview.md`, `docs/modules/{api,frontend,library}.md`, `docs/operations/troubleshooting.md` |

Approval gate: `plan-review.md` records user approval; HTML prototype present: `usage-ledger-refinement-prototype.html`.

## Findings Fixed

None. No in-scope low-risk defects required a checker fix.

## Remaining Findings

### Non-blocking

1. **Live browser smoke on this worktree unavailable**  
   - Main app on `localhost:30141` is the *parent* repo (`pi-agnet-web`), still serving pre-change `/api/usage` global scan (`timezone: UTC` / full session aggregate).  
   - Worktree `next dev` fails under Turbopack: `Symlink [project]/node_modules is invalid, it points out of the filesystem root`.  
   - Mitigation used: full static review + focused unit tests (including UTC+8 fixture) + route/source contract inspection. Main session should do a short browser pass after worktree is runnable or merged into a working dev tree.

2. **Usage icon is line-trend geometry only**  
   Matches approved HTML (`M3 18l5-6…` path set) and shared `UsageLedgerIconGeometry`. Not a dollar+line hybrid; product accepted this in prototype approval.

### Blockers

None.

## Acceptance matrix

| Requirement | Result | Evidence |
| --- | --- | --- |
| No Session 统计 tab / global legacy UI | Pass | `UsageStatsModal.tsx` deleted; AppShell opens `UsageProviderModelTable` only; static search finds no active tab/UI |
| Default + reset workspace = 全部; cwd only when 当前 | Pass | `workspaceFilter` init `"all"`; `resetFilters` sets `"all"`; `activeCwd` only when filter is `cwd` |
| source/status use `SelectDropdown`, no native `<select>` | Pass | two `SelectDropdown size="toolbar"`; `rg '<select'` empty in ledger component |
| exact + M via `lib/token-format.ts` | Pass | imports `formatTokens` / `formatTokensM` / `formatTokensLabel` / `formatTokensCompact`; TokenCell/TokenRows/summary/tooltip/drawer |
| Dual chart toggles; default line + tokens | Pass | `chartShape="line"`, `chartMetric="tokens"`; UI 折线趋势/柱状占比 + 使用量/费用; tooltip primary follows metric |
| No coverage/legacy UI noise | Pass | no coverage banner / knownGaps / corrupt / legacy footer rendering; API `coverage` still on wire |
| Shared line Usage icon | Pass | `UsageLedgerFlowIcon` sidebar + `UsageLedgerHeaderIcon` modal; same geometry as prototype |
| Date: local bounds → UTC partitions → occurredAt filter → local byDay | Pass | query filter `occurredMs` vs from/to; `formatLocalDate` byDay; range labels from request; focused tests |
| `/api/usage` without sessionId does not scan | Pass | route returns 400 `{ error: "sessionId is required" }` before any rollup call; `getUsageStats` removed |
| `/api/usage?sessionId=` rollup preserved | Pass | `getUsageStatsForSessionRollup` retained; rollup tests pass; `SessionStatsChips` / `useAgentSession` unchanged |
| `statsSource` retired; recorder always on | Pass | `recorderEnabled = true`; config ignores/strips `statsSource` |
| Docs no longer guide legacy switchback | Pass | architecture/api/frontend/library/troubleshooting + AGENTS map ledger vs rollup |

## Static searches

```text
Session 统计 / resolveDefaultUsageView / getUsageStats( active call
  → only docs/historical comments; no active UI or global aggregator

statsSource
  → retirement comments + delete-on-save in pi-web-config / recorder only

<select in UsageProviderModelTable
  → none

UsageStatsModal
  → none remaining in source tree
```

## Verification

| Command | Result |
| --- | --- |
| `npm run lint` | Pass — 0 errors (6 pre-existing warnings in unrelated scripts/task archive) |
| `node_modules/.bin/tsc --noEmit` | Pass — exit 0 |
| `npm run test:llm-usage-store` | Pass — 34/34 |
| `npm run test:llm-usage-query` | Pass — 10/10 (boundary ±1ms, UTC+8 local-day isolation, range/timezone local labels, byDay grouping, cache key isolation, 366-day / from>to validation) |
| `npm run test:usage-rollup` | Pass — parent/child/standalone/orphan/archived + includeArchived + contextUsage additive |

### UTC+8 date evidence

Host: `Asia/Shanghai`, offset +8.  
`parseLocalDateParam("2026-07-14")` → `2026-07-13T16:00:00.000Z` … `2026-07-14T15:59:59.999Z`.  
Query test asserts three in-range events / 70 tokens for classic UTC+8 fixture and excludes previous/next local-day events even when they sit in adjacent UTC partitions.

### Browser / live API

- Could not validate final UI against this worktree’s running Next server (Turbopack symlink).  
- Parent `localhost:30141` still serves old global `/api/usage` (expected: different cwd).  
- Code path for new 400 is unambiguous in `app/api/usage/route.ts`.

## UI vs approved HTML

Aligned on: single ledger page, filters (全部 default), SelectDropdown-style controls, exact+M hierarchy, dual chart switches, no Session tab / coverage noise, shared line-trend icon paths, narrow-screen CSS hooks (`.usage-chart-controls`, bar grid, line height).

## Risks remaining for main session

1. Restart/dev from a tree whose `node_modules` is not an out-of-root symlink before final browser QA.  
2. External clients still calling global `GET /api/usage` without `sessionId` will now get intentional 400 (approved).  
3. Server-local date semantics (not browser IANA) remain product contract until a future timezone param.

## Verdict

**Pass**

All automatic checks pass; static and source review cover PRD/Design/Implement acceptance; UI prototype gate satisfied and implementation matches the approved HTML. No blockers. Residual risk is operational (worktree Next cannot boot under current symlink layout), not product incompleteness — recommend main session do a 5-minute browser smoke after merge/runnable start.

## Formal revalidation (checking stage)

Date: 2026-07-15 (independent re-check after CHECK-01 report).

Re-ran full automatic gate and re-inspected contracts against current worktree diff:

| Check | Result |
| --- | --- |
| `npm run lint` | Pass — 0 errors (6 pre-existing warnings in unrelated scripts/task archive) |
| `node_modules/.bin/tsc --noEmit` | Pass — exit 0 |
| `npm run test:llm-usage-store` | Pass — 34/34 |
| `npm run test:llm-usage-query` | Pass — 10/10 |
| `npm run test:usage-rollup` | Pass |
| Static: no active Session 统计 tab / `UsageStatsModal` / `getUsageStats(` | Pass |
| `/api/usage` missing sessionId → 400 before rollup | Pass |
| ledger default/reset workspace=`all`; SelectDropdown; exact+M; dual chart defaults | Pass |
| `statsSource` retired; recorder always on; Settings includeArchived rollup-only copy | Pass |
| Approval gate + HTML prototype present | Pass |
| UTC+8 local day bounds (`Asia/Shanghai`) | Pass — `2026-07-14` → `2026-07-13T16:00:00.000Z` … `2026-07-14T15:59:59.999Z` |

No new findings. No blockers. Prior non-blocking items (worktree Next symlink cannot boot; icon is line-trend-only matching approved HTML) remain operational/product-accepted.

**Final verdict: Pass — ready for review / user_acceptance.**

## User acceptance follow-up (2026-07-15)

User reported chart regression during browser review:
- bars must stack by model
- line chart must draw one series per model

Fix applied in `components/UsageProviderModelTable.tsx`:
- charts now consume `byDayModel`
- stacked bar segments + multi-line series restored
- model legend and per-model tooltips restored

Browser smoke on `http://localhost:30142`:
- line mode: multi-model polylines present
- bars mode: stacked segments present (e.g. 3 day bars / 13 segments in sample range)
- legend includes provider/model labels

Additional review-stage polish accepted by user:
- line + bars side by side (no shape toggle); Token 拆分 on next row
- single-day left chart falls back to model pie/donut
- line hover hit-area treats line as last-day point
- token volumes display **M primary + exact secondary**

## User acceptance

**Accepted** by user on 2026-07-15 (`验收通过`). Ready for completed/archive.
