# checks

## 需求覆盖检查

- [x] R1：顶部费用 chip 不再显示裸 `+child`。（`AppShell.tsx` compact 改为 `incl. Studio` / `Studio child` 标记，裸 `+child` 已移除。）
- [x] R1：child session 只有数量、没有 usage 时，不显示 child usage 标记。（`hasChildUsage` 改为 `kind === "parent" && (childTokenTotal > 0 || childCost > 0)`，不再因 `childCount > 0` 误判。）
- [x] R1：父 session 有 child usage 时，compact 文案明确表示总额已包含 Studio child。（compact 显示总额并追加 `incl. Studio`。）
- [x] R2：打开 Studio child audit session 时，topbar 文案不再出现“当前 child + child”的误导表达。（`studio_child` compact 只显示该 child 自身费用 + `Studio child` 标记。）
- [x] R2：child session 口径（自身费用或 parent rollup）已由主会话确认并在 tooltip 中说明。（child tooltip 附带 `parent rollup` 与 parent id；口径由主会话确认为 child 自身费用。）
- [x] R3：`/api/usage` global totals 包含 child session usage。
- [x] R3：`byParentSession.totals = ownTotals + studioChildTotals`。
- [x] R3：`/api/usage?sessionId=<parent>` 与 Usage 弹窗 rollup 一致。
- [x] R3：`/api/usage?sessionId=<child>` 满足确认后的 child-selected 口径。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

如新增轻量测试脚本，补充运行：

```bash
npm run test:usage-rollup
# 等价于：node --loader ./scripts/ts-extension-loader.mjs --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/test-usage-stats-rollup.mjs
```

## usage-validation 验证记录

新增 `scripts/test-usage-stats-rollup.mjs`，在临时 `PI_CODING_AGENT_DIR` 下构造真实 JSONL fixture（1 parent + 1 child 有 usage + 1 child 无 usage + 1 standalone + 1 orphan child + 1 archived child），走真实 `SessionManager` + `session-reader` 扫描路径，断言：

- global `totals.cost` = parent(30) + child(10) + standalone(3) + orphan(4) + archived(14) = 61，`totals.calls` = 5。
- `bySession` 保留 child row，`kind=studio_child`、`parentSessionId` 指向 parent；无 usage child 不出现在 `bySession`。
- `byParentSession(parent)`：`totals = ownTotals(30) + studioChildTotals(24)`，`parentFound=true`，`studioChildSessionCount=3`（含无 usage 与 archived child）。
- `byParentSession(orphan)`：`parentFound=false`，`ownTotals=0`，`totals` 等于 orphan child 自身 usage。
- `byParentSession(standalone)`：`studioChildSessionCount=0`，`totals` 等于自身 usage。
- `includeArchived=false`：global `totals.cost` = 47（61-14），parent `studioChildTotals` = 10、`studioChildSessionCount` = 2。
- `session_rollup(parent)`：`selectedSessionKind=parent`，`totals=54`，`selectedSessionTotals` = 父自身(30)，`parentRollupTotals` = `totals`，`childSessions` 含有 usage child。
- `session_rollup(child)`：`selectedSessionKind=studio_child`，`selectedSessionTotals` = child 自身(10)，`parentRollupTotals` = parent rollup(54)，旧 `totals` 仍等于 parent rollup 以保持兼容。
- `session_rollup(standalone)`：`selectedSessionKind=standalone`，`totals=ownTotals=selectedSessionTotals=parentRollupTotals=3`，`studioChildTotals=0`。
- `session_rollup(orphan child)`：`parentFound=false`，`selectedSessionTotals` = 自身(4)。
- `session_rollup(archived child)`：经 metadata 扫描路径解析，`selectedSessionTotals` = 自身(14)，`parentRollupTotals` = 54（含自身）。

结论：R3 全部覆盖，Usage 聚合链路在 active/archive scope 下均 `includeStudioChildren`，父子 rollup 与 child-selected 口径一致。

## 手工验收点

1. 无 child 的普通 session：顶部只显示 token/cost/context，不显示 Studio child 标记。
2. parent session 有 own usage、无 child usage：不显示 child usage 标记。
3. parent session 有 own + child usage：费用为总额；tooltip 显示 own cost 与 Studio children cost。
4. Studio child audit session：顶部文案符合确认口径；不出现 `+child`。
5. Usage 弹窗：总览 `Studio children` 与 `Parent rollups` 数量合理；Parent sessions 行展示 children/own cost 拆分。
6. API 手工检查：
   - `GET /api/usage?sessionId=<parent>`
   - `GET /api/usage?sessionId=<child>`
   - `GET /api/usage?from=YYYY-MM-DD&to=YYYY-MM-DD&cwd=<cwd>`

## 回归风险

- `ChatWindow` statsKey 缺字段导致 AppShell 保留旧 topbar 文案。
- 新文案过长导致 topbar 在窄屏溢出。
- 修改 rollup contract 时破坏 UsageStatsModal 的 `byParentSession` fallback。
- 误把 child transcript sidecar 当作 usage 来源，导致费用重复计算。
- archived session metadata-only 扫描不能支持 selected rollup 读取；如触及 archived 逻辑需验证 includeArchived=true 场景。
  - 已验证：`session_rollup(archived child)` 经 `listAllArchivedSessionMetadata` 路径解析并读取真实 usage，`parentRollupTotals` 正确汇总。

## 阻塞条件

- 主会话未确认 child audit session 顶部费用最终口径，且实现需要从 parent rollup 改为 child own display。
- 无可用 parent+child usage 样本且实现不愿新增 fixture 测试；至少需记录手工 API 验证替代方案。
  - 已解除：新增 fixture 回归脚本 `scripts/test-usage-stats-rollup.mjs`，无需手工样本即可覆盖。

## docs-checks 验证记录

同步文档使与最终代码口径一致：

- `docs/architecture/overview.md`：`session_rollup` 响应补充 additive `selectedSessionTotals` / `parentRollupTotals` 与 top-bar 展示口径（parent `incl. Studio`、standalone 自身、studio_child 自身 + `Studio child` 标记，不显示裸 `+child`）。
- `docs/modules/frontend.md`：`AppShell` top-bar chip 口径、`ChatWindow` `statsKey` 新增字段、`useAgentSession` `SessionUsageTopbarStats` additive 字段与 local fallback `standalone` 语义、`UsageStatsModal` 不受 additive 字段影响。
- `docs/modules/api.md`：`usage/` route `session_rollup` 响应 additive 字段与 `selectedSessionKind`，以及 implementation pointer 中 additive 契约说明。
- `docs/modules/library.md`：`lib/usage-stats.ts` `UsageSessionRollupResult` additive 字段语义与口径。

自动验证：

- `npm run lint` — 0 error / 0 warning。
- `node_modules/.bin/tsc --noEmit` — 通过。
- `npm run test:usage-rollup` — 通过（10 组断言）。
- 未运行 `next build`（按子任务约束）。

未覆盖手工验收点（需主会话/用户在真实环境确认）：

- 手工验收点 1–4（真实 parent / standalone / Studio child session 顶部文案与 tooltip 视觉确认）。
- 手工验收点 5（Usage 弹窗总览 `Studio children` / `Parent rollups` 数量与拆分）。
- 手工验收点 6（真实 `/api/usage` 三类 API 查询）；`usage-validation` 子任务已用 fixture 覆盖等价断言，可作回归替代。
