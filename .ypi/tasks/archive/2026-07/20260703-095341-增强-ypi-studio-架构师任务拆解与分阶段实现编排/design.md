# Design — Implementation Plan 与分阶段子任务编排

## 方案摘要

在现有 YPI Studio 主状态机外增加“实现拆解层”：主状态仍保持 `planning -> awaiting_approval -> implementing -> checking`，新增 `implementationPlan` 描述静态子任务计划，新增 `implementationProgress` 描述运行时进度。架构师在 `planning` 阶段输出结构化计划；父会话保存计划并将任务切到 `awaiting_approval` 后停止等待用户确认；用户确认后才可进入 `implementing`，并在 `implementing` 内逐个领取 ready 子任务派发给实现员。

核心原则：
- 主状态机不大改，子任务进度只在 `implementing` 内推进。
- 审批门禁不变，任何子任务运行/领取动作都不能绕过 `awaiting_approval`。
- MVP 先实现“保存 + prompt 约束 + UI 展示”；阶段二再实现“选择 + 领取 + 状态推进 + 单任务返工/补查”。

## 影响模块和边界

### 类型与持久化

- `lib/ypi-studio-types.ts`
  - 新增 implementation plan/progress 相关类型。
  - 扩展 `YpiStudioTaskRecord`、`YpiStudioTaskSummary`、`YpiStudioTaskDetail`、`YpiStudioTaskWidgetProjection`。
  - 扩展 `YpiStudioTaskSubagentRun` 增加可选 `subtaskId`。
- `lib/ypi-studio-tasks.ts`
  - 读取/归一化旧任务缺失字段。
  - 保存 `implementationPlan` / `implementationProgress`。
  - 提供纯函数：计划校验、状态统计、依赖检查、选择下一个 ready 子任务。
  - 提供写函数：更新计划、领取子任务、更新子任务状态、重置/补查标记。
- `.ypi/tasks/<task-id>/task.json`
  - 增量新增字段；旧任务不迁移、不重写，读取时降级。

### API 和工具

- `app/api/studio/tasks/[taskKey]/route.ts`
  - `GET` 自然返回 detail 中新增字段。
  - `PATCH` 新增 action body：`update_implementation_plan`、`update_implementation_subtask`、`claim_implementation_subtask`。
- `lib/ypi-studio-extension.ts`
  - `ypi_studio_task` 新增同名 action。
  - `ypi_studio_subagent` 新增可选 `subtaskId`，记录到 run 并注入成员 prompt。
  - `buildStudioState()` 在 `implementing` 且有 plan 时提示父会话先领取一个 ready 子任务，不能派发完整实现。
  - `buildMemberPrompt()` 注入结构化 implementation plan/progress 摘要；实现员只看到被派发子任务的明确边界。

### Prompt / 默认成员

- `lib/ypi-studio-agents.ts`
  - `architect` 默认说明增加“Implementation Plan 必填”与 JSON 结构要求。
  - `implementer` 默认说明增加“优先读取实现拆解；有 subtaskId 只做该子任务；无 subtaskId 不默认全量实现”。
  - `checker` 默认说明增加“如果收到 subtaskId，优先做局部检查并记录局部结论”。
  - 更新默认成员 hash/backfill：仅覆盖精确匹配旧默认的项目本地成员，不覆盖用户自定义成员。

### 前端 UI

- `components/YpiStudioPanel.tsx`
  - `TaskDetailTab` 增加 `implementation`，或在 Overview 中增加 `ImplementationSection`；推荐独立 tab，避免概览过载。
  - `TaskCard` 显示子任务完成数、当前 running/blocked 摘要。
  - `TaskOverviewTab` 显示当前执行项和 next ready 简述。
- `components/YpiStudioSessionWidget.tsx`
  - 可选展示当前子任务标题与完成数；MVP 可只在 Studio Panel 展示，阶段二再加 widget 摘要。
- `lib/ypi-studio-session-link.ts`
  - Widget projection 透出轻量 `implementation` 摘要，不包含完整长文本。

### 文档

