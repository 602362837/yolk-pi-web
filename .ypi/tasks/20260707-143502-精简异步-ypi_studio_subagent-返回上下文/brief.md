# Brief

## 背景
用户反馈：`ypi_studio_wait` 已做数据精简，但当前工作流中大多数 `ypi_studio_subagent` 都是 `action=start, mode=async`。异步指派完成后主 chat 实际会立刻转向 `ypi_studio_wait` 观察进展，因此 async start 工具结果中的大块 task/run 详情在 UI 上基本不可见、对编排价值有限，却会占据主会话上下文。

## 用户目标
精简异步 `ypi_studio_subagent` 向主 chat 注入的信息。用户理解 async start 只需要标题信息、模型信息、成员等启动确认字段；之后实际进展和结果均看 `ypi_studio_wait`。

## 范围
- 重点优化 `ypi_studio_subagent(action=start, mode=async)` 的 tool result/details。
- 保留主编排必需字段：runId、taskId/taskKey/title/status、member、model/thinking、subtaskId、wait 调用提示等。
- 避免把完整/较厚的 task compact、transcriptPreview、recent events、implementationProjection 等注入 async start 结果。
- 检查 `poll/collect/cancel` 是否也应同步使用更轻量投影，避免 wait 后 collect 再次膨胀上下文。
- 不破坏现有 UI 展示、Studio widget、wait 工具、transcript sidecar/API 和 SDK child session 能力。

## 非目标
- 不改 Studio 状态机和 approval gate。
- 不移除 transcript sidecar；完整调试信息仍通过 API/展开 Debug 获取。
- 不改变同步 `ypi_studio_subagent` 的行为，除非设计确认安全。

## 验收标准
- async start tool result 显著小于当前结果，只包含启动确认与后续 wait 所需字段。
- `ypi_studio_wait` 仍能按 runId 正常等待并返回 compact terminal summary。
- 主 Chat 的 `YpiStudioSubagentTranscript`/等待卡片/悬浮卡片不因字段精简报错，至少能显示成员、状态、模型、runId、标题。
- lint、TypeScript 检查通过。