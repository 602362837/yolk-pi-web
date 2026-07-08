# summary

## 任务

修复 Chat 顶部与统计中的子任务计费汇总显示错误。

## 完成范围

- 移除 `AppShell` 顶部费用 chip 中裸露的 `+child` 占位文案，改为基于真实 child usage 的明确 compact 文案（parent `incl. Studio`、studio_child `Studio child`）与 tooltip 拆分。
- `hasChildUsage` 判定改为 child token/cost totals > 0，不再因 child 数量误判。
- Studio child audit session 顶部 compact 只显示该 child 自身费用（`selectedSessionTotals`），tooltip 附带 parent rollup 与 parent id。
- `UsageSessionRollupResult` / `SessionUsageTopbarStats` additive 新增 `selectedSessionKind` / `selectedSessionTotals` / `parentRollupTotals`，旧字段语义不变。
- `ChatWindow` `statsKey` 纳入新增字段，确保父/子 session 切换后 topbar 立即刷新。
- 新增 `scripts/test-usage-stats-rollup.mjs` fixture 回归脚本，覆盖 global / bySession / byParentSession / session_rollup / includeArchived 全链路。
- 同步 `docs/architecture/overview.md`、`docs/modules/frontend.md`、`docs/modules/api.md`、`docs/modules/library.md`。

## 验证结果

- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `npm run test:usage-rollup` — 通过（10 组断言）。
- 未运行 `next build`。

## 剩余风险

- 手工验收点 1–6（真实环境顶部文案/tooltip/Usage 弹窗/API 视觉确认）未自动覆盖；fixture 已覆盖等价 API 断言，视觉文案建议主会话在真实 parent/child session 中复核。
- `lib/git-worktree.ts` 改动属最小加载阻塞消除（parameter property → 显式字段），已通过 lint/type-check；如主会话不接受可改用测试侧 transform loader。
