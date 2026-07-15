# Design

## 方案摘要

全局 Usage 只保留 independent ledger；旧 `/api/usage` 缩减为 session rollup 专用入口。日期查询采用“本地日边界 → UTC 分区候选扫描 → occurredAt 精确过滤 → 本地日分组”的两层策略。UI 直接进入账本，默认全部工作区，复用共享 dropdown 与 token formatter，并隐藏 coverage/legacy 诊断噪音。

## 模块边界

### 1. 全局账本

- `components/UsageProviderModelTable.tsx`：唯一全局 Usage modal；承载筛选、summary、chart、provider/model 表和 drawer。
- `app/api/usage/calls/route.ts`：解析和验证本地日期/筛选；不依赖 Session inventory。
- `lib/llm-usage-query.ts`：event-level 过滤、聚合、日分组、缓存。
- `lib/llm-usage-store.ts`：继续只负责 UTC 分区候选读取与损坏文件隔离，不承担业务日期判断。

### 2. Session 顶栏 rollup

- `app/api/usage/route.ts`：只接受 `sessionId` 路径；不得再调用全局 `getUsageStats()`。
- `lib/usage-stats.ts`：保留 `UsageTotals`、`UsageSessionRollupResult`、`getUsageStatsForSessionRollup()` 及必要 helper；删除全局统计结果/聚合。
- `hooks/useAgentSession.ts`、`SessionStatsChips.tsx`、`ChatWindow.tsx`：契约不变，继续使用 selected/parent rollup fields。

### 3. 配置

- `lib/pi-web-config.ts`：`PiWebUsageConfig` 保留 `includeArchived`、price assistant 和 explicit-free 等现有 ledger/price 字段；退役 `statsSource` 的行为语义。
- `lib/llm-usage-recorder.ts`：移除 `statsSource === "ledger"` gate，默认并持续写账本；写失败仍不阻塞调用。
- `SettingsConfig.tsx`：`includeArchived` 文案改为 Session rollup 范围，不再称为全局 Usage 扫描范围。

## 日期数据流

```text
Browser date input (YYYY-MM-DD)
  -> /api/usage/calls
  -> parse local start/end instants
  -> queryLlmUsage({ fromInstant, toInstant, range labels/timezone })
  -> store scans every UTC YYYY-MM-DD partition intersecting instants
  -> query filters occurredAt >= from && <= to
  -> query groups accepted events by the same local calendar date
  -> API returns original from/to labels + actual timezone
```

关键点：UTC partition 只是索引，不是最终过滤条件。缓存 key 应包含完整 instant（ISO 或 epoch）、cwd/provider/model/source/status 和日期口径，不能只用 `formatUtcDate()` 以免时区边界碰撞。

## 日期 helper 归属

旧 `parseLocalDateParam()` 当前位于 `lib/usage-stats.ts`，会让 independent ledger 继续反向依赖 legacy Session 模块。建议抽到独立纯模块（例如 `lib/local-date-range.ts`）：

- `parseLocalDateParam(value, endOfDay)`
- `formatLocalDate(date)`
- 可选 `localTimeZone()`

`usage/calls` 和保留的 session rollup route 共用；删除旧全局统计后，账本不再导入 legacy 聚合模块。

## API 契约

### `GET /api/usage/calls`

请求不变：required `from`, `to`; optional `cwd`, `provider`, `model`, `source`, `status`。

响应 shape 保持 v1，行为修正：

- `range.from/to` 与请求日期相同；`range.timezone` 为实际 server-local timezone。
- `byDay[].date` 使用同一 local calendar semantics。
- `coverage` 字段暂保留兼容，但 UI 不消费。
- 非法/反向/超长范围仍为 400；内部错误不泄露路径。

### `GET /api/usage`

- 带 `sessionId`：现有 `session_rollup` 契约不变。
- 不带 `sessionId`：推荐 400 `{ error: "sessionId is required" }`，且不得扫描 sessions。
- 可选 from/to 如继续支持，必须使用抽出的日期 helper。

## UI 设计

- `AppShell` 直接打开账本 modal；删除 legacy view resolver、tab 和 fallback 默认 legacy。
- `workspaceFilter` 初始化和 reset 固定 `all`。
- 来源/状态使用 `SelectDropdown`。如需要 26px 控件，扩展 `size: "toolbar"`；portal z-index 继续高于 modal。
- token 显示统一从 `lib/token-format.ts` 导入：exact + M；账本在现有 byDay 数据上默认显示“使用量”SVG 折线趋势，可切换“费用”指标和柱状占比形态；两种形态均随指标重绘，tooltip/focus 以当前指标为主（费用为 `$x.xx`，使用量为 exact + M），另一指标作为次要信息，不改变 API shape。
- 删除 coverage banner、table footer 的 corrupt 数和 legacy compatibility footer；诊断仍在 API/log。
- icon path 由可复用 SVG/`ActionFlowIcon` geometry 提供给 sidebar 与 modal header，避免两个版本漂移。是否抽新组件由实现员依据复用量决定，不能复制多份不一致 path。

## 旧模块下线清单

| 层 | 下线 | 保留 |
| --- | --- | --- |
| UI | `Session 统计` tab、legacy cards/chart/session list、双视图 config resolution | ledger modal、Chat 顶栏 chips |
| API | `/api/usage` 无 sessionId global branch | `/api/usage?sessionId=`、`/api/usage/calls` |
| Library | `getUsageStats`、global result/types、global parent/session breakdown | session rollup types/helpers |
| Config | `statsSource` view/recorder selector | `includeArchived` rollup scope、pricing policy |
| Data | 无删除 | JSONL 与 ledger events 全保留 |
| Docs | legacy fallback/双视图/扫描说明 | session rollup 与 ledger 边界 |

## 兼容、迁移、回滚

- 数据迁移：无；历史文件不改写。
- API compatibility：`/api/usage/calls` shape additive/behavior fix；coverage 仍在 wire。旧无-session `/api/usage` 明确失败，属于批准后的 intentional retirement。
- 配置 compatibility：旧 `statsSource` 读取不报错但不生效；推荐在下一次 config save 时移除该已知退休键，其他未知字段不受影响。
- 回滚：恢复 legacy UI/API/global aggregator 和 statsSource gate 即可；无需回滚数据。日期修复可独立回滚，但不建议恢复错误边界。

## 风险与缓解

1. **server 与 browser 时区不同**：当前 API 没传 timezone。首版明确 server-local 口径并返回 timezone；如产品要求 browser-local，应另加 IANA timezone 参数和校验，不在本次猜测。
2. **`totalTokens` 与拆分和不等**：继续尊重 SDK authoritative total；exact/M 只改变显示，不重算。
3. **旧调用方依赖 global `/api/usage`**：仓库内搜索仅 `UsageStatsModal` 使用；实现前后再全仓搜索，文档明确 intentional 400。
4. **删除 global helper 误伤 rollup**：保留 rollup focused tests，按调用图小步删除。
5. **共享 dropdown 回归**：只增加向后兼容 size，不改变现有默认；键盘和 portal 手工验收。
6. **图表切换范围**：保留现网“使用量 / 费用”指标切换，并提供“折线趋势 / 柱状占比”形态切换；默认折线 + 使用量，均复用 byDay 数据，不引入图表库，并保持窄屏可读。入口/header 仍使用统一折线统计语义图标。
