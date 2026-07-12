# Handoff - 交给实现员

## 子任务进度

| 子任务 | 状态 | 说明 |
| --- | --- | --- |
| `imp-scope-types` | ✅ 完成 | 见下方「imp-scope-types 完成记录」。 |
| `imp-scope-library` | ✅ 完成 | 见下方「imp-scope-library 完成记录」。 |
| `imp-scope-tool-api` | ✅ 完成 | 见下方「imp-scope-tool-api 完成记录」。 |
| `imp-scope-tests` | ✅ 完成 | 见下方「imp-scope-tests 完成记录」。 |

## imp-scope-types 完成记录

### Files Changed

- `lib/ypi-studio-types.ts`
  - 新增 `YpiStudioImprovementSubtaskClaimBody`（`action: "claim_improvement_subtask"`，**required** `improvementId: string`，其余字段复用主 claim body：`cwd`/`subtaskId?`/`subtaskIds?`/`limit?`/`runId?`/`runIds?`/`status?`/`message?`/`contextId?`）。
  - 在 `YpiStudioTaskSubagentRun` 增加可选 `improvementId?: string`，作为 start/progress/final/cancel/runtime-lost 的稳定作用域归属。
  - **未改动** `YpiStudioTaskImplementationSubtaskClaimBody`：主任务 claim body 不含 `improvementId`，避免作用域隐式混用。

### Verification

- `node_modules/.bin/tsc --noEmit` — Pass (EXIT=0)

### Acceptance 对照

- 类型系统可表示 scoped claim（`YpiStudioImprovementSubtaskClaimBody`）与 scoped run（run 上的 `improvementId`）。
- 现有无 `improvementId` 调用者保持有效（`improvementId` 为可选；主 claim body 未引入该字段）。

### Notes / Risks

- `improvementId` 在 scoped claim body 上是 **required**（非可选），这是阻止“主 plan subtask 冒充实例 subtask”的类型层第一道防线；library 层必须在运行时再次校验实例存在与状态。
- 旧 run 无 `improvementId`，按主任务路径解释；旧 improvement 空 `runIds` 不回填。
- 本子任务只改 types，未触碰 library/tool/API/test/docs。

## imp-scope-library 完成记录

### Files Changed

- `lib/ypi-studio-tasks.ts`
  - 新增 `resolveImprovementInstanceForExecution(record, improvementId)`：断言主任务非 archived、`status === "waiting_for_improvements"`、实例存在且处于 `implementing | checking`、实例有 plan/progress，返回实例。
  - 扩展 `getNextYpiStudioImplementationSubtask(cwd, taskIdOrKey, { limit, improvementId? })`：有 `improvementId` 时从实例 plan/progress 运行 `selectReadyYpiStudioImplementationSubtasks`，返回附带 `improvementId`、`instance`、实例 `summary`；无则保持主任务返回语义。
  - 新增 `claimYpiStudioImprovementSubtask(taskIdOrKey, body)`：锁内仅操作实例 plan/progress，复用与主 claim 相同的 ready/依赖/并发槽/history/runId 去重/事件写入；事件 `data` 含 `improvementId`。绝不读写主 `implementationProgress`。
  - `recordYpiStudioSubagentRun` 按 `run.improvementId` 分支：实例存在且主任务仍在改进等待态时 `Set` 去重追加 `instance.runIds`，并经 `applySubagentRunToImplementationProgress` 只更新实例 progress；无 `improvementId` 保留主任务分支字节级行为。
  - 新增 `applySubagentRunToImplementationProgress`：实例作用域的 queued/running/succeeded/failed/cancelled/waiting_for_user 状态机与 `refreshDerivedImplementation` 派生。
  - `isYpiStudioImprovementSubtaskClaimBody` 导出，校验 `action === "claim_improvement_subtask"` 且 `improvementId` 为字符串。

### Verification

- `npm run test:studio-dag` — Pass（现有 DAG 契约全部通过；scoped claim/next/run 归属的正向/拒绝契约留给 imp-scope-tests）
- `node_modules/.bin/tsc --noEmit` — Pass (EXIT=0)

### Notes / Risks

