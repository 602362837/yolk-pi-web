# design

## 方案摘要

采用兼容扩展方案，不重写 YPI Studio 状态机：

1. 以 `implementationPlan.subtasks[].dependsOn` 作为唯一调度真源，统一串行、并行、混合依赖为 DAG。
2. 在现有 plan/progress 类型上增加 schemaVersion 2 可选字段和状态：`waiting`、`queued`、`failed`、多 active/runIds、waitingOn/blockedBy 原因；旧 `pending` 继续兼容并在 UI 显示为 waiting。
3. 保留 `implementation_next` / 单 claim 行为，同时新增批量 ready/claim/schedule helper，按 `maxConcurrency` 同时启动多个 ready 子任务。
4. 扩展 `ypi_studio_subagent`：默认同步保持兼容；显式 async start 返回 `runId` 后立即释放父会话，后台子进程持续写 task/subagent/transcript；提供 poll/collect/cancel。
5. UI 从“单个 active/selected subtask”升级为“任务级全量投影”：Panel 全量，Widget 总览+非终态/失败项，Chat card 绑定 runId 并可刷新。
6. 任何 claim/start/update 到实现子任务的路径继续要求主任务已合法进入 `implementing`；approvalGate/approvalGrant 逻辑不变。

## 影响模块和边界

### 类型与持久化

- `lib/ypi-studio-types.ts`
  - 扩展 implementation status union。
  - 扩展 plan/progress scheduler 字段、run 字段、widget projection 字段。
- `lib/ypi-studio-tasks.ts`
  - 负责 DAG normalize/validate、ready 判定、blocked propagation、批量 claim/update。
  - 保持旧 plan/progress 读取兼容。
- `.ypi/tasks/<task>/task.json`
  - 继续是任务状态与 subagent run 摘要的权威存储。
  - transcript 仍在 `.ypi/.runtime/studio-subagents/`。

### 子代理运行

- `lib/ypi-studio-extension.ts`
  - 扩展 `ypi_studio_task` 和 `ypi_studio_subagent` tool contract。
  - 将同步 `await runChildPi()` 抽象为可同步等待或后台执行的共同 run engine。
- `lib/ypi-studio-subagent-runtime.ts`
  - 从简单 abort registry 扩展为 active async run registry：status/progress/promise/result/cancel。
- `lib/ypi-studio-transcripts.ts`
  - 继续记录 transcript；支持 queued/running/failed 状态投影。

### API 与 UI

- `app/api/studio/tasks/[taskKey]/route.ts`
  - 支持批量 claim/status update action，或复用现有 PATCH validator 扩展。
- 可选新增 `app/api/studio/tasks/[taskKey]/subagents/[runId]/route.ts`
  - 用于 UI poll/cancel 单 run；transcript route 保持只读。
- `lib/ypi-studio-session-link.ts`
  - widget projection 增加所有非终态/失败 subtask 摘要和状态计数。
- `components/YpiStudioPanel.tsx`
  - task detail implementation tab 全量展示 DAG/status lanes。
- `components/YpiStudioSessionWidget.tsx`
  - 状态计数与所有 active/waiting/failed 摘要。
- `components/YpiStudioSubagentTranscript.tsx`、`components/ChatWindow.tsx`、`hooks/useAgentSession.ts`
  - async run card、task projection 轮询和进展刷新。

## 数据模型 / 文件契约

### Plan：DAG 真源

`subtasks[].dependsOn` 是调度源；`dependencies` 为兼容别名；`execution.groups` 只服务 UI/可读分组。

```ts
interface YpiStudioImplementationPlanV2 {
  schemaVersion: 2;
  maxConcurrency?: number;
  scheduler?: {
    mode: "dag";
    strategy?: "ready_fifo" | "priority";
    failFast?: boolean;
    defaultFailurePolicy?: "block_dependents" | "manual";
  };
  execution?: {
    mode: "serial" | "parallel" | "mixed";
    maxParallel?: number;
    groups?: YpiStudioImplementationExecutionGroup[];
  };
  subtasks: Array<YpiStudioImplementationSubtaskPlan & {
    dependsOn: string[];
    member?: "implementer" | "checker" | string;
    priority?: number;
    failurePolicy?: "block_dependents" | "manual" | "allow_dependents_when_skipped";
    retry?: { maxAttempts?: number };
  }>;
}
```

