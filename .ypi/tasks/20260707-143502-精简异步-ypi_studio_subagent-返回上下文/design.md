# Design — 精简异步 `ypi_studio_subagent` 返回上下文

## 阅读依据

已阅读并对齐：

- `docs/modules/library.md`：`lib/ypi-studio-extension.ts` 的工具契约、wait compact 约束、transcript sidecar 边界。
- `docs/modules/frontend.md`：`YpiStudioSubagentTranscript`、`YpiStudioWaitPanel`、`ChatWindow`/session widget 对 Studio tool details 的展示职责。
- `lib/ypi-studio-extension.ts`：`ypi_studio_subagent` / `ypi_studio_wait` 当前投影实现。
- `components/YpiStudioSubagentTranscript.tsx`：`details.run`、`details.task`、transcript ref、model/thinking、runId 的消费。
- `components/YpiStudioWaitPanel.tsx`：wait compact payload 消费。
- `components/ChatWindow.tsx`：live overlay 从 `details.run` / `details.task` 提取 task/run/progress/model 字段。

## 当前问题定位

### Async start 当前注入过厚

`ypi_studio_subagent(action=start, mode=async)` 当前 final result：

```ts
details: {
  action: "start",
  mode: "async",
  task: compactYpiStudioTaskForTool(root, taskAfterInitialRun),
  run: compactSubagentRunProjection(projectSubagentRun(root, taskId, runningRun)),
  wait: { tool: "ypi_studio_wait", taskId, runIds: [runId], until: "child_terminal" },
  warnings
}
```

主要膨胀来源：

- `compactYpiStudioTaskForTool()` 包含 artifacts 文件索引、implementation summary/progress/projection、subagents active/recent、recent events、nextRecommendedAction、readHints 等。
- `projectSubagentRun()` 默认读取 transcript preview；`compactSubagentRunProjection()` 会注入 `transcriptPreview` 和 `progress.itemsPreview`。
- 初始 `runningRun.progress.itemsPreview` 包含 delegated prompt preview；长 prompt 时会直接进入 start 结果。
- async 模式仍把 child runner 的 `onUpdate` 传给原 start tool，child 后续进展可能继续写入 start tool 的 partial result；但主流程实际应由 `ypi_studio_wait` 承接。

### UI 消费约束

- `YpiStudioSubagentTranscript`：当前 `normalizeRun()` 只读取 `run.id`，不读取 `run.runId`；若去掉 transcript ref，必须提供 `id` 或改为 `id ?? runId`。它需要 member/status/model/thinking/task/run/phase/summary 展示。
- `ChatWindow` live overlay：当前 runId 也优先读取 `run.id`，不读取 `run.runId`；轻量投影应提供 `id`，并建议 UI 兼容 `runId` fallback。
- `YpiStudioWaitPanel`：已能消费 compact wait payload，`run.runId` 是主要标识；不需要完整 task、events、transcript preview。

## 方案摘要

引入“按 action 分层”的 Studio subagent 工具投影：

1. **async start 使用极轻量 start projection**：只返回任务身份、运行身份、成员、模型/思考、启动时间、极短状态、wait 调用提示。
2. **async start 不再把 child 进展继续推给原 start tool**：仅发送一次轻量启动 `onUpdate`；child 进展继续持久化到 task/transcript/runtime registry，由 `ypi_studio_wait` 轮询并以 compact payload 返回。
3. **poll/collect/cancel 使用轻量 lifecycle projection**：返回任务身份 + run 状态/短 summary/error/小 progress；不返回 task compact、transcriptPreview、recent events、implementationProjection。collect terminal 可带短 `nextRecommendedAction`。
4. **wait 保持 compact，并避免无用读取 transcriptPreview**：wait payload 仍是主要进展通道；可给 wait run 增加 `id: runId` 小别名以兼容 ChatWindow overlay。
5. **UI 增强 runId/title 兼容**：`YpiStudioSubagentTranscript` 和 `ChatWindow` 同时接受 `run.id` 与 `run.runId`；subagent 卡片显示任务/子任务标题。

