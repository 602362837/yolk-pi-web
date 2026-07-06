# Design：YPI Studio implementationPlan 自动续跑 / continuation orchestration

## 证据与现状

已阅读：`docs/architecture/overview.md`、`docs/modules/api.md`、`docs/modules/frontend.md`、`docs/modules/library.md`、`docs/standards/code-style.md`，并检查了核心源码：

- `lib/ypi-studio-extension.ts`：已提供 `ypi_studio_task`、`ypi_studio_subagent`，async start 会启动 child Pi 并立即返回；`poll/collect` 只在后续主回合被调用时刷新。
- `lib/ypi-studio-tasks.ts`：已有 `implementationPlan`/`implementationProgress`、DAG readiness、`maxConcurrency`、claim/update、subagent run 持久化和 projection。
- `lib/ypi-studio-subagent-runtime.ts`：已有进程内 active child run registry 与 abort 能力。
- `components/YpiStudioPanel.tsx`、`components/YpiStudioSessionWidget.tsx`、`components/AppShell.tsx`：已有 running/queued/subtask projection 与轮询，但缺少 orchestrator 状态与 Chat 后台语义。
- `lib/rpc-manager.ts`：`AgentSessionWrapper.destroy()` 当前会按 parent session abort Studio child runs；自动后台模式必须避免“Chat wrapper idle destroy = 后台任务被误杀”。

## 方案摘要

新增一个 **YPI Studio Implementation Orchestrator**，作为受控后台编排器，而不是依赖用户反复输入“继续”：

1. 主 session 在用户 approval 后将 task 合法转入 `implementing`，再显式启动 implementation orchestrator。
2. orchestrator 读取 `implementationPlan`/`implementationProgress`，按 DAG + `maxConcurrency` 选择 ready subtasks。
3. 每个 subtask 仍启动一个独立 implementer child run，并绑定 `subtaskId`。
4. child run terminal 后通过回调/监控触发 orchestrator tick：持久化结果、刷新依赖、继续派发下一批 ready subtasks。
5. 遇到失败、blocked、waiting_for_user、manual validation、无 ready 但未完成等真正需要人工决定的边界时停止自动派发并进入 `needs_attention`；正常实现完成后继续进入 checking 并派发 checker。
6. Chat/Widget/Panel 使用后端 projection 显示“后台自动推进中 / 用户已停止 / 正在检查 / 需要关注 / 已完成”，不再把主模型回合结束误解为整个 Studio 停止。

推荐采用 **确定性 orchestrator + 关键阶段 Chat continuation/notification**：中间调度不唤醒 LLM，避免 token 浪费和重复推理；实现完成进入检查、检查完成或需要人工关注时再让主 session 解释状态或请求决策。

## 影响模块和边界

| 模块 | 影响 |
| --- | --- |
| `lib/ypi-studio-types.ts` | 增加 optional orchestrator 状态、attention reason、projection 类型；旧任务字段缺失时视为 manual/idle。 |
| `lib/ypi-studio-tasks.ts` | 持久化/更新 `task.meta.implementationOrchestrator`；在 detail/widget projection 中派生 orchestrator、ready/blocked/runs 状态。 |
| `lib/ypi-studio-subagent-runtime.ts` | 给 child run handle 增加 managedBy/continuation metadata；区分 chat-managed 与 orchestrator-managed abort。 |
| `lib/ypi-studio-subagent-runner.ts`（新增） | 从 extension 抽出 child Pi 启动、prompt 构建、transcript/progress persistence，供 tool 和 orchestrator 复用。 |
| `lib/ypi-studio-orchestrator.ts`（新增） | 进程内 continuation registry、tick lock、run terminal callback、watchdog/recovery、start/pause/resume/cancel API。 |
| `lib/ypi-studio-extension.ts` | tool adapter 调用 runner/orchestrator；新增 `implementation_autorun_*` tool actions；保留现有 sync/async/poll/collect。 |
| `app/api/studio/tasks/[taskKey]/route.ts` | PATCH 增加 orchestrator start/pause/resume/cancel/status；GET 返回 projection。 |
| `app/api/sessions/[id]/studio-task/route.ts` | widget projection 包含 orchestrator 状态。 |
| `components/ChatWindow.tsx` / `components/AppShell.tsx` | 新增 Studio background banner/status；agentRunning 与 studioBackgroundRunning 分离。 |
| `components/YpiStudioPanel.tsx` | Implementation tab 增加 orchestrator card、controls、attention hints。 |
| `components/YpiStudioSessionWidget.tsx` | 显示自动续跑 badge/pulse、active/ready/blocked counts、attention message。 |
| Docs/tests | 更新模块文档，新增/扩展 Studio policy/task tests。 |