- 主/实例 plan 完全隔离：主任务 `waiting_for_improvements` 时主 plan 子任务不能被认作实例工作；`improvementId` 是唯一作用域判据。
- `instance.runIds` 为追加式审计索引，终态/取消/runtime-lost 不移除 id，只更新同 id run 状态与实例 progress。

## imp-scope-tool-api 完成记录

### Files Changed

- `lib/ypi-studio-extension.ts`
  - 导入 `claimYpiStudioImprovementSubtask`、`implementationCounts`。
  - `StudioTaskToolInput.action` 与 `normalizeTaskToolInput` 新增 `claim_improvement_subtask`；normalizer 返回值补齐 `improvementId`/`feedback`/`owner`/`inputText`/`artifactUpdates`（修复此前实例字段被丢弃的隐患）。
  - 任务工具 JSON schema `action` enum 增加 `claim_improvement_subtask`，`improvementId` 描述补充“required for claim_improvement_subtask / 作用 implementation_next 实例 plan”。
  - `implementation_next` 透传 `improvementId`，按实例 progress 读取等待原因，文案区分实例/主任务作用域。
  - 新增 `claim_improvement_subtask` action：调用 `claimYpiStudioImprovementSubtask`，回包 `improvementId`/`displayId`/实例 active/queued/claimed 子任务。
  - `buildImprovementStateInjection` 在 `implementing | checking` 分支给出实例 `implementation_next`→`claim_improvement_subtask`→`ypi_studio_subagent(improvementId, subtaskId)` 的派发指引，并禁止领取主 plan 子任务。
  - `StudioSubagentInput`、`normalizeSubagentInput`、subagent schema 增加 `improvementId`；`StudioSubagentRunProjection`、`ChildRunMeta` 与各 compact projection（async start/lifecycle/sync/wait/`summarizeStudioSubagentRun`）透传 `improvementId`。
  - subagent `start` 校验改为显式作用域：有 `improvementId` 时要求主任务 `waiting_for_improvements`、实例 `implementing|checking` 有 plan、implementer/checker 必须带 `subtaskId`，仅在实例 plan 查找子任务（拒绝主 plan id），async ready 经实例 claim helper 领取；无 `improvementId` 但主任务等待改进且带 `subtaskId` 时直接拒绝。
  - `buildMemberPrompt(root, taskId, member, prompt, subtaskId?, improvementId?)` 改为实例作用域：注入实例 artifacts/plan/progress、`IMP` 作用域头、实例 selected subtask，绝不注入主 plan/progress。
  - `runningRun`、sync 终态 `run`、`childMeta` 均写入 `improvementId`；`persistRunSnapshot` 显式 `improvementId: existing?.improvementId ?? run.improvementId ?? runningRun.improvementId`；cancel/SDK fallback/runtime-lost 经已持久化 run 的 `improvementId` 保持归属。
- `app/api/studio/tasks/[taskKey]/route.ts`
  - 导入 `claimYpiStudioImprovementSubtask`、`isYpiStudioImprovementSubtaskClaimBody`。
  - PATCH 在主 claim 分支相邻处新增 `isYpiStudioImprovementSubtaskClaimBody`→`claimYpiStudioImprovementSubtask(taskKey, { ...body, cwd: authorizedCwd })` 分支，cwd 用授权值覆盖，归属/状态由 library 校验。

### Verification

- `npm run lint` — Pass
- `node_modules/.bin/tsc --noEmit` — Pass (EXIT=0)
- `npm run test:studio-dag` — Pass（回归，现有契约不退化；scoped 契约测试由 imp-scope-tests 补）

### Acceptance 对照

- implementer/checker 仅可启动实例 plan 内已 claim 的子任务（主任务等待改进期间）；async ready 自动经实例 claim helper 领取。
- 主任务等待改进且仅传主 plan `subtaskId`（无 `improvementId`）时在 child launch 前抛错；错误实例 id / 非 ready / 状态不允许同样被拒。
- PATCH 使用 `authorizedCwd` 覆盖 body.cwd，实例存在性与状态由 `claimYpiStudioImprovementSubtask`/`resolveImprovementInstanceForExecution` 校验。

### Notes / Risks

