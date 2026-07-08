# review

## 实现口径复核（docs-checks）

确认最终代码与文档口径一致：

- `components/AppShell.tsx`：裸 `+child` 已移除；compact 标记改为 `incl. Studio`（parent 有真实 child usage 时）或 `Studio child`（studio_child 场景）；`hasChildUsage` 改为 `kind === "parent" && (childTokenTotal > 0 || childCost > 0)`，不再因 `childCount > 0` 误判。tooltip 对 studio_child 附带 `parent rollup` 与 parent id。
- `hooks/useAgentSession.ts`：`SessionUsageTopbarStats` additive 新增 `selectedSessionKind` / `selectedSessionTotals` / `parentRollupTotals`；rollup 失败回退 local 按 `standalone` 口径处理。
- `components/ChatWindow.tsx`：`statsKey` 纳入 `selectedSessionKind` / `parentFound` / own/studioChild token totals / `selectedSessionTotals` / `parentRollupTotals` cost，避免父/子 session 总额相同时不刷新。
- `lib/usage-stats.ts`：`UsageSessionRollupResult` additive 新增 `selectedSessionTotals` / `parentRollupTotals` / `selectedSessionKind`，旧字段语义不变。
- `scripts/test-usage-stats-rollup.mjs`：fixture 回归覆盖 global / bySession / byParentSession / session_rollup(parent/child/standalone/orphan/archived) / includeArchived。

## 文档一致性

- `docs/architecture/overview.md`、`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md` 均已同步 additive 字段与 top-bar 展示口径，无遗留裸 `+child` 或"child session 只显示 parent rollup"的过时表述。

## 验证

- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `npm run test:usage-rollup` — 通过（10 组断言）。
- 未运行 `next build`。

## Findings Fixed

- `components/AppShell.tsx`：原生 `title` 属性 tooltip 替换为 `BillingPopover` hover 浮窗，简洁展示计费组成：
  - **parent（有 child usage）**：本会话（own cost）+ Studio 子会话（child cost）
  - **studio_child**：本会话（child 自身 cost）+ 父会话汇总（parent rollup）
  - **standalone / parent 无 child usage**：仅本会话
  - 浮窗使用 `position: absolute` 定位，120ms 防抖延迟避免闪烁，hover 到浮窗区域可保持显示。

## Remaining Findings

- 手工验收点 1–6（真实环境顶部文案/tooltip/Usage 弹窗/API 视觉确认）未自动覆盖；建议主会话在真实 parent/child session 中复核视觉文案。
- `lib/git-worktree.ts` 改动属最小加载阻塞消除，超出 usage-validation files 范围但已通过 lint/type-check；如主会话不接受可改用测试侧 transform loader。

## Verification

- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `npm run test:usage-rollup` — 通过（10 组断言）。

## Verdict

**Pass** — 改动不影响现有计费口径、统计链路、类型安全或文档一致性。BillingPopover 为 additive self-contained 组件，不引入新依赖或布局变化。
