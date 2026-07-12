# Design - 改进实例执行作用域与 run 归属

## 方案摘要

保持“主任务是唯一顶层任务、所有 child run 保存在 `task.subagents`”的不变量。新增显式 `improvementId` 作为 run 的持久化作用域；实例的 `runIds` 是该全局审计表的稳定索引，不创建第二份 run 记录。

主任务 DAG 与改进实例 DAG 使用同一套 `normalizeImplementationPlan`、`rebuildImplementationProgress`、ready 选择和状态刷新逻辑，但 mutation 前必须显式解析作用域。无 `improvementId` 只访问主任务字段；有 `improvementId` 只访问 `instance.implementationPlan` / `instance.implementationProgress`。不能按 subtask id 猜测作用域。

## 影响文件与具体改动

### `lib/ypi-studio-types.ts`

- 在 `YpiStudioTaskSubagentRun` 增加可选 `improvementId?: string`，使 start、progress、final、cancel、runtime-lost 重放时均携带同一归属。
- 新增 `YpiStudioImprovementSubtaskClaimBody`，字段复用主任务 claim body：`cwd`、`action: "claim_improvement_subtask"`、`improvementId`、`subtaskId(s)`、`limit`、`runId(s)`、`status`、`message`、`contextId`。
- 给 `YpiStudioTaskImplementationSubtaskClaimBody` 保持原样；不把 `improvementId` 变成隐式可选参数，以便 API/tool action 可以拒绝混用的调用。

### `lib/ypi-studio-tasks.ts`

- 新增私有实例解析/断言 helper：确认 active 主任务、`improvements.instances` 归属、主任务 `status === "waiting_for_improvements"`、实例状态为可执行的 `implementing | checking`，并取得实例 plan/progress。实例没有 plan/progress 时返回明确错误。
- 扩展 `getNextYpiStudioImplementationSubtask(cwd, taskIdOrKey, { limit, improvementId? })`。有 `improvementId` 时从该实例的 plan/progress 调用 `selectReadyYpiStudioImplementationSubtasks`，结果返回主任务 detail、实例标识、实例 summary 和 ready subtasks；未传时保持现有主任务返回语义。
- 新增 `claimYpiStudioImprovementSubtask(taskIdOrKey, body)`。在 `withTaskMutationLock` 内以实例 plan/progress 执行与 `claimYpiStudioImplementationSubtask` 同样的 ready、依赖、并发槽、history、runId 去重和 event 写入；事件 `data` 必须包含 `improvementId`。该函数不得调用主任务 claim helper，也不得读取/修改主 `implementationProgress`。
- 将 `recordYpiStudioSubagentRun` 按 `run.improvementId` 分支：先验证实例存在且主任务仍在改进等待态，再对 `instance.runIds` 做 `Set` 去重追加；若 run 带 `subtaskId`，只在该实例 plan/progress 上更新 queued/running/done/failed/blocked 和 DAG 派生状态。无 `improvementId` 保留当前主 plan 分支字节级行为。
- `reconcileYpiStudioRuntimeLostSubagentRun` 继续通过 `recordYpiStudioSubagentRun` 回写，因此自动保留实例 run 归属和实例子任务失败状态。取消路径同理：run 对象展开时不得丢失 `improvementId`。

### `lib/ypi-studio-extension.ts`

- `StudioTaskToolInput`、normalizer、tool JSON schema 增加 `claim_improvement_subtask` action 和 `improvementId`。
- `implementation_next` 将 `improvementId` 透传给 library helper；等待原因读取选择对应 instance progress，而非主 progress。
- 新 action 调用 `claimYpiStudioImprovementSubtask`，回复/compact details 标出 `improvementId` 和实例 active/queued 子任务，避免主任务投影被误当作实例投影。
- `StudioSubagentInput`、normalizer、schema 增加 `improvementId`；`ChildRunMeta` 和所有 run snapshots/compact lifecycle projection 透传它。
- start 校验改为显式 scope：当主任务为 `waiting_for_improvements`，`subtaskId` 必须伴随 `improvementId`，并只在实例 plan 查找；禁止回退主 plan。带 `improvementId` 时要求实例可执行，implementer/checker 有实例 plan 时必须带 `subtaskId`，并在 async ready 情形调用新实例 claim helper。没有 `improvementId` 时维持原“主任务必须 `implementing`”检查。
- `buildMemberPrompt` 根据 `improvementId` 选择 instance artifacts、plan、progress 和 selected subtask，明确显示 `IMP-xxx` 作用域；不得将主 plan 内容注入改进 implementer/checker。
- `runningRun` 在首次 `recordYpiStudioSubagentRun` 前写入 `improvementId`。`persistRunSnapshot` 用已有 run 合并字段，SDK/CLI finalizer、同步 final、cancel、poll runtime-lost 均由此保持归属。

### `app/api/studio/tasks/[taskKey]/route.ts`

- 导入 `claimYpiStudioImprovementSubtask` 与其 body guard，并在主任务 claim 分支相邻处处理 `action: "claim_improvement_subtask"`。
- 使用既有 `authorizedCwd` 覆盖 request body 的 cwd。library helper 是最终状态/归属校验点；route 不自行解析实例。

### `scripts/test-ypi-studio-dag.mjs`

- 补充 library 契约测试：构造已批准且进入 `waiting_for_improvements` 的实例 plan，断言 ready 查询/claim 只改变 instance progress，主 plan 不变；错误的实例 id、主 plan id、未 ready id、错误 parent/instance 状态必须抛错。
- 以 `improvementId` 记录 running、succeeded 和 cancelled run，断言 `instance.runIds` 有且仅有各 run id、对应实例 progress 正确终态、另一个实例及主 progress 未被污染；重复终态写入仍不重复。

## 数据流和契约

`ypi_studio_task(implementation_next, improvementId)` -> `getNext...({ improvementId })` -> instance ready subtasks。

`ypi_studio_task(claim_improvement_subtask, improvementId, subtaskId)` 或 API PATCH -> `claimYpiStudioImprovementSubtask` -> instance progress/history + 主任务 events.jsonl。

`ypi_studio_subagent(start, improvementId, subtaskId)` -> scope validation -> optional instance claim -> first `recordYpiStudioSubagentRun` -> `task.subagents[]` + `instance.runIds[]` + instance progress -> SDK/CLI progress/final/cancel 使用同一 run 的 `improvementId` 回写。

实例 `runIds` 采用追加式审计索引：完成、取消、runtime-lost 不移除 id；它们只更新 `task.subagents` 中同 id 的状态及实例 progress。这保证 UI 可始终按索引看到历史运行。

## 兼容、风险与回滚

- 旧 run 没有 `improvementId`，继续按主任务路径解释；旧 improvement 的空 `runIds` 不做猜测性回填。
- 子任务 id 可以在主/实例 plan 重复，显式 scope 是唯一选择依据。
- 锁覆盖 claim 和 run 持久化，但 child 启动后若首次持久化失败，run 不应被报告为成功启动；extension 应返回错误并由现有 runner cleanup 路径处理。
- 回滚仅移除新 action/作用域分支；已写入的 `improvementId` / `runIds` 为 additive 审计字段，可安全忽略，不删除历史记录。