## 数据契约

### 持久化字段（建议存放于 `task.meta.implementationOrchestrator`）

```ts
interface YpiStudioImplementationOrchestratorState {
  schemaVersion: 1;
  mode: "manual" | "auto";
  status:
    | "idle"
    | "auto_running"
    | "dispatching"
    | "waiting_runs"
    | "stopped_by_user"
    | "checking"
    | "needs_attention"
    | "completed"
    | "cancelled"
    | "failed";
  contextId?: string;
  parentSessionId?: string;
  enabled: boolean;
  maxConcurrency: number;
  generation: number;
  activeRunIds: string[];
  readySubtaskIds: string[];
  blockedSubtaskIds: string[];
  lastTickAt?: string;
  nextTickAt?: string;
  updatedAt: string;
  attention?: {
    reason:
      | "approval_required"
      | "child_failed"
      | "child_cancelled"
      | "waiting_for_user"
      | "runtime_lost"
      | "dependency_blocked"
      | "manual_validation_required"
      | "checker_required"
      | "no_ready_with_unfinished"
      | "task_not_implementing"
      | "orchestrator_error";
    message: string;
    subtaskIds?: string[];
    runIds?: string[];
    createdAt: string;
  };
}
```

选择 `meta` 而非直接塞进 `implementationProgress` 的原因：orchestrator 是控制面状态，subtask progress 是执行事实；这样旧 progress normalizer 更易兼容，且归档时自然保留控制面审计。

### Projection 字段

在 `YpiStudioImplementationProjection` 增加 optional：

```ts
orchestrator?: {
  mode: "manual" | "auto";
  status: YpiStudioImplementationOrchestratorState["status"];
  attentionLevel: "none" | "working" | "paused" | "needs_user" | "error" | "done";
  message: string;
  activeRunIds: string[];
  readySubtaskIds: string[];
  blockedSubtaskIds: string[];
  canStart: boolean;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
  updatedAt: string;
  attention?: YpiStudioImplementationOrchestratorState["attention"];
}
```

Widget projection 只携带上述 compact 字段和已有 `statusCounts/activeSubtaskIds/queuedSubtaskIds/nextSubtaskIds/nonTerminalSubtasks`，避免传输 artifact body 或完整 transcript。

## 后端运行流

### 1. 启动自动续跑

入口：

- Tool：`ypi_studio_task(action="implementation_autorun_start", taskId?, maxConcurrency?, reason?)`
- API：`PATCH /api/studio/tasks/[taskKey] { action: "implementation_autorun_start", cwd, contextId }`

启动前置条件：

1. task 存在、未归档。
2. task.status 必须是 `implementing`。
3. task 必须有合法 `implementationPlan` 和 `implementationProgress`。
4. `awaiting_approval -> implementing` 的 approvalGrant 已由现有 transition 逻辑保证；start 仍应在错误信息中明确 approval gate。
5. 若已有 active orchestrator，同一 generation 幂等返回当前状态；不同 context 需要明确 resume/override，不隐式抢占。

启动动作：

