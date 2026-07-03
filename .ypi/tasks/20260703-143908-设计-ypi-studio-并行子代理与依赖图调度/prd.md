# prd

## 目标与背景

YPI Studio 已支持基础 implementationPlan 子任务拆解和单子任务 claim/update，但复杂任务需要多个 implementer/checker 子代理并行推进。当前 `ypi_studio_subagent` 同步等待子进程完成，导致父会话无法真正并行调度，也无法让用户实时看清所有子任务和子代理状态。

目标是在保留现有工作流和 approvalGate 的前提下，引入 DAG 子任务调度、异步子代理运行、全量 UI 可见性，让父会话可安全编排串行、并行和混合依赖任务。

## 范围内

- 将 implementation subtasks 统一为 DAG：`dependsOn` 是调度源，支持串行、并行、混合依赖。
- 扩展子任务状态、ready 判定、queued/running/done/failed/blocked 传播策略。
- 解决同步等待导致无法并行：支持异步启动、`runId` 持久记录、轮询/收割/取消。
- Studio panel、floating widget、subagent chat/progress 展示所有关键子任务/子代理状态，并解释 pending/waiting 原因。
- 兼容旧 implementationPlan/implementationProgress 和现有单子任务 claim/update。
- 增加必要的 pure scheduler 测试、类型检查和文档更新。

## 范围外

- 不改变 `awaiting_approval -> implementing` 的硬门禁语义。
- 不实现真正分布式队列；本轮以当前 Next.js/Node 进程内 runtime registry + task.json/transcript 持久投影为基础。
- 不引入大型图形库；首版可用 CSS/SVG/表格实现 DAG 可见性。
- 不自动提交、push、merge，也不自动做产品决策。

## 需求与验收标准

### R1 审批门禁保持不可绕过

- 验收：task 未处于 `implementing` 且无当前 context 的 approvalGrant 时，batch claim、async start implementer、done/failed/blocked 更新都失败。
- 验收：`override` 仍不能绕过 `awaiting_approval -> implementing`。
- 验收：绑定/继续当前聊天仍只绑定 context，不授予 approval。

### R2 DAG 模型和兼容性

- 验收：新计划使用 `subtasks[].dependsOn` 表示依赖；串行是链式 dependsOn，并行是多个节点共享相同 dependsOn，混合是任意无环图。
- 验收：schemaVersion 1 旧计划仍可读取；旧 `pending` 展示为 waiting，旧 `ready/running/done/blocked/skipped` 语义不变。
- 验收：schemaVersion 2 新计划保存时校验缺失依赖、重复 id、自依赖和环；错误信息可被 UI/工具结果直接展示。

### R3 Ready/queued/running 调度

- 验收：ready 判定为所有依赖已成功终态（默认 `done`，允许策略化接受 `skipped`）。
- 验收：支持按 `maxConcurrency` 批量返回 ready 子任务；已有 `implementation_next` 仍返回第一个 ready 子任务。
- 验收：`queued` 表示已被调度保留或等待 worker slot；`running` 表示已启动子进程；两者都计入并发占用。

### R4 失败与 blocked 传播

- 验收：子代理 failed/cancelled/waiting_for_user 会写回 run 状态和对应 subtask 状态。
- 验收：默认策略下，依赖 failed/blocked 的后继节点变为 blocked，并记录 `blockedBy` 与可读原因；无关并行分支不受影响。
- 验收：可配置 `failFast`；默认不取消无依赖关系的 running 子代理。
- 验收：失败子任务可人工重置为 ready 重试，blocked 子任务可在原因解决后恢复。

### R5 异步子代理生命周期

- 验收：`ypi_studio_subagent` 默认保持现有同步行为；显式 async start 会返回 `runId`，父会话可继续启动其他子任务。
- 验收：后台运行持续更新 `task.json.subagents`、`implementationProgress.subtasks[*].runIds/lastRunId/status` 和 transcript sidecar。
- 验收：提供 poll/collect/cancel；parent abort/session destroy 仍会取消当前 session 关联的 active child runs。
- 验收：服务重启/registry 丢失时，running/queued orphan 可被 poll/collect 标记为 runtime_lost，并给出重试/人工处理建议。

### R6 UI 全量可见

- 验收：Studio panel 的 task detail 可同时看到所有子任务，按 waiting/ready/queued/running/done/failed/blocked/skipped 展示并可过滤。
- 验收：waiting/pending 子任务展示等待的依赖节点及其当前状态；blocked/failed 展示 blockedBy、runId、错误摘要。
- 验收：floating widget 展示状态计数、所有 active/queued/waiting/failed 项摘要，并可点击进入 panel 查看全量 DAG。
- 验收：subagent chat/progress card 支持 async runId，不把“异步已启动但未完成”误判为失败；运行详情可从 task projection/transcript 刷新。

### R7 验证与文档

- 验收：新增 pure DAG/scheduler 测试覆盖 serial、parallel、mixed、cycle、failure propagation、concurrency slot。
- 验收：通过 `npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm run test:studio-policy` 和新增 scheduler 测试。
- 验收：更新 `docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`。

## 未决问题

1. 异步模式是否只通过显式 `mode/action=start_async` 使用，还是在有 implementationPlan 的 implementer 调度中默认 async？推荐：默认同步保持兼容，计划调度路径显式 async。
2. implementer 成功后是否自动将 subtask 标记 `done`？推荐：首版自动 done，并通过 `localReview` 或后续 checking 阶段做质量门禁。
3. UI 是否需要用户手动 cancel 按钮？推荐：提供，但加确认；无按钮也必须保留工具/API cancel。
4. 服务重启导致 running orphan 时使用 `failed(runtime_lost)` 还是 `blocked(runtime_lost)`？推荐：run 为 `failed`，subtask 为 `failed`，允许重试。
