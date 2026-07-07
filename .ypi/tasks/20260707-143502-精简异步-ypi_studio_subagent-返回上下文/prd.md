# PRD — 精简异步 `ypi_studio_subagent` 返回上下文

## 目标与背景

当前工作流中多数成员指派使用 `ypi_studio_subagent(action=start, mode=async)`，随后主 Chat 会立即调用 `ypi_studio_wait` 获取进展和终态。异步 start 结果仍注入较厚的 task/run 投影（任务 compact、recent events、implementationProjection、transcriptPreview、progress items 等），对编排价值低但占用主会话上下文。

目标是在不改变 Studio 状态机、wait 能力、子会话审计和 UI 展示的前提下，将 async start 的工具结果压缩为“启动确认 + wait 所需索引”。

## 范围内

- 精简 `ypi_studio_subagent(action=start, mode=async)` 的 final result 和启动阶段 `onUpdate` 投影。
- 保留启动编排必需字段：`runId`/`id`、`taskId`、`taskKey`、`task.title`、`task.status`、`member`、`model`、`thinking`、`subtaskId`、`startedAt`、`wait` 调用提示。
- 避免 async start 注入：完整 task compact、recent events、artifacts/document index、implementationProjection、subagents 列表、progress `itemsPreview`、transcriptPreview、完整 policy diagnostics、request-affinity 长说明。
- 同步检查并轻量化 `poll`/`collect`/`cancel`，避免 wait 后 collect 再次注入厚 task/run 投影。
- 保持 `ypi_studio_wait` 作为进展和终态的主要紧凑返回通道。
- 保持 transcript sidecar、transcript API、Studio widget、SDK child session 能力。

## 范围外

- 不改变 YPI Studio 状态机、approval gate、implementation DAG 语义。
- 不移除或弱化 transcript sidecar/API。
- 不改变同步 `ypi_studio_subagent` 的完整终态行为。
- 不把 wait 的 compact terminal summary 改回厚投影。

## 需求与验收标准

1. Async start 返回轻量启动确认。
   - 验收：`details.task` 仅为身份字段；`details.run` 仅为启动字段和极短 progress；无 `implementationProjection`、`events`、`artifacts`、`subagents`、`transcriptPreview`、`progress.itemsPreview`。
2. Async child 进展由 wait 承接。
   - 验收：async start 后 `ypi_studio_wait(runId)` 能继续按 runId 等待并返回 compact 进展/终态。
3. Poll/collect/cancel 不再次膨胀上下文。
   - 验收：这些 action 返回轻量 lifecycle run 投影和任务身份；collect 可给出短 summary/error/next action，但不注入 task compact 或 transcriptPreview。
4. UI 兼容轻量字段。
   - 验收：`YpiStudioSubagentTranscript`、`YpiStudioWaitPanel`、ChatWindow live overlay 至少能展示成员、状态、模型、thinking、runId、任务标题/子任务标题。
5. 验证通过。
   - 验收：`npm run lint` 与 `node_modules/.bin/tsc --noEmit` 通过。

## 未决问题

无阻塞产品问题。建议实现时保守保留同步 start 行为；如后续用户希望进一步压缩同步结果，应单独设计。