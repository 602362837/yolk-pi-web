# Checks — 精简异步 `ypi_studio_subagent` 返回上下文

## 需求覆盖检查

- [ ] `ypi_studio_subagent(action=start, mode=async)` final result 使用 light projection。
- [ ] async start `details.task` 只包含 `id/key/title/status/workflowId`。
- [ ] async start `details.run` 包含 `id/runId/taskId/taskKey/taskTitle/member/status/model/thinking/startedAt/wait 所需字段`。
- [ ] async start 不包含 `implementationProjection/events/artifacts/subagents/transcriptPreview/progress.itemsPreview/full policy diagnostics`。
- [ ] async child 后续进展不继续注入 start tool；由 `ypi_studio_wait` 观察。
- [ ] `ypi_studio_wait` 仍能按 `runId` 等待并返回 compact terminal summary。
- [ ] `poll/collect/cancel` 不返回厚 task compact 或 transcriptPreview。
- [ ] UI 可显示成员、状态、模型、thinking、runId、任务/子任务标题。

## 自动验证

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## 人工验收

1. 查看 async start raw details：确认字段白名单符合设计。
2. 查看 wait 卡片：运行中显示状态/phase/current tool/tps，终态显示 summary/error/next action。
3. 查看 subagent start 卡片：即使无 transcript ref 和 itemsPreview，也不报错并显示 title/runId/model/thinking。
4. 查看 collect raw details：确认不会在 wait 后再次注入 implementationProjection/recent events/transcriptPreview。
5. 若使用 SDK runner，确认 child session 仍创建、task detail/transcript API 仍可查。

## 回归风险重点

- 同步 `ypi_studio_subagent` 的最终输出不应被意外压缩。
- transcript sidecar 写入与 API 读取不应受投影精简影响。
- approval gate、implementation subtask claim/update 不应受影响。
- ChatWindow overlay 不能依赖只存在于旧厚投影的字段。
- wait payload 不应为了补偿 start 变轻而重新变厚。