# handoff

## SPIKE-01 complete

Artifact: [`spike-child-context.md`](spike-child-context.md)

### Decision for DATA-01

- **Path A** only: additive `contextUsage` on existing `GET /api/usage?sessionId=` / `childSessions[]`.
- Authoritative live source: SDK child `AgentSession.getContextUsage()` captured into runtime handle (not `__piSessions`).
- CLI / terminated / missing snapshot → `availability: "unavailable"` + UI “暂无上下文数据”.
- Never derive context occupancy from lifetime usage or `progress.tokens/tps`.
- Actual runner file: `lib/ypi-studio-child-session-runner.ts` (not `ypi-studio-subagent-sdk-runner.ts`).

### Not done in this subtask

- No production DATA-01 / UI-02 implementation.
- No live process sampling (worktree has no local `node_modules`).

### Open product choices

1. Accept terminated children as unavailable in v1?
2. Optional process-local lastKnown snapshot before unregister (still lost on restart)?

---

## DATA-01 complete

### What shipped

Path A additive child context projection end-to-end (no UI chips):

1. **SDK runner write path** (`lib/ypi-studio-child-session-runner.ts`)
   - Samples `session.getContextUsage()` on progress (2s throttle) and force on finish.
   - Writes bounded snapshot onto runtime handle via `updateYpiStudioChildRun`.
   - CLI path unchanged (no snapshot).

2. **Runtime projection** (`lib/ypi-studio-subagent-runtime.ts`)
   - `YpiStudioChildContextUsageSnapshot` + handle.contextUsage.
   - Process-local `lastKnown` by childSessionId (survives unregister within process; lost on restart).
   - `projectYpiStudioChildContextUsageBySessionIds`, `toYpiStudioChildContextUsageSnapshot`, `unavailableYpiStudioChildContextUsage`.
   - Privacy: ids + numbers + availability/source/capturedAt only.

3. **Rollup merge** (`lib/usage-stats.ts` / existing `GET /api/usage?sessionId=`)
   - `childSessions[]` additive `contextUsage`.
   - Missing runtime sample → explicit `availability: "unavailable"` (percent/tokens null, never 0).
   - Billing totals / selectedSessionKind / own/children totals **unchanged**.

4. **Hook passthrough** (`hooks/useAgentSession.ts`)
   - `SessionUsageTopbarStats.childSessions?: SessionUsageChildTopbarSummary[]` with contextUsage.
   - AbortController + effectiveSessionId race guard unchanged.
   - local fallback still standalone (no childSessions).

### API contract (additive)

```ts
// on UsageSessionRollupResult.childSessions[i]
contextUsage?: {
  percent: number | null;
  contextWindow: number | null;
  tokens: number | null;
  availability: "available" | "unknown" | "unavailable";
  source: "live" | "persisted";
  capturedAt?: string; // ISO
};
```

Semantics:
- `available` + null percent/tokens = post-compaction unknown occupancy (show “?” not 0%).
- `unavailable` = no live/lastKnown sample (CLI, history after restart, never sampled).
- `source: "live"` for in-process samples (including lastKnown); `persisted` reserved for future sidecar (not implemented).

### Decisions taken in DATA-01

1. **Process-local lastKnown: yes** (low cost; helps parent popover after child finish in same process).
2. **No disk sidecar / no JSONL header change.**
3. **No Path B endpoint.**

### Not done (out of DATA-01)

- UI-02 chips / dual popovers.
- DOC-01 module docs.
- Disk-persisted snapshot across restarts.

### Manual verification notes for main session / UI-02

1. Start parent Studio task with active SDK child → `GET /api/usage?sessionId=<parent>` child row should show `contextUsage.availability=available` with non-null window when model has contextWindow.
2. After child finishes (same process, before restart) → lastKnown may still show available.
3. After server restart / archived historical children → unavailable.
4. Open child audit session → selected session still uses existing live `contextUsage` path (not this rollup field).
5. Confirm cost fields identical to pre-change for parent / standalone / studio_child.

### Files changed

- `lib/ypi-studio-subagent-runtime.ts`
- `lib/ypi-studio-child-session-runner.ts`
- `lib/usage-stats.ts`
- `hooks/useAgentSession.ts`
- `scripts/test-usage-stats-rollup.mjs`
- this handoff

---

## UI-02 complete

### What shipped

Top-bar session stats chips + mutually exclusive billing/context popovers:

1. **`components/SessionStatsChips.tsx`** (new)
   - 23px pill chips: input / output / cache / 费用 / 上下文
   - Compact cost semantics unchanged: parent rollup + `incl. Studio`, standalone own, studio_child selected own (+ parent rollup in billing popover)
   - Independent billing & context triggers; one open at a time
   - Hover / focus / click / Escape / outside close; portal + viewport clamp
   - Context popover: current Session first, Studio children risk-sorted with internal scroll
   - Unavailable → `暂无上下文数据`; lifetime tokens only as labeled secondary detail
   - Thresholds: `<70` normal / `70–89` watch / `≥90` danger; percent + status text + meter/ring

2. **`components/AppShell.tsx`**
   - Replaced inline stats + `BillingPopover` with `<SessionStatsChips />`