兼容规则：

- schemaVersion 1：继续允许缺失/非法依赖被过滤的旧行为；UI 标注为 legacy。
- schemaVersion 2：保存时拒绝重复 id、自依赖、缺失依赖、环。
- `relation/parallelGroup/execution.groups` 不影响 ready 判定，只影响展示和默认排序。

### Progress：多 active + 原因投影

```ts
type ImplementationStatus =
  | "pending"      // legacy alias, UI shows as waiting
  | "waiting"
  | "ready"
  | "queued"
  | "running"
  | "done"
  | "failed"
  | "blocked"
  | "skipped";

interface YpiStudioImplementationProgressV2 {
  schemaVersion: 2;
  activeSubtaskId?: string;      // legacy: last/primary active
  activeSubtaskIds?: string[];   // all running subtasks
  queuedSubtaskIds?: string[];
  nextSubtaskId?: string;        // legacy first ready
  nextSubtaskIds?: string[];     // ready batch preview
  counts: Record<ImplementationStatus, number>;
  subtasks: Record<string, YpiStudioImplementationSubtaskProgress & {
    status: ImplementationStatus;
    waitingOn?: Array<{ id: string; title?: string; status: ImplementationStatus }>;
    blockedBy?: string[];
    currentRunId?: string;
    queuedAt?: string;
    claimedAt?: string;
    claimedByContextId?: string;
    member?: string;
    terminationReason?: string;
  }>;
}
```

`waitingOn/blockedBy` 可由 plan+progress 派生，建议在 read/detail projection 时刷新，避免持久字段过期；关键 blockedReason/error 仍持久化。

### Run：异步生命周期

扩展 `YpiStudioTaskSubagentRun`：

- `status` 支持 `queued`（或用 subtask queued + run running；推荐 run 也支持 queued 便于 UI）。
- `subtaskId`、`runId` 已存在/可复用。
- 新增可选：`parentToolCallId`、`async: true`、`collectedAt`、`terminationReason`、`progress`。

## 状态流转

### 子任务状态

```text
waiting/pending --deps satisfied--> ready
ready --scheduler reserves slot--> queued
queued --child spawned--> running
queued --cancel/start failed--> failed | ready
running --child succeeded--> done
running --child failed/cancelled/runtime_lost--> failed
running --child waiting_for_user--> blocked
failed --manual retry--> ready
blocked --manual unblock/replan--> ready | skipped
ready/queued/running --manual skip--> skipped
```

### Ready 判定

一个 subtask 可 ready，当且仅当：

1. 当前状态为 `waiting`/legacy `pending`/可重试的 `failed` 被手动置回 ready；
2. 所有 `dependsOn` 节点处于成功终态：默认 `done`，若依赖被明确 `skipped` 且策略允许，则也视为满足；
3. 没有依赖处于 `failed`/`blocked`；否则该 subtask 进入/保持 `blocked` 并记录原因；
4. 当前 `queued + running` 数小于 `maxConcurrency` 时才可进入 queued/running。

### 失败传播

- 默认 `defaultFailurePolicy=block_dependents`：依赖 failed/blocked 后，所有非终态后继节点变为 blocked，`blockedBy` 指向失败依赖。
- `failFast=false` 默认：无依赖关系的 running 子代理继续执行。
- `failFast=true`：同一 implementationPlan 中尚未完成的 queued/running 可被取消，取消原因写入 run/subtask。
- `waiting_for_user` run 不应长期挂起：run 状态 `waiting_for_user`，subtask `blocked`，reason 写用户输入请求。

## Tool/API 契约

### `ypi_studio_task`

