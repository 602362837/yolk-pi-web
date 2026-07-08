# handoff

## 已完成

- 完成 intake/planning，已产出：
  - `brief.md`
  - `prd.md`
  - `ui.md`
  - `design.md`
  - `implement.md`
  - `checks.md`
  - `plan-review.md`

## 关键定位

- 顶部 `+child` 来自 `components/AppShell.tsx` 的硬编码展示。
- `hasChildUsage` 当前用 `childCount > 0 || childCost > 0`，会把“存在 child session”误判为“存在 child usage”。
- `GET /api/usage?sessionId=<child>` 当前按架构解析为 parent rollup；child audit session 中继续显示 `+child` 因而更容易误解。
- Usage 聚合链路代码已显式扫描 Studio child session 并生成 `byParentSession`，但需要回归验证证明 totals 汇总正确。

## 建议下一步

1. 主会话确认 child audit session 顶部费用口径：推荐 child tab 显示自身费用，tooltip 显示 parent rollup；备选为显示 parent rollup 但明确标注。
2. 保存 `implement.md` 中的 implementationPlan，并在用户批准后进入实现。
3. 实现后运行：
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## 验证状态

- 本轮为规划与代码阅读，未修改生产代码。
- 未运行 lint/type-check。

## usage-validation 子任务完成

已完成 `usage-validation` 子任务：验证 Usage 聚合链路并补回归检查。

变更文件：

- `scripts/test-usage-stats-rollup.mjs`（新增）— fixture 回归脚本，临时 `PI_CODING_AGENT_DIR` 下构造真实 JSONL（parent + child 有/无 usage + standalone + orphan child + archived child），走真实 `SessionManager` + `session-reader` 路径，断言 global totals、bySession、byParentSession（parent/orphan/standalone）、session_rollup（parent/child/standalone/orphan/archived）与 `includeArchived` 开关。
- `scripts/ts-extension-loader.mjs`（改动）— additive 增加 `@/` path alias → 项目根 的解析（含 `.ts` fallback），使测试脚本可 import 使用 `@/lib/...` 的源模块；原有 `./`/`../` 行为不变（dag/policy 测试仍通过）。
- `lib/git-worktree.ts`（改动）— `MainWorktreeDirtyError` 的 constructor parameter property 改为显式字段 + 赋值，行为不变，仅消除 Node strip-only 模式不支持 parameter property 的加载阻塞，使回归脚本可加载 `session-reader` 链。
- `package.json`（改动）— 新增 `test:usage-rollup` 脚本。
- 任务 `checks.md` — 勾选 R3 项并记录验证样本。

验证运行：

- `npm run test:usage-rollup` — 通过（10 组断言）。
- `npm run test:studio-policy` / `npm run test:studio-dag` — 仍通过（loader 改动未破坏）。
- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。

结论：R3 全部覆盖，`getUsageStats` / `getUsageStatsForSessionRollup` 在 active/archive scope 下均 `includeStudioChildren`，`byParentSession.totals = ownTotals + studioChildTotals`，child-selected 口径（`selectedSessionTotals` = child 自身、`parentRollupTotals` = parent rollup）与确认口径一致，孤儿 child `parentFound=false` 语义保留。Usage 弹窗的 `byParentSession` fallback 不受影响。

剩余风险/需主会话关注：

- R1/R2 属于 `topbar-copy` / `hook-refresh` 子任务范围，本子任务未触及 `AppShell.tsx` / `useAgentSession.ts` / `ChatWindow.tsx`，需对应子任务确认顶部文案与 statsKey 字段。
- `git-worktree.ts` 改动虽非行为变更，但超出 `usage-validation` 列出的 files 范围；属最小加载阻塞消除，已通过 type-check/lint。如主会话认为不该改动，可改为在测试侧用 transform loader，但项目当前未引入 tsx/esbuild。
- 回归脚本依赖 Node 内建 TS strip；后续若 `lib/` 新增 enum/namespace/parameter property 语法，脚本会再次无法加载，需保持该类语法限制或引入真正 TS 编译 loader。

## docs-checks 子任务完成

已完成 `docs-checks` 子任务：同步文档并执行最终验证。

变更文件：

- `docs/architecture/overview.md`（改动）— `session_rollup` 响应补充 additive `selectedSessionTotals` / `parentRollupTotals` 字段说明与 top-bar 展示口径（parent `incl. Studio`、standalone 自身、studio_child 自身 + `Studio child` 标记，不显示裸 `+child`，`hasChildUsage` 改为 token/cost > 0）。（已由前序子任务完成，本子任务复核一致。）
- `docs/modules/frontend.md`（改动）— 更新 `AppShell` top-bar chip 口径、`ChatWindow` `statsKey` 新增字段（`selectedSessionKind` / `parentFound` / own/studioChild token totals / `selectedSessionTotals` / `parentRollupTotals` cost）、`useAgentSession` `SessionUsageTopbarStats` additive 字段与 local fallback `standalone` 语义、`UsageStatsModal` 不受 additive 字段影响。
- `docs/modules/api.md`（改动）— `usage/` route `session_rollup` 响应 additive 字段与 `selectedSessionKind`，以及 implementation pointer 中 additive 契约说明。
- `docs/modules/library.md`（改动）— `lib/usage-stats.ts` `UsageSessionRollupResult` additive 字段语义与口径。
- 任务 `checks.md` — 勾选 R1/R2 项并记录 docs-checks 验证结果。

验证运行：

- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `npm run test:usage-rollup` — 通过（10 组断言）。
- 未运行 `next build`（按子任务约束）。

结论：docs 与最终代码口径一致，lint / type-check / usage rollup 回归全部通过。R1/R2/R3 全部覆盖。

剩余风险/需主会话关注：

- 手工验收点 1–6（真实环境顶部文案/tooltip/Usage 弹窗/API 视觉确认）未在自动验证中覆盖；`usage-validation` fixture 已覆盖等价 API 断言，顶部文案属视觉确认，建议主会话在真实 parent/child session 中复核。
- `lib/git-worktree.ts` 改动（`MainWorktreeDirtyError` parameter property → 显式字段）超出 `usage-validation` files 范围，属最小加载阻塞消除，已通过 type-check/lint；如主会话认为不该改动可改为测试侧 transform loader。
