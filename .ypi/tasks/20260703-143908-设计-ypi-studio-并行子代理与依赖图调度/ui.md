# ui

## 是否需要 UI 设计员

建议需要，但不是首版阻塞项。首版可由实现员使用现有 `SectionCard`、`Badge`、`TabButton` 风格完成；若要更强图形表达（大型 DAG、拖拽/缩放、泳道布局），再让 UI 设计员补 HTML 原型。

## 核心 UI 原则

- 全量可见：用户不应只能看到一个 selected subtask 或最近几个 running run。
- 状态先行：默认按 waiting/ready/queued/running/done/failed/blocked/skipped 展示任务，而不是按文件或成员运行时间。
- 原因透明：waiting 必须说明 “等待哪些依赖”；blocked/failed 必须说明 “由哪个依赖或 run 导致”。
- 异步不等于失败：async start 后未产生 final output 只显示为 queued/running，不显示 error 样式。
- Widget 做总览，Panel 做全量，Chat card 做单 run 调试入口。

## Studio Panel

### Tasks list

- 在每个 task 卡片追加 implementation status chips：`run N`、`queue N`、`wait N`、`fail N`、`done X/Y`。
- running/failed/blocked 任一非零时，列表项高亮但不改变工作流状态。

### Task overview

- `实现执行路线` 从 group-only 卡片升级为 DAG 摘要：
  - 节点显示 id、短标题、状态色。
  - 边显示 dependsOn。
  - 无图布局时用“阶段/并行组 + 依赖 chips”的列表兜底。
- 增加“等待原因摘要”：最多显示前 5 个 waiting/blocked/failed 节点及依赖原因。

### Implementation tab

首版结构：

1. 总览统计区：done/skipped、running、queued、waiting、ready、failed、blocked、maxConcurrency。
2. 状态泳道或可过滤表格：
   - `running`：subtask、member、runId、phase/current tool、t/s、开始时间。
   - `queued`：subtask、queuedAt、slot reason、runId（如已预分配）。
   - `waiting/pending`：subtask、`waitingOn` 依赖列表（每个依赖显示状态）。
   - `ready`：subtask、可调度原因。
   - `done/skipped`：完成时间、summary、validation。
   - `failed/blocked`：runId、blockedBy、error/blockedReason、重试提示。
3. 子任务详情抽屉/卡片：保留当前选中详情，但不作为唯一视图。
4. 可选操作（需要产品确认）：cancel running run、copy runId、open transcript。

## Floating widget

- 顶部保留 workflow flow-line。
- implementation 行从“当前/下一个/阻塞”升级为状态计数：`运行 2 · 队列 1 · 等待 4 · 失败 1 · 完成 3/10`。
- 下方展示所有非终态和失败项的紧凑列表；数量很多时 widget 内滚动，不隐藏状态类别。
- 每个条目显示：status dot、subtask id/title、waitingOn/phase/runId 短摘要。
- 点击任意位置打开 Studio panel 并定位 Implementation tab；失败/blocked 点击优先定位对应 subtask。

## Subagent chat/progress

- `ypi_studio_subagent(start_async)` 的 tool card 标题显示：member、runId、subtaskId、status、phase。
- Tool result 文案应是 “已异步启动/已排队”，不是 final output。
- 展开区显示：
  - task/subtask/runId；
  - poll 状态和最近 progress；
  - transcript path；
  - cancel/collect 指引（UI 按钮如实现）。
- 对于同一父会话的多个 async runs，ChatWindow/Widget 通过 task projection 轮询刷新，而不依赖工具调用还在 running。

## 需要原型化的问题

1. 大型 DAG（>20 subtasks）在 Panel 中用图、泳道还是表格作为默认？推荐表格/泳道默认，图作为摘要。
2. Widget 是否允许展示所有 subtasks？推荐只全量展示非终态和失败项；done 通过计数表达，Panel 提供全量 done 列表。
3. Cancel 按钮是否放在 Panel 中？推荐放，但必须确认。