- `normalizeTaskToolInput` 此前未返回 `improvementId` 等实例字段，导致旧实例改进 action 只能经 API route 生效；本次一并补齐，tool 路径与 API 路径现在一致。这是 bug 修复，未改变既有主任务行为。
- 子代理运行期 handle（`YpiStudioChildRunHandle`）未增加 `improvementId`，归属以持久化 run 为准，避免在内存 handle 维护第二份作用域。
- 手工烟测建议见 checks.md：主/实例使用相同 `subtaskId` 时的 scope 拒绝、实例 async run 的完成与取消记录。

## imp-scope-tests 完成记录

### Files Changed

- `scripts/test-ypi-studio-dag.mjs`
  - 新增 `setupImprovementImplementing` 辅助：把主任务推进到 `waiting_for_improvements`，把改进实例推进到 `implementing`，并同时可选地为实例设置 DAG plan 与为任务设置主 DAG plan（用于重叠 id 测试）。
  - 新增正向契约：`implementation_next(improvementId)` 仅返回该实例 ready 子任务并递随实例 `displayId`/`instance` 标识；`claim_improvement_subtask` 只改动 `instance.implementationProgress`，主 `implementationProgress` 保持不变；checking 状态实例同样可 claim 子任务。
  - 新增负向契约：未知 `improvementId` 抛错；实例状态非 `implementing|checking`（如 `analysis`）抛错；用主 plan 子任务 id 调用 `claim_improvement_subtask` 抛错；用实例子任务 id 但不带 `improvementId` 调用主 `claim_implementation_subtask` 被拒；实例 `accepted` 后主任务回到 `review`，再回写 scoped run 抛错。
  - 新增 run 归属持久化契约：running/succeeded/cancelled 回写使 `instance.runIds` 有且仅有各 run id、对应实例 progress 正确终态，重复终态写入仍去重；runtime-lost 回写保留 `improvementId` 与 `instance.runIds` 且实例子任务进入 `failed`。
  - 新增隔离契约：同一主任务下两个实例使用重叠子任务 id，scoped run 只写入目标实例的 `runIds` 与 progress，另一实例与主 progress 不受污染。
  - 新增导入：`claimYpiStudioImprovementSubtask`、`reconcileYpiStudioRuntimeLostSubagentRun`。
- `docs/modules/library.md`
  - 在 `lib/ypi-studio-tasks.ts` 条目增加改进实例执行作用域 helper 说明：`getNextYpiStudioImplementationSubtask({ improvementId? })`、`claimYpiStudioImprovementSubtask`、`recordYpiStudioSubagentRun` 改进分支、`instance.runIds` 追加式审计索引与 `reconcileYpiStudioRuntimeLostSubagentRun` 归属保留。
  - 在 `lib/ypi-studio-extension.ts` 条目增加 `claim_improvement_subtask` action、`implementation_next`/subagent 的 `improvementId` 参数、以及 `waiting_for_improvements` 期间的显式作用域校验规则。
- `docs/modules/api.md`
  - 在 PATCH route 条目增加 `claim_improvement_subtask` action 说明（`improvementId` required、仅作用实例 plan、cwd 覆盖）。

### Verification

- `npm run test:studio-dag` — Pass（新增 12 个实例作用域/run 归属契约测试块，回归全部通过）
- `npm run lint` — Pass
- `node_modules/.bin/tsc --noEmit` — Pass (EXIT=0)

### Acceptance 对照

- 测试证明主/实例 progress 完全隔离：实例 claim/next 不修改主 `implementationProgress`，scoped run 不污染其他实例或主 progress。
- 测试证明 `instance.runIds` 在 running/succeeded/cancelled/runtime-lost 生命周期写入后只保留唯一 run id，重复终态写入不重复。
- 文档与实际交付的 PATCH `claim_improvement_subtask` action 和 tool `improvementId` 参数名称一致。

### Notes / Risks

- 测试为 library 契约级别，覆盖 ready/claim/run 隔离与 run 归属；extension schema/API route 的接线烟测仍需手工验证（主/实例使用相同 `subtaskId` 时的 scope 拒绝、实例 async run 的完成与取消记录）。
- 未发现实现与设计冲突。

## 下一步（imp-scope-tests）

~~已由本轮实现员完成，见上方「imp-scope-tests 完成记录」。~~

