# PRD — 增强 YPI Studio 架构师任务拆解与分阶段实现编排

## 目标与背景

当前 YPI Studio 的标准流程已经具备 `planning -> awaiting_approval -> implementing -> checking` 主状态机，以及 `awaiting_approval -> implementing` 的服务器端硬审批门禁。但复杂任务在用户确认后仍通常由实现员一次性承担完整实现，造成上下文压力大、改动范围大、检查和回滚成本高。

本任务目标是在不破坏现有主状态机的前提下，让架构师在设计阶段输出结构化实现拆解，并让后续实现阶段按子任务推进：MVP 先做到可保存、可读、可展示、可按边界执行；第二阶段增加自动选择下一个 ready 子任务、逐个调度实现员、单子任务返工/补查，并预留并行和局部 checker review 扩展点。

## 范围内

### 阶段一：MVP

1. 架构师产物增加结构化 Implementation Plan / 实现拆解。
   - `implement.md` 必须包含面向人类的实现顺序，以及可机器读取的子任务计划。
   - 子任务至少包含：稳定 id、标题、阶段、状态、依赖、目标文件/模块、执行说明、验收标准、验证建议、风险。
2. 任务数据支持保存 `implementationPlan` / `implementationProgress`。
   - 数据保存在 `.ypi/tasks/<task-id>/task.json`，通过现有任务读取 API 返回。
   - 兼容旧任务：字段缺失时 UI 和 prompt 降级为“未定义实现拆解”。
3. 实现员 prompt 调整为优先读取实现拆解，并按子任务边界执行。
   - 如果父会话指定 `subtaskId`，实现员只执行该子任务。
   - 如果没有指定子任务，实现员必须先报告阻塞或请求父会话选择，不默认吞下完整复杂任务。
4. Studio UI 展示子任务列表和状态。
   - 任务详情页新增实现拆解展示区域或独立 tab。
   - 任务卡片/概览显示子任务完成数、当前执行项和阻塞项摘要。
5. 更新相关模块文档，说明数据结构、API/tool 行为、UI 展示和 prompt 约束。

### 阶段二：自动调度与细粒度执行

1. 自动选择下一个 `ready` 子任务。
   - 选择逻辑只在任务主状态为 `implementing` 时生效。
   - 依赖未完成的子任务不得被选择。
2. 支持逐个子任务交给实现员执行。
   - 父会话通过工具领取一个子任务并将 `subtaskId` 传给 `ypi_studio_subagent(member=implementer)`。
   - 每次实现员运行只绑定一个子任务，避免默认执行全部计划。
3. 支持子任务状态推进。
   - 状态集合：`pending` / `ready` / `running` / `blocked` / `done` / `skipped`。
   - 状态变更记录 `updatedAt`、原因/摘要、关联 runId、验证记录和阻塞原因。
4. 支持单个子任务重新执行或补充检查。
   - 可将 `blocked`、`done` 或 `skipped` 的子任务重新置为 `ready`，并保留 attempt/history。
   - 可对单个子任务发起 checker 补查，记录局部 review 状态和 checker runId。
5. 预留扩展点。
   - 数据结构预留 `parallelGroup` / `parallelizable` / `maxConcurrency`，MVP/二阶段默认仍串行。
   - 数据结构预留 `localReview`，用于后续每个子任务的 checker review。

## 范围外

- 不重写 YPI Studio 主工作流状态机；主状态仍使用现有 `planning / awaiting_approval / implementing / checking / ...`。
- 不取消或弱化 `awaiting_approval` 硬门禁；`override` 仍不得绕过审批。
- 不在本任务中实现真正并行调度多个实现员；只预留 schema 和 UI 提示。
- 不引入新的长期任务数据库；继续使用 `.ypi/tasks/<task-id>/task.json` 和现有 artifacts。
- 不要求 UI 提供复杂拖拽排序或可视化依赖图；列表/分组展示即可。

## 用户价值

- 用户能在确认前看到可理解、可审查的实现拆解，而不是只看笼统方案。
- 实现员每轮只处理明确子任务，降低上下文压力和误改范围。
- 父会话和 UI 能追踪当前执行项、阻塞项和剩余工作。
- 检查员能按子任务证据审查，减少遗漏和大范围返工。

## 需求与验收标准

