# Brief

## 背景
当前 YPI Studio 执行复杂任务时，架构师完成设计并经用户确认后，实现员往往一次性承担完整实现，导致上下文压力大、改动范围大、风险集中。部分用户任务天然可拆解，需要在架构师阶段形成更明确的实现拆解与编排方案。

## 用户目标
设计并实现一套机制：架构师在设计工作中对复杂任务做实现拆解，减轻实现员压力，并支持后续按子任务推进。

## 必须纳入任务的两个阶段

### 阶段一：最小可行版本
- 架构师产物增加 Implementation Plan / 实现拆解。
- 实现员 prompt 改为优先读取拆解计划，并按子任务边界执行。
- 任务数据支持保存 implementationPlan / implementationProgress。
- Studio UI 能展示子任务列表和状态。

### 阶段二：自动调度与细粒度执行
- 支持自动选择下一个 ready 子任务。
- 支持逐个子任务交给实现员执行，避免一次性实现全部内容。
- 支持子任务状态推进：pending / ready / running / blocked / done / skipped。
- 支持必要时对单个子任务重新执行或补充检查。
- 预留并行实现和局部 checker review 的扩展点。

## 约束
- 必须保留现有 awaiting_approval 硬门禁：架构师设计和拆解完成后必须停在 awaiting_approval，用户确认后才允许实现。
- override 不能绕过审批门禁。
- 不应破坏现有任务状态机；优先在 implementing 内增加子任务进度。
- 需要更新相关文档/模块说明。

## 初步验收
- 复杂任务的 architect 输出包含结构化 implementation plan。
- implementer 能按子任务执行，不会默认吞下完整复杂任务。
- UI 能展示子任务状态和当前执行项。
- lint 与 TypeScript 检查通过。
