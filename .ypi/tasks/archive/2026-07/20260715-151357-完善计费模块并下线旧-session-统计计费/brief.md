# Brief

## 目标

将全局 Usage 弹窗收敛为独立调用账本，修复账本日期筛选，统一默认范围、token 展示和下拉控件，移除用户无须关注的覆盖率噪音，并更新 Usage 图标；同时下线旧的全局 Session 扫描统计，但保留聊天顶栏依赖的单 Session / Studio child rollup 能力。

## 已核实现状

| 反馈 | 代码证据 | 结论 |
| --- | --- | --- |
| 时间筛选似乎无效 | `app/api/usage/calls/route.ts` 把日期解析为本地日边界；`lib/llm-usage-store.ts` 按 UTC 分区读取；`lib/llm-usage-query.ts` 读取后没有再按 `occurredAt` 精确过滤，并用 UTC 日期返回 range / 分组 | 根因明确：本地日与 UTC 分区混用，且缺少事件时间戳二次过滤，时区边界会读入相邻整日事件。 |
| 默认应为“全部” | `UsageProviderModelTable` 的 `workspaceFilter` 和 `resetFilters()` 在存在 `cwd` 时默认 `cwd` | 改为首次打开和重置都固定 `all`；“当前”仍可手动选择。 |
| token 需当前值 + M | 新账本仍有本地 `formatTokens()`，总量、拆分、模型表和 tooltip 多数只显示整数/百分比；`lib/token-format.ts` 已提供统一 exact/M/compact | 新账本必须接入共享 formatter，exact 为主、M 为次；紧凑位置可 compact，但必须有 exact。 |
| 下拉不统一 | 来源、状态使用原生 `<select>`；项目已有 `components/SelectDropdown.tsx` | 复用共享组件；如 26px 工具栏尺寸不适配，只给共享组件增加通用 `toolbar` size，不在 Usage 内复制 dropdown。 |
| 覆盖率声明噪音 | `UsageProviderModelTable` 展示 coverage warning banner、损坏文件计数和 legacy 口径 footer | 删除用户界面的覆盖率/兼容性声明；底层 API diagnostics 可保留用于排障和兼容。 |
| 图标需折线图 | `AppShell` 的 Usage 入口和两个 Usage modal header 都是纯美元符号 | 推荐统一为“统计折线 + 费用”语义图标；不据此新增第二套折线图数据可视化。 |
| 旧 Session 统计 | `UsageStatsModal` 同时承载 legacy/ledger tab；`GET /api/usage` 同时承载全局扫描与 `sessionId` rollup；`lib/usage-stats.ts` 同时承载两套聚合 | 只下线全局 legacy 页面和无 `sessionId` 的全局扫描；顶栏 `session_rollup`、`SessionStatsChips`、Studio child context/rollup 必须保留。 |

## 推荐下线边界

### 删除 / 退役

- UI：`Session 统计` tab、双视图切换、legacy 全局统计卡片/图表/Session 列表，以及对应 `components/UsageStatsModal.tsx` legacy 实现。
- API：`GET /api/usage` 无 `sessionId` 的全局日期聚合分支；缺失 `sessionId` 时返回明确 400，避免再次触发全库 Session 扫描。
- 聚合：`getUsageStats()` 及仅服务其结果的全局 byDay/byModel/byProvider/bySession/byParentSession 类型与辅助逻辑。
- 配置：`usage.statsSource` 不再选择 legacy/ledger，也不再关闭账本 recorder；旧字段只做一版兼容忽略，后续保存不再写出。
- 文档：删除“可切回 Session 统计”“statsSource 可关闭账本”的说明。

### 明确保留

- `GET /api/usage?sessionId=<id>` 及 `getUsageStatsForSessionRollup()`：继续服务 Chat 顶栏、`SessionStatsChips` 和 Studio parent/child rollup。
- `usage.includeArchived`：仍控制 session rollup 是否允许读取 archived Session；Settings 文案需从“Usage 弹窗扫描范围”改为“聊天顶栏 Session rollup 范围”。
- 独立账本 `usage-events/v1/`、`GET /api/usage/calls`、provider/model/source/status 聚合与诊断字段。
- 历史 Session JSONL 和 usage event 文件不迁移、不删除、不重算。

## 原型门禁

**触发。** 本任务删除可见 tab、改变筛选默认值与下拉交互、调整 token 信息层级、移除提示区并变更入口图标，属于页面/交互/信息结构变化。实现前必须由 `ui-designer` 基于现有页面交付 HTML 原型并取得用户审批。

当前 delegated child 没有 Studio 编排工具，且 child guard 禁止递归 Studio 派发，因此不能在本会话合法启动 `ui-designer`。主会话需按 [ui.md](ui.md) 的派发单启动 UI 设计员；在 HTML 原型和用户审批完成前，不得进入实现或 `awaiting_approval`。

## 待主会话 / 用户确认

1. **“增加折线图”语义**：推荐解释为 Usage 入口/header 图标增加折线走势语义；若实际要求是新增一种折线图可视化，需要扩展 PRD、API/图表状态和 HTML 原型。
2. **旧全局 API 行为**：推荐无 `sessionId` 的 `GET /api/usage` 返回 400 `sessionId is required`，而非保留隐式兼容或返回 410。
3. **`statsSource` 退役策略**：推荐旧字段读时忽略、API 不再投影、下一次保存配置时移除；ledger recorder 始终启用。