- `docs/modules/library.md`：更新 `ypi-studio-types.ts`、`ypi-studio-tasks.ts`、`ypi-studio-extension.ts` 描述。
- `docs/modules/api.md`：更新 `studio/tasks/[taskKey]` PATCH action 行为。
- `docs/modules/frontend.md`：更新 `YpiStudioPanel` 和可选 session widget 展示。
- `docs/architecture/overview.md`：补充 YPI Studio 实现拆解层和审批门禁关系。

## 数据结构契约

### 状态枚举

```ts
export type YpiStudioImplementationSubtaskStatus =
  | "pending"
  | "ready"
  | "running"
  | "blocked"
  | "done"
  | "skipped";
```

### 计划字段（静态为主）

```ts
export interface YpiStudioImplementationSubtaskPlan {
  id: string;                 // stable slug, unique in plan
  title: string;
  phase?: "mvp" | "phase2" | string;
  description?: string;
  order: number;
  dependsOn: string[];
  files?: string[];           // suggested source files/modules
  instructions?: string[];
  acceptance?: string[];
  validation?: string[];
  risks?: string[];
  parallelGroup?: string;     // reserved extension point
  parallelizable?: boolean;   // reserved extension point; default false
  localReview?: {
    required?: boolean;
    reviewer?: "checker" | string;
  };
}

export interface YpiStudioImplementationPlan {
  schemaVersion: 1;
  updatedAt: string;
  sourceArtifact?: "implement.md" | string;
  summary?: string;
  strategy?: string;
  maxConcurrency?: number;    // reserved; MVP/phase2 default 1
  subtasks: YpiStudioImplementationSubtaskPlan[];
}
```

### 进度字段（运行时）

```ts
export interface YpiStudioImplementationSubtaskProgress {
  id: string;
  status: YpiStudioImplementationSubtaskStatus;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts: number;
  runIds: string[];
  lastRunId?: string;
  blockedReason?: string;
  skippedReason?: string;
  summary?: string;
  validation?: string[];
  localReview?: {
    status?: "not_requested" | "requested" | "running" | "passed" | "failed" | "skipped";
    runIds?: string[];
    summary?: string;
    updatedAt?: string;
  };
}

export interface YpiStudioImplementationProgress {
  schemaVersion: 1;
  updatedAt: string;
  activeSubtaskId?: string;
  nextSubtaskId?: string;
  counts: Record<YpiStudioImplementationSubtaskStatus, number>;
  subtasks: Record<string, YpiStudioImplementationSubtaskProgress>;
  history?: Array<{
    at: string;
    subtaskId: string;
    from?: YpiStudioImplementationSubtaskStatus;
    to: YpiStudioImplementationSubtaskStatus;
    runId?: string;
    message?: string;
  }>;
}
```

### TaskRecord 扩展

```ts
export interface YpiStudioTaskRecord {
  // existing fields...
  implementationPlan?: YpiStudioImplementationPlan;
  implementationProgress?: YpiStudioImplementationProgress;
}
```

兼容性规则：
- 旧 `task.json` 没有字段时读取为 `undefined`，UI 展示空态。
- 保存 plan 时自动初始化 progress：无依赖的第一个/多个子任务为 `ready`，其余为 `pending`；`maxConcurrency` 默认 1。
- 更新 plan 时保留同 id 子任务的进度；删除的子任务从 progress 移除；新增子任务根据依赖置为 `ready` 或 `pending`。
- `implementationPlan` 是计划事实源；`implementationProgress` 是状态事实源。不要把状态写回 plan。

## API / Tool 契约

### `PATCH /api/studio/tasks/[taskKey]`

新增 body 形态：

```json
{
  "cwd": "/workspace",
  "action": "update_implementation_plan",
  "implementationPlan": { "schemaVersion": 1, "subtasks": [] },
  "contextId": "pi_xxx"
}
```

```json
{
  "cwd": "/workspace",
  "action": "claim_implementation_subtask",
  "subtaskId": "optional-explicit-id",
  "contextId": "pi_xxx"
}
```

