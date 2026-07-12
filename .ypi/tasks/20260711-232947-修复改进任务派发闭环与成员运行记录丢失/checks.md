# Checks - 改进派发闭环与运行记录

## 自动检查

- `npm run test:studio-dag`
- `npm run lint`
- `node_modules/.bin/tsc --noEmit`

## 契约检查

- `implementation_next` 未传 `improvementId` 时仍只返回主任务 ready 子任务。
- `implementation_next(improvementId)` 只返回该实例 ready 子任务，并在实例无 plan、未知 id、主任务不在 `waiting_for_improvements` 或实例不在 `implementing/checking` 时拒绝。
- `claim_improvement_subtask` 只修改 `instance.implementationProgress`，不修改 `task.implementationProgress`；并保持依赖和 `maxConcurrency` 约束。
- 同一个 `subtaskId` 同时存在于主/实例 plan 时，主任务等待改进期间未带 `improvementId` 的 subagent start 不能启动；带错误实例 id 也不能启动。
- implementer/checker 对有实例 plan 的执行必须带 `improvementId + subtaskId`；实例外或未 claim 的子任务不能绕过 claim。
- `recordYpiStudioSubagentRun` 的 scoped running/succeeded/cancelled/runtime-lost 回写都保留 run 的 `improvementId`，只更新对应实例 progress。
- 初始 start、progress/final、重复 final、cancel 均使 `instance.runIds` 包含 run id 一次；不同实例不能共享或覆盖 run id。

## API 与人工烟测

- PATCH `claim_improvement_subtask` 使用授权后的 cwd，未知 improvementId 返回错误且不写 task.json。
- tool schema 能接受 `improvementId`，async start 回包、poll/collect/cancel 回包均显示相同实例归属。
- 在 `waiting_for_improvements` 创建主 plan 与实例 plan 的相同 id，确认错误调用没有启动 child process、没有变更主 progress。
- 通过实例 claim 启动一个 async implementer，再 cancel 或让其完成；改进详情的成员运行过滤能按 `instance.runIds` 显示该 run。

## 回归重点

- 主任务 `implementing` 的 existing `claim_implementation_subtask`、并行 ready batch、SDK/CLI fallback、subagent cancel/poll/collect 不需要 `improvementId`，行为不变。
- 旧 task.json（无 `improvements`）和旧 run（无 `improvementId`）可读取、可继续主任务运行。
- archive task、跨 task improvementId、以及非法 body 均不得写入实例或主任务 run 状态。