- 写入 `meta.implementationOrchestrator`：`mode=auto,status=auto_running,enabled=true,generation++`。
- 注册进程内 continuation handle：`globalThis.__ypiStudioImplementationOrchestrators`。
- 立即 schedule tick（microtask/短 timeout），并记录 task event `orchestrator_start`（可复用 event type `note`，data.type 标识）。

### 2. Tick 算法

伪代码：

```text
tick(cwd, taskId, generation):
  acquire per-task orchestrator lock
  read latest task detail
  if no orchestrator/enabled/generation mismatch -> stop
  if archived/cancelled/completed -> mark cancelled/completed and stop
  if status != implementing -> needs_attention(task_not_implementing) and stop

  reconcile active runs:
    - persisted running/queued with missing runtime handle -> runtime_lost -> record failed
    - terminal run finalization already persisted by child onFinal, but tick is idempotent

  refresh implementation DAG/projection
  if any failed/blocked/waiting_for_user boundary requiring human -> needs_attention and stop
  if manual validation boundary reached -> needs_attention(manual_validation_required) and stop
  if all implementation subtasks done/skipped -> transition to checking and dispatch checker automatically

  slots = maxConcurrency - count(running + queued)
  ready = selectReadyYpiStudioImplementationSubtasks(limit=slots)
  if ready empty:
    if active runs exist -> waiting_runs and schedule watchdog
    else if unfinished exists -> needs_attention(no_ready_with_unfinished)
    else completed

  for each ready subtask up to slots:
    runId = deterministic unique id for subtask attempt
    claim subtask with status=running, runId
    start orchestrator-managed implementer child run for exactly this subtaskId
    persist running run and attach onFinal -> schedule tick

  update orchestrator activeRunIds/readySubtaskIds/blockedSubtaskIds/lastTickAt/status
  release lock
```

### 3. Child run 启动复用

当前 child process 逻辑在 `ypi-studio-extension.ts` 内部，orchestrator 不能安全复用。建议抽出：

- `buildYpiStudioMemberPrompt(root, taskId, member, delegatedPrompt, subtaskId?)`
- `startYpiStudioMemberRun({ root, taskId, member, prompt, subtaskId, mode, managedBy, parentSessionId, contextId, runId, policyInput, signal, onProgress, onFinal })`
- `projectYpiStudioSubagentRun(...)`

Tool `ypi_studio_subagent` 成为 adapter；orchestrator 直接调用 runner，确保 sync/async/manual/auto 使用同一 transcript、policy、progress、limits、waiting_for_user 处理。

### 4. Terminal callback / continuation

`runChildPi` finalizer 当前会 `recordYpiStudioSubagentRun`。新增：

- 若 handle `managedBy === "studio-orchestrator"`，`onFinal` 后调用 `notifyYpiStudioImplementationRunTerminal(cwd, taskId, runId, generation)`。
- `notify...` 只 schedule tick，不直接递归 dispatch，避免深调用栈和锁重入。
- watchdog 作为兜底：active orchestrator 每 5-10 秒检查 running runs，处理 missed callback/runtime_lost。

### 5. Chat continuation / 用户通知

中间每个 subtask 完成不唤醒 LLM，只更新 task projection。

在以下 terminal boundary 可发一次 Chat continuation/notification：

- `checking`：实现子任务全部完成并已进入检查，提示正在检查。
- `completed`：实现与检查均完成，提示任务完成或等待最终归档。
- `needs_attention`：失败、waiting_for_user、manual validation、checker 发现必须人工决策的问题等。
- `failed/cancelled`：明确建议恢复、重试或取消。

实现选项：

1. 若 parent `AgentSessionWrapper` 存活且未 streaming，调用 `inner.followUp()` 发送一条简短 Studio continuation prompt，让主 session 汇总状态并询问/执行下一步。
2. 若 session 不存活或正在运行，只写入 orchestrator attention；UI 通过轮询显示“需要关注”。
3. continuation prompt 必须说明不得绕过 approval，不得重新派发已完成 subtask；只处理当前 orchestrator terminal boundary。

