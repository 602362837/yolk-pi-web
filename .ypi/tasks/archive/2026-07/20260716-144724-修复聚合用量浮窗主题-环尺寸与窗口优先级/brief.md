# Brief：修复聚合用量浮窗主题、环尺寸与动态窗口优先级

## 背景

任务 `20260716-103603-设置中增加模型用量组件聚合开关与顶栏聚合组件` 已实现聚合入口、N-ring、流光、hover/focus 生命周期、provider 分栏及无总环设计。用户验收后进一步明确：窗口不能按 provider 写死。GPT 账号可能只有 7d 而没有 5h，其他 provider 也可能返回单窗、混合窗口或无法证明周期的 bucket。当前代码虽然已开始反转外/内圈，但 GPT/Grok 仍在各自 adapter 中按固定字段顺序构造 layers，Kiro 也包含 `Limits=90d` 的猜测，因此仍不符合动态窗口规则。

## 目标

在不改变 quota API、账号操作、聚合开关和既有交互能力的前提下完成窄范围修复：

1. 每个 provider/account 只投影实际存在、allowlisted 且安全的窗口候选；不存在的窗口不补位。
2. 通用 projector 统一过滤候选并按可信 `durationMs` 从短到长排序：外圈最短，向内逐渐变长，中心跟随外圈。
3. 单个实际窗口就是单圈，例如 GPT only-7d、Grok only-week；多个可比较窗口才组成多圈。
4. 不可识别 duration 不参与排序；允许安全显示，但按明确降级策略进入单圈或详情，绝不依赖 provider 名、数组位置、remaining、reset 时间或 percent 猜顺序。
5. 聚合浮窗完整跟随 light/dark，中心文字保持高对比度，浮窗列头环目标 40px（最低 38px），并保留 hover/focus、220ms grace、非 accordion 分栏和响应式布局。

## 代码与产品证据

- `components/ProviderUsagePanelContract.ts` 已把 `layers[0]` 定义成外圈并锁定中心，但仍假定 provider adapter 已排好序；缺少统一候选窗口与排序/降级契约。
- `components/ChatGptUsagePanel.tsx` 的 `buildChatGptUsageRingUnit` 接受固定的 `hasFiveHour/hasSevenDay` 参数，并按 5h→7d 直接 push；only-7d 能单圈，但布局逻辑仍被 provider 写死。
- `components/GrokUsageProjection.ts` 按 weekly→monthly 直接 push；同样由 provider 决定圈顺序，而非通用排序器。
- `lib/kiro-usage-ring.ts` 已有 duration 抽取与短→长排序雏形，但把 `Limits` 人为解释为 90 天；该推断必须删除并迁入统一 projector 规则。
- `lib/quota-display.ts` 的 GPT tiers 是实际返回数组，名称是字符串；ring adapter 应遍历实际安全窗口并提供候选数据，而不是合成固定双窗。
- `components/ProviderUsageAggregatePanel.tsx` 仍有固定夜间 surface/按钮色；`ProviderUsageTrigger.tsx` 的 trigger 与 panel header 环目前同为 small 30px。
- 全局主题真源是 `app/globals.css` 的 `:root` 与 `html.dark`。

## 统一窗口与降级决策

### 可信 duration 证据

可接受：上游明确 duration 数值，或由共享 resolver 识别的规范 period token/label（如 `5h`、`seven_day`、`weekly`、`month`、`90m`）。provider adapter 只负责把实际 allowlisted 数据转成候选，不负责排序、外/内圈或中心选择。

不可接受：provider 身份、字段/数组位置、当前 percent、remaining、resetAt 距当前时间、resourceType、泛化 `Limits/quota` 文案。

### 通用 projector 策略

1. 先丢弃不存在、不安全或缺少可展示 id/label 的候选；percent 未知仍可保留为 `null`。
2. 仅有 1 个安全候选：无需比较周期，直接单圈；duration 可识别也可未知。
3. 有多个安全候选：仅将 duration 可信且 rank 唯一的窗口按短→长纳入圈；unknown duration 与 duration 并列冲突的窗口留在详情。
4. 多窗口中只有 1 个可安全排序窗口：该窗口降级为单圈，其余留在详情。
5. 多窗口中没有任何可安全排序窗口：不任意挑选，不显示 ring，使用安全 fallback，并在详情展示窗口。
6. 中心始终取最终 `layers[0]`；该层 percent unknown 时显示该层 label + `—`（Kiro 等可用同一 bucket 的安全 remaining），不得借内圈。

| 场景 | 结果 |
| --- | --- |
| GPT only-7d | 7d 单圈，中心 7d |
| Grok only-week | 周单圈，中心周 |
| mixed-window（输入顺序任意） | 通用 projector 按真实 duration 短→长，多圈与中心不受输入顺序/provider 影响 |
| 单个 unknown-duration 窗口 | 单圈；因为不存在排序歧义 |
| 多个窗口，部分 unknown | 可比较窗口排序成 N 圈；若只剩一个则单圈；unknown 留详情 |
| 多个窗口，全部 unknown | 无 ring，安全 fallback + 详情；不按数组位置挑中心 |

> “优先”仅指基于真实周期的固定展示顺序，不根据当前 percent 预测哪个限制一定先耗尽；每层 warning/danger 仍独立。

## 范围外

- 不新增或修改 quota API/schema、账号存储、轮询、缓存、failover 或设置项。
- 不新增跨 provider 总环、总百分比、刷新全部或 provider 联动。
- 不基于 reset 时间动态推导 duration，不根据 percent 动态重排。
- 不重做 provider 详情信息架构，不改变敏感字段 allowlist。

## UI 门禁

任务涉及主题、信息层级、环尺寸和可见降级状态，已触发 UI HTML 原型门禁。修订后的原型必须覆盖 light/dark、only-7d、only-week、mixed-window、unknown-duration、outer unknown、warning/danger 与 Desktop/640/375/320；用户审批后才可进入实现。
