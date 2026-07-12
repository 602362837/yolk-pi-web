# Handoff: 改进流程实现 - B1/B2 复检结果

## 状态

- 子任务 `20260711-232947-修复改进任务派发闭环与成员运行记录丢失` 已完成并通过其检查员。
- 父任务检查员复检 **B1/B2：Pass**（见本目录 `review.md`）。
- 验证：`test:studio-dag` / `test:studio-policy` / `lint` / `tsc --noEmit` 全部通过。

## B1/B2 结论

| 问题 | 结论 | 说明 |
| --- | --- | --- |
| B1 改进实现/检查无法按实例子任务派发 | **已修复** | `claim_improvement_subtask`、`implementation_next(improvementId)`、`ypi_studio_subagent(improvementId)`、主任务 waiting 时主 plan 隔离、PATCH 路由均已落地并有契约测试 |
| B2 `instance.runIds` 永不写入 | **已修复（实现/检查路径）** | start/progress/final/cancel/runtime-lost 透传 `improvementId`，`recordYpiStudioSubagentRun` Set 去重写入；UI `ImprovementRunsTab` 按索引过滤 |

## 非阻塞残余

1. analysis / waiting_plan_approval 阶段 improver、ui-designer 默认不带 `improvementId`，且 start 带 `improvementId` 时要求实例 `implementing|checking` + plan → 分析期成员运行仍可能不出现在改进「成员运行」Tab。建议独立返工。
2. Extension/API 无自动化烟测；建议真实会话手测一次。
3. 实例 accepted 后迟到的 scoped 终态回写被拒（设计如此）。
4. **I1–I5 仍开放**（见下方），不要并入已通过的 B1/B2。

## 父任务仍开放项（I1–I5 / S*）

### 重要

- **I1** `approvalMode=inherit` 仅为展示字段（或文档改为本版仅 standalone）
- **I2** `reconcile_improvements`：tool/docs 有，PATCH route 需确认一致
- **I3** `create_improvement` 事件仍可能含完整 feedback（有界事件）
- **I4** 浮窗「查看改进」入口文案
- **I5** improver 默认 thinking：`inherit` vs 设计推荐 `medium`（需产品确认）

### 建议

- **S1** 主任务 `transitionYpiStudioTask` 未统一 mutation lock
- **S2** 独立通知 store 延后并文档标明
- **S3** tool prompt 写清验收 = transition to accepted / disposition

## 产物

- 父任务 `review.md`：B1/B2 复检完整报告（Pass）
- 子任务目录已有其自身 `review.md` / `handoff.md`

## 给主会话

- **Verdict: Pass** — B1/B2 阻塞已解除，可推进用户验收或先清 I1–I5。
- 无 commit/push。
- 决策仍待确认：I1 inherit、I5 thinking、通知 store 是否延后。