### R1. 结构化 Implementation Plan

**需求**：架构师在设计阶段输出结构化实现拆解，并能被保存到任务数据。

**验收标准**：
- 默认 `architect` 成员说明要求 `implement.md` 包含 `Implementation Plan` 和 fenced JSON 计划块。
- 新增类型可以表达子任务 id、状态、依赖、目标文件、验收标准和验证建议。
- 对当前任务或新复杂任务，`task.json` 能持久化 `implementationPlan` 和初始 `implementationProgress`。

### R2. 实现员按子任务边界执行

**需求**：实现员优先读取拆解计划，不默认实现完整复杂任务。

**验收标准**：
- 默认 `implementer` prompt 明确要求：有 `subtaskId` 时只执行该子任务；无 `subtaskId` 且存在拆解计划时报告需要父会话选择。
- `ypi_studio_subagent` 支持在运行记录中关联 `subtaskId`，用于 UI 和进度回填。
- 子任务 prompt 包含该子任务的目标、依赖完成情况、允许修改范围、验收标准和验证建议。

### R3. 任务数据和 API/tool 支持

**需求**：任务详情和工具层支持实现计划、进度、下一个 ready 子任务、状态推进。

**验收标准**：
- `GET /api/studio/tasks/[taskKey]` 返回 `implementationPlan` 和 `implementationProgress`。
- `PATCH /api/studio/tasks/[taskKey]` 支持更新 plan/progress 或子任务状态。
- `ypi_studio_task` 支持保存计划、选择下一个 ready 子任务、领取/完成/阻塞/跳过/重置单个子任务。
- 当任务仍在 `planning` 或 `awaiting_approval` 时，领取/运行子任务失败；只有主状态 `implementing` 可进入 `running`。

### R4. UI 展示子任务列表和状态

**需求**：Studio 面板能展示子任务状态、当前项、阻塞项和完成情况。

**验收标准**：
- 任务详情页可看到子任务列表，状态 badge 覆盖 `pending / ready / running / blocked / done / skipped`。
- 任务卡片或概览显示完成数、当前执行项、阻塞数。
- 无计划、旧任务、读失败、长文本、归档任务都有安全降级。

### R5. 自动调度与细粒度执行

**需求**：父会话可以自动选择下一个 ready 子任务，并逐个派发实现员。

**验收标准**：
- 调度函数按稳定顺序返回第一个依赖已满足的 `ready` 子任务。
- 领取后状态变为 `running`，并写入 `activeSubtaskId` 和运行记录。
- 实现员完成后父会话可将该子任务置为 `done` / `blocked` / `skipped`，然后再选择下一个。
- 所有必要子任务完成或跳过后，父会话才建议主状态进入 `checking`。

### R6. 审批门禁保持不变

**需求**：架构师完成设计和拆解后必须停在 `awaiting_approval`，用户确认后才允许实现。

**验收标准**：
- `planning -> awaiting_approval` 后，系统仍要求后续用户显式确认。
- `awaiting_approval -> implementing` 仍由 `assertYpiStudioImplementationApproved` 守护；`override` 不能绕过。
- 子任务 `claim/start/running/done` 动作不能在 `awaiting_approval` 触发实现。
- prompt 和工具错误信息都明确提示需要用户确认。

## UI 是否需要 UI 设计员

不需要单独 UI 设计员产出 HTML 原型。本功能复用现有 `YpiStudioPanel` 卡片、tab、badge、SectionCard 风格，UI 范围明确且主要是结构化数据展示。实现员应覆盖窄屏、长列表、空状态、阻塞/错误状态和归档只读状态。

## 未决问题

1. 主会话是否要一次性实现阶段一和阶段二，还是先合入 MVP 后再做自动调度？推荐先实现 MVP，再在同一任务的后续子任务中实现阶段二。
2. `implementationPlan` 的 JSON 是否必须从 `implement.md` 自动解析，还是由父会话/工具显式保存？推荐 MVP 使用显式 `ypi_studio_task(action=update_implementation_plan)` 保存，后续再考虑自动解析。
3. 子任务局部 checker review 在阶段二中做到“可记录和可手动触发”即可，还是需要主会话自动调度 checker？推荐本任务只做可记录和 prompt 支持，不做自动 checker 调度。