```json
{
  "cwd": "/workspace",
  "action": "update_implementation_subtask",
  "subtaskId": "mvp-types",
  "status": "done",
  "runId": "implementer-...",
  "message": "Types and normalizers implemented",
  "validation": ["npm run lint"]
}
```

校验规则：
- `update_implementation_plan` 允许在 `planning`、`awaiting_approval`、`changes_requested` 中执行；在 `completed/archived/cancelled` 禁止。
- `claim_implementation_subtask` 只允许主状态 `implementing`，否则返回错误。该规则不能被 `override` 绕过。
- `update_implementation_subtask` 设置 `running/done/blocked/skipped` 只允许主状态 `implementing`；设置 `ready/pending` 作为重新执行/调整可允许 `implementing` 或 `changes_requested`。
- 归档任务只读。

### `ypi_studio_task` action

新增 action：
- `update_implementation_plan`：保存 plan，初始化/合并 progress，返回 task detail。
- `implementation_next`：只读取并返回下一个 ready 子任务；不改状态。
- `claim_implementation_subtask`：选择 explicit id 或自动选择 next ready，并置为 `running`。
- `update_implementation_subtask`：推进一个子任务状态。

推荐父会话编排：
1. 架构师产出 artifacts 后，父会话读取 `implement.md` 中 JSON plan，调用 `update_implementation_plan`。
2. 父会话调用 `transition -> awaiting_approval` 并停止，向用户展示计划摘要。
3. 用户显式批准后，父会话调用 `transition -> implementing`。
4. 父会话调用 `claim_implementation_subtask`。
5. 父会话调用 `ypi_studio_subagent(member=implementer, subtaskId=...)`。
6. 实现员返回后，父会话调用 `update_implementation_subtask` 标记 `done/blocked`。
7. 循环直到没有 ready 子任务，所有必要子任务 `done/skipped` 后进入 `checking`。

### `ypi_studio_subagent`

新增输入：

```ts
interface StudioSubagentInput {
  member?: string;
  prompt?: string;
  taskId?: string;
  subtaskId?: string;
  model?: string;
  thinking?: string;
}
```

运行记录扩展：

```ts
interface YpiStudioTaskSubagentRun {
  // existing fields...
  subtaskId?: string;
}
```

规则：
- `member=implementer` 且任务存在 implementation plan 时，应要求 `subtaskId`；缺失时 prompt 明确只允许做准备/报告阻塞，不允许全量实现。
- `member=checker` 可带 `subtaskId` 做局部检查；不带时执行全局检查。
- `recordYpiStudioSubagentRun()` 将 run 关联到 progress 的 `runIds/lastRunId`，但不自动把子任务标记 done；最终状态由父会话显式更新，避免误判。

## 调度与状态推进设计

### next ready 选择

稳定算法：
1. 读取 plan subtasks，按 `order` 升序，order 相同按 id。
2. 候选必须是 progress status `ready`。
3. 候选的 `dependsOn` 必须全部为 `done` 或 `skipped`。
4. 若存在 `activeSubtaskId` 且其状态 `running`，默认不选择新任务（串行）。
5. 返回第一个候选；没有则返回 `null` 并附 counts/blockers。

MVP 可以只展示 next ready；阶段二实现 `claim` 写入 running。

### 状态转换建议

允许转换：
- `pending -> ready`：依赖满足或父会话手动解锁。
- `ready -> running`：claim 后。
- `running -> done | blocked`：实现员返回后由父会话确认。
- `blocked -> ready`：阻塞解除/重试。
- `done -> ready`：单子任务重新执行。
- `ready | pending | blocked -> skipped`：明确跳过并记录原因。

禁止/限制：
- `running` 不应直接回 `pending`；需要 `blocked` 或 `ready` 并记录原因。
- 主状态非 `implementing` 时不得进入 `running/done`。
- 已 `archived` 任务不得修改。

## UI 展示设计

### 任务卡片

新增轻量摘要：
- `子任务：done/total`。
- `当前：<running title>`；没有 running 时显示 `下一个：<next ready title>`。
- `阻塞：N`，仅 N > 0 时显示 warning。

### 任务详情 Implementation tab

