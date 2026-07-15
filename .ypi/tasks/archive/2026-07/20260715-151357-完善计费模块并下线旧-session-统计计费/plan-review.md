# 计划审批书

> 用户已于本会话明确 **批准** 计划与 HTML 原型，任务进入 **implementing**。

## 审批摘要

本计划将全局 Usage 收敛为独立调用账本，修复日期筛选，默认“全部”，统一 exact + M token 与下拉组件，删除 coverage/legacy 噪音，并在账本内保留“使用量 / 费用”指标切换、增加真实按日折线趋势图与柱状形态切换，同时更新 Usage 图标。旧全局 Session 扫描页面/API/聚合下线，但聊天顶栏依赖的 `session_rollup`、Studio parent/child 费用和上下文展示明确保留。

## PRD

详见 [prd.md](prd.md)。

关键验收：

- 全局只有调用账本，不再有 `Session 统计` tab。
- 本地日期范围严格按 occurredAt 过滤，不混入相邻 UTC 分区事件。
- 首次和重置均为“全部”。
- token exact 为主、M 为次，统一使用 `lib/token-format.ts`。
- 来源/状态复用 `SelectDropdown`。
- 账本默认展示按日“使用量”折线趋势图，可切换“费用”指标与柱状占比形态；点位/柱段 tooltip 随当前指标展示，含 exact + M 或金额。
- 不展示 coverage/legacy 兼容噪音。
- Session 顶栏 rollup 不回归。

## UI

详见 [ui.md](ui.md)。

- 原型门禁：**触发且已交付 HTML**。
- HTML 原型：**已按反馈补回“使用量 / 费用”切换并保留双形态图表**：[usage-ledger-refinement-prototype.html](usage-ledger-refinement-prototype.html)，请重新预览后审批。
- 用户审批：**已批准**（本会话明确回复「批准」）。
- 当前进入实现阶段。

## Design

详见 [design.md](design.md)。

- 日期采用“本地日边界 → UTC 分区候选读取 → occurredAt 精确过滤 → 本地日分组”。
- `/api/usage/calls` 保持 v1 shape，修正 range/timezone 行为；coverage wire 暂保留但不渲染。
- `/api/usage` 只保留 `sessionId` rollup；`getUsageStatsForSessionRollup()` 与顶栏契约保留。
- `statsSource` 退役，ledger recorder 始终启用；旧字段兼容忽略。
- 历史 JSONL/event 不迁移。

## Implement

详见 [implement.md](implement.md)。

建议顺序：

1. DATE-01 修正日期语义并补 focused tests。
2. LEGACY-01 下线 global Session 统计并保留 rollup。
3. UI-01 按已批准 HTML 收敛 ledger UI。
4. DOC-01 更新项目文档。
5. CHECK-01 自动 + 浏览器回归。

## Checks

详见 [checks.md](checks.md)。

必须通过 lint、tsc、账本 query focused test、usage rollup test，并人工验证全局日期筛选、dropdown、exact+M、窄屏和三类 Session 顶栏口径。

## 请求确认的决策

1. **图表双切换（已按反馈修订）**：保留现网“使用量 / 费用”指标切换，并提供“折线趋势 / 柱状占比”形态切换；默认折线 + 使用量，复用 byDay 数据，不新增图表库或改变 API shape；同时保留 Usage 入口/header 的折线统计语义图标。
2. **旧 API（推荐）**：无 `sessionId` 的 `/api/usage` 返回 400 `sessionId is required`；`/api/usage?sessionId=` 与顶栏 rollup 保留。
3. **旧配置（推荐）**：`statsSource` 读时忽略、API 不投影、下次配置保存时移除；ledger recorder 始终启用。
4. **UI 原型**：请打开 [usage-ledger-refinement-prototype.html](usage-ledger-refinement-prototype.html) 预览后批准或提出修改。

## 当前审批状态

- 计划内容：已批准。
- UI HTML：已交付并获用户批准。
- 用户批准：已记录（本会话「批准」）。
- 任务状态：`implementing`。