## UI / 交互设计

无需单独 UI 设计员做高保真原型；本轮是在现有 Chat banner、Session Widget、Studio Panel 上增加状态表达和控制。但实现前建议由实现员按现有组件风格做轻量 UI，并由检查员做人工验收。

### Chat 状态语义

新增独立于 `agentRunning` 的 `studioBackgroundState`：

| 状态 | 文案要点 | 用户动作 |
| --- | --- | --- |
| awaiting_approval | “等待你确认方案；确认前不会实现。” | 确认/修改 |
| manual_async_running | “已启动当前子任务后台运行；后续不会自动继续，需输入继续或开启自动续跑。” | 开启自动续跑/继续 |
| auto_running / waiting_runs | “Studio 后台自动续跑中：运行 N，队列 M，就绪 K。可等待，完成或需要关注会提示。” | 暂停/打开面板 |
| stopped_by_user | “你已让 Studio 停止继续派发新任务；正在跑的任务状态会保留。” | 继续跑/取消 |
| checking | “实现已完成，Studio 正在检查。” | 等待/打开面板 |
| needs_attention | “Studio 需要你处理：原因 + subtask/run。” | 打开面板/继续/重试 |
| completed | “实现和检查已完成。” | 总结/归档 |

Chat 输入不应被后台自动推进禁用；placeholder 应用人话提示“Studio 还在后台跑，你可以等待，也可以告诉我先停一下/继续跑/重试”。不要在面向用户的文案里使用 Abort、managed run 等内部术语。

### Studio Panel

Implementation tab 增加 “自动续跑”卡片：

- mode/status/attention badge。
- maxConcurrency、activeRunIds、readySubtaskIds、blockedSubtaskIds、lastTickAt。
- controls：开始后台推进、先停一下、继续跑、取消正在跑的任务、查看失败日志。
- needs_attention 时展示原因、关联 subtask/run 和推荐动作。

任务列表增加 chips：`后台推进中`、`用户已停止`、`正在检查`、`需要关注`、`已完成`。

### Session Widget

- 顶部/实现摘要旁显示 orchestrator badge。
- auto_running 时使用轻微 pulse，但不要复用主 agent “Thinking...” 语义。
- needs_attention 使用 warning/error 色，并优先显示 attention message。
- AppShell 轮询条件从 “active runs or chatAgentRunning” 扩展为 “active runs or orchestrator working/needs_attention”。

## API / Tool 合约

### `ypi_studio_task` 新 actions

- `implementation_autorun_start`
- `implementation_autorun_pause`
- `implementation_autorun_resume`
- `implementation_autorun_cancel`
- `implementation_autorun_status`

返回：`{ task, orchestrator, warnings? }`，错误时 `isError=true` 且不修改 subtask run。

### `ypi_studio_subagent` 兼容增强

- 保留 `start/poll/collect/cancel`。
- 可选 `autoContinue?: boolean` 只作为兼容桥：当手动 async start 传入 true 时注册/唤醒 orchestrator；推荐路径仍是 `implementation_autorun_start`。
- `poll/collect` 对 auto-run 创建的 run 仍可读取 projection，但不负责推进 DAG。

### API PATCH

`PATCH /api/studio/tasks/[taskKey]` 新增 action 分支，供 Panel 控制：

```json
{ "cwd": "...", "action": "implementation_autorun_pause", "contextId": "pi_<sessionId>", "reason": "user paused" }
```

## 边界与策略

### Approval gate

- 自动续跑 start 只接受 `implementing` 状态。
- 如果 task 仍在 `awaiting_approval`，返回 `needs_attention: approval_required`，不自动 transition。
- 主 session 仍必须在用户明确批准后的回合调用 transition；保留现有 `approvalGrant` 记录逻辑。

### maxConcurrency