结构：
1. Summary：策略、阶段、完成数、active、next ready、阻塞数。
2. Subtask list：按 phase/order 分组，每项显示：
   - 状态 badge。
   - title/id。
   - dependsOn、files。
   - acceptance/validation 摘要。
   - runIds / localReview 状态。
   - blocked/skipped reason。
3. Empty state：无 implementation plan 时提示“当前任务尚未保存实现拆解；请在规划阶段由架构师补充”。
4. Archived/read-only：展示但不提供操作。

MVP 不需要 UI 写操作；阶段二如增加操作按钮，必须只调用 API，并保持确认/错误提示。

### Session widget（可选）

阶段二可在 `YpiStudioTaskWidgetProjection` 中加入：

```ts
implementation?: {
  total: number;
  done: number;
  blocked: number;
  activeTitle?: string;
  nextTitle?: string;
}
```

Widget 只展示轻量摘要，不加载完整指令/验收文本。

## Prompt / 工作流调整

### 架构师

新增要求：
- `implement.md` 必须有 `## Implementation Plan`。
- 同时输出人类表格和 fenced JSON：

````md
```json ypi-implementation-plan
{ "schemaVersion": 1, "subtasks": [] }
```
````

- 计划完成后只建议父会话保存计划并转 `awaiting_approval`，不得进入实现。

### 父会话 / extension

- `planning` 状态注入：设计完成后先保存 implementation plan，再转 `awaiting_approval` 并停止。
- `awaiting_approval` 状态注入：展示 PRD/Design/Implement/Checks 和子任务摘要，等待明确批准。
- `implementing` 状态注入：先领取一个 ready 子任务，再派发实现员；不得让实现员一次性处理全部计划。

### 实现员

- 启动时先读 `implementationPlan` / `implementationProgress`，再读 PRD/Design/Checks。
- 有 `subtaskId`：只改该子任务允许范围；如果发现依赖未完成或范围不清，报告 blocked。
- 无 `subtaskId`：不得全量实现；报告需要父会话选择子任务。

### 检查员

- 有 `subtaskId`：做局部检查，输出该子任务 verdict、验证和风险。
- 无 `subtaskId`：做全局检查。

## 审批门禁与兼容性

- 保留现有 `transitionYpiStudioTask()` 中 `awaiting_approval -> implementing` 的 `assertYpiStudioImplementationApproved()`。
- 新增 claim/start/update-running 类函数必须检查 `record.raw.status === "implementing"`。
- `override` 不传入子任务 claim/start 路径；即使传入也忽略或报错。
- `update_implementation_plan` 不自动进入 `implementing`。
- 如果在 `awaiting_approval` 状态修改 implementation plan，推荐清除旧 `approvalGrant` 或更新 gate note，要求用户重新确认最新计划。实现员至少要避免“批准旧计划后修改新计划再实现”的路径。

## 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 子任务 schema 过复杂 | 实现和 UI 成本上升 | MVP 字段保持可选；必填只保留 id/title/order/dependsOn/status。 |
| plan 与 progress 不一致 | UI 或调度错误 | 保存 plan 时规范化并重建 counts；提供纯函数测试。 |
| 审批门禁被子任务动作绕过 | 破坏工作室安全边界 | 所有 running/done/claim 路径检查主状态 implementing；继续使用现有 transition gate。 |
| 实现员仍全量实现 | 需求未达成 | prompt + member prompt + buildStudioState 三层约束；subtaskId 缺失时明确阻塞。 |
| UI 长文本拥挤 | 面板可读性下降 | 详情 tab 分组展示，长字段折叠/摘要，metadata 保留 JSON。 |
| 旧任务读取失败 | 回归 | 所有新增字段可选，normalizer 容错，旧 task.json 不迁移。 |

## 回滚方案

- 新字段是 additive，回滚生产代码后旧版本会忽略 `task.json` 中的额外字段。
- 如 UI 出现问题，可先隐藏 Implementation tab，保留数据/API。
- 如调度逻辑有问题，可禁用 `claim_implementation_subtask` action，只保留手工 plan 展示和实现员 prompt 约束。
