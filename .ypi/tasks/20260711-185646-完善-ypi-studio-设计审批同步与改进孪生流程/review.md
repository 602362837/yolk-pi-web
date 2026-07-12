# review — 第三版改进流程复检（B1/B2 返工后）

## 检查范围

- 对照父任务 PRD R5、design §4–5、第一次 `review.md` 的 B1/B2，以及子任务 `20260711-232947` 的 design/checks。
- 重点验证：改进实例子任务 next/claim/subagent 作用域、`instance.runIds` 归属、主/实例 plan 隔离、契约测试与文档。
- 未扩大到 I1–I5 产品项（inherit / reconcile route / 事件有界 / 浮窗文案 / improver thinking）。

## Check Complete

### Findings Fixed

- None（本轮为复检；B1/B2 已由子任务 `20260711-232947` 实现并通过其检查，本轮静态复核 + 重跑验证均通过，无需就地修补）

### Remaining Findings

#### 阻塞（Blocker）

- None

#### 重要（Important）

- None（相对本次 B1/B2 验收标准）

#### 非阻塞残余（不阻塞 B1/B2 通过）

1. **improver / ui-designer 分析期 run 仍未归属实例**  
   `ypi_studio_subagent(start, improvementId=…)` 在 extension 中要求实例已是 `implementing | checking` 且有 plan/progress；`buildImprovementStateInjection` 在 `analysis` 阶段仅建议 `ypi_studio_subagent(member=improver)`，不带 `improvementId`。  
   结果：实现/检查路径的 `instance.runIds` 已打通，但分析/原型阶段的成员运行仍只落在主任务 `subagents`，改进详情「成员运行」Tab 在进入实现前仍可能为空。  
   这与返工子任务 design 的作用域一致（B1 闭环 + 带 `improvementId` 的 run 归属），但相对父任务首轮 B2 文案中“improver/ui-designer 已派发也可见”仍有缺口，建议单独返工：允许 analysis/waiting_* 下带 `improvementId` 的无 subtask 启动，并更新 injection 指引。

2. **扩展/API 接线无自动化烟测**  
   `test:studio-dag` 覆盖 library 契约；PATCH `claim_improvement_subtask` 与 child-process start 路径仍建议主会话手工烟测。

3. **实例 accepted 后迟到的 scoped final/cancel 被拒**  
   主任务离开 `waiting_for_improvements` 后，`recordYpiStudioSubagentRun` 拒绝带 `improvementId` 的回写（与设计一致）；child 仍 running 时用户接受改进可能留下 running 审计记录。

4. **父任务 I1–I5 仍未处理**  
   inherit、`reconcile_improvements` 路由一致性、事件 feedback 有界、浮窗「查看改进」、improver 默认 thinking。按范围刻意保留。

### B1 验证对照

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| `YpiStudioImprovementSubtaskClaimBody` + required `improvementId` | Pass | `lib/ypi-studio-types.ts` |
| `YpiStudioTaskSubagentRun.improvementId?` | Pass | types |
| `getNextYpiStudioImplementationSubtask({ improvementId })` | Pass | 仅实例 plan；要求 `waiting_for_improvements` + `implementing\|checking` |
| `claimYpiStudioImprovementSubtask` | Pass | 锁内只改实例 progress；事件含 `improvementId` |
| tool `claim_improvement_subtask` / schema / normalizer | Pass | `lib/ypi-studio-extension.ts` |
| `ypi_studio_subagent` 接受 `improvementId` | Pass | input/schema/`runningRun`/`persistRunSnapshot`/lifecycle 透传 |
| 主任务 waiting 时无 `improvementId` 的主 plan `subtaskId` 被拒 | Pass | extension start 分支 |
| 有 `improvementId` 时只查实例 plan；async ready 走实例 claim | Pass | extension |
| PATCH `claim_improvement_subtask` + `authorizedCwd` | Pass | `app/api/studio/tasks/[taskKey]/route.ts` |
| 主/实例 plan 隔离契约测试 | Pass | `scripts/test-ypi-studio-dag.mjs` |

### B2 验证对照

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| start 首次 `recordYpiStudioSubagentRun` 带 `improvementId` | Pass | `runningRun.improvementId` |
| `instance.runIds` Set 去重追加 | Pass | `recordYpiStudioSubagentRun` 改进分支 |
| 实例 progress 随 run 更新 | Pass | `applySubagentRunToImplementationProgress` |
| progress/final/cancel/runtime-lost 保留归属 | Pass | `persistRunSnapshot` 合并 + runtime-lost 测试 |
| UI 成员运行按 `instance.runIds` 过滤 | Pass | `ImprovementRunsTab` |
| 生命周期/隔离/重复写入测试 | Pass | DAG 测试块 |

### 对照验收标准（本轮）

| 标准 | 结论 |
| --- | --- |
| B1：改进实现员/检查员可领取并执行实例子任务 | **Pass** |
| B2：scoped run 写入 `instance.runIds`，UI 可按索引展示 | **Pass**（实现/检查闭环路径） |
| 主/实例 plan 完全隔离 | **Pass** |
| 相关测试通过 | **Pass** |

### 文档

| 文档 | 结论 |
| --- | --- |
| `docs/modules/library.md` | 描述 instance next/claim/run 分支与 append-only `runIds` |
| `docs/modules/api.md` | 描述 PATCH `claim_improvement_subtask`（required `improvementId`、cwd 覆盖） |
| `docs/modules/frontend.md` | 改进 Tab / 成员运行按 `instance.runIds` 过滤已描述 |

### Verification

| Command | Result |
| --- | --- |
| `npm run test:studio-dag` | Pass |
| `npm run test:studio-policy` | Pass |
| `npm run lint` | Pass |
| `node_modules/.bin/tsc --noEmit` | Pass |

### Verdict

**Pass**

B1（改进实现/检查按实例子任务派发）与 B2（带 `improvementId` 的 run 写入 `instance.runIds` 并可供 UI 过滤）已在返工后闭合；契约测试与类型/库/工具/API/文档一致。  
父任务可按 workflow 推进用户验收（或先处理 I1–I5 与分析期 run 归属缺口后再验收，由主会话决定）。

### 主会话建议

1. 可选手工烟测：`waiting_for_improvements` 下重叠 `subtaskId` 的 scope 拒绝；实例 async implementer complete/cancel 后详情「成员运行」可见。
2. I1–I5 与「analysis 期 improver/ui-designer 带 improvementId」拆独立返工，勿与已通过的 B1/B2 混改。
3. 无新的阻塞产品决策；I5 thinking 与 I1 inherit 仍待产品确认。