- 继续使用 `selectReadyYpiStudioImplementationSubtasks` 与 `concurrencySlotsAvailable` 语义。
- orchestrator 不直接操作 `pending/waiting` 为 running；必须通过 `claimYpiStudioImplementationSubtask`。
- 运行中 + 队列中总数为并发占用。

### 失败 / blocked / runtime_lost

- MVP 默认 fail-fast 到 `needs_attention`，不自动重试。
- 已有 `failurePolicy=block_dependents` 继续传播 blocked dependents。
- `runtime_lost`：标记 run failed/subtask failed，attention message 提示“后端重启或 runtime handle 丢失，需人工重试/恢复”。

### waiting_for_user

- child extension UI request 已被提升为 `waiting_for_user`；orchestrator 必须停止派发，并把 prompt details 显示在 attention。
- 不尝试代表用户回答 child request。

### validation / checker review

- MVP：
  - subtask `validation` 中明确人工/外部验证失败，或 checker 明确要求人工决策时，进入 `needs_attention`。
  - 整体 implementationPlan 全部完成后自动 transition 到 `checking` 并派发 checker；checker 通过后继续完成 workflow 收尾。
- Phase 2 可增强 checker verdict contract，让 checker 结果更结构化地驱动 retry/block/done。

### Parent session lifecycle

- orchestrator-managed child runs 不应因 `AgentSessionWrapper` idle destroy 被误杀。
- 建议 child run handle 增加 `managedBy`：
  - `chat`: 现有手动 tool run，parent abort/destroy 保持现状。
  - `studio-orchestrator`: 用户显式 pause/cancel/task transition 才终止；`session_destroy` 只解除 Chat wrapper，不杀后台 run。
- 用户点击普通 Abort 时需明确：仅中止当前 Chat 回合；若 Studio 自动续跑中，显示“请点击暂停 Studio 自动续跑”。

## 兼容性、迁移、回滚

- 所有新增字段为 optional；旧任务 projection 缺失时显示 manual/idle。
- 不修改 session JSONL 格式；只有可选 Chat continuation 会作为普通后续消息出现。
- 回滚方式：关闭/隐藏 `implementation_autorun_*` action 和 UI controls；旧 `poll/collect` 手动流程仍可工作。
- 若 orchestrator 出现异常，写入 `needs_attention: orchestrator_error`，不继续派发。

## 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 重复派发同一 subtask | per-task tick lock、generation、claim 前重读 progress、deterministic runId/currentRunId 校验。 |
| 后台进程泄漏 | orchestrator registry + managedBy + pause/cancel；process exit 清理；runtime_lost reconciliation。 |
| UI 误以为 Chat 仍在思考 | 分离 `agentRunning` 与 `studioBackgroundRunning`，使用明确“后台自动续跑中”文案。 |
| 自动化绕过用户意图 | 仅 implementing 后启动；失败/人工输入/validation/checker boundary 停止。 |
| token/成本不可控 | 中间调度确定性执行，不每个 subtask 唤醒主 LLM；尊重 maxConcurrency；显示 active runs。 |
| checker/localReview 语义复杂 | MVP 作为 needs_attention boundary；Phase 2 再做自动 checker。 |
| 多浏览器/多 session 同时控制 | contextId/generation/lock；不同 context resume 需显式操作并记录 event。 |

## 分阶段落地

1. **Phase 1：可见后台态 + 确定性 implementation auto-run**
   - 类型/投影、orchestrator service、runner 抽取、tool/API start/pause/resume/cancel、Widget/Panel/Chat status。
   - 完成：自动派发 implementer subtasks，失败/完成/需要检查进入 attention。
2. **Phase 2：Chat boundary continuation**
   - completed/needs_attention 时向 parent session 发送一次 continuation 或 SSE notification；避免中间频繁打扰。
3. **Phase 3：checker/localReview 自动化（可选）**
   - 支持 `autoCheck`，checker verdict contract，localReview passed/failed 驱动 dependents。