## 投影契约

### Task identity projection

用于 async start、poll/collect/cancel：

```ts
{
  id: task.id,
  key: task.key,
  title: task.title,
  status: task.status,
  workflowId: task.workflowId
}
```

明确不包含：`cwd`、`pathLabel`、`artifacts`、`events`、`subagents`、`implementationProjection`、`implementationPlan`、`documents`、`readHints`。

### Async start run projection

用于 `action=start, mode=async` final result 和启动 `onUpdate`：

```ts
{
  id: run.id,              // UI 兼容字段
  runId: run.id,           // 工具/人工可读字段
  taskId: task.id,
  taskKey: task.key,
  taskTitle: task.title,
  subtaskId: run.subtaskId,
  subtaskTitle,
  member: run.member,
  status: "running",
  model: run.model,
  thinking: run.thinking,
  modelSource: run.modelSource,
  thinkingSource: run.thinkingSource,
  runner: run.runner,
  startedAt: run.startedAt,
  progress: {
    phase: "starting",
    startedAt: run.startedAt,
    updatedAt: run.startedAt,
    eventCount: 0,
    lastTextPreview: "Async child Pi process starting."
  }
}
```

明确不包含：`prompt`、`policy` 完整诊断、`requestAffinity`、`childSessionId`/`childSessionFile`、`transcript`、`transcriptPreview`、`progress.itemsPreview`、`progress.warnings` 大数组、`summary` 长文本、`error`。

> SDK child session id/request affinity 通常在 child preflight 后才稳定；async start 阶段不需要注入。后续可通过 task detail/API/transcript debug 查看。

### Async start details 形态

```ts
{
  action: "start",
  mode: "async",
  projection: "ypi_studio_subagent_async_start_v1",
  task: taskIdentity,
  run: asyncStartRun,
  wait: {
    tool: "ypi_studio_wait",
    taskId,
    taskKey: task.key,
    runId,
    runIds: [runId],
    until: "child_terminal",
    recommended: true
  },
  warnings?: string[] // 仅短字符串；不放完整 policy diagnostics
}
```

### Poll/collect/cancel lifecycle run projection

用于 `action=poll|collect|cancel`：

```ts
{
  id: run.runId,
  runId: run.runId,
  taskId: run.taskId,
  taskKey: task.key,
  taskTitle: run.taskTitle,
  subtaskId: run.subtaskId,
  subtaskTitle: run.subtaskTitle,
  member: run.member,
  status: run.status,
  registryStatus: run.registryStatus,
  registryActive: run.registryActive,
  model,
  thinking,
  modelSource,
  thinkingSource,
  runner,
  startedAt,
  finishedAt,
  progress: {
    phase,
    updatedAt,
    eventCount,
    lastTextPreview: oneLine(..., 180),
    tokens,
    tps,
    currentTool,
    terminationReason
  },
  transcript?: transcriptRef,  // 小 metadata，可用于 terminal debug API；不含 preview/items
  summary?: oneLine(summary, 600),
  error?: oneLine(error, 800),
  terminationReason
}
```

明确不包含：`task` compact、`transcriptPreview`、`progress.itemsPreview`、recent events、implementationProjection、完整 policy diagnostics、requestAffinity 长说明。

### Wait projection

`ypi_studio_wait` 保持现有 compact 契约：task identity + run status/progress/短 summary/error/nextRecommendedAction。建议微调：

- `compactSubagentRunForWait()` 增加 `id: run.runId` 和 `taskKey` 小字段，提升 ChatWindow overlay 兼容性。
- `projectSubagentRun()` 支持 `includeTranscriptPreview: false`，wait 路径不要读取也不要构造 transcriptPreview。
- 不扩大 wait payload；如果要显示模型信息，优先由 start card或 session widget 显示，不把 wait 变厚。

## 数据流

