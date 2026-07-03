# brief

## 任务

为 YPI Studio 设计“并行 subagent + 子任务依赖图调度 + UI 全量可见”方案，并产出 implementationPlan 草案；本轮只做规划，不实现。

## 已读材料

- `AGENTS.md`
- `docs/architecture/overview.md`
- `docs/modules/api.md`
- `docs/modules/frontend.md`
- `docs/modules/library.md`
- `docs/standards/code-style.md`
- 关键源码：`lib/ypi-studio-types.ts`、`lib/ypi-studio-tasks.ts`、`lib/ypi-studio-extension.ts`、`lib/ypi-studio-subagent-runtime.ts`、`lib/ypi-studio-transcripts.ts`、`lib/ypi-studio-session-link.ts`、`components/YpiStudioPanel.tsx`、`components/YpiStudioSessionWidget.tsx`、`components/YpiStudioSubagentTranscript.tsx`、`hooks/useAgentSession.ts`、`app/api/studio/tasks/[taskKey]/route.ts`。

## 现状判断

- `implementationPlan/implementationProgress` 已有基础拆解、`dependsOn`、`execution.groups`、单个 `next/claim/update` 流程，可作为兼容扩展基础。
- `selectNextYpiStudioImplementationSubtask()` 当前偏向“一个 ready 子任务”；`activeSubtaskId` 也偏单运行，需要扩展为 DAG 批量 ready 和多 active，而不是重写状态机。
- `ypi_studio_subagent` 当前同步等待 `runChildPi()` 完成，父会话被阻塞，无法连续启动多个子代理。
- UI 已展示部分执行路线、子任务与成员运行，但需要从“单选详情/最近 5 条”扩展到所有 running/queued/waiting/done/failed 子任务和依赖等待原因。
- `awaiting_approval -> implementing` 已有服务端 approvalGate/approvalGrant 硬门禁；新调度能力必须继续复用该门禁，不能通过 async start/claim 绕过。

## 推荐方向

- 将串行、并行、混合统一为 `subtasks[].dependsOn` 的 DAG；`execution.groups` 只作为 UI/可读分组投影。
- 在现有字段上做 schemaVersion 2 兼容扩展：新增 `waiting/queued/failed` 状态、多 active/runIds、waitingOn/blockedBy 原因、scheduler/maxConcurrency 元数据；保留 `pending/ready` 旧记录兼容。
- 扩展 `ypi_studio_subagent` 为默认同步、可选异步：`start_async` 返回 `runId` 后立即释放父会话；子进程后台运行并持续写入 task/subagent/transcript sidecar；提供 `poll/collect/cancel`。
- 增加批量 ready/claim/schedule 能力，父会话按 `maxConcurrency` 启动多个 ready 子任务，收割完成后继续释放后继节点。
- UI 以任务详情为权威轮询源：Studio panel 全量列表/DAG，widget 展示状态总览与所有非终态/失败项，subagent chat card 支持 async runId 和状态刷新。

## 约束

- 规划完成后应由主会话保存 implementationPlan，并进入/保持 awaiting_approval 等用户确认；未确认不得实现。
- 不修改生产代码、不提交、不推送。
- 不重写现有 YPI Studio 状态机；优先补充 pure helpers、类型、projection 和工具 action。