4. **Phase 4：持久队列/跨进程恢复（可选）**
   - 若需要生产级无人值守，增加 durable queue/lease；MVP 只做 runtime_lost reconciliation。

## 需要主会话/产品确认的决策

1. 用户说“开始实现”后是否默认启用自动续跑？推荐默认启用，并允许“手动一步步”关闭。
2. implementation 完成后自动 transition 到 `checking`，保持非并行流程的一致体验。
3. 面向用户不使用 Abort 等内部词；提供“先停一下 / 继续跑 / 取消正在跑的任务”这些人话控制。
## 修正：主 Chat 不进入停止态，状态机仍由主会话推进

根据用户反馈，方案调整为更小破坏性的 **主 Chat 等待式编排**，而不是用独立后台 orchestrator 取代主会话：

1. 用户批准开始工作后，主 Chat 的运行态不能变成 stopped/idle。它应进入 `waiting_for_studio_children` 这样的可见等待态，持续表示“我正在等并行子任务结果”。
2. 并行 implementer/checker 子任务只是执行单元；任务状态机仍由主 Chat/当前 Studio task 流程推进：`implementing -> checking -> completed` 等 transition 不交给子任务自行决定。
3. 子任务 terminal 后，只触发同一主 session 的 continuation/tick；主 Chat 收集结果、更新 implementationProgress，再决定继续派发下一批、进入 checking、完成或请求用户处理。
4. 前端不能把 `agentRunning=false` 当作“主 Chat 停止”。需要新增或复用运行状态：`running_model`、`running_tool`、`waiting_for_studio_children`、`needs_user`、`completed`。其中 `waiting_for_studio_children` 仍属于“主 Chat 正在工作”。
5. SSE/轮询层应持续显示等待态和心跳，例如“正在等待 2 个并行子任务完成”；如果 HTTP/SSE 不适合长连接，也必须在 session runtime 中保持 active continuation，UI 展示为 active，而不是 stopped。
6. 只有用户明确说“先停一下/取消”，或出现需要用户决策的失败/冲突，主 Chat 才进入可交互的停止/需处理状态。

这意味着实现重点从“新增独立后台 orchestrator”改为“给主 Chat 增加等待子任务的 continuation loop”：

- 子任务完成事件唤醒主 Chat continuation，而不是让用户手动输入继续。
- 状态机 transition 仍走现有 YPI Studio task transition/update/implementation_next/claim/update 规则。
- 改动应尽量局部：复用现有 implementationPlan、subagent async run、task projection，只补齐主 session 等待态、terminal callback 与 UI 展示。

## 子任务状态可视化补充

主 Chat 处于 `waiting_for_studio_children` 时，不只显示“还在等”，还要展示每个关键子任务的状态摘要，避免用户不知道并行任务分别进展到哪里。

建议 projection 增加一个 compact subtask timeline：

- `pending`：还没轮到。
- `ready`：依赖满足，等待主 Chat 派发。
- `queued`：已排队，等待子进程启动。
- `running`：正在执行，显示 member、runId、startedAt、最近进展摘要。
- `waiting_for_user`：子任务需要人处理，主 Chat 应进入需要用户处理态。
- `done`：已完成，显示完成时间和简短结果。
- `failed`：失败，显示失败原因和查看日志入口。
- `blocked`：被失败或未满足依赖阻塞。
- `skipped`：按计划跳过。

Chat 中默认只展示精简版，例如：

> 正在等待并行子任务完成：运行中 2、已完成 1、等待 3、阻塞 0。  
> - A 类型契约：完成  
> - B runner 抽取：运行中  
> - C continuation：运行中  
> - D UI 状态：等待 B/C

Studio Panel 可以展示完整列表和依赖关系；Session Widget 展示最近/活跃/异常优先的 3-5 个子任务。状态严重程度以 subtask.status/run.status 为准，不把 transcript 截断当失败。
