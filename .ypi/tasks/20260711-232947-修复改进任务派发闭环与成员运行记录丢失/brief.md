# Brief - 修复改进任务派发闭环与成员运行记录丢失

## 问题

父任务 `20260711-185646-完善-ypi-studio-设计审批同步与改进孪生流程` 的检查发现改进实例只能保存 `implementationPlan` / `implementationProgress`，不能进入实际执行闭环：

- `ypi_studio_task` 只有主任务 `claim_implementation_subtask`，`implementation_next` 也只查询主任务 plan。
- `ypi_studio_subagent` 未接收 `improvementId`，会把改进子任务误按主任务 plan 校验；主任务在 `waiting_for_improvements` 时因此无法启动改进 implementer/checker。
- 改进实例初始化 `runIds: []`，但所有 subagent 生命周期都只写主任务 `subagents`，导致实例成员运行页与审计归属为空。

## 修复目标

1. 为改进实例提供与主任务 DAG 相同的 ready 查询和 claim 入口，并要求改进执行同时具备 `improvementId` 与 `subtaskId`。
2. 在 `waiting_for_improvements` 期间严格隔离实例 plan 与主任务 plan，拒绝将主 plan 的同名或任意 `subtaskId` 当作改进工作领取。
3. 将每次已成功持久化的 child run 以幂等方式记录到 `instance.runIds`；运行、完成、取消、runtime-lost 回写均保留同一归属。
4. 不改变无 `improvementId` 的主任务 `implementation_next`、claim、run 生命周期和既有 DAG 并发语义。

## 范围

范围内：`lib/ypi-studio-types.ts`、`lib/ypi-studio-tasks.ts`、`lib/ypi-studio-extension.ts`、`app/api/studio/tasks/[taskKey]/route.ts`、`scripts/test-ypi-studio-dag.mjs`，以及相应 API/library 文档。

范围外：UI 结构或原型、`approvalMode=inherit`、`reconcile_improvements` API 缺口、事件 feedback 有界化和 improver thinking 产品决策。它们保留在父任务返工清单，不与本次阻塞修复混合。

## 完成标准

- 改进 `implementing` / `checking` 实例可返回 ready 子任务、claim 子任务，并以实例作用域启动 implementer 或 checker。
- 缺少 `improvementId`、实例不存在、状态不允许、子任务不属于实例 plan，或在 `waiting_for_improvements` 使用主 plan 子任务，均被服务端拒绝。
- 每个改进 run 在首次 start 持久化后出现于对应 `instance.runIds`，终态/取消重复回写不丢失、不重复，且不污染其他实例。
- `npm run test:studio-dag` 覆盖上述契约；lint 和 TypeScript 检查通过。