## 已完成的规划产物

- `brief.md`：B1/B2 根因、范围和验收目标。
- `design.md`：明确 library/tool/API 的作用域、状态和 run 归属方案。
- `implement.md`：4 个顺序子任务及机器可读 `ypi-implementation-plan`。
- `checks.md`：自动、契约、手工和回归检查。

## 实现边界

本次只修复 B1/B2：改进实例的 ready/claim/subagent scope 和 `instance.runIds`。主任务仍是 run 审计唯一存储处；run 增加 `improvementId`，实例保存去重 run id 索引。不要借机实现 `approvalMode=inherit`、独立通知、UI 文案、feedback event 收缩或 improver thinking 决策。

## 必改文件

- `lib/ypi-studio-types.ts`
- `lib/ypi-studio-tasks.ts`
- `lib/ypi-studio-extension.ts`
- `app/api/studio/tasks/[taskKey]/route.ts`
- `scripts/test-ypi-studio-dag.mjs`
- `docs/modules/library.md`、`docs/modules/api.md`

## 验证

规划阶段未修改生产代码，未运行测试。实现完成后必须运行：

```bash
npm run test:studio-dag
npm run lint
node_modules/.bin/tsc --noEmit
```

并手工验证主/实例使用相同 `subtaskId` 时的 scope 拒绝、实例 async run 的完成和取消记录。
- 实现复核（本轮）：已补齐 `buildMemberPrompt` 实例作用域分支（注入实例 artifacts/plan/progress、`IMP` 作用域头）、`persistRunSnapshot` 显式 `improvementId` 合并、CLI `runSnapshot` 透传 `meta.improvementId`、`projectSubagentRun` 子任务标题回退实例 plan、async 启动回文标注 `improvementId`。重跑 `npm run lint`、`node_modules/.bin/tsc --noEmit`、`npm run test:studio-dag` 均通过，代码与本完成记录一致。

## 剩余风险与主会话决策

- 无需新的产品决策：已按任务要求让 implementer 与 checker 都可在实例状态 `implementing | checking` 下领取实例 DAG 子任务。
- B1/B2 不解决父 review 的 I1-I5。主会话应将它们保留为独立返工或明确缩减产品承诺，避免本次阻塞修复扩大范围。

## 检查员审查结果（checker）

### Verdict

**Pass** — B1/B2 验收通过。详见 `review.md`。

### Artifacts Produced

- `review.md` — 完整检查报告（验收映射、契约审查、验证结果、剩余非阻塞风险）

### Scope Reviewed

- Types: `YpiStudioImprovementSubtaskClaimBody`（required `improvementId`）；run `improvementId?`；主 claim body 未混入 scope。
- Library: instance next/claim、`recordYpiStudioSubagentRun` 归属分支、`instance.runIds` Set 去重、主/实例隔离。
- Tool/API: `claim_improvement_subtask`、subagent scope 校验、lifecycle/`persistRunSnapshot`/`buildMemberPrompt` 透传、PATCH `authorizedCwd`。
- Tests/docs: DAG 正向/负向/生命周期/隔离契约；`docs/modules/library.md` 与 `api.md`。

### Verification Re-run

| Command | Result |
| --- | --- |
| `npm run test:studio-dag` | Pass |
| `npm run lint` | Pass |
| `node_modules/.bin/tsc --noEmit` | Pass |

### Findings Fixed

- None（审查未发现需就地修复的缺陷）

### Remaining Risks (non-blocking)

1. Extension/API 接线无自动化烟测；建议主会话在真实 `waiting_for_improvements` 任务上手测：重叠 `subtaskId` 的 scope 拒绝 + 实例 async run 完成/取消后 UI「成员运行」可见。
2. 实例 accepted 后主任务离开 `waiting_for_improvements` 时，迟到的 scoped final/cancel 回写会被拒（与设计一致）；若 child 仍 running 时用户接受改进，可能留下 running 审计记录。
3. 父任务 I1–I5 与其它范围外项仍未处理，应独立返工。

### Decisions Needed From Main Session

- 无阻塞决策。可按 workflow 将本任务从 checking 推进到完成/归档。
- 可选：安排一次真实会话手测；将父任务 I1–I5 拆为独立返工。