1. `ypi_studio_subagent(start, async)` 创建 transcript sidecar、构造 `runningRun`、写入 `.ypi/tasks/<task>/task.json`。
2. 发送一次轻量 start `onUpdate`，用于 UI 立即显示“已启动”。
3. 启动 SDK/CLI child runner：
   - persistence callbacks 保持不变，持续写 task run progress/transcript sidecar/runtime registry。
   - async 模式传给 child runner 的 `onUpdate` 改为 `undefined` 或轻量 no-op，避免 child 进展继续注入 start tool。
   - sync 模式保持原 `onUpdate` 与最终 result 行为。
4. async start 立即返回轻量 details + wait 提示。
5. 主 Chat 调用 `ypi_studio_wait(runId)`；wait 从 task/runtime registry 读取进展，返回 compact terminal summary。
6. Debug/Raw 或任务详情页需要完整信息时，通过现有 transcript sidecar/API/task detail 路径读取，不经 async start result 注入。

## UI 兼容设计

### `YpiStudioSubagentTranscript.tsx`

- `normalizeRun()` 兼容 `id: asString(value.id) ?? asString(value.runId)`。
- 增加 `taskTitle` / `subtaskTitle` 到 `StudioRunProjection`，从 `details.run.taskTitle/subtaskTitle` 读取。
- Header/meta 中显示 `subtaskTitle ?? taskTitle ?? taskId`，保证轻量 start 卡片仍能显示标题。
- 保持没有 transcript ref 时的降级：async start 卡片只展示启动确认；后续进展由 wait 卡片显示。

### `ChatWindow.tsx`

- live overlay 的 runId 读取改为 `run.id ?? run.runId ?? progress.args.runId`。
- 可读取 `task.title ?? run.taskTitle`、`run.subtaskTitle`（如需传给 overlay type）。
- 对缺失 `progress.itemsPreview` 的轻量 start 不报错；用 result/partial content 或 `run.progress.lastTextPreview` 作为预览。

### `YpiStudioWaitPanel.tsx`

- 现有 normalizer 已支持 `runId` 与 compact progress；不需要结构性改动。
- 若 wait run 增加 `id`/`taskKey`，保持向后兼容。

## 兼容性

- 工具输入契约不变。
- `ypi_studio_wait` 调用契约不变。
- `.ypi/tasks/**/task.json` 和 transcript sidecar 写入不变。
- 同步 `ypi_studio_subagent` final result 暂不改变，降低回归风险。
- 旧会话中已有厚 details 仍由 UI normalizer 容错展示。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| async child 不再向 start tool 推送后续 progress，短时间内只有启动卡片 | 用户若不调用 wait 会少一个 live progress 来源 | prompt guideline 已要求立即 wait；session widget 仍可通过 task polling 显示；background continuation 保持 |
| 省略 transcript ref 后 start 卡片无法直接展开完整 transcript | async start 非主要进展入口 | wait/任务详情/API 保持；poll/collect terminal 可保留小 transcript ref |
| 某些模型依赖 async start 中的 task compact 做下一步判断 | 编排可能少 nextRecommendedAction | async start details 保留 wait hint；下一步应看 wait terminal 的 nextRecommendedAction；必要时可调用 `ypi_studio_task(current)` |
| UI 当前只识别 `run.id` | runId 显示缺失 | 轻量投影同时给 `id` 与 `runId`，并更新 UI fallback |
| poll/collect 变轻后调试信息减少 | Raw 面板信息少 | 保留 transcript ref metadata；完整内容走 transcript API/task detail |

## 回滚方案

- 将 async branch 的 result 恢复为 `compactYpiStudioTaskForTool + compactSubagentRunProjection`。
- 将 child runner async `onUpdate` 恢复为原始 `onUpdate`。
- 保留新增 UI fallback 不影响旧行为，可不回滚。

## 实现计划

详细 implementationPlan 已写入 `implement.md`，由主 session 保存为 Studio implementationPlan 后进入 `awaiting_approval`。