保留现有 action；新增/扩展：

- `implementation_next(limit?: number, includeWaitingReasons?: boolean)`：旧调用返回 first ready，新调用可返回 ready batch。
- `claim_implementation_subtasks(subtaskIds?: string[], limit?: number, runIds?: string[])`：原子批量 claim/queue；必须 task.status=`implementing`。
- `update_implementation_subtask` 接受 `queued/failed/waiting` 以及 `blockedBy/terminationReason`。
- 可选 `implementation_reconcile`：poll 前刷新 derived ready/waiting/blocked 状态。

### `ypi_studio_subagent`

推荐扩展输入：

```ts
{
  action?: "start" | "poll" | "collect" | "cancel";
  mode?: "sync" | "async";
  member?: string;
  prompt?: string;
  taskId?: string;
  subtaskId?: string;
  runId?: string;
  runIds?: string[];
  cancelReason?: string;
}
```

兼容规则：

- 旧输入无 `action/mode`：按当前同步行为执行。
- `action=start, mode=async`：验证 task/subtask/approval/claim 后创建 runId，写 queued/running run，启动后台 child，立即返回 `{ runId, status }`。
- `poll`：返回 run 当前 task.json/registry/transcript 投影，不阻塞。
- `collect`：返回已完成 run 的 final summary，并确保 subtask 状态已收割；未完成则返回 running/queued。
- `cancel`：取消 registry 中 child；若 registry 不存在但 task.json 仍 running，标记 runtime_lost/cancel requested。

## 异步运行策略

1. `start_async` 生成 runId，创建 transcript writer，先记录 run=`queued` 或 `running`。
2. 启动 child process 后 registry 记录 `{runId, taskId, subtaskId, member, parentSessionId, status, abort, promise}`。
3. child stdout parser 复用现有 `runChildPi` 逻辑；每次 progress 更新写 task run summary 和 transcript preview。
4. child close/fail/cancel finalizer：
   - 写最终 run；
   - 若绑定 subtask：成功 -> done，失败/取消 -> failed，waiting_for_user -> blocked；
   - 刷新 derived ready/blocked，释放后继 ready；
   - append task event。
5. `poll/collect` 调用 reconcile：发现 task.json running 但 registry 无 handle 且超出 grace，标记 runtime_lost。
6. parent abort/session destroy 调用现有 `abortYpiStudioChildRunsForSession`，扩展为同时写 run/subtask 取消结果。

## UI 投影

- Detail API 返回：`implementation.statusCounts`、`subtasks[]` 全量投影、`waitingOn/blockedBy`、`runsBySubtask`。
- Widget API 返回 bounded 但覆盖所有非终态/失败项；done 以计数表达，Panel 显示全量 done。
- ChatWindow 在存在 Studio task running/queued 时，对 `/api/sessions/[id]/studio-task` 或 task detail 做短周期轮询；无 active runs 后降频/停止。

## 兼容性、风险、回滚

### 兼容性

- 旧 schemaVersion 1 task.json 不迁移也可读；保存新 plan 时才写 schemaVersion 2。
- 旧 `implementation_next`、单 `claim_implementation_subtask`、同步 `ypi_studio_subagent` 保持可用。
- UI 必须同时识别 `pending` 和 `waiting`。

### 风险

- 多会话同时 claim 同一任务可能抢占：需要 task 级 in-process mutex；跨进程仍有小概率，需要后续文件锁增强。
- Next.js 热重载/服务重启会丢失 registry：通过 runtime_lost reconcile 降级处理。
- Async run finalizer 写 task.json 频繁：progress 写入要节流；transcript 继续承载细粒度日志。
- 自动 done 可能掩盖实现质量：通过 `localReview.required` 和 checking 阶段兜底。

### 回滚

- 关闭/不使用 `mode=async` 即回到同步行为。
- 新状态可降级：`queued/running` cancel 后设 failed，`waiting` 可按 legacy pending 展示。
- 如 UI 图形有问题，保留表格/状态泳道作为主视图。