3. **`app/globals.css`**
   - Scoped chip/popover styles, theme vars, soft-attention animation
   - `≤640px`: no longer hide entire `.app-top-stats`; hide token chips only (keep cost + context)
   - `≤900px`: hide compact mark, tighten gap
   - `prefers-reduced-motion`: disable pulse animations

### Validation

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- Browser matrix (parent/standalone/studio_child, 640px, keyboard, reduced-motion) — **for main session / CHK-01**

### Not done (out of UI-02)

- DOC-01 module docs
- CHK-01 / REV-01 formal acceptance

### Residual risks

1. Mobile top bar still `overflow-x: auto`; popovers portal to body so not clipped, but dense top bars may need horizontal scroll to reach chips.
2. Child list only when `sessionStats.childSessions` present (rollup); local fallback has no children.
3. Soft-attention animation restarts if chip remounts frequently on stats refresh.
4. Current Session detail has no live “running/idle” status string (shows occupancy only).

### Browser checks for main session

1. Parent with Studio children: context popover current + children; unavailable rows honest.
2. studio_child: compact cost is child own; billing shows parent rollup reference.
3. 640px: only 费用 + 上下文 chips visible.
4. Keyboard: Tab to triggers, Enter/Space toggle, Escape closes and restores focus.
5. reduced-motion: no soft-attention pulse.
6. ChatGptUsagePanel still lays out correctly next to chips.

---

## CHK-01 complete with follow-up blockers

### Verification passed

- `npm run lint`
- `node_modules/.bin/tsc --noEmit`
- `node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-usage-stats-rollup.mjs`
- `git diff --check`

The focused regression script covers all three billing display contracts and additive child context states (unavailable, live, process-local lastKnown, and available with null occupancy) while asserting context projection does not change billing totals.

Static review confirmed the portal popovers, explicit unavailable rendering, risk sorting/internal scroll, 640px token-chip hiding, reduced-motion rules, and numeric-only child snapshot boundary. CHK fixed one interaction race in `SessionStatsChips.tsx`: a delayed close from one trigger now cannot close the other popover after the user switches triggers; dialogs now have an accessible label.

### Browser evidence / limitation

The approved HTML prototype was exercised through `agent-browser`: parent current-first/children context list, unavailable copy, billing/context exclusivity, Escape, 640px layout, dark theme, and reduced motion. Evidence is recorded in `checks.md` (screenshots under `/tmp/ypi-prototype-*.png`).

Actual-app browser verification is **blocked**: port 30141 belongs to another worktree and serves 404; starting this worktree at 30142 causes a Next/Turbopack panic because the worktree `node_modules` symlink points outside its filesystem root. Do not treat prototype verification as a substitute for actual UI verification.

### Required follow-up before final acceptance

1. Complete the missing DOC-01 updates: no module/API/architecture documentation currently describes `SessionStatsChips` or additive child `contextUsage` availability/privacy semantics.
2. Restore a valid local dependency layout or run the app from an environment that can start this worktree, then perform actual-component keyboard/hover/outside-click, parent/standalone/studio_child, 375/640px, dark, and reduced-motion browser checks.

---

## REV-01 independent review (2026-07-13)

**Verdict: CHANGES_REQUESTED.** Static/code review and automated validation pass, but final acceptance is blocked by missing user-approval evidence for the prototype/current revision and missing actual-app browser evidence.

### Checker documentation fix

Completed DOC-01 updates in:

- `docs/modules/frontend.md`
- `docs/modules/api.md`
- `docs/modules/library.md`
- `docs/architecture/overview.md`

They now describe `SessionStatsChips`, additive numeric-only `childSessions[].contextUsage`, its authoritative SDK/runtime source, process-local last-known/unavailable behavior, privacy boundary, responsive behavior, and reduced-motion rule.

### Review evidence

- Billing parent / standalone / studio_child semantics: pass (static + focused regression).
- Context snapshot source/unavailable semantics and no lifetime-usage inference: pass.
- Numeric-only privacy projection: pass (no transcript/prompt/output/tool/artifact/path fields).
- Additive compatibility and session-switch AbortController/effective-id stale guard: pass.
- Popover/interactivity/responsive/reduced-motion static review: pass; actual-app execution remains unverified.
- `npm run lint`, `node_modules/.bin/tsc --noEmit`, focused usage-rollup script, and `git diff --check`: pass.

Full findings and required follow-up: [`review.md`](review.md).

---

## 最终 checking 阶段复查

- 当前 Studio session 已明确批准计划和 HTML 原型；审批范围已同步至 `plan-review.md`、`ui.md` 与 `checks.md`，未补造日期或外部审批证据。
- DOC-01 已完成；相关 frontend/API/library/architecture 文档已记录最终组件和 additive numeric-only child context 契约。
- 再次通过 lint、TypeScript、usage-rollup 聚焦回归及 `git diff --check`。
- 实际应用浏览器验收仍是唯一 blocker：30141 服务的 cwd 是主 worktree 而非本分支；本 worktree 的外部 `node_modules` 符号链接令 `next dev -p 30142` 触发 Turbopack `Symlink [project]/node_modules is invalid, it points out of the filesystem root`（请求 502）。原型证据和静态审查不能替代实际组件验证。

**Final verdict: CHANGES_REQUESTED.** 主 Session 需要在可启动本改动 worktree 的环境完成真实浏览器矩阵并记录结果，之后才可请求 APPROVED。
