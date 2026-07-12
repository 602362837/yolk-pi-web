# Review - 修复改进任务派发闭环与成员运行记录丢失

## Check Complete

审查对象：任务 `20260711-232947` 的 B1/B2 修复（4 个子任务全部实现完成）。对照 brief / PRD / design / implement / checks / handoff 与源码 diff 做了契约与静态验证。

### Findings Fixed

- None

### Remaining Findings

- None（无阻塞/重要问题）

非阻塞残余风险（不阻塞验收）：

1. **扩展/API 接线未做自动化烟测**：`test:studio-dag` 覆盖 library 契约（next/claim/runIds/隔离/runtime-lost/checking），但 extension schema 归一化、PATCH `claim_improvement_subtask` 与 subagent start 的 child-process 路径仍依赖手工烟测（checks.md 已列）。
2. **实例 accepted 后的迟到终态回写被拒**：`recordYpiStudioSubagentRun` 在主任务离开 `waiting_for_improvements` 后拒绝带 `improvementId` 的回写。这与设计一致，但若用户在 child 仍 running 时接受改进，迟到 final/cancel 会抛错，可能留下 `task.subagents` 中的 running 记录；不在本次 B1/B2 范围。
3. **父任务 I1–I5 未修**：按范围刻意保留，不与本次阻塞修复混合。

### 检查对照

#### 1. 类型定义（imp-scope-types）— Pass

- `YpiStudioImprovementSubtaskClaimBody`：`action: "claim_improvement_subtask"`，`improvementId: string` 为 required。
- `YpiStudioTaskSubagentRun.improvementId?: string` 为可选归属字段。
- 主任务 `YpiStudioTaskImplementationSubtaskClaimBody` 未引入 `improvementId`，避免作用域隐式混用。

#### 2. 库函数（imp-scope-library）— Pass

- `resolveImprovementInstanceForExecution`：断言非 archived、主任务 `waiting_for_improvements`、实例 `implementing|checking`、有 plan/progress。
- `getNextYpiStudioImplementationSubtask({ improvementId? })`：有 scope 时只读实例 plan/progress；无 scope 保持主任务语义。
- `claimYpiStudioImprovementSubtask`：锁内只改 `instance.implementationProgress`，事件 `data` 含 `improvementId`；不读/写主 plan/progress。
- `recordYpiStudioSubagentRun`：有 `improvementId` 时 `Set` 去重追加 `instance.runIds`，经 `applySubagentRunToImplementationProgress` 只更新实例 progress；无 `improvementId` 保留主任务分支。
- `reconcileYpiStudioRuntimeLostSubagentRun` 经 `...run` 保留 `improvementId`。

#### 3. 工具与 API（imp-scope-tool-api）— Pass

- task tool action enum / normalizer / schema 含 `claim_improvement_subtask` 与 `improvementId`。
- `implementation_next` 透传 `improvementId`，文案与 waiting reasons 走实例 progress。
- subagent input / schema / `ChildRunMeta` / projections / `runSnapshot` / `runningRun` / `persistRunSnapshot` 均透传 `improvementId`。
- start 显式 scope：等待改进时主 plan `subtaskId` 拒绝；有 `improvementId` 时只查实例 plan；implementer/checker 有实例 plan 时要求 `subtaskId`；async ready 走实例 claim helper。
- `buildMemberPrompt` 实例分支注入实例 artifacts/plan/progress 与 IMP 作用域头，不注入主 plan。
- PATCH route：`isYpiStudioImprovementSubtaskClaimBody` → `claimYpiStudioImprovementSubtask`，`cwd` 用 `authorizedCwd` 覆盖。
- cancel 路径 `...persisted` 保留 `improvementId`。

#### 4. 测试与文档（imp-scope-tests）— Pass

`scripts/test-ypi-studio-dag.mjs` 覆盖：

- 正向：`implementation_next(improvementId)`、claim 只改实例、checking 可 claim、runIds 生命周期去重、双实例隔离、runtime-lost 归属。
- 负向：未知 improvementId、非可执行状态、主 plan id 冒充实例、无 improvementId 的主 claim、accepted 后 scoped run 回写拒绝。

文档：

- `docs/modules/library.md`：instance next/claim/run 分支与 append-only `runIds`。
- `docs/modules/api.md`：PATCH `claim_improvement_subtask` 契约。

UI：范围外未改；`YpiStudioPanel` 已按 `instance.runIds` 过滤 `task.subagents`，B2 写入后成员运行 Tab 可展示。

### Verification

| Command | Result |
| --- | --- |
| `npm run test:studio-dag` | Pass |
| `npm run lint` | Pass |
| `node_modules/.bin/tsc --noEmit` | Pass |

### 验收标准对照

| 标准 | 结论 |
| --- | --- |
| 改进实现员可领取并执行改进子任务 | Pass（claim + scoped subagent start） |
| 改进检查员可领取 review 子任务 | Pass（checking 状态 next/claim） |
| 主/实例 plan 隔离，错误 scope 拒绝 | Pass |
| `instance.runIds` 正确记录且去重 | Pass |
| UI 成员运行可按 `runIds` 展示 | Pass（写入路径 + 既有 UI 过滤） |
| 契约测试 + lint + tsc | Pass |

### Verdict

**Pass**

B1（改进派发闭环）与 B2（`instance.runIds` 归属）已按设计落地：显式 `improvementId` 作用域、主/实例 plan 严格隔离、run 生命周期保留归属，且验证命令全部通过。无阻塞问题，可进入用户验收/归档准备。

### 主会话建议

1. 可按 checks.md 做一次手工烟测：主/实例重叠 `subtaskId` 的 scope 拒绝；实例 async implementer start → complete/cancel 后详情页成员运行 Tab。
2. 父任务 I1–I5 保持独立返工，勿并入本任务。
3. 无需新的产品决策。
